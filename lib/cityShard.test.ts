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

/**
 * `n` and `a1` must stay DIFFERENT strings. "Cuzco Department" is the real
 * admin-1 name GeoNames gives Cusco (checked against public/cities/PE.json),
 * and the difference is load-bearing: while both fields read "Cusco", the
 * exhaustive toEqual in shardRowToMapCity below was blind to `name` and
 * `province` being wired to each other's source field, because both spellings
 * of that bug produced the same object.
 */
const row = (over: Partial<CityShardRow> & Pick<CityShardRow, "id">): CityShardRow => ({
  n: "Cusco",
  lat: -13.52264,
  lon: -71.96734,
  a1: "Cuzco Department",
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

  test("accepts a well-formed shard, projecting every field of the row", () => {
    // Field by field, not merely counted. The parser rebuilds each row as a
    // fresh object literal rather than passing the input through, so every
    // field is a separate chance to mis-wire — and a `toHaveLength(1)` stays
    // green for all of them. Swapped lat/lon relocates the city to a
    // believable wrong place, a hardcoded `p` resizes every marker, a dropped
    // `tz` breaks arrival times, and nothing else in this file reads `n`, `p`
    // or `tz` off a parsed row at all.
    expect(parseCityShard(shard)).toEqual({
      country: "PE",
      generatedAt: "2026-08-25",
      source: "GeoNames",
      cities: [
        {
          id: "G1",
          n: "Cusco",
          lat: -13.52264,
          lon: -71.96734,
          a1: "Cuzco Department",
          p: 428_450,
          tz: "America/Lima",
        },
      ],
    });
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

  test("pins each coordinate limit from both sides", () => {
    // The committed data cannot pin these: its extremes are lat -54.93/78.22
    // and lon -179.12/179.36, and not one of the 58,742 rows sits at exactly
    // ±90 or ±180. So a range narrowed from `>=`/`<=` to `>`/`<`, or a
    // latitude handed longitude's limit, would pass every other test here AND
    // every shard on disk, and would only ever misbehave on a country nobody
    // sampled.
    const at = (over: Partial<CityShardRow>) =>
      parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), ...over }] }).cities[0];
    expect(at({ lat: 90 }).lat).toBe(90);
    expect(at({ lat: -90 }).lat).toBe(-90);
    expect(at({ lon: 180 }).lon).toBe(180);
    expect(at({ lon: -180 }).lon).toBe(-180);

    const bad = (over: Partial<CityShardRow>) => () =>
      parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), ...over }] });
    // Half a degree past each limit, which is the size a real regression is.
    // The 394.5 case above sits 304° out — far enough to stay rejected even if
    // latitude were checked against longitude's ±180, so it cannot tell the
    // two limits apart. 90.5 can, and that is its whole job.
    expect(bad({ lat: 90.5 })).toThrow(/row 0 has a non-finite lat/);
    expect(bad({ lat: -90.5 })).toThrow(/row 0 has a non-finite lat/);
    expect(bad({ lon: 180.5 })).toThrow(/row 0 has a non-finite lon/);
    // Before these, the suite had no bad longitude at all, so the lon check
    // could be deleted outright and stay green. 200 is the coarse half of that
    // guard: out of range on any reading, so it fails only if longitude goes
    // genuinely unchecked.
    expect(bad({ lon: 200 })).toThrow(/row 0 has a non-finite lon/);
  });

  test("accepts a null a1, and coerces a missing or empty one to null", () => {
    const parse = (a1: unknown) =>
      parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), a1 }] }).cities[0].a1;
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
    // Empty string too: `a1` renders as MapCity.province, and "" would draw an
    // empty separator where a province name belongs.
    expect(parse("")).toBeNull();
    expect(parse("Cuzco Department")).toBe("Cuzco Department");
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
    //
    // json() rejects the way a real 404 does — the body is an error page, not
    // JSON, so SyntaxError is what the browser actually raises. That is what
    // makes this stub load-bearing: against a `json: async () => ({})` stub
    // the `!response.ok` guard could be deleted outright and the assertion
    // below would stay green, because parseCityEnrichment({}) is also {}. The
    // empty index has to come from the guard, not from parsing an error page.
    const fetchMock = vi.fn(async (_path: string, _init?: unknown) => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCityEnrichment("PE")).resolves.toEqual({});
    // And that it asked for the enrichment file, not the shard: the two
    // fetchers differ only in the path helper they call, and nothing else in
    // this file looks at the enrichment side's URL.
    expect(fetchMock).toHaveBeenCalledWith("/cities/enrich/PE.json", undefined);
    await expect(fetchCityShard("PE")).rejects.toThrow(/city shard \/cities\/PE\.json: 404/);
    expect(fetchMock).toHaveBeenLastCalledWith("/cities/PE.json", undefined);
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
    // population is the only signal in the nine-field record that carries the
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
      // `name` and `province` are fed by different source fields and must read
      // as different strings, or this otherwise-exhaustive comparison cannot
      // see the two being crossed.
      name: "Cusco",
      localName: null,
      province: "Cuzco Department",
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
    // 4,721 of the 58,742 committed shard rows carry an explicit 0 — a real
    // GeoNames place that the dump gives no population figure for. (The raw
    // cities500 dump has 30,648 such rows out of 235,483; the shards keep only
    // the top 750 per country, so most of them never arrive.) `population:
    // null` means "unknown" to lib/feasibility and the marker sizing; 0 means
    // "nobody lives here", and the two must not be confused.
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

  it("keeps every shard at or under the top-750-per-country cut", () => {
    // "Pool = cities500, keep top 750 per country" is a Global Constraint, and
    // this is its only check. The size budget above does not stand in for it:
    // 750 rows is ~97 KB, so a shard could carry roughly 1,100 cities before
    // 150 KB fired. The cap is saturated — the largest shard holds exactly
    // 750 — so a broken cut shows up one row past the boundary rather than as
    // an overshoot a byte count would notice.
    const counts = index!.countries.map(
      (c) =>
        [
          c.code,
          parseCityShard(JSON.parse(readFileSync(join(SHARD_DIR, `${c.code}.json`), "utf8"))).cities
            .length,
        ] as const
    );
    const over = counts.filter(([, n]) => n > 750);
    expect(over, `shards past the 750-city cut: ${JSON.stringify(over)}`).toEqual([]);
    // And that the cut is still the binding constraint it is documented to be.
    // If nothing reached 750, the assertion above would be pinning a limit no
    // shard approaches — which is how a cap silently stops being applied at
    // all.
    expect(Math.max(...counts.map(([, n]) => n))).toBe(750);
  });

  it("orders every shard by population descending, not by the ranking score", () => {
    // "Ranking decides inclusion only; display sorts by population" is the
    // other Global Constraint with no coverage, and lib/cityShard.ts:58
    // publishes it as a guarantee of the CityShard type. Callers render
    // `cities` in array order and never sort, so a shard left in score order
    // would stack obscure places above capitals in the picker with nothing
    // erroring anywhere.
    const unsorted: string[] = [];
    for (const entry of index!.countries) {
      const { cities } = parseCityShard(
        JSON.parse(readFileSync(join(SHARD_DIR, `${entry.code}.json`), "utf8"))
      );
      const at = cities.findIndex((c, i) => i > 0 && c.p > cities[i - 1].p);
      if (at !== -1) unsorted.push(`${entry.code}@${at}`);
    }
    expect(unsorted, `shards not in population-descending order: ${unsorted.join(", ")}`).toEqual([]);
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
