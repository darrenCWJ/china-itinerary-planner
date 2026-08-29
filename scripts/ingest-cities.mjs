#!/usr/bin/env node
/**
 * ingest-cities.mjs
 *
 * Builds the worldwide city catalog from GeoNames' cities500 dump: 246
 * per-country shards under public/cities/, a bundled id index under data/, and
 * data/cities-report.md.
 *
 * Population is the wrong axis. At population >= 15,000 every one of Zermatt,
 * Banff, Interlaken, Positano, Queenstown, Hallstatt, Oia, Chamonix, Hakone,
 * Sa Pa, Petra, Kotor and Giverny is absent from the app; the threshold that
 * contains Zermatt (6,629) also contains all 15,363 French communes. So the
 * cut is a composite score — alternate-name count plus twice the log of
 * population — ranked *within each country*, which compares a town against its
 * own national baseline rather than a global threshold. Cusco ranks 2/2,296 in
 * Peru; Kenya's top eight surface Malindi and Naivasha above larger
 * administrative cities.
 *
 * Ranking decides inclusion ONLY. Shards sort by population for display, so
 * the score's quirks never reach the UI. (Dunkirk outranks Lyon in France —
 * wartime fame inflates alternate names.)
 *
 * Rerunnable and idempotent per shard: a country whose 750 rows are unchanged
 * keeps its previous `generatedAt`, so its file is byte-identical and the
 * daily workflow commits only the countries that actually moved. That matters
 * more here than it did for airports: the full artifact set is ~6.5 MB across
 * 246 files, and rewriting all of them nightly would bloat the repo.
 *
 * Like ingest-airports.mjs and unlike ingest-destinations.mjs, this script
 * ABORTS BEFORE WRITING when a sanity check fails. The workflow commits what
 * this writes and Vercel deploys it unattended; a corrupt city catalog is not
 * useful for inspection.
 *
 * Licence: GeoNames is CC BY 4.0 — attribution required (and an indication that
 * the material was changed, which the top-750 filter and the admin-1 resolution
 * below both make it), and unlike OurAirports and Natural Earth it is not
 * public domain. The credit has to be visible in the UI, not just here;
 * components/plan/GeoNamesCredit.tsx renders it, and `buildReport` names the
 * files that mount it. lib/contracts.test.ts (C7) fails if one of them drops
 * it, and — because a written-down list cannot catch a surface added later —
 * also derives the set from the tree and fails on an uncredited new one.
 *
 * Usage: node scripts/ingest-cities.mjs
 *
 * It reads lib/geo.ts and lib/foldPlaceName.ts straight out of lib/, relying
 * on Node's native type stripping (stable since Node 22.18 / 24) so the
 * haversine and the name fold have exactly one definition each rather than a
 * copy here that could drift. Both are leaf modules with no imports of their
 * own, which is required: an extensionless `.ts` -> `.ts` import fails under
 * type stripping with ERR_MODULE_NOT_FOUND, and adding the extension inside
 * lib/ fails `tsc` with TS5097. Node prints a MODULE_TYPELESS_PACKAGE_JSON
 * warning for these imports because package.json has no `"type": "module"`;
 * the imports still work and the warning is not worth changing the package's
 * module type for.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { foldPlaceName } from '../lib/foldPlaceName.ts';
import { haversineKm } from '../lib/geo.ts';

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_LOCAL_SIG = 0x04034b50;
/** A ZIP comment is a 16-bit length, so the EOCD is never further back than this. */
const ZIP_MAX_COMMENT = 65_535;
/** cities500.txt inflates to 40.7 MB; this is headroom, not a target. */
const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

/**
 * The one member of a ZIP archive we want, inflated.
 *
 * Written by hand rather than adding a dependency, because every other ingest
 * script in this repo runs on Node built-ins alone and the nightly workflow
 * has no `npm ci` step as a result. `node:zlib` and `DecompressionStream`
 * handle raw deflate/gzip streams but neither can open a ZIP *container*:
 * the local file headers and the central directory have to be walked first,
 * and only then are the member's bytes a raw deflate stream `inflateRawSync`
 * understands.
 *
 * The central directory is walked rather than the local headers, because only
 * the central directory is authoritative about which members exist. But the
 * *local* header's extra-field length is what locates the payload — the two
 * lengths legitimately differ, and using the central one lands the read a few
 * bytes into the compressed data, which inflates to garbage rather than
 * erroring.
 */
export function readZipMember(buffer, memberName) {
  let eocd = -1;
  const floor = Math.max(0, buffer.length - ZIP_MAX_COMMENT - 22);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new Error('not a zip archive: no end-of-central-directory record found');
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (buffer.readUInt32LE(p) !== ZIP_CENTRAL_SIG) {
      throw new Error(`corrupt zip: central directory entry ${i} has no signature`);
    }
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    if (name === memberName) {
      if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIG) {
        throw new Error(`corrupt zip: ${name} has no local file header`);
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      // `Buffer.subarray` silently CLAMPS an out-of-range end rather than
      // throwing, so a central directory that lies about `compressedSize` (or
      // a `start` that already runs past the buffer) would otherwise splice
      // in whatever bytes happen to follow — e.g. the archive's own central
      // directory and EOCD — as if they were the member's real content. This
      // must be checked before the slice, not after: there is no exception to
      // catch once `subarray` has already clamped.
      if (start + compressedSize > buffer.length) {
        throw new Error(
          `corrupt zip: ${name} claims ${compressedSize} byte(s) starting at offset ${start}, ` +
          `but the archive is only ${buffer.length} byte(s)`
        );
      }
      const payload = buffer.subarray(start, start + compressedSize);
      if (method === 0) return payload;
      if (method === 8) return inflateRawSync(payload, { maxOutputLength: MAX_INFLATED_BYTES });
      throw new Error(
        `${name} uses unsupported zip compression method ${method} — expected 0 (stored) or 8 (deflate)`
      );
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${memberName} is not in the archive`);
}

// ---------------------------------------------------------------------------
// GeoNames TSV
// ---------------------------------------------------------------------------

/** cities500.txt has no header row, so the column map is a constant, not a lookup. */
const GEONAMES_COLUMNS = 19;
const COL = {
  geonameId: 0,
  name: 1,
  altNames: 3,
  lat: 4,
  lon: 5,
  country: 8,
  admin1: 10,
  population: 14,
  elevation: 15,
  dem: 16,
  timezone: 17,
};

/** A GeoNames integer column, or null when blank or unparseable. */
function integerOrNull(raw) {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}

/**
 * Every usable row of cities500.txt, as the record the rest of the build uses.
 *
 * A ragged line aborts — the dump has a fixed 19-column shape and a line that
 * does not is upstream changing format, which must be looked at rather than
 * read past. Everything else that merely fails a filter is dropped in silence,
 * the same split ingest-airports.mjs draws.
 */
export function parseGeoNamesRows(text) {
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') continue;
    const f = line.split('\t');
    if (f.length !== GEONAMES_COLUMNS) {
      throw new Error(
        `row has ${f.length} column(s), expected ${GEONAMES_COLUMNS} — aborting rather than ` +
        `reading undefined out of a ragged row (upstream may have changed the dump's shape)`
      );
    }
    const geonameId = f[COL.geonameId].trim();
    if (!/^[1-9][0-9]*$/.test(geonameId)) continue;
    const country = f[COL.country].trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) continue;
    const latStr = f[COL.lat].trim();
    const lonStr = f[COL.lon].trim();
    // A blank cell must be rejected before it ever reaches `Number()`:
    // `Number('')` is `0`, which `Number.isFinite` happily accepts, so a row
    // with a wiped-out coordinate would be planted at Null Island (0, 0) and
    // committed rather than dropped.
    if (latStr === '' || lonStr === '') continue;
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const populationStr = f[COL.population].trim();
    const population = populationStr === '' ? 0 : Number(populationStr);
    if (!Number.isFinite(population) || population < 0) continue;
    const altNames = f[COL.altNames];
    rows.push({
      id: `G${geonameId}`,
      name: f[COL.name].trim(),
      // `''.split(',')` is `['']` — length 1 — which would hand every unnamed
      // hamlet a free point of notability and shift the whole ranking.
      altNameCount: altNames === '' ? 0 : altNames.split(',').filter(Boolean).length,
      lat,
      lon,
      country,
      admin1Code: f[COL.admin1].trim(),
      population,
      // GeoNames leaves column 15 blank for most rows and carries a modelled
      // value in `dem`; the climate bias correction needs *an* elevation far
      // more than it needs a surveyed one. Null rather than 0 — sea level is
      // a real elevation, and 0 would put a Himalayan town at the coast.
      elevation: integerOrNull(f[COL.elevation]) ?? integerOrNull(f[COL.dem]),
      timezone: f[COL.timezone].trim(),
    });
  }
  return rows;
}

/**
 * `CC.CODE` -> admin-1 name, from GeoNames' admin1CodesASCII.txt.
 *
 * A Map rather than an object literal, so a code spelled like an Object member
 * ("constructor", "toString") cannot resolve through the prototype chain to a
 * function — the exact bug `sizeForType` in ingest-airports.mjs documents,
 * where a non-nullish inherited value slips past `?? null` and JSON.stringify
 * then silently drops the key from the committed record.
 *
 * Column 1 (the UTF-8 name) is taken rather than column 2 (the ASCII fold):
 * this value becomes `CatalogHit.province` and is rendered to the user, and
 * `foldPlaceName` already folds it at the one point search needs it folded.
 */
export function parseAdmin1Codes(text) {
  const codes = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') continue;
    const f = line.split('\t');
    if (f.length < 2) continue;
    const key = f[0].trim();
    const name = f[1].trim();
    if (key === '' || name === '') continue;
    codes.set(key, name);
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Cities kept per country. Measured: 750 from cities500 captures 13 of the 14
 * destinations a population >= 15,000 filter excluded entirely (all but
 * Giverny, which is a place you visit from Vernon rather than sleep in, and so
 * belongs in the attractions layer). Total across 246 countries: 59,073.
 */
export const CITIES_PER_COUNTRY = 750;

/**
 * The composite notability score, §2.1: `altNameCount + 2 * log10(population)`.
 *
 * `altNameCount` is the size of the alternate-names column already in the
 * dump — no second source and no extra fetch. Alone it is not a clean
 * separator (tourist towns run 9-26, communes 0-12, and they overlap); ranked
 * within a country it separates well, because it is compared against a local
 * baseline rather than a global threshold.
 *
 * Population is clamped to 1. `Math.log10(0)` is `-Infinity`, and adding any
 * finite alternate-name count to `-Infinity` is still `-Infinity`, so without
 * the clamp all 30,648 unpopulated rows tie at the bottom and the id tiebreak
 * — not notability — decides which of them make a small country's cut.
 */
export function cityScore(row) {
  return row.altNameCount + 2 * Math.log10(Math.max(1, row.population));
}

/**
 * Every country's kept rows, in ranking order.
 *
 * A Map, not an object: "CO" is a real country code and "constructor" is a
 * real string, and a plain object cannot tell an inherited member from a
 * missing key — see `parseAdmin1Codes` for the same reasoning.
 *
 * The id tiebreak is not cosmetic. GeoNames reorders rows between nightly
 * rebuilds, so two rows with an identical score would otherwise swap places
 * and rewrite a shard that carries no new data — which the daily workflow
 * would then commit.
 */
export function topPerCountry(rows, perCountry = CITIES_PER_COUNTRY) {
  const byCountry = new Map();
  for (const row of rows) {
    const list = byCountry.get(row.country);
    if (list) list.push(row);
    else byCountry.set(row.country, [row]);
  }
  const kept = new Map();
  for (const [country, list] of byCountry) {
    list.sort((a, b) => cityScore(b) - cityScore(a) || a.id.localeCompare(b.id));
    kept.set(country, list.slice(0, perCountry));
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Deduplication against the existing Wikidata catalog
// ---------------------------------------------------------------------------

/**
 * How close two records have to be to be the same city, given their names
 * already match. Cities are a few kilometres across and the two sources place
 * their centres differently — GeoNames puts Jinan at 36.66833/116.99722 and
 * Wikidata at 36.6667/116.9833, 1.2 km apart. 5 km covers that disagreement
 * without reaching the next town.
 */
export const DEDUP_RADIUS_KM = 5;

/**
 * The GeoNames rows that are NOT already in the Wikidata catalog.
 *
 * The 695 existing China cities keep their Wikidata QIDs so their descriptions,
 * images and interest tags survive and no trip data migrates — which means a
 * GeoNames row for the same place is a duplicate, and the QID record is the
 * richer one. Both halves of the test are needed: name alone collapses the two
 * distinct Peruvian Cuscos 1,400 km apart, and distance alone collapses a city
 * with its neighbouring district.
 *
 * Names fold through `foldPlaceName`, the same fold search uses, because the
 * two sources disagree about apostrophes and diacritics: 23 of the 695 catalog
 * names carry an apostrophe and 2 carry diacritics.
 *
 * Indexed by folded name so this is one pass rather than 695 x 750 haversines
 * per country, and stable: the kept rows come back in the order they arrived,
 * which is ranking order and is what decides who gets enriched.
 */
export function dropCatalogDuplicates(rows, catalogCities) {
  if (catalogCities.length === 0) return [...rows];
  const byName = new Map();
  for (const city of catalogCities) {
    const key = foldPlaceName(city.name);
    const list = byName.get(key);
    if (list) list.push(city);
    else byName.set(key, [city]);
  }
  return rows.filter((row) => {
    const twins = byName.get(foldPlaceName(row.name));
    if (!twins) return true;
    return !twins.some((twin) => haversineKm(row, twin) <= DEDUP_RADIUS_KM);
  });
}

// ---------------------------------------------------------------------------
// Shard construction
// ---------------------------------------------------------------------------

/**
 * Cities per country that get a Wikipedia summary and image at build time.
 * Measured total across 246 countries: 6,244 — fewer than 246 x 30 because
 * most countries have fewer than 30 cities in cities500. Everything else is
 * enriched lazily on first selection.
 */
export const ENRICH_PER_COUNTRY = 30;

/**
 * The per-country shards, plus the enrichment target list ranking order would
 * otherwise throw away.
 *
 * Order of operations is load-bearing: cut to `perCountry` FIRST, dedup
 * SECOND. Reversing them lets China backfill the 337 slots its QID cities
 * occupy with rank-751-and-below rows — 750 GeoNames cities on top of 695
 * Wikidata ones, which is not what "top 750 per country" means.
 *
 * `shards` are in display order (population descending) because §3.2 says the
 * score decides inclusion only and must never surface in the UI. `targets` are
 * in ranking order because notability, not size, is what makes a description
 * worth fetching ahead of time.
 */
export function buildCities(rows, admin1Codes, catalogCities, perCountry = CITIES_PER_COUNTRY) {
  const ranked = topPerCountry(rows, perCountry);
  const shards = new Map();
  const targets = new Map();
  let total = 0;
  for (const country of [...ranked.keys()].sort()) {
    const kept = dropCatalogDuplicates(ranked.get(country), catalogCities);
    // An empty shard is a file the client would fetch and learn nothing from.
    if (kept.length === 0) continue;
    targets.set(country, kept.slice(0, ENRICH_PER_COUNTRY).map((row) => row.id));
    const display = [...kept].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
    shards.set(
      country,
      display.map((row) => ({
        id: row.id,
        n: row.name,
        lat: row.lat,
        lon: row.lon,
        // `?? null`, not `?? row.admin1Code`: this value is rendered to the
        // user as a province, and "22" is not a province of Japan. A Map
        // lookup, so a code spelled "constructor" cannot resolve to a function.
        a1: admin1Codes.get(`${country}.${row.admin1Code}`) ?? null,
        // The code the name was resolved FROM. Kept because the name join to
        // Natural Earth admin-1 was measured at 63.4% with 35 countries at
        // zero, while this code matches `gn_a1_code` on 83% of features and
        // is the only way to verify a geometric assignment. A row with no
        // admin-1 gets null, never the dangling prefix `"PE."`.
        a1c: row.admin1Code === '' ? null : `${country}.${row.admin1Code}`,
        p: row.population,
        elev: row.elevation ?? null,
        tz: row.timezone,
      }))
    );
    total += display.length;
  }
  return { shards, targets, total };
}

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

// ---------------------------------------------------------------------------
// Paths, sources, network
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Defaults for `run()`'s `dataDir`/`shardDir` parameters — production's real
 * values. The five file paths under each (catalog, shard index, city index,
 * enrich targets, report) are derived from whichever `dataDir`/`shardDir`
 * `run()` actually receives, not from these constants directly, so a test can
 * point them at a scratch directory and never touch `data/` or
 * `public/cities/`.
 */
const DATA_DIR = join(ROOT_DIR, 'data');
const SHARD_DIR = join(ROOT_DIR, 'public', 'cities');

const CITIES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const CITIES_MEMBER = 'cities500.txt';
const ADMIN1_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';
/**
 * CC BY 4.0, not public domain — unlike OurAirports and Natural Earth. The
 * credit has to be visible in the UI as well as here; that is
 * components/plan/GeoNamesCredit.tsx — see `buildReport`'s Attribution section
 * below, which records where it renders and what guards it.
 */
const SOURCE_LICENSE = 'GeoNames cities500 (CC BY 4.0)';
const SOURCE_ATTRIBUTION = 'https://www.geonames.org/ — CC BY 4.0';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

/** 13.5 MB over a CI network. Airports' 120s is not enough headroom for it. */
const FETCH_TIMEOUT_MS = 300_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One retrying fetch for both sources, returning bytes or text.
 *
 * Global `fetch` plus `AbortSignal.timeout`, the same shape as
 * ingest-airports.mjs — no node-fetch, no undici import, nothing from
 * node_modules at all, which is what lets the workflow skip `npm ci`.
 */
async function fetchSource(url, { binary }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms (${error.message})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

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

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // an unreadable previous artifact is the same as none
  }
}

/**
 * One shard's file contents, with its timestamp preserved when nothing moved.
 *
 * Per shard rather than per run, because the run writes 246 files totalling
 * 6.5 MB and the workflow commits them. Stamping a fresh timestamp on all of
 * them every night would put 6.5 MB of pure noise into the repository daily;
 * this way only the countries whose 750 rows actually changed appear in
 * `git diff`.
 *
 * Only the rows are compared, never the envelope — comparing the whole object
 * would compare the timestamp against itself and never match.
 */
export function shardPayload(country, cities, previous, now) {
  const unchanged = previous !== null && JSON.stringify(previous.cities) === JSON.stringify(cities);
  return {
    country,
    generatedAt: unchanged ? previous.generatedAt : now,
    source: SOURCE_LICENSE,
    cities,
  };
}

/**
 * The same preserve-when-unchanged rule for the three run-level index files.
 *
 * `shardPayload` covers the 246 shards and nothing else, and all three of
 * `public/cities/index.json`, `data/cities-index.json` and
 * `data/cities-enrich-targets.json` sit inside `refresh-cities.yml`'s
 * commit-guard paths. Stamping `new Date()` on them unconditionally makes that
 * guard impossible to satisfy: it turns a commit-on-change job into a
 * commit-every-day job, and every commit is a production deploy plus a CI run.
 *
 * Compared on the PAYLOAD, never on the envelope — comparing the whole previous
 * object would compare the timestamp against itself and never match.
 *
 * `generatedAt` is spread first so the emitted key order matches what the
 * previous file had, which is what keeps the byte comparison above meaningful
 * and keeps index.json's diff readable.
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
 * The report describes the CATALOG, never the run.
 *
 * No "N shards changed this run" line, deliberately: that number is 246 on a
 * first run and 0 on a quiet one, which would make this file differ every time
 * the previous run's numbers differed — and this file is committed. It is
 * logged to the console instead, where per-run facts belong. Everything below
 * is a function of the shards alone, so a rebuild with no data change produces
 * a byte-identical report and `git status` stays clean.
 *
 * Exported (unlike the rest of `run()`'s internals) so `data/cities-report.md`
 * can be regenerated from the 246 shard files already on disk — e.g. after a
 * wording-only change to this function — without a full network ingest.
 */
export function buildReport({ shards, total, generatedAt, largest }) {
  const bySize = [...shards.entries()]
    .map(([code, cities]) => [code, cities.length])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15);
  return [
    '# Worldwide city catalog report',
    '',
    `- Generated: ${generatedAt}`,
    `- Source: ${CITIES_URL}`,
    `- Licence: ${SOURCE_LICENSE} — ${SOURCE_ATTRIBUTION}`,
    `- Filter: composite score (alternate names + 2 x log10 population), top ${CITIES_PER_COUNTRY} per country`,
    `- Deduplicated against data/catalog.json within ${DEDUP_RADIUS_KM} km on a folded name match`,
    '',
    `**${total} cities across ${shards.size} countries.**`,
    '',
    `Largest shard: ${largest.code} at ${(largest.bytes / 1024).toFixed(1)} KB raw.`,
    '',
    '## Attribution',
    '',
    'GeoNames data is licensed CC BY 4.0, which requires a visible credit AND an',
    'indication that the material was changed. It was: the filter above cuts each',
    'country to its top scorers, admin-1 codes are resolved to human-readable',
    'names, and near-duplicates of the curated catalog are dropped. Both the credit',
    'and the modification notice are rendered in the UI by',
    '`components/plan/GeoNamesCredit.tsx`, from these files:',
    '',
    '- `app/plan/page.tsx` — the planning wizard, beside the footer rather than',
    '  inside it, because that footer is `print:hidden` and the generated plan is',
    '  meant to be printed',
    '- `components/DestinationStep.tsx` — the destination step, under the search',
    '- `components/TripView.tsx` — twice: the member view and the join-code guest',
    '  view of the shared trip page',
    '- `app/b/[code]/page.tsx` — the bearer-link briefing',
    '- `components/shell/ShareBriefing.tsx` — the briefing behind Share › "View',
    '  briefing". It carries its own credit rather than inheriting one, because',
    '  nothing in its ancestry renders a credit: ShareMenu, then AppShell, then',
    '  the root layout, which wraps every route',
    '- `components/home/TripsDashboard.tsx` — the signed-in home page trip list',
    '',
    '`lib/contracts.test.ts` (C7) fails if one of the files listed above drops it.',
    'That list is not the whole guarantee, because a hardcoded list cannot catch a',
    'surface added later: C7 also derives the set, scanning every `.tsx` under',
    '`app/` and `components/` for the tokens that carry city names and requiring',
    'each match to either render the credit or sit on an explicit allowlist naming',
    'the parent surface that renders it instead.',
    '',
    'This file is NOT the credit and never was — a line in a generated report does',
    'not discharge CC BY 4.0. It records where the credit lives so that deleting',
    'the component is a visible break rather than a silent one.',
    '',
    '## Most cities by country',
    '',
    '| Country | Cities |',
    '| --- | --- |',
    ...bySize.map(([code, n]) => `| ${code} | ${n} |`),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Fetching the two network sources
// ---------------------------------------------------------------------------

/** Real `loadCitiesTsv`: fetch the zip, inflate it, decode the one member we want. */
async function fetchCitiesTsv() {
  console.log(`Fetching ${CITIES_URL} …`);
  const archive = await fetchSource(CITIES_URL, { binary: true });
  console.log(`  ${archive.length} bytes; inflating ${CITIES_MEMBER}`);
  return readZipMember(archive, CITIES_MEMBER).toString('utf8');
}

/** Real `loadAdmin1Text`: fetch admin1CodesASCII.txt as-is. */
async function fetchAdmin1Text() {
  console.log(`Fetching ${ADMIN1_URL} …`);
  return fetchSource(ADMIN1_URL, { binary: false });
}

// ---------------------------------------------------------------------------
// run — the seam between the pure build and its network/filesystem edges
// ---------------------------------------------------------------------------

/**
 * Everything `node scripts/ingest-cities.mjs` does, minus the entry guard.
 *
 * `loadCitiesTsv`/`loadAdmin1Text` and `dataDir`/`shardDir` are injectable so
 * a test can drive the real gate-then-write ordering end to end — fake
 * network responses in, real `assertSane`/`assertAdmin1Sane` gates, real
 * `writeFileAtomic` calls out — without refetching 13.5 MB from GeoNames and
 * without touching `data/` or `public/cities/`. The entry guard below calls
 * `run()` with no arguments, so every parameter defaults to the real
 * implementation and production behaviour is unchanged.
 */
export async function run({
  loadCitiesTsv = fetchCitiesTsv,
  loadAdmin1Text = fetchAdmin1Text,
  dataDir = DATA_DIR,
  shardDir = SHARD_DIR,
} = {}) {
  const catalogPath = join(dataDir, 'catalog.json');
  const shardIndexPath = join(shardDir, 'index.json');
  const cityIndexPath = join(dataDir, 'cities-index.json');
  const enrichTargetsPath = join(dataDir, 'cities-enrich-targets.json');
  const reportPath = join(dataDir, 'cities-report.md');

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(shardDir, { recursive: true });

  const tsv = await loadCitiesTsv();

  const admin1Codes = parseAdmin1Codes(await loadAdmin1Text());
  // Gated before anything reads it: a reshaped file parses to a near-empty Map
  // and every `a1` becomes null, which no later check would notice.
  assertAdmin1Sane(admin1Codes);
  console.log(`  ${admin1Codes.size} admin-1 names`);

  const rows = parseGeoNamesRows(tsv);
  console.log(`  parsed ${rows.length} usable rows`);

  // The existing catalog is read here rather than imported, so no import
  // attribute is needed and the pure functions stay testable without it.
  const catalog = readJson(catalogPath);
  const catalogCities = catalog?.cities ?? [];
  console.log(`  deduplicating against ${catalogCities.length} Wikidata cities`);

  const { shards, targets, total } = buildCities(rows, admin1Codes, catalogCities);
  const previousIndex = readJson(shardIndexPath);
  assertSane(shards, previousIndex);

  const now = new Date().toISOString();
  const countries = [];
  const indexRows = [];
  let changed = 0;
  let largest = { code: '', bytes: 0 };

  for (const country of [...shards.keys()].sort()) {
    const cities = shards.get(country);
    const path = join(shardDir, `${country}.json`);
    const payload = shardPayload(country, cities, readJson(path), now);
    if (payload.generatedAt === now) changed++;
    const json = JSON.stringify(payload);
    if (json.length > largest.bytes) largest = { code: country, bytes: json.length };
    writeFileAtomic(path, json);
    countries.push({ code: country, count: cities.length, generatedAt: payload.generatedAt });
    for (const city of cities) {
      indexRows.push([city.id, city.n, country, city.lat, city.lon, city.a1]);
    }
  }

  // Stale shards from a country that vanished. `assertSane` refuses to let a
  // country disappear, so this only ever cleans up after an aborted run — but
  // an orphan file under public/ is a URL the client can still fetch.
  const wanted = new Set([...shards.keys()].map((code) => `${code}.json`));
  for (const entry of readdirSync(shardDir)) {
    if (entry === 'index.json' || entry === 'enrich') continue;
    if (!wanted.has(entry)) {
      rmSync(join(shardDir, entry), { force: true });
      console.log(`  removed stale shard ${entry}`);
    }
  }

  // All three index files go through `stampedPayload`, exactly as the 246
  // shards go through `shardPayload`. They are inside refresh-cities.yml's
  // commit-guard paths — public/cities/index.json is under public/cities, and
  // the other two are named outright — so stamping `now` on them
  // unconditionally would make that guard impossible to satisfy: a
  // commit-on-change job would commit 3.7 MB and redeploy production every
  // night for no data change.
  //
  // index.json is indented: it is the one generated file whose diff a human
  // reads. Everything else here is compact, because megabytes of it are
  // committed and indentation would be pure overhead.
  const shardIndex = stampedPayload(readJson(shardIndexPath), {
    source: SOURCE_LICENSE,
    countries,
  }, now);
  writeFileAtomic(shardIndexPath, JSON.stringify(shardIndex, null, 1));

  // Bundled, never fetched: public/ is unreadable from a Vercel lambda, so
  // this is the only thing resolveDestinations can read a picked city out of.
  // Tuples rather than objects — 3.5 MB instead of 4.35 MB for the same data,
  // and it is parsed once per cold start.
  writeFileAtomic(
    cityIndexPath,
    JSON.stringify(
      stampedPayload(readJson(cityIndexPath), { source: SOURCE_LICENSE, cities: indexRows }, now)
    )
  );

  writeFileAtomic(
    enrichTargetsPath,
    JSON.stringify(
      stampedPayload(
        readJson(enrichTargetsPath),
        { targets: Object.fromEntries([...targets.keys()].sort().map((c) => [c, targets.get(c)])) },
        now
      )
    )
  );

  // The report carries the run's own timestamp and is deliberately OUTSIDE the
  // workflow's change test: it is prose about the run, not an artifact the app
  // reads. It is still committed alongside a real change. `shardIndex`'s
  // timestamp, not `now`, so a quiet day does not rewrite this either.
  writeFileAtomic(
    reportPath,
    buildReport({ shards, total, generatedAt: shardIndex.generatedAt, largest })
  );

  console.log(`Wrote ${shards.size} shards to ${shardDir} (${changed} changed)`);
  console.log(`Wrote ${cityIndexPath} (${indexRows.length} cities)`);
  console.log(`Wrote ${enrichTargetsPath}, ${shardIndexPath}, ${reportPath}`);
}

/**
 * Only runs when this file is invoked directly.
 *
 * Without this guard, importing the module to test one of its rules re-runs
 * the whole ingest and rewrites 246 files as an import side effect — not
 * hypothetical; it happened during review of ingest-airports.mjs. `run()` is
 * exported and can be called directly with fake loaders for exactly that kind
 * of test; this guard is what keeps a plain `import` from doing the same
 * thing with the real ones.
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
    console.error(`\nCity ingestion failed: ${error.message}`);
    console.error('Nothing was written — the previous artifacts are untouched.');
    process.exit(1);
  });
}
