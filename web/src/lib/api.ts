import { countriesUrl, countryUrl, datasetsUrl, featureUrl } from "./config";

/**
 * One row of `GET /datasets` (api/app/main.py's list_datasets, backed by
 * `registry.datasets`). This is the ONLY place the frontend should ever
 * learn what layers/datasets exist -- never hardcode a dataset list, since
 * curators add more via upload later (Horizon 2) without a frontend deploy.
 *
 * `geometry_type` / `serve_mode` / `extent` are null for tabular (non-
 * geometry) datasets -- e.g. the four LandMark indicator tables behind
 * `/countries`. Anything mappable has both a geometry_type and a serve_mode.
 */
export interface Dataset {
  slug: string;
  name: string;
  description: string;
  source: string;
  license: string;
  attribution: string;
  sensitivity: "public" | "restricted" | "withheld" | string;
  geometry_type: string | null;
  serve_mode: "martin" | "pmtiles" | string | null;
  extent: GeoJSON.Polygon | null;
}

/** True for datasets the map can actually draw a source/layer pair for. */
export function isMappable(dataset: Dataset): boolean {
  return dataset.geometry_type != null && dataset.serve_mode != null;
}

/**
 * One row of `GET /countries` (published.country_summary, a view joining
 * four LandMark indicator tables -- api/worker/tabular_tasks.py's
 * build_country_summary_view_task). Columns are prefixed per source table
 * (pop_*, pct_*, tsic_*, tsii_*) plus a bare `iso_code` -- kept as a loose
 * index signature rather than listing 100+ columns by hand, matching how
 * the view itself is generated (introspected from information_schema, not
 * hand-maintained) so this type doesn't silently drift from the real shape.
 */
export interface CountrySummary {
  iso_code: string;
  pop_country?: string;
  pop_un_reg?: string;
  pop_un_subreg?: string;
  [key: string]: unknown;
}

/**
 * Shape returned by FastAPI's `GET /features/{dataset_slug}/{feature_id}`.
 * Kept loose (index signature passthrough) because every published dataset
 * has its own attribute schema (Kenya fixture vs. LandMark indicative
 * areas) -- Phase 1 only needs to display whatever attributes come back,
 * not validate an exact shape per dataset.
 */
export interface FeatureDetail {
  id?: number;
  name?: string;
  [key: string]: unknown;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Registry catalog -- drives the layer toggle list, map sources, and every
 * governance badge (brief §13). Fetched once per page load; Phase 1 has no
 * live-update requirement (a curator publishing mid-session just needs a
 * page reload to appear, same as any other catalog-driven site). */
export function fetchDatasets(): Promise<Dataset[]> {
  return getJson<Dataset[]>(datasetsUrl());
}

/** Country-summary list for the search box / country filter / country index. */
export function fetchCountries(): Promise<CountrySummary[]> {
  return getJson<CountrySummary[]>(countriesUrl());
}

/** Single country's summary, e.g. for a deep link straight to one country. */
export function fetchCountry(isoCode: string): Promise<CountrySummary> {
  return getJson<CountrySummary>(countryUrl(isoCode));
}

/**
 * Looks up one feature's full attributes from FastAPI by whichever key the
 * clicked tile payload gave us (numeric `id` from Martin, or `name` as the
 * fallback when a PMTiles source's tile doesn't carry an id -- see
 * mapSources.ts / MapView.tsx for why the two tile sources differ here).
 * `datasetSlug` is required now that there's more than one geometry
 * dataset -- the API uses it to pick which `published.<table>` to query.
 */
export async function fetchFeature(datasetSlug: string, idOrName: string | number): Promise<FeatureDetail> {
  return getJson<FeatureDetail>(featureUrl(datasetSlug, idOrName));
}
