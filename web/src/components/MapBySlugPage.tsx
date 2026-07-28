import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Map as MapLibreMap, Popup, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { fetchDatasets, isMappable, type Dataset } from "../lib/api";
import { fetchMap, type PublicMapConfig } from "../lib/adminApi";
import { buildBaseStyle } from "../lib/basemapStyle";
import {
  buildFillLayer,
  buildOutlineLayer,
  buildVectorSource,
  datasetSlugFromLayerId,
  fillLayerId,
  outlineLayerId,
  sourceId,
} from "../lib/mapSources";
import { WORLD_VIEW } from "../lib/regionCentroids";

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
    const entries = config.layers_json
      .map((layer) => ({ layer, dataset: datasets.find((d) => d.slug === layer.dataset_slug) }))
      .filter((entry): entry is { layer: (typeof config.layers_json)[number]; dataset: Dataset } => entry.dataset != null && isMappable(entry.dataset));

    const view = config.default_extent ?? WORLD_VIEW;
    // `config.basemap` is always "light" today (only flavor
    // @protomaps/basemaps is wired up with, per basemapStyle.ts) -- carried
    // through the API contract for a future picker, not switched on here.
    const map = new MapLibreMap({
      container: containerRef.current,
      style: buildBaseStyle(),
      center: view.center,
      zoom: view.zoom,
    });
    mapRef.current = map;

    map.on("load", () => {
      entries.forEach(({ layer, dataset }, index) => {
        map.addSource(sourceId(dataset.slug), buildVectorSource(dataset));
        map.addLayer(buildFillLayer(dataset, index));
        map.addLayer(buildOutlineLayer(dataset, index));
        if (!layer.visible) {
          map.setLayoutProperty(fillLayerId(dataset.slug), "visibility", "none");
          map.setLayoutProperty(outlineLayerId(dataset.slug), "visibility", "none");
        }
      });

      const fillLayerIds = entries.map(({ dataset }) => fillLayerId(dataset.slug));

      // Same minimal click-for-popup MapView's own click handler does --
      // no side panel here (this page has nowhere to put one, and a Map's
      // whole point is a fixed, curated view, not a full exploration UI).
      map.on("click", (e: MapMouseEvent) => {
        if (fillLayerIds.length === 0) return;
        const feature = map.queryRenderedFeatures(e.point, { layers: fillLayerIds })[0];
        if (!feature?.layer) return;
        const featureSlug = datasetSlugFromLayerId(feature.layer.id);
        const datasetName = entries.find((entry) => entry.dataset.slug === featureSlug)?.dataset.name ?? featureSlug;
        const label = (feature.properties?.name as string | undefined) ?? "Feature";
        new Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(`<div class="text-sm"><strong>${label}</strong><br/><span class="text-slate-500">${datasetName}</span></div>`)
          .addTo(map);
      });

      map.on("mousemove", (e: MapMouseEvent) => {
        const hovering = fillLayerIds.length > 0 && map.queryRenderedFeatures(e.point, { layers: fillLayerIds }).length > 0;
        map.getCanvas().style.cursor = hovering ? "pointer" : "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [config, datasets]);

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-slate-50 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          &larr; Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen">
      {config && (
        <div className="absolute left-3 top-3 z-10 max-w-sm rounded-md bg-white/95 px-3 py-2 shadow">
          <h1 className="text-sm font-semibold text-slate-900">{config.name}</h1>
          {config.description && <p className="text-xs text-slate-500">{config.description}</p>}
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
