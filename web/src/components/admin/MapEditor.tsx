import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteMap,
  fetchAdminDatasets,
  fetchAdminMap,
  fetchFieldValues,
  publishMap,
  unpublishMap,
  updateMap,
  UnauthorizedError,
  DEFAULT_GRIDLINES_CONFIG,
  DEFAULT_LAYER_HOVER,
  DEFAULT_LAYER_POPUP,
  DEFAULT_LEGEND_CONFIG,
  type AdminDataset,
  type AdminMapDetail,
  type GridlinesConfig,
  type LayerHoverConfig,
  type LayerPopupConfig,
  type MapFilter,
  type MapLayer,
  type MapLegendConfig,
  type MapUpdatePatch,
  type PopupStyle,
} from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import {
  CONTROL_POSITIONS,
  CONTROLS_WITHOUT_POSITION,
  DEFAULT_MAP_CONTROLS,
  MAP_CONTROL_IDS,
  MAP_CONTROL_LABELS,
  type MapControlsConfig,
} from "../../lib/mapControls";
import { asBasemapFlavor, BASEMAP_FLAVORS, BASEMAP_FLAVOR_LABELS } from "../../lib/basemapStyle";
import { geometryBounds, unionBounds } from "../../lib/geo";

/** Success-state Alert styling -- same convention as UploadStatusPanel's
 * SUCCESS_ALERT_CLASS (Alert has no built-in "success" variant). Both the
 * Alert AND its AlertDescription need this text color explicitly --
 * AlertDescription hardcodes its own `text-muted-foreground` (ui/alert.tsx)
 * which wins over any color set only on the parent, since the two classes
 * land on different DOM nodes. */
const SUCCESS_ALERT_CLASS = "border-green-600/30 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-950/30 dark:text-green-300";
const SUCCESS_TEXT_CLASS = "text-green-800 dark:text-green-300";

/** Just the fields this editor actually lets a curator change -- mirrors
 * GovernanceForm's `FieldValues`/`fieldsOf` split so "what did we load"
 * and "what do we diff against" stay the exact same shape. `default_extent`
 * is normalized to a fixed (possibly-null) object rather than three loose
 * strings so JSON.stringify equality (see buildPatch) is a valid diff. */
interface EditableFields {
  name: string;
  description: string;
  layers_json: MapLayer[];
  basemap: string;
  default_extent: { center: [number, number]; zoom: number } | null;
  controls_json: MapControlsConfig;
  filters_json: MapFilter[];
  min_zoom: string;
  max_zoom: string;
  gridlines_json: GridlinesConfig;
  legend_json: MapLegendConfig;
}

function fieldsOf(map: AdminMapDetail): EditableFields {
  return {
    name: map.name,
    description: map.description ?? "",
    // popup/hover default to a fully-off config for any layer saved before
    // this feature existed -- the backend's own Pydantic model defaults
    // already guarantee this shape on every response, but this is belt-
    // and-suspenders against a stale cached response.
    layers_json: map.layers_json.map((layer) => ({
      ...layer,
      popup: layer.popup ?? DEFAULT_LAYER_POPUP,
      hover: layer.hover ?? DEFAULT_LAYER_HOVER,
      zoom_to_feature: layer.zoom_to_feature ?? false,
    })),
    // Narrowed through asBasemapFlavor rather than trusted as-is -- a map
    // row saved before this picker existed already defaults to "light" (the
    // migration's own column default), but this guards against any
    // hand-edited/otherwise-stale value the same way the public map side
    // does (see basemapStyle.ts's asBasemapFlavor).
    basemap: asBasemapFlavor(map.basemap),
    default_extent: map.default_extent,
    // Falls back to the same default the migration's own column default
    // gives a brand-new row -- belt-and-suspenders in case a map row ever
    // has a genuinely empty controls_json (shouldn't happen post-migration,
    // but a missing entry per-control below still needs SOME value to
    // seed the Switch/Select from).
    controls_json: { ...DEFAULT_MAP_CONTROLS, ...map.controls_json },
    filters_json: map.filters_json ?? [],
    // Kept as strings (like the extent's own centerLng/centerLat/zoom
    // inputs below) rather than `number | null` so an in-progress "" (the
    // curator cleared the field, meaning "no constraint") has somewhere to
    // live that isn't `NaN` -- converted to a real number or `null` only at
    // Save time (see buildPatch).
    min_zoom: map.min_zoom != null ? String(map.min_zoom) : "",
    max_zoom: map.max_zoom != null ? String(map.max_zoom) : "",
    gridlines_json: map.gridlines_json ?? DEFAULT_GRIDLINES_CONFIG,
    legend_json: map.legend_json ?? DEFAULT_LEGEND_CONFIG,
  };
}

/**
 * Real partial-update diff (same contract as GovernanceForm.buildPatch --
 * the backend 400s on an empty body). `layers_json`/`default_extent` are
 * compared by JSON content, not reference, since this form always
 * constructs a fresh array/object on every edit.
 */
/** "" (cleared field) -> `null` (no constraint); anything else -> its
 * numeric value. Shared by min_zoom/max_zoom's diff below. */
function zoomPatchValue(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/**
 * Rough zoom estimate for a bbox, with no live MapLibre map to ask (this
 * editor has never had a preview map, by design -- see this component's
 * own docstring) -- brief follow-up: "centroid and zoom levels set
 * automatically based on the bounds of the dataset." Mirrors the standard
 * "degrees of longitude per tile at zoom Z" formula every `fitBounds`
 * implementation is built on, assuming a generic ~700px viewport; this is
 * a reasonable STARTING POINT for the admin to nudge afterward, not a
 * promise of pixel-perfect framing (no viewport size is knowable here).
 * Latitude span is scaled by `cos(meanLatitude)` to roughly account for
 * Web Mercator's north/south stretching, the same correction
 * worker/tasks.py's own `_bbox_wkt` calls out for a different reason.
 */
function estimateZoomForBounds(bounds: [[number, number], [number, number]]): number {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  const lngSpan = Math.max(maxLng - minLng, 0.0001);
  const meanLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const latSpan = Math.max((maxLat - minLat) / Math.max(Math.cos(meanLatRad), 0.1), 0.0001);
  const span = Math.max(lngSpan, latSpan);
  const zoom = Math.log2(360 / span) - 0.6; // slight margin so the fit isn't edge-to-edge
  return Math.max(0, Math.min(16, Math.round(zoom * 10) / 10));
}

function buildPatch(loaded: EditableFields, current: EditableFields): MapUpdatePatch | null {
  const patch: MapUpdatePatch = {};
  if (loaded.name !== current.name) patch.name = current.name;
  if (loaded.description !== current.description) patch.description = current.description;
  if (loaded.basemap !== current.basemap) patch.basemap = current.basemap;
  if (JSON.stringify(loaded.layers_json) !== JSON.stringify(current.layers_json)) patch.layers_json = current.layers_json;
  if (JSON.stringify(loaded.default_extent) !== JSON.stringify(current.default_extent)) patch.default_extent = current.default_extent;
  if (JSON.stringify(loaded.controls_json) !== JSON.stringify(current.controls_json)) patch.controls_json = current.controls_json;
  if (JSON.stringify(loaded.filters_json) !== JSON.stringify(current.filters_json)) patch.filters_json = current.filters_json;
  if (loaded.min_zoom !== current.min_zoom) patch.min_zoom = zoomPatchValue(current.min_zoom);
  if (loaded.max_zoom !== current.max_zoom) patch.max_zoom = zoomPatchValue(current.max_zoom);
  if (JSON.stringify(loaded.gridlines_json) !== JSON.stringify(current.gridlines_json)) patch.gridlines_json = current.gridlines_json;
  if (JSON.stringify(loaded.legend_json) !== JSON.stringify(current.legend_json)) patch.legend_json = current.legend_json;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Map authoring editor (brief §16: pick layers from the registry, toggle
 * visibility, set a default view, save, publish). Loads both the map
 * itself (`GET /admin/maps/{slug}`) and the FULL dataset registry (not
 * just published ones) so a curator can knowingly reference a
 * still-curating dataset while drafting -- the backend only checks
 * existence, not publish state (per maps.py's update_map docstring) -- but
 * defaults the visible picker list to published-only, since that's the
 * sane common case (brief: "probably filter to ones with tier_status ===
 * 'published' as the sane default").
 *
 * No live MapLibre preview for the default-extent inputs -- scoped down to
 * three plain number inputs (brief explicitly calls the preview a
 * nice-to-have; "your call on effort"). The public map-by-slug page (which
 * is NOT optional) gets the real MapLibre rendering instead.
 */
export function MapEditor() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { token, logout } = useAdminAuth();
  const authToken = token as string;

  const [map, setMap] = useState<AdminMapDetail | null>(null);
  const [datasets, setDatasets] = useState<AdminDataset[]>([]);
  const [loaded, setLoaded] = useState<EditableFields | null>(null);
  const [values, setValues] = useState<EditableFields | null>(null);
  const [extentEnabled, setExtentEnabled] = useState(false);
  const [centerLng, setCenterLng] = useState("0");
  const [centerLat, setCenterLat] = useState("0");
  const [zoom, setZoom] = useState("2");
  const [showAllDatasets, setShowAllDatasets] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fieldValueOptions, setFieldValueOptions] = useState<Record<string, string[]>>({});
  const [fieldValuesLoading, setFieldValuesLoading] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    if (!slug) return;
    fetchAdminMap(authToken, slug)
      .then((row) => {
        setMap(row);
        const fields = fieldsOf(row);
        setLoaded(fields);
        setValues(fields);
        setExtentEnabled(fields.default_extent !== null);
        setCenterLng(String(fields.default_extent?.center[0] ?? 0));
        setCenterLat(String(fields.default_extent?.center[1] ?? 0));
        setZoom(String(fields.default_extent?.zoom ?? 2));
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return logout();
        setLoadError("Could not load this map.");
      });
    fetchAdminDatasets(authToken)
      .then(setDatasets)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return logout();
        setLoadError("Could not load the dataset registry.");
      });
  }, [authToken, slug, logout]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep `values.default_extent` in sync with the three number inputs +
  // the enabled toggle -- kept as a derived effect rather than computing
  // inline on every input's onChange so Save always reads one consistent
  // object regardless of which field the curator touched last.
  useEffect(() => {
    if (!values) return;
    const next: EditableFields["default_extent"] = extentEnabled
      ? { center: [Number(centerLng) || 0, Number(centerLat) || 0], zoom: Number(zoom) || 0 }
      : null;
    setValues((prev) => (prev ? { ...prev, default_extent: next } : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally NOT depending on `values` itself, only the raw inputs that should re-derive it
  }, [extentEnabled, centerLng, centerLat, zoom]);

  function toggleLayerIncluded(datasetSlug: string) {
    setValues((prev) => {
      if (!prev) return prev;
      const exists = prev.layers_json.some((l) => l.dataset_slug === datasetSlug);
      const layers_json = exists
        ? prev.layers_json.filter((l) => l.dataset_slug !== datasetSlug)
        : [
            ...prev.layers_json,
            {
              dataset_slug: datasetSlug,
              visible: true,
              style_ref: "published" as const,
              popup: DEFAULT_LAYER_POPUP,
              hover: DEFAULT_LAYER_HOVER,
              zoom_to_feature: false,
            },
          ];
      return { ...prev, layers_json };
    });
  }

  function toggleLayerVisible(datasetSlug: string) {
    setValues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers_json: prev.layers_json.map((l) => (l.dataset_slug === datasetSlug ? { ...l, visible: !l.visible } : l)),
      };
    });
  }

  /** "Fit to included layers" (brief follow-up: "the dataset they choose
   * should be the centroid and zoom levels set automatically based on the
   * bounds of the dataset") -- unions every currently-included layer's
   * registry `extent` bbox and derives a center + a rough starting zoom
   * from it, then seeds the SAME extentEnabled/centerLng/centerLat/zoom
   * state the manual inputs below already drive (so this is just a
   * convenience pre-fill, not a separate code path the manual inputs
   * don't also cover). */
  function handleFitToLayers() {
    if (!values) return;
    let bounds: [[number, number], [number, number]] | null = null;
    for (const layer of values.layers_json) {
      const dataset = datasets.find((d) => d.slug === layer.dataset_slug);
      if (!dataset?.extent) continue;
      bounds = unionBounds(bounds, geometryBounds(dataset.extent)) as [[number, number], [number, number]] | null;
    }
    if (!bounds) {
      toast.error("None of the included layers have bounds data to fit to.");
      return;
    }
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    setExtentEnabled(true);
    setCenterLng(String(Math.round(((minLng + maxLng) / 2) * 1000) / 1000));
    setCenterLat(String(Math.round(((minLat + maxLat) / 2) * 1000) / 1000));
    setZoom(String(estimateZoomForBounds(bounds)));
    toast.success("Default view fit to the included layers -- feel free to nudge it further.");
  }

  function updateControl(id: keyof MapControlsConfig, patch: Partial<MapControlsConfig[keyof MapControlsConfig]>) {
    setValues((prev) => {
      if (!prev) return prev;
      const current = prev.controls_json[id] ?? DEFAULT_MAP_CONTROLS[id];
      return { ...prev, controls_json: { ...prev.controls_json, [id]: { ...current, ...patch } } };
    });
  }

  /** Shared updater for one layer's `popup` or `hover` sub-object -- both
   * follow the exact same "patch this one layer's config" shape, just
   * against a different key. */
  function updateLayerConfig(datasetSlug: string, key: "popup" | "hover", patch: Partial<LayerPopupConfig | LayerHoverConfig>) {
    setValues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers_json: prev.layers_json.map((l) =>
          l.dataset_slug === datasetSlug ? { ...l, [key]: { ...l[key], ...patch } } : l,
        ),
      };
    });
  }

  function toggleLayerConfigField(datasetSlug: string, key: "popup" | "hover", field: string) {
    setValues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers_json: prev.layers_json.map((l) => {
          if (l.dataset_slug !== datasetSlug) return l;
          const current = l[key].fields;
          const fields = current.includes(field) ? current.filter((f) => f !== field) : [...current, field];
          return { ...l, [key]: { ...l[key], fields } };
        }),
      };
    });
  }

  function updateLayerPopupStyle(datasetSlug: string, patch: Partial<PopupStyle>) {
    setValues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers_json: prev.layers_json.map((l) =>
          l.dataset_slug === datasetSlug ? { ...l, popup: { ...l.popup, style: { ...l.popup.style, ...patch } } } : l,
        ),
      };
    });
  }

  function toggleZoomToFeature(datasetSlug: string, zoom_to_feature: boolean) {
    setValues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        layers_json: prev.layers_json.map((l) => (l.dataset_slug === datasetSlug ? { ...l, zoom_to_feature } : l)),
      };
    });
  }

  function addFilter() {
    setValues((prev) => {
      if (!prev) return prev;
      const next: MapFilter = {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `filter-${Date.now()}`,
        label: "",
        dataset_slug: prev.layers_json[0]?.dataset_slug ?? "",
        field: "",
        options: [],
      };
      return { ...prev, filters_json: [...prev.filters_json, next] };
    });
  }

  function updateFilter(id: string, patch: Partial<MapFilter>) {
    setValues((prev) => {
      if (!prev) return prev;
      return { ...prev, filters_json: prev.filters_json.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
    });
  }

  function removeFilter(id: string) {
    setValues((prev) => (prev ? { ...prev, filters_json: prev.filters_json.filter((f) => f.id !== id) } : prev));
    setFieldValueOptions((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }

  /** Loads the real distinct values for a filter's chosen dataset+field
   * (brief follow-up: "the allowable ones I should just be choosing from
   * unique fields," not hand-typing them) -- keyed by filter id since two
   * filters can point at the same dataset+field independently. */
  async function loadFieldValues(filterId: string, datasetSlug: string, field: string) {
    if (!datasetSlug || !field) return;
    setFieldValuesLoading((prev) => ({ ...prev, [filterId]: true }));
    try {
      const fieldValues = await fetchFieldValues(authToken, datasetSlug, field);
      setFieldValueOptions((prev) => ({ ...prev, [filterId]: fieldValues }));
      // Dropping any previously-chosen options this field no longer has --
      // most relevant right after switching field/dataset on an existing
      // filter, where the old `options` list belonged to a different column.
      updateFilter(filterId, { options: [] });
    } catch {
      toast.error("Could not load this field's values.");
    } finally {
      setFieldValuesLoading((prev) => ({ ...prev, [filterId]: false }));
    }
  }

  function toggleFilterOption(filterId: string, value: string) {
    setValues((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        filters_json: prev.filters_json.map((f) => {
          if (f.id !== filterId) return f;
          const options = f.options.includes(value) ? f.options.filter((v) => v !== value) : [...f.options, value];
          return { ...f, options };
        }),
      };
    });
  }

  function updateGridlines(patch: Partial<GridlinesConfig>) {
    setValues((prev) => (prev ? { ...prev, gridlines_json: { ...prev.gridlines_json, ...patch } } : prev));
  }

  function updateLegendTitle(title: string) {
    setValues((prev) => (prev ? { ...prev, legend_json: { ...prev.legend_json, title } } : prev));
  }

  /** Legend item overrides are keyed by dataset slug, not stored per-layer
   * in layers_json -- a dataset can appear in the legend independently of
   * whether it's still an included layer at all (see maps.py's
   * MapLegendConfig docstring), so this lives in its own `legend_json.items`
   * map rather than piggybacking on updateLayerConfig. */
  function updateLegendItem(datasetSlug: string, patch: { label?: string | null; hidden?: boolean }) {
    setValues((prev) => {
      if (!prev) return prev;
      const current = prev.legend_json.items[datasetSlug] ?? { label: null, hidden: false };
      return {
        ...prev,
        legend_json: { ...prev.legend_json, items: { ...prev.legend_json.items, [datasetSlug]: { ...current, ...patch } } },
      };
    });
  }

  async function handleSave() {
    if (!loaded || !values || !slug) return;
    const patch = buildPatch(loaded, values);
    if (!patch) {
      setMessage({ kind: "success", text: "Nothing to save -- no fields changed." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const updated = await updateMap(authToken, slug, patch);
      setMap(updated);
      setLoaded(fieldsOf(updated));
      setMessage({ kind: "success", text: "Saved." });
      toast.success("Map saved.");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      const text = err instanceof Error ? err.message : "Could not save changes.";
      setMessage({ kind: "error", text });
      toast.error(text);
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePublish() {
    if (!slug || !map) return;
    const publish = map.status !== "published";
    setPublishing(true);
    setMessage(null);
    try {
      const updated = publish ? await publishMap(authToken, slug) : await unpublishMap(authToken, slug);
      setMap(updated);
      setMessage({ kind: "success", text: publish ? "Published." : "Unpublished." });
      toast.success(publish ? "Map published." : "Map unpublished -- its public page is now offline.");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      const text = publish ? "Could not publish." : "Could not unpublish.";
      setMessage({ kind: "error", text });
      toast.error(text);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDelete() {
    if (!slug) return;
    setDeleting(true);
    try {
      await deleteMap(authToken, slug);
      toast.success(`"${map?.name ?? slug}" deleted.`);
      navigate("/admin/maps");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not delete this map.");
    } finally {
      setDeleting(false);
      setConfirmDeleteOpen(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <Link to="/admin/maps" className="text-xs text-primary hover:underline">
          &larr; Maps
        </Link>
      </div>
    );
  }

  if (!map || !values) {
    return <div className="p-6 text-sm text-muted-foreground">Loading&hellip;</div>;
  }

  const visibleDatasets = showAllDatasets ? datasets : datasets.filter((d) => d.tier_status === "published");
  const layerFor = (s: string) => values.layers_json.find((l) => l.dataset_slug === s);

  return (
    <div className="flex h-screen w-screen flex-col animate-in fade-in duration-300">
      <div className="flex items-center justify-between border-b border-border bg-background p-4">
        <div className="flex items-center gap-4">
          <Link to="/admin/maps" className="text-xs text-primary hover:underline">
            &larr; Maps
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-foreground">{map.name}</h1>
            <p className="text-xs text-muted-foreground">
              {map.slug} &middot; {map.status}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            // Moved here from the very bottom of the form (brief follow-up:
            // "better arrangement" for the map editor) -- with the form now
            // split across tabs, a Save confirmation/error buried below
            // whichever tab happened to be open was easy to miss entirely.
            // Living next to the Save button itself means it's always in
            // the same spot regardless of tab or scroll position.
            <Alert
              variant={message.kind === "error" ? "destructive" : "default"}
              className={
                message.kind === "success"
                  ? `w-auto animate-in fade-in px-3 py-1.5 duration-200 ${SUCCESS_ALERT_CLASS}`
                  : "w-auto animate-in fade-in px-3 py-1.5 duration-200"
              }
            >
              <AlertDescription className={message.kind === "success" ? SUCCESS_TEXT_CLASS : undefined}>
                {message.text}
              </AlertDescription>
            </Alert>
          )}
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {map.status === "published" && (
            <Link to={`/m/${map.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
              View public page &rarr;
            </Link>
          )}
          {/* Publish/Unpublish is now a real toggle (brief follow-up:
              "admin should be able to unpublish ... maps"), not a one-way
              action -- variant flips to `outline` when published so the
              button doesn't read as "click again to publish more." */}
          <Button
            type="button"
            variant={map.status === "published" ? "outline" : "default"}
            onClick={handleTogglePublish}
            disabled={publishing}
          >
            {publishing ? "Working…" : map.status === "published" ? "Unpublish" : "Publish"}
          </Button>
          <Button type="button" variant="destructive" onClick={() => setConfirmDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      <Dialog open={confirmDeleteOpen} onOpenChange={(open) => !deleting && setConfirmDeleteOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{map.name}"?</DialogTitle>
            <DialogDescription>
              This permanently removes the map's saved configuration (layers, filters, styling, controls). There is
              no undo short of a backup restore. Datasets themselves are untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto p-6">
        {/* Split into tabs (brief follow-up: "better arrangement" for the
            map editor) -- this used to be one continuous ~700-line scroll
            of every section back to back; grouping by what an admin is
            actually doing (set up the basics, choose data, narrow it with
            filters, style how it looks, decide which controls a visitor
            gets) makes each individual task scannable instead of a wall of
            fields to hunt through. `sticky` on TabsList keeps the tab
            switcher reachable without scrolling back to the top first. */}
        <Tabs defaultValue="basics" className="flex flex-1 flex-col gap-6">
          <TabsList className="sticky top-0 z-10 self-start bg-background">
            <TabsTrigger value="basics">Basics</TabsTrigger>
            <TabsTrigger value="layers">Layers</TabsTrigger>
            <TabsTrigger value="filters">Filters</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
            <TabsTrigger value="controls">Controls</TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="map-name">Name</Label>
          <Input
            id="map-name"
            type="text"
            value={values.name}
            onChange={(e) => setValues((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="map-description">Description</Label>
          <Textarea
            id="map-description"
            value={values.description}
            onChange={(e) => setValues((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
            rows={2}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="map-basemap">Basemap</Label>
          <Select
            value={values.basemap}
            onValueChange={(value) => setValues((prev) => (prev ? { ...prev, basemap: value } : prev))}
          >
            <SelectTrigger id="map-basemap" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASEMAP_FLAVORS.map((flavor) => (
                <SelectItem key={flavor} value={flavor}>
                  {BASEMAP_FLAVOR_LABELS[flavor]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch id="extent-enabled" checked={extentEnabled} onCheckedChange={setExtentEnabled} />
              <Label htmlFor="extent-enabled" className="font-medium text-foreground">
                Set a default view
              </Label>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFitToLayers}
              disabled={values.layers_json.length === 0}
              title={values.layers_json.length === 0 ? "Include a layer first" : undefined}
            >
              Fit to included layers
            </Button>
          </div>
          {extentEnabled && (
            <div className="flex flex-wrap items-center gap-3 pl-8">
              <div className="flex flex-col gap-1">
                <Label htmlFor="center-lng" className="text-xs text-muted-foreground">
                  Center lng
                </Label>
                <Input
                  id="center-lng"
                  type="number"
                  step="any"
                  value={centerLng}
                  onChange={(e) => setCenterLng(e.target.value)}
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="center-lat" className="text-xs text-muted-foreground">
                  Center lat
                </Label>
                <Input
                  id="center-lat"
                  type="number"
                  step="any"
                  value={centerLat}
                  onChange={(e) => setCenterLat(e.target.value)}
                  className="w-28"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="zoom" className="text-xs text-muted-foreground">
                  Zoom
                </Label>
                <Input id="zoom" type="number" step="any" value={zoom} onChange={(e) => setZoom(e.target.value)} className="w-20" />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Zoom limits</span>
          <p className="text-xs text-muted-foreground">
            Optional -- leave either blank for no constraint on how far a visitor can zoom in/out.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="min-zoom" className="text-xs text-muted-foreground">
                Min zoom
              </Label>
              <Input
                id="min-zoom"
                type="number"
                step="any"
                placeholder="none"
                value={values.min_zoom}
                onChange={(e) => setValues((prev) => (prev ? { ...prev, min_zoom: e.target.value } : prev))}
                className="w-24"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="max-zoom" className="text-xs text-muted-foreground">
                Max zoom
              </Label>
              <Input
                id="max-zoom"
                type="number"
                step="any"
                placeholder="none"
                value={values.max_zoom}
                onChange={(e) => setValues((prev) => (prev ? { ...prev, max_zoom: e.target.value } : prev))}
                className="w-24"
              />
            </div>
          </div>
        </div>
          </TabsContent>

          <TabsContent value="style" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Gridlines styling</span>
          <p className="text-xs text-muted-foreground">
            Applies when the "Gridlines" map control in the Controls tab is enabled.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="gridlines-color" className="text-xs text-muted-foreground">
                Color
              </Label>
              <input
                id="gridlines-color"
                type="color"
                value={values.gridlines_json.color}
                onChange={(e) => updateGridlines({ color: e.target.value })}
                className="h-8 w-14 cursor-pointer rounded-md border border-input"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="gridlines-width" className="text-xs text-muted-foreground">
                Width
              </Label>
              <Input
                id="gridlines-width"
                type="number"
                min={0}
                max={5}
                step={0.5}
                value={values.gridlines_json.width}
                onChange={(e) => updateGridlines({ width: Number(e.target.value) })}
                className="w-20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="gridlines-opacity" className="text-xs text-muted-foreground">
                Opacity
              </Label>
              <Input
                id="gridlines-opacity"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={values.gridlines_json.opacity}
                onChange={(e) => updateGridlines({ opacity: Number(e.target.value) })}
                className="w-20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="gridlines-type" className="text-xs text-muted-foreground">
                Grid type
              </Label>
              <Select
                value={values.gridlines_json.grid_type}
                onValueChange={(v) => updateGridlines({ grid_type: v as "geographic" | "utm" })}
              >
                <SelectTrigger id="gridlines-type" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="geographic">Geographic (lat/long)</SelectItem>
                  <SelectItem value="utm">UTM (easting/northing)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="gridlines-spacing-mode" className="text-xs text-muted-foreground">
                Spacing
              </Label>
              <Select
                value={values.gridlines_json.spacing_mode}
                onValueChange={(v) => updateGridlines({ spacing_mode: v as "auto" | "fixed" })}
              >
                <SelectTrigger id="gridlines-spacing-mode" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (by zoom)</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {values.gridlines_json.spacing_mode === "fixed" &&
              (values.gridlines_json.grid_type === "utm" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="gridlines-spacing-m" className="text-xs text-muted-foreground">
                    Interval (m)
                  </Label>
                  <Input
                    id="gridlines-spacing-m"
                    type="number"
                    min={100}
                    step={100}
                    value={values.gridlines_json.spacing_meters}
                    onChange={(e) => updateGridlines({ spacing_meters: Number(e.target.value) })}
                    className="w-24"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="gridlines-spacing-deg" className="text-xs text-muted-foreground">
                    Interval (°)
                  </Label>
                  <Input
                    id="gridlines-spacing-deg"
                    type="number"
                    min={0.01}
                    step={0.5}
                    value={values.gridlines_json.spacing_degrees}
                    onChange={(e) => updateGridlines({ spacing_degrees: Number(e.target.value) })}
                    className="w-24"
                  />
                </div>
              ))}
            <div className="flex items-center gap-2">
              <Switch
                id="gridlines-dashed"
                checked={values.gridlines_json.dashed}
                onCheckedChange={(dashed) => updateGridlines({ dashed })}
              />
              <Label htmlFor="gridlines-dashed" className="text-xs text-muted-foreground">
                Dashed
              </Label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="gridlines-show-labels"
                checked={values.gridlines_json.show_labels}
                onCheckedChange={(show_labels) => updateGridlines({ show_labels })}
              />
              <Label htmlFor="gridlines-show-labels" className="text-xs text-muted-foreground">
                Coordinate labels
              </Label>
            </div>
            {values.gridlines_json.show_labels && (
              <>
                {values.gridlines_json.grid_type === "geographic" && (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="gridlines-label-format" className="text-xs text-muted-foreground">
                      Format
                    </Label>
                    <Select
                      value={values.gridlines_json.label_format}
                      onValueChange={(v) => updateGridlines({ label_format: v as "dd" | "dms" })}
                    >
                      <SelectTrigger id="gridlines-label-format" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dd">Decimal degrees</SelectItem>
                        <SelectItem value="dms">Degrees/min/sec</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <Label htmlFor="gridlines-label-edges" className="text-xs text-muted-foreground">
                    Label edges
                  </Label>
                  <Select
                    value={values.gridlines_json.label_edges}
                    onValueChange={(v) => updateGridlines({ label_edges: v as "left-bottom" | "all" })}
                  >
                    <SelectTrigger id="gridlines-label-edges" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left-bottom">Left + bottom</SelectItem>
                      <SelectItem value="all">All edges</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="gridlines-label-color" className="text-xs text-muted-foreground">
                    Label color
                  </Label>
                  <input
                    id="gridlines-label-color"
                    type="color"
                    value={values.gridlines_json.label_color}
                    onChange={(e) => updateGridlines({ label_color: e.target.value })}
                    className="h-8 w-14 cursor-pointer rounded-md border border-input"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="gridlines-label-size" className="text-xs text-muted-foreground">
                    Label size
                  </Label>
                  <Input
                    id="gridlines-label-size"
                    type="number"
                    min={8}
                    max={20}
                    value={values.gridlines_json.label_size}
                    onChange={(e) => updateGridlines({ label_size: Number(e.target.value) })}
                    className="w-20"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Legend</span>
          <p className="text-xs text-muted-foreground">
            Applies when the "Legend" map control (Controls tab) is enabled. Per-layer label overrides and hide
            toggles are on each layer's row in the Layers tab.
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="legend-title" className="text-xs text-muted-foreground">
              Title
            </Label>
            <Input
              id="legend-title"
              value={values.legend_json.title}
              onChange={(e) => updateLegendTitle(e.target.value)}
              className="w-48"
            />
          </div>
        </div>
          </TabsContent>

          <TabsContent value="layers" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Layers</span>
            <div className="flex items-center gap-2">
              <Switch id="show-all-datasets" checked={showAllDatasets} onCheckedChange={setShowAllDatasets} />
              <Label htmlFor="show-all-datasets" className="text-xs text-muted-foreground">
                Show all datasets (including unpublished)
              </Label>
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {visibleDatasets.length === 0 && <li className="p-3 text-sm text-muted-foreground">No datasets to reference.</li>}
            {visibleDatasets.map((dataset) => {
              const layer = layerFor(dataset.slug);
              const fieldOptions = Object.keys(dataset.schema_json ?? {}).filter((f) => f !== "bbox");
              return (
                <li key={dataset.slug} className="flex flex-col gap-2 p-3 text-sm transition-colors duration-150 hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={layer != null}
                        onCheckedChange={() => toggleLayerIncluded(dataset.slug)}
                        aria-label={`Include ${dataset.name} in this map`}
                      />
                      <span className="text-foreground">{dataset.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {dataset.slug} &middot; {dataset.tier_status}
                      </span>
                    </div>
                    {layer && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={layer.visible}
                          onCheckedChange={() => toggleLayerVisible(dataset.slug)}
                          aria-label={`Visible by default: ${dataset.name}`}
                        />
                        Visible by default
                      </div>
                    )}
                  </div>

                  {layer && (
                    <div className="ml-8 flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
                      {/* Zoom-to-feature (brief follow-up: "choose whether by
                          default it will fly to and zoom to that feature ...
                          on top of popup on hover or click") -- independent
                          of the popup/hover toggles below: a click can zoom,
                          popup, both, or neither. */}
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={layer.zoom_to_feature}
                          onCheckedChange={(checked) => toggleZoomToFeature(dataset.slug, checked)}
                          aria-label={`Zoom to feature on click for ${dataset.name}`}
                        />
                        <span className="text-xs font-medium text-foreground">Zoom to feature on click</span>
                      </div>

                      {/* Popup (brief follow-up: "customize what field show up on popups ... clicking features") */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={layer.popup.enabled}
                            onCheckedChange={(enabled) => updateLayerConfig(dataset.slug, "popup", { enabled })}
                            aria-label={`Enable click popup for ${dataset.name}`}
                          />
                          <span className="text-xs font-medium text-foreground">Click popup</span>
                        </div>
                        {layer.popup.enabled && (
                          <div className="flex flex-col gap-2 pl-7">
                            {fieldOptions.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No field list available for this dataset.</span>
                            ) : (
                              <div className="flex flex-wrap gap-x-3 gap-y-1">
                                {fieldOptions.map((field) => (
                                  <label key={field} className="flex items-center gap-1.5 text-xs text-foreground">
                                    <input
                                      type="checkbox"
                                      checked={layer.popup.fields.includes(field)}
                                      onChange={() => toggleLayerConfigField(dataset.slug, "popup", field)}
                                      className="size-3.5 accent-primary"
                                    />
                                    {field}
                                  </label>
                                ))}
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="text-xs text-muted-foreground">Look:</span>
                              <input
                                type="color"
                                title="Background color"
                                value={layer.popup.style.background_color}
                                onChange={(e) => updateLayerPopupStyle(dataset.slug, { background_color: e.target.value })}
                                className="h-6 w-9 cursor-pointer rounded border border-input"
                              />
                              <input
                                type="color"
                                title="Text color"
                                value={layer.popup.style.text_color}
                                onChange={(e) => updateLayerPopupStyle(dataset.slug, { text_color: e.target.value })}
                                className="h-6 w-9 cursor-pointer rounded border border-input"
                              />
                              <input
                                type="color"
                                title="Border color"
                                value={layer.popup.style.border_color}
                                onChange={(e) => updateLayerPopupStyle(dataset.slug, { border_color: e.target.value })}
                                className="h-6 w-9 cursor-pointer rounded border border-input"
                              />
                              <input
                                type="number"
                                min={0}
                                max={20}
                                title="Corner radius (px)"
                                value={layer.popup.style.border_radius}
                                onChange={(e) => updateLayerPopupStyle(dataset.slug, { border_radius: Number(e.target.value) })}
                                className="h-6 w-14 rounded border border-input px-1 text-xs"
                              />
                              <input
                                type="number"
                                min={8}
                                max={24}
                                title="Font size (px)"
                                value={layer.popup.style.font_size}
                                onChange={(e) => updateLayerPopupStyle(dataset.slug, { font_size: Number(e.target.value) })}
                                className="h-6 w-14 rounded border border-input px-1 text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Hover tooltip (brief follow-up: "even hovering per dataset") */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={layer.hover.enabled}
                            onCheckedChange={(enabled) => updateLayerConfig(dataset.slug, "hover", { enabled })}
                            aria-label={`Enable hover tooltip for ${dataset.name}`}
                          />
                          <span className="text-xs font-medium text-foreground">Hover tooltip</span>
                        </div>
                        {layer.hover.enabled && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 pl-7">
                            {fieldOptions.length === 0 ? (
                              <span className="text-xs text-muted-foreground">No field list available for this dataset.</span>
                            ) : (
                              fieldOptions.map((field) => (
                                <label key={field} className="flex items-center gap-1.5 text-xs text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={layer.hover.fields.includes(field)}
                                    onChange={() => toggleLayerConfigField(dataset.slug, "hover", field)}
                                    className="size-3.5 accent-primary"
                                  />
                                  {field}
                                </label>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* Legend override (brief follow-up: "customize the legend") */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium text-foreground">Legend</span>
                        <div className="flex flex-wrap items-center gap-3 pl-1">
                          <Input
                            placeholder={dataset.name}
                            value={values.legend_json.items[dataset.slug]?.label ?? ""}
                            onChange={(e) => updateLegendItem(dataset.slug, { label: e.target.value || null })}
                            className="h-7 w-40 text-xs"
                          />
                          <label className="flex items-center gap-1.5 text-xs text-foreground">
                            <input
                              type="checkbox"
                              checked={values.legend_json.items[dataset.slug]?.hidden ?? false}
                              onChange={(e) => updateLegendItem(dataset.slug, { hidden: e.target.checked })}
                              className="size-3.5 accent-primary"
                            />
                            Hide from legend
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
          </TabsContent>

          <TabsContent value="filters" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Filters</span>
            <Button type="button" variant="outline" size="sm" onClick={addFilter}>
              Add filter
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Each filter is a dropdown a visitor uses to show only features where a chosen field equals one of the
            values you list here (brief follow-up: "filters ... pointed to specific fields," not just the
            hardcoded country search).
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {values.filters_json.length === 0 && <li className="p-3 text-sm text-muted-foreground">No filters configured.</li>}
            {values.filters_json.map((filter) => {
              const filterDataset = datasets.find((d) => d.slug === filter.dataset_slug);
              const filterFieldOptions = Object.keys(filterDataset?.schema_json ?? {}).filter((f) => f !== "bbox");
              return (
                <li key={filter.id} className="flex flex-col gap-2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Label (e.g. Category)"
                      value={filter.label}
                      onChange={(e) => updateFilter(filter.id, { label: e.target.value })}
                      className="w-44"
                    />
                    <Select
                      value={filter.dataset_slug || undefined}
                      onValueChange={(dataset_slug) => {
                        updateFilter(filter.id, { dataset_slug, field: "" });
                        setFieldValueOptions((prev) => ({ ...prev, [filter.id]: [] }));
                      }}
                    >
                      <SelectTrigger className="w-52" aria-label="Filter dataset">
                        <SelectValue placeholder="Choose a dataset…" />
                      </SelectTrigger>
                      <SelectContent>
                        {values.layers_json.map((l) => (
                          <SelectItem key={l.dataset_slug} value={l.dataset_slug}>
                            {l.dataset_slug}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={filter.field || undefined}
                      onValueChange={(field) => {
                        updateFilter(filter.id, { field });
                        void loadFieldValues(filter.id, filter.dataset_slug, field);
                      }}
                    >
                      <SelectTrigger className="w-40" aria-label="Filter field">
                        <SelectValue placeholder="Choose a field…" />
                      </SelectTrigger>
                      <SelectContent>
                        {filterFieldOptions.map((field) => (
                          <SelectItem key={field} value={field}>
                            {field}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeFilter(filter.id)}>
                      Remove
                    </Button>
                  </div>
                  <div className="flex flex-col gap-1.5 pl-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Allowed values (pulled straight from the data, not typed):
                      </span>
                      {filter.field && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => loadFieldValues(filter.id, filter.dataset_slug, filter.field)}
                        >
                          {fieldValueOptions[filter.id] ? "Refresh" : "Load values"}
                        </Button>
                      )}
                    </div>
                    {fieldValuesLoading[filter.id] ? (
                      <span className="text-xs text-muted-foreground">Loading values…</span>
                    ) : !filter.field ? (
                      <span className="text-xs text-muted-foreground">Choose a field above first.</span>
                    ) : fieldValueOptions[filter.id] === undefined ? (
                      <span className="text-xs text-muted-foreground">Not loaded yet -- click "Load values."</span>
                    ) : fieldValueOptions[filter.id]!.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No values found for this field.</span>
                    ) : (
                      <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                        {fieldValueOptions[filter.id]?.map((value) => (
                          <label key={value} className="flex items-center gap-1.5 text-xs text-foreground">
                            <input
                              type="checkbox"
                              checked={filter.options.includes(value)}
                              onChange={() => toggleFilterOption(filter.id, value)}
                              className="size-3.5 accent-primary"
                            />
                            {value}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
          </TabsContent>

          <TabsContent value="controls" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Map controls</span>
          <p className="text-xs text-muted-foreground">
            MapLibre's own controls, plus search/measure/minimap/gridlines (hand-built, no API key required) --
            everything else in GeoLibre's own "Map controls" menu (directions, weather, route animation, ...)
            depends on an external service or a separate plugin package and isn't offered here.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {MAP_CONTROL_IDS.map((id) => {
              const entry = values.controls_json[id] ?? DEFAULT_MAP_CONTROLS[id];
              const positionable = !CONTROLS_WITHOUT_POSITION.has(id);
              return (
                <li key={id} className="flex items-center justify-between gap-3 p-3 text-sm transition-colors duration-150 hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={(enabled) => updateControl(id, { enabled })}
                      aria-label={`Enable ${MAP_CONTROL_LABELS[id]}`}
                    />
                    <span className="text-foreground">{MAP_CONTROL_LABELS[id]}</span>
                  </div>
                  {positionable ? (
                  <Select
                    value={entry.position}
                    onValueChange={(position) => updateControl(id, { position: position as typeof entry.position })}
                    disabled={!entry.enabled}
                  >
                    <SelectTrigger className="w-36" aria-label={`${MAP_CONTROL_LABELS[id]} position`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTROL_POSITIONS.map((position) => (
                        <SelectItem key={position} value={position}>
                          {position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">no position (whole-map overlay)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
