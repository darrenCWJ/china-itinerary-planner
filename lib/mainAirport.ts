import { ARRIVABLE_AIRPORT_SIZES, nearestAirports, type Airport } from "./airports";
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
 * medium 0, so over the set this function ranks — `ARRIVABLE_AIRPORT_SIZES` —
 * a large airport wins from up to 15 km further out than a medium one. Far
 * enough that "nearest" would be a lie the ranking eventually tells, and that
 * is the whole point of the discount: London City really is closer to London
 * than Heathrow, and really is not London's main airport.
 *
 * 15 and not the 30 an earlier version of this docblock recorded, because that
 * number came from `small`'s -15 composing with `large`'s +15 — and `small` is
 * no longer in the running here.
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
 * Null in three cases, which the caller should treat alike: the array is empty,
 * nothing in it is within `DEFAULT_AIRPORT_RADIUS_KM`, and nothing within that
 * radius is a size anyone arrives at. All three mean the same thing to a reader
 * — this place has no airport worth calling its own — and saying nothing is
 * better than naming one 600 km away, or an aeroclub.
 *
 * The distance is rounded here rather than at the JSX, so "TNA · 30 km" has
 * one place that decides what 30 is.
 *
 * ## The card names only what the map can draw
 *
 * `ARRIVABLE_AIRPORT_SIZES` before the ranking, not after: a filter applied to
 * `[0]` would answer null whenever the winner happened to be small, rather than
 * naming the best airport a traveller can actually use.
 *
 * Sharing §10.1's set is what makes the card's claim checkable, and the shape
 * of the argument is containment. This function narrows the open country's rows
 * by that set AND by `DEFAULT_AIRPORT_RADIUS_KM`; the layer narrows the same
 * rows by that set and by nothing else. So what this names is always a member
 * of what the layer drew — never the reverse, and that asymmetry is correct: a
 * map showing a country's airports beyond 150 km of the open city is a map,
 * while a card naming a code with no diamond under it is a broken promise.
 *
 * When the layer is OFF nothing is drawn and there is nothing to disagree with;
 * §10.2's line is a fact about the open place either way. lib/airports.ts's
 * docblock carries the decision and the case for it, and
 * `CountryLevel.test.tsx`'s "the airport the card names is one the layer drew"
 * is what holds the two together, by rendering both at once.
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
  const arrivable = airports.filter((airport) => ARRIVABLE_AIRPORT_SIZES.has(airport.size));
  const [best] = nearestAirports(arrivable, at, { limit: 1 });
  if (best === undefined) return null;
  return { iata: best.airport.iata, km: best.km };
}
