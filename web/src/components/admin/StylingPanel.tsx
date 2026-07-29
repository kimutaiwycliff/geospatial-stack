import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { publishStyle, saveDraftStyle, UnauthorizedError, type DraftStyle, type StyleJson } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

/**
 * Same fallback paint values mapSources.ts's buildFillLayer/buildOutlineLayer
 * hardcode for a dataset with no styling override yet -- used here ONLY as
 * the form's seed when a dataset has no draft row at all. Once a draft
 * exists, its saved values always win (brief point 5: re-opening a dataset
 * must show its last-saved-but-unpublished values, not this default).
 */
const FALLBACK_STYLE: StyleJson = { "fill-color": "#2563eb", "fill-opacity": 0.35 };

/**
 * Single-value fill styling (brief §6.3: "single-value styling first" --
 * just fill-color + fill-opacity, not a full style-spec editor). Owns its
 * own draft/publish round-trip; `draft` is passed in from AdminDashboard's
 * one `GET /admin/styles/draft` fetch (shared across every dataset row)
 * rather than each panel instance fetching the whole list itself.
 */
export function StylingPanel({
  token,
  slug,
  draft,
  onDraftSaved,
}: {
  token: string;
  slug: string;
  draft: DraftStyle | null;
  onDraftSaved: (draft: DraftStyle) => void;
}) {
  const { logout } = useAdminAuth();
  const [style, setStyle] = useState<StyleJson>(() => draft?.style_json ?? FALLBACK_STYLE);
  const [hasDraft, setHasDraft] = useState(draft != null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Re-seed whenever a different dataset (or its freshly-loaded draft) is
  // selected -- mirrors GovernanceForm's "only on identity change" rule so
  // in-progress color/opacity edits don't get clobbered by an unrelated
  // re-render.
  useEffect(() => {
    setStyle(draft?.style_json ?? FALLBACK_STYLE);
    setHasDraft(draft != null);
    setMessage(null);
  }, [slug, draft]);

  async function handleSaveDraft() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveDraftStyle(token, slug, style);
      setHasDraft(true);
      setMessage({ kind: "success", text: "Draft saved." });
      toast.success("Draft saved.");
      onDraftSaved({ slug, style_json: result.style_json, version: result.version, updated_by: "", updated_at: new Date().toISOString() });
    } catch (err) {
      // See GovernanceForm's identical branch -- 401 means the session
      // expired; logout() + RequireAdmin handles the redirect.
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not save draft." });
      toast.error("Could not save draft.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    try {
      await publishStyle(token, slug);
      setMessage({ kind: "success", text: "Published." });
      toast.success("Style published.");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not publish -- save a draft first." });
      toast.error("Could not publish -- save a draft first.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex items-center gap-3">
        <Label htmlFor="fill-color" className="w-24">
          Fill color
        </Label>
        {/* Native color input stays as-is (brief: shadcn has no color
            picker, and pulling in react-colorful is explicitly out of
            scope) -- only its border/sizing follows the same rounded/
            border-input look as every other control here. */}
        <input
          id="fill-color"
          type="color"
          value={style["fill-color"]}
          onChange={(e) => setStyle((prev) => ({ ...prev, "fill-color": e.target.value }))}
          className="h-8 w-14 cursor-pointer rounded-md border border-input"
        />
        <span className="font-mono text-xs text-muted-foreground">{style["fill-color"]}</span>
      </div>

      <div className="flex items-center gap-3">
        <Label htmlFor="fill-opacity" className="w-24">
          Fill opacity
        </Label>
        <input
          id="fill-opacity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style["fill-opacity"]}
          onChange={(e) => setStyle((prev) => ({ ...prev, "fill-opacity": Number(e.target.value) }))}
          className="flex-1 accent-primary"
        />
        <span className="w-10 font-mono text-xs text-muted-foreground">{style["fill-opacity"].toFixed(2)}</span>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={saving}>
          {saving ? "Saving…" : "Save draft"}
        </Button>
        <Button
          type="button"
          onClick={handlePublish}
          disabled={!hasDraft || publishing}
          title={hasDraft ? undefined : "Save a draft before publishing"}
        >
          {publishing ? "Publishing…" : "Publish"}
        </Button>
        {message && (
          // Same fade-in-on-appear as GovernanceForm's identical save/publish
          // confirmation -- these two forms already share this Alert
          // convention, so they share the animation too.
          <Alert
            variant={message.kind === "error" ? "destructive" : "default"}
            className={
              message.kind === "success"
                ? "w-auto animate-in fade-in border-green-600/30 bg-transparent px-3 py-1.5 text-green-700 duration-200 dark:border-green-500/30 dark:text-green-400"
                : "w-auto animate-in fade-in px-3 py-1.5 duration-200"
            }
          >
            <AlertDescription className={message.kind === "success" ? "text-green-700 dark:text-green-400" : undefined}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
