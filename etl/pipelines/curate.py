"""Step 2 of 3: curate.py

Raw GeoParquet -> validated/cleaned GeoParquet in `curated/`. This is where
correctness gets enforced, once, so every consumer downstream (contract
test, PostGIS load, tiling) can assume clean input instead of re-checking it.

Usage: python pipelines/curate.py <slug>
"""
import sys

from common import get_duckdb_conn, get_pg_conn, s3_uri


def main(slug: str):
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE raw_tbl AS SELECT * FROM read_parquet('{s3_uri(f'raw/{slug}.parquet')}')")

    before = con.execute("SELECT COUNT(*) FROM raw_tbl").fetchone()[0]

    # ST_IsValid/ST_MakeValid: fix self-intersections and other topology
    # defects instead of letting them surface later as a Martin/tippecanoe
    # error that's much harder to trace back to a specific input row.
    invalid_before = con.execute("SELECT COUNT(*) FROM raw_tbl WHERE NOT ST_IsValid(geom)").fetchone()[0]
    con.execute(
        "CREATE TABLE curated_tbl AS "
        "SELECT * REPLACE (CASE WHEN ST_IsValid(geom) THEN geom ELSE ST_MakeValid(geom) END AS geom) "
        "FROM raw_tbl"
    )

    # Dedupe on the natural key for this fixture (province name) -- a real
    # dataset's natural key comes from its registry schema_json, but Phase 0
    # hardcodes it since there's exactly one slice dataset.
    con.execute(
        "CREATE TABLE curated_deduped AS "
        "SELECT * FROM curated_tbl QUALIFY ROW_NUMBER() OVER (PARTITION BY name ORDER BY name) = 1"
    )

    # Drop rows that are still null/empty after MakeValid -- these are
    # unrecoverable and must not silently reach `published`.
    con.execute("DELETE FROM curated_deduped WHERE geom IS NULL OR ST_IsEmpty(geom)")

    # Attribute cleanup: trim stray whitespace Natural Earth's source data
    # sometimes carries in text fields.
    con.execute("UPDATE curated_deduped SET name = TRIM(name), type = TRIM(type)")

    after = con.execute("SELECT COUNT(*) FROM curated_deduped").fetchone()[0]

    dest = s3_uri(f"curated/{slug}.parquet")
    con.execute(f"COPY (SELECT * FROM curated_deduped) TO '{dest}' (FORMAT PARQUET)")
    print(
        f"curate: {before} raw rows -> {after} curated rows "
        f"({invalid_before} invalid geometries repaired) -> {dest}"
    )

    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        cur.execute(
            "UPDATE registry.datasets SET tier_status = 'curated' WHERE slug = %s",
            (slug,),
        )
    pg.close()
    print(f"curate: registry row for '{slug}' is now tier_status=curated")


if __name__ == "__main__":
    main(sys.argv[1])
