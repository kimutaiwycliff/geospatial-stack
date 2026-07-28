"""Self-service upload -> validate -> curator-approve -> publish (brief
§16 steps 1-6). Reuses the SAME worker task chain Phase 0/1 built for
engineer-triggered ingestion (worker/tasks.py) -- this router's whole job
is to be the curator-facing front door onto that chain: accept a file,
create the draft registry row, dispatch the validate-only chain
(`run_upload_pipeline`), let the curator poll/review the report, and only
then dispatch the publish chain (`run_publish_pipeline`) on explicit
approval.

Format support is intentionally narrower than the brief's full list
(Shapefile zip / GeoJSON / GPKG / GeoParquet / CSV+geom): DuckDB's ST_Read
takes GeoJSON/GPKG/GeoParquet directly from an S3 URI with zero extra
plumbing (same as every engineer-triggered ingest so far); a zipped
Shapefile needs GDAL's /vsizip/ chaining and CSV+geom needs a geometry-
column-detection step, neither of which exists yet. Curators uploading
those get a clear 400 telling them so, not a confusing worker-side failure
three steps into a chain they can't see into.
"""
import os
import tempfile

from app.auth.dependencies import require_admin
from app.db import get_connection
from app.registry.audit import write_audit_log
from app.registry.slugs import slugify
from fastapi import APIRouter, Body, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel
from worker.common import s3_uri, upload_file

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

# DuckDB ST_Read handles these straight off an s3:// URI (brief §16 step 1,
# scoped down per this module's docstring above).
_ALLOWED_EXTENSIONS = {".geojson", ".json", ".gpkg", ".parquet"}


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
        content = await file.read()
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
    # Literal["pmtiles"] only -- see load_postgis_task's docstring
    # (worker/tasks.py) for why Martin isn't offered here yet.
    serve_mode: str = "pmtiles"


@router.post("/{slug}/approve")
def approve_upload(slug: str, body: ApproveRequest = Body(default=ApproveRequest()), admin: dict = Depends(require_admin)):
    """brief §16 steps 4-6, the curator's explicit "yes, publish this"
    action -- gated on contract_test_task having actually run and passed,
    not on tier_status alone (curate_task already flips tier_status to
    'curated' before contract_test_task even runs, so tier_status by
    itself can't distinguish "validated" from "not yet checked")."""
    if body.serve_mode != "pmtiles":
        raise HTTPException(status_code=400, detail="self-service publishing only supports serve_mode='pmtiles' for now")

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
