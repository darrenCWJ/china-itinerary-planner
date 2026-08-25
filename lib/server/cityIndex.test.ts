import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import { cityIndexEntry, cityIndexStatus, isGeoNamesId, readCityIndex } from "./cityIndex";

describe("isGeoNamesId", () => {
  test("accepts a G-prefixed geonameid and nothing else", () => {
    // The one discriminator between the two id namespaces §3.3 keeps apart.
    // `resolveDestinations` branches on it, so a false positive resolves a
    // Wikidata city out of the GeoNames index and finds nothing.
    expect(isGeoNamesId("G3941584")).toBe(true);
    expect(isGeoNamesId("Q170247")).toBe(false);
    expect(isGeoNamesId("3941584")).toBe(false);
    expect(isGeoNamesId("beijing")).toBe(false);
    expect(isGeoNamesId("offmap:grandmas-village")).toBe(false);
    expect(isGeoNamesId("G0")).toBe(false);
    expect(isGeoNamesId("G")).toBe(false);
    expect(isGeoNamesId("g3941584")).toBe(false);
  });
});

describe("readCityIndex", () => {
  const raw = {
    generatedAt: "2026-08-25T00:00:00.000Z",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      ["G3941584", "Cusco", "PE", -13.52264, -71.96734, "Cusco"],
      ["G2657928", "Zermatt", "CH", 46.01998, 7.74863, "Valais"],
    ],
  };

  test("keys the tuples by id", () => {
    const index = readCityIndex(raw);
    expect(index.get("G3941584")).toEqual({
      id: "G3941584",
      name: "Cusco",
      country: "PE",
      lat: -13.52264,
      lon: -71.96734,
      region: "Cusco",
    });
    expect(index.size).toBe(2);
  });

  test("returns a Map, so an id spelled like an Object member cannot resolve through the prototype", () => {
    // The ids here come off the wire — `/api/destinations/resolve?ids=` is a
    // query string. A plain object would answer `index['constructor']` with a
    // function, and `?? null` would never catch it.
    const index = readCityIndex(raw);
    expect(index.get("constructor")).toBeUndefined();
    expect(index.get("__proto__")).toBeUndefined();
  });

  test("drops a malformed tuple rather than emitting a half-city", () => {
    // Degrades rather than throws. The index is built lazily, on the first
    // resolve, so a throw here would surface inside a request that is already
    // resolving a GeoNames city — it cannot fire at module load, and routes
    // like `/api/trips` never enter this path at all. On that narrower path,
    // one malformed row should still cost that one city rather than the whole
    // resolve.
    const index = readCityIndex({
      cities: [
        ["G1", "Fine", "PE", 1, 2, null],
        ["Q2", "Wrong namespace", "PE", 1, 2, null],
        ["G3", "", "PE", 1, 2, null],
        ["G4", "No country", "PER", 1, 2, null],
        ["G5", "Bad coords", "PE", "1", 2, null],
        ["G6"],
        "not a tuple",
      ],
    });
    expect([...index.keys()]).toEqual(["G1"]);
  });

  test("is an empty map for anything unreadable", () => {
    expect(readCityIndex(null).size).toBe(0);
    expect(readCityIndex({ cities: {} }).size).toBe(0);
    expect(readCityIndex("<html>login</html>").size).toBe(0);
  });

  test("keeps a null region as null, and does not invent one from an empty string", () => {
    // `region` becomes `Destination.region`, which the plan card renders. The
    // guard is `typeof region === "string" && region !== ""`, so all three of
    // these have to collapse to the same honest null.
    const index = readCityIndex({
      cities: [
        ["G1", "Nowhere", "PE", 1, 2, null],
        ["G2", "Blank", "PE", 1, 2, ""],
        ["G3", "Not a region at all", "PE", 1, 2, 7],
      ],
    });
    expect(index.get("G1")!.region).toBeNull();
    expect(index.get("G2")!.region).toBeNull();
    expect(index.get("G3")!.region).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The committed index
// ---------------------------------------------------------------------------

const INDEX_ASSET = join(process.cwd(), "data", "cities-index.json");
const hasAsset = existsSync(INDEX_ASSET);

describe.skipIf(!hasAsset)("the bundled city index", () => {
  it("holds every city the shards do", () => {
    // Banded rather than exact, the same reasoning lib/server/airports.test.ts
    // gives: GeoNames moves nightly, and an exact count would go red for a
    // data refresh rather than for a defect.
    const status = cityIndexStatus();
    expect(status.cities).toBeGreaterThan(55_000);
    expect(status.cities).toBeLessThan(63_000);
    // Not `not.toBe("")` — that passes for any non-empty string, so swapping
    // `generatedAt` for `artifact.source` would survive it. Assert the shape
    // the way lib/server/airports.test.ts:25,33-35 does: it looks like an ISO
    // timestamp, it parses, and it is not in the future. This subsumes the
    // non-empty check. Recency is deliberately not asserted, for the reason
    // that file gives — the ingest preserves the previous timestamp when the
    // data is unchanged, so an old value is designed behaviour.
    expect(status.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const generatedAt = new Date(status.generatedAt);
    expect(Number.isNaN(generatedAt.getTime())).toBe(false);
    expect(generatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("memoises the map, so a second resolve is not a second 58,742-row build", () => {
    // `toBe`, not `toEqual`: the memo hands back the identical entry object,
    // while a Map rebuilt per call hands back an equal copy. `toEqual` would
    // pass either way and observe nothing — dropping the memo entirely leaves
    // every other test in this file green.
    //
    // This lives inside the artifact guard on purpose. With no artifact both
    // sides are `null`, and `toBe` would pass vacuously.
    expect(cityIndexEntry("G3941584")).toBe(cityIndexEntry("G3941584"));
  });

  it("resolves the destinations the design was validated against", () => {
    // Fixture invariant §6: every fixture city must have a country present in
    // the shard index, which for the server side means resolvable here.
    expect(cityIndexEntry("G3941584")).toMatchObject({ name: "Cusco", country: "PE" });
    expect(cityIndexEntry("G2657928")).toMatchObject({ name: "Zermatt", country: "CH" });
    expect(cityIndexEntry("G1857910")).toMatchObject({ name: "Kyoto", country: "JP" });
  });

  it("does not resolve a Wikidata id, an unknown id, or an Object member", () => {
    expect(cityIndexEntry("Q170247")).toBeNull();
    expect(cityIndexEntry("G999999999")).toBeNull();
    expect(cityIndexEntry("constructor")).toBeNull();
  });

  it("does not carry the city that was deduplicated in favour of a QID record", () => {
    // Jinan's GeoNames row never reaches a shard, so it must never reach the
    // index either — otherwise a stale id would resolve to a thin Jinan while
    // Q170247's rich one sat unused.
    expect(cityIndexEntry("G1805753")).toBeNull();
  });
});
