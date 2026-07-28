#!/usr/bin/env bash
# Restore drill (brief §2.2: "a documented, and at least once actually
# executed, restore-from-backup drill"). Restores into a THROWAWAY database
# on the SAME running Postgres instance, never touching the live
# `$POSTGRES_DB` -- a restore drill that risked the real data to prove
# backups work would defeat its own purpose. The throwaway db is dropped at
# the end whether the drill passes or fails (trap, not just a happy-path
# cleanup line).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

DUMP_FILE="${1:?Usage: pg_restore_drill.sh <path-to-dump-file>}"
RESTORE_DB="geoplatform_restore_drill"

# shellcheck disable=SC1091
source .env

cleanup() {
  docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB" || true
}
trap cleanup EXIT

echo "pg_restore_drill: creating throwaway database $RESTORE_DB"
docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$RESTORE_DB"

echo "pg_restore_drill: restoring $DUMP_FILE into $RESTORE_DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" < "$DUMP_FILE"

echo "pg_restore_drill: verifying row counts against the live database"
LIVE_COUNT=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT COUNT(*) FROM registry.datasets")
RESTORED_COUNT=$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$RESTORE_DB" -tAc \
  "SELECT COUNT(*) FROM registry.datasets")

if [ "$LIVE_COUNT" != "$RESTORED_COUNT" ]; then
  echo "pg_restore_drill: FAILED -- registry.datasets row count mismatch (live=$LIVE_COUNT restored=$RESTORED_COUNT)"
  exit 1
fi

echo "pg_restore_drill: PASSED -- restored $RESTORED_COUNT registry.datasets rows, matches live"
