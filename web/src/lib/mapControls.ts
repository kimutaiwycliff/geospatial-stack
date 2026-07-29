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
import type { BasemapFlavor } from "./basemapStyle";
import { createAtmosphereControl } from "./controls/atmosphereControl";
import { createBasemapSwitcherControl } from "./controls/basemapSwitcherControl";
import { createBookmarkControl } from "./controls/bookmarkControl";
import { createGraticuleControl } from "./controls/graticuleControl";
import { createLegendControl } from "./controls/legendControl";
import { createMeasureControl } from "./controls/measureControl";
import { createMinimapControl } from "./controls/minimapControl";
import { createSearchControl } from "./controls/searchControl";
import { createSpinningGlobeControl } from "./controls/spinningGlobeControl";

/**
 * The 7 controls genuinely native to MapLibre GL JS itself, PLUS 9 more
 * that are real GeoLibre menu items but NOT MapLibre built-ins --
 * researched against GeoLibre's own source (brief §14): search/measure/
 * minimap/gridlines, and (a later follow-up) compass/spinning-globe/
 * atmosphere/bookmark/legend. All 9 are hand-rolled here (src/lib/
 * controls/*), each a small, self-contained `IControl`, since no single
 * popular npm package covers this exact set the way GeoLibre's own
 * proprietary `maplibre-gl-components` bundle does. Everything else left
 * in GeoLibre's menu (Terrain, Weather, Route Animation, Flight Simulator,
 * Directions, Reverse Geocode, Colorbar) is still out of scope -- each
 * needs a self-hosted elevation/routing/geocoding dataset, an external
 * paid/keyed API, or choropleth styling support this app doesn't have yet,
 * not just a config toggle.
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
  "compass",
  "spinning-globe",
  "atmosphere",
  "bookmark",
  "legend",
  "basemap-switcher",
] as const;
export type MapControlId = (typeof MAP_CONTROL_IDS)[number];

/** "gridlines"/"spinning-globe"/"atmosphere" have no on-map corner widget
 * (see graticuleControl.ts/spinningGlobeControl.ts/atmosphereControl.ts) --
 * MapEditor.tsx uses this to skip rendering a meaningless position picker
 * for them, the same way GeoLibre's own menu has no position submenu for
 * its non-corner items. */
export const CONTROLS_WITHOUT_POSITION = new Set<MapControlId>(["gridlines", "spinning-globe", "atmosphere"]);

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
  compass: "Compass",
  "spinning-globe": "Spinning globe",
  atmosphere: "Atmospheric effects",
  bookmark: "Bookmarks (saved views)",
  legend: "Legend",
  "basemap-switcher": "Basemap switcher",
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
  compass: { enabled: false, position: "top-right" },
  "spinning-globe": { enabled: false, position: "top-right" },
  atmosphere: { enabled: false, position: "top-right" },
  bookmark: { enabled: false, position: "top-left" },
  legend: { enabled: false, position: "bottom-left" },
  // Enabled by default -- unlike every other hand-built control above,
  // this one was ALREADY always-on for every published Map before it
  // joined controls_json (MapBySlugPage.tsx used to hard-render it),
  // so defaulting it off would be a silent regression for existing Maps.
  "basemap-switcher": { enabled: true, position: "top-right" },
};

/** One constructor per control id -- a plain function (not `new` inline in
 * applyMapControls) so each control gets a FRESH instance per call, since
 * an `IControl` instance is single-use (MapLibre binds it to one map on
 * `addControl`, `removeControl` tears that binding down and the instance
 * isn't meant to be re-added). */
const CONTROL_FACTORIES: Record<MapControlId, () => IControl> = {
  // showCompass: false -- `compass` below is its own separate, independently
  // toggleable/positionable control (matching GeoLibre's own menu, which
  // lists Navigation and Compass as two distinct items), so this stays
  // zoom-buttons-only to avoid ending up with two compass widgets when both
  // are enabled at once.
  navigation: () => new NavigationControl({ showCompass: false, showZoom: true }),
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
  compass: () => new NavigationControl({ showCompass: true, showZoom: false, visualizePitch: true }),
  "spinning-globe": () => createSpinningGlobeControl(),
  atmosphere: () => createAtmosphereControl(),
  bookmark: () => createBookmarkControl(),
  legend: () => createLegendControl(),
  // Default (no-arg) fallback -- applyMapControls special-cases this one
  // id to pass through the Map's actual configured basemap flavor instead,
  // so this entry only matters for type-completeness / any future caller
  // that invokes CONTROL_FACTORIES directly.
  "basemap-switcher": () => createBasemapSwitcherControl(),
};

/**
 * Adds every enabled control from a Map's saved `controls_json` (brief
 * §16 Map authoring, extended with per-control on/off + corner position --
 * see MapEditor.tsx for the admin side of this). Callers whose map style
 * doesn't already suppress the default attribution control (pass
 * `attributionControl: false` to the `Map` constructor) will end up with
 * two attribution controls if `attribution` is enabled here -- see
 * MapBySlugPage.tsx for why that flag is required alongside this call.
 *
 * `initialBasemapFlavor` is threaded through ONLY to the basemap-switcher
 * control -- it's the one control here that needs to know something about
 * the Map beyond its own enabled/position config (what flavor the map was
 * actually built with), so it's special-cased rather than widening every
 * other factory's signature for a need only this one has.
 */
export function applyMapControls(
  map: MapLibreMap,
  config: MapControlsConfig | null | undefined,
  opts?: { initialBasemapFlavor?: BasemapFlavor },
): void {
  if (!config) return;
  for (const id of MAP_CONTROL_IDS) {
    const entry = config[id];
    if (entry?.enabled) {
      const control = id === "basemap-switcher" ? createBasemapSwitcherControl(opts?.initialBasemapFlavor) : CONTROL_FACTORIES[id]();
      map.addControl(control, entry.position);
    }
  }
}
