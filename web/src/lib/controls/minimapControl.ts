import { Map as MapLibreMap, type GeoJSONSource, type IControl } from "maplibre-gl";
import { buildBaseStyle } from "../basemapStyle";

const BOUNDS_SOURCE_ID = "minimap-bounds-source";
const BOUNDS_LAYER_ID = "minimap-bounds-layer";

/**
 * Overview inset: a small, non-interactive second MapLibre instance
 * (reusing this app's own `buildBaseStyle()`, so it looks like the same
 * basemap, not a generic placeholder) showing the main map's current
 * viewport as a rectangle. A real second WebGL map context, same as
 * GeoLibre's own approach -- there's no lighter-weight way to render "the
 * same basemap, zoomed out" than actually rendering it.
 */
export function createMinimapControl(): IControl {
  let mainMap: MapLibreMap | null = null;
  let miniMap: MapLibreMap | null = null;

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

      miniMap = new MapLibreMap({ container, style: buildBaseStyle(), interactive: false, attributionControl: false });
      miniMap.once("load", () => {
        miniMap!.addSource(BOUNDS_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        // Static warm accent hex, not a CSS variable -- MapLibre paint
        // properties render on a WebGL canvas, outside the DOM/CSS
        // cascade, same reasoning as mapSources.ts's own hardcoded
        // PALETTE hex values.
        miniMap!.addLayer({ id: BOUNDS_LAYER_ID, type: "line", source: BOUNDS_SOURCE_ID, paint: { "line-color": "#c2703f", "line-width": 2 } });
        syncView();
      });

      map.on("move", syncView);
      return container;
    },
    onRemove() {
      mainMap?.off("move", syncView);
      miniMap?.remove();
      miniMap = null;
      mainMap = null;
    },
  };
}
