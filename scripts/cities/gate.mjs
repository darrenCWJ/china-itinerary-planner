/**
 * ingest-cities — the build gate.
 *
 * Moved verbatim out of scripts/ingest-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-cities.mjs.
 */

import { CITIES_PER_COUNTRY } from './build.mjs';

// ---------------------------------------------------------------------------
// The build gate
// ---------------------------------------------------------------------------

/**
 * Measured 2026-08-25: 246 countries, 59,073 cities.
 *
 * The country count is an EXACT expectation with a small tolerance, not a
 * floor. Spec §2.2 requires it: cities500 has 246 countries — the 244 in
 * cities15000 plus IO (British Indian Ocean Territory, 2 cities) and TK
 * (Tokelau, 3). A floor of 240 would let a first run write 241 countries and
 * then baseline every later run against 241, and `previous` is null exactly on
 * that first run, so the "a country is gone" check below cannot cover for it.
 *
 * The tolerance is for a territory GeoNames genuinely adds or retires, and
 * moving it means re-measuring. Note that 244 — cities15000's count — sits
 * INSIDE the tolerance, which is why `REQUIRED_COUNTRY_CODES` exists.
 */
export const EXPECTED_COUNTRIES = 246;
const COUNTRY_TOLERANCE = 2;
/**
 * The two countries cities500 has and cities15000 does not. Their absence
 * means the wrong dump was fetched — a failure the count check cannot see,
 * because 244 is within tolerance of 246.
 */
export const REQUIRED_COUNTRY_CODES = ['IO', 'TK'];
/**
 * Measured 2026-08-25: 59,073 cities. An EXACT expectation with a percentage
 * band, mirroring `EXPECTED_COUNTRIES` above, and for the same reason: a bare
 * floor only ever catches a feed that shrank. cities1000 or cities500
 * ingested without the per-country cut produces 184,500 rows — 3.1x real —
 * and on a first run (`previous === null`) this is the ONLY bound in play, so
 * a floor alone would wave it straight through.
 */
export const EXPECTED_CITIES = 59_073;
const CITY_COUNT_TOLERANCE_RATIO = 0.25;
const MAX_SHRINK_RATIO = 0.10;
const MAX_GROWTH_RATIO = 0.10;
/** Measured: admin1CodesASCII.txt parses to 3,865 entries. */
const EXPECTED_ADMIN1_NAMES = 3_865;
const MIN_ADMIN1_NAMES = 3_000;
/**
 * Measured 2026-08-25: 58,634/59,073 rows (99.26%) resolve a non-null admin-1
 * name. `assertAdmin1Sane` only checks the SIZE of the admin1 Map — a
 * reshaped key column in admin1CodesASCII.txt still yields a full-size Map
 * that matches nothing in `buildCities`'s lookup, so every `a1` goes null and
 * that check passes regardless. This floor is what actually inspects the
 * joined result. 90% leaves 9 points of headroom below the measured rate
 * while sitting far above the ~0% a reshape produces.
 */
const MIN_ADMIN1_RESOLVED_SHARE = 0.9;
/**
 * Measured 2026-08-29: 99.25% of rows carry an admin-1 code. The floor sits
 * far below that because 19 countries genuinely have no subdivision to
 * record — it is a collapse detector, not a quality bar.
 */
const MIN_ADMIN1_CODED_SHARE = 0.8;
/**
 * Measured 2026-08-25: 4,722/59,073 rows (7.99%) GLOBALLY have population 0.
 * This MUST stay a global share, never a per-country one: real per-country
 * rates legitimately reach 84% (Mongolia, 279/332), 81% (Yemen), 77%
 * (Ecuador), 67% (Angola), and a per-country ceiling would abort on healthy
 * data. 25% is triple the measured global rate, comfortably below the 100% an
 * all-blank population column produces feed-wide — at which point every row
 * scores on `altNameCount` alone, which `cityScore`'s own doc calls an
 * inadequate separator.
 */
const MAX_ZERO_POPULATION_SHARE = 0.25;

/**
 * Cities the design was validated against, by geonameid rather than by name.
 *
 * By id because names are not unique: Peru has two cities called Cusco —
 * G3941584 (population 428,450, rank 2) and G3697554 (population 0, 1,400 km
 * north) — and a name-keyed fixture would pass on the wrong one.
 */
export const REQUIRED_CITIES = [
  { country: 'PE', id: 'G3941584', name: 'Cusco' },
  { country: 'CH', id: 'G2657928', name: 'Zermatt' },
  { country: 'JP', id: 'G1857910', name: 'Kyoto' },
];

/**
 * The other direction of the same fixture: cities that must NOT be in a shard
 * because an existing Wikidata record already covers them.
 *
 * Jinan is the case. GeoNames' G1805753 sits 1.2 km from the catalog's
 * Q170247, so dedup drops it and the app keeps the record with a description,
 * an image and interest tags. If dedup silently stops working, Jinan does not
 * disappear — it doubles, and the map draws two of it a kilometre apart, which
 * no count check would ever notice.
 */
export const REQUIRED_DEDUPED = [
  { country: 'CN', id: 'G1805753', name: 'Jinan', qid: 'Q170247' },
];

/**
 * Everything a corrupt or reshaped upstream feed could slip through
 * unattended, checked BEFORE anything is written.
 *
 * `scripts/ingest-destinations.mjs` writes its outputs even when checks fail,
 * so they can be inspected. That is the wrong choice here for the same reason
 * it is wrong in ingest-airports.mjs: a workflow commits what this writes and
 * Vercel deploys the commit. A corrupt city catalog is not useful for
 * inspection, it is a production incident.
 */
export function assertSane(shards, previous) {
  if (Math.abs(shards.size - EXPECTED_COUNTRIES) > COUNTRY_TOLERANCE) {
    throw new Error(
      `${shards.size} countries produced a shard, expected ${EXPECTED_COUNTRIES} ` +
      `(+/-${COUNTRY_TOLERANCE}) — the dump's country set has reshaped`
    );
  }
  for (const code of REQUIRED_COUNTRY_CODES) {
    if (!shards.has(code)) {
      throw new Error(
        `${code} has no shard — it is one of the two countries cities500 has and ` +
        `cities15000 does not, so its absence means the wrong dump was fetched. ` +
        `The count check cannot catch this: 244 is inside the tolerance around ${EXPECTED_COUNTRIES}.`
      );
    }
  }

  let total = 0;
  let admin1Resolved = 0;
  // Counted separately from `a1`, not folded into it: the name and the code
  // come from the same lookup but are emitted by different expressions, and a
  // gate on the name alone would stay green while the code went all-null —
  // silently removing the field the province join depends on.
  let admin1Coded = 0;
  let zeroPopulation = 0;
  for (const [country, cities] of shards) {
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new Error(
        `malformed country code "${country}" — expected two uppercase letters ` +
        `(the dump's iso_country may have switched to alpha-3)`
      );
    }
    if (cities.length > CITIES_PER_COUNTRY) {
      throw new Error(
        `${country} has ${cities.length} cities, over the ${CITIES_PER_COUNTRY} limit — ` +
        `the per-country cut did not run`
      );
    }
    const seen = new Set();
    let previousPopulation = Infinity;
    for (const city of cities) {
      if (!/^G[1-9][0-9]*$/.test(city.id)) {
        throw new Error(
          `${country} has a malformed city id "${city.id}" — expected "G" + geonameid. ` +
          `A bare integer or a Q-id here merges the GeoNames and Wikidata namespaces, ` +
          `which is how a tap resolves to the wrong city.`
        );
      }
      if (seen.has(city.id)) throw new Error(`duplicate city id ${city.id} in ${country}`);
      seen.add(city.id);
      if (city.n.trim() === '') throw new Error(`${country} city ${city.id} has an empty name`);
      if (!Number.isFinite(city.lat) || city.lat < -90 || city.lat > 90) {
        throw new Error(
          `${country} city ${city.id} has an out-of-range latitude ${city.lat} — expected -90..90`
        );
      }
      if (!Number.isFinite(city.lon) || city.lon < -180 || city.lon > 180) {
        throw new Error(
          `${country} city ${city.id} has an out-of-range longitude ${city.lon} — expected -180..180`
        );
      }
      if (!Number.isFinite(city.p) || city.p < 0) {
        throw new Error(`${country} city ${city.id} has a non-finite or negative population ${city.p}`);
      }
      if (city.p > previousPopulation) {
        throw new Error(
          `${country} is not in descending population order — display order is what the UI ` +
          `renders without re-sorting, so a shard that loses it looks like a browser bug`
        );
      }
      previousPopulation = city.p;
      if (city.a1 !== null) admin1Resolved++;
      // `typeof === 'string'`, not `!== null`: the failure this gate is for is
      // `buildCities` dropping the field, and then every row reads `undefined`
      // — which `!== null` counts as present.
      if (typeof city.a1c === 'string') admin1Coded++;
      if (city.p === 0) zeroPopulation++;
    }
    total += cities.length;
  }

  const cityFloor = Math.round(EXPECTED_CITIES * (1 - CITY_COUNT_TOLERANCE_RATIO));
  const cityCeiling = Math.round(EXPECTED_CITIES * (1 + CITY_COUNT_TOLERANCE_RATIO));
  if (total < cityFloor) {
    throw new Error(
      `only ${total} cities passed the filter, expected at least ${cityFloor} ` +
      `(${EXPECTED_CITIES} +/-${CITY_COUNT_TOLERANCE_RATIO * 100}%)`
    );
  }
  if (total > cityCeiling) {
    throw new Error(
      `${total} cities passed the filter, over the ${cityCeiling} ceiling ` +
      `(${EXPECTED_CITIES} +/-${CITY_COUNT_TOLERANCE_RATIO * 100}%) — this is what cities1000 or ` +
      `cities500 ingested without the per-country cut looks like`
    );
  }

  if (total > 0) {
    const admin1Share = admin1Resolved / total;
    if (admin1Share < MIN_ADMIN1_RESOLVED_SHARE) {
      throw new Error(
        `only ${(admin1Share * 100).toFixed(1)}% of cities resolved a non-null admin-1 name, ` +
        `expected at least ${MIN_ADMIN1_RESOLVED_SHARE * 100}% — admin1CodesASCII.txt may have ` +
        `reshaped its key column, which a Map of the right SIZE cannot reveal`
      );
    }
    const codedShare = admin1Coded / total;
    if (codedShare < MIN_ADMIN1_CODED_SHARE) {
      throw new Error(
        `a1c coverage collapsed: ${admin1Coded}/${total} rows ` +
        `(${(codedShare * 100).toFixed(1)}%) carry an admin-1 code, expected at least ` +
        `${MIN_ADMIN1_CODED_SHARE * 100}% — this is the field the province join reads, and ` +
        `the admin-1 NAME gate above cannot see it go`
      );
    }
    const zeroPopulationShare = zeroPopulation / total;
    if (zeroPopulationShare > MAX_ZERO_POPULATION_SHARE) {
      throw new Error(
        `${(zeroPopulationShare * 100).toFixed(1)}% of cities have population 0, over the ` +
        `${MAX_ZERO_POPULATION_SHARE * 100}% GLOBAL ceiling — the population column may have gone ` +
        `blank feed-wide`
      );
    }
  }

  for (const required of REQUIRED_CITIES) {
    const cities = shards.get(required.country) ?? [];
    if (!cities.some((city) => city.id === required.id)) {
      throw new Error(
        `${required.name} (${required.id}) is missing from the ${required.country} shard — ` +
        `the ranking no longer reaches the destinations this design was validated against`
      );
    }
  }
  for (const required of REQUIRED_DEDUPED) {
    const cities = shards.get(required.country) ?? [];
    if (cities.some((city) => city.id === required.id)) {
      throw new Error(
        `${required.name} (${required.id}) is in the ${required.country} shard but ${required.qid} ` +
        `already covers it — deduplication did not run, and the map will draw it twice`
      );
    }
  }

  if (!previous) return;

  const gone = previous.countries
    .map((entry) => entry.code)
    .filter((code) => !shards.has(code))
    .sort();
  if (gone.length > 0) {
    throw new Error(
      `${gone.length} country present last run is gone: ${gone.join(', ')} — ` +
      `a country that disappears takes its whole drill-down with it, and the total ` +
      `can stay inside the drift band while it happens`
    );
  }

  const before = previous.countries.reduce((sum, entry) => sum + entry.count, 0);
  if (before > 0) {
    const shrink = (before - total) / before;
    if (shrink > MAX_SHRINK_RATIO) {
      throw new Error(
        `city count fell ${(shrink * 100).toFixed(1)}% (${before} -> ${total}), ` +
        `over the ${MAX_SHRINK_RATIO * 100}% limit — upstream may be mid-rebuild`
      );
    }
    const growth = (total - before) / before;
    if (growth > MAX_GROWTH_RATIO) {
      throw new Error(
        `city count rose ${(growth * 100).toFixed(1)}% (${before} -> ${total}), ` +
        `over the ${MAX_GROWTH_RATIO * 100}% limit — upstream may have changed its filter`
      );
    }
  }
}

/**
 * The gate for the SECOND network source, checked before `buildCities` reads it.
 *
 * `admin1CodesASCII.txt` is not one of spec §3.1's six ingest steps — this plan
 * added it so `a1` reaches the user as "Valais" rather than "VS" — and nothing
 * else here would notice it going wrong. If the fetch succeeds but the file has
 * reshaped, `parseAdmin1Codes` returns a near-empty Map, every `a1` becomes
 * null, and all 59,073 cities quietly lose their province label while every
 * count, coordinate and fixture check still passes. The daily job then commits
 * that and Vercel deploys it.
 *
 * Separate from `assertSane` rather than a third parameter on it, so
 * `assertSane` keeps one signature everywhere and this can run earlier, before
 * `buildCities` has consumed the map.
 */
export function assertAdmin1Sane(admin1Codes) {
  if (admin1Codes.size < MIN_ADMIN1_NAMES) {
    throw new Error(
      `only ${admin1Codes.size} admin-1 names parsed, expected about ` +
      `${EXPECTED_ADMIN1_NAMES.toLocaleString('en-US')} — admin1CodesASCII.txt has reshaped, ` +
      `and every province label on every city would be null`
    );
  }
}

