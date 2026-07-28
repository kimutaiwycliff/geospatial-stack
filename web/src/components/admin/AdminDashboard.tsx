import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAdminDatasets,
  fetchDraftStyles,
  UnauthorizedError,
  type AdminDataset,
  type DraftStyle,
  type UploadCreateResult,
} from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import { DatasetDetail } from "./DatasetDetail";
import { UploadDatasetModal } from "./UploadDatasetModal";

const TIER_STYLES: Record<AdminDataset["tier_status"], string> = {
  raw: "bg-slate-100 text-slate-600",
  curated: "bg-amber-100 text-amber-700",
  published: "bg-green-100 text-green-700",
};

/**
 * Phase 4: a second badge, distinct from the tier pill above, that surfaces
 * a self-service upload's validation outcome at a glance -- `tier_status:
 * "curated"` alone is ambiguous (brief note: it lands there whether
 * validation passed OR failed), so the list needs this to tell "awaiting
 * approval" apart from "needs attention" without opening the dataset.
 * Returns null (renders nothing) for every other combination -- a
 * published dataset, or a pre-Phase-4 row with no report at all, has
 * nothing upload-flow-specific worth calling out here.
 */
function validationBadge(dataset: AdminDataset): { text: string; className: string } | null {
  if (dataset.tier_status === "raw" && dataset.validation_report === null) {
    return { text: "validating…", className: "bg-slate-100 text-slate-500" };
  }
  if (dataset.tier_status === "curated" && dataset.validation_report?.passed === true) {
    return { text: "awaiting approval", className: "bg-blue-100 text-blue-700" };
  }
  if (dataset.tier_status === "curated" && dataset.validation_report?.passed === false) {
    return { text: "validation failed", className: "bg-red-100 text-red-700" };
  }
  return null;
}

/**
 * Admin shell: dataset list (every tier_status, unlike the public map's
 * `/datasets`) on the left, the selected dataset's governance/styling/audit
 * view on the right (brief point 4). Owns the two list-wide fetches
 * (datasets, draft styles) so DatasetDetail's children don't each re-fetch
 * the full draft list just to find their one row.
 */
export function AdminDashboard() {
  const { token, logout } = useAdminAuth();
  const [datasets, setDatasets] = useState<AdminDataset[]>([]);
  const [draftStyles, setDraftStyles] = useState<DraftStyle[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // `token` is guaranteed non-null here: this component only ever renders
  // inside <RequireAdmin>, which redirects to /admin/login otherwise.
  const authToken = token as string;

  // A 401 from any admin call means the token expired/was revoked server
  // side after this page already rendered -- logout() clears it, and
  // RequireAdmin (re-evaluated on the next render since it reads the same
  // context) sends the user back to /admin/login. Centralized here instead
  // of duplicated in every child's catch block.
  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  const loadAll = useCallback(() => {
    fetchAdminDatasets(authToken)
      .then(setDatasets)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return handleUnauthorized();
        setLoadError("Could not load datasets.");
      });
    fetchDraftStyles(authToken)
      .then(setDraftStyles)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return handleUnauthorized();
        setLoadError("Could not load draft styles.");
      });
  }, [authToken, handleUnauthorized]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on mount; loadAll's identity is stable via useCallback
  }, []);

  const selected = datasets.find((d) => d.slug === selectedSlug) ?? null;
  const selectedDraft = selectedSlug ? draftStyles.find((d) => d.slug === selectedSlug) ?? null : null;

  // Named generically (not "applyGovernancePatch") because Phase 4's
  // UploadStatusPanel patches this same list too (tier_status/serve_mode/
  // validation_report as an upload validates and publishes) -- one merge
  // function, two distinct call sites below, each passing its own shape of
  // partial update.
  function applyDatasetPatch(slug: string, patch: Partial<AdminDataset>) {
    setDatasets((prev) => prev.map((d) => (d.slug === slug ? { ...d, ...patch } : d)));
  }

  function applyDraftSaved(next: DraftStyle) {
    setDraftStyles((prev) => {
      const others = prev.filter((d) => d.slug !== next.slug);
      return [...others, next];
    });
  }

  // Upload flow's completion handler (brief §16 step 1): the backend has
  // already inserted the new registry row by the time `POST
  // /admin/uploads` returns, so a full re-fetch (not a locally-synthesized
  // row -- this response only carries {slug, tier_status}, not the rest of
  // AdminDataset's fields) is enough to make it selectable. `loadAll` is
  // fire-and-forget here on purpose, same as its mount-time call -- the
  // dataset list panel just re-renders once it resolves.
  function handleUploadCreated(result: UploadCreateResult) {
    setUploadModalOpen(false);
    setSelectedSlug(result.slug);
    loadAll();
  }

  return (
    <div className="flex h-screen w-screen flex-col md:flex-row">
      <div className="w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-white md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Datasets</h1>
          <div className="flex items-center gap-3 text-xs">
            <Link to="/admin/maps" className="text-blue-600 hover:underline">
              Maps
            </Link>
            <button type="button" onClick={logout} className="text-blue-600 hover:underline">
              Sign out
            </button>
          </div>
        </div>
        <div className="border-b border-slate-100 p-4">
          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Upload dataset
          </button>
        </div>
        {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
        <ul className="flex flex-col">
          {datasets.map((dataset) => {
            const badge = validationBadge(dataset);
            return (
              <li key={dataset.slug}>
                <button
                  type="button"
                  onClick={() => setSelectedSlug(dataset.slug)}
                  className={`flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                    selectedSlug === dataset.slug ? "bg-blue-50" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-slate-800">{dataset.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${TIER_STYLES[dataset.tier_status]}`}>
                      {dataset.tier_status}
                    </span>
                    {badge && <span className={`rounded-full px-2 py-0.5 font-medium ${badge.className}`}>{badge.text}</span>}
                    <span className="text-slate-400">{dataset.slug}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!selected && <p className="text-sm text-slate-500">Select a dataset to edit its governance and styling.</p>}
        {selected && (
          <DatasetDetail
            token={authToken}
            dataset={selected}
            draft={selectedDraft}
            onGovernanceSaved={(patch) => applyDatasetPatch(selected.slug, patch)}
            onDraftSaved={applyDraftSaved}
            onDatasetPatch={(patch) => applyDatasetPatch(selected.slug, patch)}
          />
        )}
      </div>

      {uploadModalOpen && (
        <UploadDatasetModal token={authToken} onCreated={handleUploadCreated} onClose={() => setUploadModalOpen(false)} />
      )}
    </div>
  );
}
