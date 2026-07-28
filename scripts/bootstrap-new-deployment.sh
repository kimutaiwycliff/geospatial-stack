#!/usr/bin/env bash
# Automates the mechanical part of docs/reuse.md step 1 (env identity) for
# a NEW deployment of this platform -- a different client/dataset/domain,
# from a fresh clone of this repo. Does NOT touch an existing .env: this is
# meant to run once, right after cloning, before `docker compose up` has
# ever been run against this checkout.
#
# What it does NOT do (see docs/reuse.md for the rest, done by hand):
# clear api/worker/seed_datasets.py, delete data/landmark or data/stand_in,
# rewrite web/src/components/Landing.tsx, or create the first admin account.
# Those are content/product decisions, not mechanical substitution -- a
# script guessing at them would be more likely to silently do the wrong
# thing than to save real time.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "error: .env already exists -- refusing to overwrite a deployment that may already be running." >&2
  echo "       (this script is meant to run once, right after cloning, before the FIRST docker compose up)" >&2
  exit 1
fi

if [ ! -f .env.example ]; then
  echo "error: .env.example not found -- run this from a checkout of the repo, not a copied-out scripts/ dir." >&2
  exit 1
fi

read -r -p "New project slug (lowercase, alnum + hyphens, e.g. 'county-land-atlas'): " SLUG
if ! [[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "error: slug must be lowercase alnum + hyphens only (got '$SLUG')." >&2
  exit 1
fi

# Postgres identifiers and S3 bucket names both reject hyphens/need distinct
# rules (Postgres db names are fine with hyphens if quoted, but every other
# script/tool in this repo composes DATABASE_URL unquoted -- underscores
# sidestep that entirely); S3 bucket naming rules (DNS-safe, lowercase,
# hyphens-not-underscores) are the opposite, hence two derived forms.
DB_NAME="$(echo "$SLUG" | tr '-' '_')"
BUCKET_NAME="$SLUG"
JWT_SECRET="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(openssl rand -hex 16)"
MINIO_PASSWORD="$(openssl rand -hex 16)"
GRAFANA_PASSWORD="$(openssl rand -hex 16)"

sed \
  -e "s/^POSTGRES_DB=.*/POSTGRES_DB=${DB_NAME}/" \
  -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${POSTGRES_PASSWORD}/" \
  -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://geo:${POSTGRES_PASSWORD}@db:5432/${DB_NAME}?sslmode=disable#" \
  -e "s/^S3_BUCKET=.*/S3_BUCKET=${BUCKET_NAME}/" \
  -e "s/^MINIO_ROOT_PASSWORD=.*/MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}/" \
  -e "s/^S3_SECRET_KEY=.*/S3_SECRET_KEY=${MINIO_PASSWORD}/" \
  -e "s/^JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" \
  -e "s/^GRAFANA_ADMIN_PASSWORD=.*/GRAFANA_ADMIN_PASSWORD=${GRAFANA_PASSWORD}/" \
  .env.example > .env

echo
echo "Wrote .env for project '${SLUG}' (db=${DB_NAME}, bucket=${BUCKET_NAME}), with fresh random secrets."
echo
echo "Remaining manual steps (see docs/reuse.md for detail):"
echo "  1. Review .env -- API_CORS_ORIGINS and any provider-specific values (e.g. R2 credentials) still need real values."
echo "  2. Clear or replace api/worker/seed_datasets.py's example entries."
echo "  3. Delete data/landmark/ and data/stand_in/ if this deployment doesn't need them."
echo "  4. Replace web/src/components/Landing.tsx's copy."
echo "  5. docker compose up -d, then: docker compose exec api python -m app.create_admin <email> <password>"
