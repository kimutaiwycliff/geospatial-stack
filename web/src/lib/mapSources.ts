import type { LayerSpecification, VectorSourceSpecification } from "maplibre-gl";
import type { Dataset } from "./api";
import { martinTileUrl, pmtilesUrlFor, tableNameFor } from "./config";

/**
 * Deterministic MapLibre id namespacing per dataset -- one map can now hold
 * N geometry datasets' sources/layers side by side (Phase 0 had exactly
 * one, so this indirection didn't exist yet). Prefixing with the slug keeps
 * every id collision-proof without a registry of "already used" ids.
 */
export function sourceId(slug: string): string {
  return `src:${slug}`;
}
export function fillLayerId(slug: string): string {
  return `fill:${slug}`;
}
export function outlineLayerId(slug: string): string {
  return `outline:${slug}`;
}

/** Recovers the dataset slug from one of the layer ids above -- used by the
 * click handler to go from "which layer did queryRenderedFeatures hit" back
 * to "which dataset's /features/{slug}/{id} do I call". */
export function datasetSlugFromLayerId(layerId: string): string | null {
  const match = /^(?:fill|outline):(.+)$/.exec(layerId);
  return match ? match[1] : null;
}

/**
 * Builds the MapLibre vector source definition for one dataset, dispatching
 * on ITS OWN `serve_mode` (Phase 0 had a single hardcoded toggle; Phase 1's
 * `/datasets` can return any mix of Martin- and PMTiles-served rows, so the
 * decision has to be per-dataset now, not one global mode).
 *
 * - Martin ("martin"): `tiles: [martinTileUrl(slug)]`, a plain XYZ template
 *   with literal {z}/{x}/{y} tokens MapLibre substitutes per tile.
 * - PMTiles ("pmtiles"): MUST be `url: pmtilesUrlFor(slug)`, NOT
 *   `tiles: [...]`. The pmtiles Protocol (registered in main.tsx) resolves a
 *   `type: "json"` request for the bare `url` into a TileJSON object whose
 *   `tiles` array is `${url}/{z}/{x}/{y}` -- IT appends the z/x/y suffix,
 *   not us. Passing the bare pmtiles:// URL via `tiles: [...]` instead means
 *   MapLibre requests that exact literal string for every tile; pmtiles's
 *   own tile-request regex never matches a URL with no numeric z/x/y
 *   suffix, so every tile request throws "Invalid PMTiles protocol URL" --
 *   silently, as a console error, never a rejected promise the app could
 *   catch. This was a hard-won Phase 0 bug fix (found by reading
 *   node_modules/pmtiles/dist/esm/index.js directly) -- preserved here
 *   verbatim per the brief's explicit instruction not to regress it.
 */
export function buildVectorSource(dataset: Dataset): VectorSourceSpecification {
  if (dataset.serve_mode === "martin") {
    return {
      type: "vector",
      tiles: [martinTileUrl(dataset.slug)],
    };
  }
  // Any other non-null serve_mode is treated as PMTiles -- today that's
  // literally just "pmtiles", but this stays a fallback rather than a
  // strict equality check so an unrecognized future serve_mode value fails
  // by trying the static path (cheap, no DB) rather than silently building
  // no source at all.
  return {
    type: "vector",
    url: pmtilesUrlFor(dataset.slug),
  };
}

/**
 * Small qualitative palette so multiple simultaneously-visible layers stay
 * visually distinguishable without per-dataset styling config existing yet
 * (that's Phase 3's admin styling panel, brief §6.3). Colors chosen to
 * stay legible at ~35% fill opacity on the light basemap and to be
 * distinguishable under common color-vision deficiencies (blue/orange/
 * green/red/purple/teal ordering avoids adjacent red-green pairs).
 * Cycles by index -- fine for the handful of layers Phase 1 actually has;
 * revisit if this ever needs to scale past the palette length.
 */
const PALETTE = ["#2563eb", "#d97706", "#16a34a", "#dc2626", "#7c3aed", "#0891b2"];

export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function buildFillLayer(dataset: Dataset, colorIndex: number): LayerSpecification {
  return {
    id: fillLayerId(dataset.slug),
    type: "fill",
    source: sourceId(dataset.slug),
    "source-layer": tableNameFor(dataset.slug),
    paint: {
      "fill-color": paletteColor(colorIndex),
      "fill-opacity": 0.35,
    },
  };
}

export function buildOutlineLayer(dataset: Dataset, colorIndex: number): LayerSpecification {
  return {
    id: outlineLayerId(dataset.slug),
    type: "line",
    source: sourceId(dataset.slug),
    "source-layer": tableNameFor(dataset.slug),
    paint: {
      "line-color": paletteColor(colorIndex),
      "line-width": 1.5,
    },
  };
}
