import { ZOOM_FILL, type MapTransform } from "@/lib/mapTransform";
import { MAP_VIEW_H, MAP_VIEW_W } from "./mapShared";
import type { MapPlace } from "./mapTypes";

/**
 * The country level's numbers: stroke widths and ring radii in viewBox units
 * at k = 1, the §5.3.2 tap-target radius and its fallback, the framing floor,
 * and the two per-place helpers that size and label a marker. Moved verbatim
 * out of CountryLevel.tsx on 2026-09-07; every docblock below is that file's,
 * and "every stroke, radius and font divides by k" is still pinned by
 * CountryLevel.markers.test.tsx.
 */

/**
 * Marker geometry, in viewBox units **at `k` = 1** — which is to say, the
 * number each of these is meant to be on screen.
 *
 * Every one of them is written `/ k` at its use site, and that is not
 * decoration. The province zoom magnifies the whole group by `k`, so a
 * constant left undivided is drawn over `k` times as many CSS pixels: at the
 * ceiling of 5 a 0.7-unit province border is a 3.5-pixel one, and the map
 * dissolves into a handful of fat strokes exactly as `MAX_ZOOM_K`'s docblock
 * warns. Dividing here is what makes visual weight scale-invariant, and it is
 * why these are named constants rather than literals scattered through the JSX
 * — a literal is a place a `/ k` can go missing without anyone noticing.
 *
 * `CountryLevel.test.tsx`'s "every stroke, radius and font divides by k" holds
 * the whole set to that ratio by rendering the map twice, so a constant added
 * later without one fails there rather than on someone's screen.
 */
export const UNIT_STROKE = 0.7;
export const OUTLINE_STROKE = 1.2;
export const MARKER_STROKE = 1.2;
export const SELECTION_RING = 3.5;
/**
 * Outside the selection ring rather than on top of it.
 *
 * The two states land on the same marker constantly — a keyboard user selects
 * by focusing and then pressing Enter — and at the same radius the solid
 * `--seal` ring simply paints over the dashed one, which is a focus indicator
 * that vanishes exactly when it is being used. Concentric keeps both readable.
 */
export const FOCUS_RING = SELECTION_RING + 2.5;
export const ROUTE_STROKE = 2;
/**
 * §10.1's airport mark: half the side of the square that is rotated 45° into a
 * diamond, and the weight of its outline.
 *
 * A diamond because every other mark on this map is a circle — a city dot, its
 * selection ring, its focus ring — and an airport is none of those and is not
 * selectable at all. The shape has to carry that on its own, since the layer
 * draws no text: labelling all 502 of the United States' would bury the cities
 * the map exists to choose between, and the one airport a reader can act on is
 * named on the card instead.
 *
 * 2.4 puts the diamond 4.8 units across the flats, against 9 for the smallest
 * city dot's diameter and 16 for a municipality's, so the layer reads as
 * infrastructure underneath the places rather than as a fourth kind of place.
 * Divided by `k` at the use site, like every constant above it.
 */
export const AIRPORT_MARK = 2.4;
export const AIRPORT_STROKE = 1;

/**
 * §10.1's sizes are `ARRIVABLE_AIRPORT_SIZES`, and this file no longer owns
 * them: `mainAirportFor` ranks over the same set, so the code the card prints
 * is always a diamond this layer drew. That used to be two lists on two axes —
 * an allow-list here, a 150 km cut over all three sizes there — and they
 * disagreed both ways. lib/airports.ts carries the decision.
 *
 * What size does NOT decide is how big a mark is. It chooses WHETHER an airport
 * is drawn and nothing else: a two-tier glyph would put a second visual scale
 * beside the city dots', and a reader cannot act on the difference anyway.
 */

/**
 * The smallest extent, in viewBox units, a unit is framed as though it had.
 *
 * Half a unit, and what makes that a measurement rather than a taste is where
 * it lands in the committed geometry. Sorting all 4,525 zoomable groups by the
 * side of the square that fits at the same scale — `ZOOM_FILL · 620 / k` — the
 * bottom of the list reads:
 *
 *     Jarvis 0.095 · Howland 0.095 · Navassa 0.135 · Ashmore 0.174 ·
 *     Wake 0.184 · Palmyra 0.194 · Baker 0.203 · Johnston 0.251 ·
 *     Midway 0.283 · VEN+99? 0.363   ← the floor sits here, at 0.5 →
 *     Pateros 0.536 · Pukapuka 0.540 · Three Kings 0.588 · …
 *
 * Ten groups fall below it and **not one of them has a city assigned to it** —
 * nine uninhabited atolls and one of Venezuela's unnamed remainder units. The
 * smallest group any city is in is GB London at **0.951**, nearly twice the
 * floor. So the ceiling this feeds binds only on geometry no traveller can
 * reach, and every province anyone can plan in gets the fit itself.
 *
 * Below the floor there is nothing left to frame. A polygon under half a
 * viewBox unit across is finer than the coordinate system the map is drawn in,
 * so more magnification magnifies the simplifier's rounding rather than the
 * island.
 */
export const MIN_FRAMED_EXTENT = 0.5;

/**
 * The zoom ceiling for the ADMIN-1 path — 1091.2, against `MAX_ZOOM_K`'s 5.
 *
 * ## Why the two paths differ
 *
 * `MAX_ZOOM_K` was tuned for `ChinaLevel`, and correctly. Its seven groups are
 * several provinces each, and measured against the curated asset they actually
 * render the fits run 1.885 (Northwest) to 3.755 (Central) — so on the real
 * China map the ceiling never fires at all, and 5 is a guard rather than a
 * policy.
 *
 * This level frames ONE admin-1 unit, which is a different regime by two orders
 * of magnitude: over the committed province files, **3,039 of the 4,525
 * zoomable groups (67.2%) fit above 5x.** For them the shared ceiling was not a
 * guard, it was the framing, and it framed badly — Rhode Island covers 0.14% of
 * the viewBox at 5x against 36.3% fitted, Delhi 0.45% against 54.9%, Jakarta
 * 0.16% against 52.5%. "Zoom to this province" left the province a speck in the
 * middle of an empty frame.
 *
 * Nothing that `MAX_ZOOM_K`'s docblock warns about applies here. "The outlines
 * become a handful of fat strokes and the labels outgrow the map" is a fact
 * about lengths that do NOT divide by `k`, and every length in this file does —
 * that is the whole of the discipline the marker constants above describe. A
 * magnified unit is drawn with the same stroke weights, marker radii and font
 * sizes on screen at `k` = 800 as at `k` = 1.
 *
 * ## Why this number
 *
 * Derived from an extent rather than picked as a magnification: it is the scale
 * a square unit of `MIN_FRAMED_EXTENT` viewBox units is fitted at. That puts
 * the number that has to be defended into the map's own units, where it can be
 * checked against the geometry — which is what `MIN_FRAMED_EXTENT` does — and
 * leaves this constant as arithmetic. A ceiling chosen directly in `k` would be
 * a magnification with nothing to measure it against, which is how 5 came to
 * outlive the framing it was chosen for.
 *
 * It remains a real ceiling. `transformForBounds` divides by the bounds' extent
 * and answers `Infinity` for a point, so something finite has to stop it; ten
 * groups in the committed set reach this one.
 */
export const ADMIN1_MAX_ZOOM_K = (ZOOM_FILL * Math.min(MAP_VIEW_W, MAP_VIEW_H)) / MIN_FRAMED_EXTENT;

/** `--tap-min`, in CSS pixels — `app/globals.css`, and WCAG 2.2 AA 2.5.8. */
export const TAP_MIN_PX = 44;

/**
 * `--tap-min` as a marker radius in viewBox units, at a given rendered width
 * (§5.3.2).
 *
 * The SVG is `w-full` over a fixed 860-unit viewBox, so one viewBox unit is
 * `renderedWidth / MAP_VIEW_W` CSS pixels — 1.30px across a 1120px desktop
 * column, 0.45px across a 390px phone. A radius in viewBox units is therefore
 * a different number of pixels on every viewport, and it moves the OPPOSITE
 * way from the viewport: a NARROWER screen stretches the same viewBox over
 * FEWER pixels, each unit is worth less, and the compliant radius is LARGER.
 * 16.9 units on the desktop column; 48.5 on the phone.
 *
 * That inversion is why this is a function of a measured width and not the
 * constant it obviously wants to be. Folding `MAP_MAX_RENDER_W` in and calling
 * the widest layout the worst case reads as the conservative choice and is the
 * exact opposite of one: it yields 44px at 1120 and less at every width below
 * — 30px at 768, 15px at 390 — so it fails 2.5.8 on every phone, i.e. on
 * precisely the devices a minimum tap target exists for. If a later PR is
 * tempted to simplify this back to a constant, that is the arithmetic it has
 * to answer, and `CountryLevel.test.tsx` asserts it at three widths.
 *
 * `renderedWidth` must be positive; `useRenderedWidth` is what guarantees it,
 * by reporting an unmeasurable container as null rather than as 0.
 *
 * `WorldMap`'s docblock converts the same way when it calls its 9-unit hit
 * circle "~22px at desktop" — and reaches the opposite conclusion for the
 * world level, where a compliant circle would swallow San Marino's neighbours
 * outright. At country level the same collision is possible between two
 * cities, so this is a ceiling and `nonOverlappingRadii` is what enforces it.
 * The narrower the screen the harder that cap bites, which is the trade §5.2's
 * list is there to make acceptable.
 *
 * At `k` = 1, for the reason the marker constants above are, and divided by
 * `k` at its use site like every one of them: a magnified map draws the same
 * radius over `k` times as many CSS pixels, so `/ k` is what keeps the target
 * 44px rather than 44k. It is the MEASUREMENT that is divided —
 * `tapTargetRadius(renderedWidth) / k`, never `TAP_MIN_R_FALLBACK / k` —
 * because a zoomed phone needs three times the radius a zoomed desktop does,
 * exactly as an unzoomed one does.
 */
export function tapTargetRadius(renderedWidth: number): number {
  return (TAP_MIN_PX / 2) * (MAP_VIEW_W / renderedWidth);
}

/**
 * The widest the map is ever laid out, in CSS pixels: `/plan`'s `max-w-6xl`
 * (72rem) less its `px-4` gutters, from `app/plan/page.tsx`.
 */
export const MAP_MAX_RENDER_W = 1120;

/**
 * The radius used until a width can be measured: the server render, the first
 * client paint, and jsdom — which lays nothing out and answers 0 to every
 * `getBoundingClientRect`.
 *
 * The widest layout gives the SMALLEST compliant radius, so this is the floor
 * of the honest range rather than a middle guess. An unmeasured frame then
 * draws a target that is merely too small on a phone, for the one commit
 * before the measurement replaces it, instead of one that swallows half the
 * country's cities on a desktop and has to shrink back.
 */
export const TAP_MIN_R_FALLBACK = tapTargetRadius(MAP_MAX_RENDER_W);

/**
 * Where a projected point ends up once the zoom has moved it.
 *
 * The matrix is `translate(tx, ty) scale(k)` about the viewBox origin, so this
 * is three multiplications — unremarkable, except that it is the ONLY way the
 * card can follow its marker. `SelectedPlaceCard` is an HTML sibling of the
 * `<svg>` and positions itself from a percentage of the frame; the transform
 * reaches everything inside `[data-zoom]` and nothing outside it. A card handed
 * the PROJECTED position would sit where its marker was before the zoom, which
 * for the island in the fixture is 4,400 units west of the frame the marker is
 * now centred in — and the card is the only affordance a touch user has for
 * reaching a place at all.
 *
 * A named function rather than two expressions in the JSX because it is the
 * piece a test can hold: jsdom drops the card's `left` declaration, which is
 * wrapped in a `clamp()` it cannot compute, so the x axis has no rendered form
 * to be asserted against and is pinned through this instead.
 */
export function paintedAt(
  point: { x: number; y: number },
  { k, tx, ty }: MapTransform
): { x: number; y: number } {
  return { x: point.x * k + tx, y: point.y * k + ty };
}

/** A place big enough to be worth a name on a country-wide map. */
const LABELLED_PREFECTURE_POPULATION = 3_000_000;

export function labelFor(place: MapPlace): boolean {
  return (
    place.kind === "curated" ||
    place.level === "municipality" ||
    (place.level === "prefecture" && (place.population ?? 0) > LABELLED_PREFECTURE_POPULATION)
  );
}

export function radiusFor(place: MapPlace): number {
  if (place.kind === "curated") return 7;
  if (place.level === "municipality") return 8;
  if (place.level === "prefecture") return 6.5;
  return 4.5;
}
