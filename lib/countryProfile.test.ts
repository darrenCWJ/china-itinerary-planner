import { describe, expect, test } from "vitest";
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
    cn.crowdByMonth[0] = 99;
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

  test("crowd pressure is flat rather than invented", () => {
    expect(xx.crowdByMonth).toHaveLength(12);
    expect(new Set(xx.crowdByMonth).size).toBe(1);
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

  test("currency falls back to the documented placeholder pivot", () => {
    expect(xx.currency).toBe("USD");
  });

  test("garbage input yields a profile instead of an exception", () => {
    for (const junk of ["", "   ", "CHN", "🙂", "constructor"]) {
      expect(() => getCountryProfile(junk)).not.toThrow();
      expect(getCountryProfile(junk).crowdByMonth).toHaveLength(12);
    }
  });
});
