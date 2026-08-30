import type { CountryCode } from "./countries";
import { foldPlaceName } from "./foldPlaceName";
import { haversineKm, type LatLon } from "./geo";

/**
 * Query layer over the worldwide airport set (spec §3).
 *
 * Every function takes the airport array as a parameter rather than importing
 * the artifact. That is what keeps this module client-safe: `lib/route.ts`
 * imports it and `lib/route.ts` runs in the browser inside `MapExplorer`, so a
 * bundled 816KB JSON here would ship to every visitor. `lib/server/airports.ts`
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

export interface RankedAirport {
  airport: Airport;
  /** True great-circle distance in km, rounded — never the ranking score. */
  km: number;
}

/**
 * How far from a place an airport can be and still count as serving it.
 *
 * Matches `NEAREST_CITY_MAX_KM` in scripts/ingest-destinations.mjs. Beyond
 * this, returning "nearest" is worse than returning nothing: a 600km airport
 * is not this city's airport, and a caller told there is none can say so.
 */
export const DEFAULT_AIRPORT_RADIUS_KM = 150;

/**
 * The sizes that count as somewhere a traveller ARRIVES: `large` and `medium`,
 * never `small` (§10.1).
 *
 * ## This is a product decision, and it has one owner on purpose
 *
 * It started as §10.1's rule for the map layer alone — `large` and `medium`
 * only, because the committed artifact is 1,148 large, 2,092 medium and 892
 * small, and that last fifth is airstrips and aeroclubs. The card's "Main
 * airport" line (§10.2) ranked over all three, and so the two surfaces filtered
 * the same array on different axes and disagreed in the way that costs a reader
 * something: the card could name a `small` airport the map would never draw, so
 * "Main airport: XYZ" pointed at a diamond that is not on screen.
 *
 * **The set governs; the card was narrowed to it.** The alternative — drawing
 * the card's pick regardless of size — was rejected on three counts:
 *
 * - It fixes the wrong half. The complaint is not "the map is missing a mark",
 *   it is that a card named an aeroclub the *card itself* should not have named.
 *   An airstrip is not a traveller's main airport whether or not it is drawn,
 *   and the argument §10.1 makes for keeping it off the map is the same
 *   argument for keeping it out of that sentence.
 * - It makes the layer depend on which card is open. The marks are projected
 *   once per country precisely so a hover cannot re-project 502 of them; a
 *   diamond that appears and vanishes as a reader taps between cities is both a
 *   new dependency and a worse map.
 * - It leaves the drawn set a function of the selection, which is what §10.1's
 *   "size chooses WHETHER an airport is drawn and nothing else" rules out.
 *
 * The narrowing also settles a discrepancy §10.2 already carried. The spec says
 * `[0]` "can legitimately be 15 km further than the true nearest", but the
 * penalties in `SIZE_BONUS_KM` are symmetric and compose, so across all three
 * sizes a large airport wins from up to **30** km further out. Over this set the
 * widest spread is large (+15) against medium (0) — 15 km, exactly the number
 * the spec quotes. `nearestAirports` itself is unchanged and still ranks over
 * whatever it is handed: `lib/route.ts` estimates flights between real airports
 * of any size, which is a different question from what to name a place's
 * gateway.
 *
 * An allow-list rather than `size !== "small"`, so a size the upstream feed
 * grows later is used only once someone has decided it should be.
 */
export const ARRIVABLE_AIRPORT_SIZES: ReadonlySet<AirportSize> = new Set<AirportSize>([
  "large",
  "medium",
]);

const DEFAULT_NEAREST_LIMIT = 5;

/**
 * Distance discount by size, in km. A judgement call, not a fact.
 *
 * Straight distance makes London City the airport for London at 13km, ahead of
 * Heathrow at 23km — technically true and wrong for a trip planner. A flat km
 * discount rather than a multiplier is what keeps this a tie-breaker: it can
 * reorder airports within 15km of each other and cannot promote a large
 * airport 100km away over a medium one next door.
 */
const SIZE_BONUS_KM: Record<AirportSize, number> = {
  large: 15,
  medium: 0,
  small: -15,
};

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
 * Scores: exact IATA code 3, name/municipality prefix 2, name/municipality
 * substring 1. This deliberately differs from `searchCities` in
 * lib/server/catalog.ts (name/local-name prefix 3, substring 2, province
 * prefix 1) — a city has no code to match exactly, so it has no exact tier,
 * while an airport does have one that users actually type. The shared idea
 * is not an identical score table but "a more specific match ranks higher."
 * Names fold through `foldPlaceName`, so "zurich" finds "Zürich" and "xian"
 * finds "Xi'an".
 */
export function searchAirports(
  airports: readonly Airport[],
  query: string,
  limit = 12
): Airport[] {
  const raw = query.trim();
  const code = raw.toUpperCase();
  const q = foldPlaceName(raw);
  if (q.length < 1) return [];

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

/**
 * Airports within range of a point, best first.
 *
 * Ranked rather than single-winner because London genuinely is five airports,
 * and a caller choosing a departure point needs to see them. Ordering uses the
 * size-discounted distance; the reported `km` is always the true one.
 */
export function nearestAirports(
  airports: readonly Airport[],
  at: LatLon,
  options: { radiusKm?: number; limit?: number } = {}
): RankedAirport[] {
  const radiusKm = options.radiusKm ?? DEFAULT_AIRPORT_RADIUS_KM;
  const limit = options.limit ?? DEFAULT_NEAREST_LIMIT;

  const within: Array<RankedAirport & { rank: number }> = [];
  for (const airport of airports) {
    const km = haversineKm(at, airport);
    if (km > radiusKm) continue;
    within.push({ airport, km: Math.round(km), rank: km - SIZE_BONUS_KM[airport.size] });
  }
  // IATA breaks a rank tie so the order is deterministic across runs.
  within.sort((a, b) => a.rank - b.rank || a.airport.iata.localeCompare(b.airport.iata));
  return within.slice(0, limit).map(({ airport, km }) => ({ airport, km }));
}
