"""Celery tasks: validate / curate / tile / ingest (brief §1.2, §5).

Each pipeline step from the Phase-0 scripts (etl/pipelines/*.py,
tiles/build/build_pmtiles.py) becomes one task here, plus `run_pipeline`
that chains all of them for one dataset with progress state after each
step. Phase 0's SQL logic carries over largely unchanged; Phase 1 added
three things real LandMark data needed that the disposable Kenya fixture
never exercised: CRS reprojection (LandMark ships EPSG:3857, not 4326),
bulk INSERT (the fixture was 8 rows; real datasets are 17K-330K), and a
dataset-agnostic attribute-cleanup step (the fixture hardcoded trimming
`name`/`type` columns that don't exist in every schema).

Usage (engineer-triggered, Phase 1): from a shell in the worker container,
or via `celery_app.send_task(...)` from anywhere that can reach Redis --
there's no HTTP trigger endpoint yet (brief §16 adds one, gated by curator
auth, once Horizon 2's upload flow exists).
"""
import json
import subprocess
import tempfile

from celery import chain
from psycopg2.extras import execute_values

from worker.celery_app import celery_app
from worker.common import ensure_bucket, get_duckdb_conn, get_pg_conn, s3_uri, upload_file

# Hand-written per dataset for Phase 0/1 -- Phase 4's upload flow (brief §16)
# collects this same information from the curator through a form instead of
# a code entry, but the registry row it produces looks identical.
#
# `sensitivity: "public"` for the two real LandMark datasets below is a
# deliberate choice, not a default: LandMark's own site already publishes
# this exact data under CC BY-SA 4.0, and replicating their public map is
# Horizon 1's explicit goal (brief §1/§15) -- whatever precision/withholding
# decision LandMark made is already baked into what they released to us, so
# this build isn't adding any exposure LandMark itself didn't already choose.
# `serve_mode` records which tile path each dataset is meant to use once
# published (brief §3 traffic split) -- both still load into PostGIS
# regardless, since FastAPI's feature-detail endpoint always queries
# Postgres directly, independent of how the *tiles* get served.
DATASET_META = {
    "kenya-admin1-provinces": {
        "name": "Kenya Admin-1 Provinces (stand-in fixture)",
        "description": (
            "Disposable Phase-0 fixture used to prove the ingest -> curate -> "
            "publish -> tile pipeline end-to-end. Not LandMark data."
        ),
        "source": "Natural Earth 1:10m Admin-1 States/Provinces (ne_10m_admin_1_states_provinces)",
        "license": "Public domain -- no attribution required (naturalearthdata.com/about/terms-of-use)",
        "attribution": "Natural Earth",
        "sensitivity": "public",
        "serve_mode": "martin",
        "dedup_key": "name",
    },
    "landmark-indicative-areas": {
        "name": "Indicative Areas of Indigenous and Community Land Rights",
        "description": (
            "Areas indicatively held or used by Indigenous Peoples and local "
            "communities, but not yet formally documented/acknowledged -- one "
            "of LandMark's six core datasets (brief §15)."
        ),
        "source": "LandMark: The Global Platform of Indigenous and Community Lands (landmarkmap.org)",
        "license": "CC BY-SA 4.0, subject to LandMark's Terms of Service",
        "attribution": "LandMark: The Global Platform of Indigenous and Community Lands",
        "sensitivity": "public",
        "serve_mode": "pmtiles",
        "dedup_key": None,  # OGC_FID is already a unique per-row source id
    },
    "landmark-indigenous-community-lands": {
        "name": "Indigenous Peoples' and Local Community Lands and Territories",
        "description": (
            "Community-level lands and territories acknowledged by governments "
            "(and some not formally acknowledged) -- LandMark's flagship dataset "
            "(brief §15), global coverage."
        ),
        "source": "LandMark: The Global Platform of Indigenous and Community Lands (landmarkmap.org)",
        "license": "CC BY-SA 4.0, subject to LandMark's Terms of Service",
        "attribution": "LandMark: The Global Platform of Indigenous and Community Lands",
        "sensitivity": "public",
        "serve_mode": "pmtiles",
        "dedup_key": None,
    },
}


def _geometry_type(con, table: str = "src") -> str:
    types = [r[0] for r in con.execute(f"SELECT DISTINCT ST_GeometryType(geom) FROM {table}").fetchall()]
    return types[0] if len(types) == 1 else "GEOMETRY"


def _source_srid(con, table: str = "src") -> str:
    """DuckDB spatial reports a geometry column's type as e.g.
    "GEOMETRY('EPSG:3857')" when the source .prj declares a CRS, or a bare
    "GEOMETRY" when it doesn't. LandMark ships EPSG:3857; the Phase-0 Kenya
    fixture happened to already be EPSG:4326 -- detecting this rather than
    assuming 4326 (Phase 0's behavior) is what makes real data reproject
    correctly instead of silently mislabeling projected meters as degrees.
    """
    type_str = next(c[2] for c in con.execute(f"PRAGMA table_info('{table}')").fetchall() if c[1] == "geom")
    if "EPSG:" in type_str:
        return type_str.split("EPSG:")[1].rstrip("')")
    return "4326"


def _bbox_wkt(con, table: str = "src", srid: str = "4326") -> str:
    # always_xy := true is load-bearing, not cosmetic: EPSG:4326 is
    # officially defined with (latitude, longitude) axis order, and PROJ
    # honors that "authority compliant" order by default when the target
    # CRS is referenced by EPSG code -- silently swapping X/Y relative to
    # the (lon, lat) convention GeoJSON/MapLibre/every other consumer here
    # expects. Caught only because the swap pushed 230 of 17,544 real
    # LandMark rows outside [-180,180]x[-90,90] (large longitudes landing
    # in the latitude slot); without always_xy every row would still be
    # silently transposed, just not always far enough to trip that check.
    xmin, ymin, xmax, ymax = con.execute(
        f"SELECT MIN(ST_XMin(g)), MIN(ST_YMin(g)), MAX(ST_XMax(g)), MAX(ST_YMax(g)) "
        f"FROM (SELECT ST_Transform(geom, 'EPSG:{srid}', 'EPSG:4326', always_xy := true) AS g FROM {table}) t"
    ).fetchone()
    return f"POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, {xmin} {ymax}, {xmin} {ymin}))"


def _schema_json(con, table: str = "src") -> dict:
    cols = con.execute(f"PRAGMA table_info('{table}')").fetchall()
    return {row[1]: row[2] for row in cols if row[1] != "geom"}


def _table_name(slug: str) -> str:
    # psycopg2 identifiers can't safely take a hyphenated slug -- the
    # registry slug stays URL-friendly (hyphens) while the table name it
    # maps to is a plain SQL identifier (underscores).
    return slug.replace("-", "_")


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def ingest_task(self, source_path: str, slug: str):
    """Step 1: source file -> immutable GeoParquet in raw/, registry row
    created with tier_status=raw (brief §4 "registry-first"). Raw stays in
    the source CRS as-ingested (medallion "immutable, as-ingested" -- CRS
    normalization is curate_task's job, brief §5 step 2); the registry's
    `extent` bbox is still computed in true EPSG:4326 degrees, since that
    column is documented as always-4326 regardless of tier."""
    meta = DATASET_META[slug]
    ensure_bucket()
    con = get_duckdb_conn()

    con.execute(f"CREATE TABLE src AS SELECT * FROM ST_Read('{source_path}')")
    geom_col = next(c[1] for c in con.execute("PRAGMA table_info('src')").fetchall() if c[2].startswith("GEOMETRY"))
    if geom_col != "geom":
        con.execute(f'ALTER TABLE src RENAME COLUMN "{geom_col}" TO geom')

    srid = _source_srid(con, "src")
    con.execute("ALTER TABLE src ADD COLUMN bbox STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)")
    con.execute(
        "UPDATE src SET bbox = {'xmin': ST_XMin(geom), 'ymin': ST_YMin(geom), "
        "'xmax': ST_XMax(geom), 'ymax': ST_YMax(geom)}"
    )

    row_count = con.execute("SELECT COUNT(*) FROM src").fetchone()[0]
    gtype = _geometry_type(con, "src")
    schema = _schema_json(con, "src")
    bbox = _bbox_wkt(con, "src", srid)

    dest = s3_uri(f"raw/{slug}.parquet")
    con.execute(f"COPY (SELECT * FROM src) TO '{dest}' (FORMAT PARQUET)")

    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO registry.datasets
                (name, slug, description, source, license, attribution,
                 sensitivity, crs, geometry_type, extent, tier_status, schema_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'EPSG:4326', %s,
                    ST_SetSRID(ST_GeomFromText(%s), 4326), 'raw', %s)
            ON CONFLICT (slug) DO UPDATE SET
                tier_status = 'raw',
                geometry_type = EXCLUDED.geometry_type,
                extent = EXCLUDED.extent,
                schema_json = EXCLUDED.schema_json
            """,
            (
                meta["name"], slug, meta["description"], meta["source"],
                meta["license"], meta["attribution"], meta["sensitivity"],
                gtype, bbox, json.dumps(schema),
            ),
        )
    pg.close()
    return {"slug": slug, "step": "ingest", "rows": row_count, "source_srid": srid, "dest": dest}


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def curate_task(self, prev_result, slug: str):
    """Step 2: raw -> validated/cleaned GeoParquet in curated/ -- CRS
    reprojection to EPSG:4326 (brief §4 CRS discipline), ST_IsValid/
    ST_MakeValid, optional dedup, attribute cleanup, dest tier_status=curated.
    `prev_result` is unused -- accepted so this task can sit directly in a
    Celery `chain()` after ingest_task."""
    meta = DATASET_META[slug]
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE raw_tbl AS SELECT * FROM read_parquet('{s3_uri(f'raw/{slug}.parquet')}')")
    before = con.execute("SELECT COUNT(*) FROM raw_tbl").fetchone()[0]

    srid = _source_srid(con, "raw_tbl")
    # always_xy := true -- see _bbox_wkt's comment; without it this silently
    # produces (lat, lon)-ordered geometry instead of the (lon, lat) every
    # downstream consumer (PostGIS, MapLibre, GeoJSON) assumes.
    # ST_Force2D -- some LandMark source polygons carry a (meaningless,
    # usually 0) Z coordinate; published.<table>'s geom column is declared
    # 2D-only (geometry(Geometry, 4326)), which PostGIS enforces at INSERT
    # time -- ST_GeomFromWKB on a Z-having WKB throws "Geometry has Z
    # dimension but column does not" rather than silently truncating it.
    con.execute(
        f"CREATE TABLE reprojected AS "
        f"SELECT * REPLACE (ST_Force2D(ST_Transform(geom, 'EPSG:{srid}', 'EPSG:4326', always_xy := true)) AS geom) FROM raw_tbl"
    )
    # Drop each intermediate table as soon as the next one is built from it --
    # without this, raw_tbl/reprojected/curated_tbl/curated_deduped all
    # coexist at once, multiplying peak memory ~4x for no reason. This alone
    # was the difference between LandMark's 327K-row community-lands layer
    # OOM-killing the container (signal 9, twice) and completing.
    con.execute("DROP TABLE raw_tbl")

    invalid_before = con.execute("SELECT COUNT(*) FROM reprojected WHERE NOT ST_IsValid(geom)").fetchone()[0]
    # bbox is recomputed here (not carried over from ingest) because it must
    # reflect the geometry AFTER reprojection -- the raw-tier bbox struct is
    # in the source CRS and would be wrong once geom is in degrees.
    con.execute(
        "CREATE TABLE curated_tbl AS "
        "SELECT * REPLACE ("
        "  (CASE WHEN ST_IsValid(geom) THEN geom ELSE ST_MakeValid(geom) END) AS geom, "
        "  {'xmin': ST_XMin(geom), 'ymin': ST_YMin(geom), 'xmax': ST_XMax(geom), 'ymax': ST_YMax(geom)} AS bbox"
        ") FROM reprojected"
    )
    con.execute("DROP TABLE reprojected")

    # Dedup is per-dataset, not universal: the Phase-0 fixture used `name`
    # to prove the step works, but blindly deduping real LandMark data by
    # `name` would silently drop distinct territories that happen to share
    # a common name -- OGC_FID is already a unique per-row id from the
    # source shapefile, so real datasets skip this step entirely
    # (dedup_key=None in DATASET_META). Skipping it also means NOT paying
    # for a full extra copy of curated_tbl just to end up with an identical
    # curated_deduped -- final_table just points at curated_tbl directly.
    dedup_key = meta.get("dedup_key")
    if dedup_key:
        con.execute(
            f"CREATE TABLE curated_deduped AS SELECT * FROM curated_tbl "
            f'QUALIFY ROW_NUMBER() OVER (PARTITION BY "{dedup_key}" ORDER BY "{dedup_key}") = 1'
        )
        con.execute("DROP TABLE curated_tbl")
        final_table = "curated_deduped"
    else:
        final_table = "curated_tbl"
    con.execute(f"DELETE FROM {final_table} WHERE geom IS NULL OR ST_IsEmpty(geom)")

    # Attribute cleanup: trim every VARCHAR column, whatever the dataset's
    # actual schema is -- Phase 0 hardcoded `name`/`type` specifically,
    # which would KeyError-equivalent crash on LandMark's schema (no `type`
    # column at all; the closest analog is `category`).
    varchar_cols = [row[1] for row in con.execute(f"PRAGMA table_info('{final_table}')").fetchall() if row[2] == "VARCHAR"]
    if varchar_cols:
        set_clause = ", ".join(f'"{c}" = TRIM("{c}")' for c in varchar_cols)
        con.execute(f"UPDATE {final_table} SET {set_clause}")

    after = con.execute(f"SELECT COUNT(*) FROM {final_table}").fetchone()[0]
    dest = s3_uri(f"curated/{slug}.parquet")
    con.execute(f"COPY (SELECT * FROM {final_table}) TO '{dest}' (FORMAT PARQUET)")

    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        cur.execute("UPDATE registry.datasets SET tier_status = 'curated' WHERE slug = %s", (slug,))
    pg.close()
    return {"slug": slug, "step": "curate", "before": before, "after": after, "invalid_repaired": invalid_before, "source_srid": srid}


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def contract_test_task(self, prev_result, slug: str):
    """Step 3: contract gate on curated output -- schema, validity, WGS84
    range, row-count sanity (brief §5 step 3). Raising here is the gate:
    Celery marks the task (and therefore the chain) FAILURE, so
    load_to_postgis never runs against unvalidated data."""
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{slug}.parquet')}')")

    cols = {row[1] for row in con.execute("PRAGMA table_info('curated_tbl')").fetchall()}
    required = {"geom", "bbox"}
    missing = required - cols
    if missing:
        raise ValueError(f"curated dataset is missing required columns: {missing}")

    bad = con.execute("SELECT COUNT(*) FROM curated_tbl WHERE geom IS NULL OR ST_IsEmpty(geom)").fetchone()[0]
    if bad:
        raise ValueError(f"{bad} rows have null/empty geometry")

    invalid = con.execute("SELECT COUNT(*) FROM curated_tbl WHERE NOT ST_IsValid(geom)").fetchone()[0]
    if invalid:
        raise ValueError(f"{invalid} rows still fail ST_IsValid after curation")

    out_of_range = con.execute(
        "SELECT COUNT(*) FROM curated_tbl WHERE ST_XMin(geom) < -180 OR ST_XMax(geom) > 180 "
        "OR ST_YMin(geom) < -90 OR ST_YMax(geom) > 90"
    ).fetchone()[0]
    if out_of_range:
        raise ValueError(f"{out_of_range} rows have coordinates outside WGS84 bounds")

    count = con.execute("SELECT COUNT(*) FROM curated_tbl").fetchone()[0]
    # Wide but real bound -- catches a truncated/empty source or an exploded
    # join without hardcoding an exact expected count per dataset. Raised
    # from Phase 0's 500 to cover LandMark's largest layer (~330K rows).
    if not (1 <= count <= 2_000_000):
        raise ValueError(f"row count {count} is outside the sane range for a promotable dataset")

    return {"slug": slug, "step": "contract_test", "row_count": count, "passed": True}


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def load_postgis_task(self, prev_result, slug: str):
    """Step 4: curated -> published.<table> with a spatial index + ANALYZE,
    registry flips to tier_status=published, serve_mode from DATASET_META.

    Overrides celery_app's global 600s/900s limits: the Kenya fixture's 8
    rows finish in seconds, but LandMark's community-lands layer is ~330K
    rows -- the global default is tuned for the common case, not the
    largest one, so the tasks whose runtime actually scales with row count
    (this one, build_pmtiles_task) get their own generous ceiling instead
    of a blanket increase that would mask a genuinely hung ingest/curate/
    contract-test task."""
    meta = DATASET_META[slug]
    table = _table_name(slug)
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{slug}.parquet')}')")

    cols = [row[1] for row in con.execute("PRAGMA table_info('curated_tbl')").fetchall() if row[1] not in ("geom", "bbox")]
    has_latlon = "latitude" in cols and "longitude" in cols
    text_cols = [c for c in cols if c not in ("latitude", "longitude")]

    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        # Idempotent re-run: drop/recreate is fine while this table has no
        # dependents; a real re-publish would swap tables atomically instead.
        cur.execute(f'DROP TABLE IF EXISTS published."{table}"')
        col_lines = [f'"{c}" TEXT' for c in text_cols]
        if has_latlon:
            col_lines += ["latitude DOUBLE PRECISION", "longitude DOUBLE PRECISION"]
        col_defs = ",\n                ".join(col_lines)
        cur.execute(
            f"""
            CREATE TABLE published."{table}" (
                id BIGSERIAL PRIMARY KEY,
                {col_defs},
                geom geometry(Geometry, 4326) NOT NULL
            )
            """
        )

        col_list = ", ".join(f'"{c}"' for c in cols)
        attr_placeholders = ", ".join(["%s"] * len(cols))
        insert_sql = f'INSERT INTO published."{table}" ({col_list}, geom) VALUES %s'
        template = f"({attr_placeholders}, ST_SetSRID(ST_GeomFromWKB(%s), 4326))"

        # Bulk insert via execute_values, not a Python for-loop of single
        # cur.execute() calls (Phase 0's approach, fine for an 8-row
        # fixture) -- one round-trip per row is impractically slow once
        # real LandMark datasets (tens to hundreds of thousands of rows)
        # started flowing through this task. page_size batches many rows
        # per round-trip.
        rows = con.execute(f"SELECT {', '.join(f'\"{c}\"' for c in cols)}, ST_AsWKB(geom) FROM curated_tbl").fetchall()
        values = [(*r[:-1], bytes(r[-1])) for r in rows]
        execute_values(cur, insert_sql, values, template=template, page_size=2000)

        cur.execute(f'CREATE INDEX "{table}_geom_gix" ON published."{table}" USING GIST (geom)')
        cur.execute(f'ANALYZE published."{table}"')
        cur.execute(
            "UPDATE registry.datasets SET tier_status = 'published', serve_mode = %s WHERE slug = %s",
            (meta.get("serve_mode", "martin"), slug),
        )
    pg.close()
    return {"slug": slug, "step": "load_postgis", "rows": len(values), "table": table}


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def build_pmtiles_task(self, prev_result, slug: str):
    """Step 5 (static path): curated GeoParquet -> tippecanoe -> PMTiles ->
    uploaded to object storage, publicly readable (brief §0.10/§5 step 5).

    Writes the intermediate GeoJSON via DuckDB spatial's native GDAL writer
    (`COPY ... TO 'x.geojson' WITH (FORMAT GDAL, DRIVER 'GeoJSON')`) instead
    of Phase 0's approach (aggregating the whole FeatureCollection into one
    in-memory JSON string via json_group_array) -- that approach means one
    DuckDB value holding gigabytes of text for a 330K-feature dataset; the
    GDAL writer streams straight to disk.

    Generous time limit override (see load_postgis_task's comment): a
    17.5K-feature layer with lots of dense small polygons at low zoom made
    tippecanoe retry several "keep the sparsest N%" passes and blew the
    global 600s soft limit despite making real progress the whole time --
    not a hang, just legitimately slow for -zg's auto zoom selection on
    this kind of geometry."""
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{slug}.parquet')}')")
    attr_cols = [
        row[1] for row in con.execute("PRAGMA table_info('curated_tbl')").fetchall()
        if row[1] not in ("geom", "bbox")
    ]
    select_cols = ", ".join(f'"{c}"' for c in attr_cols)

    with tempfile.TemporaryDirectory() as tmp:
        geojson_path = f"{tmp}/{slug}.geojson"
        pmtiles_path = f"{tmp}/{slug}.pmtiles"
        con.execute(
            f"COPY (SELECT {select_cols}, geom FROM curated_tbl) TO '{geojson_path}' "
            f"WITH (FORMAT GDAL, DRIVER 'GeoJSON')"
        )

        subprocess.run(
            [
                "tippecanoe", "-o", pmtiles_path, "-l", slug.replace("-", "_"),
                "-zg", "--drop-densest-as-needed",
                # LandMark's real datasets mix huge, highly detailed
                # individual polygons (a country-scale indicative area) with
                # many small ones -- --drop-densest-as-needed retries a
                # low-zoom tile at ever-smaller keep-fractions whenever it
                # exceeds the 500KB soft limit, but when the tile's size is
                # dominated by a handful of individually-oversized features,
                # dropping OTHER features barely moves the total size, and
                # the retry loop never converges (observed: 79.66% -> 63.50%
                # -> 50.64% keep-fraction changed tile size by under 0.1%
                # each time). --no-tile-size-limit accepts oversized tiles
                # instead of retrying forever -- a few slightly-larger
                # low-zoom overview tiles is a fine tradeoff against a task
                # that never finishes.
                "--no-tile-size-limit",
                "--force", geojson_path,
            ],
            check=True,
        )

        dest_key = f"tiles/{slug}.pmtiles"
        upload_file(pmtiles_path, dest_key, public_prefix="tiles/")

    return {"slug": slug, "step": "build_pmtiles", "dest": f"s3://.../{dest_key}"}


def run_pipeline(source_path: str, slug: str, build_static: bool = False):
    """Kicks off ingest -> curate -> contract_test -> load_postgis (and
    optionally -> build_pmtiles) as one Celery chain for `slug`.

    Not a task itself -- a plain function that dispatches a chain(), so it
    can be called from anywhere that has celery_app configured (a script, a
    future admin-triggered FastAPI route) without needing its own worker
    slot just to sit and await sub-tasks. Returns the chain's AsyncResult;
    callers/Flower track step-by-step progress via that result's chain of
    parent results.
    """
    steps = [ingest_task.s(source_path, slug), curate_task.s(slug), contract_test_task.s(slug), load_postgis_task.s(slug)]
    if build_static:
        steps.append(build_pmtiles_task.s(slug))
    return chain(*steps).apply_async()
