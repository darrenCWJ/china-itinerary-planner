import { describe, expect, test } from "vitest";
import {
  applyCurrencySettingsUpdate,
  currencyPivot,
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
    //
    // Deliberately NOT one of the defaults the worldwide catalog removed. Those
    // were country *scopes* — "which places may we offer" — and a wrong default
    // there silently offered Chinese cities for a Japanese trip. This one is a
    // *persistence* backfill for a field that did not exist when some rows were
    // written; deleting it would reclassify every legacy trip as country-less
    // rather than as Chinese. See lib/tripShared.ts's docblock.
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

  test("a country with no known currency reads as null, never a guess", () => {
    // "XX" and not another real country. Japan used to be the fixture here,
    // back when every non-China profile carried an admitted "USD" placeholder;
    // since T27 Japan's currency is the artifact's real JPY, and any real code
    // is one upstream edit away from becoming researched overnight. "XX" is
    // permanently unassigned by ISO 3166, so it cannot stop being the case
    // this test is about.
    expect(tripCurrency(tripData({ country: "XX" }))).toBeNull();
  });

  test("a country the facts artifact covers reads as that currency", () => {
    // The other half. Without it, `tripCurrency` returning null for everything
    // would satisfy every other test in this describe.
    expect(tripCurrency(tripData({ country: "JP" }))).toBe("JPY");
    expect(tripCurrency(tripData({ country: "PE" }))).toBe("PEN");
  });
});

describe("initialCurrencySettings", () => {
  test("stamps the researched pivot for a China trip", () => {
    expect(initialCurrencySettings("CN")).toEqual({ home: null, rates: {}, pivot: "CNY" });
  });

  test("J-C1: records an explicit null for a country with no known currency", () => {
    // "XX", not a real country — see the note on tripCurrency above. Stamping a
    // guess would persist it as fact, so the VALUE is still withheld.
    //
    // What changed is that the KEY is written. This used to return
    // `{ home: null, rates: {} }`, and the comment justifying it said the
    // absent case "already reads as the legacy CNY default" — which was the
    // defect, not the defence. Absent meant "saved before this field existed",
    // and that means CNY, so every new trip to Panama, Namibia, Lesotho and
    // eight other unresearched codes was priced in Chinese yuan from the moment
    // it was created. `null` is the fact this function actually knows.
    expect(initialCurrencySettings("XX")).toEqual({ home: null, rates: {}, pivot: null });
    // And the two states are now distinguishable, which is the whole point:
    // this trip has no pivot, while a row with no key at all still means CNY.
    expect(currencyPivot(initialCurrencySettings("XX"))).toBeNull();
    expect(currencyPivot({ home: null, rates: {} })).toBe("CNY");
  });

  test("records a null for real unresearched countries too, not just for XX", () => {
    // Eleven codes have no researched currency and three of them are ordinary
    // travel destinations. A fixture country cannot show that; these can.
    for (const code of ["PA", "NA", "LS"]) {
      expect(initialCurrencySettings(code), code).toEqual({
        home: null,
        rates: {},
        pivot: null,
      });
    }
  });

  test("stamps the artifact's currency for a country the ingest reached", () => {
    // The arming half: "stamps nothing" is satisfied by a function that stamps
    // nothing for anyone.
    expect(initialCurrencySettings("JP")).toEqual({ home: null, rates: {}, pivot: "JPY" });
    expect(initialCurrencySettings("PE")).toEqual({ home: null, rates: {}, pivot: "PEN" });
  });

  test("never returns the same object reference across calls", () => {
    // A shared, module-level instance would let one caller's in-place
    // mutation poison every other trip that reads the same reference —
    // identity, not just deep equality, is the guarantee. There is no
    // longer a shared default constant to compare against directly (it was
    // removed as an orphan once every caller stopped falling back to it),
    // so this proves freshness the direct way: two calls never alias.
    expect(initialCurrencySettings("CN")).not.toBe(initialCurrencySettings("CN"));
    expect(initialCurrencySettings("XX")).not.toBe(initialCurrencySettings("XX"));
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

  test("a recorded no-pivot survives a save that sets no home currency", () => {
    // `null` is a stored fact, not a missing value. A save that only touches
    // rates must not turn it into an absent key, which would silently make the
    // trip legacy-CNY — the exact confusion the null exists to end.
    const existing: CurrencySettings = { home: null, rates: {}, pivot: null };
    const result = applyCurrencySettingsUpdate(existing, { home: null, rates: { USD: 1 } });

    expect(result).toEqual({ home: null, rates: { USD: 1 }, pivot: null });
    expect("pivot" in result).toBe(true);
    expect(currencyPivot(result)).toBeNull();
  });

  test("setting a home currency stamps it as the pivot a no-pivot trip lacked", () => {
    // A Panama trip: nobody has researched its currency, so it has no pivot to
    // price rates against. The member declares a home currency, and that — not
    // a guess about the country — becomes the unit the rates table is in.
    const existing: CurrencySettings = { home: null, rates: {}, pivot: null };
    const result = applyCurrencySettingsUpdate(existing, { home: "USD", rates: {} });

    expect(result).toEqual({ home: "USD", rates: {}, pivot: "USD" });
  });

  test("a stamped pivot does not follow the home currency afterwards", () => {
    // Recorded once, then fixed. A pivot that tracked `home` would silently
    // reinterpret every stored rate the next time somebody changed it.
    const stamped = applyCurrencySettingsUpdate(
      { home: null, rates: {}, pivot: null },
      { home: "USD", rates: {} }
    );
    const moved = applyCurrencySettingsUpdate(stamped, { home: "EUR", rates: { EUR: 0.9 } });

    expect(moved).toEqual({ home: "EUR", rates: { EUR: 0.9 }, pivot: "USD" });
  });

  test("a legacy trip is not retro-stamped when its home currency is set", () => {
    // The stamping rule keys on a stored `null`, never on an absent key. A
    // legacy row's rates are already CNY-relative; writing the member's home
    // currency over that would reprice the whole trip.
    const existing: CurrencySettings = { home: null, rates: { SGD: 5.2 } };
    const result = applyCurrencySettingsUpdate(existing, { home: "SGD", rates: { SGD: 5.2 } });

    expect("pivot" in result).toBe(false);
    expect(currencyPivot(result)).toBe("CNY");
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
