"""Live styling, draft -> publish (brief §6.3). Layers are addressed by
dataset SLUG here, not the `registry.layer_styles.dataset_id` UUID -- every
other public/admin-facing route in this API (get_feature, list_datasets)
already keys off slug, and the frontend (web/src/lib/api.ts's Dataset type)
never learns a dataset's UUID at all, so slug is the one identifier both
sides of the wire already agree on. Routes below resolve slug -> UUID
against registry.datasets internally.

Endpoints (brief §6.3, adapted from `{id}` to `{slug}` per the above):
  GET  /styles/published            -- public
  GET  /admin/styles/draft          -- admin
  PUT  /admin/layers/{slug}/style   -- admin, upsert draft style_json
  POST /admin/layers/{slug}/publish -- admin, draft -> published
"""
import json

from app.auth.dependencies import require_admin
from app.db import get_connection
from app.registry.audit import write_audit_log
from fastapi import APIRouter, Body, Depends, HTTPException

router = APIRouter(tags=["styles"])


def _dataset_id_for_slug(cur, slug: str) -> str:
    cur.execute("SELECT id FROM registry.datasets WHERE slug = %s", (slug,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="dataset not found")
    return row["id"]


@router.get("/styles/published")
def list_published_styles():
    """Public: every dataset's published style_json, keyed by slug. The map
    (MapView.tsx) loads this once alongside /datasets and applies
    `style_json` via setPaintProperty -- a dataset with no published style
    row yet just falls back to mapSources.ts's hardcoded palette, so this
    endpoint only needs to return what's actually been styled."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.slug, ls.style_json, ls.version
                FROM registry.layer_styles ls
                JOIN registry.datasets d ON d.id = ls.dataset_id
                WHERE ls.status = 'published'
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows


@router.get("/admin/styles/draft", dependencies=[Depends(require_admin)])
def list_draft_styles():
    """Admin: every dataset's current draft (or none, if nobody's touched
    that layer's styling yet) -- backs the styling panel's initial load,
    one request for every layer rather than one round-trip per layer."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.slug, ls.style_json, ls.version, ls.updated_by, ls.updated_at
                FROM registry.layer_styles ls
                JOIN registry.datasets d ON d.id = ls.dataset_id
                WHERE ls.status = 'draft'
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows


@router.put("/admin/layers/{slug}/style")
def upsert_draft_style(slug: str, style_json: dict = Body(..., embed=True), admin: dict = Depends(require_admin)):
    """Upserts the ONE draft row for this dataset (unique on (dataset_id,
    'draft') per the migration's index) -- editing style is always "replace
    my current draft", never "create another draft", so ON CONFLICT here
    doubles as the whole save flow with no separate create-vs-update branch."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            dataset_id = _dataset_id_for_slug(cur, slug)
            cur.execute(
                """
                INSERT INTO registry.layer_styles (dataset_id, status, style_json, updated_by, version)
                VALUES (%(dataset_id)s, 'draft', %(style_json)s, %(updated_by)s, 1)
                ON CONFLICT (dataset_id, status) DO UPDATE
                    SET style_json = EXCLUDED.style_json,
                        updated_by = EXCLUDED.updated_by,
                        version = registry.layer_styles.version + 1
                RETURNING style_json, version
                """,
                {"dataset_id": dataset_id, "style_json": json.dumps(style_json), "updated_by": admin["id"]},
            )
            result = cur.fetchone()
            write_audit_log(cur, admin, "style.draft_saved", slug, {"style_json": style_json})
    finally:
        conn.close()
    return result


@router.post("/admin/layers/{slug}/publish")
def publish_style(slug: str, admin: dict = Depends(require_admin)):
    """"Roll out": copies the draft's style_json into the published row
    (brief §6.3) -- the draft row itself is left untouched so the curator
    can keep iterating on it immediately after publishing, rather than
    needing to recreate a draft from scratch every time."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            dataset_id = _dataset_id_for_slug(cur, slug)
            cur.execute(
                "SELECT style_json FROM registry.layer_styles WHERE dataset_id = %s AND status = 'draft'",
                (dataset_id,),
            )
            draft = cur.fetchone()
            if draft is None:
                raise HTTPException(status_code=404, detail="no draft style to publish for this layer")

            cur.execute(
                """
                INSERT INTO registry.layer_styles (dataset_id, status, style_json, updated_by, version)
                VALUES (%(dataset_id)s, 'published', %(style_json)s, %(updated_by)s, 1)
                ON CONFLICT (dataset_id, status) DO UPDATE
                    SET style_json = EXCLUDED.style_json,
                        updated_by = EXCLUDED.updated_by,
                        version = registry.layer_styles.version + 1
                RETURNING style_json, version
                """,
                {"dataset_id": dataset_id, "style_json": json.dumps(draft["style_json"]), "updated_by": admin["id"]},
            )
            result = cur.fetchone()
            write_audit_log(cur, admin, "style.published", slug, {"style_json": draft["style_json"]})
    finally:
        conn.close()
    return result
