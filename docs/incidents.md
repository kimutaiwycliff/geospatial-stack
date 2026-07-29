# Incident runbook

`docs/deploy.md` covers standing the stack up; `docs/backups.md` covers what
gets backed up and how. Neither says what to actually DO at 3am when
something's broken -- this is that missing piece (production-readiness
audit finding). Structured as symptom -> diagnose -> fix, in the order
you'd actually hit them, plus one full restore-from-backup walkthrough at
the end.

## First move, always

```
docker compose ps
```

Read the `STATUS`/`HEALTH` columns before touching anything else -- this
tells you which service is actually the problem, versus a downstream
service just failing its own dependency check (e.g. `api` "unhealthy"
because `db` is down is a `db` incident, not an `api` one).

## Symptom: a service is down / restarting in a loop

```
docker compose ps
docker compose logs --tail=200 <service>
```

Every long-running service now has `restart: unless-stopped`
(docker-compose.yml) -- Docker already retries a crashed container on its
own, so "down" here means it's stuck in a genuine crash loop, not a single
blip Docker already recovered from. Grafana's Loki datasource (Explore ->
Loki, filter `{service="<name>"}`) has the same log lines with more
history and full-text search than `docker compose logs` keeps.

- **`db` down**: check `docker compose logs db` for a corrupt-data-directory
  message before anything else -- if the `pgdata` volume is intact this is
  almost always a resource issue (see `mem_limit`/`cpus` in
  docker-compose.yml -- an OOM-killed Postgres logs as a plain crash with no
  Postgres-level error at all). `docker stats` while reproducing will show
  whether it's actually hitting its memory ceiling.
- **`worker` down / OOM**: worker runs DuckDB/GDAL/tippecanoe against
  whatever was just uploaded -- check Flower (`:5555`, or through Caddy at
  deploy time) for which task was running when it died. A single
  pathological upload can be reproduced/killed via `docker compose exec
  worker celery -A worker.celery_app control revoke <task_id>` before
  restarting the container, so the same bad job doesn't immediately retry
  and OOM it again the moment it comes back up.
- **`api` unhealthy but `db`/`redis` are healthy**: `/healthz` deliberately
  never touches Postgres (see app/main.py's comment on why) -- if this is
  failing, the uvicorn process itself is wedged. Check
  `docker compose logs api` for an unhandled startup exception; Sentry
  (once `SENTRY_DSN` is set) would also have caught this as an event.

## Symptom: a curator's upload is stuck "still validating"

The admin UI reads this as "raw or curated with no `validation_report`
yet" (`UploadStatusPanel.tsx`). Two possibilities, both diagnosable from the
same place:

```
docker compose logs worker --tail=200 | grep <slug>
```

or, better, Grafana Explore -> Loki -> `{service="worker"} |= "<slug>"`
(structured JSON logs, filterable by any field, not just full-text grep).

- **Task is genuinely still running**: a real (non-fixture) dataset can
  legitimately take minutes (see `docs/deploy.md`'s "2-3GB RAM, several
  minutes" note) -- Flower's task list shows STARTED vs. still-PENDING.
- **Task crashed without writing a failure report**: this used to be
  possible (a bug fixed earlier this project's history, see git log for
  `_write_failure_report`) -- if you see an exception in the logs but the
  registry row still shows no `validation_report`, that's a regression of
  that fix and worth a bug report, not just a manual UPDATE.
- **Task is retrying a transient failure**: `ingest_task`/`curate_task` now
  autoretry on `psycopg2.OperationalError`/S3 connection errors (up to 3
  attempts, exponential backoff) before writing a failure report -- a
  "still validating" that resolves itself within a couple minutes without
  intervention is this working as intended, not a hang.

## Symptom: public site / tiles down but the API itself is fine

```
docker compose logs proxy --tail=100
```

Caddy is the only service reachable from outside Docker's internal network
-- if `api`/`martin`/`web` all report healthy via `docker compose ps` but
nothing is reachable externally, the problem is almost always upstream of
Caddy (DNS, the host firewall, or -- once on a real domain -- an expired/
failed TLS cert renewal, which Caddy logs explicitly).

## Live restore from a Postgres backup

`ops/backup/pg_restore_drill.sh` is a **planned drill**, run against a
throwaway database to prove a dump is restorable -- it is NOT the same as
restoring the actual running `db` service during a real incident. If you
genuinely need to restore `db` itself:

1. **Stop anything that writes to Postgres first** -- `docker compose stop
   api worker migrate` (leave `db` itself running). Skipping this risks a
   write landing mid-restore.
2. Confirm which dump to use: `ls -la ops/backup/dumps/` -- filenames are
   timestamped (`geoplatform-<UTC timestamp>.dump`); pick the most recent
   one from BEFORE whatever went wrong, not just the newest file.
3. Copy the dump into the `db` container and restore into a **fresh**
   database (never restore over the live one in place -- if the restore
   itself fails partway, you still have the original intact):
   ```
   docker compose cp ops/backup/dumps/<file>.dump db:/tmp/restore.dump
   docker compose exec db psql -U ${POSTGRES_USER} -c "CREATE DATABASE restore_check;"
   docker compose exec db pg_restore -U ${POSTGRES_USER} -d restore_check /tmp/restore.dump
   ```
4. Once `pg_restore` reports success with no errors, swap it in:
   ```
   docker compose exec db psql -U ${POSTGRES_USER} -c \
     "ALTER DATABASE ${POSTGRES_DB} RENAME TO ${POSTGRES_DB}_broken; ALTER DATABASE restore_check RENAME TO ${POSTGRES_DB};"
   ```
5. `docker compose start api worker migrate` and verify `/healthz` plus a
   real page load before deleting `${POSTGRES_DB}_broken` -- keep it around
   until you're confident the restore is good, then drop it.

Object storage (MinIO/R2) restores the same way via `ops/backup/s3_backup.py`
in reverse (copy from the backup bucket back to the primary one) -- see
`docs/backups.md`; PMTiles/basemap objects are also fully regenerable by
re-running the relevant worker task, so a storage-side incident is lower
stakes than a Postgres one.
