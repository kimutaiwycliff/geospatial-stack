import type { Dataset } from "../lib/api";
import type { Selection } from "../lib/selection";
import { GovernanceBadges } from "./GovernanceBadges";

interface SidePanelProps {
  selection: Selection | null;
  datasets: Dataset[];
  onClose: () => void;
}

/** Keys every dataset's rows share that aren't useful to show a viewer --
 * the raw geometry (already rendered on the map) and the surrogate PK. */
const HIDDEN_KEYS = new Set(["geom", "geometry"]);

function AttributeTable({ record }: { record: Record<string, unknown> }) {
  const rows = Object.entries(record).filter(([key, value]) => !HIDDEN_KEYS.has(key) && value !== null && value !== "");
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">No attributes to show.</p>;
  }
  return (
    <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([key, value]) => (
        <div className="contents" key={key}>
          <dt className="truncate font-medium text-slate-500" title={key}>
            {key}
          </dt>
          <dd className="break-words text-slate-800">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Persistent detail panel (brief §6.2: "clickable polygons -> popups + side
 * panel" -- the map's own Popup is deliberately just a quick "what did I
 * click" hint; this is where the actual attribute list / country summary
 * lives). Renders one of two shapes depending on `selection.kind`:
 *   - "feature": whatever `/features/{slug}/{id}` returned, plus that
 *     dataset's governance badges (brief §13 applies wherever a dataset's
 *     data is shown, not just the layer list).
 *   - "country": the full `/countries/{iso}`-shaped row from `/countries`,
 *     grouped by its pop_, pct_, tsic_, tsii_ prefixes so 100+ flat columns
 *     read as four related indicator groups instead of one giant table.
 */
export function SidePanel({ selection, datasets, onClose }: SidePanelProps) {
  if (!selection) return null;

  return (
    <aside className="flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          {selection.kind === "feature" ? (selection.detail?.name as string | undefined) ?? "Feature" : (selection.summary.pop_country as string)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-full px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          &times;
        </button>
      </div>

      {selection.kind === "feature" && <FeaturePanelBody selection={selection} datasets={datasets} />}
      {selection.kind === "country" && <CountryPanelBody summary={selection.summary} />}
    </aside>
  );
}

function FeaturePanelBody({
  selection,
  datasets,
}: {
  selection: Extract<Selection, { kind: "feature" }>;
  datasets: Dataset[];
}) {
  const dataset = datasets.find((d) => d.slug === selection.datasetSlug);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{selection.datasetName}</p>
      {dataset && (
        <div className="rounded-md bg-slate-50 p-3">
          <GovernanceBadges dataset={dataset} />
        </div>
      )}
      {selection.error && <p className="text-sm text-red-600">{selection.error}</p>}
      {!selection.error && !selection.detail && <p className="text-sm text-slate-500">Loading&hellip;</p>}
      {selection.detail && <AttributeTable record={selection.detail} />}
    </div>
  );
}

/** Groups the flat country_summary row by its pop_/pct_/tsic_/tsii_ column
 * prefixes -- matching how api/worker/tabular_tasks.py's
 * build_country_summary_view_task built the view in the first place (one
 * prefix per source LandMark table), so the grouping in the UI mirrors the
 * grouping the data actually has. */
const INDICATOR_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "pop_", label: "Indigenous population" },
  { prefix: "pct_", label: "% of country held by Indigenous peoples & communities" },
  { prefix: "tsic_", label: "Tenure security -- community law" },
  { prefix: "tsii_", label: "Tenure security -- Indigenous Peoples' law" },
];

function CountryPanelBody({ summary }: { summary: Record<string, unknown> }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">ISO {String(summary.iso_code)}</p>
      {INDICATOR_GROUPS.map(({ prefix, label }) => {
        const group = Object.fromEntries(
          Object.entries(summary)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => [key.slice(prefix.length), value]),
        );
        if (Object.keys(group).length === 0) return null;
        return (
          <div key={prefix}>
            <h3 className="mb-1 text-sm font-semibold text-slate-700">{label}</h3>
            <AttributeTable record={group} />
          </div>
        );
      })}
    </div>
  );
}
