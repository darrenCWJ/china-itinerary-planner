import { geoDistance } from "d3-geo";
import { MAP_VIEW_H, MAP_VIEW_PAD, MAP_VIEW_W } from "./mapView";

/**
 * Every calculation the globe needs, as pure functions.
 *
 * Kept free of React and of `components/map/mapShared.ts` — which is
 * `"use client"` — so this runs in the fast node test project and can be
 * checked against hand-worked values with no rendering in the way. The same
 * split `lib/mapTransform.ts` already uses for the flat map's zoom.
 */

/** d3's rotate: `[lambda, phi]` in degrees, applied as negated lon/lat. */
export type Rotation = [number, number];

/**
 * The disc is a constant.
 *
 * `geoOrthographic().fitExtent(…, {type: "Sphere"})` fits the whole globe
 * rather than the features currently in view, which is what stops the disc
 * resizing as countries rotate past the limb. Fitting a sphere into a padded
 * box is arithmetic with no dependence on rotation, so the result is fixed:
 * radius 300 at [430, 310]. The test asserts these against d3 itself rather
 * than trusting the derivation.
 */
export const GLOBE_R =
  Math.min(MAP_VIEW_W - 2 * MAP_VIEW_PAD, MAP_VIEW_H - 2 * MAP_VIEW_PAD) / 2;
export const GLOBE_CX = MAP_VIEW_W / 2;
export const GLOBE_CY = MAP_VIEW_H / 2;

/** Degrees of rotation per viewBox unit dragged: a disc-width drag is 180°. */
const DRAG_DEGREES_PER_UNIT = 90 / GLOBE_R;

/** The lon/lat currently at the centre of the disc. */
export function rotationCentre(rot: Rotation): [number, number] {
  return [-rot[0], -rot[1]];
}

/**
 * Whether a lon/lat is on the visible hemisphere.
 *
 * The guard that stops the point layer lying. `geoPath` clips polygon geometry
 * at the limb and returns null beyond it, but a bare `projection([lon, lat])`
 * does not clip at all — centred on China it places Buenos Aires 70px from the
 * middle of the disc, drawn over Asia and fully clickable, 166° away on the far
 * side of the planet. Every point must pass this before it is drawn or made a
 * target.
 */
export function isFrontFacing(lon: number, lat: number, rot: Rotation): boolean {
  return geoDistance([lon, lat], rotationCentre(rot)) < Math.PI / 2;
}

/**
 * Whether a viewBox pixel lands on the globe rather than the space around it.
 *
 * `projection.invert()` does not answer this: pixel [5, 5], the empty top-left
 * corner of the viewBox, inverts to [-7.37, 28.53], which is inside Algeria. An
 * invert without this guard turns clicking on nothing into selecting a country.
 */
export function isOnDisc(x: number, y: number): boolean {
  return Math.hypot(x - GLOBE_CX, y - GLOBE_CY) <= GLOBE_R;
}

/** Longitude wrapped into (-180, 180], so a spin has no seam. */
export function normaliseLambda(lambda: number): number {
  const wrapped = (((lambda + 180) % 360) + 360) % 360 - 180;
  // (-180, 180] rather than [-180, 180): they are the same meridian, and
  // picking one keeps `shortestDelta` from reporting a 360° journey.
  return wrapped === -180 ? 180 : wrapped;
}

/** Tilt, clamped so the globe cannot tip over a pole and arrive upside down. */
export function clampPhi(phi: number): number {
  return Math.max(-90, Math.min(90, phi));
}

/** Signed angular distance, taking the short way round the antimeridian. */
export function shortestDelta(from: number, to: number): number {
  return normaliseLambda(to - from);
}

/** The rotation that brings a lon/lat to the centre of the disc. */
export function rotationFor(lon: number, lat: number): Rotation {
  return [normaliseLambda(-lon), clampPhi(-lat)];
}

/**
 * A pointer drag, in viewBox units, applied to a rotation.
 *
 * The surface follows the hand on both axes. d3's rotation is the NEGATED
 * centre — `rotationCentre` above — so the two axes take opposite signs here:
 *
 * - Dragging right (dx > 0) must bring what was west of the centre into the
 *   middle, i.e. the centre's longitude falls. Longitude is -lambda, so
 *   lambda RISES with dx.
 * - Dragging down (dy > 0) must bring the north into the middle, i.e. the
 *   centre's latitude rises. Latitude is -phi, so phi FALLS with dy.
 *
 * The vertical sign was `+` until 2026-09-06, on the reasoning "phi is the
 * negated latitude, so a positive dy raises it" — which raised phi, and so
 * LOWERED the centre: the globe turned against the pointer on that axis
 * while the horizontal one was right, and `lib/globeRotation.test.ts` pinned
 * the inverted sign. Measured in a browser before the fix: an 80px drag down
 * moved China 115px up.
 */
export function rotateByDrag(from: Rotation, dx: number, dy: number): Rotation {
  return [
    normaliseLambda(from[0] + dx * DRAG_DEGREES_PER_UNIT),
    clampPhi(from[1] - dy * DRAG_DEGREES_PER_UNIT),
  ];
}

/** Cubic ease-out, matching the `cubic-bezier(0.33, 1, 0.68, 1)` the zoom uses. */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * The rotation partway through a spin, for `t` in [0, 1].
 *
 * `t` is clamped rather than trusted: the driver reads a clock, and a delayed
 * frame hands it a value past 1, which without the clamp would spin past the
 * target and swing back.
 *
 * Longitude interpolates through `shortestDelta`, so turning from 170°E to
 * 170°W crosses the antimeridian — 20° — instead of unwinding 340° the other
 * way. Latitude does not wrap and is a plain lerp.
 */
export function rotationAt(from: Rotation, to: Rotation, t: number): Rotation {
  const e = easeOut(Math.max(0, Math.min(1, t)));
  return [
    normaliseLambda(from[0] + shortestDelta(from[0], to[0]) * e),
    clampPhi(from[1] + (to[1] - from[1]) * e),
  ];
}
