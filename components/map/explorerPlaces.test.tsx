import { describe, expect, test } from "vitest";
import type { CityShardRow } from "@/lib/cityShard";
import { haversineKm } from "@/lib/geo";
import type { MapCity } from "@/lib/tripShared";
import { buildExplorerPlaces, dropCatalogTwins, mergeCountryCities } from "./explorerPlaces";

/**
 * The three functions the country level's markers are built out of, tested
 * without a map — they take rows and answer rows, and every one of the cases
 * below used to need a mounted `MapExplorer` and a stubbed `fetch` to reach.
 *
 * The fixtures are the pairs the docblocks in `explorerPlaces.ts` cite, at the
 * coordinates the committed data carries, so the distances the filter turns on
 * are the real ones rather than numbers chosen to pass.
 */

/** data/catalog.json's Q71247, shaped the way `/api/map/cities` answers. */
const JINGZHOU_CATALOG: MapCity = {
  qid: "Q71247",
  name: "Jingzhou",
  localName: "荆州市",
  province: "Hubei",
  lat: 30.324444444,
  lon: 112.236111111,
  population: 5_231_180,
  level: "prefecture",
  attractionCount: 3,
  blurb: "Jingzhou is a prefecture-level city in southern Hubei province, China.",
};

/** data/catalog.json's Q1359423 — Heshan in Laibin, Guangxi. */
const HESHAN_CATALOG: MapCity = {
  qid: "Q1359423",
  name: "Heshan",
  localName: "合山市",
  province: "Laibin",
  lat: 23.81635,
  lon: 108.88475,
  population: 98_938,
  level: "county",
  attractionCount: 0,
  blurb: "Heshan is a county-level city of central Guangxi, China.",
};

const CATALOG = [JINGZHOU_CATALOG, HESHAN_CATALOG];

/**
 * public/cities/CN.json's Jingzhou, 5.3 km from the catalog's: the same city
 * twice, and the pair that made this filter necessary.
 *
 * Capitalised, which is what pins the fold — a comparison on `row.n` raw would
 * let it straight through and draw Jingzhou twice.
 */
const JINGZHOU_SHARD: CityShardRow = {
  id: "G1805540",
  n: "JINGZHOU",
  lat: 30.35028,
  lon: 112.19028,
  a1: "Hubei",
  a1c: "CN.12",
  p: 1_052_282,
  elev: 32,
  tz: "Asia/Shanghai",
};

/** Hunan's Heshan: a shared romanisation, 631 km from the catalog's. */
const HESHAN_SHARD: CityShardRow = {
  id: "G1808316",
  n: "Heshan",
  lat: 28.56938,
  lon: 112.34733,
  a1: "Hunan",
  a1c: "CN.11",
  p: 1_249_807,
  elev: 43,
  tz: "Asia/Shanghai",
};

/** A shard row with no catalog namesake at all. */
const ENSHI_SHARD: CityShardRow = {
  id: "G1811720",
  n: "Enshi",
  lat: 30.3,
  lon: 109.48333,
  a1: "Hubei",
  a1c: "CN.12",
  p: 279_185,
  elev: 447,
  tz: "Asia/Shanghai",
};

/**
 * A row `curatedPlaceNames("CN")` covers — Guilin's card plans Yangshuo, so a
 * bare "Yangshuo" chip beside it would be the same place offered twice.
 */
const YANGSHUO_SHARD: CityShardRow = {
  id: "G1806800",
  n: "Yangshuo",
  lat: 24.77875,
  lon: 110.49646,
  a1: "Guangxi",
  a1c: "CN.16",
  p: 300_000,
  elev: 116,
  tz: "Asia/Shanghai",
};

/** public/cities/PE.json's Cusco row, admin-1 and all. */
const CUSCO: MapCity = {
  qid: "G3941584",
  name: "Cusco",
  localName: null,
  province: "Cuzco Department",
  lat: -13.53188,
  lon: -71.96701,
  population: 428_450,
  level: "prefecture",
  attractionCount: 0,
  blurb: null,
};

describe("dropCatalogTwins", () => {
  test("drops a shard row that names the catalog city within the same-city radius", () => {
    // Armed with the real distance: the pair is inside the radius, so a filter
    // that dropped nothing and a radius set too small are different failures.
    expect(haversineKm(JINGZHOU_CATALOG, JINGZHOU_SHARD)).toBeLessThan(25);

    const kept = dropCatalogTwins([JINGZHOU_SHARD, HESHAN_SHARD], CATALOG);

    expect(kept.map((row) => row.id)).not.toContain("G1805540");
  });

  test("keeps a same-named row that is far away — a different place", () => {
    // 631 km apart, so the two Heshans are a shared romanisation rather than a
    // duplicate — and a filter keyed on the name alone would delete one of
    // them from the map.
    expect(haversineKm(HESHAN_CATALOG, HESHAN_SHARD)).toBeGreaterThan(25);

    expect(dropCatalogTwins([JINGZHOU_SHARD, HESHAN_SHARD], CATALOG)).toEqual([HESHAN_SHARD]);
  });
});

describe("mergeCountryCities", () => {
  test("catalog first, then the shard minus curated names and twins", () => {
    const merged = mergeCountryCities(
      "CN",
      CATALOG,
      [JINGZHOU_SHARD, HESHAN_SHARD, YANGSHUO_SHARD, ENSHI_SHARD],
      { G1811720: { description: "Enshi is a city in western Hubei.", image: null } }
    );

    // Both catalog rows, in their own order and ahead of the shard's; the
    // twin and the curated name gone; the two survivors in the order the
    // shard listed them.
    expect(merged.map((city) => city.qid)).toEqual([
      "Q71247",
      "Q1359423",
      "G1808316",
      "G1811720",
    ]);
    // The catalog row is the one that survived the twin, with the QID and the
    // attraction count the GeoNames row has none of.
    expect(merged[0]).toEqual(JINGZHOU_CATALOG);
    // And the enrichment index reached the rows it names, keyed by id.
    expect(merged[3].blurb).toBe("Enshi is a city in western Hubei.");
    expect(merged[2].blurb).toBeNull();
  });
});

describe("buildExplorerPlaces", () => {
  test("a Chinese catalog city gets one of the seven regions; any other country's gets its admin-1 label", () => {
    const chinese = buildExplorerPlaces([JINGZHOU_CATALOG], [], "CN");
    const jingzhou = chinese.find((place) => place.id === "Q71247")!;
    // Hubei is Central China, which is a region `fitForRegion` can answer for.
    expect(jingzhou.region).toBe("Central");
    expect(jingzhou.country).toBe("CN");

    const peruvian = buildExplorerPlaces([CUSCO], [], "PE");
    // Peru has no curated destinations, so the catalog city is the whole list.
    expect(peruvian).toHaveLength(1);
    expect(peruvian[0].region).toBe("Cuzco Department");
    expect(peruvian[0].country).toBe("PE");

    // The trap the keyword table sets: Botswana's Central District spells the
    // same as China's Central, and only the country gate keeps it from being
    // read as a Chinese region.
    const botswanan = buildExplorerPlaces(
      [{ ...CUSCO, qid: "G933773", name: "Serowe", province: "Central District" }],
      [],
      "BW"
    );
    expect(botswanan[0].region).toBe("Central District");
    expect(botswanan[0].country).toBe("BW");
  });

  test("a visited curated destination is left out", () => {
    const all = buildExplorerPlaces([], [], "CN");
    expect(all.map((place) => place.id)).toContain("beijing");

    const without = buildExplorerPlaces([], ["beijing"], "CN");

    expect(without.map((place) => place.id)).not.toContain("beijing");
    // One fewer, not none: `visited` subtracts a card, it does not empty the map.
    expect(without).toHaveLength(all.length - 1);
    // And the curated half is the open country's alone — every destination
    // states its own country, and Peru's list has none of China's.
    expect(buildExplorerPlaces([], [], "PE")).toEqual([]);
  });
});
