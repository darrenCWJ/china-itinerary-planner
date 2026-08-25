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
 * Licence: GeoNames is CC BY 4.0 — attribution required, and unlike
 * OurAirports and Natural Earth it is not public domain. The credit has to be
 * visible in the UI (components/plan/GeoNamesCredit.tsx), not just here.
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
  timezone: 17,
};

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
        p: row.population,
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
const MIN_EXPECTED_CITIES = 50_000;
const MAX_SHRINK_RATIO = 0.10;
const MAX_GROWTH_RATIO = 0.10;
/** Measured: admin1CodesASCII.txt parses to 3,865 entries. */
const EXPECTED_ADMIN1_NAMES = 3_865;
const MIN_ADMIN1_NAMES = 3_000;

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
    }
    total += cities.length;
  }

  if (total < MIN_EXPECTED_CITIES) {
    throw new Error(
      `only ${total} cities passed the filter, expected at least ${MIN_EXPECTED_CITIES}`
    );
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
