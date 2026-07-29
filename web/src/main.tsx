import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// MapLibre GL JS 6.0 exports named bindings only (no default export) --
// `addProtocol` is a module-level function, not a method on a Map instance.
import { addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import * as Sentry from "@sentry/react";
import App from "./App";
import "../styles/index.css";

// Frontend half of brief §12's Sentry coverage -- api/app/main.py and
// worker/celery_app.py have had this since Phase 3; the SPA never did,
// leaving zero visibility into client-side render errors/crashes. Same
// no-DSN-means-no-op contract as both of those: `dsn: ""` disables the SDK
// entirely (documented Sentry behavior), so this is safe with nothing
// configured. VITE_SENTRY_DSN is a SEPARATE Sentry project's DSN from the
// backend's SENTRY_DSN (a JS/browser project, not the Python one) -- Vite
// only inlines `VITE_`-prefixed env vars into the client bundle, and
// backend/frontend Sentry projects are normally split anyway (different
// platform, different source maps).
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN ?? "",
  tracesSampleRate: 0,
});

// MapLibre's own automatic worker-URL resolution 404s once Vite bundles the
// library into our app chunk (see vite.config.ts and
// scripts/copy-maplibre-worker.mjs for the full explanation) -- point it at
// the unbundled copy that postinstall places in public/ instead. Must run
// before any Map is constructed, same as the pmtiles protocol registration
// below.
setWorkerUrl("/maplibre-gl-worker.mjs");

// Register the `pmtiles://` URL scheme with MapLibre once, at app startup,
// before any map is created -- this is the standard pmtiles+MapLibre
// integration (protomaps/pmtiles JS README): `Protocol#tile` becomes the
// handler MapLibre calls whenever a source URL uses that scheme, so
// src/lib/mapSources.ts can just write a `pmtiles://https://...` URL like
// any other tile URL without the map needing to know PMTiles is involved.
const protocol = new Protocol();
addProtocol("pmtiles", protocol.tile);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
