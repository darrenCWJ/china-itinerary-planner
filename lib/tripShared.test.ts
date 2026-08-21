import { describe, expect, test } from "vitest";
import { DEFAULT_CURRENCY_SETTINGS, initialCurrencySettings, tripCountry, tripCurrency } from "./tripShared";
import type { TripData } from "./tripShared";
import type { TripInput } from "./itinerary";
import type { Destination } from "./types";

function tripData(input: Partial<TripInput>): TripData {
  return {
    tripName: "Spring run",
    startDate: "2026-04-02",
    input: {
      destinationIds: ["beijing"],
      days: 5,
      season: "spring",
      adults: 2,
      kids: 0,
      interests: [],
      ...input,
    },
    plan: { days: [], tips: [] },
    packing: [],
    foods: [],
    destinationNames: ["Beijing"],
  };
}

describe("tripCountry", () => {
  test("reads a trip saved before the field existed as China", () => {
    // Every trip in the store predates `country`. They are all China trips, so
    // an absent field is an explicit CN rather than an unknown — which is what
    // lets the field arrive with no backfill.
    expect(tripCountry(tripData({}))).toBe("CN");
  });

  test("reads the stored country once a trip carries one", () => {
    expect(tripCountry(tripData({ country: "JP" }))).toBe("JP");
  });
});

describe("tripCurrency", () => {
  test("a China trip has a researched currency", () => {
    expect(tripCurrency(tripData({}))).toBe("CNY");
  });

  test("a country with no researched currency profile reads as null, never the neutral profile's USD placeholder", () => {
    // getCountryProfile("JP").currency is "USD" today — an admitted
    // placeholder (lib/countryProfile.ts), not a fact about Japan. Showing
    // that guess to a member would be wrong-by-commission, so this must read
    // as an honest "we don't know" instead.
    expect(tripCurrency(tripData({ country: "JP" }))).toBeNull();
  });
});

describe("initialCurrencySettings", () => {
  test("stamps the researched pivot for a China trip", () => {
    expect(initialCurrencySettings("CN")).toEqual({ home: null, rates: {}, pivot: "CNY" });
  });

  test("J-C1: stamps nothing for a country with no researched currency profile", () => {
    // getCountryProfile("JP").currency is "USD" today — an admitted
    // placeholder (lib/countryProfile.ts), not a fact about Japan. Stamping
    // it would persist a guess as fact, which is worse than an absent pivot
    // — the absent case already reads as the legacy CNY default.
    expect(initialCurrencySettings("JP")).toEqual({ home: null, rates: {} });
  });

  test("never returns the shared DEFAULT_CURRENCY_SETTINGS reference", () => {
    // A mutated shared default would poison every later trip that falls
    // back to it — identity, not just deep equality, is the guarantee.
    expect(initialCurrencySettings("CN")).not.toBe(DEFAULT_CURRENCY_SETTINGS);
    expect(initialCurrencySettings("JP")).not.toBe(DEFAULT_CURRENCY_SETTINGS);
  });
});

describe("Destination.region is free-form", () => {
  test("accepts a region label that is meaningful outside China", () => {
    const kansai: Destination["region"] = "Kansai";
    expect(kansai).toBe("Kansai");
  });

  test("still accepts China's own labels, which are just strings now", () => {
    const east: Destination["region"] = "East";
    expect(east).toBe("East");
  });
});
