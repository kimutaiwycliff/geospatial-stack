-- migrate:up

-- Adds Compass/Spinning Globe/Atmospheric Effects/Bookmark/Legend to the
-- per-Map control config -- GeoLibre-menu parity items that are genuinely
-- feasible without an external paid/keyed API or new backend infra (see
-- web/src/lib/controls/* for each one's implementation). The rest of
-- GeoLibre's menu (Terrain, Weather, Route Animation, Flight Simulator,
-- Directions, Reverse Geocode, Colorbar) still needs something this stack
-- doesn't have yet -- a self-hosted elevation/routing/geocoding dataset or
-- choropleth styling support -- and stays out of scope here on purpose.
--
-- All 5 disabled by default, same "opt-in, not a MapLibre default behavior"
-- rule the previous controls migration established. `spinning-globe` and
-- `atmosphere` have no on-map corner widget of their own (same as
-- `gridlines`, see mapControls.ts's CONTROLS_WITHOUT_POSITION) -- their
-- `position` value is stored for schema uniformity but ignored at render
-- time.
UPDATE registry.maps
SET controls_json = controls_json || '{
    "compass": {"enabled": false, "position": "top-right"},
    "spinning-globe": {"enabled": false, "position": "top-right"},
    "atmosphere": {"enabled": false, "position": "top-right"},
    "bookmark": {"enabled": false, "position": "top-left"},
    "legend": {"enabled": false, "position": "bottom-left"}
}'::jsonb
WHERE NOT (controls_json ?& array['compass', 'spinning-globe', 'atmosphere', 'bookmark', 'legend']);

ALTER TABLE registry.maps ALTER COLUMN controls_json SET DEFAULT '{
    "navigation": {"enabled": true, "position": "top-right"},
    "fullscreen": {"enabled": true, "position": "top-right"},
    "geolocate": {"enabled": false, "position": "top-right"},
    "globe": {"enabled": false, "position": "top-right"},
    "scale": {"enabled": false, "position": "bottom-left"},
    "attribution": {"enabled": true, "position": "bottom-right"},
    "logo": {"enabled": false, "position": "bottom-left"},
    "search": {"enabled": false, "position": "top-left"},
    "measure": {"enabled": false, "position": "top-left"},
    "minimap": {"enabled": false, "position": "bottom-right"},
    "gridlines": {"enabled": false, "position": "top-right"},
    "compass": {"enabled": false, "position": "top-right"},
    "spinning-globe": {"enabled": false, "position": "top-right"},
    "atmosphere": {"enabled": false, "position": "top-right"},
    "bookmark": {"enabled": false, "position": "top-left"},
    "legend": {"enabled": false, "position": "bottom-left"}
}'::jsonb;

-- migrate:down

-- Same reasoning as the previous controls migration's down step: leaving
-- the backfilled keys in place is harmless (older schema/frontend versions
-- simply never read them), so this only reverts the column default.
ALTER TABLE registry.maps ALTER COLUMN controls_json SET DEFAULT '{
    "navigation": {"enabled": true, "position": "top-right"},
    "fullscreen": {"enabled": true, "position": "top-right"},
    "geolocate": {"enabled": false, "position": "top-right"},
    "globe": {"enabled": false, "position": "top-right"},
    "scale": {"enabled": false, "position": "bottom-left"},
    "attribution": {"enabled": true, "position": "bottom-right"},
    "logo": {"enabled": false, "position": "bottom-left"},
    "search": {"enabled": false, "position": "top-left"},
    "measure": {"enabled": false, "position": "top-left"},
    "minimap": {"enabled": false, "position": "bottom-right"},
    "gridlines": {"enabled": false, "position": "top-right"}
}'::jsonb;
