/**
 * ingest-country-facts — the field lists, the property queries' shape, the
 * record build, and the demotion/carry-forward rules.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs.
 *
 * This is the rest of that file's `// Pure build` section, from `FACT_FIELDS`
 * down to the build gate, with one block lifted out of the middle: the
 * `CURATED_FACTS` table that sat between `buildFacts` and `applyCurated` is
 * now scripts/country-facts/curated.mjs and is imported below. The two halves
 * either side of it are joined here in their original order, unedited, so
 * `applyCurated` still reads immediately after the table's former position.
 *
 * The `EmergencyNumber`, `CountryFacts` and `Diagnostics` typedefs below are a
 * byte-identical copy of that file's, for the reason the twin in
 * scripts/country-facts/parse.mjs gives. `CountryFacts` annotates the records
 * this module builds and cannot be written without `EmergencyNumber`.
 */

import { CURATED_FACTS } from './curated.mjs';
import { collapse, groupByCountry } from './parse.mjs';
import {
  pickCallingCode,
  pickCurrency,
  pickDrivingSide,
  pickEmergency,
  pickLanguages,
  pickLatitude,
  pickName,
  pickPlugs,
  pickVoltage,
} from './picks.mjs';

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

