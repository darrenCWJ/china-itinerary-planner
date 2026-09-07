/**
 * ingest-country-facts — the fixtures more than one test file reads.
 *
 * Not a `*.test.ts`: vitest.config.mts includes `scripts/**\/*.test.ts`, so
 * this file is imported by the suites and never collected as one of them.
 *
 * Every declaration below is a VERBATIM move, on 2026-09-07, of a block that
 * the 2026-09-07 split (spec 2026-09-07-unscheduled-items §2.1) had left
 * duplicated byte-identically across two or three of
 * scripts/ingest-country-facts.test.ts and scripts/country-facts/*.test.ts.
 * The bodies are unchanged — only `export ` was added to each declaration —
 * and every duplicate copy was deleted in favour of importing from here, so a
 * measured upstream shape now has exactly one home and cannot drift between
 * files.
 *
 * Where each block came from in `git show HEAD:scripts/ingest-country-facts.test.ts`:
 *
 * | Block                | Original lines | Was duplicated in                          |
 * |----------------------|----------------|--------------------------------------------|
 * | `Row`                | 62             | entry, picks.test.ts, facts.test.ts        |
 * | `PLUG_ITEM`          | 284–300        | entry, picks.test.ts, facts.test.ts        |
 * | `PLUG_ARTICLE`       | 325–329        | entry, picks.test.ts                       |
 * | `plugRows`           | 331–336        | picks.test.ts, facts.test.ts               |
 * | `entity`             | 752–753        | entry, picks/facts/curated.test.ts         |
 * | `CURATED_UPSTREAM`   | 1157–1251      | entry, curated.test.ts                     |
 * | `FILLER_POOL`        | 1615–1628      | entry, gate.test.ts                        |
 * | `SAMPLE_FILLERS`     | 1630–1634      | entry, gate.test.ts                        |
 * | `SAMPLE_GROWTH_GAIN` | 1659–1677      | entry, gate.test.ts                        |
 *
 * The upstream shapes here are the ones Investigation 3 MEASURED on
 * 2026-08-27 — `NL EUR/USD/AWG/XCG`, `FR 400/230`, `PL PLN/PLZ`, `ZW` x13,
 * `BA BAD/BAM` (2026-09-03) and Q60740126 across 39 countries — not shapes
 * invented to make a rule look reachable.
 *
 * Two inner comments still say "below" and point at their original
 * neighbours rather than at anything in this file: `PLUG_ITEM`'s "see the
 * withhold test below" is `pickPlugs`' BS 546 test in
 * scripts/country-facts/picks.test.ts, and `CURATED_UPSTREAM`'s "the
 * row-fires test below" is in scripts/country-facts/curated.test.ts. They
 * were left as written because these bodies are verbatim.
 */

import { EXPECTED_COUNTRIES } from "./gate.mjs";

export type Row = Record<string, string>;

export const PLUG_ITEM: Record<string, string> = {
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

/** The Wikipedia ARTICLE Wikidata carries as a P2853 value for 39 countries. */
export const PLUG_ARTICLE = {
  item: "http://www.wikidata.org/entity/Q60740126",
  itemLabel: "AC power plugs and sockets: British and related types",
};

export const plugRows = (...labels: string[]): Row[] =>
  labels.map((itemLabel) => ({
    country: "XX",
    item: `http://www.wikidata.org/entity/${PLUG_ITEM[itemLabel] ?? "Q999999"}`,
    itemLabel,
  }));

/** `http://www.wikidata.org/entity/Qn`, the form every `?item` column takes. */
export const entity = (id: string): string => `http://www.wikidata.org/entity/${id}`;

/**
 * The measured upstream shape that causes each curated row's withhold.
 *
 * `languages` rows are `[item, label, scoped]`, the three columns the P37
 * query selects, so the fixture drives the SAME `pickLanguages` path a real
 * run takes rather than asserting the withhold by hand.
 */
export const CURATED_UPSTREAM: Record<
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

export const FILLER_POOL = (() => {
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
export const SAMPLE_FILLERS = FILLER_POOL.slice(0, EXPECTED_COUNTRIES - 5);

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
export const SAMPLE_GROWTH_GAIN: [string, string[]][] = [
  ["plugs", SAMPLE_FILLERS.slice(0, 45)],
  ["voltageV", SAMPLE_FILLERS.slice(45, 92)],
  ["emergency", SAMPLE_FILLERS.slice(92, 141)],
  ["officialLanguages", SAMPLE_FILLERS.slice(141, 186)],
  ["drivingSide", SAMPLE_FILLERS.slice(186, 212)],
  ["lat", SAMPLE_FILLERS.slice(212, 238)],
];
