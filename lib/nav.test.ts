import { describe, expect, test } from "vitest";
import { TRIP_NAV, type TripTabId } from "./nav";

/**
 * The spec's central constraint is four trip tabs, rendered from one source so
 * the rail and the (later) mobile bottom bar can never disagree — C1.
 */
describe("TRIP_NAV", () => {
  test("is exactly the four tabs the redesign collapses to", () => {
    expect(TRIP_NAV.map((item) => item.id)).toEqual(["plan", "today", "money", "kit"]);
  });

  test("labels read as the spec names them", () => {
    expect(TRIP_NAV.map((item) => item.label)).toEqual(["Plan", "Today", "Money", "Kit"]);
  });

  test("every label fits a 375px bottom-bar tab", () => {
    // 375 / 4 ≈ 93px per tab at the token type size; 6 characters is the
    // conservative bound that keeps a label on one line without ellipsis (C7).
    for (const item of TRIP_NAV) {
      expect(item.label.length).toBeLessThanOrEqual(6);
    }
  });

  test("every item carries an icon name and an aria-label", () => {
    for (const item of TRIP_NAV) {
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  test("aria-labels say more than the visible label", () => {
    // The visible label is truncated for the 375px budget; the accessible name
    // is what a screen reader announces, so it should not just repeat it.
    for (const item of TRIP_NAV) {
      expect(item.ariaLabel).not.toBe(item.label);
    }
  });

  test("ids are unique", () => {
    expect(new Set(TRIP_NAV.map((item) => item.id)).size).toBe(TRIP_NAV.length);
  });

  test("TripTabId covers exactly the shipped ids", () => {
    // Compile-time check made runtime-visible: every id is assignable to the
    // union, and the union has no member without a nav entry.
    const ids: TripTabId[] = TRIP_NAV.map((item) => item.id);
    const byId: Record<TripTabId, boolean> = { plan: false, today: false, money: false, kit: false };
    for (const id of ids) byId[id] = true;
    expect(Object.values(byId).every(Boolean)).toBe(true);
  });
});
