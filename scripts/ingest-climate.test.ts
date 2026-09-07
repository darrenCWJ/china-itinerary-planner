import { describe, expect, test } from "vitest";
import { assertSampleHealth } from "./ingest-climate.mjs";

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
