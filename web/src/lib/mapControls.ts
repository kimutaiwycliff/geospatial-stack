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
import { createGraticuleControl } from "./controls/graticuleControl";
import { createMeasureControl } from "./controls/measureControl";
import { createMinimapControl } from "./controls/minimapControl";
import { createSearchControl } from "./controls/searchControl";

/**
 * The 7 controls genuinely native to MapLibre GL JS itself, PLUS 4 more
 * (search/measure/minimap/gridlines) that are real GeoLibre menu items but
 * NOT MapLibre built-ins -- researched against GeoLibre's own source
 * (brief §14): those 4 are hand-rolled here (src/lib/controls/*), each a
 * small, self-contained `IControl`, since no single popular npm package
 * covers this exact set the way GeoLibre's own proprietary
 * `maplibre-gl-components` bundle does. Everything else in GeoLibre's menu
 * (Directions, Reverse Geocode, Weather, Route Animation, Flight
 * Simulator, Sun, Atmospheric Effects, Spinning Globe, Colorbar, Legend,
 * HTML, Bookmark) is still out of scope -- each is either a genuinely
 * separate multi-day feature or depends on an external paid/keyed service,
 * not a config toggle (see the research this session did for the reasoning
 * behind that line).
 */
export const MAP_CONTROL_IDS = [
  "navigation",
  "fullscreen",
  "geolocate",
  "globe",
  "scale",
  "attribution",
  "logo",
  "search",
  "measure",
  "minimap",
  "gridlines",
] as const;
export type MapControlId = (typeof MAP_CONTROL_IDS)[number];

/** "gridlines" has no on-map corner widget (see graticuleControl.ts) --
 * MapEditor.tsx uses this to skip rendering a meaningless position picker
 * for it, the same way GeoLibre's own menu has no position submenu for its
 * non-corner items. */
export const CONTROLS_WITHOUT_POSITION = new Set<MapControlId>(["gridlines"]);

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
  search: "Search (place lookup)",
  measure: "Measure distance / area",
  minimap: "Minimap",
  gridlines: "Gridlines",
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
  search: { enabled: false, position: "top-left" },
  measure: { enabled: false, position: "top-left" },
  minimap: { enabled: false, position: "bottom-right" },
  // Position is stored for schema uniformity but ignored at render time --
  // see CONTROLS_WITHOUT_POSITION above.
  gridlines: { enabled: false, position: "top-right" },
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
  search: () => createSearchControl(),
  measure: () => createMeasureControl(),
  minimap: () => createMinimapControl(),
  gridlines: () => createGraticuleControl(),
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
