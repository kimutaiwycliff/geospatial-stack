"""S3 helpers for the tile-build step. Deliberately duplicated (not shared
with etl/pipelines/common.py) because this lives in its own Docker build
context (it needs a compiled tippecanoe, the etl image doesn't) -- sharing
a module across two independent build contexts would mean either a bind
mount at build time or a shared base image, more machinery than two small
functions justify at this scale.
"""
import json
import os

import boto3
import duckdb
from botocore.exceptions import ClientError


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


def s3_uri(key: str) -> str:
    return f"s3://{s3_config()['bucket']}/{key}"


def get_s3_client():
    cfg = s3_config()
    return boto3.client(
        "s3",
        endpoint_url=cfg["endpoint"],
        aws_access_key_id=cfg["access_key"],
        aws_secret_access_key=cfg["secret_key"],
        region_name=cfg["region"],
    )


def upload_file(local_path: str, key: str, public_prefix: str | None = None):
    """Binary upload (PMTiles isn't tabular, so DuckDB's COPY can't write it
    directly) -- boto3 talks plain S3 API, so this works unchanged against
    R2 too.

    `public_prefix`, when given, also grants anonymous read on that prefix
    (see set_public_read_prefix) -- callers pass this for anything MapLibre/
    pmtiles needs to fetch directly (tiles/, later basemap/), and leave it
    unset for anything that must stay ETL-internal (raw/, curated/ -- not
    uploaded from this module today, but the default keeps it that way).
    """
    cfg = s3_config()
    client = get_s3_client()
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if cfg["bucket"] not in existing:
        client.create_bucket(Bucket=cfg["bucket"])
    client.upload_file(local_path, cfg["bucket"], key)
    if public_prefix is not None:
        set_public_read_prefix(client, cfg["bucket"], public_prefix)


def set_public_read_prefix(client, bucket: str, prefix: str):
    """Grants anonymous s3:GetObject under `prefix` -- the whole point of the
    static-tile path (brief §3) is that MapLibre/the pmtiles JS lib range-
    -requests this object directly from the store over plain HTTP, no API or
    DB hit involved, which only works if the object is world-readable.
    `raw/` and `curated/` deliberately stay private (ETL-only access) --
    only `tiles/` (and `basemap/` from Phase 1) ever get this treatment.

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
