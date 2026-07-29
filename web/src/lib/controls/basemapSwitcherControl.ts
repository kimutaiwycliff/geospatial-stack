import type { IControl, Map as MapLibreMap } from "maplibre-gl";
import { applyBasemapFlavor, BASEMAP_FLAVORS, BASEMAP_FLAVOR_LABELS, type BasemapFlavor } from "../basemapStyle";

/**
 * Basemap style switcher, now "just another map control" (brief follow-up)
 * -- toggleable and positionable via the SAME controls_json system as
 * navigation/search/measure/etc, instead of the bespoke always-on corner
 * element MapBySlugPage.tsx used to hard-render. A native `<select>`
 * (not a custom panel like bookmarkControl's) since this is a single
 * mutually-exclusive choice among 5 named options -- exactly what a
 * `<select>` is for, and it comes with built-in keyboard/accessibility
 * support the bookmark control's hand-rolled dropdown has to do without.
 *
 * `initialFlavor` seeds the dropdown's displayed value to match whatever
 * flavor the map was ALREADY built with (see MapBySlugPage.tsx's call to
 * `applyMapControls`, which threads the Map's own `basemap` column through
 * here) -- this control doesn't ask the map what flavor it's currently
 * showing (there's no reliable way to read that back out of a compiled
 * style), so it has to be told.
 */
export function createBasemapSwitcherControl(initialFlavor: BasemapFlavor = "light"): IControl {
  return {
    onAdd(map: MapLibreMap) {
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";

      const select = document.createElement("select");
      select.setAttribute("aria-label", "Basemap style");
      select.style.cssText =
        "border:none;background:transparent;font-size:12px;padding:4px 6px;cursor:pointer;width:auto;height:29px;color:inherit;";
      for (const flavor of BASEMAP_FLAVORS) {
        const option = document.createElement("option");
        option.value = flavor;
        option.textContent = BASEMAP_FLAVOR_LABELS[flavor];
        if (flavor === initialFlavor) option.selected = true;
        select.appendChild(option);
      }
      select.onchange = () => applyBasemapFlavor(map, select.value as BasemapFlavor);
      container.appendChild(select);
      return container;
    },
    onRemove() {},
  };
}
