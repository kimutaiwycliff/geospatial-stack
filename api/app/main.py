"""FastAPI app -- Phase 0 vertical slice (brief §17: minimal FastAPI
`/features/{id}` is the only API surface this phase needs).

Route paths deliberately do NOT carry an /api prefix. caddy/Caddyfile proxies
public traffic with `handle_path /api/*` { reverse_proxy api:8000 }` --
`handle_path` (unlike plain `handle`) strips the matched /api prefix before
forwarding, so Caddy itself only ever sends this app a path like
`/features/1`. Concretely, both of these reach the exact same route below:
  - production/public:        http://<host>/api/features/1        (via Caddy)
  - direct-to-container (dev): http://localhost:8000/features/1    (bypasses Caddy)
There is no second "/api/..."-prefixed route to define or keep in sync --
adding one would double-handle the path and break the Caddy-proxied case.
"""
import json
import os

import sentry_sdk
from app.db import get_connection
from app.routers import auth as auth_router
from app.routers import governance as governance_router
from app.routers import maps as maps_router
from app.routers import uploads as uploads_router
from app.styles import router as styles_router
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

# Sentry (brief §12). No Sentry project exists yet for this client -- init
# with an empty/missing DSN is a documented no-op in sentry-sdk (it skips
# transport setup entirely), so this must NOT be gated behind an `if DSN:`
# check that could rot: calling init() unconditionally is what guarantees
# error reporting turns on the moment a real DSN lands in .env, with zero
# code change. traces_sample_rate=0 keeps this errors-only for now --
# performance tracing is a separate, paid-for decision the client hasn't
# made.
sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN", ""),
    traces_sample_rate=0,
)

app = FastAPI(title="geoplatform-api")

# Per-route request count/latency histograms at /metrics (brief §12: "tile
# latency, DB health, job queue depth" -- this is the API-side slice of
# that; Martin and postgres-exporter cover the other two). `.instrument()`
# must run before `.expose()` and before the app starts serving, which is
# why this sits at import time rather than inside a startup event.
Instrumentator().instrument(app).expose(app)

# The Vite dev server runs on its own port and needs to call this API
# directly (bypassing Caddy) during local development -- CORS has to allow
# that origin explicitly. API_CORS_ORIGINS is a single origin today
# (.env.example: http://localhost:8080), but split on "," defensively so a
# future comma-separated list of origins doesn't require touching this file.
_cors_origins = [
    origin.strip()
    for origin in os.environ.get("API_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # Phase 1 was read-only (GET everywhere). Phase 3's admin surface
    # (auth/styles/governance routers below) needs PUT/POST from the same
    # dev origins, and OPTIONS for the browser's own CORS preflight on those
    # -- HEAD costs nothing extra to allow alongside GET.
    allow_methods=["GET", "HEAD", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

# Phase 3 routers (brief §10/§6.3/§13): auth (login only, no signup),
# styling draft/publish, and governance metadata editing + audit log. Each
# lives in its own module (app/routers/, app/styles/) rather than growing
# this file, since every one of them owns its own admin-gating concerns.
app.include_router(auth_router.router)
app.include_router(styles_router.router)
app.include_router(governance_router.router)
# Phase 4 routers (brief §16): self-service upload/validate/approve/publish,
# and Map authoring config CRUD + public read.
app.include_router(uploads_router.router)
app.include_router(maps_router.router)


@app.get("/healthz")
def healthz():
    # Deliberately does NOT touch Postgres. This is the target the
    # docker-compose.yml `api` healthcheck curls to decide container health,
    # and its job is to prove the uvicorn process itself is up -- whether
    # Postgres is reachable is already covered by `db`'s own pg_isready
    # healthcheck plus `api`'s `depends_on: db: condition: service_healthy`.
    # Coupling this endpoint to a DB round-trip would make the api container
    # flap unhealthy (and get restarted) any time Postgres has a hiccup,
    # which defeats the healthcheck's actual purpose.
    return {"status": "ok"}


@app.get("/features/{dataset_slug}/{feature_id}")
def get_feature(dataset_slug: str, feature_id: str):
    """Single-row lookup from published.<dataset_slug's table>, by either
    the numeric `id` or the `name` column.

    Phase 0 hardcoded the one fixture table; Phase 1 has multiple published
    geometry datasets (Kenya fixture, LandMark Indicative Areas, ...), so
    the frontend now has to say which one it clicked into. `dataset_slug`
    is looked up against registry.datasets FIRST, before it's ever used to
    build a table name -- the registry lookup is what makes it safe to
    interpolate: only slugs our own ingestion tasks actually wrote can ever
    reach the f-string, a 404 on an unknown slug happens before that point.

    `id::text = key OR name = key`: MapView.tsx's click handler looks up by
    `id` when the clicked tile came from Martin (its properties carry the
    BIGSERIAL PK), but falls back to `name` for the PMTiles path, whose
    tiles are built from `curated/` GeoParquet -- which never had an `id`
    column, since that's only assigned once a row lands in PostGIS. Every
    published.<table> has both `id` and `name` (see worker/tasks.py's
    load_postgis_task and DATASET_META), so this generalizes across all of
    them without per-dataset column lists.
    """
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "SELECT geometry_type FROM registry.datasets WHERE slug = %s AND tier_status = 'published'",
                (dataset_slug,),
            )
            dataset = cur.fetchone()
            if dataset is None or dataset["geometry_type"] is None:
                raise HTTPException(status_code=404, detail="dataset not found or has no geometry")

            table = dataset_slug.replace("-", "_")
            cur.execute(
                f'SELECT * FROM published."{table}" WHERE (id::text = %(key)s) OR (name = %(key)s)',
                {"key": feature_id},
            )
            row = cur.fetchone()
    finally:
        # Connection-per-request (see app/db.py) -- always close explicitly,
        # there's no pool to return it to.
        conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="feature not found")

    # `geom` comes back as WKB hex text (psycopg2 has no native geometry
    # binding) -- not useful to a frontend that already has the tile's own
    # rendered shape; ST_AsGeoJSON would need a second round trip, so this
    # endpoint's job (attribute popup content) just drops it instead.
    row.pop("geom", None)
    return row


@app.get("/datasets")
def list_datasets():
    """Registry rows for the frontend's layer picker + governance badges
    (brief §13: "licensing surfaced in the UI", §17 layer toggles). This is
    the ONLY place the public site should ever learn what layers/datasets
    exist and their license/attribution/sensitivity -- it must never
    hardcode a dataset list, since Horizon 2 (brief §16) adds datasets at
    runtime via curator upload, not a code deploy.

    Only `published` rows: raw/curated-only datasets aren't servable yet
    (brief §4/§5's promotion gate), so they shouldn't appear as a pickable
    layer just because a row exists.
    """
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT slug, name, description, source, license, attribution,
                       sensitivity, geometry_type, serve_mode,
                       ST_AsGeoJSON(extent) AS extent
                FROM registry.datasets
                WHERE tier_status = 'published'
                ORDER BY name
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    for row in rows:
        if row["extent"] is not None:
            row["extent"] = json.loads(row["extent"])
    return rows


@app.get("/countries")
def list_countries():
    """brief §1.4: country summary list for a country-picker/index page --
    the joined view (worker/tabular_tasks.py's build_country_summary_view_task)
    does the cross-dataset join once, at ingest time, so this is a plain read."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM published.country_summary ORDER BY pop_country")
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows


@app.get("/countries/{iso_code}")
def get_country(iso_code: str):
    """brief §1.4: single country's summary for a country page/popup."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM published.country_summary WHERE iso_code = %s", (iso_code.upper(),))
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="country not found")
    return row
