import bundledCityIndexJson from "../../data/cities-index.json";
import { isGeoNamesId } from "../geoNamesId";
import type { CountryCode } from "../types";

/**
 * Re-exported so `lib/server/catalog.ts` and this file's own test import it
 * from here unchanged, while modules that want only the predicate can reach
 * `lib/geoNamesId` directly and skip the 3.5 MB import below.
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
 * At 3.65 MB the artifact is about four times data/airports.json, which is the
 * same mechanism one order of magnitude up rather than a new one. It is stored
 * as tuples rather than objects because the same data as an object map is
 * 4.35 MB and this is parsed once per cold start.
 *
 * Server-only by convention, like lib/server/catalog.ts — importing it from a
 * client component would pull 3.5 MB into the browser bundle. The client's
 * side of the same data is one 20 KB shard, in lib/cityShard.ts.
 */

export interface CityIndexEntry {
  id: string;
  name: string;
  country: CountryCode;
  lat: number;
  lon: number;
  /**
   * Admin-1 name — the region label meaningful inside this city's own country,
   * which is exactly what `Destination.region` is (`lib/types.ts:57-63`).
   */
  region: string | null;
}

interface CityIndexArtifact {
  generatedAt: string;
  source: string;
  cities: unknown[];
}

const GEONAMES_ID = /^G[1-9][0-9]*$/;

/**
 * Degrades rather than throws, unlike `parseCityShard`.
 *
 * This runs at module load inside every API route that imports the catalog.
 * A throw here takes down `/api/trips` and `/api/trips/[id]` — routes that
 * never touch a GeoNames city — over one bad tuple.
 */
export function readCityIndex(raw: unknown): Map<string, CityIndexEntry> {
  const index = new Map<string, CityIndexEntry>();
  const root = typeof raw === "object" && raw !== null ? (raw as CityIndexArtifact) : null;
  if (!root || !Array.isArray(root.cities)) return index;
  for (const tuple of root.cities) {
    if (!Array.isArray(tuple) || tuple.length < 6) continue;
    const [id, name, country, lat, lon, region] = tuple as unknown[];
    if (typeof id !== "string" || !GEONAMES_ID.test(id)) continue;
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
 * Built on first use rather than at import: the 58,742 Map inserts cost about
 * 15 ms, and a route that never resolves a GeoNames city should not pay them.
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
