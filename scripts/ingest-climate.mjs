/**
 * ingest-climate.mjs
 *
 * Builds public/climate/<CC>.json — twelve months of climate normals for every
 * catalogued city, sampled from CHELSA V2.1 1981–2010 (spec §9).
 *
 * Run by hand, or by `workflow_dispatch`, and the output committed:
 *
 *     node scripts/ingest-climate.mjs
 *
 * It reads 60 rasters (five variables × twelve months, 10.65 GB) and writes
 * 246 shards plus an index — twenty to forty minutes even with every raster
 * already cached, and the spread between those two is how much else the
 * machine is doing. So everything below follows `build-provinces.mjs`'s
 * discipline: the arithmetic is pure and exported, the I/O is not, every gate
 * fires before any write, and an entry-point guard keeps an `import` from
 * starting the fetch. Importing this file to test one rule costs nothing.
 *
 * Every number the pure functions depend on was MEASURED, and the measurements
 * plus their contradictions with spec §9.1–§9.3 are in `data/climate-probe.md`.
 * That document is the authority; code here that disagrees with it is wrong.
 * Three of its findings shape everything below.
 *
 *   1. **There are two grids, not one.** §9.1 gives a single 43200 × 20880
 *      transform for the whole product. That is right for `tasmin`, `tasmax`
 *      and `pr` and wrong for `clt`, which is 14401 × 7201 on a different
 *      origin at a different resolution — and unlike the others it reaches
 *      both poles, where they stop at +84. So `pixelFor` takes the grid as an
 *      argument, and `gridOf` builds one out of each file's own tags; there
 *      are no grid constants in this module, deliberately.
 *
 *   2. **Both grids are PixelIsArea.** `GTRasterTypeGeoKey` reads 1 on both
 *      rasters, so the origin tag is the OUTER EDGE of pixel (0,0) rather than
 *      its centre, and the index is a plain `floor` with no half-cell
 *      correction. Neither bbox is the round number either — the 1 km grid is
 *      about 1.4 × 10⁻⁴° off −180/+84 on every edge — which is why the
 *      resolution must come from the tag and not from `1/120`.
 *
 *   3. **Scaling is per file.** Each raster carries its own `SCALE`/`OFFSET`
 *      in `GDAL_METADATA`, and `real = raw * SCALE + OFFSET`. Hard-coding them
 *      is how a build reports Singapore at 298 °C: §9.1 states the 0.1 scale
 *      for `tasmin` and omits the −273.15 offset entirely. Nodata is per file
 *      too: `tasmin`, `tasmax` and `pr` declare −2147483647, which a 16-bit
 *      unsigned sample cannot hold, while `clt` and `hurs` declare 65535,
 *      which it can. So `decodeSample` is told what absence looks like rather
 *      than assuming it. (The probe measured four of the five; `hurs` was
 *      first read in this build, and it follows `clt`.)
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { GZIP_BUDGET } from './build-provinces.mjs';
import {
  CACHE_DIR,
  CITY_DIR,
  MONTHS,
  OUT_DIR,
  REPORT_PATH,
  ensureRaster,
  readCatalog,
  readGeometry,
} from './climate/acquire.mjs';
import { assertBudget, assertCityParity, assertRowShape, assertShardCoverage } from './climate/gate.mjs';
import { climatePayload, indexPayload, readPrevious, writeFileAtomic } from './climate/payload.mjs';
import { PeakRss, assembleRows, bucketByRow, sampleRaster } from './climate/raster.mjs';
import { buildReport, pct, seconds } from './climate/report.mjs';
import { MONTHS_PER_YEAR, SAMPLE_FIELDS } from './climate/sample.mjs';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** How many shards this run has put on disk, for the failure message. */
let written = 0;

/**
 * Acquires and samples all 60 rasters, one at a time.
 *
 * One variable-month is open at once and no more: `sampleRaster` closes each
 * file before the next is opened, so the resident cost is one decoded row plus
 * the accumulating samples, not two 115 MB rasters.
 *
 * Prints a line per raster, because this is twenty minutes of work behind a
 * detached process and a silent one is indistinguishable from a hung one.
 */
async function sampleAll(cities, peak) {
  /** @type {Record<string, Float64Array[]>} */
  const samples = {};
  const rasters = [];
  const variables = [];
  let atNodata = 0;
  let rowReads = 0;

  for (const variable of SAMPLE_FIELDS) {
    samples[variable] = [];
    let grid = null;
    let buckets = null;
    let scaling = null;
    for (const month of MONTHS) {
      const acquired = await ensureRaster(variable, month);
      const startedRaster = performance.now();
      if (grid === null) {
        // The transform and the scaling are taken from the variable's first
        // month and the city→row buckets computed once from them, because all
        // twelve months of a variable share a grid. `sampleRaster` re-reads
        // every file's own tags and refuses to sample against a mismatch, so
        // this is a saving rather than an assumption. It costs one extra open
        // of January, which reads the IFD and no pixels.
        ({ grid, scaling } = await readGeometry(acquired.path));
        buckets = bucketByRow(cities, grid);
      }
      const sampled = await sampleRaster(acquired.path, grid, scaling, buckets, cities.length, peak);
      samples[variable].push(sampled.values);
      atNodata += sampled.atNodata;
      rowReads += buckets.rows.length;
      const sampleMs = performance.now() - startedRaster;
      rasters.push({ variable, month, ...acquired, sampleMs, atNodata: sampled.atNodata });
      console.log(
        `${variable.padEnd(7)} ${month}  ${String(acquired.bytes).padStart(10)} B  ` +
        `${acquired.downloadedBytes === 0 ? 'cached  ' : 'fetched '}  ` +
        `${String(buckets.rows.length).padStart(6)} rows  ${seconds(sampleMs).padStart(6)} s  ` +
        `rss ${Math.round(peak.sample() / 1024 / 1024)} MB`
      );
    }
    const own = rasters.filter((r) => r.variable === variable);
    variables.push({
      variable,
      grid,
      scaling,
      rowsTouched: buckets.rows.length,
      offRaster: buckets.offRaster.length,
      bytes: own.reduce((n, r) => n + r.bytes, 0),
      downloadedBytes: own.reduce((n, r) => n + r.downloadedBytes, 0),
      sampleMs: own.reduce((n, r) => n + r.sampleMs, 0),
    });
  }
  return { samples, rasters, variables, atNodata, rowReads };
}

/**
 * The three ways the sample itself can be wrong, each fatal and each silent.
 *
 * All three are expected to be zero on this CHELSA release and none of them is
 * guaranteed by the format, which is exactly why they are gates: a city off
 * the raster, a city on a sentinel and a city with an unwritable month all end
 * the same way — the city is simply absent from the artifact, and every
 * remaining gate still passes.
 */
export function assertSampleHealth(offRaster, atNodata, skipped) {
  if (offRaster > 0) {
    throw new Error(
      `${offRaster} city-raster pair(s) fall outside the grid — the 1 km rasters stop at +84° ` +
      `and every one of those cities would be dropped from the artifact without a word`
    );
  }
  if (atNodata > 0) {
    throw new Error(
      `${atNodata} sample(s) landed on a file's declared nodata sentinel — ` +
      `data/climate-probe.md measured 0 of 58,757 cities on nodata across four rasters, so this ` +
      `release differs from the one this build was written against and a human should look`
    );
  }
  if (skipped.length > 0) {
    throw new Error(
      `${skipped.length} city/cities have no writable row (e.g. ` +
      `${skipped.slice(0, 5).map((c) => `${c.id} ${c.name}`).join(', ')}) — a 60-int tuple has no ` +
      `per-month absence marker, so each of these would vanish from the artifact silently`
    );
  }
}

/**
 * Every shard's bytes, its size, and whether it differs from what is on disk.
 *
 * Nothing is written here. `changed` is counted against the PREVIOUS BYTES
 * rather than against the payload, because it decides whether the report is
 * rewritten and the report's subject is the tree, not the rows.
 */
function buildShards(countries, cities, rows, now) {
  const sizes = [];
  const entries = [];
  const payloads = new Map();
  let changed = 0;
  for (const country of countries) {
    /** @type {Record<string, number[]>} */
    const shardRows = {};
    for (const city of cities.slice(country.from, country.from + country.count)) {
      shardRows[city.id] = rows.get(city.id);
    }
    const previous = readPrevious(join(OUT_DIR, `${country.code}.json`));
    const json = `${JSON.stringify(climatePayload(country.code, shardRows, previous.value, now))}\n`;
    if (json !== previous.text) changed += 1;
    sizes.push({ code: country.code, raw: Buffer.byteLength(json), gzip: gzipSync(json).length });
    entries.push({ code: country.code, count: country.count });
    payloads.set(country.code, json);
  }
  return { sizes, entries, payloads, changed };
}

async function main() {
  const startedAt = performance.now();
  const peak = new PeakRss();

  const { countries, cities, nullElevations } = readCatalog();
  console.log(`cache:   ${CACHE_DIR}`);
  console.log(`catalog: ${countries.length} shards, ${cities.length} cities`);
  console.log(`rasters: ${SAMPLE_FIELDS.length} variables x ${MONTHS.length} months\n`);

  const { samples, rasters, variables, atNodata, rowReads } = await sampleAll(cities, peak);

  // --- gates, all of them before anything reaches disk ---------------------

  const offRaster = variables.reduce((n, v) => n + v.offRaster, 0);
  const { rows, skipped } = assembleRows(cities, samples);
  assertSampleHealth(offRaster, atNodata, skipped);

  const now = new Date().toISOString();
  const { sizes, entries, payloads, changed: shardsChanged } = buildShards(countries, cities, rows, now);
  // Three gates below read the bytes about to be written, parsed back out of
  // `payloads` once here rather than trusting the maps they were built from —
  // each of those would be a list compared with itself, since every one of
  // them is only ever filled from the same catalog. Re-parsing 11 MB costs a
  // fraction of a second and is the only way any of the three sees
  // `buildShards`'s per-country slice, or a shard whose own envelope disagrees
  // with the key it was written under.
  const writtenIds = [];
  const writtenRows = [];
  const emittedCountries = new Set();
  for (const json of payloads.values()) {
    const parsed = JSON.parse(json);
    emittedCountries.add(parsed.country);
    for (const [id, row] of Object.entries(parsed.cities)) {
      writtenIds.push(id);
      writtenRows.push([id, row]);
    }
  }
  assertRowShape(writtenRows);
  assertCityParity(writtenIds, new Set(cities.map((c) => c.id)));

  let changed = shardsChanged;
  const indexPath = join(OUT_DIR, 'index.json');
  const previousIndex = readPrevious(indexPath);
  // `shardsChanged`, not the listing alone: an erratum re-run moves rows in
  // every shard and changes no country's count, and an index that kept its
  // old stamp through that would date the whole artifact — and the report's
  // `Generated:` line with it — to the previous run.
  const index = indexPayload(entries, previousIndex.value, now, shardsChanged);
  const indexJson = `${JSON.stringify(index)}\n`;
  if (indexJson !== previousIndex.text) changed += 1;
  // `emittedCountries` comes from each shard's own envelope (parsed above),
  // not from `payloads`'s keys or the `countries` array `buildShards` was
  // handed — either of those would be a list compared with itself, the same
  // failure `assertCityParity`'s own docblock warns about, and would not
  // catch a shard whose envelope names the wrong country. The reference is
  // still read from disk fresh, so this asks the filesystem the same question
  // a reviewer would.
  assertShardCoverage(
    emittedCountries,
    new Set(readdirSync(CITY_DIR).filter((n) => /^[A-Z]{2}\.json$/.test(n)).map((n) => n.slice(0, 2)))
  );
  assertBudget(sizes);

  // --- writes --------------------------------------------------------------

  for (const [code, json] of payloads) {
    writeFileAtomic(join(OUT_DIR, `${code}.json`), json);
    written += 1;
  }
  writeFileAtomic(indexPath, indexJson);

  const peakRss = peak.stop();
  // The report carries this run's wall clock and peak RSS, so rewriting it on
  // an unchanged artifact would put the one diff back that preserving the
  // index's timestamp exists to remove. An unchanged artifact's previous
  // measurements still describe it — they are a record of what this build
  // costs, not of how many times it has been run.
  const wroteReport = changed > 0 || !existsSync(REPORT_PATH);
  if (wroteReport) {
    writeFileAtomic(REPORT_PATH, buildReport({
      generatedAt: index.generatedAt,
      sizes,
      rasters,
      variables,
      shardCount: countries.length,
      cityCount: cities.length,
      rowCount: rows.size,
      // The rows themselves, not just their count: `measuredRanges` reads
      // every value of every one of them for the `## Measured ranges` block.
      rows,
      skipped: skipped.length,
      offRaster,
      atNodata,
      sampleCount: cities.length * SAMPLE_FIELDS.length * MONTHS_PER_YEAR,
      nullElevations,
      rasterBytes: rasters.reduce((n, r) => n + r.bytes, 0),
      rowReads,
      wallMs: performance.now() - startedAt,
      peakRss,
    }));
  }

  const raw = sizes.reduce((n, s) => n + s.raw, 0);
  const gzip = sizes.reduce((n, s) => n + s.gzip, 0);
  const worst = [...sizes].sort((a, b) => b.gzip - a.gzip)[0];
  console.log(`\nWrote ${payloads.size} climate shards + index.json to ${OUT_DIR}`);
  console.log(`  ${rows.size} rows, ${raw} B raw, ${gzip} B gzip`);
  console.log(`  worst shard ${worst.code} ${worst.gzip} B gzip (${pct(worst.gzip, GZIP_BUDGET)} of cap)`);
  console.log(`  ${changed} of ${payloads.size + 1} file(s) changed; report ${wroteReport ? 'rewritten' : 'left as it stood'}`);
  console.log(`  ${seconds(performance.now() - startedAt)} s wall, peak RSS ${Math.round(peakRss / 1024 / 1024)} MB`);
}

/**
 * The guard is the reason the tests above can import this module at all.
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
    console.error(`\nClimate ingestion failed: ${error.message}`);
    // Conditional, because the unconditional version is a lie exactly when it
    // matters: every gate runs before the first write, so a failure is almost
    // always clean — but 246 writes are not one transaction, and a throw
    // partway leaves a mixed-generation artifact that only says so here.
    console.error(written === 0
      ? 'Nothing was written — the previous artifacts are untouched.'
      : `${written} shards were already written — the artifact is now MIXED. Re-run to ` +
        `completion before committing, or "git checkout -- public/climate".`);
    process.exit(1);
  });
}
