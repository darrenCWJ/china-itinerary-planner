import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, test } from "vitest";
import {
  COUNTRY_CODES,
  EXPECTED_COUNTRIES,
  MIN_FIELD_COVERAGE,
  PLUG_LETTER_SET,
  REQUIRED_NAMES,
  RENDERED_FIELDS,
} from "@/scripts/ingest-country-facts.mjs";

/**
 * The COMMITTED artifact, checked as data rather than as code.
 *
 * scripts/ingest-country-facts.test.ts proves the rules; this file proves the
 * file those rules produced on 2026-08-27 and that a human then committed.
 * They are different questions: every gate can be correct while the artifact
 * on disk is a stale copy from before a rule existed, and every number in a
 * doc-comment can be true while the file it describes was never rebuilt.
 *
 * Every figure asserted below was produced by that run. None of them is
 * carried forward from the design's prototype — the design's own note on this
 * is explicit ("re-measure, do not carry the number forward untested"), and
 * the prototype was wrong about four of them: currency coverage (its `en`-only
 * label filter dropped every eurozone country), plug coverage (it assumed a
 * letter for BS 546), latitude coverage, and the artifact's size.
 */
const FACTS_PATH = join(process.cwd(), "data", "country-facts.json");
const SHARD_DIR = join(process.cwd(), "public", "cities");

/**
 * The artifact is a committed build artefact, not source: `npm ci` does not
 * produce it and `scripts/ingest-country-facts.mjs` needs network egress. A
 * checkout without it skips here rather than failing, which is the house
 * precedent (lib/cityShard.test.ts, lib/isoTopology.test.ts) and is the
 * difference between "this went unchecked" and "this is broken".
 */
const hasAssets = existsSync(FACTS_PATH);

type EmergencyNumber = { number: string; role: string | null };
type CountryFacts = {
  name?: string;
  currencyCode?: string;
  currencyName?: string;
  plugs?: string[];
  voltageV?: number;
  drivingSide?: string;
  emergency?: EmergencyNumber[];
  officialLanguages?: string[];
  callingCode?: string;
  lat?: number;
};
type Artifact = {
  generatedAt: string;
  source: string;
  license: string;
  countries: Record<string, CountryFacts>;
};

const artifact: Artifact | null = hasAssets
  ? (JSON.parse(readFileSync(FACTS_PATH, "utf8")) as Artifact)
  : null;

/**
 * Per-field coverage the shipping query produced on 2026-08-27, exact.
 *
 * Pinned exactly rather than as floors, and that is deliberate even though
 * `MIN_FIELD_COVERAGE` already carries floors: a floor answers "has this
 * collapsed", and an exact pin answers "is the committed file the one that run
 * produced". A rebuild that legitimately moves a number changes one line here
 * next to the artifact it describes, which is a diff a reviewer can read.
 */
const MEASURED_COVERAGE: Record<string, number> = {
  name: 246,
  currencyCode: 239,
  currencyName: 239,
  plugs: 207,
  voltageV: 221,
  drivingSide: 245,
  emergency: 221,
  // 239, not the 243 Task 25 measured. Six countries carry only P37 statements
  // upstream itself marks `applies to part`, which is upstream saying they are
  // not claims about the whole country, so the ingest withholds the whole
  // field for them: AF, AZ, BE, BQ, PW, US. Two of the six are then RESCUED by
  // a hand-verified `CURATED_FACTS` row, because their qualifier names a part
  // of the country (Belgium's language regions) or a variety of the language
  // (Standard Azerbaijani) rather than a territory the national claim
  // excludes — so the net fall is four. The FLOOR in `MIN_FIELD_COVERAGE`
  // deliberately did NOT move with either number; the comment there says why.
  officialLanguages: 239,
  callingCode: 237,
  lat: 246,
};

/**
 * Measured: 70,098 bytes for 246 countries, 2,094 facts and 246 names.
 *
 * It was 70,443 for 2,098 facts (10,387 gzipped) before the territorial-scope
 * language rule withheld six countries' official languages, and 70,014 for
 * 2,092 before two of those six got their languages back from a curated row.
 * The artifact got smaller and then slightly larger again, which is what an
 * honest gap and an honest rescue each do to a budget.
 *
 * The design's prototype said 50,265 and said to re-measure rather than carry
 * it forward; the real figure is 40% larger, mostly because 239 countries
 * carry their official languages and `currencyName` ships beside every code.
 * Adding the country name cost 4,927 bytes — 1,440 gzipped — which is the
 * price of every gap note and every packing line naming a country instead of
 * a two-letter code.
 *
 * The budget matters because this file reaches the BROWSER —
 * components/PlanStep.tsx generates the wizard preview client-side, and
 * serving guidance server-only would reintroduce the preview/saved-trip
 * disagreement this whole work exists to fix. For scale:
 * data/country-images.json is 6,505 bytes and fine, and
 * lib/server/cityIndex.ts is 3.65 MB and explicitly forbidden from client
 * components. The budget STAYS at 80 KB rather than moving up with the
 * measurement: 12% of headroom is still room for real upstream growth and is
 * now much less room for a shape change, which is the direction a budget
 * should travel. The next field that costs 5 KB should have to argue for
 * itself here.
 *
 * NOT ASSERTED, and stated so it is not assumed: the gzipped size. It is
 * measured (10,295 bytes at zlib's default level) and recorded, and nothing
 * here or anywhere else in the repo checks it.
 */
const MAX_ARTIFACT_BYTES = 80_000;

describe("COUNTRY_CODES is the app's shard universe", () => {
  const hasShards = existsSync(SHARD_DIR);

  test.skipIf(!hasShards)("equals the committed city shards exactly, in both directions", () => {
    // A derived contract, not a restatement: the ingest asks Wikidata about a
    // hard-coded list, and the only thing making that list the RIGHT list is
    // this check. A shard added without a row here is a country that silently
    // never gets facts; a row here without a shard is a country whose facts
    // nothing can ever read.
    const shards = readdirSync(SHARD_DIR)
      .filter((file) => /^[A-Z]{2}\.json$/.test(file))
      .map((file) => file.slice(0, 2))
      .sort();
    expect(shards).toHaveLength(EXPECTED_COUNTRIES);
    expect(COUNTRY_CODES).toEqual(shards);
  });
});

describe.skipIf(!hasAssets)("the committed data/country-facts.json", () => {
  test("carries 246 countries under a CC0 envelope", () => {
    expect(Object.keys(artifact!.countries)).toHaveLength(EXPECTED_COUNTRIES);
    expect(artifact!.license).toBe("CC0-1.0");
    expect(artifact!.source).toBe("Wikidata (CC0)");
    expect(artifact!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Sorted keys, or a rebuild with no data change rewrites the file and the
    // nightly job commits and redeploys production for nothing.
    const codes = Object.keys(artifact!.countries);
    expect([...codes].sort()).toEqual(codes);
  });

  test("reproduces China's answer, which a human wrote before this ingest existed", () => {
    // lib/packing.ts:64 says "Universal power adapter (China uses type A/C/I
    // plugs, 220V)" and was written without ever seeing Wikidata. This is the
    // one country where a wrong upstream edit is DETECTABLE rather than merely
    // plausible, and it is not self-referential: CN's P2853 values are
    // Europlug + NEMA 1-15 + AS/NZS 3112, which sort to exactly A, C and I.
    const cn = artifact!.countries.CN;
    expect(cn.name).toBe(REQUIRED_NAMES.CN);
    expect(cn.currencyCode).toBe("CNY");
    expect(cn.plugs).toEqual(["A", "C", "I"]);
    expect(cn.voltageV).toBe(220);
    expect(cn.drivingSide).toBe("right");
    expect(cn.callingCode).toBe("+86");
    expect(cn.emergency).toEqual([
      { number: "110", role: "police" },
      { number: "119", role: "fire" },
      { number: "120", role: "ambulance" },
    ]);
  });

  test("reproduces Peru's answer, the design's acceptance case", () => {
    const pe = artifact!.countries.PE;
    // "Peru", not "PE". Wiring the gap note before this field existed would
    // have rendered "We don't have PE-specific guidance" for 222 countries.
    expect(pe.name).toBe("Peru");
    expect(pe.name).toBe(REQUIRED_NAMES.PE);
    expect(pe.currencyCode).toBe("PEN");
    expect(pe.plugs).toEqual(["A", "B", "C"]);
    expect(pe.voltageV).toBe(220);
    expect(pe.drivingSide).toBe("right");
    expect(pe.callingCode).toBe("+51");
    const byRole = new Map((pe.emergency ?? []).map((entry) => [entry.role, entry.number]));
    expect(byRole.get("police")).toBe("105");
    expect(byRole.get("fire")).toBe("116");
    // 106 and 117 are both roled `ambulance` upstream; the design pins 106 and
    // the ingest keeps both, so this asserts presence rather than the pair.
    expect((pe.emergency ?? []).map((entry) => entry.number)).toContain("106");
    expect(pe.officialLanguages).toContain("Spanish");
  });

  test("states nothing false about the official languages of the US, the Philippines or Norway", () => {
    // THE THREE PINNED CASES. Each was a sentence the app rendered, saved into
    // TripPlan.tips, and republished on the unauthenticated /b/[code] link —
    // so a wrong value here is not a bad template, it is a falsehood a rebuild
    // cannot recall. They are pinned by name because a coverage number cannot
    // see any of them: all three countries answered, and answered wrongly.
    const countries = artifact!.countries;

    // US: every truthy P37 statement upstream carries is scoped to a territory
    // (Carolinian and Chamorro to the Northern Marianas, Hawaiian to Hawaii,
    // Samoan to American Samoa, Spanish to Puerto Rico) and English's is at
    // deprecated rank, so there is no national list to state. WITHHELD, and
    // the gap note says so — which is the promise the feature already made.
    expect(countries.US?.officialLanguages).toBeUndefined();
    // Armed: US must still be a rich record, or "withheld" and "we lost the
    // United States" would look identical here.
    expect(countries.US?.currencyCode).toBe("USD");
    expect(countries.US?.callingCode).toBe("+1");

    // PH: Taglish is the Tagalog/English code-switching register Manila
    // speaks, not a language anybody ships a translation pack for. Dropped by
    // id; English and Filipino, which are the constitutional pair, stay.
    expect(countries.PH?.officialLanguages).toEqual(["English", "Filipino"]);

    // NO: Bokmål and Nynorsk are the two WRITTEN FORMS of Norwegian, which
    // Norway lists alongside Norwegian itself — so the old value named one
    // language three times. Dropped by id; the Language Act's actual pair
    // stays.
    expect(countries.NO?.officialLanguages).toEqual(["Norwegian", "Sámi"]);

    // The rule that produced the US answer, stated as a set rather than as one
    // country. SEVEN countries carry no language field: four because every P37
    // statement upstream gives them is territorially scoped (AF, BQ, PW, US)
    // and three because upstream states no official language at all (GP, MQ,
    // UY — the first two are French overseas departments whose item carries
    // none, and Uruguay's Spanish is de facto and unstated). Pinned as one list
    // so a future upstream edit that re-admits any of them has to be looked at
    // rather than absorbed.
    const withheld = Object.entries(countries)
      .filter(([, record]) => record.officialLanguages === undefined)
      .map(([code]) => code)
      .sort();
    expect(withheld).toEqual(["AF", "BQ", "GP", "MQ", "PW", "US", "UY"]);

    // AZ and BE are NOT on that list, and the rule withheld them too — a
    // hand-verified `CURATED_FACTS` row put each back, because their P518
    // qualifier names a part of the country or a variety of the language
    // rather than a territory the national claim excludes. Asserted by VALUE,
    // because a row that fired with the wrong answer would be invisible to a
    // list check. Belgium's constitutional trio, and Azerbaijan's single state
    // language without the sign language the unscoped remainder would have
    // left standing alone.
    expect(countries.BE?.officialLanguages).toEqual(["Dutch", "French", "German"]);
    expect(countries.AZ?.officialLanguages).toEqual(["Azerbaijani"]);
  });

  test("has the per-field coverage the shipping query measured", () => {
    const records = Object.values(artifact!.countries);
    for (const [field, expected] of Object.entries(MEASURED_COVERAGE)) {
      const covered = records.filter((record) => record[field as keyof CountryFacts] !== undefined).length;
      expect(covered, `${field} coverage`).toBe(expected);
      // And the floor the ingest itself enforces, so the two cannot drift into
      // saying different things about the same field.
      const floor = (MIN_FIELD_COVERAGE as Record<string, number>)[field];
      expect(covered, `${field} against its floor`).toBeGreaterThanOrEqual(floor);
    }
  });

  test("has real gaps: countries missing a rendered field, and no country carrying an empty one", () => {
    // The honest-gap rule made checkable. If every country had every field,
    // either the world is simpler than it is or the withhold rules stopped
    // withholding — and a coverage floor cannot see the second, because floors
    // only ever count downwards.
    const records = Object.entries(artifact!.countries);
    const withGaps = records.filter(([, record]) =>
      RENDERED_FIELDS.some((field) => record[field as keyof CountryFacts] === undefined)
    );
    expect(withGaps.length).toBeGreaterThan(0);
    // Measured against the committed artifact: 184 of 246 carry all seven.
    // Pinned as the complement, so a build where the gaps quietly disappeared
    // fails here.
    const allSeven = records.length - withGaps.length;
    expect(allSeven).toBe(184);
    // What the territorial-scope rule costs this number, DERIVED rather than
    // restated — the previous version of this comment named a moved set that
    // included BQ (which was already four fields short, so it never moved) and
    // excluded US (which did move, and is the country the whole rule exists
    // for), and its arithmetic re-derived to 186 against a stated 187. Here the
    // countries whose ONLY missing rendered field is their languages are read
    // off the artifact, so the "before" figure is computed and cannot be wrong
    // about who is in it.
    const onlyLanguagesMissing = records
      .filter(
        ([, record]) =>
          RENDERED_FIELDS.filter((field) => record[field as keyof CountryFacts] === undefined)
            .length === 1 && record.officialLanguages === undefined
      )
      .map(([code]) => code)
      .sort();
    expect(onlyLanguagesMissing).toEqual(["AF", "GP", "MQ", "PW", "US", "UY"]);
    // GP, MQ and UY have never had languages upstream, so they were short
    // before the rule as well. AF, PW and US are what the rule actually moved,
    // and 184 + 3 = 187 is the figure it moved them from.
    const movedByTheRule = onlyLanguagesMissing.filter((code) => !["GP", "MQ", "UY"].includes(code));
    expect(movedByTheRule).toEqual(["AF", "PW", "US"]);
    expect(allSeven + movedByTheRule.length).toBe(187);
    // ABSENT, never empty. An empty array or an empty string would render as a
    // broken sentence where an absent field renders as nothing at all.
    for (const [code, record] of records) {
      expect(record.plugs?.length ?? 1, `${code}.plugs`).toBeGreaterThan(0);
      expect(record.emergency?.length ?? 1, `${code}.emergency`).toBeGreaterThan(0);
      expect(record.officialLanguages?.length ?? 1, `${code}.officialLanguages`).toBeGreaterThan(0);
      expect(JSON.stringify(record), code).not.toMatch(/""/);
    }
  });

  test("every record names its country, and no record is only a name", () => {
    // Two halves of one rule. `name` is identity, so every record carries one;
    // and it is not a fact, so it can never be the only thing keeping a record
    // in the file — a country we know nothing else about falls through to the
    // neutral profile instead, which is what the ingest's `factCount` enforces.
    for (const [code, record] of Object.entries(artifact!.countries)) {
      expect(typeof record.name, code).toBe("string");
      expect(record.name!.trim(), code).toBe(record.name);
      expect(record.name!.length, code).toBeGreaterThan(1);
      const facts = Object.keys(record).filter((field) => field !== "name");
      expect(facts.length, `${code} carries only a name`).toBeGreaterThan(0);
    }
    // Guinea's meta-item is gone from the extract, so the reader's language
    // rule has nothing left to refuse in the committed file.
    expect(artifact!.countries.GN?.officialLanguages).toEqual(["French"]);
  });

  test("every plug letter is one the hand-checked standard table can emit", () => {
    for (const [code, record] of Object.entries(artifact!.countries)) {
      for (const letter of record.plugs ?? []) expect(PLUG_LETTER_SET.has(letter), `${code} ${letter}`).toBe(true);
    }
  });

  test("carries no prose — this file is called country-FACTS and that name is a guardrail", () => {
    // A sentence reaching a traveller from upstream is the failure the whole
    // design is shaped to prevent. Nothing here should contain a full stop
    // followed by a space, and nothing should be long enough to be a clause.
    for (const [code, record] of Object.entries(artifact!.countries)) {
      for (const value of JSON.stringify(record).match(/"[^"]*"/g) ?? []) {
        expect(value, `${code}: ${value}`).not.toMatch(/\.\s/);
        expect(value.length, `${code}: ${value}`).toBeLessThanOrEqual(82);
      }
    }
  });

  test("stays inside a byte budget a client bundle will not notice", () => {
    // There is no byte budget on any other data/*.json in this repo. This one
    // has it because the artifact reaches the browser.
    const bytes = statSync(FACTS_PATH).size;
    expect(bytes, `data/country-facts.json is ${bytes} bytes`).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);
    // The positive half: a budget passes perfectly on an empty file.
    expect(bytes).toBeGreaterThan(40_000);
  });
});

/**
 * lib/countries.ts's `SOUTHERN` list, re-derived from source.
 *
 * Read out of the file rather than imported, because `SOUTHERN` is
 * module-private and should stay private — it is not a registry of supported
 * countries. lib/isoTopology.test.ts already scans the same block; the regex
 * approach is that file's precedent, not a new one.
 */
function southernCodes(): string[] {
  const source = readFileSync(join(process.cwd(), "lib", "countries.ts"), "utf8");
  const block = /const SOUTHERN = new Set\(\[([\s\S]*?)\]\)/.exec(source);
  if (!block) throw new Error("could not find the SOUTHERN block in lib/countries.ts");
  return [...block[1].matchAll(/"([A-Z]{2})"/g)].map((match) => match[1]);
}

/**
 * The only consumer of the ingested `lat` field. It is never rendered.
 *
 * Codes that belong in `SOUTHERN` although their centroid is NOT negative.
 * Exactly one: KE at +0.1. Kenya straddles the equator, and Nairobi, the Mara
 * and the coast — everywhere a visitor actually goes — are south of it, so its
 * travel season is the southern one. That judgement predates the centroid data
 * and survives it, which is why it is a named exception rather than something
 * a threshold rounds away.
 *
 * It is a list of CODES, not a latitude band, on purpose. A band of "within
 * half a degree" would silently admit whatever else drifted into it; a name has
 * to be argued for in a diff. The second test below fails if Wikidata ever
 * moves KE's centroid south, so the exception cannot rot into cruft either.
 */
const EQUATOR_STRADDLERS = new Set(["KE"]);

/**
 * Codes that belong in `SOUTHERN` although the artifact has no record for them,
 * so the sign rule has no centroid to read.
 *
 * Exactly three, all uninhabited: AQ (Antarctica), BV (Bouvet Island) and HM
 * (Heard & McDonald Islands). The ingest is bounded to sovereign states with a
 * city shard, so it never sees them — and without an entry they fell through to
 * `getCountry`'s default and reported Antarctica's January as WINTER. Their
 * hemisphere is not a close call: AQ is entirely south of 60°S, BV is at -54.4
 * and HM at -53.1.
 *
 * A list of CODES rather than a rule, for `EQUATOR_STRADDLERS`' reason: three
 * names have to be argued for in a diff. The test below fails the day any of
 * them GAINS a record, because at that point the sign rule covers it and the
 * exception is cruft.
 */
const OUTSIDE_THE_ARTIFACT = new Set(["AQ", "BV", "HM"]);

/**
 * The count `SOUTHERN` must hold, measured against the committed artifact:
 * 58 countries with a negative centroid, plus KE, plus the three uninhabited
 * codes the artifact does not reach.
 *
 * Pinned as well as reconciled because the reconciliation below is a set
 * comparison, and a set comparison of two things derived from the same file
 * would pass on an empty file. This number is the arming charge.
 */
const EXPECTED_SOUTHERN = 62;

/**
 * "Inside a degree of the equator", as a number rather than as prose.
 *
 * It existed as a bare `1.5` inline while the comment beside it said "a
 * degree", so the code and its own explanation disagreed and nothing could
 * see it. Inclusive, because Ecuador's centroid is exactly -1 and the
 * sentence "within a degree" is meant to include it.
 */
const NEAR_EQUATOR_DEGREES = 1;

describe.skipIf(!hasAssets)("SOUTHERN cross-check", () => {
  // Cheap, and hoisted out of every timed test body: parsing already happened
  // at module scope, so each test below does list work and nothing else.
  const southern = hasAssets ? southernCodes() : [];
  const southernSet = new Set(southern);
  const negativeLat = hasAssets
    ? Object.entries(artifact!.countries)
        .filter(([, record]) => typeof record.lat === "number" && record.lat < 0)
        .map(([code]) => code)
    : [];

  test("the list and the artifact are both really there, or every check below is vacuous", () => {
    expect(southern.length).toBe(EXPECTED_SOUTHERN);
    expect(new Set(southern).size).toBe(southern.length);
    expect(negativeLat.length).toBeGreaterThanOrEqual(50);
  });

  test("every listed southern country really is south, or is a named straddler", () => {
    const wrong: string[] = [];
    const missingLat: string[] = [];
    for (const code of southern) {
      const lat = artifact!.countries[code]?.lat;
      if (typeof lat !== "number") {
        if (!OUTSIDE_THE_ARTIFACT.has(code)) missingLat.push(code);
        continue;
      }
      if (lat >= 0 && !EQUATOR_STRADDLERS.has(code)) wrong.push(`${code}=${lat}`);
    }
    // One assertion per failure mode rather than two per country: 62 codes
    // would otherwise be 124 `expect()` calls inside the timed region.
    expect(missingLat, `listed as southern but absent from the artifact: ${missingLat.join(", ")}`).toEqual([]);
    expect(wrong, `listed as southern but not south of the equator: ${wrong.join(", ")}`).toEqual([]);
  });

  test("each code excused from the artifact really is absent from it, so the excuse cannot rot", () => {
    // The same rule `EQUATOR_STRADDLERS` gets one test below. An exception that
    // no longer excepts anything is cruft nobody re-checks — and here the day
    // it stops excepting is the day the sign rule can cover the code properly.
    for (const code of OUTSIDE_THE_ARTIFACT) {
      expect(
        artifact!.countries[code],
        `${code} now has a record, so its SOUTHERN entry should come from its centroid`
      ).toBeUndefined();
      expect(southernSet.has(code), `${code} is excused but not listed`).toBe(true);
    }
  });

  test("every country south of the equator is listed, which is the direction that was missing", () => {
    // THE OTHER HALF. The original check only ever walked `SOUTHERN`, so it
    // could see a wrong entry and never a missing one — and 25 countries
    // (Ecuador, Gabon, the Comoros, Mauritius, the Falklands, Christmas
    // Island, and 19 more) were absent from the list while passing it. A trip
    // to any of them in June was called summer when it is winter, and the
    // season drives the packing list, the crowd curve and the plan's copy.
    const unlisted = negativeLat.filter((code) => !southernSet.has(code)).sort();
    expect(
      unlisted,
      `south of the equator but missing from SOUTHERN in lib/countries.ts: ${unlisted.join(", ")}`
    ).toEqual([]);
  });

  test("each named straddler is still a straddler, so the exception cannot rot", () => {
    // An exception list that no longer excepts anything is cruft nobody
    // re-checks. If Wikidata moves KE's centroid south, this goes red and the
    // entry gets deleted rather than sitting there forever.
    for (const code of EQUATOR_STRADDLERS) {
      const lat = artifact!.countries[code]?.lat;
      expect(lat, `${code} is on the exception list but no longer needs to be`).toBeGreaterThanOrEqual(0);
      expect(lat, `${code} is too far north to be called a straddler`).toBeLessThan(5);
    }
  });

  test("the near-equator countries are listed by name, not rounded away by a threshold", () => {
    // The honest answer to "is a centroid at -0.5 meaningfully southern?".
    // These have no summer or winter to speak of — they have wet and dry
    // seasons — and this app has only two answers to give. Each is placed on
    // the sign of its centroid, which is at least what the data states, and
    // they are named here so the choice is visible rather than buried in a
    // magic number. If another country drifts inside a degree of the equator
    // this goes red and somebody decides on purpose.
    //
    // BOTH SIGNS, and the threshold matches the prose. The scan used to walk
    // `negativeLat` at a hard-coded 1.5 while the comment beside it said "a
    // degree": the number was wrong AND the half of the world it looked at
    // was, so São Tomé and Príncipe at +0.32 — as close to the equator as
    // Gabon and closer than Congo — was never named at all. It is northern
    // by centroid and this app calls it northern; that is now a decision on
    // the record rather than a country nothing looked at.
    const nearEquator = Object.entries(artifact!.countries)
      .filter(([, record]) => Math.abs(record.lat ?? 90) <= NEAR_EQUATOR_DEGREES)
      .map(([code]) => code)
      .sort();
    expect(nearEquator).toEqual(["CG", "EC", "GA", "KE", "NR", "ST"]);
    // Each on the side its own centroid states — the straddler exception is
    // the one place a human overrode that, and it is already named above.
    for (const code of nearEquator) {
      const shouldBeSouthern = artifact!.countries[code].lat! < 0 || EQUATOR_STRADDLERS.has(code);
      expect(southernSet.has(code), `${code} is on the side its centroid states`).toBe(
        shouldBeSouthern
      );
    }
  });
});

/**
 * `INGESTED_NAMES` in lib/countries.ts, parsed back out as data.
 *
 * Source text rather than the exported table, for the reason `southernCodes`
 * above reads source: the literal is what a human has to keep true after an
 * ingest, and a check that imported the module could not tell a name that is
 * checked in from one that is computed. The pattern refuses anything but a
 * two-letter key and a double-quoted value, so a malformed row drops out of the
 * parse and is caught by the count arming below rather than passing silently.
 */
function ingestedNames(): Record<string, string> {
  const source = readFileSync(join(process.cwd(), "lib", "countries.ts"), "utf8");
  const block = /const INGESTED_NAMES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(source);
  if (!block) throw new Error("could not find the INGESTED_NAMES block in lib/countries.ts");
  const out: Record<string, string> = {};
  for (const match of block[1].matchAll(/\b([A-Z]{2}): "((?:[^"\\]|\\.)*)"/g)) {
    out[match[1]] = JSON.parse(`"${match[2]}"`) as string;
  }
  return out;
}

/** The 24 codes `CURATED` names, parsed the same way and for the same reason. */
function curatedCodes(): string[] {
  const source = readFileSync(join(process.cwd(), "lib", "countries.ts"), "utf8");
  const block = /const CURATED: Record<[\s\S]*?\n\};/.exec(source);
  if (!block) throw new Error("could not find the CURATED block in lib/countries.ts");
  return [...block[0].matchAll(/^ {2}([A-Z]{2}): \{/gm)].map((match) => match[1]);
}

/**
 * 246 named countries in the artifact, minus the 24 `CURATED` names itself.
 *
 * Pinned as well as reconciled, for the reason `EXPECTED_SOUTHERN` is: the
 * reconciliation below compares two sets, and two sets both derived from a file
 * that failed to parse are both empty and compare equal. This is the arming
 * charge.
 */
const EXPECTED_INGESTED_NAMES = 222;

describe.skipIf(!hasAssets)("INGESTED_NAMES cross-check", () => {
  // Parsed once at describe scope. Every test below does list work only, so no
  // test spends its wall-clock budget re-reading and re-parsing two files
  // (commit 84cd61e).
  const names = hasAssets ? ingestedNames() : {};
  const curated = hasAssets ? curatedCodes() : [];
  const curatedSet = new Set(curated);
  const artifactNamed = hasAssets
    ? Object.entries(artifact!.countries)
        .filter(([, record]) => typeof record.name === "string" && record.name.length > 0)
        .map(([code]) => code)
    : [];

  test("both tables are really there, or every check below is vacuous", () => {
    expect(Object.keys(names)).toHaveLength(EXPECTED_INGESTED_NAMES);
    expect(curated).toHaveLength(24);
    expect(artifactNamed).toHaveLength(MEASURED_COVERAGE.name);
    // A row really was parsed, value and all — not just a key.
    expect(names.GA).toBe("Gabon");
  });

  test("every checked-in name is the artifact's, so the literal cannot go stale", () => {
    const wrong: string[] = [];
    for (const [code, name] of Object.entries(names)) {
      const upstream = artifact!.countries[code]?.name;
      if (upstream !== name) wrong.push(`${code}: "${name}" vs ${JSON.stringify(upstream)}`);
    }
    expect(
      wrong,
      `checked in with a name the artifact does not carry: ${wrong.join(", ")}`
    ).toEqual([]);
  });

  test("every country the artifact names is checked in, which is the direction that rots", () => {
    // THE OTHER HALF, and the one a one-directional check cannot see — exactly
    // the failure that left 25 southern countries out of `SOUTHERN` while every
    // entry in it passed. A country added by a later ingest and missing here
    // renders as a bare ISO code on the map pane and on the destination step.
    const unlisted = artifactNamed
      .filter((code) => !curatedSet.has(code) && !(code in names))
      .sort();
    expect(
      unlisted,
      `named by the artifact but missing from INGESTED_NAMES in lib/countries.ts: ${unlisted.join(", ")}`
    ).toEqual([]);
  });

  test("the two tables are disjoint, so the editorial name always wins structurally", () => {
    // `getCountry` reads CURATED first, but a precedence that depends on the
    // order of two `??` is one refactor away from inverting. The two tables
    // sharing no key is what makes it impossible: CN cannot be resolved to
    // "People's Republic of China" by any reordering, because this table has no
    // CN row to resolve it from.
    const overlap = Object.keys(names).filter((code) => curatedSet.has(code)).sort();
    expect(overlap, `curated and ingested both name: ${overlap.join(", ")}`).toEqual([]);
    // And the disagreement that disjointness protects is real, not
    // hypothetical — if it were not, this whole precedence would be noise.
    expect(artifact!.countries.CN?.name).toBe("People's Republic of China");
    expect(artifact!.countries.TR?.name).toBe("Turkey");
  });
});

// ---------------------------------------------------------------------------
// The bundle constraint — where the 70 KB is allowed to be reachable from
// ---------------------------------------------------------------------------

/**
 * Every non-test source file under lib/, components/ and app/.
 *
 * A source-level scan, which this repo uses for its structural contracts
 * (lib/contracts.test.ts) because the alternative — asserting a bundle size —
 * needs a build. Armed below against walking nothing.
 */
function sourceFiles(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir))) {
      const path = `${dir}/${entry}`;
      if (statSync(join(process.cwd(), path)).isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push({ path, code: readFileSync(join(process.cwd(), path), "utf8") });
      }
    }
  };
  for (const dir of ["lib", "components", "app"]) walk(dir);
  return out;
}

/** A VALUE import of a path — `import type` is erased and costs no bytes. */
const valueImportOf = (code: string, path: RegExp): boolean =>
  new RegExp(`import\\s+(?!type\\b)[^;]*from\\s+["'][^"']*${path.source}["']`).test(code);

describe("data/country-facts.json stays out of the bundles that only want a name", () => {
  const FILES = sourceFiles();

  test("the scan walks a real tree, or every check below is vacuous", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.map((file) => file.path)).toContain("lib/countries.ts");
    expect(FILES.map((file) => file.path)).toContain("lib/countryFacts.ts");
  });

  test("exactly one module imports the artifact", () => {
    // 70 KB. Every module that imports this one inherits it, so the list of
    // importers is the list of bundles paying for it — and it is one module
    // long on purpose.
    const importers = FILES.filter((file) => valueImportOf(file.code, /country-facts\.json/));
    expect(importers.map((file) => file.path)).toEqual(["lib/countryFacts.ts"]);
  });

  test("lib/countries.ts is a zero-import leaf, which is what keeps it cheap", () => {
    // The tempting fix for `getCountry("PE").name === "PE"` is to make THIS
    // module fall back to the artifact. It is imported by client components
    // for accents, marks and hemispheres, so that would put 70 KB into every
    // page that wanted a hue. The merge lives in lib/countryFacts.ts instead,
    // which already pays for the artifact — the same shape as lib/geoNamesId.ts
    // against the 3.65 MB city index.
    const countries = FILES.find((file) => file.path === "lib/countries.ts")!;
    expect(countries.code).toContain("export function curatedCountryName");
    expect(countries.code).not.toMatch(/^\s*import\s/m);
  });

  test("the template layer reaches the reader for TYPES only", () => {
    // lib/countryTips.ts is pure templates. A value import here would drag the
    // artifact into anything rendering a tip, whether or not it reads a fact.
    const tips = FILES.find((file) => file.path === "lib/countryTips.ts")!;
    expect(tips.code).toContain('import type { CountryFacts');
    expect(valueImportOf(tips.code, /countryFacts/)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The bundle constraint, transitively — added by T27
// ---------------------------------------------------------------------------

/**
 * Resolve one import specifier to a file in the scanned tree, or null.
 *
 * `@/x` is the tsconfig alias for the repo root and `./x` / `../x` are
 * relative; a bare specifier is a package and never the artifact. Extensions
 * are tried in the order the bundler tries them.
 */
function resolveSpecifier(from: string, spec: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Who imports whom, by VALUE. `import type` is erased at compile time and
 * costs no bytes, so it is not an edge — which is exactly why lib/countryTips.ts
 * may name `CountryFacts` and still not reach the artifact.
 */
function valueImportGraph(files: { path: string; code: string }[]): Map<string, string[]> {
  const known = new Set(files.map((file) => file.path));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const out = new Set<string>();
    for (const match of file.code.matchAll(/import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g)) {
      const resolved = resolveSpecifier(file.path, match[1], known);
      if (resolved !== null) out.add(resolved);
    }
    graph.set(file.path, [...out]);
  }
  return graph;
}

/** Whether `target` is reachable from `start` by following value imports. */
function reaches(graph: Map<string, string[]>, start: string, target: string): boolean {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    for (const edge of graph.get(next) ?? []) {
      if (edge === target) return true;
      if (!seen.has(edge)) {
        seen.add(edge);
        stack.push(edge);
      }
    }
  }
  return false;
}

/**
 * The 70 KB is allowed in a bundle that reads a fact, and nowhere else.
 *
 * The direct-importer test above stopped being enough the moment T27 wired the
 * facts into `getCountryProfile`: nothing imports the JSON but lib/countryFacts.ts,
 * and every module that imports THAT one inherits the bytes. What matters is
 * which `"use client"` entry points reach it along any path at all, which is a
 * graph question, not a grep one.
 *
 * The split that keeps the list short is lib/countryBaseProfile.ts — see its
 * header. Four map and route components read a country's seasons, crowd,
 * holidays, climate and transport and none of its facts; before the split they
 * would have paid 70 KB for data nothing on the page reads.
 */
describe("only the surfaces that read a fact pay for the artifact", () => {
  const FILES = sourceFiles();
  const GRAPH = valueImportGraph(FILES);
  const ARTIFACT_READER = "lib/countryFacts.ts";
  const CLIENTS = FILES.filter((file) => /^\s*["']use client["']/m.test(file.code)).map(
    (file) => file.path
  );

  /**
   * Seasons, crowd, holidays, climate, transport — and the modules that serve
   * them. Every one of these is rendered on pages that read no country fact,
   * so a `true` here is 70 KB of dead weight in a map bundle.
   */
  const MUST_STAY_CHEAP = [
    "components/map/MapExplorer.tsx",
    "components/map/MonthTimeline.tsx",
    "components/map/PlacePopup.tsx",
    "components/trip/RouteMap.tsx",
    "lib/countryBaseProfile.ts",
    "lib/countries.ts",
    "lib/months.ts",
    "lib/route.ts",
    "lib/tripSeason.ts",
  ];

  test("the walk resolves real edges, or every check below is vacuous", () => {
    // Three independent arming claims: the tree was walked, the client set is
    // real, and the graph resolves both a direct edge and a transitive path.
    expect(FILES.length).toBeGreaterThan(150);
    expect(CLIENTS.length).toBeGreaterThan(40);
    expect(GRAPH.get("lib/countryProfile.ts")).toContain(ARTIFACT_READER);
    // PlanStep reaches it three hops away (→ itinerary → countryProfile →
    // countryFacts) and names it nowhere, so a `true` for it can only come
    // from the transitive walk actually working.
    const planStep = FILES.find((file) => file.path === "components/PlanStep.tsx");
    expect(planStep?.code).not.toContain("countryFacts");
    expect(reaches(GRAPH, "components/PlanStep.tsx", ARTIFACT_READER)).toBe(true);
  });

  test("`import type` is not an edge, so the template layer stays free", () => {
    // lib/countryTips.ts names `CountryFacts` in an `import type`. If the walk
    // counted that, every consumer of a tip template would look like it paid
    // for the artifact and this whole contract would be noise.
    expect(GRAPH.get("lib/countryTips.ts")).not.toContain(ARTIFACT_READER);
    expect(reaches(GRAPH, "lib/countryTips.ts", ARTIFACT_READER)).toBe(false);
  });

  test("no map, route or calendar surface reaches the artifact", () => {
    const offenders = MUST_STAY_CHEAP.filter((path) => reaches(GRAPH, path, ARTIFACT_READER));
    expect(offenders).toEqual([]);
    // The list is real files, not typos that can never fail.
    const scanned = FILES.map((file) => file.path);
    for (const path of MUST_STAY_CHEAP) expect(scanned).toContain(path);
    expect(MUST_STAY_CHEAP).toHaveLength(9);
  });

  test("the client entry points that pay for it are exactly these", () => {
    // Pinned, not bounded. Every name here reads a country fact — a tip, a
    // packing item, a gap note or the money pivot — and the list is short
    // because lib/countryBaseProfile.ts exists. A new name appearing is not
    // necessarily wrong, but it is 70 KB in one more bundle and it should be
    // a decision somebody made rather than one that happened.
    //
    // T28 added components/shell/ShareMenu.tsx and components/shell/AppShell.tsx
    // on the argument that both are mounted from app/layout.tsx, which already
    // paid through components/shell/TripAccentProvider.tsx — so two more names
    // cost nothing measurable. The argument was sound and the premise was the
    // defect: the root layout paid on EVERY route, /login and the
    // unauthenticated /b/[code] briefing included, which quietly mooted this
    // whole contract. T28b removed the premise, so all three names are gone:
    //
    //   - TripAccentProvider now reads `tripCountry` from lib/tripCountry.ts,
    //     a leaf that value-imports nothing. It never needed a profile.
    //   - ShareMenu loads its briefing through `dynamic(() => import(...))`, so
    //     `buildBriefing` and the artifact land in their own chunk instead of
    //     the shell's. AppShell, which only mounts ShareMenu, came free.
    //
    // components/shell/ShareBriefing.tsx is what took their place, and it is
    // the far side of that dynamic import: still a client component, still
    // paying the 70 KB, but only for a member who opens Share and expands the
    // briefing. See the root-layout contract below.
    const paying = CLIENTS.filter((path) => reaches(GRAPH, path, ARTIFACT_READER)).sort();
    expect(paying).toEqual([
      "app/plan/page.tsx",
      "components/PlanStep.tsx",
      "components/TripView.tsx",
      "components/shell/ShareBriefing.tsx",
      "components/trip/BalancesCard.tsx",
      "components/trip/DayCard.tsx",
      "components/trip/ExpenseForm.tsx",
      "components/trip/KitTab.tsx",
      "components/trip/MoneyTab.tsx",
      "components/trip/PackingSection.tsx",
      "components/trip/PlanTab.tsx",
      "components/trip/TodayTab.tsx",
      "components/trip/TrackerTab.tsx",
    ]);
    // And the complement is not empty: most client components pay nothing.
    expect(CLIENTS.length - paying.length).toBeGreaterThan(20);
  });

  /**
   * app/layout.tsx, and everything it mounts.
   *
   * This is the assertion whose ABSENCE let the defect stand. Until T28b the
   * root layout reached the artifact twice over — through TripAccentProvider,
   * which wanted one field off `data.input`, and through AppShell → ShareMenu
   * → lib/briefing.ts — and because the layout wraps every route, the 70 KB
   * shipped to /login, which no signed-in user has ever reached, and to
   * /b/[code], the unauthenticated bearer-link briefing. Every per-surface pin
   * above was true the whole time and none of them could see it: they ask which
   * SURFACES pay, and the layout is not a surface, it is the floor.
   *
   * Measured 2026-08-27: the layout's subtree fell from 41 modules to 18.
   */
  const ROOT_LAYOUT = "app/layout.tsx";
  const ROOT_LAYOUT_SUBTREE = [
    ROOT_LAYOUT,
    "components/shell/AppShell.tsx",
    "components/shell/PrefsProvider.tsx",
    "components/shell/ShareMenu.tsx",
    "components/shell/ShellTripContext.tsx",
    "components/shell/TripAccentProvider.tsx",
    "lib/tripCountry.ts",
  ];

  test("the root layout reaches the artifact from nowhere, so every route starts free", () => {
    // ARMED three ways, because a `false` out of a graph walk is exactly the
    // shape a broken walk produces for free.
    //
    // (1) An app/ entry point that genuinely DOES pay is still detected, so a
    // walk that resolved no app/ specifier at all cannot pass here. /b/[code]
    // calls buildBriefing server-side, which is allowed and is the point: the
    // bytes are on the server, not in that page's client bundle.
    expect(reaches(GRAPH, "app/b/[code]/page.tsx", ARTIFACT_READER)).toBe(true);
    // (2) The layout's own edges resolved. Pinned rather than counted: a new
    // root-layout import is 70 KB on every route if it reaches the artifact,
    // so admitting one should be a line in this diff.
    expect([...(GRAPH.get(ROOT_LAYOUT) ?? [])].sort()).toEqual([
      "components/shell/AppShell.tsx",
      "components/shell/ShellTripContext.tsx",
      "components/shell/TripAccentProvider.tsx",
    ]);
    // (3) The paths listed below are real files, not typos that can never fail.
    const scanned = FILES.map((file) => file.path);
    for (const path of ROOT_LAYOUT_SUBTREE) expect(scanned).toContain(path);

    const offenders = ROOT_LAYOUT_SUBTREE.filter((path) =>
      reaches(GRAPH, path, ARTIFACT_READER)
    );
    expect(offenders).toEqual([]);
  });

  test("the accent bridge reads a leaf, not the module that pays", () => {
    // TripAccentProvider needs `data.input.country ?? "CN"` and nothing else. It
    // used to import that from lib/tripShared.ts, which reaches the artifact
    // through `tripCurrency` — 70 KB for a one-line accessor, on every route.
    const leaf = FILES.find((file) => file.path === "lib/tripCountry.ts")!;
    expect(leaf.code).toContain("export function tripCountry");
    // A leaf in the strong sense: both its imports are `import type`, so the
    // walk resolves no edge out of it at all.
    expect(GRAPH.get("lib/tripCountry.ts")).toEqual([]);
    // And the bridge really reads it from there. Without this, the test above
    // would keep passing if someone inlined the backfill instead.
    const bridge = FILES.find(
      (file) => file.path === "components/shell/TripAccentProvider.tsx"
    )!;
    expect(valueImportOf(bridge.code, /tripCountry/)).toBe(true);
    expect(valueImportOf(bridge.code, /tripShared/)).toBe(false);
    // lib/tripShared.ts still re-exports the name, so nothing that already reads
    // a fact had to change its import.
    const shared = FILES.find((file) => file.path === "lib/tripShared.ts")!;
    expect(shared.code).toContain("export { tripCountry };");
  });

  test("the in-app briefing is a chunk of its own, not part of the shell", () => {
    // The other root-layout path: AppShell mounts ShareMenu on every route, and
    // ShareMenu used to import `buildBriefing`, which resolves the gap note and
    // therefore the artifact. A static import here is the whole defect.
    const menu = FILES.find((file) => file.path === "components/shell/ShareMenu.tsx")!;
    expect(valueImportOf(menu.code, /lib\/briefing/)).toBe(false);
    // The dynamic import that replaced it. The walk does not count it as an
    // edge, and that is correct rather than convenient: the bundler splits it
    // into a chunk fetched when the disclosure opens, so those bytes are not in
    // the shell's.
    expect(menu.code).toContain('import("./ShareBriefing")');
    // The split is real, not cosmetic: the module on the far side of it is where
    // the artifact actually lands.
    expect(reaches(GRAPH, "components/shell/ShareBriefing.tsx", ARTIFACT_READER)).toBe(true);
  });

  test("the public briefing page renders without resolving a fact itself", () => {
    // Unchanged from T28, and still what the lib/briefing.ts split protects:
    // /b/[code] renders BriefingView, and BriefingView must not resolve the gap
    // note, or the artifact lands in the bearer-link client bundle.
    expect(reaches(GRAPH, "components/trip/BriefingView.tsx", ARTIFACT_READER)).toBe(false);
    const view = FILES.find((file) => file.path === "components/trip/BriefingView.tsx");
    expect(view?.code).not.toContain("countryProfile");
  });
});
