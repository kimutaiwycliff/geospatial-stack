import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
 * extra request on every single dataset selection. Rows are a textbook
 * shadcn `Table` -- a genuinely tabular action/actor/timestamp log, unlike
 * the free-form `<ul>` this used to be.
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
    <div className="rounded-md border border-border">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full justify-between rounded-b-none px-3 py-2 font-medium text-foreground"
      >
        <span>Audit history</span>
        {/* One icon that rotates rather than swapping between Up/Down --
            `transition-transform` turns "expanded" into a genuine animated
            state change instead of an instant icon replacement. */}
        <ChevronDownIcon className={`size-4 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </Button>
      {expanded && (
        <div className="animate-in fade-in border-t border-border p-3 duration-150">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && entries === null && <p className="text-sm text-muted-foreground">Loading&hellip;</p>}
          {entries !== null && entries.length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
          {entries !== null && entries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium text-foreground">{ACTION_LABELS[entry.action] ?? entry.action}</TableCell>
                    <TableCell className="text-muted-foreground">{entry.actor_email}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(entry.created_at).toLocaleString()}</TableCell>
                    <TableCell
                      className="max-w-xs truncate whitespace-normal text-muted-foreground"
                      title={summarizeDetails(entry.details)}
                    >
                      {summarizeDetails(entry.details)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
