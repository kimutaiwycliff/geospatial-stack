import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  approveUpload,
  fetchUploadStatus,
  updateServeMode,
  UnauthorizedError,
  type AdminDataset,
  type UploadStatus,
} from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

/** Turns the fields DatasetDetail already has (from `GET /admin/datasets`)
 * into this panel's local `UploadStatus` shape -- avoids a redundant fetch
 * just to render the very first frame, since AdminDataset already carries
 * every field UploadStatus does (plus a few this panel doesn't need). */
function toUploadStatus(dataset: AdminDataset): UploadStatus {
  return {
    slug: dataset.slug,
    name: dataset.name,
    description: dataset.description,
    source: dataset.source,
    license: dataset.license,
    attribution: dataset.attribution,
    sensitivity: dataset.sensitivity,
    tier_status: dataset.tier_status,
    serve_mode: dataset.serve_mode,
    validation_report: dataset.validation_report,
  };
}

/** Column order for the sample-features table -- `report.fields` is a
 * `{name: type}` map, and object key order from a JSON response is
 * insertion order, which matches the source file's own column order.
 * Falling back to whatever the first sample feature's properties contain
 * covers the (should-never-happen) case where `fields` came back empty
 * but samples didn't. */
function sampleColumns(report: UploadStatus["validation_report"]): string[] {
  if (!report) return [];
  const fromFields = Object.keys(report.fields);
  if (fromFields.length > 0) return fromFields;
  return Object.keys(report.sample_features[0]?.properties ?? {});
}

/** Success-state Alert styling -- Alert ships only "default"/"destructive"
 * (brief: no built-in success variant), so a "passed"/"published" message
 * everywhere in this panel uses this exact green-toned className rather
 * than each call site inventing its own shade. Matches GovernanceForm's/
 * StylingPanel's identical convention for their own save-confirmation
 * messages. */
const SUCCESS_ALERT_CLASS = "border-green-600/30 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-950/30 dark:text-green-300";
/** `AlertDescription` hardcodes its own `text-muted-foreground` (see
 * ui/alert.tsx) -- that wins over any text color set only on the parent
 * `Alert`, since the two classes land on different DOM nodes and don't
 * cascade. Every tinted Alert below has to pass this SAME text color to
 * AlertDescription too, not just to Alert, or the message renders in the
 * default muted gray instead of the intended tint. */
const SUCCESS_TEXT_CLASS = "text-green-800 dark:text-green-300";
const AMBER_ALERT_CLASS = "border-amber-600/30 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300";
const AMBER_TEXT_CLASS = "text-amber-800 dark:text-amber-300";
const BLUE_ALERT_CLASS = "border-blue-600/30 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-950/30 dark:text-blue-300";
const BLUE_TEXT_CLASS = "text-blue-800 dark:text-blue-300";

/**
 * Maps the real, already-polled state (`tier_status` + `validation_report`)
 * onto a stage label + percentage -- NOT a fabricated smoothly-incrementing
 * progress bar, since nothing here actually knows how far through a
 * multi-minute DuckDB validation run a given upload is. Two genuine
 * checkpoints exist between "just uploaded" and "report ready" --
 * ingest_task flips tier_status to 'raw' immediately, curate_task flips it
 * to 'curated' before contract_test_task (which produces the report) even
 * starts (see worker/tasks.py) -- so this is honest, discrete progress
 * across REAL state transitions, not a timer-driven animation pretending
 * to know more than the backend has told us.
 */
function ingestStage(status: UploadStatus): { label: string; value: number } {
  if (status.tier_status === "curated") return { label: "Validating", value: 66 };
  return { label: "Ingesting", value: 30 };
}

/**
 * Validation report + approve/publish tab (brief §16 steps 2-6). Polls
 * `GET /admin/uploads/{slug}/status` on a self-rescheduling timer -- see
 * the `stillValidating`/`awaitingPublish` derivation below for exactly
 * when that timer is allowed to run, since polling forever for a dataset
 * that will never change (already published, or a pre-Phase-4 dataset
 * that never had a validation_report at all) would just be wasted
 * requests every time a curator happens to have this tab open.
 */
export function UploadStatusPanel({
  token,
  dataset,
  onStatusChange,
}: {
  token: string;
  dataset: AdminDataset;
  onStatusChange: (patch: Partial<AdminDataset>) => void;
}) {
  const { logout } = useAdminAuth();
  const [status, setStatus] = useState<UploadStatus>(() => toUploadStatus(dataset));
  const [pollError, setPollError] = useState<string | null>(null);
  const [awaitingPublish, setAwaitingPublish] = useState(false);
  const [approving, setApproving] = useState(false);
  // Defaults to PMTiles (this app's original/only option) -- Martin is now
  // a real choice too (brief follow-up: "give the admin [the choice]
  // whether it will be from the pmtiles or martin dynamic tiles"), served
  // live from Postgres and auto-discovered by tiles/martin/config.yaml.
  const [serveMode, setServeMode] = useState<"pmtiles" | "martin">("pmtiles");
  const [changingServeMode, setChangingServeMode] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  // Re-seed on a genuinely different dataset selection, mirroring
  // GovernanceForm/StylingPanel's "only on identity change" rule.
  useEffect(() => {
    setStatus(toUploadStatus(dataset));
    setPollError(null);
    setAwaitingPublish(false);
    setApproveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on slug change, see comment above
  }, [dataset.slug]);

  // `curated` is included alongside `raw` because curate_task flips
  // tier_status to 'curated' BEFORE contract_test_task even runs (see
  // approve_upload's backend docstring) -- there's a real window where the
  // report is still null at that tier, not just at 'raw'. A `published`
  // (or a raw/curated dataset that somehow never got a report at all --
  // e.g. anything ingested by the engineer-triggered path Phase 0/1 used,
  // which never ran this upload pipeline) has nothing left to wait for.
  const stillValidating = (status.tier_status === "raw" || status.tier_status === "curated") && status.validation_report === null;
  const pollingActive = stillValidating || (awaitingPublish && status.tier_status !== "published");

  useEffect(() => {
    if (!pollingActive) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const next = await fetchUploadStatus(token, dataset.slug);
        if (cancelled) return;
        setStatus(next);
        onStatusChange({ tier_status: next.tier_status, serve_mode: next.serve_mode, validation_report: next.validation_report });
        if (next.tier_status === "published") {
          setAwaitingPublish(false);
          // `status` (not `next`) is the closure's PREVIOUS value -- this
          // only fires once, on the actual raw/curated -> published
          // transition this poll just observed, not on every subsequent
          // poll of an already-published dataset.
          if (status.tier_status !== "published") toast.success("Publish finished -- live on the public map.");
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          logout();
          return;
        }
        setPollError("Could not refresh upload status -- will keep retrying.");
      }
      // 2.5s: frequent enough that "still validating" doesn't feel stuck,
      // infrequent enough not to hammer the API while a multi-minute
      // large-file validation runs (brief: "poll ... every ~2-3 seconds").
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Re-running this effect every time `status` changes is exactly the
    // point: each completed poll's setStatus call schedules the NEXT poll,
    // a self-rescheduling timer rather than a setInterval that could pile
    // up overlapping requests if one poll is slow to resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onStatusChange/logout are stable; token/dataset.slug don't change without re-seeding above
  }, [status, pollingActive]);

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      await approveUpload(token, dataset.slug, serveMode);
      setAwaitingPublish(true);
      toast.success(
        serveMode === "pmtiles" ? "Publish requested -- building tiles now." : "Publish requested -- Martin will pick it up within ~30s.",
      );
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      // approveUpload's underlying adminFetch only surfaces "HTTP 400" for
      // the "validation hasn't finished/failed" case -- but the Approve
      // button below is already hidden whenever that would happen, so in
      // practice this branch is really just network/5xx failures.
      const message = err instanceof Error ? err.message : "Could not approve.";
      setApproveError(message);
      toast.error(message);
    } finally {
      setApproving(false);
    }
  }

  /** Brief follow-up: "I can later change how I would want a dataset
   * should be served whether by pmtiles or martin tiles" -- unlike the
   * one-time approval choice above, this can be flipped any time after
   * publishing. See governance.py's `update_serve_mode` for what actually
   * happens on each side (martin is immediate; pmtiles dispatches a
   * background tile build). */
  async function handleChangeServeMode(nextServeMode: "pmtiles" | "martin") {
    setChangingServeMode(true);
    try {
      await updateServeMode(token, dataset.slug, nextServeMode);
      setStatus((prev) => ({ ...prev, serve_mode: nextServeMode }));
      onStatusChange({ serve_mode: nextServeMode });
      toast.success(
        nextServeMode === "martin"
          ? "Now serving via Martin (live from Postgres)."
          : "Switching to PMTiles -- building the static archive now.",
      );
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not change serve mode.");
    } finally {
      setChangingServeMode(false);
    }
  }

  const report = status.validation_report;
  const columns = sampleColumns(report);
  const canApprove = report?.passed === true && status.tier_status !== "published";

  return (
    <div className="flex flex-col gap-4 pt-4">
      {pollError && (
        <Alert className={`animate-in fade-in duration-200 ${AMBER_ALERT_CLASS}`}>
          <AlertDescription className={AMBER_TEXT_CLASS}>{pollError}</AlertDescription>
        </Alert>
      )}

      {status.tier_status === "published" && (
        <>
          <Alert className={`animate-in fade-in duration-200 ${SUCCESS_ALERT_CLASS}`}>
            <AlertDescription className={SUCCESS_TEXT_CLASS}>
              Published{status.serve_mode ? ` (serve_mode: ${status.serve_mode})` : ""}.
            </AlertDescription>
          </Alert>
          {(status.serve_mode === "pmtiles" || status.serve_mode === "martin") && (
            <div className="flex items-center gap-2">
              <Label htmlFor="change-serve-mode" className="text-xs text-muted-foreground">
                Serve via
              </Label>
              <Select
                value={status.serve_mode}
                onValueChange={(value) => handleChangeServeMode(value as "pmtiles" | "martin")}
                disabled={changingServeMode}
              >
                <SelectTrigger id="change-serve-mode" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pmtiles">PMTiles (static, built once)</SelectItem>
                  <SelectItem value="martin">Martin (dynamic, live from Postgres)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}

      {awaitingPublish && status.tier_status !== "published" && (
        <div className="flex flex-col gap-2 animate-in fade-in duration-200">
          <Alert className={BLUE_ALERT_CLASS}>
            <AlertDescription className={BLUE_TEXT_CLASS}>
              Publish requested -- waiting for the tile build to finish. This page keeps polling; feel free to switch
              datasets and come back.
            </AlertDescription>
          </Alert>
          {/* No sub-step signal exists for "publishing" the way ingest/
              validate has raw-vs-curated (load_postgis_task and
              build_pmtiles_task each just run to completion or fail, with
              nothing in between reported to the API) -- animate-pulse
              communicates "still working," the fixed value doesn't claim
              to know a real percentage the backend never told us. */}
          <Progress value={80} className="animate-pulse" />
        </div>
      )}

      {stillValidating && (
        <div className="flex flex-col gap-2 animate-in fade-in duration-200">
          <Alert className={AMBER_ALERT_CLASS}>
            <AlertDescription className={AMBER_TEXT_CLASS}>
              {ingestStage(status).label}&hellip; this can take anywhere from a few seconds to a couple of minutes
              for larger files. You can navigate away and come back -- this just re-checks status, nothing is lost.
            </AlertDescription>
          </Alert>
          <Progress value={ingestStage(status).value} />
        </div>
      )}

      {!stillValidating && report === null && status.tier_status !== "published" && (
        <p className="text-sm text-muted-foreground">No validation report for this dataset.</p>
      )}

      {report && (
        <Card className="animate-in fade-in duration-200">
          <CardContent className="flex flex-col gap-3">
            <Alert variant={report.passed ? "default" : "destructive"} className={report.passed ? SUCCESS_ALERT_CLASS : undefined}>
              <AlertDescription className={report.passed ? SUCCESS_TEXT_CLASS : undefined}>
                {report.passed ? "Validation passed." : "Validation failed."}
              </AlertDescription>
            </Alert>

            {!report.passed && report.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <ul className="list-inside list-disc">
                    {report.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Rows</dt>
                <dd className="text-foreground">{report.row_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Geometry</dt>
                <dd className="text-foreground">{report.geometry_type}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Null/empty geom</dt>
                <dd className="text-foreground">{report.null_or_empty_geometry_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Invalid geom</dt>
                <dd className="text-foreground">{report.invalid_geometry_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-muted-foreground">Out of range</dt>
                <dd className="text-foreground">{report.out_of_range_count}</dd>
              </div>
            </dl>

            <div>
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Fields</p>
              <p className="text-sm text-foreground">
                {Object.entries(report.fields)
                  .map(([field, type]) => `${field} (${type})`)
                  .join(", ") || "none"}
              </p>
            </div>

            {report.sample_features.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                  Sample features ({report.sample_features.length})
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>geometry</TableHead>
                      {columns.map((col) => (
                        <TableHead key={col}>{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.sample_features.map((feature, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{feature.geometry.type}</TableCell>
                        {columns.map((col) => (
                          <TableCell key={col} className="text-foreground">
                            {String(feature.properties[col] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canApprove && (
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="serve-mode" className="text-xs text-muted-foreground">
              Serve via
            </Label>
            <Select value={serveMode} onValueChange={(value) => setServeMode(value as "pmtiles" | "martin")} disabled={approving || awaitingPublish}>
              <SelectTrigger id="serve-mode" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pmtiles">PMTiles (static, built once)</SelectItem>
                <SelectItem value="martin">Martin (dynamic, live from Postgres)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={handleApprove} disabled={approving || awaitingPublish}>
            {approving ? "Requesting…" : "Approve & publish"}
          </Button>
          {approveError && (
            <Alert variant="destructive" className="w-auto px-3 py-1.5">
              <AlertDescription>{approveError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}
