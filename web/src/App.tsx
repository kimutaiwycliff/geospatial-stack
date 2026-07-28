import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Landing } from "./components/Landing";
import { MapPage } from "./components/MapPage";

// Two routes now that there's a second thing worth navigating to (brief
// §6.2's landing page + map, vs. Phase 0's single-page "just the map").
// BrowserRouter (not Hash) because nginx.conf already does history-mode
// fallback for the SPA build (brief §6.1's "static files served by Caddy");
// a hash router would be redundant with that.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/map" element={<MapPage />} />
      </Routes>
    </BrowserRouter>
  );
}
