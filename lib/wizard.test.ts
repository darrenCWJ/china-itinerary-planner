import { describe, expect, it } from "vitest";
import { WIZARD_STEPS, canAdvance } from "./wizard";

/**
 * The wizard's step order and its advance gate, extracted so the reorder in
 * spec §3.2.1 is asserted rather than eyeballed — the whole risk of moving
 * details ahead of destinations is that a gate keeps checking the old step
 * number.
 */

describe("WIZARD_STEPS", () => {
  it("puts trip details before destinations", () => {
    // Spec §3.2.1: you cannot judge whether five cities fit until the trip
    // knows how many days it has.
    expect(WIZARD_STEPS).toEqual(["Trip details", "Destinations", "Your plan"]);
  });
});

describe("canAdvance", () => {
  it("lets a details step with at least one day continue", () => {
    expect(canAdvance(0, { selectedCount: 0, days: 1 })).toBe(true);
  });

  it("blocks a details step with no days", () => {
    // Guards against a stored or hand-edited zero; the control itself clamps.
    expect(canAdvance(0, { selectedCount: 0, days: 0 })).toBe(false);
  });

  it("does not require a destination to leave the details step", () => {
    // The point of the reorder: destinations are picked *after* this.
    expect(canAdvance(0, { selectedCount: 0, days: 5 })).toBe(true);
  });

  it("blocks the destinations step until something is selected", () => {
    expect(canAdvance(1, { selectedCount: 0, days: 5 })).toBe(false);
    expect(canAdvance(1, { selectedCount: 1, days: 5 })).toBe(true);
  });

  it("still requires days on the destinations step", () => {
    // Reachable only by going back and clearing days, but a plan for zero days
    // is not something to hand to the generator.
    expect(canAdvance(1, { selectedCount: 2, days: 0 })).toBe(false);
  });

  it("cannot advance from the final step", () => {
    expect(canAdvance(2, { selectedCount: 3, days: 5 })).toBe(false);
  });

  it("refuses an out-of-range step rather than defaulting to true", () => {
    // A gate that defaults open is the wrong failure direction.
    expect(canAdvance(-1, { selectedCount: 3, days: 5 })).toBe(false);
    expect(canAdvance(99, { selectedCount: 3, days: 5 })).toBe(false);
  });
});
