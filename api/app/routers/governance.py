"""Admin editing of dataset registry metadata (brief §13: sensitivity
classification, provenance/license/attribution, all "non-optional for
community/Indigenous land data" and all audit-logged). This is deliberately
narrower than a general "edit any registry.datasets column" endpoint --
`tier_status`/`serve_mode`/`schema_json`/`extent` are pipeline-owned (set by
etl/ and api/worker/tasks.py as data moves through raw -> curated ->
published) and must never be hand-edited from an admin form independently
of the actual data underneath them.
"""
import json
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
    ever published, not just after.

    `schema_json` (column names -> DuckDB type strings, set once by
    ingest_task's `_schema_json` for every dataset regardless of how it was
    ingested) rides along here so the styling panel can offer a real
    "which field is the label" dropdown instead of a free-text input a
    curator could typo -- this is the one universal source of "what
    attributes does this dataset actually have," unlike validation_report's
    `fields`, which is only populated for self-service uploads.

    `extent` (as GeoJSON, same `ST_AsGeoJSON` cast the public `/datasets`
    endpoint already uses) lets Map authoring's "fit to included layers"
    button (brief follow-up: "centroid and zoom levels set automatically
    based on the bounds of the dataset") compute a default view without a
    live MapLibre preview to ask -- MapEditor has never had one of those,
    by design (see its own module docstring)."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, slug, name, description, source, license, attribution,
                       sensitivity, tier_status, serve_mode, validation_report, schema_json,
                       ST_AsGeoJSON(extent) AS extent, created_at, updated_at
                FROM registry.datasets
                ORDER BY name
                """
            )
            rows = cur.fetchall()
            for row in rows:
                if row["extent"] is not None:
                    row["extent"] = json.loads(row["extent"])
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


@router.get("/datasets/{slug}/field-values")
def list_distinct_field_values(slug: str, field: str, admin: dict = Depends(require_admin)):
    """Distinct values for one column of a PUBLISHED dataset -- backs Map
    authoring's filter editor (brief follow-up: "the allowable ones I
    should just be choosing from unique fields," not hand-typing them).

    Requires `tier_status = 'published'`: a filter only makes sense on data
    actually rendered on a map, and only a published dataset has a
    `published.<table>` to query values from at all -- raw/curated tiers
    live as GeoParquet in object storage, not queryable SQL tables.

    `field` can't be parameterized (it's a column name, not a value) --
    validated against the dataset's own `schema_json` FIRST, so only a
    column that genuinely exists on this table's own registry record can
    ever reach the f-string below. Same "column names come from a
    curator-controlled schema, not public input" trust boundary
    worker/tasks.py's own load_postgis_task/contract_test_task already
    rely on for their own column-name interpolation.
    """
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT tier_status, schema_json FROM registry.datasets WHERE slug = %s", (slug,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="dataset not found")
            if row["tier_status"] != "published":
                raise HTTPException(status_code=400, detail="dataset is not published yet")

            schema = row["schema_json"] or {}
            if field == "bbox" or field not in schema:
                raise HTTPException(status_code=400, detail=f"'{field}' is not a real column on this dataset")

            table = slug.replace("-", "_")
            # LIMIT 500: a genuinely high-cardinality column (an ID, a free-
            # text note) isn't a sensible filter field anyway -- this caps
            # the query and gives the admin a clear signal (a truncated,
            # clearly-not-a-category list) rather than a slow unbounded scan.
            cur.execute(
                f'SELECT DISTINCT "{field}"::text AS value FROM published."{table}" '
                f'WHERE "{field}" IS NOT NULL ORDER BY 1 LIMIT 500'
            )
            values = [r["value"] for r in cur.fetchall()]
    finally:
        conn.close()
    return {"values": values}


class ServeModeUpdate(BaseModel):
    serve_mode: Literal["pmtiles", "martin"]


@router.post("/datasets/{slug}/serve-mode")
def update_serve_mode(slug: str, body: ServeModeUpdate, admin: dict = Depends(require_admin)):
    """Changes an ALREADY-PUBLISHED dataset's serve mode (brief follow-up:
    "I can later change how I would want a dataset should be served
    whether by pmtiles or martin tiles") -- previously a one-time choice
    made at initial publish, with no way back.

    Switching TO martin is immediate: tiles/martin/config.yaml's
    auto_publish already discovers every table in `published` regardless
    of this column's value (see that file's own comment), so `martin`
    tiles for this dataset are already being served -- this just tells the
    frontend (mapSources.ts's buildVectorSource) to actually request them
    that way instead of from a PMTiles archive.

    Switching TO pmtiles needs a real build: if no `.pmtiles` archive
    exists yet (true for any dataset originally published with
    serve_mode='martin', which never ran build_pmtiles_task), one has to
    be built before the frontend can be pointed at it. `serve_mode` is
    updated immediately either way, matching the same "optimistic, tiles
    catch up asynchronously" pattern the original publish flow already
    uses (load_postgis_task sets serve_mode before build_pmtiles_task, its
    OWN following chain step, has even started).
    """
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT tier_status FROM registry.datasets WHERE slug = %s", (slug,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="dataset not found")
            if row["tier_status"] != "published":
                raise HTTPException(status_code=400, detail="dataset is not published yet")

            cur.execute(
                "UPDATE registry.datasets SET serve_mode = %s WHERE slug = %s",
                (body.serve_mode, slug),
            )
            write_audit_log(cur, admin, "dataset.serve_mode_changed", slug, {"serve_mode": body.serve_mode})
    finally:
        conn.close()

    if body.serve_mode == "pmtiles":
        from worker.tasks import build_pmtiles_task

        # `None` for `prev_result` -- this dispatch has no chain predecessor
        # to auto-fill it, same reasoning as run_publish_pipeline's own
        # standalone use of this task (worker/tasks.py). A harmless re-build
        # if a `.pmtiles` archive already exists (e.g. flipping back and
        # forth) -- upload_file's overwrite is idempotent.
        build_pmtiles_task.delay(None, slug)

    return {"slug": slug, "serve_mode": body.serve_mode}
