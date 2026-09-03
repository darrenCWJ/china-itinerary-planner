import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { COUNTRY_DETAIL, detailFor, hasDetailLevel, parseProvinceIndex } from "./countryDetail";
import { PROVINCE_INDEX_PATH } from "./provinceTopology";

/**
 * The province directory, read from disk rather than from the index, so the
 * two can disagree and this file says so.
 *
 * Joined off `PROVINCE_INDEX_PATH` for the index itself, the trick
 * lib/countryProjection.test.ts uses for `PROJECTION_PATH`: a rename that
 * touched the constant and not the file skips this block rather than passing.
 */
const PROVINCES_DIR = join(process.cwd(), "public", "provinces");
const INDEX_ASSET = join(process.cwd(), "public", PROVINCE_INDEX_PATH);
const hasAssets = existsSync(INDEX_ASSET) && existsSync(PROVINCES_DIR);

/** Every code with a committed province file, from the directory listing. */
const shipped = hasAssets
  ? readdirSync(PROVINCES_DIR)
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .map((name) => name.slice(0, -".json".length))
      .sort()
  : [];

describe("parseProvinceIndex", () => {
  test("reads a country's unit count and id scheme", () => {
    const registry = parseProvinceIndex({
      countries: [
        { code: "PE", count: 25, idKey: "adm1_code", unplaced: 0 },
        { code: "CN", count: 31, idKey: "adcode", unplaced: 3 },
      ],
    });
    expect(registry.size).toBe(2);
    expect(registry.get("PE")).toEqual({ count: 25, idKey: "adm1_code" });
    expect(registry.get("CN")).toEqual({ count: 31, idKey: "adcode" });
  });

  test("throws when the root is not an index at all", () => {
    // Structural, so it throws, the split `parseProjectionManifest` makes: a
    // root with no `countries` array is the wrong file entirely, and every one
    // of the 246 countries would silently lose its detail level. A single bad
    // ENTRY costs one country and is dropped below.
    expect(() => parseProvinceIndex(null)).toThrow(/provinces\/index\.json/);
    expect(() => parseProvinceIndex([])).toThrow(/provinces\/index\.json/);
    expect(() => parseProvinceIndex({ countries: {} })).toThrow(/provinces\/index\.json/);
  });

  test("drops an unusable entry and keeps every country beside it", () => {
    const registry = parseProvinceIndex({
      countries: [
        { code: "PE", count: 25, idKey: "adm1_code" },
        // `iso_3166_2` is a real column in the source and is NOT an id scheme
        // this app builds; a reader that accepted it would join cities on a
        // field with 4,501 distinct values for 4,596 features.
        { code: "JP", count: 47, idKey: "iso_3166_2" },
        { code: "DE", count: "16", idKey: "adm1_code" },
        { code: "FR", count: -1, idKey: "adm1_code" },
        { code: "ZZZ", count: 3, idKey: "adm1_code" },
        { code: "AR", count: 24, idKey: "adm1_code" },
      ],
    });
    expect([...registry.keys()]).toEqual(["PE", "AR"]);
  });

  test("does not resolve a country code that is an Object property name", () => {
    // The index is a data file, and a plain object leaks two ways: a LOOKUP of
    // "constructor" resolves to a function, so a miss reads as a hit, and a
    // BUILD from an entry whose code is "__proto__" writes through the
    // prototype instead of into the registry. A Map does neither, and
    // `isCountryCode` refuses both codes before either can happen — the same
    // reason `parseProvinceTopology` hands back `cityProvince` as a Map.
    const registry = parseProvinceIndex({
      countries: [
        { code: "__proto__", count: 9, idKey: "adm1_code" },
        { code: "constructor", count: 9, idKey: "adm1_code" },
        { code: "PE", count: 25, idKey: "adm1_code" },
      ],
    });
    expect([...registry.keys()]).toEqual(["PE"]);
    expect(registry.get("constructor")).toBeUndefined();
    expect(detailFor("constructor")).toBeNull();
    expect(detailFor("toString")).toBeNull();
    expect(hasDetailLevel("__proto__")).toBe(false);
  });
});

describe("hasDetailLevel", () => {
  test("takes a code however it is cased or padded, and refuses a non-code", () => {
    // The signature `CountryMap` shipped it under, kept verbatim: three call
    // sites hand it a raw prop rather than a normalised `getCountry` code.
    expect(hasDetailLevel(" cn ")).toBe(true);
    expect(hasDetailLevel("pe")).toBe(true);
    expect(hasDetailLevel("")).toBe(false);
    expect(hasDetailLevel("CHN")).toBe(false);
    expect(hasDetailLevel(undefined as unknown as string)).toBe(false);
  });
});

describe.skipIf(!hasAssets)("the committed index", () => {
  test("is the registry, not a second copy of it", () => {
    // COUNTRY_DETAIL is built from a static import of the very file this test
    // reads off disk. If the import specifier ever pointed somewhere else —
    // a stale generated copy under data/, say — every assertion below would
    // still pass while the app read different numbers. This is the one test
    // that would notice.
    const fromDisk = parseProvinceIndex(JSON.parse(readFileSync(INDEX_ASSET, "utf8")));
    expect([...COUNTRY_DETAIL]).toEqual([...fromDisk]);
  });

  test("every country with a province file has a detail level", () => {
    // The point of the PR. Before it, one country of 246 had one.
    expect(shipped).toHaveLength(246);
    const missing = shipped.filter((code) => !hasDetailLevel(code));
    expect(missing, `province files with no detail level: ${missing.join(", ")}`).toEqual([]);
    // Both directions: an entry naming a country whose file was never written
    // would send `MapExplorer` after a 404 it has no branch for.
    expect([...COUNTRY_DETAIL.keys()].sort()).toEqual(shipped);
  });

  test("a country with no province file has none", () => {
    // Natural Earth's admin-0 carries these; its admin-1 does not, so they are
    // countries the picker can reach and this registry must refuse. AQ, BV and
    // HM have no subdivisions to draw, and UM is the fourth code
    // `lib/countries.ts` names (`UNINGESTED_NAMES`) that ships neither a city
    // shard nor a province file. XD used to stand in UM's place — Natural
    // Earth's UN neutral zone — but nothing in the app knows that code, so its
    // three assertions could only ever pass, for a reason unrelated to the
    // registry.
    for (const code of ["AQ", "BV", "HM", "UM"]) {
      expect(existsSync(join(PROVINCES_DIR, `${code}.json`)), `${code}.json`).toBe(false);
      expect(hasDetailLevel(code), code).toBe(false);
      expect(detailFor(code), code).toBeNull();
    }
  });

  test("reports China's id scheme as adcode and everyone else's as adm1_code", () => {
    // China's file is a re-envelope of the curated topology (§6.3, D7), keyed
    // on `adcode` (GB/T 2260); every other country keys on Natural Earth's
    // `adm1_code`. Readers join on what the file declares, never on a guess.
    expect(detailFor("CN")).toEqual({ count: 31, idKey: "adcode" });
    const odd = [...COUNTRY_DETAIL]
      .filter(([code, detail]) => code !== "CN" && detail.idKey !== "adm1_code")
      .map(([code, detail]) => `${code} ${detail.idKey}`);
    expect(odd, `countries not keyed on adm1_code: ${odd.join(", ")}`).toEqual([]);
  });

  test("34 countries report a single unit", () => {
    // §6.6 D10. These are the countries where an L3 affordance would offer a
    // zoom into the only thing already on screen, so Plan 4 suppresses it —
    // and this is the number that decision is sized against. Monaco, Macau,
    // the Vatican, Tokelau and 30 more.
    const single = [...COUNTRY_DETAIL].filter(([, detail]) => detail.count === 1);
    expect(single).toHaveLength(34);
    expect(detailFor("MC")).toEqual({ count: 1, idKey: "adm1_code" });
    // Not a floor for everyone: China offers 31 of the 35 geometries it ships.
    expect(detailFor("MO")?.count).toBe(1);
  });
});
