import { useState } from "react";
import type { AdminDataset, DraftStyle } from "../../lib/adminApi";
import { AuditLogPanel } from "./AuditLogPanel";
import { GovernanceForm } from "./GovernanceForm";
import { StylingPanel } from "./StylingPanel";

type Tab = "governance" | "styling";

/**
 * Governance + styling for one selected dataset, in a single view (brief
 * point 4: "click into a dataset to edit its governance fields AND its
 * draft style in one view -- a two-tab or two-panel layout is fine"). Tabs
 * chosen over side-by-side panels purely because the styling controls
 * (color swatch + slider) and the governance fields (five text inputs) are
 * different enough widths that stacking them side by side either wastes
 * space or squeezes the text inputs -- tabs let each keep its natural
 * width. Audit history stays visible under both tabs rather than being a
 * third tab, since "what happened to this dataset" is relevant regardless
 * of which editor you're currently in.
 */
export function DatasetDetail({
  token,
  dataset,
  draft,
  onGovernanceSaved,
  onDraftSaved,
}: {
  token: string;
  dataset: AdminDataset;
  draft: DraftStyle | null;
  onGovernanceSaved: (patch: Partial<AdminDataset>) => void;
  onDraftSaved: (draft: DraftStyle) => void;
}) {
  const [tab, setTab] = useState<Tab>("governance");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{dataset.name}</h2>
        <p className="text-xs text-slate-500">
          {dataset.slug} &middot; tier: {dataset.tier_status}
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(["governance", "styling"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium capitalize ${
              tab === t ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "governance" && <GovernanceForm token={token} dataset={dataset} onSaved={onGovernanceSaved} />}
      {tab === "styling" && (
        <StylingPanel key={dataset.slug} token={token} slug={dataset.slug} draft={draft} onDraftSaved={onDraftSaved} />
      )}

      <AuditLogPanel key={`audit:${dataset.slug}`} token={token} slug={dataset.slug} />
    </div>
  );
}
