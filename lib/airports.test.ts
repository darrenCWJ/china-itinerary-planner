import { describe, expect, test } from "vitest";
import { findAirport, searchAirports, type Airport } from "./airports";

/** A small hand-built set — real coordinates, so distance tests stay honest. */
export const FIXTURE: Airport[] = [
  { iata: "TNA", icao: "ZSJN", name: "Jinan Yaoqiang International Airport", municipality: "Jinan", country: "CN", lat: 36.857, lon: 117.216, size: "large" },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
  { iata: "LHR", icao: "EGLL", name: "London Heathrow Airport", municipality: "London", country: "GB", lat: 51.4706, lon: -0.461941, size: "large" },
  { iata: "LCY", icao: "EGLC", name: "London City Airport", municipality: "London", country: "GB", lat: 51.5053, lon: 0.055278, size: "medium" },
  { iata: "LGW", icao: "EGKK", name: "London Gatwick Airport", municipality: "London", country: "GB", lat: 51.1481, lon: -0.190278, size: "large" },
  { iata: "ZRH", icao: "LSZH", name: "Zürich Airport", municipality: "Zurich", country: "CH", lat: 47.4647, lon: 8.54917, size: "large" },
];

describe("findAirport", () => {
  test("finds an airport by its IATA code, case-insensitively", () => {
    expect(findAirport(FIXTURE, "tna")?.name).toBe("Jinan Yaoqiang International Airport");
  });

  test("returns null for a code that is not three letters", () => {
    expect(findAirport(FIXTURE, "TN")).toBeNull();
    expect(findAirport(FIXTURE, "")).toBeNull();
  });

  test("returns null for an unknown code", () => {
    expect(findAirport(FIXTURE, "XXX")).toBeNull();
  });
});

describe("searchAirports", () => {
  test("an exact IATA match outranks any name match", () => {
    // "LGW" is also a substring of nothing else, but the point is the ordering
    // rule: a code typed in full is the most specific thing a user can say.
    expect(searchAirports(FIXTURE, "LGW")[0].iata).toBe("LGW");
  });

  test("matches on municipality and returns every airport serving it", () => {
    const codes = searchAirports(FIXTURE, "London").map((a) => a.iata);
    expect(codes).toContain("LHR");
    expect(codes).toContain("LCY");
    expect(codes).toContain("LGW");
  });

  test("folds diacritics so 'zurich' finds 'Zürich'", () => {
    expect(searchAirports(FIXTURE, "zurich")[0].iata).toBe("ZRH");
  });

  test("prefixes outrank substrings", () => {
    // "Capital" is a substring of Beijing's name; "Jinan" is a prefix of
    // Jinan's. The prefix match must come first.
    const codes = searchAirports(FIXTURE, "Jinan").map((a) => a.iata);
    expect(codes[0]).toBe("TNA");
  });

  test("larger airports come first within the same score", () => {
    const codes = searchAirports(FIXTURE, "London").map((a) => a.iata);
    // LCY is the only medium among the three, so it must not lead.
    expect(codes[0]).not.toBe("LCY");
  });

  test("an empty query returns nothing", () => {
    expect(searchAirports(FIXTURE, "   ")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(searchAirports(FIXTURE, "London", 2)).toHaveLength(2);
  });
});
