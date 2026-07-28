import {
  adminAuditLogUrl,
  adminDatasetGovernanceUrl,
  adminDatasetsUrl,
  adminDraftStylesUrl,
  adminLayerPublishUrl,
  adminLayerStyleUrl,
  loginUrl,
  publishedStylesUrl,
} from "./config";

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

/** The single-value paint properties this phase's styling panel edits --
 * see mapSources.ts's buildFillLayer/buildOutlineLayer for the hardcoded
 * defaults this is meant to eventually override (brief §6.3: "single-value
 * styling first"). */
export interface StyleJson {
  "fill-color": string;
  "fill-opacity": number;
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
