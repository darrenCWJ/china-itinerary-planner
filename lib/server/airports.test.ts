import { describe, expect, test } from "vitest";
import {
  airportStatus,
  airportsForCountry,
  allAirports,
  findAirport,
  nearestAirports,
  searchAirports,
} from "./airports";

describe("the bundled airport artifact", () => {
  test("carries a plausible number of airports and countries", () => {
    const status = airportStatus();
    expect(status.airports).toBeGreaterThan(3_500);
    expect(status.countries).toBeGreaterThan(200);
    expect(status.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /**
   * The drift guard. A bad daily refresh should fail CI rather than ship: these
   * four are among the busiest airports on Earth and will not lose scheduled
   * service or change code. TNA is here because it is the airport whose absence
   * prompted this work.
   */
  test.each(["TNA", "PEK", "LHR", "JFK"])("still resolves %s", (code) => {
    expect(findAirport(code)).not.toBeNull();
  });

  test("TNA is Jinan's airport, in China", () => {
    const tna = findAirport("TNA");
    // OurAirports qualifies municipalities with a district — the real value is
    // "Jinan (Licheng)", not "Jinan". Asserting the exact string would pin a
    // formatting detail of the upstream source that has nothing to do with what
    // this test is about.
    expect(tna?.municipality).toContain("Jinan");
    expect(tna?.country).toBe("CN");
  });

  test("every IATA code is unique", () => {
    const all = allAirports();
    expect(new Set(all.map((a) => a.iata)).size).toBe(all.length);
  });

  test("every airport has finite coordinates and a two-letter country", () => {
    for (const a of allAirports()) {
      expect(Number.isFinite(a.lat) && Number.isFinite(a.lon)).toBe(true);
      expect(a.country).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("airportsForCountry", () => {
  test("scopes to one country", () => {
    const cn = airportsForCountry("cn");
    expect(cn.length).toBeGreaterThan(100);
    expect(cn.every((a) => a.country === "CN")).toBe(true);
    expect(cn.some((a) => a.iata === "TNA")).toBe(true);
  });

  test("an unknown country is empty, not an error", () => {
    expect(airportsForCountry("ZZ")).toEqual([]);
  });
});

describe("bound helpers reach the real data", () => {
  test("search finds Jinan by city name", () => {
    expect(searchAirports("Jinan").map((a) => a.iata)).toContain("TNA");
  });

  test("nearest finds TNA from Jinan's city centre", () => {
    const near = nearestAirports({ lat: 36.667, lon: 116.983 });
    expect(near[0].airport.iata).toBe("TNA");
    expect(near[0].km).toBeLessThan(60);
  });
});
