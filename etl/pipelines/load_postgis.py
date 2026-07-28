"""Step 3 of 3: load_postgis.py

Curated GeoParquet -> a `published.<table>` PostGIS table with a spatial
index, then flips the registry row to `tier_status='published'`. This is
the only tier Martin/the API/the frontend are ever pointed at (brief §4).

Usage: python pipelines/load_postgis.py <slug>
"""
import sys

from common import get_duckdb_conn, get_pg_conn, s3_uri

# psycopg2 identifiers can't safely take a hyphenated slug -- the registry
# slug stays URL-friendly (hyphens) while the table name it maps to is a
# plain SQL identifier (underscores). Keeping this mapping in one place
# means every step agrees on the same table name for a given slug.
def table_name(slug: str) -> str:
    return slug.replace("-", "_")


def main(slug: str):
    table = table_name(slug)
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{slug}.parquet')}')")

    cols = [row[1] for row in con.execute("PRAGMA table_info('curated_tbl')").fetchall() if row[1] not in ("geom", "bbox")]
    rows = con.execute(
        f"SELECT {', '.join(cols)}, ST_AsWKB(geom) FROM curated_tbl"
    ).fetchall()

    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        # Idempotent re-run for the Phase-0 slice: dropping/recreating is fine
        # here because this table has no dependents yet; a real re-publish
        # (Phase 1+) would swap tables atomically instead of a hard drop.
        cur.execute(f'DROP TABLE IF EXISTS published."{table}"')
        col_defs = ",\n                ".join(f'"{c}" TEXT' for c in cols if c not in ("latitude", "longitude"))
        cur.execute(
            f"""
            CREATE TABLE published."{table}" (
                id BIGSERIAL PRIMARY KEY,
                {col_defs},
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                geom geometry(Geometry, 4326) NOT NULL
            )
            """
        )

        attr_placeholders = ", ".join(["%s"] * len(cols))
        col_list = ", ".join(f'"{c}"' for c in cols)
        insert_sql = (
            f'INSERT INTO published."{table}" ({col_list}, geom) '
            f"VALUES ({attr_placeholders}, ST_SetSRID(ST_GeomFromWKB(%s), 4326))"
        )
        for row in rows:
            *attrs, wkb = row
            cur.execute(insert_sql, (*attrs, bytes(wkb)))

        cur.execute(f'CREATE INDEX "{table}_geom_gix" ON published."{table}" USING GIST (geom)')
        cur.execute(f'ANALYZE published."{table}"')

        # `martin`, not `pmtiles`: the published table is Martin's source of
        # truth. A parallel PMTiles copy of this same slice gets built by
        # tiles/build/ purely to prove the static path works too (brief §0.9
        # -0.10) -- in Phase 1, each real dataset picks one path, not both.
        cur.execute(
            "UPDATE registry.datasets SET tier_status = 'published', serve_mode = 'martin' WHERE slug = %s",
            (slug,),
        )
    pg.close()
    print(f"load_postgis: {len(rows)} rows -> published.{table}, registry tier_status=published")


if __name__ == "__main__":
    main(sys.argv[1])
