import { describe, expect, it } from "vitest";
import { WIZARD_STEPS, canAdvance, tripCountryFromPicks } from "./wizard";

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

/**
 * Which country the trip is FOR, as opposed to which one the picker is on.
 *
 * The wizard held one `country` state, written only by the world picker, and
 * handed it straight to the generators — so a trip whose only destination was
 * Peruvian was built as a Japan trip if the picker moved on afterwards, and the
 * tips, packing list, currency pivot, season and glyphs all followed. The rule
 * is unit-tested here; `components/plan/wizardCountry.test.tsx` drives the whole
 * wizard through it, because no test file may live under app/.
 */
describe("tripCountryFromPicks", () => {
  const PICKS = { lima: "PE", tokyo: "JP", beijing: "CN" };

  it("answers with the open country when nothing is picked", () => {
    // The common case, and the one that keeps China's behaviour identical: on
    // step 0 and on an empty step 1 there is no destination to speak for the
    // trip, so the country being browsed is the only statement of intent.
    expect(tripCountryFromPicks([], PICKS, "CN")).toBe("CN");
    expect(tripCountryFromPicks([], PICKS, "JP")).toBe("JP");
  });

  it("answers with the picked destination's country, not the picker's", () => {
    // THE DEFECT. Lima is the trip; the picker was left on Japan.
    expect(tripCountryFromPicks(["lima"], PICKS, "JP")).toBe("PE");
  });

  it("agrees with the picker when they already agree", () => {
    // Armed against a rule that simply ignores its third argument: this and
    // the case above return different answers for the same first argument.
    expect(tripCountryFromPicks(["lima"], PICKS, "PE")).toBe("PE");
  });

  it("takes the trip's first stop when picks span countries", () => {
    // `selected` is the stop order — `suggestRoute` starts the route at
    // `selected[0]` — so the first entry is the lead destination and the least
    // arbitrary single answer for a model that stores one country per trip.
    expect(tripCountryFromPicks(["lima", "tokyo"], PICKS, "CN")).toBe("PE");
    expect(tripCountryFromPicks(["tokyo", "lima"], PICKS, "CN")).toBe("JP");
  });

  it("skips a pick nothing knows a country for rather than giving up", () => {
    // One unattributed id must not hand the decision back to the picker while
    // a pick that does know its country is sitting behind it.
    expect(tripCountryFromPicks(["mystery", "lima"], PICKS, "JP")).toBe("PE");
    // And with nothing attributable at all, the picker is right again.
    expect(tripCountryFromPicks(["mystery"], PICKS, "JP")).toBe("JP");
  });

  it("treats an empty-string country as no answer, not as a country", () => {
    // `Destination.country` is a plain string; a blank one is a gap, and
    // returning it would put the trip in a country with no code at all.
    expect(tripCountryFromPicks(["blank", "lima"], { blank: "", lima: "PE" }, "JP")).toBe("PE");
  });

  it("reads only its own arguments — no inherited key is a country", () => {
    // `countryOfPick` is a plain object built from three id spaces. A pick
    // literally named "constructor" must not resolve to something off the
    // prototype chain and be handed to `buildItinerary` as a country.
    expect(tripCountryFromPicks(["constructor"], {}, "CN")).toBe("CN");
    expect(tripCountryFromPicks(["toString"], {}, "PE")).toBe("PE");
  });
});
