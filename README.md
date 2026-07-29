# Geospatial platform

A Docker-first, reusable geospatial platform for publishing and sharing
geographic data: PostGIS + DuckDB/GeoParquet ETL, Martin (dynamic vector
tiles) + PMTiles (static), a MapLibre GL Vite+React SPA, FastAPI (public
read + auth-gated admin), Celery/Redis background jobs, and self-hosted
OSM basemap tiles behind Caddy. See
[`geospatial-stack-build-brief-v3.md`](geospatial-stack-build-brief-v3.md)
for the full plan of record (mission, architecture, data model, security
defaults, roadmap) this was built against.

## What the app does

- **Public map site** — an interactive map of every published layer, with
  country search, layer toggles, click-to-inspect popups, and shareable
  URLs (map state round-trips through the query string).
- **Self-service upload** — an admin uploads a GeoJSON/GPKG/GeoParquet
  file through the dashboard; it's validated automatically (geometry
  validity, CRS, row count, a sample-feature preview) before anyone can
  publish it. A failed validation shows exactly what's wrong, not just
  "failed."
- **Live styling** — set a layer's fill color/opacity from the admin UI,
  save a draft, publish it — no re-tiling, no deploy, visible on the
  public map within a page reload.
- **Dataset governance** — every layer carries source/license/attribution
  and a sensitivity classification (`public`/`restricted`/`withheld`,
  defaulting to the most protective option), editable from the admin UI,
  with a full audit trail of who changed what and when.
- **Map authoring** — compose a named, curated map from a subset of
  published layers, set a default view, choose which MapLibre controls it
  shows (navigation, geolocate, a place-search box, a measure tool, a
  minimap, lat/lon gridlines — each toggleable and positionable per map),
  publish it, and share it via its own public URL (`/m/<slug>`).
- **JWT auth**, `viewer`/`admin` roles, **no signup page by design** —
  admin accounts are created with `make create-admin`, never from the
  browser (see [`docs/reuse.md`](docs/reuse.md) for why).
- **Observability, backups, R2-portable object storage** — Prometheus +
  Grafana + Sentry, a tested `pg_dump` backup/restore procedure, and
  object storage that's MinIO by default but swaps to Cloudflare R2 via
  five env vars with zero code changes.

## Quick start (local Docker)

Requires Docker + Docker Compose. From a fresh clone:

```
cp .env.example .env      # or scripts/bootstrap-new-deployment.sh for a NEW deployment, see docs/reuse.md
make up                   # builds images (first run only) and starts every service
make create-admin EMAIL=you@example.org PASSWORD=your-password
```

That's it — the whole stack (database, object storage, tile server, API,
background worker, frontend, reverse proxy, observability) is running.

- **Public site:** http://localhost:8080 (via Caddy)
- **Admin login:** http://localhost:8080/admin/login
- **API docs (Swagger):** http://localhost:8000/docs
- **Flower** (Celery task monitor): http://localhost:5555
- **Grafana** (dashboards): http://localhost:3001 — local dev only, exposed by `docker-compose.override.yml`

`make up` waits for nothing — check `make ps` after a few seconds and
confirm every service says `healthy` (or has no healthcheck defined)
before logging in; a fresh Postgres + migration run typically takes under
a minute.

## Makefile command reference

Every command below wraps a `docker compose`/`dbmate`/admin-CLI
invocation — run `make help` any time for this same list from the
terminal. All of these work identically on a VPS as they do locally
(Docker Compose doesn't care about the host); see the deployment section
below for what's actually different in production.

| Command | What it does |
|---|---|
| `make up` | Start the stack (builds images first if they don't exist yet). Safe to re-run — it won't touch already-running services or existing data. |
| `make down` | Stop every service. **Data survives** — the named volumes (Postgres, object storage, Redis, Grafana, Prometheus) are untouched. |
| `make restart` | `down` then `up`. |
| `make build` | Rebuild every image from the current source. Run this after pulling new code — `make up` alone won't pick up code changes in an already-built image. |
| `make logs` | Follow logs from every service (Ctrl-C to stop watching; doesn't stop anything). |
| `make ps` | Show every service's status (running/healthy/restarting). |
| `make migrate` | Apply any database migrations that haven't run yet. `make up` already does this automatically on every start (the `migrate` service runs once and exits before `api` starts) — use this directly when you've added a migration to a stack that's already running and don't want to restart everything. |
| `make create-admin EMAIL=... PASSWORD=...` | Create an admin account — or **reset the password of an existing one**, since this is an upsert. This is the *only* way to get admin access; there is no signup page (deliberate, see `docs/reuse.md`). |
| `make wipe` | **Destroys all data**: every dataset, map, admin account, and audit log entry, permanently. Asks you to type `wipe` to confirm first — there is no `-y`/force flag, so it can't be scripted past by accident. No undo short of a backup restore (`docs/backups.md`). |
| `make fresh-start` | `wipe` → `build` → `up` — the full "start over from an empty database" sequence. Still asks for the `wipe` confirmation. After it finishes, the only remaining step is `make create-admin`. |

**Typical flows:**

```
# I pulled new code and want to run it
make build && make restart

# I forgot the admin password
make create-admin EMAIL=you@example.org PASSWORD=a-new-password

# I want to nuke everything and start completely clean
make fresh-start
make create-admin EMAIL=you@example.org PASSWORD=your-password
```

## Deploying to a VPS

The same `make`/`docker compose` commands above are what you run on a
server too — a VPS deploy is not a different tool, just a different
`.env` and a few production-only steps that don't apply to a laptop.
**Read [`docs/deploy.md`](docs/deploy.md) in full before deploying** — it
covers, in order: provisioning sizing (8GB RAM / 4 vCPU minimum), the
firewall rules (only Caddy's 80/443 should ever be internet-reachable),
why `docker-compose.override.yml` must **not** ship to the server (it's
what exposes Postgres/Redis/MinIO/etc. directly on `localhost` for local
dev — the opposite of what a public host should do), swapping Caddy's
Caddyfile to your real domain for automatic HTTPS, pinning image digests,
scanning images with Trivy, and the first-deploy checklist.

The short version, once DNS points at the server and `docs/deploy.md`'s
prep steps are done:

```
cp .env.example .env
# edit .env: real JWT_SECRET/POSTGRES_PASSWORD/MINIO_ROOT_PASSWORD (or R2
# credentials)/GRAFANA_ADMIN_PASSWORD/SENTRY_DSN, and API_CORS_ORIGINS set
# to the real domain only -- never the .env.example placeholder values.
docker compose -f docker-compose.yml up -d   # NOT `make up` -- see below
make create-admin EMAIL=you@example.org PASSWORD=your-password
```

**One real difference from local dev:** on a VPS you invoke
`docker compose -f docker-compose.yml up -d` directly instead of
`make up`, specifically to exclude `docker-compose.override.yml` (Compose
auto-loads that file unless you name `-f` explicitly, which is exactly
what you want on a laptop and exactly what you must avoid on a public
host). Every other Makefile command (`down`, `logs`, `ps`, `migrate`,
`create-admin`, `wipe`) is safe to use as-is in production — `make wipe`
in particular is exactly as destructive there as anywhere else, so treat
it with the same care.

**Status note:** `docs/deploy.md` is a complete, reviewed runbook, but it
has not yet been executed against a real production host — this project's
deployment scope has been local-Docker-only so far. Don't run any of its
provisioning/DNS/TLS steps against a real server without first confirming
that's actually intended.

## Reusing this codebase for a different deployment

If you're standing up a *second*, independent deployment (different
client, different data, different domain) from this same codebase rather
than just running this one — see
[`docs/reuse.md`](docs/reuse.md) for exactly what to change and
[`scripts/bootstrap-new-deployment.sh`](scripts/bootstrap-new-deployment.sh)
to automate the mechanical part of it (project slug → fresh `.env` with
new database/bucket names and random secrets).

## Docs

- [`docs/deploy.md`](docs/deploy.md) — VPS deployment runbook.
- [`docs/backups.md`](docs/backups.md) — backup/restore procedure.
- [`docs/r2-portability.md`](docs/r2-portability.md) — switching object storage providers.
- [`docs/reuse.md`](docs/reuse.md) — standing up a new deployment from this codebase.
