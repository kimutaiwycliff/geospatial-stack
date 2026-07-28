import { Switch } from "@/components/ui/switch";
import { isMappable, type Dataset } from "../lib/api";
import { paletteColor } from "../lib/mapSources";
import { GovernanceBadges } from "./GovernanceBadges";

interface LayerPanelProps {
  datasets: Dataset[];
  visibleSlugs: string[];
  onToggle: (slug: string) => void;
}

/**
 * Replaces Phase 0's binary SourceToggle (Martin vs. PMTiles) with a real
 * layer list -- one toggle per geometry dataset, driven entirely by
 * `/datasets` (brief §6.2 "layer toggles"). Never hardcodes "2 layers":
 * this renders however many mappable rows the registry returns today, and
 * will render more the moment `landmark-indigenous-community-lands` (or
 * anything uploaded later) gets published, with zero frontend changes.
 *
 * Tabular datasets (geometry_type null -- the four LandMark indicator
 * tables behind /countries) are filtered out here: they have nothing to
 * toggle on a map, but they're still real registry rows with their own
 * governance metadata, which is why they're NOT filtered out of
 * `/datasets` itself -- a future "data catalog" view could still list them.
 */
export function LayerPanel({ datasets, visibleSlugs, onToggle }: LayerPanelProps) {
  const mappable = datasets.filter(isMappable);

  if (mappable.length === 0) {
    return <p className="text-sm text-muted-foreground">No map layers published yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Layers</h2>
      <ul className="flex flex-col gap-3">
        {mappable.map((dataset, index) => (
          <li key={dataset.slug} className="rounded-md border border-border p-2">
            <div className="flex items-start gap-2">
              {/* Checkbox -> Switch: a layer toggle is an on/off state change
                  (not a form field being validated/submitted), which is
                  exactly what Switch communicates at a glance -- and it's
                  the one shadcn primitive installed for this exact shape of
                  control, used identically for MapEditor's per-layer
                  visibility toggle below. */}
              <Switch
                className="mt-0.5"
                checked={visibleSlugs.includes(dataset.slug)}
                onCheckedChange={() => onToggle(dataset.slug)}
                aria-label={`Toggle ${dataset.name} layer`}
              />
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: paletteColor(index) }}
                    aria-hidden
                  />
                  <span className="text-sm font-medium text-foreground">{dataset.name}</span>
                </span>
                <span className="mt-1 block">
                  <GovernanceBadges dataset={dataset} compact />
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
