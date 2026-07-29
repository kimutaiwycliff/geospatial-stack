import type { GeoJSONSource, IControl, Map as MapLibreMap } from "maplibre-gl";
import { DEFAULT_GRIDLINES_CONFIG, type GridlinesConfig } from "../adminApi";

/** [maxZoom, intervalDegrees] bands, checked in order -- coarser grid at
 * low zoom (world view), finer as you zoom in, without redrawing on every
 * single zoom tick (only when the interval actually changes). GeoLibre's
 * own graticule is viewport-clipped and label-aware (1300 lines); this is
 * the "genuinely useful, not gold-plated" version -- a fixed global grid
 * at a zoom-appropriate interval, no edge labels. */
const ZOOM_BANDS: [number, number][] = [
  [2, 30],
  [4, 10],
  [6, 5],
  [8, 2],
  [Infinity, 1],
];

function intervalForZoom(zoom: number): number {
  return ZOOM_BANDS.find(([maxZoom]) => zoom <= maxZoom)?.[1] ?? 1;
}

function buildGraticule(interval: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lon = -180; lon <= 180; lon += interval) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[lon, -85], [lon, 85]] } });
  }
  // Stops short of the poles (+/-85, matching Web Mercator's own valid
  // range -- see basemap/build_basemap.py's identical WORLD_BBOX choice)
  // rather than +/-90, where longitude lines converge and a lat/lon grid
  // stops meaning anything.
  for (let lat = -80; lat <= 80; lat += interval) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-180, lat], [180, lat]] } });
  }
  return { type: "FeatureCollection", features };
}

const SOURCE_ID = "graticule-source";
const LAYER_ID = "graticule-layer";

/**
 * Gridlines/graticule (brief follow-up: "add search, measure, minimap,
 * gridlines"). No corner widget -- GeoLibre's own menu treats this as a
 * pure on/off layer toggle with no position submenu either (see this
 * feature's research notes), so `onAdd` returns an empty element and
 * MapEditor.tsx deliberately skips rendering a position picker for this
 * one control id.
 */
/**
 * `config` (brief follow-up: "customize ... the gridlines") overrides the
 * paint properties only -- the zoom-adaptive interval logic above stays
 * fixed, same "single value, not a full editor" scope as StylingPanel's
 * fill/line controls.
 */
export function createGraticuleControl(config: GridlinesConfig = DEFAULT_GRIDLINES_CONFIG): IControl {
  let map: MapLibreMap | null = null;
  let currentInterval = -1;

  function refresh() {
    if (!map) return;
    const interval = intervalForZoom(map.getZoom());
    if (interval === currentInterval) return;
    currentInterval = interval;
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(buildGraticule(interval));
  }

  return {
    onAdd(m) {
      map = m;
      const addLayer = () => {
        if (map!.getSource(SOURCE_ID)) return;
        currentInterval = intervalForZoom(map!.getZoom());
        map!.addSource(SOURCE_ID, { type: "geojson", data: buildGraticule(currentInterval) });
        map!.addLayer({
          id: LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": config.color,
            "line-width": config.width,
            "line-opacity": config.opacity,
            "line-dasharray": [2, 2],
          },
        });
      };
      if (map.isStyleLoaded()) addLayer();
      else map.once("load", addLayer);
      map.on("zoomend", refresh);
      return document.createElement("div");
    },
    onRemove() {
      if (!map) return;
      map.off("zoomend", refresh);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      map = null;
    },
  };
}
