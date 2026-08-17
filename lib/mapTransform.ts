/**
 * Zoom transform maths for the TopoJSON maps (spec §6: projection, zoom and
 * hover machinery are shared between map levels).
 *
 * Kept pure and free of `d3-geo` by taking bounds that are *already* projected
 * into viewBox pixels — the shape `geoPath().bounds()` returns — so the maths
 * can be checked against hand-computed fixtures with no projection in the way.
 */

/** Projected pixel bounds, `[[x0, y0], [x1, y1]]` — d3's `bounds()` shape. */
export type PixelBounds = [[number, number], [number, number]];

/** An SVG `translate(tx, ty) scale(k)`, in that order, about origin `0 0`. */
export interface MapTransform {
  k: number;
  tx: number;
  ty: number;
}

/**
 * Whole-map level: the projection already fits the viewBox, so no transform.
 * Frozen because it is one shared object handed to every map level.
 */
export const IDENTITY_TRANSFORM: MapTransform = Object.freeze({
  k: 1,
  tx: 0,
  ty: 0,
});

/**
 * Zoom ceiling. A single small region would otherwise scale far enough that
 * the outlines become a handful of fat strokes and the labels outgrow the map.
 */
export const MAX_ZOOM_K = 5;

/** The zoomed region fills 88% of the viewBox, leaving a margin around it. */
export const ZOOM_FILL = 0.88;

/**
 * Scale-and-centre transform that fits `bounds` inside a `viewW × viewH`
 * viewBox. The constraining axis wins, so the region never overflows — except
 * when {@link MAX_ZOOM_K} caps the scale, which is deliberate.
 *
 * Degenerate bounds (zero extent, or the `[[∞, ∞], [-∞, -∞]]` d3 returns for an
 * empty collection) are not guarded: callers zoom to a region they know has
 * features, and inventing a fallback here would hide the caller's bug.
 */
export function transformForBounds(
  bounds: PixelBounds,
  viewW: number,
  viewH: number
): MapTransform {
  const [[x0, y0], [x1, y1]] = bounds;
  const k = Math.min(
    MAX_ZOOM_K,
    ZOOM_FILL * Math.min(viewW / (x1 - x0), viewH / (y1 - y0))
  );
  // Centring identity: k * midpoint + t === view / 2 on both axes.
  return {
    k,
    tx: viewW / 2 - (k * (x0 + x1)) / 2,
    ty: viewH / 2 - (k * (y0 + y1)) / 2,
  };
}
