import { useEffect, useState } from "react";
import { fetchAuditLog, UnauthorizedError, type AuditLogEntry } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

/** Human labels for the three actions the backend actually logs today
 * (brief's action list) -- falls back to the raw string for anything else
 * so a future action type still renders instead of showing nothing. */
const ACTION_LABELS: Record<string, string> = {
  "style.draft_saved": "Draft style saved",
  "style.published": "Style published",
  "dataset.governance_updated": "Governance updated",
};

/** Renders `details` as a compact "key: value, key: value" line rather than
 * pretty-printed JSON -- `details` is a free-form object that differs per
 * action (brief), and a dense one-line summary reads better in a log list
 * than a multi-line JSON blob per row. */
function summarizeDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(", ");
}

/**
 * Audit history for one dataset (brief point 7). Collapsed by default and
 * fetched lazily on first expand -- most dataset-detail visits are a quick
 * governance tweak or style tweak, not a history review, so this avoids an
 * extra request on every single dataset selection.
 */
export function AuditLogPanel({ token, slug }: { token: string; slug: string }) {
  const { logout } = useAdminAuth();
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Collapsing (or switching datasets) drops any loaded log so
    // re-expanding always re-fetches fresh data instead of showing a stale
    // previous dataset's rows for a beat.
    setEntries(null);
    setError(null);
    setExpanded(false);
  }, [slug]);

  useEffect(() => {
    if (!expanded || entries !== null) return;
    fetchAuditLog(token, { datasetSlug: slug })
      .then(setEntries)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return logout();
        setError("Could not load audit history.");
      });
  }, [expanded, entries, token, slug, logout]);

  return (
    <div className="rounded-md border border-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span>Audit history</span>
        <span className="text-slate-400">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 p-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && entries === null && <p className="text-sm text-slate-500">Loading&hellip;</p>}
          {entries !== null && entries.length === 0 && <p className="text-sm text-slate-500">No history yet.</p>}
          {entries !== null && entries.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {entries.map((entry) => (
                <li key={entry.id} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-slate-800">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    <span className="text-xs text-slate-500">{entry.actor_email}</span>
                    <span className="text-xs text-slate-400">{new Date(entry.created_at).toLocaleString()}</span>
                  </div>
                  {summarizeDetails(entry.details) && (
                    <p className="mt-0.5 truncate text-xs text-slate-500" title={summarizeDetails(entry.details)}>
                      {summarizeDetails(entry.details)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
