import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { mapStatusTintClassName } from "../../lib/statusColors";
import { createMap, fetchAdminMaps, UnauthorizedError, type AdminMapSummary } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import { ThemeToggle } from "../ThemeToggle";

/**
 * map status -> Badge variant. Same "published = default" half of
 * AdminDashboard's TIER_BADGE_VARIANT convention -- draft (this resource's
 * only non-published state) gets "secondary", matching how that list
 * treats its own in-progress tier ("curated"). `mapStatusTintClassName`
 * (shared with GovernanceBadges/AdminDashboard, see lib/statusColors.ts)
 * layers the actual green/amber color on top.
 */
const STATUS_BADGE_VARIANT: Record<AdminMapSummary["status"], "secondary" | "default"> = {
  draft: "secondary",
  published: "default",
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
  // Same "first fetch only" loading flag as AdminDashboard's dataset list --
  // an empty `maps` array is otherwise ambiguous with "no maps exist yet".
  const [mapsLoading, setMapsLoading] = useState(true);

  const load = useCallback(() => {
    fetchAdminMaps(authToken)
      .then(setMaps)
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) return logout();
        setLoadError("Could not load maps.");
      })
      .finally(() => setMapsLoading(false));
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
    <div className="flex h-screen w-screen flex-col animate-in fade-in duration-300">
      <div className="flex items-center justify-between border-b border-border bg-background p-4">
        <div className="flex items-center gap-4">
          <Link to="/admin" className="text-xs text-primary hover:underline">
            &larr; Datasets
          </Link>
          <h1 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Maps</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="link" size="sm" onClick={logout}>
            Sign out
          </Button>
          <ThemeToggle />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto p-6">
        {!creating && (
          <Button type="button" className="self-start" onClick={() => setCreating(true)}>
            New map
          </Button>
        )}

        {creating && (
          <form onSubmit={handleCreate} className="flex items-end gap-3 rounded-md border border-border p-4">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-map-name">Name</Label>
              <Input id="new-map-name" type="text" required autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                setCreating(false);
                setNewName("");
                setCreateError(null);
              }}
            >
              Cancel
            </Button>
          </form>
        )}
        {createError && (
          <Alert variant="destructive" className="animate-in fade-in duration-200">
            <AlertDescription>{createError}</AlertDescription>
          </Alert>
        )}
        {loadError && (
          <Alert variant="destructive" className="animate-in fade-in duration-200">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {/* Plain bordered list, not a shadcn `Table` -- mirrors
            AdminDashboard's dataset list (a click-through nav list, not
            tabular data meant to be scanned column-by-column), so the two
            "select an item to manage" screens in this app read as the same
            pattern. */}
        {mapsLoading && (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
            {[0, 1].map((i) => (
              <li key={i} className="flex flex-col gap-2 p-4">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </li>
            ))}
          </ul>
        )}
        {!mapsLoading && (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
            {maps.length === 0 && !loadError && <li className="p-4 text-sm text-muted-foreground">No maps yet.</li>}
            {maps.map((map) => (
              <li key={map.id}>
                <Link
                  to={`/admin/maps/${map.slug}`}
                  className="flex items-center justify-between gap-3 p-4 transition-colors duration-150 hover:bg-muted"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{map.name}</span>
                    <span className="text-xs text-muted-foreground">{map.slug}</span>
                  </div>
                  <Badge variant={STATUS_BADGE_VARIANT[map.status]} className={cn("capitalize", mapStatusTintClassName(map.status))}>
                    {map.status}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
