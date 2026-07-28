import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { AdminLogin } from "./components/admin/AdminLogin";
import { AdminMapsPage } from "./components/admin/AdminMapsPage";
import { MapEditor } from "./components/admin/MapEditor";
import { Landing } from "./components/Landing";
import { MapBySlugPage } from "./components/MapBySlugPage";
import { MapPage } from "./components/MapPage";
import { Toaster } from "./components/ui/sonner";
import { AdminAuthProvider, RequireAdmin } from "./lib/adminAuth";
import { ThemeProvider } from "./lib/theme";

// Two routes now that there's a second thing worth navigating to (brief
// §6.2's landing page + map, vs. Phase 0's single-page "just the map").
// BrowserRouter (not Hash) because nginx.conf already does history-mode
// fallback for the SPA build (brief §6.1's "static files served by Caddy");
// a hash router would be redundant with that.
//
// Phase 3 adds the admin surface (brief §6.3/§10): `/admin/login` is
// public, `/admin` is wrapped in <RequireAdmin> so an unauthenticated visit
// bounces straight to login instead of rendering an empty/erroring
// dashboard. AdminAuthProvider wraps the whole router (not just the /admin
// subtree) so a stray render of, say, a shared layout component could use
// useAdminAuth() without every call site needing to know whether it's
// "inside" the admin section -- cheap to provide everywhere, and this app
// has no competing top-level context that would collide with it.
//
// Phase 4 adds two more admin routes (Map authoring, brief §16) behind the
// SAME <RequireAdmin> guard as `/admin`, plus one new PUBLIC route: `/m/
// :slug`, a published Map's shareable page. That one deliberately sits
// alongside `/map` (the all-datasets default view) rather than under it --
// a Map is "one curated slice", not a mode of the general map, so it gets
// its own top-level path instead of a query param on `/map`.
export default function App() {
  return (
    <ThemeProvider>
      <Toaster />
      <AdminAuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/m/:slug" element={<MapBySlugPage />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route
              path="/admin"
              element={
                <RequireAdmin>
                  <AdminDashboard />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/maps"
              element={
                <RequireAdmin>
                  <AdminMapsPage />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin/maps/:slug"
              element={
                <RequireAdmin>
                  <MapEditor />
                </RequireAdmin>
              }
            />
          </Routes>
        </BrowserRouter>
      </AdminAuthProvider>
    </ThemeProvider>
  );
}
