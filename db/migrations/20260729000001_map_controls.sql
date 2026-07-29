-- migrate:up

-- Per-Map MapLibre control configuration (toggle + corner position), scoped
-- to the 7 controls that are genuinely native to MapLibre GL JS itself
-- (NavigationControl/FullscreenControl/GeolocateControl/GlobeControl/
-- ScaleControl/AttributionControl/LogoControl) -- researched against
-- GeoLibre (brief §14's reference implementation)'s own "Map controls"
-- menu: everything else in that menu (Weather, Flight Simulator, Route
-- Animation, Directions, Search/geocoding, Measure, Minimap, ...) is a
-- separate plugin package or an external service dependency, not a
-- MapLibre built-in, and is out of scope here -- see this migration's
-- accompanying maps.py router for the exact validated control-id set.
--
-- A column default (not a backfill UPDATE) means every existing Map row
-- gets this automatically -- Postgres applies a constant column default to
-- pre-existing rows at ADD COLUMN time, so no separate data migration step
-- is needed. Values mirror what MapLibre already does when you construct a
-- Map with no explicit `attributionControl: false` (it silently adds its
-- own default AttributionControl) -- nav+fullscreen+attribution on by
-- default is "looks like normal MapLibre," not a new opinion.
ALTER TABLE registry.maps ADD COLUMN controls_json JSONB NOT NULL DEFAULT '{
    "navigation": {"enabled": true, "position": "top-right"},
    "fullscreen": {"enabled": true, "position": "top-right"},
    "geolocate": {"enabled": false, "position": "top-right"},
    "globe": {"enabled": false, "position": "top-right"},
    "scale": {"enabled": false, "position": "bottom-left"},
    "attribution": {"enabled": true, "position": "bottom-right"},
    "logo": {"enabled": false, "position": "bottom-left"}
}'::jsonb;

-- migrate:down

ALTER TABLE registry.maps DROP COLUMN IF EXISTS controls_json;
