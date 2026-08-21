import { describe, expect, test } from "vitest";
import {
  applyCurrencySettingsUpdate,
  initialCurrencySettings,
  tripCountry,
  tripCurrency,
} from "./tripShared";
import type { CurrencySettings, TripData } from "./tripShared";
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

  test("never returns the same object reference across calls", () => {
    // A shared, module-level instance would let one caller's in-place
    // mutation poison every other trip that reads the same reference —
    // identity, not just deep equality, is the guarantee. There is no
    // longer a shared default constant to compare against directly (it was
    // removed as an orphan once every caller stopped falling back to it),
    // so this proves freshness the direct way: two calls never alias.
    expect(initialCurrencySettings("CN")).not.toBe(initialCurrencySettings("CN"));
    expect(initialCurrencySettings("JP")).not.toBe(initialCurrencySettings("JP"));
  });
});

describe("applyCurrencySettingsUpdate", () => {
  test("Critical 1: a rate save on a pivot-stamped trip does not erase the pivot", () => {
    // This is the exact shape TripView's saveCurrency sends: home + rates,
    // no pivot — the client never sends one. The trip was stamped "JPY" at
    // creation; saving a rate must not silently drop back to CNY-relative.
    const existing: CurrencySettings = { home: null, rates: {}, pivot: "JPY" };
    const incoming = { home: "SGD", rates: { SGD: 110.4 } };

    const result = applyCurrencySettingsUpdate(existing, incoming);

    expect(result).toEqual({ home: "SGD", rates: { SGD: 110.4 }, pivot: "JPY" });
  });

  test("an explicit pivot in the request still wins over the stored one", () => {
    const existing: CurrencySettings = { home: null, rates: {}, pivot: "JPY" };
    const incoming = { home: "SGD", rates: {}, pivot: "USD" };

    expect(applyCurrencySettingsUpdate(existing, incoming).pivot).toBe("USD");
  });

  test("a legacy trip with no stored pivot stays pivot-free after a save", () => {
    // The route must never introduce a pivot key that wasn't there before —
    // that would silently change what an old trip's rates mean.
    const existing: CurrencySettings = { home: "SGD", rates: { SGD: 5.2 } };
    const incoming = { home: "SGD", rates: { SGD: 5.3 } };

    const result = applyCurrencySettingsUpdate(existing, incoming);

    expect(result).toEqual({ home: "SGD", rates: { SGD: 5.3 } });
    expect("pivot" in result).toBe(false);
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
