import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeAll, describe, expect, it, test, vi } from "vitest";
import fixture from "@/data/climate-anchors.json";
import {
  CLIMATE_INDEX_PATH,
  climatePath,
  fetchClimateIndex,
  fetchClimateShard,
  parseClimateIndex,
  parseClimateShard,
  type ClimateRow,
  type ClimateShard,
} from "./climateShard";

/**
 * A well-formed 60-int row: five 12-month blocks in the artifact's own order
 * (lo, hi, precip, cloud, td), lo <= hi in every month, every value well
 * inside the parser's guard bands. Not real CHELSA output — that is what
 * data/climate-anchors.json and the committed-shard suite below are for —
 * just a fixture shaped exactly like one.
 */
function row(): number[] {
  const lo = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  const hi = lo.map((v) => v + 10);
  const precip = [10, 12, 15, 20, 25, 30, 35, 30, 25, 20, 15, 10];
  const cloud = [40, 42, 45, 50, 55, 60, 58, 55, 50, 45, 42, 40];
  const td = [-2, -1, 0, 2, 4, 6, 8, 7, 5, 3, 1, -1];
  return [...lo, ...hi, ...precip, ...cloud, ...td];
}

/**
 * One shard envelope, in the shape task-6-report.md's "Shard shape" fact
 * records: a single `cities` object keyed by GeoNames id.
 */
const shard = (overrides: Record<string, unknown> = {}) => ({
  country: "PE",
  generatedAt: "2026-09-03T19:48:35.466Z",
  source: "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228",
  cities: { G1: row() },
  ...overrides,
});

describe("climate paths", () => {
  test("are root-relative so a fetch resolves the same from every route", () => {
    // The same rule lib/provinceTopology.ts's provincePath and
    // lib/cityShard.ts's cityShardPath pin for their own assets.
    expect(climatePath("PE")).toBe("/climate/PE.json");
    expect(CLIMATE_INDEX_PATH).toBe("/climate/index.json");
  });

  test("normalises the code the way provincePath and cityShardPath do", () => {
    expect(climatePath(" pe ")).toBe("/climate/PE.json");
  });

  test("refuses anything that is not a two-letter code", () => {
    // The value reaches a URL. A country of "../cities" would resolve out of
    // /climate/ entirely.
    expect(() => climatePath("../cities")).toThrow(/not a country code/);
    expect(() => climatePath("")).toThrow(/not a country code/);
    expect(() => climatePath("PER")).toThrow(/not a country code/);
  });
});

describe("parseClimateShard", () => {
  test("accepts a well-formed shard, projecting every field", () => {
    // Field by field, not merely counted — the same discipline
    // lib/cityShard.test.ts's equivalent test states the reason for: a
    // parser that rebuilds its own object is a separate chance to mis-wire a
    // field, and a mere toHaveLength stays green through that.
    const parsed = parseClimateShard(shard());
    expect(parsed.country).toBe("PE");
    expect(parsed.generatedAt).toBe("2026-09-03T19:48:35.466Z");
    expect(parsed.source).toBe(
      "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228"
    );
    expect(parsed.cities).toBeInstanceOf(Map);
    expect(parsed.cities.size).toBe(1);
    expect(parsed.cities.get("G1")).toEqual(row());
  });

  test("throws rather than returning a half-parsed shard, when the root is not an object", () => {
    expect(() => parseClimateShard(null)).toThrow(/^climate shard: root is not an object/);
    expect(() => parseClimateShard(undefined)).toThrow(/^climate shard: root is not an object/);
    expect(() => parseClimateShard(42)).toThrow(/^climate shard: root is not an object/);
    expect(() => parseClimateShard([])).toThrow(/^climate shard: root is not an object/);
  });

  test("throws when country is not a two-letter code", () => {
    expect(() => parseClimateShard(shard({ country: 7 }))).toThrow(/country is not a country code/);
    expect(() => parseClimateShard(shard({ country: "PER" }))).toThrow(/country is not a country code/);
    expect(() => parseClimateShard(shard({ country: "" }))).toThrow(/country is not a country code/);
  });

  test("throws when the envelope names a different country than was asked for", () => {
    // Spec §6's fixture invariant, the same one parseCityShard and
    // parseProvinceTopology enforce: nothing downstream reads `country` once
    // parsing succeeds, so a stale cache entry or a mis-copied fixture
    // serving one country's rows under another country's path would
    // otherwise be invisible.
    expect(() => parseClimateShard(shard(), "JP")).toThrow(/is PE's file, but JP was requested/);
    expect(() => parseClimateShard(shard(), "pe")).not.toThrow();
    expect(() => parseClimateShard(shard())).not.toThrow();
  });

  test("throws when generatedAt is missing or not a non-empty string", () => {
    expect(() => parseClimateShard(shard({ generatedAt: undefined }))).toThrow(
      /generatedAt is missing or not a string/
    );
    expect(() => parseClimateShard(shard({ generatedAt: "" }))).toThrow(
      /generatedAt is missing or not a string/
    );
    expect(() => parseClimateShard(shard({ generatedAt: 123 }))).toThrow(
      /generatedAt is missing or not a string/
    );
  });

  test("throws when source is missing or not a non-empty string", () => {
    expect(() => parseClimateShard(shard({ source: undefined }))).toThrow(
      /source is missing or not a string/
    );
    expect(() => parseClimateShard(shard({ source: "" }))).toThrow(/source is missing or not a string/);
    expect(() => parseClimateShard(shard({ source: 7 }))).toThrow(/source is missing or not a string/);
  });

  test("throws when cities is not a plain object", () => {
    expect(() => parseClimateShard(shard({ cities: [] }))).toThrow(/cities is not an object/);
    expect(() => parseClimateShard(shard({ cities: "nope" }))).toThrow(/cities is not an object/);
    expect(() => parseClimateShard(shard({ cities: null }))).toThrow(/cities is not an object/);
    expect(() => parseClimateShard(shard({ cities: undefined }))).toThrow(/cities is not an object/);
  });

  test("throws on a malformed city id", () => {
    // The same id shape lib/cityShard.ts's GEONAMES_ID pins, so a Wikidata
    // QID or a corrupted key cannot enter the Map.
    expect(() => parseClimateShard(shard({ cities: { Q170247: row() } }))).toThrow(
      /city id "Q170247" is malformed/
    );
    expect(() => parseClimateShard(shard({ cities: { G0: row() } }))).toThrow(/city id "G0" is malformed/);
    expect(() => parseClimateShard(shard({ cities: { "": row() } }))).toThrow(/city id "" is malformed/);
    expect(() => parseClimateShard(shard({ cities: { g123: row() } }))).toThrow(
      /city id "g123" is malformed/
    );
  });

  test("throws when a row is not an array", () => {
    expect(() => parseClimateShard(shard({ cities: { G1: "nope" } }))).toThrow(/row is not an array/);
    expect(() => parseClimateShard(shard({ cities: { G1: null } }))).toThrow(/row is not an array/);
    expect(() => parseClimateShard(shard({ cities: { G1: { 0: 1 } } }))).toThrow(/row is not an array/);
  });

  test("throws when a row is not exactly 60 entries", () => {
    // 60 positional integers with no per-month absence marker is exactly why
    // a short or long row cannot be half-accepted — see the module docblock.
    expect(() => parseClimateShard(shard({ cities: { G1: row().slice(0, 59) } }))).toThrow(
      /has 59 entries, expected 60/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: [...row(), 0] } }))).toThrow(
      /has 61 entries, expected 60/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: [] } }))).toThrow(/has 0 entries, expected 60/);
  });

  test("throws when a row entry is not a finite integer", () => {
    const bad = (i: number, value: unknown) => {
      const r = row();
      r[i] = value as number;
      return r;
    };
    expect(() => parseClimateShard(shard({ cities: { G1: bad(0, 5.5) } }))).toThrow(
      /row\[0\] is not a finite integer/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: bad(0, "5") } }))).toThrow(
      /row\[0\] is not a finite integer/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: bad(0, Number.NaN) } }))).toThrow(
      /row\[0\] is not a finite integer/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: bad(0, Number.POSITIVE_INFINITY) } }))).toThrow(
      /row\[0\] is not a finite integer/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: bad(0, null) } }))).toThrow(
      /row\[0\] is not a finite integer/
    );
  });

  test("throws when a month's lo is greater than hi", () => {
    // Both inside the guard band, so only the cross-check can catch it.
    const r = row();
    r[12] = r[0] - 1; // January: hi one degree below lo
    expect(() => parseClimateShard(shard({ cities: { G1: r } }))).toThrow(
      /month 0 has lo \(0\) greater than hi \(-1\)/
    );
  });

  test("throws when lo, hi or td falls outside -90..60 °C", () => {
    const badAt = (i: number, value: number) => {
      const r = row();
      r[i] = value;
      return r;
    };
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(0, -91) } }))).toThrow(
      /lo \(-91\) is outside the -90\.\.60 guard band/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(12, 61) } }))).toThrow(
      /hi \(61\) is outside the -90\.\.60 guard band/
    );
    // The docblock's own example: an unscaled tasmax decode (skipping the
    // -273.15 CHELSA offset) would report Singapore at 298 °C.
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(12, 298) } }))).toThrow(
      /hi \(298\) is outside the -90\.\.60 guard band/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(48, -91) } }))).toThrow(
      /td \(-91\) is outside the -90\.\.60 guard band/
    );
  });

  test("throws when precip or cloud falls outside its guard band", () => {
    const badAt = (i: number, value: number) => {
      const r = row();
      r[i] = value;
      return r;
    };
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(24, 10_001) } }))).toThrow(
      /precip \(10001\) is outside the 0\.\.10000 guard band/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(24, -1) } }))).toThrow(
      /precip \(-1\) is outside the 0\.\.10000 guard band/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(36, 101) } }))).toThrow(
      /cloud \(101\) is outside the 0\.\.100 guard band/
    );
    expect(() => parseClimateShard(shard({ cities: { G1: badAt(36, -1) } }))).toThrow(
      /cloud \(-1\) is outside the 0\.\.100 guard band/
    );
  });

  test("accepts each guard band's own edges, both sides", () => {
    // Committed data cannot pin these the way it pins the id shape or the
    // block layout: the whole point of a guard band this wide is that real
    // CHELSA output never approaches it (measured -46..47 across everything
    // committed). So the edges are only ever exercised here.
    const at = (i: number, value: number): number => {
      const r = row();
      r[i] = value;
      return parseClimateShard(shard({ cities: { G1: r } })).cities.get("G1")![i];
    };
    // td (index 48, January) shares the -90..60 band with lo/hi but has no
    // lo<=hi entanglement, so it alone can pin both edges without also
    // having to move a second field in step.
    expect(at(48, -90)).toBe(-90);
    expect(at(48, 60)).toBe(60);
    expect(at(24, 0)).toBe(0); // precip floor
    expect(at(24, 10_000)).toBe(10_000); // precip ceiling
    expect(at(36, 0)).toBe(0); // cloud floor
    expect(at(36, 100)).toBe(100); // cloud ceiling
  });

  test("names the file in every message, so a browser error says which asset", () => {
    expect(() => parseClimateShard(undefined)).toThrow(/^climate shard:/);
    expect(() => parseClimateShard(shard({ cities: { Q1: row() } }))).toThrow(/^climate shard:/);
  });
});

describe("parseClimateIndex", () => {
  const index = (overrides: Record<string, unknown> = {}) => ({
    generatedAt: "2026-09-03T19:48:35.466Z",
    countries: [{ code: "AD", count: 20 }],
    ...overrides,
  });

  test("accepts a well-formed index", () => {
    expect(parseClimateIndex(index())).toEqual({
      generatedAt: "2026-09-03T19:48:35.466Z",
      countries: [{ code: "AD", count: 20 }],
    });
  });

  test("throws rather than returning a half-parsed index, when the root is not an object", () => {
    expect(() => parseClimateIndex(null)).toThrow(/^climate index: root is not an object/);
    expect(() => parseClimateIndex("nope")).toThrow(/^climate index: root is not an object/);
  });

  test("throws when generatedAt is missing or not a non-empty string", () => {
    expect(() => parseClimateIndex(index({ generatedAt: undefined }))).toThrow(
      /generatedAt is missing or not a string/
    );
    expect(() => parseClimateIndex(index({ generatedAt: "" }))).toThrow(
      /generatedAt is missing or not a string/
    );
  });

  test("throws when countries is not an array", () => {
    expect(() => parseClimateIndex(index({ countries: {} }))).toThrow(/countries is not an array/);
    expect(() => parseClimateIndex(index({ countries: undefined }))).toThrow(/countries is not an array/);
  });

  test("throws on a malformed entry", () => {
    expect(() => parseClimateIndex(index({ countries: [null] }))).toThrow(/entry 0 is not an object/);
    expect(() => parseClimateIndex(index({ countries: [{ code: 7, count: 1 }] }))).toThrow(
      /entry 0 has a bad code/
    );
    expect(() => parseClimateIndex(index({ countries: [{ code: "ADX", count: 1 }] }))).toThrow(
      /entry 0 has a bad code/
    );
    expect(() => parseClimateIndex(index({ countries: [{ code: "AD", count: -1 }] }))).toThrow(
      /entry 0 \(AD\) has a bad count/
    );
    expect(() => parseClimateIndex(index({ countries: [{ code: "AD", count: 1.5 }] }))).toThrow(
      /entry 0 \(AD\) has a bad count/
    );
    expect(() => parseClimateIndex(index({ countries: [{ code: "AD" }] }))).toThrow(
      /entry 0 \(AD\) has a bad count/
    );
  });
});

describe("fetchClimateShard / fetchClimateIndex", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("fetchClimateShard throws on a non-ok response instead of trying to parse an error page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(fetchClimateShard("PE", fetchImpl)).rejects.toThrow(
      /climate shard \/climate\/PE\.json: 404/
    );
    expect(fetchImpl).toHaveBeenCalledWith("/climate/PE.json");
  });

  test("fetchClimateShard passes the requested country through to the parser", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(shard({ country: "PE" })),
    }) as unknown as typeof fetch;
    await expect(fetchClimateShard("JP", fetchImpl)).rejects.toThrow(/is PE's file, but JP was requested/);
  });

  test("fetchClimateShard defaults to the global fetch when no fetchImpl is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchClimateShard("PE")).rejects.toThrow(/climate shard \/climate\/PE\.json: 500/);
  });

  test("fetchClimateIndex throws on a non-ok response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(fetchClimateIndex(fetchImpl)).rejects.toThrow(
      /climate index \/climate\/index\.json: 404/
    );
    expect(fetchImpl).toHaveBeenCalledWith("/climate/index.json");
  });

  test("fetchClimateIndex resolves a well-formed index", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ generatedAt: "x", countries: [{ code: "AD", count: 20 }] }),
    }) as unknown as typeof fetch;
    await expect(fetchClimateIndex(fetchImpl)).resolves.toEqual({
      generatedAt: "x",
      countries: [{ code: "AD", count: 20 }],
    });
  });
});

// ---------------------------------------------------------------------------
// The committed climate shards
// ---------------------------------------------------------------------------

const CLIMATE_DIR = join(process.cwd(), "public", "climate");
const CLIMATE_INDEX_ASSET = join(CLIMATE_DIR, "index.json");
const CITY_DIR = join(process.cwd(), "public", "cities");

/**
 * The shards are committed build artefacts, not source — `npm ci` does not
 * produce them and `scripts/ingest-climate.mjs` needs ~11 GB of network
 * egress and a cached raster set. Tests that need them skip when they are
 * missing rather than failing, exactly as lib/cityShard.test.ts and
 * lib/provinceTopology.test.ts do for their own assets, so a checkout
 * without them is honest about what went unchecked instead of red for the
 * wrong reason.
 */
const hasAssets = existsSync(CLIMATE_INDEX_ASSET);

const climateCodes = (): string[] =>
  readdirSync(CLIMATE_DIR)
    .filter((name) => /^[A-Z]{2}\.json$/.test(name))
    .map((name) => name.slice(0, 2));

const readClimateShard = (code: string): ClimateShard =>
  parseClimateShard(JSON.parse(readFileSync(join(CLIMATE_DIR, `${code}.json`), "utf8")), code);

/** The fixture's anchors, reshaped to just what this suite reads off them. */
interface ClimateAnchor {
  id: string;
  name: string;
  row: number[];
}
const ANCHORS: ClimateAnchor[] = fixture.cities.map((c) => ({ id: c.id, name: c.name, row: c.row }));

describe.skipIf(!hasAssets)("the committed climate shards", () => {
  /**
   * Parsed once and shared across the tests below rather than re-parsed by
   * each: the id-set test, the "twelve values per block" test and the
   * anchor regression test all need every one of the 58,757 rows already
   * parsed, and running that three times over is wasted work for no extra
   * coverage. `beforeAll` (not a module-level constant) so a malformed
   * committed shard fails as an ordinary test failure — reported against
   * this describe block — rather than crashing the whole file at load time,
   * which would take the parser and licence suites above down with it.
   */
  let climateShards: ClimateShard[] = [];
  let climateRowsById: Map<string, ClimateRow> = new Map();
  let climateIdOccurrences: Map<string, number> = new Map();

  beforeAll(() => {
    climateShards = climateCodes().map((code) => readClimateShard(code));
    for (const shardFile of climateShards) {
      for (const [id, cityRow] of shardFile.cities) {
        climateRowsById.set(id, cityRow);
        climateIdOccurrences.set(id, (climateIdOccurrences.get(id) ?? 0) + 1);
      }
    }
  });

  it("names exactly 246 countries", () => {
    // toHaveLength, never toBeGreaterThan: a 247th country (or a 245th) is a
    // decision for a human, not something this test should shrug past.
    const raw = JSON.parse(readFileSync(CLIMATE_INDEX_ASSET, "utf8"));
    const parsedIndex = parseClimateIndex(raw);
    expect(parsedIndex.countries).toHaveLength(246);
    const named = parsedIndex.countries.map((c) => c.code).sort();
    const onDisk = climateCodes().sort();
    expect(named).toEqual(onDisk);
  });

  it("its city-id set equals public/cities/, in BOTH directions", () => {
    // §12.3's join is total in both directions (task-6-report.md, fact 3).
    // Checked independently of the index/shard-code cross-check above: this
    // reads every public/cities/<CC>.json on disk for its own ids, so a
    // country present in one catalog and not the other shows up here even
    // if the two directory listings otherwise agreed.
    const cityIds = new Set<string>();
    const cityCodes = readdirSync(CITY_DIR)
      .filter((f) => /^[A-Z]{2}\.json$/.test(f))
      .map((f) => f.slice(0, 2));
    for (const code of cityCodes) {
      const raw = JSON.parse(readFileSync(join(CITY_DIR, `${code}.json`), "utf8")) as {
        cities: { id: string }[];
      };
      for (const c of raw.cities) cityIds.add(c.id);
    }

    const climateIds = new Set(climateRowsById.keys());
    const missingFromClimate = [...cityIds].filter((id) => !climateIds.has(id));
    const extraInClimate = [...climateIds].filter((id) => !cityIds.has(id));
    expect(
      missingFromClimate,
      `${missingFromClimate.length} public/cities/ ids missing from climate (first 5: ${missingFromClimate.slice(0, 5).join(", ")})`
    ).toEqual([]);
    expect(
      extraInClimate,
      `${extraInClimate.length} climate ids not in public/cities/ (first 5: ${extraInClimate.slice(0, 5).join(", ")})`
    ).toEqual([]);

    // A Set would hide this: it collapses duplicates instead of reporting
    // them. Counting occurrences is what actually proves "no id appears in
    // two shards" (task-6-report.md, fact 3).
    const duplicated = [...climateIdOccurrences.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(
      duplicated,
      `ids appearing in more than one climate shard: ${duplicated.slice(0, 5).join(", ")}`
    ).toEqual([]);
  });

  it("no shard exceeds the gzip budget, and the cap is NOT saturated", () => {
    // Restated from scripts/ingest-climate.mjs rather than imported — the
    // same convention lib/provinceTopology.test.ts:348-353 follows, for the
    // same reason: importing the build script into a lib test would pull in
    // whatever heavy deps it needs (geotiff, in this case) for one number.
    //
    // Two budgets, not one. RAW_BUDGET is the pre-gzip tripwire the climate
    // build itself gates on — 700,000 B, not lib/cityShard.test.ts's
    // 150,000: five committed climate shards (ID, MY, PA, PH, CO) are
    // 150-152 KB RAW on their own, so copying the city-shard suite's
    // raw-150,000 check here would fail on real, correct, committed data.
    // GZIP_BUDGET (150,000 B) is what actually crosses the wire.
    const GZIP_BUDGET = 150_000;
    const RAW_BUDGET = 700_000;

    const sizes = climateCodes()
      .map((code) => {
        const bytes = readFileSync(join(CLIMATE_DIR, `${code}.json`));
        return [code, bytes.length, gzipSync(bytes).length] as const;
      })
      .sort((a, b) => b[2] - a[2]);

    const overRaw = sizes.filter(([, raw]) => raw > RAW_BUDGET);
    expect(overRaw, `over the ${RAW_BUDGET} B raw budget: ${JSON.stringify(overRaw)}`).toEqual([]);

    const overGzip = sizes.filter(([, , gzip]) => gzip > GZIP_BUDGET);
    expect(overGzip, `over the ${GZIP_BUDGET} B gzip budget: ${JSON.stringify(overGzip)}`).toEqual([]);

    // Unlike the city- and province-shard suites, this cap is NOT binding:
    // the worst real shard (IN) gzips to 39,490 B, 26.3% of the 150,000 B
    // cap (task-6-report.md, Fix 1). So the tripwire below is not "is the
    // cap still saturated" — it never was — but "would a refresh that
    // doubled the artifact go unnoticed": half the cap is a wide enough
    // berth for CHELSA's own numbers to drift across a future release, but
    // a duplicated block or a doubled sample count would cross it.
    const worstGzip = sizes[0][2];
    expect(worstGzip, `worst gzip size is ${worstGzip} B — the tripwire, not the cap`).toBeLessThan(
      GZIP_BUDGET / 2
    );
  });

  it("every shard has twelve values per block, with no missing months", () => {
    // Every row already parsed successfully building `climateShards` in
    // beforeAll above: parseClimateShard's own checks — exactly 60 finite
    // integers, the five 12-month blocks, the guard bands, lo <= hi — ran
    // against all 58,757 committed rows to get here, and a shard missing a
    // month (wrong array length) would already have thrown. See the module
    // docblock, "Why one bad row refuses the whole shard", for why that
    // failure is a thrown error rather than a silently short row. What is
    // left to check here is the envelope metadata parseClimateShard accepts
    // but does not otherwise compare across files.
    expect(climateShards).toHaveLength(246);

    const badMeta = climateShards
      .filter((s) => s.generatedAt === "" || s.source === "")
      .map((s) => s.country);
    expect(badMeta, `shards with an empty generatedAt or source: ${badMeta.join(", ")}`).toEqual([]);

    const sources = new Set(climateShards.map((s) => s.source));
    expect([...sources], "the source string is not identical across all 246 shards").toHaveLength(1);
  });

  it("the ten catalogued anchor cities reproduce the artifact in all sixty positions", () => {
    // The strongest regression guard on the committed artifact this suite
    // has. data/climate-anchors.json's rows came from
    // scripts/sample-climate-anchors.mjs — an entirely separate
    // implementation that re-opens the cached CHELSA rasters and re-derives
    // each tuple with its own copies of pixelFor/decodeSample/tupleFor —
    // sampling the SAME cities' coordinates the real ingest also sampled.
    // Every other test in this file only checks the committed shard's own
    // internal consistency; this is the one test that can catch the ingest
    // and this fixture silently disagreeing — a scale factor, an off-by-one
    // row, a wrong month.
    //
    // 10 of the fixture's 19 entries: the other 9 are Q-prefixed curated
    // Chinese cities (spec §9.5's calibration anchors), absent from the
    // GeoNames-keyed climate shards by design (task-6-report.md).
    const gAnchors = ANCHORS.filter((c) => c.id.startsWith("G"));
    expect(gAnchors).toHaveLength(10);

    const mismatched: string[] = [];
    for (const anchor of gAnchors) {
      const shardRow = climateRowsById.get(anchor.id);
      if (!shardRow || JSON.stringify(shardRow) !== JSON.stringify(anchor.row)) {
        mismatched.push(`${anchor.name} (${anchor.id})`);
      }
    }
    expect(
      mismatched,
      `anchors whose row disagrees with the committed shard: ${mismatched.join(", ")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Licence non-additions
// ---------------------------------------------------------------------------

const CONTRACTS_TEST_TEXT = readFileSync(join(process.cwd(), "lib", "contracts.test.ts"), "utf8");
const CITIES_REPORT_TEXT = readFileSync(join(process.cwd(), "data", "cities-report.md"), "utf8");
const CLIMATE_REPORT_TEXT = readFileSync(join(process.cwd(), "data", "climate-report.md"), "utf8");

const MENTIONS_CLIMATE_OR_CHELSA = /climate|chelsa/i;

/**
 * From `openIndex` (which must point at a `[`) to its matching close
 * bracket, by depth. Robust to a nested array inside the literal (C7's
 * `ALLOWED` has one, `mountedIn: [...]`) that a naive "next `]`" search
 * would stop at early — the one bracket pair that appears inside a STRING
 * in either literal this file reads (`"app/b/[code]/page.tsx"`) is itself
 * balanced, so counting every `[`/`]` character, string contents included,
 * still nets out correctly here.
 */
function bracketSlice(text: string, openIndex: number): string {
  if (text[openIndex] !== "[") {
    throw new Error(`bracketSlice: character at index ${openIndex} is not "["`);
  }
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  throw new Error("bracketSlice: unbalanced brackets — no matching close found");
}

/** `CITY_NAME_TOKENS`' own array literal (contracts.test.ts:664-670). */
function cityNameTokensLiteral(text: string): string {
  const marker = "const CITY_NAME_TOKENS";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) throw new Error(`lib/contracts.test.ts no longer declares ${marker}`);
  const openIndex = text.indexOf("[", markerIndex);
  if (openIndex === -1) throw new Error(`${marker}: no "[" found after it`);
  return bracketSlice(text, openIndex);
}

/** C7's `ALLOWED` array literal (contracts.test.ts:790-841). */
function c7AllowedLiteral(text: string): string {
  // C4 (contracts.test.ts:196) ALSO declares a `const ALLOWED`, with a
  // narrower `{ path; why }` type. Distinguished here by the `mountedIn`
  // field only C7's version has — a plain "const ALLOWED" search would find
  // C4's first and silently check the wrong contract's allowlist.
  const marker = "mountedIn: readonly string[]; why: string }> = [";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("lib/contracts.test.ts: C7's ALLOWED (the one typed with mountedIn) was not found");
  }
  const openIndex = markerIndex + marker.length - 1; // the marker's own trailing "["
  return bracketSlice(text, openIndex);
}

/** The six-file `test.each([` GeoNamesCredit floor (contracts.test.ts:1174-1181). */
function shareBriefingFloorLiteral(text: string): string {
  const marker = "test.each([";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) throw new Error("lib/contracts.test.ts: no test.each([ call found");
  const openIndex = markerIndex + marker.length - 1;
  const body = bracketSlice(text, openIndex);
  const paths = [...body.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (paths.length !== 6 || paths[paths.length - 1] !== "components/shell/ShareBriefing.tsx") {
    throw new Error(
      `lib/contracts.test.ts: expected the six-path GeoNamesCredit floor ending in ` +
        `ShareBriefing.tsx, got ${JSON.stringify(paths)} — is this still the only test.each([ call?`
    );
  }
  return body;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * CC0 (the climate artifact's licence) imposes no attribution condition, so
 * there is nothing here for C7 — the CC BY 4.0 machinery lib/contracts.test
 * .ts builds for GeoNames — to grow. C7 cannot see `data/` or `public/` at
 * all: it scans `.tsx` source under app/ and components/ for tokens that
 * carry CITY names (destinationName, MapCity, CatalogHit — the array
 * asserted on below) and walks a fixed allowlist, neither of which has any
 * way to notice a JSON artifact under public/climate/ or a licence line in
 * data/climate-report.md. So no C7 test needed to change when Task 6 added
 * that artifact, and the brief's Step 3 is explicit: assert that nothing
 * did. Every test below is an absence check for exactly that reason — it is
 * not a gap in coverage that they assert `false`, it is the point.
 */
describe("the climate artifact adds nothing to the CC BY attribution machinery", () => {
  test("CITY_NAME_TOKENS names no climate token", () => {
    expect(MENTIONS_CLIMATE_OR_CHELSA.test(cityNameTokensLiteral(CONTRACTS_TEST_TEXT))).toBe(false);
  });

  test("C7's ALLOWED names no climate surface", () => {
    expect(MENTIONS_CLIMATE_OR_CHELSA.test(c7AllowedLiteral(CONTRACTS_TEST_TEXT))).toBe(false);
  });

  test("the six-file GeoNamesCredit floor names no climate surface", () => {
    expect(MENTIONS_CLIMATE_OR_CHELSA.test(shareBriefingFloorLiteral(CONTRACTS_TEST_TEXT))).toBe(false);
  });

  test("data/cities-report.md's Attribution section names no climate source", () => {
    const heading = /^## Attribution\r?$/m.exec(CITIES_REPORT_TEXT);
    expect(heading, "data/cities-report.md has no ## Attribution heading").not.toBeNull();
    const afterHeading = CITIES_REPORT_TEXT.slice(heading!.index + heading![0].length);
    const nextHeading = /^## /m.exec(afterHeading);
    const section = nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;
    expect(MENTIONS_CLIMATE_OR_CHELSA.test(section)).toBe(false);
  });

  test("no ChelsaCredit component exists under components/", () => {
    const matches = walkFiles(join(process.cwd(), "components")).filter((p) => /ChelsaCredit/i.test(p));
    expect(matches).toEqual([]);
  });

  test("data/climate-report.md credits CHELSA under ## Source, not ## Attribution", () => {
    // CC0 waives the licence conditions, so this is deliberately a courtesy
    // credit under ## Source rather than the ## Attribution heading
    // data/cities-report.md uses for GeoNames' CC BY 4.0 obligation — see
    // data/climate-report.md's own "## Source" section for the same point
    // in its own words.
    expect(/^## Source\r?$/m.test(CLIMATE_REPORT_TEXT)).toBe(true);
    expect(/^## Attribution\r?$/m.test(CLIMATE_REPORT_TEXT)).toBe(false);
  });
});
