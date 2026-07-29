import type { IControl, Map as MapLibreMap } from "maplibre-gl";
import { datasetSlugFromLayerId } from "../mapSources";

/**
 * Auto-generated legend (GeoLibre-menu parity's "Legend"): lists every
 * currently-VISIBLE geometry layer with its actual rendered fill color,
 * read straight off the map's own style instead of needing the dataset
 * list threaded in from React state. That keeps this control
 * self-contained like every other hand-built one here (search/measure/
 * minimap/gridlines) rather than breaking the "just an IControl, no
 * outside data dependency" pattern MapEditor's controls_json system
 * assumes -- MapEditor only ever calls `CONTROL_FACTORIES[id]()` with no
 * arguments (see mapControls.ts).
 *
 * Labeled by dataset SLUG, not the registry's human-readable `name` --
 * the slug is the one piece of identity a MapLibre layer id itself encodes
 * (`fill:{slug}`, see mapSources.ts's `fillLayerId`/`datasetSlugFromLayerId`);
 * the display name lives only in the `/datasets` API response, which this
 * control deliberately doesn't depend on. Re-renders on every `styledata`
 * event, which MapLibre already fires for both "a new fill layer was
 * added" and "an existing layer's visibility was toggled" (LayerPanel's
 * `setLayoutProperty` calls) -- one listener covers both without this
 * control needing its own separate hook into LayerPanel's toggle state.
 */
export function createLegendControl(): IControl {
  let map: MapLibreMap | null = null;
  let container: HTMLElement | null = null;

  function refresh() {
    if (!map || !container) return;
    container.innerHTML = "";

    const rows = (map.getStyle()?.layers ?? [])
      .filter((layer) => layer.id.startsWith("fill:"))
      .filter((layer) => (map!.getLayoutProperty(layer.id, "visibility") ?? "visible") !== "none")
      .map((layer) => ({
        slug: datasetSlugFromLayerId(layer.id) ?? layer.id,
        color: (map!.getPaintProperty(layer.id, "fill-color") as string | undefined) ?? "#999999",
      }));

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "px-1 py-0.5 text-xs text-muted-foreground";
      empty.textContent = "No visible layers.";
      container.appendChild(empty);
      return;
    }

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "flex items-center gap-1.5 px-1 py-0.5 text-xs";

      const swatch = document.createElement("span");
      swatch.className = "inline-block h-2.5 w-2.5 shrink-0 rounded-full";
      swatch.style.backgroundColor = row.color;
      item.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "truncate text-foreground";
      label.textContent = row.slug;
      item.appendChild(label);

      container.appendChild(item);
    }
  }

  return {
    onAdd(m) {
      map = m;
      container = document.createElement("div");
      container.className =
        "maplibregl-ctrl flex max-w-48 flex-col gap-0.5 rounded-md border border-border bg-card/95 p-2 shadow";

      map.on("styledata", refresh);
      if (map.isStyleLoaded()) refresh();
      else map.once("load", refresh);

      return container;
    },
    onRemove() {
      map?.off("styledata", refresh);
      map = null;
      container = null;
    },
  };
}
