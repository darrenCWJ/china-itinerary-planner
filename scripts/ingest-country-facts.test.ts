/**
 * Covers `run()` — the seam between the pure build and its network and
 * filesystem edges — and through it every branch of the gate by BEHAVIOUR
 * rather than by source position. The module's entry-point guard means
 * importing it here does not also run the ingest.
 *
 * The pure functions `run()` composes were moved into scripts/country-facts/
 * on 2026-09-07 (spec 2026-09-07-unscheduled-items §2.1) and their describes
 * went with them: parse.test.ts, picks.test.ts, curated.test.ts, facts.test.ts,
 * gate.test.ts, io.test.ts and report.test.ts. Every describe below is this
 * file's own, unchanged.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture and `run()` is driven with an injected loader.
 *
 * The upstream shapes below are the ones Investigation 3 MEASURED on
 * 2026-08-27 — `BZ 550/220`, `FR 400/230`, `NL EUR/USD/AWG/XCG`,
 * `CZ CZK/203`, `PL PLN/PLZ`, `ZW` x13, and Q60740126 across 39 countries —
 * not shapes invented to make a rule look reachable. A withhold rule tested
 * only against a fixture nobody ever saw upstream proves the code compiles,
 * not that it defends anything.
 *
 * Nothing below declares a fixture or a feed helper. `PLUG_ITEM`,
 * `PLUG_ARTICLE`, `entity`, `FILLER_POOL` and `SAMPLE_GROWTH_GAIN` come from
 * scripts/country-facts/fixtures.ts, and the whole-feed apparatus the
 * describes drive — `healthyFeed`, `addCountry`, `FILLER_SPEC`, `FILLERS`,
 * `dropRows`, `languageItem` and the `Feed` type — from
 * scripts/country-facts/runHarness.ts, both their single home since
 * 2026-09-07. What stays here is what cannot leave a test file: the
 * `vi.mock("node:fs")` hoist, the lifecycle hooks, and the helpers that read
 * the mocked write primitives.
 *
 * `the four withhold rules are observably live on a whole feed` moved to
 * scripts/country-facts/gate.test.ts on the same day, where the split's table
 * always put it; it never called `run()`, only the feed apparatus that is now
 * importable.
 */

import { describe, expect, test } from "vitest";
import { factCount } from "./country-facts/facts.mjs";
import {
  FILLER_POOL,
  PLUG_ARTICLE,
  PLUG_ITEM,
  type Row,
  SAMPLE_GROWTH_GAIN,
  entity,
} from "./country-facts/fixtures";
import { EXPECTED_COUNTRIES, REQUIRED_NAMES } from "./country-facts/gate.mjs";
import { DROPPED_LANGUAGE_ITEMS } from "./country-facts/picks.mjs";
import {
  FILLERS,
  FILLER_SPEC,
  type Feed,
  addCountry,
  dropRows,
  healthyFeed,
  languageItem,
} from "./country-facts/runHarness";

// ---------------------------------------------------------------------------
// run() — proving the gate by behaviour, not by source position
//
// The design forbids a source-position grep test here, and the preamble to
// scripts/ingest-cities.test.ts's `run() aborts before any write primitive
// fires when assertSane rejects the feed` records why: a reviewer
// mutation-tested that shape and found four changes that leave it green while
// a corrupt feed still reaches disk — a gate hidden behind a never-set env
// flag, a write hoisted above the gate, an early-return branch that writes
// before returning, and a try/catch that swallows the gate's exception.
//
// This block drives the real, exported `run()` with injected loaders and
// asserts by BEHAVIOUR: on a rejected feed no write primitive ever fires and
// the output directory is never even created. Every one of those four
// mutations turns at least one test below red.
//
// The positive control at the top is what keeps the rest from passing
// vacuously: a harness that could never write would satisfy every
// `not.toHaveBeenCalled()` in the file.
// ---------------------------------------------------------------------------

import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { run } from "./ingest-country-facts.mjs";

/**
 * `vi.spyOn` cannot touch `node:fs` directly — Vitest's ESM module namespace
 * for a Node builtin is non-configurable, so `vi.spyOn(fs, "writeFileSync")`
 * throws "Cannot redefine property" before the test body runs. `vi.mock` with
 * `importOriginal` is Vitest's own prescribed workaround: every other
 * primitive (`readFileSync`, `existsSync`, `mkdirSync`, `rmSync`) stays real,
 * and only the two that actually commit bytes to disk become no-op spies. That
 * keeps this file hermetic — no mutation of the gate can make it write a real
 * artifact — while still letting `toHaveBeenCalled()` prove whether the write
 * path ran. `node:fs/promises` is a different module and is NOT mocked, which
 * is how the tests below seed a previous artifact.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), renameSync: vi.fn() };
});

const scratchRoots: string[] = [];

function freshDataDir(): string {
  const root = mkdtempSync(pathJoin(tmpdir(), "ingest-country-facts-"));
  scratchRoots.push(root);
  // Deliberately NOT created: `mkdirSync` sits below the gate, so a rejected
  // run must leave this path absent, and that is checkable.
  return pathJoin(root, "data");
}

async function seedPrevious(dataDir: string, payload: unknown): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(pathJoin(dataDir, "country-facts.json"), JSON.stringify(payload), "utf8");
}

const loaderFor = (feed: Feed) => async (name: string) => {
  const rows = feed[name];
  if (rows === "throw") throw new Error(`upstream request timeout for ${name}`);
  return rows ?? [];
};

function writtenPayload(): {
  generatedAt: string;
  source: string;
  license: string;
  countries: Record<string, Record<string, unknown>>;
} {
  const call = vi
    .mocked(writeFileSync)
    .mock.calls.find(([path]) => String(path).includes("country-facts.json.tmp"));
  expect(call, "the facts artifact was never written").toBeDefined();
  return JSON.parse(String(call![1]));
}

async function expectNoWrite(
  feed: Feed,
  pattern: RegExp,
  previous?: unknown
): Promise<void> {
  const dataDir = freshDataDir();
  if (previous !== undefined) await seedPrevious(dataDir, previous);
  await expect(run({ fetchBindings: loaderFor(feed), dataDir })).rejects.toThrow(pattern);
  expect(vi.mocked(writeFileSync), "writeFileSync fired on a rejected run").not.toHaveBeenCalled();
  expect(vi.mocked(renameSync), "renameSync fired on a rejected run").not.toHaveBeenCalled();
}

/**
 * Six disjoint slices whose fields sum to more than MAX_SHRINK_RATIO's 5% of a
 * healthy build's 2,208 facts, each sized so the property still answers
 * plausibly (>= 80% of last run's coverage) and still clears its own MEASURED
 * coverage floor. The point is to reach the DRIFT check specifically, rather
 * than being stopped one gate earlier for an unrelated reason — and the floors
 * this has to stay above were re-measured at Task 25 from the shipping query,
 * so they are far tighter than the numbers this was first sized against.
 */
const DRIFT_SLICES: [string, string, string[]][] = [
  ["plugs", "plugs", FILLERS.slice(0, 40)],
  ["voltage", "voltageV", FILLERS.slice(40, 70)],
  ["emergency", "emergency", FILLERS.slice(70, 100)],
  ["languages", "officialLanguages", FILLERS.slice(100, 112)],
  ["drivingSide", "drivingSide", FILLERS.slice(112, 122)],
  ["coordinate", "lat", FILLERS.slice(122, 131)],
];

let healthyPayload: ReturnType<typeof writtenPayload>;

beforeEach(() => {
  vi.mocked(writeFileSync).mockClear();
  vi.mocked(renameSync).mockClear();
});

afterEach(() => {
  while (scratchRoots.length > 0) {
    const root = scratchRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

beforeAll(async () => {
  await run({ fetchBindings: loaderFor(healthyFeed()), dataDir: freshDataDir() });
  healthyPayload = writtenPayload();
  vi.mocked(writeFileSync).mockClear();
  vi.mocked(renameSync).mockClear();
});

describe("run() — the positive control", () => {
  test("a healthy feed DOES write, so every not.toHaveBeenCalled() below means something", async () => {
    await run({ fetchBindings: loaderFor(healthyFeed()), dataDir: freshDataDir() });
    expect(vi.mocked(writeFileSync)).toHaveBeenCalled();
    expect(vi.mocked(renameSync)).toHaveBeenCalled();
    const payload = writtenPayload();
    expect(Object.keys(payload.countries)).toHaveLength(EXPECTED_COUNTRIES);
    expect(payload.license).toBe("CC0-1.0");
    expect(payload.source).toBe("Wikidata (CC0)");
  });

  test("China's record reproduces the answer a human wrote before this ingest existed", async () => {
    await run({ fetchBindings: loaderFor(healthyFeed()), dataDir: freshDataDir() });
    expect(writtenPayload().countries.CN).toEqual({
      name: REQUIRED_NAMES.CN,
      currencyCode: "CNY",
      currencyName: "renminbi",
      plugs: ["A", "C", "I"],
      voltageV: 220,
      drivingSide: "right",
      emergency: [
        { number: "110", role: "police" },
        { number: "119", role: "fire" },
        { number: "120", role: "ambulance" },
      ],
      officialLanguages: ["Standard Chinese"],
      callingCode: "+86",
      lat: 35,
    });
  });

  test("the measured landmines survive end to end: BZ has no voltage, CZ keeps CZK, NL gets its curated euro", async () => {
    await run({ fetchBindings: loaderFor(healthyFeed()), dataDir: freshDataDir() });
    const { countries } = writtenPayload();
    expect(countries.BZ.voltageV).toBeUndefined();
    expect(countries.BZ.currencyCode).toBe("BZD");
    expect(countries.CZ.currencyCode).toBe("CZK");
    expect(countries.NL.currencyCode).toBe("EUR");
    expect(countries.FR.voltageV).toBe(230);
    expect(countries.PL.currencyCode).toBe("PLN");
    expect(countries.ZW.currencyCode).toBe("USD");
    expect(countries.MO.currencyCode).toBe("MOP");
    // The 2026-08-31 dinar, added beside the convertible mark at the same rank.
    expect(countries.BA.currencyCode).toBe("BAM");
  });

  test("Guinea's meta-item is dropped end to end and French survives, which the reader could not do", async () => {
    // The whole point of fixing this in the extract rather than at the
    // boundary: refused by label at the reader, the all-or-nothing rule costs
    // Guinea French as well. Dropped by id here, the record states what
    // upstream states.
    const feed = healthyFeed();
    dropRows(feed, "languages", [FILLERS[0]]);
    (feed.languages as Row[]).push(
      { country: FILLERS[0], item: languageItem("French"), value: "French" },
      {
        country: FILLERS[0],
        item: `http://www.wikidata.org/entity/${[...DROPPED_LANGUAGE_ITEMS][0]}`,
        value: "languages of Nowhere",
      }
    );
    await run({ fetchBindings: loaderFor(feed), dataDir: freshDataDir() });
    expect(writtenPayload().countries[FILLERS[0]].officialLanguages).toEqual(["French"]);
  });

  test("every country is written with the name the sentences will call it", async () => {
    await run({ fetchBindings: loaderFor(healthyFeed()), dataDir: freshDataDir() });
    const { countries } = writtenPayload();
    expect(countries.PE.name).toBe("Peru");
    expect(Object.values(countries).filter((record) => record.name !== undefined)).toHaveLength(
      EXPECTED_COUNTRIES
    );
    // Identity, not a fact: it must not be able to keep a record alive, and it
    // must not have moved the count the drift bands are calibrated in.
    expect(factCount(countries.SH)).toBe(4);
  });

  test("the sparse country is written PRESENT with fields absent, never as a placeholder", async () => {
    await run({ fetchBindings: loaderFor(healthyFeed()), dataDir: freshDataDir() });
    const sh = writtenPayload().countries.SH;
    expect(sh.currencyCode).toBe("SHP");
    expect(sh.plugs).toBeUndefined();
    expect(sh.emergency).toBeUndefined();
    expect(JSON.stringify(sh)).not.toMatch(/unknown|n\/a|null/i);
  });

  test("an unchanged build keeps its previous timestamp, so a quiet night commits nothing", async () => {
    const dataDir = freshDataDir();
    await seedPrevious(dataDir, healthyPayload);
    await run({ fetchBindings: loaderFor(healthyFeed()), dataDir });
    expect(writtenPayload().generatedAt).toBe(healthyPayload.generatedAt);
  });

  test("a demoted property carries its previous values forward instead of deleting them", async () => {
    // The Task 7 shape, defended: an outage costs one night's freshness, not a
    // field. `plugs` answers for nothing, and the artifact still ships plugs.
    const dataDir = freshDataDir();
    await seedPrevious(dataDir, healthyPayload);
    const feed = healthyFeed();
    feed.plugs = [];
    await run({ fetchBindings: loaderFor(feed), dataDir });
    const { countries } = writtenPayload();
    expect(countries.CN.plugs).toEqual(["A", "C", "I"]);
    expect(Object.values(countries).filter((record) => record.plugs !== undefined)).toHaveLength(245);
  });

  test("a property whose fetch throws is demoted too, not read as an empty answer", async () => {
    const dataDir = freshDataDir();
    await seedPrevious(dataDir, healthyPayload);
    const feed = healthyFeed();
    feed.emergency = "throw";
    await run({ fetchBindings: loaderFor(feed), dataDir });
    expect(writtenPayload().countries.CN.emergency).toHaveLength(3);
  });
});

describe("run() aborts before any write primitive fires", () => {
  test("a truncated country-code answer — the five-country feed", async () => {
    // Rejected for a genuine reason: five countries is what a truncated or
    // reshaped upstream download looks like, and the two-sided band is the
    // gate that sees it.
    const feed = healthyFeed();
    feed.codes = (feed.codes as Row[]).slice(0, 5);
    await expectNoWrite(feed, /countries carry facts, expected 246/);
  });

  test("and leaves no trace at all — the output directory is never created", async () => {
    // `mkdirSync` sits BELOW the gate, unlike scripts/ingest-cities.mjs, and
    // this is what makes that true rather than merely claimed. A behavioural
    // check, not a grep for line order.
    const dataDir = freshDataDir();
    const feed = healthyFeed();
    feed.codes = (feed.codes as Row[]).slice(0, 5);
    await expect(run({ fetchBindings: loaderFor(feed), dataDir })).rejects.toThrow();
    expect(existsSync(dataDir), "a rejected run created the output directory").toBe(false);
  });

  test("a country-code answer that grew — a floor could not catch this", async () => {
    const feed = healthyFeed();
    for (const code of FILLER_POOL.slice(240, 260)) addCountry(feed, code, FILLER_SPEC);
    await expectNoWrite(feed, /countries carry facts, expected 246/);
  });

  test.each(["CN", "PE", "JP", "CH"])("a feed with no facts at all for %s", async (code) => {
    const feed = healthyFeed();
    feed.codes = (feed.codes as Row[]).filter((row) => row.code !== code);
    for (const property of Object.keys(feed)) {
      if (property !== "codes") dropRows(feed, property, [code]);
    }
    await expectNoWrite(feed, new RegExp(`${code} carries no facts`));
  });

  test("a feed with no sparse fixture", async () => {
    const feed = healthyFeed();
    feed.codes = (feed.codes as Row[]).filter((row) => row.code !== "SH");
    for (const property of Object.keys(feed)) {
      if (property !== "codes") dropRows(feed, property, ["SH"]);
    }
    await expectNoWrite(feed, /SH is absent/);
  });

  test("a feed where the sparse fixture stopped being sparse", async () => {
    const feed = healthyFeed();
    for (const property of Object.keys(feed)) {
      if (property !== "codes") dropRows(feed, property, ["SH"]);
    }
    addCountry(feed, "SH", { ...FILLER_SPEC, currency: [["SHP", "Saint Helena pound"]] });
    feed.codes = (feed.codes as Row[]).filter((row, index, rows) => rows.findIndex((r) => r.code === row.code) === index);
    await expectNoWrite(feed, /SH now carries every rendered field/);
  });

  test("a feed whose country codes switched to alpha-3", async () => {
    const feed = healthyFeed();
    addCountry(feed, "PER", { currency: [["PEN", "Peruvian sol"]] });
    await expectNoWrite(feed, /malformed country key "PER"/);
  });

  test("a feed where Q60740126 became a country's only plug value", async () => {
    const feed = healthyFeed();
    dropRows(feed, "plugs", [FILLERS[0]]);
    (feed.plugs as Row[]).push({
      country: FILLERS[0],
      item: PLUG_ARTICLE.item,
      itemLabel: PLUG_ARTICLE.itemLabel,
    });
    await expectNoWrite(feed, /as their ONLY plug value/);
  });

  test("a feed whose Peru record came back under a different name", async () => {
    const feed = healthyFeed();
    dropRows(feed, "name", ["PE"]);
    (feed.name as Row[]).push({ country: "PE", value: "Republic of Peru" });
    await expectNoWrite(feed, /PE.name is "Republic of Peru"/);
  });

  test("a feed where a dropped language item became a country's only value", async () => {
    const feed = healthyFeed();
    dropRows(feed, "languages", [FILLERS[0]]);
    (feed.languages as Row[]).push({
      country: FILLERS[0],
      item: `http://www.wikidata.org/entity/${[...DROPPED_LANGUAGE_ITEMS][0]}`,
      value: "languages of Nowhere",
    });
    await expectNoWrite(feed, /as their official-language values/);
  });

  test("a feed whose languages are ALL territorially scoped still writes, because that is the rule working", async () => {
    // The end-to-end half of the asymmetry: the United States shape, driven
    // through the real build-gate-write path. It must produce a file, and that
    // file must simply have no `officialLanguages` for the country — not an
    // empty array, not a partial list, and not an aborted run.
    const feed = healthyFeed();
    dropRows(feed, "languages", [FILLERS[0]]);
    (feed.languages as Row[]).push(
      { country: FILLERS[0], item: entity("Q33569"), value: "Hawaiian", scoped: "true" },
      { country: FILLERS[0], item: entity("Q1321"), value: "Spanish", scoped: "true" }
    );
    const dataDir = freshDataDir();
    await run({ fetchBindings: loaderFor(feed), dataDir });
    expect(writtenPayload().countries[FILLERS[0]].officialLanguages).toBeUndefined();
    expect(Object.keys(writtenPayload().countries[FILLERS[0]]).length).toBeGreaterThan(1);
  });

  test("a feed where a curated override has gone stale", async () => {
    const feed = healthyFeed();
    dropRows(feed, "currency", ["NL"]);
    (feed.currency as Row[]).push({ country: "NL", code: "EUR", name: "euro" });
    await expectNoWrite(feed, /NL.currencyCode, NL.currencyName no longer fire/);
  });

  test("a feed whose China record stopped reproducing the hand-written answer", async () => {
    const feed = healthyFeed();
    dropRows(feed, "voltage", ["CN"]);
    (feed.voltage as Row[]).push({ country: "CN", value: "110" });
    await expectNoWrite(feed, /CN.voltageV is 110/);
  });

  test("a feed whose China plug letters stopped reproducing lib/packing.ts:64", async () => {
    const feed = healthyFeed();
    dropRows(feed, "plugs", ["CN"]);
    for (const label of ["Europlug", "NEMA 1-15"]) {
      (feed.plugs as Row[]).push({
        country: "CN",
        item: `http://www.wikidata.org/entity/${PLUG_ITEM[label]}`,
        itemLabel: label,
      });
    }
    await expectNoWrite(feed, /CN.plugs is/);
  });

  test("a feed that lost one of China's three emergency numbers", async () => {
    const feed = healthyFeed();
    feed.emergency = (feed.emergency as Row[]).filter(
      (row) => !(row.country === "CN" && row.number === "120")
    );
    await expectNoWrite(feed, /CN has no emergency number 120/);
  });

  test("a first-run feed where one field is null nearly everywhere", async () => {
    // No previous artifact, so demotion cannot fire and the per-field floor is
    // the only thing standing between this and a committed, deployed artifact
    // in which nobody has a currency.
    const feed = healthyFeed();
    dropRows(feed, "currency", FILLERS.slice(0, 200));
    await expectNoWrite(feed, /countries carry currencyCode, under the 229 floor/);
  });

  test("a feed that drops a country the previous artifact had", async () => {
    const previous = structuredClone(healthyPayload);
    previous.countries.QZ = structuredClone(previous.countries.CH);
    await expectNoWrite(healthyFeed(), /lost every fact: QZ/, previous);
  });

  test("a feed whose fact count fell more than 10% across many countries", async () => {
    const feed = healthyFeed();
    for (const [property, , codes] of DRIFT_SLICES) dropRows(feed, property, codes);
    await expectNoWrite(feed, /fact count fell/, healthyPayload);
  });

  test("a feed whose fact count rose more than 10% — a withhold rule may have stopped firing", async () => {
    // SAMPLE_GROWTH_GAIN's ranges, not DRIFT_SLICES': no coverage floor bounds
    // a growth test, because the floors run against the healthy BUILT artifact
    // while it is the PREVIOUS one being made poor here.
    const previous = structuredClone(healthyPayload);
    for (const [field, codes] of SAMPLE_GROWTH_GAIN) {
      for (const code of codes) {
        if (previous.countries[code]) delete previous.countries[code][field];
      }
    }
    await expectNoWrite(healthyFeed(), /fact count rose/, previous);
  });

  test("a feed that hollows out one country while the global total barely moves", async () => {
    const feed = healthyFeed();
    dropRows(feed, "plugs", [FILLERS[0]]);
    dropRows(feed, "languages", [FILLERS[0]]);
    await expectNoWrite(feed, /lost more than 1 field/, healthyPayload);
  });

  test("a previous artifact that exists but does not parse", async () => {
    // Missing and unreadable are NOT the same answer. Treating a corrupt file
    // as absent makes every drift check early-return, which is precisely the
    // input that turned an empty upstream answer into a committed wipe.
    const dataDir = freshDataDir();
    await mkdir(dataDir, { recursive: true });
    await writeFile(pathJoin(dataDir, "country-facts.json"), "{ not json", "utf8");
    await expect(
      run({ fetchBindings: loaderFor(healthyFeed()), dataDir })
    ).rejects.toThrow(/exists but is not valid JSON/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(renameSync)).not.toHaveBeenCalled();
  });

  test("a country-code query that failed outright", async () => {
    const feed = healthyFeed();
    feed.codes = "throw";
    await expectNoWrite(feed, /country universe to build against/);
  });
});

/**
 * Carry-forward is the one path by which a value the pickers would have
 * withheld can still reach a record: a previous artifact written before a rule
 * existed, restored wholesale when its property has a bad night. These drive
 * exactly that, and they are why the value-domain branches of the gate are
 * reachable through `run()` at all rather than being unit-tested in isolation.
 */
describe("run() aborts when carry-forward would restore a value the rules now refuse", () => {
  const cases: [string, string, string, unknown, RegExp][] = [
    ["an empty string", "currency", "currencyName", "", /is an empty string/],
    ["a bare entity id", "currency", "currencyName", "Q4917", /leaked through/],
    ["an over-long label", "currency", "currencyName", "x".repeat(200), /over the 80 character ceiling/],
    ["a non-ISO currency code", "currency", "currencyCode", "203", /not ISO 4217 alphabetic/],
    ["an industrial voltage", "voltage", "voltageV", 550, /outside 100-260 V/],
    ["an unknown plug letter", "plugs", "plugs", ["Z"], /plug type "Z"/],
    ["an empty plug list", "plugs", "plugs", [], /non-array or empty plugs/],
    [
      "more plug types than any real country has",
      "plugs",
      "plugs",
      ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
      /plug types, over the 8 ceiling/,
    ],
    ["an empty emergency list", "emergency", "emergency", [], /non-array or empty emergency/],
    [
      "more emergency numbers than any real country has",
      "emergency",
      "emergency",
      Array.from({ length: 9 }, (_, i) => ({ number: `10${i}`, role: null })),
      /emergency numbers, over the 8 ceiling/,
    ],
    ["unsorted plug letters", "plugs", "plugs", ["C", "A"], /not sorted and unique/],
    [
      "an emergency number that is not two to six digits",
      "emergency",
      "emergency",
      [{ number: "911911911", role: null }],
      /emergency number "911911911"/,
    ],
    [
      "an unmapped emergency role",
      "emergency",
      "emergency",
      [{ number: "112", role: "wildlife rescue" }],
      /emergency role "wildlife rescue"/,
    ],
    ["a driving side that is neither", "drivingSide", "drivingSide", "sideways", /drives on "sideways"/],
    ["a dialling code with no plus", "callingCode", "callingCode", "0051", /dialling code "0051"/],
    ["an out-of-range latitude", "coordinate", "lat", 500, /latitude 500/],
    [
      "a language list long enough to be a join gone wrong",
      "languages",
      "officialLanguages",
      Array.from({ length: 60 }, (_, i) => `Language ${i}`),
      /over the 40 ceiling/,
    ],
  ];

  test.each(cases)("%s", async (_name, property, field, value, pattern) => {
    const previous = structuredClone(healthyPayload);
    previous.countries[FILLERS[0]][field] = value;
    const feed = healthyFeed();
    // The property answers for nothing, so it is demoted and every one of its
    // values — including the poisoned one — is carried forward.
    feed[property] = [];
    await expectNoWrite(feed, pattern, previous);
  });
});

