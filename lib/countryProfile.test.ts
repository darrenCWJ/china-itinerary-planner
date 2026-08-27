import { describe, expect, test } from "vitest";
import { ISO_NUMERIC_TO_ALPHA2 } from "./countries";
import { getCountryProfile } from "./countryProfile";
import { GENERAL_TIPS } from "./itinerary";
import { HOLIDAY_BANDS, NATIONAL_CROWD, REGION_MONTHS } from "./months";
import { TRANSPORT } from "./route";

describe("China profile", () => {
  const cn = getCountryProfile("CN");

  test("seasons follow the northern calendar", () => {
    expect(cn.seasonOfMonth(1)).toBe("winter");
    expect(cn.seasonOfMonth(4)).toBe("spring");
    expect(cn.seasonOfMonth(7)).toBe("summer");
    expect(cn.seasonOfMonth(10)).toBe("autumn");
  });

  test("carries the curated China data the generator already uses", () => {
    expect(cn.crowdByMonth).toEqual(NATIONAL_CROWD);
    expect(cn.holidays).toEqual(HOLIDAY_BANDS);
    expect(cn.tips).toEqual([...GENERAL_TIPS]);
    expect(cn.transport.railKmh).toBe(230);
    expect(cn.transport.flightThresholdKm).toBe(1200);
    expect(cn.transport.groundTransferKmh).toBe(TRANSPORT.groundTransferKmh);
    expect(cn.transport.airportSearchRadiusKm).toBe(TRANSPORT.airportSearchRadiusKm);
    expect(cn.currency).toBe("CNY");
    expect(cn.packing.length).toBeGreaterThan(0);
  });

  test("climate rows come from the region table", () => {
    const east = cn.climateFor("East");
    expect(east).toHaveLength(12);
    expect(east).toEqual(REGION_MONTHS.East);
  });

  test("an unknown region degrades to null instead of throwing", () => {
    expect(() => cn.climateFor("Bavaria")).not.toThrow();
    expect(cn.climateFor("Bavaria")).toBeNull();
  });

  test("inherited object keys are not mistaken for climate rows", () => {
    expect(cn.climateFor("constructor")).toBeNull();
    expect(cn.climateFor("toString")).toBeNull();
  });

  test("callers cannot mutate the shared curated data through the profile", () => {
    const crowd = cn.crowdByMonth;
    // Narrowing, and an assertion in its own right: China's curve is the one
    // that must never be null, so a `?? []` here would hide the regression
    // this test is holding down.
    expect(crowd).not.toBeNull();
    if (crowd === null) return;
    crowd[0] = 99;
    cn.tips.push("mutated");
    expect(getCountryProfile("CN").crowdByMonth).toEqual(NATIONAL_CROWD);
    expect(getCountryProfile("CN").tips).toEqual([...GENERAL_TIPS]);
  });
});

describe("hemisphere", () => {
  test("a southern country inverts the seasons", () => {
    const au = getCountryProfile("AU");
    expect(au.seasonOfMonth(1)).toBe("summer");
    expect(au.seasonOfMonth(4)).toBe("autumn");
    expect(au.seasonOfMonth(7)).toBe("winter");
    expect(au.seasonOfMonth(10)).toBe("spring");
  });

  test("every southern month is the northern season six months away", () => {
    const north = getCountryProfile("CN");
    for (const south of [getCountryProfile("AU"), getCountryProfile("PE"), getCountryProfile("NZ")]) {
      for (let month = 1; month <= 12; month++) {
        expect(south.seasonOfMonth(month)).toBe(north.seasonOfMonth(((month + 5) % 12) + 1));
      }
    }
  });
});

describe("neutral profile", () => {
  const xx = getCountryProfile("XX");

  test("crowd pressure is absent rather than invented", () => {
    // Was `toHaveLength(12)` over a flat `[3,3,3,…]`. A flat curve is not the
    // absence of a claim: rendered under the label its consumers carry —
    // *typical national crowd pressure this month* — it says every month is
    // equally busy, which nobody researched. `null` is the honest state, and
    // components/map/MonthTimeline.test.tsx pins that it renders as no element
    // at all rather than as a row of three-of-five dots.
    expect(xx.crowdByMonth).toBeNull();
  });

  test("no holidays and no climate rows", () => {
    expect(xx.holidays).toEqual([]);
    expect(xx.climateFor("East")).toBeNull();
    expect(xx.climateFor("anything")).toBeNull();
  });

  test("packing and tips carry nothing China-specific", () => {
    const text = JSON.stringify({ packing: xx.packing, tips: xx.tips });
    for (const chinaOnly of ["Alipay", "VPN", "RMB", "China", "12306"]) {
      expect(text).not.toContain(chinaOnly);
    }
    expect(xx.packing.length).toBeGreaterThan(0);
    expect(xx.tips.length).toBeGreaterThan(0);
  });

  test("no rail estimate is offered where no rail network is known", () => {
    expect(xx.transport.railKmh).toBeNull();
    expect(xx.transport.flightKmh).toBe(TRANSPORT.flightKmh);
    expect(xx.transport.flightThresholdKm).toBe(TRANSPORT.flightThresholdKm);
  });

  test("ground transfer speed and airport search radius are offered everywhere, not just researched countries", () => {
    expect(xx.transport.groundTransferKmh).toBe(TRANSPORT.groundTransferKmh);
    expect(xx.transport.airportSearchRadiusKm).toBe(TRANSPORT.airportSearchRadiusKm);
  });

  test("currency falls back to the documented placeholder pivot", () => {
    expect(xx.currency).toBe("USD");
  });

  test("garbage input yields a profile instead of an exception", () => {
    for (const junk of ["", "   ", "CHN", "🙂", "constructor"]) {
      expect(() => getCountryProfile(junk)).not.toThrow();
      // Was `crowdByMonth` — now null for anything unresearched, so it can no
      // longer witness that a whole profile came back. Two fields that are
      // still populated do that instead, or "yields a profile" would be
      // asserted by a check that a field is empty.
      expect(getCountryProfile(junk).crowdByMonth).toBeNull();
      expect(getCountryProfile(junk).tips.length).toBeGreaterThan(0);
      expect(getCountryProfile(junk).packing.length).toBeGreaterThan(0);
    }
  });
});

describe("crowdByMonth is null or twelve long, for every country there is", () => {
  /**
   * The guard TypeScript cannot give and nothing at runtime does.
   *
   * `number[] | null` says nothing about the length, and every consumer indexes
   * it by `month - 1`. A curve of the wrong length is not a type error and does
   * not throw — it renders `undefined` dots, or silently reads a neighbouring
   * month. So the shape is swept over the whole code table rather than sampled.
   */
  const CODES = [...new Set(Object.values(ISO_NUMERIC_TO_ALPHA2))];

  test("the sweep runs over the whole table, not over nothing", () => {
    // The iteration floor. Without it, an empty or renamed table turns the
    // sweep below into a loop over zero countries that passes perfectly.
    expect(CODES.length).toBeGreaterThanOrEqual(240);
    expect(CODES).toContain("CN");
    expect(CODES).toContain("PE");
  });

  test("every profile is either twelve months of crowd or none at all", () => {
    let researched = 0;
    let withheld = 0;
    for (const code of CODES) {
      const curve = getCountryProfile(code).crowdByMonth;
      if (curve === null) {
        withheld += 1;
        continue;
      }
      researched += 1;
      expect(curve, `${code} has a crowd curve of the wrong length`).toHaveLength(12);
      for (const value of curve) {
        expect(Number.isInteger(value), `${code} has a non-integer crowd value`).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
    // Both arms observed, or the sweep proves only that one branch exists.
    expect(researched).toBe(1);
    expect(withheld).toBe(CODES.length - 1);
  });

  test("China is the researched one and Peru is not", () => {
    expect(getCountryProfile("CN").crowdByMonth).toEqual(NATIONAL_CROWD);
    expect(getCountryProfile("PE").crowdByMonth).toBeNull();
  });
});
