"use client";

import { useEffect, useState, type RefObject } from "react";
import { geoMercator, geoPath, type GeoPath, type GeoProjection } from "d3-geo";
import {
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
 */
export function transformForFeatures<P extends GeoJSON.GeoJsonProperties>(
  pathGen: GeoPath,
  features: Array<GeoJSON.Feature<GeoJSON.Geometry, P>>
): MapTransform {
  const bounds = pathGen.bounds({
    type: "FeatureCollection",
    features,
  }) as PixelBounds;
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
