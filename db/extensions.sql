-- Runs once via docker-entrypoint-initdb.d against a fresh PostGIS volume
-- (see docker-compose.yml `db` service). Needs superuser, which is why this
-- is separate from dbmate's migrations -- those run as the app role and
-- only ever touch schemas/tables/indexes, never extensions.
CREATE EXTENSION IF NOT EXISTS postgis;
