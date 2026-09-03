import { afterEach as afterEachTop, describe, expect, test, vi as viTop } from "vitest";
import {
  COUNTRY_CODES,
  CURATED_FACTS,
  DROPPED_LANGUAGE_ITEMS,
  DROPPED_PLUG_ITEMS,
  EMERGENCY_ROLE_SET,
  EXPECTED_COUNTRIES,
  MEASURED_FIELD_COVERAGE,
  MIN_FIELD_COVERAGE,
  PLUG_LETTERS,
  PLUG_LETTER_SET,
  PROPERTIES,
  RECORD_FIELDS,
  REQUIRED_NAMES,
  RENDERED_FIELDS,
  applyCurated,
  batchCodes,
  buildQuery,
  fetchWithRetry,
  parseRetryAfter,
  assertFactsSane,
  buildFacts,
  buildReport,
  carryForwardFields,
  countAnsweredCountries,
  countPreviousCoverage,
  entityId,
  factCount,
  isPropertyAnswerPlausible,
  parseBindings,
  parseCsv,
  pickCallingCode,
  pickCurrency,
  pickDrivingSide,
  pickEmergency,
  pickLanguages,
  pickLatitude,
  pickName,
  pickPlugs,
  pickVoltage,
  stampedPayload,
} from "./ingest-country-facts.mjs";

/**
 * Covers every pure function standing between Wikidata and a committed,
 * auto-deployed artifact, and — in the `run()` block at the bottom — every
 * branch of the gate by BEHAVIOUR rather than by source position. The module's
 * entry-point guard means importing it here does not also run the ingest.
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
 */

type Row = Record<string, string>;

// ---------------------------------------------------------------------------
// parseCsv / parseBindings / entityId
// ---------------------------------------------------------------------------

describe("parseCsv", () => {
  test("splits plain rows and columns", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("keeps a comma inside a quoted field in one column", () => {
    // Not theoretical: P37 returns "Norwegian Bokmål, Nynorsk" and several
    // P498 currency names carry commas. A naive split shifts every later
    // column left by one, which the gate would read as a reshaped feed rather
    // than as a parse bug.
    expect(parseCsv('country,value\nNO,"Norwegian Bokmål, Nynorsk"\n')).toEqual([
      ["country", "value"],
      ["NO", "Norwegian Bokmål, Nynorsk"],
    ]);
  });

  test("unescapes a doubled quote and keeps an embedded newline inside the field", () => {
    expect(parseCsv('a\n"he said ""hi""\nand left"\n')).toEqual([["a"], ['he said "hi"\nand left']]);
  });

  test("treats CRLF the same as LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("returns nothing for an empty body", () => {
    expect(parseCsv("")).toEqual([]);
  });

  test("keeps a final record that has no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseBindings", () => {
  test("keys each row by the header line", () => {
    expect(parseBindings("country,value\nPE,right\n", ["country", "value"])).toEqual([
      { country: "PE", value: "right" },
    ]);
  });

  test("a header with no data rows is a legitimately empty answer", () => {
    expect(parseBindings("country,value\n", ["country"])).toEqual([]);
  });

  test("a body with no CSV header at all throws rather than reading as empty", () => {
    // The Task 7 shape. A rate-limit page or a truncated body arrives as
    // HTTP 200; reading it as "Wikidata knows nothing about 246 countries"
    // is what feeds a destructive merge.
    expect(() => parseBindings("", ["country"])).toThrow(/no CSV header/);
  });

  test("a response missing an expected column throws rather than filling it with blanks", () => {
    expect(() => parseBindings("country\nPE\n", ["country", "value"])).toThrow(/no "value" column/);
  });
});

describe("entityId", () => {
  test("takes the Q-id out of a full entity URI", () => {
    expect(entityId("http://www.wikidata.org/entity/Q60740126")).toBe("Q60740126");
  });

  test("passes a bare Q-id through", () => {
    expect(entityId("Q60740126")).toBe("Q60740126");
  });

  test("returns nothing for a value that carries no id", () => {
    expect(entityId("")).toBe("");
    expect(entityId("Europlug")).toBe("");
  });
});

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

const PLUG_ITEM: Record<string, string> = {
  "NEMA 1-15": "Q24288454",
  "NEMA 5-15": "Q24288456",
  Europlug: "Q1378312",
  "Type E": "Q2335536",
  Schuko: "Q1123613",
  "BS 1363": "Q1528507",
  "Type H": "Q1266396",
  "AS/NZS 3112": "Q2335539",
  "SN 441011": "Q2335530",
  "Type K": "Q1502017",
  "Type L": "Q1520890",
  "IEC 60906-1": "Q1653438",
  // Measured across 15 countries on 2026-08-27 and deliberately UNMAPPED; see
  // the withhold test below.
  "BS 546": "Q1383497",
};

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

/** The Wikipedia ARTICLE Wikidata carries as a P2853 value for 39 countries. */
const PLUG_ARTICLE = {
  item: "http://www.wikidata.org/entity/Q60740126",
  itemLabel: "AC power plugs and sockets: British and related types",
};

const plugRows = (...labels: string[]): Row[] =>
  labels.map((itemLabel) => ({
    country: "XX",
    item: `http://www.wikidata.org/entity/${PLUG_ITEM[itemLabel] ?? "Q999999"}`,
    itemLabel,
  }));

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
// The network layer's pure parts
// ---------------------------------------------------------------------------

describe("parseRetryAfter", () => {
  test("reads delta-seconds", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter(" 5 ")).toBe(5_000);
  });

  test("reads an HTTP-date, relative to now", () => {
    const now = Date.parse("2026-08-28T00:00:00Z");
    expect(parseRetryAfter("Fri, 28 Aug 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  test("never returns a negative wait for a date already past", () => {
    const now = Date.parse("2026-08-28T00:01:00Z");
    expect(parseRetryAfter("Fri, 28 Aug 2026 00:00:00 GMT", now)).toBe(0);
  });

  test("returns null for absent or unparseable headers, so the backoff decides instead", () => {
    // null, not 0: a 0 would read as "retry immediately", which is the one
    // answer a rate-limited endpoint definitely did not give.
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("12.5")).toBeNull();
  });
});

describe("fetchWithRetry", () => {
  afterEachTop(() => viTop.unstubAllGlobals());

  /** One canned Response-alike, enough for the three branches that matter. */
  const respond = (status: number, body: string, retryAfter?: string) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null) },
    text: async () => body,
  });

  test("returns the body on the first success, with no retry", async () => {
    // The positive control. Without it, every not.toThrow below could be
    // passing because nothing ever reaches the network at all.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(200, "code\nPE\n"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" }))
      .resolves.toBe("code\nPE\n");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("gives up immediately when Retry-After asks for longer than the ceiling", async () => {
    // Honouring the header is what keeps this a polite client; capping it is
    // what stops a misconfigured or hostile `Retry-After: 86400` from holding
    // a CI runner open for a day. The property is demoted and its previous
    // values carried forward instead — one night's freshness, not a field.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(429, "slow down", "86400"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" })
    ).rejects.toThrow(/Retry-After asked for 86400s, over the 300s ceiling/);
    // Once, not three times: the ceiling is a decision to stop, not a backoff.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("the ceiling sits at 300s exactly: 301s still gives up", async () => {
    // Pins WHERE the ceiling is, not merely that one exists. Without this, the
    // constant could drift to any value >= 86401 and the test above would
    // still pass, since it only proves a hostile number is refused.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(429, "slow down", "301"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" })
    ).rejects.toThrow(/Retry-After asked for 301s, over the 300s ceiling/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("the 120s WDQS actually asks for now PARKS and retries, instead of losing the run", async () => {
    // THE REGRESSION. Twice on 2026-08-28 WDQS answered 429 with
    // `Retry-After: 120`, and the old 60s ceiling threw the work away rather
    // than wait two minutes — once costing `drivingSide`, once costing the
    // entire run, because that 429 landed on the fatal `codes` query.
    // Fake timers so the park is asserted rather than actually slept through.
    viTop.useFakeTimers();
    try {
      const fetchSpy = viTop
        .fn()
        .mockResolvedValueOnce(respond(429, "slow down", "120"))
        .mockResolvedValueOnce(respond(200, "code\nNL\n"));
      viTop.stubGlobal("fetch", fetchSpy);
      const pending = fetchWithRetry("https://example.invalid/sparql", {
        body: "query=x",
        accept: "text/csv",
      });
      // Nothing has retried yet — the run is parked, which is the point.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await viTop.advanceTimersByTimeAsync(120_000);
      await expect(pending).resolves.toBe("code\nNL\n");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      viTop.useRealTimers();
    }
  });

  test("a 404 is an outage, never an empty result", async () => {
    // `notFoundIsEmpty: false`, stated as behaviour. Reading a moved endpoint
    // as "Wikidata knows nothing about 246 countries" is the Task 7 shape, and
    // it is not worth retrying either — a moved endpoint stays moved.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(404, "not found"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" })
    ).rejects.toThrow(/that is an outage,\s+not an empty result/);
  });
});

describe("batchCodes", () => {
  test("splits in order and loses nothing", () => {
    const codes = COUNTRY_CODES.slice(0, 25);
    const batches = batchCodes(codes, 10);
    expect(batches.map((batch: string[]) => batch.length)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(codes);
  });

  test("a size at or over the input is one batch, and an empty input is no batches", () => {
    expect(batchCodes(["AA", "BB"], 500)).toEqual([["AA", "BB"]]);
    expect(batchCodes([], 50)).toEqual([]);
  });

  test("a nonsense size still terminates rather than looping forever", () => {
    // A zero or negative batch size would make the loop never advance, which
    // fails as a hung nightly runner rather than as a red build.
    expect(batchCodes(["AA", "BB"], 0)).toEqual([["AA"], ["BB"]]);
  });
});

describe("buildQuery", () => {
  test("every property carries a query, bounded to the codes it was handed", () => {
    // A tenth property added to PROPERTIES with no case in the switch would
    // throw at 3am inside the nightly job. This fails at build time instead.
    for (const property of PROPERTIES) {
      const query = buildQuery(property, ["PE", "CN"]);
      expect(query, property.name).toMatch(/^SELECT DISTINCT/);
      expect(query, property.name).toContain('"PE"');
      expect(query, property.name).toContain('"CN"');
      for (const column of property.columns) {
        expect(query, `${property.name} selects ${column}`).toContain("?" + column);
      }
    }
  });

  test("the country-code query keeps the FILTER that makes it answer at all", () => {
    // Measured against the live endpoint on 2026-08-27: the direct form
    // `?item wdt:P297 ?code` with a VALUES-bound ?code returns HTTP 200, a CSV
    // header and ZERO rows, while this form returns all 246. Simplifying it
    // back would wipe the country universe, and the only thing standing
    // between that and a committed artifact is the two-sided count band.
    const query = buildQuery(PROPERTIES[0], COUNTRY_CODES);
    expect(query).toContain("FILTER(?isoCode = ?code)");
    expect(query).not.toMatch(/wdt:P297 \?code/);
  });

  test("an unknown property is refused rather than silently queried for nothing", () => {
    expect(() =>
      buildQuery({ name: "holidays", property: "P832", fields: [], columns: [], batch: 50 }, ["PE"])
    ).toThrow(/no SPARQL query is defined/);
  });

  test("the language query asks about STATEMENTS, because the scope lives in a qualifier", () => {
    // The mutation this exists to catch: reverting to `?c wdt:P37 ?item`.
    // `wdt:` throws qualifiers away, and `P518 applies to part` is the only
    // thing that distinguishes "official in the United States" from "official
    // in Puerto Rico" — so the truthy form published "Carolinian, Chamorro,
    // Hawaiian, Samoan and Spanish are official languages" about the US.
    const languages = PROPERTIES.find((property) => property.name === "languages")!;
    const query = buildQuery(languages, ["US", "NO"]);
    expect(query).toContain("?c p:P37 ?st");
    expect(query).toContain("?st a wikibase:BestRank");
    expect(query).toContain("BIND(EXISTS { ?st pq:P518 ?part } AS ?scoped)");
    expect(query).not.toMatch(/wdt:P37/);
    // And the column has to be SELECTed, not merely bound: `parseBindings`
    // refuses a response missing a declared column, so a query that stopped
    // returning it demotes the property and carries yesterday's values
    // forward rather than silently publishing every scoped statement.
    expect(languages.columns).toContain("scoped");
    expect(query).toContain("?scoped");
  });
});

describe("COUNTRY_CODES", () => {
  test("is the app's shard universe: 246 sorted, unique, alpha-2 codes", () => {
    expect(COUNTRY_CODES).toHaveLength(EXPECTED_COUNTRIES);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect([...COUNTRY_CODES].sort()).toEqual(COUNTRY_CODES);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    for (const code of ["CN", "PE", "JP", "CH", "SH"]) expect(COUNTRY_CODES).toContain(code);
  });

  test("excludes the codes Wikidata carries that the app ships no shard for", () => {
    // Measured 2026-08-27: an unbounded P297 query answers with 259 codes, and
    // these thirteen are the difference — exceptionally reserved codes,
    // uninhabited territories, and the historical Netherlands Antilles, East
    // Germany and Yugoslavia. Facts about East Germany would pass every gate in
    // this file and answer a question no user can ask.
    for (const code of ["AC", "AN", "AQ", "BV", "CP", "CQ", "DD", "DG", "HM", "PC", "TA", "UM", "YU"]) {
      expect(COUNTRY_CODES, code).not.toContain(code);
    }
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

/** `http://www.wikidata.org/entity/Qn`, the form every `?item` column takes. */
const entity = (id: string): string => `http://www.wikidata.org/entity/${id}`;

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

// ---------------------------------------------------------------------------
// buildFacts
// ---------------------------------------------------------------------------

describe("buildFacts", () => {
  const byProperty = {
    codes: [{ code: "PE" }, { code: "XX" }],
    currency: [{ country: "PE", code: "PEN", name: "Peruvian sol" }],
    plugs: plugRows("NEMA 1-15", "NEMA 5-15", "Europlug").map((row) => ({ ...row, country: "PE" })),
    voltage: [{ country: "PE", value: "220" }],
    drivingSide: [{ country: "PE", value: "right-hand traffic" }],
    emergency: [
      { country: "PE", number: "105", role: "police" },
      { country: "PE", number: "116", role: "fire department" },
      { country: "PE", number: "106", role: "emergency medical services" },
    ],
    languages: [{ country: "PE", item: entity("Q1321"), value: "Spanish" }],
    callingCode: [{ country: "PE", value: "+51" }],
    coordinate: [{ country: "PE", lat: "-9.19" }],
    name: [{ country: "PE", value: "Peru" }],
  };

  test("builds one ordered record per country that has facts", () => {
    const built = buildFacts(byProperty);
    expect(built.countries.PE).toEqual({
      name: "Peru",
      currencyCode: "PEN",
      currencyName: "Peruvian sol",
      plugs: ["A", "B", "C"],
      voltageV: 220,
      drivingSide: "right",
      emergency: [
        { number: "105", role: "police" },
        { number: "116", role: "fire" },
        { number: "106", role: "ambulance" },
      ],
      officialLanguages: ["Spanish"],
      callingCode: "+51",
      lat: -9.19,
    });
  });

  test("puts the name first, so a reader sees which country a record is about", () => {
    // Also the byte-identical-rebuild rule: key order is RECORD_FIELDS order,
    // never insertion order, or a quiet night rewrites the file for nothing.
    expect(Object.keys(buildFacts(byProperty).countries.PE)).toEqual(RECORD_FIELDS);
  });

  test("OMITS a country with no facts rather than writing an empty record", () => {
    // lib/countryProfile.ts already falls through to the neutral profile for a
    // country it has no facts for. An empty record would be a second way of
    // saying the same thing, and the two would drift.
    const built = buildFacts(byProperty);
    expect(Object.keys(built.countries)).toEqual(["PE"]);
  });

  test("OMITS a country that has a name and nothing else, because a name is not a fact", () => {
    // The whole reason `name` is outside FACT_FIELDS: it must not be able to
    // keep an otherwise empty record alive, and it must not move `factCount` —
    // the unit every drift band in the gate is calibrated in.
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "PE" }, { code: "XX" }],
      name: [
        { country: "PE", value: "Peru" },
        { country: "XX", value: "Nowhere" },
      ],
    });
    expect(Object.keys(built.countries)).toEqual(["PE"]);
    expect(factCount(built.countries.PE)).toBe(9);
  });

  test("records the meta-item drop and the withheld name, which a finished record cannot show", () => {
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "PE" }, { code: "GN" }],
      languages: [
        { country: "PE", item: entity("Q1321"), value: "Spanish" },
        { country: "GN", item: entity("Q1339026"), value: "languages of Guinea" },
      ],
      currency: [
        { country: "PE", code: "PEN", name: "Peruvian sol" },
        { country: "GN", code: "GNF", name: "Guinean franc" },
      ],
      name: [
        { country: "PE", value: "Peru" },
        { country: "GN", value: "Guinea" },
        { country: "GN", value: "Republic of Guinea" },
      ],
    });
    expect(built.diagnostics.soleDroppedLanguages).toEqual(["GN"]);
    expect(built.countries.GN.officialLanguages).toBeUndefined();
    expect(built.diagnostics.withheld.name).toEqual(["GN"]);
    expect(built.countries.GN.name).toBeUndefined();
  });

  test("does not uppercase or reshape a country code, so the gate can see a reshape", () => {
    // The lowercase code carries its OWN rows, which is what makes this a pin
    // rather than a restatement. Fed only `[{code:"pe"},{code:"PE"}]` against
    // rows that all say `country: "PE"`, the "pe" record ends up empty and is
    // omitted by `factCount` — so a build that quietly uppercased every code
    // would produce the identical answer and this test would pass through the
    // mutation it names. With rows of its own, "pe" survives as a separate key
    // under the real rule and merges into "PE" under the mutated one.
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "pe" }, { code: "PE" }],
      currency: [
        { country: "PE", code: "PEN", name: "Peruvian sol" },
        { country: "pe", code: "PEN", name: "Peruvian sol" },
      ],
    });
    expect(Object.keys(built.countries).sort()).toEqual(["PE", "pe"]);
    expect(built.countries.pe.currencyCode).toBe("PEN");
  });

  test("records which rule withheld which field", () => {
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "PE" }, { code: "BZ" }],
      drivingSide: [
        { country: "PE", value: "right-hand traffic" },
        { country: "BZ", value: "right-hand traffic" },
      ],
      voltage: [
        { country: "PE", value: "220" },
        { country: "BZ", value: "550" },
        { country: "BZ", value: "220" },
      ],
      currency: [
        { country: "PE", code: "PEN", name: "Peruvian sol" },
        { country: "BZ", code: "PLN", name: "złoty" },
        { country: "BZ", code: "PLZ", name: "Polish zloty" },
      ],
    });
    expect(built.diagnostics.withheld.voltage).toEqual(["BZ"]);
    expect(built.diagnostics.withheld.currency).toEqual(["BZ"]);
    expect(built.countries.BZ.voltageV).toBeUndefined();
  });
});

describe("factCount", () => {
  test("counts only fields that are actually present", () => {
    expect(factCount({ currencyCode: "PEN", plugs: ["A"] })).toBe(2);
    expect(factCount({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CURATED_FACTS
// ---------------------------------------------------------------------------

/**
 * The measured upstream shape that causes each curated row's withhold.
 *
 * `languages` rows are `[item, label, scoped]`, the three columns the P37
 * query selects, so the fixture drives the SAME `pickLanguages` path a real
 * run takes rather than asserting the withhold by hand.
 */
const CURATED_UPSTREAM: Record<
  string,
  {
    currency?: [string, string][];
    voltage?: string[];
    languages?: [string, string, string][];
    name?: string[];
    emergency?: [string, string][];
    coordinate?: string[];
  }
> = {
  NL: {
    currency: [
      ["EUR", "euro"],
      ["USD", "United States dollar"],
      ["AWG", "Aruban florin"],
      ["XCG", "Caribbean guilder"],
    ],
    // The two-item split: Q55 gained P297 = "NL" alongside Q29999 on
    // 2026-08-28, so `wdt:P297` matches both and these three fields each get
    // two answers. Recorded here so the row-fires test below exercises the
    // real withhold rather than the absence of a fixture.
    name: ["Kingdom of the Netherlands", "Netherlands"],
    emergency: [
      ["112", ""],
      ["911", ""],
    ],
    coordinate: ["52.366666666667", "52.316666666"],
  },
  FR: {
    currency: [
      ["EUR", "euro"],
      ["XPF", "CFP franc"],
    ],
    voltage: ["400", "230"],
  },
  PL: {
    currency: [
      ["PLN", "złoty"],
      ["PLZ", "Polish zloty"],
    ],
  },
  // Bosnia's measured P38 answer, 2026-09-03: the 1992-1998 dinar arrived on
  // 2026-08-31 at the same rank as the convertible mark, so `wdt:` returns both
  // and the withhold is PL's shape exactly. It reddened three nightly runs.
  BA: {
    currency: [
      ["BAD", "Bosnia and Herzegovina dinar"],
      ["BAM", "convertible mark"],
    ],
  },
  ZW: {
    currency: [
      ["ZWL", "Zimbabwean dollar"],
      ["ZWG", "Zimbabwe Gold"],
      ["USD", "United States dollar"],
    ],
  },
  MO: {
    currency: [
      ["HKD", "Hong Kong dollar"],
      ["MOP", "Macanese pataca"],
    ],
  },
  // Belgium's real P37 answer, measured 2026-08-27 by the shipping query: 36
  // truthy rows over exactly three distinct items, every one qualified
  // `applies to part` with a region or a language-facility commune INSIDE
  // Belgium. Three rows are enough to reproduce the withhold; the repetition
  // upstream carries is per-qualifier and `pickLanguages` deduplicates.
  BE: {
    languages: [
      ["Q7411", "Dutch", "true"],
      ["Q150", "French", "true"],
      ["Q188", "German", "true"],
    ],
  },
  // Azerbaijan's real P37 answer, measured the same day: the scoped statement
  // is Azerbaijani itself (`applies to part: Standard Azerbaijani`, a variety
  // rather than a territory), and the unscoped remainder is the sign language
  // alone. This is the shape `pickLanguages`' doc-comment names as the reason
  // the rule is whole-field rather than a filter.
  AZ: {
    languages: [
      ["Q9292", "Azerbaijani", "true"],
      ["Q55698568", "Azerbaijani Sign Language", "false"],
    ],
  },
};

describe("CURATED_FACTS", () => {
  test("every shipped row fires against the measured upstream shape that caused its withhold", () => {
    // The CURATED_HEROES rule: a hand-verified value is only honest while it
    // is actually needed. A row that never fires is a claim nobody re-checks.
    for (const [code, overrides] of Object.entries(CURATED_FACTS)) {
      const upstream = CURATED_UPSTREAM[code];
      expect(upstream, `no measured upstream shape recorded for ${code}`).toBeDefined();
      const built = buildFacts({
        codes: [{ code }],
        currency: (upstream.currency ?? []).map(([c, name]) => ({ country: code, code: c, name })),
        voltage: (upstream.voltage ?? []).map((value) => ({ country: code, value })),
        languages: (upstream.languages ?? []).map(([item, value, scoped]) => ({
          country: code,
          item: entity(item),
          value,
          scoped,
        })),
        // Wired from the fixture like the three above, so a row covering one
        // of these fields is proven to fire against the shape that withheld
        // it. Left unwired, `before?.[field]` would be undefined because
        // nothing was SUPPLIED, and the assertion below would pass for a
        // reason that has nothing to do with the withhold.
        name: (upstream.name ?? []).map((value) => ({ country: code, value })),
        emergency: (upstream.emergency ?? []).map(([number, role]) => ({
          country: code,
          number,
          role,
        })),
        coordinate: (upstream.coordinate ?? []).map((lat) => ({ country: code, lat })),
        drivingSide: [{ country: code, value: "right-hand traffic" }],
      });
      const before = built.countries[code] as Record<string, unknown> | undefined;
      for (const field of Object.keys(overrides)) {
        expect(before?.[field], `${code}.${field} was not withheld upstream`).toBeUndefined();
      }
      applyCurated(built);
      expect(built.diagnostics.curatedStale).toEqual([]);
      const after = built.countries[code] as Record<string, unknown>;
      for (const [field, value] of Object.entries(overrides)) {
        expect(built.diagnostics.curatedFired).toContain(`${code}.${field}`);
        expect(after[field]).toEqual(value);
      }
    }
  });

  test("the shipped rows are exactly the six currencies, the one voltage and the two languages", () => {
    expect(Object.keys(CURATED_FACTS).sort()).toEqual(["AZ", "BA", "BE", "FR", "MO", "NL", "PL", "ZW"]);
    expect(CURATED_FACTS.FR.voltageV).toBe(230);
    // The two rescued by hand from the territorial-scope rule, VALUE and all.
    // Belgium's constitutional trio, and Azerbaijan's single state language
    // WITHOUT the sign language the unscoped remainder would have left alone.
    expect(CURATED_FACTS.BE.officialLanguages).toEqual(["Dutch", "French", "German"]);
    expect(CURATED_FACTS.AZ.officialLanguages).toEqual(["Azerbaijani"]);
  });

  test("a curated language row rescues the field the scope rule withheld, end to end", () => {
    // The claim the previous repair was abandoned on — that `CURATED_FACTS`
    // could not reach a withheld field "since applyCurated marks a row stale
    // when the field is present" — driven rather than argued. A withheld field
    // is ABSENT, `applyCurated` keys on `!== undefined`, so the row fires. If
    // the withhold ever stops firing this goes red as STALE instead, which is
    // the whole point of the pair.
    const built = buildFacts({
      codes: [{ code: "BE" }],
      drivingSide: [{ country: "BE", value: "right-hand traffic" }],
      languages: [
        { country: "BE", item: entity("Q7411"), value: "Dutch", scoped: "true" },
        { country: "BE", item: entity("Q150"), value: "French", scoped: "true" },
        { country: "BE", item: entity("Q188"), value: "German", scoped: "true" },
      ],
    });
    expect(built.diagnostics.scopedLanguages).toContain("BE");
    expect(built.countries.BE.officialLanguages).toBeUndefined();
    applyCurated(built);
    expect(built.countries.BE.officialLanguages).toEqual(["Dutch", "French", "German"]);
    expect(built.diagnostics.curatedFired).toContain("BE.officialLanguages");
    expect(built.diagnostics.curatedStale).toEqual([]);
  });

  test("a second item gaining the ISO code withholds three NL fields, and the curated rows rescue all three", () => {
    // THE SHAPE THAT TOOK THE NIGHTLY JOB DOWN, and the reason these rows are
    // not editorial. At 2026-08-28T09:46:29Z, Q55 "Netherlands" GAINED
    // `P297 = "NL"` alongside Q29999 "Kingdom of the Netherlands", both at
    // NormalRank. Every query in the ingest anchors on `?c wdt:P297 ?country`,
    // so `wdt:` now matches BOTH items and each SINGLE-VALUED picker sees two
    // answers and withholds — which is correct, and must stay correct: the
    // first three assertions below pin the withhold itself, so a "fix" that
    // made a picker coin-flip would go red here rather than ship a guess.
    //
    // The rows are the measured upstream shape, NL only. 911 is the Caribbean
    // constituents'; 112 is the European country's. The two P625 points are
    // Q29999's and Q55's.
    const built = buildFacts({
      codes: [{ code: "NL" }],
      name: [
        { country: "NL", value: "Kingdom of the Netherlands" },
        { country: "NL", value: "Netherlands" },
      ],
      currency: [
        { country: "NL", code: "EUR", name: "euro" },
        { country: "NL", code: "USD", name: "United States dollar" },
        { country: "NL", code: "AWG", name: "Aruban florin" },
        { country: "NL", code: "XCG", name: "Caribbean guilder" },
      ],
      emergency: [
        { country: "NL", number: "112", role: "" },
        { country: "NL", number: "911", role: "" },
      ],
      coordinate: [
        { country: "NL", lat: "52.366666666667" },
        { country: "NL", lat: "52.316666666" },
      ],
      drivingSide: [{ country: "NL", value: "right-hand traffic" }],
    });
    expect(built.countries.NL.name).toBeUndefined();
    expect(built.countries.NL.emergency).toBeUndefined();
    expect(built.countries.NL.lat).toBeUndefined();
    // Two FACTS lost (name is not a fact), which is what crosses
    // COUNTRY_FIELD_LOSS_GRACE = 1 and aborts the run against a 9-fact NL.
    expect(factCount(built.countries.NL)).toBe(1);

    applyCurated(built);
    expect(built.countries.NL.name).toBe("Kingdom of the Netherlands");
    expect(built.countries.NL.emergency).toEqual([{ number: "112", role: null }]);
    expect(built.countries.NL.lat).toBe(52.366666666667);
    expect(built.diagnostics.curatedStale).toEqual([]);
    for (const field of ["name", "emergency", "lat", "currencyCode", "currencyName"]) {
      expect(built.diagnostics.curatedFired).toContain(`NL.${field}`);
    }
    // drivingSide plus the four rescued facts. Not nine, because this fixture
    // supplies only the properties the two-item split actually moved — the
    // real run adds plugs, voltage, languages and callingCode, which both
    // items agree on and which were never withheld.
    expect(factCount(built.countries.NL)).toBe(5);
  });

  test("an override upstream has since made redundant is reported STALE, not applied silently", () => {
    const built = buildFacts({
      codes: [{ code: "NL" }],
      currency: [{ country: "NL", code: "EUR", name: "euro" }],
    });
    applyCurated(built);
    expect(built.diagnostics.curatedStale).toContain("NL.currencyCode");
    expect(built.diagnostics.curatedFired).not.toContain("NL.currencyCode");
  });

  test("applyCurated leaves the country keys sorted, so a rebuild is byte-identical", () => {
    const built = buildFacts({ codes: [{ code: "ZW" }, { code: "AA" }], currency: [{ country: "AA", code: "AAA", name: "test" }] });
    applyCurated(built);
    expect(Object.keys(built.countries)).toEqual([...Object.keys(built.countries)].sort());
  });
});

// ---------------------------------------------------------------------------
// Per-property demotion and carry-forward
// ---------------------------------------------------------------------------

describe("per-property demotion", () => {
  test("a first run has no previous coverage and accepts any answer", () => {
    expect(isPropertyAnswerPlausible(0, 0)).toBe(true);
  });

  test("an answer covering less than 80% of last run's countries is not an answer", () => {
    expect(isPropertyAnswerPlausible(195, 246)).toBe(false);
    expect(isPropertyAnswerPlausible(197, 246)).toBe(true);
  });

  test("counts previous coverage per FIELD GROUP, not per country", () => {
    const previous = {
      countries: {
        PE: { currencyCode: "PEN", currencyName: "Peruvian sol" },
        CN: { plugs: ["A"] },
      },
    };
    expect(countPreviousCoverage(previous, ["currencyCode", "currencyName"])).toBe(1);
    expect(countPreviousCoverage(previous, ["plugs"])).toBe(1);
    expect(countPreviousCoverage(null, ["plugs"])).toBe(0);
  });

  test("counts distinct countries in an answer, not rows", () => {
    expect(
      countAnsweredCountries([
        { country: "PE", value: "a" },
        { country: "PE", value: "b" },
        { country: "CN", value: "c" },
      ])
    ).toBe(2);
  });
});

/** What `buildFacts` returns, loosened so a test can hand-build a fixture. */
type Built = {
  countries: Record<string, Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
};

describe("carryForwardFields", () => {
  const previous = {
    countries: {
      PE: { currencyCode: "PEN", currencyName: "Peruvian sol", plugs: ["A", "B", "C"] },
      CN: { plugs: ["A", "C", "I"] },
    },
  };

  test("restores a demoted property's previous values instead of deleting them", () => {
    const built: Built = {
      countries: { PE: { currencyCode: "PEN", currencyName: "Peruvian sol" }, CN: { currencyCode: "CNY", currencyName: "renminbi" } },
      diagnostics: {},
    };
    carryForwardFields(built, previous, ["plugs"]);
    expect(built.countries.PE.plugs).toEqual(["A", "B", "C"]);
    expect(built.countries.CN.plugs).toEqual(["A", "C", "I"]);
  });

  test("discards the demoted property's own partial answer rather than merging it", () => {
    // A result set already judged untrustworthy is not a better source than
    // the last state that passed every gate, and mixing the two produces a
    // record no run ever verified as a whole.
    const built: Built = { countries: { PE: { plugs: ["G"] } }, diagnostics: {} };
    carryForwardFields(built, previous, ["plugs"]);
    expect(built.countries.PE.plugs).toEqual(["A", "B", "C"]);
  });

  test("does not invent a country the previous artifact never had", () => {
    const built: Built = { countries: { PE: { currencyCode: "PEN", currencyName: "sol" } }, diagnostics: {} };
    carryForwardFields(built, previous, ["plugs"]);
    expect(built.countries.JP).toBeUndefined();
  });

  test("a first run has nothing to carry and leaves the build alone", () => {
    const built: Built = { countries: { PE: { plugs: ["A"] } }, diagnostics: {} };
    carryForwardFields(built, null, ["plugs"]);
    expect(built.countries.PE.plugs).toEqual(["A"]);
  });
});

// ---------------------------------------------------------------------------
// stampedPayload
// ---------------------------------------------------------------------------

describe("stampedPayload", () => {
  test("keeps the previous timestamp when the payload is unchanged", () => {
    const body = { source: "Wikidata (CC0)", license: "CC0-1.0", countries: { PE: { lat: -9 } } };
    const previous = { generatedAt: "2026-08-01T00:00:00.000Z", ...body };
    expect(stampedPayload(previous, body, "2026-08-27T00:00:00.000Z").generatedAt).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });

  test("takes the new timestamp when anything moved", () => {
    const previous = {
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "Wikidata (CC0)",
      license: "CC0-1.0",
      countries: { PE: { lat: -9 } },
    };
    const body = { source: "Wikidata (CC0)", license: "CC0-1.0", countries: { PE: { lat: -10 } } };
    expect(stampedPayload(previous, body, "2026-08-27T00:00:00.000Z").generatedAt).toBe(
      "2026-08-27T00:00:00.000Z"
    );
  });
});

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe("buildReport", () => {
  const countries = { PE: { currencyCode: "PEN", lat: -9 }, SH: { lat: -15.9 } };

  test("states the CC0 licence and that no UI credit is added, and why", () => {
    const report = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    expect(report).toContain("CC0-1.0");
    expect(report).toContain("No UI credit is added for this source");
    expect(report).toContain("GeoNamesCredit.tsx");
  });

  test("carries the measurement behind each refusal, so it is not re-litigated", () => {
    const report = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    expect(report).toContain("## Not derivable");
    expect(report).toMatch(/high-speed railway line/);
    expect(report).toMatch(/204 of 246/);
  });

  test("has no per-run counts, so a quiet rebuild is byte-identical", () => {
    const first = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    const second = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    expect(first).toBe(second);
    expect(first).not.toMatch(/changed (this run|tonight)/i);
  });

  test("the withheld-language list is derived from the artifact, not a frozen literal", () => {
    // The defect: the bullet said "AF, AZ, BE, BQ, PW and US" — six — while the
    // artifact beside it withheld NINE, because the three countries upstream
    // states no language for at all were never in a sentence that claimed to
    // explain the gap. A hand-written copy of what a rule did drifts the first
    // time anything moves. Here the report is handed one country withheld for
    // each reason and has to name both.
    const report = buildReport({
      countries: {
        PE: { officialLanguages: ["Spanish"] },
        US: { currencyCode: "USD" },
        UY: { currencyCode: "UYU" },
      },
      generatedAt: "2026-08-27T00:00:00.000Z",
      scopedLanguages: ["US"],
    });
    expect(report).toContain("**Official languages for 2 of the 3 countries.**");
    expect(report).toMatch(/1 because every P37 statement upstream gives them is qualified/);
    expect(report).toMatch(/1 because upstream states no official language at all/);
    // And each country lands under the reason that actually applies to it. The
    // scoped bullet is the one that names US; the unstated bullet names UY.
    const scopedAt = report.indexOf("applies to part");
    const unstatedAt = report.indexOf("no official language at all");
    expect(report.slice(scopedAt, unstatedAt)).toMatch(/^\s{4}US$/m);
    expect(report.slice(unstatedAt)).toMatch(/^\s{4}UY$/m);
    // And PE is in none of the three lists, because it has its languages. The
    // whole-set line is asserted verbatim rather than by absence, so a build
    // that listed every country would fail here rather than pass by omission.
    expect(report).toMatch(/^\s{2}US, UY$/m);
  });

  test("a demoted P37 query withholds the SPLIT rather than guessing at it", () => {
    // `scopedLanguages: null` is "not measured this run", which is a different
    // thing from "nothing was scoped". On a night the P37 query is demoted and
    // its values carried forward, the artifact still withholds the same
    // countries while the diagnostic is empty — so attributing all of them to
    // "upstream states none" would be the frozen list's failure with extra
    // steps. The countries are still named; only the reason is withheld.
    const report = buildReport({
      countries: { PE: { officialLanguages: ["Spanish"] }, US: { currencyCode: "USD" } },
      generatedAt: "2026-08-27T00:00:00.000Z",
      scopedLanguages: null,
    });
    expect(report).toContain("**Official languages for 1 of the 2 countries.**");
    expect(report).toContain("Why each one is withheld is not stated this run");
    expect(report).not.toMatch(/because upstream states no official language at all/);
    expect(report).toMatch(/^\s{2}US$/m);
  });

  test("says nothing about withheld languages when nothing is withheld", () => {
    // The arming case for the two above: the bullet is not boilerplate that
    // renders regardless, so a build where the rule stopped firing does not
    // print a paragraph explaining a gap that is not there.
    const report = buildReport({
      countries: { PE: { officialLanguages: ["Spanish"] } },
      generatedAt: "2026-08-27T00:00:00.000Z",
      scopedLanguages: [],
    });
    expect(report).not.toMatch(/Official languages for/);
  });
});

// ---------------------------------------------------------------------------
// assertFactsSane — one test per branch, each naming the mutation it kills
//
// Every branch is also driven through the real `run()` below and asserted to
// write nothing. These unit tests are what pin the MESSAGE and the exact
// boundary; the run() block is what proves the gate is wired into the path a
// nightly job actually takes.
// ---------------------------------------------------------------------------

const FILLER_POOL = (() => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  // Every code `healthyFeed` adds by name, so no country is added twice. AZ,
  // BA and BE are the curated rows that are not currencies: left out of this
  // set they were ALSO drawn as fillers, and the filler's clean calling code
  // beside the curated loop's second one made `pickCallingCode` withhold — a
  // shape that matched nothing measured upstream.
  const named = new Set([
    "AZ", "BA", "BE", "BZ", "CH", "CN", "CZ", "FR", "JP", "MO", "NL", "PE", "PL", "SH", "ZW", "QZ",
  ]);
  const codes: string[] = [];
  for (const a of alphabet) for (const b of alphabet) if (!named.has(a + b)) codes.push(a + b);
  return codes;
})();

/**
 * The 241 anonymous countries in a sample build. Five named ones (CN, PE, JP,
 * CH and the sparse SH) bring it to the 246 the gate expects.
 */
const SAMPLE_FILLERS = FILLER_POOL.slice(0, EXPECTED_COUNTRIES - 5);

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

/**
 * The growth direction needs BIGGER slices than the shrink direction, and the
 * asymmetry is the point rather than an oversight.
 *
 * `MIN_FIELD_COVERAGE` is checked against the BUILT artifact, which is healthy
 * in a growth test — it is the PREVIOUS one that is made poor. So no coverage
 * floor bounds how far these may go, and they are sized to clear
 * MAX_GROWTH_RATIO's 10% instead of MAX_SHRINK_RATIO's 5%. Reusing the shrink
 * slices here would leave the growth check with no killing test at all: 131
 * fields is 6.3% growth, which passes.
 */
const SAMPLE_GROWTH_GAIN: [string, string[]][] = [
  ["plugs", SAMPLE_FILLERS.slice(0, 45)],
  ["voltageV", SAMPLE_FILLERS.slice(45, 92)],
  ["emergency", SAMPLE_FILLERS.slice(92, 141)],
  ["officialLanguages", SAMPLE_FILLERS.slice(141, 186)],
  ["drivingSide", SAMPLE_FILLERS.slice(186, 212)],
  ["lat", SAMPLE_FILLERS.slice(212, 238)],
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
// run() — proving the gate by behaviour, not by source position
//
// The design forbids a source-position grep test here, and
// scripts/ingest-cities.test.ts:1263-1276 records why: a reviewer
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

import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

type Feed = Record<string, Row[] | "throw">;

const NAMED_CODES = ["AZ", "BA", "BE", "BZ", "CH", "CN", "CZ", "FR", "JP", "MO", "NL", "PE", "PL", "SH", "ZW"];
const FILLERS = FILLER_POOL.slice(0, EXPECTED_COUNTRIES - NAMED_CODES.length);

interface CountrySpec {
  name?: string;
  currency?: [string, string][];
  plugs?: string[];
  voltage?: string[];
  drivingSide?: string;
  emergency?: [string, string][];
  languages?: string[];
  callingCode?: string;
  lat?: string;
}

/**
 * A stable fake Q-id per language label, so a fixture rebuilt in the same run
 * produces the same rows. `pickLanguages` acts on the id, so the feed has to
 * carry one — and the one id that MATTERS, Q1339026, is pushed by hand in the
 * test that needs it rather than being reachable from here by accident.
 */
const LANGUAGE_ITEM: Record<string, string> = {};
let nextLanguageItem = 900_000;
const languageItem = (label: string): string =>
  (LANGUAGE_ITEM[label] ??= `http://www.wikidata.org/entity/Q${nextLanguageItem++}`);

function addCountry(feed: Feed, code: string, spec: CountrySpec): void {
  (feed.codes as Row[]).push({ code });
  (feed.name as Row[]).push({ country: code, value: spec.name ?? `Country ${code}` });
  for (const [currencyCode, name] of spec.currency ?? []) {
    (feed.currency as Row[]).push({ country: code, code: currencyCode, name });
  }
  for (const label of spec.plugs ?? []) {
    (feed.plugs as Row[]).push({
      country: code,
      item: `http://www.wikidata.org/entity/${PLUG_ITEM[label] ?? "Q999999"}`,
      itemLabel: label,
    });
  }
  for (const value of spec.voltage ?? []) (feed.voltage as Row[]).push({ country: code, value });
  if (spec.drivingSide) (feed.drivingSide as Row[]).push({ country: code, value: spec.drivingSide });
  for (const [number, role] of spec.emergency ?? []) {
    (feed.emergency as Row[]).push({ country: code, number, role });
  }
  for (const value of spec.languages ?? []) {
    (feed.languages as Row[]).push({ country: code, item: languageItem(value), value });
  }
  if (spec.callingCode) (feed.callingCode as Row[]).push({ country: code, value: spec.callingCode });
  if (spec.lat) (feed.coordinate as Row[]).push({ country: code, lat: spec.lat });
}

const FILLER_SPEC: CountrySpec = {
  currency: [["XCD", "East Caribbean dollar"]],
  plugs: ["Europlug"],
  voltage: ["230"],
  drivingSide: "right-hand traffic",
  emergency: [["112", "emergency service"]],
  languages: ["English"],
  callingCode: "+1",
  lat: "10.0",
};

/**
 * 246 countries the way Wikidata really answers, including the six measured
 * landmines. Every fixture that follows is a mutation of this one, so each
 * test states exactly one hazard.
 */
function healthyFeed(): Feed {
  const feed: Feed = {
    codes: [],
    name: [],
    currency: [],
    plugs: [],
    voltage: [],
    drivingSide: [],
    emergency: [],
    languages: [],
    callingCode: [],
    coordinate: [],
  };
  addCountry(feed, "CN", {
    name: REQUIRED_NAMES.CN,
    currency: [["CNY", "renminbi"]],
    plugs: ["Europlug", "NEMA 1-15", "AS/NZS 3112"],
    voltage: ["220"],
    drivingSide: "right-hand traffic",
    emergency: [
      ["110", "police"],
      ["119", "fire department"],
      ["120", "emergency medical services"],
    ],
    languages: ["Standard Chinese"],
    callingCode: "+86",
    lat: "35.0",
  });
  addCountry(feed, "PE", {
    name: REQUIRED_NAMES.PE,
    currency: [["PEN", "Peruvian sol"]],
    plugs: ["NEMA 1-15", "NEMA 5-15", "Europlug"],
    voltage: ["220"],
    drivingSide: "right-hand traffic",
    emergency: [
      ["105", "police"],
      ["116", "fire department"],
      ["106", "emergency medical services"],
    ],
    languages: ["Spanish", "Quechua", "Aymara"],
    callingCode: "+51",
    lat: "-9.19",
  });
  addCountry(feed, "JP", {
    currency: [["JPY", "Japanese yen"]],
    plugs: ["NEMA 1-15", "NEMA 5-15"],
    voltage: ["100"],
    drivingSide: "left-hand traffic",
    emergency: [
      ["110", "police"],
      ["119", "fire department"],
    ],
    languages: ["Japanese"],
    callingCode: "+81",
    lat: "36.0",
  });
  addCountry(feed, "CH", {
    currency: [["CHF", "Swiss franc"]],
    plugs: ["SN 441011", "Europlug"],
    voltage: ["230"],
    drivingSide: "right-hand traffic",
    emergency: [
      ["117", "police"],
      ["118", "fire department"],
      ["144", "emergency medical services"],
    ],
    languages: ["German", "French", "Italian", "Romansh"],
    callingCode: "+41",
    lat: "47.0",
  });
  // The design's own sparse fixture: present, with fields absent.
  addCountry(feed, "SH", {
    name: "Saint Helena, Ascension and Tristan da Cunha",
    currency: [["SHP", "Saint Helena pound"]],
    drivingSide: "left-hand traffic",
    lat: "-15.9",
  });
  for (const [code, spec] of Object.entries(CURATED_UPSTREAM)) {
    addCountry(feed, code, {
      ...FILLER_SPEC,
      currency: spec.currency ?? FILLER_SPEC.currency,
      voltage: spec.voltage ?? FILLER_SPEC.voltage,
      callingCode: `+${31 + Object.keys(CURATED_UPSTREAM).indexOf(code)}`,
    });
    // BE and AZ carry a language shape rather than a currency one, so the
    // filler's unscoped "English" has to go: leave it and their curated rows
    // read as STALE and `assertFactsSane` refuses the whole run, which is the
    // gate working — the fixture has to reproduce the withhold, not assert it.
    if (spec.languages) {
      dropRows(feed, "languages", [code]);
      for (const [item, value, scoped] of spec.languages) {
        (feed.languages as Row[]).push({ country: code, item: entity(item), value, scoped });
      }
    }
    // NL's two-item split, by the same rule and for the same reason: the
    // filler gives one clean answer per field, which would resolve and leave
    // the curated rows STALE. Replacing them with the measured pair is what
    // reproduces the withhold these rows exist to rescue.
    if (spec.name) {
      dropRows(feed, "name", [code]);
      for (const value of spec.name) (feed.name as Row[]).push({ country: code, value });
    }
    if (spec.emergency) {
      dropRows(feed, "emergency", [code]);
      for (const [number, role] of spec.emergency) {
        (feed.emergency as Row[]).push({ country: code, number, role });
      }
    }
    if (spec.coordinate) {
      dropRows(feed, "coordinate", [code]);
      for (const lat of spec.coordinate) (feed.coordinate as Row[]).push({ country: code, lat });
    }
  }
  // Measured: BZ's P2884 is 550/220, so its voltage is withheld and — unlike
  // FR's — no curated row replaces it. A country with an honest gap.
  addCountry(feed, "BZ", { ...FILLER_SPEC, currency: [["BZD", "Belize dollar"]], voltage: ["550", "220"] });
  // Measured: CZ's P498 leaks the ISO numeric code beside the alphabetic one.
  addCountry(feed, "CZ", {
    ...FILLER_SPEC,
    currency: [
      ["CZK", "Czech koruna"],
      ["203", "Czech koruna"],
    ],
    callingCode: "+420",
  });
  for (const code of FILLERS) addCountry(feed, code, FILLER_SPEC);
  return feed;
}

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

/** Drop every row a property carries for these countries. */
function dropRows(feed: Feed, property: string, codes: string[]): Feed {
  const gone = new Set(codes);
  feed[property] = (feed[property] as Row[]).filter((row) => !gone.has(row.country));
  return feed;
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
