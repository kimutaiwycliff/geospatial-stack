// Endpoint bases -- environment-aware since a real bug report (admin login
// silently failing with zero network requests, once caddy/Caddyfile grew a
// CSP header) showed the "swap it for relative paths once deployed behind
// Caddy" note below had never actually been done.
//
// WHY two modes instead of one hardcoded set of URLs: `import.meta.env.DEV`
// is true only under Vite's own dev server (`npm run dev`, running OUTSIDE
// Docker on the host) -- there, `docker-compose.override.yml` exposes each
// service's port straight to the host, so hitting Martin/the API/MinIO
// directly by port is the simplest thing that works, and is what every URL
// here used to do unconditionally. But the BUILT app (`vite build`, served
// by the `web` nginx container behind Caddy -- i.e. every real `docker
// compose up` deployment, not just Vite dev) has never been behind that
// same host-port-mapping: from a browser hitting Caddy's origin (e.g.
// localhost:8080), `http://localhost:8000` is a DIFFERENT origin entirely
// (different port). That always relied on CORS + the override file's port
// exposure to limp along; adding caddy/Caddyfile's CSP (`connect-src 'self'
// https:`) finally made the browser refuse the cross-origin, non-HTTPS
// fetch outright -- blocked client-side before any request is even sent,
// which is why devtools showed no network activity at all. The real fix is
// what this file's own comment always said to do: relative paths in
// production, which Caddy's own `handle_path /api/*` `/tiles/*` `/objects/*`
// blocks (see /caddy/Caddyfile) already route correctly -- and are
// automatically same-origin, so the CSP no longer has anything to block.
const isDev = import.meta.env.DEV;

/** Martin's tile server -- direct-by-port only in Vite dev (see file
 * header); in a built app, Caddy's `handle_path /tiles/*` strips this
 * prefix and forwards to martin:3000 (docker-compose.yml). */
const MARTIN_BASE_URL = isDev ? "http://localhost:3000" : "/tiles";

/** MinIO's S3 API -- direct-by-port only in Vite dev. In a built app,
 * Caddy's `handle_path /objects/*` rewrites to `/geoplatform/<uri>` and
 * forwards to storage:9000 -- the bucket name is Caddy's job to insert,
 * NOT this file's, which is why `pmtilesUrlFor`/`BASEMAP_PMTILES_URL`
 * below only splice in `S3_BUCKET` for the dev-direct case. */
const S3_BASE_URL = isDev ? "http://localhost:9000" : "/objects";

/** Bucket name -- matches .env.example's S3_BUCKET (also "geoplatform" if R2 vars are swapped in later). */
const S3_BUCKET = "geoplatform";

/** FastAPI -- direct-by-port only in Vite dev; in a built app, Caddy's
 * `handle_path /api/*` strips this prefix and forwards to api:8000. */
const API_BASE_URL = isDev ? "http://localhost:8000" : "/api";

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
 * Object-storage URL for a key under the bucket. Dev mode hits MinIO
 * directly, so the bucket name must be explicit in the path; a built app
 * goes through Caddy's `/objects/*` rewrite (see S3_BASE_URL above), which
 * already inserts the bucket name server-side -- repeating it client-side
 * there would 404 (double bucket segment). Prefixed with
 * `window.location.origin` rather than left as a bare relative path so the
 * `pmtiles://` protocol handler below always gets a real, unambiguous
 * absolute URL, matching the shape it's always received in dev mode.
 */
function objectUrl(key: string): string {
  return isDev ? `${S3_BASE_URL}/${S3_BUCKET}/${key}` : `${window.location.origin}${S3_BASE_URL}/${key}`;
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
  return `pmtiles://${objectUrl(`tiles/${slug}.pmtiles`)}`;
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
export const BASEMAP_PMTILES_URL = `pmtiles://${objectUrl("basemap/basemap.pmtiles")}`;

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

/**
 * Per-flavor icon sprite. Protomaps only publishes sprite sheets for the
 * "light"/"dark" flavors (their own `generate_style` CLI -- see
 * node_modules/@protomaps/basemaps/src/generate_style.ts -- only ever sets a
 * sprite value for those two names too); "white"/"grayscale"/"black" have no
 * sprite sheet of their own, so those flavors render with no POI icons
 * rather than pointing at a 404. Returning `undefined` there (not the light
 * sprite as a fallback) matches upstream's own behavior exactly.
 */
export function basemapSpriteUrl(flavor: string): string | undefined {
  if (flavor !== "light" && flavor !== "dark") return undefined;
  return `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`;
}

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

/** One dataset by slug -- today only used for `DELETE`, but named for the
 * resource (not the verb) in case a future admin-only single-dataset GET
 * ever wants the same URL. */
export function adminDatasetUrl(slug: string): string {
  return `${API_BASE_URL}/admin/datasets/${encodeURIComponent(slug)}`;
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

/** Distinct values for one column of a published dataset -- backs Map
 * authoring's filter editor (brief follow-up: "the allowable ones I
 * should just be choosing from unique fields"). */
export function adminDatasetFieldValuesUrl(slug: string, field: string): string {
  return `${API_BASE_URL}/admin/datasets/${encodeURIComponent(slug)}/field-values?field=${encodeURIComponent(field)}`;
}

/** Changes an already-published dataset's serve mode (brief follow-up:
 * "I can later change how I would want a dataset should be served"). */
export function adminDatasetServeModeUrl(slug: string): string {
  return `${API_BASE_URL}/admin/datasets/${encodeURIComponent(slug)}/serve-mode`;
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

// --- Phase 4 self-service upload endpoints (brief §16 steps 1-6). Same
// dev-only direct-to-container shortcut as every URL above.

/** `POST /admin/uploads` -- multipart file + name + description. */
export function adminUploadsUrl(): string {
  return `${API_BASE_URL}/admin/uploads`;
}

/** Polling target while validation runs in the worker -- see adminApi.ts's
 * fetchUploadStatus for the poll-until-`validation_report`-is-non-null loop. */
export function adminUploadStatusUrl(slug: string): string {
  return `${API_BASE_URL}/admin/uploads/${encodeURIComponent(slug)}/status`;
}

/** Curator's explicit "publish this" action -- 400s server-side unless
 * `validation_report.passed` is already true (the UI is expected to gate on
 * that itself rather than rely on the error, see UploadPanel). */
export function adminUploadApproveUrl(slug: string): string {
  return `${API_BASE_URL}/admin/uploads/${encodeURIComponent(slug)}/approve`;
}

// --- Phase 4 Map authoring endpoints (brief §16 second half). A Map is
// pure stored config over registry layers -- no worker/pipeline involved,
// unlike uploads above.

/** Public, no auth -- every published map's basic info (a map-picker's data source). */
export function mapsUrl(): string {
  return `${API_BASE_URL}/maps`;
}

/** Public, no auth -- one published map's full render config. 404s if the
 * map doesn't exist or isn't published (see MapBySlugPage's error handling). */
export function mapUrl(slug: string): string {
  return `${API_BASE_URL}/maps/${encodeURIComponent(slug)}`;
}

/** Admin -- every map regardless of status; the authoring UI's list view. */
export function adminMapsUrl(): string {
  return `${API_BASE_URL}/admin/maps`;
}

/** Admin -- one map's full config regardless of status (GET for the editor
 * to load, PUT for its partial-update save). */
export function adminMapUrl(slug: string): string {
  return `${API_BASE_URL}/admin/maps/${encodeURIComponent(slug)}`;
}

/** Admin -- flips a map's status draft -> published. Idempotent server-side. */
export function adminMapPublishUrl(slug: string): string {
  return `${API_BASE_URL}/admin/maps/${encodeURIComponent(slug)}/publish`;
}

/** Admin -- flips a map's status published -> draft. Idempotent server-side. */
export function adminMapUnpublishUrl(slug: string): string {
  return `${API_BASE_URL}/admin/maps/${encodeURIComponent(slug)}/unpublish`;
}
