import type { IControl, Map as MapLibreMap } from "maplibre-gl";

interface Bookmark {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const STORAGE_KEY = "geoplatform:map-bookmarks";

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Bookmark[]) : [];
  } catch {
    // Corrupted/hand-edited localStorage value -- treat as "no bookmarks"
    // rather than throwing and breaking the whole control.
    return [];
  }
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

/**
 * Saved-view bookmarks (GeoLibre-menu parity's "Bookmark"): a corner button
 * that opens a small panel to save the current view under a name and jump
 * back to it later. Stored in `localStorage`, per-browser -- there's no
 * server-side "viewer's personal view" resource anywhere in this app to
 * persist these against (a Map's own `default_extent` is an admin-authored
 * config field, not a visitor's bookmark list), and per-browser is exactly
 * what a personal "places I come back to" list should be anyway.
 *
 * Plain DOM (no React) building its own small panel, same as minimapControl
 * -- every custom control here is a self-contained `IControl` with no
 * dependency on this app's component tree, since MapEditor's controls_json
 * system adds/positions these directly via MapLibre's own `addControl`.
 */
export function createBookmarkControl(): IControl {
  let map: MapLibreMap | null = null;

  return {
    onAdd(m) {
      map = m;
      const container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group";
      container.style.position = "relative";

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "maplibregl-ctrl-icon";
      toggleButton.title = "Bookmarks";
      toggleButton.setAttribute("aria-label", "Bookmarks");
      // A plain glyph, not an icon font/sprite -- matches this control
      // set's "no external asset dependency" bar (search/measure/minimap
      // are all plain DOM + Tailwind classes too).
      toggleButton.textContent = "★";
      toggleButton.style.fontSize = "16px";
      container.appendChild(toggleButton);

      const panel = document.createElement("div");
      panel.className =
        "hidden absolute right-0 top-full z-10 mt-1 w-56 flex-col gap-0.5 rounded-md border border-border bg-card p-2 text-sm shadow-lg";
      container.appendChild(panel);

      function renderPanel() {
        panel.innerHTML = "";
        const bookmarks = loadBookmarks();

        const saveRow = document.createElement("button");
        saveRow.type = "button";
        saveRow.className = "mb-1 w-full rounded px-2 py-1 text-left font-medium text-foreground hover:bg-muted";
        saveRow.textContent = "+ Save current view";
        saveRow.onclick = () => {
          if (!map) return;
          const name = window.prompt("Name this view:");
          if (!name) return;
          const center = map.getCenter();
          const next: Bookmark = {
            id: `${Date.now()}`,
            name,
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
            bearing: map.getBearing(),
            pitch: map.getPitch(),
          };
          saveBookmarks([...bookmarks, next]);
          renderPanel();
        };
        panel.appendChild(saveRow);

        if (bookmarks.length === 0) {
          const empty = document.createElement("p");
          empty.className = "px-2 py-1 text-xs text-muted-foreground";
          empty.textContent = "No bookmarks yet.";
          panel.appendChild(empty);
        }

        for (const bookmark of bookmarks) {
          const row = document.createElement("div");
          row.className = "flex items-center justify-between gap-1 rounded px-2 py-1 hover:bg-muted";

          const jumpButton = document.createElement("button");
          jumpButton.type = "button";
          jumpButton.className = "flex-1 truncate text-left text-foreground";
          jumpButton.textContent = bookmark.name;
          jumpButton.onclick = () => {
            map?.flyTo({ center: bookmark.center, zoom: bookmark.zoom, bearing: bookmark.bearing, pitch: bookmark.pitch });
          };
          row.appendChild(jumpButton);

          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "text-muted-foreground hover:text-destructive";
          deleteButton.setAttribute("aria-label", `Delete bookmark ${bookmark.name}`);
          deleteButton.textContent = "×";
          deleteButton.onclick = () => {
            saveBookmarks(bookmarks.filter((b) => b.id !== bookmark.id));
            renderPanel();
          };
          row.appendChild(deleteButton);

          panel.appendChild(row);
        }
      }

      toggleButton.onclick = () => {
        const isHidden = panel.classList.contains("hidden");
        panel.classList.toggle("hidden", !isHidden);
        panel.classList.toggle("flex", isHidden);
        if (isHidden) renderPanel();
      };

      return container;
    },
    onRemove() {
      map = null;
    },
  };
}
