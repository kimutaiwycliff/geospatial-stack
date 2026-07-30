import type { IControl, Map as MapLibreMap } from "maplibre-gl";
import type { Dataset } from "../api";
import {
  applyBasemapFlavor,
  BASEMAP_FLAVOR_LABELS,
  BASEMAP_FLAVORS,
  BASEMAP_SOURCE_ID,
  type BasemapFlavor,
} from "../basemapStyle";
import { geometryBounds } from "../geo";
import { datasetSlugFromLayerId, fillLayerId, labelLayerId, outlineLayerId } from "../mapSources";
import { shapeForGeometryType } from "./legendControl";

/** Stacked-layers glyph -- the same one basemapSwitcherControl.ts used to
 * own by itself. Brief follow-up: "combine the Layers ... to be inside the
 * basemap switcher icon" -- GeoLibre's own corner layer-control plugin
 * already treats the basemap as just another row alongside dataset
 * layers, in ONE panel behind ONE icon, rather than two separate corner
 * buttons; this merges the two controls this app had into that same
 * shape instead of keeping them apart. */
const LAYERS_ICON = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
  <polyline points="2 17 12 22 22 17"></polyline>
  <polyline points="2 12 12 17 22 12"></polyline>
</svg>`;

/** "Zoom/fit to this layer's extent" -- a corner-brackets glyph (lucide's
 * Maximize), distinct from the search control's magnifying glass since this
 * fits a known extent rather than looking anything up. */
const ZOOM_TO_ICON = `
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
  <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
  <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
  <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
</svg>`;

/**
 * GeoLibre parity follow-up: their Layers control (both the full sidebar
 * LayerPanel and the smaller `maplibre-gl-layer-control`-based corner
 * button) lists every loaded layer -- INCLUDING the basemap itself as one
 * row -- with a visibility toggle and (the fuller panel) a zoom-to-layer
 * action. This is the corner-control form factor (like every other
 * hand-built control here, not a permanently-docked sidebar -- that's
 * desktop-GIS authoring chrome this app has repeatedly scoped out of, same
 * call as the legend/gridlines research). Drag-to-reorder, rename, opacity
 * sliders, remove/delete, and layer groups are ALL deliberately left out
 * too -- those mutate a Map's actual authored config, which is exactly
 * what the admin Map editor is for; a viewer-facing control should only
 * ever toggle/inspect, never restructure.
 *
 * Distinct from legendControl.ts on purpose, not a shared refactor of it:
 * the legend's row list is filtered/labeled by a Map's own legend config
 * (`items[slug].hidden`/`label`, an admin-authored "how the legend reads"
 * setting) -- this control lists literally every dataset layer currently
 * on the map regardless of that config, since "is this layer visible/
 * zoomable" shouldn't depend on whether an admin chose to describe it in
 * the legend. The two share only the genuinely reusable primitive
 * (`shapeForGeometryType`, imported from legendControl.ts).
 */
export function createLayersControl(initialBasemapFlavor: BasemapFlavor = "light", datasets: Dataset[] = []): IControl {
  let map: MapLibreMap | null = null;
  let container: HTMLElement | null = null;
  let toggleButton: HTMLButtonElement;
  let panel: HTMLDivElement;
  let currentFlavor = initialBasemapFlavor;
  // Independent of `currentFlavor` -- an admin can hide the basemap
  // entirely (brief follow-up: "toggle it off to switch off the basemap
  // alongside the other available layers") without that being tied to any
  // one flavor choice.
  let basemapVisible = true;

  const datasetBySlug = new Map(datasets.map((d) => [d.slug, d]));

  function toggleVisibility(slug: string, nextVisible: boolean) {
    if (!map) return;
    const visibility = nextVisible ? "visible" : "none";
    for (const layerId of [fillLayerId(slug), outlineLayerId(slug), labelLayerId(slug)]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }

  function zoomTo(slug: string) {
    const extent = datasetBySlug.get(slug)?.extent;
    const bounds = extent ? geometryBounds(extent) : null;
    if (!map || !bounds) return;
    map.fitBounds(bounds, { padding: 60, duration: 500 });
  }

  function setBasemapVisible(nextVisible: boolean) {
    if (!map) return;
    basemapVisible = nextVisible;
    const visibility = nextVisible ? "visible" : "none";
    for (const layer of map.getStyle()?.layers ?? []) {
      if ("source" in layer && layer.source === BASEMAP_SOURCE_ID) {
        map.setLayoutProperty(layer.id, "visibility", visibility);
      }
    }
  }

  function selectBasemapFlavor(flavor: BasemapFlavor) {
    if (!map) return;
    currentFlavor = flavor;
    applyBasemapFlavor(map, flavor);
    // applyBasemapFlavor rebuilds the basemap's source+layers from scratch
    // (remove then re-add, see basemapStyle.ts) -- freshly-added layers
    // default to visible regardless of what the OLD ones were set to, so
    // an admin who'd toggled the basemap off would otherwise see it
    // silently reappear the moment they picked a different style.
    if (!basemapVisible) setBasemapVisible(false);
    refresh();
  }

  function refresh() {
    if (!map || !panel) return;
    panel.innerHTML = "";

    // --- Basemap row: visibility toggle + flavor picker, both live in
    // the same panel as the dataset layers below rather than a second
    // corner button (brief follow-up). ---
    const basemapSection = document.createElement("div");
    basemapSection.className = "mb-1 flex flex-col gap-1.5 border-b border-border pb-2";

    const basemapRow = document.createElement("div");
    basemapRow.className = "flex items-center gap-1.5 px-1 py-1 text-xs";
    const basemapCheckbox = document.createElement("input");
    basemapCheckbox.type = "checkbox";
    basemapCheckbox.checked = basemapVisible;
    basemapCheckbox.className = "size-3.5 shrink-0 cursor-pointer accent-primary";
    basemapCheckbox.setAttribute("aria-label", "Toggle basemap visibility");
    basemapCheckbox.onchange = () => {
      setBasemapVisible(basemapCheckbox.checked);
      refresh();
    };
    basemapRow.appendChild(basemapCheckbox);
    const basemapLabel = document.createElement("span");
    basemapLabel.className = "flex-1 font-medium text-foreground";
    basemapLabel.textContent = "Basemap";
    basemapRow.appendChild(basemapLabel);
    basemapSection.appendChild(basemapRow);

    const flavorRow = document.createElement("div");
    flavorRow.className = "flex flex-wrap gap-1 px-1 pb-0.5";
    for (const flavor of BASEMAP_FLAVORS) {
      const flavorButton = document.createElement("button");
      flavorButton.type = "button";
      flavorButton.className =
        flavor === currentFlavor
          ? "rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-foreground"
          : "rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";
      flavorButton.textContent = BASEMAP_FLAVOR_LABELS[flavor];
      flavorButton.onclick = () => selectBasemapFlavor(flavor);
      flavorRow.appendChild(flavorButton);
    }
    basemapSection.appendChild(flavorRow);
    panel.appendChild(basemapSection);

    // --- Dataset layers (unchanged from the standalone Layers control). ---
    const rows = (map.getStyle()?.layers ?? [])
      .filter((layer) => layer.id.startsWith("fill:"))
      .map((layer) => {
        const slug = datasetSlugFromLayerId(layer.id) ?? layer.id;
        const dataset = datasetBySlug.get(slug);
        const visible = (map!.getLayoutProperty(layer.id, "visibility") ?? "visible") !== "none";
        const shape = shapeForGeometryType(dataset?.geometry_type ?? undefined);
        const color =
          (shape === "line"
            ? (map!.getPaintProperty(outlineLayerId(slug), "line-color") as string | undefined)
            : (map!.getPaintProperty(layer.id, "fill-color") as string | undefined)) ?? "#999999";
        return { slug, label: dataset?.name || slug, visible, shape, color, hasExtent: dataset?.extent != null };
      });

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "px-1 py-0.5 text-xs text-muted-foreground";
      empty.textContent = "No data layers loaded.";
      panel.appendChild(empty);
      return;
    }

    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-muted/60";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = row.visible;
      checkbox.className = "size-3.5 shrink-0 cursor-pointer accent-primary";
      checkbox.setAttribute("aria-label", `Toggle ${row.label} visibility`);
      checkbox.onchange = () => {
        toggleVisibility(row.slug, checkbox.checked);
        refresh();
      };
      item.appendChild(checkbox);

      const swatch = document.createElement("span");
      swatch.className =
        row.shape === "circle"
          ? "inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          : row.shape === "line"
            ? "inline-block h-[3px] w-3 shrink-0"
            : "inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]";
      if (row.shape === "line") {
        swatch.style.borderTop = `3px solid ${row.color}`;
        swatch.style.height = "0px";
      } else {
        swatch.style.backgroundColor = row.color;
      }
      item.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "flex-1 truncate text-foreground";
      label.textContent = row.label;
      item.appendChild(label);

      const zoomButton = document.createElement("button");
      zoomButton.type = "button";
      zoomButton.className = "flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";
      zoomButton.title = row.hasExtent ? `Zoom to ${row.label}` : "No extent available for this layer";
      zoomButton.setAttribute("aria-label", `Zoom to ${row.label}`);
      zoomButton.disabled = !row.hasExtent;
      zoomButton.innerHTML = ZOOM_TO_ICON;
      zoomButton.onclick = () => zoomTo(row.slug);
      item.appendChild(zoomButton);

      panel.appendChild(item);
    }
  }

  return {
    onAdd(m) {
      map = m;
      // Plain `maplibregl-ctrl` (NOT `maplibregl-ctrl-group`, which this
      // control's predecessor used) -- MapLibre's own stylesheet hardcodes
      // `.maplibregl-ctrl-group { background: #fff }` unconditionally, with
      // no dark-mode awareness at all, which is exactly why this button
      // looked wrong in dark mode. Search/Layers' own icon buttons never
      // had this problem because they never used that class; the fix here
      // is simply not opting into it, not an override.
      container = document.createElement("div");
      container.className = "maplibregl-ctrl relative";

      toggleButton = document.createElement("button");
      toggleButton.type = "button";
      // Theme-aware replacement for `.maplibregl-ctrl-group`'s look
      // (rounded + box-shadow + the 29x29 sizing that class's own `button`
      // descendant selector provides) -- NOT `.maplibregl-ctrl-group`
      // itself, which hardcodes `background:#fff` with no dark-mode
      // awareness at all (that's exactly why this button looked wrong in
      // dark mode). Put on the button rather than the container so a
      // control whose container ALSO wraps other always-rendered content
      // (none here, but matches searchControl.ts's identical fix) never
      // risks a double-boxed look.
      toggleButton.className =
        "maplibregl-ctrl-icon flex h-[29px] w-[29px] items-center justify-center rounded border border-border bg-card shadow-sm";
      toggleButton.title = "Basemap & layers";
      toggleButton.setAttribute("aria-label", "Basemap & layers");
      toggleButton.innerHTML = LAYERS_ICON;
      toggleButton.onclick = () => {
        const isHidden = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !isHidden);
        panel.classList.toggle("flex", isHidden);
        if (isHidden) refresh();
      };
      container.appendChild(toggleButton);

      panel = document.createElement("div");
      panel.className =
        "hidden absolute right-0 top-full z-10 mt-1 max-h-80 w-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-card p-1.5 text-sm shadow-lg";
      container.appendChild(panel);

      map.on("styledata", () => {
        if (!panel.classList.contains("hidden")) refresh();
      });

      return container;
    },
    onRemove() {
      map = null;
      container = null;
    },
  };
}
