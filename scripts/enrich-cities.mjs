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
 *
 * The build itself is scripts/enrich/: `plan.mjs` (the query, the binding
 * reader, the merge, `planCountry` and all five gates above, each with the
 * constant it reads) and `io.mjs` (the retrying fetch, the two upstreams, the
 * atomic write and the JSON read, with the endpoints and the timeouts). This
 * file is the entry point — `run`, the seam between those pure functions and
 * the network and filesystem, and the guard below it.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchExtracts, fetchSparqlBindings, readJson, writeFileAtomic } from './enrich/io.mjs';
import {
  assertCountryCoverageSane,
  assertEnrichmentSane,
  assertExtractQualitySane,
  buildEnrichmentQuery,
  chunk,
  firstSentences,
  isBatchAnswerPlausible,
  planCountry,
  readEnrichmentBindings,
} from './enrich/plan.mjs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS_PATH = join(ROOT_DIR, 'data', 'cities-enrich-targets.json');
const ENRICH_DIR = join(ROOT_DIR, 'public', 'cities', 'enrich');

const SOURCE = 'Wikidata (CC0) + Wikipedia (CC BY-SA) summaries';

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
 * in scripts/enrich/plan.mjs: a 150-id batch carries LIMIT 7500 and real
 * batches return ~140 rows.
 *
 * So the unenriched targets are cities with no image and no English
 * description upstream; enrichment is complete with respect to what Wikidata
 * has, and the positional pattern is compositional (how country blocks tile
 * into 150-id windows). A correlation with a plausible mechanism is not a
 * measurement of that mechanism.
 */
const IDS_PER_SPARQL_BATCH = 150;

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
