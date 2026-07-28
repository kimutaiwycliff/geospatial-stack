-- migrate:up

-- Self-service validation reporting (brief §16 step 3: "preview + report").
-- Nullable JSONB on the existing registry.datasets row rather than a
-- separate table -- one upload is one registry row throughout its whole
-- raw -> curated -> published lifecycle, and the report describes THAT
-- row's current curated state, not a separate append-only history
-- (registry.audit_log already covers "who did what when").
ALTER TABLE registry.datasets ADD COLUMN validation_report JSONB;

-- Map authoring (brief §16 second half): a Map is stored config over
-- registry layers, not code -- "create a new map" needs no engineering,
-- exactly the GeoLibre-like ease the brief wants, but server-published and
-- governed the same way a dataset is.
CREATE TYPE registry.map_status AS ENUM ('draft', 'published');

CREATE TABLE registry.maps (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT NOT NULL,
    slug           TEXT NOT NULL UNIQUE,
    description    TEXT,

    -- Ordered [{dataset_slug, visible, style_ref}, ...] -- dataset_slug
    -- (not a registry.datasets UUID FK) matches every other public-facing
    -- identifier in this API (get_feature, /datasets, the styles router
    -- all key off slug already); style_ref is always "published" today
    -- (a map only ever shows a layer's published style, brief §6.3 -- an
    -- admin's in-progress draft on some other layer has no business
    -- leaking into someone else's published map), kept as a field rather
    -- than hardcoded so a future per-map style override has somewhere to
    -- live without another migration.
    layers_json    JSONB NOT NULL DEFAULT '[]',

    basemap        TEXT NOT NULL DEFAULT 'light',
    -- {center: [lng, lat], zoom: number} -- matches web/src/lib/urlState.ts's
    -- view-state shape exactly (not a PostGIS bbox like registry.datasets.
    -- extent) because a Map's default_extent is only ever READ back into a
    -- MapLibre `flyTo`/initial viewport, never spatially queried -- there's
    -- no ST_Intersects-type use case here that would justify a real
    -- geometry column and its GIST index.
    default_extent JSONB,
    filters_json   JSONB,
    legend_json    JSONB,

    status         registry.map_status NOT NULL DEFAULT 'draft',
    created_by     TEXT,
    version        INT NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX maps_status_idx ON registry.maps (status);

-- Reuses registry.set_updated_at() from migration 1, same as every other
-- admin-editable table so far (auth.users, registry.layer_styles).
CREATE TRIGGER maps_set_updated_at
    BEFORE UPDATE ON registry.maps
    FOR EACH ROW
    EXECUTE FUNCTION registry.set_updated_at();

-- migrate:down

DROP TRIGGER IF EXISTS maps_set_updated_at ON registry.maps;
DROP TABLE IF EXISTS registry.maps;
DROP TYPE IF EXISTS registry.map_status;
ALTER TABLE registry.datasets DROP COLUMN IF EXISTS validation_report;
