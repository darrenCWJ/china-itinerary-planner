import { describe, expect, test } from "vitest";
import { buildBriefing } from "./briefing";
import type { TripPayload } from "./tripShared";

function payload(overrides: Partial<TripPayload> = {}): TripPayload {
  return {
    id: "abc123",
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "Fujian run",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["beijing", "chengdu"],
        days: 3,
        season: "winter",
        adults: 4,
        kids: 3,
        interests: ["food", "history"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              { id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK" },
              {
                id: "i2",
                slot: "afternoon",
                kind: "activity",
                title: "Forbidden City",
                interests: ["history"],
                note: "Book ahead",
              },
            ],
          },
          {
            day: 2,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              {
                id: "i3",
                slot: "morning",
                kind: "activity",
                title: "Hutong food walk",
                interests: ["food", "history"],
              },
            ],
          },
          {
            day: 3,
            destinationId: "chengdu",
            destinationName: "Chengdu",
            items: [{ id: "i4", slot: "morning", kind: "travel", title: "Rail to Chengdu" }],
          },
        ],
        tips: ["Set up Alipay before flying."],
      },
      packing: [],
      foods: [],
      destinationNames: ["Beijing", "Chengdu"],
    },
    members: [{ name: "Ada", joinedAt: 1 }],
    checks: [{ key: "item:i1", by: "Ada" }],
    tickets: [],
    ...overrides,
  };
}

const FULL = { redacted: false, includeBookings: true } as const;

describe("buildBriefing — overview", () => {
  test("titles the briefing and summarises days, cities and season", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.title).toBe("Fujian run");
    expect(b.subtitle).toBe("3 days · 2 cities · winter");
  });

  test("counts days from the plan, not the original input", () => {
    const p = payload();
    p.data.input.days = 99;
    expect(buildBriefing(p, FULL).subtitle).toBe("3 days · 2 cities · winter");
  });

  test("derives a date range from the start date", () => {
    expect(buildBriefing(payload(), FULL).dateRange).toEqual({
      start: "2026-12-24",
      end: "2026-12-26",
    });
  });

  test("has no date range when the trip has no start date", () => {
    const p = payload();
    p.data.startDate = null;
    const b = buildBriefing(p, FULL);
    expect(b.dateRange).toBeNull();
    expect(b.days.every((d) => d.date === null)).toBe(true);
  });

  test("groups cities in visit order with their day numbers", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.cities).toEqual([
      { id: "beijing", name: "Beijing", chineseName: "北京", days: [1, 2] },
      { id: "chengdu", name: "Chengdu", chineseName: "成都", days: [3] },
    ]);
  });

  test("leaves chineseName null for cities outside the curated set", () => {
    const p = payload();
    p.data.plan.days[2].destinationId = "Q1234";
    p.data.plan.days[2].destinationName = "Quanzhou";
    expect(buildBriefing(p, FULL).cities[1]).toEqual({
      id: "Q1234",
      name: "Quanzhou",
      chineseName: null,
      days: [3],
    });
  });

  test("carries the party and each day's items", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.party).toEqual({ adults: 4, kids: 3 });
    expect(b.days[0]).toEqual({
      day: 1,
      date: "2026-12-24",
      destinationName: "Beijing",
      items: [
        { id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK", time: null, note: null },
        {
          id: "i2",
          slot: "afternoon",
          kind: "activity",
          title: "Forbidden City",
          time: null,
          note: "Book ahead",
        },
      ],
    });
  });

  test("does not mutate the payload it is given", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    buildBriefing(p, FULL);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
