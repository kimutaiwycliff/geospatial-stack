import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
// MapLibre GL JS 6.0 dropped its default export in favor of named bindings
// (`Map` the class collides with the JS built-in, so the library also
// exports the same class as `MapLibreMap` -- used here for exactly that
// reason). `MapLayerMouseEvent` types the click handler's `e` param, which
// is otherwise implicit-any because `Map.on` is overloaded per-event-type.
import { Map as MapLibreMap, Popup, type LngLatBoundsLike, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchFeature, isMappable, type Dataset } from "../lib/api";
import { fetchPublishedStyles } from "../lib/adminApi";
import { buildBaseStyle } from "../lib/basemapStyle";
import { geometryBounds, unionBounds } from "../lib/geo";
import {
  buildFillLayer,
  buildOutlineLayer,
  buildVectorSource,
  datasetSlugFromLayerId,
  fillLayerId,
  outlineLayerId,
  sourceId,
  type PublishedStyleOverride,
} from "../lib/mapSources";
import { REGION_CENTROIDS, WORLD_VIEW } from "../lib/regionCentroids";
import { tableNameFor } from "../lib/config";
import type { Selection } from "../lib/selection";

export interface MapViewProps {
  datasets: Dataset[];
  visibleSlugs: string[];
  /** Only consulted once, on mount -- see the effect below for why the map
   * isn't kept "controlled" from outside after that. */
  initialView: { center: [number, number]; zoom: number } | null;
  onFeatureSelect: (selection: Selection | null) => void;
  onViewChange: (center: [number, number], zoom: number) => void;
}

export interface MapViewHandle {
  /** Jumps the map to one country -- see the function body for the two-tier
   * strategy (real feature bounds when available, rough region centroid
   * otherwise). Exposed imperatively rather than via a "flyToRequest" prop
   * because the trigger is a one-off user action (selecting a country),
   * not persistent state the map should stay synced to. */
  flyToCountry: (iso: string, countryName: string | undefined, subregion: string | undefined) => void;
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { datasets, visibleSlugs, initialView, onFeatureSelect, onViewChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  // "Latest callback" refs: MapView registers its click/move handlers with
  // MapLibre exactly once (see the mount effect below) so toggling a layer
  // or a parent re-render never tears down and rebuilds the whole map. But
  // those handlers still need the CURRENT onFeatureSelect/onViewChange/
  // datasets, not whatever they closed over at mount time -- assigning on
  // every render (not inside an effect) is the standard fix, and is safe
  // here because it has no side effect of its own.
  const onFeatureSelectRef = useRef(onFeatureSelect);
  onFeatureSelectRef.current = onFeatureSelect;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const datasetsRef = useRef<Dataset[]>(datasets);
  datasetsRef.current = datasets;

  // Populated once (effect below) with the fill-layer ids of every
  // mappable dataset actually added to the map. Read (not written) by the
  // click/mousemove handlers registered at mount, so it has to be a ref,
  // not state -- those handlers close over it once and must see later
  // mutations.
  const fillLayerIdsRef = useRef<string[]>([]);
  const layersAddedRef = useRef(false);

  // Create the map exactly once, styled with the self-hosted basemap
  // (brief §1.5) -- Phase 0's empty `background`-only style is gone now
  // that a real basemap exists. Click/hover handlers are registered here
  // too, generically over "whatever fill layers exist right now"
  // (fillLayerIdsRef.current) rather than one handler per dataset, so
  // datasets appearing later (a curator publishes mid-session -> next
  // reload, or simply loading after this effect runs) don't need this
  // effect to re-run.
  useEffect(() => {
    if (!containerRef.current) return;

    const view = initialView ?? WORLD_VIEW;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildBaseStyle(),
      center: view.center,
      zoom: view.zoom,
    });
    mapRef.current = map;

    // Only sets `ready` here -- does NOT add dataset sources/layers itself.
    // A separate effect (keyed on [ready, datasets]) owns that, exactly
    // once. Doing both from this same "load" handler and from a second
    // effect raced two addSource/removeSource cycles against each other in
    // Phase 0 (see git history) -- kept as one single call site this time
    // for the same reason.
    map.on("load", () => setReady(true));

    map.on("moveend", () => {
      const center = map.getCenter();
      onViewChangeRef.current([center.lng, center.lat], map.getZoom());
    });

    // Click-to-popup + side-panel select (brief §6.2). Generic over
    // whichever fill layers currently exist (fillLayerIdsRef.current) so
    // this one handler covers every geometry dataset, not just one.
    map.on("click", (e: MapMouseEvent) => {
      const layers = fillLayerIdsRef.current;
      if (layers.length === 0) return;
      const feature = map.queryRenderedFeatures(e.point, { layers })[0];
      if (!feature?.layer) return;

      const slug = datasetSlugFromLayerId(feature.layer.id);
      if (!slug) return;
      const dataset = datasetsRef.current.find((d) => d.slug === slug);
      const datasetName = dataset?.name ?? slug;

      // Martin's tiles carry `id` (published table's BIGSERIAL PK). PMTiles
      // archives built from `curated/` GeoParquet have no `id` column at
      // all (only assigned once a row lands in PostGIS), so `name` is the
      // fallback lookup key -- same rule as Phase 0, now applied per-dataset
      // instead of to one hardcoded fixture.
      const lookupKey: string | number | undefined =
        (feature.properties?.id as number | undefined) ?? (feature.properties?.name as string | undefined);
      if (lookupKey === undefined) {
        console.warn("Clicked feature has neither id nor name -- cannot look up detail.", feature.properties);
        return;
      }

      const label = (feature.properties?.name as string | undefined) ?? "Feature";
      new Popup({ closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="text-sm"><strong>${label}</strong><br/><span class="text-muted-foreground">${datasetName}</span></div>`,
        )
        .addTo(map);

      // Loading state first (detail undefined) so the side panel can show a
      // spinner/placeholder immediately rather than sitting empty until the
      // fetch resolves.
      onFeatureSelectRef.current({ kind: "feature", datasetSlug: slug, datasetName });
      fetchFeature(slug, lookupKey)
        .then((detail) => {
          onFeatureSelectRef.current({ kind: "feature", datasetSlug: slug, datasetName, detail });
        })
        .catch((err: unknown) => {
          // API is a moving target across dataset additions -- a fetch
          // failure surfaces in the side panel rather than an unhandled
          // rejection.
          console.error("fetchFeature failed", err);
          onFeatureSelectRef.current({
            kind: "feature",
            datasetSlug: slug,
            datasetName,
            error: err instanceof Error ? err.message : "Could not load feature detail.",
          });
        });
    });

    // Cursor feedback on hover, done the same generic way as the click
    // handler (one mousemove listener querying whatever fill layers exist
    // right now) instead of one mouseenter/mouseleave pair per dataset --
    // trades a per-move query for not having to re-bind listeners every
    // time the dataset list changes. Fine at this data scale (a handful of
    // layers); would need revisiting if that ever grows a lot.
    map.on("mousemove", (e: MapMouseEvent) => {
      const layers = fillLayerIdsRef.current;
      const hovering = layers.length > 0 && map.queryRenderedFeatures(e.point, { layers }).length > 0;
      map.getCanvas().style.cursor = hovering ? "pointer" : "";
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
    // one-time setup; `initialView` is only meant to seed the FIRST render
    // (re-running this on every prop change would fight the user's own
    // panning/zooming), and everything else is read via refs above.
  }, []);

  // Adds one source + fill/outline layer pair per MAPPABLE dataset, exactly
  // once (guarded by layersAddedRef -- `datasets` is fetched once from
  // `/datasets` and shouldn't change again this session, but effects still
  // have to guard against StrictMode's double-invoke in dev). Must wait for
  // `ready` (map "load") -- addSource/addLayer before then throws.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || layersAddedRef.current || datasets.length === 0) return;
    layersAddedRef.current = true; // claim it up front -- see the catch below for why

    const mappable = datasets.filter(isMappable);
    // Published styles (brief §6.3) are fetched here, not baked into
    // `/datasets` itself -- a layer with no published style yet is the
    // common case (most datasets are still on the palette default), and
    // this keeps that lookup a single best-effort side call rather than
    // coupling the registry endpoint to the styling feature.
    fetchPublishedStyles()
      .then((styles) => new Map(styles.map((s) => [s.slug, s.style_json as PublishedStyleOverride])))
      .catch(() => new Map<string, PublishedStyleOverride>()) // no published styles yet is not an error -- render on palette defaults
      .then((styleBySlug) => {
        mappable.forEach((dataset, index) => {
          const style = styleBySlug.get(dataset.slug);
          map.addSource(sourceId(dataset.slug), buildVectorSource(dataset));
          map.addLayer(buildFillLayer(dataset, index, style));
          map.addLayer(buildOutlineLayer(dataset, index, style));
        });
        fillLayerIdsRef.current = mappable.map((d) => fillLayerId(d.slug));
      });
  }, [ready, datasets]);

  // Layer-toggle effect (brief §6.2 "layer toggles"): only touches
  // layout visibility, never re-adds/removes sources -- toggling a
  // checkbox should be instant and shouldn't re-fetch any tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !layersAddedRef.current) return;
    for (const dataset of datasets.filter(isMappable)) {
      const visible = visibleSlugs.includes(dataset.slug);
      const visibility = visible ? "visible" : "none";
      if (map.getLayer(fillLayerId(dataset.slug))) {
        map.setLayoutProperty(fillLayerId(dataset.slug), "visibility", visibility);
      }
      if (map.getLayer(outlineLayerId(dataset.slug))) {
        map.setLayoutProperty(outlineLayerId(dataset.slug), "visibility", visibility);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `datasets`
    // itself doesn't need to retrigger this; only which slugs are visible
    // does, and re-running on every `datasets` reference is unnecessary
    // (it's fetched once and effectively stable content-wise).
  }, [ready, visibleSlugs.join(",")]);

  useImperativeHandle(
    ref,
    () => ({
      flyToCountry(iso, countryName, subregion) {
        const map = mapRef.current;
        if (!map) return;

        // Tier 1: if the polygons for this country are already loaded in
        // any dataset's vector-tile cache (querySourceFeatures only looks
        // at tiles already fetched -- it never triggers new requests), use
        // their real geometry for an exact fit. Wrapped per-dataset in
        // try/catch because querySourceFeatures throws if that dataset's
        // source hasn't been added yet (a real possibility if this is
        // called before the layers-added effect has run).
        let bounds: LngLatBoundsLike | null = null;
        for (const dataset of datasetsRef.current.filter(isMappable)) {
          try {
            const features = map.querySourceFeatures(sourceId(dataset.slug), {
              sourceLayer: tableNameFor(dataset.slug),
              filter: [
                "any",
                ["==", ["get", "iso_code"], iso],
                ["==", ["get", "country"], countryName ?? ""],
              ],
            });
            for (const feature of features) {
              if (feature.geometry) bounds = unionBounds(bounds, geometryBounds(feature.geometry));
            }
          } catch {
            // Source not added yet, or this dataset has no such property --
            // both are expected, not an error worth surfacing.
          }
        }

        if (bounds) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 8, duration: 800 });
          return;
        }

        // Tier 2 (brief: "simply zoom to a rough centroid/region ... don't
        // over-engineer this") -- a UN-subregion-level fallback, since an
        // exact per-country bbox isn't available from the API at all.
        const fallback = (subregion && REGION_CENTROIDS[subregion]) || WORLD_VIEW;
        map.flyTo({ center: fallback.center, zoom: fallback.zoom, duration: 800 });
      },
    }),
    [],
  );

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
});
