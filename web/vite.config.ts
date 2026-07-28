import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Minimal Vite config for the Phase-0 slice: React (JSX/Fast Refresh) +
// Tailwind v4's own Vite plugin, which replaces the postcss.config.js +
// autoprefixer setup Tailwind v3 needed -- Tailwind v4 does CSS transforms
// itself via Lightning CSS, so there's nothing else to wire up here.
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // No proxy for /api or /tiles here on purpose (see src/lib/config.ts) --
  // Phase 0 hits Martin/FastAPI/MinIO directly at their docker-compose
  // override ports from the browser. Caddy becomes the single origin once
  // the whole stack is deployed together; a Vite proxy would just be a
  // second, temporary version of that routing to delete later.
  server: {
    port: 5173,
  },

  // MapLibre GL JS 6.0's tile-decoding worker is a prebuilt file inside the
  // maplibre-gl package (dist/maplibre-gl-worker.mjs), resolved at runtime
  // via `new URL(..., import.meta.url)` relative to wherever the library's
  // own module ends up being served from. Vite bundles maplibre-gl INTO our
  // single app chunk rather than serving it as its own file, so that
  // relative resolution 404s (caught by actually loading the built site --
  // map background painted, but no vector tiles ever fetched, no console
  // error either since the failure is inside the worker's own fetch).
  // Fix: `scripts.postinstall` below copies the real worker file into
  // public/ (so Vite serves/copies it verbatim, unbundled) and
  // src/main.tsx calls maplibregl.setWorkerUrl() to point at it explicitly
  // instead of relying on the library's automatic resolution.
});
