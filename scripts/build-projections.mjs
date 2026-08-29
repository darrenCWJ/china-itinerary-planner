/**
 * The §5.4 projection rule: how each of the 246 countries is fitted into the
 * map viewport, and which of its outlying polygons may be left out of frame.
 *
 * This module is the rule alone — pure functions over a country's already
 * merged outline. The I/O that walks `public/provinces/` and writes
 * `public/country-projections.json` lands in Task 2.
 *
 * Modelled on build-provinces.mjs: the pure functions are exported for tests
 * and the I/O is not.
 *
 * Two things about this file are load-bearing and neither is obvious:
 *
 * 1. **The viewport comes from lib/mapView.ts, never a literal.** The spec's
 *    own committed manifest was computed against 860x600 while the app renders
 *    into 860x620, so every scale in it is wrong by 3.3% and the build-time
 *    test §5.4 describes would fail on all of them.
 * 2. **d3-geo reads rings spherically.** A ring wound the other way is the
 *    globe MINUS the shape, which is why the fit uses a `MultiPoint` and never
 *    a `Polygon` rectangle (§5.5), and why `separation`'s fixtures have to be
 *    wound the way `merge()` winds real outlines.
 */

import { geoArea, geoBounds, geoCentroid, geoMercator } from 'd3-geo';
import { MAP_VIEW_H, MAP_VIEW_W } from '../lib/mapView.ts';

/**
 * The extent every scale is fitted to.
 *
 * Taken from the module the renderer takes it from, so the manifest and the
 * component can never disagree about how big the map is.
 */
export const VIEW_BOX = [[0, 0], [MAP_VIEW_W, MAP_VIEW_H]];

/** A longitude folded back into ±180. */
function norm(x) {
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

/**
 * Rule 1: the rotation that un-splits a country crossing the antimeridian.
 *
 * The largest gap between sorted longitudes is the empty arc, so the rest is
 * the minimal covering arc. Return 0 unless that arc crosses ±180 — §5.4's
 * rule 1 is that everyone else takes `rotate: 0` — and otherwise return the
 * negated centre, normalised, so the country lands on the prime meridian.
 *
 * Five countries take a non-zero rotation: FJ, KI, NZ, RU and US.
 */
export function rotationFor(polygons) {
  const lons = [];
  for (const polygon of polygons) for (const ring of polygon) for (const [lon] of ring) lons.push(lon);
  if (lons.length === 0) return 0;
  const sorted = lons.sort((a, b) => a - b);
  let gap = -1;
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 === sorted.length ? sorted[0] + 360 : sorted[i + 1];
    if (next - sorted[i] > gap) {
      gap = next - sorted[i];
      at = i;
    }
  }
  const start = sorted[(at + 1) % sorted.length];
  const span = 360 - gap;
  if (!(start <= 180 && start + span > 180)) return 0;
  return -norm(start + span / 2);
}

/**
 * One polygon's bbox in the ROTATED frame — computed once, reused everywhere.
 *
 * `lon + lambda` is normalised back into ±180 because it must be: rotating
 * Fiji by -178 sends its lon -179 vertex to -357, and the country reads as a
 * 357° span instead of a 3° one. The fit then collapses.
 */
export function boxOf(polygon, lambda) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const ring of polygon) {
    for (const [lon, lat] of ring) {
      const rx = norm(lon + lambda);
      if (rx < x0) x0 = rx;
      if (rx > x1) x1 = rx;
      if (lat < y0) y0 = lat;
      if (lat > y1) y1 = lat;
    }
  }
  return { x0, x1, y0, y1 };
}

/** The bbox covering a chosen subset of already-computed boxes. */
export function unionOf(boxes, indices) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const i of indices) {
    const b = boxes[i];
    if (b.x0 < x0) x0 = b.x0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y0 < y0) y0 = b.y0;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, x1, y0, y1 };
}

/**
 * The Mercator scale that fits a bbox into the viewport.
 *
 * Spec §5.5: three longitudes, two latitudes, as a MultiPoint. **Never a
 * Polygon rectangle** — d3-geo reads a ring spherically, so the rectangle is
 * read as the globe minus itself and every fit collapses to about
 * height / 2π. The middle longitude is what keeps the corner order unambiguous
 * as a span approaches 180°.
 *
 * The points are un-rotated (`x - lambda`) because the projection re-applies
 * the rotation; the bbox arrives already in the rotated frame.
 */
export function scaleOf(union, lambda, viewBox = VIEW_BOX) {
  const xm = (union.x0 + union.x1) / 2;
  const coordinates = [];
  for (const x of [union.x0, xm, union.x1]) {
    for (const y of [union.y0, union.y1]) coordinates.push([x - lambda, y]);
  }
  return geoMercator()
    .rotate([lambda, 0, 0])
    .fitExtent(viewBox, { type: 'MultiPoint', coordinates })
    .scale();
}

/**
 * Gate B, whose formula the spec never gives.
 *
 * §5.4 says "separation >= 0.5, measured from the polygon to the anchor" and
 * defines neither the measure nor the unit. Raw great-circle radians cannot be
 * it: Prince Edward Is. sits 0.356 rad from South Africa and the spec ACCEPTS
 * that trim.
 *
 * This is centroid separation in degrees normalised by the anchor's own bbox
 * diagonal — scale-free, so 0.5 means the same thing for Australia and for the
 * Netherlands. Recovered by treating the spec's published gains as an oracle:
 * on the 50m source the spec measured against, it reproduces NL, ZA, NC and
 * FJ, and it correctly refuses to hide Tasmania and Stewart Island, which are
 * the two cases §5.4 says the gate exists for.
 *
 * An anchor with no extent returns Infinity rather than dividing by zero.
 */
export function separation(anchorPolygon, polygon) {
  const [[ax0, ay0], [ax1, ay1]] = geoBounds({ type: 'Polygon', coordinates: anchorPolygon });
  const diagonal = Math.hypot(ax1 - ax0, ay1 - ay0);
  if (diagonal === 0) return Infinity;
  const a = geoCentroid({ type: 'Polygon', coordinates: anchorPolygon });
  const c = geoCentroid({ type: 'Polygon', coordinates: polygon });
  return Math.hypot(norm(c[0] - a[0]), c[1] - a[1]) / diagonal;
}

/** Floating-point slack for "this bbox edge IS the union's edge". */
const EPS = 1e-9;

/**
 * A ceiling on trimming, so a pathological country cannot loop for ever.
 * The deepest real trajectory that is accepted drops 7 polygons (FJ, TF).
 */
export const MAX_TRIM_STEPS = 40;

/**
 * Rule 2: every prefix of the greedy trim, best-first, with its cost.
 *
 * At each step the candidates are the polygons **driving the current extent** —
 * the ones whose bbox touches an edge of the union. That is what
 * "extent-driving" means, and it is also what makes this tractable: trying
 * every polygon is O(n²) over vertices and CA has 412 of them. **The
 * restriction is not lossy, and that was checked rather than assumed:** the
 * exhaustive every-polygon search was run to completion over all 246 countries
 * and returns the same nine accepted countries with identical gains, hidden
 * areas and scales to the digit.
 *
 * **The anchor is never a candidate.** Dropping it maximises scale trivially,
 * and ZA-without-South-Africa is Prince Edward Island at a 146× "gain".
 *
 * The WHOLE trajectory is returned and the caller picks the best point on it,
 * because a per-step gate loses the answer: NL's three Caribbean polygons each
 * gain ≈1.1× alone and 11.5× together.
 */
export function trimTrajectory(polygons, lambda, anchor, viewBox = VIEW_BOX) {
  const boxes = polygons.map((polygon) => boxOf(polygon, lambda));
  const all = polygons.map((_, i) => i);
  const areas = polygons.map((polygon) => geoArea({ type: 'Polygon', coordinates: polygon }));
  const total = areas.reduce((a, b) => a + b, 0);
  const base = scaleOf(unionOf(boxes, all), lambda, viewBox);

  const trajectory = [];
  const dropped = [];
  let keep = all.slice();
  let union = unionOf(boxes, keep);

  for (let step = 0; step < MAX_TRIM_STEPS && keep.length > 1; step++) {
    const driving = keep.filter((i) => i !== anchor && (
      Math.abs(boxes[i].x0 - union.x0) < EPS || Math.abs(boxes[i].x1 - union.x1) < EPS ||
      Math.abs(boxes[i].y0 - union.y0) < EPS || Math.abs(boxes[i].y1 - union.y1) < EPS));
    if (driving.length === 0) break;

    let pick = null;
    for (const i of driving) {
      const rest = keep.filter((j) => j !== i);
      const scale = scaleOf(unionOf(boxes, rest), lambda, viewBox);
      if (pick === null || scale > pick.scale) pick = { i, rest, scale };
    }

    keep = pick.rest;
    union = unionOf(boxes, keep);
    dropped.push(pick.i);
    trajectory.push({
      dropped: dropped.slice(),
      hidden: dropped.reduce((sum, i) => sum + areas[i], 0) / total,
      gain: pick.scale / base,
      // The MINIMUM over everything dropped so far, so one close-in polygon
      // cannot ride along on a set that is otherwise remote.
      sep: Math.min(...dropped.map((i) => separation(polygons[anchor], polygons[i]))),
      scale: pick.scale,
      union,
    });
  }

  return trajectory;
}
