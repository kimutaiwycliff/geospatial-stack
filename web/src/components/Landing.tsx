import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Database, LayoutGrid, MapPinned, ShieldCheck, UploadCloud, Wand2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { datasetsUrl, mapsUrl } from "@/lib/config";
import type { Dataset } from "@/lib/api";
import type { MapSummary } from "@/lib/adminApi";
import { ThemeToggle } from "./ThemeToggle";

const FEATURES = [
  {
    icon: UploadCloud,
    title: "Bring your own data",
    description:
      "Shapefiles, KML/KMZ, GeoParquet, spreadsheets -- upload it, and the pipeline validates, curates, and tiles it automatically.",
  },
  {
    icon: Wand2,
    title: "Style it your way",
    description:
      "Per-layer colors, popups, hover tooltips, filters, and legends -- all editable from the admin side, no code changes required.",
  },
  {
    icon: MapPinned,
    title: "Author curated maps",
    description:
      "Combine any published layers into a shareable Map with its own basemap, controls, zoom limits, and gridlines.",
  },
  {
    icon: ShieldCheck,
    title: "Governance built in",
    description:
      "Source, license, attribution, and sensitivity travel with every dataset, with a full audit trail on every admin change.",
  },
  {
    icon: Database,
    title: "Serve it however fits",
    description:
      "Static PMTiles for stable layers, dynamic Martin tiles for live-editable data -- switchable per dataset, even after publishing.",
  },
  {
    icon: LayoutGrid,
    title: "One platform, any domain",
    description:
      "Land tenure, infrastructure, environment, logistics -- the pipeline doesn't care what the data is about, only that it's geospatial.",
  },
] as const;

/**
 * Mission/explainer page, reframed from a single-purpose LandMark-replica
 * pitch to what this platform actually is now: a general-purpose
 * geospatial data publishing stack that happens to have shipped with land
 * rights data first. The old copy ("This platform replicates ... LandMark
 * ...") stopped being true the moment self-service upload/curate/publish +
 * Map authoring landed -- this page was the one place that framing hadn't
 * caught up yet.
 *
 * Still deliberately restrained (brief's "doesn't need to be elaborate"),
 * just widened: a headline + subhead, a live stats strip (real counts from
 * the public API, never hardcoded -- this app's own rule for datasets
 * applies here too), a feature grid explaining the actual capabilities,
 * and the same single "Explore the map" CTA.
 */
export function Landing() {
  const [datasetCount, setDatasetCount] = useState<number | null>(null);
  const [mapCount, setMapCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(datasetsUrl())
      .then((res) => (res.ok ? (res.json() as Promise<Dataset[]>) : Promise.reject()))
      .then((rows) => {
        if (!cancelled) setDatasetCount(rows.length);
      })
      .catch(() => {
        // Stats are a nice-to-have flourish, not load-bearing -- a failed
        // fetch just leaves the number out rather than showing an error on
        // what's meant to be the calmest page in the app.
      });
    void fetch(mapsUrl())
      .then((res) => (res.ok ? (res.json() as Promise<MapSummary[]>) : Promise.reject()))
      .then((rows) => {
        if (!cancelled) setMapCount(rows.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = [
    { label: "Published datasets", value: datasetCount },
    { label: "Curated maps", value: mapCount },
    { label: "Data formats supported", value: 5 },
  ];

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-background">
      {/* Same soft radial wash as before, now anchored to the hero section
          only (not the whole scrollable page) -- brief: public/mission
          pages "can carry a bit more visual warmth than the admin
          dashboard's data-density needs". `color-mix` against the themed
          `--primary` variable keeps this correct in both themes with no
          separate dark-mode override. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-128"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 20%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 70%)",
        }}
      />

      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 pb-20 pt-24 text-center sm:pt-32">
        <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            A general-purpose geospatial data platform
          </span>
          <h1 className="max-w-3xl text-4xl font-bold text-foreground sm:text-5xl">
            Publish, style, and share any geospatial data
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Upload shapefiles, KML, or spreadsheets and this platform handles the rest: validation, curation, tiling,
            styling, and governance -- so you can go from raw file to a shareable, interactive map without writing a
            line of code.
          </p>
          <Link to="/map" className={buttonVariants({ variant: "default", size: "lg" })}>
            Explore the map
          </Link>
        </div>

        {/* Stats strip -- real counts, not marketing copy; blank cells
            (still loading, or the fetch failed) render as "--" rather than
            a layout-shifting spinner, since these are a supporting detail
            and shouldn't compete for attention on first paint. */}
        <div className="mt-8 grid w-full max-w-2xl grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 py-4">
              <span className="text-2xl font-bold text-foreground">{stat.value ?? "--"}</span>
              <span className="text-xs text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-12 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="animate-in fade-in duration-500">
              <CardHeader>
                <feature.icon className="mb-1 h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
