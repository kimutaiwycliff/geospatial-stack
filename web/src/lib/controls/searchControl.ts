import type { IControl, Map as MapLibreMap } from "maplibre-gl";

interface NominatimResult {
  display_name: string;
  boundingbox: [string, string, string, string];
}

/**
 * Free-text place search via Nominatim (OpenStreetMap's public geocoder) --
 * no API key, matching what GeoLibre itself defaults to for its own
 * Search/Reverse-Geocode tools. Their usage policy caps this at roughly
 * one request/second; the debounce below keeps normal typing well under
 * that. A self-hosted Nominatim instance (or a keyed provider) is the
 * natural upgrade path if usage ever outgrows the public instance --
 * swapping NOMINATIM_URL is the only change that would need.
 */
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const DEBOUNCE_MS = 500;

export function createSearchControl(): IControl {
  let map: MapLibreMap | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let input: HTMLInputElement;
  let results: HTMLUListElement;

  async function runSearch(query: string) {
    if (!query.trim()) {
      results.replaceChildren();
      results.classList.add("hidden");
      return;
    }
    let places: NominatimResult[];
    try {
      const res = await fetch(`${NOMINATIM_URL}?format=json&limit=5&q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      places = (await res.json()) as NominatimResult[];
    } catch {
      // Network hiccup or rate-limit -- fails quiet (empty dropdown), same
      // as CountrySearch.tsx's own no-match state; a toast for every
      // transient geocoding miss would be noisier than useful.
      results.replaceChildren();
      results.classList.add("hidden");
      return;
    }
    results.replaceChildren();
    if (places.length === 0) {
      results.classList.add("hidden");
      return;
    }
    for (const place of places) {
      const item = document.createElement("li");
      item.className = "cursor-pointer px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted";
      item.textContent = place.display_name;
      item.onclick = () => {
        const [south, north, west, east] = place.boundingbox.map(Number);
        map?.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, maxZoom: 14, duration: 500 },
        );
        results.classList.add("hidden");
        input.value = place.display_name;
      };
      results.appendChild(item);
    }
    results.classList.remove("hidden");
  }

  return {
    onAdd(m) {
      map = m;
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl relative w-56";

      input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Search a place…";
      input.setAttribute("aria-label", "Search a place");
      input.className =
        "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground shadow outline-none focus-visible:ring-2 focus-visible:ring-ring";
      input.oninput = () => {
        clearTimeout(debounceTimer);
        const query = input.value;
        debounceTimer = setTimeout(() => void runSearch(query), DEBOUNCE_MS);
      };
      container.appendChild(input);

      results = document.createElement("ul");
      results.className =
        "hidden absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card/95 shadow";
      container.appendChild(results);

      return container;
    },
    onRemove() {
      clearTimeout(debounceTimer);
      map = null;
    },
  };
}
