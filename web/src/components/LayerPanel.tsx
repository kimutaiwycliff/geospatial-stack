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
 * layer list -- one checkbox per geometry dataset, driven entirely by
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
    return <p className="text-sm text-slate-500">No map layers published yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Layers</h2>
      <ul className="flex flex-col gap-3">
        {mappable.map((dataset, index) => (
          <li key={dataset.slug} className="rounded-md border border-slate-200 p-2">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={visibleSlugs.includes(dataset.slug)}
                onChange={() => onToggle(dataset.slug)}
              />
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: paletteColor(index) }}
                    aria-hidden
                  />
                  <span className="text-sm font-medium text-slate-800">{dataset.name}</span>
                </span>
                <span className="mt-1 block">
                  <GovernanceBadges dataset={dataset} compact />
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
