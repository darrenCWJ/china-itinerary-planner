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
 * production. At ~557KB the file is smaller than data/catalog.json, which is
 * already bundled this way, so this adds no new size concern.
 *
 * Server-only by convention, like lib/server/catalog.ts — importing it from a
 * client component would pull the artifact into the browser bundle.
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
