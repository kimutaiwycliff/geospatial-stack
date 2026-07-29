import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchAdminDatasets,
  fetchAdminMap,
  publishMap,
  updateMap,
  UnauthorizedError,
  type AdminDataset,
  type AdminMapDetail,
  type MapLayer,
  type MapUpdatePatch,
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
}

function fieldsOf(map: AdminMapDetail): EditableFields {
  return {
    name: map.name,
    description: map.description ?? "",
    layers_json: map.layers_json,
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
  };
}

/**
 * Real partial-update diff (same contract as GovernanceForm.buildPatch --
 * the backend 400s on an empty body). `layers_json`/`default_extent` are
 * compared by JSON content, not reference, since this form always
 * constructs a fresh array/object on every edit.
 */
function buildPatch(loaded: EditableFields, current: EditableFields): MapUpdatePatch | null {
  const patch: MapUpdatePatch = {};
  if (loaded.name !== current.name) patch.name = current.name;
  if (loaded.description !== current.description) patch.description = current.description;
  if (loaded.basemap !== current.basemap) patch.basemap = current.basemap;
  if (JSON.stringify(loaded.layers_json) !== JSON.stringify(current.layers_json)) patch.layers_json = current.layers_json;
  if (JSON.stringify(loaded.default_extent) !== JSON.stringify(current.default_extent)) patch.default_extent = current.default_extent;
  if (JSON.stringify(loaded.controls_json) !== JSON.stringify(current.controls_json)) patch.controls_json = current.controls_json;
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
        : [...prev.layers_json, { dataset_slug: datasetSlug, visible: true, style_ref: "published" as const }];
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

  function updateControl(id: keyof MapControlsConfig, patch: Partial<MapControlsConfig[keyof MapControlsConfig]>) {
    setValues((prev) => {
      if (!prev) return prev;
      const current = prev.controls_json[id] ?? DEFAULT_MAP_CONTROLS[id];
      return { ...prev, controls_json: { ...prev.controls_json, [id]: { ...current, ...patch } } };
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

  async function handlePublish() {
    if (!slug) return;
    setPublishing(true);
    setMessage(null);
    try {
      const updated = await publishMap(authToken, slug);
      setMap(updated);
      setMessage({ kind: "success", text: "Published." });
      toast.success("Map published.");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not publish." });
      toast.error("Could not publish.");
    } finally {
      setPublishing(false);
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
          {map.status === "published" && (
            <Link to={`/m/${map.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
              View public page &rarr;
            </Link>
          )}
          <Button type="button" onClick={handlePublish} disabled={publishing || map.status === "published"}>
            {map.status === "published" ? "Published" : publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto p-6">
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
          <div className="flex items-center gap-2">
            <Switch id="extent-enabled" checked={extentEnabled} onCheckedChange={setExtentEnabled} />
            <Label htmlFor="extent-enabled" className="font-medium text-foreground">
              Set a default view
            </Label>
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
              return (
                <li
                  key={dataset.slug}
                  className="flex items-center justify-between gap-3 p-3 text-sm transition-colors duration-150 hover:bg-muted/50"
                >
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
                </li>
              );
            })}
          </ul>
        </div>

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

        <div className="flex items-center gap-3">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {message && (
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
        </div>
      </div>
    </div>
  );
}
