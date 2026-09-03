/**
 * Measures CHELSA V2.1 against this repo's city catalog, once, before Plan 5
 * commits to a 6.4 GB ingest.
 *
 *     node scripts/probe-chelsa.mjs
 *
 * Throwaway. It writes no artifact under `public/` or `data/` — its output is
 * the numbers it prints plus a machine-readable dump beside the raster cache,
 * transcribed into `data/climate-probe.md`. Task 6 deletes this file once the
 * real ingest exists. Deliberately not an npm script, for the same reason.
 *
 * Two constraints shape the code:
 *
 *   - **Rasters never touch the repo.** This working copy is inside a
 *     OneDrive-synced folder, so 520 MB of GeoTIFF dropped anywhere under it
 *     would be uploaded. They go to `CIP_CHELSA_CACHE`, else a `cip-chelsa`
 *     directory in the OS temp dir.
 *   - **Nothing decodes a whole raster.** 43200 x 20880 uint16 is 1.8 GB
 *     resident; the real ingest's budget is sub-500 MB RSS. Cities are grouped
 *     by the raster's own storage block and each touched block is decoded once
 *     and released, so peak resident is one block plus the catalog.
 *
 * The block turns out to be a single 43200-pixel row, not the 512x512 tile
 * §9.1 describes — see `data/climate-probe.md`. The grouping code is written
 * against whatever `getTileWidth`/`getTileHeight` report so it is right either
 * way, and it is what keeps the working set at 86 KB per read.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

import { fromFile } from 'geotiff';

/** Resolved from this file, never `process.cwd()` — see build-provinces.mjs. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CITY_DIR = join(REPO_ROOT, 'public', 'cities');

/**
 * The spec (§9.1) names no URL. This pattern is the one that answers 200 for
 * all four variables; `clt` lives beside the three the spec does name.
 */
const MONTH = '01';
const VARIABLES = ['tasmin', 'tasmax', 'pr', 'clt'];
/** Identified by their 16-byte header only — never downloaded. */
const NOT_SAMPLED = ['hurs', 'tas'];
const urlFor = (variable) =>
  `https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010/${variable}` +
  `/CHELSA_${variable}_${MONTH}_1981-2010_V.2.1.tif`;

const CACHE_DIR = process.env.CIP_CHELSA_CACHE || join(tmpdir(), 'cip-chelsa');

/** The commit whose tree still carries GeoNames' `-9999` elevation sentinel. */
const PRE_SENTINEL_FIX_COMMIT = 'c6fa7f5';

/** `build-provinces.mjs`'s two per-file budgets, reused as the yardstick. */
const GZIP_BUDGET = 150_000;
const RAW_TRIPWIRE = 700_000;

/** The sentinel §9.1 names. Whether it is the one the files use is the point. */
const SPEC_NODATA = 65535;

/** Distinct from any uint16: the sampling loop never reached this cell. */
const UNREAD = -1;

/**
 * Cities the January answer is checkable against without any external data:
 * equatorial (one wet, one bone-dry), mid-latitude continental, southern
 * summer, polar. A wrong scale factor puts at least one of these somewhere
 * absurd.
 */
const REFERENCE_CITIES = [
  'G1880252', // Singapore
  'G524901', // Moscow, RU
  'G360630', // Cairo, EG
  'G2147714', // Sydney, AU
  'G3413829', // Reykjavík, IS
  'G3936456', // Lima, PE
  'G3663517', // Manaus, BR
  'G1275339', // Mumbai, IN
  'G6185377', // Yellowknife, CA
  'G2729907', // Longyearbyen, SJ
];

// --- the catalog -----------------------------------------------------------

/**
 * Reads the committed shards as raw JSON rather than through
 * `lib/cityShard.ts`. That parser nulls `elev` at `-9999`, and the sentinel is
 * one of the things being counted here, so going through it would erase the
 * measurement.
 */
function readCityCatalog() {
  const files = readdirSync(CITY_DIR).filter((f) => /^[A-Z]{2}\.json$/.test(f));
  const cities = [];
  const perCountry = new Map();
  let sentinelElevations = 0;
  let nullElevations = 0;
  for (const file of files.sort()) {
    const shard = JSON.parse(readFileSync(join(CITY_DIR, file), 'utf8'));
    perCountry.set(shard.country, shard.cities.length);
    for (const row of shard.cities) {
      if (row.elev === -9999) sentinelElevations += 1;
      if (row.elev === null || row.elev === undefined) nullElevations += 1;
      cities.push({ id: row.id, name: row.n, cc: shard.country, lat: row.lat, lon: row.lon });
    }
  }
  return { cities, perCountry, sentinelElevations, nullElevations, shardCount: files.length, extremes: extremesOf(cities) };
}

/**
 * The four corners of the catalog. The northernmost city is what decides
 * whether `tas*`/`pr` stopping at +84 rather than +90 costs anything at all.
 */
function extremesOf(cities) {
  const pick = (compare) => cities.reduce((best, c) => (compare(c, best) ? c : best), cities[0]);
  const label = (c) => ({ name: c.name, cc: c.cc, lat: c.lat, lon: c.lon });
  return {
    north: label(pick((c, b) => c.lat > b.lat)),
    south: label(pick((c, b) => c.lat < b.lat)),
    east: label(pick((c, b) => c.lon > b.lon)),
    west: label(pick((c, b) => c.lon < b.lon)),
  };
}

/**
 * How many rows carried the sentinel before `c6fa7f5` nulled it at the ingest,
 * and where. One `git grep -o` over that tree rather than 246 `git show`s —
 * and `-o` rather than `-c`, because the shards are one line of JSON each and
 * a line-counting grep would report 1 per file instead of the occurrences.
 */
function historicalSentinelRows() {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-o', '-F', '"elev":-9999', PRE_SENTINEL_FIX_COMMIT, '--', 'public/cities/*.json'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }
    );
    const byCountry = new Map();
    let total = 0;
    for (const line of out.split('\n')) {
      const match = /public\/cities\/([A-Z]{2})\.json:/.exec(line);
      if (!match) continue;
      byCountry.set(match[1], (byCountry.get(match[1]) ?? 0) + 1);
      total += 1;
    }
    return { commit: PRE_SENTINEL_FIX_COMMIT, total, byCountry };
  } catch (error) {
    return { commit: PRE_SENTINEL_FIX_COMMIT, error: String(error.message ?? error) };
  }
}

// --- acquisition -----------------------------------------------------------

async function headContentLength(url) {
  const response = await fetch(url, { method: 'HEAD' });
  if (!response.ok) throw new Error(`HEAD ${url}: ${response.status} ${response.statusText}`);
  const length = Number(response.headers.get('content-length'));
  if (!Number.isInteger(length) || length <= 0) throw new Error(`HEAD ${url}: no usable content-length`);
  return length;
}

/**
 * Streams to disk rather than buffering: `pr` alone is 219 MB, and an
 * `arrayBuffer()` of it would be resident for the whole write.
 *
 * A file already on disk at the advertised byte size is taken as good. A
 * truncated one is re-fetched, because a partial GeoTIFF fails deep inside a
 * block read with an error that says nothing about the download.
 */
async function ensureRaster(variable) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const url = urlFor(variable);
  const path = join(CACHE_DIR, `CHELSA_${variable}_${MONTH}_1981-2010_V.2.1.tif`);
  const expected = await headContentLength(url);
  if (existsSync(path) && statSync(path).size === expected) {
    return { variable, url, path, bytes: expected, downloadMs: 0, cached: true };
  }
  const startedAt = performance.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: ${response.status} ${response.statusText}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  const written = statSync(path).size;
  if (written !== expected) throw new Error(`${path}: wrote ${written} B, expected ${expected} B`);
  return { variable, url, path, bytes: expected, downloadMs: performance.now() - startedAt, cached: false };
}

/**
 * The flavour of a variable this probe does NOT download, from a 16-byte range
 * read. §9.1's only BigTIFF claim is about `hurs`, which is not one of the four
 * — and `hurs` is an input to §9.4's mugginess term, so the claim would reach
 * the real ingest even though nothing here samples it. Two requests settle it;
 * downloading 345 MB to find out would not be worth it.
 */
async function probeRemoteHeader(variable) {
  const url = urlFor(variable);
  const bytes = await headContentLength(url);
  const response = await fetch(url, { headers: { Range: 'bytes=0-15' } });
  if (!response.ok) throw new Error(`GET ${url} (range): ${response.status} ${response.statusText}`);
  const head = Buffer.from(await response.arrayBuffer());
  const order = head.toString('ascii', 0, 2);
  const little = order === 'II';
  const magic = little ? head.readUInt16LE(2) : head.readUInt16BE(2);
  return { variable, url, bytes, byteOrder: order, magic, flavour: magic === 43 ? 'BigTIFF' : magic === 42 ? 'classic' : 'unknown' };
}

/**
 * Byte order and magic straight off the front of the file, before geotiff.js
 * sees it — §9.1 claims classic (42) for `tas*`/`pr` and says nothing at all
 * about `clt`, and a BigTIFF widens every offset the real ingest would have to
 * arithmetic over.
 */
async function readTiffHeader(path) {
  const handle = await open(path, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(16), 0, 16, 0);
    const order = buffer.toString('ascii', 0, 2);
    const little = order === 'II';
    if (!little && order !== 'MM') throw new Error(`${path}: byte order is ${JSON.stringify(order)}, not II or MM`);
    const magic = little ? buffer.readUInt16LE(2) : buffer.readUInt16BE(2);
    return { byteOrder: order, magic, flavour: magic === 43 ? 'BigTIFF' : magic === 42 ? 'classic' : 'unknown' };
  } finally {
    await handle.close();
  }
}

// --- tags ------------------------------------------------------------------

/**
 * geotiff 3's `getFileDirectory()` hands back an `ImageFileDirectory`, not the
 * plain tag bag version 2 returned: fields are reached through `hasTag` and
 * `loadValue`, and the synchronous `getValue` *throws* on a deferred field
 * rather than returning undefined. `GDAL_METADATA` is deferred, so reading it
 * as a property yields `undefined` in silence — indistinguishable from a tag
 * the file does not carry, which is how the scale factor nearly went unread.
 */
async function readTags(directory) {
  const value = async (name) => (directory.hasTag(name) ? await directory.loadValue(name) : undefined);
  const scalar = (v) => (v === undefined || v === null ? null : ArrayBuffer.isView(v) || Array.isArray(v) ? Array.from(v) : v);
  const text = (v) => {
    if (typeof v === 'string') return v.replace(/\0+$/, '');
    if (ArrayBuffer.isView(v) || Array.isArray(v)) return Buffer.from(Array.from(v)).toString('latin1').replace(/\0+$/, '');
    return null;
  };
  const noData = text(await value('GDAL_NODATA'));
  return {
    compression: scalar(await value('Compression')),
    predictor: scalar(await value('Predictor')),
    rowsPerStrip: scalar(await value('RowsPerStrip')),
    sampleFormat: scalar(await value('SampleFormat')),
    bitsPerSample: scalar(await value('BitsPerSample')),
    planarConfiguration: scalar(await value('PlanarConfiguration')),
    gdalNoData: noData === null || noData === '' ? null : Number(noData),
    gdalMetadata: text(await value('GDAL_METADATA')),
  };
}

/**
 * GDAL's convention, and the only statement of the scale factor that comes
 * from the data rather than from the spec: `real = raw * SCALE + OFFSET`,
 * both carried as `<Item role="...">` in the GDAL_METADATA tag.
 */
function readScaling(gdalMetadata) {
  const item = (role) => {
    const match = new RegExp(`role="${role}"[^>]*>([^<]+)<`).exec(gdalMetadata ?? '');
    return match ? Number(match[1]) : null;
  };
  const scale = item('scale');
  const offset = item('offset');
  return {
    scale: scale === null || !Number.isFinite(scale) ? 1 : scale,
    offset: offset === null || !Number.isFinite(offset) ? 0 : offset,
    declared: scale !== null || offset !== null,
  };
}

// --- sampling --------------------------------------------------------------

/** Peak of `rss` over the run, sampled on a timer and after every block. */
class PeakRss {
  constructor() {
    this.peak = process.memoryUsage().rss;
    this.timer = setInterval(() => this.sample(), 50);
    this.timer.unref();
  }
  sample() {
    const rss = process.memoryUsage().rss;
    if (rss > this.peak) this.peak = rss;
    return rss;
  }
  stop() {
    clearInterval(this.timer);
    return this.peak;
  }
}

/**
 * Nearest-cell lookup for every city in one raster.
 *
 * Cities are bucketed by storage block first and the buckets walked in block
 * order, so each touched block is decoded once and released before the next.
 * Sampling city-by-city would re-decode the same dense blocks hundreds of
 * times; decoding the whole raster would need 1.8 GB.
 */
async function sampleVariable(raster, cities, peak) {
  const startedAt = performance.now();
  const tiff = await fromFile(raster.path);
  try {
    const imageCount = await tiff.getImageCount();
    const image = await tiff.getImage(0);
    const width = image.getWidth();
    const height = image.getHeight();
    const blockWidth = image.getTileWidth();
    const blockHeight = image.getTileHeight();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const tags = await readTags(image.getFileDirectory());

    const blocksAcross = Math.ceil(width / blockWidth);
    const blocksDown = Math.ceil(height / blockHeight);

    // block index -> [{ cityIndex, col, row }]
    const buckets = new Map();
    let outsideLat = 0;
    let outsideLon = 0;
    const outsideExamples = [];
    for (let i = 0; i < cities.length; i += 1) {
      const city = cities[i];
      const col = Math.floor((city.lon - originX) / resX);
      const row = Math.floor((city.lat - originY) / resY);
      if (row < 0 || row >= height) {
        outsideLat += 1;
        if (outsideExamples.length < 10) outsideExamples.push({ ...city, axis: 'lat', row });
        continue;
      }
      if (col < 0 || col >= width) {
        outsideLon += 1;
        if (outsideExamples.length < 10) outsideExamples.push({ ...city, axis: 'lon', col });
        continue;
      }
      const block = Math.floor(row / blockHeight) * blocksAcross + Math.floor(col / blockWidth);
      const bucket = buckets.get(block);
      if (bucket) bucket.push({ i, col, row });
      else buckets.set(block, [{ i, col, row }]);
    }

    const values = new Int32Array(cities.length).fill(UNREAD);
    // Every cell of every block that gets decoded anyway, swept for the
    // sentinel §9.1 names. Answers "does 65535 occur at all" far more strongly
    // than the per-city count can, at the cost of one pass over data already
    // in cache.
    let cellsScanned = 0;
    let sentinelCells = 0;
    let cellMin = Infinity;
    let cellMax = -Infinity;
    for (const block of [...buckets.keys()].sort((a, b) => a - b)) {
      const bx = block % blocksAcross;
      const by = Math.floor(block / blocksAcross);
      const left = bx * blockWidth;
      const top = by * blockHeight;
      const rasters = await image.readRasters({
        window: [left, top, Math.min(left + blockWidth, width), Math.min(top + blockHeight, height)],
      });
      // `width`/`height` are set on the RESULT array, not on each sample's
      // typed array. Reading `band.width` yields undefined, the index goes
      // NaN, and every city silently samples 0 — which is a plausible-looking
      // raw value, so nothing throws.
      const band = rasters[0];
      const bandWidth = rasters.width;
      for (const { i, col, row } of buckets.get(block)) {
        values[i] = band[(row - top) * bandWidth + (col - left)];
      }
      for (let k = 0; k < band.length; k += 1) {
        const v = band[k];
        if (v === SPEC_NODATA) sentinelCells += 1;
        if (v < cellMin) cellMin = v;
        if (v > cellMax) cellMax = v;
      }
      cellsScanned += band.length;
      peak.sample();
    }

    return {
      variable: raster.variable,
      url: raster.url,
      bytes: raster.bytes,
      cached: raster.cached,
      downloadMs: raster.downloadMs,
      sampleMs: performance.now() - startedAt,
      geometry: {
        imageCount,
        width,
        height,
        isTiled: image.isTiled,
        blockWidth,
        blockHeight,
        blocksAcross,
        blocksDown,
        blocksTotal: blocksAcross * blocksDown,
        blocksTouched: buckets.size,
        origin: [originX, originY],
        resolution: [resX, resY],
        boundingBox: image.getBoundingBox(),
        outsideLat,
        outsideLon,
        outsideExamples,
      },
      tags,
      scaling: readScaling(tags.gdalMetadata),
      sweep: { cellsScanned, sentinelCells, cellMin, cellMax },
      values,
    };
  } finally {
    await tiff.close();
  }
}

// --- statistics ------------------------------------------------------------

function rawStatistics(values) {
  let sentinel = 0;
  let unread = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === UNREAD) unread += 1;
    else if (v === SPEC_NODATA) sentinel += 1;
    else {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n += 1;
    }
  }
  return { sentinel, unread, valid: n, min: n ? min : null, max: n ? max : null, mean: n ? sum / n : null };
}

function countBy(cities, values, predicate) {
  const byCountry = new Map();
  for (let i = 0; i < cities.length; i += 1) {
    if (!predicate(values[i])) continue;
    byCountry.set(cities[i].cc, (byCountry.get(cities[i].cc) ?? 0) + 1);
  }
  return [...byCountry.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// --- layout sizing ---------------------------------------------------------

/**
 * A fixed stamp so the envelope contributes the bytes a real shard's would,
 * without the measurement moving between runs.
 */
const SIZING_ENVELOPE = {
  generatedAt: '2026-09-03T00:00:00.000Z',
  source: 'CHELSA V2.1 1981-2010 (CC0 1.0)',
};

/**
 * The five shard shapes measured, each a list of the row fields its tuple
 * holds in order.
 *
 * `l36`/`l48` are the two candidate layouts, with January repeated twelve
 * times because January is all this probe downloads. Their RAW sizes are
 * usable — the bytes depend on digit widths, which January's own histogram
 * bounds. Their GZIP sizes are not: twelve identical copies of one integer
 * compress the way no real annual cycle ever will, and taking them at face
 * value would understate the artifact by roughly four times.
 *
 * `base`, `jan3` and `jan4` exist to recover a gzip number that isn't an
 * artifact. They hold real, spatially varying values and no repetition at
 * all, so the cost of one real column is measurable; twelve times that is an
 * UPPER bound on the real block, because real months are correlated and gzip
 * exploits correlation this construction denies it.
 */
const SHAPES = {
  base: [],
  jan3: ['lo', 'hi', 'precip'],
  jan4: ['lo', 'hi', 'precip', 'cloud'],
  l36: [...Array(12).fill('lo'), ...Array(12).fill('hi'), ...Array(12).fill('precip')],
  l48: [...Array(12).fill('lo'), ...Array(12).fill('hi'), ...Array(12).fill('precip'), ...Array(12).fill('cloud')],
};

/**
 * The widest token any month of that column could need, so a strict raw upper
 * bound can be computed without a second month: temperatures never leave
 * -99..999, and the wettest cell in the whole January raster is 1783.8 mm.
 */
const WIDEST = { lo: -100, hi: -100, precip: 9999, cloud: 100 };

/**
 * One country's climate shard as `public/climate/<CC>.json` would hold it: a
 * positional tuple per city, id-keyed, one line of JSON plus a trailing LF —
 * `build-provinces.mjs`'s convention, and what `.gitattributes` already pins
 * `public/climate/*.json` to.
 */
function serialiseShard(country, rows, shape, widest = false) {
  const cities = {};
  for (const row of rows) {
    cities[row.id] = shape.map((field) => (widest ? WIDEST[field] : row[field]));
  }
  return `${JSON.stringify({ country, ...SIZING_ENVELOPE, cities })}\n`;
}

function measureLayouts(byCountry) {
  const sizes = [];
  for (const [country, rows] of [...byCountry.entries()].sort()) {
    const entry = { country, cities: rows.length };
    for (const [name, shape] of Object.entries(SHAPES)) {
      const json = serialiseShard(country, rows, shape);
      entry[`raw_${name}`] = Buffer.byteLength(json);
      entry[`gzip_${name}`] = gzipSync(json).length;
    }
    // Twelve real columns rather than one repeated twelve times.
    entry.gzipEst36 = entry.gzip_base + 12 * (entry.gzip_jan3 - entry.gzip_base);
    entry.gzipEst48 = entry.gzip_base + 12 * (entry.gzip_jan4 - entry.gzip_base);
    // Every month at its widest possible token: a bound, not an estimate.
    entry.rawMax36 = Buffer.byteLength(serialiseShard(country, rows, SHAPES.l36, true));
    entry.rawMax48 = Buffer.byteLength(serialiseShard(country, rows, SHAPES.l48, true));
    sizes.push(entry);
  }
  return sizes;
}

/** How wide the integers actually are, so the estimate can be re-derived. */
function widthHistogram(rows, key) {
  const histogram = new Map();
  for (const row of rows) {
    const width = String(row[key]).length;
    histogram.set(width, (histogram.get(width) ?? 0) + 1);
  }
  return [...histogram.entries()].sort((a, b) => a[0] - b[0]);
}

// --- main ------------------------------------------------------------------

async function main() {
  const peak = new PeakRss();
  const startedAt = performance.now();
  const log = (...parts) => console.log(...parts);

  const catalog = readCityCatalog();
  log(`catalog: ${catalog.shardCount} shards, ${catalog.cities.length} cities`);
  log(`elevation now: ${catalog.sentinelElevations} rows at -9999, ${catalog.nullElevations} null`);
  const historical = historicalSentinelRows();
  log(`elevation at ${historical.commit}: ${historical.total ?? historical.error} rows at -9999`);
  if (historical.byCountry) {
    const ranked = [...historical.byCountry.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    log(`  ${ranked.length} countries: ${ranked.map(([c, n]) => `${c}:${n}`).join(' ')}`);
  }
  const { north, south, east, west } = catalog.extremes;
  log(`extremes: N ${north.name} (${north.cc}) ${north.lat}, S ${south.name} (${south.cc}) ${south.lat}` +
    `, E ${east.name} (${east.cc}) ${east.lon}, W ${west.name} (${west.cc}) ${west.lon}`);
  log(`cache: ${CACHE_DIR}`);

  // Not sampled, only identified: §9.1's BigTIFF claim is about `hurs`.
  const remoteHeaders = [];
  for (const variable of NOT_SAMPLED) {
    const header = await probeRemoteHeader(variable);
    remoteHeaders.push(header);
    log(`${variable} (header only): ${header.bytes} B, ${header.byteOrder} magic ${header.magic} (${header.flavour})`);
  }

  const samples = new Map();
  for (const variable of VARIABLES) {
    const raster = await ensureRaster(variable);
    const header = await readTiffHeader(raster.path);
    log(
      `\n${variable}: ${raster.bytes} B, ${raster.cached ? 'cached' : `downloaded in ${(raster.downloadMs / 1000).toFixed(1)} s`}` +
        `, ${header.byteOrder} magic ${header.magic} (${header.flavour})`
    );
    const sample = await sampleVariable(raster, catalog.cities, peak);
    sample.header = header;
    sample.stats = rawStatistics(sample.values);
    samples.set(variable, sample);
    const g = sample.geometry;
    log(`  grid ${g.width}x${g.height}, ${g.isTiled ? 'tiled' : 'stripped'} ${g.blockWidth}x${g.blockHeight}` +
      `, ${g.blocksTouched}/${g.blocksTotal} blocks touched`);
    log(`  bbox ${g.boundingBox.map((n) => n.toFixed(6)).join(' ')}, res ${g.resolution[0]}`);
    log(`  compression ${sample.tags.compression} predictor ${sample.tags.predictor}` +
      ` bps ${sample.tags.bitsPerSample} GDAL_NODATA ${sample.tags.gdalNoData}`);
    log(`  scale ${sample.scaling.scale} offset ${sample.scaling.offset} (declared: ${sample.scaling.declared})`);
    log(`  cities: outside lat ${g.outsideLat}, outside lon ${g.outsideLon}, on ${SPEC_NODATA} ${sample.stats.sentinel}` +
      `, raw ${sample.stats.min}..${sample.stats.max}, mean ${sample.stats.mean?.toFixed(1)}`);
    log(`  sweep: ${sample.sweep.cellsScanned} cells, ${sample.sweep.sentinelCells} at ${SPEC_NODATA}` +
      `, range ${sample.sweep.cellMin}..${sample.sweep.cellMax}`);
    log(`  ${(sample.sampleMs / 1000).toFixed(1)} s`);
  }

  // Reference cities: raw, then the file's own scale/offset applied.
  const indexById = new Map(catalog.cities.map((c, i) => [c.id, i]));
  const reference = [];
  for (const id of REFERENCE_CITIES) {
    const i = indexById.get(id);
    if (i === undefined) continue;
    const city = catalog.cities[i];
    const entry = { id, name: city.name, cc: city.cc, lat: city.lat, lon: city.lon, by: {} };
    for (const variable of VARIABLES) {
      const sample = samples.get(variable);
      const raw = sample.values[i];
      entry.by[variable] = {
        raw,
        scaled: Math.round((raw * sample.scaling.scale + sample.scaling.offset) * 100) / 100,
        // The alternative §9.1 leaves open, so the doc can show it is wrong.
        tenths: Math.round(raw * 0.1 * 100) / 100,
      };
    }
    reference.push(entry);
  }
  log('\nreference cities (raw -> file-declared scaling):');
  for (const entry of reference) {
    log(
      `  ${entry.name} (${entry.cc}) ` +
        VARIABLES.map((v) => `${v} ${entry.by[v].raw}->${entry.by[v].scaled}`).join('  ')
    );
  }

  // The rows a real shard would hold: every city with all four variables read.
  const scaled = (variable, i) => {
    const sample = samples.get(variable);
    return sample.values[i] * sample.scaling.scale + sample.scaling.offset;
  };
  const byCountry = new Map();
  const excludedByCountry = new Map();
  for (let i = 0; i < catalog.cities.length; i += 1) {
    const city = catalog.cities[i];
    if (VARIABLES.some((v) => samples.get(v).values[i] === SPEC_NODATA || samples.get(v).values[i] === UNREAD)) {
      excludedByCountry.set(city.cc, (excludedByCountry.get(city.cc) ?? 0) + 1);
      continue;
    }
    const rows = byCountry.get(city.cc) ?? [];
    rows.push({
      id: city.id,
      lo: Math.round(scaled('tasmin', i)),
      hi: Math.round(scaled('tasmax', i)),
      precip: Math.round(scaled('pr', i)),
      cloud: Math.round(scaled('clt', i)),
    });
    byCountry.set(city.cc, rows);
  }
  const allRows = [...byCountry.values()].flat();
  log(`\nshard rows: ${allRows.length} of ${catalog.cities.length} cities have all four variables`);

  const sizes = measureLayouts(byCountry);
  const total = (key) => sizes.reduce((s, e) => s + e[key], 0);
  // Both layouts ranked by the SAME key — the 36-int raw size — so "largest"
  // and "median" name one country and the two layouts can be read off against
  // each other. Ranking each on its own size would silently compare Indonesia
  // to Zambia. Raw rather than gzip, because the gzip column of a
  // January-repeated shard is an artifact and `gzipEst` is a derived bound.
  const ranked = [...sizes].sort((a, b) => a.raw_l36 - b.raw_l36);
  const largest = ranked[ranked.length - 1];
  const median = ranked[Math.floor(ranked.length / 2)];
  const summary = { largest: largest.country, median: median.country };
  for (const ints of [36, 48]) {
    // The budget is on gzipped bytes, and the shard with the most RAW bytes is
    // not the one with the most compressed bytes — a country whose values vary
    // more compresses worse from a smaller file. The cap is tested against
    // this worst case, not against `largest`.
    const worstGzip = sizes.reduce((a, b) => (b[`gzipEst${ints}`] > a[`gzipEst${ints}`] ? b : a));
    summary[ints] = {
      totalRaw: total(`raw_l${ints}`),
      totalGzipRepeated: total(`gzip_l${ints}`),
      totalGzipEstimated: total(`gzipEst${ints}`),
      totalRawWidest: total(`rawMax${ints}`),
      largest: { ...largest },
      median: { ...median },
      worstGzip: { ...worstGzip },
      overGzipBudget: sizes.filter((e) => e[`gzipEst${ints}`] > GZIP_BUDGET).map((e) => e.country),
      overRawTripwire: sizes.filter((e) => e[`rawMax${ints}`] > RAW_TRIPWIRE).map((e) => e.country),
    };
    const s = summary[ints];
    log(`\nlayout ${ints}:`);
    log(`  total ${s.totalRaw} B raw / ${s.totalGzipEstimated} B gzip (bound) / ${s.totalGzipRepeated} B gzip (repeated, artifact)`);
    log(`  largest ${largest.country}: ${largest[`raw_l${ints}`]} B raw, ${largest[`gzipEst${ints}`]} B gzip bound, ${largest[`rawMax${ints}`]} B raw at widest tokens`);
    log(`  median  ${median.country}: ${median[`raw_l${ints}`]} B raw, ${median[`gzipEst${ints}`]} B gzip bound, ${median[`rawMax${ints}`]} B raw at widest tokens`);
    log(`  worst gzip bound ${worstGzip.country}: ${worstGzip[`gzipEst${ints}`]} B` +
      ` = ${((100 * worstGzip[`gzipEst${ints}`]) / GZIP_BUDGET).toFixed(1)}% of the ${GZIP_BUDGET} B cap`);
    log(`  over ${GZIP_BUDGET} B gzip bound: ${s.overGzipBudget.length}; over ${RAW_TRIPWIRE} B raw at widest tokens: ${s.overRawTripwire.length}`);
  }
  const marginal = {
    rawPerCloudColumn: total('raw_jan4') - total('raw_jan3'),
    gzipPerCloudColumn: total('gzip_jan4') - total('gzip_jan3'),
  };
  log(
    `\ncloud block (12 x one real column): +${marginal.rawPerCloudColumn * 12} B raw` +
      ` / +${marginal.gzipPerCloudColumn * 12} B gzip across all ${sizes.length} shards`
  );

  const peakRss = peak.stop();
  const wallMs = performance.now() - startedAt;
  log(`\npeak rss ${peakRss} B (${(peakRss / 1024 / 1024).toFixed(0)} MB), wall ${(wallMs / 1000).toFixed(1)} s`);

  const dump = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    month: MONTH,
    cacheDir: CACHE_DIR,
    catalog: {
      shards: catalog.shardCount,
      cities: catalog.cities.length,
      sentinelElevations: catalog.sentinelElevations,
      nullElevations: catalog.nullElevations,
      extremes: catalog.extremes,
      perCountry: [...catalog.perCountry.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    },
    historicalSentinel: historical.byCountry
      ? {
          commit: historical.commit,
          total: historical.total,
          byCountry: [...historical.byCountry.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
        }
      : historical,
    remoteHeaders,
    variables: VARIABLES.map((v) => {
      const s = samples.get(v);
      return {
        variable: v,
        url: s.url,
        bytes: s.bytes,
        cached: s.cached,
        downloadMs: Math.round(s.downloadMs),
        sampleMs: Math.round(s.sampleMs),
        header: s.header,
        geometry: s.geometry,
        tags: s.tags,
        scaling: s.scaling,
        sweep: s.sweep,
        stats: s.stats,
        sentinelByCountry: countBy(catalog.cities, s.values, (x) => x === SPEC_NODATA),
      };
    }),
    reference,
    completeCities: allRows.length,
    excludedByCountry: [...excludedByCountry.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    widths: {
      lo: widthHistogram(allRows, 'lo'),
      hi: widthHistogram(allRows, 'hi'),
      precip: widthHistogram(allRows, 'precip'),
      cloud: widthHistogram(allRows, 'cloud'),
    },
    sizes,
    summary,
    marginal,
    peakRssBytes: peakRss,
    wallMs: Math.round(wallMs),
  };

  const dumpPath = join(CACHE_DIR, 'probe.json');
  writeFileSync(dumpPath, `${JSON.stringify(dump, null, 2)}\n`);
  log(`dump: ${dumpPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
