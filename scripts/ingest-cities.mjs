#!/usr/bin/env node
/**
 * ingest-cities.mjs
 *
 * Builds the worldwide city catalog from GeoNames' cities500 dump: 246
 * per-country shards under public/cities/, a bundled id index under data/, and
 * data/cities-report.md.
 *
 * Population is the wrong axis. At population >= 15,000 every one of Zermatt,
 * Banff, Interlaken, Positano, Queenstown, Hallstatt, Oia, Chamonix, Hakone,
 * Sa Pa, Petra, Kotor and Giverny is absent from the app; the threshold that
 * contains Zermatt (6,629) also contains all 15,363 French communes. So the
 * cut is a composite score — alternate-name count plus twice the log of
 * population — ranked *within each country*, which compares a town against its
 * own national baseline rather than a global threshold. Cusco ranks 2/2,296 in
 * Peru; Kenya's top eight surface Malindi and Naivasha above larger
 * administrative cities.
 *
 * Ranking decides inclusion ONLY. Shards sort by population for display, so
 * the score's quirks never reach the UI. (Dunkirk outranks Lyon in France —
 * wartime fame inflates alternate names.)
 *
 * Rerunnable and idempotent per shard: a country whose 750 rows are unchanged
 * keeps its previous `generatedAt`, so its file is byte-identical and the
 * daily workflow commits only the countries that actually moved. That matters
 * more here than it did for airports: the full artifact set is ~6.5 MB across
 * 246 files, and rewriting all of them nightly would bloat the repo.
 *
 * Like ingest-airports.mjs and unlike ingest-destinations.mjs, this script
 * ABORTS BEFORE WRITING when a sanity check fails. The workflow commits what
 * this writes and Vercel deploys it unattended; a corrupt city catalog is not
 * useful for inspection.
 *
 * Licence: GeoNames is CC BY 4.0 — attribution required (and an indication that
 * the material was changed, which the top-750 filter and the admin-1 resolution
 * in scripts/cities/build.mjs both make it), and unlike OurAirports and Natural
 * Earth it is not public domain. The credit has to be visible in the UI, not
 * just here; components/plan/GeoNamesCredit.tsx renders it, and `buildReport`
 * (scripts/cities/report.mjs) names the files that mount it.
 * lib/contracts.test.ts (C7) fails if one of them drops it, and — because a
 * written-down list cannot catch a surface added later — also derives the set
 * from the tree and fails on an uncredited new one.
 *
 * Usage: node scripts/ingest-cities.mjs
 *
 * The build itself is scripts/cities/: `geonames.mjs` (the ZIP and TSV
 * readers), `build.mjs` (ranking, dedup, shard construction), `gate.mjs`,
 * `io.mjs` (paths, the retrying fetch, the writers) and `report.mjs`. This
 * file is the entry point — `run`, the seam between those pure functions and
 * the network and filesystem, and the guard below it.
 *
 * scripts/cities/build.mjs reads lib/geo.ts and lib/foldPlaceName.ts straight
 * out of lib/, relying on Node's native type stripping (stable since Node
 * 22.18 / 24) so the haversine and the name fold have exactly one definition
 * each rather than a copy under scripts/ that could drift. Both are leaf
 * modules with no imports of their own, which is required: an extensionless
 * `.ts` -> `.ts` import fails under type stripping with ERR_MODULE_NOT_FOUND,
 * and adding the extension inside lib/ fails `tsc` with TS5097. Node prints a
 * MODULE_TYPELESS_PACKAGE_JSON warning for these imports because package.json
 * has no `"type": "module"`; the imports still work and the warning is not
 * worth changing the package's module type for.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildCities } from './cities/build.mjs';
import { assertAdmin1Sane, assertSane } from './cities/gate.mjs';
import { parseAdmin1Codes, parseGeoNamesRows } from './cities/geonames.mjs';
import {
  DATA_DIR,
  SHARD_DIR,
  SOURCE_LICENSE,
  fetchAdmin1Text,
  fetchCitiesTsv,
  readJson,
  shardPayload,
  staleShardFiles,
  stampedPayload,
  writeFileAtomic,
} from './cities/io.mjs';
import { buildReport } from './cities/report.mjs';

// ---------------------------------------------------------------------------
// run — the seam between the pure build and its network/filesystem edges
// ---------------------------------------------------------------------------

/**
 * Everything `node scripts/ingest-cities.mjs` does, minus the entry guard.
 *
 * `loadCitiesTsv`/`loadAdmin1Text` and `dataDir`/`shardDir` are injectable so
 * a test can drive the real gate-then-write ordering end to end — fake
 * network responses in, real `assertSane`/`assertAdmin1Sane` gates, real
 * `writeFileAtomic` calls out — without refetching 13.5 MB from GeoNames and
 * without touching `data/` or `public/cities/`. The entry guard below calls
 * `run()` with no arguments, so every parameter defaults to the real
 * implementation and production behaviour is unchanged.
 */
export async function run({
  loadCitiesTsv = fetchCitiesTsv,
  loadAdmin1Text = fetchAdmin1Text,
  dataDir = DATA_DIR,
  shardDir = SHARD_DIR,
} = {}) {
  const catalogPath = join(dataDir, 'catalog.json');
  const shardIndexPath = join(shardDir, 'index.json');
  const cityIndexPath = join(dataDir, 'cities-index.json');
  const enrichTargetsPath = join(dataDir, 'cities-enrich-targets.json');
  const reportPath = join(dataDir, 'cities-report.md');

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(shardDir, { recursive: true });

  const tsv = await loadCitiesTsv();

  const admin1Codes = parseAdmin1Codes(await loadAdmin1Text());
  // Gated before anything reads it: a reshaped file parses to a near-empty Map
  // and every `a1` becomes null, which no later check would notice.
  assertAdmin1Sane(admin1Codes);
  console.log(`  ${admin1Codes.size} admin-1 names`);

  const rows = parseGeoNamesRows(tsv);
  console.log(`  parsed ${rows.length} usable rows`);

  // The existing catalog is read here rather than imported, so no import
  // attribute is needed and the pure functions stay testable without it.
  const catalog = readJson(catalogPath);
  const catalogCities = catalog?.cities ?? [];
  console.log(`  deduplicating against ${catalogCities.length} Wikidata cities`);

  const { shards, targets, total } = buildCities(rows, admin1Codes, catalogCities);
  const previousIndex = readJson(shardIndexPath);
  assertSane(shards, previousIndex);

  const now = new Date().toISOString();
  const countries = [];
  const indexRows = [];
  let changed = 0;
  let largest = { code: '', bytes: 0 };

  for (const country of [...shards.keys()].sort()) {
    const cities = shards.get(country);
    const path = join(shardDir, `${country}.json`);
    const payload = shardPayload(country, cities, readJson(path), now);
    if (payload.generatedAt === now) changed++;
    const json = JSON.stringify(payload);
    if (json.length > largest.bytes) largest = { code: country, bytes: json.length };
    writeFileAtomic(path, json);
    countries.push({ code: country, count: cities.length, generatedAt: payload.generatedAt });
    for (const city of cities) {
      indexRows.push([city.id, city.n, country, city.lat, city.lon, city.a1]);
    }
  }

  // Stale shards from a country that vanished. `assertSane` refuses to let a
  // country disappear, so this only ever cleans up after an aborted run — but
  // an orphan file under public/ is a URL the client can still fetch. Files
  // only: `enrich/`, and any directory a later phase puts here, is not a
  // shard and must not reach `rmSync` — see `staleShardFiles`.
  for (const entry of staleShardFiles(shardDir, shards.keys())) {
    rmSync(join(shardDir, entry), { force: true });
    console.log(`  removed stale shard ${entry}`);
  }

  // All three index files go through `stampedPayload`, exactly as the 246
  // shards go through `shardPayload`. They are inside refresh-cities.yml's
  // commit-guard paths — public/cities/index.json is under public/cities, and
  // the other two are named outright — so stamping `now` on them
  // unconditionally would make that guard impossible to satisfy: a
  // commit-on-change job would commit 3.7 MB and redeploy production every
  // night for no data change.
  //
  // index.json is indented: it is the one generated file whose diff a human
  // reads. Everything else here is compact, because megabytes of it are
  // committed and indentation would be pure overhead.
  const shardIndex = stampedPayload(readJson(shardIndexPath), {
    source: SOURCE_LICENSE,
    countries,
  }, now);
  writeFileAtomic(shardIndexPath, JSON.stringify(shardIndex, null, 1));

  // Bundled, never fetched: public/ is unreadable from a Vercel lambda, so
  // this is the only thing resolveDestinations can read a picked city out of.
  // Tuples rather than objects — 3.5 MB instead of 4.35 MB for the same data,
  // and it is parsed once per cold start.
  writeFileAtomic(
    cityIndexPath,
    JSON.stringify(
      stampedPayload(readJson(cityIndexPath), { source: SOURCE_LICENSE, cities: indexRows }, now)
    )
  );

  writeFileAtomic(
    enrichTargetsPath,
    JSON.stringify(
      stampedPayload(
        readJson(enrichTargetsPath),
        { targets: Object.fromEntries([...targets.keys()].sort().map((c) => [c, targets.get(c)])) },
        now
      )
    )
  );

  // The report carries the run's own timestamp and is deliberately OUTSIDE the
  // workflow's change test: it is prose about the run, not an artifact the app
  // reads. It is still committed alongside a real change. `shardIndex`'s
  // timestamp, not `now`, so a quiet day does not rewrite this either.
  writeFileAtomic(
    reportPath,
    buildReport({ shards, total, generatedAt: shardIndex.generatedAt, largest })
  );

  console.log(`Wrote ${shards.size} shards to ${shardDir} (${changed} changed)`);
  console.log(`Wrote ${cityIndexPath} (${indexRows.length} cities)`);
  console.log(`Wrote ${enrichTargetsPath}, ${shardIndexPath}, ${reportPath}`);
}

/**
 * Only runs when this file is invoked directly.
 *
 * Without this guard, importing the module to test one of its rules re-runs
 * the whole ingest and rewrites 246 files as an import side effect — not
 * hypothetical; it happened during review of ingest-airports.mjs. `run()` is
 * exported and can be called directly with fake loaders for exactly that kind
 * of test; this guard is what keeps a plain `import` from doing the same
 * thing with the real ones.
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
    console.error(`\nCity ingestion failed: ${error.message}`);
    console.error('Nothing was written — the previous artifacts are untouched.');
    process.exit(1);
  });
}
