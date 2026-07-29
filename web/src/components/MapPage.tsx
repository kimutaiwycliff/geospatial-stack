import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { fetchCountries, fetchDatasets, isMappable, type CountrySummary, type Dataset } from "../lib/api";
import { asBasemapFlavor } from "../lib/basemapStyle";
import { buildMapUrlParams, parseMapUrlState } from "../lib/urlState";
import { WORLD_VIEW } from "../lib/regionCentroids";
import type { Selection } from "../lib/selection";
import { BasemapSwitcher } from "./BasemapSwitcher";
import { MapView, type MapViewHandle } from "./MapView";
import { LayerPanel } from "./LayerPanel";
import { CountrySearch } from "./CountrySearch";
import { SidePanel } from "./SidePanel";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Owns every piece of state the map, filters, and side panel share, and is
 * the ONLY place that talks to `/datasets` + `/countries` (brief §17: "the
 * only place the frontend should ever learn what layers exist"). MapView
 * itself stays a fairly dumb rendering component; this is where clicking a
 * country, toggling a layer, and the URL all get wired together.
 */
export function MapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Parsed exactly once, from whatever the URL was on first render of this
  // page -- deliberately NOT re-derived from `searchParams` on every
  // change, since this page is itself the thing writing `searchParams`
  // from then on (see the sync effect below). Re-reading it reactively
  // would just be reading back what this page just wrote.
  const [initialUrlState] = useState(() => parseMapUrlState(searchParams));

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [countries, setCountries] = useState<CountrySummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // null = "not yet resolved to a concrete slug list" -- resolved to either
  // the URL's `layers` param or (absent that) every mappable dataset, the
  // first time `datasets` loads. See the effect below.
  const [visibleSlugs, setVisibleSlugs] = useState<string[] | null>(initialUrlState.visibleSlugs);
  const [view, setView] = useState(initialUrlState.view ?? WORLD_VIEW);
  const [selectedIso, setSelectedIso] = useState<string | null>(initialUrlState.country);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [basemapFlavor, setBasemapFlavor] = useState(() => asBasemapFlavor(initialUrlState.basemap));

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panelOpenMobile, setPanelOpenMobile] = useState(false);

  const mapViewRef = useRef<MapViewHandle>(null);
  const appliedInitialCountryRef = useRef(false);

  useEffect(() => {
    fetchDatasets()
      .then(setDatasets)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Could not load datasets."));
    fetchCountries()
      .then(setCountries)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Could not load countries."));
  }, []);

  // Default layer visibility to "everything mappable" the first time
  // datasets arrive, UNLESS the URL already specified a `layers` list --
  // that list wins even if it doesn't (yet) match every mappable slug, so
  // a shared URL that intentionally hid a layer stays hidden on load.
  useEffect(() => {
    if (visibleSlugs !== null || datasets.length === 0) return;
    setVisibleSlugs(datasets.filter(isMappable).map((d) => d.slug));
  }, [datasets, visibleSlugs]);

  // Restores a `country` URL param once, after `/countries` has loaded --
  // both the side panel content and the map's initial fly-to depend on
  // having the real CountrySummary row, not just the bare ISO code.
  useEffect(() => {
    if (appliedInitialCountryRef.current || countries.length === 0) return;
    appliedInitialCountryRef.current = true;
    const iso = initialUrlState.country;
    if (!iso) return;
    const summary = countries.find((c) => c.iso_code === iso);
    if (!summary) return;
    setSelection({ kind: "country", summary });
    mapViewRef.current?.flyToCountry(iso, summary.pop_country as string | undefined, summary.pop_un_subreg as string | undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initialUrlState` is stable (see its own useState initializer)
  }, [countries]);

  // Share-URL sync (brief §6.2/§17): every view/filter change this page
  // knows about gets folded back into the query string with `replace`
  // (not `push`) so panning the map doesn't spam browser history -- only
  // an explicit navigation (e.g. clicking "About this platform") should do
  // that.
  useEffect(() => {
    if (datasets.length === 0 || visibleSlugs === null) return;
    const allSlugs = datasets.filter(isMappable).map((d) => d.slug);
    const params = buildMapUrlParams({
      center: view.center,
      zoom: view.zoom,
      visibleSlugs,
      allSlugs,
      country: selectedIso,
      basemap: basemapFlavor,
    });
    setSearchParams(params, { replace: true });
  }, [view, visibleSlugs, selectedIso, basemapFlavor, datasets, setSearchParams]);

  function toggleLayer(slug: string) {
    setVisibleSlugs((prev) => {
      const current = prev ?? datasets.filter(isMappable).map((d) => d.slug);
      return current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
    });
  }

  function selectAndShow(next: Selection | null) {
    setSelection(next);
    setPanelOpenMobile(next !== null);
  }

  function handleCountrySelect(country: CountrySummary | null) {
    if (country) {
      setSelectedIso(country.iso_code);
      selectAndShow({ kind: "country", summary: country });
      mapViewRef.current?.flyToCountry(
        country.iso_code,
        country.pop_country as string | undefined,
        country.pop_un_subreg as string | undefined,
      );
    } else {
      setSelectedIso(null);
      setSelection((prev) => (prev?.kind === "country" ? null : prev));
    }
  }

  return (
    <div className="flex h-screen w-screen flex-col animate-in fade-in duration-300 md:flex-row">
      {/* Filters/layers sidebar -- an overlay drawer under md, a fixed
          column at md+ (brief §6.2 "responsive desktop/mobile"). */}
      <div
        className={`z-30 w-full shrink-0 overflow-y-auto border-b border-border bg-background md:block md:h-full md:w-72 md:border-b-0 md:border-r ${
          sidebarOpen ? "fixed inset-0" : "hidden"
        } md:relative md:inset-auto`}
      >
        <div className="flex items-center justify-between border-b border-border p-3 md:hidden">
          <span className="text-sm font-semibold text-foreground">Filters</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen(false)} aria-label="Close filters">
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-5 p-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="text-xs text-primary hover:underline">
              &larr; About this platform
            </Link>
            {/* Same top-right-of-nav spot as Landing's toggle, just folded
                into this row since the sidebar (not a page-wide header) is
                the nearest "chrome" this page has. */}
            <ThemeToggle />
          </div>
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          <CountrySearch countries={countries} selectedIso={selectedIso} onSelect={handleCountrySelect} />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Basemap</span>
            <BasemapSwitcher value={basemapFlavor} onChange={setBasemapFlavor} />
          </div>
          <LayerPanel datasets={datasets} visibleSlugs={visibleSlugs ?? []} onToggle={toggleLayer} />
        </div>
      </div>

      {/* Map */}
      <div className="relative min-h-0 flex-1">
        <MapView
          ref={mapViewRef}
          datasets={datasets}
          visibleSlugs={visibleSlugs ?? []}
          initialView={initialUrlState.view}
          basemapFlavor={basemapFlavor}
          onFeatureSelect={selectAndShow}
          onViewChange={(center, zoom) => setView({ center, zoom })}
        />

        <div className="absolute left-3 top-3 z-10 flex gap-2 md:hidden">
          <Button variant="secondary" size="sm" onClick={() => setSidebarOpen(true)} className="shadow">
            Filters
          </Button>
          {selection && !panelOpenMobile && (
            <Button variant="secondary" size="sm" onClick={() => setPanelOpenMobile(true)} className="shadow">
              Details
            </Button>
          )}
        </div>
      </div>

      {/* Side panel -- overlay drawer under md, fixed column at md+. Slides
          in from the right on mount (brief: "SidePanel.tsx sliding in when
          a feature/country is selected") -- only plays on this wrapper's
          FIRST mount (selection: null -> non-null), not on every subsequent
          feature click while it's already open, since re-triggering it per
          click would be more motion than a "necessary" micro-interaction. */}
      {selection && (
        <div
          className={`z-30 w-full shrink-0 animate-in fade-in slide-in-from-right-4 duration-200 md:block md:h-full md:w-80 ${
            panelOpenMobile ? "fixed inset-0" : "hidden"
          } md:relative md:inset-auto`}
        >
          <SidePanel
            selection={selection}
            datasets={datasets}
            onClose={() => {
              setSelection(null);
              setPanelOpenMobile(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
