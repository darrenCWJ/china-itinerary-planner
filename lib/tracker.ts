import type { LatLon } from "./geo";
import { haversineKm } from "./geo";
import type { DayPlan, ScheduledItem } from "./itinerary";
import { itemCheckKey } from "./tripShared";
import type { TimeSlot } from "./types";

export type TripPhase = "no-date" | "before" | "during" | "after";

export interface TrackerState {
  phase: TripPhase;
  /** 1-based trip day, only set during the trip. */
  dayIndex: number | null;
  /** Whole days until departure, only set before the trip. */
  daysToGo: number | null;
  totalDays: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since epoch for an ISO date, UTC-anchored so no timezone drift. */
function epochDay(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

export function trackerState(
  startDate: string | null,
  totalDays: number,
  todayIsoDate: string
): TrackerState {
  const start = startDate ? epochDay(startDate) : null;
  const today = epochDay(todayIsoDate);
  if (start === null || today === null) {
    return { phase: "no-date", dayIndex: null, daysToGo: null, totalDays };
  }
  const dayIndex = today - start + 1;
  if (dayIndex < 1) {
    return { phase: "before", dayIndex: null, daysToGo: 1 - dayIndex, totalDays };
  }
  if (dayIndex <= totalDays) {
    return { phase: "during", dayIndex, daysToGo: null, totalDays };
  }
  return { phase: "after", dayIndex: null, daysToGo: null, totalDays };
}

/** Device-local calendar date — the whole party lives in UTC+8 either way. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function slotForHour(hour: number): TimeSlot {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const SLOT_RANK: Record<TimeSlot, number> = { morning: 0, afternoon: 1, evening: 2 };

export interface NowNext {
  current: ScheduledItem | null;
  next: ScheduledItem | null;
}

/**
 * current = first unchecked item in a slot that has already begun;
 * next = the unchecked item after it (or the first upcoming one when
 * nothing is currently due).
 */
export function nowNext(
  day: DayPlan,
  checkedKeys: ReadonlySet<string>,
  slot: TimeSlot
): NowNext {
  const pending = day.items.filter((i) => !checkedKeys.has(itemCheckKey(i.id)));
  const rank = SLOT_RANK[slot];
  const current = pending.find((i) => SLOT_RANK[i.slot] <= rank) ?? null;
  if (current) {
    const idx = pending.indexOf(current);
    return { current, next: pending[idx + 1] ?? null };
  }
  return { current: null, next: pending[0] ?? null };
}

export function progress(
  days: DayPlan[],
  checkedKeys: ReadonlySet<string>
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const d of days) {
    for (const item of d.items) {
      total += 1;
      if (checkedKeys.has(itemCheckKey(item.id))) done += 1;
    }
  }
  return { done, total };
}

/** Unique destination names through the given trip day, in visit order. */
export function citiesSoFar(days: DayPlan[], dayIndex: number): string[] {
  const seen: string[] = [];
  for (const d of days) {
    if (d.day > dayIndex) break;
    if (!seen.includes(d.destinationName)) seen.push(d.destinationName);
  }
  return seen;
}

/**
 * Rail km covered so far: haversine over consecutive-day city changes already
 * reached. Days whose coordinates can't be resolved contribute nothing.
 */
export function railKmSoFar(
  days: DayPlan[],
  dayIndex: number,
  coords: (destinationId: string) => LatLon | null
): number {
  let km = 0;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i].day > dayIndex) break;
    if (days[i].destinationId === days[i - 1].destinationId) continue;
    const a = coords(days[i - 1].destinationId);
    const b = coords(days[i].destinationId);
    if (a && b) km += haversineKm(a, b);
  }
  return Math.round(km);
}
