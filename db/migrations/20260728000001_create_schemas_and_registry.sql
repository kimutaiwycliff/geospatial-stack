-- migrate:up

-- Medallion tiers as real PostGIS schemas, not just a naming convention --
-- Martin/tippecanoe/FastAPI are only ever pointed at `published`; `raw` and
-- `curated` exist so nothing "just becomes a file on disk" between them (brief §4/§5).
CREATE SCHEMA raw;
CREATE SCHEMA curated;
CREATE SCHEMA published;

-- The catalog spans all three tiers, so it gets its own schema rather than
-- living inside one of them -- a dataset's registry row outlives and describes
-- its journey across raw -> curated -> published, it isn't owned by any one tier.
CREATE SCHEMA registry;

CREATE TYPE registry.sensitivity AS ENUM ('public', 'restricted', 'withheld');
CREATE TYPE registry.tier_status AS ENUM ('raw', 'curated', 'published');
CREATE TYPE registry.serve_mode AS ENUM ('pmtiles', 'martin');

-- Every layer is a row here before it's servable (brief §4, "registry-first").
CREATE TABLE registry.datasets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    description     TEXT,

    -- Provenance/consent metadata -- non-optional for land-rights data (brief §13),
    -- kept as plain text since license/attribution wording must be recorded verbatim.
    source          TEXT,
    license         TEXT,
    attribution     TEXT,

    -- Defaults to the most protective option: a new dataset is `withheld` until
    -- someone explicitly classifies it, never silently `public` by omission.
    sensitivity     registry.sensitivity NOT NULL DEFAULT 'withheld',

    crs             TEXT NOT NULL DEFAULT 'EPSG:4326',
    geometry_type   TEXT,
    -- Bbox as a real geometry (not four floats) so extent queries can use the
    -- same spatial operators/indexes as everything else in PostGIS.
    extent          geometry(Polygon, 4326),

    tier_status     registry.tier_status NOT NULL DEFAULT 'raw',
    -- NULL until a layer is actually published and a serving path is chosen --
    -- a raw/curated-only dataset has no serve_mode yet.
    serve_mode      registry.serve_mode,

    -- Attribute fields + types as ingested -- lets the admin UI (Horizon 2)
    -- render a schema preview without re-reading the source file.
    schema_json     JSONB,

    created_by      TEXT,
    version         INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX datasets_extent_gix ON registry.datasets USING GIST (extent);
CREATE INDEX datasets_tier_status_idx ON registry.datasets (tier_status);

-- Generic "touch updated_at" trigger -- every future writer (worker tasks,
-- admin API, Horizon-2 upload flow) gets a correct updated_at for free instead
-- of each caller having to remember to set it.
CREATE FUNCTION registry.set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER datasets_set_updated_at
    BEFORE UPDATE ON registry.datasets
    FOR EACH ROW
    EXECUTE FUNCTION registry.set_updated_at();

-- migrate:down

DROP TRIGGER IF EXISTS datasets_set_updated_at ON registry.datasets;
DROP FUNCTION IF EXISTS registry.set_updated_at();
DROP TABLE IF EXISTS registry.datasets;
DROP TYPE IF EXISTS registry.serve_mode;
DROP TYPE IF EXISTS registry.tier_status;
DROP TYPE IF EXISTS registry.sensitivity;
DROP SCHEMA IF EXISTS registry;
DROP SCHEMA IF EXISTS published;
DROP SCHEMA IF EXISTS curated;
DROP SCHEMA IF EXISTS raw;
