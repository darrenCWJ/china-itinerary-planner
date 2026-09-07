/**
 * ingest-cities — paths, sources, the retrying fetch, the writers, and the two
 * network sources.
 *
 * Moved verbatim out of scripts/ingest-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-cities.mjs.
 *
 * The one line that is not verbatim is `ROOT_DIR`: this file sits one
 * directory deeper than the one it came out of, so the walk up from
 * `import.meta.url` takes one more `'..'`.
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
import { fileURLToPath } from 'node:url';

import { readZipMember } from './geonames.mjs';

// ---------------------------------------------------------------------------
// Paths, sources, network
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * Defaults for `run()`'s `dataDir`/`shardDir` parameters — production's real
 * values. The five file paths under each (catalog, shard index, city index,
 * enrich targets, report) are derived from whichever `dataDir`/`shardDir`
 * `run()` actually receives, not from these constants directly, so a test can
 * point them at a scratch directory and never touch `data/` or
 * `public/cities/`.
 */
export const DATA_DIR = join(ROOT_DIR, 'data');
export const SHARD_DIR = join(ROOT_DIR, 'public', 'cities');

export const CITIES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const CITIES_MEMBER = 'cities500.txt';
const ADMIN1_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';
/**
 * CC BY 4.0, not public domain — unlike OurAirports and Natural Earth. The
 * credit has to be visible in the UI as well as here; that is
 * components/plan/GeoNamesCredit.tsx — see `buildReport`'s Attribution section
 * below, which records where it renders and what guards it.
 */
export const SOURCE_LICENSE = 'GeoNames cities500 (CC BY 4.0)';
export const SOURCE_ATTRIBUTION = 'https://www.geonames.org/ — CC BY 4.0';
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

export function writeFileAtomic(path, content) {
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

/**
 * The entries of `shardDir` that are stale shards and nothing else: a regular
 * file naming a country this run did not write, `index.json` excepted because
 * the run rewrites it next.
 *
 * FILES ONLY, and that is the reason this is its own function rather than
 * three lines in `run`. `rmSync(path, { force: true })` on a directory throws
 * `ERR_FS_EISDIR` — `force` forgives a missing path, not a directory — so the
 * sweep used to be one subdirectory away from ending the nightly refresh at
 * its last step, after every shard had already been written. `enrich/`
 * survived only because it was excluded by NAME; the first unnamed directory
 * under public/cities/ would have killed the run — and a reason
 * `public/provinces/` must stay beside this directory rather than inside it.
 * Verified on Node 24 before this was written. A directory is never a shard,
 * so it is never stale, whatever it is called.
 *
 * @param {string} shardDir
 * @param {Iterable<string>} writtenCountries
 * @returns {string[]} file names, sorted so the log order is stable
 */
export function staleShardFiles(shardDir, writtenCountries) {
  const wanted = new Set([...writtenCountries].map((code) => `${code}.json`));
  return readdirSync(shardDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'index.json' && !wanted.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export function readJson(path) {
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
// Fetching the two network sources
// ---------------------------------------------------------------------------

/** Real `loadCitiesTsv`: fetch the zip, inflate it, decode the one member we want. */
export async function fetchCitiesTsv() {
  console.log(`Fetching ${CITIES_URL} …`);
  const archive = await fetchSource(CITIES_URL, { binary: true });
  console.log(`  ${archive.length} bytes; inflating ${CITIES_MEMBER}`);
  return readZipMember(archive, CITIES_MEMBER).toString('utf8');
}

/** Real `loadAdmin1Text`: fetch admin1CodesASCII.txt as-is. */
export async function fetchAdmin1Text() {
  console.log(`Fetching ${ADMIN1_URL} …`);
  return fetchSource(ADMIN1_URL, { binary: false });
}

