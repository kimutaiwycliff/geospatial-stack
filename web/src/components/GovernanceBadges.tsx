import type { Dataset } from "../lib/api";

/**
 * Sensitivity color coding (brief §13: "Sensitivity classification per
 * dataset (public / restricted / withheld), enforced in the registry").
 * Every published dataset today is "public" (see api curl output at build
 * time), but restricted/withheld are real registry values the UI has to be
 * able to render correctly the day a curator marks one that way -- this
 * isn't speculative, it's the whole point of brief §13 being "non-optional".
 */
const SENSITIVITY_STYLES: Record<string, string> = {
  public: "bg-green-100 text-green-800 border-green-300",
  restricted: "bg-amber-100 text-amber-800 border-amber-300",
  withheld: "bg-red-100 text-red-800 border-red-300",
};

function SensitivityBadge({ sensitivity }: { sensitivity: string }) {
  const style = SENSITIVITY_STYLES[sensitivity] ?? "bg-slate-100 text-slate-700 border-slate-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${style}`}>{sensitivity}</span>
  );
}

/**
 * License + attribution + sensitivity, together, wherever a dataset is
 * shown (brief §13: "Licensing surfaced in the UI" -- non-negotiable, not
 * per-component optional). Used both in the compact layer-list rows and
 * the fuller side-panel dataset detail; `compact` trims it to fit a narrow
 * checkbox row instead of dropping any of the three fields.
 */
export function GovernanceBadges({ dataset, compact = false }: { dataset: Dataset; compact?: boolean }) {
  return (
    <div className={compact ? "flex flex-wrap items-center gap-1.5 text-xs" : "flex flex-col gap-1.5 text-sm"}>
      <SensitivityBadge sensitivity={dataset.sensitivity} />
      <span className={compact ? "text-slate-500" : "text-slate-600"}>
        <span className="font-medium">License:</span> {dataset.license}
      </span>
      {!compact && (
        <span className="text-slate-600">
          <span className="font-medium">Attribution:</span> {dataset.attribution}
        </span>
      )}
    </div>
  );
}
