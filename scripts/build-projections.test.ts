import { geoArea } from "d3-geo";
import { describe, expect, test } from "vitest";
import { MAP_VIEW_H, MAP_VIEW_W } from "@/lib/mapView";
import {
  EXPECTED_COUNTRIES,
  assertManifest,
  bestTrim,
  boxOf,
  measureCountry,
  polygonsOf,
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

describe("polygonsOf", () => {
  test("unwraps a MultiPolygon into its polygons", () => {
    const polygons = polygonsOf({ type: "MultiPolygon", coordinates: [sq(0, 0), sq(5, 5)] });
    expect(polygons).toHaveLength(2);
    expect(polygons[1]).toEqual(sq(5, 5));
  });

  test("wraps a lone Polygon rather than reading its rings as polygons", () => {
    // The trap: a Polygon's `coordinates` are RINGS. Passing them through
    // makes a country with one landmass and one lake look like two polygons,
    // and the lake becomes a trim candidate with its own centroid.
    const withHole = [sq(0, 0, 10)[0], sq(4, 4)[0]];
    expect(polygonsOf({ type: "Polygon", coordinates: withHole })).toEqual([withHole]);
  });
});

describe("bestTrim — the three gates §5.4 states but never applies", () => {
  type Step = {
    dropped: number[];
    hidden: number;
    gain: number;
    sep: number;
    scale: number;
    union: { x0: number; x1: number; y0: number; y1: number };
  };

  /** One trajectory step, with every gate passing unless a test says otherwise. */
  const step = (over: Partial<Step> = {}): Step => ({
    dropped: [1],
    hidden: 0.001,
    gain: 2,
    sep: 1,
    scale: 1000,
    union: { x0: 0, x1: 1, y0: 0, y1: 1 },
    ...over,
  });

  test("takes the best point on the whole trajectory, not the first that passes", () => {
    // NL's three Caribbean polygons each gain ~1.1x alone and 11.5x together,
    // so a caller that stopped at the first passing step loses the answer.
    const best = bestTrim([
      step({ gain: 1.6 }),
      step({ gain: 11.5, dropped: [1, 2, 3] }),
      step({ gain: 2 }),
    ]);
    expect(best?.gain).toBe(11.5);
    expect(best?.dropped).toEqual([1, 2, 3]);
  });

  test("refuses a trim that hides more than 1% of the country — Gate A", () => {
    expect(bestTrim([step({ hidden: 0.0101 })])).toBeNull();
    expect(bestTrim([step({ hidden: 0.01 })])).not.toBeNull();
  });

  test("refuses a polygon sitting close to the anchor — Gate B", () => {
    // Tasmania and Stewart Island are the two cases §5.4 says the gate is for.
    expect(bestTrim([step({ sep: 0.49 })])).toBeNull();
    expect(bestTrim([step({ sep: 0.5 })])).not.toBeNull();
  });

  test("refuses a trim that is not worth 1.5x — Gate C", () => {
    expect(bestTrim([step({ gain: 1.49 })])).toBeNull();
    expect(bestTrim([step({ gain: 1.5 })])).not.toBeNull();
  });

  test("is null for an empty trajectory, so a one-polygon country needs no case", () => {
    expect(bestTrim([])).toBeNull();
  });
});

describe("measureCountry", () => {
  test("omits hiddenAreaPct entirely when nothing is trimmed", () => {
    const { entry, trim } = measureCountry([sq(0, 0, 10)], BOX);
    expect(trim).toBeNull();
    expect(entry).not.toHaveProperty("hiddenAreaPct");
    expect(entry.rotate).toBe(0);
    expect(entry.bounds).toEqual([[0, 0], [10, 10]]);
    expect(entry.scale).toBeCloseTo(scaleOf({ x0: 0, x1: 10, y0: 0, y1: 10 }, 0, BOX), 3);
  });

  test("carries hiddenAreaPct as a PERCENT when a trim is applied", () => {
    // Gate A is 1% of the area; the field is 100x that, so a reader who
    // compares the field against 0.01 rejects every country that passed.
    const { entry, trim } = measureCountry(
      [sq(0, 0, 10), sq(80, 0, 0.3), sq(0, 70, 0.3)],
      BOX,
    );
    expect(trim).not.toBeNull();
    expect(entry.bounds).toEqual([[0, 0], [10, 10]]);
    expect(entry.hiddenAreaPct).toBeGreaterThan(0);
    expect(entry.hiddenAreaPct).toBeLessThan(1);
    expect(entry.scale).toBeGreaterThan(
      measureCountry([sq(0, 0, 10), sq(80, 0, 0.3)], BOX).baseScale,
    );
  });

  test("keeps an outlier that costs more than 1% of the area", () => {
    // Gate A is a ceiling, not a preference. A 2-degree island 80 degrees off
    // a 10-degree country is 3.9% of it, and the country is carried untrimmed
    // rather than trimmed anyway — even though the trim would gain 8x.
    const { entry, trim } = measureCountry([sq(0, 0, 10), sq(80, 0, 2)], BOX);
    expect(trim).toBeNull();
    expect(entry).not.toHaveProperty("hiddenAreaPct");
    expect(entry.bounds).toEqual([[0, 0], [82, 10]]);
  });

  test("reports bounds in the ROTATED frame, so an antimeridian span stays narrow", () => {
    const { entry } = measureCountry([sq(178, -18), sq(-179, -18)], BOX);
    expect(entry.rotate).toBeLessThan(0);
    expect(entry.bounds[1][0] - entry.bounds[0][0]).toBeLessThan(10);
  });

  test("rounds every number, because 246 unrounded entries are not 20 KB", () => {
    const { entry } = measureCountry([sq(0.123456, 0.123456, 10)], BOX);
    expect(entry.bounds[0][0]).toBe(0.1235);
    for (const n of [entry.rotate, entry.scale, ...entry.bounds.flat()]) {
      expect((String(n).split(".")[1] ?? "").length).toBeLessThanOrEqual(4);
    }
  });
});

describe("assertManifest", () => {
  const full = () =>
    Object.fromEntries(
      Array.from({ length: EXPECTED_COUNTRIES }, (_, i) => [
        `X${i}`,
        { rotate: 0, bounds: [[0, 0], [1, 1]], scale: 100 },
      ]),
    );

  test("accepts a manifest with one entry per committed province file", () => {
    expect(() => assertManifest(full())).not.toThrow();
  });

  test("aborts on a short manifest, naming the count it actually got", () => {
    const short = full();
    delete short.X0;
    expect(() => assertManifest(short)).toThrow(/245/);
  });

  test("aborts on a scale that is not finite and positive, naming the country", () => {
    const infinite = full();
    infinite.X7 = { ...infinite.X7, scale: Infinity };
    expect(() => assertManifest(infinite)).toThrow(/X7/);
    const zero = full();
    zero.X9 = { ...zero.X9, scale: 0 };
    expect(() => assertManifest(zero)).toThrow(/X9/);
  });

  test("aborts on inverted bounds, which fitExtent would accept in silence", () => {
    const inverted = full();
    inverted.X3 = { ...inverted.X3, bounds: [[1, 1], [0, 0]] };
    expect(() => assertManifest(inverted)).toThrow(/X3/);
  });
});
