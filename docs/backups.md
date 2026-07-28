# Backups & restore drill (brief §2.2)

Two independent things get backed up: the Postgres database (registry +
`published.*` tables) and the object-storage bucket (raw/curated GeoParquet,
built PMTiles, the basemap). They're backed up separately, not as one
combined snapshot, because they restore independently too -- object storage
holds regenerable intermediate artifacts (re-run the pipeline against the
same source to reproduce `raw/curated`), while Postgres holds the one thing
that has no "regenerate it" path if lost: the registry catalog and whatever
governance metadata (sensitivity, license, consent basis) has been recorded
against each dataset.

## Postgres: `ops/backup/pg_backup.sh`

```
./ops/backup/pg_backup.sh
```

Runs `pg_dump -Fc` **inside the `db` container** (`docker compose exec`) --
no separate backup image needed, since `postgis/postgis` is built from the
official `postgres` image and already ships `pg_dump`/`pg_restore`. Custom
format (`-Fc`), not plain SQL, so `pg_restore` can later restore selectively
if this database ever has more than one schema worth restoring
independently. Writes a timestamped `.dump` file to `ops/backup/dumps/`
(gitignored -- see repo `.gitignore`; dumps aren't source, and a 190MB+
binary file has no business in git history).

## Object storage: `ops/backup/s3_backup.py`

```
docker run --rm --network geospatial_stack_default --env-file .env \
  -v "$(pwd)/ops/backup:/backup" geospatial_stack-worker \
  python3 /backup/s3_backup.py [backup-bucket-name]
```

Server-side `CopyObject` calls (not download-then-reupload) via the same
plain S3 API every other part of this stack uses -- works unchanged against
R2 (see `docs/r2-portability.md`), and doesn't push gigabytes of PMTiles
data through this process's own network stack just to move it bucket-to-
bucket. Defaults to a `geoplatform-backup` bucket on the same endpoint; point
it at a genuinely separate provider/region for real disaster-recovery
value (same-endpoint backups don't protect against that endpoint disappearing).

## Restore drill: `ops/backup/pg_restore_drill.sh`

```
./ops/backup/pg_restore_drill.sh ops/backup/dumps/<dump-file>.dump
```

Restores into a **throwaway database** (`geoplatform_restore_drill`) on the
same running Postgres instance, never touching the live database -- a
restore drill that risked live data to prove backups work would defeat its
own purpose. Verifies `registry.datasets` row count matches the live
database's, then drops the throwaway database via a `trap` (runs on
success OR failure, so a failed drill doesn't leave a stray database
behind).

### Actually executed (2026-07-28)

```
$ ./ops/backup/pg_backup.sh
pg_backup: wrote ops/backup/dumps/geoplatform-20260728T174147Z.dump (192M)

$ ./ops/backup/pg_restore_drill.sh ops/backup/dumps/geoplatform-20260728T174147Z.dump
pg_restore_drill: creating throwaway database geoplatform_restore_drill
pg_restore_drill: restoring ops/backup/dumps/geoplatform-20260728T174147Z.dump into geoplatform_restore_drill
pg_restore_drill: verifying row counts against the live database
pg_restore_drill: PASSED -- restored 8 registry.datasets rows, matches live

$ docker run --rm --network geospatial_stack_default --env-file .env \
    -v "$(pwd)/ops/backup:/backup" geospatial_stack-worker python3 /backup/s3_backup.py
s3_backup: 8 objects copied from geoplatform to geoplatform-backup
```

Confirmed via `list_objects_v2` against `geoplatform-backup` afterward: all 8
objects present with matching sizes (raw/curated GeoParquet for both real
LandMark datasets, both PMTiles archives, and the basemap).

## Not yet automated

This drill was run manually, once, to prove the mechanism works end-to-end
-- it is not yet on a schedule (cron/systemd timer on the VPS, once one
exists; brief §2.5's runbook is where that gets documented for real). A
backup that's never actually run until the day you need it is the exact
failure mode this drill exists to rule out; running it again periodically
(not just once, here) is a VPS-runbook follow-up, not a Phase-2 checkbox.
