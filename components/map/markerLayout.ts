import type { ProvinceFile } from "@/lib/provinceTopology";
import { FIT_COLORS, fitForPlace, type DerivedClimateIndex, type MapPlace } from "./mapTypes";
import { radiusFor } from "./markerGeometry";

/**
 * The marker layer's arithmetic, as pure functions over the country's places:
 * where each is projected, how large its target may be, what colour it is
 * this month, and which of them a framed map draws. `CountryLevel` memoises
 * each on exactly the inputs named here. Moved out of its `useMemo` bodies on
 * 2026-09-07 with no change to any line of arithmetic; the docblock each
 * memo carried is on its function below.
 */

export type Project = (lon: number, lat: number) => [number, number];
export interface Point { x: number; y: number }
export interface Mark extends Point { r: number; hitR: number }
export interface VisibleEntry { place: MapPlace; index: number }

/** The suggested route's stops, projected, in route order (`routePoints`). */
export function routePath(routeIds: string[], places: MapPlace[], project: Project): [number, number][] {
  return routeIds
    .map((id) => places.find((p) => p.id === id))
    .filter((p): p is MapPlace => Boolean(p))
    .map((p) => project(p.lon, p.lat));
}

/** Every place's projected point, indexed like `places` (`points`). */
export function projectPlaces(places: MapPlace[], project: Project): Point[] {
  return places.map((place) => {
    const [x, y] = project(place.lon, place.lat);
    return { x, y };
  });
}

/**
 * Marker positions and their transparent targets (§5.3.2).
 *
 * The floor is the marker's own dot: a target INSIDE the visible circle
 * would make the dot's edge the target's edge, which is the failure the
 * hit-area-first ordering exists to prevent. Where two dots are closer than
 * their own radii they already overlapped before this existed.
 *
 * Two of the three terms are divided by `k` and one is not, which is the
 * whole of the clamp-after discipline in one line. The dot is a drawn length
 * and the tap target is a pixel promise, so both shrink as the map is
 * magnified; `caps` is a gap between two projected points, which the zoom
 * does not change. This memo is O(n) and may re-run per zoom; the O(n²) one
 * above must not.
 */
export function markerMarks(points: Point[], caps: number[], places: MapPlace[], tapMinR: number, k: number): Mark[] {
  return points.map((point, index) => {
    const r = radiusFor(places[index]) / k;
    return { ...point, r, hitR: Math.max(r, Math.min(caps[index], tapMinR)) };
  });
}

/**
 * Each marker's fill, resolved once per (places, month, climate) rather than
 * once per render: this level re-renders on every hover — the hover card is
 * state above it — and a verdict depends on nothing the pointer changes.
 * Indexed like `marks`, by the place's position in the country, so a zoom
 * re-uses it untouched.
 */
export function markerFills(places: MapPlace[], month: number, climate: DerivedClimateIndex): string[] {
  return places.map((place) => FIT_COLORS[fitForPlace(place, month, climate)]);
}

/**
 * The markers a framed map draws, paired with their index into everything
 * computed above — §6.5, and `cityProvince`'s first ever reader.
 *
 * Plan 2 shipped that Map unconsumed. It is the ONLY thing that places a
 * city in a province: a marker's lon/lat decide where it is drawn, and the
 * committed assignment decides which unit contains it. Recomputing
 * containment here would be a second answer to a question
 * `scripts/build-provinces.mjs` already answered — per frame, against
 * simplified geometry — and the two would part company at the first boundary
 * that moved.
 *
 * Two misses, and both hide the city rather than showing it:
 *
 * - **no assignment at all.** 478 cities across the 246 files were placed by
 *   neither containment nor `a1c`. A city shown in every province because it
 *   is known to be in none asserts, 25 times over for Peru, a fact the build
 *   was careful not to invent.
 * - **an assignment naming a unit no group offers.** 43 committed values name
 *   a `sel: 0` unit — Northern Cyprus, Somaliland, Guantánamo — which §7.2
 *   keeps out of `regionSchemeFor` on purpose. Those cities are real and the
 *   list below reaches them; no region draws them.
 *
 * The pairs carry the ORIGINAL index because `points`, `caps` and `marks`
 * are computed over the whole country and must stay that way: `caps` is the
 * O(n²) pass, keyed on the country so a zoom never re-runs its ~560k
 * distance checks, and re-indexing it per zoom is the same mistake as
 * folding `k` into it. So the filter lands at the DRAW, and the arithmetic
 * above it never learns there is one.
 */
export function visibleEntries(
  places: MapPlace[],
  group: { unitIds: readonly string[] } | null,
  provinces: ProvinceFile
): VisibleEntry[] {
  const all = places.map((place, index) => ({ place, index }));
  if (!group) return all;
  const units = new Set(group.unitIds);
  return all.filter(({ place }) => {
    const unit = provinces.cityProvince.get(place.id);
    return unit !== undefined && units.has(unit);
  });
}
