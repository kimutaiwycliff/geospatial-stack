# R2 portability validation (brief §2.1)

**Claim being tested:** every object-storage call in this stack goes through
the plain S3 API and reads its endpoint/credentials/bucket/region from five
env vars (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`,
`S3_REGION`) — so pointing the whole pipeline at Cloudflare R2 instead of the
self-hosted MinIO container should need zero code changes, only a `.env` edit.

**Why validated against a second MinIO instance, not real R2:** this
environment has no Cloudflare account/credentials to test against. A second,
independent MinIO container (different bucket, different access key, on the
same Docker network) is a faithful stand-in for "a different S3-compatible
provider" for the purpose of this test, since the code path is identical
either way — `boto3`/DuckDB's `httpfs` extension talk to whatever
`S3_ENDPOINT` says, with no MinIO-specific SDK calls anywhere in this repo.

## What was run

```
docker run -d --name mock-r2 --network geospatial_stack_default \
  -e MINIO_ROOT_USER=mockr2accesskey \
  -e MINIO_ROOT_PASSWORD=mockr2secretkey \
  minio/minio:latest server /data --console-address ":9001"
```

Then the full, **unmodified** ingest pipeline (`ingest_task` -> `curate_task`
-> `contract_test_task` -> `load_postgis_task`, `api/worker/tasks.py`) for
the `kenya-admin1-provinces` fixture, via `docker run` env overrides only —
no source file touched:

```
docker run --rm --network geospatial_stack_default \
  --env-file .env \
  -e S3_ENDPOINT=http://mock-r2:9000 \
  -e S3_ACCESS_KEY=mockr2accesskey \
  -e S3_SECRET_KEY=mockr2secretkey \
  -e S3_BUCKET=geoplatform-r2-test \
  -e S3_REGION=auto \
  -v "$(pwd)/data:/data:ro" \
  geospatial_stack-worker python3 -c "<run the four tasks in sequence>"
```

## Result

All four steps succeeded, reading/writing GeoParquet against
`geoplatform-r2-test` on the alternate endpoint instead of the default
bucket, with the exact same code:

```
ingest:        8 rows -> s3://geoplatform-r2-test/raw/kenya-admin1-provinces.parquet
curate:        8 rows, 0 invalid geometries repaired
contract_test: 8 rows, passed
load_postgis:  8 rows -> published.kenya_admin1_provinces
```

Since the full chain (including `load_postgis_task`) ran, the registry row
ended back at `tier_status=published` -- the same state it started in, so
this test left no side effects on the live dataset.

## Applying this to real Cloudflare R2

Swap these five vars in `.env` (no code changes, no MinIO container needed):

```
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY=<r2 access key id>
S3_SECRET_KEY=<r2 secret access key>
S3_BUCKET=<r2 bucket name>
S3_REGION=auto
```

R2 buckets are created out-of-band via the Cloudflare dashboard/API
(`ensure_bucket()` in `api/worker/common.py` is a MinIO-only convenience --
harmless no-op against R2 once the bucket already exists, per its own
docstring). Drop the `storage` service from `docker-compose.yml` entirely
once R2 is the target -- nothing else depends on MinIO specifically.
