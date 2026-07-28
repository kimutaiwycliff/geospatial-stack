import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

/** Just the fields this editor actually lets a curator change -- mirrors
 * GovernanceForm's `FieldValues`/`fieldsOf` split so "what did we load"
 * and "what do we diff against" stay the exact same shape. `default_extent`
 * is normalized to a fixed (possibly-null) object rather than three loose
 * strings so JSON.stringify equality (see buildPatch) is a valid diff. */
interface EditableFields {
  name: string;
  description: string;
  layers_json: MapLayer[];
  default_extent: { center: [number, number]; zoom: number } | null;
}

function fieldsOf(map: AdminMapDetail): EditableFields {
  return {
    name: map.name,
    description: map.description ?? "",
    layers_json: map.layers_json,
    default_extent: map.default_extent,
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
  if (JSON.stringify(loaded.layers_json) !== JSON.stringify(current.layers_json)) patch.layers_json = current.layers_json;
  if (JSON.stringify(loaded.default_extent) !== JSON.stringify(current.default_extent)) patch.default_extent = current.default_extent;
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
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not save changes." });
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
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not publish." });
    } finally {
      setPublishing(false);
    }
  }

  if (loadError) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">{loadError}</p>
        <Link to="/admin/maps" className="text-xs text-blue-600 hover:underline">
          &larr; Maps
        </Link>
      </div>
    );
  }

  if (!map || !values) {
    return <div className="p-6 text-sm text-slate-500">Loading&hellip;</div>;
  }

  const visibleDatasets = showAllDatasets ? datasets : datasets.filter((d) => d.tier_status === "published");
  const layerFor = (s: string) => values.layers_json.find((l) => l.dataset_slug === s);

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <Link to="/admin/maps" className="text-xs text-blue-600 hover:underline">
            &larr; Maps
          </Link>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">{map.name}</h1>
            <p className="text-xs text-slate-400">
              {map.slug} &middot; {map.status}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {map.status === "published" && (
            <Link to={`/m/${map.slug}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
              View public page &rarr;
            </Link>
          )}
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || map.status === "published"}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {map.status === "published" ? "Published" : publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto p-6">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input
            type="text"
            value={values.name}
            onChange={(e) => setValues((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            value={values.description}
            onChange={(e) => setValues((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
            rows={2}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Basemap</span>
          {/* Read-only: "light" is the only style @protomaps/basemaps is
              wired up with today (see basemapStyle.ts) -- a picker with one
              option is worse UX than just stating the fact. */}
          <span className="text-slate-500">{map.basemap} (only basemap available)</span>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2 font-medium text-slate-700">
            <input type="checkbox" checked={extentEnabled} onChange={(e) => setExtentEnabled(e.target.checked)} />
            Set a default view
          </label>
          {extentEnabled && (
            <div className="flex flex-wrap items-center gap-3 pl-6">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Center lng
                <input
                  type="number"
                  step="any"
                  value={centerLng}
                  onChange={(e) => setCenterLng(e.target.value)}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Center lat
                <input
                  type="number"
                  step="any"
                  value={centerLat}
                  onChange={(e) => setCenterLat(e.target.value)}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Zoom
                <input
                  type="number"
                  step="any"
                  value={zoom}
                  onChange={(e) => setZoom(e.target.value)}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Layers</span>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={showAllDatasets} onChange={(e) => setShowAllDatasets(e.target.checked)} />
              Show all datasets (including unpublished)
            </label>
          </div>
          <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200">
            {visibleDatasets.length === 0 && <li className="p-3 text-sm text-slate-500">No datasets to reference.</li>}
            {visibleDatasets.map((dataset) => {
              const layer = layerFor(dataset.slug);
              return (
                <li key={dataset.slug} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={layer != null} onChange={() => toggleLayerIncluded(dataset.slug)} />
                    <span className="text-slate-800">{dataset.name}</span>
                    <span className="text-xs text-slate-400">
                      {dataset.slug} &middot; {dataset.tier_status}
                    </span>
                  </label>
                  {layer && (
                    <label className="flex items-center gap-2 text-xs text-slate-500">
                      <input type="checkbox" checked={layer.visible} onChange={() => toggleLayerVisible(dataset.slug)} />
                      Visible by default
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {message && (
            <p className={`text-sm ${message.kind === "success" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
          )}
        </div>
      </div>
    </div>
  );
}
