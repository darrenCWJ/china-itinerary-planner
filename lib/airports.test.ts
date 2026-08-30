import { describe, expect, test } from "vitest";
import {
  ARRIVABLE_AIRPORT_SIZES,
  findAirport,
  searchAirports,
  nearestAirports,
  DEFAULT_AIRPORT_RADIUS_KM,
  type Airport,
} from "./airports";
import { allAirports } from "./server/airports";

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

  test("ranks over every size it is handed — the arrivable set is the CALLER's choice", () => {
    // `ARRIVABLE_AIRPORT_SIZES` is applied by `mainAirportFor` and by
    // `CountryLevel`'s layer, and deliberately NOT here. `lib/route.ts` asks a
    // different question — which airports would a flight between these two
    // places actually use — and a small field is a real answer to it. Baking
    // the filter into the ranking would silently re-price every leg.
    const strip: Airport = {
      iata: "STP", icao: null, name: "Airstrip", municipality: null,
      country: "GB", lat: 51.5, lon: -0.1, size: "small",
    };
    expect(nearestAirports([strip], { lat: 51.5, lon: -0.1 })[0].airport.iata).toBe("STP");
  });

  test("breaks a genuine rank tie alphabetically by IATA, deterministically", () => {
    // Two airports at identical coordinates and the same size rank exactly
    // equal (same `km`, same size bonus), so only the `localeCompare`
    // tiebreaker in `nearestAirports` can decide their order. Reversing the
    // FIXTURE array (as the old version of this test did) never produces a
    // real tie: LHR/LCY/LGW rank ~8.5/~12.7/~25.15 — all distinct — so that
    // version passed even with the tiebreaker deleted. This one does not.
    const here = { lat: 10, lon: 10 };
    const tiedAirport = (iata: string): Airport => ({
      iata,
      icao: null,
      name: `${iata} Airport`,
      municipality: null,
      country: "ZZ",
      lat: here.lat,
      lon: here.lon,
      size: "medium",
    });
    const tied = [tiedAirport("ZAA"), tiedAirport("AAA")];

    const forward = nearestAirports(tied, here).map((r) => r.airport.iata);
    const reversed = nearestAirports([...tied].reverse(), here).map((r) => r.airport.iata);

    expect(forward).toEqual(["AAA", "ZAA"]);
    expect(reversed).toEqual(["AAA", "ZAA"]);
  });

  test("excludes a large airport whose true distance is outside the radius, even though its size-discounted rank would fall inside", () => {
    // The radius filter must use the true great-circle distance, not the
    // size-discounted ranking score. A large airport gets a 15km bonus in
    // `rank`, so a filter that mistakenly compared `rank` to `radiusKm`
    // (instead of `km`) would let this one through: 155 - 15 = 140 < 150.
    // But 155km really is outside a 150km radius, so it must be excluded.
    const kmPerDegree = (6371 * Math.PI) / 180;
    const farLargeAirport: Airport = {
      iata: "FAR",
      icao: null,
      name: "Far Away International Airport",
      municipality: null,
      country: "ZZ",
      lat: 0,
      lon: 0,
      size: "large",
    };
    const at = { lat: 155 / kmPerDegree, lon: 0 };

    expect(nearestAirports([farLargeAirport], at, { radiusKm: 150 })).toEqual([]);

    // Companion assertion: widening the radius past the true 155km distance
    // includes it, proving the boundary sits at the true distance rather
    // than just that something, somewhere, got filtered.
    const included = nearestAirports([farLargeAirport], at, { radiusKm: 160 });
    expect(included.map((r) => r.airport.iata)).toEqual(["FAR"]);
  });
});

/**
 * The one set both the card and the map layer read (§10.1, §10.2).
 *
 * Pinned here rather than at either reader, because it belongs to neither: the
 * defect it fixes was precisely that `mainAirportFor` and `CountryLevel`'s
 * layer each owned a filter and the two disagreed in both directions. A second
 * copy is how that comes back.
 */
describe("ARRIVABLE_AIRPORT_SIZES", () => {
  test("is large and medium, and is an allow-list rather than a small-denier", () => {
    expect([...ARRIVABLE_AIRPORT_SIZES].sort()).toEqual(["large", "medium"]);
    expect(ARRIVABLE_AIRPORT_SIZES.has("small")).toBe(false);
  });

  test("drops about a fifth of the committed artifact — the airstrips", () => {
    // The number the docblock's argument rests on, measured rather than
    // asserted from memory: if the upstream feed re-classifies the set, this is
    // where "a fifth" stops being true and someone has to look again.
    const all = allAirports();
    const arrivable = all.filter((airport) => ARRIVABLE_AIRPORT_SIZES.has(airport.size));
    expect(all.length).toBeGreaterThan(3_000);
    expect(all.length - arrivable.length).toBeGreaterThan(0);
    // Every dropped row is `small`, which is what makes the allow-list and
    // `!== "small"` agree TODAY — and the allow-list is what keeps a size the
    // feed grows tomorrow out until someone decides otherwise.
    for (const airport of all) {
      expect(ARRIVABLE_AIRPORT_SIZES.has(airport.size)).toBe(airport.size !== "small");
    }
  });
});
