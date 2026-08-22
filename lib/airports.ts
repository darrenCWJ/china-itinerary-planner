import type { CountryCode } from "./countries";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Query layer over the worldwide airport set (spec §3).
 *
 * Every function takes the airport array as a parameter rather than importing
 * the artifact. That is what keeps this module client-safe: `lib/route.ts`
 * imports it and `lib/route.ts` runs in the browser inside `MapExplorer`, so a
 * bundled 557KB JSON here would ship to every visitor. `lib/server/airports.ts`
 * binds these to the real artifact on the server.
 *
 * A linear scan over ~4,100 entries is microseconds, so there is no index and
 * no precomputed city-to-airport table — which also means these work for any
 * coordinate, including a hand-typed place that is in no dataset.
 */

export type AirportSize = "large" | "medium" | "small";

export interface Airport {
  /** Three-letter IATA code. Unique across the filtered set — the primary key. */
  iata: string;
  icao: string | null;
  name: string;
  /** The city the airport serves, as the source names it. */
  municipality: string | null;
  country: CountryCode;
  lat: number;
  lon: number;
  size: AirportSize;
}

/** Sort weight for search results at equal score — bigger airports first. */
const SIZE_RANK: Record<AirportSize, number> = { large: 0, medium: 1, small: 2 };

export function findAirport(airports: readonly Airport[], iata: string): Airport | null {
  const code = iata.trim().toUpperCase();
  if (code.length !== 3) return null;
  return airports.find((a) => a.iata === code) ?? null;
}

/**
 * Ranked search over IATA code, airport name and municipality.
 *
 * Scores mirror `searchCities` in lib/server/catalog.ts — exact 3, prefix 2,
 * substring 1 — so the two search surfaces in the app behave alike. Names fold
 * through `foldPlaceName`, so "zurich" finds "Zürich" and "xian" finds "Xi'an".
 */
export function searchAirports(
  airports: readonly Airport[],
  query: string,
  limit = 12
): Airport[] {
  const raw = query.trim();
  if (raw.length < 1) return [];
  const code = raw.toUpperCase();
  const q = foldPlaceName(raw);

  const scored: Array<{ airport: Airport; score: number }> = [];
  for (const airport of airports) {
    let score = -1;
    if (airport.iata === code) {
      score = 3;
    } else {
      const name = foldPlaceName(airport.name);
      const city = foldPlaceName(airport.municipality ?? "");
      if (name.startsWith(q) || city.startsWith(q)) score = 2;
      else if (name.includes(q) || city.includes(q)) score = 1;
    }
    if (score > 0) scored.push({ airport, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      SIZE_RANK[a.airport.size] - SIZE_RANK[b.airport.size] ||
      a.airport.iata.localeCompare(b.airport.iata)
  );
  return scored.slice(0, limit).map((s) => s.airport);
}
