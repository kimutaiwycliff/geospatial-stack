// Phase-1 dev-only endpoint constants.
//
// WHY hardcoded absolute URLs instead of a Vite proxy or env vars: the build
// brief's real routing layer is Caddy, which will front Martin/the API/MinIO
// behind one origin once the whole compose stack (incl. `web`) runs together
// (see /caddy/Caddyfile). Until then, `docker-compose.override.yml` exposes
// each service's port straight to the host for local development, so the
// dev server (this Vite app, running OUTSIDE Docker on the host) can just
// hit them directly. This file is the one place that shortcut lives --
// swap it for relative paths (`/tiles`, `/api`, `/objects`) once the app is
// deployed as the `web` service behind Caddy; no other file should hardcode
// a port. (Carried over unchanged from Phase 0 -- see git history for that
// version's fuller rationale.)

/** Martin's tile server, reached directly (dev only -- see file header). */
const MARTIN_BASE_URL = "http://localhost:3000";

/** MinIO's S3 API, reached directly (dev only -- see file header). */
const S3_BASE_URL = "http://localhost:9000";

/** Bucket name -- matches .env.example's S3_BUCKET (also "geoplatform" if R2 vars are swapped in later). */
const S3_BUCKET = "geoplatform";

/** FastAPI, reached directly (dev only -- see file header). */
const API_BASE_URL = "http://localhost:8000";

/**
 * Martin's per-table tile URL. The dataset registry never stores a Martin
 * source id -- every publishing path so far (ETL's load_postgis_task, this
 * app's own naming) derives it the same deterministic way: the dataset slug
 * with `-` swapped for `_`, which is also the `published.<table>` name and
 * the MVT source-layer name baked into the tiles. That three-way identity
 * is what lets one function here stand in for a per-dataset Martin config
 * entry instead of the frontend needing its own copy of tiles/martin/config.yaml.
 */
export function martinTileUrl(slug: string): string {
  return `${MARTIN_BASE_URL}/${tableNameFor(slug)}/{z}/{x}/{y}`;
}

/**
 * Static PMTiles archive in MinIO for a given dataset slug. Uses the
 * `pmtiles://` protocol prefix (registered in src/main.tsx via
 * maplibregl.addProtocol) wrapping a plain HTTP(S) URL -- the pmtiles JS
 * library range-requests this URL directly, no server-side tile logic
 * involved at all. Matches tiles/build/build_pmtiles.py's upload path
 * (`tiles/<slug>.pmtiles`) exactly.
 */
export function pmtilesUrlFor(slug: string): string {
  return `pmtiles://${S3_BASE_URL}/${S3_BUCKET}/tiles/${slug}.pmtiles`;
}

/**
 * Table / Martin source id / MVT source-layer name derived from a dataset
 * slug -- one identifier shared across all three because every step in the
 * pipeline derives it the same way (see martinTileUrl's comment).
 */
export function tableNameFor(slug: string): string {
  return slug.replace(/-/g, "_");
}

/**
 * Self-hosted OSM basemap (brief §1.5/§15) -- world coverage, zoom 0-8,
 * uploaded once at build time (basemap/build_basemap.py), served the exact
 * same way as any dataset's PMTiles archive: a bare MinIO URL behind the
 * pmtiles:// protocol, range-requested client-side, no tile server involved.
 */
export const BASEMAP_PMTILES_URL = `pmtiles://${S3_BASE_URL}/${S3_BUCKET}/basemap/basemap.pmtiles`;

/**
 * Font glyphs + icon sprite for the @protomaps/basemaps style. These are
 * Protomaps' own free, keyless, static GitHub Pages assets -- not a
 * metered/keyed API, so they don't violate brief §1.5's "no external API
 * keys" rule (the tile *data* itself is fully self-hosted; only these two
 * static asset bundles are fetched from a public CDN). A fully air-gapped
 * deployment would need to mirror these two paths into MinIO too -- flagged
 * as a Phase 2 follow-up, not done here since it's not required to render
 * the basemap.
 */
export const BASEMAP_GLYPHS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
export const BASEMAP_SPRITE_URL = "https://protomaps.github.io/basemaps-assets/sprites/v4/light";

/**
 * FastAPI endpoints (brief §17/§6.2). No `/api` prefix here even though
 * Caddy's production route is `/api/*`: docker-compose.yml's own
 * healthcheck for the `api` service hits `http://localhost:8000/healthz`
 * (no /api prefix) inside the container, and Caddy's Caddyfile uses
 * `handle_path /api/*` specifically because that directive STRIPS the
 * matched prefix before proxying -- so FastAPI's own routes are mounted at
 * root, and `/api` is purely Caddy's external namespacing. Hitting the
 * container directly (this dev shortcut) therefore skips straight to the
 * un-prefixed route.
 */
export function datasetsUrl(): string {
  return `${API_BASE_URL}/datasets`;
}

export function countriesUrl(): string {
  return `${API_BASE_URL}/countries`;
}

export function countryUrl(isoCode: string): string {
  return `${API_BASE_URL}/countries/${encodeURIComponent(isoCode)}`;
}

/**
 * Feature-detail endpoint. THE ROUTE CHANGED from Phase 0's `/features/{id}`
 * to `/features/{dataset_slug}/{feature_id}` because Phase 1 has multiple
 * published geometry datasets -- the API now needs to know which
 * `published.<table>` to query (see api/app/main.py's get_feature).
 */
export function featureUrl(datasetSlug: string, idOrName: string | number): string {
  return `${API_BASE_URL}/features/${encodeURIComponent(datasetSlug)}/${encodeURIComponent(idOrName)}`;
}

// --- Phase 3 admin endpoints (brief §6.3/§10/§13). Same dev-only
// direct-to-container shortcut as above -- these all sit behind Caddy's
// same `/api/*` -> strip-prefix rule in prod, so no route here carries an
// /api prefix either.

/** Form-urlencoded OAuth2PasswordRequestForm login -- NOT JSON (FastAPI's
 * OAuth2PasswordRequestForm dependency only parses form bodies). */
export function loginUrl(): string {
  return `${API_BASE_URL}/auth/login`;
}

/** Full registry, every tier_status -- the admin-only counterpart to
 * datasetsUrl(), which the public map deliberately filters to "published". */
export function adminDatasetsUrl(): string {
  return `${API_BASE_URL}/admin/datasets`;
}

/** Partial-update governance fields for one dataset (brief §13). */
export function adminDatasetGovernanceUrl(slug: string): string {
  return `${API_BASE_URL}/admin/datasets/${encodeURIComponent(slug)}/governance`;
}

/**
 * Audit log, optionally filtered to one dataset. `datasetSlug`/`limit` are
 * both optional query params on the backend -- omitted here exactly when
 * the caller omits them, so a bare call still hits the documented default
 * (limit=100, no dataset filter) instead of this file inventing its own.
 */
export function adminAuditLogUrl(opts?: { datasetSlug?: string; limit?: number }): string {
  const params = new URLSearchParams();
  if (opts?.datasetSlug) params.set("dataset_slug", opts.datasetSlug);
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const query = params.toString();
  return `${API_BASE_URL}/admin/audit-log${query ? `?${query}` : ""}`;
}

/** Every dataset's current draft style row (admin-only preview of unpublished edits). */
export function adminDraftStylesUrl(): string {
  return `${API_BASE_URL}/admin/styles/draft`;
}

/** Upserts one dataset's draft style. */
export function adminLayerStyleUrl(slug: string): string {
  return `${API_BASE_URL}/admin/layers/${encodeURIComponent(slug)}/style`;
}

/** Copies a dataset's draft style into its published row. */
export function adminLayerPublishUrl(slug: string): string {
  return `${API_BASE_URL}/admin/layers/${encodeURIComponent(slug)}/publish`;
}

/** Public (no auth) published styles -- what the live map itself would read
 * once Phase 3's styling replaces mapSources.ts's hardcoded paint values. */
export function publishedStylesUrl(): string {
  return `${API_BASE_URL}/styles/published`;
}
