import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  approveUpload,
  fetchUploadStatus,
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
        if (next.tier_status === "published") setAwaitingPublish(false);
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
      await approveUpload(token, dataset.slug, "pmtiles");
      setAwaitingPublish(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      // approveUpload's underlying adminFetch only surfaces "HTTP 400" for
      // the "validation hasn't finished/failed" case -- but the Approve
      // button below is already hidden whenever that would happen, so in
      // practice this branch is really just network/5xx failures.
      setApproveError(err instanceof Error ? err.message : "Could not approve.");
    } finally {
      setApproving(false);
    }
  }

  const report = status.validation_report;
  const columns = sampleColumns(report);
  const canApprove = report?.passed === true && status.tier_status !== "published";

  return (
    <div className="flex flex-col gap-4 pt-4">
      {pollError && (
        <Alert className={AMBER_ALERT_CLASS}>
          <AlertDescription className={AMBER_TEXT_CLASS}>{pollError}</AlertDescription>
        </Alert>
      )}

      {status.tier_status === "published" && (
        <Alert className={SUCCESS_ALERT_CLASS}>
          <AlertDescription className={SUCCESS_TEXT_CLASS}>
            Published{status.serve_mode ? ` (serve_mode: ${status.serve_mode})` : ""}.
          </AlertDescription>
        </Alert>
      )}

      {awaitingPublish && status.tier_status !== "published" && (
        <Alert className={BLUE_ALERT_CLASS}>
          <AlertDescription className={BLUE_TEXT_CLASS}>
            Publish requested -- waiting for the tile build to finish. This page keeps polling; feel free to switch
            datasets and come back.
          </AlertDescription>
        </Alert>
      )}

      {stillValidating && (
        <div className="flex flex-col gap-3">
          <Alert className={AMBER_ALERT_CLASS}>
            <AlertDescription className={AMBER_TEXT_CLASS}>
              Still validating&hellip; this can take anywhere from a few seconds to a couple of minutes for larger
              files. You can navigate away and come back -- this just re-checks status, nothing is lost.
            </AlertDescription>
          </Alert>
          {/* Skeleton placeholder for the report that will land here once
              validation finishes -- a long blocking spinner reads as "stuck"
              for an operation that can genuinely take minutes (brief's
              loading-state guidance: skeleton over spinner for >1s work). */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
      )}

      {!stillValidating && report === null && status.tier_status !== "published" && (
        <p className="text-sm text-muted-foreground">No validation report for this dataset.</p>
      )}

      {report && (
        <Card>
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
          <Button type="button" onClick={handleApprove} disabled={approving || awaitingPublish}>
            {approving ? "Requesting…" : "Approve & publish (PMTiles)"}
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
