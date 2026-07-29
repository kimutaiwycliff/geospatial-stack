"""Admin editing of dataset registry metadata (brief §13: sensitivity
classification, provenance/license/attribution, all "non-optional for
community/Indigenous land data" and all audit-logged). This is deliberately
narrower than a general "edit any registry.datasets column" endpoint --
`tier_status`/`serve_mode`/`schema_json`/`extent` are pipeline-owned (set by
etl/ and api/worker/tasks.py as data moves through raw -> curated ->
published) and must never be hand-edited from an admin form independently
of the actual data underneath them.
"""
from typing import Literal

from app.auth.dependencies import require_admin
from app.db import get_connection
from app.registry.audit import write_audit_log
from botocore.exceptions import ClientError
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
# worker.common has no import-time env read (get_s3_client/s3_config both
# read os.environ inside the function body, at CALL time) -- same reasoning
# uploads.py's own module docstring gives for its top-level `worker.common`
# import, so this stays a normal import rather than the function-local
# pattern `worker.tasks` needs (that one imports worker.celery_app, which
# DOES read REDIS_URL at import time).
from worker.common import get_s3_client, s3_config

router = APIRouter(prefix="/admin", tags=["governance"])

_EDITABLE_FIELDS = ("description", "source", "license", "attribution", "sensitivity")


class GovernanceUpdate(BaseModel):
    description: str | None = None
    source: str | None = None
    license: str | None = None
    attribution: str | None = None
    # Mirrors registry.sensitivity's three enum values -- a typo'd value gets
    # a 422 from pydantic here rather than surfacing as a raw Postgres
    # "invalid input value for enum" error.
    sensitivity: Literal["public", "restricted", "withheld"] | None = None


@router.get("/datasets")
def list_all_datasets(admin: dict = Depends(require_admin)):
    """Every registry row regardless of tier_status -- unlike the public
    `GET /datasets` (main.py), the admin dashboard needs to see raw/curated
    datasets too so a curator can classify sensitivity before a layer is
    ever published, not just after."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, slug, name, description, source, license, attribution,
                       sensitivity, tier_status, serve_mode, validation_report, created_at, updated_at
                FROM registry.datasets
                ORDER BY name
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows


@router.put("/datasets/{slug}/governance")
def update_governance(slug: str, update: GovernanceUpdate = Body(...), admin: dict = Depends(require_admin)):
    """Partial update: only fields present in the request body are changed
    (`exclude_unset`, not "field is None means clear it") -- a curator
    fixing just the license shouldn't accidentally null out attribution by
    omitting it from a hand-built request body."""
    fields = update.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")
    unknown = set(fields) - set(_EDITABLE_FIELDS)
    if unknown:
        raise HTTPException(status_code=400, detail=f"not editable: {sorted(unknown)}")

    set_clause = ", ".join(f"{field} = %({field})s" for field in fields)
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE registry.datasets
                SET {set_clause}
                WHERE slug = %(slug)s
                RETURNING id, slug, description, source, license, attribution, sensitivity
                """,
                {**fields, "slug": slug},
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="dataset not found")
            write_audit_log(cur, admin, "dataset.governance_updated", slug, fields)
    finally:
        conn.close()
    return row


def _delete_object_storage_for(slug: str) -> None:
    """Best-effort cleanup of everything a dataset's pipeline may have
    written to object storage: raw/curated GeoParquet, a PMTiles archive (if
    it was ever published with serve_mode='pmtiles'), and the self-service
    upload flow's original source file(s) under `uploads/{slug}/`.

    Deliberately swallows a missing key rather than treating it as an
    error -- a dataset deleted while still `tier_status='raw'` never had
    curated/tiles objects to begin with, and that's the expected case here,
    not a failure. Called AFTER the registry row's own transaction commits
    (see delete_dataset) since none of this is transactional with Postgres
    anyway -- a rolled-back DB delete couldn't have undone an S3 delete
    either way, so there's no correctness reason to interleave them.
    """
    client = get_s3_client()
    bucket = s3_config()["bucket"]

    for key in (f"raw/{slug}.parquet", f"curated/{slug}.parquet", f"tiles/{slug}.pmtiles"):
        try:
            client.delete_object(Bucket=bucket, Key=key)
        except ClientError:
            pass

    try:
        listed = client.list_objects_v2(Bucket=bucket, Prefix=f"uploads/{slug}/")
        keys = [{"Key": obj["Key"]} for obj in listed.get("Contents", [])]
        if keys:
            client.delete_objects(Bucket=bucket, Delete={"Objects": keys})
    except ClientError:
        pass


@router.delete("/datasets/{slug}")
def delete_dataset(slug: str, admin: dict = Depends(require_admin)):
    """Deletes a dataset's registry row AND everything its pipeline
    produced, regardless of `tier_status` -- 'raw' (still validating),
    'curated' (validation failed OR passed and awaiting approval), and
    'published' all delete the same way. Deliberately NOT gated on
    validation outcome: an admin discarding a failed upload to retry under
    the same name needs this to work exactly as well as retiring a stale
    published layer.

    Lives in this router (not uploads.py or its own file) because it
    operates on the same `/admin/datasets/{slug}` resource `update_governance`
    above already does, even though -- unlike that endpoint -- this isn't a
    metadata edit; there's no other existing home for a dataset-lifecycle
    operation this narrow.

    `registry.layer_styles` cascades automatically (`ON DELETE CASCADE`, see
    db/schema.sql). Any Map whose `layers_json` referenced this slug is left
    as-is -- maps.py's `get_published_map` already filters `layers_json`
    down to currently-published dataset slugs at read time, so a dangling
    reference to a deleted dataset just silently stops rendering that one
    layer instead of needing a cross-table cleanup here.
    """
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "SELECT name, tier_status, serve_mode FROM registry.datasets WHERE slug = %s",
                (slug,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="dataset not found")

            # Written INSIDE this transaction, before the DELETE -- but
            # audit_log.dataset_slug has no FK to registry.datasets (see
            # db/schema.sql), so this row survives the dataset's own removal
            # on purpose: "who deleted what, when" has to outlive the thing
            # it's about.
            write_audit_log(
                cur,
                admin,
                "dataset.deleted",
                slug,
                {"name": row["name"], "tier_status": row["tier_status"], "serve_mode": row["serve_mode"]},
            )

            if row["tier_status"] == "published":
                table = slug.replace("-", "_")
                cur.execute(f'DROP TABLE IF EXISTS published."{table}"')

            cur.execute("DELETE FROM registry.datasets WHERE slug = %s", (slug,))
    finally:
        conn.close()

    _delete_object_storage_for(slug)
    return {"slug": slug, "deleted": True}


@router.get("/audit-log")
def list_audit_log(dataset_slug: str | None = None, limit: int = 100, admin: dict = Depends(require_admin)):
    """Read side of brief §13's audit trail requirement -- backs an admin
    "history" view. `limit` capped at 500 so a bare `?limit=999999` from the
    UI can't turn this into an unbounded table scan; audit_log has no
    pagination cursor yet since nothing has needed to page past one screen."""
    limit = min(limit, 500)
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, actor_email, action, dataset_slug, details, created_at
                FROM registry.audit_log
                WHERE %(dataset_slug)s::text IS NULL OR dataset_slug = %(dataset_slug)s
                ORDER BY created_at DESC
                LIMIT %(limit)s
                """,
                {"dataset_slug": dataset_slug, "limit": limit},
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows
