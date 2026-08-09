import { describe, expect, test } from "vitest";
import { DESTINATIONS, getDestination } from "./data";
import { allocateDays, buildItinerary, type TripInput } from "./itinerary";

function input(overrides: Partial<TripInput> = {}): TripInput {
  return {
    destinationIds: ["beijing"],
    days: 4,
    season: "autumn",
    adults: 2,
    kids: 0,
    interests: ["history", "food"],
    ...overrides,
  };
}

describe("allocateDays", () => {
  test("sums to the total and gives each destination at least one day", () => {
    const dests = [getDestination("beijing")!, getDestination("suzhou")!, getDestination("yunnan")!];
    const alloc = allocateDays(dests, 8);
    expect(alloc).toHaveLength(3);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(8);
    alloc.forEach((d) => expect(d).toBeGreaterThanOrEqual(1));
  });

  test("gives longer stays to destinations with higher suggested days", () => {
    const dests = [getDestination("yunnan")!, getDestination("suzhou")!];
    const [yunnan, suzhou] = allocateDays(dests, 7);
    expect(yunnan).toBeGreaterThan(suzhou);
  });
});

describe("buildItinerary", () => {
  test("produces exactly the requested number of days", () => {
    const plan = buildItinerary(input({ days: 5 }), DESTINATIONS);
    expect(plan.days).toHaveLength(5);
    expect(plan.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5]);
  });

  test("starts with arrival and ends with departure", () => {
    const plan = buildItinerary(input({ days: 3 }), DESTINATIONS);
    expect(plan.days[0].items[0].kind).toBe("arrival");
    const lastDay = plan.days[plan.days.length - 1];
    expect(lastDay.items.some((i) => i.kind === "departure")).toBe(true);
  });

  test("adds a travel item when switching cities", () => {
    const plan = buildItinerary(
      input({ destinationIds: ["beijing", "xian"], days: 5 }),
      DESTINATIONS
    );
    const xianDays = plan.days.filter((d) => d.destinationId === "xian");
    expect(xianDays.length).toBeGreaterThan(0);
    expect(xianDays[0].items[0].kind).toBe("travel");
  });

  test("excludes activities that should be avoided in the chosen season", () => {
    const plan = buildItinerary(
      input({ destinationIds: ["harbin"], days: 3, season: "summer" }),
      DESTINATIONS
    );
    const titles = plan.days.flatMap((d) => d.items.map((i) => i.title));
    expect(titles.join(" ")).not.toContain("Ice & Snow World");
  });

  test("schedules the winter-only highlight in winter", () => {
    const plan = buildItinerary(
      input({ destinationIds: ["harbin"], days: 3, season: "winter", interests: ["family"] }),
      DESTINATIONS
    );
    const titles = plan.days.flatMap((d) => d.items.map((i) => i.title));
    expect(titles.join(" ")).toContain("Ice & Snow World");
  });

  test("surfaces beach activities for beach lovers in Sanya", () => {
    const plan = buildItinerary(
      input({ destinationIds: ["sanya"], days: 3, season: "winter", interests: ["beach"] }),
      DESTINATIONS
    );
    const titles = plan.days.flatMap((d) => d.items.map((i) => i.title)).join(" ");
    expect(titles).toMatch(/Yalong Bay|Wuzhizhou/);
  });

  test("never repeats an activity within a trip", () => {
    const plan = buildItinerary(input({ days: 6 }), DESTINATIONS);
    const activityTitles = plan.days
      .flatMap((d) => d.items)
      .filter((i) => i.kind === "activity")
      .map((i) => i.title);
    expect(new Set(activityTitles).size).toBe(activityTitles.length);
  });

  test("caps destinations at the number of days", () => {
    const plan = buildItinerary(
      input({ destinationIds: ["beijing", "xian", "chengdu"], days: 2 }),
      DESTINATIONS
    );
    const cities = new Set(plan.days.map((d) => d.destinationId));
    expect(cities.size).toBeLessThanOrEqual(2);
    expect(plan.days).toHaveLength(2);
  });

  test("a city that only gets one day still gets something to do", () => {
    const plan = buildItinerary(
      input({ destinationIds: ["beijing", "xian"], days: 2 }),
      DESTINATIONS
    );
    const xianDay = plan.days[1];
    expect(xianDay.destinationId).toBe("xian");
    expect(xianDay.items[0].kind).toBe("travel");
    expect(xianDay.items.some((i) => i.kind === "activity")).toBe(true);
    expect(xianDay.items[xianDay.items.length - 1].kind).toBe("departure");
  });

  test("a one-day trip schedules an activity between arrival and departure", () => {
    const plan = buildItinerary(input({ days: 1 }), DESTINATIONS);
    const day = plan.days[0];
    expect(day.items[0].kind).toBe("arrival");
    expect(day.items.some((i) => i.kind === "activity" || i.kind === "free")).toBe(true);
    expect(day.items[day.items.length - 1].kind).toBe("departure");
  });

  test("returns an empty plan for empty selections", () => {
    const plan = buildItinerary(input({ destinationIds: [] }), DESTINATIONS);
    expect(plan.days).toHaveLength(0);
  });

  test("includes seasonal tips for each destination", () => {
    const plan = buildItinerary(input({ destinationIds: ["beijing"], season: "autumn" }), DESTINATIONS);
    expect(plan.tips.some((t) => t.startsWith("Beijing in autumn"))).toBe(true);
  });
});
