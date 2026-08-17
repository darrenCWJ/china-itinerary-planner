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

/**
 * Discriminated rather than optional-numbered on purpose: a leg into a place
 * with no coordinates has no distance and no duration, and `km: 0` would render
 * as a real zero-kilometre hop. Callers have to decide what an unmeasurable leg
 * looks like, which is the point.
 */
export type RouteLeg =
  | {
      kind: "estimated";
      from: RoutePlace;
      to: RoutePlace;
      km: number;
      /** Estimated door-to-door hours, rounded to the nearest half hour. */
      hours: number;
      mode: LegMode;
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
const FLIGHT_BUFFER_H = 2.5;

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
} as const;

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function estimateLeg(from: RoutePlace, to: RoutePlace): RouteLeg {
  if (!isLocated(from) || !isLocated(to)) return { kind: "unknown", from, to };
  const km = Math.round(haversineKm(from, to));
  const mode: LegMode = km > FLIGHT_THRESHOLD_KM ? "flight" : "rail";
  const hours =
    mode === "flight"
      ? roundHalf(km / FLIGHT_KMH + FLIGHT_BUFFER_H)
      : roundHalf(km / RAIL_KMH + RAIL_BUFFER_H);
  return { kind: "estimated", from, to, km, hours, mode };
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
export function suggestRoute(places: RoutePlace[]): RouteSuggestion {
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
  const legs = order.slice(0, -1).map((p, i) => estimateLeg(p, order[i + 1]));
  const measured = legs.filter((l) => l.kind === "estimated");
  const totalKm = Math.round(measured.reduce((sum, l) => sum + l.km, 0));

  const notes: string[] = [];
  const flights = measured.filter((l) => l.mode === "flight");
  if (flights.length > 0) {
    notes.push(
      `${flights.length} leg${flights.length > 1 ? "s are" : " is"} over ${FLIGHT_THRESHOLD_KM} km — consider flying (${flights
        .map((l) => `${l.from.name} → ${l.to.name}`)
        .join(", ")}).`
    );
  }
  // Requires every leg to be measured *and* rail: with an unmeasurable leg in
  // the route, "every leg is rail-friendly" is an unsupported claim, not a true
  // one. `measured.every` alone would assert it over a route it cannot see.
  if (legs.length > 0 && measured.length === legs.length && measured.every((l) => l.mode === "rail")) {
    notes.push("Every leg is high-speed-rail friendly — book seats ~15 days ahead on 12306 or Trip.com.");
  }
  return { order, legs, totalKm, notes };
}
