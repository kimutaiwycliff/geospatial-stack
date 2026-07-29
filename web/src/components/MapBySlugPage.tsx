import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Map as MapLibreMap, Popup, type FilterSpecification, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchableFilterSelect } from "./SearchableFilterSelect";
import { fetchDatasets, isMappable, type Dataset } from "../lib/api";
import {
  DEFAULT_LAYER_HOVER,
  DEFAULT_LAYER_POPUP,
  fetchMap,
  fetchPublishedStyles,
  type LayerHoverConfig,
  type PopupStyle,
  type PublicMapConfig,
} from "../lib/adminApi";
import { asBasemapFlavor, buildBaseStyle } from "../lib/basemapStyle";
import { geometryBounds } from "../lib/geo";
import { applyMapControls } from "../lib/mapControls";
import {
  buildFillLayer,
  buildLabelLayer,
  buildOutlineLayer,
  buildVectorSource,
  datasetSlugFromLayerId,
  fillLayerId,
  labelLayerId,
  outlineLayerId,
  sourceId,
  type PublishedStyleOverride,
} from "../lib/mapSources";
import { WORLD_VIEW } from "../lib/regionCentroids";
import { ThemeToggle } from "./ThemeToggle";

/** Minimal HTML-escaping for feature property values interpolated into a
 * Popup's `setHTML` -- those values come from whatever a curator uploaded
 * (self-service uploads accept arbitrary attribute data), and this popup
 * renders to the PUBLIC, unauthenticated map, so an unescaped `<script>`/
 * `<img onerror=...>` in a dataset's own attribute data would execute for
 * every visitor. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Shared by both the click popup and the hover tooltip -- the same
 * "picked fields, or the old name-only fallback" content, styled with the
 * layer's `popup.style` either way (hover has no style of its own, see
 * maps.py's `LayerHoverConfig` docstring). `fields` empty means "nobody
 * configured this yet" -- falls back to the single `name` property (or
 * "Feature") this app showed unconditionally before per-layer popups
 * existed, so an un-configured Map doesn't go from "shows something" to
 * "shows nothing" the moment this feature shipped.
 *
 * Deliberately does NOT show the dataset's own name anywhere -- a curator
 * looking at a feature already knows what layer they clicked (they chose
 * which layers to enable), and it just added noise to every popup.
 *
 * Each field renders as its own row (small uppercase label above the
 * value, a hairline divider between rows) rather than inline "Field:
 * value" text -- reads like a real feature-inspector card instead of a
 * loose stack of labeled sentences. The OUTER MapLibre `Popup`/tip chrome
 * is hidden via the `map-feature-popup` CSS class (see this page's own
 * `<style>` block) so this div's own background/border/shadow is the
 * only visible chrome -- without that override, MapLibre's default white
 * popup box shows through around this one, a double-boxed look.
 */
function buildFeatureHtml(properties: Record<string, unknown>, fields: string[], style: PopupStyle): string {
  const cardStyle =
    `background:${style.background_color};color:${style.text_color};` +
    `border:1px solid ${style.border_color};border-radius:${style.border_radius}px;` +
    `font-size:${style.font_size}px;box-shadow:0 6px 20px rgba(0,0,0,0.18);` +
    `min-width:140px;max-width:260px;overflow:hidden;`;

  if (fields.length === 0) {
    const name = escapeHtml(String(properties.name ?? "Feature"));
    return `<div style="${cardStyle}"><div style="padding:10px 12px;font-weight:600;">${name}</div></div>`;
  }

  const labelSize = Math.max(style.font_size - 3, 9);
  const rows = fields
    .map((field, i) => {
      const value = escapeHtml(String(properties[field] ?? "—"));
      const divider = i > 0 ? `border-top:1px solid ${style.border_color};` : "";
      return (
        `<div style="padding:7px 12px;${divider}">` +
        `<div style="font-size:${labelSize}px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.65;">${escapeHtml(field)}</div>` +
        `<div style="margin-top:2px;line-height:1.3;">${value}</div>` +
        `</div>`
      );
    })
    .join("");
  return `<div style="${cardStyle}">${rows}</div>`;
}

/**
 * Public, unauthenticated render of ONE published Map (brief §16: "the map
 * gets a public route/shareable URL"). Deliberately a leaner sibling of
 * MapPage/MapView rather than reusing them outright -- MapView's whole
 * design centers on a mutable, user-driven layer/country/selection state
 * that this page doesn't have (a Map's layer set and view are fixed
 * config, not something a visitor toggles), so threading this page's
 * fixed-config-only needs through MapView's imperative-handle/URL-sync
 * machinery would mean fighting most of what makes that component what it
 * is. What DOES carry over unchanged, per the brief's steer, are the
 * actual MapLibre building blocks -- `buildBaseStyle`, `buildVectorSource`,
 * `buildFillLayer`/`buildOutlineLayer` -- so a dataset renders pixel-for-
 * pixel the same way here as it does on the main map.
 */
export function MapBySlugPage() {
  const { slug } = useParams<{ slug: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const [config, setConfig] = useState<PublicMapConfig | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState<string | null>(null);
  // One selected value per configured filter (brief follow-up: "filters
  // can be customized ... pointed to specific fields"), keyed by filter id;
  // an absent/empty entry means "no restriction from this filter."
  const [activeFilterValues, setActiveFilterValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!slug) return;
    fetchMap(slug)
      .then(setConfig)
      .catch(() => setError("This map doesn't exist or isn't published."));
    fetchDatasets()
      .then(setDatasets)
      .catch(() => setError("Could not load the dataset registry."));
  }, [slug]);

  useEffect(() => {
    if (!config || datasets.length === 0 || !containerRef.current || mapRef.current) return;

    // Resolve the map's fixed layer list against the full public registry
    // exactly once: `config.layers_json` is already filtered server-side to
    // dataset slugs that are CURRENTLY published (see maps.py's
    // get_published_map), so the only extra check needed here is
    // `isMappable` -- a layer entry referencing a tabular (non-geometry)
    // dataset can't get a source/layer pair at all.
    // `popup`/`hover` normalized here -- a Map's layers_json saved before
    // this feature existed has neither key in its stored JSON at all (the
    // backend returns whatever's actually in the jsonb column, not
    // re-validated through the Pydantic model's defaults), so accessing
    // `layer.popup.enabled` directly on an old row would throw.
    const entries = config.layers_json
      .map((layer) => ({
        layer: {
          ...layer,
          popup: layer.popup ?? DEFAULT_LAYER_POPUP,
          hover: layer.hover ?? DEFAULT_LAYER_HOVER,
          zoom_to_feature: layer.zoom_to_feature ?? false,
        },
        dataset: datasets.find((d) => d.slug === layer.dataset_slug),
      }))
      .filter((entry): entry is { layer: (typeof config.layers_json)[number]; dataset: Dataset } => entry.dataset != null && isMappable(entry.dataset));

    const view = config.default_extent ?? WORLD_VIEW;
    const map = new MapLibreMap({
      container: containerRef.current,
      // Read `config.basemap` directly (not React state) -- this is the
      // map's very first frame, and there's no risk of a stale value here
      // since this effect already depends on `config` being non-null.
      // `projection` is a STYLE-level property, not a Map constructor
      // option -- spread onto buildBaseStyle's result. Loads as a globe by
      // default (brief follow-up) -- the "globe" control (now defaulted to
      // enabled, see mapControls.ts's DEFAULT_MAP_CONTROLS) is the
      // "optionally ... flatten the map" half: MapLibre's own GlobeControl
      // button toggles projection between globe and mercator.
      style: { ...buildBaseStyle(asBasemapFlavor(config.basemap)), projection: { type: "globe" } },
      center: view.center,
      zoom: view.zoom,
      // Undefined (not set at all) when unconfigured -- MapLibre's own
      // "no constraint" behavior (brief follow-up: "optionally choose
      // minimum and maximum zoom per map").
      minZoom: config.min_zoom ?? undefined,
      maxZoom: config.max_zoom ?? undefined,
      // MapLibre silently adds its OWN default AttributionControl unless
      // told not to -- suppressed here so applyMapControls (below) is the
      // ONLY thing that ever adds one, driven by this Map's saved
      // controls_json, instead of ending up with two attribution controls
      // whenever an admin has "attribution" enabled (the default).
      attributionControl: false,
    });
    mapRef.current = map;
    // The basemap switcher is now just another control (brief follow-up:
    // "just another map control that can be toggled and placed wherever
    // you want") -- `initialBasemapFlavor` seeds its dropdown to match the
    // flavor this map was actually built with above.
    applyMapControls(map, config.controls_json, {
      initialBasemapFlavor: asBasemapFlavor(config.basemap),
      gridlinesConfig: config.gridlines_json ?? undefined,
      legendConfig: config.legend_json ?? undefined,
      // Shape-accurate legend swatches (brief follow-up) -- built from
      // this page's own `datasets` fetch, not a new API call.
      datasetGeometryTypes: Object.fromEntries(
        datasets.filter((d) => d.geometry_type).map((d) => [d.slug, d.geometry_type as string]),
      ),
    });

    // Published styles (brief §6.3) -- see MapView.tsx's identical fetch
    // for why this is a separate best-effort call rather than baked into
    // `config`/`/datasets`: most layers have never been styled, and a
    // missing style shouldn't block rendering on the palette default.
    const stylesPromise = fetchPublishedStyles()
      .then((styles) => new Map(styles.map((s) => [s.slug, s.style_json as PublishedStyleOverride])))
      .catch(() => new Map<string, PublishedStyleOverride>());

    map.on("load", () => {
      void stylesPromise.then((styleBySlug) => {
        entries.forEach(({ layer, dataset }, index) => {
          const style = styleBySlug.get(dataset.slug);
          map.addSource(sourceId(dataset.slug), buildVectorSource(dataset));
          map.addLayer(buildFillLayer(dataset, index, style));
          map.addLayer(buildOutlineLayer(dataset, index, style));
          const labelLayer = buildLabelLayer(dataset, style);
          if (labelLayer) map.addLayer(labelLayer);
          if (!layer.visible) {
            map.setLayoutProperty(fillLayerId(dataset.slug), "visibility", "none");
            map.setLayoutProperty(outlineLayerId(dataset.slug), "visibility", "none");
            if (labelLayer) map.setLayoutProperty(labelLayerId(dataset.slug), "visibility", "none");
          }
        });
      });

      const fillLayerIds = entries.map(({ dataset }) => fillLayerId(dataset.slug));

      // Click-for-popup, now rendering whichever fields (brief follow-up:
      // "customize what field show up on popups ... clicking features")
      // and look (`popup.style`) the admin configured for THAT layer,
      // falling back to the old name-only content when unconfigured (see
      // buildFeatureHtml's doc comment).
      // Zoom-to-feature and popup are independent (brief follow-up: "choose
      // whether by default it will fly to and zoom to that feature ... on
      // top of popup on hover or click, or whether it will even popup in
      // the first place") -- a click can do either, both, or neither,
      // driven by two separate per-layer config fields (layer.zoom_to_feature
      // and layer.popup.enabled), not one flag gating the other.
      map.on("click", (e: MapMouseEvent) => {
        if (fillLayerIds.length === 0) return;
        const feature = map.queryRenderedFeatures(e.point, { layers: fillLayerIds })[0];
        if (!feature?.layer) return;
        const featureSlug = datasetSlugFromLayerId(feature.layer.id);
        const entry = entries.find((en) => en.dataset.slug === featureSlug);
        if (!entry) return;

        if (entry.layer.zoom_to_feature && feature.geometry) {
          const bounds = geometryBounds(feature.geometry);
          if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: config.max_zoom ?? 14, duration: 800 });
        }

        if (entry.layer.popup.enabled) {
          new Popup({ closeButton: true, className: "map-feature-popup" })
            .setLngLat(e.lngLat)
            .setHTML(buildFeatureHtml(feature.properties ?? {}, entry.layer.popup.fields, entry.layer.popup.style))
            .addTo(map);
        }
      });

      // Hover tooltip (brief follow-up: "even hovering per dataset") --
      // a genuinely new capability (hover previously only changed the
      // cursor), so this only appears for a layer whose admin explicitly
      // enabled it with at least one field chosen; reuses the layer's
      // `popup.style` rather than a separate style config (see
      // buildFeatureHtml's doc comment on why).
      let hoverPopup: Popup | null = null;
      map.on("mousemove", (e: MapMouseEvent) => {
        const feature = fillLayerIds.length > 0 ? map.queryRenderedFeatures(e.point, { layers: fillLayerIds })[0] : undefined;
        map.getCanvas().style.cursor = feature ? "pointer" : "";

        const featureSlug = feature?.layer ? datasetSlugFromLayerId(feature.layer.id) : null;
        const entry = featureSlug ? entries.find((en) => en.dataset.slug === featureSlug) : undefined;
        const hover: LayerHoverConfig | undefined = entry?.layer.hover;

        if (!feature || !entry || !hover?.enabled || hover.fields.length === 0) {
          hoverPopup?.remove();
          hoverPopup = null;
          return;
        }
        hoverPopup ??= new Popup({ closeButton: false, closeOnClick: false, className: "map-feature-popup map-feature-hover" });
        hoverPopup
          .setLngLat(e.lngLat)
          .setHTML(buildFeatureHtml(feature.properties ?? {}, hover.fields, entry.layer.popup.style))
          .addTo(map);
      });
      // `map.on("mouseleave", ...)` requires a layer id (MapLibre only
      // supports layer-scoped mouseleave, not a whole-map one) -- this
      // needs "cursor left the canvas entirely" regardless of layer, so it
      // listens on the canvas DOM element directly instead.
      map.getCanvas().addEventListener("mouseleave", () => {
        hoverPopup?.remove();
        hoverPopup = null;
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [config, datasets]);

  // Filter-application effect: reacts to a visitor's dropdown choice
  // (brief follow-up: "filters can be customized and dynamically changed
  // ... pointed to specific fields," replacing the old hardcoded country
  // filter). Guarded per-layer via `getLayer` (not a separate "ready"
  // flag) -- harmless no-op before the layers-added effect above has run,
  // since the only way this effect's dependency (`activeFilterValues`)
  // changes at all is a visitor interacting with a dropdown that only
  // exists once `config` (and therefore the map) already loaded.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !config?.filters_json) return;
    const byDataset = new Map<string, FilterSpecification[]>();
    for (const filter of config.filters_json) {
      const value = activeFilterValues[filter.id];
      if (!value) continue;
      const clause: FilterSpecification = ["==", ["get", filter.field], value];
      const existing = byDataset.get(filter.dataset_slug) ?? [];
      byDataset.set(filter.dataset_slug, [...existing, clause]);
    }
    for (const layer of config.layers_json) {
      const clauses = byDataset.get(layer.dataset_slug);
      // Cast: MapLibre's FilterSpecification union is exact enough that
      // spreading an array of already-valid `["==", ...]` clauses into an
      // `["all", ...]` tuple doesn't infer cleanly, even though the result
      // is a well-formed filter expression at runtime.
      const expression = (clauses && clauses.length > 0 ? ["all", ...clauses] : null) as FilterSpecification | null;
      for (const layerId of [fillLayerId(layer.dataset_slug), outlineLayerId(layer.dataset_slug), labelLayerId(layer.dataset_slug)]) {
        if (map.getLayer(layerId)) map.setFilter(layerId, expression);
      }
    }
  }, [activeFilterValues, config]);

  if (error) {
    return (
      <div className="flex h-screen w-screen animate-in fade-in flex-col items-center justify-center gap-3 bg-background text-center duration-300">
        <p className="text-sm text-destructive">{error}</p>
        <Link to="/" className={buttonVariants({ variant: "link" })}>
          &larr; Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen animate-in fade-in duration-300 map-by-slug-page">
      {/* MapLibre's own top-left control corner (Geolocate/Search/Measure,
          whichever this Map has enabled -- see mapControls.ts) starts at
          roughly the same offset as the info card below, so without this
          the two silently overlap (found by actually looking at a Map with
          a top-left control enabled, not by inspecting the JSX). Scoped to
          this page's own class -- MapView.tsx's main explorer map has no
          such title card, so its top-left controls shouldn't be pushed
          down for no reason. */}
      <style>{`
        .map-by-slug-page .maplibregl-ctrl-top-left { margin-top: 4.5rem; }
        /* Strips MapLibre's own white popup box/arrow so only
           buildFeatureHtml's own styled card shows -- otherwise the
           default chrome renders AROUND our card, a double-boxed look. */
        .map-feature-popup .maplibregl-popup-content { padding: 0; background: transparent; box-shadow: none; }
        .map-feature-popup .maplibregl-popup-tip { display: none; }
        /* Hover tooltips shouldn't intercept the pointer -- without this,
           the tooltip card itself can end up under the cursor and briefly
           block the next mousemove's hit-test against the map canvas. */
        .map-feature-hover { pointer-events: none; }
      `}</style>
      {/* Info card in the corner -- a great fit for shadcn `Card` (brief):
          it's a genuinely floating, self-contained piece of chrome over the
          map, not a full-height pane, so Card's rounded/ring/padding model
          reads naturally here (unlike SidePanel's edge-to-edge drawer).
          Filters (when configured) render as a CardContent section right
          below the header instead of their own separately-positioned card
          -- the header's height varies with whether a description is set,
          which would make a second absolutely-positioned card either
          overlap or leave an awkward gap. */}
      {config && (
        // `w-72` (not just `max-w-sm`) is load-bearing: Card is `absolute`
        // with no explicit width, so it shrink-to-fits its content -- and
        // CardHeader's grid layout collapses to a near-zero intrinsic width
        // in that mode, wrapping the title one character per line. A fixed
        // base width (still capped by max-w-sm on very narrow viewports)
        // keeps the grid from collapsing.
        <Card className="absolute left-3 top-3 z-10 w-72 max-w-[calc(100vw-1.5rem)] animate-in fade-in bg-card/95 py-3 shadow duration-300">
          <CardHeader className="gap-1 px-3">
            <CardTitle className="text-sm">{config.name}</CardTitle>
            {config.description && <CardDescription className="text-xs">{config.description}</CardDescription>}
          </CardHeader>
          {config.filters_json && config.filters_json.length > 0 && (
            <CardContent className="flex flex-col gap-2 px-3">
              {config.filters_json.map((filter) => (
                <div key={filter.id} className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">{filter.label || filter.field}</Label>
                  <SearchableFilterSelect
                    label={filter.label || filter.field}
                    options={filter.options}
                    value={activeFilterValues[filter.id] ?? ""}
                    onChange={(value) => setActiveFilterValues((prev) => ({ ...prev, [filter.id]: value }))}
                  />
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}
      <div className="absolute right-3 top-3 z-10">
        <ThemeToggle />
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
