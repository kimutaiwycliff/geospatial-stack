import type { IControl, Map as MapLibreMap } from "maplibre-gl";

// Mirrors the widely-published MapLibre/Mapbox "spinning globe" recipe:
// slow at low zoom, ease off as the user zooms in, pause entirely while the
// user is interacting (drag/scroll/etc) and resume once they stop. Not a
// GeoLibre-specific algorithm -- this exact shape (seconds-per-revolution,
// a "start slowing down" zoom threshold, a "stop entirely" zoom threshold)
// is the standard reference implementation for this effect.
const SECONDS_PER_REVOLUTION = 120;
const MAX_SPIN_ZOOM = 5;
const SLOW_SPIN_ZOOM = 3;

/**
 * Auto-rotating globe (GeoLibre-menu parity's "Spinning Globe") -- distinct
 * from the existing `globe` control (a bare on/off projection toggle
 * button, `GlobeControl`): this one forces globe projection AND animates
 * it, pausing while the viewer is actively panning/zooming/rotating so it
 * doesn't fight their own input. No corner widget (same as gridlines) --
 * this is a pure behavior toggle, not a positionable button.
 */
export function createSpinningGlobeControl(): IControl {
  let map: MapLibreMap | null = null;
  let userInteracting = false;
  let frame: number | null = null;
  let previousProjectionType: string | undefined;

  function spin() {
    if (!map) return;
    frame = requestAnimationFrame(spin);
    if (userInteracting) return;

    const zoom = map.getZoom();
    if (zoom >= MAX_SPIN_ZOOM) return;

    let degreesPerSecond = 360 / SECONDS_PER_REVOLUTION;
    if (zoom > SLOW_SPIN_ZOOM) {
      // Linearly tapers to a stop between SLOW_SPIN_ZOOM and MAX_SPIN_ZOOM
      // rather than cutting off abruptly at one threshold -- an instant
      // stop reads as the map "getting stuck," a taper reads as
      // intentional.
      degreesPerSecond *= (MAX_SPIN_ZOOM - zoom) / (MAX_SPIN_ZOOM - SLOW_SPIN_ZOOM);
    }

    const center = map.getCenter();
    // requestAnimationFrame has no fixed interval -- ~60fps is close enough
    // for a purely decorative rotation speed (nobody is timing this against
    // a stopwatch), so dividing the per-second rate by 60 rather than
    // tracking real elapsed time between frames.
    center.lng -= degreesPerSecond / 60;
    map.jumpTo({ center });
  }

  function markInteracting() {
    userInteracting = true;
  }
  function clearInteracting() {
    userInteracting = false;
  }

  return {
    onAdd(m) {
      map = m;
      // `getProjection()?.type` is typed as `PropertyValueSpecification<...>`
      // (it CAN be an interpolation/expression, not just a bare string) --
      // this app never sets projection to anything but the "mercator"/
      // "globe" literals, so this narrows to that reality rather than
      // threading the full expression type through just to store one value.
      previousProjectionType = map.getProjection()?.type as string | undefined;
      map.setProjection({ type: "globe" });

      map.on("mousedown", markInteracting);
      map.on("touchstart", markInteracting);
      map.on("dragstart", markInteracting);
      map.on("moveend", clearInteracting);

      frame = requestAnimationFrame(spin);
      return document.createElement("div");
    },
    onRemove() {
      if (frame !== null) cancelAnimationFrame(frame);
      map?.off("mousedown", markInteracting);
      map?.off("touchstart", markInteracting);
      map?.off("dragstart", markInteracting);
      map?.off("moveend", clearInteracting);
      // Restores whatever projection was in effect before this control was
      // added (mercator, or "globe" if the `globe` control/GlobeControl
      // button had already been toggled on) -- turning spin off shouldn't
      // also silently force the map back to mercator if it wasn't already.
      map?.setProjection({ type: (previousProjectionType as "mercator" | "globe" | undefined) ?? "mercator" });
      map = null;
      frame = null;
    },
  };
}
