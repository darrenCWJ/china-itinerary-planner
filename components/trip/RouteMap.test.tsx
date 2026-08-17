import { describe, expect, test } from "vitest";
import { DESTINATIONS } from "@/lib/data";
import type { DayPlan, TripPlan } from "@/lib/itinerary";
import { routeDestinationIds, routeMonth, routePlaces } from "./RouteMap";

/**
 * Spec §2.1 justified removing Route from the nav by promising this view inside
 * Plan; for the whole of PR2 the branch rendered a placeholder instead. What is
 * testable without a browser is the derivation — which stops are drawn, in what
 * order, and which month the season fit is coloured against. The map itself is
 * CountryMap, already covered by its own tests.
 */

const day = (n: number, destinationId: string): DayPlan => ({
  day: n,
  destinationId,
  destinationName: destinationId,
  items: [],
});

const plan = (days: DayPlan[]): TripPlan => ({ days, tips: [] }) as unknown as TripPlan;

describe("routeDestinationIds", () => {
  test("keeps day order and de-duplicates on first appearance", () => {
    const ids = routeDestinationIds(
      plan([day(1, "beijing"), day(2, "beijing"), day(3, "xian"), day(4, "beijing")])
    );
    expect(ids).toEqual(["beijing", "xian"]);
  });

  test("an empty plan yields no stops rather than throwing", () => {
    expect(routeDestinationIds(plan([]))).toEqual([]);
  });
});

describe("routePlaces", () => {
  test("draws the trip's curated stops in day order", () => {
    const places = routePlaces(plan([day(1, "xian"), day(2, "beijing")]));
    expect(places.map((p) => p.id)).toEqual(["xian", "beijing"]);
    for (const place of places) {
      expect(Number.isFinite(place.lat)).toBe(true);
      expect(Number.isFinite(place.lon)).toBe(true);
    }
  });

  test("drops a stop the curated set does not know", () => {
    // Catalog cities (Qxxxx) carry no bundled Destination, and off-map ids never
    // reach a saved plan at all. Both are absent rather than drawn at 0,0.
    const places = routePlaces(plan([day(1, "beijing"), day(2, "Q71284")]));
    expect(places.map((p) => p.id)).toEqual(["beijing"]);
  });

  test("carries the fields the map colours and labels with", () => {
    const [place] = routePlaces(plan([day(1, "beijing")]));
    const source = DESTINATIONS.find((d) => d.id === "beijing")!;
    expect(place).toMatchObject({
      kind: "curated",
      name: source.name,
      region: source.region,
      attractionCount: source.activities.length,
    });
  });
});

describe("routeMonth", () => {
  test("a start date is the fact", () => {
    expect(routeMonth("2026-11-03", "summer", "CN")).toBe(11);
  });

  test("falls back to a month the country's own profile calls that season", () => {
    expect(routeMonth(null, "winter", "CN")).toBe(1);
  });

  test("the fallback is hemisphere-aware, not a northern table", () => {
    // Southern seasons are inverted, and the loop takes the first matching
    // month: January is summer in Australia and June is winter. A northern
    // table would answer 6 and 12.
    expect(routeMonth(null, "summer", "AU")).toBe(1);
    expect(routeMonth(null, "winter", "AU")).toBe(6);
    expect(routeMonth(null, "summer", "CN")).toBe(6);
    expect(routeMonth(null, "winter", "CN")).toBe(1);
  });

  test("a malformed start date falls through rather than producing NaN", () => {
    expect(routeMonth("not-a-date", "winter", "CN")).toBe(1);
  });
});
