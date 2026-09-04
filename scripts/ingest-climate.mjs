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

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { fromFile } from 'geotiff';

/**
 * The two per-file budgets, imported rather than restated so there is one
 * number to change. `build-provinces.mjs` is argv-guarded exactly like this
 * module, so importing it runs its module body and nothing else.
 */
import { GZIP_BUDGET, RAW_TRIPWIRE } from './build-provinces.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTHS_PER_YEAR = 12;

/**
 * The artifact tuple: five blocks of twelve, calendar-indexed, January at
 * index 0 in every block.
 *
 *     [ 0..11] lo      °C           tasmin
 *     [12..23] hi      °C           tasmax
 *     [24..35] precip  mm/month     pr
 *     [36..47] cloud   %            clt
 *     [48..59] td      °C           derived, see `dewPointC`
 *
 * 60 and not the 48 the probe recommended, for three reasons recorded in
 * `data/climate-probe.md`: §9.4's mugginess term needs a dew point, §13
 * forbids shipping the raw humidity field it is derived from, and the probe
 * measured that a fifth block still leaves the worst shard under 40% of the
 * gzip cap.
 *
 * The first four names are also the sample fields, in block order; `hurs`
 * comes last because it is an input that is never itself written.
 */
const SAMPLE_FIELDS = ['tasmin', 'tasmax', 'pr', 'clt', 'hurs'];
const BLOCKS = 5;
const TUPLE_LENGTH = BLOCKS * MONTHS_PER_YEAR;

/**
 * The August–Roche–Magnus coefficients, in the form Alduchov & Eskridge (1996)
 * fit: `b` is dimensionless and `c` is in °C. Stated to ±0.4 °C over −40 to
 * +50 °C, which covers the whole range the catalog spans and is well inside
 * the resolution of an integer artifact.
 */
const MAGNUS_B = 17.625;
const MAGNUS_C = 243.04;

// ---------------------------------------------------------------------------
// pixelFor
// ---------------------------------------------------------------------------

/**
 * One raster's transform, read from that raster's own tags.
 *
 * `resY` is a POSITIVE degrees-per-row, i.e. a magnitude. geotiff's
 * `getResolution()` reports it negative for a north-up image (y increases
 * southward while latitude decreases), so whoever builds this object must take
 * the absolute value before `pixelFor` counts rows downward from `originY`
 * itself. `pixelFor` THROWS if `resX`/`resY`/`width`/`height` is not finite
 * and positive, or if `originX`/`originY` is not finite, rather than silently
 * nulling out every city on the wrong side of an unenforced sign.
 *
 * @typedef {object} Grid
 * @property {number} width   columns
 * @property {number} height  rows
 * @property {number} originX west edge of column 0, degrees
 * @property {number} originY north edge of row 0, degrees
 * @property {number} resX    degrees per column, positive
 * @property {number} resY    degrees per row, positive
 */

/**
 * The nearest cell to a coordinate, or null when the coordinate is off the
 * raster. Nearest-cell, never interpolated: CHELSA is a modelled surface and
 * blending four cells of it would invent a place that is not in the model.
 *
 * The `floor` is unadjusted because both rasters are PixelIsArea — see the
 * module docblock. A half-cell correction would be right for a node-registered
 * grid and is silently wrong here: it moves every city up to half a cell
 * north-west, which is nothing at 1 km and a real error near a coast on `clt`.
 *
 * The bounds check is what makes "off the raster" an answer distinct from "on
 * it" rather than an index the caller has no way to recognise as wrong. The
 * probe found 0 of 58,757 cities outside either grid, so it should never fire
 * — but +84 is a real edge on the 1 km grid and the catalog grows.
 *
 * A malformed `grid` is a different wrong from a coordinate off the raster:
 * it is the caller's bug, not a gap in the data — the same distinction
 * `tupleFor` draws when it throws on a wrong-length column instead of
 * returning null. So this throws instead of nulling when `resX`, `resY`,
 * `width` or `height` is not finite and positive, or when `originX` or
 * `originY` is not finite. The concrete case that motivates it: geotiff's
 * `getResolution()` reports `resY` NEGATIVE for a north-up raster (see the
 * `Grid` typedef above), and a grid built without correcting that sign would
 * otherwise return null for every city south of the origin — the whole
 * catalog — while every downstream shape and budget gate kept passing.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {Grid} grid
 * @returns {{ x: number, y: number } | null}
 * @throws {Error} if `grid` has a non-finite/non-positive resolution or size,
 *   or a non-finite origin
 */
export function pixelFor(lon, lat, grid) {
  for (const field of ['resX', 'resY', 'width', 'height']) {
    if (!Number.isFinite(grid[field]) || grid[field] <= 0) {
      throw new Error(`pixelFor expects grid.${field} to be a finite positive number, got ${grid[field]}`);
    }
  }
  for (const field of ['originX', 'originY']) {
    if (!Number.isFinite(grid[field])) {
      throw new Error(`pixelFor expects grid.${field} to be a finite number, got ${grid[field]}`);
    }
  }

  const x = Math.floor((lon - grid.originX) / grid.resX);
  const y = Math.floor((grid.originY - lat) / grid.resY);
  // An index has to be an index. `Math.floor` of a finite number always is,
  // so this only rejects NaN and ±Infinity — which the range check below
  // cannot, because every comparison against NaN is false and a NaN pixel
  // would sail through it and read `undefined` out of the raster.
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || x >= grid.width) return null;
  if (y < 0 || y >= grid.height) return null;
  return { x, y };
}

// ---------------------------------------------------------------------------
// decodeSample
// ---------------------------------------------------------------------------

/**
 * One raster's `GDAL_METADATA` scaling plus its `GDAL_NODATA` tag.
 *
 * `nodata` is nullable because a file may declare none, and because the value
 * a file does declare need not be representable in its own samples: `tasmin`,
 * `tasmax` and `pr` all declare −2147483647 against 16-bit unsigned data, so
 * for those three the tag is inapplicable and no raw value is a sentinel.
 *
 * @typedef {object} Scaling
 * @property {number} scale
 * @property {number} offset
 * @property {number | null} [nodata]
 */

/**
 * A raw sample turned into its real-world value, or null when the file says
 * that cell holds nothing.
 *
 * The second argument is a scaling read from the file, not a variable name.
 * Naming a variable would only be a lookup into constants this module would
 * then have to carry, and those constants are exactly what the probe found the
 * spec had wrong — the offset is missing from §9.1 and the sentinel is right
 * about one file of four. Passing the file's own tags removes the chance to be
 * wrong about them.
 *
 * Absence has to be caught here, before the arithmetic: 65535 under `clt`'s
 * 0.01 scale is 655.35% cloud, and `Number.isFinite` is perfectly happy with
 * it. Nothing downstream would notice.
 *
 * A missing or unparseable sentinel means "no sentinel", which is the right
 * default but also a silent one — so the ingest asserts the tag it read rather
 * than trusting this to have caught anything.
 *
 * Deliberately unrounded. `tupleFor` rounds, and the dew point is computed
 * from these fractions before it does.
 *
 * @param {number} raw
 * @param {Scaling} scaling
 * @returns {number | null}
 */
export function decodeSample(raw, scaling) {
  if (raw === scaling.nodata) return null;
  return raw * scaling.scale + scaling.offset;
}

// ---------------------------------------------------------------------------
// tupleFor
// ---------------------------------------------------------------------------

/**
 * `Math.round`, with −0 folded back to 0.
 *
 * −0 is an integer and `JSON.stringify` writes it as "0", so the artifact on
 * disk is unaffected — but `Object.is` tells it apart from 0 and so does every
 * strict comparison, which makes an in-memory tuple carrying it not the tuple
 * it prints as. Any month between −0.5 and 0 °C lands there, which is a great
 * many towns in a great many Marches.
 *
 * @param {number} value
 * @returns {number}
 */
function asInt(value) {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/**
 * Dew point in °C from air temperature and relative humidity, by the standard
 * August–Roche–Magnus approximation:
 *
 *     γ  = ln(RH / 100) + (b · T) / (c + T)
 *     Td = (c · γ) / (b − γ)
 *
 * `T` is the monthly mean, taken as the midpoint of `lo` and `hi` on the
 * UNROUNDED decoded temperatures, and `RH` is the monthly mean relative
 * humidity straight off `hurs`.
 *
 * Derived here rather than shipped raw because §9.4's mugginess term wants a
 * dew point and §13 is explicit that v1 ships the correction, not the raw
 * field. The humidity BIAS correction (spec fix 2) is NOT applied here on
 * purpose: it belongs in the fit model at read time, where it can be retuned
 * without re-running an hour-long, 6.2 GB ingest.
 *
 * @param {number} tempC
 * @param {number} relativeHumidityPct
 * @returns {number}
 */
function dewPointC(tempC, relativeHumidityPct) {
  const gamma =
    Math.log(relativeHumidityPct / 100) + (MAGNUS_B * tempC) / (MAGNUS_C + tempC);
  return (MAGNUS_C * gamma) / (MAGNUS_B - gamma);
}

/**
 * Twelve months of decoded, unrounded samples for one city, as `decodeSample`
 * returns them — nulls and all.
 *
 * @typedef {object} CitySamples
 * @property {(number | null)[]} tasmin  monthly mean daily minimum, °C
 * @property {(number | null)[]} tasmax  monthly mean daily maximum, °C
 * @property {(number | null)[]} pr      monthly precipitation, mm
 * @property {(number | null)[]} clt     monthly mean cloud area fraction, %
 * @property {(number | null)[]} hurs    monthly mean relative humidity, %
 */

/**
 * One city's 60-int artifact tuple, or null when the city cannot be written.
 *
 * Layout and field order are in the `SAMPLE_FIELDS` docblock. `lo` is `tasmin`
 * and `hi` is `tasmax`; the fifth block is derived, not sampled.
 *
 * A single unwritable month sinks the whole city, because 60 positional
 * integers carry no per-month absence marker — there is no way to write "March
 * has no cloud", and a tuple that quietly substituted something would be
 * indistinguishable from a measurement. That covers both a `decodeSample` null
 * and any value that is not finite. The probe found 0 of 58,757 cities on
 * nodata, so the first should never fire; that is a property of this CHELSA
 * release, not of the format.
 *
 * A column that is not twelve months throws instead, because that is a bug in
 * the caller rather than a gap in the data and the two must not be conflated:
 * returning null would drop a city silently, and writing a short tuple would
 * corrupt every index after it.
 *
 * @param {CitySamples} samples
 * @returns {number[] | null}
 */
export function tupleFor(samples) {
  const columns = SAMPLE_FIELDS.map((field) => {
    const column = samples[field];
    if (!Array.isArray(column) || column.length !== MONTHS_PER_YEAR) {
      const got = Array.isArray(column) ? `${column.length}` : typeof column;
      throw new Error(`tupleFor expects 12 months of ${field}, got ${got}`);
    }
    return column;
  });
  // Absence and unusability are the same answer here. A month that is not a
  // finite number cannot be written any more than a null can: NaN and
  // ±Infinity round to themselves and `JSON.stringify` writes both as `null`,
  // which puts a null in the middle of a positional int tuple — the one shape
  // this layout cannot express, and one nothing downstream would flag.
  const unusable = (value) => value === null || !Number.isFinite(value);
  if (columns.some((column) => column.some(unusable))) return null;

  const [lo, hi, precip, cloud, humidity] = columns;
  const tuple = new Array(TUPLE_LENGTH);
  for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
    // The dew point is derived, so it needs the same check again on the way
    // out: `hurs` at exactly 0 sends `Math.log` to -Infinity and the whole
    // expression to NaN, from finite inputs that passed the sweep above.
    const td = dewPointC((lo[m] + hi[m]) / 2, humidity[m]);
    if (unusable(td)) return null;
    tuple[m] = asInt(lo[m]);
    tuple[MONTHS_PER_YEAR + m] = asInt(hi[m]);
    tuple[2 * MONTHS_PER_YEAR + m] = asInt(precip[m]);
    tuple[3 * MONTHS_PER_YEAR + m] = asInt(cloud[m]);
    tuple[4 * MONTHS_PER_YEAR + m] = asInt(td);
  }
  return tuple;
}

// ---------------------------------------------------------------------------
// Paths, and the source
// ---------------------------------------------------------------------------

/** Resolved from this file, never `process.cwd()` — see build-provinces.mjs. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CITY_DIR = join(REPO_ROOT, 'public', 'cities');
const OUT_DIR = join(REPO_ROOT, 'public', 'climate');
const REPORT_PATH = join(REPO_ROOT, 'data', 'climate-report.md');

/**
 * The rasters live outside the repo, always. This working copy sits inside a
 * OneDrive-synced folder, so 10.65 GB of GeoTIFF dropped anywhere under it
 * would be uploaded — and a CI runner wants them on scratch disk anyway.
 */
const CACHE_DIR = process.env.CIP_CHELSA_CACHE || join(tmpdir(), 'cip-chelsa');

const MONTHS = Array.from({ length: MONTHS_PER_YEAR }, (_, i) => String(i + 1).padStart(2, '0'));

/**
 * The pattern the spec does not name. §9.1 gives no URL at all; this is the
 * one that answers 200 for all five variables, `clt` and `hurs` included.
 */
const SOURCE_BASE = 'https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010';
const SOURCE_URL_PATTERN = `${SOURCE_BASE}/<var>/CHELSA_<var>_<MM>_1981-2010_V.2.1.tif`;

/**
 * What each shard's `source` field carries, and the same string the committed
 * `data/climate-anchors.json` fixture already uses. CHELSA V2.1 is CC0, so
 * this is a courtesy credit rather than a licence condition — which is why the
 * report's section is `## Source` and not `## Attribution`, the heading
 * `data/cities-report.md` uses for GeoNames' genuinely binding CC BY 4.0 term.
 */
const SOURCE = 'CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228';

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
const PROBE_EXTRAPOLATION = Object.freeze({ raw: 11_089_517, gzip: 3_480_000, worstGzip: 55_000 });

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
function readCatalog() {
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
 * Exported for `scripts/ingest-climate.test.ts`: every real run so far found
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
function gridOf(image) {
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
function sameGrid(a, b) {
  return ['width', 'height', 'originX', 'originY', 'resX', 'resY'].every((key) => a[key] === b[key]);
}

/** As above, for the scaling. */
function sameScaling(a, b) {
  return a.scale === b.scale && a.offset === b.offset && a.nodata === b.nodata;
}

/** The transform and scaling of one raster, without sampling it. */
async function readGeometry(path) {
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0);
    return { grid: gridOf(image), scaling: await readScaling(image.getFileDirectory(), basename(path)) };
  } finally {
    await tiff.close();
  }
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Every city grouped by the raster ROW it lands on, rows ascending.
 *
 * The row is the unit because these files are stripped with RowsPerStrip 1 —
 * not the 512×512 COG tiles §9.1 describes, which is the finding that retires
 * its range-read analysis. Reading each touched row once keeps the working set
 * at one decoded row (86 KB on the 1 km grid) instead of the 1.8 GB a whole
 * raster would need, and the catalog touches only 11,771 of 20,880 rows, so
 * grouping also skips 44% of the file.
 *
 * Rows are returned ascending so the reads walk the file forwards; a
 * city-order walk would seek back and forth across 115 MB and re-decode the
 * same dense rows hundreds of times.
 *
 * A city `pixelFor` refuses is collected rather than thrown on, because "off
 * the raster" is a property of the catalog and belongs in a gate with a count
 * beside it. The probe found 0 of 58,757 outside either grid.
 *
 * @param {{lat: number, lon: number}[]} cities
 * @param {object} grid
 * @returns {{ rows: number[], byRow: Map<number, {i: number, x: number}[]>, offRaster: number[] }}
 */
export function bucketByRow(cities, grid) {
  const byRow = new Map();
  const offRaster = [];
  for (let i = 0; i < cities.length; i += 1) {
    const pixel = pixelFor(cities[i].lon, cities[i].lat, grid);
    if (pixel === null) {
      offRaster.push(i);
      continue;
    }
    const bucket = byRow.get(pixel.y);
    if (bucket) bucket.push({ i, x: pixel.x });
    else byRow.set(pixel.y, [{ i, x: pixel.x }]);
  }
  return { rows: [...byRow.keys()].sort((a, b) => a - b), byRow, offRaster };
}

/** Peak `rss` over the run, sampled on a timer and after every row read. */
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
 * Decoded values for every city on one raster, as a Float64Array.
 *
 * `NaN` is the in-memory stand-in for `decodeSample`'s null, because a
 * Float64Array cannot hold one — and it is a faithful stand-in, because
 * `tupleFor` treats a null and a non-finite number identically and the caller
 * turns NaN back into null before handing it over. The count of sentinel hits
 * is returned separately so a gate can name it; folding it into the null-city
 * count would lose the distinction between "the file says nothing is here" and
 * "the arithmetic came out unusable".
 *
 * Deliberately NOT a sweep of every decoded cell for the sentinel. The probe
 * did that — 1.59 billion cells — and it roughly doubled the sampling time to
 * answer a question this build asks more cheaply: the cells that matter are
 * the ones a city reads.
 */
async function sampleRaster(path, grid, scaling, buckets, cityCount, peak) {
  const values = new Float64Array(cityCount).fill(Number.NaN);
  let atNodata = 0;
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0);
    // Every file's own tags, every month — not January's carried forward.
    // The buckets are computed once per variable because all twelve months
    // share a grid, and this is what makes that a verified saving rather than
    // an assumption. A month with a different transform would put every city
    // on the wrong cell; a month with a different scale would decode into
    // plausible nonsense. Neither would raise anything downstream.
    const actual = gridOf(image);
    if (!sameGrid(actual, grid)) {
      throw new Error(
        `${path}: grid is ${actual.width}x${actual.height} at ${actual.originX},${actual.originY} — ` +
        `the other months of this variable are ${grid.width}x${grid.height} at ${grid.originX},${grid.originY}`
      );
    }
    const actualScaling = await readScaling(image.getFileDirectory(), basename(path));
    if (!sameScaling(actualScaling, scaling)) {
      throw new Error(
        `${path}: scale ${actualScaling.scale} offset ${actualScaling.offset} nodata ${actualScaling.nodata} — ` +
        `the other months of this variable declare ${scaling.scale} / ${scaling.offset} / ${scaling.nodata}`
      );
    }
    for (const y of buckets.rows) {
      const rasters = await image.readRasters({ window: [0, y, grid.width, y + 1] });
      const band = rasters[0];
      // The window is the whole row, so `band[x]` IS the city's cell. That
      // only holds while the band is full width: a short read would shift
      // every city east of the gap onto a neighbour's value, which is a
      // plausible number and would never be noticed.
      if (band.length !== grid.width) {
        throw new Error(`${path}: row ${y} decoded ${band.length} cells, expected ${grid.width}`);
      }
      for (const { i, x } of buckets.byRow.get(y)) {
        const decoded = decodeSample(band[x], scaling);
        if (decoded === null) atNodata += 1;
        else values[i] = decoded;
      }
      peak.sample();
    }
  } finally {
    await tiff.close();
  }
  return { values, atNodata };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * The 60-int row for every city that has one, keyed by city id.
 *
 * `samples[field]` is twelve Float64Arrays in calendar order, `NaN` where the
 * raster had nothing. They are turned back into nulls here so `tupleFor` sees
 * exactly the `CitySamples` its contract describes rather than a second
 * encoding of absence it would have to know about.
 *
 * @param {{id: string}[]} cities
 * @param {Record<string, Float64Array[]>} samples
 */
export function assembleRows(cities, samples) {
  const rows = new Map();
  const skipped = [];
  for (let i = 0; i < cities.length; i += 1) {
    /** @type {Record<string, (number | null)[]>} */
    const citySamples = {};
    for (const field of SAMPLE_FIELDS) {
      citySamples[field] = samples[field].map((month) => (Number.isNaN(month[i]) ? null : month[i]));
    }
    const tuple = tupleFor(citySamples);
    if (tuple === null) skipped.push(cities[i]);
    else rows.set(cities[i].id, tuple);
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * One climate shard per city shard, in both directions.
 *
 * Two-way, unlike `build-provinces.mjs`'s one-way coverage gate, because the
 * two artifacts have different failure modes. A province file for a country
 * with no cities is harmless geometry; a climate file for one is a file whose
 * every key joins to nothing, and a missing one is a country whose map renders
 * with no climate at all. Neither should be decided by a count — a run that
 * loses one country and gains another keeps the count identical.
 */
export function assertShardCoverage(emitted, reference) {
  const missing = [...reference].filter((code) => !emitted.has(code)).sort();
  const extra = [...emitted].filter((code) => !reference.has(code)).sort();
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} country/countries have a city shard and no climate shard: ${missing.join(', ')}`
    );
  }
  if (extra.length > 0) {
    throw new Error(
      `${extra.length} climate shard(s) name a country with no city shard: ${extra.join(', ')}`
    );
  }
}

/**
 * The ids the shards carry are exactly the catalog's ids, each exactly once.
 *
 * This is the join Task 8's loader and every map component depend on: a
 * climate row is looked up by the city id that came out of
 * `public/cities/<CC>.json`, and `elev` is read from the city row beside it.
 * An id in one file and not the other is a city that renders with no climate,
 * or a row nothing will ever read — both silent.
 *
 * `written` is an ITERABLE and not a Set on purpose, so a duplicate survives
 * long enough to be caught. The failure this is really written for is a bad
 * range in `buildShards`: the catalog is one flat array sliced per country by
 * offset and length, and an overlapping or short slice writes some city twice
 * and another not at all — with a Set on both sides, an overlap would compare
 * equal and every remaining gate would pass.
 *
 * Names at most ten of each, because a build that has lost the join has lost
 * tens of thousands and the list is the wrong thing to print.
 */
export function assertCityParity(written, catalog) {
  const seen = new Set();
  const duplicated = [];
  for (const id of written) {
    if (seen.has(id)) duplicated.push(id);
    else seen.add(id);
  }
  const missing = [...catalog].filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !catalog.has(id));
  if (missing.length === 0 && extra.length === 0 && duplicated.length === 0) return;
  const sample = (ids) => `${ids.length} (e.g. ${ids.slice(0, 10).join(', ')})`;
  throw new Error(
    'the climate rows and the city catalog do not agree: ' +
    `${missing.length > 0 ? `catalogued cities with no row: ${sample(missing)}; ` : ''}` +
    `${extra.length > 0 ? `rows for uncatalogued cities: ${sample(extra)}; ` : ''}` +
    `${duplicated.length > 0 ? `cities written into more than one shard: ${sample(duplicated)}; ` : ''}` +
    'the artifact is joined by city id and nothing downstream would notice the gap'
  );
}

/**
 * Every row is exactly `TUPLE_LENGTH` integers.
 *
 * `tupleFor` already guarantees this for anything it returns, so the gate is
 * about what happens between there and disk. A positional tuple carries no
 * field names: one short row and every index after it means something else,
 * and `JSON.parse` will accept it happily.
 */
export function assertRowShape(rows) {
  for (const [id, row] of rows) {
    if (!Array.isArray(row) || row.length !== TUPLE_LENGTH) {
      throw new Error(`${id}: row is ${Array.isArray(row) ? `${row.length} long` : typeof row}, expected ${TUPLE_LENGTH} integers`);
    }
    const bad = row.findIndex((value) => !Number.isInteger(value));
    if (bad >= 0) throw new Error(`${id}: row[${bad}] is ${row[bad]}, which is not an integer`);
  }
}

/**
 * Aborts the build when any shard breaches either limit, naming all of them.
 *
 * Same two numbers as the province files, imported from that build rather than
 * restated. The gzip budget is the one that binds — it measures what crosses
 * the wire — and the raw tripwire catches the pathological shape a runaway
 * build takes even when it happens to compress well.
 */
export function assertBudget(sizes) {
  const over = (key, limit, label) => {
    const breaches = sizes.filter((s) => s[key] > limit).sort((a, b) => a.code.localeCompare(b.code));
    if (breaches.length === 0) return;
    throw new Error(
      `${breaches.length} climate shard(s) over the ${limit} B ${label}: ` +
      breaches.map((s) => `${s.code} ${s[key]}`).join(', ')
    );
  };
  over('gzip', GZIP_BUDGET, 'gzip budget');
  over('raw', RAW_TRIPWIRE, 'raw tripwire');
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * One country's shard, with its timestamp preserved when nothing changed.
 *
 * Compared on the rows alone — never the envelope, which carries the very
 * timestamp being decided. A comparison that included `generatedAt` could
 * never match and the guard would be dead code that looks alive.
 *
 * @param {string} country
 * @param {Record<string, number[]>} cities
 * @param {object | null} previous
 * @param {string} now
 */
export function climatePayload(country, cities, previous, now) {
  const unchanged = previous !== null && JSON.stringify(previous.cities) === JSON.stringify(cities);
  return {
    country,
    generatedAt: unchanged ? previous.generatedAt : now,
    source: SOURCE,
    cities,
  };
}

/**
 * `index.json`, with ITS timestamp preserved too.
 *
 * This is the one place this build departs from `build-provinces.mjs`, which
 * stamps `generatedAt: now` on the index unconditionally. That is safe there
 * only because it is hand-run: a person who rebuilds the provinces is looking
 * at the diff. Spec §9.2 gives this artifact a `workflow_dispatch`, and an
 * unattended run over unchanged decadal normals must produce a byte-identical
 * tree — otherwise every dispatch commits one line of pure noise in the one
 * file a reviewer checks first, and learning to ignore it is how the real
 * change gets waved through.
 *
 * `shardsChanged` is why the listing alone cannot decide this. The listing is
 * `{code, count}` per country, and a CHELSA erratum — the one event
 * `.github/workflows/refresh-climate.yml`'s header names as a reason to
 * dispatch — rewrites rows in every shard while adding and removing no city
 * at all. On the listing alone, all 246 shards would restamp while this index
 * kept the previous decade's date, and `buildReport` takes the report's
 * `Generated:` line from THIS stamp, so the record of the run would be stale
 * too. Defaulted to 0 so the three-argument form still means "the listing
 * decides", which is what the unchanged-case tests are about.
 *
 * @param {{ code: string, count: number }[]} countries
 * @param {object | null} previous
 * @param {string} now
 * @param {number} shardsChanged how many shard files this run's bytes differ in
 */
export function indexPayload(countries, previous, now, shardsChanged = 0) {
  const unchanged =
    previous !== null &&
    shardsChanged === 0 &&
    JSON.stringify(previous.countries) === JSON.stringify(countries);
  return { generatedAt: unchanged ? previous.generatedAt : now, countries };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write via a PID-suffixed temp file, removing the destination first.
 *
 * `build-provinces.mjs`'s, for its reasons: renaming onto an existing path is
 * not reliably atomic on Windows, which is this project's dev platform, and a
 * bare `.tmp` collides if two builds ever overlap.
 */
function writeFileAtomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, contents);
    rmSync(path, { force: true });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * A previously committed artifact, as both its bytes and its parse.
 *
 * The bytes decide whether this run CHANGED anything; the parse is what the
 * payload builders compare against to decide whether to restamp. A file that
 * will not parse yields a null parse — not an abort — because restamping and
 * overwriting is exactly the right answer to a corrupt artifact.
 */
function readPrevious(path) {
  if (!existsSync(path)) return { text: null, value: null };
  const text = readFileSync(path, 'utf8');
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return { text, value: null };
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const MB = (bytes) => (bytes / 1_000_000).toFixed(2);
const GB = (bytes) => (bytes / 1_000_000_000).toFixed(2);
const pct = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`;
const seconds = (ms) => (ms / 1000).toFixed(1);
/** Signed, because "off by −6.3%" and "off by 6.3%" are different findings. */
const drift = (measured, predicted) =>
  `${measured >= predicted ? '+' : '−'}${(Math.abs(100 * (measured - predicted)) / predicted).toFixed(1)}%`;

/** The five blocks, in tuple order, as `measuredRanges` labels them. */
const BLOCK_LABELS = [
  { label: 'lo', unit: '°C' },
  { label: 'hi', unit: '°C' },
  { label: 'precip', unit: 'mm/month' },
  { label: 'cloud', unit: '%' },
  { label: 'td', unit: '°C' },
];

/**
 * The report's `## Measured ranges` section: what the rows actually contain.
 *
 * Committed because this is the provenance behind `lib/climateShard.ts`'s
 * guard bands, and until it was written here it existed only in an agent
 * scratch file that `.gitignore` keeps out of the repository — eight comments
 * cited a document a reader could not open. The bands are deliberately wide of
 * anything CHELSA reports, and with no measured figures beside them a reader
 * cannot tell a generous guard rail from one a future release would trip.
 *
 * `lo > hi` is counted for the same reason: it is the one CROSS-FIELD
 * invariant the parser checks per month, so a decode that scaled `tasmin` and
 * `tasmax` differently would land inside every band and still be caught. The
 * count here is what says the artifact has never needed it.
 *
 * Pure, and takes the same `[id, row]` iterable `assertRowShape` does, so the
 * block can be recomputed from `public/climate/*.json` alone rather than only
 * as a side effect of a 26-minute build.
 *
 * @param {Iterable<[string, number[]]>} rows
 * @returns {string[]} the section's lines, heading first, blank-terminated
 */
export function measuredRanges(rows) {
  const blocks = BLOCK_LABELS.map((b) => ({ ...b, min: Infinity, max: -Infinity }));
  let cityMonths = 0;
  let inverted = 0;
  for (const [, row] of rows) {
    for (let b = 0; b < blocks.length; b += 1) {
      const block = blocks[b];
      for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
        const value = row[b * MONTHS_PER_YEAR + m];
        if (value < block.min) block.min = value;
        if (value > block.max) block.max = value;
      }
    }
    for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
      cityMonths += 1;
      if (row[m] > row[MONTHS_PER_YEAR + m]) inverted += 1;
    }
  }
  return [
    '## Measured ranges',
    '',
    'Per block, over every row written above — the provenance behind the guard',
    'bands `lib/climateShard.ts` refuses a row outside of. Those bands are',
    'deliberately wide of anything CHELSA reports, so these are the figures that',
    'say how much room is actually left under them:',
    '',
    '```',
    ...blocks.map((b) => `${b.label.padEnd(7)} ${`${b.min}..${b.max}`.padEnd(11)} ${b.unit}`),
    '```',
    '',
    `${cityMonths} city-months, of which **${inverted}** have \`lo\` greater than \`hi\` — the`,
    'one cross-field invariant the parser checks per month, and the one a decode',
    'that scaled `tasmin` and `tasmax` differently would trip while landing inside',
    'every band above.',
    '',
  ];
}

/**
 * The committed measurement record, in `data/provinces-report.md`'s shape:
 * provenance, bolded counts, a paragraph for the one consequence a reader
 * would otherwise get wrong, and a size block.
 *
 * Every figure comes from the run that is writing the files, and the timestamp
 * from the INDEX's envelope rather than a fresh `new Date()` — the report
 * describes the artifact, so it is stamped when the artifact was generated.
 * On a run that changes nothing those differ, because the index keeps its
 * previous stamp; the report is not rewritten then either, so the only way to
 * see the difference is to delete the report and rebuild, and even then the
 * date a reader wants is the artifact's.
 */
function buildReport(stats) {
  const raw = stats.sizes.reduce((n, s) => n + s.raw, 0);
  const gzip = stats.sizes.reduce((n, s) => n + s.gzip, 0);
  const byGzip = [...stats.sizes].sort((a, b) => b.gzip - a.gzip);
  const byRaw = [...stats.sizes].sort((a, b) => b.raw - a.raw);
  const median = [...stats.sizes].sort((a, b) => a.raw - b.raw)[Math.floor(stats.sizes.length / 2)];
  const worst = byGzip[0];
  const largest = byRaw[0];
  const downloadedBytes = stats.rasters.reduce((n, r) => n + r.downloadedBytes, 0);
  const downloadMs = stats.rasters.reduce((n, r) => n + r.downloadMs, 0);
  const sampleMs = stats.rasters.reduce((n, r) => n + r.sampleMs, 0);
  const cachedCount = stats.rasters.filter((r) => r.downloadedBytes === 0).length;
  return [
    '# Climate normals',
    '',
    `- Source: ${SOURCE_URL_PATTERN}`,
    `- Licence: CC0 1.0 — CHELSA V2.1 climatologies 1981–2010, DOI 10.16904/envidat.228`,
    `- Generated: ${stats.generatedAt}`,
    `- Built by: \`node scripts/ingest-climate.mjs\`, Node ${process.version}`,
    `- Catalog: the ${stats.shardCount} committed shards under \`public/cities/\`, **${stats.cityCount} cities**`,
    '',
    '## Layout',
    '',
    'Per city, 60 positional integers — five blocks of twelve, **calendar-indexed**',
    'with January at index 0 of every block:',
    '',
    '```',
    '[ 0..11]  lo      °C          tasmin',
    '[12..23]  hi      °C          tasmax',
    '[24..35]  precip  mm/month    pr',
    '[36..47]  cloud   %           clt',
    '[48..59]  td      °C          derived',
    '```',
    '',
    '`td` is the August–Roche–Magnus dew point on `T = (lo + hi) / 2` and the raw',
    'monthly mean relative humidity from `hurs`, and it is **uncorrected**: spec',
    "§9.4's humidity-bias correction lives in the fit model at read time, where it",
    'can be retuned without re-running this build. `hurs` itself is never written',
    '(§13). Nothing here is hemisphere-flipped — the rasters come out',
    'calendar-ordered and no `seasonIn` is applied on the way in.',
    '',
    'The rows join `public/cities/<CC>.json` on the city id. Elevation is not',
    'repeated here; a consumer that needs it reads `elev` from the city row, where',
    `${stats.nullElevations} of ${stats.cityCount} rows carry \`null\` and must be treated as "no correction".`,
    '',
    '## Coverage',
    '',
    `- Country shards: **${stats.sizes.length}**`,
    `- Cities with a climate row: **${stats.rowCount}**`,
    `- Cities dropped for an unwritable month: **${stats.skipped}**`,
    `- Cities no raster could place: **${stats.offRaster}**`,
    `- Samples on the file's declared nodata sentinel: **${stats.atNodata}** of ${stats.sampleCount}`,
    '',
    'The last three are zero and are expected to stay zero, but none of them is',
    'guaranteed by the format. CHELSA V2.1 is modelled over ocean as well as land,',
    'so there is no coastline to fall off and no sentinel to land on — a property',
    'of this release, not of the product. A future release that changes it would',
    'drop whole cities silently, because 60 positional integers carry no per-month',
    'absence marker: one unwritable month and the city cannot be written at all.',
    'That is why all three are gates and not statistics.',
    '',
    ...measuredRanges(stats.rows),
    '## Rasters',
    '',
    `- Variables: ${SAMPLE_FIELDS.join(', ')} — 12 months each, ${stats.rasters.length} files`,
    `- On disk: ${stats.rasterBytes} B (${GB(stats.rasterBytes)} GB)`,
    `- Downloaded by this run: ${downloadedBytes} B (${GB(downloadedBytes)} GB); ${cachedCount} of ${stats.rasters.length} files were already cached`,
    '',
    '| variable | grid | rows touched | bytes | downloaded | sample |',
    '|---|---|---|---|---|---|',
    ...stats.variables.map((v) =>
      `| \`${v.variable}\` | ${v.grid.width}×${v.grid.height} @ ${v.grid.resX}° | ` +
      `${v.rowsTouched} of ${v.grid.height} | ${v.bytes} B | ${v.downloadedBytes} B | ${seconds(v.sampleMs)} s |`
    ),
    '',
    'Two grids, not one: `clt` is a coarser raster on its own origin that reaches',
    'both poles, where the other four stop at +84°. Each file carries its own',
    'transform, scale, offset and sentinel, and this build reads all of them off',
    'the file — §9.1 states the scale and omits the −273.15 offset, which alone',
    'would have reported Singapore at 298 °C.',
    '',
    '```',
    ...stats.variables.map((v) =>
      `${v.variable.padEnd(7)} scale ${String(v.scaling.scale).padEnd(5)} offset ${String(v.scaling.offset).padEnd(8)} nodata ${v.scaling.nodata}`
    ),
    '```',
    '',
    '## Cost',
    '',
    `- Download: ${downloadedBytes} B in ${seconds(downloadMs)} s`,
    `- Sample: ${seconds(sampleMs)} s over ${stats.rowReads} row reads`,
    `- Wall clock: ${seconds(stats.wallMs)} s (${(stats.wallMs / 60000).toFixed(1)} min)`,
    `- Peak RSS: ${stats.peakRss} B (${Math.round(stats.peakRss / 1024 / 1024)} MB)`,
    '',
    'Spec §14.8 budgeted this run at "tens of minutes, single-digit GB,',
    'sub-500 MB RSS" and asked for the truth. Two of the three hold. **The download',
    `does not**: ${GB(stats.rasterBytes)} GB, because §9.1's variables row omits \`hurs\`, and`,
    'the fifth variable is the second largest of the five. A runner that provisions',
    'for single-digit GB of scratch disk will not finish.',
    '',
    'Memory is a non-issue and stays one. A decoded row is 86 KB on the 1 km grid',
    'and is released before the next is read; the resident cost is the catalog plus',
    `the whole year's decoded samples, which is ${MB(stats.cityCount * TUPLE_LENGTH * 8)} MB of Float64 for`,
    `${stats.cityCount} cities. Nothing needs streaming, and nothing needs the 1.8 GB a`,
    'whole-raster decode would take.',
    '',
    '## Size',
    '',
    `- Raw: ${raw} B (${MB(raw)} MB)`,
    `- Gzip: ${gzip} B (${MB(gzip)} MB)`,
    `- Largest shard by raw bytes: ${largest.code}, ${largest.raw} B raw / ${largest.gzip} B gzip`,
    `- Worst shard by gzip bytes: ${worst.code}, ${worst.gzip} B gzip / ${worst.raw} B raw`,
    `- Median shard: ${median.code}, ${median.raw} B raw / ${median.gzip} B gzip`,
    `- Shards over the ${GZIP_BUDGET} B gzip budget: **0 of ${stats.sizes.length}**`,
    `- Shards over the ${RAW_TRIPWIRE} B raw tripwire: **0 of ${stats.sizes.length}**`,
    '',
    `**The cap is not saturated.** The worst shard uses ${pct(worst.gzip, GZIP_BUDGET)} of the`,
    `${GZIP_BUDGET} B gzip budget — ${pct(GZIP_BUDGET - worst.gzip, GZIP_BUDGET)} of it goes unused — and the`,
    `runners-up are clustered just below it (${byGzip.slice(1, 6).map((s) => `${s.code} ${s.gzip}`).join(', ')}),`,
    "so the result is not one country's luck. Unlike the city shard's cap, this one",
    'is not binding, and a future reader should not treat it as the constraint that',
    'shaped the layout: the fifth block was added on top of a 48-int layout the',
    'probe had already shown fits, and it still does not come close.',
    '',
    `The biggest file and the worst one are ${largest.code === worst.code ? 'the same country here, which is a coincidence' : `different countries (${largest.code} by raw, ${worst.code} by gzip)`}.`,
    'Raw bytes follow city count and id lengths; gzip follows how much the twelve',
    'months of a place actually vary. Any budget test must therefore be written',
    'against the maximum over all shards, not against the largest file.',
    '',
    '## Against the probe',
    '',
    '`data/climate-probe.md` sized this artifact from **January alone**, and never',
    'sampled `hurs` at all — its 60-int figures extrapolate the fifth block from the',
    'cloud column, and its gzip figure treats the twelve months as independent',
    'columns, which real months are not. It said so, and predicted the direction of',
    'its own error. Measured against those predictions:',
    '',
    '| | predicted | measured | off by |',
    '|---|---|---|---|',
    `| whole artifact, raw | ${PROBE_EXTRAPOLATION.raw} B | ${raw} B | ${drift(raw, PROBE_EXTRAPOLATION.raw)} |`,
    `| whole artifact, gzip | ${PROBE_EXTRAPOLATION.gzip} B | ${gzip} B | ${drift(gzip, PROBE_EXTRAPOLATION.gzip)} |`,
    `| worst shard, gzip | ${PROBE_EXTRAPOLATION.worstGzip} B | ${worst.gzip} B | ${drift(worst.gzip, PROBE_EXTRAPOLATION.worstGzip)} |`,
    '',
    'Raw came out almost exactly where January said it would; both gzip figures',
    'came in well under, in the direction the probe named — it measured that the',
    'marginal cost of a column FALLS as columns are added, so treating twelve',
    'months as independent could only overstate the total.',
    '',
    'The countries moved, as the probe warned they would. §9.3 named VN as the',
    `largest shard and the probe corrected that to ID; measured, it is ${largest.code}. The`,
    `probe named CO as the worst by gzip; measured, it is ${worst.code}. The leaders are a`,
    "few per cent apart because they all sit on the ingest's 750-city-per-country",
    'cap, so which one wins is decided by id lengths and digit widths and will move',
    'between refreshes — nothing should be written that depends on a particular',
    'country being the largest.',
    '',
    '## Source',
    '',
    'CHELSA V2.1 climatologies 1981–2010, **CC0 1.0**, DOI 10.16904/envidat.228.',
    '',
    'CC0 waives the licence conditions, so this section is a courtesy credit and',
    'not a term this project has to meet — deliberately `## Source` rather than the',
    '`## Attribution` heading `data/cities-report.md` uses for GeoNames, whose',
    'CC BY 4.0 credit is enforced by a byte-for-byte contract test. Karger, D.N.,',
    'Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R.W., Zimmermann,',
    'N.E., Linder, H.P. & Kessler, M. (2017). Climatologies at high resolution for',
    "the earth's land surface areas. Scientific Data 4, 170122.",
    '',
  ].join('\n');
}

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
