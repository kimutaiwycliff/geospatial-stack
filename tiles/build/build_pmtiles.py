"""Static tile path: curated GeoParquet -> tippecanoe -> PMTiles -> uploaded
to object storage (brief §0.10, §5 step 5 "stable layers -> tippecanoe").

This is a proof artifact for Phase 0: it tiles the SAME published dataset
Martin already serves live, purely to demonstrate the static path works
end-to-end. In Phase 1, a given real dataset picks one path or the other
based on how often it changes -- not both (see load_postgis.py's registry
comment).

Usage: python build_pmtiles.py <slug>
"""
import json
import subprocess
import sys
import tempfile

from common import get_duckdb_conn, s3_uri, upload_file


def main(slug: str):
    con = get_duckdb_conn()
    con.execute("INSTALL json; LOAD json;")
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{slug}.parquet')}')")

    attr_cols = [
        row[1] for row in con.execute("PRAGMA table_info('curated_tbl')").fetchall()
        if row[1] not in ("geom", "bbox")
    ]
    # Fetching the whole FeatureCollection as one JSON string via DuckDB's
    # json_object/json_group_array, then writing it with plain Python file
    # I/O, sidesteps DuckDB's CSV/text COPY writer mangling embedded quotes
    # and commas inside the JSON -- far more reliable than trying to coax
    # COPY into emitting a single well-formed text blob.
    props_obj = ", ".join(f"'{c}', {c}" for c in attr_cols)
    fc_json = con.execute(
        f"""
        SELECT json_object(
            'type', 'FeatureCollection',
            'features', json_group_array(
                json_object(
                    'type', 'Feature',
                    'properties', json_object({props_obj}),
                    'geometry', json(ST_AsGeoJSON(geom))
                )
            )
        )
        FROM curated_tbl
        """
    ).fetchone()[0]

    with tempfile.TemporaryDirectory() as tmp:
        geojson_path = f"{tmp}/{slug}.geojson"
        pmtiles_path = f"{tmp}/{slug}.pmtiles"

        with open(geojson_path, "w") as f:
            f.write(fc_json if isinstance(fc_json, str) else json.dumps(fc_json))

        # -zg: pick a sensible zoom range automatically for this fixture's
        # extent instead of hand-tuning min/max zoom for a dataset that only
        # exists to prove the pipeline. Real LandMark layers (Phase 1) will
        # want deliberate per-zoom generalization settings.
        subprocess.run(
            [
                "tippecanoe",
                "-o", pmtiles_path,
                "-l", slug.replace("-", "_"),
                "-zg",
                "--drop-densest-as-needed",
                "--force",
                geojson_path,
            ],
            check=True,
        )

        dest_key = f"tiles/{slug}.pmtiles"
        # public_prefix="tiles/": MapLibre's pmtiles JS lib range-requests
        # this object directly, unauthenticated, straight from object
        # storage (brief §3's "no DB hit at request time") -- it must be
        # anonymously readable, unlike raw/curated which stay ETL-internal.
        upload_file(pmtiles_path, dest_key, public_prefix="tiles/")
        print(f"build_pmtiles: uploaded {pmtiles_path} -> s3://.../{dest_key}")


if __name__ == "__main__":
    main(sys.argv[1])
