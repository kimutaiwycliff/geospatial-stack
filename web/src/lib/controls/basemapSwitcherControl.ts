import type { IControl, Map as MapLibreMap } from "maplibre-gl";
import { applyBasemapFlavor, BASEMAP_FLAVORS, BASEMAP_FLAVOR_LABELS, type BasemapFlavor } from "../basemapStyle";

/** A stacked-layers glyph -- the standard visual shorthand for "basemap /
 * layer style," inlined as SVG (no icon-font/external asset dependency,
 * same bar every other hand-built control here holds itself to) rather
 * than a text glyph (bookmarkControl's "★"): a stack of squares reads
 * unambiguously at 15px in a way no single character does. */
const LAYERS_ICON = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
  <polyline points="2 17 12 22 22 17"></polyline>
  <polyline points="2 12 12 17 22 12"></polyline>
</svg>`;

/**
 * Basemap style switcher, sized and styled like every other corner button
 * (brief follow-up: "make basemap switcher ... smaller to fit in just
 * like the map controls with the appropriate icon") -- a
 * `maplibregl-ctrl-icon` button (the exact class MapLibre's own built-in
 * controls use, giving it the same ~29x29px footprint and hover styling
 * as Navigation/Fullscreen/etc) instead of the wider native `<select>`
 * this used to be. Clicking it opens a small dropdown of the 5 flavor
 * names -- same button+panel pattern as bookmarkControl.ts.
 */
export function createBasemapSwitcherControl(initialFlavor: BasemapFlavor = "light"): IControl {
  return {
    onAdd(map: MapLibreMap) {
      let current = initialFlavor;

      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";
      container.style.position = "relative";

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "maplibregl-ctrl-icon";
      toggleButton.title = "Basemap style";
      toggleButton.setAttribute("aria-label", "Basemap style");
      toggleButton.innerHTML = LAYERS_ICON;
      toggleButton.style.display = "flex";
      toggleButton.style.alignItems = "center";
      toggleButton.style.justifyContent = "center";
      container.appendChild(toggleButton);

      const panel = document.createElement("div");
      panel.className =
        "hidden absolute right-0 top-full z-10 mt-1 w-32 flex-col overflow-hidden rounded-md border border-border bg-card p-1 text-sm shadow-lg";
      container.appendChild(panel);

      function renderPanel() {
        panel.innerHTML = "";
        for (const flavor of BASEMAP_FLAVORS) {
          const option = document.createElement("button");
          option.type = "button";
          option.className =
            flavor === current
              ? "rounded px-2 py-1 text-left text-xs font-medium bg-muted text-foreground"
              : "rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted";
          option.textContent = BASEMAP_FLAVOR_LABELS[flavor];
          option.onclick = () => {
            current = flavor;
            applyBasemapFlavor(map, flavor);
            panel.classList.add("hidden");
            panel.classList.remove("flex");
          };
          panel.appendChild(option);
        }
      }

      toggleButton.onclick = () => {
        const isHidden = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !isHidden);
        panel.classList.toggle("flex", isHidden);
        if (isHidden) renderPanel();
      };

      return container;
    },
    onRemove() {},
  };
}
