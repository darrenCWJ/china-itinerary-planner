import { haversineKm, type LatLon } from "./geo";

export interface RoutePlace extends LatLon {
  id: string;
  name: string;
}

export type LegMode = "rail" | "flight";

export interface RouteLeg {
  from: RoutePlace;
  to: RoutePlace;
  km: number;
  /** Estimated door-to-door hours, rounded to the nearest half hour. */
  hours: number;
  mode: LegMode;
}

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

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export function estimateLeg(from: RoutePlace, to: RoutePlace): RouteLeg {
  const km = Math.round(haversineKm(from, to));
  const mode: LegMode = km > FLIGHT_THRESHOLD_KM ? "flight" : "rail";
  const hours =
    mode === "flight"
      ? roundHalf(km / FLIGHT_KMH + FLIGHT_BUFFER_H)
      : roundHalf(km / RAIL_KMH + RAIL_BUFFER_H);
  return { from, to, km, hours, mode };
}

function tourDistance(order: RoutePlace[]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += haversineKm(order[i], order[i + 1]);
  }
  return total;
}

/** Greedy nearest-neighbour path starting from a fixed place. */
function nearestNeighbourFrom(start: RoutePlace, places: RoutePlace[]): RoutePlace[] {
  const remaining = places.filter((p) => p.id !== start.id);
  const order = [start];
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
  let best: RoutePlace[] | null = null;
  let bestDist = Infinity;
  for (const start of sorted) {
    const tour = nearestNeighbourFrom(start, sorted);
    const dist = tourDistance(tour);
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = tour;
    }
  }

  const order = best ?? sorted;
  const legs = order.slice(0, -1).map((p, i) => estimateLeg(p, order[i + 1]));
  const totalKm = Math.round(legs.reduce((sum, l) => sum + l.km, 0));

  const notes: string[] = [];
  const flights = legs.filter((l) => l.mode === "flight");
  if (flights.length > 0) {
    notes.push(
      `${flights.length} leg${flights.length > 1 ? "s are" : " is"} over ${FLIGHT_THRESHOLD_KM} km — consider flying (${flights
        .map((l) => `${l.from.name} → ${l.to.name}`)
        .join(", ")}).`
    );
  }
  if (legs.every((l) => l.mode === "rail")) {
    notes.push("Every leg is high-speed-rail friendly — book seats ~15 days ahead on 12306 or Trip.com.");
  }
  return { order, legs, totalKm, notes };
}
