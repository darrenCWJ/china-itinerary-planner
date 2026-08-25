import { describe, expect, test } from "vitest";
import {
  assertEnrichmentSane,
  buildEnrichmentQuery,
  firstSentences,
  mergeEnrichment,
  readEnrichmentBindings,
  toThumbnailUrl,
} from "./enrich-cities.mjs";

/**
 * The pure half of the enrichment build. The network half — SPARQL, the
 * Action API and the file writes — runs only from `main()`, which the
 * module's entry-point guard keeps out of this import.
 */

describe("buildEnrichmentQuery", () => {
  test("keys on P1566 with the bare geonameid, not the G-prefixed app id", () => {
    // The G prefix exists so a GeoNames id can never be mistaken for a
    // Wikidata QID inside this app. Wikidata stores the bare integer as a
    // string, so sending "G3941584" matches nothing and every city comes back
    // unenriched — silently, because an empty result is also what a genuinely
    // unknown city returns.
    const query = buildEnrichmentQuery(["G3941584", "G2657928"]);
    expect(query).toContain('"3941584"');
    expect(query).toContain('"2657928"');
    expect(query).not.toContain("G3941584");
    expect(query).toContain("wdt:P1566");
  });

  test("asks for the enwiki title, the description and the image", () => {
    const query = buildEnrichmentQuery(["G1"]);
    expect(query).toContain("wdt:P18");
    expect(query).toContain("https://en.wikipedia.org/");
    expect(query).toContain("schema:description");
  });

  test("refuses an id that is not a GeoNames id rather than injecting it", () => {
    // The ids arrive from a generated file, but this string is interpolated
    // straight into a query — a value with a quote in it would rewrite the
    // WHERE clause.
    expect(() => buildEnrichmentQuery(['G1" } UNION { ?x ?y ?z'])).toThrow(/not a GeoNames id/);
    expect(() => buildEnrichmentQuery(["Q170247"])).toThrow(/not a GeoNames id/);
  });
});

describe("readEnrichmentBindings", () => {
  test("collapses SPARQL's row-per-combination output into one entity per id", () => {
    // Wikidata returns one row per statement combination — the live query
    // returns Cusco three times. First non-null binding wins per field, the
    // same `??=` merge ingest-destinations.mjs uses.
    const merged = readEnrichmentBindings([
      { gid: { value: "3941584" }, title: { value: "Cusco" }, desc: { value: "historic city of Peru" } },
      { gid: { value: "3941584" }, img: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg" } },
      { gid: { value: "3941584" }, title: { value: "Cusco (disambiguation)" } },
    ]);
    expect(merged.get("G3941584")).toEqual({
      title: "Cusco",
      description: "historic city of Peru",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg?width=640",
    });
  });

  test("re-prefixes the id so it matches the shard", () => {
    const merged = readEnrichmentBindings([{ gid: { value: "2657928" } }]);
    expect([...merged.keys()]).toEqual(["G2657928"]);
  });

  test("nulls every field a binding did not carry", () => {
    expect(readEnrichmentBindings([{ gid: { value: "1" } }]).get("G1")).toEqual({
      title: null,
      description: null,
      image: null,
    });
  });

  test("ignores a row with no id rather than keying on undefined", () => {
    expect(readEnrichmentBindings([{ title: { value: "orphan" } }]).size).toBe(0);
  });
});

describe("toThumbnailUrl", () => {
  test("forces https and asks Commons to resize server-side", () => {
    // No image bytes are ever downloaded — P18 arrives as a Special:FilePath
    // URL and Commons does the resizing, the same trick
    // ingest-country-images.mjs uses at width 1280.
    expect(toThumbnailUrl("http://commons.wikimedia.org/wiki/Special:FilePath/A.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=640"
    );
  });

  test("passes null through", () => {
    expect(toThumbnailUrl(null)).toBeNull();
  });
});

describe("mergeEnrichment", () => {
  const previous = {
    G1: { description: "old one", image: null },
    G2: { description: "kept", image: "https://x/2.jpg?width=640" },
  };

  test("keeps entries outside this run's scope", () => {
    // §4: enrichment is stored apart from the base shard so a re-ingest never
    // discards it. A lazily-enriched city that has since fallen out of the top
    // 30 must survive a build that no longer asks about it.
    const merged = mergeEnrichment(previous, new Map(), ["G1"]);
    expect(merged.G2).toEqual({ description: "kept", image: "https://x/2.jpg?width=640" });
  });

  test("recomputes every id inside this run's scope, including deletion", () => {
    // A city that now fails the gate loses its stale entry rather than keeping
    // it forever — the same rule ingest-country-images.mjs applies to a
    // partial run. Correct for a batch that ANSWERED and found nothing; see
    // the next two tests for what stops it being catastrophic otherwise.
    const merged = mergeEnrichment(previous, new Map(), ["G1"]);
    expect(merged).not.toHaveProperty("G1");
  });

  test("does not delete an entry whose batch never ran", () => {
    // The narrowing `main()` applies: an id whose SPARQL batch timed out is
    // not in scope at all, so a Wikidata blip costs nothing. Deleting on an
    // unasked id turns a transient outage into a committed, deployed data
    // regression, because the workflow commits whatever this writes.
    expect(mergeEnrichment(previous, new Map(), []).G1).toEqual({
      description: "old one",
      image: null,
    });
  });

  test("an empty fresh map erases the whole scope, which is why the gate exists", () => {
    // Stated rather than left implicit: this is correct for a successful run
    // that legitimately found nothing, and a disaster for a failed one.
    // `assertEnrichmentSane` is the only thing separating the two.
    expect(mergeEnrichment(previous, new Map(), ["G1", "G2"])).toEqual({});
  });

  test("writes a fresh entry from a summary and an image", () => {
    const fresh = new Map([
      ["G1", { title: "Zermatt", description: "Zermatt is a municipality in Valais.", image: "https://x/z.jpg?width=640" }],
    ]);
    expect(mergeEnrichment(previous, fresh, ["G1"]).G1).toEqual({
      description: "Zermatt is a municipality in Valais.",
      image: "https://x/z.jpg?width=640",
    });
  });

  test("drops an entry that has neither a description nor an image", () => {
    // An empty record is a byte cost with nothing in it, and its presence
    // would tell the lazy runtime path the city was already tried.
    const fresh = new Map([["G1", { title: "Nowhere", description: null, image: null }]]);
    expect(mergeEnrichment(previous, fresh, ["G1"])).not.toHaveProperty("G1");
  });

  test("returns keys in sorted order so a rebuild is byte-stable", () => {
    const fresh = new Map([
      ["G9", { title: null, description: "nine", image: null }],
      ["G3", { title: null, description: "three", image: null }],
    ]);
    expect(Object.keys(mergeEnrichment({}, fresh, ["G9", "G3"]))).toEqual(["G3", "G9"]);
  });
});

describe("assertEnrichmentSane", () => {
  test("aborts when a run would erase most of the previous coverage", () => {
    // The failure this exists for: SPARQL answered every batch but returned
    // nothing — a renamed property, a schema change, a rate-limit page that
    // parsed as valid JSON — so scope narrowing does not help and
    // mergeEnrichment would delete all 6,244 records. The workflow commits
    // that and Vercel deploys it, unattended.
    expect(() => assertEnrichmentSane(6_244, 0)).toThrow(/coverage fell to 0\/6244/);
    expect(() => assertEnrichmentSane(6_244, 2_000)).toThrow(/under the 95% floor/);
  });

  test("accepts normal drift, and a first run with nothing to lose", () => {
    expect(() => assertEnrichmentSane(6_244, 6_100)).not.toThrow();
    expect(() => assertEnrichmentSane(6_244, 6_400)).not.toThrow();
    expect(() => assertEnrichmentSane(0, 0)).not.toThrow();
  });
});

describe("firstSentences", () => {
  // The function every build-time description a traveller reads passes
  // through — three branches, a lookbehind/lookahead split and a 420-character
  // truncation, none of it otherwise exercised.

  test("keeps two sentences and drops the rest", () => {
    expect(
      firstSentences("Cusco is a city in Peru. It was the Inca capital. It sits at 3,400 m.")
    ).toBe("Cusco is a city in Peru. It was the Inca capital.");
  });

  test("survives an abbreviation the splitter mistakes for a sentence end", () => {
    // Verified behaviour, not the behaviour one might assume: the lookahead
    // only requires an uppercase letter or digit after the space, so "Mt. |
    // Everest…" DOES split. What saves it is the two-sentence budget rejoining
    // the halves. A one-sentence cap would truncate this to "Mt." — which is
    // why `maxSentences` must not be lowered without revisiting this.
    expect(firstSentences("Mt. Everest is 8,848 m tall.")).toBe("Mt. Everest is 8,848 m tall.");
  });

  test("drops a pinyin parenthetical rather than shipping it to a traveller", () => {
    expect(
      firstSentences("Jinan (simplified Chinese: 济南; pinyin: Jǐnán) is a city in Shandong.")
    ).toBe("Jinan is a city in Shandong.");
  });

  test("falls back to one sentence when two would exceed the cap", () => {
    const long = `${"A".repeat(300)}. ${"B".repeat(300)}.`;
    expect(firstSentences(long)).toBe(`${"A".repeat(300)}.`);
  });

  test("truncates with an ellipsis when even one sentence exceeds the cap", () => {
    const result = firstSentences(`${"A".repeat(600)}.`);
    expect(result).toHaveLength(420);
    expect(result!.endsWith("…")).toBe(true);
  });

  test("is null for nothing, rather than an empty string", () => {
    expect(firstSentences(null)).toBeNull();
    expect(firstSentences("   ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The guards, driven end to end through run()
//
// `vi.spyOn` cannot touch `node:fs` here — Vitest's ESM module namespace for a
// Node builtin is non-configurable, so `vi.spyOn(fs, "writeFileSync")` throws
// "Cannot redefine property" before the test body runs. `vi.mock` with
// `importOriginal` is Vitest's own prescribed workaround, and the same one
// scripts/ingest-cities.test.ts uses: every other primitive stays real, and
// only the two that actually commit bytes to disk become no-op spies. Fixture
// files are written through `node:fs/promises`, which this mock does not
// touch.
// ---------------------------------------------------------------------------

import { renameSync, rmSync as rmSyncReal, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename as pathBasename, join as pathJoin } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import {
  assertCountryCoverageSane,
  assertExtractQualitySane,
  fetchSparqlBindings,
  isBatchAnswerPlausible,
  planCountry,
  run,
} from "./enrich-cities.mjs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), renameSync: vi.fn() };
});

const scratch: string[] = [];

function cc(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `${alphabet[Math.floor(index / 26)]}${alphabet[index % 26]}`;
}

/** Deterministic, well-formed GeoNames ids: country index and rank, encoded. */
function idsFor(countryIndex: number, count: number): string[] {
  return Array.from({ length: count }, (_, rank) => `G${1_000_000 + countryIndex * 1_000 + rank}`);
}

function bindingsFor(ids: string[], { empty = false } = {}) {
  return ids.map((id) =>
    empty
      ? { gid: { value: id.slice(1) } }
      : {
          gid: { value: id.slice(1) },
          title: { value: `Title ${id}` },
          desc: { value: `wikidata short description for ${id}` },
          img: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${id}.jpg` },
        }
  );
}

/** Rank of a fixture id inside its country's target list. */
function rankOf(id: string): number {
  return Number(id.slice(1)) % 1_000;
}

function countryIndexOf(id: string): number {
  return Math.floor((Number(id.slice(1)) - 1_000_000) / 1_000);
}

function rankBelow(limit: number) {
  return (id: string) => rankOf(id) < limit;
}

/** The ids a query asked about, read back out of its VALUES clause. */
function askedIds(query: string): string[] {
  return [...query.matchAll(/"(\d+)"/g)].map((match) => `G${match[1]}`);
}

const fullExtracts = async (titles: string[]) =>
  new Map(titles.map((title) => [title, `${title} is a city in the fixture. It has a second sentence.`]));

async function fixture({
  countries,
  perCountry,
  previousPerCountry,
  corrupt = [],
}: {
  countries: number;
  perCountry: number;
  previousPerCountry: (code: string, index: number) => number;
  corrupt?: string[];
}) {
  const root = await mkdtemp(pathJoin(tmpdir(), "enrich-cities-run-"));
  scratch.push(root);
  const enrichDir = pathJoin(root, "enrich");
  await mkdir(enrichDir, { recursive: true });

  const targets: Record<string, string[]> = {};
  for (let index = 0; index < countries; index++) targets[cc(index)] = idsFor(index, perCountry);
  const targetsPath = pathJoin(root, "cities-enrich-targets.json");
  await writeFile(targetsPath, JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", targets }), "utf8");

  for (let index = 0; index < countries; index++) {
    const code = cc(index);
    if (corrupt.includes(code)) {
      await writeFile(pathJoin(enrichDir, `${code}.json`), '{"country":"AA","cities":{', "utf8");
      continue;
    }
    const cities: Record<string, { description: string; image: string }> = {};
    for (const id of idsFor(index, previousPerCountry(code, index))) {
      cities[id] = { description: `previously committed ${id}`, image: `https://x/${id}.jpg?width=640` };
    }
    await writeFile(
      pathJoin(enrichDir, `${code}.json`),
      JSON.stringify({ country: code, generatedAt: "2026-01-01T00:00:00.000Z", source: "fixture", cities }),
      "utf8"
    );
  }
  return { targetsPath, enrichDir, targets };
}

function writtenFiles() {
  return vi.mocked(writeFileSync).mock.calls.map((call) => ({
    country: pathBasename(String(call[0])).replace(/\.tmp-\d+$/, "").replace(/\.json$/, ""),
    payload: JSON.parse(String(call[1])) as { cities: Record<string, unknown> },
  }));
}

describe("run() — the wipe path the guards must close", () => {
  beforeEach(() => {
    vi.mocked(writeFileSync).mockClear();
    vi.mocked(renameSync).mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (scratch.length > 0) {
      const dir = scratch.pop();
      if (dir) rmSyncReal(dir, { recursive: true, force: true });
    }
  });

  test("C3: a batch that answers 200 with a third of its rows deletes nothing", async () => {
    // The middle of the hazard. The HTTP call did not throw, so guard 1 counts
    // every id in the batch as answered; the response simply omitted most of
    // them. Every omitted id is then deleted, committed and deployed, while
    // the global floor sits far above the damage. A short body is an outage,
    // not an answer.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) => {
        const ids = askedIds(query);
        // Batch 1 (150 ids) answers in full; batch 2 (30 ids) returns 10 rows.
        return bindingsFor(ids.length > 30 ? ids : ids.slice(0, 10));
      },
    });
    const shortBatched = writtenFiles().find((file) => file.country === cc(5));
    expect(Object.keys(shortBatched?.payload.cities ?? {})).toHaveLength(30);
  });

  test("I2: a previous file that exists but does not parse aborts before any write", async () => {
    // `readJson` returns null for both "missing" and "unparseable", so a
    // corrupt file reads as previousTotal 0 — which is exactly the input that
    // makes the coverage gate early-return "a first run has nothing to lose".
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
      corrupt: Array.from({ length: 6 }, (_, index) => cc(index)),
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: fullExtracts,
        fetchBindings: async (query: string) => bindingsFor(askedIds(query), { empty: true }),
      })
    ).rejects.toThrow(/not valid JSON/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(renameSync)).not.toHaveBeenCalled();
  });

  test("C2: the coverage gate's CALL SITE, not just its body, stops the write", async () => {
    // The function was fully tested and the line that invokes it was not, so
    // deleting that one line left the suite green and produced the complete
    // `{"cities":{}}` wipe at exit 0. This is the mutant killer: a scenario
    // tuned so ONLY the global floor can fire — every country loses exactly
    // 20%, which the per-country gate permits, while the total falls to 80%,
    // which the global floor does not.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: fullExtracts,
        fetchBindings: async (query: string) => bindingsFor(askedIds(query).filter(rankBelow(24))),
      })
    ).rejects.toThrow(/under the 95% floor/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(renameSync)).not.toHaveBeenCalled();
  });

  test("C3/I1: one country emptied inside a healthy global ratio still stops the write", async () => {
    // 30 countries, one of them zeroed: global coverage reads 96.7%, above the
    // floor, and the batch carrying it answers for 120 of the 150 ids it asked
    // about — exactly the ratio the batch check accepts. Only a per-country
    // floor can see this; without one the country is deleted and deployed.
    const { targetsPath, enrichDir } = await fixture({
      countries: 30,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: fullExtracts,
        fetchBindings: async (query: string) =>
          bindingsFor(askedIds(query).filter((id) => countryIndexOf(id) !== 0)),
      })
    ).rejects.toThrow(/AA 0\/30/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  test("I4: a Wikipedia outage is refused even though the record count is perfect", async () => {
    // Wikidata healthy, the Action API down: every description silently
    // becomes the Wikidata one-liner and not one record is lost, so every
    // count-based gate reports a flawless run.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: async (titles: string[]) => new Map(titles.map((title) => [title, null])),
        fetchBindings: async (query: string) => bindingsFor(askedIds(query)),
      })
    ).rejects.toThrow(/fell back to the Wikidata one-liner/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  test("the healthy path at the yield this catalog actually produces is written", async () => {
    // 25 of 30 per country — 83%, the live run's 82.0% to within a city — must
    // not look like an outage to any of the five gates.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 25,
    });
    const summary = await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) => bindingsFor(askedIds(query).filter(rankBelow(25))),
    });
    expect(summary.nextTotal).toBe(150);
    expect(summary.unasked).toBe(0);
    expect(writtenFiles()).toHaveLength(6);
    for (const file of writtenFiles()) expect(Object.keys(file.payload.cities)).toHaveLength(25);
  });

  test("a single country at low yield inside a healthy mix is written", async () => {
    // Switzerland's real shape: 14 of 30, while its neighbours run at 30 of
    // 30. A per-country floor reading yield against the TARGET count rather
    // than against the country's own previous file would reject this catalog
    // every single night.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: (_code, index) => (index === 0 ? 14 : 30),
    });
    const summary = await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) =>
        bindingsFor(askedIds(query).filter((id) => (countryIndexOf(id) === 0 ? rankOf(id) < 14 : true))),
    });
    expect(summary.nextTotal).toBe(164);
    expect(summary.countryReport[0]).toMatchObject({ country: "AA", previousCount: 14, nextCount: 14 });
  });

  test("I3: every target id lands in exactly one disposition bucket", async () => {
    // The live run reported "82.0% of 6,245" and nothing else, so the missing
    // 1,127 were explained by guesswork — and explained wrong. These counts
    // are what tells "Wikidata has no P1566 row" apart from "it had one and
    // carried nothing usable" apart from "we never got a straight answer".
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 28,
    });
    const summary = await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) => {
        const ids = askedIds(query);
        return [
          ...bindingsFor(ids.filter(rankBelow(28))),
          // Matched, but carrying neither a description nor an image.
          ...bindingsFor(ids.filter((id) => rankOf(id) === 28), { empty: true }),
          // Rank 29 is simply absent: no P1566 row at all.
        ];
      },
    });
    expect(summary.dispositions).toEqual({
      asked: 180,
      unasked: 0,
      found: 168,
      noMatch: 6,
      droppedEmpty: 6,
    });
    expect(summary.batchReport.every((batch) => batch.accepted)).toBe(true);
    expect(summary.extracts).toEqual({ requested: 168, resolved: 168, fallback: 0 });
  });
});

describe("planCountry — the scope-narrowing guard", () => {
  const previous = {
    G1: { description: "one", image: null },
    G2: { description: "two", image: null },
  };

  test("keeps an id whose batch never answered out of the delete scope", () => {
    // Guard 1, as a unit. While this lived inline in the run loop, replacing
    // the filter with `const scoped = scope;` left 1025/1025 green while
    // letting a single failed batch delete a whole country and commit it.
    const plan = planCountry(previous, new Map(), ["G1", "G2"], new Set(["G2"]));
    expect(plan.scoped).toEqual(["G2"]);
    expect(plan.cities.G1).toEqual({ description: "one", image: null });
    expect(plan.cities).not.toHaveProperty("G2");
  });

  test("narrows to nothing when the whole run failed, so the file is untouched", () => {
    const plan = planCountry(previous, new Map(), ["G1", "G2"], new Set());
    expect(plan.scoped).toEqual([]);
    expect(plan.cities).toEqual(previous);
    expect(plan.nextCount).toBe(2);
  });

  test("sorts every id in scope into one disposition", () => {
    const entities = new Map([
      ["G1", { title: null, description: "kept", image: null }],
      ["G3", { title: null, description: null, image: null }],
    ]);
    const plan = planCountry({}, entities, ["G1", "G2", "G3", "G4"], new Set(["G1", "G2", "G3"]));
    expect(plan.dispositions).toEqual({ asked: 3, unasked: 1, found: 1, noMatch: 1, droppedEmpty: 1 });
  });
});

describe("isBatchAnswerPlausible", () => {
  test("rejects a 200 that returned far fewer rows than the batch already had", () => {
    // The middle of the hazard: the call did not throw, the body was short.
    // At 150 ids with 123 already enriched, a 55%-yield upstream returns 82.
    expect(isBatchAnswerPlausible(82, 123)).toBe(false);
    expect(isBatchAnswerPlausible(0, 150)).toBe(false);
  });

  test("accepts the drift a healthy batch actually shows", () => {
    // The live artifact's worst within-batch deficit is about 8 points.
    expect(isBatchAnswerPlausible(120, 123)).toBe(true);
    expect(isBatchAnswerPlausible(123, 123)).toBe(true);
  });

  test("accepts anything on a first run, which has nothing to lose", () => {
    expect(isBatchAnswerPlausible(0, 0)).toBe(true);
  });
});

describe("assertEnrichmentSane's floor", () => {
  test("refuses the loss the old 50% floor waved through", () => {
    // Production's real numbers: 5,118 entries. The old floor permitted
    // deleting 2,559 of them in one unattended night at exit 0.
    expect(() => assertEnrichmentSane(5_118, 2_559)).toThrow(/under the 95% floor/);
    expect(() => assertEnrichmentSane(5_118, 4_800)).toThrow(/coverage fell to 4800\/5118/);
  });

  test("accepts the drift a healthy re-run actually shows", () => {
    // An immediate re-run of the live data was byte-identical, so steady-state
    // drift is zero; 0.95 still leaves room for 255 lost entries a night.
    expect(() => assertEnrichmentSane(5_118, 5_118)).not.toThrow();
    expect(() => assertEnrichmentSane(5_118, 4_900)).not.toThrow();
  });
});

describe("assertCountryCoverageSane", () => {
  test("refuses a country emptied while the global ratio stays healthy", () => {
    const counts = [
      { country: "AA", previousCount: 30, nextCount: 0 },
      ...Array.from({ length: 29 }, (_, index) => ({
        country: `B${index}`,
        previousCount: 30,
        nextCount: 30,
      })),
    ];
    expect(() => assertCountryCoverageSane(counts)).toThrow(/AA 0\/30/);
  });

  test("accepts a country losing a couple of cities, and every tiny country", () => {
    // 25 of the 246 countries have fewer than 10 targets and several hold one
    // or two entries, where losing a single city is a 50-100% "collapse". A
    // ratio alone would let one of them block the nightly refresh forever.
    expect(() => assertCountryCoverageSane([{ country: "NR", previousCount: 2, nextCount: 0 }])).not.toThrow();
    expect(() => assertCountryCoverageSane([{ country: "CH", previousCount: 14, nextCount: 12 }])).not.toThrow();
    expect(() => assertCountryCoverageSane([{ country: "PE", previousCount: 30, nextCount: 24 }])).not.toThrow();
  });

  test("has nothing to lose on a country's first run", () => {
    expect(() => assertCountryCoverageSane([{ country: "ZZ", previousCount: 0, nextCount: 0 }])).not.toThrow();
  });
});

describe("assertExtractQualitySane", () => {
  test("refuses to commit a Wikipedia outage as a silent content downgrade", () => {
    expect(() => assertExtractQualitySane(4_660, 4_660)).toThrow(/Wikipedia's extract API is degraded/);
    expect(() => assertExtractQualitySane(1_400, 4_660)).toThrow(/30\.0%/);
  });

  test("tolerates the fallback rate the live run actually produced", () => {
    // ~20 titles lost to 429s across the full run, and 434 of 5,118 committed
    // descriptions are short enough to be Wikidata stubs — an upper bound of
    // about 9%, since that count also includes entities with no enwiki title.
    expect(() => assertExtractQualitySane(20, 4_660)).not.toThrow();
    expect(() => assertExtractQualitySane(434, 4_660)).not.toThrow();
  });

  test("says nothing about a sample too small to mean anything", () => {
    // `node scripts/enrich-cities.mjs VA` asks about one title.
    expect(() => assertExtractQualitySane(1, 1)).not.toThrow();
  });
});

describe("a SPARQL 404", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("is an outage, not an answer of zero bindings", () => {
    // For a per-title REST lookup a 404 means "no such page". For the SPARQL
    // endpoint it means the endpoint moved, and reading that as "Wikidata
    // knows nothing about these 150 cities" feeds a destructive merge.
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    return expect(fetchSparqlBindings("SELECT ?x WHERE {}", "1/1")).rejects.toThrow(/404/);
  });
});
