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

/** Magnifying-glass glyph, same inlined-SVG convention as every other
 * hand-built control's icon (layersControl.ts's LAYERS_ICON, etc.) -- no
 * icon-font/external asset dependency. */
const SEARCH_ICON = `
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="11" cy="11" r="8"></circle>
  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
</svg>`;

const CLOSE_ICON = `
<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="18" y1="6" x2="6" y2="18"></line>
  <line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`;

/**
 * Collapsed by default to a single icon button -- same `maplibregl-ctrl-
 * icon` footprint as every other corner control (brief follow-up:
 * "closable and collapsible", matching the basemap switcher's earlier
 * "smaller ... appropriate icon" treatment) instead of permanently
 * occupying a 224px-wide input box on the map. Clicking the icon expands
 * an input+results panel; the panel's own close (X) button, hitting
 * Escape, or clicking elsewhere on the map all collapse it back down --
 * three natural ways to dismiss it rather than just one.
 */
export function createSearchControl(): IControl {
  let map: MapLibreMap | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let input: HTMLInputElement;
  let results: HTMLUListElement;
  let container: HTMLDivElement;
  let expanded: HTMLDivElement;
  let toggleButton: HTMLButtonElement;

  function handleOutsideClick(e: MouseEvent) {
    if (!expanded.classList.contains("hidden") && e.target instanceof Node && !container.contains(e.target)) {
      collapse();
    }
  }

  function collapse() {
    expanded.classList.add("hidden");
    toggleButton.classList.remove("hidden");
    results.replaceChildren();
    results.classList.add("hidden");
    input.value = "";
    clearTimeout(debounceTimer);
  }

  function expand() {
    toggleButton.classList.add("hidden");
    expanded.classList.remove("hidden");
    input.focus();
  }

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
      container = document.createElement("div");
      container.className = "maplibregl-ctrl relative";

      toggleButton = document.createElement("button");
      toggleButton.type = "button";
      // Theme-aware replacement for `.maplibregl-ctrl-group`'s look
      // (rounded + box-shadow + the 29x29 sizing that class's own `button`
      // descendant selector provides), applied to the BUTTON rather than
      // `container` -- `container` also wraps `expanded` below, which has
      // its own separate box styling once open, and boxing the container
      // too would nest one border inside another. Not `.maplibregl-ctrl-
      // group` itself: that hardcodes `background:#fff` with no dark-mode
      // awareness (brief follow-up: "does not look well ... in dark mode").
      toggleButton.className =
        "maplibregl-ctrl-icon flex h-[29px] w-[29px] items-center justify-center rounded border border-border bg-card shadow-sm";
      toggleButton.title = "Search a place";
      toggleButton.setAttribute("aria-label", "Search a place");
      toggleButton.innerHTML = SEARCH_ICON;
      toggleButton.onclick = expand;
      container.appendChild(toggleButton);

      expanded = document.createElement("div");
      expanded.className = "hidden w-56 rounded-md border border-border bg-background shadow";

      const inputRow = document.createElement("div");
      inputRow.className = "flex items-center gap-1 p-1";

      input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Search a place…";
      input.setAttribute("aria-label", "Search a place");
      input.className =
        "w-full rounded border-none bg-transparent px-1.5 py-1 text-xs text-foreground outline-none";
      input.oninput = () => {
        clearTimeout(debounceTimer);
        const query = input.value;
        debounceTimer = setTimeout(() => void runSearch(query), DEBOUNCE_MS);
      };
      input.onkeydown = (e) => {
        if (e.key === "Escape") collapse();
      };
      inputRow.appendChild(input);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className =
        "flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground";
      closeButton.title = "Close search";
      closeButton.setAttribute("aria-label", "Close search");
      closeButton.innerHTML = CLOSE_ICON;
      closeButton.onclick = collapse;
      inputRow.appendChild(closeButton);

      expanded.appendChild(inputRow);

      results = document.createElement("ul");
      results.className = "hidden max-h-56 overflow-y-auto border-t border-border";
      expanded.appendChild(results);

      container.appendChild(expanded);

      // Captures on `mousedown` (fires before `blur`/click-driven state
      // changes elsewhere) so clicking anywhere else on the map -- not just
      // the X button or Escape -- collapses this back to an icon.
      document.addEventListener("mousedown", handleOutsideClick);

      return container;
    },
    onRemove() {
      clearTimeout(debounceTimer);
      document.removeEventListener("mousedown", handleOutsideClick);
      map = null;
    },
  };
}
