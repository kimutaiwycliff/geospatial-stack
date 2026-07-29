import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { basemapSpriteUrl, BASEMAP_GLYPHS_URL, BASEMAP_PMTILES_URL } from "./config";

/** One fixed source id for the self-hosted OSM basemap (brief §1.5) --
 * never toggled or removed, unlike the per-dataset sources in mapSources.ts,
 * so it doesn't need the same slug-namespaced id scheme. */
export const BASEMAP_SOURCE_ID = "basemap";

/** Every color scheme @protomaps/basemaps ships (see
 * node_modules/@protomaps/basemaps/src/index.ts's `namedFlavor` switch) --
 * this IS "the most common basemap styles" a self-hosted, keyless OSM
 * basemap can offer: there's no separate imagery/satellite/street provider
 * to switch to without a second data source and a second API key, which is
 * exactly what brief §1.5's "no external API keys" rule rules out. */
export const BASEMAP_FLAVORS = ["light", "dark", "white", "grayscale", "black"] as const;
export type BasemapFlavor = (typeof BASEMAP_FLAVORS)[number];

export const BASEMAP_FLAVOR_LABELS: Record<BasemapFlavor, string> = {
  light: "Light",
  dark: "Dark",
  white: "White",
  grayscale: "Grayscale",
  black: "Black",
};

export const DEFAULT_BASEMAP_FLAVOR: BasemapFlavor = "light";

/** Narrows an arbitrary string (e.g. a Map's saved `basemap` column, or a
 * value round-tripped through the URL) down to a real flavor -- falls back
 * to the default rather than throwing, since `namedFlavor` itself throws on
 * anything unrecognized and a stale/hand-edited value shouldn't blank the
 * whole map. */
export function asBasemapFlavor(value: string | null | undefined): BasemapFlavor {
  return (BASEMAP_FLAVORS as readonly string[]).includes(value ?? "") ? (value as BasemapFlavor) : DEFAULT_BASEMAP_FLAVOR;
}

/**
 * Builds the base MapLibre style: basemap layers first (bottom of the
 * z-order), so every data layer added afterwards (mapSources.ts) draws on
 * top of it. Replaces Phase 0's empty `background`-only style now that a
 * real self-hosted basemap exists.
 *
 * `layers()` is @protomaps/basemaps' own function -- it returns a complete
 * LayerSpecification[] (fills, lines, and label/symbol layers) for a given
 * source id + flavor, so there's no hand-rolled land/water/road styling
 * here at all. `flavorName` defaults to "light" (this style's original only
 * option) but now accepts any of BASEMAP_FLAVORS -- see applyBasemapFlavor
 * below for switching it on an already-rendered map without a full
 * `setStyle` (which would tear down every dataset layer too).
 */
export function buildBaseStyle(flavorName: BasemapFlavor = DEFAULT_BASEMAP_FLAVOR): StyleSpecification {
  const flavor = namedFlavor(flavorName);
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: "vector",
        url: BASEMAP_PMTILES_URL,
      },
    },
    layers: layers(BASEMAP_SOURCE_ID, flavor, { lang: "en" }),
    // Protomaps' own free, keyless, public static assets (see config.ts's
    // comment on BASEMAP_GLYPHS_URL) -- required for the label layers
    // `layers()` returns to render text/icons at all. `sprite` is omitted
    // (undefined) for flavors with no published sprite sheet -- see
    // basemapSpriteUrl's doc comment.
    glyphs: BASEMAP_GLYPHS_URL,
    sprite: basemapSpriteUrl(flavorName),
  };
}

/**
 * Switches an already-rendered map to a different basemap flavor WITHOUT
 * `map.setStyle(...)`. `setStyle` diffs the requested style against the
 * map's current one and removes anything the new style doesn't declare --
 * since every dataset source/layer here is added imperatively (MapView's
 * own effect, not part of either style object), a `setStyle` call would
 * silently wipe every dataset layer along with the basemap. Instead: pull
 * down only the basemap's own source+layers, add the new flavor's, and
 * reuse `setSprite`/`setGlyphs` (both real MapLibre GL JS APIs, MapLibre 6)
 * for the two style-level properties that can't be swapped via
 * add/removeLayer alone.
 *
 * `beforeId` is captured BEFORE removing the old basemap layers -- the
 * first non-basemap layer id at that point is, by construction, the bottom
 * of the dataset-layer stack (MapView/MapBySlugPage always add the
 * basemap's layers first), so re-inserting the new flavor's layers there
 * preserves "basemap always renders under every dataset" regardless of how
 * many dataset layers already exist (including zero, before they've loaded
 * at all -- `beforeId` is just `undefined` then, and `addLayer` appends).
 */
export function applyBasemapFlavor(map: MapLibreMap, flavorName: BasemapFlavor): void {
  const style = buildBaseStyle(flavorName);
  const currentLayers = map.getStyle()?.layers ?? [];
  const beforeId = currentLayers.find((layer) => "source" in layer && layer.source !== BASEMAP_SOURCE_ID)?.id;

  for (const layer of currentLayers) {
    if ("source" in layer && layer.source === BASEMAP_SOURCE_ID) map.removeLayer(layer.id);
  }
  if (map.getSource(BASEMAP_SOURCE_ID)) map.removeSource(BASEMAP_SOURCE_ID);

  map.addSource(BASEMAP_SOURCE_ID, style.sources[BASEMAP_SOURCE_ID]);
  for (const layer of style.layers) {
    map.addLayer(layer, beforeId);
  }
  // `StyleSpecification.sprite`'s type also allows a multi-sprite
  // `{id, url}[]` form (`setSprite` doesn't accept that shape at all) --
  // `buildBaseStyle` above only ever produces a plain string or leaves it
  // undefined (see basemapSpriteUrl), so this cast reflects that narrower
  // reality rather than papering over a real type mismatch.
  map.setSprite((style.sprite as string | undefined) ?? null);

  flavorChangeListeners.get(map)?.forEach((listener) => listener(flavorName));
}

/**
 * Lets a SECOND map instance (today: minimapControl's own overview map)
 * track the first's basemap flavor live -- brief follow-up: "the basemap
 * style should cut across even to the minimap." A plain `WeakMap` of
 * listener sets, not MapLibre's own typed event system (`map.on`/`.fire`):
 * MapLibre's `Evented` mixin does support arbitrary custom event names at
 * runtime, but its TypeScript overloads are closed to the built-in
 * `MapEventType` union, so a custom event name doesn't type-check cleanly.
 * Keyed by the SOURCE map (the one `applyBasemapFlavor` is called on, e.g.
 * from basemapSwitcherControl), not the listener's own map, since that's
 * the instance whose flavor changes are the thing being watched.
 */
const flavorChangeListeners = new WeakMap<MapLibreMap, Set<(flavor: BasemapFlavor) => void>>();

/** Registers `listener` to fire every time `applyBasemapFlavor(map, ...)`
 * runs. Returns an unsubscribe function -- callers (minimapControl's
 * `onRemove`) MUST call it when torn down, since the `Set` this closes
 * over would otherwise keep a removed control's callback alive for as
 * long as the main map itself lives. */
export function onBasemapFlavorChange(map: MapLibreMap, listener: (flavor: BasemapFlavor) => void): () => void {
  let listeners = flavorChangeListeners.get(map);
  if (!listeners) {
    listeners = new Set();
    flavorChangeListeners.set(map, listeners);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
