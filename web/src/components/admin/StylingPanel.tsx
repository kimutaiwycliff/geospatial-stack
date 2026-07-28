import { useEffect, useState } from "react";
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
      onDraftSaved({ slug, style_json: result.style_json, version: result.version, updated_by: "", updated_at: new Date().toISOString() });
    } catch (err) {
      // See GovernanceForm's identical branch -- 401 means the session
      // expired; logout() + RequireAdmin handles the redirect.
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not save draft." });
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
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not publish -- save a draft first." });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-3 text-sm">
        <span className="w-24 font-medium text-slate-700">Fill color</span>
        <input
          type="color"
          value={style["fill-color"]}
          onChange={(e) => setStyle((prev) => ({ ...prev, "fill-color": e.target.value }))}
          className="h-8 w-14 cursor-pointer rounded border border-slate-300"
        />
        <span className="font-mono text-xs text-slate-500">{style["fill-color"]}</span>
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="w-24 font-medium text-slate-700">Fill opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={style["fill-opacity"]}
          onChange={(e) => setStyle((prev) => ({ ...prev, "fill-opacity": Number(e.target.value) }))}
          className="flex-1"
        />
        <span className="w-10 font-mono text-xs text-slate-500">{style["fill-opacity"].toFixed(2)}</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={saving}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={!hasDraft || publishing}
          title={hasDraft ? undefined : "Save a draft before publishing"}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
        {message && (
          <p className={`text-sm ${message.kind === "success" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
}
