import type { CountrySummary, FeatureDetail } from "./api";

/**
 * What the side panel is currently showing (brief §6.2: "clickable polygons
 * -> popups + side panel"). A discriminated union rather than two separate
 * pieces of state (selectedFeature / selectedCountry) so MapPage only ever
 * has one "currently selected thing" to reason about, and SidePanel can
 * switch on `kind` instead of juggling nullable-and-independent fields.
 *
 * The feature variant's `detail`/`error` are both optional and mutually
 * exclusive: absent-detail-absent-error means "fetch in flight" (renders a
 * loading state), present-error means the fetch failed.
 */
export type Selection =
  | { kind: "feature"; datasetSlug: string; datasetName: string; detail?: FeatureDetail; error?: string }
  | { kind: "country"; summary: CountrySummary };
