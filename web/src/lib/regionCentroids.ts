/**
 * Rough fallback view for "jump to country" when no rendered/loaded feature
 * geometry is available to compute an exact bounding box from (see
 * MapView.tsx's flyToCountry). The build brief is explicit that an exact
 * per-country bbox isn't available from the API and not worth building --
 * "simply zoom to a rough centroid/region ... don't over-engineer this".
 *
 * Keyed by `pop_un_subreg` from `/countries` (23 UN geoscheme subregions --
 * far fewer than 254 countries, and known well enough to place roughly
 * correctly, unlike a hand-typed per-country table which would be both much
 * larger and much more likely to be wrong for small/less-familiar countries).
 * Values are approximate [lng, lat] centroids and a zoom level wide enough
 * to show most of the subregion at once.
 */
export const REGION_CENTROIDS: Record<string, { center: [number, number]; zoom: number }> = {
  "Eastern Africa": { center: [34, -2], zoom: 4 },
  "Middle Africa": { center: [20, -2], zoom: 4 },
  "Northern Africa": { center: [15, 26], zoom: 4 },
  "Southern Africa": { center: [24, -28], zoom: 4 },
  "Western Africa": { center: [-2, 10], zoom: 4 },
  Caribbean: { center: [-71, 19], zoom: 5 },
  "Central America": { center: [-88, 14], zoom: 5 },
  "Northern America": { center: [-100, 50], zoom: 3 },
  "South America": { center: [-60, -18], zoom: 3 },
  Antartica: { center: [0, -80], zoom: 2 },
  "Central Asia": { center: [66, 45], zoom: 4 },
  "Eastern Asia": { center: [115, 35], zoom: 4 },
  "South-Eastern Asia": { center: [110, 5], zoom: 4 },
  "Southern Asia": { center: [77, 22], zoom: 4 },
  "Western Asia": { center: [42, 30], zoom: 4 },
  "Eastern Europe": { center: [35, 50], zoom: 4 },
  "Northern Europe": { center: [15, 58], zoom: 4 },
  "Southern Europe": { center: [15, 41], zoom: 4 },
  "Western Europe": { center: [6, 49], zoom: 5 },
  "Australia and New Zealand": { center: [140, -28], zoom: 4 },
  Melanesia: { center: [155, -8], zoom: 4 },
  Micronesia: { center: [150, 8], zoom: 4 },
  Polynesia: { center: [-160, -12], zoom: 4 },
  Other: { center: [0, 20], zoom: 2 },
};

/** World view used when a country's subregion isn't in the table above
 * (shouldn't happen for real `/countries` rows, but a bare `[0,20]` world
 * view is a safe, honest fallback rather than throwing). */
export const WORLD_VIEW = { center: [0, 20] as [number, number], zoom: 2 };
