#!/usr/bin/env node
/**
 * ingest-country-images.mjs
 *
 * Builds data/country-images.json: one hero photograph per country, from
 * Wikidata P18 (image) joined to Wikimedia Commons `imageinfo` for the licence
 * and author. Same pipeline as scripts/ingest-destinations.mjs — no new
 * dependency, no API key — and the same conventions: retries with backoff,
 * bounded batches, atomic writes.
 *
 * Attribution is the point of the Commons half. A country whose file has no
 * usable author or licence is *dropped*, never emitted with a guessed credit:
 * lib/countryImagery falls back to an accent gradient, which is a designed
 * state, whereas a wrong credit is a licence breach.
 *
 * Usage:
 *   node scripts/ingest-country-images.mjs                 # every ISO country
 *   node scripts/ingest-country-images.mjs CN JP TH        # merge just these
 *
 * With codes the run merges into the existing file (a partial run must not
 * discard countries fetched earlier); without them it replaces the file.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const OUTPUT_PATH = join(DATA_DIR, 'country-images.json');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const COMMONS_ACTION_API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

const SPARQL_TIMEOUT_MS = 90_000;
const REST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 8_000];
const MAX_RETRY_AFTER_MS = 30_000;
const COMMONS_POLITENESS_DELAY_MS = 250;
const TITLES_PER_REQUEST = 50; // Action API limit for anonymous callers
/** Hero band, so wider than the 640px destination thumbnails. */
const HERO_WIDTH_PX = 1280;

/**
 * Subject gate. P18 for a country is frequently not scenery — measured on the
 * first run: ES/KR/US returned UN location-map SVGs, AU/IT/JP returned MODIS
 * satellite frames. Behind a hero scrim those read as an error, so they are
 * rejected and the country renders the accent gradient instead, which is a
 * designed state. Filename-based and therefore imperfect; it is a floor on
 * quality, not a guarantee, and the curated override remains the real fix.
 */
const PHOTO_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
// "carte"/"mapa"/"karte" are here because Commons filenames are in the
// uploader's language, and a map does not stop being a map in French.
const NOT_SCENERY = /\b(map|maps|mapa|carte|karte|locator|topograph\w*|flag|coat of arms|emblem|satellite|orthographic|globe)\b/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// HTTP (same shape as ingest-destinations.mjs)
// ---------------------------------------------------------------------------

async function fetchWithRetry(url, { headers, timeoutMs, label }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (res.status === 404) return null;
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status} for ${label}: ${(await res.text()).slice(0, 200)}`);
        const retryAfterSeconds = Number(res.headers.get('retry-after'));
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          error.retryAfterMs = Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
        }
        throw error;
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = Math.max(RETRY_DELAYS_MS[attempt], error.retryAfterMs ?? 0);
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} for ${label} in ${delay}ms (${error.message.slice(0, 120)})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed after retries: ${label}: ${lastError?.message}`);
}

async function sparql(query, label) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const json = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    timeoutMs: SPARQL_TIMEOUT_MS,
    label: `SPARQL ${label}`,
  });
  return json?.results?.bindings ?? [];
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
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

/** Commons Special:FilePath URL → the "File:Name.jpg" title it serves. */
function fileTitleFromFilePath(filePathUrl) {
  const match = /Special:FilePath\/(.+)$/.exec(filePathUrl ?? '');
  if (!match) return null;
  return `File:${decodeURIComponent(match[1]).replace(/_/g, ' ')}`;
}

/** True when the filename suggests a photograph of the place, not a diagram. */
function looksLikeScenery(fileTitle) {
  const name = fileTitle.replace(/^File:/, '');
  return PHOTO_EXTENSIONS.test(name) && !NOT_SCENERY.test(name);
}

/**
 * Same URL shape as the destinations ingest: Special:FilePath with a width,
 * which Commons resizes server-side. Preferred over imageinfo's `thumburl`
 * because that arrives with analytics query parameters attached.
 */
function heroUrl(filePathUrl) {
  return `${filePathUrl.replace(/^http:/, 'https:')}?width=${HERO_WIDTH_PX}`;
}

/** extmetadata values are HTML; the credit line renders as plain text. */
function stripHtml(value) {
  if (typeof value !== 'string') return null;
  const plain = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 0 ? plain : null;
}

const metaValue = (extmetadata, key) => stripHtml(extmetadata?.[key]?.value);

// ---------------------------------------------------------------------------
// Step 1: P18 per ISO country code
// ---------------------------------------------------------------------------

/**
 * P297 is the ISO 3166-1 alpha-2 code, so it also does the filtering: only
 * entities the standard recognises as countries or territories carry one.
 * Multiple P18 statements are possible; the lexically first URL wins so reruns
 * are stable.
 */
async function fetchCountryImages(codeFilter) {
  const values = codeFilter
    ? `VALUES ?code { ${codeFilter.map((code) => `"${code}"`).join(' ')} }`
    : '';
  console.log(`Fetching P18 images for ${codeFilter ? codeFilter.join(', ') : 'every ISO country'}…`);
  const rows = await sparql(
    `SELECT ?code ?img WHERE { ${values} ?c wdt:P297 ?code; wdt:P18 ?img. } ORDER BY ?code ?img`,
    'country P18',
  );

  const byCode = new Map();
  for (const row of rows) {
    const code = (row.code?.value ?? '').trim().toUpperCase();
    const img = row.img?.value;
    if (!/^[A-Z]{2}$/.test(code) || !img) continue;
    if (!byCode.has(code)) byCode.set(code, img);
  }
  console.log(`  ${byCode.size} countries have a P18 image`);
  return byCode;
}

// ---------------------------------------------------------------------------
// Step 2: Commons licence + author per file
// ---------------------------------------------------------------------------

async function fetchCredits(titles) {
  const credits = new Map();
  const batches = chunk(titles, TITLES_PER_REQUEST);
  console.log(`Fetching Commons licence metadata for ${titles.length} files (${batches.length} calls)…`);

  for (const [index, batch] of batches.entries()) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      prop: 'imageinfo', iiprop: 'extmetadata|url', redirects: '1',
      iiextmetadatafilter: 'Artist|Attribution|Credit|LicenseShortName|LicenseUrl',
      titles: batch.join('|'),
    });
    const json = await fetchWithRetry(`${COMMONS_ACTION_API}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeoutMs: REST_TIMEOUT_MS,
      label: `commons imageinfo ${index + 1}/${batches.length}`,
    });

    // Titles can be normalised or redirected; map every requested form back.
    const aliases = new Map();
    for (const { from, to } of json?.query?.normalized ?? []) aliases.set(from, to);
    for (const { from, to } of json?.query?.redirects ?? []) aliases.set(from, to);
    const resolve = (title) => {
      let current = title;
      for (let hop = 0; hop < 4 && aliases.has(current); hop++) current = aliases.get(current);
      return current;
    };

    const byTitle = new Map();
    for (const page of json?.query?.pages ?? []) byTitle.set(page.title, page.imageinfo?.[0] ?? null);

    for (const title of batch) {
      const info = byTitle.get(resolve(title));
      if (!info) continue;
      const meta = info.extmetadata;
      // Artist first: it is the author's name, which is what a one-line credit
      // has room for. Attribution is the licensor's requested wording and is
      // often a sentence; Credit is usually "own work". Any of the three still
      // beats no credit at all.
      const artist = metaValue(meta, 'Artist') ?? metaValue(meta, 'Attribution') ?? metaValue(meta, 'Credit');
      const license = metaValue(meta, 'LicenseShortName');
      const sourceUrl = typeof info.descriptionurl === 'string' ? info.descriptionurl : null;
      if (!artist || !license || !sourceUrl) continue;
      credits.set(title, { artist, license, licenseUrl: metaValue(meta, 'LicenseUrl'), sourceUrl });
    }
    await sleep(COMMONS_POLITENESS_DELAY_MS);
  }
  console.log(`  ${credits.size}/${titles.length} files carry a usable author + licence`);
  return credits;
}

// ---------------------------------------------------------------------------
// Step 3: assemble and write
// ---------------------------------------------------------------------------

function readExistingCountries() {
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    return parsed?.countries && typeof parsed.countries === 'object' ? parsed.countries : {};
  } catch {
    return {}; // first run, or a file we are about to replace anyway
  }
}

async function main() {
  const startedAt = Date.now();
  mkdirSync(DATA_DIR, { recursive: true });

  const codeFilter = process.argv
    .slice(2)
    .map((arg) => arg.trim().toUpperCase())
    .filter((arg) => /^[A-Z]{2}$/.test(arg));
  const isPartialRun = codeFilter.length > 0;

  const imageByCode = await fetchCountryImages(isPartialRun ? codeFilter : null);
  const titleByCode = new Map();
  const notScenery = [];
  for (const [code, filePathUrl] of imageByCode) {
    const title = fileTitleFromFilePath(filePathUrl);
    if (!title) continue;
    if (!looksLikeScenery(title)) { notScenery.push(`${code} (${title.replace(/^File:/, '')})`); continue; }
    titleByCode.set(code, { title, filePathUrl });
  }

  const credits = await fetchCredits([...new Set([...titleByCode.values()].map((v) => v.title))]);

  // A partial run merges so earlier countries survive, but every code *in this
  // run's scope* is recomputed — including deletion, so a country that now
  // fails a gate loses its stale entry instead of keeping it forever.
  const countries = isPartialRun ? { ...readExistingCountries() } : {};
  if (isPartialRun) for (const code of codeFilter) delete countries[code];

  const uncredited = [];
  for (const [code, { title, filePathUrl }] of titleByCode) {
    const credit = credits.get(title);
    if (!credit) { uncredited.push(code); continue; }
    countries[code] = {
      url: heroUrl(filePathUrl),
      artist: credit.artist,
      license: credit.license,
      licenseUrl: credit.licenseUrl,
      sourceUrl: credit.sourceUrl,
    };
  }

  const ordered = {};
  for (const code of Object.keys(countries).sort()) ordered[code] = countries[code];

  writeFileAtomic(OUTPUT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: 'Wikidata P18 (CC0 metadata) + Wikimedia Commons imageinfo (per-file licence)',
    countries: ordered,
  }, null, 1)}\n`);

  const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`Wrote ${OUTPUT_PATH} (${Object.keys(ordered).length} countries, ${isPartialRun ? 'merged' : 'replaced'}) in ${elapsedSeconds}s`);
  if (uncredited.length > 0) {
    console.log(`Dropped for missing author/licence: ${uncredited.join(', ')}`);
  }
  if (notScenery.length > 0) {
    console.log(`Dropped as not scenery: ${notScenery.join(', ')}`);
  }
  // Every dropped country renders the accent gradient, which is the designed
  // fallback — the fix for a specific country is a credited entry in
  // CURATED_HEROES (lib/countryImagery.ts), not an edit to this generated file.
  console.log('Dropped countries render the accent gradient; pin better files in lib/countryImagery.ts.');
}

main().catch((error) => {
  console.error(`\nIngestion failed: ${error.message}`);
  console.error('If this is a network error, Wikidata/Commons may be unreachable — rerun later; the output file was not modified.');
  process.exit(1);
});
