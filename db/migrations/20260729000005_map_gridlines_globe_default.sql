-- migrate:up

-- Gridlines styling (brief follow-up: "I should also be able to customize
-- ... the gridlines") -- color/width/opacity, mirrors gridlines_json's own
-- Pydantic default in app/routers/maps.py's GridlinesConfig. Nullable: a
-- null value means "use graticuleControl.ts's own hardcoded defaults,"
-- same as filters_json/legend_json being null meaning "nothing configured
-- yet" rather than every Map needing a row here from day one.
ALTER TABLE registry.maps ADD COLUMN gridlines_json jsonb;

-- A Map now loads projected as a globe by default (brief follow-up: "the
-- map by default loads as a globe") -- the `globe` control (MapLibre's own
-- GlobeControl button, which toggles projection) is the "optionally ...
-- flatten the map" half of that, so it has to actually be enabled by
-- default too, or a visitor would have no way to flatten it. Every other
-- control's default is untouched.
UPDATE registry.maps
SET controls_json = jsonb_set(controls_json, '{globe,enabled}', 'true'::jsonb)
WHERE controls_json -> 'globe' ->> 'enabled' = 'false';

ALTER TABLE registry.maps ALTER COLUMN controls_json SET DEFAULT '{
    "navigation": {"enabled": true, "position": "top-right"},
    "fullscreen": {"enabled": true, "position": "top-right"},
    "geolocate": {"enabled": false, "position": "top-right"},
    "globe": {"enabled": true, "position": "top-right"},
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

ALTER TABLE registry.maps DROP COLUMN IF EXISTS gridlines_json;

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
