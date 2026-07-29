import type { GeoJSONSource, IControl, Map as MapLibreMap } from "maplibre-gl";
import proj4 from "proj4";
import { DEFAULT_GRIDLINES_CONFIG, type GridlinesConfig } from "../adminApi";

/** Coarser grid at low zoom, finer as you zoom in -- GeoLibre's own
 * graticule plugin (packages/plugins/src/plugins/maplibre-graticule.ts)
 * calls this "auto" spacing mode; used here whenever
 * `spacing_mode === "auto"`. */
const DEGREE_ZOOM_BANDS: [number, number][] = [
  [2, 30],
  [4, 10],
  [6, 5],
  [8, 2],
  [Infinity, 1],
];
function intervalForZoomDegrees(zoom: number): number {
  return DEGREE_ZOOM_BANDS.find(([maxZoom]) => zoom <= maxZoom)?.[1] ?? 1;
}

/** Same idea, in meters, for the UTM grid's own auto mode. */
const METER_ZOOM_BANDS: [number, number][] = [
  [4, 1000000],
  [6, 200000],
  [8, 100000],
  [10, 50000],
  [12, 20000],
  [Infinity, 10000],
];
function intervalForZoomMeters(zoom: number): number {
  return METER_ZOOM_BANDS.find(([maxZoom]) => zoom <= maxZoom)?.[1] ?? 10000;
}

function buildGeographicGraticule(interval: number): GeoJSON.FeatureCollection {
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

/** UTM zone 1-60 for a given longitude -- the standard 6°-wide zone
 * definition (verified directly: zone 37 for Nairobi's 36.8°E, matching
 * the real-world UTM zone map). */
function utmZoneFor(lng: number): number {
  return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1));
}
function utmProjString(zone: number, northernHemisphere: boolean): string {
  return `+proj=utm +zone=${zone}${northernHemisphere ? "" : " +south"} +datum=WGS84 +units=m +no_defs`;
}

/** Draws a UTM easting/northing grid by sampling each candidate gridline
 * in projected meters and inverse-projecting the samples back to lon/lat
 * (proj4 -- verified numerically: forward/inverse round-trips to ~1e-15°,
 * and a fixed-easting line's inverse-projected samples trace a
 * believable near-vertical curve, not a straight line, which is the
 * expected visual difference between a UTM grid and a lat/lon one).
 * Scoped to ONE zone -- the current view center's -- rather than
 * switching mid-grid at a zone boundary; a reasonable simplification
 * most lightweight UTM-grid tools also make, since a Map's default view
 * is normally centered on the region it actually covers. */
function buildUtmGraticule(map: MapLibreMap, interval: number): GeoJSON.FeatureCollection {
  const center = map.getCenter();
  const bounds = map.getBounds();
  const zone = utmZoneFor(center.lng);
  const proj = proj4(utmProjString(zone, center.lat >= 0));

  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  // Projected-space bounds of the current viewport (a rough box, not
  // exact -- only used to decide which round easting/northing values are
  // worth drawing at all, so a generous margin is fine).
  const corners = [
    proj.forward([west, south]),
    proj.forward([west, north]),
    proj.forward([east, south]),
    proj.forward([east, north]),
  ];
  const eastings = corners.map((c) => c[0]);
  const northings = corners.map((c) => c[1]);
  const minE = Math.min(...eastings) - interval;
  const maxE = Math.max(...eastings) + interval;
  const minN = Math.min(...northings) - interval;
  const maxN = Math.max(...northings) + interval;

  const SAMPLES = 12;
  const features: GeoJSON.Feature[] = [];

  for (let e = Math.ceil(minE / interval) * interval; e <= maxE; e += interval) {
    const coordinates: [number, number][] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const n = minN + ((maxN - minN) * i) / SAMPLES;
      coordinates.push(proj.inverse([e, n]) as [number, number]);
    }
    features.push({ type: "Feature", properties: { value: Math.round(e), axis: "easting" }, geometry: { type: "LineString", coordinates } });
  }
  for (let n = Math.ceil(minN / interval) * interval; n <= maxN; n += interval) {
    const coordinates: [number, number][] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const e = minE + ((maxE - minE) * i) / SAMPLES;
      coordinates.push(proj.inverse([e, n]) as [number, number]);
    }
    features.push({ type: "Feature", properties: { value: Math.round(n), axis: "northing" }, geometry: { type: "LineString", coordinates } });
  }
  return { type: "FeatureCollection", features };
}

function formatDD(value: number, axis: "lat" | "lng"): string {
  const dir = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  return `${Math.abs(value).toFixed(2)}°${dir}`;
}
function formatDMS(value: number, axis: "lat" | "lng"): string {
  const dir = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return `${deg}°${min}'${sec}"${dir}`;
}
function formatGeoLabel(value: number, axis: "lat" | "lng", format: "dd" | "dms"): string {
  return format === "dms" ? formatDMS(value, axis) : formatDD(value, axis);
}

/** Label points for the geographic grid -- one per meridian/parallel per
 * requested edge, positioned at the current viewport's own edge (not a
 * fixed world coordinate) so labels stay visible while panning. Each
 * feature carries its own `anchor` (MapLibre's `text-anchor` can be a
 * per-feature data expression, `["get", "anchor"]`), since meridian labels
 * anchor bottom/top and parallel labels anchor left/right within the SAME
 * symbol layer. */
function buildGeographicLabels(
  interval: number,
  bounds: { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number },
  config: GridlinesConfig,
): GeoJSON.FeatureCollection {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const features: GeoJSON.Feature[] = [];
  const allEdges = config.label_edges === "all";

  for (let lon = Math.ceil(west / interval) * interval; lon <= east; lon += interval) {
    const text = formatGeoLabel(lon, "lng", config.label_format);
    features.push(labelFeature(lon, south, text, "bottom"));
    if (allEdges) features.push(labelFeature(lon, north, text, "top"));
  }
  for (let lat = Math.ceil(south / interval) * interval; lat <= north; lat += interval) {
    const text = formatGeoLabel(lat, "lat", config.label_format);
    features.push(labelFeature(west, lat, text, "left"));
    if (allEdges) features.push(labelFeature(east, lat, text, "right"));
  }
  return { type: "FeatureCollection", features };
}

function buildUtmLabels(lineFeatures: GeoJSON.Feature[], config: GridlinesConfig): GeoJSON.FeatureCollection {
  const allEdges = config.label_edges === "all";
  const features: GeoJSON.Feature[] = [];
  for (const feature of lineFeatures) {
    const coords = (feature.geometry as GeoJSON.LineString).coordinates;
    const value = feature.properties?.value as number;
    const axis = feature.properties?.axis as "easting" | "northing";
    const text = `${value.toLocaleString()}m`;
    if (axis === "easting") {
      features.push(labelFeature(coords[0][0], coords[0][1], text, "bottom"));
      if (allEdges) features.push(labelFeature(coords[coords.length - 1][0], coords[coords.length - 1][1], text, "top"));
    } else {
      features.push(labelFeature(coords[0][0], coords[0][1], text, "left"));
      if (allEdges) features.push(labelFeature(coords[coords.length - 1][0], coords[coords.length - 1][1], text, "right"));
    }
  }
  return { type: "FeatureCollection", features };
}

function labelFeature(lng: number, lat: number, text: string, anchor: string): GeoJSON.Feature {
  return { type: "Feature", properties: { text, anchor }, geometry: { type: "Point", coordinates: [lng, lat] } };
}

const LINE_SOURCE_ID = "graticule-source";
const LAYER_ID = "graticule-layer";
const LABEL_SOURCE_ID = "graticule-labels-source";
const LABEL_LAYER_ID = "graticule-labels-layer";

/**
 * Gridlines/graticule control (brief follow-up: "gridlines ... GeoLibre
 * ... don't have yet" -- grid type, spacing mode, coordinate labels,
 * dashed toggle, label styling all added here to close that gap; see
 * `GridlinesConfig`'s own doc comment).
 */
export function createGraticuleControl(config: GridlinesConfig = DEFAULT_GRIDLINES_CONFIG): IControl {
  let map: MapLibreMap | null = null;

  function currentInterval(): number {
    if (config.grid_type === "utm") {
      return config.spacing_mode === "fixed" ? config.spacing_meters : intervalForZoomMeters(map!.getZoom());
    }
    return config.spacing_mode === "fixed" ? config.spacing_degrees : intervalForZoomDegrees(map!.getZoom());
  }

  function refresh() {
    if (!map) return;
    const interval = currentInterval();
    const lineData = config.grid_type === "utm" ? buildUtmGraticule(map, interval) : buildGeographicGraticule(interval);
    (map.getSource(LINE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(lineData);

    if (config.show_labels) {
      const labelData =
        config.grid_type === "utm" ? buildUtmLabels(lineData.features, config) : buildGeographicLabels(interval, map.getBounds(), config);
      (map.getSource(LABEL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(labelData);
    }
  }

  return {
    onAdd(m) {
      map = m;
      const addLayers = () => {
        if (map!.getSource(LINE_SOURCE_ID)) return;
        map!.addSource(LINE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        const paint: Record<string, unknown> = {
          "line-color": config.color,
          "line-width": config.width,
          "line-opacity": config.opacity,
        };
        if (config.dashed) paint["line-dasharray"] = [2, 2];
        map!.addLayer({ id: LAYER_ID, type: "line", source: LINE_SOURCE_ID, paint });

        if (config.show_labels) {
          map!.addSource(LABEL_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map!.addLayer({
            id: LABEL_LAYER_ID,
            type: "symbol",
            source: LABEL_SOURCE_ID,
            layout: {
              "text-field": ["get", "text"],
              "text-font": ["Noto Sans Regular"],
              "text-size": config.label_size,
              "text-anchor": ["get", "anchor"],
              "text-allow-overlap": false,
            },
            paint: {
              "text-color": config.label_color,
              "text-halo-color": "#ffffff",
              "text-halo-width": 1,
            },
          });
        }
        refresh();
      };
      if (map.isStyleLoaded()) addLayers();
      else map.once("load", addLayers);
      map.on("zoomend", refresh);
      // UTM's own grid depends on the current viewport (both for sampling
      // range and for which zone is "current"), unlike the geographic
      // grid (a fixed world-spanning line set); geographic labels also
      // need to re-anchor to the new viewport edges on every pan. Cheap
      // enough to just always refresh on move rather than branching.
      map.on("moveend", refresh);
      return document.createElement("div");
    },
    onRemove() {
      if (!map) return;
      map.off("zoomend", refresh);
      map.off("moveend", refresh);
      if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
      if (map.getSource(LABEL_SOURCE_ID)) map.removeSource(LABEL_SOURCE_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(LINE_SOURCE_ID)) map.removeSource(LINE_SOURCE_ID);
      map = null;
    },
  };
}
