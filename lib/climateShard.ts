import { isCountryCode } from "./countries";

/**
 * The client's side of the worldwide climate normals artifact.
 *
 * One file per country under `public/climate/`, built by
 * `scripts/ingest-climate.mjs` from CHELSA V2.1 climatologies 1981-2010
 * (CC0 1.0, DOI 10.16904/envidat.228) and committed, exactly as
 * `public/cities/` and `public/provinces/` are — see the generated
 * `data/climate-report.md` for that build's own measurement record. This
 * module is the only thing that knows the file's shape.
 *
 * Fetched per country like a city shard, not read server-side: `public/` is
 * not readable from a Vercel lambda — the same constraint `cityShard.ts` and
 * `provinceTopology.ts` document — so an `fs` read of one of these works
 * locally and 500s in production.
 *
 * ## The row
 *
 * `cities` maps a `G`-prefixed GeoNames id (the same ids `public/cities/`
 * uses) to a `ClimateRow`: 60 integers, five blocks of twelve.
 *
 * ```
 * [ 0..11]  lo      °C          mean daily minimum
 * [12..23]  hi      °C          mean daily maximum
 * [24..35]  precip  mm/month
 * [36..47]  cloud   %
 * [48..59]  td      °C          dew point, UNCORRECTED (see below)
 * ```
 *
 * Every block is CALENDAR-INDEXED, January at index 0. No `seasonIn` was
 * applied when this artifact was built and none should be applied to this
 * index when reading it: a row is handed to `lib/climateModel.ts`'s
 * `climateMonth(row, month)` with a plain 0-based calendar month, for both
 * hemispheres alike.
 *
 * `td` is the August–Roche–Magnus dew point computed on `T = (lo + hi) / 2`
 * and the raw monthly `hurs` (relative humidity) — UNCORRECTED. Spec §9.4's
 * humidity-bias correction (`lib/climateModel.ts`'s `correctedDewPoint`) is
 * applied at READ time, deliberately, so it can be retuned without a
 * multi-gigabyte CHELSA re-ingest.
 *
 * Elevation is NOT in the row. A consumer that needs it (fix 4's lapse-rate
 * correction) joins `elev` from that same city's `public/cities/<CC>.json`
 * row. 301 of the 58,757 committed rows carry `elev: null`, and a consumer
 * must treat that as "no correction" — `lib/climateModel.ts`'s
 * `usableElevation` is what does that; never substitute `-9999`, GeoNames'
 * own no-data sentinel, which would warm those cities by roughly 65 °C if
 * read as a real elevation. This loader itself reads no city shard — joining
 * is the caller's job (Plan 6).
 *
 * ## Why one bad row refuses the whole shard
 *
 * `parseClimateShard` throws on the first malformed row rather than
 * dropping it and returning the rest — the same policy `parseCityShard`,
 * `parseProvinceTopology`, `parseWorldTopology` and `parseGlobeTopology` all
 * take, for a reason specific to this artifact's shape: a `ClimateRow` is 60
 * bare positional integers with NO per-month absence marker. Nothing in the
 * row itself says "this is January's cloud figure" — only its position
 * does. A row that lost its shape in a bad merge (not merely a short array,
 * which the length check alone already catches, but one reassembled with a
 * block or a month out of place) would still look like 60 ordinary
 * integers, and a city read through it would have July's precipitation
 * rendered as June's, or December's cloud read as its own dew point, with
 * nothing downstream able to tell a shifted row from a correct one. Refusing
 * the whole shard is the only defence available to a positional format.
 *
 * ## The bounds are a guard rail, not a climate claim
 *
 * `parseClimateShard` also rejects a row whose `lo`, `hi` or `td` falls
 * outside −90..60 °C, whose `precip` falls outside 0..10,000 mm, or whose
 * `cloud` falls outside 0..100% — deliberately wide of anything CHELSA
 * itself reports. The point is not to encode a claim about the planet's
 * climate; it is to catch a build that forgot to apply a raster's declared
 * offset. `tasmin`/`tasmax` are stored as `(°C + 273.15) × 10`, and a decode
 * that skipped the −273.15 offset would report Singapore at 298 °C —
 * comfortably inside a naive "cold sometimes, hot sometimes" bound, and
 * outside this one. No build gate upstream of this module would notice that
 * mistake; this one does. For reference, the artifact's OWN measured ranges
 * sit far inside these guard bands: lo −46..33, hi −40..47, precip 0..2476,
 * cloud 0..93, td −43..24 (data/climate-report.md, "## Measured ranges",
 * which the build regenerates from the rows it is about to write).
 */

/** Root-relative so the fetch resolves the same from every route. */
export const CLIMATE_INDEX_PATH = "/climate/index.json";

function normaliseCountry(country: string, what: string): string {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!isCountryCode(code)) {
    throw new Error(`${what}: "${country}" is not a country code — expected two letters`);
  }
  return code;
}

/**
 * Validated rather than interpolated, because this value reaches a URL: a
 * country of "../cities" would resolve out of /climate/ entirely and hand
 * the parser below a shard with no envelope at all. Same rule
 * `lib/provinceTopology.ts`'s `provincePath` and `lib/cityShard.ts`'s
 * `cityShardPath` pin for their own assets.
 */
export function climatePath(country: string): string {
  return `/climate/${normaliseCountry(country, "climatePath")}.json`;
}

/**
 * One city's climate normals: 60 integers, five 12-month calendar-indexed
 * blocks. See the module docblock for the block layout and for what `td` is
 * and is not. This is exactly the type `lib/climateModel.ts`'s
 * `climateMonth` and `rainKnee` consume — this module hands it over as read,
 * with no reshaping at the boundary.
 */
export type ClimateRow = readonly number[];

export interface ClimateShard {
  country: string;
  generatedAt: string;
  source: string;
  /**
   * A Map, not a record, for the reason `ProvinceFile.cityProvince` and
   * `DerivedClimateIndex` are: the keys come from a data file, and on a
   * plain object `cities["constructor"]` resolves to a function through the
   * prototype chain rather than missing, the way a lookup should.
   */
  cities: ReadonlyMap<string, ClimateRow>;
}

export interface ClimateIndex {
  generatedAt: string;
  countries: ReadonlyArray<{ code: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

const MONTHS_PER_YEAR = 12;
const BLOCKS = 5;
const ROW_LENGTH = BLOCKS * MONTHS_PER_YEAR;
const LO = 0;
const HI = 1;
const PRECIP = 2;
const CLOUD = 3;
const TD = 4;

/**
 * Wide of anything CHELSA actually reports — see the module docblock's "The
 * bounds are a guard rail, not a climate claim". Measured extremes across
 * the whole committed artifact: lo −46..33, hi −40..47, precip 0..2476,
 * cloud 0..93, td −43..24 (data/climate-report.md, "## Measured ranges").
 */
const TEMP_MIN_C = -90;
const TEMP_MAX_C = 60;
const PRECIP_MIN_MM = 0;
const PRECIP_MAX_MM = 10_000;
const CLOUD_MIN_PCT = 0;
const CLOUD_MAX_PCT = 100;

const GEONAMES_ID = /^G[1-9][0-9]*$/;

function failShard(detail: string): never {
  throw new Error(`climate shard: ${detail}`);
}

function failIndex(detail: string): never {
  throw new Error(`climate index: ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One field's guard band, checked at one calendar month. */
function checkBand(
  country: string,
  id: string,
  field: string,
  month: number,
  value: number,
  min: number,
  max: number
): void {
  if (value < min || value > max) {
    failShard(
      `${country}: city ${id} month ${month}'s ${field} (${value}) is outside the ${min}..${max} guard band — looks like an unscaled build`
    );
  }
}

/**
 * One row: shape, integer-ness, the guard bands, and lo ≤ hi. Throws via
 * `failShard` on the first problem — see the module docblock, "Why one bad
 * row refuses the whole shard", for why this does not drop the row instead.
 */
function parseRow(value: unknown, country: string, id: string): ClimateRow {
  if (!Array.isArray(value)) {
    failShard(`${country}: city ${id}'s row is not an array (got ${typeof value})`);
  }
  if (value.length !== ROW_LENGTH) {
    failShard(`${country}: city ${id}'s row has ${value.length} entries, expected ${ROW_LENGTH}`);
  }
  for (let i = 0; i < ROW_LENGTH; i += 1) {
    if (!Number.isInteger(value[i])) {
      failShard(`${country}: city ${id} row[${i}] is not a finite integer (${JSON.stringify(value[i])})`);
    }
  }
  for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
    const lo = value[LO * MONTHS_PER_YEAR + m];
    const hi = value[HI * MONTHS_PER_YEAR + m];
    checkBand(country, id, "lo", m, lo, TEMP_MIN_C, TEMP_MAX_C);
    checkBand(country, id, "hi", m, hi, TEMP_MIN_C, TEMP_MAX_C);
    checkBand(country, id, "precip", m, value[PRECIP * MONTHS_PER_YEAR + m], PRECIP_MIN_MM, PRECIP_MAX_MM);
    checkBand(country, id, "cloud", m, value[CLOUD * MONTHS_PER_YEAR + m], CLOUD_MIN_PCT, CLOUD_MAX_PCT);
    checkBand(country, id, "td", m, value[TD * MONTHS_PER_YEAR + m], TEMP_MIN_C, TEMP_MAX_C);
    if (lo > hi) {
      failShard(`${country}: city ${id} month ${m} has lo (${lo}) greater than hi (${hi})`);
    }
  }
  return value as ClimateRow;
}

/**
 * Validates at the boundary and narrows. Throws rather than degrading on
 * anything structural — the same policy `parseCityShard` and
 * `parseProvinceTopology` take, for the reason the module docblock gives.
 */
export function parseClimateShard(raw: unknown, expectedCountry?: string): ClimateShard {
  const root = asRecord(raw);
  if (!root) failShard("root is not an object");

  const country = typeof root.country === "string" ? root.country.trim().toUpperCase() : "";
  if (!isCountryCode(country)) {
    failShard(`country is not a country code (${JSON.stringify(root.country)})`);
  }
  // A shard is identified by its URL AND by its envelope, and the two must
  // agree — the same fixture invariant `parseCityShard` and
  // `parseProvinceTopology` enforce, and for the same reason: nothing
  // downstream reads `country` once parsing succeeds, so a stale cache
  // entry or a mis-copied fixture serving one country's rows under another
  // country's path would otherwise be invisible.
  if (expectedCountry !== undefined) {
    const wanted = expectedCountry.trim().toUpperCase();
    if (country !== wanted) failShard(`is ${country}'s file, but ${wanted} was requested`);
  }

  if (typeof root.generatedAt !== "string" || root.generatedAt === "") {
    failShard(`${country}: generatedAt is missing or not a string (${JSON.stringify(root.generatedAt)})`);
  }
  if (typeof root.source !== "string" || root.source === "") {
    failShard(`${country}: source is missing or not a string (${JSON.stringify(root.source)})`);
  }

  const citiesRaw = asRecord(root.cities);
  if (!citiesRaw) failShard(`${country}: cities is not an object`);

  const cities = new Map<string, ClimateRow>();
  for (const [id, value] of Object.entries(citiesRaw)) {
    if (!GEONAMES_ID.test(id)) {
      failShard(`${country}: city id ${JSON.stringify(id)} is malformed — expected "G" + digits`);
    }
    cities.set(id, parseRow(value, country, id));
  }

  return {
    country,
    generatedAt: root.generatedAt,
    source: root.source,
    cities,
  };
}

/**
 * `index.json`'s envelope: `generatedAt` plus one `{ code, count }` per
 * committed shard. Thrown on for the same reason as the shard parser — a
 * caller that reads this to know which countries have climate data must not
 * be handed a half-parsed list.
 */
export function parseClimateIndex(raw: unknown): ClimateIndex {
  const root = asRecord(raw);
  if (!root) failIndex("root is not an object");
  if (typeof root.generatedAt !== "string" || root.generatedAt === "") {
    failIndex(`generatedAt is missing or not a string (${JSON.stringify(root.generatedAt)})`);
  }
  if (!Array.isArray(root.countries)) failIndex("countries is not an array");

  const countries = root.countries.map((entry, i) => {
    const record = asRecord(entry);
    if (!record) failIndex(`entry ${i} is not an object`);
    const code = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
    if (!isCountryCode(code)) failIndex(`entry ${i} has a bad code (${JSON.stringify(record.code)})`);
    if (typeof record.count !== "number" || !Number.isInteger(record.count) || record.count < 0) {
      failIndex(`entry ${i} (${code}) has a bad count (${JSON.stringify(record.count)})`);
    }
    return { code, count: record.count };
  });

  return { generatedAt: root.generatedAt, countries };
}

/**
 * Fetches and validates one country's climate shard. Shaped like
 * `fetchProvinceTopology` and `fetchCityShard`: rejects rather than
 * degrading on both a bad status and a bad body, and leaves it to the
 * caller (Plan 6) to decide whether a missing shard is survivable.
 *
 * `fetchImpl` defaults to the global `fetch` and is overridable so a test
 * can inject a fake response with no network call — `lib/rates.ts`'s
 * `fetchJsonWithTimeout` pattern.
 */
export async function fetchClimateShard(
  country: string,
  fetchImpl: typeof fetch = fetch
): Promise<ClimateShard> {
  const path = climatePath(country);
  const response = await fetchImpl(path);
  if (!response.ok) throw new Error(`climate shard ${path}: ${response.status}`);
  return parseClimateShard(await response.json(), country);
}

/** Same shape as `fetchClimateShard`, for `index.json`. */
export async function fetchClimateIndex(fetchImpl: typeof fetch = fetch): Promise<ClimateIndex> {
  const response = await fetchImpl(CLIMATE_INDEX_PATH);
  if (!response.ok) throw new Error(`climate index ${CLIMATE_INDEX_PATH}: ${response.status}`);
  return parseClimateIndex(await response.json());
}
