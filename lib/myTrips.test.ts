import { describe, expect, it } from "vitest";
import {
  mergeTripLists,
  parseMyTrips,
  pickNextTrip,
  removeMyTrip,
  tripEndDate,
  tripPhase,
  upsertMyTrip,
  type MyTrip,
} from "./myTrips";

function trip(partial: Partial<MyTrip>): MyTrip {
  return {
    id: "t1",
    name: "Trip",
    startDate: null,
    days: 5,
    destinations: ["Beijing"],
    role: "member",
    savedAt: 0,
    ...partial,
  };
}

describe("parseMyTrips", () => {
  it("returns [] for null, junk, and non-arrays", () => {
    expect(parseMyTrips(null)).toEqual([]);
    expect(parseMyTrips("not json")).toEqual([]);
    expect(parseMyTrips('{"a":1}')).toEqual([]);
  });

  it("drops malformed entries, keeps valid ones", () => {
    const raw = JSON.stringify([trip({ id: "good" }), { id: 42 }, "junk"]);
    const parsed = parseMyTrips(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("good");
  });
});

describe("upsertMyTrip", () => {
  it("adds new trips to the front and caps the list at 20", () => {
    let list: MyTrip[] = [];
    for (let i = 0; i < 25; i += 1) {
      list = upsertMyTrip(list, trip({ id: `t${i}`, savedAt: undefined as never }), i);
    }
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe("t24");
  });

  it("refreshes an existing trip in place without duplicating", () => {
    const list = upsertMyTrip([trip({ id: "a", name: "Old" })], trip({ id: "a", name: "New" }), 5);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "New", savedAt: 5 });
  });

  it("never downgrades creator to member on revisit", () => {
    const created = upsertMyTrip([], trip({ id: "a", role: "creator" }), 1);
    const revisited = upsertMyTrip(created, trip({ id: "a", role: "member" }), 2);
    expect(revisited[0].role).toBe("creator");
  });
});

describe("tripPhase", () => {
  it("labels upcoming, ongoing, past and undated", () => {
    const t = { startDate: "2026-09-14", days: 3 };
    expect(tripPhase(t, "2026-09-10")).toEqual({ kind: "upcoming", daysUntil: 4 });
    expect(tripPhase(t, "2026-09-14")).toEqual({ kind: "ongoing", dayNumber: 1 });
    expect(tripPhase(t, "2026-09-16")).toEqual({ kind: "ongoing", dayNumber: 3 });
    expect(tripPhase(t, "2026-09-17")).toEqual({ kind: "past" });
    expect(tripPhase({ startDate: null, days: 3 }, "2026-09-14")).toEqual({ kind: "undated" });
  });
});

describe("pickNextTrip", () => {
  it("prefers an ongoing trip over a sooner upcoming one", () => {
    const list = [
      trip({ id: "up", startDate: "2026-09-15", days: 2 }),
      trip({ id: "now", startDate: "2026-09-13", days: 5 }),
    ];
    expect(pickNextTrip(list, "2026-09-14")?.id).toBe("now");
  });

  it("picks the soonest upcoming trip otherwise, ignoring past/undated", () => {
    const list = [
      trip({ id: "past", startDate: "2026-01-01", days: 2 }),
      trip({ id: "later", startDate: "2026-12-01", days: 2 }),
      trip({ id: "soon", startDate: "2026-09-20", days: 2 }),
      trip({ id: "nodate", startDate: null }),
    ];
    expect(pickNextTrip(list, "2026-09-14")?.id).toBe("soon");
  });

  it("returns null when nothing is ongoing or upcoming", () => {
    expect(pickNextTrip([trip({ startDate: "2026-01-01", days: 2 })], "2026-09-14")).toBeNull();
  });
});

describe("mergeTripLists", () => {
  it("unions distinct trips from both sides, newest first", () => {
    const merged = mergeTripLists(
      [trip({ id: "a", savedAt: 1 })],
      [trip({ id: "b", savedAt: 2 })]
    );
    expect(merged.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("resolves conflicts by newer savedAt", () => {
    const merged = mergeTripLists(
      [trip({ id: "a", name: "Old", savedAt: 1 })],
      [trip({ id: "a", name: "New", savedAt: 9 })]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("New");
  });

  it("keeps creator role even when the member-side entry is newer", () => {
    const merged = mergeTripLists(
      [trip({ id: "a", role: "creator", savedAt: 1 })],
      [trip({ id: "a", role: "member", savedAt: 9 })]
    );
    expect(merged[0].role).toBe("creator");
  });

  it("fills a missing memberName from the losing side", () => {
    const merged = mergeTripLists(
      [trip({ id: "a", memberName: "Darren", savedAt: 1 })],
      [trip({ id: "a", memberName: undefined, savedAt: 9 })]
    );
    expect(merged[0].memberName).toBe("Darren");
  });

  it("caps the merged list at 20", () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => trip({ id: `${prefix}${i}`, savedAt: i }));
    expect(mergeTripLists(many("a", 15), many("b", 15))).toHaveLength(20);
  });
});

describe("removeMyTrip / tripEndDate", () => {
  it("removes by id", () => {
    expect(removeMyTrip([trip({ id: "a" }), trip({ id: "b" })], "a").map((t) => t.id)).toEqual([
      "b",
    ]);
  });

  it("computes the last calendar day", () => {
    expect(tripEndDate({ startDate: "2026-09-14", days: 5 })).toBe("2026-09-18");
    expect(tripEndDate({ startDate: null, days: 5 })).toBeNull();
  });
});
