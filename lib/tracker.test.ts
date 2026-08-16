import { describe, expect, test } from "vitest";
import { latLonOf } from "./geo";
import type { DayPlan } from "./itinerary";
import { itemCheckKey } from "./tripShared";
import {
  citiesSoFar,
  nowNext,
  progress,
  railKmSoFar,
  slotForHour,
  trackerState,
} from "./tracker";

function day(n: number, destinationId: string, itemIds: string[]): DayPlan {
  return {
    day: n,
    destinationId,
    destinationName: destinationId.toUpperCase(),
    items: itemIds.map((id, i) => ({
      id,
      slot: (["morning", "afternoon", "evening"] as const)[i % 3],
      kind: "activity",
      title: `Item ${id}`,
    })),
  };
}

describe("trackerState", () => {
  test("no start date", () => {
    expect(trackerState(null, 5, "2026-11-02")).toEqual({
      phase: "no-date",
      dayIndex: null,
      daysToGo: null,
      totalDays: 5,
    });
  });

  test("before the trip counts days to go", () => {
    expect(trackerState("2026-11-05", 5, "2026-11-02")).toEqual({
      phase: "before",
      dayIndex: null,
      daysToGo: 3,
      totalDays: 5,
    });
  });

  test("day 1 on the start date, last day inclusive", () => {
    expect(trackerState("2026-11-02", 5, "2026-11-02").dayIndex).toBe(1);
    expect(trackerState("2026-11-02", 5, "2026-11-02").phase).toBe("during");
    expect(trackerState("2026-11-02", 5, "2026-11-06").dayIndex).toBe(5);
  });

  test("after the trip", () => {
    expect(trackerState("2026-11-02", 5, "2026-11-07").phase).toBe("after");
  });

  test("month boundary arithmetic", () => {
    expect(trackerState("2026-10-30", 5, "2026-11-01").dayIndex).toBe(3);
  });

  test("garbage start date degrades to no-date", () => {
    expect(trackerState("soon", 5, "2026-11-02").phase).toBe("no-date");
  });
});

describe("slotForHour", () => {
  test("cutoffs at 12:00 and 18:00", () => {
    expect(slotForHour(0)).toBe("morning");
    expect(slotForHour(11)).toBe("morning");
    expect(slotForHour(12)).toBe("afternoon");
    expect(slotForHour(17)).toBe("afternoon");
    expect(slotForHour(18)).toBe("evening");
    expect(slotForHour(23)).toBe("evening");
  });
});

describe("nowNext", () => {
  const d = day(1, "beijing", ["a", "b", "c"]); // slots: morning, afternoon, evening
  const checked = (...ids: string[]) => new Set(ids.map((id) => itemCheckKey(id)));

  test("first unchecked item at or before the current slot is current", () => {
    const r = nowNext(d, checked(), "afternoon");
    expect(r.current?.id).toBe("a");
    expect(r.next?.id).toBe("b");
  });

  test("checked items are skipped", () => {
    const r = nowNext(d, checked("a"), "afternoon");
    expect(r.current?.id).toBe("b");
    expect(r.next?.id).toBe("c");
  });

  test("morning slot leaves later items as next only", () => {
    const r = nowNext(d, checked("a"), "morning");
    expect(r.current).toBeNull();
    expect(r.next?.id).toBe("b");
  });

  test("everything done", () => {
    const r = nowNext(d, checked("a", "b", "c"), "evening");
    expect(r.current).toBeNull();
    expect(r.next).toBeNull();
  });
});

describe("progress", () => {
  test("counts checked items across days", () => {
    const days = [day(1, "beijing", ["a", "b"]), day(2, "xian", ["c"])];
    const keys = new Set([itemCheckKey("a"), itemCheckKey("c")]);
    expect(progress(days, keys)).toEqual({ done: 2, total: 3 });
  });
});

describe("citiesSoFar", () => {
  test("unique names in visit order up to the day index", () => {
    const days = [
      day(1, "beijing", []),
      day(2, "beijing", []),
      day(3, "xian", []),
      day(4, "chengdu", []),
    ];
    expect(citiesSoFar(days, 3)).toEqual(["BEIJING", "XIAN"]);
  });
});

describe("railKmSoFar", () => {
  const coords = (id: string) =>
    id === "beijing"
      ? { lat: 39.9, lon: 116.4 }
      : id === "xian"
        ? { lat: 34.26, lon: 108.94 }
        : null;

  test("sums transfers between distinct consecutive cities already reached", () => {
    const days = [day(1, "beijing", []), day(2, "xian", []), day(3, "unknown-city", [])];
    const km = railKmSoFar(days, 2, coords);
    expect(km).toBeGreaterThan(800);
    expect(km).toBeLessThan(1100);
  });

  test("unknown coordinates and unreached days contribute nothing", () => {
    const days = [day(1, "beijing", []), day(2, "xian", [])];
    expect(railKmSoFar(days, 1, coords)).toBe(0);
    expect(railKmSoFar(days, 2, () => null)).toBe(0);
  });
});

describe("railKmSoFar with off-map places", () => {
  test("a leg through a place with no coordinates adds no distance", () => {
    // Spec: a leg with a coordinate-less endpoint yields no estimate rather
    // than a fabricated one. The resolver returns null for such a place, and
    // the surrounding legs still count normally.
    const located: Record<string, { lat: number | null; lon: number | null }> = {
      beijing: { lat: 39.9, lon: 116.4 },
      "hand-typed": { lat: null, lon: null },
      xian: { lat: 34.26, lon: 108.94 },
    };
    const coords = (id: string) => latLonOf(located[id] ?? { lat: null, lon: null });

    const withGap = railKmSoFar(
      [day(1, "beijing", []), day(2, "hand-typed", []), day(3, "xian", [])],
      3,
      coords
    );
    const direct = railKmSoFar([day(1, "beijing", []), day(2, "xian", [])], 2, coords);

    // Both legs touching the off-map place drop out, leaving nothing.
    expect(withGap).toBe(0);
    // The same resolver still measures a leg between two located places.
    expect(direct).toBeGreaterThan(800);
  });
});
