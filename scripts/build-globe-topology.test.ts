import { describe, expect, test } from "vitest";
import { assertCoverage, buildGlobePoints } from "./build-globe-topology.mjs";

/**
 * Covers the two pure functions standing between a 61-country gap and
 * `public/world-globe.json`. Both are exported for exactly this reason; the
 * module's entry-point guard means importing it here does not also refetch
 * world-atlas and rewrite the asset as a side effect.
 */

const p = (code: string) => ({ code, name: code, lon: 0, lat: 0 });

describe("buildGlobePoints", () => {
  test("carries every 50m point through, including codes 110m never draws", () => {
    // HK/MT/SG are the real case: 110m has no feature for them at all, so
    // recomputing the layer from 110m loses them silently.
    const points = buildGlobePoints([p("HK"), p("MT"), p("SG")], []);
    expect(points.map((x) => x.code)).toEqual(["HK", "MT", "SG"]);
  });

  test("adds 110m-only points without duplicating shared codes", () => {
    // TL is below the size threshold at 110m but not at 50m — the one code
    // that makes the correct layer a 77-entry union rather than a 76 copy.
    const points = buildGlobePoints([p("MT"), p("SG")], [p("SG"), p("TL")]);
    expect(points.map((x) => x.code)).toEqual(["MT", "SG", "TL"]);
  });

  test("sorts by code so a rebuild is byte-stable", () => {
    const points = buildGlobePoints([p("SG"), p("AD")], [p("TL")]);
    expect(points.map((x) => x.code)).toEqual(["AD", "SG", "TL"]);
  });
});

describe("assertCoverage", () => {
  test("passes when polygons and points together reach every reference code", () => {
    expect(() =>
      assertCoverage(new Set(["FR", "JP"]), new Set(["MT"]), new Set(["FR", "JP", "MT"]))
    ).not.toThrow();
  });

  test("throws, naming every unreachable country, when the point layer is short", () => {
    // This is the naive build: 110m polygons plus a 110m-derived point layer.
    expect(() =>
      assertCoverage(new Set(["FR", "JP"]), new Set(), new Set(["FR", "JP", "MT", "SG"]))
    ).toThrow(/cannot reach 2 countries[\s\S]*MT, SG/);
  });

  test("ignores globe codes the reference does not have", () => {
    // A one-way check: the globe may reach more than the flat map, never less.
    expect(() => assertCoverage(new Set(["FR", "XX"]), new Set(), new Set(["FR"]))).not.toThrow();
  });
});
