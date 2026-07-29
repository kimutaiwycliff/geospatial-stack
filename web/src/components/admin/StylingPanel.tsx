import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  publishStyle,
  saveDraftStyle,
  UnauthorizedError,
  type AdminDataset,
  type DraftStyle,
  type LabelStyle,
  type StyleJson,
} from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

/**
 * Same fallback paint values mapSources.ts's buildFillLayer/buildOutlineLayer
 * hardcode for a dataset with no styling override yet -- used both as the
 * form's seed when a dataset has no draft row at all, AND merged under an
 * EXISTING draft (see `styleFrom`) so a draft saved before this panel grew
 * line/label controls still has sensible values for the new fields rather
 * than `undefined` flowing into a number input.
 */
const FALLBACK_STYLE: StyleJson = {
  "fill-color": "#2563eb",
  "fill-opacity": 0.35,
  "line-color": "#2563eb",
  "line-width": 1.5,
  "line-opacity": 1,
};

const DEFAULT_LABEL: LabelStyle = {
  enabled: false,
  field: "",
  size: 12,
  color: "#111111",
  haloColor: "#ffffff",
  haloWidth: 1,
};

function styleFrom(draft: DraftStyle | null): StyleJson {
  return { ...FALLBACK_STYLE, ...(draft?.style_json ?? {}) };
}

/** `bbox` is an internal struct column every ingested dataset carries (see
 * worker/tasks.py's `_schema_json`), not a real attribute a curator would
 * ever want rendered as a label -- filtered out here rather than at the
 * API layer, since AdminDataset's own doc comment already documents that
 * this is the caller's job. */
function labelFieldOptions(schemaJson: Record<string, string> | null): string[] {
  if (!schemaJson) return [];
  return Object.keys(schemaJson).filter((key) => key !== "bbox");
}

/** A raw `line-dasharray` number-array editor is bad UX for a "just pick a
 * look" panel -- GeoLibre's own line-decoration options boil down to the
 * same handful of recognizable patterns, so this panel offers presets
 * instead (mapSources.ts's buildOutlineLayer applies whichever array wins
 * verbatim; nothing downstream needs to know these are presets). */
const DASH_PRESET_KEYS = ["solid", "dashed", "dotted", "dash-dot"] as const;
type DashPresetKey = (typeof DASH_PRESET_KEYS)[number];

const DASH_PRESET_ARRAYS: Record<DashPresetKey, number[] | undefined> = {
  solid: undefined,
  dashed: [4, 2],
  dotted: [1, 2],
  "dash-dot": [4, 2, 1, 2],
};

const DASH_PRESET_LABELS: Record<DashPresetKey, string> = {
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  "dash-dot": "Dash-dot",
};

function dashPresetFor(dasharray: number[] | undefined): DashPresetKey {
  if (!dasharray || dasharray.length === 0) return "solid";
  const match = DASH_PRESET_KEYS.find(
    (key) => key !== "solid" && JSON.stringify(DASH_PRESET_ARRAYS[key]) === JSON.stringify(dasharray),
  );
  // A custom array this panel didn't itself produce (shouldn't happen --
  // nothing here writes anything but these 4 presets) falls back to
  // "dashed" as the closest non-solid preset rather than crashing on an
  // unrecognized value.
  return match ?? "dashed";
}

/**
 * Single-value styling (brief §6.3: "single-value styling first," still
 * true here -- every control below applies ONE value uniformly across a
 * layer's features, never a data-driven rule/classification the way a full
 * desktop GIS styling panel offers; see GeoLibre's own StylePanel.tsx for
 * how much further that goes, deliberately not followed here). Extends the
 * original fill-only panel with the outline's line color/width/opacity/
 * dash and a data-driven label (text-field sourced from the dataset's real
 * schema, not a free-text input a curator could typo).
 *
 * Owns its own draft/publish round-trip; `draft` is passed in from
 * AdminDashboard's one `GET /admin/styles/draft` fetch (shared across every
 * dataset row) rather than each panel instance fetching the whole list
 * itself.
 */
export function StylingPanel({
  token,
  dataset,
  draft,
  onDraftSaved,
}: {
  token: string;
  dataset: AdminDataset;
  draft: DraftStyle | null;
  onDraftSaved: (draft: DraftStyle) => void;
}) {
  const slug = dataset.slug;
  const { logout } = useAdminAuth();
  const [style, setStyle] = useState<StyleJson>(() => styleFrom(draft));
  const [hasDraft, setHasDraft] = useState(draft != null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const fieldOptions = labelFieldOptions(dataset.schema_json);
  const label = style.label ?? DEFAULT_LABEL;

  // Re-seed whenever a different dataset (or its freshly-loaded draft) is
  // selected -- mirrors GovernanceForm's "only on identity change" rule so
  // in-progress color/opacity edits don't get clobbered by an unrelated
  // re-render.
  useEffect(() => {
    setStyle(styleFrom(draft));
    setHasDraft(draft != null);
    setMessage(null);
  }, [slug, draft]);

  function setLabel(patch: Partial<LabelStyle>) {
    setStyle((prev) => ({ ...prev, label: { ...(prev.label ?? DEFAULT_LABEL), ...patch } }));
  }

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
    <div className="flex flex-col gap-5 pt-4">
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fill</h3>
        <div className="flex items-center gap-3">
          <Label htmlFor="fill-color" className="w-28">
            Color
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
          <Label htmlFor="fill-opacity" className="w-28">
            Opacity
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
      </div>

      <Separator />

      {/* Outline for a polygon dataset, but the ONLY visible rendering for a
          LineString-only one (roads/rivers) -- `fill` layers draw nothing
          for non-polygon geometry, see mapSources.ts's buildOutlineLayer. */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outline / line</h3>
        <div className="flex items-center gap-3">
          <Label htmlFor="line-color" className="w-28">
            Color
          </Label>
          <input
            id="line-color"
            type="color"
            value={style["line-color"] ?? style["fill-color"]}
            onChange={(e) => setStyle((prev) => ({ ...prev, "line-color": e.target.value }))}
            className="h-8 w-14 cursor-pointer rounded-md border border-input"
          />
          <span className="font-mono text-xs text-muted-foreground">{style["line-color"] ?? style["fill-color"]}</span>
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="line-width" className="w-28">
            Width
          </Label>
          <input
            id="line-width"
            type="range"
            min={0}
            max={8}
            step={0.5}
            value={style["line-width"] ?? 1.5}
            onChange={(e) => setStyle((prev) => ({ ...prev, "line-width": Number(e.target.value) }))}
            className="flex-1 accent-primary"
          />
          <span className="w-10 font-mono text-xs text-muted-foreground">{(style["line-width"] ?? 1.5).toFixed(1)}px</span>
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="line-opacity" className="w-28">
            Opacity
          </Label>
          <input
            id="line-opacity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={style["line-opacity"] ?? 1}
            onChange={(e) => setStyle((prev) => ({ ...prev, "line-opacity": Number(e.target.value) }))}
            className="flex-1 accent-primary"
          />
          <span className="w-10 font-mono text-xs text-muted-foreground">{(style["line-opacity"] ?? 1).toFixed(2)}</span>
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor="line-dash" className="w-28">
            Dash style
          </Label>
          <Select
            value={dashPresetFor(style["line-dasharray"])}
            onValueChange={(value) =>
              setStyle((prev) => ({ ...prev, "line-dasharray": DASH_PRESET_ARRAYS[value as DashPresetKey] }))
            }
          >
            <SelectTrigger id="line-dash" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DASH_PRESET_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {DASH_PRESET_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Switch id="label-enabled" checked={label.enabled} onCheckedChange={(enabled) => setLabel({ enabled })} />
          <Label htmlFor="label-enabled" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Labels
          </Label>
        </div>

        {label.enabled && (
          <div className="flex flex-col gap-3 pl-1">
            <div className="flex items-center gap-3">
              <Label htmlFor="label-field" className="w-28">
                Field
              </Label>
              {fieldOptions.length > 0 ? (
                <Select value={label.field} onValueChange={(field) => setLabel({ field })}>
                  <SelectTrigger id="label-field" className="w-52">
                    <SelectValue placeholder="Choose a field…" />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldOptions.map((field) => (
                      <SelectItem key={field} value={field}>
                        {field}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                // Every ingested dataset has a schema_json (worker/tasks.py's
                // _schema_json runs unconditionally) -- an empty list here
                // means the registry row predates that column, not a real
                // "no attributes" dataset, so this is a stale-data message,
                // not a validation error to block on.
                <span className="text-xs text-muted-foreground">No field list available for this dataset.</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="label-size" className="w-28">
                Text size
              </Label>
              <input
                id="label-size"
                type="range"
                min={8}
                max={24}
                step={1}
                value={label.size}
                onChange={(e) => setLabel({ size: Number(e.target.value) })}
                className="flex-1 accent-primary"
              />
              <span className="w-10 font-mono text-xs text-muted-foreground">{label.size}px</span>
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="label-color" className="w-28">
                Text color
              </Label>
              <input
                id="label-color"
                type="color"
                value={label.color}
                onChange={(e) => setLabel({ color: e.target.value })}
                className="h-8 w-14 cursor-pointer rounded-md border border-input"
              />
              <span className="font-mono text-xs text-muted-foreground">{label.color}</span>
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="label-halo-color" className="w-28">
                Halo color
              </Label>
              <input
                id="label-halo-color"
                type="color"
                value={label.haloColor}
                onChange={(e) => setLabel({ haloColor: e.target.value })}
                className="h-8 w-14 cursor-pointer rounded-md border border-input"
              />
              <span className="font-mono text-xs text-muted-foreground">{label.haloColor}</span>
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="label-halo-width" className="w-28">
                Halo width
              </Label>
              <input
                id="label-halo-width"
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={label.haloWidth}
                onChange={(e) => setLabel({ haloWidth: Number(e.target.value) })}
                className="flex-1 accent-primary"
              />
              <span className="w-10 font-mono text-xs text-muted-foreground">{label.haloWidth.toFixed(1)}px</span>
            </div>
          </div>
        )}
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
