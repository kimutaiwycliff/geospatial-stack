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
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

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
                       sensitivity, tier_status, serve_mode, created_at, updated_at
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
