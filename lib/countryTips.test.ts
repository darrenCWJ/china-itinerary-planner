import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CN_PACKING } from "./countryData/cn";
import {
  COUNTRY_FACTS,
  CURATED_FACTS,
  type CountryFacts,
  type CountryFactsIndex,
  getCountryFacts,
  getCountryName,
  readCountryFactsIndex,
  readCountryFactsRecord,
} from "./countryFacts";
import {
  GAP_NOTE_FIELDS,
  buildGapNote,
  cashBackupItem,
  currencyTip,
  emergencyTip,
  factTips,
  languageTip,
  powerAdapterItem,
  roadAndDiallingTip,
  socketsTip,
  translationPackItem,
} from "./countryTips";

/**
 * The template layer, checked against the REAL committed artifact.
 *
 * Every fixture below is a real country read out of `data/country-facts.json`
 * through `getCountryFacts` — never a record invented here — except where a
 * malformed shape is the thing under test. That is deliberate: this design's
 * biggest named failure mode is "a template renders a true fact into a false
 * sentence", and a test fed hand-written facts cannot see it. Writing this
 * file against the real data is what surfaced Guinea's non-language language
 * (see `readCountryFactsRecord`'s `languageName`), which no invented fixture
 * would have contained.
 *
 * `lib/countryFacts.test.ts` skips when the artifact is missing, because it
 * reads the file from disk. This file does not skip: `lib/countryFacts.ts`
 * imports the artifact statically, so a checkout without it does not build at
 * all, and a skip here would be a test that quietly stops running.
 */

const PE = getCountryFacts("PE");
const CN = getCountryFacts("CN");
/** Saint Helena: three of the seven rendered fields, and the design's own gap-note example. */
const SH = getCountryFacts("SH");
/** South Africa: twelve official languages, and no plug types at all. */
const ZA = getCountryFacts("ZA");

// ---------------------------------------------------------------------------
// The reproduction gate
// ---------------------------------------------------------------------------

describe("the reproduction gate", () => {
  /**
   * Read out of `lib/countryData/cn.ts` rather than retyped, so an edit to
   * EITHER side fails. A retyped copy would only ever test this file against
   * itself.
   */
  const handWritten = CN_PACKING.flatMap((group) => group.items).filter((item) =>
    item.startsWith("Universal power adapter")
  );

  test("China's ingested facts reproduce the line a human wrote before this ingest existed", () => {
    // Arming. `find`-style lookups that match nothing compare undefined to
    // undefined and pass; this pins that the line is there and is the only one.
    expect(handWritten).toHaveLength(1);
    expect(handWritten[0]).toBe("Universal power adapter (China uses type A/C/I plugs, 220V)");

    // The gate itself. China's P2853 values are Europlug + NEMA 1-15 + AS/NZS
    // 3112, which sort to A, C and I, and its P2884 is 220 — so this is an
    // independent check on the whole template layer by a source that never saw
    // Wikidata. A bad upstream edit to China's plugs or voltage, or a reworded
    // template, fails here on the one country whose answer is known correct.
    expect(powerAdapterItem("China", CN)).toBe(handWritten[0]);
  });

  test("the facts the gate depends on are the ones the artifact carries", () => {
    // Says out loud what the byte-for-byte match is standing on, so a future
    // reader does not have to reverse-engineer it from a string.
    expect(CN.plugs).toEqual(["A", "C", "I"]);
    expect(CN.voltageV).toBe(220);
  });
});

// ---------------------------------------------------------------------------
// Golden output
// ---------------------------------------------------------------------------

describe("golden output", () => {
  test("Peru — the design's acceptance case, carrying all seven rendered fields", () => {
    expect(factTips(PE)).toEqual([
      "Prices are in PEN. Set your home currency on the Money tab for live conversions.",
      "Sockets are type A, B and C at 220 V — bring a universal adapter.",
      "Emergency numbers: 105 police, 116 fire, 106 or 117 ambulance.",
      "Aymara, Quechua and Spanish are official languages.",
      "Traffic drives on the right. The international dialling code is +51.",
    ]);
    expect(powerAdapterItem("Peru", PE)).toBe(
      "Universal power adapter (Peru uses type A/B/C plugs, 220V)"
    );
    expect(cashBackupItem(PE)).toBe("Some PEN cash as a backup");
    // Three official languages and upstream states no primacy, so there is no
    // one language to name a pack for. NEUTRAL_PACKING's own "translation app
    // downloaded before you fly" already covers the ground, so nothing is lost.
    expect(translationPackItem(PE)).toBeNull();
    // All six gap-note fields present, so line 2 does not exist.
    expect(buildGapNote("Peru", PE)).toEqual([
      "These notes come from open reference data. We don't have Peru-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
    ]);
  });

  test("China — the same templates over the one hand-researched country", () => {
    // These are not what a CN trip renders: T27 dispatches CN to the
    // hand-written profile and gives it an empty gap note. They are here
    // because CN is the country whose facts are independently verifiable.
    expect(factTips(CN)).toEqual([
      "Prices are in CNY. Set your home currency on the Money tab for live conversions.",
      "Sockets are type A, C and I at 220 V — bring a universal adapter.",
      "Emergency numbers: 110 police, 119 fire, 120 ambulance.",
      "Putonghua is the official language.",
      "Traffic drives on the right. The international dialling code is +86.",
    ]);
    expect(cashBackupItem(CN)).toBe("Some CNY cash as a backup");
    expect(translationPackItem(CN)).toBe("Offline Putonghua translation pack");
  });

  test("Saint Helena — a genuinely sparse country, three fields of seven", () => {
    expect(SH).toEqual({
      // Identity, not one of the three: `name` is what the templates CALL the
      // country, so it is absent from every count of what we know about it.
      name: "Saint Helena, Ascension and Tristan da Cunha",
      drivingSide: "left",
      emergency: [{ number: "999", role: null }],
      officialLanguages: ["English"],
      lat: -15.9245,
    });
    expect(factTips(SH)).toEqual([
      // Singular, and bare: upstream gives no role for 999, and inventing one
      // ("general", "emergency") would be this module writing a fact.
      "Emergency number: 999.",
      "English is the official language.",
      // Driving side alone. The dialling clause is simply absent rather than
      // taking the driving-side clause down with it.
      "Traffic drives on the left.",
    ]);
    expect(powerAdapterItem("Saint Helena", SH)).toBeNull();
    expect(cashBackupItem(SH)).toBeNull();
    expect(translationPackItem(SH)).toBe("Offline English translation pack");
    expect(buildGapNote("Saint Helena", SH)).toEqual([
      "These notes come from open reference data. We don't have Saint Helena-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
      "Our data also has no currency, plug types, mains voltage or dialling code for this country.",
    ]);
  });

  test("South Africa — the cost of naming every official language, made visible", () => {
    // Twelve languages in one sentence is not pretty, and it is pinned here so
    // the cost is reviewed rather than discovered. The alternative is worse:
    // capping the list drops languages, and picking a "main" one invents a
    // primacy Wikidata's P37 does not carry. Measured: only 6 of 246 countries
    // carry more than four official languages.
    expect(languageTip(ZA)).toBe(
      "Afrikaans, English, Northern Sotho, Sesotho, South African Sign Language, Southern Ndebele, " +
        "Swazi, Tsonga, Tswana, Venda, Xhosa and Zulu are official languages."
    );
    // One number serving three roles. Listing the entries flat would repeat it
    // three times; dropping two would discard the roles it covers.
    expect(emergencyTip(ZA)).toBe("Emergency number: 112 police, fire and ambulance.");
    expect(buildGapNote("South Africa", ZA)).toEqual([
      "These notes come from open reference data. We don't have South Africa-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
      "Our data also has no plug types for this country.",
    ]);
  });

  test("the language tip states the fact and issues no instruction", () => {
    // THE DEFECT. It used to end "— download an offline translation pack
    // before you go", four tips below NEUTRAL_TIPS' "Download offline maps and
    // a translation pack before you leave." Same instruction, twice, in one
    // panel, for the 239 countries whose languages the artifact carries.
    // `countryProfile.test.ts` holds the other half: every country still gets
    // that instruction, exactly once, from the neutral tip.
    expect(languageTip(PE)).toBe("Aymara, Quechua and Spanish are official languages.");
    expect(languageTip(SH)).toBe("English is the official language.");
    const imperative = /\b(download|bring|set|book|carry|install|check|tell)\b/i;
    const offenders: string[] = [];
    for (const code of Object.keys(COUNTRY_FACTS)) {
      const tip = languageTip(getCountryFacts(code));
      if (tip !== null && imperative.test(tip)) offenders.push(`${code}: ${tip}`);
    }
    expect(offenders).toEqual([]);
    // Armed: the sweep found language tips to look at, and the regex it uses
    // does fire on a line that carries an instruction.
    const withLanguages = Object.keys(COUNTRY_FACTS).filter(
      (code) => languageTip(getCountryFacts(code)) !== null
    );
    expect(withLanguages).toHaveLength(239);
    expect(imperative.test("Download offline maps and a translation pack before you leave.")).toBe(
      true
    );
  });

  test("the two duplicate-role shapes, from the two real countries that have them", () => {
    // Peru: two numbers under one role. Switzerland: both shapes at once — two
    // ambulance numbers AND a fifth roleless-in-spirit "emergency" entry.
    expect(emergencyTip(PE)).toBe("Emergency numbers: 105 police, 116 fire, 106 or 117 ambulance.");
    expect(emergencyTip(getCountryFacts("CH"))).toBe(
      "Emergency numbers: 117 police, 118 fire, 1414 or 144 ambulance, 112 emergency."
    );
    // Every number upstream carries survives into the sentence, for both.
    for (const facts of [PE, getCountryFacts("CH"), ZA, getCountryFacts("AG")]) {
      const tip = emergencyTip(facts) ?? "";
      for (const entry of facts.emergency ?? []) expect(tip).toContain(entry.number);
    }
  });
});

// ---------------------------------------------------------------------------
// The honest-gap rule: every field, individually absent
// ---------------------------------------------------------------------------

/** Every key `CountryFacts` can carry. Removing each in turn is the parameterisation. */
const ALL_FIELDS = [
  "currencyCode",
  "currencyName",
  "plugs",
  "voltageV",
  "drivingSide",
  "emergency",
  "officialLanguages",
  "callingCode",
  "lat",
] as const satisfies readonly (keyof CountryFacts)[];

function without(facts: CountryFacts, field: keyof CountryFacts): CountryFacts {
  const copy: Record<string, unknown> = { ...facts };
  delete copy[field];
  return copy as CountryFacts;
}

/**
 * Which fact each all-or-nothing template needs. A template listed against a
 * field must return null when that field is gone, and must be UNCHANGED when
 * any other field is gone — that second half is what catches a template
 * quietly depending on something it never names.
 */
const NEEDS: { name: string; run: (facts: CountryFacts) => string | null; fields: string[] }[] = [
  { name: "currencyTip", run: currencyTip, fields: ["currencyCode"] },
  { name: "socketsTip", run: socketsTip, fields: ["plugs", "voltageV"] },
  { name: "emergencyTip", run: emergencyTip, fields: ["emergency"] },
  { name: "languageTip", run: languageTip, fields: ["officialLanguages"] },
  { name: "powerAdapterItem", run: (f) => powerAdapterItem("Peru", f), fields: ["plugs", "voltageV"] },
  { name: "cashBackupItem", run: cashBackupItem, fields: ["currencyCode"] },
  { name: "translationPackItem", run: translationPackItem, fields: ["officialLanguages"] },
];

/**
 * Shapes a template must never emit. Each one is what a vanished value leaves
 * behind: `undefined`/`null`/`NaN` from a bare interpolation, a double space
 * or a space against punctuation from an interpolation that produced "", empty
 * parentheses from a list that ran dry, and a dangling comma from a join.
 * Hedges and placeholders are forbidden outright — the honest-gap rule says a
 * template that cannot speak says nothing, not "typically around 220 V".
 */
const FORBIDDEN: [string, RegExp][] = [
  ["undefined", /undefined/],
  ["null", /\bnull\b/],
  ["NaN", /NaN/],
  ["unknown", /\bunknown\b/i],
  ["N/A", /N\/A/],
  ["TBD", /\bTBD\b/i],
  // A dash is legitimate PUNCTUATION mid-sentence in three templates ("at
  // 220 V — bring a universal adapter"), so it cannot be banned outright. It
  // is a PLACEHOLDER when it stands where a value belongs — at the edge of a
  // line, or straight after the word that introduces the value.
  ["dash at the edge of a line", /^\s*[—–-]|[—–-]\s*$/],
  ["dash standing in for a value", /\b(type|in|is|are|at|on)\s+[—–](\s|$)/i],
  ["hedge", /\b(possibly|typically|approximately|roughly|probably|perhaps|maybe|about|around)\b/i],
  ["double space", /\s\s/],
  ["padded or empty parentheses", /\(\s|\s\)|\(\)/],
  ["space before punctuation", /\s[.,]/],
  ["dangling separator", /[,;]\s*$/],
];

function everyOutput(name: string, facts: CountryFacts): string[] {
  return [
    ...factTips(facts),
    ...buildGapNote(name, facts),
    powerAdapterItem(name, facts),
    cashBackupItem(facts),
    translationPackItem(facts),
  ].filter((value): value is string => value !== null);
}

/**
 * Every way `lines` breaks the rules above, named — nothing asserted here.
 *
 * Collecting rather than asserting per line is load-bearing for the 246-country
 * sweep further down, which runs this over every country the artifact carries.
 * At 13 forbidden patterns plus two shape checks per line, over 2,043 rendered
 * lines and 1,154 tips, the assert-as-you-go version made ~33,000 `expect()`
 * calls in one test body. Measured on an idle machine: the templates those
 * calls check take **8ms** to run, and building the assertion objects takes
 * **199ms** — 96% of the test spent on the harness rather than on the code
 * under test. vitest bills a test's body to a wall-clock `testTimeout`, so the
 * sweep was burning a 5000ms budget on 8ms of real work, and it timed out in
 * 6 of 6 runs of this repo's 3x-concurrent-suite repro. One assertion over a
 * collected list checks exactly the same things for ~8ms.
 *
 * It also reports better than it used to. An `expect()` per line aborts on the
 * first bad one, so a template that broke forty countries showed you one of
 * them; this hands back all of them.
 */
function wellFormedViolations(label: string, lines: readonly string[]): string[] {
  const violations: string[] = [];
  for (const line of lines) {
    for (const [why, pattern] of FORBIDDEN) {
      if (pattern.test(line)) violations.push(`${label} — ${why}: |${line}|`);
    }
    if (line !== line.trim()) violations.push(`${label} — not trimmed: |${line}|`);
    if (line.length === 0) violations.push(`${label} — empty line`);
  }
  return violations;
}

function assertWellFormed(label: string, lines: readonly string[]): void {
  expect(wellFormedViolations(label, lines)).toEqual([]);
}

describe("every field, individually absent", () => {
  // This is not a defensive edge — it is the common path. Measured on the
  // committed artifact: plug types cover 207 of 246 countries, and 15 of those
  // 39 absences are deliberate, because one Wikidata item covers both BS 546
  // type D and type M, so India, South Africa, Pakistan, Israel, Sri Lanka and
  // ten others carry no plugs field rather than a guessed one.
  test.each(ALL_FIELDS)("without %s, every template either fires whole or not at all", (field) => {
    const reduced = without(PE, field);
    // Arming: `without` silently doing nothing would make every case below a
    // restatement of the Peru golden.
    expect(Object.keys(reduced)).toHaveLength(Object.keys(PE).length - 1);

    for (const template of NEEDS) {
      const before = template.run(PE);
      const after = template.run(reduced);
      if (template.fields.includes(field)) {
        expect(after, `${template.name} without ${field}`).toBeNull();
      } else {
        expect(after, `${template.name} without ${field}`).toBe(before);
      }
    }
    assertWellFormed(`Peru without ${field}`, everyOutput("Peru", reduced));
  });

  test("the road-and-dialling tip degrades clause by clause instead of vanishing", () => {
    // The one template built from two independent facts. All-or-nothing here
    // would throw away a true driving side for the eight countries that have
    // one and no dialling code — driving side covers 245, dialling code 237.
    expect(roadAndDiallingTip(PE)).toBe("Traffic drives on the right. The international dialling code is +51.");
    expect(roadAndDiallingTip(without(PE, "drivingSide"))).toBe(
      "The international dialling code is +51."
    );
    expect(roadAndDiallingTip(without(PE, "callingCode"))).toBe("Traffic drives on the right.");
    expect(roadAndDiallingTip(without(without(PE, "drivingSide"), "callingCode"))).toBeNull();
  });

  test("a country with no facts produces no fact-tips and no packing lines", () => {
    expect(factTips({})).toEqual([]);
    expect(powerAdapterItem("Nowhere", {})).toBeNull();
    expect(cashBackupItem({})).toBeNull();
    expect(translationPackItem({})).toBeNull();
    // Only the gap note, and it names all six.
    expect(buildGapNote("Nowhere", {})).toEqual([
      "These notes come from open reference data. We don't have Nowhere-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
      "Our data also has no currency, plug types, mains voltage, emergency numbers, official language or dialling code for this country.",
    ]);
  });

  test("no template output for any real country is partial, hedged or placeholdered", () => {
    // The generalised half. The parameterised test above proves the rule on
    // one country; this proves it on the 246 shapes that actually exist.
    let swept = 0;
    // Collected, then asserted once — see `wellFormedViolations` for why every
    // check in this loop reports into a list instead of calling `expect`.
    const violations: string[] = [];
    for (const code of Object.keys(COUNTRY_FACTS)) {
      const lines = everyOutput(`Country ${code}`, getCountryFacts(code));
      violations.push(...wellFormedViolations(code, lines));
      for (const tip of factTips(getCountryFacts(code))) {
        if (!/^[A-Z]/.test(tip)) violations.push(`${code} tip is not capitalised: |${tip}|`);
        if (!tip.endsWith(".")) violations.push(`${code} tip has no full stop: |${tip}|`);
      }
      swept += lines.length;
    }
    // Sliced only so a broad break prints readably; the count in the message is
    // the real total, and any violation at all still fails this line.
    expect(violations.slice(0, 25), `${violations.length} malformed line(s)`).toEqual([]);
    // Armed. Every assertion above lives inside a loop, so an artifact that
    // failed to load would leave this test green with nothing checked.
    expect(Object.keys(COUNTRY_FACTS)).toHaveLength(246);
    expect(swept).toBeGreaterThan(1500);
  });
});

// ---------------------------------------------------------------------------
// currencyName is carried and never rendered
// ---------------------------------------------------------------------------

describe("the upstream currency label never reaches a sentence", () => {
  test("Peru's committed label is the pre-2015 name, and no template emits it", () => {
    // Arming, and the reason for the rule: Peru dropped "nuevo" in 2015, so
    // the artifact publishes a name that is simply wrong — and 238 more that
    // nobody has checked. The templates render the ISO code instead, which is
    // stable by treaty and validated by shape.
    expect(PE.currencyName).toBe("Nuevo sol");
    for (const line of everyOutput("Peru", PE)) expect(line).not.toContain("Nuevo sol");
  });

  test("no country's rendered output contains that country's currency name", () => {
    let checked = 0;
    for (const code of Object.keys(COUNTRY_FACTS)) {
      const facts = getCountryFacts(code);
      const name = facts.currencyName;
      if (name === undefined) continue;
      checked++;
      for (const line of everyOutput(`Country ${code}`, facts)) {
        expect(line, `${code} rendered its currencyName`).not.toContain(name);
      }
    }
    expect(checked).toBe(239);
  });
});

// ---------------------------------------------------------------------------
// The gap note
// ---------------------------------------------------------------------------

describe("the gap note", () => {
  test("names exactly the absent field, one field at a time", () => {
    for (const { field, label } of GAP_NOTE_FIELDS) {
      const note = buildGapNote("Peru", without(PE, field));
      expect(note, `${field}`).toHaveLength(2);
      expect(note[1]).toBe(`Our data also has no ${label} for this country.`);
      // And names none of the other five. This is the half that catches a note
      // listing a field that IS present.
      for (const other of GAP_NOTE_FIELDS) {
        if (other.field === field) continue;
        expect(note[1], `${field} note mentioned ${other.label}`).not.toContain(other.label);
      }
    }
  });

  test("is one line when all six fields are present", () => {
    for (const { field } of GAP_NOTE_FIELDS) expect(PE[field]).toBeDefined();
    expect(buildGapNote("Peru", PE)).toHaveLength(1);
  });

  test("driving side is deliberately not one of the six", () => {
    // 245 of 246 countries carry it, so a line spent on it would almost never
    // be the line worth spending. Absent from the list, and absent from the
    // note when the field itself is gone.
    expect(GAP_NOTE_FIELDS.map((entry) => entry.field)).not.toContain("drivingSide");
    expect(buildGapNote("Peru", without(PE, "drivingSide"))).toHaveLength(1);
  });

  test("joins the labels with commas and a final or, in the fixed order", () => {
    expect(buildGapNote("Nowhere", { currencyCode: "PEN" })[1]).toBe(
      "Our data also has no plug types, mains voltage, emergency numbers, official language or dialling code for this country."
    );
    expect(buildGapNote("Nowhere", { callingCode: "+51" })[1]).toContain(
      "currency, plug types, mains voltage, emergency numbers or official language"
    );
  });

  test("line 2 says whose data is short, not what the country is like", () => {
    // THE DEFECT. It read "We also have no official language for United
    // States", which a reader takes as "the United States has no official
    // language" — a claim about the country, from a sentence whose only job
    // is to describe our coverage. The subject is now our data, and it can no
    // longer be read the other way.
    const line = buildGapNote("United States", without(PE, "officialLanguages"))[1];
    expect(line).toBe("Our data also has no official language for this country.");
    expect(line.startsWith("Our data")).toBe(true);
  });

  test("line 2 needs no article, because it interpolates no country name", () => {
    // THE SECOND HALF, and the larger one. `for ${name}` wanted a "the" for
    // "United States", "Philippines", "Isle of Man" and dozens more, must not
    // have one for "Peru", and would have to REMOVE one for "The Bahamas" and
    // "The Gambia" — which is a rule that is wrong for some of 246 names
    // forever. Line 1 already names the country, attributively, which is the
    // one position every name reads correctly in. So line 2 names none.
    //
    // Swept, not sampled: no country's line 2 contains its own name.
    const offenders: string[] = [];
    let swept = 0;
    for (const code of Object.keys(COUNTRY_FACTS)) {
      const name = getCountryName(code);
      const line = buildGapNote(name, getCountryFacts(code))[1];
      if (line === undefined) continue;
      swept += 1;
      if (line.includes(name)) offenders.push(`${code}: ${line}`);
    }
    expect(offenders).toEqual([]);
    // Armed: 60 countries are missing at least one of the six fields, so the
    // loop above is reading real second lines rather than skipping every one.
    expect(swept).toBeGreaterThan(50);
    // And armed the other way: the name is still on line 1, where it belongs.
    expect(buildGapNote("United States", PE)[0]).toContain("United States-specific");
  });

  test("is withheld entirely when the country cannot be named", () => {
    // `getCountry("🙂").name` is "", and a note that cannot say whose data is
    // missing is not a statement anyone can act on.
    expect(buildGapNote("", PE)).toEqual([]);
    expect(buildGapNote("   ", {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The boundary drops, it does not repair
// ---------------------------------------------------------------------------

describe("the boundary validator", () => {
  const wrap = (record: unknown): CountryFactsIndex =>
    readCountryFactsIndex({ countries: { PE: record } });

  test("refuses a value of the wrong type instead of coercing it", () => {
    expect(readCountryFactsRecord({ voltageV: "220" })).toBeNull();
    expect(readCountryFactsRecord({ plugs: "A" })).toBeNull();
    expect(readCountryFactsRecord({ emergency: "105" })).toBeNull();
    expect(readCountryFactsRecord({ lat: "-9.4" })).toBeNull();
  });

  test("refuses a value of the wrong shape instead of tidying it", () => {
    // Each of these has an obvious "fix", and taking it would invent data:
    // upper-casing a code asserts an ISO currency nobody verified, prefixing a
    // dialling code asserts a country prefix, trimming asserts the padding was
    // accidental.
    expect(readCountryFactsRecord({ currencyCode: "pen" })).toBeNull();
    expect(readCountryFactsRecord({ currencyCode: "PENN" })).toBeNull();
    expect(readCountryFactsRecord({ callingCode: "51" })).toBeNull();
    expect(readCountryFactsRecord({ currencyName: " sol " })).toBeNull();
    expect(readCountryFactsRecord({ drivingSide: "Right" })).toBeNull();
  });

  test("drops a whole array field rather than filtering the bad element out", () => {
    // Filtering would be a quiet strengthening of the claim: ["A"] states the
    // country uses exactly one plug type, which upstream never said.
    expect(readCountryFactsRecord({ plugs: ["A", "BB"], voltageV: 220 })).toEqual({ voltageV: 220 });
    expect(
      readCountryFactsRecord({
        emergency: [{ number: "105", role: "police" }, { number: "oops" }],
        voltageV: 220,
      })
    ).toEqual({ voltageV: 220 });
    expect(readCountryFactsRecord({ officialLanguages: ["Spanish", 7], voltageV: 220 })).toEqual({
      voltageV: 220,
    });
  });

  test("refuses an implausible voltage rather than publishing it", () => {
    // Belize's upstream 550/220 is what this band is for. The ingest gate
    // catches it before the artifact is written; this catches an artifact
    // edited by hand or served stale.
    expect(readCountryFactsRecord({ voltageV: 550 })).toBeNull();
    expect(readCountryFactsRecord({ voltageV: 12 })).toBeNull();
    expect(readCountryFactsRecord({ voltageV: 230.5 })).toBeNull();
    expect(readCountryFactsRecord({ voltageV: 230 })).toEqual({ voltageV: 230 });
  });

  test("refuses prose, because this file is called country-FACTS", () => {
    expect(
      readCountryFactsRecord({ currencyName: "The sol. Peru's currency since 1991." })
    ).toBeNull();
    expect(readCountryFactsRecord({ officialLanguages: ["x".repeat(81)] })).toBeNull();
  });

  test("a dropped record flows into the gap note rather than vanishing silently", () => {
    // The honest-gap rule reaching all the way down. A country whose whole
    // record is junk is indistinguishable, to a reader, from a country the
    // artifact never mentioned — and both say so out loud.
    const junk = readCountryFactsIndex({ countries: { PE: { voltageV: "220", plugs: "A" } } });
    expect(junk).toEqual({});
    const facts = getCountryFacts("PE", { facts: junk });
    expect(facts).toEqual({});
    expect(factTips(facts)).toEqual([]);
    expect(buildGapNote("Peru", facts)[1]).toBe(
      "Our data also has no currency, plug types, mains voltage, emergency numbers, official language or dialling code for this country."
    );
  });

  test("keeps the good fields of a record with one bad one", () => {
    expect(wrap({ currencyCode: "PEN", voltageV: "220" })).toEqual({ PE: { currencyCode: "PEN" } });
  });

  test("drops a record that is not an object, and a key that is not a country code", () => {
    expect(readCountryFactsRecord(null)).toBeNull();
    expect(readCountryFactsRecord(["A"])).toBeNull();
    expect(readCountryFactsRecord("PEN")).toBeNull();
    expect(readCountryFactsIndex({ countries: { peru: { voltageV: 220 } } })).toEqual({});
    expect(readCountryFactsIndex(null)).toEqual({});
  });

  test("an emergency entry with no role is a fact, not a malformed entry", () => {
    // Absent and null both spell "upstream gave no role", and null is how the
    // type spells it — no value is invented by preserving the absence.
    expect(readCountryFactsRecord({ emergency: [{ number: "999" }] })).toEqual({
      emergency: [{ number: "999", role: null }],
    });
    expect(readCountryFactsRecord({ emergency: [{ number: "999", role: null }] })).toEqual({
      emergency: [{ number: "999", role: null }],
    });
  });
});

describe("the boundary and the committed artifact agree", () => {
  /**
   * The artifact read from disk rather than through `lib/countryFacts.ts`,
   * so the two sides of the comparison below are genuinely independent. Read
   * with `fs` rather than imported, for the same reason `lib/cityShard.test.ts`
   * does: it keeps the raw shape out of the module graph the reader is under
   * test in.
   */
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "data", "country-facts.json"), "utf8")
  ) as { countries: Record<string, Record<string, unknown>> };

  test("the reader drops exactly one field of one country, and it is named", () => {
    // A too-tight boundary would silently shrink the data the ingest measured,
    // and lib/countryFacts.test.ts's coverage pins count the FILE, not what
    // survives this module — so nothing else in the repo can see this gap.
    const dropped: string[] = [];
    let compared = 0;
    for (const [code, record] of Object.entries(raw.countries)) {
      const read = getCountryFacts(code) as Record<string, unknown>;
      for (const field of Object.keys(record)) {
        compared++;
        if (read[field] === undefined) dropped.push(`${code}.${field}`);
      }
    }
    // Armed: an artifact that failed to parse would leave both empty and green.
    expect(Object.keys(raw.countries)).toHaveLength(246);
    // 2,094 facts plus one name per country. The name is not a fact — the
    // ingest keeps it out of `FACT_FIELDS` so no drift band moves by 246 — but
    // it IS a field this reader has to carry, so it is compared like one.
    expect(compared).toBe(2340);
    // Nothing is dropped any more. T26 refused Guinea's "languages of Guinea"
    // meta-item here, by label, which cost Guinea French with it; the ingest
    // now drops that item by its Q-id upstream, so what the artifact carries is
    // what upstream states. The rule that refused it is still live and still
    // tested — see the two tests below — it just has nothing to refuse in the
    // committed file.
    expect(dropped).toEqual([]);
  });

  test("Guinea keeps French: the meta-item is gone from the artifact, not filtered at the reader", () => {
    // The positive half of the fix. If the ingest ever stops dropping
    // Q1339026, the first line goes red rather than the boundary silently
    // taking Guinea's language field away again.
    expect(raw.countries.GN.officialLanguages).toEqual(["French"]);
    expect(getCountryFacts("GN").officialLanguages).toEqual(["French"]);
    expect(languageTip(getCountryFacts("GN"))).toBe(
      "French is the official language."
    );
    expect(translationPackItem(getCountryFacts("GN"))).toBe("Offline French translation pack");
    expect(buildGapNote("Guinea", getCountryFacts("GN"))).toHaveLength(1);
    expect(getCountryFacts("GN").currencyCode).toBe("GNF");
  });

  test("no committed record carries a value the language rule would refuse", () => {
    // The rule is belt and braces now, so this is what says it is not needed
    // rather than not working: a sweep over every language value in the file.
    const meta: string[] = [];
    let scanned = 0;
    for (const [code, record] of Object.entries(raw.countries)) {
      for (const language of (record.officialLanguages as string[] | undefined) ?? []) {
        scanned++;
        if (/^languages? of /i.test(language)) meta.push(`${code}: ${language}`);
      }
    }
    // Armed: measured 426 language values across the 239 countries that carry
    // the field. It was 450 across 243 before the ingest's territorial-scope
    // rule withheld six countries' languages and dropped Norway's two written
    // forms and the Philippines' code-switching register, and 422 before BE
    // and AZ got theirs back from a hand-verified CURATED_FACTS row.
    expect(scanned).toBe(426);
    expect(meta).toEqual([]);
    // And the rule still refuses one arriving by another route — a hand-edited
    // artifact, or a stale deploy built before the ingest dropped it.
    expect(
      readCountryFactsRecord({ officialLanguages: ["French", "languages of Guinea"] })
    ).toBeNull();
  });

  test("no field's value is altered on the way through", () => {
    // Dropping is the sanctioned outcome; changing a value is not. This is the
    // "does not repair" rule checked against 2,340 real values rather than
    // against the handful of malformed fixtures above.
    let checked = 0;
    for (const [code, record] of Object.entries(raw.countries)) {
      const read = getCountryFacts(code) as Record<string, unknown>;
      for (const [field, value] of Object.entries(record)) {
        if (read[field] === undefined) continue;
        checked++;
        expect(read[field], `${code}.${field}`).toEqual(value);
      }
    }
    expect(checked).toBe(2340);
  });
});

// ---------------------------------------------------------------------------
// Copy on read, and the curated escape hatch
// ---------------------------------------------------------------------------

describe("copy on read", () => {
  test("mutating a returned array does not affect the next call", () => {
    // countryProfile.test.ts:45-50 pins that a profile hands out fresh objects
    // whose arrays a caller may mutate. COUNTRY_FACTS is one shared object
    // built once at module load, so that contract survives only if reads copy.
    const first = getCountryFacts("PE");
    (first.plugs as string[]).push("Z");
    (first.officialLanguages as string[]).length = 0;
    (first.emergency as unknown as { number: string }[])[0].number = "000";

    const second = getCountryFacts("PE");
    expect(second.plugs).toEqual(["A", "B", "C"]);
    expect(second.officialLanguages).toEqual(["Aymara", "Quechua", "Spanish"]);
    expect(second.emergency?.[0]).toEqual({ number: "105", role: "police" });
    expect(factTips(second)).toEqual(factTips(getCountryFacts("PE")));
    // And the shared table itself, which is the thing actually at risk: this
    // module builds it once at load, so a leaked reference corrupts it for the
    // whole process, not just for the next call.
    expect(COUNTRY_FACTS.PE.plugs).toEqual(["A", "B", "C"]);
    expect(COUNTRY_FACTS.PE.emergency?.[0]).toEqual({ number: "105", role: "police" });
  });

  test("two calls hand back different objects, not the same one", () => {
    const a = getCountryFacts("PE");
    const b = getCountryFacts("PE");
    expect(a).not.toBe(b);
    expect(a.plugs).not.toBe(b.plugs);
    expect(a.emergency).not.toBe(b.emergency);
    expect(a.emergency?.[0]).not.toBe(b.emergency?.[0]);
    expect(a).toEqual(b);
  });

  test("an unknown or malformed code answers with an empty record, never null", () => {
    for (const code of ["", "   ", "CHN", "🙂", "constructor", "__proto__", "toString"]) {
      expect(getCountryFacts(code), code).toEqual({});
    }
  });
});

describe("the curated escape hatch", () => {
  test("is empty, and every row it ever carries passes the same boundary", () => {
    // Empty is the intended steady state: the ingest repairs upstream SHAPE
    // problems before writing, and the one candidate for a row here — Peru's
    // stale currency name — was answered by not rendering the field at all.
    // The loop is the rule that outlives the emptiness.
    for (const [code, record] of Object.entries(CURATED_FACTS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(readCountryFactsRecord(record), code).toEqual(record);
    }
    expect(Object.keys(CURATED_FACTS)).toEqual([]);
  });

  test("an override wins field by field without blanking the rest", () => {
    const facts = getCountryFacts("PE", { curated: { PE: { currencyCode: "USD" } } });
    expect(facts.currencyCode).toBe("USD");
    expect(currencyTip(facts)).toBe(
      "Prices are in USD. Set your home currency on the Money tab for live conversions."
    );
    // The six ingested fields beside it are untouched.
    expect(facts.plugs).toEqual(["A", "B", "C"]);
    expect(socketsTip(facts)).toBe(socketsTip(PE));
  });

  test("a malformed override is dropped, not trusted for being hand-written", () => {
    const facts = getCountryFacts("PE", { curated: { PE: { currencyCode: "usd" } } });
    expect(facts.currencyCode).toBe("PEN");
  });
});

// ---------------------------------------------------------------------------
// The country name — the one thing these templates cannot derive
// ---------------------------------------------------------------------------

describe("getCountryName", () => {
  /** The artifact read from disk, so the precedence checks are independent. */
  const rawNames = (
    JSON.parse(readFileSync(join(process.cwd(), "data", "country-facts.json"), "utf8")) as {
      countries: Record<string, { name?: string }>;
    }
  ).countries;

  test("Peru is called Peru — the regression this field exists to close", () => {
    // Before the ingest carried a name, `getCountry("PE").name` was "PE" and
    // this note read "We don't have PE-specific guidance…". lib/countries.ts's
    // hand-tuned table has 24 entries and Peru is not one of them, so this
    // answer can only be coming from the artifact.
    expect(getCountryName("PE")).toBe("Peru");
    expect(rawNames.PE?.name).toBe("Peru");
    expect(buildGapNote(getCountryName("PE"), PE)).toEqual([
      "These notes come from open reference data. We don't have Peru-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
    ]);
    expect(powerAdapterItem(getCountryName("PE"), PE)).toBe(
      "Universal power adapter (Peru uses type A/B/C plugs, 220V)"
    );
  });

  test("the hand-tuned name wins over the ingested one, and the reproduction gate is why", () => {
    // Wikidata's label for CN is "People's Republic of China". Resolved
    // through the merge, China is still "China" — which is what keeps the one
    // line in this repo written before the ingest existed reproducible.
    expect(rawNames.CN?.name).toBe("People's Republic of China");
    expect(getCountryName("CN")).toBe("China");
    const handWritten = CN_PACKING.flatMap((group) => group.items).filter((item) =>
      item.startsWith("Universal power adapter")
    );
    expect(handWritten).toHaveLength(1);
    expect(powerAdapterItem(getCountryName("CN"), CN)).toBe(handWritten[0]);
  });

  test("and it wins where the two genuinely disagree, not only where they agree", () => {
    // Armed with a case that is not China: if the precedence were reversed,
    // this would say "Turkey", the name the country itself asked the world to
    // stop using.
    expect(rawNames.TR?.name).toBe("Turkey");
    expect(getCountryName("TR")).toBe("Türkiye");
  });

  test("an uncurated country gets Wikidata's label, formality and all", () => {
    // The honest cost of not hand-writing 246 names, pinned rather than
    // discovered: the label belongs to the entity that CARRIES the ISO code,
    // and for NL that entity is the Kingdom — the same item whose P38 answers
    // EUR/USD/AWG/XCG. A shorter name would have to come from a second item
    // nothing else in the ingest speaks about, or from a hand-written table,
    // which is the thing the honest-gap rule refuses. If a country earns a
    // nicer name it earns a row in lib/countries.ts's CURATED table, and this
    // test is where that shows up.
    expect(getCountryName("NL")).toBe("Kingdom of the Netherlands");
    expect(getCountryName("CD")).toBe("Democratic Republic of the Congo");
    expect(buildGapNote(getCountryName("NL"), getCountryFacts("NL"))[0]).toContain(
      "We don't have Kingdom of the Netherlands-specific guidance"
    );
  });

  test("every country in the artifact has a real name, and none is its own code", () => {
    // The sweep that would have caught the original bug: 222 of these have no
    // hand-tuned entry, so before the ingest every one of them answered with
    // its own two letters.
    let checked = 0;
    for (const code of Object.keys(rawNames)) {
      const name = getCountryName(code);
      checked++;
      expect(name, code).not.toBe("");
      expect(name, code).not.toBe(code);
      expect(name.length, `${code}: ${name}`).toBeLessThanOrEqual(80);
    }
    expect(checked).toBe(246);
  });

  test("a code that is not a country resolves to nothing, and nothing is rendered", () => {
    // "" is a real answer here and never a rendered one: both name-taking
    // templates treat it as "say nothing" rather than printing a blank.
    for (const code of ["", "   ", "🙂", "CHN", "constructor"]) {
      expect(getCountryName(code), code).toBe("");
      expect(buildGapNote(getCountryName(code), getCountryFacts(code))).toEqual([]);
      expect(powerAdapterItem(getCountryName(code), PE)).toBeNull();
    }
  });

  test("reads the name through the same boundary as every other field", () => {
    // A hand-edited artifact cannot smuggle a Q-id, a blob or prose into a
    // sentence just because it landed in the name.
    const junk = { XX: { name: "Q148", currencyCode: "USD" } };
    expect(getCountryName("XX", { facts: junk })).toBe("");
    expect(getCountryName("XX", { facts: { XX: { name: "x".repeat(81) } } })).toBe("");
    expect(getCountryName("XX", { facts: { XX: { name: "Peru. It is nice." } } })).toBe("");
    expect(getCountryName("XX", { facts: { XX: { name: " Peru " } } })).toBe("");
    expect(getCountryName("XX", { facts: { XX: { name: "Nowhere" } } })).toBe("Nowhere");
  });
});
