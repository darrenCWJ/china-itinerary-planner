import { nearestAirports, type Airport } from "./airports";
import type { LatLon } from "./geo";

/**
 * The one "main airport" line a place gets, and the words it is labelled with
 * (spec §10.2).
 *
 * Takes the airport array as a parameter, exactly as lib/airports.ts does, and
 * for the same reason: this is read by a client component. `lib/server/airports.ts`
 * carries NO `server-only` guard — importing it from the browser side compiles
 * clean and silently ships data/airports.json, 876,823 B, to every visitor.
 * `MapExplorer` already fetches the open country's rows from
 * `/api/map/airports?country=XX`, so the array is always someone else's to
 * supply.
 */

/**
 * The label, which deliberately does not claim proximity.
 *
 * `nearestAirports` ranks on `km - SIZE_BONUS_KM[size]` with large +15 and
 * small -15 (lib/airports.ts:60-64). The two penalties are symmetric and
 * compose, so a large airport wins from up to 30 km further out than a small
 * one — twice the bound §10.2 quotes, and far enough that "nearest" would be a
 * lie the ranking eventually tells. That is the whole point of the discount:
 * London City really is closer to London than Heathrow, and really is not
 * London's main airport.
 */
export const MAIN_AIRPORT_LABEL = "Main airport";

export interface MainAirport {
  iata: string;
  /** True great-circle distance in km, rounded — never the ranking score. */
  km: number;
}

/**
 * The single airport to name for a place, or null if there is none to name.
 *
 * Null in two cases, which the caller should treat alike: the array is empty,
 * and nothing in it is within `DEFAULT_AIRPORT_RADIUS_KM`. Both mean the same
 * thing to a reader — this place has no airport worth calling its own — and
 * saying nothing is better than naming one 600 km away.
 *
 * The distance is rounded here rather than at the JSX, so "TNA · 30 km" has
 * one place that decides what 30 is.
 *
 * ## The border limit
 *
 * Scoped to the array it is handed, with no country predicate of its own — and
 * in the app that array is ONE country's rows, because `MapExplorer` fetches
 * `/api/map/airports?country=XX`. So near a border the true main airport is not
 * out-ranked, it is ABSENT: Basel's is EuroAirport (BSL), 6 km from the city
 * and in France, and a Swiss map can only offer Zürich (ZRH) at 74 km.
 * Measured against the committed artifact and pinned in mainAirport.test.ts.
 *
 * The limit is recorded here rather than in the card's copy, on purpose:
 *
 * - It is not a fact about that line of text. Nothing in this function and
 *   nothing in `CountryLevel` restricts anything by country; the scope is
 *   created three hops away by one fetch. A caveat in the copy would be the
 *   card describing a distant module's data path — and would silently become a
 *   lie the day that path widens, in JSX, where nobody chasing cross-border
 *   airports would think to look.
 * - "in Switzerland" only restates the country map already filling the screen.
 *   The version worth reading — "there may be a better one across that border"
 *   — cannot be said per place without exactly the cross-border data whose
 *   absence IS the limit.
 * - The copy's cleanliness is enforced, not merely intended:
 *   CountryLevel.test.tsx pins the rendered line's exact `textContent`, so a
 *   caveat added to it fails there.
 *
 * Fixing it is a change to the ARRAY, not to this function: a wider fetch (the
 * open country plus its neighbours) or an unfiltered artifact, both out of
 * scope for PR8 and both leaving this file alone. `mainAirportFor` is already
 * right for either — hand it more rows and the answer improves with no edit
 * here.
 */
export function mainAirportFor(airports: readonly Airport[], at: LatLon): MainAirport | null {
  const [best] = nearestAirports(airports, at, { limit: 1 });
  if (best === undefined) return null;
  return { iata: best.airport.iata, km: best.km };
}
