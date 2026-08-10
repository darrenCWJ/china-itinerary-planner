import { dayDate } from "./tickets";

/** A trip this device has created or joined — the homepage dashboard source. */
export interface MyTrip {
  id: string;
  name: string;
  startDate: string | null;
  /** Trip length in days, for the ongoing/past phase calculation. */
  days: number;
  destinations: string[];
  role: "creator" | "member";
  /** Your member name on this trip — lets a synced device edit as you. */
  memberName?: string;
  savedAt: number;
}

export type TripPhase =
  | { kind: "upcoming"; daysUntil: number }
  | { kind: "ongoing"; dayNumber: number }
  | { kind: "past" }
  | { kind: "undated" };

const STORAGE_KEY = "cip-my-trips-v1";
const MAX_TRIPS = 20;
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoToUtc(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Today's date in the device's local timezone, as yyyy-mm-dd. */
export function localTodayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Safe parse of the stored list — malformed storage yields an empty list. */
export function parseMyTrips(raw: string | null): MyTrip[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is MyTrip => {
      if (typeof t !== "object" || t === null) return false;
      const trip = t as Partial<MyTrip>;
      return (
        typeof trip.id === "string" &&
        typeof trip.name === "string" &&
        (trip.startDate === null || typeof trip.startDate === "string") &&
        typeof trip.days === "number" &&
        Array.isArray(trip.destinations) &&
        (trip.role === "creator" || trip.role === "member") &&
        (trip.memberName === undefined || typeof trip.memberName === "string") &&
        typeof trip.savedAt === "number"
      );
    });
  } catch {
    return [];
  }
}

/**
 * Insert or refresh a trip, newest-first, capped. An existing entry keeps its
 * role ("creator" never downgrades to "member" on a revisit).
 */
export function upsertMyTrip(
  list: MyTrip[],
  trip: Omit<MyTrip, "savedAt">,
  now: number
): MyTrip[] {
  const existing = list.find((t) => t.id === trip.id);
  const entry: MyTrip = {
    ...trip,
    role: existing?.role === "creator" ? "creator" : trip.role,
    memberName: trip.memberName ?? existing?.memberName,
    savedAt: now,
  };
  return [entry, ...list.filter((t) => t.id !== trip.id)].slice(0, MAX_TRIPS);
}

/**
 * Union two devices' lists by trip id: the newer entry wins a conflict,
 * "creator" role is sticky, and a missing memberName is filled from the
 * losing side. Newest-first, capped like the local list.
 */
export function mergeTripLists(a: MyTrip[], b: MyTrip[]): MyTrip[] {
  const byId = new Map<string, MyTrip>();
  for (const trip of [...a, ...b]) {
    const existing = byId.get(trip.id);
    if (!existing) {
      byId.set(trip.id, trip);
      continue;
    }
    const winner = trip.savedAt >= existing.savedAt ? trip : existing;
    const loser = winner === trip ? existing : trip;
    byId.set(trip.id, {
      ...winner,
      role: winner.role === "creator" || loser.role === "creator" ? "creator" : winner.role,
      memberName: winner.memberName ?? loser.memberName,
    });
  }
  return [...byId.values()].sort((x, y) => y.savedAt - x.savedAt).slice(0, MAX_TRIPS);
}

export function removeMyTrip(list: MyTrip[], id: string): MyTrip[] {
  return list.filter((t) => t.id !== id);
}

/** Where the trip sits relative to today. */
export function tripPhase(
  trip: Pick<MyTrip, "startDate" | "days">,
  todayIso: string
): TripPhase {
  const start = trip.startDate ? isoToUtc(trip.startDate) : null;
  const today = isoToUtc(todayIso);
  if (start === null || today === null) return { kind: "undated" };
  const diffDays = Math.round((today - start) / DAY_MS);
  if (diffDays < 0) return { kind: "upcoming", daysUntil: -diffDays };
  if (diffDays < trip.days) return { kind: "ongoing", dayNumber: diffDays + 1 };
  return { kind: "past" };
}

/** The trip to headline: an ongoing one first, else the soonest upcoming. */
export function pickNextTrip(list: MyTrip[], todayIso: string): MyTrip | null {
  let best: { trip: MyTrip; rank: number; distance: number } | null = null;
  for (const trip of list) {
    const phase = tripPhase(trip, todayIso);
    if (phase.kind !== "ongoing" && phase.kind !== "upcoming") continue;
    const rank = phase.kind === "ongoing" ? 0 : 1;
    const distance = phase.kind === "upcoming" ? phase.daysUntil : phase.dayNumber;
    if (
      !best ||
      rank < best.rank ||
      (rank === best.rank && distance < best.distance)
    ) {
      best = { trip, rank, distance };
    }
  }
  return best?.trip ?? null;
}

/** Last calendar day of the trip, for "14 Sep → 18 Sep" ranges. */
export function tripEndDate(trip: Pick<MyTrip, "startDate" | "days">): string | null {
  return dayDate(trip.startDate, Math.max(1, trip.days));
}

// ---- localStorage wrappers (browser only) ----

export function loadMyTrips(): MyTrip[] {
  try {
    return parseMyTrips(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function persist(list: MyTrip[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked — the dashboard just won't remember this trip.
  }
}

export function saveMyTrip(trip: Omit<MyTrip, "savedAt">): void {
  persist(upsertMyTrip(loadMyTrips(), trip, Date.now()));
}

export function forgetMyTrip(id: string): void {
  persist(removeMyTrip(loadMyTrips(), id));
}

/** Overwrite the stored list wholesale — used after a wallet merge. */
export function replaceMyTrips(list: MyTrip[]): void {
  persist(list);
}
