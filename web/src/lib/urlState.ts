/**
 * Map state <-> URL query-string, both directions (brief §6.2 "shareable
 * URLs (map state in query params)"). Kept as pure functions (no React,
 * no router) so MapPage can call these from a `useSearchParams` setter
 * without this module needing to know which router is in use.
 *
 * Params:
 *   lng, lat, zoom  -- current view. All three or none; a URL with only
 *                      some of them is treated as "no view in the URL" so a
 *                      half-copied link doesn't produce a nonsensical view.
 *   layers          -- comma-separated visible dataset slugs. Omitted
 *                      entirely means "all mappable datasets visible" (the
 *                      default), so a plain bare `/map` URL doesn't grow a
 *                      long `layers=` param listing everything.
 *   country         -- selected country's ISO code, if any.
 *   basemap         -- basemap flavor (light/dark/white/grayscale/black).
 *                       Omitted entirely means "light" (the default), same
 *                       omit-the-default convention as `layers`.
 */
export interface MapUrlState {
  view: { center: [number, number]; zoom: number } | null;
  /** null = "no explicit layers param" (caller should default to all). */
  visibleSlugs: string[] | null;
  country: string | null;
  /** Raw string, not `BasemapFlavor` -- this module deliberately has no
   * dependency on basemapStyle.ts, so narrowing/validating an unrecognized
   * value is the caller's job (see basemapStyle.ts's `asBasemapFlavor`). */
  basemap: string | null;
}

export function parseMapUrlState(params: URLSearchParams): MapUrlState {
  const lng = Number(params.get("lng"));
  const lat = Number(params.get("lat"));
  const zoom = Number(params.get("zoom"));
  const hasView =
    params.has("lng") && params.has("lat") && params.has("zoom") && [lng, lat, zoom].every(Number.isFinite);

  const layersParam = params.get("layers");

  return {
    view: hasView ? { center: [lng, lat], zoom } : null,
    visibleSlugs: layersParam !== null ? layersParam.split(",").filter(Boolean) : null,
    country: params.get("country"),
    basemap: params.get("basemap"),
  };
}

/**
 * Builds the full replacement param set for the current state. Takes
 * `allSlugs` so it can omit `layers` when every dataset is visible (the
 * common case) rather than always spelling out the full list -- keeps
 * shared URLs readable and avoids the param silently going stale if a new
 * dataset is published later (an omitted `layers` param still means "all",
 * automatically including whatever's newly published).
 */
export function buildMapUrlParams(state: {
  center: [number, number];
  zoom: number;
  visibleSlugs: string[];
  allSlugs: string[];
  country: string | null;
  basemap: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("lng", state.center[0].toFixed(5));
  params.set("lat", state.center[1].toFixed(5));
  params.set("zoom", state.zoom.toFixed(2));

  const allVisible = state.allSlugs.length > 0 && state.allSlugs.every((s) => state.visibleSlugs.includes(s));
  if (!allVisible) {
    params.set("layers", state.visibleSlugs.join(","));
  }

  if (state.country) {
    params.set("country", state.country);
  }

  if (state.basemap !== "light") {
    params.set("basemap", state.basemap);
  }

  return params;
}
