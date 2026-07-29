-- migrate:up

-- Optional min/max zoom constraints per Map (brief follow-up: "choose
-- minimum and maximum zoom per map"). Nullable, no default -- unset means
-- "no constraint," matching MapLibre's own Map constructor behavior when
-- minZoom/maxZoom are omitted entirely.
ALTER TABLE registry.maps ADD COLUMN min_zoom double precision;
ALTER TABLE registry.maps ADD COLUMN max_zoom double precision;

-- The basemap switcher (brief follow-up: "just another map control that
-- can be toggled and placed wherever you want") joins the SAME
-- controls_json system every other control already uses, instead of being
-- a bespoke always-on corner widget (MapBySlugPage.tsx used to hardcode
-- it). Defaults enabled/top-right -- unlike most other hand-built
-- controls (search/measure/minimap/... default OFF), this one was
-- ALREADY always-on for every published Map before this migration, so
-- defaulting it off here would be a silent regression for every existing
-- Map.
UPDATE registry.maps
SET controls_json = controls_json || '{"basemap-switcher": {"enabled": true, "position": "top-right"}}'::jsonb
WHERE NOT (controls_json ? 'basemap-switcher');

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
    "legend": {"enabled": false, "position": "bottom-left"},
    "basemap-switcher": {"enabled": true, "position": "top-right"}
}'::jsonb;

-- migrate:down

ALTER TABLE registry.maps DROP COLUMN IF EXISTS min_zoom;
ALTER TABLE registry.maps DROP COLUMN IF EXISTS max_zoom;

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
