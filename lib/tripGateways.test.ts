import { describe, expect, test } from "vitest";
import type { TripInput } from "./itinerary";
import type { TripData } from "./tripShared";
import { carryGateways, IATA_CODE, tripGateways, withGateways } from "./tripGateways";

function tripData(input: Partial<TripInput>): TripData {
  return {
    tripName: "Family Trip",
    startDate: null,
    input: {
      destinationIds: ["beijing"],
      days: 3,
      season: "spring",
      adults: 2,
      kids: 0,
      interests: [],
      country: "CN",
      ...input,
    },
    plan: { days: [], tips: [] },
    packing: [],
    foods: [],
    destinationNames: [],
  };
}

describe("IATA_CODE", () => {
  test("accepts exactly three uppercase letters", () => {
    expect(IATA_CODE.test("LIM")).toBe(true);
    expect(IATA_CODE.test("lim")).toBe(false);
    expect(IATA_CODE.test("LIMA")).toBe(false);
    expect(IATA_CODE.test("")).toBe(false);
  });
});

describe("tripGateways", () => {
  test("reads a trip saved before the fields existed as having no gateways", () => {
    // Absent and null mean the same thing to a reader. They differ only at
    // the write end, where applyDefaultGateways fills absent and leaves null.
    expect(tripGateways(tripData({}))).toEqual({ arrival: null, departure: null });
  });

  test("reads an explicit none as none", () => {
    expect(tripGateways(tripData({ arrivalAirport: null, departureAirport: null }))).toEqual({
      arrival: null,
      departure: null,
    });
  });

  test("reads the stored codes once a trip carries them", () => {
    expect(tripGateways(tripData({ arrivalAirport: "LIM", departureAirport: "CUZ" }))).toEqual({
      arrival: "LIM",
      departure: "CUZ",
    });
  });
});

describe("withGateways", () => {
  test("replaces both gateways and nothing else", () => {
    const before = tripData({ arrivalAirport: "LIM" });
    const after = withGateways(before, { arrival: "AQP", departure: null });
    expect(after.input.arrivalAirport).toBe("AQP");
    expect(after.input.departureAirport).toBeNull();
    // The plan is the members' draft; a gateway edit never touches it.
    expect(after.plan).toBe(before.plan);
    expect(after.input.destinationIds).toBe(before.input.destinationIds);
    // And the input it was given is not mutated.
    expect(before.input.arrivalAirport).toBe("LIM");
    expect("departureAirport" in before.input).toBe(false);
  });
});

describe("carryGateways", () => {
  const stored = tripData({ arrivalAirport: "LIM", departureAirport: null }).input;

  test("an input that omits its gateways inherits the stored ones", () => {
    const next = tripData({}).input;
    const carried = carryGateways(next, stored);
    expect(carried.arrivalAirport).toBe("LIM");
    expect(carried.departureAirport).toBeNull();
  });

  test("null is a clear, not an omission", () => {
    const next = tripData({ arrivalAirport: null }).input;
    expect(carryGateways(next, stored).arrivalAirport).toBeNull();
  });

  test("a code sent wins over the stored one", () => {
    const next = tripData({ arrivalAirport: "AQP" }).input;
    expect(carryGateways(next, stored).arrivalAirport).toBe("AQP");
  });

  test("absent on both sides stays absent, so a legacy row stays legacy", () => {
    const carried = carryGateways(tripData({}).input, tripData({}).input);
    expect("arrivalAirport" in carried).toBe(false);
    expect("departureAirport" in carried).toBe(false);
  });
});
