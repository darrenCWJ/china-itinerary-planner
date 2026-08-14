import { describe, expect, it } from "vitest";
import type { TripPayload } from "../tripShared";
import { planIdMigration } from "./migrate";

/** Legacy payload: plan items with no ids, one index-based schedule check. */
function legacyPayload(): TripPayload {
  return {
    id: "t1",
    version: 3,
    updatedAt: 0,
    members: [{ name: "Bob", joinedAt: 0 }],
    checks: [
      { key: "day:1:1", by: "Bob" },
      { key: "pack:Documents:Passport", by: "Bob" },
      { key: "day:9:0", by: "Bob" },
    ],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    currencySettings: { home: null, rates: {} },
    data: {
      tripName: "Legacy",
      startDate: null,
      input: { destinationIds: ["beijing"], days: 1, season: "autumn", adults: 1, kids: 0, interests: [] },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              { id: "", slot: "morning", kind: "arrival", title: "Arrive" },
              { id: "", slot: "afternoon", kind: "activity", title: "Great Wall" },
            ],
          },
        ],
        tips: [],
      },
      packing: [],
      foods: [],
      destinationNames: ["Beijing"],
    },
  };
}

describe("planIdMigration", () => {
  it("assigns deterministic ids so concurrent migrations converge", () => {
    const a = planIdMigration(legacyPayload());
    const b = planIdMigration(legacyPayload());
    if (!a || !b) throw new Error("expected migrations");
    expect(a.data.plan.days[0].items.map((i) => i.id)).toEqual(
      b.data.plan.days[0].items.map((i) => i.id)
    );
    expect(a.data.plan.days[0].items.every((i) => i.id.length > 0)).toBe(true);
  });

  it("remaps index-based schedule checks and ignores packing/orphan keys", () => {
    const m = planIdMigration(legacyPayload());
    if (!m) throw new Error("expected a migration");
    expect(m.remaps).toHaveLength(1);
    expect(m.remaps[0]).toMatchObject({
      oldKey: "day:1:1",
      newKey: `item:${m.data.plan.days[0].items[1].id}`,
      by: "Bob",
    });
  });

  it("returns null when every item already has an id", () => {
    const payload = legacyPayload();
    payload.data.plan.days[0].items.forEach((i, idx) => {
      i.id = `existing-${idx}`;
    });
    expect(planIdMigration(payload)).toBeNull();
  });
});
