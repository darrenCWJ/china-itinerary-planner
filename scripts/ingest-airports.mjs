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
import { fileURLToPath } from 'node:url';
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

/** Floor and shrink limit. Measured 2026-08-23: 4,134 passed the filter. */
const MIN_EXPECTED_AIRPORTS = 3_500;
const MAX_SHRINK_RATIO = 0.10;

const SIZE_BY_TYPE = {
  large_airport: 'large',
  medium_airport: 'medium',
  small_airport: 'small',
};

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
    const lat = Number(get('latitude_deg'));
    const lon = Number(get('longitude_deg'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    airports.push({
      iata,
      icao: get('icao_code').toUpperCase() || null,
      name: get('name'),
      municipality: get('municipality') || null,
      country: get('iso_country').toUpperCase(),
      lat,
      lon,
      size: SIZE_BY_TYPE[get('type')] ?? 'small',
    });
  }
  // Sorted by IATA so the artifact is stable across runs and a diff is readable.
  airports.sort((a, b) => a.iata.localeCompare(b.iata));
  return airports;
}

export function assertSane(airports, previous) {
  if (airports.length < MIN_EXPECTED_AIRPORTS) {
    throw new Error(`only ${airports.length} airports passed the filter, expected at least ${MIN_EXPECTED_AIRPORTS}`);
  }
  const seen = new Set();
  for (const a of airports) {
    if (seen.has(a.iata)) throw new Error(`duplicate IATA code ${a.iata}`);
    seen.add(a.iata);
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

main().catch((error) => {
  console.error(`\nAirport ingestion failed: ${error.message}`);
  console.error('Nothing was written — the previous artifact is untouched.');
  process.exit(1);
});
