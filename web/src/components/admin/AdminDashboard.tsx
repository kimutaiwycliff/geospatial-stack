import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminDatasets,
  fetchDraftStyles,
  UnauthorizedError,
  type AdminDataset,
  type DraftStyle,
} from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import { DatasetDetail } from "./DatasetDetail";

const TIER_STYLES: Record<AdminDataset["tier_status"], string> = {
  raw: "bg-slate-100 text-slate-600",
  curated: "bg-amber-100 text-amber-700",
  published: "bg-green-100 text-green-700",
};

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

  function applyGovernancePatch(slug: string, patch: Partial<AdminDataset>) {
    setDatasets((prev) => prev.map((d) => (d.slug === slug ? { ...d, ...patch } : d)));
  }

  function applyDraftSaved(next: DraftStyle) {
    setDraftStyles((prev) => {
      const others = prev.filter((d) => d.slug !== next.slug);
      return [...others, next];
    });
  }

  return (
    <div className="flex h-screen w-screen flex-col md:flex-row">
      <div className="w-full shrink-0 overflow-y-auto border-b border-slate-200 bg-white md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Datasets</h1>
          <button type="button" onClick={logout} className="text-xs text-blue-600 hover:underline">
            Sign out
          </button>
        </div>
        {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
        <ul className="flex flex-col">
          {datasets.map((dataset) => (
            <li key={dataset.slug}>
              <button
                type="button"
                onClick={() => setSelectedSlug(dataset.slug)}
                className={`flex w-full flex-col gap-1 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                  selectedSlug === dataset.slug ? "bg-blue-50" : ""
                }`}
              >
                <span className="text-sm font-medium text-slate-800">{dataset.name}</span>
                <span className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${TIER_STYLES[dataset.tier_status]}`}>
                    {dataset.tier_status}
                  </span>
                  <span className="text-slate-400">{dataset.slug}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!selected && <p className="text-sm text-slate-500">Select a dataset to edit its governance and styling.</p>}
        {selected && (
          <DatasetDetail
            token={authToken}
            dataset={selected}
            draft={selectedDraft}
            onGovernanceSaved={(patch) => applyGovernancePatch(selected.slug, patch)}
            onDraftSaved={applyDraftSaved}
          />
        )}
      </div>
    </div>
  );
}
