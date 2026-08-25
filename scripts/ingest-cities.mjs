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
