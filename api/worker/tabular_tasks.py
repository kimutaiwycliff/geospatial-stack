"""Tabular LandMark datasets (brief §1.4, §15): national indicators shipped
as .xlsx/.xls spreadsheets, not GIS files. These skip the geometry
pipeline's medallion tiers entirely (raw/curated GeoParquet, CRS,
GIST index, tiles) -- there's no geometry to validate/reproject/tile, and
brief §1.4 is explicit that this data is "not tiled, since it's tabular,
not geometry-heavy." One task reads a sheet, writes it straight to a plain
published.<table>, and creates its registry row directly at tier_status=
published -- a deliberate simplification, not an oversight: raw/curated
distinctions exist to gate geometry validity/CRS correctness, neither of
which applies to a spreadsheet of per-country indicator values.
"""
import json
import re

import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

from worker.celery_app import celery_app
from worker.common import get_pg_conn
from worker.seed_datasets import TABULAR_ATTRIBUTION as _ATTRIBUTION
from worker.seed_datasets import TABULAR_DATASET_META
from worker.seed_datasets import TABULAR_LICENSE as _LICENSE
from worker.seed_datasets import TABULAR_SOURCE as _SOURCE

# TABULAR_DATASET_META (+ the three constants above) moved to worker/
# seed_datasets.py, same reasoning as tasks.py's DATASET_META import above it.

# Same production-readiness-audit retry policy as tasks.py's identical
# `_RETRY_KWARGS` (a dropped DB connection shouldn't permanently fail a
# tabular ingest either) -- duplicated rather than imported cross-module
# since this file has no other dependency on tasks.py and the tuple/dict is
# three lines; not worth a shared module for that. Only psycopg2 here (no
# S3/boto3 involved in the tabular path at all), unlike tasks.py's pair.
_RETRY_KWARGS = dict(
    autoretry_for=(psycopg2.OperationalError,),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
)


def _clean_col(name) -> str:
    """Column names as-shipped mix case and stray characters (e.g.
    "ISO_Code", "i4_addinfo2") -- lowercased/underscored so every column is
    a safe, unquoted-friendly Postgres identifier."""
    return re.sub(r"[^0-9a-zA-Z_]+", "_", str(name).strip()).strip("_").lower()


def _table_name(slug: str) -> str:
    return slug.replace("-", "_")


@celery_app.task(bind=True, soft_time_limit=300, time_limit=360, **_RETRY_KWARGS)
def ingest_tabular_task(self, slug: str):
    meta = TABULAR_DATASET_META[slug]
    df = pd.read_excel(meta["file_path"], sheet_name=meta["sheet"])
    df = df.dropna(how="all")
    df.columns = [_clean_col(c) for c in df.columns]

    iso_col = _clean_col(meta["iso_col"])
    if iso_col != "iso_code":
        df = df.rename(columns={iso_col: "iso_code"})
    # Standardize case/whitespace on the join key every downstream country-
    # summary join relies on -- LandMark's own files aren't fully consistent
    # here (mostly upper already, but worth not trusting that blindly).
    df["iso_code"] = df["iso_code"].astype(str).str.strip().str.upper()

    table = _table_name(slug)
    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        cur.execute(f'DROP TABLE IF EXISTS published."{table}"')
        col_defs = ", ".join(
            f'"{col}" {"DOUBLE PRECISION" if pd.api.types.is_numeric_dtype(dtype) else "TEXT"}'
            for col, dtype in zip(df.columns, df.dtypes)
        )
        cur.execute(f'CREATE TABLE published."{table}" (id BIGSERIAL PRIMARY KEY, {col_defs})')

        col_list = ", ".join(f'"{c}"' for c in df.columns)
        insert_sql = f'INSERT INTO published."{table}" ({col_list}) VALUES %s'
        # NaN isn't a valid SQL value -- swap for None so execute_values
        # inserts a real NULL instead of the literal string "nan".
        values = [tuple(None if pd.isna(v) else v for v in row) for row in df.itertuples(index=False)]
        execute_values(cur, insert_sql, values)
        cur.execute(f'CREATE INDEX "{table}_iso_idx" ON published."{table}" (iso_code)')

        schema = {col: str(dtype) for col, dtype in zip(df.columns, df.dtypes)}
        cur.execute(
            """
            INSERT INTO registry.datasets
                (name, slug, description, source, license, attribution, sensitivity, tier_status, schema_json)
            VALUES (%s, %s, %s, %s, %s, %s, 'public', 'published', %s)
            ON CONFLICT (slug) DO UPDATE SET
                tier_status = 'published',
                schema_json = EXCLUDED.schema_json
            """,
            (meta["name"], slug, meta["description"], _SOURCE, _LICENSE, _ATTRIBUTION, json.dumps(schema)),
        )
    pg.close()
    return {"slug": slug, "step": "ingest_tabular", "rows": len(df), "table": table}


@celery_app.task(bind=True, soft_time_limit=120, time_limit=180, **_RETRY_KWARGS)
def build_country_summary_view_task(self, prev_results=None):
    """brief §1.4: "a small PostGIS table (or set of registry-linked tables)
    joining the national indicator datasets by country." Implemented as a
    VIEW (not a materialized copy) over the four genuinely one-row-per-
    country tables -- cbd-headline-indicator-22-1 is excluded because it's a
    time-series (multiple rows per country per year), not a per-country
    snapshot, so it doesn't fit a single-row-per-country join.

    Columns are prefixed per source table (pop_*, pct_*, tsic_*, tsii_*) to
    avoid collisions -- "country"/"source" appear in more than one table
    with different values, and silently picking one via SELECT * would be
    wrong. Regenerated by introspecting information_schema rather than
    hand-listing 100+ columns, so it stays correct if a table's own schema
    changes later.
    """
    view_tables = {
        "pop": "indigenous_population_per_country",
        "pct": "pct_ip_comm_lands",
        "tsic": "tenure_security_community",
        "tsii": "tenure_security_ip",
    }
    pg = get_pg_conn()
    with pg, pg.cursor() as cur:
        select_parts = ["pop.iso_code AS iso_code"]
        joins = []
        for prefix, table in view_tables.items():
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'published' AND table_name = %s AND column_name NOT IN ('id', 'iso_code')",
                (table,),
            )
            # get_pg_conn() uses RealDictCursor -- rows are dicts keyed by
            # column name, not positional tuples, so r[0] raises KeyError.
            cols = [r["column_name"] for r in cur.fetchall()]
            select_parts += [f'{prefix}."{c}" AS "{prefix}_{c}"' for c in cols]
            if prefix != "pop":
                joins.append(f'LEFT JOIN published."{table}" {prefix} ON {prefix}.iso_code = pop.iso_code')

        view_sql = (
            f"CREATE OR REPLACE VIEW published.country_summary AS "
            f"SELECT {', '.join(select_parts)} "
            f'FROM published."{view_tables["pop"]}" pop {" ".join(joins)}'
        )
        cur.execute(view_sql)
    pg.close()
    return {"step": "build_country_summary_view", "view": "published.country_summary"}
