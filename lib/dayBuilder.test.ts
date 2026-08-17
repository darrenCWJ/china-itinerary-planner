import { describe, expect, it } from "vitest";
import {
  createDayBuilderState,
  dayBuilderReducer,
  deriveShelf,
  type DayBuilderAction,
  type DayBuilderState,
} from "./dayBuilder";
import type { DayPlan, ScheduledItem } from "./itinerary";
import { reflow } from "./timeline";
import type { TripPayload } from "./tripShared";
import type { Activity } from "./types";

/**
 * Tests for the day-builder reducer, ordered by the risk ranking in
 * docs/superpowers/specs/2026-08-18-day-builder-invariants.md — the things that
 * would corrupt a shared plan or lose a member's edit come first.
 */

const activity = (name: string, timeOfDay: Activity["timeOfDay"] = "morning"): Activity => ({
  name,
  interests: [],
  slots: 1,
  timeOfDay,
});

const item = (id: string, extra: Partial<ScheduledItem> = {}): ScheduledItem => ({
  id,
  slot: "morning",
  kind: "activity",
  title: id,
  ...extra,
});

const timed = (id: string, startMinutes: number, durationMinutes: number) =>
  item(id, { startMinutes, durationMinutes });

const day = (n: number, destinationId: string, items: ScheduledItem[]): DayPlan => ({
  day: n,
  destinationId,
  destinationName: destinationId,
  items,
});

const payloadOf = (version: number, days: DayPlan[]): TripPayload =>
  ({ version, data: { plan: { days, tips: [] } } }) as unknown as TripPayload;

const run = (state: DayBuilderState, ...actions: DayBuilderAction[]) =>
  actions.reduce(dayBuilderReducer, state);

/** A state with two Beijing days, the second holding one timed block. */
function seeded(): DayBuilderState {
  const base = createDayBuilderState({
    beijing: [activity("Great Wall"), activity("Summer Palace"), activity("Night market", "evening")],
    xian: [activity("Terracotta Army")],
  });
  return run(base, {
    type: "serverPayload",
    payload: payloadOf(10, [
      day(1, "beijing", [item("a", { title: "Great Wall" })]),
      day(2, "beijing", [timed("b", 540, 60), item("c"), timed("d", 660, 60)]),
    ]),
  });
}

const opsOf = (state: DayBuilderState) => state.pendingOps.map((p) => p.op);

describe("emitted ops — never write over a block the user did not touch", () => {
  it("emits exactly one op naming only the adjusted item", () => {
    // reflow normalises every overlap it finds, including ones already stored, so
    // diffing its output into ops would POST over blocks another member owns.
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "b",
      deltaMinutes: 60,
      opId: "op1",
    });

    expect(opsOf(state)).toEqual([
      { op: "setTiming", day: 2, itemId: "b", startMinutes: 540, durationMinutes: 120 },
    ]);
  });

  it("leaves the pushed successor's stored start untouched", () => {
    // +120 rather than +60: at +60 the grown block ends exactly where d starts,
    // and touching is not overlapping, so nothing would be pushed and the test
    // would prove nothing.
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "b",
      deltaMinutes: 120,
      opId: "op1",
    });

    const items = state.days[1].items;
    // Stored: d still starts where the server has it.
    expect(items[2].startMinutes).toBe(660);
    // Displayed: reflow reports the push, as a read-time view only.
    const view = reflow(items);
    expect(view[2].startMinutes).toBe(720);
    expect(view[2].pushedBy).toBe("b");
  });

  it("emits nothing when a payload merely contains overlapping blocks", () => {
    // Opening a trip someone else over-packed must not trigger writes.
    const state = run(createDayBuilderState(), {
      type: "serverPayload",
      payload: payloadOf(1, [day(1, "beijing", [timed("a", 540, 180), timed("b", 600, 60)])]),
    });

    expect(state.pendingOps).toEqual([]);
  });
});

describe("emitted ops — shape the server will accept", () => {
  it("adds with one addItem op and never invents an item id", () => {
    // The brief says addItem then setTiming; ids are minted server-side and the
    // route returns none, so the second op would have nothing to name.
    const state = seeded();
    const wall = state.shelf.find((row) => row.title === "Summer Palace");
    const next = run(state, { type: "addFromShelf", key: wall!.key, opId: "op1" });

    expect(opsOf(next)).toEqual([
      { op: "addItem", day: 1, title: "Summer Palace", slot: "morning" },
    ]);
    expect(next.pendingOps.every((p) => !("itemId" in p.op))).toBe(true);
  });

  it("resends the existing start alongside a changed duration", () => {
    // Both keys are required; omitting one fails validation with an error the UI
    // cannot explain, and the tap would appear to do nothing.
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "b",
      deltaMinutes: 15,
      opId: "op1",
    });

    const op = opsOf(state)[0];
    expect(op).toMatchObject({ startMinutes: 540, durationMinutes: 75 });
    expect(Object.keys(op).sort()).toEqual(
      ["day", "durationMinutes", "itemId", "op", "startMinutes"].sort()
    );
  });

  it("never emits a half block", () => {
    const cleared = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "clearBlock",
      itemId: "b",
      opId: "op1",
    });

    expect(opsOf(cleared)).toEqual([
      { op: "setTiming", day: 2, itemId: "b", startMinutes: null, durationMinutes: null },
    ]);
  });

  it("keeps every emitted op inside the write boundary", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "setBlock",
      itemId: "c",
      startMinutes: 9999,
      durationMinutes: 99999,
      opId: "op1",
    });

    expect(opsOf(state)[0]).toMatchObject({ startMinutes: 1439, durationMinutes: 1440 });
  });

  it("floors a shrink at the minimum duration", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "b",
      deltaMinutes: -600,
      opId: "op1",
    });

    expect(opsOf(state)[0]).toMatchObject({ durationMinutes: 15 });
  });

  it("refuses to adjust an untimed item rather than fabricating a block", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "c",
      deltaMinutes: 15,
      opId: "op1",
    });

    expect(state.pendingOps).toEqual([]);
    expect(state.days[1].items[1].startMinutes).toBeUndefined();
  });

  it("emits nothing for a move already at the edge", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "moveBlock",
      itemId: "b",
      direction: "up",
      opId: "op1",
    });

    expect(state.pendingOps).toEqual([]);
  });

  it("swaps adjacent array positions for a move, without sorting", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "moveBlock",
      itemId: "d",
      direction: "up",
      opId: "op1",
    });

    // Array order is the canonical order every other consumer reads.
    expect(state.days[1].items.map((i) => i.id)).toEqual(["b", "d", "c"]);
    expect(opsOf(state)).toEqual([
      { op: "moveItem", day: 2, itemId: "d", direction: "up" },
    ]);
  });
});

describe("poll gate", () => {
  it("withholds a payload during an interaction, leaving state untouched", () => {
    const before = run(seeded(), { type: "beginInteraction" });
    const after = dayBuilderReducer(before, {
      type: "serverPayload",
      payload: payloadOf(11, [day(1, "beijing", [])]),
    });

    expect(after.days).toBe(before.days);
    expect(after.targetDay).toBe(before.targetDay);
    expect(after.shelf).toBe(before.shelf);
    expect(after.baselineVersion).toBe(10);
    expect(after.buffered?.payload.version).toBe(11);
  });

  it("buffers only the newest payload", () => {
    const state = run(
      seeded(),
      { type: "beginInteraction" },
      { type: "serverPayload", payload: payloadOf(11, []) },
      { type: "serverPayload", payload: payloadOf(13, []) },
      { type: "serverPayload", payload: payloadOf(12, []) }
    );

    expect(state.buffered?.payload.version).toBe(13);
  });

  it("applies the buffered payload on release", () => {
    const state = run(
      seeded(),
      { type: "beginInteraction" },
      { type: "serverPayload", payload: payloadOf(11, [day(1, "xian", [item("z")])]) },
      { type: "endInteraction" }
    );

    expect(state.interaction).toBe(false);
    expect(state.buffered).toBeNull();
    expect(state.baselineVersion).toBe(11);
    expect(state.days[0].destinationId).toBe("xian");
  });

  it("drops a buffered payload that is not strictly newer", () => {
    // `version` is a whole-trip counter bumped by any write — a packing tick
    // included — so an older poll must never be allowed to land.
    const state = run(
      seeded(),
      { type: "beginInteraction" },
      { type: "serverPayload", payload: payloadOf(9, [day(1, "xian", [])]) },
      { type: "endInteraction" }
    );

    expect(state.baselineVersion).toBe(10);
    expect(state.days[0].destinationId).toBe("beijing");
  });

  it("applies a forced buffered payload even at an equal version", () => {
    // force marks an identity change or a post-error reconciliation, which the
    // version comparison cannot see.
    const state = run(
      seeded(),
      { type: "beginInteraction" },
      { type: "serverPayload", payload: payloadOf(10, [day(1, "xian", [])]), force: true },
      { type: "endInteraction" }
    );

    expect(state.days[0].destinationId).toBe("xian");
  });

  it("lets a forced payload displace a newer unforced buffered one", () => {
    const state = run(
      seeded(),
      { type: "beginInteraction" },
      { type: "serverPayload", payload: payloadOf(20, [day(1, "beijing", [])]) },
      { type: "serverPayload", payload: payloadOf(11, [day(1, "xian", [])]), force: true },
      { type: "endInteraction" }
    );

    expect(state.days[0].destinationId).toBe("xian");
  });

  it("does not gate the very first payload", () => {
    // No baseline means no local state worth protecting; gating would leave the
    // builder empty behind an interaction that started early.
    const state = run(createDayBuilderState(), { type: "beginInteraction" }, {
      type: "serverPayload",
      payload: payloadOf(1, [day(1, "beijing", [])]),
    });

    expect(state.days).toHaveLength(1);
    expect(state.buffered).toBeNull();
  });

  it("releases the gate after two begins and one end", () => {
    // A nesting counter would wedge the gate shut on a dropped end and freeze the
    // trip for that member.
    const state = run(
      seeded(),
      { type: "beginInteraction" },
      { type: "beginInteraction" },
      { type: "serverPayload", payload: payloadOf(11, [day(1, "xian", [])]) },
      { type: "endInteraction" }
    );

    expect(state.interaction).toBe(false);
    expect(state.days[0].destinationId).toBe("xian");
  });

  it("treats endInteraction from a clean state as a no-op", () => {
    const before = seeded();

    expect(dayBuilderReducer(before, { type: "endInteraction" })).toBe(before);
  });
});

describe("target day and shelf", () => {
  it("clamps the target day when the plan shrinks", () => {
    // PATCH /api/trips/:id rebuilds the whole plan and can cut 7 days to 3; a
    // stale target would make every subsequent add POST a day that is gone.
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "serverPayload",
      payload: payloadOf(11, [day(1, "xian", [])]),
    });

    expect(state.targetDay).toBe(1);
  });

  it("re-derives the shelf from the new target's destination", () => {
    const state = run(seeded(), { type: "serverPayload", payload: payloadOf(11, [
      day(1, "xian", []),
    ]) });

    expect(state.shelf.map((row) => row.title)).toEqual(["Terracotta Army", ""]);
  });

  it("never emits an op for a day outside the plan", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 99 });

    expect(state.targetDay).toBe(2);
  });

  it("hides an activity already scheduled anywhere in that destination", () => {
    // Great Wall sits on day 1; day 2 is the same destination, so offering it
    // again would invite a duplicate.
    const state = run(seeded(), { type: "setTargetDay", day: 2 });

    expect(state.shelf.map((row) => row.title)).not.toContain("Great Wall");
  });

  it("hides a row while its add is in flight", () => {
    const state = seeded();
    const row = state.shelf.find((r) => r.title === "Summer Palace")!;
    const next = run(state, { type: "addFromShelf", key: row.key, opId: "op1" });

    expect(next.shelf.map((r) => r.title)).not.toContain("Summer Palace");
  });

  it("restores the row when its add fails", () => {
    const state = seeded();
    const row = state.shelf.find((r) => r.title === "Summer Palace")!;
    const next = run(
      state,
      { type: "addFromShelf", key: row.key, opId: "op1" },
      { type: "opFailed", opId: "op1", message: "Nope" }
    );

    expect(next.shelf.map((r) => r.title)).toContain("Summer Palace");
    expect(next.error).toBe("Nope");
  });

  it("derives a real slot for a day-long or unconstrained activity", () => {
    // 'day' and 'any' are common in the curated data, addItem demands a real
    // slot, and §3.2.4 forbids asking.
    const shelf = deriveShelf({
      days: [day(1, "beijing", [])],
      targetDay: 1,
      customDraft: "",
      pendingOps: [],
      activitiesByDestination: { beijing: [activity("Hutong walk", "day"), activity("Whatever", "any")] },
    });

    expect(shelf.slice(0, 2).map((row) => row.slot)).toEqual(["morning", "morning"]);
  });

  it("keeps the custom row terminal and clears the draft after adding", () => {
    const state = run(seeded(), { type: "setCustomDraft", text: "  Grandma's house  " });
    expect(state.shelf[state.shelf.length - 1].isCustom).toBe(true);

    const added = run(state, { type: "addFromShelf", key: "custom", opId: "op1" });

    expect(opsOf(added)).toEqual([
      { op: "addItem", day: 1, title: "Grandma's house", slot: "morning" },
    ]);
    expect(added.customDraft).toBe("");
  });

  it("ignores an add from an empty custom row", () => {
    const state = run(seeded(), { type: "addFromShelf", key: "custom", opId: "op1" });

    expect(state.pendingOps).toEqual([]);
  });
});

describe("injected activity map", () => {
  it("adopts a destination that entered the plan after mount", () => {
    // The map is a snapshot at `useReducer` init. PATCH /api/trips/:id replaces
    // the whole plan, so a day can arrive for a destination the map has never
    // seen — and a frozen map leaves that day's shelf empty forever, which the UI
    // reads as "everything for this destination is already on the plan".
    const mounted = { beijing: [activity("Great Wall")] };
    const state = run(
      createDayBuilderState(mounted),
      {
        type: "serverPayload",
        payload: payloadOf(11, [day(1, "beijing", []), day(2, "xian", [])]),
      },
      { type: "setTargetDay", day: 2 }
    );
    // Only the custom row: xian is in the plan but not in the mount-time map.
    expect(state.shelf.map((row) => row.title)).toEqual([""]);

    const after = dayBuilderReducer(state, {
      type: "setActivities",
      activitiesByDestination: { ...mounted, xian: [activity("Terracotta Army")] },
    });

    expect(after.shelf.map((row) => row.title)).toEqual(["Terracotta Army", ""]);
    expect(after.activitiesByDestination.xian).toHaveLength(1);
  });

  it("still hides activities already scheduled after the map is replaced", () => {
    // Replacing the map re-derives the shelf; it must not bypass the
    // destination-scoped unscheduled rule and re-offer a placed activity.
    const after = dayBuilderReducer(seeded(), {
      type: "setActivities",
      activitiesByDestination: {
        beijing: [activity("Great Wall"), activity("Summer Palace")],
      },
    });

    expect(after.shelf.map((row) => row.title)).toEqual(["Summer Palace", ""]);
  });

  it("treats an equivalent map as a no-op, so an unmemoised prop cannot spin", () => {
    // The dispatch comes from an effect keyed on the prop, and the caller
    // recomputes the map on every `plan.days` change — most of which do not
    // change a single activity.
    const before = seeded();
    const rebuilt = {
      beijing: before.activitiesByDestination.beijing,
      xian: [...before.activitiesByDestination.xian],
    };

    expect(
      dayBuilderReducer(before, { type: "setActivities", activitiesByDestination: rebuilt })
    ).toBe(before);
  });

  it("adopts a new map mid-interaction without disturbing the gate", () => {
    // Not gated: the map is not member state and cannot change the target day's
    // shelf, so there is nothing for the gate to protect here.
    const before = run(
      seeded(),
      { type: "setTargetDay", day: 2 },
      { type: "adjustTiming", itemId: "b", deltaMinutes: 15, opId: "op1" },
      { type: "beginInteraction" }
    );

    const after = dayBuilderReducer(before, {
      type: "setActivities",
      activitiesByDestination: {
        ...before.activitiesByDestination,
        chengdu: [activity("Panda base")],
      },
    });

    expect(after.days).toBe(before.days);
    expect(after.pendingOps).toBe(before.pendingOps);
    expect(after.interaction).toBe(true);
    expect(after.buffered).toBeNull();
    // The gated target day is Beijing's, so its shelf is unchanged.
    expect(after.shelf.map((row) => row.title)).toEqual(before.shelf.map((row) => row.title));
  });
});

describe("pending ops", () => {
  it("acknowledges by identity, not position", () => {
    const state = run(
      seeded(),
      { type: "setTargetDay", day: 2 },
      { type: "adjustTiming", itemId: "b", deltaMinutes: 15, opId: "first" },
      { type: "adjustTiming", itemId: "d", deltaMinutes: 15, opId: "second" },
      { type: "opSettled", opId: "first" }
    );

    expect(state.pendingOps.map((p) => p.id)).toEqual(["second"]);
  });

  it("drops a pending op whose item the server no longer has", () => {
    // Someone else deleted the item. Retrying would resurrect it; the server wins.
    const state = run(
      seeded(),
      { type: "setTargetDay", day: 2 },
      { type: "adjustTiming", itemId: "b", deltaMinutes: 15, opId: "op1" },
      { type: "serverPayload", payload: payloadOf(11, [day(1, "beijing", []), day(2, "beijing", [])]) }
    );

    expect(state.pendingOps).toEqual([]);
  });

  it("keeps a pending add across a payload, since it has no item id yet", () => {
    const state = seeded();
    const row = state.shelf.find((r) => r.title === "Summer Palace")!;
    const next = run(
      state,
      { type: "addFromShelf", key: row.key, opId: "op1" },
      { type: "serverPayload", payload: payloadOf(11, [day(1, "beijing", [])]) }
    );

    expect(next.pendingOps.map((p) => p.id)).toEqual(["op1"]);
  });

  it("ignores an acknowledgement for an unknown op", () => {
    const before = seeded();

    expect(dayBuilderReducer(before, { type: "opFailed", opId: "ghost", message: "x" })).toBe(before);
  });
});

describe("C3 — no layout knowledge", () => {
  it("routes an add solely by the explicit target day", () => {
    // There is no notion of a visible, scrolled or expanded day anywhere in the
    // state or the action union — which is what makes tap-to-add testable at all.
    const state = run(seeded(), { type: "setTargetDay", day: 2 });
    const row = state.shelf.find((r) => r.title === "Summer Palace")!;

    expect(opsOf(run(state, { type: "addFromShelf", key: row.key, opId: "op1" }))[0]).toMatchObject({
      day: 2,
    });
  });

  it("never rewrites the free-text time field when setting a block", () => {
    // `time` is unvalidated free text and a separate field from startMinutes.
    const base = run(createDayBuilderState(), {
      type: "serverPayload",
      payload: payloadOf(1, [day(1, "beijing", [item("a", { time: "19:00", note: "keep me" })])]),
    });

    const state = run(base, {
      type: "setBlock",
      itemId: "a",
      startMinutes: 600,
      durationMinutes: 60,
      opId: "op1",
    });

    const stored = state.days[0].items[0];
    expect(stored.time).toBe("19:00");
    expect(stored.note).toBe("keep me");
    expect(opsOf(state)[0]).not.toHaveProperty("time");
  });
});

describe("state identity", () => {
  it("keeps the pendingOps array identity when a payload drops nothing", () => {
    // The hook's send effect keys on this array; a fresh one every poll would
    // re-run it four times a minute for nothing.
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "b",
      deltaMinutes: 15,
      opId: "op1",
    });

    const after = dayBuilderReducer(state, {
      type: "serverPayload",
      payload: payloadOf(11, state.days),
    });

    expect(after.pendingOps).toBe(state.pendingOps);
  });

  it("returns a fresh pendingOps array when it does drop one", () => {
    const state = run(seeded(), { type: "setTargetDay", day: 2 }, {
      type: "adjustTiming",
      itemId: "b",
      deltaMinutes: 15,
      opId: "op1",
    });

    const after = dayBuilderReducer(state, {
      type: "serverPayload",
      payload: payloadOf(11, [day(1, "beijing", []), day(2, "beijing", [])]),
    });

    expect(after.pendingOps).not.toBe(state.pendingOps);
    expect(after.pendingOps).toEqual([]);
  });
});
