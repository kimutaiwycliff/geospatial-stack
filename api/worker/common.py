"""Shared S3/DuckDB/PostGIS helpers for every pipeline step (brief §5).

Phase 0 had this duplicated across etl/pipelines/common.py and
tiles/build/common.py because those lived in two separate, independent
Docker build contexts. Phase 1 moves the pipeline into this one image
(brief §1.2 "this is the pipeline that Horizon 2 will reuse verbatim"), so
there's exactly one copy from here on -- etl/ and tiles/build/ stay in the
repo as the Phase-0 record/reference but are no longer the code path any
real ingestion runs through.
"""
import json
import os

import boto3
import duckdb
import psycopg2
from botocore.exceptions import ClientError
from psycopg2.extras import RealDictCursor


def s3_config():
    endpoint = os.environ["S3_ENDPOINT"]
    return {
        "endpoint": endpoint,
        "use_ssl": endpoint.startswith("https://"),
        "host": endpoint.split("://", 1)[-1],
        "access_key": os.environ["S3_ACCESS_KEY"],
        "secret_key": os.environ["S3_SECRET_KEY"],
        "bucket": os.environ["S3_BUCKET"],
        "region": os.environ["S3_REGION"],
    }


def get_duckdb_conn():
    """DuckDB with spatial + httpfs wired to read/write the S3 bucket directly.

    `s3_url_style=path` is required for MinIO (bucket.storage:9000 doesn't
    resolve as a subdomain) and is also valid against R2 -- so this one
    setting keeps both providers working without a code branch.

    `memory_limit` + `temp_directory` matter for real (non-fixture) data:
    the Docker Desktop VM this stack runs in has only ~3.8GB total, shared
    across every container. DuckDB's default in-memory connection has no
    disk-spill ceiling -- CREATE TABLE AS SELECT * FROM ST_Read(...) on
    LandMark's 327K-feature community-lands shapefile (~3.7GB of raw
    shp+dbf) tried to hold enough of that in RAM to get the worker process
    SIGKILLed by the OOM killer. Capping memory_limit forces DuckDB's
    buffer manager to spill to temp_directory on disk once that cap is
    hit -- slower, but it finishes instead of dying. The cap is deliberately
    well under the container's likely share of the 3.8GB total, leaving
    headroom for Postgres/MinIO/everything else running concurrently.
    """
    cfg = s3_config()
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET memory_limit='2GB';")
    con.execute("SET temp_directory='/tmp/duckdb_spill';")
    # preserve_insertion_order defaults to true, which makes large
    # COPY/ORDER-sensitive writes buffer significantly more data before
    # flushing -- disabling it was DuckDB's own suggested fix after
    # `COPY (SELECT * FROM src) TO '...parquet'` for the 327K-row LandMark
    # community-lands layer hit the memory_limit mid-write (1GB wasn't
    # enough even with the limit correctly preventing a hard OOM-kill).
    # Row order doesn't matter anywhere in this pipeline -- nothing downstream
    # depends on GeoParquet row order.
    con.execute("SET preserve_insertion_order=false;")
    con.execute(f"SET s3_endpoint='{cfg['host']}';")
    con.execute(f"SET s3_access_key_id='{cfg['access_key']}';")
    con.execute(f"SET s3_secret_access_key='{cfg['secret_key']}';")
    con.execute(f"SET s3_region='{cfg['region']}';")
    con.execute(f"SET s3_use_ssl={'true' if cfg['use_ssl'] else 'false'};")
    con.execute("SET s3_url_style='path';")
    return con


def get_pg_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)


def get_s3_client():
    cfg = s3_config()
    return boto3.client(
        "s3",
        endpoint_url=cfg["endpoint"],
        aws_access_key_id=cfg["access_key"],
        aws_secret_access_key=cfg["secret_key"],
        region_name=cfg["region"],
    )


def ensure_bucket():
    """MinIO doesn't auto-create buckets; R2 buckets are created out-of-band
    via their dashboard/API -- so this is a MinIO-only convenience, guarded
    so it's a no-op (and harmless) once pointed at a real R2 bucket.
    """
    client = get_s3_client()
    bucket = s3_config()["bucket"]
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if bucket not in existing:
        client.create_bucket(Bucket=bucket)
    return client


def s3_uri(key: str) -> str:
    return f"s3://{s3_config()['bucket']}/{key}"


def upload_file(local_path: str, key: str, public_prefix: str | None = None):
    """Binary upload (PMTiles isn't tabular, so DuckDB's COPY can't write it
    directly) -- boto3 talks plain S3 API, so this works unchanged against
    R2 too.

    `public_prefix`, when given, also grants anonymous read on that prefix
    (see set_public_read_prefix) -- pass this for anything MapLibre/pmtiles
    needs to fetch directly (tiles/, later basemap/); leave it unset for
    anything that must stay ETL-internal (raw/, curated/).
    """
    client = ensure_bucket()
    bucket = s3_config()["bucket"]
    client.upload_file(local_path, bucket, key)
    if public_prefix is not None:
        set_public_read_prefix(client, bucket, public_prefix)


def set_public_read_prefix(client, bucket: str, prefix: str):
    """Grants anonymous s3:GetObject under `prefix` -- the static-tile path
    (brief §3) means MapLibre/pmtiles range-requests this object directly
    from the store, unauthenticated, which only works if it's world-readable.
    `raw/` and `curated/` deliberately stay private -- only `tiles/` (and
    `basemap/` from Phase 1) ever get this treatment.

    Merges into whatever bucket policy already exists (keyed by Sid) instead
    of overwriting it, so adding a second public prefix later doesn't
    silently revoke this one.
    """
    sid = f"PublicRead-{prefix.rstrip('/').replace('/', '-')}"
    statement = {
        "Sid": sid,
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": f"arn:aws:s3:::{bucket}/{prefix}*",
    }
    try:
        existing = json.loads(client.get_bucket_policy(Bucket=bucket)["Policy"])
        statements = [s for s in existing.get("Statement", []) if s.get("Sid") != sid]
    except ClientError:
        statements = []
    statements.append(statement)
    client.put_bucket_policy(
        Bucket=bucket,
        Policy=json.dumps({"Version": "2012-10-17", "Statement": statements}),
    )
