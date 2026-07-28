import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// MapLibre GL JS 6.0 exports named bindings only (no default export) --
// `addProtocol` is a module-level function, not a method on a Map instance.
import { addProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import App from "./App";
import "../styles/index.css";

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
