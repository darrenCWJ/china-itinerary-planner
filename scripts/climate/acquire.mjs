/**
 * ingest-climate — paths, the source, the catalog, acquisition and tags.
 *
 * Moved verbatim out of scripts/ingest-climate.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `main`, the run guard — is still
 * scripts/ingest-climate.mjs.
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { fromFile } from 'geotiff';

import { MONTHS_PER_YEAR } from './sample.mjs';

// ---------------------------------------------------------------------------
// Paths, and the source
// ---------------------------------------------------------------------------

/** Resolved from this file, never `process.cwd()` — see build-provinces.mjs. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CITY_DIR = join(REPO_ROOT, 'public', 'cities');
export const OUT_DIR = join(REPO_ROOT, 'public', 'climate');
export const REPORT_PATH = join(REPO_ROOT, 'data', 'climate-report.md');

/**
 * The rasters live outside the repo, always. This working copy sits inside a
 * OneDrive-synced folder, so 10.65 GB of GeoTIFF dropped anywhere under it
 * would be uploaded — and a CI runner wants them on scratch disk anyway.
 */
export const CACHE_DIR = process.env.CIP_CHELSA_CACHE || join(tmpdir(), 'cip-chelsa');

export const MONTHS = Array.from({ length: MONTHS_PER_YEAR }, (_, i) => String(i + 1).padStart(2, '0'));

/**
 * The pattern the spec does not name. §9.1 gives no URL at all; this is the
 * one that answers 200 for all five variables, `clt` and `hurs` included.
 */
const SOURCE_BASE = 'https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010';
export const SOURCE_URL_PATTERN = `${SOURCE_BASE}/<var>/CHELSA_<var>_<MM>_1981-2010_V.2.1.tif`;

/**
 * What each shard's `source` field carries, and the same string the committed
 * `data/climate-anchors.json` fixture already uses. CHELSA V2.1 is CC0, so
 * this is a courtesy credit rather than a licence condition — which is why the
 * report's section is `## Source` and not `## Attribution`, the heading
 * `data/cities-report.md` uses for GeoNames' genuinely binding CC BY 4.0 term.
 */
export const SOURCE = 'CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228';

const fileFor = (variable, month) => `CHELSA_${variable}_${month}_1981-2010_V.2.1.tif`;
const urlFor = (variable, month) => `${SOURCE_BASE}/${variable}/${fileFor(variable, month)}`;

/**
 * What `data/climate-probe.md` predicted this artifact would weigh, so the
 * report can state how far off it was rather than leaving a reader to diff two
 * documents.
 *
 * All three are EXTRAPOLATIONS, and the probe says so twice: it downloaded
 * January alone, and it never sampled `hurs` at all. Raw is its measured
 * 48-int total (8,980,757 B) plus the cloud block's own measured cost
 * (+2,108,760 B) as the proxy it used for the fifth block; gzip and the worst
 * shard are the round figures it quotes for 60 ints. The probe is explicit
 * that its gzip bound treats the twelve months as independent columns, which
 * they are not, and is therefore an UPPER bound.
 */
export const PROBE_EXTRAPOLATION = Object.freeze({ raw: 11_089_517, gzip: 3_480_000, worstGzip: 55_000 });

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/**
 * The committed city shards, flattened, in file-then-row order.
 *
 * Read as raw JSON and counted rather than trusted to a constant: the catalog
 * grew from 58,748 rows to 58,757 between the plan being written and the probe
 * being run, and it will keep drifting with every nightly `Refresh cities`.
 * Everything downstream — the shard set, the id parity gate, the report's
 * totals — is derived from what is on disk at run time.
 */
export function readCatalog() {
  const files = readdirSync(CITY_DIR).filter((name) => /^[A-Z]{2}\.json$/.test(name)).sort();
  if (files.length === 0) throw new Error(`no city shards under ${CITY_DIR} — there is nothing to sample for`);
  const cities = [];
  const countries = [];
  // Counted here for the report's note that §9.4's elevation correction must
  // read `null` as "no correction". The climate artifact does not repeat
  // `elev` — a consumer joins to the city row for it — so this is the one
  // place the build sees how often that field is absent.
  let nullElevations = 0;
  for (const file of files) {
    const code = file.slice(0, 2);
    const shard = JSON.parse(readFileSync(join(CITY_DIR, file), 'utf8'));
    if (shard.country !== code) {
      throw new Error(`${file} declares country ${JSON.stringify(shard.country)} — the filename and the envelope disagree`);
    }
    countries.push({ code, from: cities.length, count: shard.cities.length });
    for (const row of shard.cities) {
      if (row.elev === null || row.elev === undefined) nullElevations += 1;
      cities.push({ id: row.id, name: row.n, lat: row.lat, lon: row.lon });
    }
  }
  return { countries, cities, nullElevations };
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [2000, 8000];
const USER_AGENT =
  'china-itinerary-planner/ingest-climate (+https://github.com/darrenCWJ/china-itinerary-planner)';

/**
 * A ceiling on one download, scaled to the file rather than fixed.
 *
 * A single number cannot cover both a 58 MB `clt` and a 361 MB `hurs`: tight
 * enough to catch a stalled `hurs` would abort a healthy `clt` on any slow
 * link. So the budget is a floor plus a minimum throughput — 1 MB/s, five
 * times slower than the 4.81 MB/s `data/climate-probe.md` measured on a home
 * connection, and far slower than a CI runner. `hurs` gets about eight
 * minutes.
 *
 * It exists because a `fetch` with no signal at all does not fail on its own
 * schedule; it fails on the runtime's, and this build runs unattended for half
 * an hour behind a `workflow_dispatch` where a wedged request is
 * indistinguishable from a slow one.
 */
const DOWNLOAD_FLOOR_MS = 120_000;
const DOWNLOAD_MIN_BYTES_PER_MS = 1000;
// Math.ceil, because `AbortSignal.timeout` requires an integer and `bytes` is
// essentially never an exact multiple of DOWNLOAD_MIN_BYTES_PER_MS — every
// real run so far found every raster already cached, so the GET branch below
// that calls this was never reached and this was never caught.
const downloadBudgetMs = (bytes) => Math.ceil(DOWNLOAD_FLOOR_MS + bytes / DOWNLOAD_MIN_BYTES_PER_MS);

/**
 * Two retries, because the host is academic infrastructure and this run makes
 * 60 requests to it over half an hour. A transient 502 on raster 41 must not
 * throw away the forty that came before it.
 *
 * `delaysMs` defaults to `RETRY_DELAYS_MS`; a test that wants to exhaust a
 * retry loop without paying its real wall-clock delay passes a shorter array
 * instead, down the same `retryDelaysMs` option `ensureRaster` takes.
 */
async function withRetry(what, attempt, delaysMs = RETRY_DELAYS_MS) {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= delaysMs.length) throw new Error(`${what}: ${error.message}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, delaysMs[tries]));
    }
  }
}

async function headContentLength(url, retryDelaysMs = RETRY_DELAYS_MS) {
  return withRetry(`HEAD ${url}`, async () => {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const length = Number(response.headers.get('content-length'));
    if (!Number.isInteger(length) || length <= 0) throw new Error('no usable content-length');
    return length;
  }, retryDelaysMs);
}

/**
 * The raster on disk, downloaded only if the cache does not already hold it at
 * the size the server advertises.
 *
 * The size check is what makes a re-run cheap and a truncated file loud: a
 * partial GeoTIFF does not fail at `open`, it fails deep inside a deflate
 * block with an error that says nothing about the download. Streamed rather
 * than buffered — `pr` alone is 254 MB, and an `arrayBuffer()` of it would be
 * resident for the whole write — and written to a PID-suffixed temp name so
 * an interrupted run leaves no half file at the real path.
 *
 * Exported for `scripts/climate/acquire.test.ts`: every real run so far found
 * every raster already cached, so this path has never once executed against a
 * live HEAD/GET. `cacheDir` and `retryDelaysMs` default to the module's own
 * `CACHE_DIR` and `RETRY_DELAYS_MS`, so a caller that passes nothing gets
 * exactly today's behaviour; a test points the first at a scratch directory
 * and the second at near-zero delays, so a retry-exhausting failure does not
 * cost real wall-clock seconds. `fetch` itself is not threaded through — the
 * global is a `vi.stubGlobal` target, the same way this repo's other fetchers
 * are tested.
 *
 * @param {string} variable
 * @param {string} month
 * @param {{ cacheDir?: string, retryDelaysMs?: number[] }} [options]
 */
export async function ensureRaster(variable, month, { cacheDir = CACHE_DIR, retryDelaysMs = RETRY_DELAYS_MS } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const url = urlFor(variable, month);
  const path = join(cacheDir, fileFor(variable, month));
  const expected = await headContentLength(url, retryDelaysMs);
  if (existsSync(path) && statSync(path).size === expected) {
    return { path, bytes: expected, downloadedBytes: 0, downloadMs: 0 };
  }
  const startedAt = performance.now();
  const temp = `${path}.tmp-${process.pid}`;
  try {
    await withRetry(`GET ${url}`, async () => {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(downloadBudgetMs(expected)),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temp));
      const written = statSync(temp).size;
      if (written !== expected) throw new Error(`wrote ${written} B, expected ${expected} B`);
    }, retryDelaysMs);
    rmSync(path, { force: true });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return { path, bytes: expected, downloadedBytes: expected, downloadMs: performance.now() - startedAt };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * `GDAL_METADATA` and `GDAL_NODATA` are DEFERRED fields in geotiff 3: reading
 * either as a property yields `undefined` in silence — indistinguishable from
 * a tag the file does not carry — and the synchronous `getValue` throws. They
 * have to be `loadValue`d. That trap is how the scale factor nearly went
 * unread in the probe, and `data/climate-probe.md` records it.
 */
async function tagText(directory, name) {
  const value = await directory.loadValue(name);
  if (typeof value === 'string') return value.replace(/\0+$/, '');
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return Buffer.from(Array.from(value)).toString('latin1').replace(/\0+$/, '');
  }
  return null;
}

/**
 * One raster's scaling and sentinel, from that raster's own tags.
 *
 * Every branch here throws rather than defaulting. A silent default is the
 * specific failure this file is written against: §9.1 states `tasmin`'s 0.1
 * scale and omits its −273.15 offset, so a build that treated a missing offset
 * as 0 would report Singapore at 298 °C and every gate below would still pass.
 * The same goes for the sentinel — all five files declare `GDAL_NODATA`, and a
 * release that stopped declaring one is a change a human should see.
 */
export async function readScaling(directory, file) {
  for (const tag of ['GDAL_METADATA', 'GDAL_NODATA']) {
    if (!directory.hasTag(tag)) {
      throw new Error(`${file}: no ${tag} tag — this build reads the scaling off the file and will not guess it`);
    }
  }
  const metadata = await tagText(directory, 'GDAL_METADATA');
  const item = (role) => {
    const match = new RegExp(`role="${role}"[^>]*>([^<]+)<`).exec(metadata ?? '');
    return match ? Number(match[1]) : null;
  };
  const scale = item('scale');
  const offset = item('offset');
  // `scale === 0` is checked on top of `Number.isFinite`, and only for
  // `scale` — `offset` may legitimately be 0, as `pr` and `clt` both declare.
  // `item()` returns `Number(match[1])`, and `Number(' ')` is 0: a
  // whitespace-bodied `role="scale"` item would otherwise decode every value
  // in the file to the constant offset, and 0 is finite enough to sail past
  // the check below it.
  if (!Number.isFinite(scale) || scale === 0 || !Number.isFinite(offset)) {
    throw new Error(`${file}: GDAL_METADATA declares no usable scale/offset: ${metadata}`);
  }
  // Trimmed and length-checked before `Number`, because `Number('')` is 0 and
  // 0 is a real precipitation reading. An empty sentinel tag would otherwise
  // null every dry month on `pr` and drop the cities that have one.
  const declared = (await tagText(directory, 'GDAL_NODATA'))?.trim() ?? '';
  const nodata = Number(declared);
  if (declared === '' || !Number.isFinite(nodata)) {
    throw new Error(`${file}: GDAL_NODATA is not a number: ${JSON.stringify(declared)}`);
  }
  return { scale, offset, nodata };
}

/**
 * One raster's transform, in the shape `pixelFor` wants.
 *
 * `Math.abs` on both resolutions because geotiff reports `resY` NEGATIVE for a
 * north-up image, and `pixelFor` counts rows downward from `originY` itself.
 * `pixelFor` throws on a non-positive resolution rather than nulling every
 * city, so leaving the sign uncorrected would at least be loud — but the sign
 * is this function's to get right, not that one's to survive.
 */
export function gridOf(image) {
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    originX,
    originY,
    resX: Math.abs(resX),
    resY: Math.abs(resY),
  };
}

/** Two grids are the same grid, or the twelve months of a variable disagree. */
export function sameGrid(a, b) {
  return ['width', 'height', 'originX', 'originY', 'resX', 'resY'].every((key) => a[key] === b[key]);
}

/** As above, for the scaling. */
export function sameScaling(a, b) {
  return a.scale === b.scale && a.offset === b.offset && a.nodata === b.nodata;
}

/** The transform and scaling of one raster, without sampling it. */
export async function readGeometry(path) {
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0);
    return { grid: gridOf(image), scaling: await readScaling(image.getFileDirectory(), basename(path)) };
  } finally {
    await tiff.close();
  }
}

