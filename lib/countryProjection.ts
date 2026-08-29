import { geoMercator, type GeoProjection } from "d3-geo";
import { isCountryCode } from "./countries";
import { MAP_VIEW_H, MAP_VIEW_W } from "./mapView";

/**
 * The client's side of the §5.4 projection manifest.
 *
 * `scripts/build-projections.mjs` measures every country's merged outline once
 * and commits the answer as `public/country-projections.json`; this module is
 * the only thing that reads it back, so the on-disk shape stays an
 * implementation detail exactly as `lib/provinceTopology.ts` keeps the province
 * files' shape.
 *
 * The division of labour is the point of the artifact. A per-render
 * `fitExtent` over a country's features would be honest but wrong: it re-fits
 * whatever geometry happens to be loaded, so France would jump when Clipperton
 * arrives, and the trim that keeps Clipperton out of frame — a decision made
 * against gates, area budgets and a committed report — would have nowhere to
 * live. The manifest says how a country is framed; the renderer only obeys.
 *
 * Nothing here fetches. `PROJECTION_PATH` is root-relative and the caller owns
 * the request, the loading state and the failure, the same contract the
 * province files ship under.
 */

/** Root-relative so the fetch resolves the same from every route. */
export const PROJECTION_PATH = "/country-projections.json";

/** `[[x0, y0], [x1, y1]]`, the shape `fitExtent` and `bounds` both take. */
export type ViewBox = [[number, number], [number, number]];

/**
 * The extent every committed `scale` was fitted to.
 *
 * 860 x 620 from `lib/mapView.ts`, never a literal: the spec's own committed
 * manifest was measured against 860 x 600 and is wrong by 3.3% on all 235 of
 * its entries because of it. Flush, with no `MAP_VIEW_PAD` inset — a caller
 * that wants the inset passes its own box and gets a smaller scale.
 */
export const MANIFEST_VIEW_BOX: ViewBox = [
  [0, 0],
  [MAP_VIEW_W, MAP_VIEW_H],
];

/**
 * One country's framing.
 *
 * `bounds` is in the **rotated** frame — the frame `rotate` puts the country
 * in — so a renderer that applies `rotate` and then fits `bounds` reproduces
 * `scale` exactly. `scale` is therefore redundant by construction, which is
 * the point: `lib/countryProjection.test.ts` recomputes all 246, so a manifest
 * edited by hand fails a test rather than quietly mis-fitting a country.
 *
 * `hiddenAreaPct` is a PERCENT and is present only on the nine countries whose
 * fit leaves an outlying polygon out of frame. Nothing in the fit reads it; it
 * is carried so a surface can say so rather than silently losing an island.
 */
export interface ProjectionEntry {
  rotate: number;
  bounds: ViewBox;
  scale: number;
  hiddenAreaPct?: number;
}

/**
 * The fallback frame: the whole world, minus the latitudes Mercator cannot
 * draw.
 *
 * ±85 rather than ±90 because Mercator's y is infinite at the poles — d3 clips
 * there for the same reason — and an infinite extent fits to a NaN.
 */
const WORLD_BOUNDS: ViewBox = [
  [-180, -85],
  [180, 85],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * `[[x0, y0], [x1, y1]]` with all four numbers finite and in order, or null.
 *
 * Ordering is checked because an inverted box does NOT produce a NaN:
 * `fitExtent` accepts it in silence and mirrors the country.
 */
function readBounds(value: unknown): ViewBox | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [low, high] = value;
  if (!Array.isArray(low) || low.length !== 2 || !Array.isArray(high) || high.length !== 2) {
    return null;
  }
  const [x0, y0] = low;
  const [x1, y1] = high;
  if (![x0, y0, x1, y1].every(finite)) return null;
  if (x1 < x0 || y1 < y0) return null;
  return [
    [x0, y0],
    [x1, y1],
  ];
}

/** One entry, or null when it could not be rendered from. */
function readEntry(value: unknown): ProjectionEntry | null {
  if (!isRecord(value)) return null;
  const { rotate, scale, hiddenAreaPct } = value;
  // Beyond ±180 is not a rotation, it is a coordinate that escaped `norm`.
  if (!finite(rotate) || Math.abs(rotate) > 180) return null;
  if (!finite(scale) || scale <= 0) return null;
  const bounds = readBounds(value.bounds);
  if (bounds === null) return null;
  if (hiddenAreaPct !== undefined && (!finite(hiddenAreaPct) || hiddenAreaPct < 0 || hiddenAreaPct > 100)) {
    return null;
  }
  const entry: ProjectionEntry = { rotate, bounds, scale };
  if (hiddenAreaPct !== undefined) entry.hiddenAreaPct = hiddenAreaPct;
  return entry;
}

/**
 * Validates at the boundary and narrows.
 *
 * Throws only on the root, and drops individual entries — the split
 * `parseProvinceTopology` makes for `cityProvince`, for the same reason. A
 * root that is not an object is the wrong file entirely and every country
 * would silently take the world fallback, which is worth a hard failure. A
 * single unusable entry costs one country its framing and it falls back
 * gracefully, where throwing would cost all 246 theirs.
 *
 * `assertManifest` already refuses to write an entry this would drop, so
 * reaching that branch means the committed file disagrees with its own builder.
 *
 * A Map, not the record it was parsed from, because the keys come from a data
 * file: on a plain object `manifest["constructor"]` resolves to a function, so
 * a lookup that should miss reads as a hit.
 */
export function parseProjectionManifest(raw: unknown): ReadonlyMap<string, ProjectionEntry> {
  if (!isRecord(raw)) {
    throw new Error(
      `country-projections.json: root is not an object (got ${
        raw === null ? "null" : Array.isArray(raw) ? "an array" : typeof raw
      }) — was scripts/build-projections.mjs run?`
    );
  }
  const manifest = new Map<string, ProjectionEntry>();
  for (const [code, value] of Object.entries(raw)) {
    if (!isCountryCode(code)) continue;
    const entry = readEntry(value);
    if (entry !== null) manifest.set(code.toUpperCase(), entry);
  }
  return manifest;
}

/**
 * The §5.5 fit: three longitudes and two latitudes, as a `MultiPoint`.
 *
 * **Never a GeoJSON `Polygon` rectangle.** d3-geo reads rings spherically, so
 * a clockwise rect is *the globe minus the rect* and every fit collapses to
 * `MAP_VIEW_H / 2π` — which is indistinguishable from a whole-world map, so
 * the bug ships looking like a feature.
 *
 * The points are un-rotated (`x - rotate`) because the projection re-applies
 * the rotation and `bounds` already arrives in the rotated frame. Feed the
 * rotated numbers straight in and FJ, KI, NZ, RU and US are each framed 178°
 * away from themselves, at a perfectly plausible scale — a double rotation
 * moves the frame and never its width.
 *
 * Three longitudes rather than two, per §5.5, so corner order stays
 * unambiguous as a span approaches 180°.
 */
function fit(rotate: number, bounds: ViewBox, viewBox: ViewBox): GeoProjection {
  const [[x0, y0], [x1, y1]] = bounds;
  const coordinates: [number, number][] = [];
  for (const x of [x0, (x0 + x1) / 2, x1]) {
    for (const y of [y0, y1]) coordinates.push([x - rotate, y]);
  }
  return geoMercator()
    .rotate([rotate, 0, 0])
    .fitExtent(viewBox, { type: "MultiPoint", coordinates });
}

/**
 * The projection a country is drawn through, or a whole-world one when the
 * manifest has nothing to say about it.
 *
 * The fallback is not a nicety. The manifest and the code deploy
 * independently, and the province files refresh on their own schedule, so a
 * country whose entry has not been built yet must get a small map rather than
 * a blank one or a NaN — and the list beside it stays the spine either way.
 */
export function projectionFor(
  entry: ProjectionEntry | null | undefined,
  viewBox: ViewBox = MANIFEST_VIEW_BOX
): GeoProjection {
  return entry
    ? fit(entry.rotate, entry.bounds, viewBox)
    : fit(0, WORLD_BOUNDS, viewBox);
}
