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
      "Aymara, Quechua and Spanish are official languages — download an offline translation pack before you go.",
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
      "Putonghua is the official language — download an offline translation pack before you go.",
      "Traffic drives on the right. The international dialling code is +86.",
    ]);
    expect(cashBackupItem(CN)).toBe("Some CNY cash as a backup");
    expect(translationPackItem(CN)).toBe("Offline Putonghua translation pack");
  });

  test("Saint Helena — a genuinely sparse country, three fields of seven", () => {
    expect(SH).toEqual({
      drivingSide: "left",
      emergency: [{ number: "999", role: null }],
      officialLanguages: ["English"],
      lat: -15.9245,
    });
    expect(factTips(SH)).toEqual([
      // Singular, and bare: upstream gives no role for 999, and inventing one
      // ("general", "emergency") would be this module writing a fact.
      "Emergency number: 999.",
      "English is the official language — download an offline translation pack before you go.",
      // Driving side alone. The dialling clause is simply absent rather than
      // taking the driving-side clause down with it.
      "Traffic drives on the left.",
    ]);
    expect(powerAdapterItem("Saint Helena", SH)).toBeNull();
    expect(cashBackupItem(SH)).toBeNull();
    expect(translationPackItem(SH)).toBe("Offline English translation pack");
    expect(buildGapNote("Saint Helena", SH)).toEqual([
      "These notes come from open reference data. We don't have Saint Helena-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
      "We also have no currency, plug types, mains voltage or dialling code for Saint Helena.",
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
        "Swazi, Tsonga, Tswana, Venda, Xhosa and Zulu are official languages — download an offline " +
        "translation pack before you go."
    );
    // One number serving three roles. Listing the entries flat would repeat it
    // three times; dropping two would discard the roles it covers.
    expect(emergencyTip(ZA)).toBe("Emergency number: 112 police, fire and ambulance.");
    expect(buildGapNote("South Africa", ZA)).toEqual([
      "These notes come from open reference data. We don't have South Africa-specific guidance on payments, connectivity, booking channels or public holidays yet — and we'd rather leave that blank than guess.",
      "We also have no plug types for South Africa.",
    ]);
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

function assertWellFormed(label: string, lines: readonly string[]): void {
  for (const line of lines) {
    for (const [why, pattern] of FORBIDDEN) {
      expect(pattern.test(line), `${label} — ${why}: |${line}|`).toBe(false);
    }
    expect(line, label).toBe(line.trim());
    expect(line.length, label).toBeGreaterThan(0);
  }
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
      "We also have no currency, plug types, mains voltage, emergency numbers, official language or dialling code for Nowhere.",
    ]);
  });

  test("no template output for any real country is partial, hedged or placeholdered", () => {
    // The generalised half. The parameterised test above proves the rule on
    // one country; this proves it on the 246 shapes that actually exist.
    let swept = 0;
    for (const code of Object.keys(COUNTRY_FACTS)) {
      const lines = everyOutput(`Country ${code}`, getCountryFacts(code));
      assertWellFormed(code, lines);
      for (const tip of factTips(getCountryFacts(code))) {
        expect(/^[A-Z]/.test(tip), `${code} tip is not capitalised: |${tip}|`).toBe(true);
        expect(tip.endsWith("."), `${code} tip has no full stop: |${tip}|`).toBe(true);
      }
      swept += lines.length;
    }
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
      expect(note[1]).toBe(`We also have no ${label} for Peru.`);
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
      "We also have no plug types, mains voltage, emergency numbers, official language or dialling code for Nowhere."
    );
    expect(buildGapNote("Nowhere", { callingCode: "+51" })[1]).toContain(
      "currency, plug types, mains voltage, emergency numbers or official language"
    );
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
      "We also have no currency, plug types, mains voltage, emergency numbers, official language or dialling code for Peru."
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
    expect(compared).toBe(2098);
    // Guinea's P37 includes Q35759, "languages of Guinea" — a Wikidata
    // meta-item, not a language. Rendered it reads "languages of Guinea is the
    // official language". The upstream fix belongs to the ingest's extract;
    // when it lands, this goes red and the rule can be deleted rather than
    // rotting into cruft nobody re-checks.
    expect(dropped).toEqual(["GN.officialLanguages"]);
  });

  test("Guinea loses the field, not the country, and the note says so", () => {
    expect(raw.countries.GN.officialLanguages).toEqual(["French", "languages of Guinea"]);
    expect(getCountryFacts("GN").officialLanguages).toBeUndefined();
    expect(languageTip(getCountryFacts("GN"))).toBeNull();
    expect(translationPackItem(getCountryFacts("GN"))).toBeNull();
    expect(buildGapNote("Guinea", getCountryFacts("GN"))[1]).toBe(
      "We also have no official language for Guinea."
    );
    expect(getCountryFacts("GN").currencyCode).toBe("GNF");
  });

  test("no field's value is altered on the way through", () => {
    // Dropping is the sanctioned outcome; changing a value is not. This is the
    // "does not repair" rule checked against 2,097 real values rather than
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
    expect(checked).toBe(2097);
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
