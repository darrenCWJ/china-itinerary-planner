import { isCountryCode } from "./countries";
import type { MapCity } from "./tripShared";

/**
 * The client's side of the worldwide city catalog.
 *
 * Cities are per-country static files under `public/`, fetched by the browser
 * when a country is picked — not read by a route handler. `public/` is not
 * readable from a Vercel lambda, so a server-side `fs` read of a shard works
 * locally and 500s in production (spec §3.2). The server's copy of the data is
 * the bundled `data/cities-index.json`, bound in `lib/server/cityIndex.ts`.
 *
 * Measured: the largest shard (AR) is 21.6 KB gzipped and the median is under
 * 12 KB, which is what makes on-demand fetching need no loading state beyond
 * what the map already has.
 */

/** Root-relative so the fetch resolves the same from every route. */
export const CITY_SHARD_INDEX_PATH = "/cities/index.json";

function normaliseCountry(country: string, what: string): string {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!isCountryCode(code)) {
    throw new Error(`${what}: "${country}" is not a country code — expected two letters`);
  }
  return code;
}

/**
 * Validated rather than interpolated, because this value reaches a URL: a
 * country of "../world-globe" would resolve out of /cities/ entirely and hand
 * the shard parser a topology.
 */
export function cityShardPath(country: string): string {
  return `/cities/${normaliseCountry(country, "cityShardPath")}.json`;
}

export function cityEnrichmentPath(country: string): string {
  return `/cities/enrich/${normaliseCountry(country, "cityEnrichmentPath")}.json`;
}

/** The seven-field record `scripts/ingest-cities.mjs` emits. */
export interface CityShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  /** Admin-1 name, already resolved from GeoNames' code. Null when it has none. */
  a1: string | null;
  p: number;
  tz: string;
}

export interface CityShard {
  country: string;
  generatedAt: string;
  source: string;
  /** Population descending — display order, never score order (spec §3.2). */
  cities: CityShardRow[];
}

export interface CityEnrichment {
  description: string | null;
  image: string | null;
}

/** Keyed by the `G`-prefixed GeoNames id. */
export type CityEnrichmentIndex = Readonly<Record<string, CityEnrichment>>;

const GEONAMES_ID = /^G[1-9][0-9]*$/;

function fail(detail: string): never {
  throw new Error(`city shard: ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function degrees(value: unknown, limit: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -limit && value <= limit
    ? value
    : null;
}

/**
 * Throws rather than degrading, the same policy `parseWorldTopology` and
 * `parseGlobeTopology` take: a silently partial parse renders a picker that is
 * quietly missing cities, and nothing downstream can tell that from a country
 * that genuinely has few.
 */
export function parseCityShard(raw: unknown, expectedCountry?: string): CityShard {
  const root = asRecord(raw);
  if (!root) fail("root is not an object");
  const country = typeof root.country === "string" ? root.country.trim().toUpperCase() : "";
  if (!isCountryCode(country)) fail(`country is not a country code (${JSON.stringify(root.country)})`);
  // A shard is identified by its URL AND by its envelope, and the two must
  // agree. Nothing downstream reads this field — callers take `cities` and
  // nothing else — so a cache entry, a CDN rewrite or a mis-copied fixture
  // that served one country's rows under another country's path would be
  // completely invisible: Peru's cities would draw on Japan's map and every
  // test would stay green. That is spec §6's fixture invariant, and it is the
  // shape of PR #17's inside-out globe fixture. `isCountryCode` is only
  // `/^[A-Za-z]{2}$/`, so it would happily accept "JP" on Peru's file.
  if (expectedCountry !== undefined) {
    const wanted = expectedCountry.trim().toUpperCase();
    if (country !== wanted) fail(`is ${country}'s shard, but ${wanted} was requested`);
  }
  if (!Array.isArray(root.cities)) fail("cities is not an array");

  const cities: CityShardRow[] = root.cities.map((entry, i) => {
    const city = asRecord(entry);
    if (!city) fail(`row ${i} is not an object`);
    if (typeof city.id !== "string" || !GEONAMES_ID.test(city.id)) {
      fail(`row ${i} has a malformed id (${JSON.stringify(city.id)}) — expected "G" + digits`);
    }
    if (typeof city.n !== "string" || city.n.trim() === "") fail(`row ${i} has an empty name`);
    // Range-checked, not merely finite: haversine's trig is periodic, so a
    // latitude of 394.5 silently behaves as 34.5 and the city relocates to a
    // believable wrong place rather than erroring.
    const lat = degrees(city.lat, 90);
    if (lat === null) fail(`row ${i} has a non-finite lat (${JSON.stringify(city.lat)})`);
    const lon = degrees(city.lon, 180);
    if (lon === null) fail(`row ${i} has a non-finite lon (${JSON.stringify(city.lon)})`);
    if (typeof city.p !== "number" || !Number.isFinite(city.p) || city.p < 0) {
      fail(`row ${i} has a non-finite population (${JSON.stringify(city.p)})`);
    }
    return {
      id: city.id,
      n: city.n,
      lat,
      lon,
      a1: typeof city.a1 === "string" && city.a1 !== "" ? city.a1 : null,
      p: city.p,
      tz: typeof city.tz === "string" ? city.tz : "",
    };
  });

  return {
    country,
    generatedAt: typeof root.generatedAt === "string" ? root.generatedAt : "",
    source: typeof root.source === "string" ? root.source : "",
    cities,
  };
}

/**
 * Drops bad entries and never throws — the opposite of `parseCityShard`, and
 * for the reason `readCountryImageIndex` gives for the same split: a city with
 * no description already renders exactly as a thin catalog city does, so
 * degrading costs a blurb while failing costs the whole country.
 */
export function parseCityEnrichment(raw: unknown): CityEnrichmentIndex {
  const root = asRecord(raw);
  const entries = asRecord(root?.cities);
  if (!entries) return {};
  const index: Record<string, CityEnrichment> = {};
  for (const [id, value] of Object.entries(entries)) {
    if (!GEONAMES_ID.test(id)) continue;
    const entry = asRecord(value);
    if (!entry) continue;
    const description = typeof entry.description === "string" ? entry.description : null;
    const image = typeof entry.image === "string" ? entry.image : null;
    if (description === null && image === null) continue;
    index[id] = { description, image };
  }
  return index;
}

/** A million people is a municipality; 200,000 is a prefecture. */
const MUNICIPALITY_POPULATION = 1_000_000;
const PREFECTURE_POPULATION = 200_000;

/**
 * `MapCity.level` for a GeoNames city.
 *
 * The union is China's administrative vocabulary and it stays, because it is
 * what `CountryMap.tsx`'s `radiusFor` and `labelFor` already switch on — the
 * levels are marker prominence, not governance. Population is the only field
 * in the seven-field record that carries that meaning, and the thresholds are
 * chosen so a GeoNames city draws at the same size as a Chinese one of the
 * same weight.
 */
export function cityLevel(population: number): MapCity["level"] {
  if (population >= MUNICIPALITY_POPULATION) return "municipality";
  if (population >= PREFECTURE_POPULATION) return "prefecture";
  return "county";
}

export function shardRowToMapCity(row: CityShardRow, enrichment: CityEnrichmentIndex): MapCity {
  return {
    // `qid` is MapCity's existing field name and §3.3 keeps the shape
    // unchanged, so the `G`-prefixed GeoNames id rides in it. The prefix is
    // the whole of what keeps the two namespaces apart.
    qid: row.id,
    name: row.n,
    // GeoNames' `name` column is already the local endonym for most places and
    // the dump carries no separate romanisation worth showing beside it.
    localName: null,
    province: row.a1,
    lat: row.lat,
    lon: row.lon,
    // 0 is a real population for 30,648 rows and must not become `null`, which
    // means "unknown" to marker sizing and to lib/feasibility.
    population: row.p,
    level: cityLevel(row.p),
    // GeoNames has no attractions layer; the QID catalog is the only source of
    // those, and it is China-only.
    attractionCount: 0,
    blurb: enrichment[row.id]?.description ?? null,
  };
}

/**
 * Fetches and validates one country's shard.
 *
 * No module-level cache: the response carries a 6h `Cache-Control` plus a day
 * of `stale-while-revalidate` from `next.config.ts` (Task 17), so the browser's
 * own cache serves the second caller, and a cache here would need a test-only
 * reset hook and would leak between tests.
 *
 * A signed-out request is redirected to /login by `proxy.ts` and `fetch`
 * follows it, so `res.ok` is true and `res.json()` rejects on the login page's
 * `<`. That rejection is the correct outcome — the picker only renders on
 * `/plan`, which is behind the wall anyway — and callers already treat any
 * rejection as "no shard".
 */
export async function fetchCityShard(country: string, signal?: AbortSignal): Promise<CityShard> {
  const path = cityShardPath(country);
  const response = await fetch(path, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`city shard ${path}: ${response.status}`);
  // The country is passed through, so the URL and the envelope are checked
  // against each other on every real fetch — not only in fixtures.
  return parseCityShard(await response.json(), country);
}

/** Never rejects for a country that simply has no enrichment file. */
export async function fetchCityEnrichment(
  country: string,
  signal?: AbortSignal
): Promise<CityEnrichmentIndex> {
  const path = cityEnrichmentPath(country);
  const response = await fetch(path, signal ? { signal } : undefined);
  if (!response.ok) return {};
  return parseCityEnrichment(await response.json());
}
