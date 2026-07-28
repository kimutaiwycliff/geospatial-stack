"""Contract test: gates promotion from `curated/` to PostGIS `published`
(brief §5 step 3). Deliberately minimal for Phase 0 -- schema, geometry
validity, and row-count sanity -- more contracts (null/range checks per
field, referential checks against reference tables) get added per-dataset
as Horizon 2's upload flow needs them.

Run with DATASET_SLUG=<slug> pytest, from etl/ so `pipelines/` is importable.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipelines"))

import pytest
from common import get_duckdb_conn, s3_uri

SLUG = os.environ.get("DATASET_SLUG", "kenya-admin1-provinces")

# Every stand-in/LandMark polygon dataset must carry at least these columns;
# per-dataset extras are fine, missing required ones are not.
REQUIRED_COLUMNS = {"name", "geom", "bbox"}


@pytest.fixture(scope="module")
def curated():
    con = get_duckdb_conn()
    con.execute(f"CREATE TABLE curated_tbl AS SELECT * FROM read_parquet('{s3_uri(f'curated/{SLUG}.parquet')}')")
    yield con


def test_required_columns_present(curated):
    cols = {row[1] for row in curated.execute("PRAGMA table_info('curated_tbl')").fetchall()}
    missing = REQUIRED_COLUMNS - cols
    assert not missing, f"curated dataset is missing required columns: {missing}"


def test_no_null_or_empty_geometries(curated):
    bad = curated.execute(
        "SELECT COUNT(*) FROM curated_tbl WHERE geom IS NULL OR ST_IsEmpty(geom)"
    ).fetchone()[0]
    assert bad == 0, f"{bad} rows have null/empty geometry"


def test_all_geometries_valid(curated):
    invalid = curated.execute(
        "SELECT COUNT(*) FROM curated_tbl WHERE NOT ST_IsValid(geom)"
    ).fetchone()[0]
    assert invalid == 0, f"{invalid} rows still fail ST_IsValid after curation"


def test_coordinates_in_wgs84_range(curated):
    # Cheap proxy for "this is actually EPSG:4326" -- a real CRS-mismatch
    # bug (e.g. still in 3857) produces coordinates wildly outside these
    # bounds, so this catches the common failure without a full CRS check.
    out_of_range = curated.execute(
        "SELECT COUNT(*) FROM curated_tbl "
        "WHERE ST_XMin(geom) < -180 OR ST_XMax(geom) > 180 "
        "OR ST_YMin(geom) < -90 OR ST_YMax(geom) > 90"
    ).fetchone()[0]
    assert out_of_range == 0, f"{out_of_range} rows have coordinates outside WGS84 bounds"


def test_row_count_sanity(curated):
    count = curated.execute("SELECT COUNT(*) FROM curated_tbl").fetchone()[0]
    # Wide but real bounds: catches "the source file was truncated/empty" or
    # "a join exploded rows" without hardcoding an exact expected count.
    assert 1 <= count <= 500, f"row count {count} is outside the sane range for this dataset"
