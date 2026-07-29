/**
 * One shared color convention for every status-flavored Badge in the app --
 * dataset sensitivity (GovernanceBadges), dataset tier_status
 * (AdminDashboard's list), and map publish status (AdminMapsPage's list).
 * Before this pass each of those three rendered with shadcn's neutral
 * secondary/outline/default Badge variants, which all resolve to shades of
 * gray in this theme -- functional but colorless. This layers a genuine
 * green/amber tint ON TOP of that same variant prop (variant still controls
 * border/spacing/shape; this only overrides color), reusing the EXACT
 * green/amber shades UploadStatusPanel/GovernanceForm/StylingPanel/
 * MapEditor already established for their own success/pending Alert
 * messages (SUCCESS_ALERT_CLASS/AMBER_ALERT_CLASS) -- one color vocabulary
 * for "this is good/live" and "this needs a look/decision" across the whole
 * app, not a second one invented just for badges.
 *
 * destructive/withheld/failed states are deliberately NOT covered here --
 * every caller keeps shadcn's built-in `destructive` Badge variant for
 * those (already red, already correct, don't reinvent it).
 */
const GREEN_BADGE_CLASS =
  "border-green-600/30 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-950/30 dark:text-green-400";
const AMBER_BADGE_CLASS =
  "border-amber-600/30 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-400";

/** public (visible to everyone -- the "good to go" state) -> green;
 * restricted (access-controlled, needs a curator's ongoing judgment) ->
 * amber; withheld isn't handled here -- callers keep Badge's `destructive`
 * variant for it instead of adding a className. */
export function sensitivityTintClassName(sensitivity: string): string {
  if (sensitivity === "public") return GREEN_BADGE_CLASS;
  if (sensitivity === "restricted") return AMBER_BADGE_CLASS;
  return "";
}

/** published (live on the public map) -> green; curated (validated,
 * awaiting a publish decision) -> amber; raw stays neutral outline --
 * nothing to flag yet, it just landed. */
export function tierTintClassName(tier: string): string {
  if (tier === "published") return GREEN_BADGE_CLASS;
  if (tier === "curated") return AMBER_BADGE_CLASS;
  return "";
}

/** published -> green; draft (the map-authoring equivalent of "curated",
 * not live yet) -> amber. */
export function mapStatusTintClassName(status: string): string {
  if (status === "published") return GREEN_BADGE_CLASS;
  if (status === "draft") return AMBER_BADGE_CLASS;
  return "";
}

/** Exported for the one ad-hoc badge that isn't a sensitivity/tier/map
 * status (AdminDashboard's upload-flow "awaiting approval" pill) but still
 * wants the exact same amber, not a fifth hand-rolled shade. */
export { AMBER_BADGE_CLASS };
