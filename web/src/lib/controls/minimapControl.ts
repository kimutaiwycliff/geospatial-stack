import { Map as MapLibreMap, type GeoJSONSource, type IControl } from "maplibre-gl";
import { applyBasemapFlavor, buildBaseStyle, onBasemapFlavorChange, type BasemapFlavor } from "../basemapStyle";

const BOUNDS_SOURCE_ID = "minimap-bounds-source";
const BOUNDS_LAYER_ID = "minimap-bounds-layer";

/**
 * Overview inset: a small, non-interactive second MapLibre instance
 * (reusing this app's own `buildBaseStyle()`, so it looks like the same
 * basemap, not a generic placeholder) showing the main map's current
 * viewport as a rectangle. A real second WebGL map context, same as
 * GeoLibre's own approach -- there's no lighter-weight way to render "the
 * same basemap, zoomed out" than actually rendering it.
 *
 * `initialFlavor` + `onBasemapFlavorChange` keep this inset showing the
 * SAME basemap style as the main map (brief follow-up: "the basemap style
 * should cut across even to the minimap") -- previously this always
 * hardcoded `buildBaseStyle()` with no argument, i.e. always "light"
 * regardless of what the main map was actually showing.
 */
export function createMinimapControl(initialFlavor: BasemapFlavor = "light"): IControl {
  let mainMap: MapLibreMap | null = null;
  let miniMap: MapLibreMap | null = null;
  let unsubscribeFlavor: (() => void) | null = null;

  function syncView() {
    if (!mainMap || !miniMap) return;
    miniMap.jumpTo({ center: mainMap.getCenter(), zoom: Math.max(mainMap.getZoom() - 5, 0) });
    const bounds = mainMap.getBounds();
    const bbox: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [bounds.getWest(), bounds.getSouth()],
            [bounds.getEast(), bounds.getSouth()],
            [bounds.getEast(), bounds.getNorth()],
            [bounds.getWest(), bounds.getNorth()],
            [bounds.getWest(), bounds.getSouth()],
          ],
        ],
      },
    };
    (miniMap.getSource(BOUNDS_SOURCE_ID) as GeoJSONSource | undefined)?.setData(bbox);
  }

  return {
    onAdd(map) {
      mainMap = map;
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl overflow-hidden rounded-md border border-border shadow";
      container.style.width = "160px";
      container.style.height = "120px";

      miniMap = new MapLibreMap({ container, style: buildBaseStyle(initialFlavor), interactive: false, attributionControl: false });
      miniMap.once("load", () => {
        // MapLibre sized this map's internal canvas/transform off
        // `container`'s layout at CONSTRUCTION time above -- but `container`
        // was still a detached DOM node then (MapLibre's own `addControl`
        // only appends the element THIS `onAdd` returns to the corner
        // container AFTER `onAdd` itself returns), so it had no real
        // computed width/height yet. Without this `resize()` call, the
        // minimap keeps whatever bogus 0-ish dimensions it started with,
        // which throws off its whole screen<->geo projection -- the actual
        // bug behind "the minimap shows a different place." By the time
        // "load" fires (async, well after `onAdd` returned), `container`
        // is guaranteed to already be in the document with its real
        // 160x120 layout.
        miniMap!.resize();
        miniMap!.addSource(BOUNDS_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        // Static warm accent hex, not a CSS variable -- MapLibre paint
        // properties render on a WebGL canvas, outside the DOM/CSS
        // cascade, same reasoning as mapSources.ts's own hardcoded
        // PALETTE hex values.
        miniMap!.addLayer({ id: BOUNDS_LAYER_ID, type: "line", source: BOUNDS_SOURCE_ID, paint: { "line-color": "#c2703f", "line-width": 2 } });
        syncView();
      });

      unsubscribeFlavor = onBasemapFlavorChange(map, (flavor) => {
        if (miniMap) applyBasemapFlavor(miniMap, flavor);
      });

      map.on("move", syncView);
      return container;
    },
    onRemove() {
      unsubscribeFlavor?.();
      mainMap?.off("move", syncView);
      miniMap?.remove();
      miniMap = null;
      mainMap = null;
    },
  };
}
