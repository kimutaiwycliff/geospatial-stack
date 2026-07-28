// Runs on every `npm install`/`npm ci` (see package.json postinstall).
//
// MapLibre GL JS's tile-decoding worker is a prebuilt file the library
// ships as a plain dist/ asset, not something Vite can bundle from source --
// its default runtime URL resolution 404s once Vite inlines the rest of the
// library into our app chunk (see vite.config.ts for the full story). The
// fix is to serve the library's own worker file unbundled: copying it into
// public/ here means Vite copies it byte-for-byte into dist/ on build, and
// src/main.tsx points maplibregl.setWorkerUrl() at that exact path.
//
// maplibre-gl-worker.mjs is itself an ES module with its own top-level
// `import ... from "./maplibre-gl-shared.mjs"` -- that sibling chunk has to
// be copied alongside it, or the worker's own module graph 404s once it
// starts, and its message handler never registers. Symptom was brutal to
// diagnose: the top-level Worker script loads fine (200), no console error,
// no thrown exception anywhere -- tiles just sit in "loading" state forever
// because postMessage calls to the worker vanish into a half-initialized
// module. Caught only by inspecting map.style.tileManagers.<id> directly in
// a live browser, not by any build-time check.
//
// Done as a postinstall script (not committed to git) so both files stay in
// sync automatically whenever the maplibre-gl version in package.json
// changes -- a committed copy would silently go stale on `npm update`.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(webRoot, "node_modules/maplibre-gl/dist");
const destDir = join(webRoot, "public");

mkdirSync(destDir, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(distDir, file), join(destDir, file));
  console.log(`copy-maplibre-worker: ${file} -> public/${file}`);
}
