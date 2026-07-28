# VPS deployment runbook (brief §2.5)

**Status: documented, not executed.** The client chose local-Docker-only for
now -- nothing in this file has been run against a real host. Every command below that provisions, exposes, or
publishes something is a plan, not a completed action. **Do not run any
command in this file against a real server without the client's explicit,
current go-ahead** -- that authorization is scoped to this specific
deployment, not implied by anything decided earlier in this project.

## 1. Provisioning

Any VPS provider works; the only real requirements are: a public IPv4/IPv6
address, a recent Linux distro with a maintained kernel (Ubuntu 24.04 LTS or
Debian 12 are both fine), and enough RAM for the whole stack --
`docker stats` during local development showed the worker alone using
2-3GB while processing a 327K-feature LandMark dataset (see
`geospatial-stack-build-brief-v3.md`'s session history), so **8GB RAM
minimum**, more if the client expects to ingest datasets at that scale
regularly. 4 vCPUs, 80GB+ disk (object storage + Postgres + Docker images
add up fast -- the community-lands raw parquet alone is ~860MB, and that's
one dataset).

```
# On a fresh Ubuntu 24.04 host:
curl -fsSL https://get.docker.com | sh
usermod -aG docker <deploy-user>   # avoid running compose as root
```

DNS: an A/AAAA record pointing the deployment domain at the VPS's IP,
created before starting Caddy -- Caddy's automatic HTTPS (below) does an
ACME HTTP-01/TLS-ALPN challenge that needs the domain to already resolve to
this host.

## 2. Firewall: only 80/443 exposed

This is already how `docker-compose.yml` is written (brief §10) -- `proxy`
(Caddy) is the only service with a `ports:` mapping; everything else
(Postgres, Redis, MinIO, the API, Martin, Flower, Prometheus, Grafana) is
reachable only on the internal Docker network. The VPS's own firewall
should enforce the same boundary at the OS level too, as defense in depth
(a compose misconfiguration shouldn't be the only thing standing between
Postgres and the public internet):

```
ufw default deny incoming
ufw allow 22/tcp    # SSH -- restrict to a known IP range if possible
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**`docker-compose.override.yml` (local dev port exposure) must NOT be
deployed to the VPS.** It's what makes `db`/`redis`/`storage`/`martin`/`api`
directly reachable on `localhost` for development -- deploying it to a
public host would undo the whole point of "only proxy exposes ports."
`docker compose -f docker-compose.yml up -d` (no `-f override`) is the
production invocation; Compose only auto-loads `docker-compose.override.yml`
when it's *not* explicitly excluded like this.

## 3. Caddy auto-HTTPS + HSTS

`caddy/Caddyfile` currently targets `:80` for local dev (see its own
comments). For a real domain, the site block becomes:

```
your-domain.example {
	# Caddy issues/renews the cert automatically via ACME -- no manual
	# certbot, no cert files to manage. `header` adds HSTS so browsers
	# stop even trying plain HTTP after the first successful HTTPS visit.
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"

	handle_path /tiles/* {
		reverse_proxy martin:3000
	}
	handle_path /objects/* {
		rewrite * /geoplatform{uri}
		reverse_proxy storage:9000
	}
	handle_path /api/* {
		reverse_proxy api:8000 {
			header_up X-Forwarded-Prefix /api
		}
	}
	handle {
		reverse_proxy web:80
	}
	encode gzip zstd
}
```

Nothing else in the routing changes -- same `handle_path` structure as the
dev Caddyfile, just a real domain instead of `:80` and Caddy's automatic TLS
taking over from there. Caddy needs outbound 80/443 to reach Let's Encrypt
for the ACME challenge (already covered by the firewall rules above, which
only restrict *inbound* traffic).

## 4. Image digest pinning

Every `image:` line in `docker-compose.yml` currently uses a mutable tag
(`:latest`, `:17-3.5`, etc.) -- fine for local dev (you want the latest
patch release), risky for production (a tag can point at a different image
tomorrow than it does today, silently). Before a real deploy, pin every
base image to its digest:

```
docker compose pull
docker compose images --format json | jq -r '.[] | "\(.Repository):\(.Tag)"' | while read -r img; do
  digest=$(docker inspect --format='{{index .RepoDigests 0}}' "$img")
  echo "$img -> $digest"
done
```

Replace each `image: foo:tag` with `image: foo@sha256:<digest>` in
`docker-compose.yml`. This makes deploys reproducible (the exact same
bytes run today and after a server rebuild) -- re-pin deliberately (and
re-scan, next section) when actually upgrading a dependency, not
automatically.

## 5. Image scanning (Trivy)

```
docker compose build
for img in $(docker compose config --images); do
  trivy image --severity HIGH,CRITICAL --exit-code 1 "$img"
done
```

Run this in CI (`.github/workflows/ci.yml`'s `build-images` job is the
natural place to add it) before any image reaches the VPS, and again
periodically against whatever's actually pinned in production -- a
vulnerability disclosed in a base image after it was pinned/deployed won't
show up until you scan again.

## 6. First deploy checklist

1. DNS resolves to the VPS.
2. `.env` on the VPS has real secrets (`JWT_SECRET`, `POSTGRES_PASSWORD`,
   `MINIO_ROOT_PASSWORD`/real R2 credentials, `GRAFANA_ADMIN_PASSWORD`,
   `SENTRY_DSN`) -- **never** the placeholder values from `.env.example`.
   `API_CORS_ORIGINS` should list only the real production origin(s), not
   `localhost`/`127.0.0.1`.
3. Images pinned by digest (§4) and scanned clean (§5).
4. `docker compose -f docker-compose.yml up -d` (explicitly excluding the
   override file, §2).
5. `docker compose ps` -- everything healthy, no restart loops.
6. Confirm the deployed site over HTTPS, confirm the cert is real (not a
   Caddy internal/staging cert -- check `caddy/data` didn't get created
   from a `ZeroSSL`/staging fallback because DNS wasn't ready yet).
7. Run `ops/backup/pg_backup.sh` once, immediately, so there's a first
   backup before any real data lands -- see `docs/backups.md`.
8. Schedule the backup script (cron/systemd timer) -- the restore drill in
   `docs/backups.md` was run manually once during development; production
   needs it running on an actual schedule, not "whenever someone remembers."

## 7. Deploy-on-tag (not wired yet)

`docs/backups.md` and this file both assume a manual `docker compose up -d`
deploy. `.github/workflows/ci.yml` deliberately stops at building images --
no `deploy` job pushes anywhere, because there's no VPS target yet to push
to. Once step 1-6 above have actually been done once by hand, the natural
next step is a tag-triggered GitHub Actions job that SSHes in and re-runs
step 4 with the newly pinned image digests -- add that job to
`ci.yml` at that point, not before (a deploy job with no real target to
verify against is dead code that will bit-rot before it's ever used).
