import type { IControl, Map as MapLibreMap } from "maplibre-gl";
import { DEFAULT_LEGEND_CONFIG, type MapLegendConfig } from "../adminApi";
import { datasetSlugFromLayerId, fillLayerId, labelLayerId, outlineLayerId } from "../mapSources";

type SwatchShape = "circle" | "line" | "square";

/** Point/MultiPoint -> a dot; LineString/MultiLineString -> a stroke;
 * everything else (Polygon/MultiPolygon, or an unknown/generic
 * "GEOMETRY" type) -> a filled square -- matching GeoLibre's own legend
 * swatch shapes (LegendSwatch.tsx), researched directly rather than
 * guessed. Case-insensitive: registry.datasets.geometry_type is whatever
 * DuckDB's `ST_GeometryType` returned at ingest time. */
function shapeForGeometryType(geometryType: string | undefined): SwatchShape {
  const t = (geometryType ?? "").toLowerCase();
  if (t.includes("point")) return "circle";
  if (t.includes("line")) return "line";
  return "square";
}

/**
 * Auto-generated legend (GeoLibre-menu parity's "Legend"): lists every
 * layer with its actual rendered color, read straight off the map's own
 * style instead of needing the dataset list threaded in from React state
 * for the CORE discovery (still self-contained like every other
 * hand-built control here). `datasetGeometryTypes` is the one deliberate
 * exception -- an optional slug->geometry_type hint map (brief follow-up:
 * shape-accurate swatches, researched against GeoLibre's LegendSwatch.tsx)
 * that a caller with access to `/datasets` can supply (see
 * MapBySlugPage.tsx); omitted entirely, every row just falls back to a
 * square swatch.
 *
 * Rows are no longer dropped when their layer is toggled off (LayerPanel's
 * `setLayoutProperty` calls, or this control's OWN click-to-toggle below)
 * -- they stay in the list at reduced opacity, matching GeoLibre's own
 * legend (`opacity-40` on a hidden entry) rather than disappearing
 * entirely, so a visitor can still find and re-enable a layer they
 * switched off from here.
 */
export function createLegendControl(
  config: MapLegendConfig = DEFAULT_LEGEND_CONFIG,
  datasetGeometryTypes: Record<string, string> = {},
): IControl {
  let map: MapLibreMap | null = null;
  let container: HTMLElement | null = null;

  function toggleDataset(slug: string, nextVisible: boolean) {
    if (!map) return;
    const visibility = nextVisible ? "visible" : "none";
    for (const layerId of [fillLayerId(slug), outlineLayerId(slug), labelLayerId(slug)]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }

  function refresh() {
    if (!map || !container) return;
    container.innerHTML = "";

    if (config.title) {
      const title = document.createElement("p");
      title.className = "px-1 pb-0.5 text-xs font-semibold text-foreground";
      title.textContent = config.title;
      container.appendChild(title);
    }

    const rows = (map.getStyle()?.layers ?? [])
      .filter((layer) => layer.id.startsWith("fill:"))
      .map((layer) => {
        const slug = datasetSlugFromLayerId(layer.id) ?? layer.id;
        const override = config.items[slug];
        const visible = (map!.getLayoutProperty(layer.id, "visibility") ?? "visible") !== "none";
        const shape = shapeForGeometryType(datasetGeometryTypes[slug]);
        const outlineId = outlineLayerId(slug);
        const color =
          (shape === "line"
            ? (map!.getPaintProperty(outlineId, "line-color") as string | undefined)
            : (map!.getPaintProperty(layer.id, "fill-color") as string | undefined)) ?? "#999999";
        const opacity =
          (shape === "line"
            ? (map!.getPaintProperty(outlineId, "line-opacity") as number | undefined)
            : (map!.getPaintProperty(layer.id, "fill-opacity") as number | undefined)) ?? 1;
        return { slug, hidden: override?.hidden ?? false, label: override?.label || slug, color, opacity, shape, visible };
      })
      .filter((row) => !row.hidden);

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "px-1 py-0.5 text-xs text-muted-foreground";
      empty.textContent = "No layers.";
      container.appendChild(empty);
      return;
    }

    for (const row of rows) {
      const item = document.createElement("button");
      item.type = "button";
      item.title = row.visible ? "Click to hide this layer" : "Click to show this layer";
      item.className = `flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/60 ${
        row.visible ? "" : "opacity-40"
      }`;
      item.onclick = () => {
        toggleDataset(row.slug, !row.visible);
        refresh();
      };

      const swatch = document.createElement("span");
      swatch.className =
        row.shape === "circle"
          ? "inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          : row.shape === "line"
            ? "inline-block h-[3px] w-3.5 shrink-0"
            : "inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]";
      swatch.style.backgroundColor = row.shape === "line" ? "transparent" : row.color;
      if (row.shape === "line") {
        swatch.style.borderTop = `3px solid ${row.color}`;
        swatch.style.height = "0px";
      }
      swatch.style.opacity = String(Math.max(row.opacity, 0.25));
      item.appendChild(swatch);

      const label = document.createElement("span");
      label.className = "truncate text-foreground";
      label.textContent = row.label;
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
