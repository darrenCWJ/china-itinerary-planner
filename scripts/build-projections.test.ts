import { geoArea } from "d3-geo";
import { describe, expect, test } from "vitest";
import { MAP_VIEW_H, MAP_VIEW_W } from "@/lib/mapView";
import {
  boxOf,
  rotationFor,
  scaleOf,
  separation,
  trimTrajectory,
  unionOf,
} from "./build-projections.mjs";

const BOX: [[number, number], [number, number]] = [[0, 0], [MAP_VIEW_W, MAP_VIEW_H]];

/**
 * A closed square ring, as one polygon — wound the way d3-geo reads a sphere.
 *
 * The winding is not cosmetic and it is the same trap §5.5 names for the fit
 * rectangle. `[[x,y],[x+w,y],[x+w,y+w],[x,y+w]]` — the obvious order, and the
 * one this plan first wrote — makes d3-geo read the ring as THE GLOBE MINUS
 * THE SQUARE: `geoBounds` on a 10° square returns `[[-180,-90],[180,90]]`,
 * `geoArea` returns 12.54 sr of a 12.57 sr sphere, and `geoCentroid` lands on
 * the far side of the planet. Every `separation` assertion below would then be
 * measuring the complement rather than the square.
 *
 * This order is the one `merge()` actually produces: checked against the
 * committed `public/provinces/ZA.json`, whose mainland polygon reports bounds
 * `[[16.47,-34.82],[32.89,-22.13]]` and area 3.008e-2 sr.
 */
const sq = (x: number, y: number, w = 1) =>
  [[[x, y], [x, y + w], [x + w, y + w], [x + w, y], [x, y]]];

describe("rotationFor", () => {
  test("is zero when the country does not cross the antimeridian", () => {
    expect(rotationFor([sq(10, 10)])).toBe(0);
  });

  test("centres a country that straddles ±180", () => {
    // Fiji really does span the antimeridian; without a rotation its bounds
    // read as a ~357° span instead of a ~3° one and the fit collapses.
    const l = rotationFor([sq(178, -18), sq(-179, -18)]);
    expect(l).toBeLessThan(0);
    expect(Math.abs(l)).toBeGreaterThan(170);
  });

  test("normalises the rotated longitude back into ±180", () => {
    // The bug this pins: rotating by -178 sends lon -179 to -357, not to +3.
    const l = rotationFor([sq(178, -18), sq(-179, -18)]);
    const b = unionOf([boxOf(sq(178, -18), l), boxOf(sq(-179, -18), l)], [0, 1]);
    expect(b.x1 - b.x0).toBeLessThan(10);
  });
});

describe("scaleOf", () => {
  test("uses the app's real viewport, not a rounded one", () => {
    // The spec's committed manifest was computed against 860x600 and the app
    // renders into 860x620 (lib/mapView.ts). Reproducing the spec's published
    // ZA scale of 2383.2504 requires the 600; this must not.
    const u = { x0: 16.4468, x1: 32.8845, y0: -34.7854, y1: -22.1456 };
    expect(scaleOf(u, 0, BOX)).toBeCloseTo(2462.6921, 3);
    expect(scaleOf(u, 0, [[0, 0], [860, 600]])).toBeCloseTo(2383.2504, 3);
  });

  test("does not collapse the way a Polygon rectangle would", () => {
    // §5.5: d3-geo reads rings spherically, so a clockwise rect is the globe
    // MINUS the rect and every fit collapses to about height/(2π).
    const u = { x0: 0, x1: 10, y0: 0, y1: 10 };
    expect(scaleOf(u, 0, BOX)).toBeGreaterThan(1000);
  });
});

describe("separation — Gate B", () => {
  test("is scale-free, so 0.5 means the same for a large country and a small one", () => {
    // The spec gives no formula and no unit. Raw radians cannot be it: Prince
    // Edward Is. is 0.356 rad from South Africa and the spec ACCEPTS it.
    const anchor = sq(0, 0, 10);
    const near = sq(11, 4.5);    // just off the middle of a 10°-wide anchor's edge
    const far = sq(40, 40);
    expect(separation(anchor, near)).toBeLessThan(0.5);
    expect(separation(anchor, far)).toBeGreaterThan(0.5);
  });

  test("an anchor with no extent does not divide by zero", () => {
    expect(separation([[[0, 0], [0, 0], [0, 0]]], sq(10, 10))).toBe(Infinity);
  });
});

describe("trimTrajectory", () => {
  /** One big anchor with two far-flung specks, the shape every trim case has. */
  const scattered = () => [sq(0, 0, 10), sq(80, 0), sq(0, 70)];

  test("never offers the anchor as a candidate", () => {
    // Dropping the anchor maximises scale trivially, and ZA-without-South-
    // Africa is Prince Edward Island at a 146x "gain".
    const steps = trimTrajectory(scattered(), 0, 0, BOX);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.dropped).not.toContain(0);
    }
  });

  test("returns the whole trajectory, not the first improving step", () => {
    // NL's three Caribbean polygons each gain ~1.1x alone and 11.5x together,
    // so a caller that stopped at step 1 would lose the answer entirely.
    const steps = trimTrajectory(scattered(), 0, 0, BOX);
    expect(steps).toHaveLength(2);
    expect(steps[0].dropped).toHaveLength(1);
    expect(new Set(steps[1].dropped)).toEqual(new Set([1, 2]));
    expect(steps[1].gain).toBeGreaterThan(steps[0].gain);
  });

  test("reports the union it stopped at, so the caller need not recompute it", () => {
    const steps = trimTrajectory(scattered(), 0, 0, BOX);
    const last = steps[steps.length - 1];
    expect(last.union).toEqual({ x0: 0, x1: 10, y0: 0, y1: 10 });
    expect(last.scale).toBeCloseTo(scaleOf(last.union, 0, BOX), 6);
  });

  test("measures hidden area as a fraction of the country, not in steradians", () => {
    // Gate A is "<= 1% of the country's area", so the units matter: a
    // steradian figure would compare a country against the whole sphere and
    // pass every gate it was ever shown.
    const polygons = scattered();
    const area = (p: number[][][]) => geoArea({ type: "Polygon", coordinates: p });
    const areas = polygons.map(area);
    const steps = trimTrajectory(polygons, 0, 0, BOX);
    const last = steps[steps.length - 1];
    expect(last.hidden).toBeCloseTo(
      (areas[1] + areas[2]) / (areas[0] + areas[1] + areas[2]),
      12,
    );
    expect(last.hidden).toBeLessThan(1);
  });
});
