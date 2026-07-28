import type { StyleSpecification } from "maplibre-gl";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { BASEMAP_GLYPHS_URL, BASEMAP_PMTILES_URL, BASEMAP_SPRITE_URL } from "./config";

/** One fixed source id for the self-hosted OSM basemap (brief §1.5) --
 * never toggled or removed, unlike the per-dataset sources in mapSources.ts,
 * so it doesn't need the same slug-namespaced id scheme. */
export const BASEMAP_SOURCE_ID = "basemap";

/**
 * Builds the base MapLibre style: basemap layers first (bottom of the
 * z-order), so every data layer added afterwards (mapSources.ts) draws on
 * top of it. Replaces Phase 0's empty `background`-only style now that a
 * real self-hosted basemap exists.
 *
 * `layers()` is @protomaps/basemaps' own function -- it returns a complete
 * LayerSpecification[] (fills, lines, and label/symbol layers) for a given
 * source id + flavor, so there's no hand-rolled land/water/road styling
 * here at all. `namedFlavor("light")` picks their built-in light color
 * scheme (brief didn't ask for a dark-mode basemap toggle, so this is the
 * one fixed choice; swapping to "dark" later is a one-line change here).
 */
export function buildBaseStyle(): StyleSpecification {
  const flavor = namedFlavor("light");
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: "vector",
        url: BASEMAP_PMTILES_URL,
      },
    },
    layers: layers(BASEMAP_SOURCE_ID, flavor, { lang: "en" }),
    // Both URLs are Protomaps' own free, keyless, public static assets (see
    // config.ts's comment on BASEMAP_GLYPHS_URL) -- required for the label
    // layers `layers()` returns to render text/icons at all.
    glyphs: BASEMAP_GLYPHS_URL,
    sprite: BASEMAP_SPRITE_URL,
  };
}
