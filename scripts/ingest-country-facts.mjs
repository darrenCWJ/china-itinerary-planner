#!/usr/bin/env node
/**
 * ingest-country-facts.mjs
 *
 * Builds data/country-facts.json — structured scalars about every country the
 * app ships a city shard for — from Wikidata's SPARQL endpoint, plus
 * data/country-facts-report.md describing what was and was not derivable.
 *
 * STRUCTURED SCALARS ONLY, NEVER PROSE. The country's English name, currency
 * code and name, plug letters, mains voltage, driving side, emergency numbers
 * with their roles, official languages, dialling code and a centroid latitude
 * used by one cross-check.
 *
 * The NAME is identity, not a fact, and the difference is enforced rather than
 * asserted: it sits in `RECORD_FIELDS` so every shape rule applies to it, and
 * it is deliberately absent from `FACT_FIELDS` so `factCount` - the unit every
 * drift check in this file counts in - does not move by 246 the night this
 * field was added. It exists because the sentences in lib/countryTips.ts have
 * to name the country ("We don't have Peru-specific guidance...") and
 * lib/countries.ts's hand-tuned table covers 24 of the 246: the other 222 read
 * "We don't have PE-specific guidance..." without it. Hand-writing 246 names
 * was the alternative, and it is the thing the honest-gap rule exists to
 * refuse - so the name comes from the same CC0 source, under the same gates,
 * as every other value here.
 * The sentences a traveller reads are written by hand in reviewed TypeScript
 * (lib/countryTips.ts, Task 26) from these scalars; no upstream string is ever
 * rendered as advice. The artifact is called `country-facts`, not
 * `country-guidance`, and that name is a guardrail: it should read as wrong to
 * put a sentence in it.
 *
 * Why an ingest at all: lib/countryProfile.ts already declares the right
 * interface and the plan generators already route through it, but outside
 * China it answers with the neutral defaults. That is honest and thin. These
 * facts turn thin into specific for 246 countries without anybody hand-writing
 * 246 country guides — and a field with no supporting data emits NOTHING
 * rather than a hedge, a placeholder or a guess.
 *
 * Rerunnable and idempotent: `stampedPayload` keeps the previous
 * `generatedAt` when the payload is unchanged, so a quiet night produces a
 * byte-identical file and the nightly workflow has nothing to commit. There is
 * no per-country write loop — the whole merge is computed in memory, every
 * gate runs, and only then does a single whole-file write happen.
 *
 * Like ingest-cities.mjs and ingest-airports.mjs, and unlike
 * ingest-destinations.mjs, this script ABORTS BEFORE WRITING when a sanity
 * check fails. The nightly workflow commits what this writes and Vercel
 * deploys the commit unattended. Task 7 of this project shipped a measured
 * data wipe because an HTTP 200 with a short body was treated as a full
 * answer: it deleted 2,559 of 5,118 records in one night at exit 0. A corrupt
 * facts artifact is not useful for inspection, it is a production incident, so
 * `assertFactsSane` runs before `mkdirSync` and before any write primitive
 * fires.
 *
 * Licence: Wikidata's main and property namespaces are CC0 — a public domain
 * dedication with NO attribution condition. That is confirmed live from the
 * endpoint's own `meta=siteinfo` and it is why this source adds nothing to
 * components/plan/GeoNamesCredit.tsx and nothing to lib/contracts.test.ts's C7
 * contract. That component's own doc-comment argues this exact case for this
 * exact source: naming a CC0 source in a legal notice would imply the credits
 * beside it are discretionary, when every one of them is required. The
 * decision is recorded in three coupled places so a reader cannot mistake it
 * for an oversight — `SOURCE_LICENSE` below, the `license` field stamped into
 * the artifact envelope, and the `## Attribution` section of the report.
 *
 * Usage: node scripts/ingest-country-facts.mjs
 *
 * This script imports nothing outside node:fs, node:path and node:url. It
 * deliberately reads no `lib/*.ts` leaf: build-time logic may not live in
 * lib/, which is also why `writeFileAtomic` below is an acknowledged fourth
 * verbatim copy rather than a shared import. If a future edit does need a
 * leaf, it must be a zero-import one and the import must carry an explicit
 * `.ts` extension — Node's native type stripping (stable since Node 22.18 /
 * 24) fails an extensionless `.ts` -> `.ts` import with ERR_MODULE_NOT_FOUND,
 * and adding the extension inside lib/ fails `tsc` with TS5097.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * One SPARQL result row, already decoded from CSV: column name -> cell text.
 * @typedef {Record<string, string>} Row
 */
/**
 * One emergency number and the role its P366 qualifier gave it. `role` is null
 * only on the single-number path, where there is no ambiguity to resolve.
 * @typedef {{ number: string, role: string | null }} EmergencyNumber
 */
/**
 * One country's record as it sits in data/country-facts.json. Every field is
 * optional and an ABSENT field is the honest answer — never an empty string,
 * never an empty array, never a placeholder.
 * @typedef {{
 *   name?: string,
 *   currencyCode?: string,
 *   currencyName?: string,
 *   plugs?: string[],
 *   voltageV?: number,
 *   drivingSide?: string,
 *   emergency?: EmergencyNumber[],
 *   officialLanguages?: string[],
 *   callingCode?: string,
 *   lat?: number,
 * }} CountryFacts
 */
/**
 * What the build learned about itself, for the gate to inspect. None of it is
 * written to the artifact; it exists so `assertFactsSane` can refuse things a
 * finished record cannot show — a plug field withheld because the only value
 * upstream carried was a Wikipedia article, a language field withheld because
 * every statement upstream had was scoped to one territory, or a hand-verified
 * override that upstream has since made redundant.
 * @typedef {{
 *   soleDroppedArticlePlugs: string[],
 *   soleDroppedLanguages: string[],
 *   scopedLanguages: string[],
 *   curatedFired: string[],
 *   curatedStale: string[],
 *   withheld: Record<string, string[]>,
 * }} Diagnostics
 */
/**
 * @typedef {{ countries: Record<string, CountryFacts>, diagnostics: Diagnostics }} BuiltFacts
 */

// ---------------------------------------------------------------------------
// Pure parse
// ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV, because the endpoint is asked for `text/csv`.
 *
 * Hand-written rather than added as a dependency, for the same reason
 * ingest-cities.mjs walks a ZIP container by hand: every ingest in this repo
 * runs on Node built-ins alone and the nightly workflow has no `npm ci` step
 * as a result.
 *
 * Quoted fields matter here specifically, not theoretically: a P37 language
 * label ("Norwegian Bokmål, Nynorsk") and a P498 currency name both carry
 * commas, and a naive `split(',')` would shift every later column left by one
 * — which reads as a reshaped feed rather than as a parse bug, and is exactly
 * the class of silent corruption the gate cannot attribute.
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  let started = false;
  const pushField = () => { row.push(field); field = ''; started = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && !started) { quoted = true; started = true; continue; }
    if (char === ',') { pushField(); continue; }
    if (char === '\r') continue; // CRLF and bare CR both end the record on the \n
    if (char === '\n') { pushRow(); continue; }
    field += char;
    started = true;
  }
  // A trailing newline leaves nothing pending; anything else is a final record.
  if (field !== '' || row.length > 0) pushRow();
  return rows;
}

/**
 * A CSV result set as row objects keyed by the header line.
 *
 * A response with a header and no data rows is a legitimately empty answer and
 * returns `[]`. A response with NO header at all is not: the SPARQL endpoint
 * always emits one, so its absence means the body is an error page, a
 * rate-limit notice or a truncation, and reading that as "Wikidata knows
 * nothing" is the Task 7 shape. It throws, which demotes the property and
 * carries the previous values forward rather than deleting them.
 */
export function parseBindings(text, expectedColumns) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('empty response body — the endpoint answered with no CSV header at all');
  }
  const header = rows[0].map((name) => name.trim());
  for (const column of expectedColumns ?? []) {
    if (!header.includes(column)) {
      throw new Error(
        `response has no "${column}" column (got ${header.join(', ') || '<nothing>'}) — ` +
        `the query or the endpoint's output format has changed, which is not an empty answer`
      );
    }
  }
  /** @type {Row[]} */
  const out = [];
  for (const cells of rows.slice(1)) {
    if (cells.length === 1 && cells[0] === '') continue; // blank line
    /** @type {Row} */
    const record = {};
    for (const [index, name] of header.entries()) record[name] = cells[index] ?? '';
    out.push(record);
  }
  return out;
}

/** `Q60740126` out of `http://www.wikidata.org/entity/Q60740126`, or out of itself. */
export function entityId(value) {
  const text = String(value ?? '').trim();
  const match = /(Q[1-9][0-9]*)$/.exec(text);
  return match ? match[1] : '';
}

/** Whitespace-collapsed, trimmed text. Everything upstream goes through this. */
const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Rows bucketed by their `country` column, which every query selects. */
export function groupByCountry(rows) {
  /** @type {Map<string, Row[]>} */
  const grouped = new Map();
  for (const row of rows ?? []) {
    const code = collapse(row.country);
    if (code === '') continue;
    const bucket = grouped.get(code);
    if (bucket) bucket.push(row);
    else grouped.set(code, [row]);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Pure build
// ---------------------------------------------------------------------------

/**
 * The standard -> letter table. LANDMINE 3.
 *
 * P2853 does not return letters. It returns technical standards — `Europlug`,
 * `Schuko`, `BS 1363`, `NEMA 1-15`, `AS/NZS 3112`, `IEC 60906-1`, `SN 441011`
 * and the bare `Type E`/`H`/`K`/`L` items — and Investigation 3 measured the
 * distinct value set across all 246 countries at exactly 14 items, one of
 * which is a *Wikipedia article* (see `DROPPED_PLUG_ITEMS`). Small enough to
 * audit by hand, which is the whole reason this is a table and not a regex.
 *
 * ANY unrecognised standard withholds the WHOLE plug field for that country.
 * It is never passed through and never guessed at: "Peru uses type A/B/C
 * plugs" is checkable, and "Peru uses type IEC-60906-1 plugs" is a sentence no
 * traveller can act on.
 *
 * TWELVE rows for the thirteen standards the shipping query MEASURED on
 * 2026-08-27 by the shipping query (Task 25, not the design prototype). That
 * measurement is the whole distinct P2853 label set across
 * the 246 shard countries, counts attached:
 *
 *   Europlug 135, Schuko 75, BS 1363 55, NEMA 1-15 54, NEMA 5-15 46,
 *   Type E 40, AS/NZS 3112 21, BS 546 15, Type K 9, Type L 9, SN 441011 6,
 *   Type H 2, IEC 60906-1 2  — plus the Wikipedia article at 39
 *   (`DROPPED_PLUG_ITEMS`), which is the fourteenth distinct value.
 *
 * Two changes against Task 24's provisional table, both forced by that run.
 * `Type D` and `Type M` are GONE: upstream uses neither item, so both rows
 * were dead code that could only ever have fired on a value nobody has seen.
 *
 * `BS 546` is measured, is the thirteenth standard, and is DELIBERATELY NOT
 * GIVEN A ROW. One Wikidata item covers both of its sizes — the 5 A variant
 * is IEC type D and the 15 A variant is type M — and the statement carries
 * nothing that separates them. Guessing D would publish "South Africa uses
 * type C/D/N" when South Africa's round-pin sockets are the 15 A type M, and
 * a traveller who buys a type D adapter on that sentence finds it does not
 * fit. Measured cost of refusing instead: 15 countries withhold their plug
 * field — MO, BT, MZ, PK, IL, PS, ZA, IN, BW, LK, NP, SZ, NG, NA, LS (SZ and
 * LS carry BS 546 alone, so they would have been withheld by any rule). Those
 * countries say so, per field, through the gap note. Recorded in
 * data/country-facts-report.md's "Not derivable" section so it is not
 * re-litigated as an oversight.
 *
 * A row can only ever RECOGNISE a standard, each letter below is hand-checked
 * against IEC 60083, and a standard with no row still withholds — which is why
 * an unmappable standard costs coverage but can never cost correctness.
 */
export const PLUG_LETTERS = {
  'NEMA 1-15': 'A',
  'NEMA 5-15': 'B',
  Europlug: 'C',
  'Type E': 'E',
  Schuko: 'F',
  'BS 1363': 'G',
  'Type H': 'H',
  'AS/NZS 3112': 'I',
  'SN 441011': 'J',
  'Type K': 'K',
  'Type L': 'L',
  'IEC 60906-1': 'N',
};

/** Every letter the table can emit — the gate's allowlist, derived not restated. */
export const PLUG_LETTER_SET = new Set(Object.values(PLUG_LETTERS));

/**
 * Q60740126 is `AC power plugs and sockets: British and related types` — a
 * Wikipedia ARTICLE used as a P2853 value by 39 countries. It names no single
 * standard, so it maps to no letter.
 *
 * Measured zero countries have it as their SOLE value — re-measured against
 * the live endpoint by the shipping query on 2026-08-27, still zero, across
 * all 39 countries that carry it — which is what makes dropping it by explicit
 * id lossless rather than a silent coverage cut. That
 * measurement is an assumption about live upstream data, so it is enforced
 * rather than trusted: `buildFacts` records any country whose plug field was
 * withheld only because this article was all it had, and `assertFactsSane`
 * refuses to write when that list is non-empty. A future upstream edit that
 * breaks the assumption fails the nightly build instead of quietly costing 39
 * countries their sockets tip.
 */
export const DROPPED_PLUG_ITEMS = new Set(['Q60740126']);

/**
 * P37 values that are not a language a traveller could be told to learn.
 *
 * FOUR ids, and each is here because the FULL universe was measured, not
 * because one country looked odd. Re-measured 2026-08-27 across all 246 codes:
 * 451 P37 rows over 243 countries, 215 distinct items, and the distinct set of
 * `P31` classes those items carry is 42 values long — small enough to read
 * end to end, which is how this list was closed rather than guessed at.
 *
 * - `Q1339026` `languages of Guinea` — a META-ITEM, an article-shaped
 *   container about a country's languages, used by GN alone. It is the only
 *   item in the universe whose class is `languages of a country` (Q55958305).
 *   Rendered by `languageTip` it reads "languages of Guinea is the official
 *   language - download an offline translation pack", which is design risk 2
 *   ("a template renders a true fact into a false sentence") in real data.
 * - `Q25167` `Bokmål` and `Q25164` `Nynorsk` — the two items in the universe
 *   whose class is `målform` (Q14860523), the Norwegian word for a WRITTEN
 *   FORM of a language. Both are written standards OF Norwegian, which Norway
 *   also lists separately, so publishing them made NO read "Bokmål, Norwegian,
 *   Nynorsk and Sámi are official languages" — a list naming one language
 *   three times. Dropped, Norway reads "Norwegian and Sámi", which is what its
 *   Language Act says.
 * - `Q2530387` `Taglish` — the only item in the universe whose class is
 *   `code-switching` (Q255615). It is the Tagalog/English register Manila
 *   speaks, not a language anybody publishes a translation pack for, and its
 *   own P37 statement is qualified `nature of statement: de facto`.
 *
 * BY CLASS WOULD HAVE BEEN WRONG, and the measurement is why this is an id
 * list rather than the class filter it looks like it wants to be. `register`
 * (Q286576) sounds like exactly the right thing to exclude and it is the class
 * of `Hindi`, `Urdu` and `Tajik`; `language family` is the class of `Greek`,
 * `Albanian` and `Sámi`; `technical standard` is the class of
 * `Standard Chinese`; `academic discipline` is the class of `Māori`. A class
 * rule would have cost IN, PK, TJ, GR, AL, NO, SG, HK, MO and NZ real
 * languages to catch three items. Only `målform`, `code-switching` and
 * `languages of a country` are clean, and between them they contain exactly
 * the four ids above.
 *
 * By id and not by label, for `DROPPED_PLUG_ITEMS`'s reason: an upstream label
 * edit must not silently re-admit one. Measured zero countries carry ONLY
 * dropped items, and - exactly as for the plug article - that assumption is
 * enforced rather than trusted: `buildFacts` records any country withheld only
 * because of this, and `assertFactsSane` refuses to write when that list is
 * non-empty. GN keeps French, NO keeps Norwegian and Sámi, PH keeps English
 * and Filipino.
 */
export const DROPPED_LANGUAGE_ITEMS = new Set(['Q1339026', 'Q25164', 'Q25167', 'Q2530387']);

/** Emergency numbers are two to six digits. LANDMINE 4's shape check. */
const EMERGENCY_NUMBER = /^[0-9]{2,6}$/;

/**
 * P366 ("has use") qualifier labels, normalised to the small vocabulary the
 * templates in Task 26 can render. An unrecognised role is dropped rather than
 * passed through, which pushes its number onto the single-number path or into
 * a withhold — never into a sentence naming a role nobody checked.
 */
export const EMERGENCY_ROLES = {
  police: 'police',
  'law enforcement': 'police',
  'police force': 'police',
  'fire department': 'fire',
  'fire brigade': 'fire',
  firefighting: 'fire',
  'fire and rescue service': 'fire',
  ambulance: 'ambulance',
  'emergency medical services': 'ambulance',
  'emergency medical service': 'ambulance',
  'emergency medical technician': 'ambulance',
  'coast guard': 'coastguard',
  'search and rescue': 'rescue',
  'mountain rescue': 'rescue',
  'emergency service': 'emergency',
  'emergency telephone number': 'emergency',
};

/** Render order, so a rebuild with no data change is byte-identical. */
const ROLE_ORDER = ['police', 'fire', 'ambulance', 'rescue', 'coastguard', 'emergency'];

/** Every role token the table can emit — the gate's allowlist, derived not restated. */
export const EMERGENCY_ROLE_SET = new Set(Object.values(EMERGENCY_ROLES));

/** Mains voltage band. LANDMINE 1: outside this is industrial, not domestic. */
const MIN_VOLTAGE_V = 100;
const MAX_VOLTAGE_V = 260;
/** Genuine dual-voltage countries exist (BO 230/115, BR 220/127); triples do not. */
const MAX_DISTINCT_VOLTAGES = 2;
/** Bolivia's P37 lists 37 languages, so this is a reshape ceiling, not a taste one. */
const MAX_LANGUAGES = 40;
const MAX_PLUGS = 8;
const MAX_EMERGENCY_ENTRIES = 8;
/** Longest any single upstream label may be before it reads as a leaked blob. */
const MAX_TEXT_CHARS = 80;

/**
 * The country's English name, from the item's own `rdfs:label`.
 *
 * The name a traveller reads in "We don't have Peru-specific guidance..." and
 * in "Universal power adapter (Peru uses type A/B/C plugs, 220V)". Measured
 * 2026-08-27 across all 246 codes: 246 rows, one per country, none blank, none
 * multi-valued, none over 80 characters and none a bare Q-id - which is what
 * makes the floor in `MIN_FIELD_COVERAGE` a tight one rather than a hopeful
 * one.
 *
 * Withholds on more than one distinct value rather than picking, because two
 * names for one ISO code means two items carry that code and the join has
 * stopped being about one country; and withholds over `MAX_TEXT_CHARS` rather
 * than letting the gate abort, because one strange upstream label must cost
 * that country its name, not cost the other 245 their nightly refresh. (The
 * gate still refuses a blob that reaches a record any OTHER way - through
 * carry-forward from an artifact written before this rule existed, or through
 * a typo in a curated row.)
 *
 * The longest measured names are `South Georgia and the South Sandwich
 * Islands` (44) and `Saint Helena, Ascension and Tristan da Cunha` (44), so
 * the 80-character ceiling has room for a real name and none for a sentence.
 */
export function pickName(rows) {
  const names = [...new Set((rows ?? []).map((row) => collapse(row.value)).filter((name) => name !== ''))];
  if (names.length !== 1) return null;
  return names[0].length > MAX_TEXT_CHARS ? null : names[0];
}

/**
 * The one currency a traveller transacts in. LANDMINE 2.
 *
 * The ISO code sits on the wrong item for composite states: NL's P297 is on
 * Q29999 "Kingdom of the Netherlands", so its P38 yields EUR/USD/AWG/XCG and a
 * naive pick gives `getCountryProfile("NL").currency === "AWG"` — worse than
 * today's admitted USD placeholder, because it looks researched. FR yields
 * EUR/XPF, MO yields HKD/MOP and ZW yields thirteen.
 *
 * Two rules, in this order. Keep only `/^[A-Z]{3}$/` values, which rescues CZ:
 * its P498 carries both `CZK` and `203`, Czechia's ISO *numeric* code leaking
 * into an alphabetic field. Then, if more than one survives, WITHHOLD — which
 * is what stops PL's `PLN`/`PLZ` pair, the pre-1995 zloty being still
 * ISO-shaped and still truthy, from resolving by coin flip. `CURATED_FACTS`
 * supplies a hand-verified answer for the five that matter.
 *
 * The name is taken verbatim (whitespace-collapsed) and a blank one withholds
 * the pair: "Prices are in (PEN)" is not a sentence, and the honest-gap rule
 * says absent rather than partial.
 */
export function pickCurrency(rows) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const row of rows ?? []) {
    const code = collapse(row.code);
    if (!/^[A-Z]{3}$/.test(code)) continue;
    if (!seen.has(code)) seen.set(code, collapse(row.name));
  }
  if (seen.size !== 1) return null;
  const [[currencyCode, currencyName]] = [...seen.entries()];
  if (currencyName === '') return null;
  return { currencyCode, currencyName };
}

/**
 * Domestic mains voltage. LANDMINE 1.
 *
 * 12 of 246 countries are multi-valued and two of those include industrial
 * three-phase supply: BZ carries 550/220 and FR carries 400/230. A `SAMPLE()`
 * has a coin-flip chance of publishing "Belize runs at 550 V", and a traveller
 * who believes it buys the wrong adapter.
 *
 * Rule: EVERY raw value must fall inside 100-260 V and at most two distinct
 * values may survive; otherwise withhold the field entirely. That passes the
 * genuine dual-voltage countries (BO 230/115, BR 220/127, ID 230/127,
 * MA 220/127) and refuses the industrial ones. Of a surviving pair the HIGHER
 * is published, because it is the figure an adapter has to tolerate and the
 * one every one of those four countries actually distributes at scale.
 */
export function pickVoltage(rows) {
  const raw = (rows ?? []).map((row) => Number.parseFloat(collapse(row.value)));
  if (raw.length === 0) return null;
  if (raw.some((value) => !Number.isFinite(value) || value < MIN_VOLTAGE_V || value > MAX_VOLTAGE_V)) {
    return null;
  }
  const distinct = [...new Set(raw)];
  if (distinct.length > MAX_DISTINCT_VOLTAGES) return null;
  return Math.max(...distinct);
}

/**
 * Plug letters. LANDMINE 3 — see `PLUG_LETTERS` and `DROPPED_PLUG_ITEMS`.
 *
 * Returns the letters plus the one thing a finished record cannot show: that
 * the field is absent only because the Wikipedia-article value was everything
 * this country had. That flag is a gate input, not an artifact field.
 */
export function pickPlugs(rows) {
  const all = rows ?? [];
  const kept = all.filter((row) => !DROPPED_PLUG_ITEMS.has(entityId(row.item)));
  if (all.length > 0 && kept.length === 0) {
    return { letters: null, soleDroppedArticle: true };
  }
  const letters = new Set();
  for (const row of kept) {
    const letter = PLUG_LETTERS[collapse(row.itemLabel)];
    // Unrecognised standard: withhold the WHOLE field, never a partial set.
    // A country shown "type A" when it is really "A and G" sends a traveller
    // with the wrong adapter just as surely as showing nothing does not.
    if (!letter) return { letters: null, soleDroppedArticle: false };
    letters.add(letter);
  }
  if (letters.size === 0) return { letters: null, soleDroppedArticle: false };
  return { letters: [...letters].sort(), soleDroppedArticle: false };
}

/**
 * Emergency numbers with their roles. LANDMINE 4.
 *
 * P2852 values are Q-items, not literals — the number lives in the item's
 * `rdfs:label`. Cross-checked: Q11185210 serves as both Japan's coast-guard
 * number and Switzerland's fire number, which is only consistent if the item
 * is "118", and it is. So every label is validated against `/^[0-9]{2,6}$/`
 * before it can be published.
 *
 * Publish only when the statements carry P366 roles (155 countries measured)
 * or when there is exactly one number (67 measured). Several numbers with no
 * roles is not an answer — "Emergency numbers: 112, 118" tells a traveller
 * nothing about which to dial — so it withholds.
 */
export function pickEmergency(rows) {
  /** @type {EmergencyNumber[]} */
  const valid = [];
  for (const row of rows ?? []) {
    const number = collapse(row.number);
    if (!EMERGENCY_NUMBER.test(number)) continue;
    valid.push({ number, role: EMERGENCY_ROLES[collapse(row.role).toLowerCase()] ?? null });
  }
  if (valid.length === 0) return null;

  const roled = valid.filter((entry) => entry.role !== null);
  if (roled.length > 0) {
    /** @type {Map<string, EmergencyNumber>} */
    const unique = new Map();
    for (const entry of roled) {
      const key = `${entry.role}:${entry.number}`;
      if (!unique.has(key)) unique.set(key, entry);
    }
    const ordered = [...unique.values()].sort(
      (a, b) =>
        ROLE_ORDER.indexOf(String(a.role)) - ROLE_ORDER.indexOf(String(b.role)) ||
        a.number.localeCompare(b.number)
    );
    // A country with nine distinct emergency roles is a reshaped query, not a
    // country. Withhold rather than truncate: truncation is silent data loss,
    // and rather than abort, because one strange country must not cost the
    // other 245 their nightly refresh.
    return ordered.length > MAX_EMERGENCY_ENTRIES ? null : ordered;
  }

  const numbers = [...new Set(valid.map((entry) => entry.number))];
  if (numbers.length !== 1) return null;
  return [{ number: numbers[0], role: null }];
}

/** P1622, as `left` or `right`. Anything else withholds. */
export function pickDrivingSide(rows) {
  const sides = new Set();
  for (const row of rows ?? []) {
    const label = collapse(row.value).toLowerCase();
    if (label.includes('left')) sides.add('left');
    else if (label.includes('right')) sides.add('right');
    else return null;
  }
  if (sides.size !== 1) return null;
  return [...sides][0];
}

/** P474, as `+` and one to four digits. Multi-valued or reshaped withholds. */
export function pickCallingCode(rows) {
  const codes = new Set((rows ?? []).map((row) => collapse(row.value)).filter((code) => code !== ''));
  if (codes.size !== 1) return null;
  const code = [...codes][0];
  return /^\+[0-9]{1,4}$/.test(code) ? code : null;
}

/** A `?scoped` cell, which SPARQL renders as `true`/`false`. */
const isTrue = (value) => collapse(value).toLowerCase() === 'true';

/**
 * P37 English labels, deduplicated and sorted so a quiet rebuild is
 * byte-identical, with two rules ahead of that: territorial scope, then
 * `DROPPED_LANGUAGE_ITEMS` by id.
 *
 * THE TERRITORIAL RULE IS THE ONE THAT MATTERS. `?scoped` is true when the
 * statement carries a `P518 applies to part` qualifier — upstream saying, on
 * the statement itself, that this is NOT a claim about the whole country. The
 * United States is the case that forces it: every one of its truthy P37
 * statements is scoped to a territory (Carolinian and Chamorro to the Northern
 * Marianas, Hawaiian to Hawaii, Samoan to American Samoa, Spanish to Puerto
 * Rico), and English's is DEPRECATED rank, so an unfiltered query published
 * "Carolinian, Chamorro, Hawaiian, Samoan and Spanish are official languages —
 * download an offline translation pack before you go" about the United States.
 *
 * ANY scoped statement withholds the WHOLE field, which is `pickPlugs`'s BS 546
 * rule applied to the same kind of ambiguity, and the alternative was measured
 * before it was rejected. Dropping only the scoped statements and publishing
 * the remainder leaves AZ with `Azerbaijani Sign Language` ALONE — Azerbaijani
 * itself is the scoped one, because upstream used `applies to part` to name a
 * variety rather than a territory — and `languageTip` renders a one-item list
 * as "X is the official language". Trading a false sentence about the United
 * States for a false sentence about Azerbaijan is not a fix. Whole-field, the
 * gap note names the field and nobody is told anything untrue.
 *
 * Measured 2026-08-27 across all 246 codes, the whole cost is SIX countries:
 * AF, AZ, BE, BQ, PW, US. TWO OF THE SIX ARE RESCUED BY HAND rather than left
 * withheld — see `CURATED_FACTS`' BE and AZ rows. The rule is right and its
 * answer is wrong for those two, because their P518 values name a part of the
 * country (Belgium's language regions) or a variety of the language (Standard
 * Azerbaijani) rather than a territory the national claim excludes. Telling
 * those apart means judging what the qualifier's VALUE is, which is a question
 * about sovereignty rather than a shape a picker can check, so it is answered
 * once by a human in a row that a test asserts still FIRES. The four that stay
 * withheld stay withheld. `P1001 applies to jurisdiction` is checked for by
 * name in the query comment and is used by ZERO statements in this universe,
 * so it deliberately gets no rule here — a rule that can only fire on a value
 * nobody has seen is the dead `Type D`/`Type M` row `PLUG_LETTERS` already
 * had to delete.
 *
 * Shaped like `pickPlugs`: it returns the names plus the two things a finished
 * record cannot show — that the field is absent because every statement was
 * territorially scoped, or because a dropped id was everything this country
 * had. Both are gate and report inputs, not artifact fields.
 */
export function pickLanguages(rows) {
  const all = rows ?? [];
  const kept = all.filter((row) => !DROPPED_LANGUAGE_ITEMS.has(entityId(row.item)));
  /**
   * BOTH FLAGS ARE COMPUTED BEFORE EITHER IS RETURNED, and that is a fix
   * rather than a style. The scope test used to run first and return early, so
   * a country that was scoped AND had nothing but dropped ids reported only
   * the scope — and `assertFactsSane` REFUSES THE WRITE on `soleDropped`,
   * because a country whose whole language field rests on `DROPPED_LANGUAGE_ITEMS`
   * means that list has outgrown the measurement it was made from. Under the
   * early return that gate was unreachable for exactly the countries most
   * likely to trip it, and the run would have passed quietly.
   *
   * The WITHHOLD precedence is unchanged: a scoped statement still withholds
   * the whole field, and `territoriallyScoped` is still what the report reads.
   * What changed is that the two diagnostics are now independent facts about
   * the rows rather than one being a side effect of which branch ran first.
   *
   * Measured against the shipping query on 2026-08-27: zero countries are in
   * both states, so this changes no record in the artifact. It changes what
   * the gate can see the day one is.
   */
  const soleDropped = all.length > 0 && kept.length === 0;
  const territoriallyScoped = all.some((row) => isTrue(row.scoped));
  if (territoriallyScoped) return { names: null, soleDropped, territoriallyScoped: true };
  if (soleDropped) return { names: null, soleDropped: true, territoriallyScoped: false };
  const names = [...new Set(kept.map((row) => collapse(row.value)).filter((name) => name !== ''))].sort();
  if (names.length === 0) return { names: null, soleDropped: false, territoriallyScoped: false };
  return {
    names: names.length > MAX_LANGUAGES ? null : names,
    soleDropped: false,
    territoriallyScoped: false,
  };
}

/**
 * P625 latitude. Never rendered — it is the SOURCE OF TRUTH for which
 * hemisphere a country is in.
 *
 * lib/countries.ts's `SOUTHERN` set is derived from this field and reconciled
 * against it in BOTH directions by lib/countryFacts.test.ts: a code listed
 * with a non-negative centroid fails, and a code with a negative centroid that
 * is not listed fails too. The second half is the one that was missing — the
 * check used to be one-directional, and 25 southern countries were quietly
 * told a June trip was summer.
 *
 * `SOUTHERN` is not a live lookup because lib/countries.ts is a zero-import
 * leaf and this artifact is 70 KB; see the block comment on `SOUTHERN` itself.
 */
export function pickLatitude(rows) {
  const values = [...new Set((rows ?? []).map((row) => Number.parseFloat(collapse(row.lat))))];
  if (values.length !== 1) return null;
  const lat = values[0];
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null;
}

/**
 * The nine FACTS - the things this ingest learned about travelling somewhere.
 *
 * `factCount` counts exactly these, and `factCount` is the unit every drift
 * check in this file speaks in: the 5% shrink band, the 10% growth band, the
 * one-field-per-country loss grace, "this country lost every fact", and the
 * rule that a country with nothing to say is omitted rather than written as
 * `{}`. All of those are calibrated against a per-country ceiling of nine.
 *
 * `name` is NOT here, and that is the load-bearing half of adding it. A name
 * is who the record is about, not something we learned about going there - so
 * counting it would have moved the committed baseline by 246 in a single
 * night: an 11.7% jump against 2,098 facts, over `MAX_GROWTH_RATIO`, which
 * would have meant loosening a calibrated gate to admit a schema change. Left
 * out, every one of those bands keeps the meaning it was measured with, and a
 * country carrying a name and nothing else still counts zero and is still
 * omitted - the neutral profile already says everything such a record could.
 */
export const FACT_FIELDS = [
  'currencyCode',
  'currencyName',
  'plugs',
  'voltageV',
  'drivingSide',
  'emergency',
  'officialLanguages',
  'callingCode',
  'lat',
];

/**
 * Every key a record may carry, in the order it carries them, so a rebuild
 * with no data change is byte-identical and the nightly workflow has nothing
 * to commit. Also the gate's known-field allowlist: a column the query starts
 * returning under a new name would otherwise land in the artifact unexamined,
 * and every shape rule - no empty strings, no sentinels, no bare Q-ids, no
 * blobs - walks this list rather than `FACT_FIELDS`, so the name is checked
 * exactly as hard as everything beside it.
 *
 * Identity first: a reader opening the artifact sees which country a record is
 * about before what it says.
 */
export const RECORD_FIELDS = ['name', ...FACT_FIELDS];

/**
 * The seven fields that reach a user, in the order the gap note names them.
 * `currencyName` rides with `currencyCode` and `lat` is never rendered, so
 * neither is here. `name` is not a field the gap note can report missing - it
 * is what the gap note calls the country.
 */
export const RENDERED_FIELDS = [
  'currencyCode',
  'plugs',
  'voltageV',
  'drivingSide',
  'emergency',
  'officialLanguages',
  'callingCode',
];

/** One record with its keys in `RECORD_FIELDS` order and its absent fields absent. */
function orderRecord(record) {
  /** @type {CountryFacts} */
  const ordered = {};
  for (const field of RECORD_FIELDS) {
    if (record[field] !== undefined) ordered[field] = record[field];
  }
  return ordered;
}

/** How many facts a record carries. The unit every drift check counts in. */
export function factCount(record) {
  let count = 0;
  for (const field of FACT_FIELDS) if (record?.[field] !== undefined) count++;
  return count;
}

/**
 * Which SPARQL query feeds which fields.
 *
 * The pairing is what makes per-property demotion possible: when one property
 * answers implausibly, exactly the fields it feeds are carried forward from
 * the previous artifact and everything else in the run proceeds normally.
 * `codes` feeds no fields — it establishes the country universe, and a run
 * without it has nothing to build at all.
 *
 * `batch` is how many country codes ride in one request's `VALUES` block, and
 * every value below is derived from one measured number rather than chosen:
 * the rows-per-answering-country density the shipping query returned on
 * 2026-08-27 by the shipping query over all 246 codes.
 *
 *   name     246 rows / 246 countries = 1.00   currency 268 / 244 = 1.10
 *   plugs    508 / 222 = 2.29                  voltage  234 / 222 = 1.05
 *   driving  247 / 246 = 1.00                  emergency 648 / 246 = 2.63
 *   languages 451 / 243 = 1.86                 callingCode 248 / 242 = 1.02
 *   coordinate 246 / 246 = 1.00
 *
 * The rule, applied uniformly: the largest size in {50, 100, 150, 200} whose
 * measured density keeps ONE request under 250 rows. That is roughly a tenth
 * of what the whole universe returns in a single request today, so upstream
 * would have to grow tenfold before any one request came near Blazegraph's own
 * 60-second ceiling — and a batch that does bail out costs a slice of one
 * property rather than the property, which is the granularity
 * `isPropertyAnswerPlausible` judges at.
 *
 * `codes` is unbatched: it is the country universe, its `VALUES` block IS the
 * batch key, and splitting the thing every other batch is cut from would be
 * circular.
 */
export const PROPERTIES = [
  { name: 'codes', property: 'P297', fields: [], columns: ['code'], batch: 246 },
  { name: 'name', property: 'rdfs:label', fields: ['name'], columns: ['country', 'value'], batch: 200 },
  { name: 'currency', property: 'P38/P498', fields: ['currencyCode', 'currencyName'], columns: ['country', 'code', 'name'], batch: 200 },
  { name: 'plugs', property: 'P2853', fields: ['plugs'], columns: ['country', 'item', 'itemLabel'], batch: 100 },
  { name: 'voltage', property: 'P2884', fields: ['voltageV'], columns: ['country', 'value'], batch: 200 },
  { name: 'drivingSide', property: 'P1622', fields: ['drivingSide'], columns: ['country', 'value'], batch: 200 },
  { name: 'emergency', property: 'P2852', fields: ['emergency'], columns: ['country', 'number', 'role'], batch: 50 },
  { name: 'languages', property: 'P37', fields: ['officialLanguages'], columns: ['country', 'item', 'value', 'scoped'], batch: 100 },
  { name: 'callingCode', property: 'P474', fields: ['callingCode'], columns: ['country', 'value'], batch: 200 },
  { name: 'coordinate', property: 'P625', fields: ['lat'], columns: ['country', 'lat'], batch: 200 },
];

/**
 * Every country's record, from one bag of rows per property.
 *
 * The country universe comes from the `codes` answer and nothing else. Codes
 * are trimmed but deliberately NOT uppercased: a feed that switched to
 * lowercase or to alpha-3 is a reshape the gate must see, and quietly
 * normalising it away is how a reshape reaches production looking healthy.
 *
 * A country that ends the build with zero facts is OMITTED rather than written
 * as `{}`. lib/countryProfile.ts falls through to the neutral profile for a
 * country it has no facts for, which is already the honest default; an empty
 * record would be a second way of saying the same thing and the two would
 * drift. A record carrying ONLY a name is omitted by the same rule, because
 * `factCount` does not count the name - measured 2026-08-27, zero of the 246
 * are in that position, every one of them carrying at least four facts.
 */
export function buildFacts(byProperty) {
  const codes = [
    ...new Set((byProperty?.codes ?? []).map((row) => collapse(row.code)).filter((code) => code !== '')),
  ].sort();

  const grouped = {
    name: groupByCountry(byProperty?.name),
    currency: groupByCountry(byProperty?.currency),
    plugs: groupByCountry(byProperty?.plugs),
    voltage: groupByCountry(byProperty?.voltage),
    drivingSide: groupByCountry(byProperty?.drivingSide),
    emergency: groupByCountry(byProperty?.emergency),
    languages: groupByCountry(byProperty?.languages),
    callingCode: groupByCountry(byProperty?.callingCode),
    coordinate: groupByCountry(byProperty?.coordinate),
  };

  /**
   * Annotated, not inferred. An object literal populated only through computed
   * keys infers as `{}` under `allowJs`, which turns every `built.countries.CN`
   * in scripts/ingest-country-facts.test.ts into a hard `tsc --noEmit` error,
   * and the pre-merge gate is exactly `npx tsc --noEmit` then `npm test`. The
   * same fix scripts/enrich-cities.mjs already carries.
   * @type {Record<string, CountryFacts>}
   */
  const countries = {};
  /** @type {Diagnostics} */
  const diagnostics = {
    soleDroppedArticlePlugs: [],
    soleDroppedLanguages: [],
    scopedLanguages: [],
    curatedFired: [],
    curatedStale: [],
    withheld: { name: [], currency: [], plugs: [], voltage: [], emergency: [] },
  };

  for (const code of codes) {
    /** @type {CountryFacts} */
    const record = {};

    const nameRows = grouped.name.get(code) ?? [];
    const name = pickName(nameRows);
    if (name !== null) record.name = name;
    else if (nameRows.length > 0) diagnostics.withheld.name.push(code);

    const currencyRows = grouped.currency.get(code) ?? [];
    const currency = pickCurrency(currencyRows);
    if (currency) {
      record.currencyCode = currency.currencyCode;
      record.currencyName = currency.currencyName;
    } else if (currencyRows.length > 0) diagnostics.withheld.currency.push(code);

    const plugRows = grouped.plugs.get(code) ?? [];
    const plugs = pickPlugs(plugRows);
    if (plugs.letters) record.plugs = plugs.letters;
    else if (plugRows.length > 0) diagnostics.withheld.plugs.push(code);
    if (plugs.soleDroppedArticle) diagnostics.soleDroppedArticlePlugs.push(code);

    const voltageRows = grouped.voltage.get(code) ?? [];
    const voltage = pickVoltage(voltageRows);
    if (voltage !== null) record.voltageV = voltage;
    else if (voltageRows.length > 0) diagnostics.withheld.voltage.push(code);

    const drivingSide = pickDrivingSide(grouped.drivingSide.get(code) ?? []);
    if (drivingSide !== null) record.drivingSide = drivingSide;

    const emergencyRows = grouped.emergency.get(code) ?? [];
    const emergency = pickEmergency(emergencyRows);
    if (emergency !== null) record.emergency = emergency;
    else if (emergencyRows.length > 0) diagnostics.withheld.emergency.push(code);

    const languages = pickLanguages(grouped.languages.get(code) ?? []);
    if (languages.names) record.officialLanguages = languages.names;
    if (languages.soleDropped) diagnostics.soleDroppedLanguages.push(code);
    if (languages.territoriallyScoped) diagnostics.scopedLanguages.push(code);

    const callingCode = pickCallingCode(grouped.callingCode.get(code) ?? []);
    if (callingCode !== null) record.callingCode = callingCode;

    const lat = pickLatitude(grouped.coordinate.get(code) ?? []);
    if (lat !== null) record.lat = lat;

    if (factCount(record) > 0) countries[code] = orderRecord(record);
  }

  return { countries, diagnostics };
}

/**
 * Hand-verified values for fields the withhold rules refuse, with the upstream
 * shape that caused each withhold named in its comment.
 *
 * Design 3 shipped this table empty on the argument that withholding is honest
 * and sampling is not. Both halves of that are true and neither settles the
 * question: Poland with no currency at all reads as broken software, not as
 * restraint. A hand-verified value whose provenance is recorded is MORE honest
 * than silence, and it is not sampling — nothing here was chosen by a query.
 *
 * The `CURATED_HEROES` precedent (lib/countryImagery.ts) governs the rules: a
 * row is written only when a human verified it, and every row is asserted by a
 * test to actually FIRE. A row whose field upstream now supplies is stale, and
 * `assertFactsSane` refuses to write rather than letting it rot into silent
 * cruft. That deliberately reddens the nightly job on a GOOD upstream change,
 * which is the same trade `CN_CROSS_CHECK` makes below and for the same
 * reason: a human deleting one line is cheaper than a wrong answer nobody
 * noticed.
 */
export const CURATED_FACTS = {
  /** P297 sits on Q29999 "Kingdom of the Netherlands", so P38 yields EUR/USD/AWG/XCG. */
  NL: { currencyCode: 'EUR', currencyName: 'euro' },
  /**
   * P38 yields EUR/XPF (the CFP franc of the Pacific collectivities), and
   * P2884 yields 400/230 — 400 V being industrial three-phase supply.
   */
  FR: { currencyCode: 'EUR', currencyName: 'euro', voltageV: 230 },
  /** P498 yields PLN and PLZ, the pre-1995 zloty: still ISO-shaped, still truthy. */
  PL: { currencyCode: 'PLN', currencyName: 'złoty' },
  /**
   * P38 yields thirteen currencies. Measured 2026-08-27 by the shipping
   * query, they are EUR, CNY,
   * GBP, USD, JPY, AUD, ZWG, ZAR, ZWN, ZWR, ZWL, INR and ZWD — four of them
   * historical Zimbabwean dollars, so no rule that picks by shape can pick
   * correctly here. Zimbabwe's multi-currency regime makes USD
   * the unit a visitor is quoted in and pays in; ZWG, the 2024 gold-backed
   * unit, is neither obtainable abroad nor useful to a traveller. This is the
   * currency the money pivot and the cash-backup packing line are about, so it
   * is the traveller-facing one, and this comment is the record of that
   * judgement rather than a claim about legal tender.
   *
   * Re-examined at Task 25 against the live answer above rather than carried
   * forward on trust, because the value was an editorial call the design named
   * a row for without naming a value. Kept: USD is in the upstream set, it is
   * what a visitor is quoted and pays in, and the two alternatives a rule
   * could have reached for are both worse — ZWG is unobtainable abroad, and
   * "pick the one ISO-shaped value" is undefined when thirteen qualify. The
   * row still FIRES, which `applyCurated` records and `assertFactsSane`
   * enforces: the day Wikidata reduces ZW to one currency, this goes red
   * rather than rotting.
   */
  ZW: { currencyCode: 'USD', currencyName: 'United States dollar' },
  /** P38 yields HKD/MOP, because the item covers the wider administrative history. */
  MO: { currencyCode: 'MOP', currencyName: 'Macanese pataca' },
  /**
   * Every one of Belgium's three P37 statements is `applies to part`, so
   * `pickLanguages` withholds the whole field — correctly as a RULE, wrongly
   * as an ANSWER, and the difference is what this row records.
   *
   * Measured 2026-08-27 by the shipping query: 36 truthy statement rows over
   * exactly THREE distinct items — Dutch (Q7411), French (Q150) and German
   * (Q188) — and the P518 qualifier on each names a region or a municipality
   * INSIDE Belgium: Flanders, the Walloon Region, the Brussels-Capital
   * Region, the German-speaking Community, and the language-facility communes
   * (Welkenraedt, Mouscron, Comines-Warneton, Voeren, Linkebeek and the rest).
   *
   * That is the opposite of the United States shape the rule was written for.
   * There, the scope qualifier said "this language is official in a territory
   * and the country as a whole has no such claim". Here it says "this is
   * WHICH of the country's three national languages governs WHERE" — Article
   * 4 of the Belgian Constitution divides the country into four language
   * regions, so a per-region qualifier is how upstream encodes a fact that IS
   * national. Dutch, French and German is the constitutional trio; it is what
   * a Belgian passport is printed in and what `languageTip` should say.
   *
   * The rule stays whole-field, because it cannot tell those two shapes apart
   * without reading the qualifier's VALUE and deciding whether that value is
   * a part of the country or a territory beside it — a judgement about
   * sovereignty, not a shape a picker can check. So the judgement is made
   * here, by a human, once, with the upstream shape recorded beside it.
   */
  BE: { officialLanguages: ['Dutch', 'French', 'German'] },
  /**
   * Azerbaijan's withhold is the same rule and a third shape again: the P518
   * qualifier names neither a part of the country nor a territory beside it,
   * but a VARIETY of the language.
   *
   * Measured 2026-08-27: two truthy statements. Azerbaijani (Q9292) is
   * qualified `applies to part: Standard Azerbaijani` — upstream saying which
   * register is official, which is a refinement of a national claim rather
   * than a limit on it. Azerbaijani Sign Language (Q55698568) is unqualified.
   * `pickLanguages`'s own doc-comment already names why the remainder cannot
   * be published: it leaves the sign language ALONE, and `languageTip` renders
   * a one-item list as "Azerbaijani Sign Language is the official language".
   *
   * Article 21 of Azerbaijan's constitution makes Azerbaijani the state
   * language, singular. That is the value here. The sign language is
   * deliberately NOT included: it is recognised, it is not the language a
   * traveller needs a phrasebook for, and this field feeds a packing line
   * about offline translation packs.
   */
  AZ: { officialLanguages: ['Azerbaijani'] },
};

/**
 * Fill withheld fields from `CURATED_FACTS`, and notice when a row has gone
 * stale.
 *
 * Judged against the UPSTREAM build alone, deliberately: this runs before
 * carry-forward, so a demoted property restoring last night's values (which
 * already include yesterday's curated answer) cannot be mistaken for Wikidata
 * having fixed itself.
 */
export function applyCurated(built, curated = CURATED_FACTS) {
  for (const [code, overrides] of Object.entries(curated)) {
    for (const [field, value] of Object.entries(overrides)) {
      const record = built.countries[code];
      if (record && record[field] !== undefined) {
        built.diagnostics.curatedStale.push(`${code}.${field}`);
        continue;
      }
      const next = record ?? {};
      next[field] = value;
      built.countries[code] = orderRecord(next);
      built.diagnostics.curatedFired.push(`${code}.${field}`);
    }
  }
  /** @type {Record<string, CountryFacts>} */
  const sorted = {};
  for (const code of Object.keys(built.countries).sort()) sorted[code] = built.countries[code];
  built.countries = sorted;
  return built;
}

/**
 * How much of a property's previous coverage must come back before its answer
 * counts as an ANSWER rather than an outage.
 *
 * The middle of the hazard that throw/no-throw cannot see. Blazegraph returns
 * HTTP 200 with a partial result set when a property-path traversal bails out,
 * and "upstream request timeout" is a routine, expected outcome on these
 * queries — so a property that answers for a third of the countries it covered
 * yesterday has not told us those countries lost their currency. Judged
 * against previous coverage rather than against the country count, because the
 * country count says nothing: `plugs` legitimately covers 222 of 246.
 *
 * 0.8 is the value scripts/enrich-cities.mjs already calibrated for exactly
 * this question at batch scale, and it STAYS 0.8 — stated as a decision rather
 * than dressed up as a measurement. The first real build (2026-08-27) is one
 * run, and one run measures a level, not a variance: every property answered
 * its full expected coverage, so there is no night-to-night spread here to
 * calibrate against yet. What that run did establish is the shape this ratio
 * has to survive — ten independent property queries in 24 batched requests,
 * where a single batch bailing out fails its whole property (see
 * `fetchPropertyRows`) and arrives here as a zero, not as 80%.
 */
export const MIN_PROPERTY_ANSWER_RATIO = 0.8;

/**
 * Did this property ANSWER, or did it merely respond? On a first run there is
 * no previous coverage and nothing to lose, so any answer is accepted — and
 * the per-field coverage floors in the gate are what bound that run instead.
 */
export function isPropertyAnswerPlausible(answeredCountries, previouslyCoveredCountries) {
  if (previouslyCoveredCountries === 0) return true;
  return answeredCountries >= previouslyCoveredCountries * MIN_PROPERTY_ANSWER_RATIO;
}

/** How many countries in the previous artifact carried any of these fields. */
export function countPreviousCoverage(previous, fields) {
  if (!previous?.countries || fields.length === 0) return 0;
  let count = 0;
  for (const record of Object.values(previous.countries)) {
    if (fields.some((field) => record?.[field] !== undefined)) count++;
  }
  return count;
}

/** How many distinct countries a property's rows actually spoke about. */
export function countAnsweredCountries(rows) {
  return groupByCountry(rows).size;
}

/**
 * A demoted property's previous values, carried forward rather than deleted.
 *
 * The whole point of demotion: an outage costs one night's freshness, never a
 * field. The demoted property's partial answer is discarded outright rather
 * than merged, because a result set we have already judged untrustworthy is
 * not a better source than the last state that passed every gate — mixing the
 * two would produce a record no run ever verified as a whole.
 *
 * A country the previous artifact never had stays absent: carry-forward
 * restores, it does not invent.
 */
export function carryForwardFields(built, previous, fields) {
  if (!previous?.countries || fields.length === 0) return built;
  for (const [code, record] of Object.entries(built.countries)) {
    for (const field of fields) delete record[field];
    built.countries[code] = record;
  }
  for (const [code, previousRecord] of Object.entries(previous.countries)) {
    const carried = fields.filter((field) => previousRecord?.[field] !== undefined);
    if (carried.length === 0) continue;
    const record = built.countries[code] ?? {};
    for (const field of carried) record[field] = previousRecord[field];
    built.countries[code] = record;
  }
  /** @type {Record<string, CountryFacts>} */
  const sorted = {};
  for (const code of Object.keys(built.countries).sort()) {
    const record = orderRecord(built.countries[code]);
    // A country left with nothing after a demoted property was stripped is
    // omitted, exactly as `buildFacts` omits it — otherwise a demotion would
    // be the one path that writes `{}`.
    if (factCount(record) > 0) sorted[code] = record;
  }
  built.countries = sorted;
  return built;
}

// ---------------------------------------------------------------------------
// The build gate
// ---------------------------------------------------------------------------

/**
 * 246, measured 2026-08-27 against the app's exact shard set and confirmed by
 * the first real build the same day.
 *
 * A two-sided band, never a bare floor. `previous === null` on a first run,
 * which is precisely when every drift check below early-returns — so on that
 * run this band is the ONLY bound in play, and a floor cannot bound a run that
 * has nothing to compare against. A floor of 200 would let a first run write
 * 201 countries and then baseline every later run against 201.
 *
 * The two sets are RECONCILED, measured 2026-08-27 by the shipping query. The
 * app's 246 shard codes are a STRICT SUBSET of the 259 codes Wikidata carries
 * a truthy P297 for: nothing the app ships a shard for is unknown upstream,
 * and the 13 extras are AC, AN, AQ, BV, CP, CQ, DD, DG, HM, PC, TA, UM, YU.
 * `COUNTRY_CODES` bounds the query to the 246, so the answer is the
 * intersection and this band is measuring the same thing on both sides.
 *
 * The first real build returned exactly 246. The tolerance is for the handful
 * of items whose P297 Wikidata adds or retires; a code upstream stops carrying
 * drops out of `universe` in `run()` and shows up here rather than silently.
 */
export const EXPECTED_COUNTRIES = 246;
const COUNTRY_TOLERANCE = 3;

/**
 * Countries that must carry at least one fact, chosen because a count cannot
 * see them: CN is the reproduction gate below, PE is the design's acceptance
 * case, JP is the fixture lib/tripShared.test.ts moves off once its currency
 * stops being a placeholder, and CH is the fixture ingest-cities.mjs uses for
 * a destination the population ranking nearly missed.
 */
export const REQUIRED_FACT_COUNTRIES = ['CN', 'PE', 'JP', 'CH'];

/**
 * The positive fixture for the honest-gap rule, and the one check that can
 * tell "we degraded to silence" from "we degraded to fabrication".
 *
 * Saint Helena is the joint-thinnest record the shipping query produced on
 * 2026-08-27 — 4 of 9 fields, tied with IO, ahead of CC, CX, SJ and TF at 5,
 * all uninhabited or near-uninhabited dependencies — and it is the design's
 * own gap-note example: "We also have no emergency numbers or plug types for
 * Saint Helena." (Measured, it has emergency 999 but no currency, plugs,
 * voltage or dialling code; its P474 answers both +290 and +247, which
 * `pickCallingCode` withholds.) It must be PRESENT, and it must still be
 * MISSING at least one rendered field. A run where SH has everything means the
 * withhold rules stopped withholding, which no coverage floor can see because
 * floors only ever count downwards.
 */
export const REQUIRED_SPARSE_COUNTRY = 'SH';

/**
 * The reproduction gate. China's answer is known independently of this ingest
 * — a human wrote `Universal power adapter (China uses type A/C/I plugs,
 * 220V)` at lib/packing.ts:64 without ever seeing Wikidata — so CN is the one
 * country where a wrong upstream edit is detectable rather than merely
 * plausible.
 *
 * This deliberately reddens the nightly job when Wikidata's China record
 * changes. Accepted: a silent degradation of the one country known to be right
 * is strictly worse than a build that stops and asks.
 */
export const CN_CROSS_CHECK = {
  currencyCode: 'CNY',
  plugs: ['A', 'C', 'I'],
  voltageV: 220,
  drivingSide: 'right',
  callingCode: '+86',
  emergencyNumbers: ['110', '119', '120'],
};

/**
 * The two names this ingest is checked against, measured 2026-08-27 by the
 * shipping query.
 *
 * CN because it is the reproduction country - every other cross-check in this
 * file is anchored on it - and PE because it is the design's acceptance case
 * and the country whose missing name was the blocker this field exists to
 * clear: `getCountry("PE").name` is `"PE"`, so before this the gap note read
 * "We don't have PE-specific guidance..." for 222 of 246 countries.
 *
 * `People's Republic of China` is Wikidata's own English label for the item
 * whose P297 is `CN` (Q148), carried verbatim rather than shortened, because
 * shortening it here would be this ingest editing its source. The traveller
 * never reads it: `lib/countries.ts` carries the hand-tuned `China`, and
 * `getCountryName` in lib/countryFacts.ts prefers the hand-tuned name over the
 * ingested one for all 24 curated countries - which is why the reproduction
 * gate on `Universal power adapter (China uses type A/C/I plugs, 220V)` is
 * unaffected by what this line says.
 *
 * Pinned exactly, so an upstream rename reddens the nightly job rather than
 * quietly changing what a traveller reads. That is the same trade
 * `CN_CROSS_CHECK` makes.
 */
export const REQUIRED_NAMES = {
  CN: "People's Republic of China",
  PE: 'Peru',
};

/**
 * Per-field floors, because 246 records can all survive while one field goes
 * null everywhere — the `assertExtractQualitySane` lesson, where a healthy
 * record count hid every description being replaced by a stub.
 *
 * MEASURED. Every floor below is the SHIPPING query's own post-withhold
 * coverage on 2026-08-27 — Task 25's run, not the design prototype's — less
 * exactly ten countries of headroom, one rule,
 * applied uniformly, so a reader can recompute each number rather than trust
 * it. Measured coverage, out of 246:
 *
 *   currencyCode 239   currencyName 239   plugs 207   voltageV 221
 *   drivingSide  245   emergency    221   officialLanguages 243
 *   callingCode  237   lat 246
 *
 * Three of these move against Task 24's provisional guesses and each is a
 * finding rather than a rounding:
 *
 * - `currencyCode` 234 -> 239. The design's prototype filtered labels to
 *   `en` only, and Q4916 (the euro) now has no English label at all — its
 *   label lives under `mul`. See `labelWithMulFallback`.
 * - `drivingSide` 245 and `lat` 246 close the design's unexplained 246 -> 245
 *   pair. Driving side is raw 246 and post-withhold 245: exactly one country,
 *   AR, carries both left and right, because Argentina drove on the left until
 *   1945. Latitude is 246 both raw and post-withhold — every country returns
 *   exactly one best-rank centroid — so the prototype's 245 was not
 *   reproducible and is not carried forward.
 * - `plugs` 222 -> 207, and its floor DROPS from 200 to 197. That is not the
 *   gate being loosened to admit bad data: the prototype's 222 assumed the
 *   standard `BS 546` maps to a letter, and it does not — one Wikidata item
 *   covers both the 5 A (type D) and 15 A (type M) sizes. Fifteen countries
 *   are withheld rather than guessed at; see `PLUG_LETTERS`. The floor tracks
 *   the measurement under the same -10 rule as every other row.
 *
 * `officialLanguages` measured 243 at Task 25 and measures 237 now, and the
 * FLOOR DOES NOT MOVE. The six-country fall is the territorial-scope rule in
 * `pickLanguages` doing its job — AF, AZ, BE, BQ, PW and US carry P37
 * statements upstream itself marks as applying to only part of the country,
 * and the United States one published a flat falsehood. Under the -10 rule
 * this row would now read 227; it stays at 233, because lowering a gate to
 * admit the fix that tripped it is how a gate becomes decoration. Four
 * countries of headroom is tighter than every other row here and that is the
 * point: the next six countries to lose their languages should stop the
 * nightly job, not pass it. The deviation is recorded here rather than left
 * for a reader to spot, exactly like `name`'s two.
 *
 * `name` is the ONE row that does not take ten countries of headroom, and the
 * deviation is deliberate rather than an oversight. Measured 246 of 246 -
 * every country answers, exactly once, with a label that is neither blank, nor
 * multi-valued, nor over the character ceiling - so the -10 rule would set a
 * floor of 236 and quietly permit ten countries to be called "PE" instead of
 * "Peru". A missing name is not a thin fact, it is a sentence that reads as
 * broken software; and unlike every field above it, `name` has no withhold
 * rule that can legitimately fire in bulk. Two countries of headroom is what
 * that leaves: enough that a single upstream label deletion does not stop the
 * world's refresh, tight enough that a systemic label failure does.
 */
export const MIN_FIELD_COVERAGE = {
  name: 244,
  currencyCode: 229,
  currencyName: 229,
  plugs: 197,
  voltageV: 211,
  drivingSide: 235,
  emergency: 211,
  officialLanguages: 233,
  callingCode: 227,
  lat: 236,
};

/**
 * 0.05, not 0.10, and the change is forced by arithmetic the first real build
 * made available.
 *
 * `MIN_FIELD_COVERAGE` runs BEFORE this check and is now set from measured
 * coverage less ten. Add up how many fields can go missing while every one of
 * those floors still holds: currencyCode 17, currencyName 17, plugs 49,
 * voltageV 35, drivingSide 11, emergency 35, officialLanguages 13,
 * callingCode 19, lat 10 — 206 fields out of a full 246 x 9 = 2,214, which is
 * 9.3%. A 10% shrink is therefore UNREACHABLE: every path to it trips a
 * coverage floor first, and this check would have been dead code dressed as a
 * defence. At 0.05 it is live again, and it is the only gate that sees loss
 * spread thinly across many fields and many countries at once, which is
 * exactly the shape no single floor and no per-country grace can catch.
 *
 * The nightly cost of the tighter number is negligible: per-property demotion
 * already carries a bad property's values forward before this check ever runs,
 * so a 5% overnight fall in total facts means something systemic rather than
 * churn.
 */
const MAX_SHRINK_RATIO = 0.05;
/**
 * Stays at 0.10, and its honest reach is recorded rather than assumed: against
 * the shipped baseline of 2,098 facts, filling in EVERY absent field in every
 * country would reach 2,214, a 5.5% rise — so this ratio cannot fire on the
 * artifact as it stands. It is a backstop against a much larger reshape, not
 * the thing that catches a withhold rule that stopped firing. That job belongs
 * to the value-domain allowlists above (plug letters, driving side, the
 * voltage band, ISO-shaped currency codes) and to the `soleDroppedArticlePlugs`
 * and `curatedStale` diagnostics, all of which fire on one country.
 */
const MAX_GROWTH_RATIO = 0.10;
/**
 * How many fields one country may lose before the run stops, regardless of how
 * small the global movement is.
 *
 * An ABSOLUTE grace rather than a ratio, and a tight one, because a record
 * holds at most nine fields: a ratio at this scale is meaningless (losing one
 * of three fields is 33%) and a country losing two fields in a night is a real
 * regression, not churn. This is the `assertCountryCoverageSane` lesson at
 * field granularity — one country being emptied moves the global total by
 * 0.4%, which no global ratio worth having can see.
 */
const COUNTRY_FIELD_LOSS_GRACE = 1;

/**
 * Strings that mean "we had nothing" and must never be published as though
 * they meant something. Bare Q-ids and entity URIs are the shape a label
 * failure takes on this endpoint specifically: an unlabelled item's `Label`
 * column comes back as the id, and `Q4917` rendered as a currency name reads
 * as a real, researched answer.
 */
const SENTINEL_TEXT = /^(?:unknown|n\/?a|none|null|undefined|nan|nil|tbd|-{1,2}|\?+)$/i;
const BARE_ENTITY_ID = /^Q[1-9][0-9]*$/;

/** Every string a record carries, wherever it sits, for the shape walk. */
function recordStrings(record) {
  /** @type {{ path: string, value: string }[]} */
  const found = [];
  for (const field of RECORD_FIELDS) {
    const value = record[field];
    if (typeof value === 'string') found.push({ path: field, value });
    else if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        if (typeof item === 'string') found.push({ path: `${field}[${index}]`, value: item });
        else if (item && typeof item === 'object') {
          for (const [key, nested] of Object.entries(item)) {
            if (typeof nested === 'string') found.push({ path: `${field}[${index}].${key}`, value: nested });
          }
        }
      }
    }
  }
  return found;
}

/**
 * Everything a corrupt or reshaped upstream feed could slip through
 * unattended, checked BEFORE anything is written and before `mkdirSync` has
 * even created the output directory.
 *
 * The order is load-bearing. The count band, the required-key fixtures, the
 * per-record shape walk, the four landmine gates, the CN reproduction check
 * and the per-field coverage floors all run BEFORE `if (!previous) return;`,
 * because a first run has no previous artifact and every drift check below is
 * therefore inert on exactly the run that writes the baseline every later run
 * is measured against. A gate that only compares against yesterday cannot
 * bound today when there was no yesterday.
 *
 * `built` carries `diagnostics` as well as `countries` because two of the
 * checks here are about how the build REACHED its answer — a plug field
 * withheld only because upstream's sole value was a Wikipedia article, and a
 * hand-verified override upstream has since made redundant — and a finished
 * record cannot show either.
 */
export function assertFactsSane(built, previous) {
  const countries = built?.countries ?? {};
  const diagnostics = built?.diagnostics ?? {};
  const codes = Object.keys(countries);

  // --- Two-sided country-count band ---------------------------------------
  if (Math.abs(codes.length - EXPECTED_COUNTRIES) > COUNTRY_TOLERANCE) {
    throw new Error(
      `${codes.length} countries carry facts, expected ${EXPECTED_COUNTRIES} ` +
      `(+/-${COUNTRY_TOLERANCE}) — the country universe has reshaped. This band is two-sided ` +
      `on purpose: on a first run it is the only bound in play, and a floor cannot catch a ` +
      `feed that grew`
    );
  }

  // --- Required-key fixtures a count cannot see ---------------------------
  for (const code of REQUIRED_FACT_COUNTRIES) {
    if (factCount(countries[code] ?? {}) === 0) {
      throw new Error(
        `${code} carries no facts — the count band cannot see one country emptying, and ${code} ` +
        `is one of the countries this design was validated against`
      );
    }
  }
  const sparse = countries[REQUIRED_SPARSE_COUNTRY];
  if (!sparse) {
    throw new Error(
      `${REQUIRED_SPARSE_COUNTRY} is absent — it is the positive fixture for the honest-gap ` +
      `rule, and without it "a country degraded to silence" and "a country we forgot" look ` +
      `identical in this artifact`
    );
  }
  if (RENDERED_FIELDS.every((field) => sparse[field] !== undefined)) {
    throw new Error(
      `${REQUIRED_SPARSE_COUNTRY} now carries every rendered field — either the withhold rules ` +
      `stopped withholding, which no coverage floor can see because floors only count ` +
      `downwards, or upstream genuinely filled it in and this fixture must move to another ` +
      `sparse dependency (TF, SJ, CX, IO)`
    );
  }

  // --- Per-record shape ---------------------------------------------------
  for (const [code, record] of Object.entries(countries)) {
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new Error(
        `malformed country key "${code}" — expected two uppercase letters. Codes are trimmed ` +
        `but never uppercased or reshaped by the build, so this is upstream switching to ` +
        `alpha-3 or to lowercase and it must not be normalised away`
      );
    }
    if (factCount(record) === 0) {
      throw new Error(
        `${code} is present with an empty record — a country with no facts is OMITTED even when ` +
        `upstream gave it a name, so the neutral profile answers for it; an empty record is a ` +
        `second way of saying the same thing and the two would drift`
      );
    }
    for (const field of Object.keys(record)) {
      if (!RECORD_FIELDS.includes(field)) {
        throw new Error(
          `${code} carries an unknown field "${field}" — the query is returning a column this ` +
          `build has never examined, and it would reach the client unreviewed`
        );
      }
    }
    for (const { path, value } of recordStrings(record)) {
      if (value.trim() === '') {
        throw new Error(
          `${code}.${path} is an empty string — the honest-gap rule is ABSENT, never empty: an ` +
          `empty value renders as a broken sentence while an absent one renders as nothing`
        );
      }
      if (SENTINEL_TEXT.test(value.trim()) || BARE_ENTITY_ID.test(value.trim()) || /^https?:\/\//i.test(value)) {
        throw new Error(
          `${code}.${path} is "${value}" — a sentinel, a bare entity id or a URI leaked through ` +
          `where a human-readable value belongs, and it would read to a traveller as researched`
        );
      }
      if (value.length > MAX_TEXT_CHARS) {
        throw new Error(
          `${code}.${path} is ${value.length} characters, over the ${MAX_TEXT_CHARS} character ceiling — ` +
          `a label that long is a leaked blob, not a name`
        );
      }
    }
    if ((record.officialLanguages?.length ?? 0) > MAX_LANGUAGES) {
      throw new Error(
        `${code} lists ${record.officialLanguages.length} official languages, over the ` +
        `${MAX_LANGUAGES} ceiling — Bolivia's 37 is the real maximum, so this is a join gone wrong`
      );
    }
    if ((record.plugs?.length ?? 0) > MAX_PLUGS) {
      throw new Error(`${code} lists ${record.plugs.length} plug types, over the ${MAX_PLUGS} ceiling`);
    }
    if ((record.emergency?.length ?? 0) > MAX_EMERGENCY_ENTRIES) {
      throw new Error(
        `${code} lists ${record.emergency.length} emergency numbers, over the ` +
        `${MAX_EMERGENCY_ENTRIES} ceiling`
      );
    }
  }

  // --- The four landmine gates, plus the value domains around them ---------
  // Defence in depth, not a restatement: the pickers above withhold on these
  // shapes so a bad UPSTREAM value never reaches a record. What reaches one
  // anyway is a value carried forward from a previous artifact that was
  // written before a rule existed, or a typo in `CURATED_FACTS`. Both are
  // exactly the inputs a picker never sees.
  for (const [code, record] of Object.entries(countries)) {
    if (record.voltageV !== undefined) {
      const volts = record.voltageV;
      if (typeof volts !== 'number' || !Number.isFinite(volts) || volts < MIN_VOLTAGE_V || volts > MAX_VOLTAGE_V) {
        throw new Error(
          `${code} has mains voltage ${volts}, outside ${MIN_VOLTAGE_V}-${MAX_VOLTAGE_V} V — ` +
          `that is industrial three-phase supply, the BZ 550/220 and FR 400/230 shape, and it ` +
          `sends a traveller after the wrong adapter`
        );
      }
    }
    if (record.currencyCode !== undefined && !/^[A-Z]{3}$/.test(record.currencyCode)) {
      throw new Error(
        `${code} has currency code "${record.currencyCode}", not ISO 4217 alphabetic — the ` +
        `CZ "203" shape, an ISO numeric code leaking into an alphabetic field`
      );
    }
    if (record.plugs !== undefined) {
      if (!Array.isArray(record.plugs) || record.plugs.length === 0) {
        throw new Error(`${code} has a non-array or empty plugs field — absent, never empty`);
      }
      for (const letter of record.plugs) {
        if (!PLUG_LETTER_SET.has(letter)) {
          throw new Error(
            `${code} has plug type "${letter}", which is not one of ${[...PLUG_LETTER_SET].join('')} — ` +
            `P2853 returns technical standards, and an unrecognised one must withhold the whole ` +
            `field rather than pass through`
          );
        }
      }
      const sorted = [...new Set(record.plugs)].sort();
      if (sorted.length !== record.plugs.length || sorted.some((letter, i) => letter !== record.plugs[i])) {
        throw new Error(
          `${code}'s plug types are not sorted and unique (${record.plugs.join(',')}) — an ` +
          `unstable order rewrites the artifact every night for no data change`
        );
      }
    }
    if (record.emergency !== undefined) {
      if (!Array.isArray(record.emergency) || record.emergency.length === 0) {
        throw new Error(`${code} has a non-array or empty emergency field — absent, never empty`);
      }
      for (const entry of record.emergency) {
        if (!EMERGENCY_NUMBER.test(String(entry?.number))) {
          throw new Error(
            `${code} has emergency number "${entry?.number}" — P2852's values are Q-items and ` +
            `the number lives in the item's label, so anything that is not 2-6 digits is the ` +
            `label lookup having failed`
          );
        }
        if (entry.role !== null && !EMERGENCY_ROLE_SET.has(entry.role)) {
          throw new Error(
            `${code} has emergency role "${entry.role}", which is not one of ` +
            `${[...EMERGENCY_ROLE_SET].join(', ')} — an unmapped P366 qualifier would be ` +
            `rendered into a sentence nobody reviewed`
          );
        }
      }
    }
    if (record.drivingSide !== undefined && record.drivingSide !== 'left' && record.drivingSide !== 'right') {
      throw new Error(`${code} drives on "${record.drivingSide}" — expected "left" or "right"`);
    }
    if (record.callingCode !== undefined && !/^\+[0-9]{1,4}$/.test(record.callingCode)) {
      throw new Error(
        `${code} has dialling code "${record.callingCode}" — expected "+" and one to four digits`
      );
    }
    if (record.lat !== undefined) {
      const lat = record.lat;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error(`${code} has latitude ${lat}, outside -90..90`);
      }
    }
  }

  if ((diagnostics.soleDroppedArticlePlugs?.length ?? 0) > 0) {
    throw new Error(
      `${diagnostics.soleDroppedArticlePlugs.length} country/countries ` +
      `(${diagnostics.soleDroppedArticlePlugs.slice(0, 10).join(', ')}) have ` +
      `${[...DROPPED_PLUG_ITEMS].join(', ')} as their ONLY plug value. Dropping that Wikipedia ` +
      `article by id is lossless only while zero countries rely on it — measured zero on ` +
      `2026-08-27 — so this refuses the write rather than quietly costing them their sockets tip`
    );
  }

  if ((diagnostics.soleDroppedLanguages?.length ?? 0) > 0) {
    throw new Error(
      `${diagnostics.soleDroppedLanguages.length} country/countries ` +
      `(${diagnostics.soleDroppedLanguages.slice(0, 10).join(', ')}) have nothing but ` +
      `${[...DROPPED_LANGUAGE_ITEMS].join(', ')} as their official-language values. Dropping ` +
      `those items by id is lossless only while zero countries rely on them — measured zero on ` +
      `2026-08-27 — so this refuses the write rather than quietly costing them their language tip`
    );
  }

  // Territorially scoped languages are NOT refused here, and the asymmetry is
  // deliberate. A dropped id withholding a whole country is a sign the drop
  // list has outgrown its measurement; a scoped statement withholding a whole
  // country is the rule working exactly as designed — it is what stops the
  // United States being told Carolinian is one of its official languages. The
  // set is measured, named in the report and pinned by name in
  // lib/countryFacts.test.ts, and the `officialLanguages` floor in
  // `MIN_FIELD_COVERAGE` is what bounds it growing without anybody noticing.

  if ((diagnostics.curatedStale?.length ?? 0) > 0) {
    throw new Error(
      `CURATED_FACTS rows ${diagnostics.curatedStale.join(', ')} no longer fire — upstream now ` +
      `supplies those fields, so the hand-verified override is stale. Verify the upstream value ` +
      `and delete the row; leaving it would be cruft nothing ever re-checks`
    );
  }

  // --- The CN cross-check --------------------------------------------------
  const cn = countries.CN ?? {};
  for (const field of ['currencyCode', 'voltageV', 'drivingSide', 'callingCode']) {
    if (cn[field] !== CN_CROSS_CHECK[field]) {
      throw new Error(
        `CN.${field} is ${JSON.stringify(cn[field])}, expected ` +
        `${JSON.stringify(CN_CROSS_CHECK[field])} — China is the one country whose answer was ` +
        `written by hand before this ingest existed, so a mismatch means the pipeline, not China`
      );
    }
  }
  if ((cn.plugs ?? []).join(',') !== CN_CROSS_CHECK.plugs.join(',')) {
    throw new Error(
      `CN.plugs is ${JSON.stringify(cn.plugs)}, expected ${JSON.stringify(CN_CROSS_CHECK.plugs)} — ` +
      `the string lib/packing.ts:64 already carries by hand`
    );
  }
  const cnNumbers = new Set((cn.emergency ?? []).map((entry) => entry.number));
  for (const number of CN_CROSS_CHECK.emergencyNumbers) {
    if (!cnNumbers.has(number)) {
      throw new Error(
        `CN has no emergency number ${number} (has ${[...cnNumbers].join(', ') || 'none'}) — ` +
        `110 police, 119 fire and 120 ambulance are the answer this ingest is checked against`
      );
    }
  }

  // --- The two pinned names ------------------------------------------------
  // The reproduction gate's sibling. A name is the one value here that is read
  // back to the traveller verbatim, so a wrong one is not a thin field, it is
  // a sentence about the wrong country.
  for (const [code, expected] of Object.entries(REQUIRED_NAMES)) {
    if (countries[code]?.name !== expected) {
      throw new Error(
        `${code}.name is ${JSON.stringify(countries[code]?.name)}, expected ` +
        `${JSON.stringify(expected)} — the gap note and the packing line read this back to a ` +
        `traveller word for word, so a rename upstream must stop the build rather than change ` +
        `what they are told`
      );
    }
  }

  // --- Per-field coverage floors ------------------------------------------
  for (const [field, floor] of Object.entries(MIN_FIELD_COVERAGE)) {
    let covered = 0;
    for (const record of Object.values(countries)) if (record[field] !== undefined) covered++;
    if (covered < floor) {
      throw new Error(
        `only ${covered} countries carry ${field}, under the ${floor} floor — every record can ` +
        `survive while one field goes null everywhere, and the count band cannot see it`
      );
    }
  }

  if (!previous) return;

  // --- Drift, against the previous artifact --------------------------------
  const previousCountries = previous.countries ?? {};

  const emptied = Object.keys(previousCountries)
    .filter((code) => factCount(previousCountries[code]) > 0 && factCount(countries[code] ?? {}) === 0)
    .sort();
  if (emptied.length > 0) {
    throw new Error(
      `${emptied.length} country/countries lost every fact: ${emptied.slice(0, 10).join(', ')} — ` +
      `a country that empties falls back to the neutral profile silently, and the global total ` +
      `can stay well inside the drift band while it happens`
    );
  }

  let before = 0;
  for (const record of Object.values(previousCountries)) before += factCount(record);
  let after = 0;
  for (const record of Object.values(countries)) after += factCount(record);
  if (before > 0) {
    const shrink = (before - after) / before;
    if (shrink > MAX_SHRINK_RATIO) {
      throw new Error(
        `fact count fell ${(shrink * 100).toFixed(1)}% (${before} -> ${after}), over the ` +
        `${MAX_SHRINK_RATIO * 100}% limit — upstream may be mid-rebuild, and writing now would ` +
        `delete what this run failed to refetch`
      );
    }
    const growth = (after - before) / before;
    if (growth > MAX_GROWTH_RATIO) {
      throw new Error(
        `fact count rose ${(growth * 100).toFixed(1)}% (${before} -> ${after}), over the ` +
        `${MAX_GROWTH_RATIO * 100}% limit — a withhold rule may have stopped firing`
      );
    }
  }

  const collapsed = [];
  for (const [code, previousRecord] of Object.entries(previousCountries)) {
    const lost = factCount(previousRecord) - factCount(countries[code] ?? {});
    if (lost > COUNTRY_FIELD_LOSS_GRACE) {
      collapsed.push(`${code} ${factCount(countries[code] ?? {})}/${factCount(previousRecord)}`);
    }
  }
  if (collapsed.length > 0) {
    throw new Error(
      `${collapsed.length} country/countries lost more than ${COUNTRY_FIELD_LOSS_GRACE} field(s) ` +
      `(${collapsed.slice(0, 10).join(', ')}) — a record holds at most ${FACT_FIELDS.length} ` +
      `fields, so a global ratio cannot see one country being hollowed out`
    );
  }
}

// ---------------------------------------------------------------------------
// Paths, sources, network
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Default for `run()`'s `dataDir` — production's real value. Both output paths
 * are derived from whichever `dataDir` `run()` actually receives, never from
 * this constant directly, so a test can point them at a scratch directory and
 * never touch `data/`.
 */
const DATA_DIR = join(ROOT_DIR, 'data');
const FACTS_FILE = 'country-facts.json';
const REPORT_FILE = 'country-facts-report.md';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
/**
 * CC0, a public domain dedication with NO attribution condition — confirmed
 * live from the endpoint's `meta=siteinfo`. This is why nothing here widens
 * components/plan/GeoNamesCredit.tsx or lib/contracts.test.ts's C7 contract;
 * see the header and the report's `## Attribution` section, which are the
 * other two places the same decision is recorded.
 */
const SOURCE_LICENSE = 'CC0-1.0';
const SOURCE_NAME = 'Wikidata (CC0)';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

/**
 * The country universe this ingest asks about: every code the app ships a city
 * shard for under public/cities, sorted. Pinned against that directory by a
 * derived contract in lib/countryFacts.test.ts, so a shard added or removed
 * reddens rather than silently going unqueried.
 *
 * Bounding the query matters. Measured 2026-08-27, an unbounded
 * `?item wdt:P297 ?code` returns 259 codes — the app's 246 are a strict subset,
 * and the 13 extras are AC, AN, AQ, BV, CP, CQ, DD, DG, HM, PC, TA, UM, YU:
 * exceptionally reserved codes, uninhabited territories, and the historical
 * AN (Netherlands Antilles), DD (East Germany) and YU (Yugoslavia). Facts
 * about East Germany would pass every gate in this file, cost bytes in a
 * bundle that reaches the browser, and answer a question no user can ask.
 *
 * It is a literal rather than a `readdirSync` because `run()`'s injectable
 * seams are `fetchBindings` and `dataDir`: reading public/cities inside the
 * run would make every gate test in scripts/ingest-country-facts.test.ts
 * depend on the real shard tree, which is the coupling those tests exist
 * without.
 */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT', 'AU',
  'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ',
  'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CA',
  'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR',
  'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO',
  'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN',
  'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT',
  'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE',
  'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW',
  'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
  'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN',
  'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS',
  'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC',
  'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR',
  'SS', 'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ',
  'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG',
  'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS',
  'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

/**
 * Deliberately ABOVE the server's own ceiling, not below it.
 *
 * Blazegraph gives itself 60 s and then answers `upstream request timeout` —
 * an HTTP 200 whose body has no CSV header, which `parseBindings` refuses to
 * read as an empty answer. A client timeout under 60 s would abort requests
 * the server was about to answer or about to refuse in a way this ingest can
 * attribute, and turn a diagnosable refusal into an undiagnosable abort.
 *
 * Headroom, measured 2026-08-27 by the shipping queries over all 246 codes in
 * ONE request each (the batches below are smaller still): 252 ms for the
 * fastest (P474) and 746 ms for the slowest (P2884). 90 s is ~120x the
 * measured worst case and 1.5x the server's ceiling.
 */
const SPARQL_TIMEOUT_MS = 90_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

/**
 * The longest a `Retry-After` may park this run.
 *
 * The header is honoured because ignoring it is how a polite client becomes an
 * abusive one, but it is upstream-controlled input and is treated as such: a
 * misconfigured or hostile `Retry-After: 86400` must not hold the nightly
 * workflow's runner open for a day. Past this, the run fails, nothing is
 * written, the previous artifact stands and the job goes red — which is the
 * correct outcome for "Wikidata has asked us to come back much later".
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * One second between requests, serially, never concurrently.
 *
 * WDQS asks clients to keep concurrency low rather than to hit a published
 * quota, so the politeness rule here is one request in flight at a time with a
 * full second between them. Measured cost on 2026-08-27: 24 requests for a
 * whole build (1 codes + 2 name + 2 + 3 + 2 + 2 + 5 + 3 + 2 + 2), so the delay
 * adds about 23 s to a run whose queries themselves total well under a minute.
 * That is a price worth paying nightly for a free public endpoint.
 */
const POLITENESS_DELAY_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `Retry-After` in milliseconds, or null when there is nothing usable to
 * honour. Both RFC 9110 forms are accepted: delta-seconds and an HTTP-date.
 *
 * Clamped to `MAX_RETRY_AFTER_MS` by the caller, not here, so the raw value
 * stays visible in the log line — "asked for 3600 s, waiting 60 s" is
 * diagnosable and "waiting 60 s" is not.
 */
export function parseRetryAfter(header, now = Date.now()) {
  const raw = String(header ?? '').trim();
  if (raw === '') return null;
  if (/^[0-9]+$/.test(raw)) return Number(raw) * 1_000;
  // Every RFC 9110 date form starts with a day name, and requiring one is not
  // pedantry: `Date.parse` is lenient enough to read "12.5" as a DATE, so a
  // malformed delta-seconds value would otherwise come back as "wait until
  // some day in the year 2012", clamp to 0, and turn a rate-limit into a
  // hot retry loop against the endpoint that just asked us to slow down.
  if (!/^[A-Za-z]{3}/.test(raw)) return null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * One retrying fetch, returning the response text.
 *
 * Global `fetch` plus `AbortSignal.timeout`, the same shape as
 * ingest-cities.mjs and ingest-airports.mjs — no node-fetch, no undici import,
 * nothing from node_modules at all, which is what lets the workflow skip
 * `npm ci`.
 *
 * `notFoundIsEmpty: false` is not offered as an option here because there is
 * only one endpoint and the answer for it is fixed: a 404 from SPARQL means
 * the endpoint moved, which is an outage. Laundering that into "Wikidata knows
 * nothing about 246 countries" is the exact reading that feeds a destructive
 * merge, and it is not worth retrying either — a moved endpoint will still be
 * moved in ten seconds.
 */
export async function fetchWithRetry(url, { body, accept }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    /** Set when the server itself told us how long to wait; overrides the backoff. */
    let requested = null;
    /** Set when the answer is one no amount of waiting will change. */
    let fatal = false;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: accept,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(SPARQL_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (res.status === 404) {
        fatal = true;
        throw new Error(
          `HTTP 404 — the SPARQL endpoint moved or the query path changed; that is an outage, ` +
          `not an empty result`
        );
      }
      if (!res.ok) {
        requested = parseRetryAfter(res.headers.get('retry-after'));
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      // A moved endpoint will still be moved in ten seconds, and the retry
      // budget here is ten seconds. Retrying it would buy nothing and would
      // triple the time the nightly job takes to report a real outage.
      if (fatal) throw error;
      if (requested !== null && requested > MAX_RETRY_AFTER_MS) {
        // Not a retry decision: the server has asked for longer than this run
        // is willing to hold a CI runner open, so stop and let the property be
        // demoted with its previous values carried forward.
        throw new Error(
          `${error.message}; Retry-After asked for ${Math.round(requested / 1_000)}s, over the ` +
          `${MAX_RETRY_AFTER_MS / 1_000}s ceiling — giving up rather than parking the run`
        );
      }
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = requested === null ? RETRY_DELAYS_MS[attempt] : Math.max(requested, RETRY_DELAYS_MS[attempt]);
        console.warn(
          `  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms (${error.message}` +
          `${requested === null ? '' : `, Retry-After ${Math.round(requested / 1_000)}s`})`
        );
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * The fourth verbatim copy in this repo, acknowledged rather than shared:
 * build-time logic may not live in lib/, and a scripts/ helper module would be
 * a fifth import edge for three lines of filesystem work.
 */
function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    rmSync(path, { force: true }); // Windows rename does not overwrite reliably
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * Missing and unreadable are NOT the same answer.
 *
 * scripts/enrich-cities.mjs's version, deliberately, never
 * scripts/ingest-cities.mjs's swallow. Returning null for both would make a
 * corrupt previous artifact — a partial checkout, an interrupted write, a bad
 * merge — read as "there is no previous artifact", which is precisely the
 * input that makes `assertFactsSane`'s `if (!previous) return;` skip every
 * drift check. That combination is what this repo has already paid for once:
 * corrupt the committed file, hand the run an empty upstream answer, and it
 * rewrites everything at exit 0. A file that exists and does not parse is a
 * reason to stop, never a reason to proceed as though it were absent.
 */
function readJson(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path} exists but is not valid JSON (${error.message}) — refusing to continue: ` +
      `an unreadable previous state reads as "nothing to lose", and every drift check below ` +
      `would then wave this run straight through`
    );
  }
}

/**
 * The artifact's contents, with its timestamp preserved when nothing moved.
 *
 * Verbatim from scripts/ingest-cities.mjs, and for the same reason: this file
 * is inside the nightly workflow's commit-guard paths, so stamping
 * `new Date()` on it unconditionally turns a commit-on-change job into a
 * commit-every-day job, and every commit is a production deploy plus a CI run.
 *
 * Compared on the PAYLOAD, never on the envelope — comparing the whole
 * previous object would compare the timestamp against itself and never match.
 *
 * `generatedAt` is spread first so the emitted key order matches what the
 * previous file had, which is what keeps the byte comparison above meaningful.
 */
export function stampedPayload(previous, body, now) {
  const unchanged =
    previous !== null &&
    JSON.stringify({ ...previous, generatedAt: undefined }) ===
      JSON.stringify({ ...body, generatedAt: undefined });
  return { generatedAt: unchanged ? previous.generatedAt : now, ...body };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The report describes the ARTIFACT, never the run.
 *
 * No "N countries changed tonight" line, deliberately, for the reason
 * scripts/ingest-cities.mjs's `buildReport` gives: that number is 246 on a
 * first run and 0 on a quiet one, which would make this committed file differ
 * every time the previous run's numbers differed. Everything below is a pure
 * function of the records, so a rebuild with no data change produces a
 * byte-identical report and `git status` stays clean.
 *
 * `scopedLanguages` is the one input that is NOT a record, and it is still not
 * a run count: it is `diagnostics.scopedLanguages`, the set of countries whose
 * P37 statements upstream qualified `applies to part`. Same query, same
 * answer, same output — see `languageGap` below for why the alternative was a
 * literal that drifted, and for what `null` means.
 *
 * @param {{
 *   countries: Record<string, CountryFacts>,
 *   generatedAt: string,
 *   scopedLanguages?: string[] | null,
 * }} input
 */
export function buildReport({ countries, generatedAt, scopedLanguages = null }) {
  const records = Object.entries(countries);
  const coverage = RECORD_FIELDS.map((field) => {
    const covered = records.filter(([, record]) => record[field] !== undefined).length;
    return `| \`${field}\` | ${covered} | ${records.length === 0 ? '0.0' : ((covered / records.length) * 100).toFixed(1)}% |`;
  });
  const byFacts = records
    .map(([code, record]) => [code, factCount(record)])
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])));
  const thinnest = byFacts.slice(-15).reverse();
  /**
   * How many of the SEVEN rendered fields each country carries. The design's
   * first stated risk is that the bar "as clear as China for all countries" is
   * not met literally, and this histogram is the number that risk turns on:
   * it says how many countries get the full set of fact-derived lines and how
   * many are visibly thin. `currencyName` rides with `currencyCode` and `lat`
   * is never rendered, so neither is counted here.
   */
  const rendered = new Map();
  for (const [, record] of records) {
    const carried = RENDERED_FIELDS.filter((field) => record[field] !== undefined).length;
    rendered.set(carried, (rendered.get(carried) ?? 0) + 1);
  }
  const histogram = [...rendered.entries()].sort((a, b) => b[0] - a[0]);

  /**
   * The languages bullet under `## Not derivable`, DERIVED — and the only
   * reader `diagnostics.scopedLanguages` has.
   *
   * It used to be a frozen literal reading "AF, AZ, BE, BQ, PW and US", which
   * named six while the artifact beside it withheld nine: the three the rule
   * has nothing to do with (upstream states no official language for them at
   * all) were simply missing from a sentence that claimed to explain the gap.
   * A hand-written list of what a rule did is a second copy of the answer, and
   * the two drifted the first time anything moved.
   *
   * Both halves come from what actually happened: the WHO from the artifact,
   * the WHY from the run's own diagnostic. That is the point of reading the
   * diagnostic rather than re-deriving the rule here — a diagnostic nothing
   * reads is one nobody notices going wrong.
   *
   * `scopedLanguages === null` means the P37 query was demoted this run and
   * its values were carried forward, so the diagnostic is empty because
   * nothing was measured rather than because nothing was scoped. Attributing
   * every withheld country to "upstream states none" on that night would be
   * the frozen list's failure with extra steps, so the split is withheld
   * instead and the reason is printed.
   */
  const withheldLanguages = records
    .filter(([, record]) => record.officialLanguages === undefined)
    .map(([code]) => code)
    .sort();
  const scopedSet = new Set(scopedLanguages ?? []);
  const scopedHere = withheldLanguages.filter((code) => scopedSet.has(code));
  const unstatedHere = withheldLanguages.filter((code) => !scopedSet.has(code));
  const languageGap = withheldLanguages.length === 0 ? [] : [
    `- **Official languages for ${withheldLanguages.length} of the ${records.length} countries.**`,
    '  The gap note names the field for every one of them. Both the list and the split below',
    '  are derived from this run rather than written down, so neither can drift from what was',
    '  actually published:',
    `  ${withheldLanguages.join(', ')}`,
    ...(scopedLanguages === null
      ? [
        '  - **Why each one is withheld is not stated this run.** The P37 query was demoted and',
        '    its values carried forward, so the scope diagnostic is empty because nothing was',
        '    measured rather than because nothing was scoped. A split written down anyway is',
        '    exactly the frozen list this derivation replaced.',
      ]
      : [
        `  - **${scopedHere.length} because every P37 statement upstream gives them is qualified`,
        '    `applies to part`** — or enough of them that the remainder is not a national list.',
        '    Upstream is stating, on the statement itself, that this is not a claim about the',
        '    whole country. The United States is the case that forces the rule: Carolinian and',
        '    Chamorro apply to the Northern Marianas, Hawaiian to Hawaii, Samoan to American',
        '    Samoa and Spanish to Puerto Rico, while English sits at deprecated rank — so an',
        '    unfiltered query told a traveller the United States has five official languages and',
        '    none of them is English. Publishing the unscoped remainder instead was measured and',
        '    rejected: it leaves Azerbaijan with `Azerbaijani Sign Language` alone, trading one',
        '    false sentence for another. Where the qualifier names a PART of the country',
        '    (Belgium\'s language regions) or a VARIETY of the language (Standard Azerbaijani)',
        '    rather than a territory the national claim excludes, a hand-verified value is',
        '    carried instead and the whole field is not lost — see `CURATED_FACTS`.',
        `    ${scopedHere.join(', ') || '(none)'}`,
        `  - **${unstatedHere.length} because upstream states no official language at all** —`,
        '    no truthy P37 statement, or none this ingest can publish.',
        `    ${unstatedHere.join(', ') || '(none)'}`,
      ]),
  ];

  return [
    '# Country facts report',
    '',
    `- Generated: ${generatedAt}`,
    `- Source: ${SPARQL_ENDPOINT} (${SOURCE_NAME})`,
    `- Licence: ${SOURCE_LICENSE}`,
    '- Contents: structured scalars only. Never prose, never a sentence.',
    '',
    `**${records.length} countries carry at least one fact.**`,
    '',
    "Every record also carries the country's English NAME, from the item's own",
    '`rdfs:label`. It is identity rather than a fact — it is what the sentences in',
    '`lib/countryTips.ts` call the country — so it is not counted as one, and a record',
    'carrying nothing but a name would be omitted exactly like an empty one.',
    '',
    'A country with none is absent from the artifact entirely and falls through to',
    "`lib/countryProfile.ts`'s neutral profile, which is the honest default. A field",
    'with no supporting data is ABSENT from its record — never an empty string, never',
    'an empty array, never a placeholder — and the template that would render it',
    'simply does not run.',
    '',
    '## Coverage by field',
    '',
    '| Field | Countries | Share |',
    '| --- | --- | --- |',
    ...coverage,
    '',
    '## Countries by rendered-field count',
    '',
    'Of the seven fields that reach a traveller. A country lower down this table is',
    'not a country we got wrong — it is one whose gap note names, per field, exactly',
    'what we do not have.',
    '',
    '| Rendered fields | Countries |',
    '| --- | --- |',
    ...histogram.map(([carried, count]) => `| ${carried} of ${RENDERED_FIELDS.length} | ${count} |`),
    '',
    '## Thinnest records',
    '',
    '| Country | Facts |',
    '| --- | --- |',
    ...thinnest.map(([code, count]) => `| ${code} | ${count} |`),
    '',
    '## Not derivable',
    '',
    'Recorded so it is not re-litigated. Each of these was measured, not assumed.',
    '',
    '- **Rail speed outside China.** Wikidata\'s "high-speed railway line" class returns',
    '  lines for Peru, Panama, Ecuador, Bangladesh, Venezuela, Colombia, Australia and',
    '  the Philippines. Either that or the World Bank\'s route-kilometre series would',
    '  tell the app Peru is high-speed-rail friendly. Rail speed for a new country is a',
    '  hand-written, cited entry in `lib/countryData/`.',
    '- **Public holidays.** The open dataset with the best coverage reaches 204 of 246',
    '  and misses IN, TH, MY, LK, NP, PK, MM, LA, IL, AE, SA, QA, KW, OM, JO, LB, TW,',
    '  MO, MU, MV, FJ, UZ, IR, AZ and 18 more — disproportionately where holiday',
    '  crowding matters most. It returns single dates rather than travel-impact bands.',
    '  Wikidata\'s own holiday property reaches 73 of 246.',
    '- **Per-month crowd pressure.** No open per-country per-month tourism seasonality',
    '  source exists at this granularity.',
    '- **Climate normals.** These need station data of a different order of size, and',
    '  they are the highest-value future addition — climate is what actually answers',
    '  "when should I go".',
    '- **A currency NAME a traveller could be shown.** The code is carried and rendered;',
    '  the name is carried and never rendered. Measured 2026-08-27 on the currency items',
    '  themselves: PE\'s is `Nuevo sol`, the pre-2015 name Peru dropped that year, and the',
    '  `mul` fallback does not fix it (Q204656 has an English label and no `mul` one).',
    '  Nor is the field consistent in what it names — JP\'s is `yen` and MX\'s is `peso`,',
    '  generic units rather than the Japanese yen or the Mexican peso — and P1813',
    '  ("short name") is empty for every one sampled, so no better property exists to',
    '  switch to. One label being provably stale while 238 more are unchecked is not a',
    '  one-country correction; it is a field that cannot be shown. See the block comment',
    '  in `lib/countryFacts.ts`.',
    '- **Payment apps, connectivity, booking channels, tipping, tap water, visa rules.**',
    '  No structured source. Visa rules also depend on the traveller\'s passport, which',
    '  the app does not know.',
    ...languageGap,
    '- **Plug letters for the fifteen BS 546 countries.** Measured 2026-08-27: the whole',
    '  distinct P2853 value set across these countries is fourteen items, thirteen',
    '  standards plus one Wikipedia article. One of the thirteen, `BS 546`, is a single',
    '  Wikidata item covering both of its sizes — the 5 A variant is IEC type D and the',
    '  15 A variant is type M — and the statement carries nothing that separates them.',
    '  Guessing D would publish "South Africa uses type C/D/N" when South Africa\'s',
    '  round-pin sockets are the 15 A type M, and a traveller who buys a type D adapter',
    '  on that sentence finds it does not fit. So the whole plug field is withheld for',
    '  MO, BT, MZ, PK, IL, PS, ZA, IN, BW, LK, NP, SZ, NG, NA and LS, and the gap note',
    '  names it. Splitting the item upstream, or a qualifier that gives the current',
    '  rating, is what would fix this.',
    '- **Anything about a country the app has no city shard for.** The query is bounded',
    '  to the 246 codes under `public/cities`. Measured 2026-08-27, an unbounded P297',
    '  query answers with 259: the extra thirteen are AC, AN, AQ, BV, CP, CQ, DD, DG,',
    '  HM, PC, TA, UM and YU — exceptionally reserved codes, uninhabited territories,',
    '  and the historical Netherlands Antilles, East Germany and Yugoslavia. Facts about',
    '  East Germany would pass every gate in the ingest and answer a question no user',
    '  can ask.',
    '',
    '## Attribution',
    '',
    'Wikidata\'s main and property namespaces are CC0 — a public domain dedication with',
    'NO attribution condition to discharge. **No UI credit is added for this source,',
    'and that is a decision rather than an oversight.**',
    '',
    '`components/plan/GeoNamesCredit.tsx` already argues this exact case for this exact',
    'source in its own doc-comment: naming a CC0 source inside a legal notice would',
    'imply the credits beside it are discretionary, when every one of them is required.',
    'Adding one here would weaken the notice.',
    '',
    'This file is therefore deliberately outside the C7 derived contract in',
    '`lib/contracts.test.ts`, which names `data/cities-report.md` specifically. If a',
    'future task adds a source that DOES carry an attribution condition, that task owns,',
    'in a single commit: the clause in `GeoNamesCredit.tsx`, the C7 token-list widening,',
    'and the enumerated-surface update in `data/cities-report.md`.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fetching the property queries
// ---------------------------------------------------------------------------

/**
 * An English label with Wikidata's `mul` fallback, as a deterministic COALESCE.
 *
 * This is not defensive boilerplate — it is the single most expensive thing
 * measured on 2026-08-27. Wikidata has been migrating item labels to the `mul`
 * ("default for all languages") pseudo-language, and Q4916, the EURO, now has
 * NO English label at all: 207 label languages, `en` not among them, `mul` =
 * "euro". An `en`-only currency query therefore silently drops every eurozone
 * country — measured 209 countries with `en` alone against 244 with this
 * fallback, and DE, IT, AT, GR, ES, IE, FI, EE, LT, LV, LU, MC, ME and more
 * simply absent. That is a 35-country hole that looks exactly like thin data.
 *
 * COALESCE rather than `FILTER(LANG(?x) IN ("en","mul"))`, because an item
 * carrying both would emit two rows and the pickers take first-seen — which
 * makes the artifact depend on result order and rewrites it on nights when
 * nothing changed.
 */
const labelWithMulFallback = (subject, out) =>
  `OPTIONAL { ${subject} rdfs:label ?${out}En . FILTER(LANG(?${out}En) = "en") }\n` +
  `    OPTIONAL { ${subject} rdfs:label ?${out}Mul . FILTER(LANG(?${out}Mul) = "mul") }\n` +
  `    BIND(COALESCE(?${out}En, ?${out}Mul) AS ?${out})`;

/** `VALUES ?country { "AD" "AE" … }` for one batch. */
const valuesClause = (variable, codes) => `VALUES ?${variable} { ${codes.map((code) => `"${code}"`).join(' ')} }`;

/**
 * The shipping query for one property over one batch of country codes.
 *
 * Every one of these is anchored on `?c wdt:P297 ?country` — the ISO code is
 * the join key AND the country universe, so a query can only ever speak about
 * codes this build asked for. `wdt:` is truthy-only, which is what keeps
 * Germany's normal-rank Deutsche Mark and France's livre tournois out of the
 * currency answer while their preferred-rank euro stays in.
 *
 * Two queries need statement-level access and say why in place. The rest are
 * one triple plus a label.
 *
 * Investigation 3's warning is the reason each of these was measured
 * individually before shipping: the same emergency-number question returned 0,
 * then 84, then the correct 155 rows depending on `BIND` and `OPTIONAL`
 * scoping inside Blazegraph. A query here is a measured artefact, not a
 * detail.
 *
 * @param {{ name: string, property: string, fields: string[], columns: string[], batch: number }} property
 * @param {string[]} codes
 * @returns {string}
 */
export function buildQuery(property, codes) {
  switch (property.name) {
    // The universe. Bounded by `VALUES` rather than left as an unbounded
    // `?item wdt:P297 ?code`, because unbounded returns 259 codes including
    // the historical DD (East Germany), YU (Yugoslavia) and AN (Netherlands
    // Antilles) and the uninhabited AQ/BV/HM — measured 2026-08-27, and the
    // app ships a city shard for none of them. Bounded, the answer is the
    // intersection, and a code Wikidata has stopped coding drops out where the
    // count band sees it.
    //
    // The FILTER is not a stylistic choice and must not be "simplified" back
    // into `?item wdt:P297 ?code`. Measured against the live endpoint on
    // 2026-08-27, that direct form returns HTTP 200 with a CSV header and ZERO
    // rows for the same 246 codes this form answers in full — Blazegraph binds
    // the VALUES set straight into the object position and the join misses,
    // while every other query here escapes it only because it carries further
    // triples on `?c`. This is Investigation 3's `BIND`/`OPTIONAL` scoping
    // hazard, in the one place where a wrong answer is a total wipe rather
    // than a thin field, and it was caught by the count band throwing "5
    // countries carry facts, expected 246" on the first real run rather than
    // by reading the query.
    case 'codes':
      return `SELECT DISTINCT ?code WHERE {
  ${valuesClause('code', codes)}
  ?item wdt:P297 ?isoCode .
  FILTER(?isoCode = ?code)
}`;

    // The country's own label. One triple and a label, and the label is the
    // whole point: `?c` here is the item whose P297 is the ISO code, so the
    // name is the name of the exact entity every other query in this file
    // joins through - NL's is "Kingdom of the Netherlands" for the same reason
    // its P38 answers EUR/USD/AWG/XCG, and that consistency is worth more than
    // a prettier name from a second item nothing else here speaks about.
    case 'name':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ${labelWithMulFallback('?c', 'value')}
}`;

    // P38 -> P498. The name is the currency item's own label, so `EUR` and
    // "euro" always come from one item and can never be paired across two.
    case 'currency':
      return `SELECT DISTINCT ?country ?code ?name WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P38 ?currency .
  ?currency wdt:P498 ?code .
  ${labelWithMulFallback('?currency', 'name')}
}`;

    // `?item` is selected as well as its label because `DROPPED_PLUG_ITEMS`
    // acts on the Q-id: dropping the Wikipedia article by id survives an
    // upstream label edit, and dropping it by label would not.
    case 'plugs':
      return `SELECT DISTINCT ?country ?item ?itemLabel WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P2853 ?item .
  ${labelWithMulFallback('?item', 'itemLabel')}
}`;

    case 'voltage':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P2884 ?value .
}`;

    // P1622's values are items whose labels are the bare words "left" and
    // "right" — measured 2026-08-27, 170 right / 77 left over 246 countries.
    // The 247th row is AR, which carries both because Argentina drove on the
    // left until 1945; `pickDrivingSide` withholds it, and that is the whole
    // of the design's unexplained 246 -> 245.
    case 'drivingSide':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P1622 ?side .
  ${labelWithMulFallback('?side', 'value')}
}`;

    // Statement-level, because the ROLE is a P366 qualifier on the statement
    // and `wdt:` throws qualifiers away. `?st a wikibase:BestRank` is the
    // truthy filter a `wdt:` path would have given for free — without it,
    // superseded emergency numbers come back as current ones.
    //
    // The OPTIONAL wraps the qualifier AND its label together, so a role whose
    // item has no label leaves `?role` unbound rather than dropping the number
    // — a number with no role still reaches `pickEmergency`, which is what
    // keeps the 67 single-number countries publishable.
    case 'emergency':
      return `SELECT DISTINCT ?country ?number ?role WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c p:P2852 ?st .
  ?st a wikibase:BestRank .
  ?st ps:P2852 ?num .
  ${labelWithMulFallback('?num', 'number')}
  OPTIONAL {
    ?st pq:P366 ?use .
    ${labelWithMulFallback('?use', 'role')}
  }
}`;

    // Statement-level, and NOT `wdt:P37`, because the thing that makes a P37
    // value publishable is a QUALIFIER and `wdt:` throws qualifiers away.
    // `P518 applies to part` is upstream saying, on the statement itself, that
    // this is not a claim about the whole country: every truthy P37 statement
    // the United States carries is scoped to a territory, so the `wdt:` form
    // published "Carolinian, Chamorro, Hawaiian, Samoan and Spanish are
    // official languages" about the US. `?scoped` carries that fact out to
    // `pickLanguages`, which withholds the whole field — the withhold decision
    // stays in reviewed JavaScript where the diagnostics and the gate can see
    // it, rather than disappearing into a FILTER whose effect nothing can
    // count.
    //
    // `?st a wikibase:BestRank` is the truthy filter `wdt:` would have given
    // for free, and it matters here beyond tidiness: US English is DEPRECATED
    // rank ("wrong property", disputed by the Constitution, subject of
    // Executive Order 14224), so it is absent from both forms and no rule in
    // this file may pretend otherwise.
    //
    // `P1001 applies to jurisdiction` is the other qualifier that would mean
    // the same thing. Measured 2026-08-27 across all 246 codes, it appears on
    // ZERO P37 statements, so it deliberately gets no clause — see
    // `PLUG_LETTERS` on the dead `Type D`/`Type M` rows.
    //
    // `?item` is selected as well as its label for `pickPlugs`'s reason:
    // `DROPPED_LANGUAGE_ITEMS` acts on the Q-id, so dropping Guinea's
    // "languages of Guinea" meta-item, or Norway's two written forms, survives
    // an upstream label edit while dropping them by label would not.
    //
    // Measured 2026-08-27: this form returns 451 rows over 243 countries, the
    // same as the `wdt:` form it replaces, so the batch density in
    // `PROPERTIES` is unchanged.
    case 'languages':
      return `SELECT DISTINCT ?country ?item ?value ?scoped WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c p:P37 ?st .
  ?st a wikibase:BestRank .
  ?st ps:P37 ?item .
  ${labelWithMulFallback('?item', 'value')}
  BIND(EXISTS { ?st pq:P518 ?part } AS ?scoped)
}`;

    case 'callingCode':
      return `SELECT DISTINCT ?country ?value WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c wdt:P474 ?value .
}`;

    // Statement-level again, for the value NODE: `wdt:P625` hands back a WKT
    // point that would have to be parsed by hand, while `psv:` exposes the
    // latitude Wikidata already decomposed. `a wikibase:BestRank` keeps
    // superseded centroids out, which is what makes every country's answer
    // single-valued — `pickLatitude` withholds on anything else.
    case 'coordinate':
      return `SELECT DISTINCT ?country ?lat WHERE {
  ${valuesClause('country', codes)}
  ?c wdt:P297 ?country .
  ?c p:P625 ?st .
  ?st a wikibase:BestRank .
  ?st psv:P625 ?node .
  ?node wikibase:geoLatitude ?lat .
}`;

    default:
      throw new Error(`no SPARQL query is defined for property "${property.name}"`);
  }
}

/** `codes` split into `size`-long batches, in order. */
export function batchCodes(codes, size) {
  const batches = [];
  for (let i = 0; i < codes.length; i += Math.max(1, size)) batches.push(codes.slice(i, i + Math.max(1, size)));
  return batches;
}

/**
 * One property's rows, in batches.
 *
 * One request per property rather than one joined query, because that is the
 * granularity demotion needs: a single joined query makes one property's
 * bail-out indistinguishable from every property failing, and the whole
 * carry-forward defence rests on being able to tell them apart.
 *
 * A batch that fails THROWS the whole property rather than returning what the
 * other batches managed. Partial rows are the Task 7 shape at a smaller scale:
 * they would arrive as an ordinary answer covering four fifths of the world,
 * and `isPropertyAnswerPlausible` would wave through anything above 80%.
 * Failing the property routes it to demotion and carry-forward instead, which
 * loses one night's freshness rather than a field.
 *
 * @param {string} name
 * @param {string[]} codes
 * @returns {Promise<Row[]>}
 */
async function fetchPropertyRows(name, codes) {
  const property = PROPERTIES.find((entry) => entry.name === name);
  if (!property) throw new Error(`unknown property query "${name}"`);
  const batches = batchCodes(codes, property.batch);
  /** @type {Row[]} */
  const rows = [];
  for (const [index, batch] of batches.entries()) {
    if (rows.length > 0 || index > 0) await sleep(POLITENESS_DELAY_MS);
    const started = Date.now();
    const text = await fetchWithRetry(SPARQL_ENDPOINT, {
      body: `query=${encodeURIComponent(buildQuery(property, batch))}`,
      accept: 'text/csv',
    });
    const parsed = parseBindings(text, property.columns);
    rows.push(...parsed);
    console.log(
      `  ${property.property} ${name} batch ${index + 1}/${batches.length} ` +
      `(${batch.length} codes): ${parsed.length} rows in ${Date.now() - started}ms`
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// run — the seam between the pure build and its network/filesystem edges
// ---------------------------------------------------------------------------

/**
 * Everything `node scripts/ingest-country-facts.mjs` does, minus the entry
 * guard.
 *
 * `fetchBindings` and `dataDir` are injectable so a test can drive the real
 * build-then-gate-then-write ordering end to end — fake upstream answers in,
 * real `assertFactsSane`, real `writeFileAtomic` calls out — without touching
 * Wikidata or `data/`. That is the only way to pin a gate's CALL SITE:
 * scripts/enrich-cities.mjs's `assertEnrichmentSane` had its body fully tested
 * while deleting the one line that invoked it left the suite green and
 * produced a complete wipe at exit 0. The entry guard below calls `run()` with
 * no arguments, so every parameter defaults to the real implementation.
 *
 * `mkdirSync` sits BELOW the gate, unlike scripts/ingest-cities.mjs where it
 * runs first (a tracked finding recorded at
 * scripts/ingest-cities.test.ts:1339-1341). A rejected run must leave no trace
 * at all, and a directory created before the gate is one — which also makes
 * "nothing was written" checkable by a test rather than merely asserted here.
 *
 * @param {{ fetchBindings?: (name: string, codes: string[]) => Promise<Row[]>, dataDir?: string }} [options]
 */
export async function run({ fetchBindings = fetchPropertyRows, dataDir = DATA_DIR } = {}) {
  const factsPath = join(dataDir, FACTS_FILE);
  const reportPath = join(dataDir, REPORT_FILE);

  // Read BEFORE the network, for two reasons. An unreadable artifact has to
  // abort before a single request is made rather than after nine of them, and
  // every property's answer is judged against how many countries already
  // carried the fields it feeds.
  const previous = readJson(factsPath);

  /** @type {Record<string, Row[]>} */
  const byProperty = {};
  const demoted = [];
  /**
   * What the later property queries batch over. Starts as the codes this
   * build ASKS about and narrows to the codes Wikidata ANSWERED with, so a
   * code upstream has stopped carrying is never queried for the other eight
   * properties — and, because `buildFacts` takes the universe from the same
   * answer, never lands in the artifact either.
   */
  let universe = COUNTRY_CODES;
  for (const property of PROPERTIES) {
    const previouslyCovered = countPreviousCoverage(previous, property.fields);
    /** @type {Row[] | null} */
    let rows = null;
    try {
      rows = await fetchBindings(property.name, universe);
    } catch (error) {
      console.warn(`  ${property.name} (${property.property}) failed: ${String(error.message).slice(0, 160)}`);
    }
    if (property.name === 'codes') {
      // The country universe is not a field anything can carry forward: with
      // no codes there is nothing to build, and building from the previous
      // artifact's key set would make a total outage look like a quiet night.
      if (rows === null) {
        throw new Error(
          `the country-code query (${property.property}) failed — without it there is no country ` +
          `universe to build against, and reusing the previous artifact's keys would make a ` +
          `total outage look like a quiet night`
        );
      }
      byProperty.codes = rows;
      universe = [...new Set(rows.map((row) => String(row.code ?? '').trim()).filter((code) => code !== ''))].sort();
      continue;
    }
    const answered = rows === null ? 0 : countAnsweredCountries(rows);
    if (rows !== null && isPropertyAnswerPlausible(answered, previouslyCovered)) {
      byProperty[property.name] = rows;
      continue;
    }
    demoted.push(property);
    byProperty[property.name] = [];
    console.warn(
      `  ${property.name} (${property.property}) answered for ${answered} countries but ` +
      `${previouslyCovered} carried it last run — demoted; those values are carried forward, ` +
      `not deleted`
    );
  }

  const built = buildFacts(byProperty);
  // Curated first, so staleness is judged against the upstream answer alone —
  // carry-forward would otherwise restore last night's curated value and make
  // every override look stale the moment its property has a bad night.
  applyCurated(built);
  for (const property of demoted) carryForwardFields(built, previous, property.fields);

  assertFactsSane(built, previous);

  // Below the gate. Nothing about a rejected run may reach the filesystem,
  // including an empty directory.
  mkdirSync(dataDir, { recursive: true });

  const now = new Date().toISOString();
  const payload = stampedPayload(
    previous,
    { source: SOURCE_NAME, license: SOURCE_LICENSE, countries: built.countries },
    now
  );
  writeFileAtomic(factsPath, JSON.stringify(payload));
  // `scopedLanguages` is null, not `[]`, when P37 was demoted: the diagnostic
  // is empty on such a night because nothing was measured, and the report must
  // not read that as "nothing was scoped". See `languageGap` in `buildReport`.
  const languagesDemoted = demoted.some((property) => property.fields.includes('officialLanguages'));
  writeFileAtomic(
    reportPath,
    buildReport({
      countries: built.countries,
      generatedAt: payload.generatedAt,
      scopedLanguages: languagesDemoted ? null : built.diagnostics.scopedLanguages,
    })
  );

  const total = Object.values(built.countries).reduce((sum, record) => sum + factCount(record), 0);
  console.log(
    `Wrote ${factsPath} (${Object.keys(built.countries).length} countries, ${total} facts` +
    `${payload.generatedAt === now ? '' : ', unchanged'})`
  );
  if (demoted.length > 0) {
    console.log(`  carried forward: ${demoted.map((property) => property.name).join(', ')}`);
  }
  if (built.diagnostics.curatedFired.length > 0) {
    console.log(`  curated overrides fired: ${built.diagnostics.curatedFired.join(', ')}`);
  }
  console.log(`Wrote ${reportPath}`);
}

/**
 * Only runs when this file is invoked directly.
 *
 * Without this guard, importing the module to test one of its rules re-runs
 * the whole ingest as an import side effect — not hypothetical; it happened
 * during review of ingest-airports.mjs. `run()` is exported and can be called
 * directly with fake loaders for exactly that kind of test.
 *
 * Compared as file URLs rather than as paths because on Windows
 * `process.argv[1]` is a drive path while `import.meta.url` is a `file://`
 * URL, so comparing them directly would never match and running the script
 * would silently do nothing. `process.argv[1]` is checked for existence first
 * because it is undefined under `node --eval`, where `pathToFileURL(undefined)`
 * throws.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`\nCountry facts ingestion failed: ${error.message}`);
    console.error('Nothing was written — the previous artifact is untouched.');
    process.exit(1);
  });
}
