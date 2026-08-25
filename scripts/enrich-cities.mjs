#!/usr/bin/env node
/**
 * enrich-cities.mjs
 *
 * Gives the top 30 cities per country (6,244 in total) a one-or-two sentence
 * description and a Wikimedia image, written to public/cities/enrich/<CC>.json
 * — a file per country, mirroring the shards.
 *
 * GeoNames carries name, coordinates, population, admin-1 and timezone. It
 * carries no descriptions, no images and no interest tags, so a naive port
 * would trade 695 rich cities for 59,073 thin ones — a coverage win that is a
 * regression in feel. This closes most of that gap at build time; anything
 * else is enriched on first selection by lib/server/cityEnrichment.ts.
 *
 * Keyed on Wikidata's P1566 (GeoNames ID) rather than on a name search,
 * because a name search is ambiguous — Peru has two cities called Cusco and
 * 139,183 of the dump's rows are plain `PPL`. P1566 is an exact key back to a
 * QID, and the same query yields the enwiki sitelink, the P18 image and the
 * English description in one round trip.
 *
 * Stored apart from the shard, and merged rather than replaced: §4 requires
 * that a re-ingest never discards enrichment. Every id in THIS run's scope is
 * recomputed, including deletion, so a city that now fails a gate loses its
 * stale entry instead of keeping it forever — the rule
 * ingest-country-images.mjs already applies to a partial run.
 *
 * Unlike scripts/ingest-cities.mjs this script does NOT abort on a failed
 * batch. A city with no enrichment renders exactly as a thin catalog city does
 * today, which is already an accepted state in the UI, so a failed batch is
 * counted, reported, and the run continues.
 *
 * That tolerance is only safe because of two rules below, and both are
 * load-bearing. `mergeEnrichment` is additive for entries OUTSIDE its scope and
 * DESTRUCTIVE inside it — it deletes every id in scope before re-adding what
 * came back — and it cannot tell "Wikidata has nothing for this city" from "we
 * never got to ask". So:
 *
 *   1. `main()` narrows each country's scope to the ids whose SPARQL batch
 *      actually returned. A timed-out batch costs nothing at all.
 *   2. `assertEnrichmentSane` refuses to write when total coverage collapses
 *      anyway — the case narrowing cannot catch, where every batch answers and
 *      returns nothing because the query or the endpoint changed shape.
 *
 * Without both, one outage rewrites all 246 files as `{"cities":{}}`, exits 0,
 * and `refresh-cities.yml` commits the wipe and Vercel deploys it.
 *
 * Usage:
 *   node scripts/enrich-cities.mjs             # every country in the target file
 *   node scripts/enrich-cities.mjs PE CH JP    # merge just these
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS_PATH = join(ROOT_DIR, 'data', 'cities-enrich-targets.json');
const ENRICH_DIR = join(ROOT_DIR, 'public', 'cities', 'enrich');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const ENWIKI_ACTION_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';
const SOURCE = 'Wikidata (CC0) + Wikipedia (CC BY-SA) summaries';

const SPARQL_TIMEOUT_MS = 90_000;
const REST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 8_000];
const MAX_RETRY_AFTER_MS = 30_000;
const SPARQL_POLITENESS_DELAY_MS = 400;
/**
 * How much of the previous run's coverage may vanish before this is an outage
 * rather than a data change. See the header: enrichment is destructive within
 * scope, and the workflow commits and deploys whatever is written.
 */
const MIN_COVERAGE_RATIO = 0.5;
const SUMMARY_POLITENESS_DELAY_MS = 250;
/** Wikidata's optimiser copes with this many VALUES per query; more times out. */
const IDS_PER_SPARQL_BATCH = 150;
/** The Action API's `exlimit` maximum for anonymous callers. */
const TITLES_PER_REQUEST = 20;
const MAX_DESCRIPTION_CHARS = 420;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

/** `G` + digits, the id shape scripts/ingest-cities.mjs emits. */
const GEONAMES_ID = /^G[1-9][0-9]*$/;

/**
 * A VALUES query over Wikidata's P1566 (GeoNames ID).
 *
 * Ids are validated rather than escaped. They come from a generated file, but
 * this string is interpolated straight into a query, and a value carrying a
 * quote would rewrite the WHERE clause. Validation is also what catches the
 * subtler mistake: sending the app's `G`-prefixed id matches nothing, and an
 * empty result is indistinguishable from a genuinely unknown city.
 */
export function buildEnrichmentQuery(geonameIds) {
  const values = geonameIds
    .map((id) => {
      if (!GEONAMES_ID.test(id)) throw new Error(`"${id}" is not a GeoNames id — expected "G" + digits`);
      return `"${id.slice(1)}"`;
    })
    .join(' ');
  return `
SELECT ?gid ?x ?img ?title ?desc WHERE {
  VALUES ?gid { ${values} }
  ?x wdt:P1566 ?gid.
  OPTIONAL { ?x wdt:P18 ?img. }
  OPTIONAL { ?article schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
  OPTIONAL { ?x schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

/** P18 arrives as a Commons Special:FilePath URL; Commons resizes server-side. */
export function toThumbnailUrl(commonsFilePathUrl) {
  if (!commonsFilePathUrl) return null;
  return `${commonsFilePathUrl.replace(/^http:/, 'https:')}?width=640`;
}

/**
 * SPARQL's row-per-statement-combination output, collapsed to one entity per
 * id. First non-null binding wins per field — the `??=` idiom
 * ingest-destinations.mjs uses, and the reason the live query returning Cusco
 * three times does not produce three records.
 */
export function readEnrichmentBindings(bindings) {
  const merged = new Map();
  for (const row of bindings) {
    const gid = row?.gid?.value;
    if (!gid) continue;
    const id = `G${gid}`;
    const entity = merged.get(id) ?? { title: null, description: null, image: null };
    entity.title ??= row.title?.value ?? null;
    entity.description ??= row.desc?.value ?? null;
    entity.image ??= toThumbnailUrl(row.img?.value ?? null);
    merged.set(id, entity);
  }
  return merged;
}

/**
 * The previous enrichment file, updated for the ids this run covered.
 *
 * Merged so a lazily-enriched city that has since fallen out of the top 30
 * survives a build that no longer asks about it. Recomputed inside the scope,
 * including deletion, so a city that now yields nothing loses its stale entry.
 * Keys are sorted so a rebuild with no data change is byte-identical and the
 * daily workflow has nothing to commit.
 */
export function mergeEnrichment(previous, fresh, scope) {
  const out = { ...previous };
  for (const id of scope) delete out[id];
  for (const id of scope) {
    const entity = fresh.get(id);
    if (!entity) continue;
    const description = entity.description ?? null;
    const image = entity.image ?? null;
    if (description === null && image === null) continue;
    out[id] = { description, image };
  }
  /**
   * Annotated, not inferred. `allowJs` with `checkJs` off still lets
   * TypeScript infer this module's exported types, and an object literal
   * populated only through a computed key infers as `{}` — which makes
   * `merged.G2` in scripts/enrich-cities.test.ts a hard `tsc --noEmit` error
   * (`TS2339: Property 'G2' does not exist on type '{}'`), and the pre-merge
   * gate is exactly `npx tsc --noEmit` then `npm test`. Reproduced and the fix
   * verified against this repo's own TypeScript 7.0.2.
   *
   * @type {Record<string, { description: string | null; image: string | null }>}
   */
  const ordered = {};
  for (const key of Object.keys(out).sort()) ordered[key] = out[key];
  return ordered;
}

/**
 * The gate between a Wikidata outage and a committed, deployed data wipe.
 *
 * `mergeEnrichment` deletes every id in its scope before re-adding what came
 * back, and `main()` already narrows the scope to batches that answered — but
 * narrowing cannot catch the case where every batch answers and returns
 * nothing, which is what a renamed property, a schema change or a rate-limit
 * page parsed as JSON looks like. Then the merge is legitimately empty and
 * all 6,244 records would be deleted, written, committed and deployed with
 * `main()` still exiting 0.
 *
 * Throwing here fails the workflow's enrich step, which skips the commit step
 * entirely: the cost of a bad upstream day is one skipped refresh, not the
 * catalog's whole descriptive layer.
 */
export function assertEnrichmentSane(previousTotal, nextTotal) {
  if (previousTotal === 0) return; // a first run has nothing to lose
  const ratio = nextTotal / previousTotal;
  if (ratio < MIN_COVERAGE_RATIO) {
    throw new Error(
      `enrichment coverage fell to ${nextTotal}/${previousTotal} ` +
      `(${(ratio * 100).toFixed(1)}%), under the ${MIN_COVERAGE_RATIO * 100}% floor — ` +
      `writing now would delete the enrichment this run failed to refetch`
    );
  }
}

/** Drop "(simplified Chinese: …; pinyin: …)" style parentheticals from extracts. */
function stripLanguageParentheticals(text) {
  if (!text) return text;
  return text.replace(/\s*\((?=[^)]*(?:pinyin|romanized|Chinese))[^()]*\)/g, '');
}

export function firstSentences(text, maxSentences = 2) {
  if (!text) return null;
  const clean = stripLanguageParentheticals(text).replace(/\s+/g, ' ').trim();
  // The optional opener before a capital is a straight quote, an apostrophe or
  // a bracket. (An earlier draft listed `"` twice, which was a no-op.)
  const sentences = clean.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
  let result = sentences.slice(0, maxSentences).join(' ');
  if (result.length > MAX_DESCRIPTION_CHARS && sentences.length > 1) result = sentences[0];
  if (result.length > MAX_DESCRIPTION_CHARS) {
    result = `${result.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
  }
  return result || null;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

// ---------------------------------------------------------------------------
// Network
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
  await sleep(SPARQL_POLITENESS_DELAY_MS);
  return json?.results?.bindings ?? [];
}

/** Intro extracts, 20 titles per request. Failures degrade, they do not abort. */
async function fetchExtracts(titles) {
  const extracts = new Map();
  const batches = chunk([...new Set(titles)], TITLES_PER_REQUEST);
  let failures = 0;
  for (const [index, batch] of batches.entries()) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      prop: 'extracts', exintro: '1', explaintext: '1', exlimit: 'max',
      redirects: '1', titles: batch.join('|'),
    });
    try {
      const json = await fetchWithRetry(`${ENWIKI_ACTION_API}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeoutMs: REST_TIMEOUT_MS,
        label: `extracts ${index + 1}/${batches.length}`,
      });
      // The Action API answers under the canonical title, not the requested
      // one, so the two remappings have to be walked in order.
      const normalized = new Map((json?.query?.normalized ?? []).map((n) => [n.from, n.to]));
      const redirected = new Map((json?.query?.redirects ?? []).map((r) => [r.from, r.to]));
      const byTitle = new Map((json?.query?.pages ?? []).map((p) => [p.title, p.extract ?? null]));
      for (const requested of batch) {
        const normal = normalized.get(requested) ?? requested;
        const final = redirected.get(normal) ?? normal;
        extracts.set(requested, byTitle.get(final) ?? null);
      }
    } catch (error) {
      failures += batch.length;
      console.warn(`  extract batch ${index + 1} failed (${error.message.slice(0, 120)})`);
    }
    await sleep(SUMMARY_POLITENESS_DELAY_MS);
  }
  if (failures > 0) console.warn(`  ${failures} titles fell back to Wikidata descriptions`);
  return extracts;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    rmSync(path, { force: true });
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
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const targetsFile = readJson(TARGETS_PATH);
  if (!targetsFile?.targets) {
    throw new Error(`${TARGETS_PATH} is missing — run \`node scripts/ingest-cities.mjs\` first`);
  }
  const requested = process.argv
    .slice(2)
    .map((arg) => arg.trim().toUpperCase())
    .filter((arg) => /^[A-Z]{2}$/.test(arg));
  const countries = requested.length > 0 ? requested : Object.keys(targetsFile.targets).sort();

  const scopeByCountry = new Map();
  const allIds = [];
  for (const country of countries) {
    const ids = targetsFile.targets[country];
    if (!Array.isArray(ids)) {
      console.warn(`  ${country} has no targets — skipping`);
      continue;
    }
    scopeByCountry.set(country, ids);
    allIds.push(...ids);
  }
  if (allIds.length === 0) {
    throw new Error(`${TARGETS_PATH} names no cities — rerun \`node scripts/ingest-cities.mjs\``);
  }
  console.log(`Enriching ${allIds.length} cities across ${scopeByCountry.size} countries…`);

  const entities = new Map();
  /**
   * Ids whose batch actually came back. Only these may be deleted below.
   *
   * `mergeEnrichment` cannot tell "Wikidata has nothing for this city" from
   * "we never got to ask", and a timed-out batch must cost nothing — otherwise
   * a transient blip becomes a committed, auto-deployed data regression.
   */
  const answered = new Set();
  const batches = chunk(allIds, IDS_PER_SPARQL_BATCH);
  for (const [index, batch] of batches.entries()) {
    try {
      const bindings = await sparql(buildEnrichmentQuery(batch), `${index + 1}/${batches.length}`);
      for (const [id, entity] of readEnrichmentBindings(bindings)) entities.set(id, entity);
      for (const id of batch) answered.add(id);
    } catch (error) {
      console.warn(
        `  SPARQL batch ${index + 1} failed (${error.message.slice(0, 120)}) — ` +
        `${batch.length} cities keep their previous enrichment`
      );
    }
    if ((index + 1) % 5 === 0 || index === batches.length - 1) {
      console.log(`  wikidata ${index + 1}/${batches.length} (${entities.size} entities)`);
    }
  }

  const titles = [...entities.values()].map((e) => e.title).filter(Boolean);
  const extracts = await fetchExtracts(titles);
  for (const entity of entities.values()) {
    const extract = entity.title ? extracts.get(entity.title) : null;
    entity.description = firstSentences(extract) ?? entity.description;
  }

  // Merged in full BEFORE anything is written, so the coverage gate below can
  // see what the whole run would do. Writing per country as we go would leave
  // half the catalog wiped and half intact when the gate fires.
  const planned = new Map();
  let previousTotal = 0;
  let nextTotal = 0;
  for (const [country, scope] of scopeByCountry) {
    const path = join(ENRICH_DIR, `${country}.json`);
    const previous = readJson(path);
    previousTotal += Object.keys(previous?.cities ?? {}).length;
    // Only ids whose batch returned. An unasked id is not recomputed, so it
    // keeps whatever the last successful run gave it.
    const scoped = scope.filter((id) => answered.has(id));
    const cities = mergeEnrichment(previous?.cities ?? {}, entities, scoped);
    nextTotal += Object.keys(cities).length;
    planned.set(country, { path, previous, cities });
  }

  assertEnrichmentSane(previousTotal, nextTotal);

  const now = new Date().toISOString();
  let written = 0;
  for (const [country, { path, previous, cities }] of planned) {
    const unchanged = previous !== null && JSON.stringify(previous.cities) === JSON.stringify(cities);
    writeFileAtomic(
      path,
      JSON.stringify({
        country,
        generatedAt: unchanged ? previous.generatedAt : now,
        source: SOURCE,
        cities,
      })
    );
    if (!unchanged) written++;
  }
  console.log(
    `Wrote ${planned.size} enrichment files to ${ENRICH_DIR} ` +
    `(${written} changed, ${nextTotal} cities enriched, ${allIds.length - answered.size} unasked)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nCity enrichment failed: ${error.message}`);
    console.error('If this is a network error, Wikidata/Wikipedia may be unreachable — rerun later.');
    process.exit(1);
  });
}
