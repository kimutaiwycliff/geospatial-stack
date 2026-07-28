"""Minimal S3 helper for the basemap build -- deliberately its own small
copy (not imported from api/worker/common.py) because this lives in its own
Docker build context (needs go-pmtiles, not Python/DuckDB), same rationale
as tiles/build/common.py in Phase 0.
"""
import json
import os

import boto3
from botocore.exceptions import ClientError


def s3_config():
    endpoint = os.environ["S3_ENDPOINT"]
    return {
        "endpoint": endpoint,
        "access_key": os.environ["S3_ACCESS_KEY"],
        "secret_key": os.environ["S3_SECRET_KEY"],
        "bucket": os.environ["S3_BUCKET"],
        "region": os.environ["S3_REGION"],
    }


def get_s3_client():
    cfg = s3_config()
    return boto3.client(
        "s3",
        endpoint_url=cfg["endpoint"],
        aws_access_key_id=cfg["access_key"],
        aws_secret_access_key=cfg["secret_key"],
        region_name=cfg["region"],
    )


def set_public_read_prefix(client, bucket: str, prefix: str):
    """Same mechanism as worker/common.py's helper of the same name -- the
    basemap has to be anonymously fetchable by MapLibre/pmtiles-js directly
    from the browser, exactly like the tiles/ prefix."""
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


def upload_file(local_path: str, key: str, public_prefix: str | None = None):
    client = get_s3_client()
    cfg = s3_config()
    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if cfg["bucket"] not in existing:
        client.create_bucket(Bucket=cfg["bucket"])
    client.upload_file(local_path, cfg["bucket"], key)
    if public_prefix is not None:
        set_public_read_prefix(client, cfg["bucket"], public_prefix)
