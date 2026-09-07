/**
 * enrich-cities — the pure half of the enrichment build: the query, the
 * binding reader, the merge, `planCountry`, and the five gates.
 *
 * Moved out of scripts/enrich-cities.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/enrich-cities.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import paths moved with them.
 *
 * The network half — SPARQL, the Action API and the file writes — is
 * scripts/enrich/io.mjs, and the run that drives them is still behind
 * scripts/enrich-cities.mjs's entry-point guard, so importing this module runs
 * nothing.
 */

import { describe, expect, test } from "vitest";
import {
  assertCountryCoverageSane,
  assertEnrichmentSane,
  assertExtractQualitySane,
  buildEnrichmentQuery,
  firstSentences,
  isBatchAnswerPlausible,
  mergeEnrichment,
  planCountry,
  readEnrichmentBindings,
  toThumbnailUrl,
} from "./plan.mjs";

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
