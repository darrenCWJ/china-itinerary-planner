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
 * ---------------------------------------------------------------------------
 * WHY THERE ARE FIVE GATES AND NOT TWO
 * ---------------------------------------------------------------------------
 *
 * `mergeEnrichment` is additive for entries OUTSIDE its scope and DESTRUCTIVE
 * inside it — it deletes every id in scope before re-adding what came back —
 * and it cannot tell "Wikidata has nothing for this city" from "we never got
 * to ask". An earlier version separated those two cases by ONE signal:
 * whether the HTTP call threw. That closes the two ENDS of the hazard and
 * leaves the MIDDLE open. An upstream returning HTTP 200 with fewer bindings
 * than it was asked for is classified as "answered", every omitted id is
 * deleted, and a global 50% floor sits far above the damage: measured against
 * production's 5,118 entries, that permitted deleting 2,559 of them in one
 * unattended night, at exit 0, committed and deployed.
 *
 * So the answer is judged, not just its exception:
 *
 *   1. `planCountry` narrows each country's scope to the ids whose SPARQL
 *      batch actually returned. A timed-out batch costs nothing at all.
 *   2. `isBatchAnswerPlausible` decides what "returned" means. A batch that
 *      answers for far fewer ids than it ALREADY HAD enrichment for is a
 *      truncated or throttled response, not a data change, so it is demoted
 *      to a failed batch and rule 1 then protects it.
 *   3. `assertEnrichmentSane` refuses to write when total coverage collapses
 *      anyway — the case narrowing cannot catch, where every batch answers
 *      plausibly and the merge is still legitimately empty because the query
 *      or the endpoint changed shape.
 *   4. `assertCountryCoverageSane` refuses to write when ONE country collapses
 *      while the global ratio holds. The largest country holds 30 of 5,118
 *      entries, so no global floor can see a country being zeroed.
 *   5. `assertExtractQualitySane` counts QUALITY rather than records: a
 *      Wikipedia-only outage leaves the record count untouched and silently
 *      downgrades every description to a Wikidata stub.
 *
 * Without all of these, one bad upstream night rewrites all 246 files, exits
 * 0, and `refresh-cities.yml` commits the wipe and Vercel deploys it.
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
 * rather than a data change.
 *
 * Chosen from this catalog's real numbers, not guessed. The live run produced
 * 5,118 entries from 6,245 targets, and an immediate re-run was byte-identical
 * — steady-state drift is zero, because the only way an entry disappears is
 * that an item Wikidata already answered for stops carrying P1566, or loses
 * both its image and its description. That is a handful of items a night, not
 * hundreds.
 *
 * 0.95 therefore permits losing 255 of 5,118 — comfortably more than any
 * plausible night of churn, and more than a whole SPARQL batch's worth of it
 * (150 ids = 2.9%) — while refusing anything larger. The value it replaces,
 * 0.5, permitted losing 2,559: half the catalog, 85 countries' worth, in one
 * unattended run.
 *
 * It deliberately does NOT try to catch concentrated damage: 30 targets is the
 * most any one country has, or 0.6% of the total, which no global ratio can
 * see. That is `MIN_COUNTRY_COVERAGE_RATIO`'s job.
 */
const MIN_COVERAGE_RATIO = 0.95;

/**
 * The same question asked per country, which is the scale real damage arrives
 * at: a truncated batch, or a country whose ids all sit in one 150-id window.
 *
 * Per-country COUNTS are far more stable than per-country YIELD, which ranges
 * from 0/1 (VA) to 30/30 across the real catalog — so this compares a country
 * against its own previous file, never against its target count. Ids that
 * fall out of the top 30 are kept by `mergeEnrichment` as out-of-scope
 * entries, so a country's total only moves when an id it already had stops
 * answering. 0.8 lets a 30-entry country lose 6 and a 14-entry country lose 2
 * before this fires; the demonstrated wipe — a country losing all 30 while
 * global coverage read a healthy 83% — trips it at 0.
 */
const MIN_COUNTRY_COVERAGE_RATIO = 0.8;

/**
 * Countries too small for a ratio to mean anything. 25 of the 246 have fewer
 * than 10 targets and several hold 1 or 2 entries, where losing one city is a
 * 50-100% "collapse". Without this a single tiny country could block the whole
 * nightly refresh indefinitely, which is its own kind of outage.
 */
const COUNTRY_COVERAGE_GRACE = 2;

/**
 * What fraction of a batch's ALREADY-ENRICHED ids must come back before the
 * response counts as an answer rather than an outage.
 *
 * Judged against previous coverage rather than against batch size, because
 * batch size says nothing: real per-batch yield across the live run ranged
 * 65-98%, so any fixed fraction of the batch either never fires or fires
 * constantly. Previously-covered ids, by contrast, are ids Wikidata has
 * already answered for at least once; more than 20% of them vanishing inside
 * a single 150-id window is a truncated result set, not editorial churn. On a
 * first run there is no previous coverage and nothing to lose, so any answer
 * is accepted.
 *
 * Calibrated against the failure that was demonstrated: an upstream yielding
 * 55% of the batch scores ~0.67 here and is rejected, and the observed
 * within-batch tail deficit (the last 30 positions of each batch answer about
 * 8 points below the head) scores ~0.9 and is accepted.
 */
const MIN_BATCH_ANSWER_RATIO = 0.8;

/**
 * How many of the titles sent to the Action API may fall back to Wikidata's
 * terse one-liner before the run is a Wikipedia outage rather than a normal
 * day. The committed artifact puts an upper bound of ~9% on the real rate:
 * 434 of 5,118 descriptions are short and unpunctuated enough to be Wikidata
 * stubs, and that count also includes entities that never had an enwiki title
 * to ask about. 0.2 is more than twice that bound, so routine rate-limiting
 * cannot trip it — the live run took a 429 on roughly 1 batch in 10 and still
 * lost only ~20 titles — while a Wikipedia outage scores ~1.0 and stops the
 * commit.
 */
const MAX_EXTRACT_FALLBACK_RATIO = 0.2;

/** Below this the fallback ratio is noise: `enrich-cities.mjs VA` asks about one title. */
const MIN_EXTRACT_SAMPLE = 50;

const SUMMARY_POLITENESS_DELAY_MS = 250;
/**
 * Wikidata's optimiser copes with this many VALUES per query; more times out.
 *
 * DO NOT SHRINK THIS TO FIX A "BATCH-POSITION TRUNCATION". There isn't one.
 * Measured 2026-08-29, and written here because the code is where the next
 * person will come looking to fix it.
 *
 * The thing that makes it look real: enrichment yield bucketed by `i % 150`
 * is 0.837 for positions 0-119 and 0.749 for 120-149, with a cliff shape
 * (0.841 / 0.729 / 0.676 over the last three tens) — and the effect is
 * SPECIFIC to this constant. Tail-vs-head delta by modulus: 150 gives -0.135,
 * while non-aligned controls give ~0 (100 -0.022, 200 -0.018, 149 +0.020).
 * That correlation convinced two earlier analyses, and then me.
 *
 * The mechanism was then tested directly, three ways, all negative:
 *   1. Batches 3, 11 and 25 sent as ONE 150-id query and as THREE 50-id
 *      queries through `buildEnrichmentQuery` returned IDENTICAL results —
 *      same answered ids, same img/desc count, same row count (141/139/148,
 *      138/105/140, 131/97/137). The big query loses nothing.
 *   2. For those 450 ids the committed artifact equals what Wikidata offers,
 *      exactly: 139/139, 105/105, 97/97.
 *   3. Sampling the tail positions themselves (130-149): Wikidata has
 *      img/desc for 77 of 100, the artifact holds 77. Missing: zero.
 *
 * `LIMIT` could not have been the mechanism either — see SPARQL_ROWS_PER_ID
 * below: a 150-id batch carries LIMIT 7500 and real batches return ~140 rows.
 *
 * So the unenriched targets are cities with no image and no English
 * description upstream; enrichment is complete with respect to what Wikidata
 * has, and the positional pattern is compositional (how country blocks tile
 * into 150-id windows). A correlation with a plausible mechanism is not a
 * measurement of that mechanism.
 */
const IDS_PER_SPARQL_BATCH = 150;
/**
 * The explicit ceiling on the query's result set. With DISTINCT, one entity
 * yields one row per combination of its images, its enwiki title and its
 * English description — one row for almost every city, a handful for a city
 * with several P18 values. 50 rows per id is far above anything real and
 * still bounds a join that goes wrong. Truncation at the limit would look
 * exactly like the partial-answer hazard, which is why
 * `isBatchAnswerPlausible` guards it rather than the limit being trusted to
 * be generous enough.
 */
const SPARQL_ROWS_PER_ID = 50;
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
 *
 * DISTINCT and LIMIT are not decoration. Without DISTINCT the three OPTIONALs
 * multiply out into duplicate rows that inflate the response for no extra
 * information; without LIMIT there is no ceiling at all on what a mis-planned
 * join can return, and an oversized result set is exactly what makes an
 * endpoint answer 200 with a body that stops early.
 */
export function buildEnrichmentQuery(geonameIds) {
  const values = geonameIds
    .map((id) => {
      if (!GEONAMES_ID.test(id)) throw new Error(`"${id}" is not a GeoNames id — expected "G" + digits`);
      return `"${id.slice(1)}"`;
    })
    .join(' ');
  return `
SELECT DISTINCT ?gid ?x ?img ?title ?desc WHERE {
  VALUES ?gid { ${values} }
  ?x wdt:P1566 ?gid.
  OPTIONAL { ?x wdt:P18 ?img. }
  OPTIONAL { ?article schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
  OPTIONAL { ?x schema:description ?desc. FILTER(LANG(?desc) = "en") }
}
LIMIT ${geonameIds.length * SPARQL_ROWS_PER_ID}`;
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
 * One country's whole delete-and-re-add decision, as a pure function.
 *
 * This is a unit because the scope narrowing — the single `.filter` below — is
 * the guard that makes a failed batch cost nothing, and while it lived inline
 * in the run loop no test could reach it. Deleting the filter left the entire
 * suite green while letting one failed batch delete a whole country's
 * enrichment, commit it, and exit 0.
 *
 * The dispositions are the other half of the reason. The live run yielded
 * 5,118 of 6,245 and recorded nothing about WHY the other 1,127 missed, so the
 * shortfall was explained by inspection and explained wrong. Every target id
 * now lands in exactly one bucket.
 */
export function planCountry(previousCities, entities, scope, answered) {
  // Only ids whose batch returned. An unasked id is not recomputed, so it
  // keeps whatever the last successful run gave it.
  const scoped = scope.filter((id) => answered.has(id));
  const cities = mergeEnrichment(previousCities, entities, scoped);
  const dispositions = { asked: 0, unasked: 0, found: 0, noMatch: 0, droppedEmpty: 0 };
  for (const id of scope) {
    if (!answered.has(id)) {
      dispositions.unasked++;
      continue;
    }
    dispositions.asked++;
    if (Object.hasOwn(cities, id)) dispositions.found++;
    else if (entities.has(id)) dispositions.droppedEmpty++;
    else dispositions.noMatch++;
  }
  return {
    scoped,
    cities,
    dispositions,
    previousCount: Object.keys(previousCities).length,
    nextCount: Object.keys(cities).length,
  };
}

/**
 * Did this batch ANSWER, or did it merely respond?
 *
 * The distinction the earlier design could not make. `mergeEnrichment` deletes
 * every id in scope, so an id may only enter scope if Wikidata genuinely had
 * its say about it. A response carrying rows for far fewer ids than already
 * had enrichment is a truncated result set, a rate-limit page that parsed as
 * JSON, or a query-plan bailout — all of which arrive as HTTP 200 and all of
 * which the throw/no-throw signal reads as a successful, empty answer.
 *
 * Rejecting a batch is cheap and safe: its ids stay unasked and keep the
 * enrichment the last good run gave them. Accepting a partial one is not.
 */
export function isBatchAnswerPlausible(matchedCount, previouslyCoveredCount) {
  if (previouslyCoveredCount === 0) return true; // nothing to lose
  return matchedCount >= previouslyCoveredCount * MIN_BATCH_ANSWER_RATIO;
}

/**
 * The gate between a Wikidata outage and a committed, deployed data wipe.
 *
 * `mergeEnrichment` deletes every id in its scope before re-adding what came
 * back, and `planCountry` already narrows the scope to batches that answered —
 * but narrowing cannot catch the case where every batch answers plausibly and
 * returns nothing usable, which is what a renamed property or a schema change
 * looks like. Then the merge is legitimately empty and all 6,244 records would
 * be deleted, written, committed and deployed at exit 0.
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

/**
 * The same gate at the scale damage actually arrives at.
 *
 * A global floor is blind to concentrated loss: the biggest country holds 30
 * of 5,118 entries, so zeroing one costs 0.6% and any global floor worth
 * having sits far above that. A country's ids also tend to share a SPARQL
 * batch, which is exactly the unit an upstream truncates.
 */
export function assertCountryCoverageSane(countryCounts) {
  const collapsed = countryCounts.filter(
    ({ previousCount, nextCount }) =>
      previousCount > 0 &&
      previousCount - nextCount > COUNTRY_COVERAGE_GRACE &&
      nextCount < previousCount * MIN_COUNTRY_COVERAGE_RATIO
  );
  if (collapsed.length > 0) {
    const detail = collapsed
      .slice(0, 10)
      .map(({ country, previousCount, nextCount }) => `${country} ${nextCount}/${previousCount}`)
      .join(', ');
    throw new Error(
      `${collapsed.length} country/countries lost more than ` +
      `${(1 - MIN_COUNTRY_COVERAGE_RATIO) * 100}% of their enrichment (${detail}) — ` +
      `a global coverage ratio cannot see one country being emptied, so this refuses the write`
    );
  }
}

/**
 * The gate that counts QUALITY rather than records.
 *
 * With Wikidata healthy and the Action API down, every description falls back
 * to `entity.description` — Wikidata's terse one-liner — and the record count
 * does not move by one, so every count-based gate reports a perfect run. The
 * descriptions a traveller reads are the product; replacing all of them with
 * stubs and deploying it is a regression the other gates are structurally
 * unable to notice.
 */
export function assertExtractQualitySane(fallbackCount, requestedCount) {
  if (requestedCount < MIN_EXTRACT_SAMPLE) return;
  const ratio = fallbackCount / requestedCount;
  if (ratio > MAX_EXTRACT_FALLBACK_RATIO) {
    throw new Error(
      `${fallbackCount}/${requestedCount} descriptions (${(ratio * 100).toFixed(1)}%) fell back ` +
      `to the Wikidata one-liner, over the ${MAX_EXTRACT_FALLBACK_RATIO * 100}% ceiling — ` +
      `Wikipedia's extract API is degraded, and writing now would commit a silent ` +
      `downgrade of every description with the record count unchanged`
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
function readJson(path) {
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

// ---------------------------------------------------------------------------
// run — the seam between the pure plan and its network/filesystem edges
// ---------------------------------------------------------------------------

/**
 * Everything `node scripts/enrich-cities.mjs` does, minus the entry guard.
 *
 * `fetchBindings`/`loadExtracts` and `targetsPath`/`enrichDir` are injectable
 * so a test can drive the real plan-then-gate-then-write ordering end to end —
 * fake upstream answers in, real gates, real `writeFileAtomic` calls out —
 * without touching Wikidata or `public/cities/`. That is the only way to pin a
 * gate's CALL SITE: `assertEnrichmentSane`'s body was fully tested while
 * deleting the one line that invokes it left the suite green and produced a
 * complete wipe at exit 0. The entry guard below calls `run()` with no
 * arguments, so every parameter defaults to the real implementation and
 * production behaviour is unchanged.
 */
export async function run({
  fetchBindings = fetchSparqlBindings,
  loadExtracts = fetchExtracts,
  targetsPath = TARGETS_PATH,
  enrichDir = ENRICH_DIR,
  argv = process.argv.slice(2),
} = {}) {
  const targetsFile = readJson(targetsPath);
  if (!targetsFile?.targets) {
    throw new Error(`${targetsPath} is missing — run \`node scripts/ingest-cities.mjs\` first`);
  }
  const requested = argv
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
    throw new Error(`${targetsPath} names no cities — rerun \`node scripts/ingest-cities.mjs\``);
  }
  console.log(`Enriching ${allIds.length} cities across ${scopeByCountry.size} countries…`);

  // Read BEFORE the network, for two reasons. An unreadable file has to abort
  // before a single request is made rather than after an hour of them, and
  // every batch's answer is judged against how much enrichment its own ids
  // already carry.
  const previousByCountry = new Map();
  const previouslyCovered = new Set();
  for (const country of scopeByCountry.keys()) {
    const path = join(enrichDir, `${country}.json`);
    const previous = readJson(path);
    previousByCountry.set(country, { path, previous });
    for (const id of Object.keys(previous?.cities ?? {})) previouslyCovered.add(id);
  }

  const entities = new Map();
  /**
   * Ids whose batch came back, and came back plausibly. Only these may be
   * deleted below: `mergeEnrichment` cannot tell "Wikidata has nothing for
   * this city" from "we never got to ask", and a timed-out or truncated batch
   * must cost nothing — otherwise a transient blip becomes a committed,
   * auto-deployed data regression.
   */
  const answered = new Set();
  /** @type {{ batch: number; size: number; covered: number; matched: number; accepted: boolean }[]} */
  const batchReport = [];
  const batches = chunk(allIds, IDS_PER_SPARQL_BATCH);
  for (const [index, batch] of batches.entries()) {
    const covered = batch.filter((id) => previouslyCovered.has(id)).length;
    let fresh = null;
    try {
      const bindings = await fetchBindings(buildEnrichmentQuery(batch), `${index + 1}/${batches.length}`);
      fresh = readEnrichmentBindings(bindings);
    } catch (error) {
      console.warn(
        `  SPARQL batch ${index + 1} failed (${error.message.slice(0, 120)}) — ` +
        `${batch.length} cities keep their previous enrichment`
      );
    }
    const matched = fresh === null ? 0 : batch.filter((id) => fresh.has(id)).length;
    const accepted = fresh !== null && isBatchAnswerPlausible(matched, covered);
    if (accepted) {
      for (const id of batch) {
        const entity = fresh.get(id);
        if (entity) entities.set(id, entity);
        answered.add(id);
      }
    } else if (fresh !== null) {
      console.warn(
        `  SPARQL batch ${index + 1} answered for ${matched}/${batch.length} ids but ${covered} ` +
        `already carried enrichment — too few to be a data change, so it is treated as a failed ` +
        `batch and ${batch.length} cities keep their previous enrichment`
      );
    }
    batchReport.push({ batch: index + 1, size: batch.length, covered, matched, accepted });
    if ((index + 1) % 5 === 0 || index === batches.length - 1) {
      console.log(`  wikidata ${index + 1}/${batches.length} (${entities.size} entities)`);
    }
  }

  const requestedTitles = [...new Set([...entities.values()].map((e) => e.title).filter(Boolean))];
  const extracts = await loadExtracts(requestedTitles);
  const resolvedTitles = requestedTitles.filter((title) => extracts.get(title)).length;
  const extractFallbacks = requestedTitles.length - resolvedTitles;
  for (const entity of entities.values()) {
    const extract = entity.title ? extracts.get(entity.title) : null;
    entity.description = firstSentences(extract) ?? entity.description;
  }

  // Merged in full BEFORE anything is written, so the gates below can see what
  // the whole run would do. Writing per country as we go would leave half the
  // catalog wiped and half intact when one of them fires.
  const planned = new Map();
  /** @type {{ country: string; previousCount: number; nextCount: number; asked: number; unasked: number; found: number; noMatch: number; droppedEmpty: number }[]} */
  const countryReport = [];
  let previousTotal = 0;
  let nextTotal = 0;
  const dispositions = { asked: 0, unasked: 0, found: 0, noMatch: 0, droppedEmpty: 0 };
  for (const [country, scope] of scopeByCountry) {
    const { path, previous } = previousByCountry.get(country);
    const plan = planCountry(previous?.cities ?? {}, entities, scope, answered);
    previousTotal += plan.previousCount;
    nextTotal += plan.nextCount;
    for (const key of Object.keys(dispositions)) dispositions[key] += plan.dispositions[key];
    planned.set(country, { path, previous, cities: plan.cities });
    countryReport.push({
      country,
      previousCount: plan.previousCount,
      nextCount: plan.nextCount,
      ...plan.dispositions,
    });
  }

  // Every gate runs before the first byte is written, and each covers a shape
  // the others structurally cannot see: quality with the record count
  // unchanged, a global collapse, and a single country emptied inside a
  // healthy global ratio.
  assertExtractQualitySane(extractFallbacks, requestedTitles.length);
  assertEnrichmentSane(previousTotal, nextTotal);
  assertCountryCoverageSane(countryReport);

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
    `Wrote ${planned.size} enrichment files to ${enrichDir} ` +
    `(${written} changed, ${nextTotal} cities enriched, ${dispositions.unasked} unasked)`
  );
  reportDispositions({
    dispositions,
    batchReport,
    countryReport,
    requestedTitles: requestedTitles.length,
    resolvedTitles,
  });
  return {
    written,
    previousTotal,
    nextTotal,
    unasked: dispositions.unasked,
    dispositions,
    batchReport,
    countryReport,
    extracts: { requested: requestedTitles.length, resolved: resolvedTitles, fallback: extractFallbacks },
  };
}

/**
 * Why the yield is what it is.
 *
 * The live run reported "82.0% of 6,245" and nothing else, so the missing
 * 1,127 were explained by inspection and explained wrong — the report blamed
 * "tail-end smaller municipalities" when the missing Swiss cities were Zürich,
 * Basel, Bern and Lausanne. Every number below distinguishes a cause: an id
 * Wikidata has no P1566 row for is a data fact; an id that matched and was
 * dropped for carrying neither a description nor an image is a different data
 * fact; an id whose batch was rejected is an upstream problem. The per-batch
 * line is what makes a truncated result set visible — a batch whose matched
 * count sits well under its previously-covered count is not a country that
 * changed, it is a response that stopped early.
 */
function reportDispositions({ dispositions, batchReport, countryReport, requestedTitles, resolvedTitles }) {
  console.log(
    `  dispositions: ${dispositions.found} found, ${dispositions.noMatch} no P1566 match, ` +
    `${dispositions.droppedEmpty} matched but empty, ${dispositions.unasked} unasked`
  );
  console.log(
    `  descriptions: ${resolvedTitles}/${requestedTitles} from Wikipedia extracts, ` +
    `${requestedTitles - resolvedTitles} fell back to the Wikidata one-liner`
  );
  console.log(
    `  batch yield (matched/size ~previously covered): ${batchReport
      .map((b) => `${b.batch}:${b.matched}/${b.size}~${b.covered}${b.accepted ? '' : ' REJECTED'}`)
      .join(' ')}`
  );
  const lean = countryReport
    .filter((c) => c.noMatch + c.droppedEmpty > 0)
    .sort((a, b) => b.noMatch + b.droppedEmpty - (a.noMatch + a.droppedEmpty))
    .slice(0, 10);
  if (lean.length > 0) {
    console.log(
      `  lowest-yield countries: ${lean
        .map((c) => `${c.country} ${c.found}/${c.asked + c.unasked} (${c.noMatch} no match, ${c.droppedEmpty} empty)`)
        .join(', ')}`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`\nCity enrichment failed: ${error.message}`);
    console.error('If this is a network error, Wikidata/Wikipedia may be unreachable — rerun later.');
    process.exit(1);
  });
}
