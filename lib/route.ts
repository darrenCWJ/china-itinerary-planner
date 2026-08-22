import { nearestAirports, DEFAULT_AIRPORT_RADIUS_KM, type Airport } from "./airports";
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
 * `airports` and `groundedForLackOfAirport` are optional rather than a fourth
 * variant so that every existing consumer — which reads `kind`, `mode`, `km`
 * and `hours` — keeps compiling and behaving unchanged.
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
  | { kind: "unknown"; from: RoutePlace; to: RoutePlace };

export interface RouteSuggestion {
  order: RoutePlace[];
  legs: RouteLeg[];
  totalKm: number;
  notes: string[];
}

/** Legs longer than this are usually better flown than railed. */
const FLIGHT_THRESHOLD_KM = 1200;
/** Typical average speed of China's high-speed rail network, station to station. */
const RAIL_KMH = 230;
const RAIL_BUFFER_H = 0.75;
const FLIGHT_KMH = 700;
/**
 * Time spent at the airport itself: check-in, security, boarding, taxi and
 * baggage reclaim. Gate-side only — it does not include getting from the city
 * to the airport. That trip is `GROUND_TRANSFER_KMH` below, added on top for
 * an airport-aware flight, so the two terms are legitimately additive and do
 * not double-count the ride to the airport.
 */
const FLIGHT_BUFFER_H = 2.5;

/**
 * Average door-to-door speed between a city centre and its airport. Deliberately
 * slow: it stands for a taxi or airport train plus the walk at either end, not
 * a motorway cruise.
 */
const GROUND_TRANSFER_KMH = 60;

/**
 * The estimator's constants, readable from outside without duplicating them.
 * The private consts above stay the single definition — this is a view of
 * them, so a country profile can report what the estimates assume.
 */
export const TRANSPORT = {
  railKmh: RAIL_KMH,
  flightThresholdKm: FLIGHT_THRESHOLD_KM,
  flightKmh: FLIGHT_KMH,
  railBufferH: RAIL_BUFFER_H,
  flightBufferH: FLIGHT_BUFFER_H,
  groundTransferKmh: GROUND_TRANSFER_KMH,
  airportSearchRadiusKm: DEFAULT_AIRPORT_RADIUS_KM,
} as const;

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

const railHours = (km: number) => roundHalf(km / RAIL_KMH + RAIL_BUFFER_H);

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
 * With airports it fixes two lies in that heuristic: it no longer flies between
 * city centres, and it no longer routes a flight to a city that has no airport.
 */
export function estimateLeg(
  from: RoutePlace,
  to: RoutePlace,
  airports: readonly Airport[] = []
): RouteLeg {
  if (!isLocated(from) || !isLocated(to)) return { kind: "unknown", from, to };
  const km = Math.round(haversineKm(from, to));

  if (airports.length === 0) {
    const mode: LegMode = km > FLIGHT_THRESHOLD_KM ? "flight" : "rail";
    const hours =
      mode === "flight" ? roundHalf(km / FLIGHT_KMH + FLIGHT_BUFFER_H) : railHours(km);
    return { kind: "estimated", from, to, km, hours, mode };
  }

  const fromNear = nearestAirports(airports, from, { limit: 1 })[0];
  const toNear = nearestAirports(airports, to, { limit: 1 })[0];

  // No airport at one end means this leg cannot be flown, however long it is.
  if (!fromNear || !toNear) {
    const leg: RouteLeg = { kind: "estimated", from, to, km, hours: railHours(km), mode: "rail" };
    return km > FLIGHT_THRESHOLD_KM ? { ...leg, groundedForLackOfAirport: true } : leg;
  }

  // The threshold applies to the flight actually available, not to the distance
  // between the city centres — those differ by up to 300km for a served pair.
  const airportKm = Math.round(haversineKm(fromNear.airport, toNear.airport));
  if (airportKm <= FLIGHT_THRESHOLD_KM) {
    return { kind: "estimated", from, to, km, hours: railHours(km), mode: "rail" };
  }

  const transferH = (fromNear.km + toNear.km) / GROUND_TRANSFER_KMH;
  return {
    kind: "estimated",
    from,
    to,
    km,
    hours: roundHalf(airportKm / FLIGHT_KMH + FLIGHT_BUFFER_H + transferH),
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
  airports: readonly Airport[] = []
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
  const legs = order.slice(0, -1).map((p, i) => estimateLeg(p, order[i + 1], airports));
  const measured = legs.filter((l) => l.kind === "estimated");
  const totalKm = Math.round(measured.reduce((sum, l) => sum + l.km, 0));

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
        `${DEFAULT_AIRPORT_RADIUS_KM} km at one end — plan those overland (${grounded
          .map((l) => `${l.from.name} → ${l.to.name}`)
          .join(", ")}).`
    );
  }
  // Requires every leg to be measured *and* rail: with an unmeasurable leg in
  // the route, "every leg is rail-friendly" is an unsupported claim, not a true
  // one. `measured.every` alone would assert it over a route it cannot see.
  //
  // The mode/rail check alone is not enough either: `l.km` is always the
  // city-to-city distance, but with airports supplied `mode` was decided on
  // the airport-to-airport distance instead. A leg can come back "rail" and
  // ungrounded (both ends have an airport in range) while its own city-to-
  // city km is still well past FLIGHT_THRESHOLD_KM — calling that hop
  // "high-speed-rail friendly" is the same lie the grounded guard was added
  // to kill, just reached through a door the grounded flag cannot see.
  //
  // Checking `l.km <= FLIGHT_THRESHOLD_KM` directly is simpler than the old
  // `!l.groundedForLackOfAirport` check and strictly stronger:
  //   - `groundedForLackOfAirport` is only ever set when
  //     `km > FLIGHT_THRESHOLD_KM`, so `km <= FLIGHT_THRESHOLD_KM` already
  //     implies "not grounded" — the grounded check was redundant here.
  //   - It also closes the door above, which the grounded flag cannot see,
  //     because that leg is never grounded at all.
  // `groundedForLackOfAirport` itself is untouched — the grounded note above
  // still reads it.
  if (
    legs.length > 0 &&
    measured.length === legs.length &&
    measured.every((l) => l.mode === "rail" && l.km <= FLIGHT_THRESHOLD_KM)
  ) {
    notes.push("Every leg is high-speed-rail friendly — book seats ~15 days ahead on 12306 or Trip.com.");
  }
  return { order, legs, totalKm, notes };
}
