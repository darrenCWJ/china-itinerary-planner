"use client";

import { useEffect, useState, type RefObject } from "react";
import { geoMercator, geoPath, type GeoPath, type GeoProjection } from "d3-geo";
import {
  IDENTITY_TRANSFORM,
  transformForBounds,
  type MapTransform,
  type PixelBounds,
} from "@/lib/mapTransform";
import { MAP_VIEW_H, MAP_VIEW_PAD, MAP_VIEW_W } from "@/lib/mapView";

/**
 * Machinery both map levels share (spec §6): the fit-extent projection, the
 * zoom transform, the marker-visibility timing during a zoom, and hover
 * reporting in container coordinates. The world level and the country level
 * differ only in which features they draw — everything here is level-agnostic.
 */

// Re-exported rather than moved outright: nine call sites across CountryMap
// and WorldMap import these from here, and the geometry modules under lib/
// cannot import from a "use client" module. One definition, two doors.
export { MAP_VIEW_H, MAP_VIEW_W } from "@/lib/mapView";

/** Zoom transition length. Marker visibility is timed against it. */
export const ZOOM_MS = 650;

export interface FittedProjection {
  projection: GeoProjection;
  pathGen: GeoPath;
}

/**
 * Mercator projection fitted to the whole feature set, plus its path
 * generator. Fitting to the features rather than to fixed bounds is what lets
 * the same viewBox hold a country or the world.
 */
export function buildFitProjection<P extends GeoJSON.GeoJsonProperties>(
  features: Array<GeoJSON.Feature<GeoJSON.Geometry, P>>
): FittedProjection {
  const projection = geoMercator().fitExtent(
    [
      [MAP_VIEW_PAD, MAP_VIEW_PAD],
      [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD],
    ],
    { type: "FeatureCollection", features }
  );
  return { projection, pathGen: geoPath(projection) };
}

/**
 * Zoom transform that frames `features` within the shared viewBox. The maths
 * lives in `lib/mapTransform` and is tested there; this only turns features
 * into the pixel bounds it wants.
 *
 * **This is where spec §6.2's degenerate-bounds guard lives, and it lives here
 * because it is a fact about the caller and not about the maths.**
 * `transformForBounds` refuses the guard in its own docblock — a fallback
 * invented inside the arithmetic would hide the bug of asking to zoom to
 * nothing — and this function is its only caller in the app, so guarding once
 * here covers every level that zooms.
 *
 * The hazard is narrower than §6.2 states. A single point is the case it names,
 * and at the real 860 x 620 viewBox that case is fine: `860/0` and `620/0` are
 * both `Infinity`, and `MAX_ZOOM_K` clamps the result to exactly the
 * scale a 4px unit would have received. Guarding zero extent would therefore
 * send a legitimately tiny province back to identity. What has no defined
 * answer is an EMPTY collection — a group whose filter matched no unit, or
 * whose units carry no drawable geometry — for which d3 answers
 * `[[∞, ∞], [-∞, -∞]]` and the maths answers `scale(-0)` at
 * `translate(NaN, NaN)`: a map that vanishes rather than one that misframes.
 *
 * Finiteness is the test rather than `features.length`, because the two failure
 * modes are the same failure: what matters is whether anything was drawn, not
 * whether anything was passed.
 */
export function transformForFeatures<P extends GeoJSON.GeoJsonProperties>(
  pathGen: GeoPath,
  features: Array<GeoJSON.Feature<GeoJSON.Geometry, P>>
): MapTransform {
  const bounds = pathGen.bounds({
    type: "FeatureCollection",
    features,
  }) as PixelBounds;
  if (!bounds.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
    return IDENTITY_TRANSFORM;
  }
  return transformForBounds(bounds, MAP_VIEW_W, MAP_VIEW_H);
}

/** Projects a lon/lat pair into viewBox pixels, or the origin if unprojectable. */
export function makeProjector(
  projection: GeoProjection
): (lon: number, lat: number) => [number, number] {
  return (lon, lat) => projection([lon, lat]) ?? [0, 0];
}

/**
 * Markers hide during the zoom transition and fade back in at the target
 * scale, so they never render mid-transition at the wrong size. `zoomKey` is
 * whatever identifies the current framing — changing it restarts the hide.
 */
export function useMarkersVisible(zoomKey: unknown): boolean {
  const [markersVisible, setMarkersVisible] = useState(true);

  useEffect(() => {
    setMarkersVisible(false);
    const id = setTimeout(() => setMarkersVisible(true), ZOOM_MS);
    return () => clearTimeout(id);
  }, [zoomKey]);

  return markersVisible;
}

/** Hover position relative to the map container's top-left corner. */
export interface HoverPos {
  x: number;
  y: number;
}

/** The bits of a mouse event a hover reporter needs — React's or the DOM's. */
interface PointerLike {
  clientX: number;
  clientY: number;
}

/**
 * Reports hover in container coordinates, which is the frame the popup is
 * positioned in. Not a hook — it closes over nothing that outlives a render,
 * exactly like the inline handler it replaces.
 *
 * Without an event, or without an item, hover is cleared. If the container has
 * not mounted there is nothing to measure against, so it reports nothing
 * rather than a position relative to the viewport.
 */
export function createHoverReporter<T>(
  containerRef: RefObject<HTMLElement | null>,
  onHover: (item: T | null, pos: HoverPos | null) => void
): (item: T | null, evt?: PointerLike) => void {
  return (item, evt) => {
    if (!item || !evt) {
      onHover(null, null);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onHover(item, { x: evt.clientX - rect.left, y: evt.clientY - rect.top });
  };
}
