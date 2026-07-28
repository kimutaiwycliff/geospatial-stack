#!/usr/bin/env bash
# Postgres backup (brief §2.2). Runs pg_dump INSIDE the `db` container via
# `docker compose exec` rather than needing a separate backup image with its
# own postgresql-client install -- the postgis/postgis image is built FROM
# the official postgres image, so pg_dump/pg_restore/createdb/dropdb are
# already there, unused by anything else in this stack.
#
# Custom format (-Fc), not plain SQL: it's compressed, and pg_restore can
# selectively restore from it (a full plain-SQL dump can only be replayed
# start-to-finish) -- useful once this DB has more than one schema/tier
# worth restoring independently.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

BACKUP_DIR="${BACKUP_DIR:-ops/backup/dumps}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_DIR/geoplatform-$TIMESTAMP.dump"

# shellcheck disable=SC1091
source .env

docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST"

echo "pg_backup: wrote $DEST ($(du -h "$DEST" | cut -f1))"
