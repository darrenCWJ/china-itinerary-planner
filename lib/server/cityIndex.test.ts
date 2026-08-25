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
    // Degrades rather than throws: this parses at module load, and a throw
    // here takes down every route that imports the catalog, including the ones
    // that never touch a GeoNames city.
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
    expect(status.generatedAt).not.toBe("");
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
