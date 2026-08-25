import bundledCityIndexJson from "../../data/cities-index.json";
import { isGeoNamesId } from "../geoNamesId";
import type { CountryCode } from "../types";

/**
 * Re-exported so `lib/server/catalog.ts` and this file's own test import it
 * from here unchanged, while modules that want only the predicate can reach
 * `lib/geoNamesId` directly and skip the 3.65 MB import below.
 */
export { isGeoNamesId };

/**
 * Binds the bundled worldwide city index to a lookup the server can use.
 *
 * A static `import` rather than an `fs` read, for the reason
 * lib/server/catalog.ts and lib/server/airports.ts both document: serverless
 * deployments have a read-only filesystem and no data/ directory, so a path
 * read works locally and fails in production. `public/cities/*.json` is
 * emphatically NOT an option here — spec §3.2 makes that a hard constraint,
 * and this file is the reason it can be one.
 *
 * data/cities-index.json is 3,653,616 bytes (3.65 MB) against
 * data/airports.json's 877,293 — 4.16x. That is the same mechanism at four
 * times the size rather than a new one.
 *
 * Tuples rather than objects because every object shape measured costs more
 * for the same 58,742 rows. Re-serialising the committed rows with
 * JSON.stringify: an id-keyed map of the same fields, with the id not repeated
 * inside each value, is 5,885,812 bytes — 1.61x this file; an array of
 * six-field objects is 6,179,522; even single-letter keys with no envelope
 * only get down to 4,828,362. The payload is parsed once per cold start, so
 * that difference is paid per instance, not once.
 *
 * Server-only by convention, like lib/server/catalog.ts — importing it from a
 * client component would pull 3.65 MB into the browser bundle. The client's
 * side of the same data is a single country shard out of public/cities/ —
 * median 12 KB, 97 KB at the largest — parsed by lib/cityShard.ts.
 */

export interface CityIndexEntry {
  id: string;
  name: string;
  country: CountryCode;
  lat: number;
  lon: number;
  /**
   * Admin-1 name — the region label meaningful inside this city's own country.
   *
   * `Destination.region` (`lib/types.ts:63`) is where this eventually has to
   * land, but the two types do not line up: that field is declared
   * `region: string`, required and non-nullable, and this one is genuinely
   * nullable — 439 of the 58,742 committed rows carry no admin1 at all. So
   * this is live data, not a defensive branch, and reconciling it is Task 11's
   * problem. It needs a real answer rather than the codebase's only existing
   * fallback: `regionFor` (lib/server/catalog.ts:204-206) defaults to
   * "Central", a China-specific value that means nothing for a Peruvian or
   * Andorran city.
   */
  region: string | null;
}

interface CityIndexArtifact {
  generatedAt: string;
  source: string;
  cities: unknown[];
}

/**
 * Degrades rather than throws, unlike `parseCityShard`.
 *
 * The index is built lazily, on the first resolve (`loadIndex` below), so a
 * throw here would surface inside a request that is already resolving a
 * GeoNames city. It would not fire at module load, and it could not reach
 * `/api/trips` or `/api/trips/[id]`, which never enter this path.
 *
 * Dropping the bad tuple still beats throwing on that narrower path: the input
 * is a build-time static import of a generated artifact, a wholesale reshape
 * is already caught by the count band in this file's test, and one malformed
 * row should cost that one city rather than the whole resolve.
 * `readCountryImageIndex` (lib/countryImagery.ts:153) degrades for the same
 * reason on the same kind of generated input.
 */
export function readCityIndex(raw: unknown): Map<string, CityIndexEntry> {
  const index = new Map<string, CityIndexEntry>();
  const root = typeof raw === "object" && raw !== null ? (raw as CityIndexArtifact) : null;
  if (!root || !Array.isArray(root.cities)) return index;
  for (const tuple of root.cities) {
    if (!Array.isArray(tuple) || tuple.length < 6) continue;
    const [id, name, country, lat, lon, region] = tuple as unknown[];
    // `isGeoNamesId` guards `typeof` itself, so the check in front of it is
    // not a second validation — it is what narrows `id` from `unknown` to
    // `string` for the `index.set` below, which would otherwise need a cast.
    if (typeof id !== "string" || !isGeoNamesId(id)) continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) continue;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) continue;
    index.set(id, {
      id,
      name,
      country,
      lat,
      lon,
      region: typeof region === "string" && region !== "" ? region : null,
    });
  }
  return index;
}

const artifact = bundledCityIndexJson as unknown as CityIndexArtifact;

/**
 * Built on first use rather than at import: reading the 58,742 tuples into the
 * Map costs 25-31 ms (measured over five fresh node processes, first call
 * only, median 27), and a route that never resolves a GeoNames city should not
 * pay that.
 */
let index: Map<string, CityIndexEntry> | null = null;

function loadIndex(): Map<string, CityIndexEntry> {
  if (!index) index = readCityIndex(artifact);
  return index;
}

/**
 * A Map lookup, not an object index: these ids arrive off the wire through
 * `/api/destinations/resolve?ids=`, and a plain object would answer
 * `index["constructor"]` with a function that `?? null` cannot catch.
 */
export function cityIndexEntry(id: string): CityIndexEntry | null {
  return loadIndex().get(id) ?? null;
}

export function cityIndexStatus(): { cities: number; generatedAt: string } {
  return { cities: loadIndex().size, generatedAt: artifact.generatedAt ?? "" };
}
