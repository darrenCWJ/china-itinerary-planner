/**
 * ingest-climate.mjs
 *
 * Builds public/climate/<CC>.json — twelve months of climate normals for every
 * catalogued city, sampled from CHELSA V2.1 1981–2010 (spec §9).
 *
 * Right now this module is only the arithmetic: `pixelFor`, `decodeSample` and
 * `tupleFor`, three pure functions with no I/O of any kind and no `geotiff`
 * import. Task 6 adds the download-and-write half behind the entry-point guard
 * at the bottom, the way `build-provinces.mjs` establishes — so that importing
 * this file to test one rule cannot also start a 6.2 GB fetch.
 *
 * Every number these functions depend on was MEASURED, and the measurements
 * plus their contradictions with spec §9.1–§9.3 are in `data/climate-probe.md`.
 * That document is the authority; code here that disagrees with it is wrong.
 * Three of its findings shape everything below.
 *
 *   1. **There are two grids, not one.** §9.1 gives a single 43200 × 20880
 *      transform for the whole product. That is right for `tasmin`, `tasmax`
 *      and `pr` and wrong for `clt`, which is 14401 × 7201 on a different
 *      origin at a different resolution — and unlike the others it reaches
 *      both poles, where they stop at +84. So `pixelFor` takes the grid as an
 *      argument. Task 6 builds one per file out of that file's own tags; there
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
 *      too — only `clt` declares a sentinel a uint16 can actually hold — so
 *      `decodeSample` is told what absence looks like rather than assuming it.
 */

import { pathToFileURL } from 'node:url';

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
 * southward while latitude decreases), so whoever builds this object takes the
 * absolute value and `pixelFor` counts rows downward from `originY` itself.
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
 * The bounds check is what keeps a city off the wrong row rather than off the
 * raster. `x` wrapping past `width` would otherwise read a pixel one row down,
 * and a negative `y` would read from the end of the buffer. The probe found 0
 * of 58,757 cities outside either grid, so this should never fire — but +84 is
 * a real edge and the catalog grows.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {Grid} grid
 * @returns {{ x: number, y: number } | null}
 */
export function pixelFor(lon, lat, grid) {
  const x = Math.floor((lon - grid.originX) / grid.resX);
  const y = Math.floor((grid.originY - lat) / grid.resY);
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
 * A single missing month sinks the whole city, because 60 positional integers
 * carry no per-month absence marker — there is no way to write "March has no
 * cloud", and a tuple that quietly substituted something would be indis-
 * tinguishable from a measurement. The probe found 0 of 58,757 cities on
 * nodata, so this should never fire; that is a property of this CHELSA
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
  if (columns.some((column) => column.some((value) => value === null))) return null;

  const [lo, hi, precip, cloud, humidity] = columns;
  const tuple = new Array(TUPLE_LENGTH);
  for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
    tuple[m] = asInt(lo[m]);
    tuple[MONTHS_PER_YEAR + m] = asInt(hi[m]);
    tuple[2 * MONTHS_PER_YEAR + m] = asInt(precip[m]);
    tuple[3 * MONTHS_PER_YEAR + m] = asInt(cloud[m]);
    tuple[4 * MONTHS_PER_YEAR + m] = asInt(dewPointC((lo[m] + hi[m]) / 2, humidity[m]));
  }
  return tuple;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Task 6's job: fetch 48 rasters, sample all 58,757 cities against the grids
 * above, and write 246 shards under `public/climate/`. Nothing here yet.
 */
async function main() {
  throw new Error('not implemented until Task 6');
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
    process.exit(1);
  });
}
