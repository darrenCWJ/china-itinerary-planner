import type { DayPlan, ScheduledItem, TripPlan } from "./itinerary";
import type { TimeSlot } from "./types";

/** One member edit to the stored plan, applied server-side. */
export type PlanOp =
  | {
      op: "addItem";
      day: number;
      title: string;
      slot: TimeSlot;
      time?: string;
      note?: string;
      startMinutes?: number;
      durationMinutes?: number;
    }
  | {
      op: "updateItem";
      day: number;
      itemId: string;
      title?: string;
      slot?: TimeSlot;
      /** null clears the field; undefined leaves it unchanged. */
      time?: string | null;
      note?: string | null;
      startMinutes?: number | null;
      durationMinutes?: number | null;
    }
  /** Set or clear an item's time block. Both null = back to untimed. */
  | {
      op: "setTiming";
      day: number;
      itemId: string;
      startMinutes: number | null;
      durationMinutes: number | null;
    }
  | { op: "removeItem"; day: number; itemId: string }
  | { op: "moveItem"; day: number; itemId: string; direction: "up" | "down" }
  | { op: "addDay"; destinationId?: string };

export interface PlanOpContext {
  newId: () => string;
  /** Resolve a catalog destination id to its display name; null when unknown. */
  resolveDestinationName: (id: string) => string | null;
}

export type PlanOpResult =
  | { ok: true; plan: TripPlan; removedItemId?: string }
  | { ok: false; error: string };

function replaceDay(plan: TripPlan, day: DayPlan): TripPlan {
  return { ...plan, days: plan.days.map((d) => (d.day === day.day ? day : d)) };
}

/**
 * Timing patch semantics, shared by `updateItem` and `setTiming`: `undefined`
 * leaves the field alone, `null` clears it. Clearing lands on `undefined` rather
 * than `null` so the persisted item loses the key entirely and reads back
 * identical to one saved before time blocks existed.
 */
function patchTiming(
  current: number | null | undefined,
  next: number | null | undefined
): number | undefined {
  return (next === undefined ? current : next) ?? undefined;
}

export function applyPlanOp(plan: TripPlan, op: PlanOp, ctx: PlanOpContext): PlanOpResult {
  if (op.op === "addDay") {
    const last = plan.days[plan.days.length - 1];
    let destinationId: string;
    let destinationName: string;
    if (op.destinationId) {
      const name = ctx.resolveDestinationName(op.destinationId);
      if (!name) return { ok: false, error: "Unknown destination" };
      destinationId = op.destinationId;
      destinationName = name;
    } else if (last) {
      destinationId = last.destinationId;
      destinationName = last.destinationName;
    } else {
      return { ok: false, error: "Pick a destination for the new day" };
    }
    const newDay: DayPlan = {
      day: plan.days.length + 1,
      destinationId,
      destinationName,
      items: [],
    };
    return { ok: true, plan: { ...plan, days: [...plan.days, newDay] } };
  }

  const day = plan.days.find((d) => d.day === op.day);
  if (!day) return { ok: false, error: "Day not found" };

  switch (op.op) {
    case "addItem": {
      const item: ScheduledItem = {
        id: ctx.newId(),
        slot: op.slot,
        kind: "custom",
        title: op.title,
        time: op.time || undefined,
        note: op.note || undefined,
        startMinutes: op.startMinutes,
        durationMinutes: op.durationMinutes,
      };
      return { ok: true, plan: replaceDay(plan, { ...day, items: [...day.items, item] }) };
    }

    case "updateItem": {
      const existing = day.items.find((i) => i.id === op.itemId);
      if (!existing) return { ok: false, error: "That item no longer exists" };
      const slotChanged = op.slot !== undefined && op.slot !== existing.slot;
      const patched: ScheduledItem = {
        ...existing,
        title: op.title ?? existing.title,
        slot: op.slot ?? existing.slot,
        fullDay: slotChanged ? undefined : existing.fullDay,
        time: op.time === undefined ? existing.time : op.time || undefined,
        note: op.note === undefined ? existing.note : op.note || undefined,
        startMinutes: patchTiming(existing.startMinutes, op.startMinutes),
        durationMinutes: patchTiming(existing.durationMinutes, op.durationMinutes),
      };
      const items = day.items.map((i) => (i.id === op.itemId ? patched : i));
      return { ok: true, plan: replaceDay(plan, { ...day, items }) };
    }

    case "setTiming": {
      const existing = day.items.find((i) => i.id === op.itemId);
      if (!existing) return { ok: false, error: "That item no longer exists" };
      const patched: ScheduledItem = {
        ...existing,
        startMinutes: patchTiming(existing.startMinutes, op.startMinutes),
        durationMinutes: patchTiming(existing.durationMinutes, op.durationMinutes),
      };
      const items = day.items.map((i) => (i.id === op.itemId ? patched : i));
      return { ok: true, plan: replaceDay(plan, { ...day, items }) };
    }

    case "removeItem": {
      const exists = day.items.some((i) => i.id === op.itemId);
      if (!exists) return { ok: true, plan };
      const items = day.items.filter((i) => i.id !== op.itemId);
      return {
        ok: true,
        plan: replaceDay(plan, { ...day, items }),
        removedItemId: op.itemId,
      };
    }

    case "moveItem": {
      const idx = day.items.findIndex((i) => i.id === op.itemId);
      if (idx === -1) return { ok: false, error: "That item no longer exists" };
      const target = op.direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= day.items.length) return { ok: true, plan };
      const items = [...day.items];
      [items[idx], items[target]] = [items[target], items[idx]];
      return { ok: true, plan: replaceDay(plan, { ...day, items }) };
    }
  }
}
