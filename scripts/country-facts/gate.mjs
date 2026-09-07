/**
 * ingest-country-facts — the build gate that runs before the first write.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs, and `assertFactsSane` is still called
 * there before `mkdirSync` and before any write primitive fires.
 *
 * .github/workflows/refresh-cities.yml names this file for that reason:
 * `assertFactsSane`'s throw sites are the ones below.
 */

import {
  FACT_FIELDS,
  RECORD_FIELDS,
  RENDERED_FIELDS,
  factCount,
} from './facts.mjs';
import {
  DROPPED_LANGUAGE_ITEMS,
  DROPPED_PLUG_ITEMS,
  EMERGENCY_NUMBER,
  EMERGENCY_ROLE_SET,
  MAX_EMERGENCY_ENTRIES,
  MAX_LANGUAGES,
  MAX_PLUGS,
  MAX_TEXT_CHARS,
  MAX_VOLTAGE_V,
  MIN_VOLTAGE_V,
  PLUG_LETTER_SET,
} from './picks.mjs';

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
 * MEASURED, and now DERIVED rather than described. `MEASURED_FIELD_COVERAGE`
 * below is the shipping query's own post-withhold coverage OF THE COMMITTED
 * ARTIFACT, out of 246. Eight of the ten floors are written as that number
 * less `FIELD_HEADROOM`, so the arithmetic is executable and a reader
 * recomputes it rather than trusting it. The two floors written as LITERALS
 * are the two deliberate deviations, and the code shape is the tell: a literal
 * floor is a pinned judgement that must NOT follow a future measurement down.
 *
 * The table used to live in this comment as prose, and five of its numbers had
 * gone stale against the file they described — one of them promising a safety
 * margin the gate does not actually deliver. Hence it is code now. Headroom
 * for any row is `MEASURED_FIELD_COVERAGE[f] - MIN_FIELD_COVERAGE[f]`, and
 * `ingest-country-facts.test.ts` asserts the uniform rule, both deviations,
 * and the exact count at which the gate flips.
 *
 * Three rows moved against Task 24's provisional guesses and each is a
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
 * `officialLanguages` IS PINNED AT 233 AND DOES NOT MOVE WITH ITS
 * MEASUREMENT. Task 25 measured 243. The territorial-scope rule in
 * `pickLanguages` then withheld the whole field from six countries whose only
 * P37 statements upstream itself marks as applying to part of the country —
 * and the United States one published a flat falsehood — taking the row to
 * 237. Commit 017468c gave two of those six back by hand (`CURATED_FACTS`' BE
 * and AZ rows, whose qualifiers name a language region or a language VARIETY
 * rather than a territory beside the country), so it measures 239 today and
 * the countries without the field are AF, BQ, GP, MQ, PW, US and UY — three of
 * which upstream simply has no P37 for and which never lost anything.
 *
 * Under the uniform rule this row would read 229. It stays at 233, because
 * lowering a gate to admit the fix that tripped it is how a gate becomes
 * decoration.
 *
 * THE MARGIN THAT LEAVES, STATED CORRECTLY, because the previous version of
 * this sentence was wrong in the UNSAFE direction: 239 - 233 = 6, and the gate
 * is `covered < floor`. So SIX countries can lose their languages and the
 * nightly job still PASSES — it lands exactly ON the floor, not under it — and
 * the SEVENTH is the one that stops it. The old comment promised six would
 * stop it, a margin one country wider than the code delivers. Six is tighter
 * than the eight uniform rows and looser than `name`'s two.
 *
 * Six silent losses is more than I would choose. The floor is deliberately
 * left alone anyway: RAISING it is a judgement about how much of the world may
 * quietly go quiet overnight, it belongs to a human with the nightly job's
 * history in front of them, and a floor that is wrong but fails loudly beats a
 * floor nobody chose. What is fixed here is that the margin is now stated
 * correctly and asserted in a test, so whoever touches it next is choosing
 * rather than inheriting a false one.
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
export const MEASURED_FIELD_COVERAGE = {
  name: 246,
  currencyCode: 239,
  currencyName: 239,
  plugs: 207,
  voltageV: 221,
  drivingSide: 245,
  emergency: 221,
  officialLanguages: 239,
  callingCode: 237,
  lat: 246,
};

/** Countries of slack under the measurement, for every row that takes the rule. */
const FIELD_HEADROOM = 10;

export const MIN_FIELD_COVERAGE = {
  /** PINNED. See the `name` paragraph above — the rule would say 236. */
  name: 244,
  currencyCode: MEASURED_FIELD_COVERAGE.currencyCode - FIELD_HEADROOM,
  currencyName: MEASURED_FIELD_COVERAGE.currencyName - FIELD_HEADROOM,
  plugs: MEASURED_FIELD_COVERAGE.plugs - FIELD_HEADROOM,
  voltageV: MEASURED_FIELD_COVERAGE.voltageV - FIELD_HEADROOM,
  drivingSide: MEASURED_FIELD_COVERAGE.drivingSide - FIELD_HEADROOM,
  emergency: MEASURED_FIELD_COVERAGE.emergency - FIELD_HEADROOM,
  /** PINNED. See the `officialLanguages` paragraph above — the rule would say 229. */
  officialLanguages: 233,
  callingCode: MEASURED_FIELD_COVERAGE.callingCode - FIELD_HEADROOM,
  lat: MEASURED_FIELD_COVERAGE.lat - FIELD_HEADROOM,
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

