"""Step 1 of 3: ingest.py

Source file -> immutable GeoParquet in `raw/`, plus the registry row that
makes this dataset exist as a first-class entity from this point on (brief
§4 "registry-first"). GeoParquet, not the source format, is the artifact we
keep: it's columnar, typed, and self-describing (CRS + bbox in metadata),
so every later step reads one predictable format regardless of whether the
source was a Shapefile, GeoJSON, or CSV+geom.

Usage: python pipelines/ingest.py <path-to-source-file> <slug>
"""
import json
import sys

from common import ensure_bucket, get_duckdb_conn, get_pg_conn, s3_uri

# Hand-written per dataset for Phase 0 -- Phase 4's upload flow (brief §16)
# collects this same information from the curator through a form instead of
# a script argument, but the registry row it produces looks identical.
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
        # Overrides the registry's protective default ('withheld') on purpose:
        # this is public-domain reference geography, not land-rights data, so
        # none of the §13 sensitivity concerns that justify the default apply.
        "sensitivity": "public",
    }
}


def geometry_type(con) -> str:
    types = [r[0] for r in con.execute("SELECT DISTINCT ST_GeometryType(geom) FROM src").fetchall()]
    return types[0] if len(types) == 1 else "GEOMETRY"


def bbox_wkt(con) -> str:
    xmin, ymin, xmax, ymax = con.execute(
        "SELECT MIN(ST_XMin(geom)), MIN(ST_YMin(geom)), MAX(ST_XMax(geom)), MAX(ST_YMax(geom)) FROM src"
    ).fetchone()
    return (
        f"POLYGON(({xmin} {ymin}, {xmax} {ymin}, {xmax} {ymax}, "
        f"{xmin} {ymax}, {xmin} {ymin}))"
    )


def schema_json(con) -> dict:
    cols = con.execute("PRAGMA table_info('src')").fetchall()
    # geom is described separately (crs/geometry_type columns), so it's
    # excluded here -- schema_json is specifically the *attribute* schema.
    return {row[1]: row[2] for row in cols if row[1] != "geom"}


def main(source_path: str, slug: str):
    meta = DATASET_META[slug]
    ensure_bucket()
    con = get_duckdb_conn()

    con.execute(f"CREATE TABLE src AS SELECT * FROM ST_Read('{source_path}')")
    # ST_Read names the geometry column differently depending on driver;
    # normalize to `geom` so every downstream step can assume one name.
    # DuckDB spatial reports the type as e.g. "GEOMETRY('EPSG:4326')", not a
    # bare "GEOMETRY" -- match the prefix rather than exact equality.
    geom_col = next(c[1] for c in con.execute("PRAGMA table_info('src')").fetchall() if c[2].startswith("GEOMETRY"))
    if geom_col != "geom":
        con.execute(f'ALTER TABLE src RENAME COLUMN "{geom_col}" TO geom')

    # GeoParquet 1.1 "covering" bbox: a per-row struct column readers can use
    # to prune row groups without decoding geometries (brief §2/§4).
    con.execute(
        "ALTER TABLE src ADD COLUMN bbox STRUCT(xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE)"
    )
    con.execute(
        "UPDATE src SET bbox = {'xmin': ST_XMin(geom), 'ymin': ST_YMin(geom), "
        "'xmax': ST_XMax(geom), 'ymax': ST_YMax(geom)}"
    )

    row_count = con.execute("SELECT COUNT(*) FROM src").fetchone()[0]
    gtype = geometry_type(con)
    schema = schema_json(con)
    bbox = bbox_wkt(con)

    dest = s3_uri(f"raw/{slug}.parquet")
    con.execute(f"COPY (SELECT * FROM src) TO '{dest}' (FORMAT PARQUET)")
    print(f"ingest: wrote {row_count} rows -> {dest}")

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
    print(f"ingest: registry row for '{slug}' is now tier_status=raw")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
