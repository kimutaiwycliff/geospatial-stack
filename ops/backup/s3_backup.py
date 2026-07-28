"""Object-store backup (brief §2.2): copies every object in the live bucket
to a separate backup bucket, via the same plain S3 API every other part of
this stack uses -- no MinIO-specific mirror tool, so this works unchanged
against R2 too (same portability rule as brief §2.1).

Run via the worker image (already has boto3 + the S3_* env vars):
    docker run --rm --network geospatial_stack_default --env-file .env \
        -v "$(pwd)/ops/backup:/backup" geospatial_stack-worker \
        python3 /backup/s3_backup.py

Copies server-side (S3 CopyObject), not download-then-upload -- for a
multi-hundred-MB PMTiles archive that's the difference between one API call
and moving gigabytes through this process's own network stack.
"""
import os
import sys

import boto3


def s3_client():
    endpoint = os.environ["S3_ENDPOINT"]
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        region_name=os.environ["S3_REGION"],
    )


def main(backup_bucket: str):
    client = s3_client()
    source_bucket = os.environ["S3_BUCKET"]

    existing = {b["Name"] for b in client.list_buckets().get("Buckets", [])}
    if backup_bucket not in existing:
        client.create_bucket(Bucket=backup_bucket)

    paginator = client.get_paginator("list_objects_v2")
    copied = 0
    for page in paginator.paginate(Bucket=source_bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            client.copy_object(
                Bucket=backup_bucket,
                Key=key,
                CopySource={"Bucket": source_bucket, "Key": key},
            )
            copied += 1
            print(f"s3_backup: copied {key}")

    print(f"s3_backup: {copied} objects copied from {source_bucket} to {backup_bucket}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "geoplatform-backup")
