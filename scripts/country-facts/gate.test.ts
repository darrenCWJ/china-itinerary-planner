/**
 * ingest-country-facts — the build gate, one test per branch, plus the
 * committed artifact checked against the rules as they stand today.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture, and the artifact block below reads only the committed file.
 *
 * The `run()` block those describes' preamble points at — "Every branch is
 * also driven through the real `run()` below" — is now
 * scripts/ingest-country-facts.test.ts, which still drives every branch of
 * this gate by behaviour with an injected loader.
 *
 * `FILLER_POOL`, `SAMPLE_FILLERS` and `SAMPLE_GROWTH_GAIN` come from
 * scripts/country-facts/fixtures.ts, their single home since 2026-09-07: the
 * `run()` harness in scripts/ingest-country-facts.test.ts sizes its feed from
 * the same pool and reuses the same growth slices, and it now reads them from
 * there too rather than from a copy. `SAMPLE_DRIFT_LOSS` below is this file's
 * alone and stays here.
 *
 * The last describe, `the four withhold rules are observably live on a whole
 * feed`, joined this file on 2026-09-07 — the split's table always placed it
 * here, and it could only land once the whole-feed apparatus it is built from
 * became importable as scripts/country-facts/runHarness.ts. It calls no
 * `run()` and touches no filesystem.
 */

import { existsSync, readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { describe, expect, test } from "vitest";
import { RENDERED_FIELDS, buildFacts } from "./facts.mjs";
import { FILLER_POOL, SAMPLE_FILLERS, SAMPLE_GROWTH_GAIN, type Row } from "./fixtures";
import {
  EXPECTED_COUNTRIES,
  MEASURED_FIELD_COVERAGE,
  MIN_FIELD_COVERAGE,
  REQUIRED_NAMES,
  assertFactsSane,
} from "./gate.mjs";
import { PLUG_LETTER_SET } from "./picks.mjs";
import { FILLERS, dropRows, healthyFeed } from "./runHarness";

// ---------------------------------------------------------------------------
// assertFactsSane — one test per branch, each naming the mutation it kills
//
// Every branch is also driven through the real `run()` below and asserted to
// write nothing. These unit tests are what pin the MESSAGE and the exact
// boundary; the run() block is what proves the gate is wired into the path a
// nightly job actually takes.
// ---------------------------------------------------------------------------

/**
 * Six disjoint slices of a sample build whose fields sum to 131 — more than
 * MAX_SHRINK_RATIO's 5% of its 2,209 facts — while each field stays above its
 * own per-field coverage floor and no country loses more than one field. Sized
 * that way on purpose: the point is to reach the DRIFT check specifically,
 * rather than being stopped one gate earlier for an unrelated reason.
 *
 * Re-sized at Task 25 against the MEASURED floors, which are much tighter than
 * Task 24's provisional guesses. The headroom each slice has left is now one
 * or two countries wide for the last three fields (officialLanguages 13,
 * drivingSide 11, lat 10) — which is the arithmetic that forced
 * MAX_SHRINK_RATIO down to 0.05, because the largest loss that clears every
 * floor at once is 9.3% and a 10% threshold could never have fired.
 */
const SAMPLE_DRIFT_LOSS: [string, string[]][] = [
  ["plugs", SAMPLE_FILLERS.slice(0, 40)],
  ["voltageV", SAMPLE_FILLERS.slice(40, 70)],
  ["emergency", SAMPLE_FILLERS.slice(70, 100)],
  ["officialLanguages", SAMPLE_FILLERS.slice(100, 112)],
  ["drivingSide", SAMPLE_FILLERS.slice(112, 122)],
  ["lat", SAMPLE_FILLERS.slice(122, 131)],
];

function applySampleDriftLoss(countries: Record<string, Record<string, unknown>>): void {
  for (const [field, codes] of SAMPLE_DRIFT_LOSS) for (const code of codes) delete countries[code][field];
}

/** A whole, healthy build: 246 countries shaped the way the design measured them. */
function sampleBuilt(): {
  countries: Record<string, Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
} {
  const countries: Record<string, Record<string, unknown>> = {};
  const base = {
    name: "Sample Country",
    currencyCode: "XCD",
    currencyName: "East Caribbean dollar",
    plugs: ["C"],
    voltageV: 230,
    drivingSide: "right",
    emergency: [{ number: "112", role: "emergency" }],
    officialLanguages: ["English"],
    callingCode: "+1",
    lat: 10,
  };
  for (const code of SAMPLE_FILLERS) countries[code] = structuredClone(base);
  countries.CN = {
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
  };
  countries.PE = { ...structuredClone(base), name: REQUIRED_NAMES.PE };
  countries.JP = structuredClone(base);
  countries.CH = structuredClone(base);
  countries.SH = {
    name: "Saint Helena, Ascension and Tristan da Cunha",
    currencyCode: "SHP",
    currencyName: "Saint Helena pound",
    drivingSide: "left",
    lat: -15.9,
  };
  const ordered: Record<string, Record<string, unknown>> = {};
  for (const code of Object.keys(countries).sort()) ordered[code] = countries[code];
  return {
    countries: ordered,
    diagnostics: {
      soleDroppedArticlePlugs: [],
      soleDroppedLanguages: [],
      scopedLanguages: [],
      curatedFired: [],
      curatedStale: [],
      withheld: {},
    },
  };
}

/** The first filler code, used wherever a test needs "some ordinary country". */
const ANY = FILLER_POOL[0];

describe("assertFactsSane", () => {
  test("a healthy build passes, so every rejection below is a real signal", () => {
    // Without this the whole block could pass while the gate rejected
    // everything, including good data.
    expect(Object.keys(sampleBuilt().countries)).toHaveLength(EXPECTED_COUNTRIES);
    expect(() => assertFactsSane(sampleBuilt(), null)).not.toThrow();
  });

  test("rejects too few countries", () => {
    const built = sampleBuilt();
    for (const code of Object.keys(built.countries).slice(0, 10)) delete built.countries[code];
    expect(() => assertFactsSane(built, null)).toThrow(/countries carry facts, expected 246/);
  });

  test("rejects too many countries — a floor could never catch this", () => {
    // The band is two-sided because `previous === null` on a first run, which
    // is exactly when every drift check early-returns.
    const built = sampleBuilt();
    for (const code of FILLER_POOL.slice(245, 255)) built.countries[code] = { lat: 1 };
    expect(() => assertFactsSane(built, null)).toThrow(/countries carry facts, expected 246/);
  });

  test.each(["CN", "PE", "JP", "CH"])("rejects a build where %s carries no facts", (code) => {
    const built = sampleBuilt();
    built.countries[code] = {};
    delete built.countries[code];
    built.countries[FILLER_POOL[245]] = { lat: 1 };
    expect(() => assertFactsSane(built, null)).toThrow(new RegExp(`${code} carries no facts`));
  });

  test("rejects a build with no sparse fixture, which is what tells silence from forgetting", () => {
    const built = sampleBuilt();
    delete built.countries.SH;
    built.countries[FILLER_POOL[245]] = structuredClone(built.countries[ANY]);
    expect(() => assertFactsSane(built, null)).toThrow(/SH is absent/);
  });

  test("rejects a sparse fixture that has stopped being sparse", () => {
    // No coverage floor can see this: floors only ever count downwards.
    const built = sampleBuilt();
    built.countries.SH = structuredClone(built.countries[ANY]);
    expect(() => assertFactsSane(built, null)).toThrow(/SH now carries every rendered field/);
  });

  test("rejects a country key that is not two uppercase letters", () => {
    const built = sampleBuilt();
    built.countries.PER = structuredClone(built.countries[ANY]);
    expect(() => assertFactsSane(built, null)).toThrow(/malformed country key "PER"/);
  });

  test("rejects a record that is present but empty", () => {
    const built = sampleBuilt();
    built.countries[ANY] = {};
    expect(() => assertFactsSane(built, null)).toThrow(/present with an empty record/);
  });

  test("rejects a field this build has never examined", () => {
    const built = sampleBuilt();
    built.countries[ANY].tippingCustom = "10%";
    expect(() => assertFactsSane(built, null)).toThrow(/unknown field "tippingCustom"/);
  });

  test("rejects an empty string, because the honest gap is ABSENT not empty", () => {
    const built = sampleBuilt();
    built.countries[ANY].currencyName = "";
    expect(() => assertFactsSane(built, null)).toThrow(/is an empty string/);
  });

  test.each([
    ["a bare entity id", "Q4917"],
    ["a sentinel", "unknown"],
    ["an entity URI", "http://www.wikidata.org/entity/Q4917"],
    // The case fold in `SENTINEL_TEXT` and the URI pattern, armed. Every
    // fixture above is lowercase, so dropping the `i` flag from either regex
    // left this whole block green while letting "Unknown", "N/A" and
    // "HTTP://…" through to the artifact. Upstream labels are free text.
    ["a capitalised sentinel", "Unknown"],
    ["an upper-case N/A", "N/A"],
    ["an upper-case URI scheme", "HTTP://www.wikidata.org/entity/Q4917"],
  ])("rejects %s leaking into a human-readable field", (_name, value) => {
    const built = sampleBuilt();
    built.countries[ANY].currencyName = value;
    expect(() => assertFactsSane(built, null)).toThrow(/leaked through/);
  });

  test("rejects a label long enough to be a leaked blob", () => {
    const built = sampleBuilt();
    built.countries[ANY].currencyName = "x".repeat(200);
    expect(() => assertFactsSane(built, null)).toThrow(/over the 80 character ceiling/);
  });

  test("rejects a language list long enough to be a join gone wrong", () => {
    const built = sampleBuilt();
    built.countries[ANY].officialLanguages = Array.from({ length: 60 }, (_, i) => `Language ${i}`);
    expect(() => assertFactsSane(built, null)).toThrow(/official languages, over the 40 ceiling/);
  });

  test("rejects a plug list longer than any real country's", () => {
    const built = sampleBuilt();
    built.countries[ANY].plugs = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    expect(() => assertFactsSane(built, null)).toThrow(/plug types, over the 8 ceiling/);
  });

  test("rejects an emergency list longer than any real country's", () => {
    const built = sampleBuilt();
    built.countries[ANY].emergency = Array.from({ length: 9 }, (_, i) => ({
      number: `10${i}`,
      role: null,
    }));
    expect(() => assertFactsSane(built, null)).toThrow(/emergency numbers, over the 8 ceiling/);
  });

  test("rejects an empty emergency array — absent, never empty", () => {
    const built = sampleBuilt();
    built.countries[ANY].emergency = [];
    expect(() => assertFactsSane(built, null)).toThrow(/non-array or empty emergency/);
  });

  test("rejects an industrial voltage — the BZ 550/220 shape, arriving by another route", () => {
    const built = sampleBuilt();
    built.countries[ANY].voltageV = 550;
    expect(() => assertFactsSane(built, null)).toThrow(/outside 100-260 V/);
  });

  test("rejects a currency code that is not ISO 4217 alphabetic — the CZ 203 shape", () => {
    const built = sampleBuilt();
    built.countries[ANY].currencyCode = "203";
    expect(() => assertFactsSane(built, null)).toThrow(/not ISO 4217 alphabetic/);
  });

  test("rejects a plug letter that is not in the standard table", () => {
    const built = sampleBuilt();
    built.countries[ANY].plugs = ["Z"];
    expect(() => assertFactsSane(built, null)).toThrow(/plug type "Z"/);
  });

  test("rejects an empty plugs array — absent, never empty", () => {
    const built = sampleBuilt();
    built.countries[ANY].plugs = [];
    expect(() => assertFactsSane(built, null)).toThrow(/non-array or empty plugs/);
  });

  test("rejects unsorted plug letters, which would rewrite the artifact every night", () => {
    const built = sampleBuilt();
    built.countries[ANY].plugs = ["C", "A"];
    expect(() => assertFactsSane(built, null)).toThrow(/not sorted and unique/);
  });

  test("rejects a DUPLICATE plug letter, which the sort check alone cannot see", () => {
    // The message says "not sorted and unique" and only the sorted half was
    // pinned: `["C","A"]` is caught element-wise, so the length comparison
    // that catches a duplicate could be deleted with nothing going red. A
    // repeated letter renders as "uses type A/C/C", which is a broken sentence
    // rather than a wrong fact — and it is still not something to ship.
    //
    // The duplicate is at the END on purpose. `["A","A","C"]` dedupes to
    // `["A","C"]`, whose second element already disagrees with the original's,
    // so the element-wise walk catches it and the length clause is STILL
    // unpinned — a first attempt at this test made exactly that mistake.
    // `["A","C","C"]` dedupes to a strict prefix of itself, so every index the
    // walk visits matches and only the length comparison can see it.
    const built = sampleBuilt();
    built.countries[ANY].plugs = ["A", "C", "C"];
    expect(() => assertFactsSane(built, null)).toThrow(/not sorted and unique/);
  });

  test("rejects an emergency number that is not two to six digits", () => {
    // Not a bare Q-id here: the sentinel walk above already refuses those, so
    // a Q-id fixture would test that check twice and leave this one untested.
    const built = sampleBuilt();
    built.countries[ANY].emergency = [{ number: "911911911", role: null }];
    expect(() => assertFactsSane(built, null)).toThrow(/emergency number "911911911"/);
  });

  test("rejects an emergency role nobody mapped", () => {
    const built = sampleBuilt();
    built.countries[ANY].emergency = [{ number: "112", role: "wildlife rescue" }];
    expect(() => assertFactsSane(built, null)).toThrow(/emergency role "wildlife rescue"/);
  });

  test("rejects a driving side that is neither left nor right", () => {
    const built = sampleBuilt();
    built.countries[ANY].drivingSide = "sideways";
    expect(() => assertFactsSane(built, null)).toThrow(/drives on "sideways"/);
  });

  test("rejects a dialling code with no plus", () => {
    const built = sampleBuilt();
    built.countries[ANY].callingCode = "0051";
    expect(() => assertFactsSane(built, null)).toThrow(/dialling code "0051"/);
  });

  test("rejects an out-of-range latitude", () => {
    const built = sampleBuilt();
    built.countries[ANY].lat = 500;
    expect(() => assertFactsSane(built, null)).toThrow(/latitude 500/);
  });

  test("rejects a build where Q60740126 became some country's only plug value", () => {
    // This is the LIVE-DATA invariant, armed. Dropping the article by id is
    // lossless only while zero countries rely on it; a future upstream edit
    // that breaks that must fail the build rather than silently cost 39
    // countries their sockets tip.
    const built = sampleBuilt();
    built.diagnostics.soleDroppedArticlePlugs = ["GB"];
    expect(() => assertFactsSane(built, null)).toThrow(/as their ONLY plug value/);
  });

  test("rejects a build where a dropped language item became a country's only value", () => {
    // The LIVE-DATA invariant for `DROPPED_LANGUAGE_ITEMS`, armed exactly like
    // the plug article's. Dropping Q1339026, Bokmål, Nynorsk and Taglish by id
    // is lossless only while zero countries rely on them.
    const built = sampleBuilt();
    built.diagnostics.soleDroppedLanguages = ["GN"];
    expect(() => assertFactsSane(built, null)).toThrow(/as their official-language values/);
  });

  test("does NOT reject a build where a country's languages were all territorially scoped", () => {
    // The deliberate asymmetry with the check above, pinned so it cannot be
    // "tidied" into symmetry. A dropped id emptying a country means the drop
    // list has outgrown its measurement; a scoped statement emptying one is
    // the rule working — it is what stops the United States being told
    // Carolinian is one of its official languages. US, AF, AZ, BE, BQ and PW
    // are measured members of that set, and the nightly job must not go red
    // for them.
    const built = sampleBuilt();
    built.diagnostics.scopedLanguages = ["US", "BE"];
    expect(() => assertFactsSane(built, null)).not.toThrow();
  });

  test.each([
    ["CN", "China"],
    ["PE", "PE"],
  ])("rejects a build where %s.name stopped being the name a traveller is shown", (code, value) => {
    // "PE" is the exact regression this field exists to close: before it,
    // `getCountry("PE").name` was "PE" and the gap note read "We don't have
    // PE-specific guidance". "China" is the opposite mistake — a nicer name
    // than upstream carries, which means the ingest edited its source.
    const built = sampleBuilt();
    built.countries[code].name = value;
    expect(() => assertFactsSane(built, null)).toThrow(new RegExp(`${code}.name is`));
  });

  test("rejects a build where a country lost its name entirely", () => {
    const built = sampleBuilt();
    delete built.countries.PE.name;
    expect(() => assertFactsSane(built, null)).toThrow(/PE.name is undefined/);
  });

  test("rejects a stale curated override rather than letting it rot", () => {
    const built = sampleBuilt();
    built.diagnostics.curatedStale = ["NL.currencyCode"];
    expect(() => assertFactsSane(built, null)).toThrow(/no longer fire/);
  });

  test.each([
    ["currencyCode", "USD"],
    ["voltageV", 110],
    ["drivingSide", "left"],
    ["callingCode", "+87"],
  ])("rejects a build whose CN.%s stopped reproducing the hand-written answer", (field, value) => {
    const built = sampleBuilt();
    built.countries.CN[field] = value;
    expect(() => assertFactsSane(built, null)).toThrow(new RegExp(`CN.${field} is`));
  });

  test("rejects a build whose CN plug letters stopped reproducing lib/packing.ts:64", () => {
    const built = sampleBuilt();
    built.countries.CN.plugs = ["A", "C"];
    expect(() => assertFactsSane(built, null)).toThrow(/CN.plugs is/);
  });

  test("rejects a build that lost one of China's three emergency numbers", () => {
    const built = sampleBuilt();
    built.countries.CN.emergency = [
      { number: "110", role: "police" },
      { number: "119", role: "fire" },
    ];
    expect(() => assertFactsSane(built, null)).toThrow(/CN has no emergency number 120/);
  });

  test.each(Object.keys(MIN_FIELD_COVERAGE))(
    "rejects a build where %s went null nearly everywhere while every record survived",
    (field) => {
      // The assertExtractQualitySane lesson: all 246 records can survive while
      // one field empties, and no count check can see it.
      const built = sampleBuilt();
      // Every country except the ones an EARLIER gate pins for this field —
      // CN for the reproduction cross-check, and CN and PE for `name`. Those
      // gates would otherwise be what rejects the build, which would leave the
      // floor itself untested.
      const pinned = field === "name" ? new Set(Object.keys(REQUIRED_NAMES)) : new Set(["CN"]);
      for (const [code, record] of Object.entries(built.countries)) {
        if (!pinned.has(code)) delete record[field];
      }
      expect(() => assertFactsSane(built, null)).toThrow(
        new RegExp(`only ${pinned.size} countries carry ${field}`)
      );
    }
  );

  test("every drift check is inert on a first run, which is why the checks above are not", () => {
    // Stated as a test rather than as a comment: this is the exact property
    // that makes a bare floor insufficient.
    const built = sampleBuilt();
    expect(() => assertFactsSane(built, null)).not.toThrow();
    expect(() => assertFactsSane(built, { countries: {} })).not.toThrow();
  });

  test("rejects a country that lost every fact while the global total barely moved", () => {
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    const built = sampleBuilt();
    delete built.countries[ANY];
    built.countries[FILLER_POOL[245]] = structuredClone(built.countries[FILLER_POOL[1]]);
    expect(() => assertFactsSane(built, previous)).toThrow(/lost every fact/);
  });

  test("rejects a fact count that fell more than 10%", () => {
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    const built = sampleBuilt();
    applySampleDriftLoss(built.countries);
    expect(() => assertFactsSane(built, previous)).toThrow(/fact count fell/);
  });

  test("rejects a fact count that rose more than 10% — a withhold rule may have stopped firing", () => {
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    for (const [field, codes] of SAMPLE_GROWTH_GAIN) {
      for (const code of codes) delete previous.countries[code][field];
    }
    expect(() => assertFactsSane(sampleBuilt(), previous)).toThrow(/fact count rose/);
  });

  test("rejects one country being hollowed out, which no global ratio can see", () => {
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    const built = sampleBuilt();
    delete built.countries[ANY].plugs;
    delete built.countries[ANY].officialLanguages;
    expect(() => assertFactsSane(built, previous)).toThrow(/lost more than 1 field/);
  });

  test("tolerates one field of churn in one country", () => {
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    const built = sampleBuilt();
    delete built.countries[ANY].officialLanguages;
    expect(() => assertFactsSane(built, previous)).not.toThrow();
  });

  test("the sparse fixture is checked against the seven rendered fields", () => {
    expect(RENDERED_FIELDS).toEqual([
      "currencyCode",
      "plugs",
      "voltageV",
      "drivingSide",
      "emergency",
      "officialLanguages",
      "callingCode",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The committed artifact — live data, honestly skipped until it exists
//
// Task 25 builds and commits data/country-facts.json. Until it does, this
// block skips rather than passing vacuously, which is the house precedent
// (lib/cityShard.test.ts:325).
// ---------------------------------------------------------------------------

const FACTS_PATH = pathJoin(process.cwd(), "data", "country-facts.json");
const hasArtifact = existsSync(FACTS_PATH);

describe.skipIf(!hasArtifact)("data/country-facts.json", () => {
  const artifact = (): { countries: Record<string, Record<string, unknown>> } =>
    JSON.parse(readFileSync(FACTS_PATH, "utf8"));

  test("still satisfies every gate this ingest applies", () => {
    // Not a re-run of the ingest: the committed file is checked against the
    // rules as they stand today, so a rule added after the artifact was built
    // reddens here rather than waiting for the next nightly.
    expect(() =>
      assertFactsSane({ countries: artifact().countries, diagnostics: {} }, null)
    ).not.toThrow();
  });

  test("dropping Q60740126 cost no country its plug field", () => {
    // The live half of the invariant, and the honest limit of it: the artifact
    // carries LETTERS, not the Q-ids the rule acts on, so what is checkable
    // here is the consequence — plug coverage has not fallen, which is exactly
    // what would happen if the 39 article-carrying countries had lost their
    // only value. The ARMED half, the one that fails a nightly build the day
    // upstream changes, is the `soleDroppedArticlePlugs` gate in
    // `assertFactsSane`, which runs on every build rather than only when this
    // file happens to be present.
    const records = Object.values(artifact().countries);
    const withPlugs = records.filter((record) => record.plugs !== undefined);
    expect(withPlugs.length).toBeGreaterThanOrEqual(MIN_FIELD_COVERAGE.plugs);
    for (const record of withPlugs) {
      for (const letter of record.plugs as string[]) expect(PLUG_LETTER_SET.has(letter)).toBe(true);
    }
  });

  test("at least one country has an honest gap, so the withholds are real", () => {
    const records = Object.values(artifact().countries);
    const withGaps = records.filter((record) =>
      RENDERED_FIELDS.some((field) => record[field] === undefined)
    );
    expect(withGaps.length).toBeGreaterThan(0);
  });

  test("MEASURED_FIELD_COVERAGE is what the committed artifact actually carries", () => {
    // The constant the floors are derived FROM, checked against the file it
    // claims to describe. Without this the derivation is only as good as a
    // number somebody typed — which is the exact failure this replaced: the
    // measured table used to live in a comment and five of its numbers had
    // drifted from the artifact.
    const records = Object.values(artifact().countries);
    for (const [field, expected] of Object.entries(MEASURED_FIELD_COVERAGE)) {
      const covered = records.filter((record) => record[field] !== undefined).length;
      expect(covered, `${field} coverage`).toBe(expected);
    }
  });

  test("every floor takes ten countries of headroom except the two pinned rows", () => {
    // The uniform rule, and both deviations, asserted rather than described.
    // A future edit that quietly re-pins a third row has to change this list.
    const headroom = Object.fromEntries(
      Object.entries(MIN_FIELD_COVERAGE).map(([field, floor]) => [
        field,
        MEASURED_FIELD_COVERAGE[field as keyof typeof MEASURED_FIELD_COVERAGE] - floor,
      ])
    );
    expect(headroom).toEqual({
      name: 2,
      currencyCode: 10,
      currencyName: 10,
      plugs: 10,
      voltageV: 10,
      drivingSide: 10,
      emergency: 10,
      officialLanguages: 6,
      callingCode: 10,
      lat: 10,
    });
  });

  test("the officialLanguages floor lets SIX countries go silently and stops the seventh", () => {
    // THE CLAIM THE COMMENT USED TO GET WRONG, IN THE UNSAFE DIRECTION. It
    // promised that "the next six countries to lose their languages should
    // stop the nightly job"; the gate is `covered < floor`, so six lands
    // exactly ON the floor and passes. Only the seventh is under it.
    //
    // Written as a boundary pair rather than a sentence, because a sentence is
    // what drifted. If anybody moves the floor or the measurement, this fails
    // and states the real margin instead of restating a stale one.
    const headroom =
      MEASURED_FIELD_COVERAGE.officialLanguages - MIN_FIELD_COVERAGE.officialLanguages;
    expect(headroom).toBe(6);

    const stripLanguages = (count: number) => {
      const countries = artifact().countries;
      const losable = Object.keys(countries).filter(
        // Never CN: it is the reproduction country every other cross-check in
        // the file is anchored on, and an earlier gate would reject the build
        // for a different reason, leaving this floor untested.
        (code) => code !== "CN" && countries[code].officialLanguages !== undefined
      );
      for (const code of losable.slice(0, count)) delete countries[code].officialLanguages;
      return () => assertFactsSane({ countries, diagnostics: {} }, null);
    };

    // Exactly on the floor — 233 of 246 — and the nightly job ships it.
    expect(stripLanguages(headroom)).not.toThrow();
    // One further, 232, and it stops.
    expect(stripLanguages(headroom + 1)).toThrow(
      /only 232 countries carry officialLanguages, under the 233 floor/
    );
  });
});

// ---------------------------------------------------------------------------
// The withhold rules, on a whole feed rather than one picker at a time
//
// The pickers' own describes are in scripts/country-facts/picks.test.ts, one
// rule at a time against a hand-built row set. This asks the complementary
// question — whether the withhold path is REACHED on a 246-country feed shaped
// like the real upstream — and it is the gate's question, because a withhold
// that stopped firing would change the fact count `assertFactsSane` bounds.
// ---------------------------------------------------------------------------

describe("the four withhold rules are observably live on a whole feed", () => {
  test("currency, voltage, plug and emergency withholds each fire at least once", () => {
    // The design's risk 3 asks for exactly this: proof that the withhold path
    // runs rather than being dead code that a coverage number cannot
    // distinguish from a feed that never needed it.
    const feed = healthyFeed();
    // A P2853 value with no row in the standard table.
    dropRows(feed, "plugs", [FILLERS[0]]);
    (feed.plugs as Row[]).push({
      country: FILLERS[0],
      item: "http://www.wikidata.org/entity/Q123456",
      itemLabel: "GOST 7396",
    });
    // Two emergency numbers and no P366 role on either.
    dropRows(feed, "emergency", [FILLERS[1]]);
    (feed.emergency as Row[]).push(
      { country: FILLERS[1], number: "112", role: "" },
      { country: FILLERS[1], number: "118", role: "" }
    );
    const built = buildFacts(feed);
    expect(built.diagnostics.withheld.currency, "no currency was withheld").toContain("NL");
    expect(built.diagnostics.withheld.voltage, "no voltage was withheld").toContain("BZ");
    expect(built.diagnostics.withheld.plugs, "no plug field was withheld").toContain(FILLERS[0]);
    expect(built.diagnostics.withheld.emergency, "no emergency field was withheld").toContain(FILLERS[1]);
  });
});
