# Geospatial Platform — Build Brief (v3, refined)

*A production-grade, Docker-first, reusable open geospatial platform. Horizon 1 replicates a LandMark-style site (landmarkmap.org) with all available data; Horizon 2 turns it into a self-service platform for uploading new data and creating new maps.*

> **Status:** Decisions are locked (see §2). Stack versions verified via npm/PyPI/GitHub on 2026-07-27. This is the plan of record for review before build.

---

## 1. Mission & scope

Build one reusable platform, delivered in two horizons:

- **Horizon 1 — Replicate LandMark (now).** A public, interactive site for exploring Indigenous & community land rights: community-level boundaries, national indicators, country summaries, filters, clickable polygons with popups/side panels, search, layer toggles, and shareable URLs. Loaded with all available LandMark data (§15).
- **Horizon 2 — Self-service platform (soon).** Authenticated users upload new geospatial data, have it validated and curated, style it, compose it into named maps, and publish — without engineering involvement (§16).

Everything in Horizon 1 is designed so Horizon 2 is an extension, not a rewrite: the same ingest → curate → publish pipeline, dataset registry, and styling engine power both.

---

## 2. Locked decisions & stack

| Concern | Decision | Version (2026-07-27) |
|---|---|---|
| Spatial database | PostgreSQL + PostGIS | PG 17 / PostGIS 3.5+ |
| ETL / analysis / QA | DuckDB + `spatial` | 1.5.5 |
| Interchange format | GeoParquet 1.1 (bbox covering cols) | — |
| Dynamic vector tiles | Martin | current |
| Static vector tiles | PMTiles (+ `tippecanoe` to build) | JS lib 4.4.1 |
| Web map client | MapLibre GL JS | 6.0 |
| Web framework | **Vite + React SPA** (not Next.js) | — |
| Frontend UI | **Tailwind CSS v4 + shadcn/ui** (Radix primitives, component-based; source vendored into repo) | Tailwind v4 |
| Backend / API | FastAPI (public read + auth-gated admin) | — |
| Auth/admin scope | **Both** — public read-only site + editing/curation admin UI | — |
| Authentication | **FastAPI-native now** (fastapi-users or pyjwt+passlib, roles `viewer`/`admin`) → **self-hosted OIDC later** (Authentik / Zitadel / Logto), FastAPI validates via JWT/JWKS | — |
| OGC services | **GeoServer dropped**; pygeoapi / tipg only if required | pygeoapi 0.23.5 |
| Raster (optional) | TiTiler + COG (only if needed) | titiler 2.2.0 |
| Basemap | **Self-hosted OSM PMTiles** (Protomaps style), no API keys | — |
| Object storage | **MinIO self-hosted (default); Cloudflare R2 via env opt-in** | — |
| Edge / proxy | Caddy (auto-HTTPS, routing, compression, cache) | — |
| Prod hosting | **Single VPS + Docker Compose** | — |
| DB migrations | **dbmate** (plain `.sql` up/down, single Go binary, no JVM) | — |
| Background jobs | **Core (non-optional): Redis + worker** for validation, tiling, ingestion | — |
| Job engine | **Celery + Flower** (Python; Redis broker/result backend; Flower dashboard) | — |
| Internal GIS/QA tool | GeoLibre (reference + analyst tool, not in serving path) | geolibre 2.3.0 |

**Design rule that keeps it portable:** all object-storage access goes through the plain S3 API and reads `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_REGION` from env. Supplying R2 credentials switches provider with zero code change (and lets you skip the MinIO container).

> **Job engine (decided):** **Celery + Flower.** The job *work* (DuckDB validation, `tippecanoe` tiling, ingestion) is Python, so Celery keeps the worker in the same runtime and language as FastAPI and the ETL code — no extra language on the box. **Redis** is the broker and result backend (single dependency, already present); **Flower** provides the monitoring dashboard (queues, task history, retries, worker health). Add **Celery Beat** later if scheduled/periodic jobs are needed.

---

## 3. Reference architecture

```mermaid
flowchart TB
  User((Public browser)) --> Caddy
  Admin((Admin browser)) --> Caddy
  subgraph Edge
    Caddy[Caddy — TLS, routing, cache, rate limit]
  end
  subgraph App
    FE[MapLibre SPA — public site + admin UI]
    API[FastAPI — public read + auth-gated admin]
    Martin[Martin — dynamic vector tiles]
  end
  subgraph Async [Background jobs — core]
    Worker[Worker (Celery) — validate / curate / tile / ingest]
    Redis[(Redis)]
  end
  subgraph Data
    PG[(PostGIS: raw / curated / published + registry)]
    OBJ[(Object storage: MinIO default / R2 opt-in — PMTiles + GeoParquet lake + basemap)]
  end
  Caddy --> FE
  Caddy --> API
  Caddy --> Martin
  Caddy --> OBJ
  API --> PG
  API --> Redis
  Worker --> Redis
  Worker --> PG
  Worker --> OBJ
  Martin --> PG
  Martin --> OBJ
  FE -->|static layers + basemap| OBJ
```

**Traffic split (the key performance/cost decision):**
- **Static / semi-static layers** (national LandMark datasets, boundaries that rarely change) and the **basemap** → PMTiles in object storage, fetched directly by MapLibre. No DB hit at request time.
- **Dynamic / frequently-edited / query-filtered layers** → Martin from PostGIS.
- **Feature detail, search, metadata, admin actions** → FastAPI.

---

## 4. Data architecture

**Medallion separation**, enforced as PostGIS schemas *and* storage prefixes:

| Tier | PostGIS schema | Storage prefix | Purpose |
|---|---|---|---|
| Raw | `raw` | `raw/` | As-ingested, immutable GeoParquet. Never edited in place. |
| Curated | `curated` | `curated/` | Validated, cleaned, joined, CRS-normalized (DuckDB output). |
| Published | `published` | `tiles/` (PMTiles) | Web-ready layers — the only tier the frontend/Martin touch. |

**Dataset registry (catalog)** — a first-class table that makes both horizons work. Every layer is a registry row:

```
datasets(
  id, name, slug, description,
  source, license, attribution,
  sensitivity,            -- public | restricted | withheld
  crs, geometry_type, extent (bbox),
  tier_status,            -- raw | curated | published
  serve_mode,             -- pmtiles | martin
  schema_json,            -- attribute fields + types
  created_by, version, created_at, updated_at
)
```

**CRS discipline:**
- Store & interchange in **EPSG:4326**.
- Serve tiles in **EPSG:3857** (Martin/tippecanoe handle reprojection).
- Compute areas/statistics (e.g. hectares of community land) in an **equal-area** CRS — an appropriate UTM zone or Africa Albers. Never measure area in 4326/3857.

**Formats:** GeoParquet 1.1 for the lake; PMTiles for published vector layers; COG only if raster is added.

---

## 5. Data pipeline

The same pipeline serves engineer-driven loading (Horizon 1) and self-service uploads (Horizon 2):

1. **Ingest** raw GIS (Shapefile / GeoJSON / GPKG / GeoParquet / CSV+geom) → GeoParquet in `raw/`; create the dataset registry row.
2. **Validate & transform** in DuckDB: geometry validity (`ST_IsValid` / `ST_MakeValid`), CRS normalization, dedupe, attribute cleaning, joins to reference tables, derived features (areas, centroids, status flags) → `curated/`.
3. **Contract tests** on curated output (schema, CRS, geometry validity, null/range, row-count sanity) as a promotion gate.
4. **Load** curated → PostGIS `published` with spatial indexes (`GIST`) + `ANALYZE`.
5. **Build tiles**: stable layers → `tippecanoe` → PMTiles in object storage (per-zoom generalization); dynamic layers → served live by Martin.
6. **Publish**: flip registry `tier_status` to `published`; the layer becomes available to maps.

Steps 1–5 run as **background jobs** (worker via Redis) — engineer-triggered in Horizon 1, admin-upload-triggered in Horizon 2 — with progress surfaced in the UI.

---

## 6. Frontend & admin

### 6.1 Framework — Vite + React SPA

MapLibre GL JS is client-side (WebGL, needs the DOM), so SSR buys nothing, and FastAPI already owns the backend — Next.js's server tier would be redundant. The SPA builds to static files, is served by Caddy, and talks to FastAPI + Martin over HTTP. Fewer moving parts, faster dev loop. (The broader MapLibre/deck.gl ecosystem and GeoLibre are React; Angular is possible via `@maplibre/ngx-maplibre-gl` but forfeits that reuse.)

### 6.1a UI toolkit — Tailwind v4 + shadcn/ui

**Tailwind CSS v4 + shadcn/ui**, component-based. shadcn is not a runtime dependency: its CLI **vendors component source into the repo** (Radix UI primitives, accessible by default, Tailwind-styled), so the team owns and adapts the code — ideal for a hand-off/extensible platform. It works with Vite + React (not Next-only). Especially strong for the admin surface — Dialog, Form, Table, Slider, Select, Tabs cover the styling panel, dataset registry, upload dialogs, and Map-authoring forms; pair with `react-colorful` for the color picker. **Map-specific UI** (the MapLibre canvas, legends, layer toggles) is hand-built and sits alongside shadcn's chrome.

### 6.2 Public site (Horizon 1)

Landing page (mission/platform explainer); interactive map of community boundaries + country summaries; filters by country / layer type / status / theme; clickable polygons → popups + side panel; search; layer toggles; shareable URLs (map state in query params); responsive desktop/mobile.

### 6.3 Admin UI (auth-gated)

- **Live styling with draft → publish.** Styling is data: color/opacity/size are MapLibre Style-Spec paint/layout properties (`fill-color`, `fill-opacity`, `circle-radius`, `line-width`, …) edited live via `setPaintProperty` / `setLayoutProperty` — the GeoLibre editing feel, effectively free. Styles are stored server-side (`layer_styles`: `layer_id`, `status` draft|published, `style_json`, `updated_by`, `version`); the public map loads only **published**; "roll out" promotes draft → published. **Styling never requires re-tiling** — tiles carry geometry/attributes, style is applied client-side.
- **Endpoints:** `GET /api/styles/published` · `GET /api/admin/styles/draft` · `PUT /api/admin/layers/{id}/style` · `POST /api/admin/layers/{id}/publish`.
- **Phasing:** single-value styling first (one color/opacity/size per layer); data-driven styling (color ramp by attribute, e.g. tenure status) via style expressions next.

GeoLibre (MIT) is a legitimate reference implementation for the styling panel.

---

## 7. Migrations & configuration

- **dbmate** for schema migrations: plain `.sql` files with `-- migrate:up` / `-- migrate:down`, applied by a one-shot compose service or CI step before the API starts. No ORM required; matches raw-SQL-first practice. (Switch to Alembic only if SQLAlchemy is later adopted.)
- **Repeatable seeds** for reference data (country lists, theme/status lookups).
- **Env-based config** end to end (`.env`, never committed); the same compose file runs local → prod.

---

## 8. Repository structure

```
geo-platform/
├── docker-compose.yml            # prod-like base
├── docker-compose.override.yml   # local dev conveniences
├── .env.example
├── caddy/Caddyfile
├── db/
│   ├── migrations/               # dbmate .sql (up/down)
│   ├── seeds/
│   └── extensions.sql
├── etl/
│   ├── pipelines/                # DuckDB SQL / Python steps
│   ├── contracts/                # data contract tests
│   └── Makefile                  # make ingest | curate | publish
├── api/                          # FastAPI: public + admin + job triggers
│   ├── app/ (routers, auth, registry, styles)
│   ├── worker/                   # Celery tasks (validate / curate / tile / ingest) — core
│   └── tests/
├── tiles/
│   ├── martin/config.yaml
│   └── build/                    # tippecanoe recipes → PMTiles
├── web/                          # Vite + React SPA (Tailwind v4 + shadcn/ui)
│   ├── src/ (public map, filters, popups, panels, share-url, admin/)
│   ├── components/ui/            # shadcn components (vendored)
│   └── styles/
├── basemap/                      # OSM PMTiles build + Protomaps style
├── ops/
│   ├── prometheus/ grafana/
│   └── backup/                   # pg_dump + object-store sync
├── docs/                         # setup, data-loading, styling, deploy, ops, governance
└── .github/workflows/            # CI: lint, test, build, push, deploy
```

---

## 9. Docker Compose service map

| Service | Base | Role | Notes |
|---|---|---|---|
| `proxy` | Caddy | TLS, routing, compression, cache, rate limit | Auto-HTTPS; single entrypoint. |
| `db` | PostGIS | Canonical spatial DB | `pg_isready` healthcheck; named volume; tuned memory. |
| `migrate` | dbmate | Apply migrations then exit | Runs before `api`; `depends_on: db (healthy)`. |
| `martin` | Martin | Dynamic vector tiles | `depends_on: db (healthy)`. |
| `api` | FastAPI | Public read + auth-gated admin + job triggers | `/healthz`; env-configured. |
| `web` | nginx + built SPA | Public site + admin UI | Static build; cache headers. |
| `storage` *(default)* | MinIO | S3-compatible object store | S3-API only in code; set `S3_*` to R2 to skip this container. |
| `redis` | Redis | Celery broker + result backend + cache | Core service. |
| `worker` | Celery (Python) | Validate / curate / tile / ingest jobs | Core; `depends_on: db, redis`. Shares the `api` image/codebase. |
| `flower` | Flower | Celery monitoring dashboard | Behind auth at the proxy; `depends_on: redis`. |
| `ogc` *(opt)* | pygeoapi / tipg | OGC API — Features/Tiles | Only if OGC required. |
| `titiler` *(opt)* | TiTiler | Raster/COG tiles | Only if raster needed. |
| `prometheus` / `grafana` *(opt)* | — | Observability | Scrape API/Martin/PG exporters. |

**Startup ordering** via `depends_on: { condition: service_healthy }` + real healthchecks — never `sleep`.

---

## 10. Security & production defaults

- Single VPS: only `proxy` exposes ports (80/443); everything else stays on the internal Docker network. **PostGIS 5432 never public.**
- Secrets via env / secret store; distinct DB roles — read-only for Martin/tile and public API paths; least privilege for admin.
- **Auth (locked path):** *now* — FastAPI-native (fastapi-users, or pyjwt + passlib), JWT for admin routes, roles `viewer` (public/implicit) and `admin`, secure session/refresh; *later* — if self-service grows to many curators/orgs and needs SSO/social/org management, front it with a **self-hosted OIDC provider (Authentik / Zitadel / Logto)** that FastAPI validates via standard **JWT/JWKS**. Authorization is **always enforced server-side in FastAPI**; the SPA only holds the token — it never decides who can publish or upload.
- TLS everywhere (Caddy auto-HTTPS + HSTS); locked CORS; rate limiting + request-size limits at the proxy.
- Upload hardening (H2): type/size validation, sandboxed processing, no execution of uploaded content.
- Backups: automated `pg_dump` + object-store versioning; **tested restores**. Pin image digests; scan images (Trivy) in CI.
- Structured JSON logging, error tracking (Sentry), no PII in logs.

---

## 11. Testing & QA

- **Database/data:** pgTAP for DB assertions; data-contract tests on curated GeoParquet as a promotion gate.
- **API:** pytest + httpx — endpoint contracts, filters, spatial queries, auth, publish workflow.
- **Frontend:** Playwright — map loads, filters apply, popups/panels, share-URL round-trip, admin styling save/publish, mobile viewport.
- **Pipeline:** golden-file tests on a small fixture dataset so ETL changes are diffable.
- **CI:** lint (ruff/eslint) → unit → integration (minimal compose up) → build images → deploy on tag.

---

## 12. Observability

Proportionate to a single VPS: Prometheus scraping API/Martin/Postgres exporters, Grafana dashboards (tile latency, DB health, job queue depth), Sentry for errors, structured logs. Add only what you'll actually watch.

---

## 13. Data governance & "do no harm" (land-rights specific)

Non-optional for community/Indigenous land data:

- **Sensitivity classification per dataset** (`public` / `restricted` / `withheld`), enforced in the registry and honored by publishing. Some boundaries should be generalized, buffered, or withheld to avoid enabling land grabs or targeting.
- **Provenance & consent metadata** on every dataset: source, custodian, license, attribution, consent basis, method, date.
- **Licensing surfaced in the UI** and in dataset metadata.
- **Precision control** — publish generalized geometries where fine precision creates risk.
- **Audit trail** for who published/changed what (critical once Horizon 2 opens uploads to more users).

---

## 14. GeoLibre — internal tool & reference

GeoLibre (opengeos / Qiusheng Wu; MIT; Tauri v2 + React + TypeScript + MapLibre + DuckDB-WASM Spatial + deck.gl; browser/desktop/Android/Jupyter) is a **local-first analysis & authoring GIS** — not a server-side publishing platform, so it does **not** replace this stack. Use it as (1) an internal exploration/QA tool for the data team (same DuckDB Spatial engine as our ETL), and (2) a reference implementation for the MapLibre client and styling panel. Keep it out of the production serving path; no hard dependency.

---

## 15. Horizon 1 — LandMark replication

**Target content** (LandMark, run by World Resources Institute and partners — the global platform of Indigenous & community lands):

- **Indigenous & community lands** — acknowledged by governments (polygons), and held/used but not formally acknowledged.
- **National indicators** — e.g. percent of a country held/used by Indigenous peoples & communities.
- **Legal-security indicators** — national-level tenure security scoring.
- **Country profiles / summaries** — per-country roll-ups shown on click and on country pages.

**Delivery approach for these:**
- Most LandMark content is **national and semi-static** → publish as **PMTiles** (cheap, fast, no DB at request time). National indicators/summaries → PostGIS tables surfaced via FastAPI for popups/country pages.
- **Data acquisition is a defined task, not automatic.** LandMark data is distributed through its own WRI-run portal under specific **terms, licensing, and attribution** (and its own do-no-harm posture). Confirm the current license and required attribution before ingesting, mirror the "restricted/withheld" treatment where LandMark itself withholds precise boundaries, and record all of this in the dataset registry (§4) and surface it in the UI (§13).

> Open item to confirm at build start: exact current LandMark data endpoints/downloads and license terms. (Enable web search and I can pin these down precisely.)

---

## 16. Horizon 2 — self-service data & maps

Turns the platform into a product. Built on the same registry + pipeline + styling engine.

**Upload → publish (self-service):**
1. Admin/curator uploads a file (Shapefile zip / GeoJSON / GPKG / GeoParquet / CSV+geom).
2. Server stores it in `raw/`, creates a draft registry row, and enqueues a validation job (worker via Redis).
3. Worker validates + curates in DuckDB, returns a **preview + report** (geometry validity, CRS, field types, row counts, a sample map).
4. Curator reviews, sets sensitivity/license/attribution, and approves.
5. Worker loads to `published` and builds tiles (PMTiles or assigns Martin).
6. Layer becomes available to maps.

**Map authoring (create new maps easily):**
- A **Map** (project) is config, not code: a named collection of layers + per-layer published style + default extent + basemap + filter/legend config.
- Authoring UI: pick layers from the registry, style them live (§6.3), set extent/filters/legend, preview, **publish** → the map gets a public route/slug and shareable URL.
- Because a Map is just stored config over registry layers, "create a new map" needs no engineering — exactly the GeoLibre-like ease you want, but server-published and governed.

```
maps(
  id, name, slug, description,
  layers_json,     -- ordered [{dataset_id, style_ref, visible, ...}]
  basemap, default_extent, filters_json, legend_json,
  status,          -- draft | published
  created_by, version, created_at, updated_at
)
```

---

## 17. Phased roadmap

**Phase 0 — Vertical slice.** One dataset end-to-end: ingest → DuckDB curate → PostGIS `published` → **both** a Martin dynamic layer and a tippecanoe→PMTiles static layer → Vite+React MapLibre map with click-popup → minimal FastAPI `/features/{id}` → dbmate migration → Caddy + compose on the VPS. Proves every tier and the static/dynamic split.

**Phase 1 — Replicate LandMark (public site).** Ingest all available LandMark data (§15) via the **Redis + worker** job pipeline (core from here on); filters (country/layer/status/theme), side panel, search, layer toggles, shareable URLs, responsive layout; self-hosted OSM PMTiles basemap; country summaries; governance metadata surfaced. Frontend on Tailwind v4 + shadcn/ui.

**Phase 2 — Scale & operations.** R2 option validated, CDN in front of tiles, medallion schemas enforced, dbmate migrations + seeds, backups + tested restores, observability, CI/CD to the VPS.

**Phase 3 — Admin & governance.** FastAPI-native auth (roles `viewer`/`admin`), admin styling (draft → publish), sensitivity/consent workflow, audit trail, dataset registry UI — all on shadcn/ui.

**Phase 4 — Self-service (Horizon 2).** Upload → validate → curate → publish flow with previews (on the existing worker), and the Map authoring UI. Optional: graduate auth to self-hosted OIDC (Authentik/Zitadel/Logto) if SSO/org management is needed; OGC (pygeoapi/tipg) or raster (TiTiler/COG) if a requirement appears.

**Phase 5 — Reusability.** Extract the stack into a templated starter (cookiecutter/`degit`) so a new deployment stands up in hours.

---

## 18. Deliverables

- Working, prod-like Docker Compose stack on a single VPS (edge, db, migrate, tiles, api, web, storage, redis, worker; optional OGC/raster/observability).
- Reusable, templated project structure.
- Example dataset pipeline (ingest → DuckDB → PostGIS → PMTiles + Martin) run through the Redis + worker job queue, with contract tests.
- LandMark-style public site (Vite + React, Tailwind v4 + shadcn/ui): map, styles, popups, filters, layer controls, search, shareable URLs, responsive, country summaries.
- Admin UI: FastAPI-native auth; live styling with draft → publish; dataset registry; (H2) upload→publish flow and Map authoring.
- Self-hosted OSM PMTiles basemap.
- dbmate migrations + repeatable seeds; health checks + startup ordering.
- Test suites (pgTAP, pytest, Playwright) in CI/CD.
- Security defaults + backup/restore runbook.
- Data governance metadata model + sensitivity workflow.
- Docs: setup, data loading, styling, deployment, operations, governance.

---

*Plan of record for review. Versions verified via npm/PyPI/GitHub on 2026-07-27; LandMark data endpoints/license to be confirmed at build start. Re-check upstream release notes before locking versions in code.*
