import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BASEMAP_FLAVORS, BASEMAP_FLAVOR_LABELS, type BasemapFlavor } from "../lib/basemapStyle";

/**
 * Picker for the 5 color schemes @protomaps/basemaps ships (light/dark/
 * white/grayscale/black) -- reused as-is by both MapPage's sidebar (the
 * general all-datasets explorer) and MapBySlugPage's floating chrome (one
 * published Map's public view), so switching basemaps looks and behaves
 * identically in both places. Deliberately a plain controlled `<Select>`,
 * not a MapLibre `IControl` like search/measure/minimap -- those live
 * inside the map's own corner-control system because they're per-Map
 * authoring config (brief §16); this is a client-side view preference any
 * visitor can change regardless of what a Map's author configured, so it
 * belongs in this app's own React chrome instead.
 */
export function BasemapSwitcher({
  value,
  onChange,
  className,
}: {
  value: BasemapFlavor;
  onChange: (flavor: BasemapFlavor) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as BasemapFlavor)}>
      <SelectTrigger className={className ?? "w-full"} aria-label="Basemap style">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BASEMAP_FLAVORS.map((flavor) => (
          <SelectItem key={flavor} value={flavor}>
            {BASEMAP_FLAVOR_LABELS[flavor]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
