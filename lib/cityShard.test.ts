import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import {
  CITY_SHARD_INDEX_PATH,
  cityEnrichmentPath,
  cityLevel,
  cityShardPath,
  fetchCityEnrichment,
  fetchCityShard,
  parseCityEnrichment,
  parseCityShard,
  shardRowToMapCity,
  type CityShardRow,
} from "./cityShard";

const row = (over: Partial<CityShardRow> & Pick<CityShardRow, "id">): CityShardRow => ({
  n: "Cusco",
  lat: -13.52264,
  lon: -71.96734,
  a1: "Cusco",
  p: 428_450,
  tz: "America/Lima",
  ...over,
});

describe("shard paths", () => {
  test("are root-relative so a fetch resolves the same from every route", () => {
    // The same rule lib/isoTopology.ts and lib/globeTopology.ts pin for their
    // own assets: /plan and /trip/:id are at different depths.
    expect(cityShardPath("PE")).toBe("/cities/PE.json");
    expect(cityEnrichmentPath("PE")).toBe("/cities/enrich/PE.json");
    expect(CITY_SHARD_INDEX_PATH).toBe("/cities/index.json");
  });

  test("normalise the code the way getCountry does", () => {
    expect(cityShardPath(" pe ")).toBe("/cities/PE.json");
  });

  test("refuse anything that is not a two-letter code", () => {
    // The value reaches a URL. A country of "../../world-globe" would resolve
    // out of /cities/ entirely.
    expect(() => cityShardPath("../world-globe")).toThrow(/not a country code/);
    expect(() => cityShardPath("")).toThrow(/not a country code/);
    expect(() => cityEnrichmentPath("PER")).toThrow(/not a country code/);
  });
});

describe("parseCityShard", () => {
  const shard = { country: "PE", generatedAt: "2026-08-25", source: "GeoNames", cities: [row({ id: "G1" })] };

  test("accepts a well-formed shard", () => {
    expect(parseCityShard(shard).cities).toHaveLength(1);
  });

  test("throws rather than returning a half-parsed shard", () => {
    // A silently partial parse renders a picker quietly missing cities, which
    // is the failure lib/globeTopology.ts documents for its own asset.
    expect(() => parseCityShard(null)).toThrow(/city shard: root is not an object/);
    expect(() => parseCityShard({ ...shard, country: 7 })).toThrow(/country is not a country code/);
    expect(() => parseCityShard({ ...shard, cities: {} })).toThrow(/cities is not an array/);
  });

  test("throws when a row is missing a field the map needs", () => {
    expect(() => parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), lat: "-13" }] })).toThrow(
      /row 0 has a non-finite lat/
    );
    expect(() => parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), id: 1 }] })).toThrow(
      /row 0 has a malformed id/
    );
    expect(() => parseCityShard({ ...shard, cities: [{ ...row({ id: "Q170247" }) }] })).toThrow(
      /row 0 has a malformed id/
    );
  });

  test("throws on an out-of-range coordinate rather than trusting finiteness", () => {
    expect(() => parseCityShard({ ...shard, cities: [row({ id: "G1", lat: 394.5 })] })).toThrow(
      /row 0 has a non-finite lat/
    );
  });

  test("accepts a null a1, and coerces a missing or empty one to null", () => {
    const parse = (a1: unknown) =>
      parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), a1 }] }).cities[0].a1;
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
    // Empty string too: `a1` renders as MapCity.province, and "" would draw an
    // empty separator where a province name belongs.
    expect(parse("")).toBeNull();
    expect(parse("Cusco")).toBe("Cusco");
  });

  test("rejects a shard whose envelope names a different country than was asked for", () => {
    // Spec §6's fixture invariant, with teeth. Nothing downstream reads
    // `country` — fetchCityShard hands only `cities` to its callers — so a
    // CDN rewrite, a stale cache entry or a mis-copied fixture that serves
    // Peru's rows under /cities/JP.json would draw Peruvian cities on Japan's
    // map with every test still green. That is precisely the shape of PR #17's
    // inside-out globe fixture, and the only defence is a field that is
    // actually read.
    expect(() => parseCityShard(shard, "JP")).toThrow(/is PE's shard, but JP was requested/);
    expect(() => parseCityShard(shard, "pe")).not.toThrow();
    expect(() => parseCityShard(shard)).not.toThrow();
  });

  test("names the file in every message, so a browser error says which asset", () => {
    expect(() => parseCityShard(undefined)).toThrow(/^city shard:/);
  });
});

describe("fetchCityShard / fetchCityEnrichment", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("a missing enrichment file is an empty index; a missing shard is an error", async () => {
    // The asymmetry the module's docblock claims, exercised rather than
    // asserted in prose: the shard is required and the enrichment is not.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchCityEnrichment("PE")).resolves.toEqual({});
    await expect(fetchCityShard("PE")).rejects.toThrow(/city shard \/cities\/PE\.json: 404/);
  });

  test("passes the requested country through to the parser", async () => {
    // What makes the invariant above reach production rather than only the
    // fixtures: the URL and the envelope are checked against each other on
    // every real fetch.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ country: "PE", generatedAt: "x", source: "y", cities: [] }),
      }))
    );
    await expect(fetchCityShard("JP")).rejects.toThrow(/is PE's shard, but JP was requested/);
  });
});

describe("parseCityEnrichment", () => {
  test("reads the wrapped file", () => {
    const parsed = parseCityEnrichment({
      country: "CH",
      generatedAt: "x",
      source: "y",
      cities: { G2657928: { description: "Zermatt is a municipality.", image: "https://x/z.jpg" } },
    });
    expect(parsed.G2657928).toEqual({
      description: "Zermatt is a municipality.",
      image: "https://x/z.jpg",
    });
  });

  test("drops instead of throwing, so one bad entry does not cost the file", () => {
    // The opposite policy from parseCityShard, and for the same reason
    // lib/countryImagery.ts gives: a city with no description already renders,
    // so degrading beats failing.
    const parsed = parseCityEnrichment({
      cities: {
        G1: { description: "kept", image: null },
        G2: { description: 7, image: null },
        "not-an-id": { description: "dropped", image: null },
        G3: "not an object",
      },
    });
    expect(Object.keys(parsed)).toEqual(["G1"]);
  });

  test("is an empty index for anything unreadable, never a throw", () => {
    expect(parseCityEnrichment(null)).toEqual({});
    expect(parseCityEnrichment({ cities: [] })).toEqual({});
    expect(parseCityEnrichment("<html>login</html>")).toEqual({});
  });
});

describe("cityLevel", () => {
  test("maps population onto the three levels the map already draws", () => {
    // MapCity.level is a closed union that drives marker radius and labelling
    // in CountryMap.tsx:227-233. GeoNames has no equivalent field, and
    // population is the only signal in the seven-field record that carries the
    // same meaning — how prominent a marker should be.
    expect(cityLevel(7_737_002)).toBe("municipality");
    expect(cityLevel(1_000_000)).toBe("municipality");
    expect(cityLevel(999_999)).toBe("prefecture");
    expect(cityLevel(200_000)).toBe("prefecture");
    expect(cityLevel(199_999)).toBe("county");
    expect(cityLevel(0)).toBe("county");
  });
});

describe("shardRowToMapCity", () => {
  test("carries the enrichment blurb when there is one", () => {
    const city = shardRowToMapCity(row({ id: "G3941584" }), {
      G3941584: { description: "Cusco is a city in southeastern Peru.", image: null },
    });
    expect(city).toEqual({
      // `qid` is the field name MapCity has always used; §3.3 keeps
      // CatalogHit's shape unchanged, so a GeoNames id rides in it. The
      // G prefix is what keeps the two namespaces apart.
      qid: "G3941584",
      name: "Cusco",
      localName: null,
      province: "Cusco",
      lat: -13.52264,
      lon: -71.96734,
      population: 428_450,
      level: "prefecture",
      attractionCount: 0,
      blurb: "Cusco is a city in southeastern Peru.",
    });
  });

  test("leaves the blurb null for an unenriched city", () => {
    // Which renders exactly as a thin catalog city does today — an accepted
    // state in the current UI, not a hole.
    expect(shardRowToMapCity(row({ id: "G1" }), {}).blurb).toBeNull();
  });

  test("reports population zero as zero, not as null", () => {
    // 30,648 of the real rows carry an explicit 0. `population: null` means
    // "unknown" to lib/feasibility and the marker sizing; 0 means "nobody
    // lives here", and the two must not be confused.
    expect(shardRowToMapCity(row({ id: "G1", p: 0 }), {}).population).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The committed shards
// ---------------------------------------------------------------------------

const SHARD_DIR = join(process.cwd(), "public", "cities");
const INDEX_ASSET = join(SHARD_DIR, "index.json");

/**
 * The shards are committed build artefacts, not source — `npm ci` does not
 * produce them and `scripts/ingest-cities.mjs` needs network egress. Tests
 * that need them skip when they are missing rather than failing, exactly as
 * lib/isoTopology.test.ts and lib/globeTopology.test.ts do, so a checkout
 * without them is honest about what went unchecked instead of red for the
 * wrong reason.
 */
const hasAssets = existsSync(INDEX_ASSET);
const index = hasAssets
  ? (JSON.parse(readFileSync(INDEX_ASSET, "utf8")) as {
      countries: { code: string; count: number; generatedAt: string }[];
    })
  : null;

describe.skipIf(!hasAssets)("the committed city shards", () => {
  it("covers 246 countries", () => {
    // cities500 has 246, not cities15000's 244 — it adds IO (2 cities) and TK
    // (3). A count assertion written against the old dump would pass here and
    // hide two missing shards.
    expect(index!.countries).toHaveLength(246);
    expect(index!.countries.map((c) => c.code)).toContain("IO");
    expect(index!.countries.map((c) => c.code)).toContain("TK");
  });

  it("has a file for every country the index names, and no orphans", () => {
    // The fixture invariant §6 states: every city must have a country present
    // in the shard index. Enforced here at the file level, so an index entry
    // pointing at a 404 cannot pass.
    const named = new Set(index!.countries.map((c) => `${c.code}.json`));
    const onDisk = new Set(readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json") && f !== "index.json"));
    expect([...named].filter((f) => !onDisk.has(f)).sort()).toEqual([]);
    expect([...onDisk].filter((f) => !named.has(f)).sort()).toEqual([]);
  });

  it("parses every shard, with the counts the index promises", () => {
    const mismatched: string[] = [];
    for (const entry of index!.countries) {
      const shard = parseCityShard(
        JSON.parse(readFileSync(join(SHARD_DIR, `${entry.code}.json`), "utf8"))
      );
      if (shard.cities.length !== entry.count || shard.country !== entry.code) {
        mismatched.push(entry.code);
      }
    }
    expect(mismatched, `index disagrees with the shard for: ${mismatched.join(", ")}`).toEqual([]);
  });

  it("keeps every shard inside a single fetch a user will not notice", () => {
    // Measured: AR is the largest at 97,008 bytes raw / 21,647 gzipped. The
    // budget is what makes §3.2's "no loading state beyond what the map
    // already has" a checked claim rather than an aspiration.
    const oversized = index!.countries
      .map((c) => [c.code, statSync(join(SHARD_DIR, `${c.code}.json`)).size] as const)
      .filter(([, bytes]) => bytes > 150_000);
    expect(oversized, `oversized shards: ${JSON.stringify(oversized)}`).toEqual([]);
  });

  it("reaches the destinations population alone excluded", () => {
    // The 14 towns §2 names are the reason this design exists. Asserted by
    // geonameid, because Peru has two cities called Cusco.
    const has = (country: string, id: string) =>
      parseCityShard(
        JSON.parse(readFileSync(join(SHARD_DIR, `${country}.json`), "utf8"))
      ).cities.some((c) => c.id === id);
    expect(has("PE", "G3941584"), "Cusco").toBe(true);
    expect(has("CH", "G2657928"), "Zermatt").toBe(true);
    expect(has("JP", "G1857910"), "Kyoto").toBe(true);
    expect(has("JO", "G246008"), "Wadi Musa (Petra)").toBe(true);
    expect(has("GR", "G252920"), "Fira (Santorini)").toBe(true);
  });

  it("gives every shard file an envelope that names its own filename", () => {
    // The other half of the invariant above, at the file level: a shard whose
    // `country` disagrees with its path would be rejected at run time by
    // fetchCityShard, so it must never be committed in the first place.
    const wrong = index!.countries
      .map((c) => c.code)
      .filter((code) => {
        const raw = JSON.parse(readFileSync(join(SHARD_DIR, `${code}.json`), "utf8")) as {
          country?: string;
        };
        return raw.country !== code;
      });
    expect(wrong, `shards whose envelope disagrees with their filename: ${wrong.join(", ")}`).toEqual(
      []
    );
  });

  it("keeps GeoNames out of Wikidata's namespace everywhere", () => {
    // §3.3: merging the two id namespaces silently would be a real bug, since
    // MapExplorer.togglePlace resolves a tap by matching this field.
    const offenders: string[] = [];
    for (const entry of index!.countries) {
      const shard = JSON.parse(readFileSync(join(SHARD_DIR, `${entry.code}.json`), "utf8")) as {
        cities: { id: string }[];
      };
      for (const city of shard.cities) {
        if (!/^G[1-9][0-9]*$/.test(city.id)) offenders.push(`${entry.code}:${city.id}`);
      }
    }
    expect(offenders.slice(0, 10)).toEqual([]);
  });
});
