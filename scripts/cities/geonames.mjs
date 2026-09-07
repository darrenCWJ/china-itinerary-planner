/**
 * ingest-cities — the ZIP reader and the GeoNames TSV parsers.
 *
 * Moved verbatim out of scripts/ingest-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-cities.mjs.
 */

import { inflateRawSync } from 'node:zlib';

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
 * GeoNames' no-data value for `dem`. SRTM has no coverage above 60° of
 * latitude or over water, and GeoNames writes -9999 there rather than leaving
 * the column blank — measured 2026-09-03 on 300 committed rows (HK 48, NO 41,
 * FI 17, CV 12, HN 10, IS 10, FM 9, GL 9), every one of them a coastal or
 * high-latitude town sitting "ten kilometres below sea level". It is not an
 * elevation, and the lapse-rate correction climate work needs would read it
 * as one and warm those towns by tens of degrees. Null, like a blank cell.
 */
export const GEONAMES_NO_DATA_ELEVATION = -9999;

function elevationOrNull(raw) {
  const value = integerOrNull(raw);
  return value === GEONAMES_NO_DATA_ELEVATION ? null : value;
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
      // a real elevation, and 0 would put a Himalayan town at the coast. And
      // null rather than -9999, GeoNames' own no-data marker — see
      // `GEONAMES_NO_DATA_ELEVATION`.
      elevation: elevationOrNull(f[COL.elevation]) ?? elevationOrNull(f[COL.dem]),
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

