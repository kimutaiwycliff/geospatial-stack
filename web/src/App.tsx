import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AdminDashboard } from "./components/admin/AdminDashboard";
import { AdminLogin } from "./components/admin/AdminLogin";
import { Landing } from "./components/Landing";
import { MapPage } from "./components/MapPage";
import { AdminAuthProvider, RequireAdmin } from "./lib/adminAuth";

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
export default function App() {
  return (
    <AdminAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminDashboard />
              </RequireAdmin>
            }
          />
        </Routes>
      </BrowserRouter>
    </AdminAuthProvider>
  );
}
