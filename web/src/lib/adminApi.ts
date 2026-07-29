import {
  adminAuditLogUrl,
  adminDatasetFieldValuesUrl,
  adminDatasetGovernanceUrl,
  adminDatasetServeModeUrl,
  adminDatasetUrl,
  adminDatasetsUrl,
  adminDraftStylesUrl,
  adminLayerPublishUrl,
  adminLayerStyleUrl,
  adminMapPublishUrl,
  adminMapUnpublishUrl,
  adminMapUrl,
  adminMapsUrl,
  adminUploadApproveUrl,
  adminUploadStatusUrl,
  adminUploadsUrl,
  loginUrl,
  mapUrl,
  mapsUrl,
  publishedStylesUrl,
} from "./config";
import type { MapControlsConfig } from "./mapControls";

/**
 * Full registry row as the ADMIN sees it (brief §6.3/§13) -- a superset of
 * api.ts's public `Dataset`: it carries `tier_status` (raw/curated/
 * published, never exposed to the public map, which only ever sees
 * already-published rows) and drops `geometry_type`/`extent` (the admin
 * screens here don't render a map, so there's nothing that needs them).
 * Kept as its own interface rather than extending `Dataset` because the two
 * endpoints genuinely return different field sets, not one being a subset
 * of the other.
 */
export interface AdminDataset {
  id: string;
  slug: string;
  name: string;
  description: string;
  source: string;
  license: string;
  attribution: string;
  sensitivity: "public" | "restricted" | "withheld";
  tier_status: "raw" | "curated" | "published";
  serve_mode: "martin" | "pmtiles" | string | null;
  created_at: string;
  updated_at: string;
  /**
   * Phase 4: `GET /admin/datasets` now also carries the upload pipeline's
   * validation result -- null for a dataset that hasn't run the upload
   * pipeline at all (every engineer-triggered ingest before this phase) OR
   * whose validation hasn't finished yet. Lets the dashboard's list badge a
   * curated-but-unreviewed upload as "awaiting approval" / "validation
   * failed" without a second per-dataset request (see AdminDashboard's
   * TIER_STYLES-adjacent badge logic).
   */
  validation_report: ValidationReport | null;
  /** Column name -> DuckDB type string, set once at ingest time regardless
   * of how the dataset was ingested (engineer-triggered or self-service
   * upload) -- the styling panel's label-field picker builds its dropdown
   * from this rather than a free-text input. `bbox` (an internal struct
   * column every dataset carries, not a real attribute) is filtered out by
   * the caller, not here -- see StylingPanel's `labelFieldOptions`. */
  schema_json: Record<string, string> | null;
  /** Bounding-box polygon, as GeoJSON (same `ST_AsGeoJSON` shape api.ts's
   * public `Dataset.extent` already uses) -- Map authoring's "fit to
   * included layers" button (brief follow-up: "centroid and zoom levels
   * set automatically based on the bounds of the dataset") reads this
   * directly, since MapEditor has no live MapLibre preview to ask instead
   * (by design, see MapEditor.tsx's own docstring). */
  extent: GeoJSON.Polygon | null;
}

/** Every field optional on purpose -- this is a PATCH-shaped partial update
 * (`PUT /admin/datasets/{slug}/governance`), and the backend 400s on an
 * empty body, so callers must build this from only the fields that
 * actually changed (see DatasetDetail's diff-against-loaded-values logic),
 * not spread the whole loaded record back at it. */
export interface GovernancePatch {
  description?: string;
  source?: string;
  license?: string;
  attribution?: string;
  sensitivity?: "public" | "restricted" | "withheld";
}

/** Data-driven label config, one row of `StyleJson.label` -- `field` is a
 * column name from the dataset's `schema_json` (see AdminDataset's own
 * doc comment), rendered via a `symbol` layer's `text-field`. Kept as its
 * own interface (not flattened into StyleJson) because it's genuinely
 * optional as a WHOLE unit -- a dataset with labels off has none of these
 * fields meaningfully set, unlike fill/line paint values which always
 * apply once a layer renders at all. */
export interface LabelStyle {
  enabled: boolean;
  field: string;
  size: number;
  color: string;
  haloColor: string;
  haloWidth: number;
}

/**
 * The single-value paint properties this phase's styling panel edits --
 * see mapSources.ts's buildFillLayer/buildOutlineLayer/buildLabelLayer for
 * the hardcoded defaults this is meant to override (brief §6.3:
 * "single-value styling first" -- still true here: every property below is
 * ONE value applied uniformly across a layer's features, never a
 * data-driven expression/rule/classification the way a full desktop GIS
 * styling panel offers -- see GeoLibre's own StylePanel.tsx for how much
 * further that rabbit hole goes, deliberately not followed here).
 *
 * `line-*` fields are all optional -- undefined means "inherit the old
 * hardcoded default" (see buildOutlineLayer), so a dataset styled before
 * this expansion, or a fresh draft that only touches fill-color, doesn't
 * need every new field populated to remain valid.
 */
export interface StyleJson {
  "fill-color": string;
  "fill-opacity": number;
  "line-color"?: string;
  "line-width"?: number;
  "line-opacity"?: number;
  /** Undefined/empty = solid. A small preset set (solid/dashed/dotted/
   * dash-dot), not a raw array editor -- see StylingPanel's `DASH_PRESETS`. */
  "line-dasharray"?: number[];
  label?: LabelStyle;
}

/** One row of `GET /admin/styles/draft` -- a dataset's saved-but-unpublished style. */
export interface DraftStyle {
  slug: string;
  style_json: StyleJson;
  version: number;
  updated_by: string;
  updated_at: string;
}

/** One row of `GET /styles/published` -- what the public map would render. */
export interface PublishedStyle {
  slug: string;
  style_json: StyleJson;
  version: number;
}

/** Response shape from both the style-save and publish endpoints. */
export interface StyleSaveResult {
  style_json: StyleJson;
  version: number;
}

/**
 * One GeoJSON Feature from `validation_report.sample_features` -- up to 5
 * of the uploaded file's actual rows, geometry + properties both real (not
 * a schema summary), so the curator reviewing a report can see concrete
 * data rather than just field names and counts. `properties` stays a loose
 * record for the same reason FeatureDetail (api.ts) does: every upload's
 * attribute schema is whatever the curator's file happened to contain.
 */
export interface SampleFeature {
  type: "Feature";
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

/**
 * `validation_report` column on `registry.datasets` -- populated once by
 * the worker's `contract_test_task`, null before that finishes (see
 * fetchUploadStatus's poll loop). `passed` is the single boolean the UI
 * gates the Approve action on; `errors` is only meaningful when `passed`
 * is false (brief: human-readable strings like "N rows have coordinates
 * outside WGS84 bounds").
 */
export interface ValidationReport {
  row_count: number;
  geometry_type: string;
  null_or_empty_geometry_count: number;
  invalid_geometry_count: number;
  out_of_range_count: number;
  fields: Record<string, string>;
  sample_features: SampleFeature[];
  passed: boolean;
  errors: string[];
}

/** Response from `POST /admin/uploads` -- returns immediately, before the
 * worker chain has done anything but enqueue (brief §16: "never block on
 * the chain finishing"). `tier_status` is always `"raw"` at this point. */
export interface UploadCreateResult {
  slug: string;
  tier_status: "raw";
}

/** Response from `GET /admin/uploads/{slug}/status` -- a narrower field set
 * than AdminDataset (no `id`/`created_at`/`updated_at`, since this is a
 * poll target callers hit every 2-3s and the backend only selects what the
 * upload flow actually needs). Kept as its own interface rather than
 * `Pick<AdminDataset, ...>` because AdminDataset's `validation_report` was
 * added in service of THIS type, not the other way around -- duplicating
 * the field list here is clearer than a Pick that reads backwards. */
export interface UploadStatus {
  slug: string;
  name: string;
  description: string;
  source: string;
  license: string;
  attribution: string;
  sensitivity: "public" | "restricted" | "withheld";
  tier_status: "raw" | "curated" | "published";
  serve_mode: "martin" | "pmtiles" | string | null;
  validation_report: ValidationReport | null;
}

/** Response from `POST /admin/uploads/{slug}/approve` -- publishing is
 * async (worker's `run_publish_pipeline`), so this is just an
 * acknowledgement; callers go back to polling `fetchUploadStatus` to watch
 * `tier_status` become `"published"`. */
export interface UploadApproveResult {
  slug: string;
  status: "publish_requested";
}

/** "How they should look" (brief follow-up) -- single-value popup/hover
 * styling, mirrored 1:1 from the backend's `PopupStyle` model. */
export interface PopupStyle {
  background_color: string;
  text_color: string;
  border_color: string;
  border_radius: number;
  font_size: number;
}

/** Click-to-inspect popup config for one layer within a Map (brief
 * follow-up: "customize what field show up on popups ... and I should
 * also choose how they should look"). `fields` is empty by default --
 * enabling this with no fields chosen yet is a real (if useless) state,
 * not an error. */
export interface LayerPopupConfig {
  enabled: boolean;
  fields: string[];
  style: PopupStyle;
}

/** Hover-tooltip config -- no `style` of its own; reuses the same layer's
 * `popup.style` (see maps.py's `LayerHoverConfig` docstring for why). */
export interface LayerHoverConfig {
  enabled: boolean;
  fields: string[];
}

/** Mirrors the backend Pydantic models' own field defaults exactly --
 * seeds for a newly-included layer (MapEditor's `toggleLayerIncluded`)
 * and the fallback when an older layers_json entry predates this feature. */
export const DEFAULT_POPUP_STYLE: PopupStyle = {
  background_color: "#ffffff",
  text_color: "#111111",
  border_color: "#e5e7eb",
  border_radius: 8,
  font_size: 13,
};
// enabled: true -- see maps.py's LayerPopupConfig docstring for why this
// one control defaults ON (preserves the old unconditional name-only
// popup) while hover below defaults off (a genuinely new capability).
export const DEFAULT_LAYER_POPUP: LayerPopupConfig = { enabled: true, fields: [], style: DEFAULT_POPUP_STYLE };
export const DEFAULT_LAYER_HOVER: LayerHoverConfig = { enabled: false, fields: [] };

/**
 * One layer reference inside a Map's `layers_json` (brief §16: "layers_json
 * is [{dataset_slug, visible, style_ref: 'published'}]"). `style_ref` only
 * has one legal value today (a map always renders a layer's PUBLISHED
 * style, never a curator's in-progress draft) -- kept as a field rather
 * than hardcoded so a future per-map style override has somewhere to live
 * without another migration, per the backend's own MapLayer model.
 */
export interface MapLayer {
  dataset_slug: string;
  visible: boolean;
  style_ref: "published";
  popup: LayerPopupConfig;
  hover: LayerHoverConfig;
  /** Independent of `popup`/`hover` (brief follow-up: "choose whether ...
   * it will fly to and zoom to that feature ... on top of popup on hover
   * or click, or whether it will even popup in the first place") -- a
   * visitor's click can zoom to the feature, show a popup, both, or
   * neither, all set independently per layer. */
  zoom_to_feature: boolean;
}

/** One admin-defined filter widget (brief follow-up: "filters can be
 * customized ... pointed to specific fields," replacing the old
 * hardcoded country-only filter). `options` is a plain, admin-typed list
 * of allowed values for `field` on `dataset_slug` -- see maps.py's
 * `MapFilter` docstring for why there's no live "distinct values from the
 * tiles" introspection. */
export interface MapFilter {
  id: string;
  label: string;
  dataset_slug: string;
  field: string;
  options: string[];
}

/** Per-dataset override for the auto-generated legend (brief follow-up:
 * "customize the legend") -- mirrors maps.py's `MapLegendItem`. The legend
 * control itself still discovers WHICH layers are visible off the map's
 * own style; this only overrides a given dataset's display label, or
 * hides it entirely. */
export interface MapLegendItem {
  label: string | null;
  hidden: boolean;
}

export interface MapLegendConfig {
  title: string;
  items: Record<string, MapLegendItem>;
}
export const DEFAULT_LEGEND_CONFIG: MapLegendConfig = { title: "Legend", items: {} };

/** Gridlines/graticule styling (brief follow-up: "customize ... the
 * gridlines") -- mirrors maps.py's `GridlinesConfig` and
 * graticuleControl.ts's own previous hardcoded paint values. */
export interface GridlinesConfig {
  color: string;
  width: number;
  opacity: number;
}
export const DEFAULT_GRIDLINES_CONFIG: GridlinesConfig = { color: "#888888", width: 0.5, opacity: 0.5 };

/** Matches urlState.ts's `MapUrlState.view` shape exactly (brief note) --
 * reused as-is rather than inventing a parallel view-state type. */
export interface MapExtent {
  center: [number, number];
  zoom: number;
}

/** One row of `GET /maps` -- public map-picker's data source. */
export interface MapSummary {
  slug: string;
  name: string;
  description: string | null;
}

/** Response from `GET /maps/{slug}` -- public, full render config for one
 * published map. `layers_json` here is already filtered server-side down
 * to layers whose dataset is CURRENTLY published (see maps.py's
 * get_published_map docstring), so the public page never needs to
 * re-check that itself. */
export interface PublicMapConfig {
  slug: string;
  name: string;
  description: string | null;
  layers_json: MapLayer[];
  basemap: string;
  default_extent: MapExtent | null;
  filters_json: MapFilter[] | null;
  legend_json: MapLegendConfig | null;
  controls_json: MapControlsConfig;
  /** Null = no constraint, matching MapLibre's own Map constructor
   * behavior when minZoom/maxZoom are omitted (brief follow-up:
   * "optionally choose minimum and maximum zoom per map"). */
  min_zoom: number | null;
  max_zoom: number | null;
  gridlines_json: GridlinesConfig | null;
}

/** One row of `GET /admin/maps` -- the authoring UI's list view, every
 * status, none of the heavier config fields (matches the backend's
 * `list_all_maps` SELECT exactly). */
export interface AdminMapSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
}

/** Full row of `registry.maps`, as returned by `GET/POST/PUT /admin/maps*`
 * and the publish endpoint -- what the editor loads and every mutation
 * echoes back. */
export interface AdminMapDetail extends AdminMapSummary {
  layers_json: MapLayer[];
  basemap: string;
  default_extent: MapExtent | null;
  filters_json: MapFilter[] | null;
  legend_json: MapLegendConfig | null;
  controls_json: MapControlsConfig;
  created_by: string | null;
  version: number;
  min_zoom: number | null;
  max_zoom: number | null;
  gridlines_json: GridlinesConfig | null;
}

/** Body for `POST /admin/maps` -- `name` is the only required field; the
 * slug is derived server-side (same `slugify` the uploads flow uses). */
export interface MapCreateBody {
  name: string;
  description?: string;
}

/** Every field optional on purpose -- same `exclude_unset` partial-update
 * pattern as GovernancePatch. Callers (MapEditor) must diff against the
 * loaded row themselves and only send what actually changed. */
export interface MapUpdatePatch {
  name?: string;
  description?: string;
  layers_json?: MapLayer[];
  basemap?: string;
  default_extent?: MapExtent | null;
  filters_json?: MapFilter[] | null;
  legend_json?: MapLegendConfig | null;
  controls_json?: MapControlsConfig;
  min_zoom?: number | null;
  max_zoom?: number | null;
  gridlines_json?: GridlinesConfig | null;
}

/** One row of `GET /admin/audit-log`. `details` is intentionally left as a
 * loose record -- its shape depends on `action` (draft-saved vs. published
 * vs. governance-updated each log different fields) and Phase 3 only needs
 * to display it, not branch on it. */
export interface AuditLogEntry {
  id: string;
  actor_email: string;
  action: string;
  dataset_slug: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface LoginResult {
  access_token: string;
  token_type: string;
  role: string;
}

/**
 * Thrown for any admin request that comes back 401 (missing/invalid/
 * expired token) so the UI layer can catch this ONE type and redirect to
 * `/admin/login`, instead of string-matching a generic Error's message.
 * A 403 (valid token, wrong role) deliberately does NOT throw this --
 * per the brief, no viewer accounts exist yet, so that path is treated as
 * an unexpected error to surface, not a "go log in again" signal.
 */
export class UnauthorizedError extends Error {
  constructor(url: string) {
    super(`401 Unauthorized: ${url}`);
    this.name = "UnauthorizedError";
  }
}

/** `POST /auth/login` -- form-urlencoded (OAuth2PasswordRequestForm), NOT
 * JSON. `username` is the admin's email; FastAPI's dependency just names it
 * that regardless of what the field actually represents. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const body = new URLSearchParams();
  body.set("username", email);
  body.set("password", password);

  const res = await fetch(loginUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status === 401) {
    throw new UnauthorizedError(loginUrl());
  }
  if (!res.ok) {
    throw new Error(`POST ${loginUrl()} -> HTTP ${res.status}`);
  }
  return res.json() as Promise<LoginResult>;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

/** Shared fetch+parse for every admin (bearer-token) request -- one place
 * to attach the header and translate a 401 into `UnauthorizedError` so
 * every caller below stays a one-liner. */
async function adminFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    throw new UnauthorizedError(url);
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} -> HTTP ${res.status}`);
  }
  // 204s / bodyless publish-with-no-draft errors aside, every admin route
  // used here returns JSON on success.
  return res.json() as Promise<T>;
}

/** Full registry, all tier_status values -- drives the admin dataset list. */
export function fetchAdminDatasets(token: string): Promise<AdminDataset[]> {
  return adminFetch<AdminDataset[]>(adminDatasetsUrl(), token);
}

/** Partial governance update -- `patch` should already be diffed down to
 * only the changed fields by the caller (see GovernancePatch's doc comment). */
export function updateGovernance(
  token: string,
  slug: string,
  patch: GovernancePatch,
): Promise<Partial<AdminDataset>> {
  return adminFetch<Partial<AdminDataset>>(adminDatasetGovernanceUrl(slug), token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** Deletes a dataset's registry row and everything its pipeline produced --
 * raw/curated GeoParquet, tiles, an uploaded source file -- regardless of
 * `tier_status` (raw/curated/published all delete the same way; see
 * governance.py's `delete_dataset` for the full contract). There is no
 * undo short of a backup restore. */
export function deleteDataset(token: string, slug: string): Promise<{ slug: string; deleted: true }> {
  return adminFetch(adminDatasetUrl(slug), token, { method: "DELETE" });
}

/** Distinct values for one column of a published dataset -- backs Map
 * authoring's filter editor (brief follow-up: "the allowable ones I
 * should just be choosing from unique fields," not hand-typing them). */
export function fetchFieldValues(token: string, slug: string, field: string): Promise<string[]> {
  return adminFetch<{ values: string[] }>(adminDatasetFieldValuesUrl(slug, field), token).then((r) => r.values);
}

/** Changes an already-published dataset's serve mode (brief follow-up:
 * "I can later change how I would want a dataset should be served whether
 * by pmtiles or martin tiles"). Switching to martin takes effect
 * immediately (Martin already auto-discovers every published table);
 * switching to pmtiles dispatches a tile build in the background -- see
 * governance.py's `update_serve_mode` for the full contract. */
export function updateServeMode(token: string, slug: string, serveMode: "pmtiles" | "martin"): Promise<{ slug: string; serve_mode: string }> {
  return adminFetch(adminDatasetServeModeUrl(slug), token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serve_mode: serveMode }),
  });
}

/** Every dataset's current draft style -- callers filter this down to one
 * slug themselves (there's no per-slug draft endpoint). */
export function fetchDraftStyles(token: string): Promise<DraftStyle[]> {
  return adminFetch<DraftStyle[]>(adminDraftStylesUrl(), token);
}

/** Upserts one dataset's draft style. Body is `{style_json: {...}}` --
 * nested, not the bare paint object -- per the backend contract. */
export function saveDraftStyle(token: string, slug: string, styleJson: StyleJson): Promise<StyleSaveResult> {
  return adminFetch<StyleSaveResult>(adminLayerStyleUrl(slug), token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ style_json: styleJson }),
  });
}

/** Copies the current draft into the published row. 404s if there's no
 * draft yet -- callers should already be hiding/disabling the Publish
 * button in that case (see DatasetDetail), so this is a real error path,
 * not an expected one. */
export function publishStyle(token: string, slug: string): Promise<StyleSaveResult> {
  return adminFetch<StyleSaveResult>(adminLayerPublishUrl(slug), token, { method: "POST" });
}

/** Public, unauthenticated -- what the live map would actually render.
 * No token param on purpose: this is the one admin-adjacent function any
 * page could call without being logged in. */
export async function fetchPublishedStyles(): Promise<PublishedStyle[]> {
  const res = await fetch(publishedStylesUrl());
  if (!res.ok) {
    throw new Error(`GET ${publishedStylesUrl()} -> HTTP ${res.status}`);
  }
  return res.json() as Promise<PublishedStyle[]>;
}

export function fetchAuditLog(token: string, opts?: { datasetSlug?: string; limit?: number }): Promise<AuditLogEntry[]> {
  return adminFetch<AuditLogEntry[]>(adminAuditLogUrl(opts), token);
}

// --- Phase 4: self-service upload (brief §16 steps 1-6).

/**
 * `POST /admin/uploads` -- multipart/form-data, NOT JSON, unlike every
 * other admin write in this file. Deliberately does NOT set a
 * `Content-Type` header: the browser has to generate one itself (
 * `multipart/form-data; boundary=...`), and setting it manually here would
 * either omit the boundary (backend can't parse the body at all) or lock
 * in a boundary string that doesn't match what actually got written to the
 * request body. `adminFetch` isn't reused here for that same reason -- it
 * always spreads `authHeaders` first but never forces Content-Type, so it
 * WOULD work, but bypassing it and being explicit inline makes "this one
 * call is different" visible at the call site rather than buried in a
 * shared helper's behavior.
 */
export async function createUpload(
  token: string,
  file: File,
  name: string,
  description?: string,
): Promise<UploadCreateResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("name", name);
  if (description) body.append("description", description);

  const res = await fetch(adminUploadsUrl(), {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
  if (res.status === 401) {
    throw new UnauthorizedError(adminUploadsUrl());
  }
  if (!res.ok) {
    // 400 (bad extension) and 409 (slug collision) both carry a useful
    // `detail` string the caller wants to show verbatim, not just an HTTP
    // status -- unlike adminFetch's generic error, this reads the body.
    const detail = await res.json().catch(() => null);
    const message = typeof detail?.detail === "string" ? detail.detail : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<UploadCreateResult>;
}

/** Poll target while the worker's validate-only chain runs -- callers
 * (UploadPanel) are expected to call this every 2-3s until
 * `validation_report` is non-null, per the brief; this function itself
 * does exactly one GET, it doesn't own the polling loop. */
export function fetchUploadStatus(token: string, slug: string): Promise<UploadStatus> {
  return adminFetch<UploadStatus>(adminUploadStatusUrl(slug), token);
}

/**
 * Curator's explicit "publish this" action. `serveMode` chooses between a
 * static PMTiles archive (built once at approval time, served straight
 * from object storage) and Martin's dynamic tiles (served live from
 * Postgres, auto-discovered by tiles/martin/config.yaml within ~30s of
 * this call -- no server-side edit needed anymore, brief follow-up: "give
 * the admin [the choice] whether it will be from the pmtiles or martin
 * dynamic tiles").
 */
export function approveUpload(token: string, slug: string, serveMode: "pmtiles" | "martin"): Promise<UploadApproveResult> {
  return adminFetch<UploadApproveResult>(adminUploadApproveUrl(slug), token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serve_mode: serveMode }),
  });
}

// --- Phase 4: Map authoring (brief §16 second half). `fetchMaps`/`fetchMap`
// are the two public, unauthenticated ones (no token param), matching
// fetchPublishedStyles' pattern above.

/** Public -- every published map's basic info. */
export async function fetchMaps(): Promise<MapSummary[]> {
  const res = await fetch(mapsUrl());
  if (!res.ok) {
    throw new Error(`GET ${mapsUrl()} -> HTTP ${res.status}`);
  }
  return res.json() as Promise<MapSummary[]>;
}

/** Public -- one published map's full render config. Throws a plain Error
 * (including on 404, "map not found or not published") -- MapBySlugPage
 * treats any failure here the same way, there's no UnauthorizedError path
 * on an unauthenticated route. */
export async function fetchMap(slug: string): Promise<PublicMapConfig> {
  const res = await fetch(mapUrl(slug));
  if (!res.ok) {
    throw new Error(`GET ${mapUrl(slug)} -> HTTP ${res.status}`);
  }
  return res.json() as Promise<PublicMapConfig>;
}

/** Admin -- every map, every status. The Maps list view's data source. */
export function fetchAdminMaps(token: string): Promise<AdminMapSummary[]> {
  return adminFetch<AdminMapSummary[]>(adminMapsUrl(), token);
}

/** Admin -- one map's full config regardless of status; what MapEditor loads. */
export function fetchAdminMap(token: string, slug: string): Promise<AdminMapDetail> {
  return adminFetch<AdminMapDetail>(adminMapUrl(slug), token);
}

/** Creates a new empty draft map. 409s if the derived slug collides with
 * an existing map -- callers show that error, they don't pre-check it
 * client-side (no `GET /admin/maps?slug=` lookup exists to pre-check with). */
export function createMap(token: string, body: MapCreateBody): Promise<AdminMapDetail> {
  return adminFetch<AdminMapDetail>(adminMapsUrl(), token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Partial update -- `patch` should already be diffed down to only the
 * changed fields by the caller (see MapEditor's diff-against-loaded-values
 * logic, same pattern as GovernanceForm's `buildPatch`). */
export function updateMap(token: string, slug: string, patch: MapUpdatePatch): Promise<AdminMapDetail> {
  return adminFetch<AdminMapDetail>(adminMapUrl(slug), token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** Flips a map's status to published. Idempotent server-side if already published. */
export function publishMap(token: string, slug: string): Promise<AdminMapDetail> {
  return adminFetch<AdminMapDetail>(adminMapPublishUrl(slug), token, { method: "POST" });
}

/** Flips a map's status back to draft (brief follow-up: "admin should be
 * able to unpublish ... maps") -- takes an already-shared `/m/<slug>` URL
 * offline; idempotent server-side if already a draft. */
export function unpublishMap(token: string, slug: string): Promise<AdminMapDetail> {
  return adminFetch<AdminMapDetail>(adminMapUnpublishUrl(slug), token, { method: "POST" });
}

/** Deletes a map's registry row outright (brief follow-up: "even delete
 * maps") -- works regardless of draft/published status. There is no undo
 * short of a backup restore. */
export function deleteMap(token: string, slug: string): Promise<{ slug: string; deleted: true }> {
  return adminFetch(adminMapUrl(slug), token, { method: "DELETE" });
}
