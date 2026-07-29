"""Self-service upload -> validate -> curator-approve -> publish (brief
§16 steps 1-6). Reuses the SAME worker task chain Phase 0/1 built for
engineer-triggered ingestion (worker/tasks.py) -- this router's whole job
is to be the curator-facing front door onto that chain: accept a file,
create the draft registry row, dispatch the validate-only chain
(`run_upload_pipeline`), let the curator poll/review the report, and only
then dispatch the publish chain (`run_publish_pipeline`) on explicit
approval.

Format support is intentionally narrower than the brief's full list
(Shapefile zip / GeoJSON / GPKG / GeoParquet / CSV+geom / KML): DuckDB's
ST_Read takes GeoJSON/GPKG/GeoParquet directly from an S3 URI with zero
extra plumbing (same as every engineer-triggered ingest so far), and KML
the exact same way (GDAL's KML driver reads a plain .kml over http(s)/s3
with no chaining needed -- verified directly against this repo's pinned
duckdb==1.5.5 spatial build before relying on it here). A zipped Shapefile
(or KMZ, which is just a zip containing one .kml) needs GDAL's `/vsizip/`
chaining instead -- see ingest_task's `_resolved_source` in worker/tasks.py
for that. CSV+geom needs a geometry-column-detection step that doesn't
exist yet, so that one still gets a clear 400 rather than a confusing
worker-side failure three steps into a chain the curator can't see into.
"""
import io
import os
import tempfile
import zipfile
from typing import Literal

from app.auth.dependencies import require_admin
from app.db import get_connection
from app.registry.audit import write_audit_log
from app.registry.slugs import slugify
from fastapi import APIRouter, Body, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel
from worker.common import is_macos_zip_artifact, s3_uri, upload_file

router = APIRouter(prefix="/admin/uploads", tags=["uploads"])

# worker.tasks (and therefore this module) is imported lazily, function-local,
# NOT at module level: worker.tasks imports worker.celery_app, which reads
# REDIS_URL at IMPORT time (`Celery(..., broker=os.environ["REDIS_URL"])`).
# A top-level import here would make importing app.main require REDIS_URL to
# be set just to load the module -- breaking test_healthz.py's documented
# invariant that importing app.main needs zero env config (see app/db.py's
# get_connection docstring for the same principle applied to DATABASE_URL).
# worker.common has no such import-time env read, so it stays a normal
# top-level import above.

# DuckDB ST_Read handles geojson/json/gpkg/parquet/kml straight off an s3://
# URI with no extra work (brief §16 step 1); .zip/.kmz need the archive
# member -- checked for below, and later re-derived by ingest_task itself to
# build the actual `/vsizip/...` read path (see worker/tasks.py).
_ALLOWED_EXTENSIONS = {".geojson", ".json", ".gpkg", ".parquet", ".kml", ".zip", ".kmz"}

# Which inner file each archive format must contain -- a zip with no .shp
# (or a kmz with no .kml) is a curator mistake worth a clear 400 right here,
# rather than a worker-side `ST_Read` failure on a path that was never going
# to resolve to anything (see ingest_task's identical suffix-search, which
# trusts this check already ran and only needs to find the SAME member
# again to build its explicit `/vsizip/archive.zip/inner/path` read path --
# GDAL's own vsizip auto-detection only finds a single-layer archive when
# the target file sits at the zip's root, not inside a subfolder, which is
# a common mistake when zipping a Shapefile's sidecar files from a file
# manager rather than `zip file.zip *.shp *.dbf ...` from inside the folder).
_ARCHIVE_INNER_SUFFIX = {".zip": ".shp", ".kmz": ".kml"}


@router.post("")
async def create_upload(
    file: UploadFile,
    name: str = Form(...),
    description: str | None = Form(None),
    admin: dict = Depends(require_admin),
):
    """brief §16 steps 1-2: stores the file, creates a draft registry row
    (tier_status='raw', sensitivity='withheld' -- the schema's own most-
    protective default, made explicit here rather than left implicit),
    and enqueues validation. Returns immediately with the slug to poll --
    see run_upload_pipeline's docstring for why this must never block on
    the chain finishing (a 330K-row LandMark-sized upload can take minutes)."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported file type '{ext}' -- self-service upload accepts {sorted(_ALLOWED_EXTENSIONS)}",
        )

    # Read once, up front -- both the archive-content check right below and
    # the S3 upload further down need the actual bytes, and `UploadFile` is a
    # single-read stream (reading it twice without seeking back to 0 would
    # just return empty the second time).
    content = await file.read()

    inner_suffix = _ARCHIVE_INNER_SUFFIX.get(ext)
    if inner_suffix is not None:
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                # is_macos_zip_artifact excludes __MACOSX/._real_file stubs --
                # without it, a zip containing ONLY macOS Finder's resource-
                # fork placeholders (no real .shp/.kml at all) would pass this
                # check, then fail confusingly deep in the worker instead of
                # with a clear 400 right here.
                has_member = any(
                    n.lower().endswith(inner_suffix) and not is_macos_zip_artifact(n) for n in zf.namelist()
                )
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail=f"'{file.filename}' is not a valid {ext} archive")
        if not has_member:
            raise HTTPException(
                status_code=400,
                detail=f"no {inner_suffix} file found inside the uploaded {ext} archive",
            )

    try:
        slug = slugify(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM registry.datasets WHERE slug = %s", (slug,))
            if cur.fetchone() is not None:
                raise HTTPException(status_code=409, detail=f"a dataset with slug '{slug}' already exists")

            cur.execute(
                """
                INSERT INTO registry.datasets (name, slug, description, sensitivity, tier_status, created_by)
                VALUES (%s, %s, %s, 'withheld', 'raw', %s)
                """,
                (name, slug, description, admin["email"]),
            )
            write_audit_log(cur, admin, "dataset.upload_started", slug, {"filename": file.filename})
    finally:
        conn.close()

    # Streamed to a local temp file first, then uploaded to object storage --
    # `api` and `worker` are separate containers with no shared writable
    # volume (docker-compose.yml only mounts ./data read-only on `worker`),
    # so a plain local path here would be invisible to the task that reads
    # it. `uploads/` (not `raw/`) because ingest_task's OWN job is producing
    # the real `raw/{slug}.parquet` -- this key is the as-uploaded source
    # file ingest_task reads FROM, one step earlier than `raw/` in the
    # medallion sense, and is never public (no public_prefix, same as
    # raw/curated).
    upload_key = f"uploads/{slug}/{file.filename}"
    with tempfile.NamedTemporaryFile(suffix=ext) as tmp:
        tmp.write(content)
        tmp.flush()
        upload_file(tmp.name, upload_key)

    from worker.tasks import run_upload_pipeline

    run_upload_pipeline(s3_uri(upload_key), slug)
    return {"slug": slug, "tier_status": "raw"}


@router.get("/{slug}/status")
def upload_status(slug: str, admin: dict = Depends(require_admin)):
    """Polling target for the admin UI while validation runs -- same shape
    as governance's dataset read, plus `validation_report` (null until
    contract_test_task finishes, one way or the other)."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT slug, name, description, source, license, attribution,
                       sensitivity, tier_status, serve_mode, validation_report
                FROM registry.datasets WHERE slug = %s
                """,
                (slug,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="dataset not found")
    return row


class ApproveRequest(BaseModel):
    # Both real options now (brief follow-up: "give the admin [the choice]
    # whether it will be from the pmtiles or martin dynamic tiles") --
    # Martin used to be excluded here because a newly-published table had
    # no way to become tile-servable without a manual config.yaml edit and
    # a container restart. tiles/martin/config.yaml now auto-discovers
    # every table in the `published` schema on a 30s interval, so a
    # serve_mode='martin' approval just needs load_postgis_task to create
    # the table -- Martin picks it up on its own from there.
    serve_mode: Literal["pmtiles", "martin"] = "pmtiles"


@router.post("/{slug}/approve")
def approve_upload(slug: str, body: ApproveRequest = Body(default=ApproveRequest()), admin: dict = Depends(require_admin)):
    """brief §16 steps 4-6, the curator's explicit "yes, publish this"
    action -- gated on contract_test_task having actually run and passed,
    not on tier_status alone (curate_task already flips tier_status to
    'curated' before contract_test_task even runs, so tier_status by
    itself can't distinguish "validated" from "not yet checked")."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT validation_report FROM registry.datasets WHERE slug = %s", (slug,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="dataset not found")
            report = row["validation_report"]
            if report is None:
                raise HTTPException(status_code=400, detail="validation hasn't finished yet -- check upload status")
            if not report.get("passed"):
                raise HTTPException(status_code=400, detail={"message": "validation failed, cannot approve", "errors": report.get("errors")})

            write_audit_log(cur, admin, "dataset.publish_requested", slug, {"serve_mode": body.serve_mode})
    finally:
        conn.close()

    from worker.tasks import run_publish_pipeline

    run_publish_pipeline(slug, body.serve_mode)
    return {"slug": slug, "status": "publish_requested"}
