import { describe, expect, it } from "vitest";
import type { TripPlan } from "./itinerary";
import { applyPlanOp, type PlanOpContext } from "./planOps";

function plan(): TripPlan {
  return {
    days: [
      {
        day: 1,
        destinationId: "beijing",
        destinationName: "Beijing",
        items: [
          { id: "a", slot: "morning", kind: "arrival", title: "Arrive" },
          { id: "b", slot: "afternoon", kind: "activity", title: "Forbidden City" },
          { id: "c", slot: "evening", kind: "free", title: "Dinner" },
        ],
      },
      {
        day: 2,
        destinationId: "shanghai",
        destinationName: "Shanghai",
        items: [{ id: "d", slot: "morning", kind: "travel", title: "Train" }],
      },
    ],
    tips: ["tip"],
  };
}

let n = 0;
const ctx: PlanOpContext = {
  newId: () => `new-${(n += 1)}`,
  resolveDestinationName: (id) => (id === "xian" ? "Xi'an" : null),
};

describe("addItem", () => {
  it("appends a custom item to the day", () => {
    const before = plan();
    const res = applyPlanOp(before, { op: "addItem", day: 1, title: "Massage", slot: "evening", time: "19:00", note: "hotel spa" }, ctx);
    if (!res.ok) throw new Error(res.error);
    const items = res.plan.days[0].items;
    expect(items).toHaveLength(4);
    expect(items[3]).toMatchObject({ kind: "custom", title: "Massage", slot: "evening", time: "19:00", note: "hotel spa" });
    expect(items[3].id).toBeTruthy();
    // immutability: input untouched
    expect(before.days[0].items).toHaveLength(3);
  });

  it("rejects an unknown day", () => {
    const res = applyPlanOp(plan(), { op: "addItem", day: 9, title: "X", slot: "morning" }, ctx);
    expect(res.ok).toBe(false);
  });
});

describe("updateItem", () => {
  it("patches title, slot, time and note", () => {
    const res = applyPlanOp(
      plan(),
      { op: "updateItem", day: 1, itemId: "b", title: "Temple of Heaven", slot: "morning", time: "09:00", note: "east gate" },
      ctx
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[1]).toMatchObject({
      id: "b",
      title: "Temple of Heaven",
      slot: "morning",
      time: "09:00",
      note: "east gate",
      kind: "activity",
    });
  });

  it("clears note/time when passed null", () => {
    const withExtras = applyPlanOp(
      plan(),
      { op: "updateItem", day: 1, itemId: "b", time: "09:00", note: "x" },
      ctx
    );
    if (!withExtras.ok) throw new Error(withExtras.error);
    const res = applyPlanOp(withExtras.plan, { op: "updateItem", day: 1, itemId: "b", time: null, note: null }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[1].time).toBeUndefined();
    expect(res.plan.days[0].items[1].note).toBeUndefined();
  });

  it("drops fullDay when the slot changes", () => {
    const p = plan();
    p.days[0].items[1].fullDay = true;
    const res = applyPlanOp(p, { op: "updateItem", day: 1, itemId: "b", slot: "evening" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[1].fullDay).toBeUndefined();
  });

  it("errors when the item no longer exists", () => {
    const res = applyPlanOp(plan(), { op: "updateItem", day: 1, itemId: "zz", title: "X" }, ctx);
    expect(res.ok).toBe(false);
  });
});

describe("setTiming", () => {
  it("sets both fields on the target item and leaves the rest of the plan alone", () => {
    const before = plan();
    const res = applyPlanOp(
      before,
      { op: "setTiming", day: 1, itemId: "b", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[1]).toMatchObject({ id: "b", startMinutes: 540, durationMinutes: 90 });
    // Neighbours keep whatever timing they had — which is none.
    expect(res.plan.days[0].items[0].startMinutes).toBeUndefined();
    expect(res.plan.days[1].items[0].startMinutes).toBeUndefined();
    // Immutability: neither the input plan nor the input item was touched.
    expect(before.days[0].items[1].startMinutes).toBeUndefined();
    expect(res.plan).not.toBe(before);
    expect(res.plan.days[0]).not.toBe(before.days[0]);
  });

  it("clears timing back to untimed when passed nulls", () => {
    const timed = applyPlanOp(
      plan(),
      { op: "setTiming", day: 1, itemId: "b", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    if (!timed.ok) throw new Error(timed.error);
    const res = applyPlanOp(
      timed.plan,
      { op: "setTiming", day: 1, itemId: "b", startMinutes: null, durationMinutes: null },
      ctx
    );
    if (!res.ok) throw new Error(res.error);
    const item = res.plan.days[0].items[1];
    expect(item.startMinutes).toBeUndefined();
    expect(item.durationMinutes).toBeUndefined();
    // Cleared means untimed in the persisted sense: the keys are gone, so the
    // item is indistinguishable from one saved before timing existed.
    expect(JSON.parse(JSON.stringify(item))).not.toHaveProperty("startMinutes");
  });

  it("errors when the item no longer exists", () => {
    const res = applyPlanOp(
      plan(),
      { op: "setTiming", day: 1, itemId: "zz", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    expect(res).toEqual({ ok: false, error: "That item no longer exists" });
  });

  it("errors when the day does not exist", () => {
    const res = applyPlanOp(
      plan(),
      { op: "setTiming", day: 9, itemId: "b", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    expect(res).toEqual({ ok: false, error: "Day not found" });
  });
});

describe("timing is never fabricated", () => {
  it("addItem lands the timing it was given", () => {
    const res = applyPlanOp(
      plan(),
      { op: "addItem", day: 1, title: "Lunch", slot: "afternoon", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[3]).toMatchObject({ startMinutes: 540, durationMinutes: 90 });
  });

  it("addItem without timing creates an untimed item — no invented start", () => {
    const res = applyPlanOp(plan(), { op: "addItem", day: 1, title: "Lunch", slot: "afternoon" }, ctx);
    if (!res.ok) throw new Error(res.error);
    const item = res.plan.days[0].items[3];
    expect(item.startMinutes).toBeUndefined();
    expect(item.durationMinutes).toBeUndefined();
    expect(JSON.parse(JSON.stringify(item))).not.toHaveProperty("startMinutes");
  });

  it("editing a legacy untimed item leaves it untimed", () => {
    // Every item in `plan()` is legacy-shaped: no timing keys at all. Giving one
    // a start here would be a silent data change to a trip members already own.
    const res = applyPlanOp(plan(), { op: "updateItem", day: 1, itemId: "b", title: "Renamed" }, ctx);
    if (!res.ok) throw new Error(res.error);
    const item = res.plan.days[0].items[1];
    expect(item.title).toBe("Renamed");
    expect(item.startMinutes).toBeUndefined();
    expect(item.durationMinutes).toBeUndefined();
  });

  it("updateItem preserves timing it was not asked to change", () => {
    const timed = applyPlanOp(
      plan(),
      { op: "setTiming", day: 1, itemId: "b", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    if (!timed.ok) throw new Error(timed.error);
    const res = applyPlanOp(
      timed.plan,
      { op: "updateItem", day: 1, itemId: "b", title: "Renamed", slot: "evening" },
      ctx
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[1]).toMatchObject({ startMinutes: 540, durationMinutes: 90 });
  });

  it("updateItem sets timing when asked and clears it on null", () => {
    const set = applyPlanOp(
      plan(),
      { op: "updateItem", day: 1, itemId: "b", startMinutes: 600, durationMinutes: 45 },
      ctx
    );
    if (!set.ok) throw new Error(set.error);
    expect(set.plan.days[0].items[1]).toMatchObject({ startMinutes: 600, durationMinutes: 45 });

    const cleared = applyPlanOp(
      set.plan,
      { op: "updateItem", day: 1, itemId: "b", startMinutes: null, durationMinutes: null },
      ctx
    );
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.plan.days[0].items[1].startMinutes).toBeUndefined();
    expect(cleared.plan.days[0].items[1].durationMinutes).toBeUndefined();
  });

  it("moveItem carries timing with the item instead of re-deriving it", () => {
    const timed = applyPlanOp(
      plan(),
      { op: "setTiming", day: 1, itemId: "b", startMinutes: 540, durationMinutes: 90 },
      ctx
    );
    if (!timed.ok) throw new Error(timed.error);
    const res = applyPlanOp(timed.plan, { op: "moveItem", day: 1, itemId: "b", direction: "up" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items[0]).toMatchObject({ id: "b", startMinutes: 540, durationMinutes: 90 });
    // The item it swapped past stays untimed — a move is not a reflow.
    expect(res.plan.days[0].items[1].startMinutes).toBeUndefined();
  });
});

describe("removeItem", () => {
  it("removes the item and reports its id", () => {
    const res = applyPlanOp(plan(), { op: "removeItem", day: 1, itemId: "b" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(res.removedItemId).toBe("b");
  });

  it("is a no-op when the item is already gone", () => {
    const res = applyPlanOp(plan(), { op: "removeItem", day: 1, itemId: "zz" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items).toHaveLength(3);
    expect(res.removedItemId).toBeUndefined();
  });
});

describe("moveItem", () => {
  it("swaps with the previous item on up", () => {
    const res = applyPlanOp(plan(), { op: "moveItem", day: 1, itemId: "b", direction: "up" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("swaps with the next item on down", () => {
    const res = applyPlanOp(plan(), { op: "moveItem", day: 1, itemId: "b", direction: "down" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the boundary", () => {
    const res = applyPlanOp(plan(), { op: "moveItem", day: 1, itemId: "a", direction: "up" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("addDay", () => {
  it("appends a day copying the last day's destination by default", () => {
    const res = applyPlanOp(plan(), { op: "addDay" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days).toHaveLength(3);
    expect(res.plan.days[2]).toMatchObject({
      day: 3,
      destinationId: "shanghai",
      destinationName: "Shanghai",
      items: [],
    });
  });

  it("uses the requested destination when resolvable", () => {
    const res = applyPlanOp(plan(), { op: "addDay", destinationId: "xian" }, ctx);
    if (!res.ok) throw new Error(res.error);
    expect(res.plan.days[2]).toMatchObject({ destinationId: "xian", destinationName: "Xi'an" });
  });

  it("errors on an unknown destination", () => {
    const res = applyPlanOp(plan(), { op: "addDay", destinationId: "nowhere" }, ctx);
    expect(res.ok).toBe(false);
  });

  it("errors when the plan is empty and no destination given", () => {
    const res = applyPlanOp({ days: [], tips: [] }, { op: "addDay" }, ctx);
    expect(res.ok).toBe(false);
  });
});
