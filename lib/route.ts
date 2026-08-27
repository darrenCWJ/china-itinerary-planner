import { nearestAirports, DEFAULT_AIRPORT_RADIUS_KM, type Airport } from "./airports";
import { DEFAULT_COUNTRY, getCountryProfile, type TransportProfile } from "./countryProfile";
import { haversineKm, type LatLon } from "./geo";

export interface RoutePlace {
  id: string;
  name: string;
  /**
   * Null for an off-map place — hand-typed by the user with no location
   * attached (spec §5.6). It still takes days, nights and budget; it just
   * contributes no distance.
   */
  lat: number | null;
  lon: number | null;
}

/** A place we can actually measure from. */
type LocatedPlace = RoutePlace & LatLon;

function isLocated(place: RoutePlace): place is LocatedPlace {
  return place.lat !== null && place.lon !== null;
}

export type LegMode = "rail" | "flight";

/** An airport as a leg reports it — enough to label "PEK → URC" and no more. */
export interface RouteAirport {
  iata: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * Discriminated rather than optional-numbered on purpose: a leg into a place
 * with no coordinates has no distance and no duration, and `km: 0` would render
 * as a real zero-kilometre hop. Callers have to decide what an unmeasurable leg
 * looks like, which is the point.
 *
 * `airports` and `groundedForLackOfAirport` are optional rather than variants
 * of their own so that every existing consumer — which reads `kind`, `mode`,
 * `km` and `hours` — keeps compiling and behaving unchanged. `overland` below
 * is a variant precisely because it breaks that shape: it has no `hours` at
 * all, so a consumer that renders one has to say what an untimed leg looks
 * like instead of printing `~undefinedh`.
 */
export type RouteLeg =
  | {
      kind: "estimated";
      from: RoutePlace;
      to: RoutePlace;
      /** City-to-city distance. Unchanged by airport awareness. */
      km: number;
      /** Estimated door-to-door hours, rounded to the nearest half hour. */
      hours: number;
      mode: LegMode;
      /** The resolved pair. Present only on an airport-aware flight leg. */
      airports?: { from: RouteAirport; to: RouteAirport };
      /** Distance called for a flight, but an end had no airport in range. */
      groundedForLackOfAirport?: true;
    }
  | {
      /**
       * A ground leg in a country whose profile withholds a rail speed
       * (`railKmh: null`). It carries its distance and deliberately no
       * duration: nothing here knows that country's road speeds, and
       * `km / GROUND_TRANSFER_KMH` would be a claim about them — Lima → Cusco
       * is roughly 20 h by coach, not the 9.5 h that arithmetic prints.
       */
      kind: "overland";
      from: RoutePlace;
      to: RoutePlace;
      /** City-to-city distance, the same measure an estimated leg reports. */
      km: number;
    }
  | { kind: "unknown"; from: RoutePlace; to: RoutePlace };

/** Every leg that measured a distance — estimated or overland, never unknown. */
type MeasuredLeg = Extract<RouteLeg, { km: number }>;

function hasDistance(leg: RouteLeg): leg is MeasuredLeg {
  return leg.kind !== "unknown";
}

/**
 * Legs that keep the party on the ground: rail where the country has rail,
 * overland where it does not. Grouping the two keeps the all-ground predicate
 * in `suggestRoute` a single predicate — and it is what makes the
 * `railKmh !== null` guard beside it load-bearing rather than decorative,
 * because an all-overland route reaches that predicate and is turned away by
 * the guard alone.
 */
function isGroundLeg(leg: MeasuredLeg): boolean {
  return leg.kind === "overland" || leg.mode === "rail";
}

export interface RouteSuggestion {
  order: RoutePlace[];
  legs: RouteLeg[];
  totalKm: number;
  notes: string[];
}

/**
 * What the estimator assumes when the caller names no country: the default
 * country's own transport profile.
 *
 * Read from the profile rather than restated here, so "the estimator's
 * constants" and "China's transport profile" cannot drift apart — they are
 * the same object. It is also today's behaviour exactly, which is what lets
 * every pre-existing route test pass unedited: the estimator was always
 * assuming China, it simply never said so.
 *
 * The import arrow runs route → countryProfile, the direction T20 opened by
 * moving the country data down into zero-import leaves. countryProfile does
 * not import this module, so there is no cycle to reintroduce.
 */
export const TRANSPORT: TransportProfile = getCountryProfile(DEFAULT_COUNTRY).transport;

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

function toRouteAirport(airport: Airport): RouteAirport {
  return { iata: airport.iata, name: airport.name, lat: airport.lat, lon: airport.lon };
}

/**
 * Estimate one leg, optionally using real airports.
 *
 * With no airports supplied this is the original distance heuristic, unchanged
 * — which is what keeps every caller that has no airport data working, and what
 * the "behaves exactly as before" test pins.
 *
 * With airports it fixes three lies in that heuristic: it no longer flies
 * between city centres, it no longer routes a flight to a city that has no
 * airport, and it no longer picks "flight" on distance alone — a threshold on
 * the airport-pair distance can still be beaten by rail door-to-door once
 * ground transfer at both ends is counted, so the estimate falls back to rail
 * whenever that would actually be faster.
 */
export function estimateLeg(
  from: RoutePlace,
  to: RoutePlace,
  airports: readonly Airport[] = [],
  transport: TransportProfile = TRANSPORT
): RouteLeg {
  if (!isLocated(from) || !isLocated(to)) return { kind: "unknown", from, to };
  const km = Math.round(haversineKm(from, to));

  const { railKmh, flightThresholdKm, flightKmh, railBufferH, flightBufferH, groundTransferKmh } =
    transport;

  // A country with no rail speed has no rail leg to fall back to, so none of
  // the rail-versus-flight arithmetic below applies to it.
  if (railKmh === null) return estimateWithoutRail(from, to, km, airports, transport);

  const railHours = (d: number) => roundHalf(d / railKmh + railBufferH);

  if (airports.length === 0) {
    const mode: LegMode = km > flightThresholdKm ? "flight" : "rail";
    const hours =
      mode === "flight" ? roundHalf(km / flightKmh + flightBufferH) : railHours(km);
    return { kind: "estimated", from, to, km, hours, mode };
  }

  const fromNear = nearestAirports(airports, from, { limit: 1 })[0];
  const toNear = nearestAirports(airports, to, { limit: 1 })[0];

  // No airport at one end means this leg cannot be flown, however long it is.
  if (!fromNear || !toNear) {
    const leg: RouteLeg = { kind: "estimated", from, to, km, hours: railHours(km), mode: "rail" };
    return km > flightThresholdKm ? { ...leg, groundedForLackOfAirport: true } : leg;
  }

  // The threshold applies to the flight actually available, not to the distance
  // between the city centres — those differ by up to 300km for a served pair.
  const airportKm = Math.round(haversineKm(fromNear.airport, toNear.airport));
  if (airportKm <= flightThresholdKm) {
    return { kind: "estimated", from, to, km, hours: railHours(km), mode: "rail" };
  }

  const transferH = (fromNear.km + toNear.km) / groundTransferKmh;
  const flightHours = roundHalf(airportKm / flightKmh + flightBufferH + transferH);

  // A distance-only threshold on the airport pair is not sufficient once
  // ground transfer is counted: two airports sitting well outside their
  // cities can push airportKm past the threshold — and so pick "flight" —
  // even though the two transfers add up to more time than the flight's
  // speed advantage over rail actually buys back. Keep the flight only if
  // it is genuinely faster door-to-door than the rail alternative over the
  // same city-to-city km; otherwise this is functionally a rail leg that
  // happened to resolve two distant airports.
  const railAlternativeHours = railHours(km);
  if (flightHours >= railAlternativeHours) {
    return { kind: "estimated", from, to, km, hours: railAlternativeHours, mode: "rail" };
  }

  return {
    kind: "estimated",
    from,
    to,
    km,
    hours: flightHours,
    mode: "flight",
    airports: { from: toRouteAirport(fromNear.airport), to: toRouteAirport(toNear.airport) },
  };
}

/**
 * The estimate for a country whose profile withholds a rail speed.
 *
 * The flight threshold has nothing to protect here. It exists because below it
 * rail beats flying door-to-door, and this country has no rail — so the gate
 * becomes whether the flight is a journey rather than a detour: the hop between
 * the two airports has to be longer than the ground transfers needed to reach
 * them. Two cities sharing one airport, or sitting closer together than their
 * own airports are to them, come back overland.
 *
 * Everything else is `overland`: real distance, and no duration at all. A
 * road-speed guess is the exact failure this task exists to remove, and the one
 * speed available — `groundTransferKmh`, a taxi-to-the-airport figure — would
 * turn Lima → Cusco into a 9.5 h drive. It is roughly 20 h by coach.
 *
 * With no airports supplied at all this returns overland too, rather than
 * falling back to the distance heuristic: calling a flight would assert an
 * airport exists at both ends, which is precisely what is not known here.
 * Coarser, and true.
 */
function estimateWithoutRail(
  from: LocatedPlace,
  to: LocatedPlace,
  km: number,
  airports: readonly Airport[],
  transport: TransportProfile
): RouteLeg {
  const fromNear = nearestAirports(airports, from, { limit: 1 })[0];
  const toNear = nearestAirports(airports, to, { limit: 1 })[0];
  if (!fromNear || !toNear) return { kind: "overland", from, to, km };

  const airportKm = Math.round(haversineKm(fromNear.airport, toNear.airport));
  const transferKm = fromNear.km + toNear.km;
  if (airportKm <= transferKm) return { kind: "overland", from, to, km };

  const hours = roundHalf(
    airportKm / transport.flightKmh +
      transport.flightBufferH +
      transferKm / transport.groundTransferKmh
  );
  return {
    kind: "estimated",
    from,
    to,
    km,
    hours,
    mode: "flight",
    airports: { from: toRouteAirport(fromNear.airport), to: toRouteAirport(toNear.airport) },
  };
}

function tourDistance(order: LocatedPlace[]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += haversineKm(order[i], order[i + 1]);
  }
  return total;
}

/** Greedy nearest-neighbour path starting from a fixed place. */
function nearestNeighbourFrom(start: LocatedPlace, places: LocatedPlace[]): LocatedPlace[] {
  const remaining = places.filter((p) => p.id !== start.id);
  const order: LocatedPlace[] = [start];
  let current = start;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    current = remaining[bestIdx];
    order.push(current);
    remaining.splice(bestIdx, 1);
  }
  return order;
}

/**
 * Suggest a visiting order for the selected places: nearest-neighbour tours
 * from every possible start, keeping the shortest (ties broken by id order,
 * so results are deterministic). This is deliberately a pure function — the
 * seam where an AI-powered planner can slot in later with the same shape.
 */
export function suggestRoute(
  places: RoutePlace[],
  airports: readonly Airport[] = [],
  transport: TransportProfile = TRANSPORT
): RouteSuggestion {
  if (places.length < 2) {
    return { order: [...places], legs: [], totalKm: 0, notes: [] };
  }

  const sorted = [...places].sort((a, b) => a.id.localeCompare(b.id));
  // Coordinate-less places cannot join a nearest-neighbour tour — there is no
  // distance to be nearest by. They go last, which is the only position that
  // does not distort the legs around them, and keeps the id sort's determinism.
  const located = sorted.filter(isLocated);
  const unlocated = sorted.filter((p) => !isLocated(p));

  let best: LocatedPlace[] | null = null;
  let bestDist = Infinity;
  for (const start of located) {
    const tour = nearestNeighbourFrom(start, located);
    const dist = tourDistance(tour);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = tour;
    }
  }

  const order: RoutePlace[] = [...(best ?? located), ...unlocated];
  const legs = order.slice(0, -1).map((p, i) => estimateLeg(p, order[i + 1], airports, transport));
  const measured = legs.filter((l) => l.kind === "estimated");
  // Overland legs measured a real distance and no duration, so they belong in
  // the total and nowhere near the duration-shaped notes below. Totalling only
  // the estimated legs would under-report a trip by every leg its country has
  // no rail for — which, for most countries, is the whole trip.
  const withDistance = legs.filter(hasDistance);
  const totalKm = Math.round(withDistance.reduce((sum, l) => sum + l.km, 0));

  const notes: string[] = [];
  const flights = measured.filter((l) => l.mode === "flight");
  if (flights.length > 0) {
    // Not "over FLIGHT_THRESHOLD_KM km": with airports supplied, `mode` was
    // decided on the airport-to-airport distance, but `l.km` here is still
    // city-to-city — the two can sit on opposite sides of the threshold (see
    // the all-rail predicate below for the mirror case). Claiming only that
    // these legs are worth flying stays true regardless of which distance
    // decided it.
    notes.push(
      `${flights.length} leg${flights.length > 1 ? "s are" : " is"} worth flying (${flights
        .map((l) => `${l.from.name} → ${l.to.name}`)
        .join(", ")}).`
    );
  }
  const grounded = measured.filter((l) => l.groundedForLackOfAirport);
  if (grounded.length > 0) {
    notes.push(
      `${grounded.length} long leg${grounded.length > 1 ? "s have" : " has"} no airport within ` +
        `${DEFAULT_AIRPORT_RADIUS_KM} km at one end — plan ${
          grounded.length > 1 ? "those" : "it"
        } overland (${grounded.map((l) => `${l.from.name} → ${l.to.name}`).join(", ")}).`
    );
  }
  // `l.km <= flightThresholdKm` already implies the leg isn't grounded,
  // since `groundedForLackOfAirport` is only ever set once km exceeds that
  // threshold. It also catches the two cases the grounded flag alone can't
  // see: close airports masking a long city-to-city hop that comes back
  // "rail" and ungrounded, and the slower-than-rail fallback above, which
  // also returns "rail" with the full city-to-city km still over threshold.
  const ground = withDistance.filter(isGroundLeg);
  if (transport.railKmh === null) {
    // A country with no researched rail network still has transport to book —
    // flights, coaches, whatever the traveller ends up on — and the neutral
    // copy names none of them, which is exactly why it is safe to emit here.
    //
    // What is *not* safe is the researched branch below: China's copy says
    // "every leg is high-speed-rail friendly — book seats on 12306", and a
    // country whose profile withholds a rail speed has no such rail. Two
    // sentences, two premises; only the rail one is gated on rail.
    //
    // Still gated on there being a measured distance: a route made entirely of
    // hand-typed places has no coordinates, so nothing here knows whether the
    // hops are long-distance at all, and "fares climb close to the date" would
    // be a claim about a journey we cannot see.
    if (withDistance.length > 0) notes.push(...transport.bookingCopy);
  } else if (
    legs.length > 0 &&
    ground.length === legs.length &&
    ground.every((l) => l.km <= transport.flightThresholdKm)
  ) {
    notes.push(...transport.bookingCopy);
  }
  return { order, legs, totalKm, notes };
}
