/**
 * ingest-country-facts — the nine field pickers and their four landmines.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture.
 *
 * The upstream shapes below are the ones Investigation 3 MEASURED on
 * 2026-08-27 — `BZ 550/220`, `FR 400/230`, `NL EUR/USD/AWG/XCG`,
 * `CZ CZK/203`, `PL PLN/PLZ`, `ZW` x13, and Q60740126 across 39 countries —
 * not shapes invented to make a rule look reachable. A withhold rule tested
 * only against a fixture nobody ever saw upstream proves the code compiles,
 * not that it defends anything.
 *
 * `Row`, `PLUG_ARTICLE`, `plugRows` and `entity` come from
 * scripts/country-facts/fixtures.ts, their single home since 2026-09-07 —
 * with `PLUG_ITEM`, which only `plugRows` ever read.
 * scripts/country-facts/facts.test.ts, scripts/country-facts/curated.test.ts
 * and scripts/ingest-country-facts.test.ts read some of them across what is
 * now a file boundary, and all four read the one declaration rather than a
 * copy apiece. `MEASURED_PLUG_STANDARDS` and `GUINEA_LANGUAGE_ROWS` below are
 * this file's alone and stay here; `MEASURED_PLUG_STANDARDS`' own doc-comment
 * says "every Q-id above", which is now `PLUG_ITEM` in fixtures.ts — the
 * sentence was left as written because that block was moved verbatim.
 */

import { describe, expect, test } from "vitest";
import { PLUG_ARTICLE, type Row, entity, plugRows } from "./fixtures";
import { REQUIRED_NAMES } from "./gate.mjs";
import {
  DROPPED_LANGUAGE_ITEMS,
  DROPPED_PLUG_ITEMS,
  EMERGENCY_ROLE_SET,
  PLUG_LETTERS,
  PLUG_LETTER_SET,
  pickCallingCode,
  pickCurrency,
  pickDrivingSide,
  pickEmergency,
  pickLanguages,
  pickLatitude,
  pickName,
  pickPlugs,
  pickVoltage,
} from "./picks.mjs";

// ---------------------------------------------------------------------------
// Landmine 1 — voltage
// ---------------------------------------------------------------------------

const voltageRows = (...values: string[]): Row[] => values.map((value) => ({ country: "XX", value }));

describe("pickVoltage — landmine 1, industrial supply in a domestic field", () => {
  test("withholds Belize, whose measured P2884 is 550/220", () => {
    // A SAMPLE() has a coin-flip chance of publishing "Belize runs at 550 V".
    expect(pickVoltage(voltageRows("550", "220"))).toBeNull();
  });

  test("withholds France, whose measured P2884 is 400/230", () => {
    expect(pickVoltage(voltageRows("400", "230"))).toBeNull();
  });

  test.each([
    ["BO", ["230", "115"], 230],
    ["BR", ["220", "127"], 220],
    ["ID", ["230", "127"], 230],
    ["MA", ["220", "127"], 220],
  ])("passes genuinely dual-voltage %s and publishes the higher figure", (_code, values, expected) => {
    expect(pickVoltage(voltageRows(...values))).toBe(expected);
  });

  test("publishes the HIGHER figure, not the first one upstream happened to return", () => {
    // The arming charge for the four measured pairs above. Every one of them
    // lists its higher value first, so `Math.max(...distinct)` and
    // `distinct[0]` are indistinguishable across the whole set — the rule
    // would read as pinned while actually depending on upstream's row order,
    // which is the one thing a SPARQL result set does not promise. Reversed,
    // only the real rule still answers 230.
    expect(pickVoltage(voltageRows("115", "230"))).toBe(230);
    expect(pickVoltage(voltageRows("127", "220"))).toBe(220);
  });

  test("publishes a single in-band value unchanged", () => {
    expect(pickVoltage(voltageRows("220"))).toBe(220);
  });

  test("withholds three distinct in-band values", () => {
    expect(pickVoltage(voltageRows("230", "220", "127"))).toBeNull();
  });

  test("withholds a non-numeric value rather than coercing it", () => {
    expect(pickVoltage(voltageRows("two hundred"))).toBeNull();
  });

  test("is absent, not zero, when there is nothing upstream", () => {
    expect(pickVoltage([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Landmine 2 — currency
// ---------------------------------------------------------------------------

const currencyRows = (...pairs: [string, string][]): Row[] =>
  pairs.map(([code, name]) => ({ country: "XX", code, name }));

describe("pickCurrency — landmine 2, the ISO code on the wrong item", () => {
  test("withholds the Netherlands, whose measured P38 yields EUR/USD/AWG/XCG", () => {
    // A naive pick gives getCountryProfile("NL").currency === "AWG" — worse
    // than today's admitted USD placeholder, because it looks researched.
    expect(
      pickCurrency(
        currencyRows(
          ["EUR", "euro"],
          ["USD", "United States dollar"],
          ["AWG", "Aruban florin"],
          ["XCG", "Caribbean guilder"]
        )
      )
    ).toBeNull();
  });

  test("withholds France, whose measured P38 yields EUR/XPF", () => {
    expect(pickCurrency(currencyRows(["EUR", "euro"], ["XPF", "CFP franc"]))).toBeNull();
  });

  test("withholds Macau, whose measured P38 yields HKD/MOP", () => {
    expect(pickCurrency(currencyRows(["HKD", "Hong Kong dollar"], ["MOP", "Macanese pataca"]))).toBeNull();
  });

  test("withholds Poland, whose measured P498 yields PLN and the pre-1995 PLZ", () => {
    // Both are ISO-shaped and both are truthy, so nothing but the count rule
    // separates them.
    expect(pickCurrency(currencyRows(["PLN", "złoty"], ["PLZ", "Polish zloty"]))).toBeNull();
  });

  test("withholds Zimbabwe, whose measured P38 yields thirteen currencies", () => {
    const thirteen: [string, string][] = [
      ["ZWL", "Zimbabwean dollar"],
      ["ZWG", "Zimbabwe Gold"],
      ["USD", "United States dollar"],
      ["ZAR", "South African rand"],
      ["BWP", "Botswana pula"],
      ["GBP", "pound sterling"],
      ["EUR", "euro"],
      ["CNY", "renminbi"],
      ["JPY", "Japanese yen"],
      ["INR", "Indian rupee"],
      ["AUD", "Australian dollar"],
      ["ZWD", "Zimbabwean dollar (1980)"],
      ["ZWR", "Zimbabwean dollar (2008)"],
    ];
    expect(thirteen).toHaveLength(13);
    expect(pickCurrency(currencyRows(...thirteen))).toBeNull();
  });

  test("RESCUES Czechia, whose measured P498 leaks the ISO numeric code 203 beside CZK", () => {
    // The ISO-shape filter is what makes this a rescue rather than a withhold:
    // "203" is not /^[A-Z]{3}$/, so exactly one value survives.
    expect(pickCurrency(currencyRows(["CZK", "Czech koruna"], ["203", "Czech koruna"]))).toEqual({
      currencyCode: "CZK",
      currencyName: "Czech koruna",
    });
  });

  test("publishes a single ISO-shaped value with its name", () => {
    expect(pickCurrency(currencyRows(["PEN", "Peruvian sol"]))).toEqual({
      currencyCode: "PEN",
      currencyName: "Peruvian sol",
    });
  });

  test("withholds the pair when the name is blank, rather than publishing half a sentence", () => {
    // "Prices are in (PEN)" is not a sentence. Absent, never partial.
    expect(pickCurrency(currencyRows(["PEN", "   "]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Landmine 3 — plug types
// ---------------------------------------------------------------------------

/**
 * The whole distinct P2853 label set the shipping query returned on
 * 2026-08-27, with the number of countries carrying each. Fourteen values:
 * thirteen standards plus one Wikipedia article. Every Q-id above is the real
 * one that run returned, not a plausible-looking placeholder.
 */
const MEASURED_PLUG_STANDARDS: [string, number][] = [
  ["Europlug", 135],
  ["Schuko", 75],
  ["BS 1363", 55],
  ["NEMA 1-15", 54],
  ["NEMA 5-15", 46],
  ["Type E", 40],
  ["AC power plugs and sockets: British and related types", 39],
  ["AS/NZS 3112", 21],
  ["BS 546", 15],
  ["Type K", 9],
  ["Type L", 9],
  ["SN 441011", 6],
  ["Type H", 2],
  ["IEC 60906-1", 2],
];

describe("pickPlugs — landmine 3, technical standards used as if they were letters", () => {
  test("maps China's measured P2853 to exactly the letters a human already wrote by hand", () => {
    // lib/packing.ts:64 says "China uses type A/C/I plugs" and was written
    // without ever seeing Wikidata. This is the reproduction gate in
    // miniature: the same three standards must come back as A, C and I.
    expect(pickPlugs(plugRows("Europlug", "NEMA 1-15", "AS/NZS 3112")).letters).toEqual(["A", "C", "I"]);
  });

  test("maps Peru's measured P2853 to A, B and C", () => {
    expect(pickPlugs(plugRows("NEMA 1-15", "NEMA 5-15", "Europlug")).letters).toEqual(["A", "B", "C"]);
  });

  test("drops Q60740126 by id and keeps the rest of the country's letters", () => {
    const picked = pickPlugs([...plugRows("BS 1363"), { country: "XX", ...PLUG_ARTICLE }]);
    expect(picked.letters).toEqual(["G"]);
    expect(picked.soleDroppedArticle).toBe(false);
  });

  test("flags a country whose ONLY plug value is Q60740126 instead of silently emptying it", () => {
    // Measured zero countries on 2026-08-27, which is what makes dropping the
    // article lossless. This flag is how a future upstream edit that breaks
    // that assumption reaches `assertFactsSane` instead of costing 39
    // countries their sockets tip in silence.
    const picked = pickPlugs([{ country: "XX", ...PLUG_ARTICLE }]);
    expect(picked.letters).toBeNull();
    expect(picked.soleDroppedArticle).toBe(true);
  });

  test("an unrecognised standard withholds the WHOLE field, never a partial set", () => {
    // A country shown "type A" when it is really "A and G" sends a traveller
    // with the wrong adapter just as surely as showing nothing does not.
    const picked = pickPlugs([
      ...plugRows("NEMA 1-15"),
      { country: "XX", item: "http://www.wikidata.org/entity/Q123456", itemLabel: "GOST 7396" },
    ]);
    expect(picked.letters).toBeNull();
    expect(picked.soleDroppedArticle).toBe(false);
  });

  test("every row of the standard table maps to one distinct IEC letter", () => {
    const letters = Object.values(PLUG_LETTERS);
    for (const letter of letters) expect(letter).toMatch(/^[A-N]$/);
    expect(new Set(letters).size).toBe(letters.length);
    expect(PLUG_LETTER_SET.size).toBe(letters.length);
  });

  test("the dropped-item set is exactly the one measured Wikipedia article", () => {
    expect([...DROPPED_PLUG_ITEMS]).toEqual(["Q60740126"]);
  });

  test("BS 546 withholds, because one Wikidata item covers both type D and type M", () => {
    // The design's most expensive deliberate refusal, and the reason plug
    // coverage is 207 rather than the prototype's 222. BS 546's 5 A variant is
    // IEC type D and its 15 A variant is type M; the statement says which
    // standard, never which size. Mapping it to D would publish "South Africa
    // uses type C/D/N" over sockets that are type M, and a traveller who buys
    // a type D adapter on that sentence finds it does not fit.
    //
    // India's measured value set, which is the expensive half of the cost.
    const picked = pickPlugs([...plugRows("Europlug", "BS 546"), { country: "XX", ...PLUG_ARTICLE }]);
    expect(picked.letters).toBeNull();
    expect(picked.soleDroppedArticle).toBe(false);
    // The arming half: the same country WITHOUT BS 546 does publish, so this
    // fails on the standard rather than on the fixture.
    expect(pickPlugs(plugRows("Europlug")).letters).toEqual(["C"]);
  });

  test("the table maps every measured standard it can map, and no standard it cannot", () => {
    // Pins the reconciliation Task 25 performed against the live endpoint
    // rather than restating the table. `Type D` and `Type M` used to have rows
    // here and upstream uses neither item, so both were dead code that could
    // only ever have fired on a value nobody has seen.
    const mappable = MEASURED_PLUG_STANDARDS.map(([label]) => label).filter(
      (label) => label !== "BS 546" && !label.startsWith("AC power plugs")
    );
    expect(Object.keys(PLUG_LETTERS).sort()).toEqual([...mappable].sort());
    expect(MEASURED_PLUG_STANDARDS).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// Landmine 4 — emergency numbers
// ---------------------------------------------------------------------------

const emergencyRows = (...pairs: [string, string][]): Row[] =>
  pairs.map(([number, role]) => ({ country: "XX", number, role }));

describe("pickEmergency — landmine 4, Q-items whose number lives in the label", () => {
  test("publishes role-carrying numbers in a fixed order", () => {
    expect(
      pickEmergency(
        emergencyRows(["120", "emergency medical services"], ["110", "police"], ["119", "fire department"])
      )
    ).toEqual([
      { number: "110", role: "police" },
      { number: "119", role: "fire" },
      { number: "120", role: "ambulance" },
    ]);
  });

  test("publishes a single unlabelled number, because there is no ambiguity to resolve", () => {
    expect(pickEmergency(emergencyRows(["112", ""]))).toEqual([{ number: "112", role: null }]);
  });

  test("withholds several unlabelled numbers", () => {
    // "Emergency numbers: 112, 118" tells a traveller nothing about which to
    // dial, so it is not an answer.
    expect(pickEmergency(emergencyRows(["112", ""], ["118", ""]))).toBeNull();
  });

  test("accepts Q11185210's label, the item that is both Japan's coastguard and Switzerland's fire number", () => {
    // Cross-checked in the design: the two uses are only consistent if the
    // item is "118", and it is.
    expect(pickEmergency(emergencyRows(["118", "coast guard"]))).toEqual([
      { number: "118", role: "coastguard" },
    ]);
  });

  test("drops a label that is not two to six digits rather than publishing it", () => {
    // A failed label lookup returns the item's own id or its English name;
    // "Emergency numbers: Q11185210 police" is the shape that must never ship.
    expect(pickEmergency(emergencyRows(["Q11185210", "police"]))).toBeNull();
  });

  test("an unmapped P366 role does not become a role nobody reviewed", () => {
    const picked = pickEmergency(emergencyRows(["191", "wildlife rescue"]));
    expect(picked).toEqual([{ number: "191", role: null }]);
  });

  test("a capitalised P366 label still finds its role, so the case fold is load-bearing", () => {
    // The `isTrue` shape again, in a second picker. Every role fixture in this
    // file and in `healthyFeed` is already lowercase, so deleting
    // `.toLowerCase()` from the `EMERGENCY_ROLES` lookup left all of them
    // green while silently degrading any capitalised upstream label to
    // `role: null` — which pushes a country onto the single-number path or
    // into a withhold. Upstream labels are free text; their case is not a
    // guarantee this ingest may rely on.
    expect(pickEmergency(emergencyRows(["110", "Police"], ["119", "Fire Department"]))).toEqual([
      { number: "110", role: "police" },
      { number: "119", role: "fire" },
    ]);
  });

  test("every role token the table can emit is on the gate's allowlist", () => {
    expect([...EMERGENCY_ROLE_SET].sort()).toEqual(
      ["ambulance", "coastguard", "emergency", "fire", "police", "rescue"].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// The remaining pickers
// ---------------------------------------------------------------------------

describe("pickDrivingSide", () => {
  test.each([
    ["right-hand traffic", "right"],
    ["left-hand traffic", "left"],
  ])("reads %s as %s", (label, expected) => {
    expect(pickDrivingSide([{ country: "XX", value: label }])).toBe(expected);
  });

  test("withholds an unrecognised label rather than guessing", () => {
    expect(pickDrivingSide([{ country: "XX", value: "Q13196750" }])).toBeNull();
  });

  test("a capitalised label still reads, so the case fold is load-bearing", () => {
    // Third instance of the `isTrue` shape. Both fixtures above are lowercase
    // and the Q-id case returns null either way, so deleting `.toLowerCase()`
    // here withheld the driving side of EVERY country whose upstream label is
    // capitalised, with nothing going red.
    expect(pickDrivingSide([{ country: "XX", value: "Right-hand traffic" }])).toBe("right");
    expect(pickDrivingSide([{ country: "XX", value: " LEFT-HAND TRAFFIC " }])).toBe("left");
  });

  test("withholds a country that upstream says drives on both", () => {
    expect(
      pickDrivingSide([
        { country: "XX", value: "left-hand traffic" },
        { country: "XX", value: "right-hand traffic" },
      ])
    ).toBeNull();
  });
});

describe("pickCallingCode", () => {
  test("publishes a single well-formed code", () => {
    expect(pickCallingCode([{ country: "PE", value: "+51" }])).toBe("+51");
  });

  test("withholds a multi-valued code", () => {
    expect(
      pickCallingCode([
        { country: "XX", value: "+1" },
        { country: "XX", value: "+1340" },
      ])
    ).toBeNull();
  });

  test("withholds a code with no plus, which is the shape a stripped literal takes", () => {
    expect(pickCallingCode([{ country: "XX", value: "0051" }])).toBeNull();
  });
});

/** Guinea's real P37 answer, measured 2026-08-27: French plus one meta-item. */
const GUINEA_LANGUAGE_ROWS: Row[] = [
  { country: "GN", item: entity("Q150"), value: "French" },
  { country: "GN", item: entity("Q1339026"), value: "languages of Guinea" },
];

describe("pickLanguages", () => {
  test("deduplicates and sorts, so a quiet rebuild is byte-identical", () => {
    expect(
      pickLanguages([
        { country: "PE", item: entity("Q1321"), value: "Spanish" },
        { country: "PE", item: entity("Q5218"), value: "Quechua" },
        { country: "PE", item: entity("Q4118"), value: "Aymara" },
        { country: "PE", item: entity("Q1321"), value: "Spanish" },
      ]).names
    ).toEqual(["Aymara", "Quechua", "Spanish"]);
  });

  test("passes Bolivia's real 37 languages, which is why the ceiling is not a taste judgement", () => {
    const rows = Array.from({ length: 37 }, (_, i) => ({
      country: "BO",
      item: entity(`Q${1000 + i}`),
      value: `Language ${i}`,
    }));
    expect(pickLanguages(rows).names).toHaveLength(37);
  });

  test("withholds a list long enough to be a join gone wrong", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      country: "XX",
      item: entity(`Q${1000 + i}`),
      value: `Language ${i}`,
    }));
    expect(pickLanguages(rows).names).toBeNull();
  });

  test("is absent, not an empty array, when there is nothing upstream", () => {
    expect(pickLanguages([]).names).toBeNull();
  });

  test("drops Guinea's meta-item by id and KEEPS French, which the boundary could not", () => {
    // The meta-item among the 215 distinct P37 items measured 2026-08-27. T26
    // refused it at the reader by label shape, which costs Guinea the whole
    // field because a language list is all-or-nothing there. Dropped here, the
    // surviving set is what upstream actually states.
    expect(pickLanguages(GUINEA_LANGUAGE_ROWS)).toEqual({
      names: ["French"],
      soleDropped: false,
      territoriallyScoped: false,
    });
  });

  test("drops it by ID, so an upstream label edit cannot re-admit it", () => {
    const relabelled: Row[] = [
      { country: "GN", item: entity("Q150"), value: "French" },
      { country: "GN", item: entity("Q1339026"), value: "Guinean languages" },
    ];
    expect(pickLanguages(relabelled).names).toEqual(["French"]);
  });

  test("flags a country whose ONLY language value is a dropped item instead of silently emptying it", () => {
    expect(pickLanguages([{ country: "XX", item: entity("Q1339026"), value: "languages of Guinea" }])).toEqual({
      names: null,
      soleDropped: true,
      territoriallyScoped: false,
    });
  });

  test("drops Norway's two WRITTEN FORMS and keeps the languages they are forms of", () => {
    // NO's real P37 answer, measured 2026-08-27. Bokmal and Nynorsk are the
    // two written standards OF Norwegian, which Norway also lists in its own
    // right, so publishing all four made `languageTip` name one language three
    // times: "Bokmal, Norwegian, Nynorsk and Sami are official languages".
    const rows: Row[] = [
      { country: "NO", item: entity("Q25167"), value: "Bokm\u00e5l", scoped: "false" },
      { country: "NO", item: entity("Q9043"), value: "Norwegian", scoped: "false" },
      { country: "NO", item: entity("Q25164"), value: "Nynorsk", scoped: "false" },
      { country: "NO", item: entity("Q56463"), value: "S\u00e1mi", scoped: "false" },
    ];
    expect(pickLanguages(rows).names).toEqual(["Norwegian", "S\u00e1mi"]);
  });

  test("drops the Philippines' code-switching register and keeps the constitutional pair", () => {
    // PH's real P37 answer, measured 2026-08-27. Taglish is the Tagalog and
    // English register Manila speaks - its own statement is qualified `nature
    // of statement: de facto` - and "English, Filipino and Taglish are
    // official languages" is not a sentence anybody can act on.
    const rows: Row[] = [
      { country: "PH", item: entity("Q1860"), value: "English", scoped: "false" },
      { country: "PH", item: entity("Q33298"), value: "Filipino", scoped: "false" },
      { country: "PH", item: entity("Q2530387"), value: "Taglish", scoped: "false" },
    ];
    expect(pickLanguages(rows).names).toEqual(["English", "Filipino"]);
  });

  test("withholds the WHOLE field when any statement applies to only part of the country", () => {
    // THE UNITED STATES. Every truthy P37 statement it carries is scoped to a
    // territory - Carolinian and Chamorro to the Northern Marianas, Hawaiian
    // to Hawaii, Samoan to American Samoa, Spanish to Puerto Rico - and
    // English's is at deprecated rank, so it is absent from a truthy query
    // altogether. Unfiltered, the app told a traveller the United States has
    // five official languages and none of them is English, then SAVED that
    // sentence into the trip and republished it on the public briefing link.
    const rows: Row[] = [
      { country: "US", item: entity("Q28427"), value: "Carolinian", scoped: "true" },
      { country: "US", item: entity("Q33262"), value: "Chamorro", scoped: "true" },
      { country: "US", item: entity("Q33569"), value: "Hawaiian", scoped: "true" },
      { country: "US", item: entity("Q34011"), value: "Samoan", scoped: "true" },
      { country: "US", item: entity("Q1321"), value: "Spanish", scoped: "true" },
    ];
    expect(pickLanguages(rows)).toEqual({
      names: null,
      soleDropped: false,
      territoriallyScoped: true,
    });
  });

  test("withholds even when unscoped statements survive, because a partial list is its own falsehood", () => {
    // AZERBAIJAN, measured 2026-08-27, and the reason this rule is
    // all-or-nothing rather than a filter. Azerbaijani is the SCOPED
    // statement - upstream used `applies to part` to name a variety, "Standard
    // Azerbaijani", rather than a territory - so publishing the remainder
    // leaves `Azerbaijani Sign Language` alone, which `languageTip` renders as
    // "Azerbaijani Sign Language is the official language". Trading a false
    // sentence about the United States for a false one about Azerbaijan is not
    // a fix.
    const rows: Row[] = [
      { country: "AZ", item: entity("Q9292"), value: "Azerbaijani", scoped: "true" },
      { country: "AZ", item: entity("Q36386"), value: "Azerbaijani Sign Language", scoped: "false" },
    ];
    expect(pickLanguages(rows).names).toBeNull();
    expect(pickLanguages(rows).territoriallyScoped).toBe(true);
  });

  test("a missing or false scope column publishes normally, so an unscoped feed is not a wipe", () => {
    // `?scoped` is a SPARQL boolean rendered as the literal text "true" or
    // "false". Anything else - an absent column, an empty cell - means the
    // statement said nothing about scope, which is the ordinary case for 434
    // of the 451 measured rows and must not withhold.
    expect(pickLanguages([{ country: "PE", item: entity("Q1321"), value: "Spanish" }]).names).toEqual(["Spanish"]);
    expect(
      pickLanguages([{ country: "PE", item: entity("Q1321"), value: "Spanish", scoped: "" }]).names
    ).toEqual(["Spanish"]);
    expect(
      pickLanguages([{ country: "PE", item: entity("Q1321"), value: "Spanish", scoped: "FALSE" }]).names
    ).toEqual(["Spanish"]);
  });

  test("an UPPERCASE scope cell still withholds, so the case fold is load-bearing", () => {
    // The arming charge for the three `FALSE`/empty/absent cases above. Every
    // one of them publishes whether or not `isTrue` folds case — "FALSE" is
    // not "true" either way — so deleting `.toLowerCase()` from `isTrue` left
    // the whole scope rule dead with all of them green, and the United States
    // falsehood this file exists to stop would have shipped again. Only a cell
    // that is `true` in some OTHER case can see that mutation. SPARQL JSON
    // renders `xsd:boolean` lowercase today; a serialiser that ever emits
    // `TRUE` must withhold, not publish.
    expect(
      pickLanguages([{ country: "US", item: entity("Q1321"), value: "Spanish", scoped: "TRUE" }]).names
    ).toBeNull();
    expect(
      pickLanguages([{ country: "US", item: entity("Q1321"), value: "Spanish", scoped: " True " }])
        .territoriallyScoped
    ).toBe(true);
  });

  test("a country that is BOTH scoped and all-dropped reports both, not just the scope", () => {
    // The scope test used to return early, so `soleDropped` was unreachable
    // whenever both applied — and `assertFactsSane` refuses the write on
    // `soleDropped`, because a country whose whole language field rests on
    // `DROPPED_LANGUAGE_ITEMS` means that list has outgrown its measurement.
    // The gate was therefore blind for exactly the countries most likely to
    // trip it. The withhold is the same either way; what this pins is that the
    // two diagnostics are independent facts rather than branch order.
    const both = pickLanguages([
      { country: "XX", item: entity("Q1339026"), value: "languages of Guinea", scoped: "true" },
    ]);
    expect(both.names).toBeNull();
    expect(both.territoriallyScoped).toBe(true);
    expect(both.soleDropped).toBe(true);
    // And neither flag fires on the other's input, or "reports both" would be
    // satisfied by a function that always reports both.
    expect(pickLanguages([{ country: "XX", item: entity("Q1321"), value: "Spanish", scoped: "true" }]))
      .toMatchObject({ soleDropped: false, territoriallyScoped: true });
    expect(pickLanguages([{ country: "XX", item: entity("Q1339026"), value: "languages of Guinea" }]))
      .toMatchObject({ soleDropped: true, territoriallyScoped: false });
  });

  test("the dropped-item set is exactly the four measured non-languages", () => {
    // Measured 2026-08-27: 451 P37 rows, 243 countries, 215 distinct items,
    // and 42 distinct `P31` classes across them. Exactly four items are not a
    // language a traveller could learn - one meta-item, two written forms of
    // Norwegian, one code-switching register. A fifth id here would be a rule
    // nobody measured. Sorted so the assertion does not depend on insertion
    // order.
    expect([...DROPPED_LANGUAGE_ITEMS].sort()).toEqual(["Q1339026", "Q25164", "Q25167", "Q2530387"]);
  });
});

describe("pickName", () => {
  test("publishes the one label upstream carries, whitespace-collapsed", () => {
    expect(pickName([{ country: "PE", value: " Peru " }])).toBe("Peru");
  });

  test("carries China's label verbatim rather than shortening it", () => {
    // Wikidata's English label for the item whose P297 is CN. The traveller
    // reads lib/countries.ts's hand-tuned "China" instead — see
    // `getCountryName` — but this ingest does not edit its source.
    expect(pickName([{ country: "CN", value: "People's Republic of China" }])).toBe(
      REQUIRED_NAMES.CN
    );
  });

  test("withholds two names for one code, which means two items carry that code", () => {
    expect(pickName([{ country: "XX", value: "Peru" }, { country: "XX", value: "Perú" }])).toBeNull();
  });

  test("is absent, not an empty string, when the label lookup found nothing", () => {
    expect(pickName([])).toBeNull();
    expect(pickName([{ country: "XX", value: "" }])).toBeNull();
  });

  test("withholds a label long enough to be a blob, rather than aborting the whole run", () => {
    // One strange upstream label costs that country its name. It must not cost
    // the other 245 their nightly refresh — which is what the gate's 80-char
    // throw would do if this reached a record.
    expect(pickName([{ country: "XX", value: "x".repeat(81) }])).toBeNull();
    expect(pickName([{ country: "XX", value: "x".repeat(80) }])).toBe("x".repeat(80));
  });
});

describe("pickLatitude", () => {
  test("publishes a single in-range latitude", () => {
    expect(pickLatitude([{ country: "PE", lat: "-9.19" }])).toBe(-9.19);
  });

  test("withholds an out-of-range value", () => {
    expect(pickLatitude([{ country: "XX", lat: "500" }])).toBeNull();
  });

  test("withholds a country with two different centroids", () => {
    expect(
      pickLatitude([
        { country: "FR", lat: "46.2" },
        { country: "FR", lat: "-21.1" },
      ])
    ).toBeNull();
  });
});

