import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sensitivityTintClassName } from "../lib/statusColors";
import type { Dataset } from "../lib/api";

/**
 * Sensitivity -> shadcn Badge variant (brief §13: "Sensitivity
 * classification per dataset (public / restricted / withheld), enforced in
 * the registry"). Every published dataset today is "public" (see api curl
 * output at build time), but restricted/withheld are real registry values
 * the UI has to be able to render correctly the day a curator marks one
 * that way -- this isn't speculative, it's the whole point of brief §13
 * being "non-optional". This exact mapping (public/restricted/withheld ->
 * secondary/outline/destructive) is the ONE convention used everywhere
 * sensitivity is shown (also GovernanceForm's select options) -- don't
 * invent a second one elsewhere. `sensitivityTintClassName` (shared with
 * AdminDashboard's tier badge and AdminMapsPage's map-status badge) layers
 * an actual green/amber color on top of that variant -- see
 * lib/statusColors.ts for why withheld is left to shadcn's own red
 * `destructive` variant instead of a fourth tint.
 */
const SENSITIVITY_BADGE_VARIANT: Record<string, "secondary" | "outline" | "destructive"> = {
  public: "secondary",
  restricted: "outline",
  withheld: "destructive",
};

export function SensitivityBadge({ sensitivity }: { sensitivity: string }) {
  const variant = SENSITIVITY_BADGE_VARIANT[sensitivity] ?? "outline";
  return (
    <Badge variant={variant} className={cn("capitalize", sensitivityTintClassName(sensitivity))}>
      {sensitivity}
    </Badge>
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
      <span className={compact ? "text-muted-foreground" : "text-muted-foreground"}>
        <span className="font-medium text-foreground">License:</span> {dataset.license}
      </span>
      {!compact && (
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">Attribution:</span> {dataset.attribution}
        </span>
      )}
    </div>
  );
}
