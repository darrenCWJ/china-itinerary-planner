import { describe, expect, test } from "vitest";
import { getDestination } from "./data";
import type { TripInput } from "./itinerary";
import { buildPackingList } from "./packing";

function input(overrides: Partial<TripInput> = {}): TripInput {
  return {
    destinationIds: ["beijing"],
    days: 4,
    season: "spring",
    adults: 2,
    kids: 0,
    interests: [],
    ...overrides,
  };
}

function allItems(groups: ReturnType<typeof buildPackingList>): string {
  return groups.flatMap((g) => g.items).join(" | ").toLowerCase();
}

describe("buildPackingList", () => {
  test("always includes documents and tech essentials", () => {
    const groups = buildPackingList(input(), [getDestination("beijing")!]);
    const text = allItems(groups);
    expect(text).toContain("passport");
    expect(text).toContain("vpn");
    expect(text).toContain("alipay");
  });

  test("includes swim gear for beach trips", () => {
    const groups = buildPackingList(input({ season: "winter", interests: ["beach"] }), [
      getDestination("sanya")!,
    ]);
    expect(allItems(groups)).toContain("swimwear");
  });

  test("includes thermals for winter and the Harbin extreme-cold kit", () => {
    const groups = buildPackingList(input({ season: "winter" }), [getDestination("harbin")!]);
    const text = allItems(groups);
    expect(text).toContain("thermal");
    expect(text).toContain("harbin extreme-cold kit");
  });

  test("omits the Harbin kit outside winter", () => {
    const groups = buildPackingList(input({ season: "summer" }), [getDestination("harbin")!]);
    expect(allItems(groups)).not.toContain("extreme-cold kit");
  });

  test("adds a kids group only when kids are travelling", () => {
    const without = buildPackingList(input(), [getDestination("beijing")!]);
    const withKids = buildPackingList(input({ kids: 2 }), [getDestination("beijing")!]);
    expect(without.some((g) => g.title.includes("Kids"))).toBe(false);
    expect(withKids.some((g) => g.title.includes("Kids"))).toBe(true);
  });

  test("adds hiking gear when hiking is selected", () => {
    const groups = buildPackingList(input({ interests: ["hiking"] }), [
      getDestination("zhangjiajie")!,
    ]);
    expect(allItems(groups)).toContain("hiking shoes");
  });
});
