import type { ScheduledItem } from "./itinerary";

/**
 * Timeline reflow (spec §3.2.6): when a block grows or moves, the timed blocks
 * after it give way.
 *
 * Two rules shape everything here:
 *
 * **Untimed items never move.** Most items in every plan saved before time
 * blocks existed carry no `startMinutes` at all, and spec §5.3 forbids giving
 * them one they never had. They are stepped over, not scheduled around.
 *
 * **Array order is day order.** `moveItem` reorders the array, so the user's
 * sequence is the array's sequence — a block dragged above one that starts
 * earlier pushes it rather than being re-sorted behind it. Reflow never sorts.
 *
 * Pure and free of React so it can be composed by the day-builder reducer (C3).
 */

/** The ±15m granularity spec §3.2.6 specifies for the duration controls. */
export const DURATION_STEP = 15;
/** Floor for a block. Below this it is not a plan, it is a rounding error. */
export const MIN_DURATION = 15;
/** Matches DurationMinutesSchema's ceiling in lib/server/schemas.ts. */
const MAX_DURATION = 1440;
/** Matches StartMinutesSchema's ceiling — 23:59, the last minute a block starts. */
const LAST_START = 1439;

export interface ReflowedItem extends ScheduledItem {
  /**
   * Id of the block that displaced this one. Derived per reflow and never
   * persisted — it is a presentation fact ("this moved because that grew"),
   * which is why it lives on this view type and not on `ScheduledItem`.
   *
   * Attribution is to the immediate predecessor, so the UI can name what pushed
   * this block rather than blaming an edit three blocks back.
   */
  pushedBy?: string;
  /**
   * The push would have run past midnight and was clamped to the last minute of
   * the day. Flagged rather than allowed to overflow because `startMinutes` is
   * bounded 0–1439 at the write boundary, so an overflowing start could not be
   * saved — this lets the UI say the day is overfull instead.
   */
  overflows?: boolean;
}

/** A block is timed only when it has *both* halves — see `ScheduledItem`. */
function isTimed(item: ScheduledItem): item is ScheduledItem & {
  startMinutes: number;
  durationMinutes: number;
} {
  return (
    typeof item.startMinutes === "number" &&
    typeof item.durationMinutes === "number" &&
    item.durationMinutes > 0
  );
}

export function reflow(items: readonly ScheduledItem[]): ReflowedItem[] {
  /** End of the previous timed block, and the id it belongs to. */
  let cursor: number | null = null;
  let cursorId: string | null = null;

  return items.map((item) => {
    if (!isTimed(item)) return { ...item };

    if (cursor === null || item.startMinutes >= cursor) {
      cursor = item.startMinutes + item.durationMinutes;
      cursorId = item.id;
      return { ...item };
    }

    // Overlapped: take the earliest start that clears the block above.
    const pushedStart = Math.min(cursor, LAST_START);
    const overflows = cursor > LAST_START;
    const pushed: ReflowedItem = {
      ...item,
      startMinutes: pushedStart,
      pushedBy: cursorId ?? undefined,
      ...(overflows ? { overflows: true } : {}),
    };
    cursor = pushedStart + item.durationMinutes;
    cursorId = item.id;
    return pushed;
  });
}

/**
 * Grow or shrink one block by a signed number of minutes, clamped to the floor
 * and the ceiling.
 *
 * Deliberately does not reflow. The two are separate so a caller can apply
 * several adjustments and reflow once, rather than reflowing on every
 * intermediate step of a drag.
 */
export function adjustDuration(
  items: readonly ScheduledItem[],
  id: string,
  deltaMinutes: number
): ScheduledItem[] {
  return items.map((item) => {
    // An untimed item has no duration to adjust, and inventing one would
    // fabricate the block §5.3 forbids.
    if (item.id !== id || !isTimed(item)) return { ...item };
    const next = Math.min(MAX_DURATION, Math.max(MIN_DURATION, item.durationMinutes + deltaMinutes));
    return { ...item, durationMinutes: next };
  });
}

export interface DayLoad {
  /** Total length of the timed blocks. Untimed items contribute nothing. */
  plannedMinutes: number;
  /**
   * Holes *between* consecutive timed blocks. The time before the first block
   * and after the last is the unplanned rest of the day, not a hole in a plan.
   */
  gaps: number;
}

/** The `9h 40m planned · 2 gaps` readout (spec §3.2.6). */
export function dayLoad(items: readonly ScheduledItem[]): DayLoad {
  let plannedMinutes = 0;
  let gaps = 0;
  let previousEnd: number | null = null;

  for (const item of items) {
    if (!isTimed(item)) continue;
    plannedMinutes += item.durationMinutes;
    if (previousEnd !== null && item.startMinutes > previousEnd) gaps += 1;
    previousEnd = item.startMinutes + item.durationMinutes;
  }

  return { plannedMinutes, gaps };
}

/** Minutes from midnight as a 24-hour clock, e.g. 540 → "09:00". */
export function formatClock(startMinutes: number): string {
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * A span as humans say it: 90 → "1h 30m", 60 → "1h", 45 → "45m".
 *
 * Drops the zero minute part rather than printing "1h 0m", and drops the hour
 * part below an hour, so the day-load readout stays scannable.
 */
export function formatSpan(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
