import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { Catalog, CatalogCity } from "./catalog";

/**
 * The two country-scoped readers of the Wikidata catalog: `searchCities`, the
 * server leg of place search, and `mapCities`, the server leg of the map's
 * markers. One fixture for both, because they take the same country argument
 * and answer from the same corpus — and because a second fixture would be a
 * second `CIP_CATALOG_PATH` override racing this one's cache.
 *
 * A fixture rather than the real catalog: the point is which *spellings* match
 * and which *countries* are in scope, and stating the corpus in the test is
 * what makes an empty result mean something. Pointed at through
 * `CIP_CATALOG_PATH`, the same override `CIP_DB_PATH` gives the store.
 *
 * Fixture invariant (spec §6): the corpus contains cities in MORE THAN ONE
 * country. Stating `country` on every row is not enough on its own — the read
 * boundary fills `"CN"` anyway, so an all-China fixture is satisfied by an
 * implementation that answers `[]` for every country but CN, which is not
 * scoping at all. The two Peruvian rows are what make the scoping assertions
 * mean something.
 */

const city = (over: Partial<CatalogCity> & Pick<CatalogCity, "qid" | "name">): CatalogCity => ({
  localName: null,
  province: "Shandong",
  country: "CN",
  lat: 36.6,
  lon: 117.0,
  population: 7_000_000,
  description: null,
  interests: [],
  image: null,
  level: "prefecture",
  ...over,
});

const FIXTURE: Catalog = {
  generatedAt: "2026-08-25",
  source: "fixture",
  cities: [
    // Real spellings from data/catalog.json, where 23 of 695 city names carry an
    // apostrophe and 2 carry diacritics. The person searching types neither.
    city({ qid: "Q1", name: "Tai'an" }),
    city({ qid: "Q2", name: "Ma'anshan", province: "Anhui" }),
    city({ qid: "Q3", name: "Ürümqi", province: "Xinjiang" }),
    // Synthetic: the curly apostrophe a paste from Wikipedia carries.
    city({ qid: "Q4", name: "Huai’an", province: "Jiangsu" }),
    // A control that must never match the queries below.
    city({ qid: "Q5", name: "Luoyang", province: "Henan" }),
    // Not China. Without it, every scoping assertion below is equally
    // satisfied by an implementation that hardcodes `country !== "CN" -> []`,
    // which is exactly the shape of bug the country parameter exists to
    // prevent: the fixture could not tell "scoped to what was asked for" from
    // "only CN ever answers".
    city({ qid: "Q6", name: "Trujillo", province: "La Libertad", country: "PE", lat: -8.11, lon: -79.03 }),
    // Shares a folded name with the curated Chinese destination "Dali", but is
    // in another country: the curated blocklist must be keyed by country, or
    // this place is unreachable and nothing says so.
    city({ qid: "Q7", name: "Dali", province: "Ica", country: "PE", lat: -14.0, lon: -75.7 }),
    // The Chinese Dali, which the curated Yunnan card already plans. Without a
    // row here, "the curated blocklist hides Dali in CN" is satisfied by an
    // empty corpus and would pass with no blocklist at all — the assertion
    // needs something present that has to be filtered OUT.
    city({ qid: "Q8", name: "Dali", province: "Yunnan", country: "CN", lat: 25.6, lon: 100.27 }),
  ],
  attractions: [],
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-catalog-"));
const fixturePath = path.join(dir, "catalog.json");
fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE), "utf8");
process.env.CIP_CATALOG_PATH = fixturePath;

// Imported after the override so the loader reads the fixture, not data/.
const { mapCities, resolveDestinations, searchCities } = await import("./catalog");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const names = (q: string, country = "CN") => searchCities(q, country).map((h) => h.name);
const markers = (country: string) => mapCities(country).map((c) => c.name).sort();

describe("searchCities — folding", () => {
  test("finds an apostrophe name from a query without one", () => {
    expect(names("taian")).toContain("Tai'an");
    expect(names("maanshan")).toContain("Ma'anshan");
  });

  test("treats a curly apostrophe as the same character", () => {
    expect(names("huaian")).toContain("Huai’an");
  });

  test("finds a diacritic name from an unaccented query", () => {
    expect(names("urumqi")).toContain("Ürümqi");
  });

  test("still matches what it always matched, and nothing more", () => {
    expect(names("luoyang")).toEqual(["Luoyang"]);
    expect(names("taian")).not.toContain("Luoyang");
    expect(names("zzzz")).toEqual([]);
  });
});

describe("searchCities — country scoping", () => {
  test("offers a Chinese city only while China is the country in scope", () => {
    // The Wikidata half of the catalog is all-China and always will be: the
    // 695 keep their QIDs so their enrichment survives, and everywhere else is
    // served from a GeoNames shard the client fetches. Returning them for a
    // Peru trip is the bug PlaceSearch's CATALOG_COUNTRIES allowlist used to
    // paper over.
    expect(names("luoyang", "CN")).toEqual(["Luoyang"]);
    expect(names("luoyang", "PE")).toEqual([]);
  });

  test("offers a Peruvian city only while Peru is the country in scope", () => {
    // The half a China-only fixture cannot state: this proves the filter reads
    // the country it was handed, rather than proving that CN is the only
    // country that ever answers.
    expect(names("trujillo", "PE")).toEqual(["Trujillo"]);
    expect(names("trujillo", "CN")).toEqual([]);
  });

  test("the curated blocklist is scoped to the country that curated the name", () => {
    // "Dali" is covered by the curated Yunnan destination in China and must
    // stay hidden there — and must stay REACHABLE in Peru. A global name
    // blocklist hides both, and nothing in the UI would ever say so. This is
    // the only test of `curatedPlaceNames`'s country keying.
    expect(names("dali", "CN")).toEqual([]);
    expect(names("dali", "PE")).toEqual(["Dali"]);
  });

  test("normalises the country the way getCountry does", () => {
    expect(names("luoyang", " cn ")).toEqual(["Luoyang"]);
  });

  test("an absent or malformed country is empty, not everything", () => {
    // Failing open here would serve the whole China catalog to a request that
    // named no country at all — the exact thing the route must not do.
    expect(names("luoyang", "")).toEqual([]);
    expect(names("luoyang", "CHN")).toEqual([]);
  });
});

/**
 * `mapCities` takes the same country argument as `searchCities` and filters the
 * same corpus by the same two rules, but it is a second copy of that filter in
 * the source and nothing shared enforces that the copies agree. Tested in its
 * own right for that reason: with `searchCities` alone covered, a `mapCities`
 * that ignored its country would put every Chinese marker on a Peru map and
 * every test would still be green.
 */
describe("mapCities — country scoping", () => {
  test("marks the country in scope and no other", () => {
    // Both halves, and stated as the whole corpus rather than as `toContain`:
    // the positive half alone is satisfied by a `mapCities` that returns
    // everything regardless of country.
    expect(markers("CN")).toEqual(["Huai’an", "Luoyang", "Ma'anshan", "Tai'an", "Ürümqi"]);
    expect(markers("PE")).toEqual(["Dali", "Trujillo"]);
  });

  test("the curated blocklist is scoped to the country that curated the name", () => {
    // The Yunnan card already puts Dali on the map with richer data, so the
    // bare catalog marker must not double it — in China. Peru's Dali has no
    // curated card anywhere and must keep its marker.
    expect(markers("CN")).not.toContain("Dali");
    expect(markers("PE")).toContain("Dali");
  });

  test("normalises the country the way getCountry does", () => {
    expect(markers(" pe ")).toEqual(["Dali", "Trujillo"]);
  });

  test("an absent or malformed country is empty, not everything", () => {
    // The map's version of the same failure: a country the route could not
    // parse must draw nothing, not the whole China catalog.
    expect(mapCities("")).toEqual([]);
    expect(mapCities("CHN")).toEqual([]);
  });
});

/**
 * The only branch production actually takes. Every one of the 695 cities in
 * data/catalog.json omits `country`, and scripts/ingest-destinations.mjs emits
 * no such key, so `LEGACY_CATALOG_COUNTRY` — not a value read off the artifact
 * — is what every real read resolves to. The typed `CatalogCity` fixtures
 * elsewhere all supply `country`, so they exercise the other branch.
 *
 * A raw JSON artifact is what makes this testable without a cast: a JSON
 * literal is not typed as `CatalogCity`, so it may legally omit the field.
 * `resolveDestinations` rather than `searchCities` because `CatalogHit` carries
 * no country; this routes loadCatalog -> catalogCityToDestination and exposes
 * the resolved value directly, which is the half `searchCities` cannot show.
 */
describe("catalog country default — the field the artifact does not carry", () => {
  const originalCatalogPath = process.env.CIP_CATALOG_PATH;

  afterAll(() => {
    process.env.CIP_CATALOG_PATH = originalCatalogPath;
  });

  test("fills CN for a country-less artifact, all the way through to a Destination", () => {
    const countryless = {
      generatedAt: "2026-01-01",
      source: "test",
      cities: [
        {
          qid: "Q1",
          name: "Nanjing",
          localName: "南京",
          province: "Jiangsu",
          lat: 32.06,
          lon: 118.8,
          population: 8000000,
          description: null,
          interests: [],
          image: null,
          level: "prefecture",
        },
      ],
      attractions: [],
    };
    const file = path.join(os.tmpdir(), `cip-countryless-catalog-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(countryless));
    // Pin a distinct mtime: loadCatalog caches on mtimeMs, and two fixtures
    // written in the same clock tick would silently serve the earlier one's
    // cache, which would make this assertion prove nothing about this file.
    const stamp = new Date("2020-01-01T00:00:00Z");
    fs.utimesSync(file, stamp, stamp);
    process.env.CIP_CATALOG_PATH = file;

    try {
      const resolved = resolveDestinations(["Q1"]);

      expect(resolved).toHaveLength(1);
      expect(resolved[0].country).toBe("CN");
    } finally {
      fs.unlinkSync(file);
    }
  });
});

describe("searchCities — legacy catalog read boundary", () => {
  const originalCatalogPath = process.env.CIP_CATALOG_PATH;

  afterAll(() => {
    process.env.CIP_CATALOG_PATH = originalCatalogPath;
  });

  test("reads a legacy artifact that spells the field chineseName and states no country", () => {
    // data/catalog.json on disk today predates BOTH the localName rename and
    // the country field. Both defaults live at this one boundary rather than
    // as `??` at every call site — which is exactly the distinction Task 10
    // drew for Destination.country.
    const legacy = {
      generatedAt: "2026-01-01",
      source: "test",
      cities: [
        {
          qid: "Q1",
          name: "Nanjing",
          chineseName: "南京",
          province: "Jiangsu",
          lat: 32.06,
          lon: 118.8,
          population: 8000000,
          description: null,
          interests: [],
          image: null,
          level: "prefecture",
        },
      ],
      attractions: [],
    };
    const file = path.join(os.tmpdir(), `cip-legacy-catalog-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(legacy));
    // A stamp of its own, for the reason the block above gives — and one that
    // differs from that block's 2020 stamp in particular: both fixtures carry
    // a Nanjing under qid Q1, so a shared mtime would serve the countryless
    // one out of cache and this test would pass while reading the wrong file.
    const stamp = new Date("2021-01-01T00:00:00Z");
    fs.utimesSync(file, stamp, stamp);
    process.env.CIP_CATALOG_PATH = file;

    try {
      const hits = searchCities("Nanjing", "CN", 5);

      expect(hits[0].localName).toBe("南京");
      expect(hits[0]).not.toHaveProperty("chineseName");
      // And it is reachable at all, which is the country default working.
      expect(hits).toHaveLength(1);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
