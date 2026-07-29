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
import contextlib
import json
import os
import subprocess
import tempfile
import zipfile

from celery import chain
from psycopg2.extras import execute_values

from worker.celery_app import celery_app
from worker.common import ensure_bucket, get_duckdb_conn, get_pg_conn, get_s3_client, s3_uri, upload_file
from worker.seed_datasets import DATASET_META

# DATASET_META moved to worker/seed_datasets.py (Phase 5, brief §17's
# reusability pass) -- it's example/seed CONTENT for this deployment's
# engineer-triggered CLI path, not pipeline logic, so a new deployment
# edits/deletes that one file instead of this one. Phase 4's self-service
# upload flow (brief §16) needs no entry here at all: the curator's upload
# form + governance-editing endpoints supply this same information per-row.


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


def _metadata_for(slug: str, pg) -> dict:
    """Phase 0/1 datasets are hand-entered in DATASET_META above; Phase 4's
    self-service upload flow (brief §16 step 2) collects the same fields
    through a curator form instead, and the upload endpoint (app/routers/
    uploads.py) writes them into a draft registry.datasets row BEFORE ever
    dispatching this task chain -- so for any slug not in DATASET_META, that
    row is the metadata source instead. Raises if neither exists: every
    ingest run must have SOME source of name/license/attribution etc, there
    is no third, implicit default.
    """
    if slug in DATASET_META:
        return DATASET_META[slug]
    with pg.cursor() as cur:
        cur.execute(
            "SELECT name, description, source, license, attribution, sensitivity FROM registry.datasets WHERE slug = %s",
            (slug,),
        )
        row = cur.fetchone()
    if row is None:
        raise ValueError(f"no DATASET_META entry and no registry.datasets row for slug '{slug}' -- ingest_task "
                          "needs one or the other to exist before it runs")
    # dedup_key/serve_mode have no self-service form field (dedup is a
    # Phase 0/1-only concept for known-duplicated fixture data; serve_mode
    # is a curator decision made at APPROVAL time, not upload time -- see
    # app/routers/uploads.py's approve endpoint and run_publish_pipeline
    # below) -- both are absent from a DB-sourced meta dict on purpose.
    return dict(row)


# Which inner file each archive format must contain -- mirrors
# app/routers/uploads.py's `_ARCHIVE_INNER_SUFFIX` exactly (that endpoint
# already rejects an archive missing this member at upload time, so this is
# a defense-in-depth re-check, not the primary gate).
_ARCHIVE_INNER_SUFFIX = {".zip": ".shp", ".kmz": ".kml"}


def _s3_uri_to_bucket_key(uri: str) -> tuple[str, str]:
    """Splits `s3://bucket/key/with/slashes` back into its parts -- the
    inverse of `s3_uri`. Needed only by `_resolved_source` below: every
    other ingest step reads straight off the `s3://` URI via DuckDB's own
    httpfs filesystem and never needs the bucket/key apart."""
    without_scheme = uri.removeprefix("s3://")
    bucket, _, key = without_scheme.partition("/")
    return bucket, key


@contextlib.contextmanager
def _resolved_source(source_path: str):
    """Yields the exact string to hand `ST_Read`.

    Unchanged for every format DuckDB's own httpfs-backed S3 filesystem
    already reads straight off `s3://...` -- geojson/gpkg/parquet, and KML
    the same way (GDAL's KML driver takes a plain .kml over http(s)/s3 with
    no chaining at all). A zipped Shapefile or KMZ (a zip containing one
    .kml) needs GDAL's `/vsizip/` chaining instead, WITH an explicit inner
    path -- `/vsizip/{archive}` alone only auto-detects a single-layer
    archive when the target file sits at the zip's root, and silently fails
    to find it if a curator zipped a containing folder instead (a common
    mistake when zipping a Shapefile's sidecar files from a file manager
    rather than from inside the folder) -- verified directly against this
    repo's pinned duckdb==1.5.5 spatial build before relying on any of this.

    Downloads the archive to a local temp file first rather than reaching
    for GDAL's own S3 VSI handler (`/vsizip/vsis3/...`) at the s3:// URL
    directly -- that handler needs its own separate AWS_*-env-var-based
    credentials that GDAL reads independently of the s3_access_key_id/etc
    DuckDB's httpfs extension is already configured with (get_duckdb_conn),
    and wiring up a second, GDAL-flavored auth path just for this one format
    is more moving parts than downloading the (curator-upload-sized, not
    LandMark-bulk-sized) archive locally and reading it off disk -- already
    proven to work identically to the remote case once GDAL has a `/vsizip/`
    path, scheme aside.
    """
    ext = os.path.splitext(source_path)[1].lower()
    inner_suffix = _ARCHIVE_INNER_SUFFIX.get(ext)
    if inner_suffix is None:
        yield source_path
        return

    bucket, key = _s3_uri_to_bucket_key(source_path)
    fd, local_path = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    try:
        get_s3_client().download_file(bucket, key, local_path)
        with zipfile.ZipFile(local_path) as zf:
            member = next((n for n in zf.namelist() if n.lower().endswith(inner_suffix)), None)
        if member is None:
            raise ValueError(f"no {inner_suffix} file found inside the uploaded {ext} archive")
        yield f"/vsizip/{local_path}/{member}"
    finally:
        os.remove(local_path)


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def ingest_task(self, source_path: str, slug: str):
    """Step 1: source file -> immutable GeoParquet in raw/, registry row
    created with tier_status=raw (brief §4 "registry-first"). Raw stays in
    the source CRS as-ingested (medallion "immutable, as-ingested" -- CRS
    normalization is curate_task's job, brief §5 step 2); the registry's
    `extent` bbox is still computed in true EPSG:4326 degrees, since that
    column is documented as always-4326 regardless of tier."""
    ensure_bucket()
    con = get_duckdb_conn()

    with _resolved_source(source_path) as read_path:
        con.execute(f"CREATE TABLE src AS SELECT * FROM ST_Read('{read_path}')")
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
    meta = _metadata_for(slug, pg)
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
    # .get(), not [slug] -- a self-service upload (brief §16) has no
    # DATASET_META entry at all; dedup is a Phase 0/1-only concept for
    # known-duplicated fixture/LandMark data (see the comment below), so
    # "no entry" and "entry with dedup_key=None" mean the same thing here.
    meta = DATASET_META.get(slug, {})
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


def _sample_features(con, table: str, limit: int = 5) -> list:
    """A handful of full features (geometry simplified + every attribute)
    for the curator's validation report (brief §16 step 3: "a sample map")
    -- not a real map render, just enough GeoJSON for the admin UI to drop
    onto a throwaway MapLibre instance so a curator can eyeball "does this
    look like what I uploaded" without downloading the whole file.
    `ST_Simplify` at a coarse tolerance keeps even a detailed polygon's
    JSON small; this is a sanity-check sample, not the published tiles."""
    attr_cols = [row[1] for row in con.execute(f"PRAGMA table_info('{table}')").fetchall() if row[1] not in ("geom", "bbox")]
    select_cols = ", ".join(f'"{c}"::VARCHAR AS "{c}"' for c in attr_cols)
    rows = con.execute(
        f"SELECT {select_cols}, ST_AsGeoJSON(ST_Simplify(geom, 0.01)) AS geom_geojson "
        f"FROM {table} USING SAMPLE {limit}"
    ).fetchall()
    columns = [d[0] for d in con.description]
    features = []
    for row in rows:
        record = dict(zip(columns, row))
        geom_geojson = record.pop("geom_geojson")
        features.append({"type": "Feature", "geometry": json.loads(geom_geojson), "properties": record})
    return features


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def contract_test_task(self, prev_result, slug: str):
    """Step 3: contract gate on curated output -- schema, validity, WGS84
    range, row-count sanity (brief §5 step 3), PLUS (brief §16 step 3) a
    structured report -- geometry validity, CRS, field types, row count,
    a feature sample -- persisted to registry.datasets.validation_report
    so a curator can review it in the admin UI regardless of whether this
    task ultimately passes or raises. Every check below accumulates into
    `errors` instead of raising immediately, specifically so a FAILED
    upload still gets a complete, inspectable report ("here's everything
    that's wrong with your file") rather than only ever reporting the
    first problem found and stopping.

    Raising at the end is still the gate: Celery marks the task (and
    therefore the chain) FAILURE, so load_postgis_task never runs against
    unvalidated data -- unchanged from Phase 0/1's behavior."""
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{slug}.parquet')}')")

    cols = {row[1] for row in con.execute("PRAGMA table_info('curated_tbl')").fetchall()}
    errors = []
    required = {"geom", "bbox"}
    missing = required - cols
    if missing:
        errors.append(f"curated dataset is missing required columns: {sorted(missing)}")

    null_or_empty = con.execute("SELECT COUNT(*) FROM curated_tbl WHERE geom IS NULL OR ST_IsEmpty(geom)").fetchone()[0]
    if null_or_empty:
        errors.append(f"{null_or_empty} rows have null/empty geometry")

    invalid = con.execute("SELECT COUNT(*) FROM curated_tbl WHERE NOT ST_IsValid(geom)").fetchone()[0]
    if invalid:
        errors.append(f"{invalid} rows still fail ST_IsValid after curation")

    out_of_range = con.execute(
        "SELECT COUNT(*) FROM curated_tbl WHERE ST_XMin(geom) < -180 OR ST_XMax(geom) > 180 "
        "OR ST_YMin(geom) < -90 OR ST_YMax(geom) > 90"
    ).fetchone()[0]
    if out_of_range:
        errors.append(f"{out_of_range} rows have coordinates outside WGS84 bounds")

    count = con.execute("SELECT COUNT(*) FROM curated_tbl").fetchone()[0]
    # Wide but real bound -- catches a truncated/empty source or an exploded
    # join without hardcoding an exact expected count per dataset. Raised
    # from Phase 0's 500 to cover LandMark's largest layer (~330K rows).
    if not (1 <= count <= 2_000_000):
        errors.append(f"row count {count} is outside the sane range for a promotable dataset")

    report = {
        "row_count": count,
        "geometry_type": _geometry_type(con, "curated_tbl") if "geom" in cols else None,
        "null_or_empty_geometry_count": null_or_empty,
        "invalid_geometry_count": invalid,
        "out_of_range_count": out_of_range,
        "fields": {k: v for k, v in _schema_json(con, "curated_tbl").items() if k != "bbox"},
        "sample_features": _sample_features(con, "curated_tbl") if not missing else [],
        "passed": not errors,
        "errors": errors,
    }

    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        cur.execute(
            "UPDATE registry.datasets SET validation_report = %s WHERE slug = %s",
            (json.dumps(report), slug),
        )
    pg.close()

    if errors:
        raise ValueError("; ".join(errors))
    return {"slug": slug, "step": "contract_test", "row_count": count, "passed": True}


@celery_app.task(bind=True, soft_time_limit=3300, time_limit=3600)
def load_postgis_task(self, prev_result, slug: str, serve_mode: str | None = None):
    """Step 4: curated -> published.<table> with a spatial index + ANALYZE,
    registry flips to tier_status=published.

    `serve_mode`: explicit param (not just DATASET_META) so a curator's
    approval-time choice (brief §16 step 5 -- "Worker loads to published
    and builds tiles (PMTiles or assigns Martin)") can drive this without
    a code entry. `None` (Phase 0/1's engineer-triggered `run_pipeline`
    path, which never passes this) falls back to DATASET_META as before.
    Phase 4's self-service approval endpoint (app/routers/uploads.py)
    always passes `serve_mode="pmtiles"` explicitly -- Martin's serve path
    needs a curator-added dataset to be added to tiles/martin/config.yaml
    and the container reloaded, which nothing here automates yet, so
    self-service publishing offers PMTiles only until that's built.

    Overrides celery_app's global 600s/900s limits: the Kenya fixture's 8
    rows finish in seconds, but LandMark's community-lands layer is ~330K
    rows -- the global default is tuned for the common case, not the
    largest one, so the tasks whose runtime actually scales with row count
    (this one, build_pmtiles_task) get their own generous ceiling instead
    of a blanket increase that would mask a genuinely hung ingest/curate/
    contract-test task."""
    meta = DATASET_META.get(slug, {})
    resolved_serve_mode = serve_mode or meta.get("serve_mode", "martin")
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
            (resolved_serve_mode, slug),
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


def run_upload_pipeline(source_path: str, slug: str):
    """Self-service counterpart to `run_pipeline` (brief §16 steps 1-3):
    ingest -> curate -> contract_test, and STOPS -- no load_postgis_task,
    no auto-publish. The curator reviews contract_test_task's persisted
    `validation_report` (and sets governance fields via the existing
    PUT /admin/datasets/{slug}/governance) before anything reaches
    `published`; that review is `run_publish_pipeline`, a deliberately
    separate dispatch a curator triggers explicitly via
    POST /admin/uploads/{slug}/approve, not an automatic next step of this
    chain. Called from app/routers/uploads.py's upload endpoint right after
    it creates the draft registry.datasets row (see _metadata_for's
    docstring above for why that ordering matters)."""
    return chain(ingest_task.s(source_path, slug), curate_task.s(slug), contract_test_task.s(slug)).apply_async()


def run_publish_pipeline(slug: str, serve_mode: str):
    """Curator-triggered publish (brief §16 steps 4-6), dispatched from
    POST /admin/uploads/{slug}/approve once `validation_report.passed` is
    true. `load_postgis_task.s(None, slug, serve_mode=serve_mode)` passes
    `None` explicitly for `prev_result` because THIS chain has no
    predecessor to auto-fill it (unlike `run_pipeline`'s chain, where
    Celery prepends contract_test_task's real return value) -- see that
    task's own docstring for why `serve_mode` is a required, explicit
    argument here rather than falling back to DATASET_META."""
    steps = [load_postgis_task.s(None, slug, serve_mode=serve_mode)]
    if serve_mode == "pmtiles":
        steps.append(build_pmtiles_task.s(slug))
    return chain(*steps).apply_async()
