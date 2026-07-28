"""Shared connection helpers for every pipeline step.

Centralized here so each step (ingest/curate/load) configures DuckDB's S3
credentials identically -- a mismatch between steps (e.g. one script using
virtual-hosted-style URLs) is exactly the kind of bug that only shows up
once you swap MinIO for R2, so it's worth getting the config in one place.
"""
import os

import boto3
import duckdb
import psycopg2


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
    """
    cfg = s3_config()
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute(f"SET s3_endpoint='{cfg['host']}';")
    con.execute(f"SET s3_access_key_id='{cfg['access_key']}';")
    con.execute(f"SET s3_secret_access_key='{cfg['secret_key']}';")
    con.execute(f"SET s3_region='{cfg['region']}';")
    con.execute(f"SET s3_use_ssl={'true' if cfg['use_ssl'] else 'false'};")
    con.execute("SET s3_url_style='path';")
    return con


def get_pg_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"])


def ensure_bucket():
    """MinIO doesn't auto-create buckets; R2 buckets are created out-of-band
    via their dashboard/API -- so this is a MinIO-only convenience, guarded
    so it's a no-op (and harmless) once pointed at a real R2 bucket.
    """
    cfg = s3_config()
    client = boto3.client(
        "s3",
        endpoint_url=cfg["endpoint"],
        aws_access_key_id=cfg["access_key"],
        aws_secret_access_key=cfg["secret_key"],
        region_name=cfg["region"],
    )
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if cfg["bucket"] not in existing:
        client.create_bucket(Bucket=cfg["bucket"])
    return client


def s3_uri(key: str) -> str:
    return f"s3://{s3_config()['bucket']}/{key}"
