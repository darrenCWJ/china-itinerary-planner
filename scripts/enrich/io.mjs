/**
 * enrich-cities — the network and filesystem edges: the retrying fetch, the
 * two upstreams it drives, the atomic write and the JSON read.
 *
 * Moved verbatim out of scripts/enrich-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the enrichment it
 * describes is unchanged. The entry point — `run`, the run guard — is still
 * scripts/enrich-cities.mjs.
 *
 * The endpoints, the timeouts, the retry delays and the two politeness sleeps
 * came with the code that reads them; they were declared above the `Pure`
 * banner in the file this was cut from, and nothing outside these functions
 * reads them. Nothing here computes a path from `import.meta.url`, so sitting
 * one directory deeper costs this file nothing: `run` still passes
 * `targetsPath` and `enrichDir` in, which is what lets a test drive the real
 * plan-then-gate-then-write ordering without touching Wikidata or
 * `public/cities/`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { chunk } from './plan.mjs';

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const ENWIKI_ACTION_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

const SPARQL_TIMEOUT_MS = 90_000;
const REST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 8_000];
const MAX_RETRY_AFTER_MS = 30_000;
const SPARQL_POLITENESS_DELAY_MS = 400;
const SUMMARY_POLITENESS_DELAY_MS = 250;

/** The Action API's `exlimit` maximum for anonymous callers. */
const TITLES_PER_REQUEST = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * `notFoundIsEmpty` is per-endpoint on purpose. For a per-title REST lookup a
 * 404 means "no such page", which is a real, empty answer. For the SPARQL
 * endpoint it means the endpoint moved — an outage that must not be laundered
 * into "Wikidata knows nothing about these 150 cities", because that reading
 * feeds straight into a destructive merge. It is also not worth retrying: a
 * moved endpoint will still be moved in ten seconds.
 */
async function fetchWithRetry(url, { headers, timeoutMs, label, notFoundIsEmpty = true }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (res.status === 404) {
        if (notFoundIsEmpty) return null;
        const moved = new Error(
          `HTTP 404 for ${label} — the endpoint moved or the query path changed; ` +
          `that is an outage, not an empty result`
        );
        moved.nonRetryable = true;
        throw moved;
      }
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
      if (error.nonRetryable) throw error;
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

export async function fetchSparqlBindings(query, label) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const json = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    timeoutMs: SPARQL_TIMEOUT_MS,
    label: `SPARQL ${label}`,
    notFoundIsEmpty: false,
  });
  await sleep(SPARQL_POLITENESS_DELAY_MS);
  return json?.results?.bindings ?? [];
}

/**
 * Intro extracts, 20 titles per request. Failures degrade rather than abort
 * here; `assertExtractQualitySane` decides afterwards whether the total
 * degradation is small enough to commit.
 */
export async function fetchExtracts(titles) {
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

export function writeFileAtomic(path, content) {
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

/**
 * Missing and unreadable are NOT the same answer.
 *
 * Returning null for both meant a corrupt enrich file — a partial checkout, an
 * interrupted write, a bad merge — read as "this country has no previous
 * enrichment", which is precisely the input that makes `assertEnrichmentSane`
 * early-return "a first run has nothing to lose". Corrupting the committed
 * files and handing the run an empty upstream answer rewrote every one of them
 * as `{"cities":{}}` at exit 0. A file that exists and does not parse is a
 * reason to stop, never a reason to proceed as though it were absent.
 */
export function readJson(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path} exists but is not valid JSON (${error.message}) — refusing to continue: ` +
      `an unreadable previous state reads as "nothing to lose", and this run would then ` +
      `delete every entry it cannot refetch`
    );
  }
}

