#!/usr/bin/env node
/**
 * ingest-airports.mjs
 *
 * Builds data/airports.json (+ data/airports-report.md) from the OurAirports
 * nightly CSV: every airport with scheduled service and an IATA code.
 *
 * "International airport" is not a field OurAirports carries, and every
 * substitute is worse — `large_airport` alone drops regional airports people
 * genuinely fly to, and matching "International" in the name is
 * language-dependent. Scheduled service plus an IATA code means "an airport you
 * can buy a ticket to", which is the operative meaning for a trip planner.
 *
 * Rerunnable and idempotent: when the airport set is unchanged the previous
 * `generatedAt` is preserved, so the file is byte-identical and the daily
 * workflow has nothing to commit.
 *
 * Unlike ingest-destinations.mjs, which writes its outputs even when sanity
 * checks fail so they can be inspected, this script ABORTS before writing. A
 * corrupt airport list is not useful for inspection and would be committed and
 * deployed automatically by the workflow.
 *
 * Usage: node scripts/ingest-airports.mjs
 *
 * One harmless note on that command. It reads the CSV parser straight out of
 * lib/csv.ts, relying on Node's native type stripping (stable since Node
 * 22.18 / 24) so the parser has exactly one definition, tested under
 * lib/csv.test.ts, rather than a copy here that could drift. Node prints a
 * MODULE_TYPELESS_PACKAGE_JSON warning for that import because package.json
 * has no `"type": "module"`; the import still works and the warning is not
 * worth changing the package's module type for.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCsv } from '../lib/csv.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const AIRPORTS_PATH = join(DATA_DIR, 'airports.json');
const REPORT_PATH = join(DATA_DIR, 'airports-report.md');

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const SOURCE_LICENSE = 'Public domain (OurAirports, regenerated nightly)';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

const FETCH_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

/** Columns the build reads. A missing one aborts rather than yielding nulls. */
const REQUIRED_COLUMNS = [
  'type', 'name', 'latitude_deg', 'longitude_deg', 'iso_country',
  'municipality', 'scheduled_service', 'icao_code', 'iata_code',
];

/** Floor, shrink limit, and growth ceiling. Measured 2026-08-23: 4,134 passed the filter. */
const MIN_EXPECTED_AIRPORTS = 3_500;
const MAX_SHRINK_RATIO = 0.10;
/**
 * Mirrors MAX_SHRINK_RATIO in the other direction. A shrink guard alone lets
 * upstream double the list — a bad merge, a filter regression that stops
 * excluding closed airports — and this script would write and the workflow
 * would commit it without a second opinion, since nothing else here caps
 * growth.
 */
const MAX_GROWTH_RATIO = 0.10;

const SIZE_BY_TYPE = {
  large_airport: 'large',
  medium_airport: 'medium',
  small_airport: 'small',
};

/** The only sizes `assertSane` accepts on a record — see the gate below. */
const VALID_SIZES = new Set(['large', 'medium', 'small']);

/**
 * Size for a CSV `type` value, or `'small'` when the type is unrecognised.
 *
 * `SIZE_BY_TYPE[type] ?? 'small'` looks safe but isn't: `SIZE_BY_TYPE` is a
 * plain object literal, so a `type` of `"constructor"` resolves through the
 * prototype chain to `Object.prototype.constructor` — a function, and a
 * function is not nullish, so `?? 'small'` never catches it. The record then
 * carries a function as `size`, and `JSON.stringify` silently *drops that key
 * entirely* rather than erroring, producing a committed record with no
 * `size` at all — which is what fed `NaN` into downstream ranking. Confirmed
 * against this exact input.
 *
 * Same fix as `components/map/mapTypes.ts`'s `isChinaRegion` and
 * `lib/countryProfile.ts`'s `chinaClimate`: check ownership before indexing,
 * so an inherited key can never be mistaken for a data value.
 */
function sizeForType(type) {
  return Object.prototype.hasOwnProperty.call(SIZE_BY_TYPE, type) ? SIZE_BY_TYPE[type] : 'small';
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCsv() {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(SOURCE_URL, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms (${error.message})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to fetch ${SOURCE_URL}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildAirports(rows) {
  const header = rows[0];
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(`upstream CSV is missing column(s): ${missing.join(', ')} — aborting rather than writing nulls`);
  }
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const airports = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length <= 1) continue; // trailing blank line
    if (row.length !== header.length) {
      throw new Error(
        `row ${r + 1} has ${row.length} column(s), expected ${header.length} — ` +
        `aborting rather than reading undefined out of a ragged row`
      );
    }
    const get = (name) => (row[index[name]] ?? '').trim();
    if (get('scheduled_service') !== 'yes') continue;
    const iata = get('iata_code').toUpperCase();
    if (iata.length !== 3) continue;
    const latStr = get('latitude_deg');
    const lonStr = get('longitude_deg');
    // A blank cell must be rejected before it ever reaches `Number()`:
    // `Number('')` is `0`, which `Number.isFinite` happily accepts, so a row
    // with a wiped-out coordinate would otherwise be planted at Null Island
    // (0, 0) and committed rather than dropped.
    if (latStr === '' || lonStr === '') continue;
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    airports.push({
      iata,
      icao: get('icao_code').toUpperCase() || null,
      name: get('name'),
      municipality: get('municipality') || null,
      country: get('iso_country').toUpperCase(),
      lat,
      lon,
      size: sizeForType(get('type')),
    });
  }
  // Sorted by IATA so the artifact is stable across runs and a diff is readable.
  airports.sort((a, b) => a.iata.localeCompare(b.iata));
  return airports;
}

/**
 * Everything a corrupt or reshaped upstream feed could slip through
 * unattended. This is the ONLY gate that runs on the nightly workflow — there
 * is no CI, so lib/server/airports.test.ts's equivalent per-record checks
 * only run when a human types `npm test`. Whatever this function does not
 * catch, the nightly job will commit and Vercel will deploy.
 */
export function assertSane(airports, previous) {
  if (airports.length < MIN_EXPECTED_AIRPORTS) {
    throw new Error(`only ${airports.length} airports passed the filter, expected at least ${MIN_EXPECTED_AIRPORTS}`);
  }
  const seen = new Set();
  for (const a of airports) {
    if (seen.has(a.iata)) throw new Error(`duplicate IATA code ${a.iata}`);
    seen.add(a.iata);

    // Belt-and-braces on lat/lon: buildAirports already drops rows with
    // non-finite coordinates, so this branch should be unreachable. Keeping
    // it costs nothing and documents the invariant at the one place that is
    // guaranteed to run unattended.
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) {
      throw new Error(`airport ${a.iata} has non-finite coordinates (lat=${a.lat}, lon=${a.lon})`);
    }
    // Finite is not the same as plausible: `lat: 394.5` is finite and would
    // sail through every other gate, and haversine's trig is periodic, so it
    // silently behaves as 34.5° — the airport relocates to a plausible wrong
    // place rather than erroring, and can go on to win `nearestAirports` for
    // cities nowhere near it.
    if (a.lat < -90 || a.lat > 90) {
      throw new Error(`airport ${a.iata} has an out-of-range latitude ${a.lat} — expected -90..90`);
    }
    if (a.lon < -180 || a.lon > 180) {
      throw new Error(`airport ${a.iata} has an out-of-range longitude ${a.lon} — expected -180..180`);
    }
    if (!VALID_SIZES.has(a.size)) {
      throw new Error(
        `airport ${a.iata} has an invalid size "${a.size}" — expected one of ${[...VALID_SIZES].join(', ')}`
      );
    }
    if (!/^[A-Z]{3}$/.test(a.iata)) {
      throw new Error(`airport record has a malformed IATA code "${a.iata}" — expected three uppercase letters`);
    }
    if (!/^[A-Z]{2}$/.test(a.country)) {
      throw new Error(
        `airport ${a.iata} has a malformed country code "${a.country}" — expected two uppercase letters ` +
        `(iso_country may have switched formats upstream, e.g. to alpha-3)`
      );
    }
  }
  const before = previous?.airports?.length ?? 0;
  if (before > 0) {
    const shrink = (before - airports.length) / before;
    if (shrink > MAX_SHRINK_RATIO) {
      throw new Error(
        `airport count fell ${(shrink * 100).toFixed(1)}% (${before} → ${airports.length}), ` +
        `over the ${MAX_SHRINK_RATIO * 100}% limit — upstream may be mid-rebuild`
      );
    }
    const growth = (airports.length - before) / before;
    if (growth > MAX_GROWTH_RATIO) {
      throw new Error(
        `airport count rose ${(growth * 100).toFixed(1)}% (${before} → ${airports.length}), ` +
        `over the ${MAX_GROWTH_RATIO * 100}% limit — upstream may have changed its filter`
      );
    }
  }
}

function writeFileAtomic(path, content) {
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

function readPrevious() {
  if (!existsSync(AIRPORTS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(AIRPORTS_PATH, 'utf8'));
  } catch {
    return null; // unreadable previous artifact is the same as none
  }
}

function buildReport(airports, generatedAt, unchanged) {
  const byCountry = new Map();
  const bySize = { large: 0, medium: 0, small: 0 };
  for (const a of airports) {
    byCountry.set(a.country, (byCountry.get(a.country) ?? 0) + 1);
    bySize[a.size]++;
  }
  const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return [
    '# Airports catalog report',
    '',
    `- Generated: ${generatedAt}${unchanged ? ' (unchanged — preserved from the previous run)' : ''}`,
    `- Source: ${SOURCE_URL}`,
    `- Licence: ${SOURCE_LICENSE}`,
    `- Filter: scheduled_service = yes AND iata_code present`,
    '',
    `**${airports.length} airports across ${byCountry.size} countries.**`,
    '',
    `By size: ${bySize.large} large, ${bySize.medium} medium, ${bySize.small} small.`,
    '',
    '## Most airports by country',
    '',
    '| Country | Airports |',
    '| --- | --- |',
    ...top.map(([code, n]) => `| ${code} | ${n} |`),
    '',
  ].join('\n');
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`Fetching ${SOURCE_URL} …`);
  const csv = await fetchCsv();
  const rows = parseCsv(csv);
  console.log(`  parsed ${rows.length - 1} rows`);

  const airports = buildAirports(rows);
  const previous = readPrevious();
  assertSane(airports, previous);

  // Idempotency lives here, not in the workflow: preserving the timestamp when
  // nothing changed makes the file byte-identical, so `git diff` is empty and
  // the daily job commits nothing.
  const unchanged =
    previous !== null && JSON.stringify(previous.airports) === JSON.stringify(airports);
  const generatedAt = unchanged ? previous.generatedAt : new Date().toISOString();

  writeFileAtomic(
    AIRPORTS_PATH,
    JSON.stringify({ generatedAt, source: SOURCE_LICENSE, airports }, null, 1)
  );
  writeFileAtomic(REPORT_PATH, buildReport(airports, generatedAt, unchanged));

  console.log(`Wrote ${AIRPORTS_PATH} (${airports.length} airports)${unchanged ? ' — unchanged' : ''}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

/**
 * Only runs when this file is invoked directly.
 *
 * Unlike its sibling ingest scripts, this module *exports* `buildAirports`
 * and `assertSane`, so their validation rules can be exercised without a
 * 12MB network fetch. Without this guard, importing it to check one of those
 * rules re-runs the entire ingest and rewrites the artifact as a side effect
 * — not hypothetical; it happened during review.
 *
 * Compared as file URLs rather than as paths because on Windows
 * `process.argv[1]` is a drive path while `import.meta.url` is a `file://`
 * URL, so comparing them directly would never match and running the script
 * would silently do nothing.
 *
 * `process.argv[1]` is checked for existence first because it is undefined
 * under `node --eval`, where `pathToFileURL(undefined)` throws.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nAirport ingestion failed: ${error.message}`);
    console.error('Nothing was written — the previous artifact is untouched.');
    process.exit(1);
  });
}
