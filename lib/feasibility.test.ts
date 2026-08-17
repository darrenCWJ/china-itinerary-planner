import { describe, expect, it } from "vitest";
import { CATALOG_MIN_NIGHTS, OFF_MAP_NIGHTS, assessFeasibility, type FeasibilityPlace } from "./feasibility";

/**
 * The arithmetic behind the live counter (spec §3.2.3):
 * `5 cities · 12 nights needed · 7 days set — 5 over`.
 */

const curated = (id: string, min: number, max: number): FeasibilityPlace => ({
  id,
  suggestedDays: [min, max],
});

describe("assessFeasibility", () => {
  it("reports an empty selection without implying a problem", () => {
    const result = assessFeasibility([], 7);

    expect(result).toEqual({
      cities: 0,
      nightsNeededMin: 0,
      nightsNeededMax: 0,
      daysSet: 7,
      delta: 7,
      verdict: "empty",
    });
  });

  it("fits a single city inside the budget", () => {
    const result = assessFeasibility([curated("shanghai", 2, 3)], 5);

    expect(result.cities).toBe(1);
    expect(result.nightsNeededMin).toBe(2);
    expect(result.nightsNeededMax).toBe(3);
    expect(result.delta).toBe(3);
    expect(result.verdict).toBe("fits");
  });

  it("reproduces the spec's own example — 5 cities, 12 nights, 7 days, 5 over", () => {
    const places = [
      curated("beijing", 2, 3),
      curated("xian", 2, 4),
      curated("chengdu", 2, 3),
      curated("guilin", 3, 5),
      curated("shanghai", 3, 4),
    ];

    const result = assessFeasibility(places, 7);

    expect(result.cities).toBe(5);
    expect(result.nightsNeededMin).toBe(12);
    expect(result.daysSet).toBe(7);
    // Negative delta is the shortfall the counter renders as "5 over".
    expect(result.delta).toBe(-5);
    expect(result.verdict).toBe("over");
  });

  it("counts a day budget exactly equal to the minimum as fitting", () => {
    const result = assessFeasibility([curated("a", 2, 3), curated("b", 2, 3)], 4);

    expect(result.delta).toBe(0);
    expect(result.verdict).toBe("fits");
  });

  it("gives an off-map place the default range rather than nothing", () => {
    // Spec §5.6: a hand-typed place has no coordinates and no researched range,
    // but it still consumes nights, so the counter must not read it as free.
    const result = assessFeasibility([{ id: "grandma's village", offMap: true }], 3);

    expect(result.nightsNeededMin).toBe(OFF_MAP_NIGHTS[0]);
    expect(result.nightsNeededMax).toBe(OFF_MAP_NIGHTS[1]);
    expect(result.cities).toBe(1);
  });

  it("ignores a suggested range on an off-map place", () => {
    // Nothing researched it, so a range on one of these is noise — most likely
    // a caller passing a Destination-shaped default through.
    const result = assessFeasibility(
      [{ id: "hand-typed", offMap: true, suggestedDays: [9, 9] }],
      3
    );

    expect(result.nightsNeededMin).toBe(OFF_MAP_NIGHTS[0]);
  });

  it("raises a catalog city's synthetic minimum of one night", () => {
    // Every catalog city is built with suggestedDays [1, maxDays]
    // (lib/server/catalog.ts) — the 1 is a placeholder, not research, and taking
    // it literally makes the counter optimistic on exactly the cities the user
    // knows least about.
    const result = assessFeasibility([{ id: "Q1234", fromCatalog: true, suggestedDays: [1, 4] }], 7);

    expect(result.nightsNeededMin).toBe(CATALOG_MIN_NIGHTS);
    expect(result.nightsNeededMax).toBe(4);
  });

  it("leaves a catalog city's minimum alone when it already exceeds the floor", () => {
    const result = assessFeasibility([{ id: "Q9", fromCatalog: true, suggestedDays: [3, 5] }], 7);

    expect(result.nightsNeededMin).toBe(3);
  });

  it("never lets a raised minimum exceed the maximum", () => {
    // A one-activity catalog city can arrive as [1, 1]; raising the min past the
    // max would report a range that runs backwards.
    const result = assessFeasibility([{ id: "Q7", fromCatalog: true, suggestedDays: [1, 1] }], 7);

    expect(result.nightsNeededMin).toBeLessThanOrEqual(result.nightsNeededMax);
    expect(result.nightsNeededMax).toBe(CATALOG_MIN_NIGHTS);
  });

  it("sums a mixed selection", () => {
    const result = assessFeasibility(
      [
        curated("beijing", 2, 3),
        { id: "Q1234", fromCatalog: true, suggestedDays: [1, 4] },
        { id: "village", offMap: true },
      ],
      6
    );

    expect(result.cities).toBe(3);
    expect(result.nightsNeededMin).toBe(2 + CATALOG_MIN_NIGHTS + OFF_MAP_NIGHTS[0]);
    expect(result.nightsNeededMax).toBe(3 + 4 + OFF_MAP_NIGHTS[1]);
  });

  it("treats a curated place with no range as off-map rather than free", () => {
    // Defensive: the field is optional on the input shape, and a place that
    // contributes zero nights is the one wrong answer here.
    const result = assessFeasibility([{ id: "mystery" }], 5);

    expect(result.nightsNeededMin).toBe(OFF_MAP_NIGHTS[0]);
  });

  it("does not go negative on a zero-day budget", () => {
    const result = assessFeasibility([curated("a", 2, 3)], 0);

    expect(result.daysSet).toBe(0);
    expect(result.delta).toBe(-2);
    expect(result.verdict).toBe("over");
  });
});
