/**
 * ingest-climate — bucketing cities onto raster rows, and assembling the rows.
 *
 * Moved out of scripts/ingest-climate.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-climate.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import path moved with it. The two grids are repeated here rather
 * than shared, because `scripts/climate/sample.test.ts` needs them too and a
 * test file cannot import another test file without running its describes
 * twice. They are transcribed from `data/climate-probe.md`, which is the
 * measured authority.
 */

import { describe, expect, test } from "vitest";
import { assembleRows, bucketByRow } from "./raster.mjs";

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
