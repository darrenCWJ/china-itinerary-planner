#!/usr/bin/env node
/**
 * ingest-country-facts.mjs
 *
 * Builds data/country-facts.json — structured scalars about every country the
 * app ships a city shard for — from Wikidata's SPARQL endpoint, plus
 * data/country-facts-report.md describing what was and was not derivable.
 *
 * STRUCTURED SCALARS ONLY, NEVER PROSE. The country's English name, currency
 * code and name, plug letters, mains voltage, driving side, emergency numbers
 * with their roles, official languages, dialling code and a centroid latitude
 * used by one cross-check.
 *
 * The NAME is identity, not a fact, and the difference is enforced rather than
 * asserted: it sits in `RECORD_FIELDS` so every shape rule applies to it, and
 * it is deliberately absent from `FACT_FIELDS` so `factCount` - the unit every
 * drift check in this file counts in - does not move by 246 the night this
 * field was added. It exists because the sentences in lib/countryTips.ts have
 * to name the country ("We don't have Peru-specific guidance...") and
 * lib/countries.ts's hand-tuned table covers 24 of the 246: the other 222 read
 * "We don't have PE-specific guidance..." without it. Hand-writing 246 names
 * was the alternative, and it is the thing the honest-gap rule exists to
 * refuse - so the name comes from the same CC0 source, under the same gates,
 * as every other value here.
 * The sentences a traveller reads are written by hand in reviewed TypeScript
 * (lib/countryTips.ts, Task 26) from these scalars; no upstream string is ever
 * rendered as advice. The artifact is called `country-facts`, not
 * `country-guidance`, and that name is a guardrail: it should read as wrong to
 * put a sentence in it.
 *
 * Why an ingest at all: lib/countryProfile.ts already declares the right
 * interface and the plan generators already route through it, but outside
 * China it answers with the neutral defaults. That is honest and thin. These
 * facts turn thin into specific for 246 countries without anybody hand-writing
 * 246 country guides — and a field with no supporting data emits NOTHING
 * rather than a hedge, a placeholder or a guess.
 *
 * Rerunnable and idempotent: `stampedPayload` keeps the previous
 * `generatedAt` when the payload is unchanged, so a quiet night produces a
 * byte-identical file and the nightly workflow has nothing to commit. There is
 * no per-country write loop — the whole merge is computed in memory, every
 * gate runs, and only then does a single whole-file write happen.
 *
 * Like ingest-cities.mjs and ingest-airports.mjs, and unlike
 * ingest-destinations.mjs, this script ABORTS BEFORE WRITING when a sanity
 * check fails. The nightly workflow commits what this writes and Vercel
 * deploys the commit unattended. Task 7 of this project shipped a measured
 * data wipe because an HTTP 200 with a short body was treated as a full
 * answer: it deleted 2,559 of 5,118 records in one night at exit 0. A corrupt
 * facts artifact is not useful for inspection, it is a production incident, so
 * `assertFactsSane` runs before `mkdirSync` and before any write primitive
 * fires.
 *
 * Licence: Wikidata's main and property namespaces are CC0 — a public domain
 * dedication with NO attribution condition. That is confirmed live from the
 * endpoint's own `meta=siteinfo` and it is why this source adds nothing to
 * components/plan/GeoNamesCredit.tsx and nothing to lib/contracts.test.ts's C7
 * contract. That component's own doc-comment argues this exact case for this
 * exact source: naming a CC0 source in a legal notice would imply the credits
 * beside it are discretionary, when every one of them is required. The
 * decision is recorded in three coupled places so a reader cannot mistake it
 * for an oversight — `SOURCE_LICENSE` in scripts/country-facts/io.mjs, the
 * `license` field stamped into the artifact envelope, and the `## Attribution`
 * section of the report.
 *
 * Usage: node scripts/ingest-country-facts.mjs
 *
 * Everything this file used to hold below `run()`'s section banner was moved
 * verbatim into scripts/country-facts/ on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so this file stays under the 800-line
 * guidance: `parse.mjs`, `picks.mjs`, `curated.mjs`, `facts.mjs`, `gate.mjs`,
 * `io.mjs` and `report.mjs`, one per section banner. Nothing about the build
 * changed with them, and `assertFactsSane` — now `gate.mjs`'s — still runs
 * here before `mkdirSync` and before any write primitive fires.
 *
 * This script imports nothing outside node:fs, node:path, node:url and its own
 * scripts/country-facts/ modules. It deliberately reads no `lib/*.ts` leaf:
 * build-time logic may not live in lib/, which is also why `writeFileAtomic`
 * in scripts/country-facts/io.mjs is an acknowledged fourth verbatim copy
 * rather than a shared import. If a future edit does need a leaf, it must be a
 * zero-import one and the import must carry an explicit `.ts` extension —
 * Node's native type stripping (stable since Node 22.18 / 24) fails an
 * extensionless `.ts` -> `.ts` import with ERR_MODULE_NOT_FOUND, and adding
 * the extension inside lib/ fails `tsc` with TS5097.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PROPERTIES,
  applyCurated,
  buildFacts,
  carryForwardFields,
  countAnsweredCountries,
  countPreviousCoverage,
  factCount,
  isPropertyAnswerPlausible,
} from './country-facts/facts.mjs';
import { assertFactsSane } from './country-facts/gate.mjs';
import {
  COUNTRY_CODES,
  DATA_DIR,
  FACTS_FILE,
  REPORT_FILE,
  SOURCE_LICENSE,
  SOURCE_NAME,
  fetchPropertyRows,
  readJson,
  stampedPayload,
  writeFileAtomic,
} from './country-facts/io.mjs';
import { buildReport } from './country-facts/report.mjs';

/**
 * One SPARQL result row, already decoded from CSV: column name -> cell text.
 * @typedef {Record<string, string>} Row
 */

// ---------------------------------------------------------------------------
// run — the seam between the pure build and its network/filesystem edges
// ---------------------------------------------------------------------------

/**
 * Everything `node scripts/ingest-country-facts.mjs` does, minus the entry
 * guard.
 *
 * `fetchBindings` and `dataDir` are injectable so a test can drive the real
 * build-then-gate-then-write ordering end to end — fake upstream answers in,
 * real `assertFactsSane`, real `writeFileAtomic` calls out — without touching
 * Wikidata or `data/`. That is the only way to pin a gate's CALL SITE:
 * scripts/enrich-cities.mjs's `assertEnrichmentSane` had its body fully tested
 * while deleting the one line that invoked it left the suite green and
 * produced a complete wipe at exit 0. The entry guard below calls `run()` with
 * no arguments, so every parameter defaults to the real implementation.
 *
 * `mkdirSync` sits BELOW the gate, unlike scripts/ingest-cities.mjs where it
 * runs first (a tracked finding recorded in scripts/ingest-cities.test.ts's
 * `run() aborts before any write primitive fires when assertSane rejects the
 * feed`). A rejected run must leave no trace at all, and a directory created
 * before the gate is one — which also makes "nothing was written" checkable by
 * a test rather than merely asserted here.
 *
 * @param {{ fetchBindings?: (name: string, codes: string[]) => Promise<Row[]>, dataDir?: string }} [options]
 */
export async function run({ fetchBindings = fetchPropertyRows, dataDir = DATA_DIR } = {}) {
  const factsPath = join(dataDir, FACTS_FILE);
  const reportPath = join(dataDir, REPORT_FILE);

  // Read BEFORE the network, for two reasons. An unreadable artifact has to
  // abort before a single request is made rather than after nine of them, and
  // every property's answer is judged against how many countries already
  // carried the fields it feeds.
  const previous = readJson(factsPath);

  /** @type {Record<string, Row[]>} */
  const byProperty = {};
  const demoted = [];
  /**
   * What the later property queries batch over. Starts as the codes this
   * build ASKS about and narrows to the codes Wikidata ANSWERED with, so a
   * code upstream has stopped carrying is never queried for the other eight
   * properties — and, because `buildFacts` takes the universe from the same
   * answer, never lands in the artifact either.
   */
  let universe = COUNTRY_CODES;
  for (const property of PROPERTIES) {
    const previouslyCovered = countPreviousCoverage(previous, property.fields);
    /** @type {Row[] | null} */
    let rows = null;
    try {
      rows = await fetchBindings(property.name, universe);
    } catch (error) {
      console.warn(`  ${property.name} (${property.property}) failed: ${String(error.message).slice(0, 160)}`);
    }
    if (property.name === 'codes') {
      // The country universe is not a field anything can carry forward: with
      // no codes there is nothing to build, and building from the previous
      // artifact's key set would make a total outage look like a quiet night.
      if (rows === null) {
        throw new Error(
          `the country-code query (${property.property}) failed — without it there is no country ` +
          `universe to build against, and reusing the previous artifact's keys would make a ` +
          `total outage look like a quiet night`
        );
      }
      byProperty.codes = rows;
      universe = [...new Set(rows.map((row) => String(row.code ?? '').trim()).filter((code) => code !== ''))].sort();
      continue;
    }
    const answered = rows === null ? 0 : countAnsweredCountries(rows);
    if (rows !== null && isPropertyAnswerPlausible(answered, previouslyCovered)) {
      byProperty[property.name] = rows;
      continue;
    }
    demoted.push(property);
    byProperty[property.name] = [];
    console.warn(
      `  ${property.name} (${property.property}) answered for ${answered} countries but ` +
      `${previouslyCovered} carried it last run — demoted; those values are carried forward, ` +
      `not deleted`
    );
  }

  const built = buildFacts(byProperty);
  // Curated first, so staleness is judged against the upstream answer alone —
  // carry-forward would otherwise restore last night's curated value and make
  // every override look stale the moment its property has a bad night.
  applyCurated(built);
  for (const property of demoted) carryForwardFields(built, previous, property.fields);

  assertFactsSane(built, previous);

  // Below the gate. Nothing about a rejected run may reach the filesystem,
  // including an empty directory.
  mkdirSync(dataDir, { recursive: true });

  const now = new Date().toISOString();
  const payload = stampedPayload(
    previous,
    { source: SOURCE_NAME, license: SOURCE_LICENSE, countries: built.countries },
    now
  );
  writeFileAtomic(factsPath, JSON.stringify(payload));
  // `scopedLanguages` is null, not `[]`, when P37 was demoted: the diagnostic
  // is empty on such a night because nothing was measured, and the report must
  // not read that as "nothing was scoped". See `languageGap` in `buildReport`.
  const languagesDemoted = demoted.some((property) => property.fields.includes('officialLanguages'));
  writeFileAtomic(
    reportPath,
    buildReport({
      countries: built.countries,
      generatedAt: payload.generatedAt,
      scopedLanguages: languagesDemoted ? null : built.diagnostics.scopedLanguages,
    })
  );

  const total = Object.values(built.countries).reduce((sum, record) => sum + factCount(record), 0);
  console.log(
    `Wrote ${factsPath} (${Object.keys(built.countries).length} countries, ${total} facts` +
    `${payload.generatedAt === now ? '' : ', unchanged'})`
  );
  if (demoted.length > 0) {
    console.log(`  carried forward: ${demoted.map((property) => property.name).join(', ')}`);
  }
  if (built.diagnostics.curatedFired.length > 0) {
    console.log(`  curated overrides fired: ${built.diagnostics.curatedFired.join(', ')}`);
  }
  console.log(`Wrote ${reportPath}`);
}

/**
 * Only runs when this file is invoked directly.
 *
 * Without this guard, importing the module to test one of its rules re-runs
 * the whole ingest as an import side effect — not hypothetical; it happened
 * during review of ingest-airports.mjs. `run()` is exported and can be called
 * directly with fake loaders for exactly that kind of test.
 *
 * Compared as file URLs rather than as paths because on Windows
 * `process.argv[1]` is a drive path while `import.meta.url` is a `file://`
 * URL, so comparing them directly would never match and running the script
 * would silently do nothing. `process.argv[1]` is checked for existence first
 * because it is undefined under `node --eval`, where `pathToFileURL(undefined)`
 * throws.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`\nCountry facts ingestion failed: ${error.message}`);
    console.error('Nothing was written — the previous artifact is untouched.');
    process.exit(1);
  });
}
