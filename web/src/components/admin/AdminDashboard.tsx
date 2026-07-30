import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SensitivityBadge } from "../GovernanceBadges";
import { AMBER_BADGE_CLASS, tierTintClassName } from "../../lib/statusColors";
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
 * `tierTintClassName` (shared with GovernanceBadges/AdminMapsPage, see
 * lib/statusColors.ts) layers the actual green/amber color on top.
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
 *
 * "awaiting approval" gets the same amber tint as a curated tier badge (it
 * IS a curated dataset waiting on a decision) -- "validating…" stays
 * neutral outline on purpose: nothing needs a curator's attention yet,
 * amber should mean "there's a decision pending", not "something is still
 * running". "validation failed" keeps Badge's own red `destructive`
 * variant, already colored correctly.
 */
function validationBadge(
  dataset: AdminDataset,
): { text: string; variant: "outline" | "secondary" | "destructive"; className?: string } | null {
  if (dataset.tier_status === "raw" && dataset.validation_report === null) {
    return { text: "validating…", variant: "outline" };
  }
  if (dataset.tier_status === "curated" && dataset.validation_report?.passed === true) {
    return { text: "awaiting approval", variant: "secondary", className: AMBER_BADGE_CLASS };
  }
  if (dataset.tier_status === "curated" && dataset.validation_report?.passed === false) {
    return { text: "validation failed", variant: "destructive" };
  }
  return null;
}

/**
 * Lower sorts first -- surfaces datasets an admin actually needs to DO
 * something about (a failed validation to investigate, a passed one
 * awaiting the publish decision) above ones that don't need attention
 * right now, same "action-oriented first" reasoning as defaulting
 * DatasetDetail's tabs to Publishing (brief follow-up). Ties within a
 * group fall back to name so the order stays otherwise predictable rather
 * than reshuffling on every unrelated re-render.
 */
function attentionRank(dataset: AdminDataset): number {
  const badge = validationBadge(dataset);
  if (badge?.text === "validation failed") return 0;
  if (badge?.text === "awaiting approval") return 1;
  if (badge?.text === "validating…") return 2;
  return 3;
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
  const [search, setSearch] = useState("");
  // Only tracks the FIRST dataset fetch -- an empty `datasets` array is
  // otherwise ambiguous between "still loading" and "genuinely no datasets
  // registered yet", and the list used to just render nothing for that
  // whole gap. Not reset on subsequent `loadAll()` calls (upload/publish
  // refreshes) since those already have real rows on screen to show.
  const [datasetsLoading, setDatasetsLoading] = useState(true);

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
      })
      .finally(() => setDatasetsLoading(false));
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

  // Filter (name or slug -- whichever an admin remembers) then sort by
  // attentionRank -- recomputed only when the inputs that actually change
  // it change, not on every keystroke-unrelated re-render (e.g. a
  // polling tick from a DIFFERENT dataset's UploadStatusPanel).
  const visibleDatasets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? datasets.filter((d) => d.name.toLowerCase().includes(query) || d.slug.toLowerCase().includes(query))
      : datasets;
    return [...filtered].sort((a, b) => attentionRank(a) - attentionRank(b) || a.name.localeCompare(b.name));
  }, [datasets, search]);

  // Named generically (not "applyGovernancePatch") because Phase 4's
  // UploadStatusPanel patches this same list too (tier_status/serve_mode/
  // validation_report as an upload validates and publishes) -- one merge
  // function, two distinct call sites below, each passing its own shape of
  // partial update.
  function applyDatasetPatch(slug: string, patch: Partial<AdminDataset>) {
    setDatasets((prev) => prev.map((d) => (d.slug === slug ? { ...d, ...patch } : d)));
  }

  // Deletion's completion handler: drop the row from local state (no
  // re-fetch needed -- the backend already confirmed it's gone) and clear
  // the selection, since DatasetDetail is keyed on `selected.slug` and is
  // about to have nothing left to render for the dataset that just
  // disappeared.
  function handleDatasetDeleted(slug: string) {
    setDatasets((prev) => prev.filter((d) => d.slug !== slug));
    setSelectedSlug((prev) => (prev === slug ? null : prev));
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
    // `animate-in fade-in duration-300` on the page root -- the same brief
    // "route entrance" treatment every top-level page in this app gets, a
    // cheap way to make navigation feel less abrupt without a router-level
    // transition library.
    <div className="flex h-screen w-screen flex-col animate-in fade-in duration-300 md:flex-row">
      <div className="w-full shrink-0 overflow-y-auto border-b border-border bg-background md:h-full md:w-80 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h1 className="flex items-baseline gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Datasets
            {!datasetsLoading && <span className="text-xs font-normal normal-case text-muted-foreground/70">({datasets.length})</span>}
          </h1>
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
        <div className="flex flex-col gap-2 border-b border-border p-4">
          <Button variant="outline" className="w-full" onClick={() => setUploadModalOpen(true)}>
            Upload dataset
          </Button>
          {/* Only worth showing once there's enough of a list to actually
              need filtering -- a bare input above 1-2 rows is just noise. */}
          {datasets.length > 5 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or slug…"
                className="h-8 pl-8 text-xs"
                aria-label="Search datasets"
              />
            </div>
          )}
        </div>
        {loadError && <p className="p-4 text-sm text-destructive">{loadError}</p>}
        {/* Skeleton rows while the very first `/admin/datasets` fetch is in
            flight -- this list used to just render nothing for that gap,
            indistinguishable from "no datasets exist". Shape/count is
            arbitrary (3 rows, roughly this list's usual density), purely a
            "content is coming" placeholder, not meant to mirror real rows
            pixel-for-pixel. */}
        {datasetsLoading && (
          <ul className="flex flex-col">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex flex-col gap-2 border-b border-border px-4 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </li>
            ))}
          </ul>
        )}
        {!datasetsLoading && visibleDatasets.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {search ? `No datasets match "${search}".` : "No datasets yet -- upload one to get started."}
          </p>
        )}
        {!datasetsLoading && visibleDatasets.length > 0 && (
          <ul className="flex flex-col">
            {visibleDatasets.map((dataset) => {
              const badge = validationBadge(dataset);
              const isSelected = selectedSlug === dataset.slug;
              return (
                <li key={dataset.slug}>
                  <button
                    type="button"
                    onClick={() => setSelectedSlug(dataset.slug)}
                    className={cn(
                      // `border-l-transparent` at rest reserves the same
                      // 2px selected rows get from `border-l-primary` --
                      // otherwise selecting a row shifts every row's
                      // content 2px sideways.
                      "flex w-full flex-col gap-1 border-b border-l-2 border-border border-l-transparent px-4 py-3 text-left transition-colors duration-150 hover:bg-muted",
                      // Selected state now carries the signature accent
                      // (brief: "a hand-styled selected/active state using
                      // bg-muted/bg-accent instead of a primary-tinted
                      // highlight") instead of the old neutral `bg-accent`.
                      isSelected && "border-l-primary bg-primary/10 dark:bg-primary/15",
                    )}
                  >
                    <span className="text-sm font-medium text-foreground">{dataset.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge variant={TIER_BADGE_VARIANT[dataset.tier_status]} className={cn("capitalize", tierTintClassName(dataset.tier_status))}>
                        {dataset.tier_status}
                      </Badge>
                      {badge && (
                        <Badge variant={badge.variant} className={badge.className}>
                          {badge.text}
                        </Badge>
                      )}
                      {/* Sensitivity alongside tier -- an admin scanning the
                          list for "what needs a look" benefits from seeing
                          restricted/withheld data flagged here too, not
                          only after clicking into Governance (brief
                          follow-up: general admin-page UX pass). */}
                      <SensitivityBadge sensitivity={dataset.sensitivity} />
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{dataset.slug}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!selected && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <LayoutDashboard className="size-8 text-muted-foreground/50" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-muted-foreground">Select a dataset on the left to review its publishing status, style, or governance.</p>
          </div>
        )}
        {selected && (
          <DatasetDetail
            // Keyed by slug so switching datasets fully remounts this pane
            // -- matches the same-slug-keying StylingPanel/UploadStatusPanel/
            // AuditLogPanel already do one level down (see DatasetDetail.tsx),
            // and gives the panel's own fade-in (see DatasetDetail.tsx) a
            // fresh mount to animate on every selection, not just the first.
            key={selected.slug}
            token={authToken}
            dataset={selected}
            draft={selectedDraft}
            onGovernanceSaved={(patch) => applyDatasetPatch(selected.slug, patch)}
            onDraftSaved={applyDraftSaved}
            onDatasetPatch={(patch) => applyDatasetPatch(selected.slug, patch)}
            onDeleted={() => handleDatasetDeleted(selected.slug)}
          />
        )}
      </div>

      {uploadModalOpen && (
        <UploadDatasetModal token={authToken} onCreated={handleUploadCreated} onClose={() => setUploadModalOpen(false)} />
      )}
    </div>
  );
}
