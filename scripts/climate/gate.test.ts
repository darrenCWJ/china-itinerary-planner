/**
 * ingest-climate — the four gates that run before the first write.
 *
 * Moved out of scripts/ingest-climate.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-climate.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import paths moved with them.
 */

import { describe, expect, test } from "vitest";
import { assertBudget, assertCityParity, assertRowShape, assertShardCoverage } from "./gate.mjs";
import { GZIP_BUDGET, RAW_TRIPWIRE } from "../build-provinces.mjs";

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

import { parseClimateShard } from "../../lib/climateShard";

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
