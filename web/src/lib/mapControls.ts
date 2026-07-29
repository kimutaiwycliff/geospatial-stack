import {
  AttributionControl,
  FullscreenControl,
  GeolocateControl,
  GlobeControl,
  LogoControl,
  NavigationControl,
  ScaleControl,
  type IControl,
  type Map as MapLibreMap,
} from "maplibre-gl";

/**
 * The 7 controls that are genuinely native to MapLibre GL JS itself --
 * researched against GeoLibre (brief §14, the project's own reference
 * MapLibre implementation), whose "Map controls" menu lists ~24 items.
 * Everything past these 7 (Search/geocoding, Directions, Weather, Route
 * Animation, Flight Simulator, Measure, Minimap, ...) is either a separate
 * plugin package or depends on an external service (routing/geocoding
 * APIs) -- deliberately out of scope. These 7 are exactly the ones
 * MapLibre's own `map.addControl(control, position)` already supports
 * per-corner positioning for, natively, with zero extra dependencies.
 */
export const MAP_CONTROL_IDS = ["navigation", "fullscreen", "geolocate", "globe", "scale", "attribution", "logo"] as const;
export type MapControlId = (typeof MAP_CONTROL_IDS)[number];

export type ControlPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface MapControlConfig {
  enabled: boolean;
  position: ControlPosition;
}

export type MapControlsConfig = Partial<Record<MapControlId, MapControlConfig>>;

export const MAP_CONTROL_LABELS: Record<MapControlId, string> = {
  navigation: "Navigation (zoom / rotate)",
  fullscreen: "Fullscreen",
  geolocate: "Geolocate",
  globe: "Globe view",
  scale: "Scale bar",
  attribution: "Attribution",
  logo: "MapLibre logo",
};

export const CONTROL_POSITIONS: ControlPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Mirrors db/migrations/20260729000001_map_controls.sql's column default
 * exactly -- a brand-new draft Map (or any Map row from before this
 * feature shipped, though the migration's column default already
 * backfilled those) resolves to the same nav+fullscreen+attribution-on
 * baseline MapLibre gives you for free when you don't customize anything. */
export const DEFAULT_MAP_CONTROLS: Record<MapControlId, MapControlConfig> = {
  navigation: { enabled: true, position: "top-right" },
  fullscreen: { enabled: true, position: "top-right" },
  geolocate: { enabled: false, position: "top-right" },
  globe: { enabled: false, position: "top-right" },
  scale: { enabled: false, position: "bottom-left" },
  attribution: { enabled: true, position: "bottom-right" },
  logo: { enabled: false, position: "bottom-left" },
};

/** One constructor per control id -- a plain function (not `new` inline in
 * applyMapControls) so each control gets a FRESH instance per call, since
 * an `IControl` instance is single-use (MapLibre binds it to one map on
 * `addControl`, `removeControl` tears that binding down and the instance
 * isn't meant to be re-added). */
const CONTROL_FACTORIES: Record<MapControlId, () => IControl> = {
  navigation: () => new NavigationControl(),
  fullscreen: () => new FullscreenControl(),
  geolocate: () => new GeolocateControl({ trackUserLocation: true, positionOptions: { enableHighAccuracy: true } }),
  globe: () => new GlobeControl(),
  scale: () => new ScaleControl(),
  attribution: () => new AttributionControl({ compact: true }),
  logo: () => new LogoControl(),
};

/**
 * Adds every enabled control from a Map's saved `controls_json` (brief
 * §16 Map authoring, extended with per-control on/off + corner position --
 * see MapEditor.tsx for the admin side of this). Callers whose map style
 * doesn't already suppress the default attribution control (pass
 * `attributionControl: false` to the `Map` constructor) will end up with
 * two attribution controls if `attribution` is enabled here -- see
 * MapBySlugPage.tsx for why that flag is required alongside this call.
 */
export function applyMapControls(map: MapLibreMap, config: MapControlsConfig | null | undefined): void {
  if (!config) return;
  for (const id of MAP_CONTROL_IDS) {
    const entry = config[id];
    if (entry?.enabled) {
      map.addControl(CONTROL_FACTORIES[id](), entry.position);
    }
  }
}
