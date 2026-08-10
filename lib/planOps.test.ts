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
