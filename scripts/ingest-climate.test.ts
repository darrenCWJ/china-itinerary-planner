import { describe, expect, test } from "vitest";
import { decodeSample, pixelFor, tupleFor } from "./ingest-climate.mjs";

/**
 * Covers the three pure functions the real climate build (Task 6) will call
 * once per city per raster. The module's entry-point guard means importing it
 * here does not also run `main()` and start a 6.2 GB download — the idiom
 * `scripts/ingest-cities.test.ts` and `scripts/ingest-airports.test.ts`
 * already rely on.
 *
 * Every grid and scaling constant below is transcribed from
 * `data/climate-probe.md`, which is the measured authority: the probe read
 * these off the real rasters' own tags. They are not reconstructed, because
 * reconstructing them is exactly the bug. `1/120` is not the 1 km grid's
 * resolution, `-180`/`+84` are not its edges, and `clt` is a different raster
 * altogether. Where this file and that document disagree, the document wins.
 */

// ---------------------------------------------------------------------------
// The two grids, as measured
// ---------------------------------------------------------------------------

/**
 * `tasmin`, `tasmax` and `pr`: 43200 x 20880 at ~1 km, latitude stopping at
 * +84. `GTRasterTypeGeoKey` is 1 (PixelIsArea), so the origin is the OUTER
 * EDGE of pixel (0,0) and there is no half-cell correction.
 */
const KM_GRID = {
  width: 43200,
  height: 20880,
  originX: -180.00013888885,
  originY: 83.99986042,
  resX: 0.0083333333,
  resY: 0.0083333333,
};

/**
 * `clt`: a coarser raster on a different origin that does reach both poles.
 * Also PixelIsArea. Its 14,401st column is a full-cell overhang in the west,
 * not a registration difference.
 */
const CLT_GRID = {
  width: 14401,
  height: 7201,
  originX: -180.02485599,
  originY: 89.999928,
  resX: 0.02499999,
  resY: 0.02499999,
};

// ---------------------------------------------------------------------------
// The scalings, as measured — `real = raw * SCALE + OFFSET`, per file
// ---------------------------------------------------------------------------

/** Declared nodata is -2147483647, which a uint16 sample cannot hold. */
const TASMIN_SCALING = { scale: 0.1, offset: -273.15, nodata: -2147483647 };
const PR_SCALING = { scale: 0.1, offset: 0, nodata: -2147483647 };
/** The one file of the four that declares a sentinel a uint16 can carry. */
const CLT_SCALING = { scale: 0.01, offset: 0, nodata: 65535 };

// ---------------------------------------------------------------------------
// Sample fixtures
// ---------------------------------------------------------------------------

type Samples = {
  tasmin: (number | null)[];
  tasmax: (number | null)[];
  pr: (number | null)[];
  clt: (number | null)[];
  hurs: (number | null)[];
};

/** Twelve months of one value, for tests that vary a single thing. */
const months = (value: number | null): (number | null)[] =>
  Array.from({ length: 12 }, () => value);

/** A city that decodes cleanly: nothing null, everything in range. */
const samplesOf = (overrides: Partial<Samples> = {}): Samples => ({
  tasmin: months(10),
  tasmax: months(20),
  pr: months(50),
  clt: months(40),
  hurs: months(70),
  ...overrides,
});

/**
 * `tupleFor` returns `number[] | null` and the null case has its own test, so
 * the rest assert on a narrowed value rather than sprinkling `!` about.
 */
function required(tuple: number[] | null): number[] {
  if (tuple === null) throw new Error("expected a 60-int tuple, got null");
  return tuple;
}

// ---------------------------------------------------------------------------
// pixelFor
// ---------------------------------------------------------------------------

describe("pixelFor", () => {
  test("maps a coordinate to a pixel on CHELSA's grid", () => {
    // 43200 x 20880 over -180..+180 / -90..+84. The latitude band is NOT
    // symmetric — the top is +84 — so the naive (90 - lat) / res mapping is
    // wrong everywhere: it puts the equator on row 10800, where the raster
    // puts it on row 10079. That is 721 rows, 3.5% of the height, every city.
    expect(pixelFor(0, 0, KM_GRID)).toEqual({ x: 21600, y: 10079 });

    // PixelIsArea, so no half-cell correction. The origin corner IS pixel
    // (0,0), and a point six tenths of a cell inside it is still (0,0) — a
    // node-registered reading would round that one up to (1,1).
    expect(pixelFor(KM_GRID.originX, KM_GRID.originY, KM_GRID)).toEqual({ x: 0, y: 0 });
    expect(
      pixelFor(KM_GRID.originX + 0.6 * KM_GRID.resX, KM_GRID.originY - 0.6 * KM_GRID.resY, KM_GRID),
    ).toEqual({ x: 0, y: 0 });
    expect(
      pixelFor(KM_GRID.originX + 1.4 * KM_GRID.resX, KM_GRID.originY - 1.4 * KM_GRID.resY, KM_GRID),
    ).toEqual({ x: 1, y: 1 });

    // The far corner, half a cell inside the raster's own south-east edge.
    const east = KM_GRID.originX + KM_GRID.width * KM_GRID.resX;
    const south = KM_GRID.originY - KM_GRID.height * KM_GRID.resY;
    expect(pixelFor(east - 0.5 * KM_GRID.resX, south + 0.5 * KM_GRID.resY, KM_GRID)).toEqual({
      x: 43199,
      y: 20879,
    });
    // And the round number is off the raster: the eastern edge measures
    // 179.99985967, not 180, so the width bound has to be checked too.
    expect(pixelFor(180, 0, KM_GRID)).toBeNull();

    // `clt` is a different grid, and the same coordinate lands on a different
    // pixel. That is the whole reason this takes a grid rather than reading
    // constants: one transform cannot serve both rasters.
    expect(pixelFor(0, 0, CLT_GRID)).toEqual({ x: 7200, y: 3599 });
  });

  test("returns null for a city outside the covered latitude band", () => {
    // Nothing exists above +84 on the 1 km grid...
    expect(pixelFor(0, 84.5, KM_GRID)).toBeNull();
    // ...but `clt` reaches +90, so the SAME point is a real pixel there.
    expect(pixelFor(0, 84.5, CLT_GRID)).toEqual({ x: 7200, y: 219 });

    // Below the southern edge, both grids refuse.
    expect(pixelFor(0, -90.5, KM_GRID)).toBeNull();
    expect(pixelFor(0, -90.5, CLT_GRID)).toBeNull();

    // The northernmost city the catalog actually holds — Longyearbyen (SJ),
    // 78.22334N 15.64689E — is 5.78 degrees south of the cut, so the band is
    // free but the check must not be so eager it rejects it.
    expect(pixelFor(15.64689, 78.22334, KM_GRID)).toEqual({ x: 23477, y: 693 });
  });
});

// ---------------------------------------------------------------------------
// decodeSample
// ---------------------------------------------------------------------------

describe("decodeSample", () => {
  test("decodes the nodata sentinel as null, not as a temperature", () => {
    // 65535 scaled by 0.01 is 655.35% cloud, and Number.isFinite accepts it,
    // so nothing downstream would catch the sentinel by itself.
    expect(Number.isFinite(65535 * 0.01)).toBe(true);
    expect(decodeSample(65535, CLT_SCALING)).toBeNull();

    // But the sentinel is a property of the FILE, not a constant. `tasmin`
    // declares -2147483647, which a uint16 sample cannot hold, so under its
    // scaling that very same raw value is data — absurd data, but not
    // absence, and inventing an absence the file never declared would drop a
    // city for no reason.
    expect(decodeSample(65535, TASMIN_SCALING)).toBeCloseTo(6280.35, 10);
    // A neighbouring value on the file that does declare 65535 is still data.
    expect(decodeSample(65534, CLT_SCALING)).toBeCloseTo(655.34, 10);
  });

  test("applies the scale factor the probe measured, not an assumed one", () => {
    // Singapore's January `tasmin` is raw 2980. The scale alone gives 298 C.
    // Only `raw * SCALE + OFFSET`, with the file's own -273.15, gives a
    // January a traveller would recognise — and spec 9.1 states the scale and
    // omits the offset entirely.
    expect(decodeSample(2980, TASMIN_SCALING)).toBeCloseTo(24.85, 10);
    expect(decodeSample(2980, TASMIN_SCALING)).not.toBeCloseTo(298, 10);
    // Moscow, the same file, below zero.
    expect(decodeSample(2630, TASMIN_SCALING)).toBeCloseTo(-10.15, 10);
    // Singapore again: 232.7 mm of rain and 61.61% cloud, on two more
    // scalings that are neither each other's nor tasmin's.
    expect(decodeSample(2327, PR_SCALING)).toBeCloseTo(232.7, 10);
    expect(decodeSample(6161, CLT_SCALING)).toBeCloseTo(61.61, 10);

    // Unrounded on the way out. `tupleFor` rounds; the dew point needs the
    // fraction that rounding here would have thrown away.
    expect(Number.isInteger(decodeSample(2980, TASMIN_SCALING))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tupleFor
// ---------------------------------------------------------------------------

describe("tupleFor", () => {
  test("rounds to integers, because the artifact is a positional int tuple", () => {
    const tuple = required(
      tupleFor(
        samplesOf({
          tasmin: months(24.85),
          tasmax: months(24.85),
          pr: months(232.7),
          clt: months(61.61),
          hurs: months(60),
        }),
      ),
    );
    expect(tuple).toHaveLength(60);
    expect(tuple.every(Number.isInteger)).toBe(true);
    expect(tuple[0]).toBe(25);
    expect(tuple[24]).toBe(233);
    expect(tuple[36]).toBe(62);

    // -0 is an integer and JSON.stringify writes it as "0", but it is not 0 to
    // Object.is, so a tuple carrying it is not the tuple it prints as. Any
    // month between -0.5 and 0 C lands there, which is a great many towns in
    // a great many Marches.
    const freezing = required(
      tupleFor(samplesOf({ tasmin: months(-0.35), tasmax: months(-0.35) })),
    );
    expect(Object.is(freezing[0], -0)).toBe(false);
    expect(freezing[0]).toBe(0);
  });

  test("orders the tuple lo, hi, precip, cloud, dew point with January at index 0", () => {
    // Calendar-indexed everywhere. `seasonIn` is never applied to this index —
    // `tupleFor` takes no country and no hemisphere, so a flip is structurally
    // impossible and January is index 0 in every one of the five blocks.
    //
    // The markers sit in disjoint ranges on purpose, so a transposed or
    // block-swapped implementation cannot pass by coincidence.
    const marker = (base: number): (number | null)[] =>
      Array.from({ length: 12 }, (_, m) => base + m);
    const tuple = required(
      tupleFor({
        tasmin: marker(0),
        tasmax: marker(100),
        pr: marker(200),
        clt: marker(300),
        hurs: marker(50),
      }),
    );

    expect(tuple).toHaveLength(60);
    expect(tuple.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(tuple.slice(12, 24)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
    expect(tuple.slice(24, 36)).toEqual([200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211]);
    expect(tuple.slice(36, 48)).toEqual([300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311]);

    // The fifth block is the derived dew point — twelve distinct values, not
    // one repeated. Both T and RH climb across these markers, so td must too.
    const dewPoints = tuple.slice(48, 60);
    expect(dewPoints).toHaveLength(12);
    for (let m = 1; m < 12; m += 1) {
      expect(dewPoints[m]).toBeGreaterThan(dewPoints[m - 1]);
    }
  });

  test("derives the dew point from the standard Magnus form", () => {
    const dewPointFor = (t: number, rh: number): number =>
      required(tupleFor(samplesOf({ tasmin: months(t), tasmax: months(t), hurs: months(rh) })))[48];

    // The textbook pin: 25 C at 60% RH is 16.698 C, which rounds to 17.
    expect(dewPointFor(25, 60)).toBe(17);
    // 20 C at 50% is 9.26 C. The rule of thumb T - (100 - RH) / 5 gives 10
    // here, so this is what separates Magnus from the approximation.
    expect(dewPointFor(20, 50)).toBe(9);
    // At saturation the dew point IS the temperature, for any b and c — the
    // structural identity, which a mis-transcribed formula breaks.
    expect(dewPointFor(25, 100)).toBe(25);
    expect(dewPointFor(-10, 100)).toBe(-10);

    // And it is taken on the mean of lo and hi, not on either end.
    const fromMean = required(
      tupleFor(samplesOf({ tasmin: months(20), tasmax: months(30), hurs: months(60) })),
    )[48];
    expect(fromMean).toBe(dewPointFor(25, 60));
  });

  test("returns null for the whole city when any month is missing", () => {
    // The artifact is 60 positional ints with no per-month absence marker, so
    // there is no way to write "March has no cloud". A city that cannot be
    // sampled completely is not written at all. The probe found 0 of 58,757
    // cities on nodata, so this should never fire — but that is a property of
    // this CHELSA release, not of the format.
    expect(tupleFor(samplesOf())).not.toBeNull();
    for (const field of ["tasmin", "tasmax", "pr", "clt", "hurs"] as const) {
      const holed = samplesOf();
      holed[field] = holed[field].map((value, m) => (m === 2 ? null : value));
      expect(tupleFor(holed)).toBeNull();
    }
  });

  test("refuses a sample set that is not twelve months, rather than writing a short tuple", () => {
    // A short array is a bug in the caller, not a gap in the data, and the two
    // must not be conflated: returning null would drop a city silently, and
    // writing a 58-int tuple would corrupt every index after it.
    expect(() => tupleFor(samplesOf({ pr: months(50).slice(0, 11) }))).toThrow(/12 months/);
    expect(() => tupleFor(samplesOf({ hurs: [...months(70), 70] }))).toThrow(/12 months/);
  });
});
