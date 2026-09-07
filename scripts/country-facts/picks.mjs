/**
 * ingest-country-facts — the upstream lookup tables, the ceilings, and the
 * nine per-field pickers with their four landmines.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs.
 *
 * This is the top of that file's `// Pure build` section, down to but not
 * including `FACT_FIELDS`; the rest of that section is
 * scripts/country-facts/facts.mjs and scripts/country-facts/curated.mjs.
 *
 * The `EmergencyNumber` typedef below is a byte-identical copy of the one that
 * stayed in scripts/ingest-country-facts.mjs, for the reason its twin in
 * scripts/country-facts/parse.mjs gives.
 */

import { collapse, entityId } from './parse.mjs';

/**
 * One emergency number and the role its P366 qualifier gave it. `role` is null
 * only on the single-number path, where there is no ambiguity to resolve.
 * @typedef {{ number: string, role: string | null }} EmergencyNumber
 */

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
export const EMERGENCY_NUMBER = /^[0-9]{2,6}$/;

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
export const MIN_VOLTAGE_V = 100;
export const MAX_VOLTAGE_V = 260;
/** Genuine dual-voltage countries exist (BO 230/115, BR 220/127); triples do not. */
const MAX_DISTINCT_VOLTAGES = 2;
/** Bolivia's P37 lists 37 languages, so this is a reshape ceiling, not a taste one. */
export const MAX_LANGUAGES = 40;
export const MAX_PLUGS = 8;
export const MAX_EMERGENCY_ENTRIES = 8;
/** Longest any single upstream label may be before it reads as a leaked blob. */
export const MAX_TEXT_CHARS = 80;

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
 * supplies a hand-verified answer for the six that matter.
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

