import type { IControl, Map as MapLibreMap } from "maplibre-gl";

/**
 * Toggles MapLibre's own native atmosphere/sky rendering (`map.setSky`,
 * `SkySpecification`) -- a real built-in MapLibre feature, not a
 * hand-rolled effect, and best visible on globe projection (see
 * `atmosphere-blend`'s own doc comment in the style spec: "best to
 * interpolate ... when using globe projection" -- pairs naturally with the
 * `spinning-globe`/`globe` controls, though not dependent on either). No
 * corner widget, same as gridlines -- this is a pure on/off visual toggle
 * with no position-dependent UI of its own.
 */
export function createAtmosphereControl(): IControl {
  let map: MapLibreMap | null = null;
  let previousSky: ReturnType<MapLibreMap["getSky"]> | undefined;

  return {
    onAdd(m) {
      map = m;
      // Captured so onRemove restores whatever sky config (if any) was
      // already in place, rather than assuming "no sky at all" -- a style
      // that shipped its own sky config for some other reason shouldn't
      // lose it just because this toggle was flipped off again.
      previousSky = map.getSky();
      map.setSky({ "atmosphere-blend": 1 });
      return document.createElement("div");
    },
    onRemove() {
      map?.setSky(previousSky ?? {});
      map = null;
      previousSky = undefined;
    },
  };
}
