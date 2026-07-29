import type { GeoJSONSource, IControl, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";

/** Haversine distance in meters -- good enough for a casual on-map "how
 * far is this" tool. NOT the equal-area/geodesic rigor the backend
 * pipeline requires for published statistics (brief §4: "never measure
 * area in 4326/3857") -- that rule governs authoritative dataset numbers,
 * not this disposable measuring overlay, so a simpler formula here is a
 * deliberate scope choice, not a shortcut around that rule. */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters.toFixed(0)} m`;
}

/** Planar shoelace area in a local equirectangular projection centered on
 * the vertex latitude -- a rough estimate, not authoritative (see
 * haversineMeters' comment; same caveat applies). Fine for "roughly how
 * big is this shape I just traced," wrong for anything that needs to hold
 * up as a real area figure. */
function approximateAreaSqMeters(points: [number, number][]): number {
  if (points.length < 3) return 0;
  const avgLat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((avgLat * Math.PI) / 180);
  const projected = points.map(([lon, lat]): [number, number] => [lon * metersPerDegLon, lat * metersPerDegLat]);
  let area = 0;
  for (let i = 0; i < projected.length; i++) {
    const [x1, y1] = projected[i];
    const [x2, y2] = projected[(i + 1) % projected.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function formatArea(sqMeters: number): string {
  return sqMeters >= 1e6 ? `${(sqMeters / 1e6).toFixed(2)} km²` : `${sqMeters.toFixed(0)} m²`;
}

const SOURCE_ID = "measure-source";
const LINE_LAYER_ID = "measure-line-layer";
const POINT_LAYER_ID = "measure-point-layer";

/**
 * Click-to-add-vertex distance/area tool, toggled by its own button
 * (rather than always-on) so it doesn't compete with every other click
 * handler on the map by default. KNOWN LIMITATION, documented rather than
 * silently accepted: MapLibre calls every `map.on("click", ...)` handler
 * independently -- there's no shared event to preventDefault/stopPropagate
 * against the public map's own feature-popup click handler (MapView.tsx/
 * MapBySlugPage.tsx). So while measuring is active, clicking a feature
 * still opens its popup ALONGSIDE placing a measurement vertex. Cheap to
 * live with (both things happening is confusing but not broken); fixing
 * it properly would mean threading "is any other tool claiming clicks"
 * state across independently-registered controls, which is out of scope
 * for what's meant to be a small, self-contained control.
 */
export function createMeasureControl(): IControl {
  let map: MapLibreMap | null = null;
  let active = false;
  let points: [number, number][] = [];
  let button: HTMLButtonElement;
  let readout: HTMLDivElement;

  function render() {
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } },
        ...points.map((p): GeoJSON.Feature => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } })),
      ],
    };
    (map?.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);

    if (points.length < 2) {
      readout.classList.add("hidden");
      return;
    }
    let dist = 0;
    for (let i = 1; i < points.length; i++) dist += haversineMeters(points[i - 1], points[i]);
    let text = `Distance: ${formatDistance(dist)}`;
    if (points.length >= 3) text += ` · Area (approx.): ${formatArea(approximateAreaSqMeters(points))}`;
    readout.textContent = text;
    readout.classList.remove("hidden");
  }

  function handleClick(e: MapMouseEvent) {
    if (!active) return;
    points = [...points, [e.lngLat.lng, e.lngLat.lat]];
    render();
  }

  function toggle() {
    active = !active;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("bg-primary", active);
    button.classList.toggle("text-primary-foreground", active);
    if (!active) {
      points = [];
      render();
    }
    if (map) map.getCanvas().style.cursor = active ? "crosshair" : "";
  }

  return {
    onAdd(m) {
      map = m;
      const addLayers = () => {
        if (map!.getSource(SOURCE_ID)) return;
        map!.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map!.addLayer({
          id: LINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#c2703f", "line-width": 2, "line-dasharray": [2, 1] },
        });
        map!.addLayer({
          id: POINT_LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": "#c2703f", "circle-radius": 4 },
        });
      };
      if (map.isStyleLoaded()) addLayers();
      else map.once("load", addLayers);
      map.on("click", handleClick);

      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group flex flex-col gap-1 p-1";

      button = document.createElement("button");
      button.type = "button";
      button.title = "Measure distance / area";
      button.setAttribute("aria-label", "Measure distance / area");
      button.setAttribute("aria-pressed", "false");
      button.className = "rounded-sm px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted";
      button.textContent = "Measure";
      button.onclick = toggle;
      container.appendChild(button);

      readout = document.createElement("div");
      readout.className = "hidden rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-foreground shadow";
      container.appendChild(readout);

      return container;
    },
    onRemove() {
      if (!map) return;
      map.off("click", handleClick);
      if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
      if (map.getLayer(POINT_LAYER_ID)) map.removeLayer(POINT_LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      map = null;
    },
  };
}
