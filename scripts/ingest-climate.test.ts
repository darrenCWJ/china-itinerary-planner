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

  test("returns null for a coordinate that is not a number", () => {
    // Every comparison against NaN is false, so a NaN coordinate passes BOTH
    // range checks and yields {x: NaN, y: NaN} — a pixel that is not a pixel,
    // which then reads `undefined` out of the raster and turns into a `null`
    // in the middle of an int tuple. The range check cannot catch this; only
    // asking whether the index is an index can.
    expect(pixelFor(Number.NaN, 0, KM_GRID)).toBeNull();
    expect(pixelFor(0, Number.NaN, KM_GRID)).toBeNull();
    expect(pixelFor(Number.POSITIVE_INFINITY, 0, KM_GRID)).toBeNull();
    expect(pixelFor(0, Number.NEGATIVE_INFINITY, KM_GRID)).toBeNull();
  });

  test("refuses a grid whose resolution is not positive, rather than nulling every city", () => {
    // geotiff's getResolution() reports resY NEGATIVE for a north-up raster
    // (see the Grid typedef in the module) and nothing enforces the sign
    // before it reaches here. A sign-flipped resY does not fail loudly: the
    // division below still produces a number for every coordinate, so it
    // would silently return null for every city south of the origin — the
    // whole catalog — while every downstream shape and budget gate kept
    // passing. That is a caller bug, the same category `tupleFor` throws on
    // for a wrong-length column, not a coordinate genuinely off the raster
    // (that case is covered above, by `pixelFor(180, 0, KM_GRID)` returning
    // null, and is not repeated here).
    expect(() => pixelFor(0, 0, { ...KM_GRID, resY: -KM_GRID.resY })).toThrow(/resY/);
    expect(() => pixelFor(0, 0, { ...KM_GRID, resX: 0 })).toThrow(/resX/);
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

  test("returns null for the whole city when any month is missing or unusable", () => {
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

    // A value that is not finite is just as unwritable as a null, and quieter
    // about it: NaN and Infinity are what Math.round returns for themselves,
    // and JSON.stringify writes both as `null` — a null inside a positional
    // int tuple, which nothing downstream would flag.
    expect(JSON.stringify([1, Number.NaN, 3])).toBe("[1,null,3]");
    expect(tupleFor(samplesOf({ pr: months(Number.NaN) }))).toBeNull();
    expect(tupleFor(samplesOf({ clt: months(Number.POSITIVE_INFINITY) }))).toBeNull();

    // And the dew point is derived, so finite inputs are not enough: humidity
    // at exactly 0 sends Math.log to -Infinity and the whole expression to
    // NaN. `hurs` was never sampled, so its real range is not yet known.
    expect(tupleFor(samplesOf({ hurs: months(0) }))).toBeNull();
    expect(tupleFor(samplesOf({ hurs: months(1) }))).not.toBeNull();
  });

  test("refuses a sample set that is not twelve months, rather than writing a short tuple", () => {
    // A short array is a bug in the caller, not a gap in the data, and the two
    // must not be conflated: returning null would drop a city silently, and
    // writing a 58-int tuple would corrupt every index after it.
    expect(() => tupleFor(samplesOf({ pr: months(50).slice(0, 11) }))).toThrow(/12 months/);
    expect(() => tupleFor(samplesOf({ hurs: [...months(70), 70] }))).toThrow(/12 months/);
  });
});

// ---------------------------------------------------------------------------
// The build half
// ---------------------------------------------------------------------------

import {
  assembleRows,
  assertBudget,
  assertCityParity,
  assertRowShape,
  assertSampleHealth,
  assertShardCoverage,
  bucketByRow,
  climatePayload,
  ensureRaster,
  indexPayload,
  measuredRanges,
  readScaling,
} from "./ingest-climate.mjs";
import { GZIP_BUDGET, RAW_TRIPWIRE } from "./build-provinces.mjs";

describe("bucketByRow", () => {
  /** Three cities that share row 0, plus one on the equator. */
  const cities = [
    { id: "G1", lat: KM_GRID.originY - 0.5 * KM_GRID.resY, lon: KM_GRID.originX + 0.5 * KM_GRID.resX },
    { id: "G2", lat: 0, lon: 0 },
    { id: "G3", lat: KM_GRID.originY - 0.5 * KM_GRID.resY, lon: KM_GRID.originX + 10.5 * KM_GRID.resX },
    { id: "G4", lat: KM_GRID.originY - 0.5 * KM_GRID.resY, lon: KM_GRID.originX + 3.5 * KM_GRID.resX },
  ];

  test("groups every city by the row it lands on, not by the city", () => {
    // The row is the unit because these rasters are stripped with
    // RowsPerStrip 1 — not the 512x512 COG tiles spec 9.1 describes. A
    // city-by-city read would decode the same dense rows hundreds of times;
    // one read per touched row decodes each exactly once.
    const { rows, byRow } = bucketByRow(cities, KM_GRID);
    expect(rows).toEqual([0, 10079]);
    expect(byRow.get(0)!.map((e) => e.i)).toEqual([0, 2, 3]);
    expect(byRow.get(0)!.map((e) => e.x)).toEqual([0, 10, 3]);
    expect(byRow.get(10079)!).toEqual([{ i: 1, x: 21600 }]);
  });

  test("returns the rows ascending, so the reads walk the file forwards", () => {
    // Insertion order here is row 0, 10079, 0, 0 — so a Map's own iteration
    // order is not sorted and this has to sort explicitly. Unsorted, the
    // reads would seek back and forth across 115 MB.
    const { rows } = bucketByRow(cities, KM_GRID);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  test("collects cities off the raster rather than throwing on the first", () => {
    // "Off the raster" is a property of the catalog, so it belongs in a gate
    // with a count beside it: the build fails on the total and the operator
    // sees how many. The probe found 0 of 58,757 outside either grid, but +84
    // is a real edge on the 1 km grid and the catalog grows.
    const arctic = [{ id: "G5", lat: 88, lon: 0 }, { id: "G6", lat: 0, lon: 0 }];
    const km = bucketByRow(arctic, KM_GRID);
    expect(km.offRaster).toEqual([0]);
    expect(km.rows).toEqual([10079]);

    // The same city is ON `clt`, which reaches the pole. Two grids, two
    // answers — which is why the buckets are computed once per VARIABLE and
    // not once for the run.
    expect(bucketByRow(arctic, CLT_GRID).offRaster).toEqual([]);
  });
});

describe("assembleRows", () => {
  /** Twelve months per variable for two cities, as the sampler stores them. */
  const store = (hole?: { field: string; month: number; city: number }) => {
    const out: Record<string, Float64Array[]> = {};
    for (const [field, value] of Object.entries({ tasmin: 10, tasmax: 20, pr: 50, clt: 40, hurs: 70 })) {
      out[field] = Array.from({ length: 12 }, (_, m) =>
        new Float64Array([
          hole && hole.field === field && hole.month === m && hole.city === 0 ? Number.NaN : value,
          hole && hole.field === field && hole.month === m && hole.city === 1 ? Number.NaN : value + 1,
        ]),
      );
    }
    return out;
  };

  test("keys the rows by city id, in catalog order", () => {
    const { rows, skipped } = assembleRows([{ id: "G1" }, { id: "G2" }], store());
    expect([...rows.keys()]).toEqual(["G1", "G2"]);
    expect(rows.get("G1")).toHaveLength(60);
    expect(rows.get("G1")![0]).toBe(10);
    expect(rows.get("G2")![0]).toBe(11);
    expect(skipped).toEqual([]);
  });

  test("turns the sampler's NaN back into the null tupleFor's contract names", () => {
    // A Float64Array cannot hold null, so the sampler stores NaN where
    // `decodeSample` returned one. Handing that NaN straight on would work by
    // accident — `tupleFor` refuses non-finite values too — but it would mean
    // two encodings of absence and only one of them documented.
    const { rows, skipped } = assembleRows([{ id: "G1" }], store({ field: "clt", month: 2, city: 0 }));
    expect(rows.size).toBe(0);
    expect(skipped).toEqual([{ id: "G1" }]);
  });

  test("drops only the city that cannot be written, not its neighbours", () => {
    // 60 positional integers carry no per-month absence marker, so one
    // unwritable month sinks the whole city — but exactly that city.
    const { rows, skipped } = assembleRows(
      [{ id: "G1" }, { id: "G2" }],
      store({ field: "pr", month: 5, city: 1 }),
    );
    expect([...rows.keys()]).toEqual(["G1"]);
    expect(skipped.map((c) => c.id)).toEqual(["G2"]);
  });
});

describe("climatePayload", () => {
  const rows = { G1: Array.from({ length: 60 }, (_, i) => i) };
  const now = "2026-09-04T00:00:00.000Z";

  test("writes the envelope the loader reads, in that order", () => {
    const payload = climatePayload("PE", rows, null, now);
    expect(Object.keys(payload)).toEqual(["country", "generatedAt", "source", "cities"]);
    expect(payload.country).toBe("PE");
    expect(payload.source).toMatch(/CHELSA V2\.1/);
    expect(payload.cities).toBe(rows);
  });

  test("stamps generatedAt on a first build", () => {
    expect(climatePayload("PE", rows, null, now).generatedAt).toBe(now);
  });

  test("keeps the previous timestamp when the rows are unchanged", () => {
    // 246 files whose only difference is a timestamp is 246 diffs of noise,
    // and it hides the one file that really did change.
    const before = climatePayload("PE", rows, null, "2026-01-01T00:00:00.000Z");
    expect(climatePayload("PE", rows, before, now).generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("restamps when a single integer of a single month moves", () => {
    const before = climatePayload("PE", rows, null, "2026-01-01T00:00:00.000Z");
    const nudged = { G1: rows.G1.map((v, i) => (i === 37 ? v + 1 : v)) };
    expect(climatePayload("PE", nudged, before, now).generatedAt).toBe(now);
  });

  test("restamps when a city is added", () => {
    // The row SET is the artifact. A country that gained a city has changed
    // even though every row it already had is identical.
    const before = climatePayload("PE", rows, null, "2026-01-01T00:00:00.000Z");
    expect(climatePayload("PE", { ...rows, G2: rows.G1 }, before, now).generatedAt).toBe(now);
  });

  test("compares the rows only, never the envelope", () => {
    // If the comparison included generatedAt it could never match, and the
    // guard would be dead code that looks alive.
    const before = { ...climatePayload("PE", rows, null, now), source: "something else" };
    expect(climatePayload("PE", rows, before, "2026-12-31T00:00:00.000Z").generatedAt).toBe(now);
  });
});

describe("indexPayload", () => {
  const countries = [{ code: "AD", count: 20 }, { code: "PE", count: 750 }];
  const now = "2026-09-04T00:00:00.000Z";

  test("keeps the previous timestamp when the listing is unchanged", () => {
    // The one place this build departs from build-provinces.mjs, which stamps
    // its index unconditionally. That is safe for a hand-run script, because
    // someone is looking at the diff. Spec 9.2 gives this artifact a
    // workflow_dispatch over decadal normals, so most runs change nothing at
    // all — and an unchanged run has to produce a byte-identical tree, or
    // every dispatch commits one line of pure noise in the one file a
    // reviewer opens first.
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    expect(before.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(indexPayload(countries, before, now).generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("restamps when a country's city count changes", () => {
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    const grown = [{ code: "AD", count: 21 }, { code: "PE", count: 750 }];
    expect(indexPayload(grown, before, now).generatedAt).toBe(now);
  });

  test("restamps when a country appears or disappears", () => {
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    expect(indexPayload(countries.slice(0, 1), before, now).generatedAt).toBe(now);
  });

  test("restamps when a shard's rows changed even though the listing did not", () => {
    // A CHELSA erratum — the one event refresh-climate.yml's header names as
    // a reason to dispatch — rewrites rows in every shard and adds or removes
    // no city at all, so the {code, count} listing comes out identical. On the
    // listing alone all 246 shards would restamp while this index, and
    // data/climate-report.md's `Generated:` line with it, kept the previous
    // decade's date.
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    expect(indexPayload(countries, before, now, 246).generatedAt).toBe(now);
    expect(indexPayload(countries, before, now, 1).generatedAt).toBe(now);
    // Zero changed shards is still the quiet case, which is the whole point
    // of preserving the stamp at all.
    expect(indexPayload(countries, before, now, 0).generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("assertShardCoverage", () => {
  test("passes when the two sets are the same", () => {
    expect(() => assertShardCoverage(new Set(["PE", "NO"]), new Set(["NO", "PE"]))).not.toThrow();
  });

  test("names every country that has a city shard and no climate shard", () => {
    // A country the picker can open with no climate file renders a map with
    // no climate at all, silently, because every other gate still passes.
    expect(() => assertShardCoverage(new Set(["PE"]), new Set(["NO", "PE", "KE"]))).toThrow(/KE, NO/);
  });

  test("names climate shards for countries that have no cities", () => {
    // Two-way, unlike build-provinces.mjs's one-way coverage gate: a province
    // file for a country with no cities is harmless geometry, but a climate
    // file for one is a file whose every key joins to nothing.
    expect(() => assertShardCoverage(new Set(["PE", "XX"]), new Set(["PE"]))).toThrow(/no city shard: XX/);
  });

  test("a swap keeps the count identical and still fails", () => {
    // Which is why this is an identity check and not a count.
    expect(() => assertShardCoverage(new Set(["PE", "XX"]), new Set(["PE", "NO"]))).toThrow();
  });
});

describe("assertSampleHealth", () => {
  // The three ways the sample itself can be wrong. All three are zero on this
  // CHELSA release and none is guaranteed by the format, so all three are
  // gates — a city off the raster, a city on a sentinel and a city with one
  // unwritable month all end the same way: the city is simply absent, and
  // every remaining gate still passes.
  test("passes when all three counts are zero", () => {
    expect(() => assertSampleHealth(0, 0, [])).not.toThrow();
  });

  test("fails on a city outside the grid", () => {
    expect(() => assertSampleHealth(3, 0, [])).toThrow(/3 city-raster pair\(s\) fall outside the grid/);
  });

  test("fails on a sample that landed on the declared sentinel", () => {
    expect(() => assertSampleHealth(0, 7, [])).toThrow(/7 sample\(s\) landed on a file's declared nodata/);
  });

  test("names the cities it would otherwise have dropped in silence", () => {
    // A count tells an operator a gate fired; the names tell them what broke.
    expect(() => assertSampleHealth(0, 0, [{ id: "G1", name: "Lima" }]))
      .toThrow(/1 city\/cities have no writable row \(e\.g\. G1 Lima\)/);
  });

  test("reports the off-raster count before the others", () => {
    // Order matters only in that the first one to fire should be the most
    // specific diagnosis; a city off the raster explains its own null.
    expect(() => assertSampleHealth(1, 1, [{ id: "G1", name: "Lima" }])).toThrow(/outside the grid/);
  });
});

describe("assertCityParity", () => {
  test("passes when the ids agree", () => {
    expect(() => assertCityParity(["G1", "G2"], new Set(["G2", "G1"]))).not.toThrow();
  });

  test("fails on a catalogued city with no row", () => {
    // The artifact is joined on the city id, and `elev` is read from the city
    // row beside it, so a gap here is a city that renders with no climate.
    expect(() => assertCityParity(["G1"], new Set(["G1", "G2"]))).toThrow(/no row: 1 \(e\.g\. G2\)/);
  });

  test("fails on a row for a city the catalog does not carry", () => {
    expect(() => assertCityParity(["G1", "G9"], new Set(["G1"])))
      .toThrow(/uncatalogued cities: 1 \(e\.g\. G9\)/);
  });

  test("fails on a city written into two shards, which a Set would hide", () => {
    // The failure this is really written for: the catalog is one flat array
    // sliced per country by offset and length, and an overlapping slice writes
    // some city twice and another not at all. Taking a Set of the written ids
    // before comparing would make an overlap compare equal.
    expect(() => assertCityParity(["G1", "G2", "G1"], new Set(["G1", "G2"])))
      .toThrow(/more than one shard: 1 \(e\.g\. G1\)/);
    // And the same input through a Set is exactly what would have passed.
    expect(() => assertCityParity(new Set(["G1", "G2", "G1"]), new Set(["G1", "G2"]))).not.toThrow();
  });
});

describe("assertRowShape", () => {
  const row = Array.from({ length: 60 }, () => 1);

  test("passes a row of exactly sixty integers", () => {
    expect(() => assertRowShape(new Map([["G1", row]]))).not.toThrow();
  });

  test("refuses a short row, which would shift every index after it", () => {
    // A positional tuple carries no field names: one short row and index 36
    // stops meaning cloud. `JSON.parse` accepts it happily.
    expect(() => assertRowShape(new Map([["G1", row.slice(0, 59)]]))).toThrow(/G1: row is 59 long/);
  });

  test("refuses a non-integer, which JSON.stringify would write as a decimal", () => {
    expect(() => assertRowShape(new Map([["G1", row.map((v, i) => (i === 12 ? 1.5 : v))]])))
      .toThrow(/G1: row\[12\] is 1\.5/);
  });

  test("refuses a value outside each block's own guard band, naming block and month", () => {
    // The same bands lib/climateShard.ts applies at read time, checked here
    // because this gate runs BEFORE the first write. An unscaled tasmax —
    // the failure the -273.15 offset exists to prevent — would otherwise
    // write 246 shards of Singapore at 298 °C and only surface 66 minutes
    // later, when npm test parsed the committed artifact back.
    const at = (i: number, value: number) => new Map([["G1", row.map((v, j) => (j === i ? value : v))]]);
    // lo's high edge and hi's low edge each need the OTHER value pulled to
    // match, or lo <= hi breaks before the band under test gets a say.
    const at2 = (i: number, vi: number, j: number, vj: number) =>
      new Map([["G1", row.map((v, k) => (k === i ? vi : k === j ? vj : v))]]);
    expect(() => assertRowShape(at(0, -91))).toThrow(/G1: lo in month 0 is -91, outside the -90\.\.60/);
    expect(() => assertRowShape(at(23, 298))).toThrow(/G1: hi in month 11 is 298, outside the -90\.\.60/);
    expect(() => assertRowShape(at(24, -1))).toThrow(/G1: precip in month 0 is -1, outside the 0\.\.10000/);
    expect(() => assertRowShape(at(35, 10_001))).toThrow(
      /G1: precip in month 11 is 10001, outside the 0\.\.10000/
    );
    expect(() => assertRowShape(at(36, 101))).toThrow(/G1: cloud in month 0 is 101, outside the 0\.\.100/);
    expect(() => assertRowShape(at(48, -91))).toThrow(/G1: td in month 0 is -91, outside the -90\.\.60/);
    // All ten accepting edges: the tripwire is for an unscaled decode, not
    // for a cold winter or a dry month.
    expect(() => assertRowShape(at(0, -90))).not.toThrow(); // lo low
    expect(() => assertRowShape(at2(11, 60, 23, 60))).not.toThrow(); // lo high
    expect(() => assertRowShape(at2(12, -90, 0, -90))).not.toThrow(); // hi low
    expect(() => assertRowShape(at(23, 60))).not.toThrow(); // hi high
    expect(() => assertRowShape(at(24, 0))).not.toThrow(); // precip low
    expect(() => assertRowShape(at(24, 10_000))).not.toThrow(); // precip high
    expect(() => assertRowShape(at(36, 0))).not.toThrow(); // cloud low
    expect(() => assertRowShape(at(36, 100))).not.toThrow(); // cloud high
    expect(() => assertRowShape(at(48, -90))).not.toThrow(); // td low
    expect(() => assertRowShape(at(59, 60))).not.toThrow(); // td high
  });

  test("refuses a month whose lo exceeds its hi, which every band alone would pass", () => {
    // 2 and 1 are both deep inside -90..60, so no band sees this. It is what
    // a build that scaled tasmin and tasmax differently looks like — and the
    // reason the cross-check is worth its own pass over the row.
    const inverted = row.map((v, i) => (i === 12 + 5 ? 0 : i === 5 ? 2 : v));
    expect(() => assertRowShape(new Map([["G1", inverted]]))).toThrow(
      /G1: lo in month 5 is 2, greater than hi \(0\)/
    );
  });
});

// ---------------------------------------------------------------------------
// assertRowShape vs parseClimateShard
// ---------------------------------------------------------------------------

import { parseClimateShard } from "../lib/climateShard";

describe("assertRowShape vs parseClimateShard", () => {
  test("agree on every block's accept/refuse boundary", () => {
    // BLOCK_META here and lib/climateShard.ts's own band constants are
    // restated independently rather than shared (this file's own docblock:
    // a build script cannot import the app's TypeScript). Independence is
    // the point, but only a check like this one would notice the two
    // quietly drifting apart.
    const blocks: [string, number, number][] = [
      ["lo", -90, 60],
      ["hi", -90, 60],
      ["precip", 0, 10_000],
      ["cloud", 0, 100],
      ["td", -90, 60],
    ];
    // lo defaults to -90 and hi to 60 so lo <= hi holds at every probe below,
    // whichever block is under test; the other three blocks never touch it.
    const base: number[] = Array.from({ length: 60 }, (_, i) =>
      Math.floor(i / 12) === 0 ? -90 : Math.floor(i / 12) === 1 ? 60 : 1
    );
    const throws = (fn: () => unknown) => {
      try {
        fn();
        return false;
      } catch {
        return true;
      }
    };
    blocks.forEach(([label, min, max], b) => {
      for (const probe of [min - 1, min, max, max + 1]) {
        const row = base.slice();
        row[b * 12] = probe;
        const shapeThrew = throws(() => assertRowShape(new Map([["G1", row]])));
        const parseThrew = throws(() =>
          parseClimateShard({
            country: "PE",
            generatedAt: "2026-01-01T00:00:00.000Z",
            source: "test",
            cities: { G1: row },
          })
        );
        expect(parseThrew, `${label} ${probe}`).toBe(shapeThrew);
      }
    });
  });
});

describe("assertBudget", () => {
  test("measures against build-provinces.mjs's own two numbers", () => {
    // Imported rather than restated, so there is one number to change. Both
    // are inclusive: a shard exactly at the limit passes. Unlike the city
    // shard's cap, this one is NOT saturated and is not what shaped the
    // layout: the worst real shard (IN) gzips to 39,490 B, 26.3% of the
    // 150,000 B budget, so a future reader should not treat it as binding.
    expect(GZIP_BUDGET).toBe(150_000);
    expect(RAW_TRIPWIRE).toBe(700_000);
    expect(() => assertBudget([{ code: "CO", raw: RAW_TRIPWIRE, gzip: GZIP_BUDGET }])).not.toThrow();
    expect(() => assertBudget([{ code: "CO", raw: 1000, gzip: GZIP_BUDGET + 1 }])).toThrow(/gzip budget/);
    expect(() => assertBudget([{ code: "CO", raw: RAW_TRIPWIRE + 1, gzip: 1000 }])).toThrow(/raw tripwire/);
  });

  test("names every offender, not the first", () => {
    expect(() => assertBudget([
      { code: "PE", raw: 1000, gzip: 400 },
      { code: "ID", raw: 1000, gzip: 200_000 },
      { code: "CO", raw: 1000, gzip: 160_000 },
    ])).toThrow(/CO 160000[\s\S]*ID 200000/);
  });

  test("catches a shard that gzips well and is still pathological to parse", () => {
    // The two limits answer different questions: one is what a reader pays
    // for over the wire, the other is what their browser pays to parse it.
    expect(() => assertBudget([{ code: "ID", raw: 900_000, gzip: 40_000 }])).toThrow(/raw tripwire/);
  });
});

describe("measuredRanges", () => {
  /** A row of five constant blocks, so a fixture reads as five numbers. */
  const flat = (lo: number, hi: number, precip: number, cloud: number, td: number): number[] => [
    ...Array<number>(12).fill(lo),
    ...Array<number>(12).fill(hi),
    ...Array<number>(12).fill(precip),
    ...Array<number>(12).fill(cloud),
    ...Array<number>(12).fill(td),
  ];

  /** One block's line, split on whitespace, so the padding is not the subject. */
  const fields = (lines: string[], label: string): string[] => {
    const line = lines.find((l) => l.startsWith(`${label} `));
    expect(line, `no ${label} line among ${JSON.stringify(lines)}`).toBeDefined();
    return line!.trim().split(/\s+/);
  };

  test("takes each block's min and max across rows, never within one", () => {
    // G1 holds the lo floor and the td floor, G2 every ceiling: a min/max
    // taken per ROW, or over the flat 60 ints, would blend the five blocks
    // into one range and still look like a plausible report.
    const lines = measuredRanges([
      ["G1", flat(-46, 12, 0, 0, -43)],
      ["G2", flat(0, 47, 2476, 93, 24)],
      ["G3", flat(-5, 20, 100, 50, 0)],
    ]);
    expect(fields(lines, "lo")).toEqual(["lo", "-46..0", "°C"]);
    expect(fields(lines, "hi")).toEqual(["hi", "12..47", "°C"]);
    expect(fields(lines, "precip")).toEqual(["precip", "0..2476", "mm/month"]);
    expect(fields(lines, "cloud")).toEqual(["cloud", "0..93", "%"]);
    expect(fields(lines, "td")).toEqual(["td", "-43..24", "°C"]);
    expect(lines.join("\n")).toMatch(/^36 city-months, of which \*\*0\*\* have/m);
  });

  test("counts the months where lo exceeds hi, which no single band would catch", () => {
    // 20 and 10 are both well inside the parser's -90..60 band, so only the
    // cross-field check sees the inversion — the shape a build that scaled
    // tasmin and tasmax differently would take.
    const lines = measuredRanges([
      ["G1", flat(0, 10, 0, 0, 0)],
      ["G2", flat(20, 10, 0, 0, 0)],
    ]);
    expect(lines.join("\n")).toMatch(/^24 city-months, of which \*\*12\*\* have/m);
  });

  test("returns a whole section, heading first and blank-terminated", () => {
    // buildReport splices these lines straight in ahead of '## Rasters', so
    // the trailing blank is the section separator, not decoration.
    const lines = measuredRanges([["G1", flat(0, 10, 0, 0, 0)]]);
    expect(lines[0]).toBe("## Measured ranges");
    expect(lines[1]).toBe("");
    expect(lines.at(-1)).toBe("");
  });

  test("refuses an empty row set rather than reporting Infinity..-Infinity", () => {
    // Every block's min/max starts at the opposite infinity; with no rows to
    // narrow it, that starting point is what would otherwise reach the
    // committed report.
    expect(() => measuredRanges([])).toThrow(/no rows to measure/);
  });
});

// ---------------------------------------------------------------------------
// readScaling
// ---------------------------------------------------------------------------

describe("readScaling", () => {
  /** A minimal GDAL_METADATA blob — only the two `role=` items this function reads. */
  const metadataOf = (scaleItem: string, offsetItem = "-273.15") =>
    `<GDALMetadata><Item name="SCALE" sample="0" role="scale">${scaleItem}</Item>` +
    `<Item name="OFFSET" sample="0" role="offset">${offsetItem}</Item></GDALMetadata>`;

  /** Stands in for geotiff's FileDirectory: `hasTag` plus an async `loadValue`. */
  function fakeDirectory(metadata: string, nodata: string) {
    return {
      hasTag: () => true,
      loadValue: async (name: string) => (name === "GDAL_METADATA" ? metadata : nodata),
    };
  }

  test("reads a real scale/offset/nodata triple off the tags", async () => {
    const directory = fakeDirectory(metadataOf("0.1"), "-2147483647");
    await expect(readScaling(directory, "CHELSA_tasmin_01_1981-2010_V.2.1.tif")).resolves.toEqual({
      scale: 0.1,
      offset: -273.15,
      nodata: -2147483647,
    });
  });

  test("rejects a whitespace-bodied scale item instead of silently reading it as 0", async () => {
    // item() is `Number(match[1])`, and `Number(' ')` is 0 — finite, and a
    // scale no real file declares. Without the explicit zero check every
    // value in the file would decode to the constant offset (raw * 0 +
    // offset), a plausible number that would pass every gate below it.
    const directory = fakeDirectory(metadataOf(" "), "-2147483647");
    await expect(readScaling(directory, "CHELSA_tasmin_01_1981-2010_V.2.1.tif")).rejects.toThrow(
      /GDAL_METADATA declares no usable scale\/offset/
    );
  });

  test("refuses a file that declares no such tag, naming which one and which file", async () => {
    // Every branch of readScaling throws rather than defaulting, and this was
    // the one branch no fixture could reach: fakeDirectory's hasTag is
    // hardcoded true. All five CHELSA files declare both tags today; a
    // release that stopped declaring one is a change a human should see, not
    // one this build should guess past — and the message has to say which
    // file and which tag, because the run is 60 files deep behind a detached
    // process by the time anyone reads it.
    const without = (missing: string) => ({
      hasTag: (tag: string) => tag !== missing,
      loadValue: async () => "unreachable",
    });
    await expect(
      readScaling(without("GDAL_NODATA"), "CHELSA_pr_01_1981-2010_V.2.1.tif")
    ).rejects.toThrow(/^CHELSA_pr_01_1981-2010_V\.2\.1\.tif: no GDAL_NODATA tag/);
    await expect(
      readScaling(without("GDAL_METADATA"), "CHELSA_clt_07_1981-2010_V.2.1.tif")
    ).rejects.toThrow(/^CHELSA_clt_07_1981-2010_V\.2\.1\.tif: no GDAL_METADATA tag/);
  });

  test("reads a tag geotiff hands back as NUL-terminated bytes exactly as it reads a string", async () => {
    // GDAL_METADATA and GDAL_NODATA are DEFERRED fields, and loadValue gives
    // back whatever the file holds — an ASCII blob as a typed array, not
    // always a JS string. tagText's latin1 decode and trailing-NUL trim are
    // what make the two forms one value, and nothing exercised them: every
    // fixture above answers with a string. A NUL left on the end of the
    // sentinel alone would send `Number("-2147483647\0")` to NaN and abort
    // the run on a file that is perfectly well-formed.
    const bytes = (s: string) => new TextEncoder().encode(`${s}\0`);
    const asBytes = {
      hasTag: () => true,
      loadValue: async (name: string) =>
        name === "GDAL_METADATA" ? bytes(metadataOf("0.1")) : bytes("-2147483647"),
    };
    const file = "CHELSA_tasmin_01_1981-2010_V.2.1.tif";
    await expect(readScaling(asBytes, file)).resolves.toEqual(
      await readScaling(fakeDirectory(metadataOf("0.1"), "-2147483647"), file)
    );
  });
});

// ---------------------------------------------------------------------------
// ensureRaster
// ---------------------------------------------------------------------------

import { afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * All three real builds (Task 6's report) found every one of the 60 rasters
 * already cached, so `ensureRaster`'s HEAD / stream-to-temp /
 * verify-byte-count / rename / retry path has never once executed — the
 * first cold run is an unattended CI job. `fetch` is stubbed globally, the
 * way this repo's other fetchers are tested, and `cacheDir` is pointed at a
 * scratch directory via the options `ensureRaster` now takes — the module's
 * real `CACHE_DIR` is never touched by any test here.
 */
describe("ensureRaster", () => {
  const scratchDirs: string[] = [];

  afterEach(() => {
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
    vi.unstubAllGlobals();
  });

  function scratchCacheDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "ingest-climate-ensureRaster-"));
    scratchDirs.push(dir);
    return dir;
  }

  /** A HEAD response carrying only the one header ensureRaster reads. */
  const headResponse = (bytes: number) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (name: string) => (name === "content-length" ? String(bytes) : null) },
  });

  /** A GET response whose body stream is exactly `bytes` long. */
  const okResponse = (bytes: number) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes).fill(7));
        controller.close();
      },
    }),
  });

  const failureResponse = (status: number, statusText: string) => ({
    ok: false,
    status,
    statusText,
    headers: { get: () => null },
  });

  test("a cached file whose size equals the HEAD Content-Length is not re-downloaded, and no GET is issued", async () => {
    const cacheDir = scratchCacheDir();
    const BYTES = 37;
    // Content doesn't matter — the cache check is a byte-count comparison,
    // never a hash or a read of the file itself.
    const cachedPath = join(cacheDir, "CHELSA_clt_01_1981-2010_V.2.1.tif");
    writeFileSync(cachedPath, Buffer.alloc(BYTES, 1));

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") return headResponse(BYTES);
      throw new Error("GET must not be issued when the cache already matches");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureRaster("clt", "01", { cacheDir });
    expect(result).toEqual({ path: cachedPath, bytes: BYTES, downloadedBytes: 0, downloadMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("an absent file is streamed to a PID-suffixed temp and renamed into place with the exact byte count", async () => {
    const cacheDir = scratchCacheDir();
    const BYTES = 41;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD" ? headResponse(BYTES) : okResponse(BYTES)
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureRaster("clt", "01", { cacheDir });
    expect(result.bytes).toBe(BYTES);
    expect(result.downloadedBytes).toBe(BYTES);
    expect(statSync(result.path).size).toBe(BYTES);
    // Only the final file survives — no `.tmp-<pid>` left behind, which is
    // exactly what a crash mid-stream would otherwise leave at this path.
    expect(readdirSync(cacheDir)).toEqual([basename(result.path)]);
  });

  test("a body shorter than Content-Length throws and leaves no file at the final path", async () => {
    const cacheDir = scratchCacheDir();
    const DECLARED = 50;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD" ? headResponse(DECLARED) : okResponse(10)
    );
    vi.stubGlobal("fetch", fetchMock);

    // `retryDelaysMs: [0, 0]` — same two retries the real module makes, at
    // no real wall-clock cost, rather than fake timers: this test writes to
    // real disk on every attempt, and interleaving that with a fake clock is
    // its own hazard (a fake timer scheduled only after real I/O settles can
    // outlive `runAllTimersAsync`'s own drain and hang the test forever).
    await expect(
      ensureRaster("clt", "01", { cacheDir, retryDelaysMs: [0, 0] })
    ).rejects.toThrow(/wrote 10 B, expected 50 B/);
    // The retries all wrote the same short body to the SAME temp name, and
    // the outer `finally` removes it on the way out — nothing survives.
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("a non-2xx HEAD throws", async () => {
    const cacheDir = scratchCacheDir();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => failureResponse(500, "Internal Server Error"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureRaster("clt", "01", { cacheDir, retryDelaysMs: [0, 0] })
    ).rejects.toThrow(/HTTP 500/);
    // A HEAD that never succeeds must never reach the GET branch.
    expect(fetchMock.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.method === "HEAD")).toBe(
      true
    );
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("a transient failure followed by success is retried and succeeds", async () => {
    const cacheDir = scratchCacheDir();
    const BYTES = 44;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(headResponse(BYTES))
      .mockResolvedValueOnce(failureResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(okResponse(BYTES));
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureRaster("clt", "01", { cacheDir, retryDelaysMs: [0] });
    expect(result.downloadedBytes).toBe(BYTES);
    expect(statSync(result.path).size).toBe(BYTES);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
