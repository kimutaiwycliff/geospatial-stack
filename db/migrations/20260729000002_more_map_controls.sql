-- migrate:up

-- Adds search/measure/minimap/gridlines to the per-Map control config
-- (brief follow-up: "add search, Measure, Minimap, Gridlines as well" --
-- see web/src/lib/controls/* for how each is implemented; none needs an
-- API key or a new heavy dependency). All 4 disabled by default -- unlike
-- navigation/fullscreen/attribution (which MapLibre already turns on by
-- default when unconfigured), none of these 4 has an equivalent "this is
-- just normal MapLibre behavior" baseline, so opt-in is the honest default.
--
-- Backfills EXISTING rows via UPDATE (unlike the previous controls_json
-- migration, which only needed a column DEFAULT because it was adding the
-- column itself) -- an ALTER COLUMN ... SET DEFAULT only affects rows
-- inserted after this migration runs, so already-existing Maps need an
-- explicit merge to pick up the 4 new keys too. `||` only adds/overwrites
-- these 4 keys, leaving whatever a curator already configured for the
-- original 7 untouched.
UPDATE registry.maps
SET controls_json = controls_json || '{
    "search": {"enabled": false, "position": "top-left"},
    "measure": {"enabled": false, "position": "top-left"},
    "minimap": {"enabled": false, "position": "bottom-right"},
    "gridlines": {"enabled": false, "position": "top-right"}
}'::jsonb
WHERE NOT (controls_json ?& array['search', 'measure', 'minimap', 'gridlines']);

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

-- migrate:down

-- Reverts the column default only -- there is no clean way to tell which
-- rows had these 4 keys added by this migration's backfill versus a
-- curator genuinely configuring them afterward, so a down migration can't
-- safely strip them back out without risking real curator edits. Leaving
-- the extra keys in place is harmless (the frontend/backend for the
-- pre-this-migration schema simply never reads them).
ALTER TABLE registry.maps ALTER COLUMN controls_json SET DEFAULT '{
    "navigation": {"enabled": true, "position": "top-right"},
    "fullscreen": {"enabled": true, "position": "top-right"},
    "geolocate": {"enabled": false, "position": "top-right"},
    "globe": {"enabled": false, "position": "top-right"},
    "scale": {"enabled": false, "position": "bottom-left"},
    "attribution": {"enabled": true, "position": "bottom-right"},
    "logo": {"enabled": false, "position": "bottom-left"}
}'::jsonb;
