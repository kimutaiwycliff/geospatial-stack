import type { LngLatBoundsLike } from "maplibre-gl";

/**
 * Flattens any GeoJSON geometry's coordinate nesting (Point through
 * MultiPolygon, any depth) into a bbox. Hand-rolled instead of pulling in
 * `@turf/bbox` for one function -- this only ever needs to run over a
 * handful of already-decoded vector-tile features (see MapView.tsx's
 * flyToCountry), not general-purpose geometry math.
 */
export function geometryBounds(geometry: GeoJSON.Geometry): LngLatBoundsLike | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  // GeoJSON coordinate arrays bottom out at [lng, lat] (or [lng, lat, alt]);
  // everything above that is nesting (rings, polygons, multi-geometries).
  // Recursing on "is the first element a number" rather than switching on
  // `geometry.type` handles every geometry type with one code path.
  function visit(coords: unknown): void {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lng, lat] = coords as [number, number];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) visit(c);
  }

  if ("coordinates" in geometry) {
    visit(geometry.coordinates);
  } else if ("geometries" in geometry) {
    for (const g of geometry.geometries) visit((g as GeoJSON.Geometry & { coordinates?: unknown }).coordinates);
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
    return null;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** Merges two bboxes (either may be null, meaning "no data yet"). */
export function unionBounds(a: LngLatBoundsLike | null, b: LngLatBoundsLike | null): LngLatBoundsLike | null {
  if (!a) return b;
  if (!b) return a;
  const [[aMinLng, aMinLat], [aMaxLng, aMaxLat]] = a as [[number, number], [number, number]];
  const [[bMinLng, bMinLat], [bMaxLng, bMaxLat]] = b as [[number, number], [number, number]];
  return [
    [Math.min(aMinLng, bMinLng), Math.min(aMinLat, bMinLat)],
    [Math.max(aMaxLng, bMaxLng), Math.max(aMaxLat, bMaxLat)],
  ];
}
