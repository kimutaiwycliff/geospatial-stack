import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchAdminDatasets,
  fetchDraftStyles,
  UnauthorizedError,
  type AdminDataset,
  type DraftStyle,
  type UploadCreateResult,
} from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import { ThemeToggle } from "../ThemeToggle";
import { DatasetDetail } from "./DatasetDetail";
import { UploadDatasetModal } from "./UploadDatasetModal";

/**
 * tier_status -> Badge variant. This exact mapping (raw/curated/published
 * -> outline/secondary/default) is the ONE convention used everywhere
 * tier_status appears (also MapEditor's dataset-picker rows) -- "published"
 * gets the same "default" treatment AdminMapsPage's map status uses for its
 * own "published" value, so the two lists read as the same visual language
 * even though they're different fields on different resources.
 */
const TIER_BADGE_VARIANT: Record<AdminDataset["tier_status"], "outline" | "secondary" | "default"> = {
  raw: "outline",
  curated: "secondary",
  published: "default",
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
function validationBadge(dataset: AdminDataset): { text: string; variant: "outline" | "secondary" | "destructive" } | null {
  if (dataset.tier_status === "raw" && dataset.validation_report === null) {
    return { text: "validating…", variant: "outline" };
  }
  if (dataset.tier_status === "curated" && dataset.validation_report?.passed === true) {
    return { text: "awaiting approval", variant: "secondary" };
  }
  if (dataset.tier_status === "curated" && dataset.validation_report?.passed === false) {
    return { text: "validation failed", variant: "destructive" };
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
      <div className="w-full shrink-0 overflow-y-auto border-b border-border bg-background md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Datasets</h1>
          <div className="flex items-center gap-1.5">
            <Button variant="link" size="sm" asChild>
              <Link to="/admin/maps">Maps</Link>
            </Button>
            <Button variant="link" size="sm" onClick={logout}>
              Sign out
            </Button>
            <ThemeToggle />
          </div>
        </div>
        <div className="border-b border-border p-4">
          <Button variant="outline" className="w-full" onClick={() => setUploadModalOpen(true)}>
            Upload dataset
          </Button>
        </div>
        {loadError && <p className="p-4 text-sm text-destructive">{loadError}</p>}
        <ul className="flex flex-col">
          {datasets.map((dataset) => {
            const badge = validationBadge(dataset);
            return (
              <li key={dataset.slug}>
                <button
                  type="button"
                  onClick={() => setSelectedSlug(dataset.slug)}
                  className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left hover:bg-muted ${
                    selectedSlug === dataset.slug ? "bg-accent" : ""
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">{dataset.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant={TIER_BADGE_VARIANT[dataset.tier_status]} className="capitalize">
                      {dataset.tier_status}
                    </Badge>
                    {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
                    <span className="text-muted-foreground">{dataset.slug}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!selected && <p className="text-sm text-muted-foreground">Select a dataset to edit its governance and styling.</p>}
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
