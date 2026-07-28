import { useEffect, useState } from "react";
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
    <div className="flex flex-col gap-4">
      {pollError && <p className="text-sm text-amber-700">{pollError}</p>}

      {status.tier_status === "published" && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Published{status.serve_mode ? ` (serve_mode: ${status.serve_mode})` : ""}.
        </div>
      )}

      {awaitingPublish && status.tier_status !== "published" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Publish requested -- waiting for the tile build to finish. This page keeps polling; feel free to switch
          datasets and come back.
        </div>
      )}

      {stillValidating && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Still validating&hellip; this can take anywhere from a few seconds to a couple of minutes for larger
          files. You can navigate away and come back -- this just re-checks status, nothing is lost.
        </div>
      )}

      {!stillValidating && report === null && status.tier_status !== "published" && (
        <p className="text-sm text-slate-500">No validation report for this dataset.</p>
      )}

      {report && (
        <div className="flex flex-col gap-3">
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              report.passed ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {report.passed ? "Validation passed." : "Validation failed."}
          </div>

          {!report.passed && report.errors.length > 0 && (
            <ul className="list-inside list-disc rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {report.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase text-slate-400">Rows</dt>
              <dd className="text-slate-800">{report.row_count}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-400">Geometry</dt>
              <dd className="text-slate-800">{report.geometry_type}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-400">Null/empty geom</dt>
              <dd className="text-slate-800">{report.null_or_empty_geometry_count}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-400">Invalid geom</dt>
              <dd className="text-slate-800">{report.invalid_geometry_count}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-slate-400">Out of range</dt>
              <dd className="text-slate-800">{report.out_of_range_count}</dd>
            </div>
          </dl>

          <div>
            <p className="mb-1 text-xs font-medium uppercase text-slate-400">Fields</p>
            <p className="text-sm text-slate-700">
              {Object.entries(report.fields)
                .map(([field, type]) => `${field} (${type})`)
                .join(", ") || "none"}
            </p>
          </div>

          {report.sample_features.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-1 text-xs font-medium uppercase text-slate-400">
                Sample features ({report.sample_features.length})
              </p>
              <table className="min-w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1 pr-4">geometry</th>
                    {columns.map((col) => (
                      <th key={col} className="py-1 pr-4">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.sample_features.map((feature, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 pr-4 text-slate-500">{feature.geometry.type}</td>
                      {columns.map((col) => (
                        <td key={col} className="py-1 pr-4 text-slate-700">
                          {String(feature.properties[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {canApprove && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleApprove}
            disabled={approving || awaitingPublish}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {approving ? "Requesting…" : "Approve & publish (PMTiles)"}
          </button>
          {approveError && <p className="text-sm text-red-600">{approveError}</p>}
        </div>
      )}
    </div>
  );
}
