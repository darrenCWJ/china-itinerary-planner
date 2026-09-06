import "server-only";
import bundledAirportsJson from "../../data/airports.json";
import {
  findAirport as findIn,
  nearestAirports as nearestIn,
  searchAirports as searchIn,
  type Airport,
  type RankedAirport,
} from "../airports";
import type { LatLon } from "../geo";

/**
 * Binds the pure query layer in lib/airports to the committed artifact.
 *
 * The artifact is a static `import` rather than an `fs` read, for the reason
 * lib/server/catalog.ts documents: serverless deployments have a read-only
 * filesystem and no data/ directory, so a path read works locally and fails in
 * production. At 816KB the file is bigger than data/catalog.json's 569KB, but
 * that is the same order of magnitude as an artifact this repo already bundles
 * server-side, so it needs no new mechanism — just more of the one already in
 * use.
 *
 * Server-only, and enforced: `server-only` above makes a client import a
 * `next build` error rather than a silent 816 KB in the browser bundle.
 * Vitest aliases the package to an empty module (vitest.server-only.ts).
 */

interface AirportArtifact {
  generatedAt: string;
  source: string;
  airports: Airport[];
}

const artifact = bundledAirportsJson as unknown as AirportArtifact;

export function allAirports(): readonly Airport[] {
  return artifact.airports;
}

export function airportStatus(): {
  generatedAt: string;
  source: string;
  airports: number;
  countries: number;
} {
  return {
    generatedAt: artifact.generatedAt,
    source: artifact.source,
    airports: artifact.airports.length,
    countries: new Set(artifact.airports.map((a) => a.country)).size,
  };
}

export function airportsForCountry(code: string): Airport[] {
  const wanted = code.trim().toUpperCase();
  if (wanted.length !== 2) return [];
  return artifact.airports.filter((a) => a.country === wanted);
}

export function findAirport(iata: string): Airport | null {
  return findIn(allAirports(), iata);
}

export function searchAirports(query: string, limit?: number): Airport[] {
  return searchIn(allAirports(), query, limit);
}

export function nearestAirports(
  at: LatLon,
  options?: { radiusKm?: number; limit?: number }
): RankedAirport[] {
  return nearestIn(allAirports(), at, options);
}
