"""Map authoring (brief §16 second half): "a Map (project) is config, not
code... because a Map is just stored config over registry layers, 'create
a new map' needs no engineering." This router is that config's CRUD +
publish surface -- there is no worker task involved anywhere here (unlike
uploads.py), since nothing about saving a Map touches the pipeline.

Unlike registry.layer_styles' separate draft/published ROWS (brief §6.3,
so a curator can keep editing a draft after publishing), a Map has exactly
one row with a `status` column: publishing it just flips that column, and
every subsequent PUT edits the SAME row whether it's currently draft or
published -- editing an already-published map takes effect immediately.
That's a deliberate difference from styles, not an oversight: a Map's
"draft" state is about "not yet given a public route" (brief §16: "the map
gets a public route/slug"), not about hiding in-progress edits from a
version already live -- styles has that second need (client-side repaint
independent of admin edits), Maps doesn't.
"""
import json
from typing import Literal

from app.auth.dependencies import require_admin
from app.db import get_connection
from app.registry.audit import write_audit_log
from app.registry.slugs import slugify
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

# Security audit finding: PopupStyle's color fields used to accept any
# plain `str` with no validation, then went straight into an HTML `style=`
# attribute client-side (MapBySlugPage.tsx's buildFeatureHtml) with no
# escaping -- an admin/curator account setting e.g. background_color to
# `red;"><script>...</script>` was a genuine stored-XSS path against every
# public visitor of that Map. A hex-color pattern rejects anything that
# isn't actually a color at the API boundary (Pydantic validates on
# write), which is a stronger guarantee than escaping client-side alone
# (defense in depth, not a replacement -- MapBySlugPage.tsx's own
# escapeHtml still covers feature *data* values, a separate input).
_HEX_COLOR_PATTERN = r"^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$"

router = APIRouter(tags=["maps"])


class PopupStyle(BaseModel):
    """"How they should look" (brief follow-up) -- single-value styling for
    a layer's popup/hover tooltip, same "one value applied uniformly"
    philosophy as StylePanel's fill/line/label controls (no per-field
    theming, no rich text)."""

    background_color: str = Field(default="#ffffff", pattern=_HEX_COLOR_PATTERN)
    text_color: str = Field(default="#111111", pattern=_HEX_COLOR_PATTERN)
    border_color: str = Field(default="#e5e7eb", pattern=_HEX_COLOR_PATTERN)
    # Bounded ranges, not just "an int" -- a popup card is never usefully
    # 0px or 500px of border-radius/font-size; the ceiling also keeps a
    # typo'd admin value from producing a visually broken (not just
    # unvalidated) public popup.
    border_radius: int = Field(default=8, ge=0, le=48)
    font_size: int = Field(default=13, ge=8, le=32)


class LayerPopupConfig(BaseModel):
    """Click-to-inspect popup config for one layer within a Map -- which
    attributes show (`fields`, in order) and how the popup looks.

    `enabled` defaults to True (not False like `LayerHoverConfig` below) --
    every Map already showed SOME click popup unconditionally before this
    config existed (a hardcoded `name`-or-"Feature" one, see
    MapBySlugPage.tsx's `buildFeatureHtml`), so this has to default to "on"
    or every pre-existing Map would silently go from "shows a popup" to
    "shows nothing" the moment this feature shipped. `fields` empty is what
    preserves that exact old behavior (falls back to `name`) -- an admin
    who wants MORE than that picks fields; one who wants NONE explicitly
    disables it."""

    enabled: bool = True
    fields: list[str] = []
    style: PopupStyle = PopupStyle()


class LayerHoverConfig(BaseModel):
    """Hover tooltip config -- deliberately no `style` of its own (reuses
    the layer's `popup.style`, see MapBySlugPage.tsx): a hover tooltip and
    a click popup for the SAME layer looking different would read as two
    unrelated pieces of chrome, not "more detail on click.\""""

    enabled: bool = False
    fields: list[str] = []


class MapLayer(BaseModel):
    dataset_slug: str
    visible: bool = True
    # Only "published" exists today -- see the module docstring on why a
    # map never shows anyone's in-progress style draft. Kept as a field
    # (not hardcoded server-side) so a per-map style override has
    # somewhere to live later without another migration.
    style_ref: Literal["published"] = "published"
    popup: LayerPopupConfig = LayerPopupConfig()
    hover: LayerHoverConfig = LayerHoverConfig()
    # Independent of `popup`/`hover` -- brief follow-up: "choose whether by
    # default it will fly to and zoom to that feature ... on top of popup
    # on hover or click, or whether it will even popup in the first place."
    # A visitor's click can zoom to the feature, show a popup, both, or
    # neither, all set independently per layer.
    zoom_to_feature: bool = False


# The 7 controls genuinely native to MapLibre GL JS, plus 9 more hand-built
# client-side with no API key or heavy dependency (see web/src/lib/
# controls/*): search/measure/minimap/gridlines, and (a later follow-up)
# compass/spinning-globe/atmosphere/bookmark/legend -- researched against
# GeoLibre (brief §14), whose own "Map controls" menu lists ~24 items.
# Everything past these 16 (Terrain, Weather, Route Animation, Flight
# Simulator, Directions, Reverse Geocode, Colorbar) needs a self-hosted
# elevation/routing/geocoding dataset, an external paid/keyed API, or
# choropleth styling support this app doesn't have yet -- out of scope.
# Frozen as a real allowlist (not just a TypedDict) so a typo'd or made-up
# control id in a PUT body 400s immediately instead of silently being
# stored and then ignored by the frontend's renderer.
_KNOWN_CONTROLS = {
    "navigation", "fullscreen", "geolocate", "globe", "scale", "attribution", "logo",
    "search", "measure", "minimap", "gridlines",
    "compass", "spinning-globe", "atmosphere", "bookmark", "legend", "basemap-switcher",
    # "layers" is retired (merged into "basemap-switcher", brief follow-up)
    # but stays allow-listed: at least one real saved Map's controls_json
    # already has this key (MapEditor.tsx's `{...DEFAULT_MAP_CONTROLS,
    # ...map.controls_json}` load-merge preserves unknown keys from
    # whatever was already stored, and re-sends the whole object on save)
    # -- removing it here would 400 that Map's very next save for an
    # unrelated field change. Harmless to keep: the frontend's renderer
    # simply no longer iterates this id at all (see mapControls.ts's
    # MAP_CONTROL_IDS), so a stored "layers" entry is inert either way.
    "layers",
}


class MapControlConfig(BaseModel):
    enabled: bool = False
    position: Literal["top-left", "top-right", "bottom-left", "bottom-right"] = "top-right"


class MapFilter(BaseModel):
    """One admin-defined filter widget (brief follow-up: "filters ...
    pointed to specific fields," replacing the old hardcoded country-only
    filter). Points at one dataset + attribute; `options` is a plain,
    admin-typed list of allowed values -- there's no live "distinct values
    from the tiles" introspection here (Martin/PMTiles don't expose that
    cheaply), so the admin authoring this Map is the one who knows what
    values that field actually takes."""

    id: str
    label: str
    dataset_slug: str
    field: str
    options: list[str] = []


class MapLegendItem(BaseModel):
    """Per-dataset override for the auto-generated legend control (brief
    follow-up: "I should also be able to customize the legend"). The
    legend control itself (legendControl.ts) still discovers WHICH layers
    are currently visible straight off the map's own style -- this only
    overrides how a given dataset's row is presented, or hides it
    entirely, rather than replacing that discovery with a hand-maintained
    list an admin would have to keep in sync as layers are added/removed."""

    label: str | None = None
    hidden: bool = False


class MapLegendConfig(BaseModel):
    title: str = "Legend"
    items: dict[str, MapLegendItem] = {}


class GridlinesConfig(BaseModel):
    """Gridlines/graticule config -- expanded to close the gap against
    GeoLibre's own graticule plugin (researched directly against
    packages/plugins/src/plugins/maplibre-graticule.ts, brief follow-up:
    features GeoLibre's gridlines have that this app didn't). `grid_type`
    "utm" draws a metric easting/northing grid (proj4, client-side) instead
    of the geographic lat/long one; everything else applies to both."""

    grid_type: Literal["geographic", "utm"] = "geographic"
    spacing_mode: Literal["auto", "fixed"] = "auto"
    spacing_degrees: float = 10
    spacing_meters: float = 100000
    color: str = "#888888"
    width: float = 0.5
    opacity: float = 0.5
    # True matches the OLD hardcoded behavior exactly (every gridline was
    # always dashed before this became a real toggle) -- preserves what an
    # existing Map was already showing rather than silently changing it.
    dashed: bool = True
    show_labels: bool = True
    label_format: Literal["dd", "dms"] = "dd"
    label_edges: Literal["left-bottom", "all"] = "left-bottom"
    label_color: str = "#888888"
    label_size: float = 10


class MapCreate(BaseModel):
    name: str
    description: str | None = None


class MapUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    layers_json: list[MapLayer] | None = None
    basemap: str | None = None
    default_extent: dict | None = None
    filters_json: list[MapFilter] | None = None
    legend_json: MapLegendConfig | None = None
    controls_json: dict[str, MapControlConfig] | None = None
    gridlines_json: GridlinesConfig | None = None
    # Nullable, no default -- unset means "no zoom constraint" (brief
    # follow-up: "optionally choose minimum and maximum zoom per map").
    min_zoom: float | None = None
    max_zoom: float | None = None


def _row_to_map(row: dict) -> dict:
    row = dict(row)
    if row.get("id") is not None:
        row["id"] = str(row["id"])
    return row


@router.get("/maps")
def list_published_maps():
    """Public: every published map's basic info -- a map-picker/index page's
    data source, same role `GET /datasets` plays for layers."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT slug, name, description FROM registry.maps WHERE status = 'published' ORDER BY name")
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows


@router.get("/maps/{slug}")
def get_published_map(slug: str):
    """Public: full render config for one published map. `layers_json` is
    filtered down to entries whose dataset is CURRENTLY tier_status=
    'published' -- a map saved against a layer that's since been
    unpublished/withheld degrades gracefully (that one layer just
    disappears) instead of 404ing the whole map or leaking a withheld
    dataset's existence through a stale layer reference."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT slug, name, description, layers_json, basemap, default_extent, filters_json, legend_json,
                       controls_json, min_zoom, max_zoom, gridlines_json
                FROM registry.maps WHERE slug = %s AND status = 'published'
                """,
                (slug,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="map not found")

            layer_slugs = [layer["dataset_slug"] for layer in row["layers_json"]]
            published_slugs = set()
            if layer_slugs:
                cur.execute(
                    "SELECT slug FROM registry.datasets WHERE slug = ANY(%s) AND tier_status = 'published'",
                    (layer_slugs,),
                )
                published_slugs = {r["slug"] for r in cur.fetchall()}
    finally:
        conn.close()

    row["layers_json"] = [layer for layer in row["layers_json"] if layer["dataset_slug"] in published_slugs]
    return row


@router.get("/admin/maps")
def list_all_maps(admin: dict = Depends(require_admin)):
    """Admin: every map regardless of status -- the authoring UI's list view."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, slug, name, description, status, created_at, updated_at FROM registry.maps ORDER BY name"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_row_to_map(r) for r in rows]


@router.get("/admin/maps/{slug}")
def get_map_for_editing(slug: str, admin: dict = Depends(require_admin)):
    """Admin: full config regardless of status, unfiltered -- the authoring
    UI needs to show/edit layer references even to datasets that aren't
    (yet) published, unlike the public read above."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM registry.maps WHERE slug = %s", (slug,))
            row = cur.fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="map not found")
    return _row_to_map(row)


@router.post("/admin/maps")
def create_map(body: MapCreate, admin: dict = Depends(require_admin)):
    try:
        slug = slugify(body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT 1 FROM registry.maps WHERE slug = %s", (slug,))
            if cur.fetchone() is not None:
                raise HTTPException(status_code=409, detail=f"a map with slug '{slug}' already exists")
            cur.execute(
                "INSERT INTO registry.maps (name, slug, description, created_by) VALUES (%s, %s, %s, %s) RETURNING *",
                (body.name, slug, body.description, admin["email"]),
            )
            row = cur.fetchone()
            write_audit_log(cur, admin, "map.created", slug, {"name": body.name})
    finally:
        conn.close()
    return _row_to_map(row)


@router.put("/admin/maps/{slug}")
def update_map(slug: str, update: MapUpdate = Body(...), admin: dict = Depends(require_admin)):
    """Partial update (`exclude_unset`, same pattern as governance's dataset
    edit) -- an authoring UI saving just a basemap change shouldn't have to
    resend the full layers_json it may not have freshly loaded."""
    fields = update.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="no fields to update")

    layer_slugs = [layer["dataset_slug"] for layer in fields.get("layers_json", [])]
    # Filters point at a dataset the SAME way layers_json does -- validated
    # against the same registry.datasets existence check just below (not
    # necessarily one of this Map's own included layers: a filter could
    # reasonably target a dataset the map doesn't render a fill/outline for
    # at all, e.g. filtering by a tabular indicator joined client-side --
    # out of scope today, but nothing here should preclude it later).
    filter_dataset_slugs = [f["dataset_slug"] for f in fields.get("filters_json", [])]
    if "controls_json" in fields:
        unknown_controls = set(fields["controls_json"]) - _KNOWN_CONTROLS
        if unknown_controls:
            raise HTTPException(status_code=400, detail=f"unknown control id(s) in controls_json: {sorted(unknown_controls)}")

    # JSONB columns need an explicit json.dumps -- psycopg2 has no built-in
    # adapter for a bare Python list/dict targeting jsonb (see styles
    # router's identical pattern for the single-value case).
    jsonb_fields = {"layers_json", "default_extent", "filters_json", "legend_json", "controls_json", "gridlines_json"}
    params = {field: (json.dumps(value) if field in jsonb_fields else value) for field, value in fields.items()}
    # controls_json is the one JSONB field that's a MERGE, not a whole-value
    # replace, unlike layers_json/default_extent/etc: each control id is an
    # independently addressable sub-config (brief: "toggling for each map
    # easily"), so sending {"scale": {...}} must only touch "scale", not
    # silently drop every other control the map already had configured.
    # Postgres's `||` on jsonb does exactly that at the top level.
    set_clause = ", ".join(
        f"{field} = controls_json || %({field})s::jsonb" if field == "controls_json" else f"{field} = %({field})s"
        for field in fields
    )

    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            if layer_slugs:
                cur.execute("SELECT slug FROM registry.datasets WHERE slug = ANY(%s)", (layer_slugs,))
                known = {r["slug"] for r in cur.fetchall()}
                unknown = set(layer_slugs) - known
                if unknown:
                    raise HTTPException(status_code=400, detail=f"unknown dataset slug(s) in layers_json: {sorted(unknown)}")

            if filter_dataset_slugs:
                cur.execute("SELECT slug FROM registry.datasets WHERE slug = ANY(%s)", (filter_dataset_slugs,))
                known = {r["slug"] for r in cur.fetchall()}
                unknown = set(filter_dataset_slugs) - known
                if unknown:
                    raise HTTPException(status_code=400, detail=f"unknown dataset slug(s) in filters_json: {sorted(unknown)}")

            cur.execute(
                f"UPDATE registry.maps SET {set_clause} WHERE slug = %(slug)s RETURNING *",
                {**params, "slug": slug},
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="map not found")
            write_audit_log(cur, admin, "map.updated", slug, fields)
    finally:
        conn.close()
    return _row_to_map(row)


@router.post("/admin/maps/{slug}/publish")
def publish_map(slug: str, admin: dict = Depends(require_admin)):
    """Flips status draft -> published (brief §16: "the map gets a public
    route/slug and shareable URL") -- idempotent no-op if already published,
    since re-approving an already-live map isn't an error, just redundant."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE registry.maps SET status = 'published' WHERE slug = %s RETURNING *",
                (slug,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="map not found")
            write_audit_log(cur, admin, "map.published", slug, None)
    finally:
        conn.close()
    return _row_to_map(row)


@router.post("/admin/maps/{slug}/unpublish")
def unpublish_map(slug: str, admin: dict = Depends(require_admin)):
    """Flips status published -> draft (brief follow-up: "admin should be
    able to unpublish ... maps") -- the counterpart to publish_map above.
    The public `/m/<slug>` route (get_published_map) only ever matches
    `status = 'published'`, so this alone is what takes an already-shared
    URL offline; the row and its config are untouched, so re-publishing
    later needs no reconstruction. Idempotent no-op if already a draft."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE registry.maps SET status = 'draft' WHERE slug = %s RETURNING *",
                (slug,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="map not found")
            write_audit_log(cur, admin, "map.unpublished", slug, None)
    finally:
        conn.close()
    return _row_to_map(row)


@router.delete("/admin/maps/{slug}")
def delete_map(slug: str, admin: dict = Depends(require_admin)):
    """Deletes a Map's registry row outright (brief follow-up: "admin
    should be able to ... even delete maps"). Unlike dataset deletion
    (governance.py's delete_dataset), a Map has no pipeline-produced
    artifacts in object storage to clean up -- it's pure stored config over
    registry layers (this router's own module docstring), so removing the
    row is the whole operation. Works regardless of draft/published status,
    same as dataset deletion's "any tier_status" rule."""
    conn = get_connection()
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT name, status FROM registry.maps WHERE slug = %s", (slug,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="map not found")
            # Written before the DELETE, same reasoning as dataset deletion's
            # audit entry -- registry.audit_log has no FK to registry.maps,
            # so this row survives the Map's own removal on purpose.
            write_audit_log(cur, admin, "map.deleted", slug, {"name": row["name"], "status": row["status"]})
            cur.execute("DELETE FROM registry.maps WHERE slug = %s", (slug,))
    finally:
        conn.close()
    return {"slug": slug, "deleted": True}
