import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createMap, fetchAdminMaps, UnauthorizedError, type AdminMapSummary } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

const STATUS_STYLES: Record<AdminMapSummary["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  published: "bg-green-100 text-green-700",
};

/**
 * Map authoring's list view (brief §16 second half) -- the counterpart to
 * AdminDashboard's dataset list, but its own top-level page rather than a
 * tab bolted onto AdminDashboard: a Map isn't a property of one dataset,
 * it's a cross-cutting config object over several, so it doesn't belong
 * nested under "select a dataset first". "New map" only asks for a name
 * (brief: "create a new map needs no engineering" -- everything else is
 * edited in MapEditor after creation) then jumps straight to the editor.
 */
export function AdminMapsPage() {
  const { token, logout } = useAdminAuth();
  const navigate = useNavigate();
  const authToken = token as string;

  const [maps, setMaps] = useState<AdminMapSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    fetchAdminMaps(authToken)
      .then(setMaps)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return logout();
        setLoadError("Could not load maps.");
      });
  }, [authToken, logout]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setCreateError(null);
    try {
      const map = await createMap(authToken, { name: newName });
      // Straight to the editor -- there's nothing else worth showing on
      // this list page for a brand-new, all-defaults draft map.
      navigate(`/admin/maps/${map.slug}`);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      // 409 (slug collision) is the one expected failure here -- adminFetch
      // only gives a generic "HTTP 409" message, but that's still enough
      // context for a curator to know to pick a different name.
      setCreateError(err instanceof Error ? err.message : "Could not create map.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <Link to="/admin" className="text-xs text-blue-600 hover:underline">
            &larr; Datasets
          </Link>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Maps</h1>
        </div>
        <button type="button" onClick={logout} className="text-xs text-blue-600 hover:underline">
          Sign out
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto p-6">
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New map
          </button>
        )}

        {creating && (
          <form onSubmit={handleCreate} className="flex items-end gap-3 rounded-md border border-slate-200 p-4">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Name</span>
              <input
                type="text"
                required
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setCreateError(null);
              }}
              disabled={submitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </form>
        )}
        {createError && <p className="text-sm text-red-600">{createError}</p>}
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}

        <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {maps.length === 0 && !loadError && <li className="p-4 text-sm text-slate-500">No maps yet.</li>}
          {maps.map((map) => (
            <li key={map.id}>
              <Link to={`/admin/maps/${map.slug}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-slate-800">{map.name}</span>
                  <span className="text-xs text-slate-400">{map.slug}</span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[map.status]}`}>
                  {map.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
