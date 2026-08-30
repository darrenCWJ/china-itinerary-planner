import type { RefObject } from "react";
import { describe, expect, test, vi } from "vitest";
import { geoPath } from "d3-geo";
import * as mapTransform from "@/lib/mapTransform";
import type { PixelBounds } from "@/lib/mapTransform";
import {
  createHoverReporter,
  transformForFeatures,
  MAP_VIEW_H,
  MAP_VIEW_W,
  type HoverPos,
} from "./mapShared";

/**
 * `createHoverReporter`'s only behavioural coverage used to be an incidental
 * assertion inside `WorldMap.test.tsx`'s hover test — and even that ran
 * against a jsdom container sitting at (0, 0), so the container-relative
 * subtraction was never actually exercised (subtracting zero is a no-op).
 * Task 38 deleted that test along with the dead `WorldMap.onHoverCountry`
 * prop it exercised, leaving the offset maths with no coverage at all.
 *
 * These tests unit-test the reporter directly against a non-origin container
 * rect, so the subtraction itself is what's asserted.
 */

/** A containerRef whose element reports the given rect, or no element at all. */
function refWithRect(rect: { left: number; top: number } | null): RefObject<HTMLElement | null> {
  if (!rect) return { current: null };
  return {
    current: {
      getBoundingClientRect: () => ({
        left: rect.left,
        top: rect.top,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: rect.left,
        y: rect.top,
        toJSON() {
          return this;
        },
      }),
    } as unknown as HTMLElement,
  };
}

describe("createHoverReporter", () => {
  test("reports the pointer position relative to the container's top-left", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect({ left: 40, top: 20 }), onHover);

    report("FR", { clientX: 120, clientY: 90 });

    expect(onHover).toHaveBeenCalledWith("FR", { x: 80, y: 70 });
  });

  test("clears hover when called with no item", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect({ left: 40, top: 20 }), onHover);

    report(null, { clientX: 120, clientY: 90 });

    expect(onHover).toHaveBeenCalledWith(null, null);
  });

  test("clears hover when called with no event", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect({ left: 40, top: 20 }), onHover);

    report("FR");

    expect(onHover).toHaveBeenCalledWith(null, null);
  });

  test("reports nothing when the container has not mounted", () => {
    const onHover = vi.fn<(item: string | null, pos: HoverPos | null) => void>();
    const report = createHoverReporter<string>(refWithRect(null), onHover);

    report("FR", { clientX: 120, clientY: 90 });

    expect(onHover).not.toHaveBeenCalled();
  });
});

/**
 * `transformForFeatures` is the ONLY caller of `lib/mapTransform`'s
 * `transformForBounds` in the whole app, which is why spec §6.2's guard against
 * degenerate bounds belongs here rather than there. `transformForBounds`'s own
 * docblock refuses the guard deliberately — inventing a fallback inside the
 * maths would hide the caller's bug — and these tests pin both halves of that
 * arrangement: the caller stops handing it nothing, and the maths stays bare.
 *
 * The hazard is narrower than §6.2 states, and the numbers below are what
 * narrows it. A group whose filter matched NOTHING is the only input with no
 * defined answer; a single point, which §6.2 names as the danger, divides by
 * zero and comes out finite and sane because the ceiling catches it.
 */

const { IDENTITY_TRANSFORM, MAX_ZOOM_K, ZOOM_FILL, transformForBounds } = mapTransform;

/** No projection: the coordinates below ARE viewBox pixels, so bounds are hand-computable. */
const planar = geoPath(null);

type Unit = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;

/** One admin-1 unit, as an axis-aligned square in viewBox pixels. */
function square(x: number, y: number, size: number): Unit {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ],
    },
  };
}

/** A unit that IS in the group and still draws nothing — a ringless polygon. */
const UNDRAWABLE: Unit = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [] },
};

describe("transformForFeatures — §6.2's guard, at the call site", () => {
  test("zooming to a group whose units have no drawable feature stays unzoomed", () => {
    // The real hazard, and it is NOT zero extent: a filter that matched
    // nothing, and a unit that is present but contributes no geometry.
    expect(transformForFeatures(planar, [])).toBe(IDENTITY_TRANSFORM);
    expect(transformForFeatures(planar, [UNDRAWABLE])).toBe(IDENTITY_TRANSFORM);

    // What the guard stands in front of. d3 answers an empty collection with
    // [[∞, ∞], [−∞, −∞]], and the unguarded maths turns that into scale(−0) at
    // translate(NaN, NaN) — an SVG group that draws nothing anywhere.
    const nothing = planar.bounds({ type: "FeatureCollection", features: [] }) as PixelBounds;
    const unguarded = transformForBounds(nothing, MAP_VIEW_W, MAP_VIEW_H);
    expect(Number.isFinite(unguarded.tx)).toBe(false);
    expect(Number.isFinite(unguarded.ty)).toBe(false);
  });

  test("zooming to a group with exactly one unit pins to MAX_ZOOM_K", () => {
    // A single province has non-zero extent, so it never divides by zero — it
    // reaches the ceiling through the ordinary branch that
    // `mapTransform.test.ts` already pins with these very numbers. The guard
    // must not swallow it.
    const t = transformForFeatures(planar, [square(400, 300, 4)]);

    expect(t).not.toBe(IDENTITY_TRANSFORM);
    expect(t.k).toBe(MAX_ZOOM_K);
    expect(t.tx).toBeCloseTo(-1580, 8); // 430 − 5·804/2
    expect(t.ty).toBeCloseTo(-1200, 8); // 310 − 5·604/2
  });

  test("a single point divides by zero and still comes out finite, so it is not guarded", () => {
    // §6.2 calls this the degenerate case. Reproduced at the real 860 × 620
    // viewBox it is not one: 860/0 and 620/0 are both ∞, ZOOM_FILL · ∞ is ∞,
    // and MAX_ZOOM_K clamps it to exactly the k a 4px unit gets. Guarding zero
    // extent would send a legitimately tiny unit back to identity instead.
    const point: Unit = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [400, 300] },
    };

    const t = transformForFeatures(planar, [point]);

    expect(t).not.toBe(IDENTITY_TRANSFORM);
    expect(t.k).toBe(MAX_ZOOM_K);
    expect(t.tx).toBeCloseTo(-1570, 8); // 430 − 5·800/2
    expect(t.ty).toBeCloseTo(-1190, 8); // 310 − 5·600/2
  });

  test("lib/mapTransform.ts still answers exactly as it did, and still bare", () => {
    // Belt and braces. The guard belongs at the call site and the docblock at
    // the top of `transformForBounds` explains why, so the way this could still
    // go wrong is by quietly moving the guard down into the maths — where a
    // second caller would inherit a fallback instead of a visible bug.
    //
    // This test USED to be called "lib/mapTransform.ts is not modified by this
    // plan", and the plan did modify it: the province-zoom fix gave
    // `transformForBounds` a defaulted `maxK`, because the ceiling is a fact
    // about what is being framed and the maths cannot see which. What the file
    // must not do is change its ANSWER, so that is what is pinned now — the
    // exported surface, the default, and the bareness — rather than a byte
    // count that would have blocked a change the arithmetic is indifferent to.
    expect(Object.keys(mapTransform).sort()).toEqual([
      "IDENTITY_TRANSFORM",
      "MAX_ZOOM_K",
      "ZOOM_FILL",
      "transformForBounds",
    ]);
    // Three REQUIRED parameters, so no caller has to know about the fourth and
    // no call site can be broken by its arrival.
    expect(transformForBounds.length).toBe(3);
    expect(IDENTITY_TRANSFORM).toEqual({ k: 1, tx: 0, ty: 0 });
    expect(Object.isFrozen(IDENTITY_TRANSFORM)).toBe(true);
    expect(MAX_ZOOM_K).toBe(5);
    expect(ZOOM_FILL).toBe(0.88);

    // The default IS `MAX_ZOOM_K`, on a region small enough for the ceiling to
    // be the thing answering — which is what makes this a test of the default
    // rather than of two ways to spell the same fit. `ChinaLevel` takes this
    // branch, and `chinaBaseline.test.tsx` pins the markup it produces.
    const tiny: PixelBounds = [
      [400, 300],
      [404, 304],
    ];
    expect(transformForBounds(tiny, MAP_VIEW_W, MAP_VIEW_H)).toEqual(
      transformForBounds(tiny, MAP_VIEW_W, MAP_VIEW_H, MAX_ZOOM_K)
    );
    expect(transformForBounds(tiny, MAP_VIEW_W, MAP_VIEW_H).k).toBe(MAX_ZOOM_K);

    // And a caller that passes a higher one gets the fit instead of the clamp,
    // which is the whole of what the parameter buys.
    expect(transformForBounds(tiny, MAP_VIEW_W, MAP_VIEW_H, 1000).k).toBeCloseTo(
      (ZOOM_FILL * MAP_VIEW_H) / 4,
      10
    );

    // Still bare: handed the bounds of nothing, it still answers NaN — at the
    // default ceiling and at any other.
    const bare = transformForBounds(
      [
        [Infinity, Infinity],
        [-Infinity, -Infinity],
      ],
      MAP_VIEW_W,
      MAP_VIEW_H
    );
    expect(Number.isNaN(bare.tx)).toBe(true);
    expect(Number.isNaN(bare.ty)).toBe(true);
  });

  test("the ceiling a caller passes is the one it gets", () => {
    // `transformForFeatures` is the app's only door into the maths, so the
    // parameter has to survive the trip — a passthrough that dropped it would
    // leave `CountryLevel` silently back on `MAX_ZOOM_K`, which is exactly the
    // defect, and every OTHER assertion about the zoom would still pass.
    const unit = [square(400, 300, 4)];

    expect(transformForFeatures(planar, unit).k).toBe(MAX_ZOOM_K);
    expect(transformForFeatures(planar, unit, 50).k).toBe(50);
    // Below the fit the caller's ceiling binds; above it the fit does, and the
    // ceiling stops being visible at all.
    expect(transformForFeatures(planar, unit, 1000).k).toBeCloseTo(
      (ZOOM_FILL * MAP_VIEW_H) / 4,
      10
    );
    // The guard still runs first: a ceiling cannot revive an empty group.
    expect(transformForFeatures(planar, [], 1000)).toBe(IDENTITY_TRANSFORM);
  });
});
