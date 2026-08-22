import { describe, expect, test } from "vitest";
import {
  findAirport,
  searchAirports,
  nearestAirports,
  DEFAULT_AIRPORT_RADIUS_KM,
  type Airport,
} from "./airports";

/** A small hand-built set — real coordinates, so distance tests stay honest. */
export const FIXTURE: Airport[] = [
  { iata: "TNA", icao: "ZSJN", name: "Jinan Yaoqiang International Airport", municipality: "Jinan", country: "CN", lat: 36.857, lon: 117.216, size: "large" },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
  { iata: "LHR", icao: "EGLL", name: "London Heathrow Airport", municipality: "London", country: "GB", lat: 51.4706, lon: -0.461941, size: "large" },
  { iata: "LCY", icao: "EGLC", name: "London City Airport", municipality: "London", country: "GB", lat: 51.5053, lon: 0.055278, size: "medium" },
  { iata: "LGW", icao: "EGKK", name: "London Gatwick Airport", municipality: "London", country: "GB", lat: 51.1481, lon: -0.190278, size: "large" },
  { iata: "ZRH", icao: "LSZH", name: "Zürich Airport", municipality: "Zurich", country: "CH", lat: 47.4647, lon: 8.54917, size: "large" },
  { iata: "PVG", icao: "ZSPD", name: "Shanghai Pudong International Airport", municipality: "Shanghai (Pudong)", country: "CN", lat: 31.1434, lon: 121.805, size: "large" },
  { iata: "SHA", icao: "ZSSS", name: "Shanghai Hongqiao International Airport", municipality: "Shanghai (Minhang)", country: "CN", lat: 31.198104, lon: 121.33426, size: "large" },
  { iata: "FIH", icao: "FZAA", name: "Ndjili International Airport", municipality: "Kinshasa", country: "CD", lat: -4.38575, lon: 15.4446, size: "large" },
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
  test("exact IATA, prefix, and substring matches all rank in order", () => {
    // "sha" hits all three tiers against real airports, so this single
    // assertion pins the whole ordering and fails if any two tiers swap:
    //   SHA  — iata === "SHA"                              → exact, score 3
    //   PVG  — municipality "Shanghai (Pudong)" folds to    → prefix, score 2
    //          a string that *starts with* "shanghai"
    //   FIH  — municipality "Kinshasa" folds to a string    → substring, score 1
    //          that *contains* "sha" but does not start with it
    const codes = searchAirports(FIXTURE, "sha").map((a) => a.iata);
    expect(codes).toEqual(["SHA", "PVG", "FIH"]);
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

  test("larger airports come first within the same score", () => {
    const codes = searchAirports(FIXTURE, "London").map((a) => a.iata);
    // LCY is the only medium among the three, so it must not lead.
    expect(codes[0]).not.toBe("LCY");
  });

  test("an empty query returns nothing", () => {
    expect(searchAirports(FIXTURE, "   ")).toEqual([]);
  });

  test("a punctuation-only query that folds to empty returns nothing", () => {
    // Regression: foldPlaceName strips apostrophes entirely, so a raw query
    // of "'" has raw.length === 1 (passing a raw-length guard) but folds to
    // "". Every airport's name/municipality starts with "", so an unfolded
    // length guard would return the entire dataset instead of [].
    expect(searchAirports(FIXTURE, "'")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(searchAirports(FIXTURE, "London", 2)).toHaveLength(2);
  });
});

describe("nearestAirports", () => {
  const london = { lat: 51.507, lon: -0.128 };
  const jinan = { lat: 36.667, lon: 116.983 };

  test("returns every airport serving a multi-airport city, nearest-ish first", () => {
    const codes = nearestAirports(FIXTURE, london).map((r) => r.airport.iata);
    expect(codes).toEqual(expect.arrayContaining(["LHR", "LCY", "LGW"]));
  });

  test("prefers a large airport over a marginally closer medium one", () => {
    // LCY is ~13km from central London and LHR ~23km. Straight distance would
    // make London City "the" London airport, which is wrong for a trip planner.
    const codes = nearestAirports(FIXTURE, london).map((r) => r.airport.iata);
    expect(codes[0]).toBe("LHR");
  });

  test("reports true distance, not the size-adjusted ranking score", () => {
    const lhr = nearestAirports(FIXTURE, london).find((r) => r.airport.iata === "LHR");
    // ~23km from central London; the 15km size bonus must not leak into `km`.
    expect(lhr?.km).toBeGreaterThan(18);
    expect(lhr?.km).toBeLessThan(30);
  });

  test("returns an empty list when nothing is in range", () => {
    // Point Nemo — the most remote place in the ocean.
    expect(nearestAirports(FIXTURE, { lat: -48.876, lon: -123.393 })).toEqual([]);
  });

  test("honours a tightened radius", () => {
    // Jinan's own airport is ~30km out, so a 10km radius must find nothing.
    expect(nearestAirports(FIXTURE, jinan, { radiusKm: 10 })).toEqual([]);
    expect(nearestAirports(FIXTURE, jinan, { radiusKm: 60 })[0].airport.iata).toBe("TNA");
  });

  test("honours the limit", () => {
    expect(nearestAirports(FIXTURE, london, { limit: 1 })).toHaveLength(1);
  });

  test("the default radius is the documented one", () => {
    expect(DEFAULT_AIRPORT_RADIUS_KM).toBe(150);
  });

  test("is deterministic when two airports rank identically", () => {
    const a = nearestAirports(FIXTURE, london).map((r) => r.airport.iata);
    const b = nearestAirports([...FIXTURE].reverse(), london).map((r) => r.airport.iata);
    expect(a).toEqual(b);
  });
});
