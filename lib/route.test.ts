import { describe, expect, test } from "vitest";
import { estimateLeg, suggestRoute, TRANSPORT, type RoutePlace } from "./route";
import type { Airport } from "./airports";

const beijing: RoutePlace = { id: "beijing", name: "Beijing", lat: 39.904, lon: 116.407 };
const xian: RoutePlace = { id: "xian", name: "Xi'an", lat: 34.342, lon: 108.94 };
const shanghai: RoutePlace = { id: "shanghai", name: "Shanghai", lat: 31.23, lon: 121.474 };
const chengdu: RoutePlace = { id: "chengdu", name: "Chengdu", lat: 30.657, lon: 104.066 };
const urumqi: RoutePlace = { id: "urumqi", name: "Ürümqi", lat: 43.826, lon: 87.616 };
/** Hand-typed, no location attached (spec §5.6). */
const village: RoutePlace = { id: "village", name: "Grandma’s village", lat: null, lon: null };

describe("estimateLeg", () => {
  test("Beijing–Shanghai distance is roughly 1070 km by rail", () => {
    const leg = estimateLeg(beijing, shanghai);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.km).toBeGreaterThan(1000);
    expect(leg.km).toBeLessThan(1150);
    expect(leg.mode).toBe("rail");
    expect(leg.hours).toBeGreaterThanOrEqual(4);
    expect(leg.hours).toBeLessThanOrEqual(7);
  });

  test("legs beyond 1200 km are flagged as flights", () => {
    const leg = estimateLeg(beijing, urumqi);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.km).toBeGreaterThan(2000);
    expect(leg.mode).toBe("flight");
  });
});

describe("TRANSPORT", () => {
  test("exposes the constants the estimator is built on", () => {
    expect(TRANSPORT.railKmh).toBe(230);
    expect(TRANSPORT.flightThresholdKm).toBe(1200);
    expect(TRANSPORT.flightKmh).toBe(700);
    expect(TRANSPORT.railBufferH).toBe(0.75);
    expect(TRANSPORT.flightBufferH).toBe(2.5);
  });

  test("estimateLeg flips mode either side of the exported threshold", () => {
    // Along a meridian the great-circle distance is linear in latitude, so a
    // leg of an exact length can be constructed from the exported threshold
    // rather than from a copied-out number.
    const kmPerDegree = (6371 * Math.PI) / 180;
    const northOf = (km: number): RoutePlace => ({
      id: `p${km}`,
      name: `${km} km north`,
      lat: km / kmPerDegree,
      lon: 0,
    });
    const origin: RoutePlace = { id: "origin", name: "Origin", lat: 0, lon: 0 };

    // Narrowed through a helper so the mode assertions stay one-liners.
    const modeOf = (to: RoutePlace) => {
      const leg = estimateLeg(origin, to);
      return leg.kind === "estimated" ? leg.mode : "unknown";
    };

    expect(modeOf(northOf(TRANSPORT.flightThresholdKm - 5))).toBe("rail");
    expect(modeOf(northOf(TRANSPORT.flightThresholdKm + 5))).toBe("flight");
  });
});

describe("suggestRoute", () => {
  test("fewer than two places yields no legs", () => {
    expect(suggestRoute([]).legs).toHaveLength(0);
    expect(suggestRoute([beijing]).order).toEqual([beijing]);
  });

  test("orders places along a sensible geographic path", () => {
    const { order, legs } = suggestRoute([shanghai, chengdu, beijing, xian]);
    const ids = order.map((p) => p.id);
    // Xi'an and Chengdu are neighbours; Beijing and Shanghai are the coasts.
    // A sane tour never sandwiches the far-west pair between the two coasts.
    const xianIdx = ids.indexOf("xian");
    const chengduIdx = ids.indexOf("chengdu");
    expect(Math.abs(xianIdx - chengduIdx)).toBe(1);
    expect(legs).toHaveLength(3);
  });

  test("is deterministic for the same input in any order", () => {
    const a = suggestRoute([beijing, xian, shanghai, chengdu]);
    const b = suggestRoute([chengdu, shanghai, xian, beijing]);
    expect(a.order.map((p) => p.id)).toEqual(b.order.map((p) => p.id));
    expect(a.totalKm).toBe(b.totalKm);
  });

  test("collects rail-friendly note when every leg is short", () => {
    const { notes } = suggestRoute([shanghai, { id: "suzhou", name: "Suzhou", lat: 31.299, lon: 120.585 }]);
    expect(notes.join(" ")).toMatch(/rail/i);
  });

  test("flags long legs with a flight note", () => {
    const { notes } = suggestRoute([beijing, urumqi]);
    expect(notes.join(" ")).toMatch(/flying/i);
  });

  test("puts a coordinate-less place at the end of the order", () => {
    // Spec §5.6: it still takes days and budget, but it contributes no distance,
    // so it cannot participate in a nearest-neighbour tour. Last is the only
    // position that does not distort the legs around it.
    const { order } = suggestRoute([shanghai, village, beijing]);

    expect(order[order.length - 1].id).toBe("village");
    expect(order.slice(0, 2).map((p) => p.id).sort()).toEqual(["beijing", "shanghai"]);
  });

  test("counts only measurable legs in totalKm", () => {
    const withVillage = suggestRoute([beijing, shanghai, village]);
    const withoutVillage = suggestRoute([beijing, shanghai]);

    // Adding an unlocatable place must not inflate or deflate the distance.
    expect(withVillage.totalKm).toBe(withoutVillage.totalKm);
  });

  test("renders the leg into a coordinate-less place as unknown", () => {
    const { legs } = suggestRoute([beijing, shanghai, village]);

    const last = legs[legs.length - 1];
    expect(last.kind).toBe("unknown");
    expect(last.to.id).toBe("village");
  });

  test("keeps two coordinate-less places in deterministic order", () => {
    const other: RoutePlace = { id: "aunt-house", name: "Aunt's house", lat: null, lon: null };
    const a = suggestRoute([shanghai, village, other]);
    const b = suggestRoute([other, village, shanghai]);

    expect(a.order.map((p) => p.id)).toEqual(b.order.map((p) => p.id));
  });

  test("handles a selection with no coordinates at all", () => {
    const other: RoutePlace = { id: "aunt-house", name: "Aunt's house", lat: null, lon: null };
    const { order, legs, totalKm } = suggestRoute([village, other]);

    expect(order).toHaveLength(2);
    expect(totalKm).toBe(0);
    expect(legs.every((l) => l.kind === "unknown")).toBe(true);
  });

  test("omits the all-rail note when a leg cannot be measured", () => {
    // The note claims every leg is rail-friendly. One leg being unmeasurable
    // means that claim is unsupported, not true.
    const { notes } = suggestRoute([shanghai, { id: "suzhou", name: "Suzhou", lat: 31.299, lon: 120.585 }, village]);

    expect(notes.join(" ")).not.toMatch(/Every leg/i);
  });
});

/**
 * Two Chinese cities and their airports, plus a city with no airport at all.
 * Real coordinates, so the arithmetic below is checkable by hand.
 */
const AIRPORTS: Airport[] = [
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
  { iata: "URC", icao: "ZWWW", name: "Ürümqi Diwopu International Airport", municipality: "Ürümqi", country: "CN", lat: 43.907, lon: 87.474, size: "large" },
  { iata: "SHA", icao: "ZSSS", name: "Shanghai Hongqiao International Airport", municipality: "Shanghai", country: "CN", lat: 31.198, lon: 121.336, size: "large" },
];

/** Far from every airport in the fixture — the forced-rail case. */
const remote: RoutePlace = { id: "remote", name: "Remote valley", lat: 30.0, lon: 95.0 };

describe("estimateLeg with airports", () => {
  test("without airports it behaves exactly as before", () => {
    const withoutFlight = estimateLeg(beijing, urumqi);
    const emptyFlight = estimateLeg(beijing, urumqi, []);
    expect(emptyFlight).toEqual(withoutFlight);

    // A flight pair alone leaves the rail branch of `estimateLeg` unpinned by
    // this equivalence — cover a rail pair too so the property holds for both
    // modes, not just the one this test happened to pick first.
    const withoutRail = estimateLeg(beijing, shanghai);
    const emptyRail = estimateLeg(beijing, shanghai, []);
    expect(emptyRail).toEqual(withoutRail);
  });

  test("a long leg between two served cities resolves the airport pair", () => {
    const leg = estimateLeg(beijing, urumqi, AIRPORTS);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.mode).toBe("flight");
    expect(leg.airports?.from.iata).toBe("PEK");
    expect(leg.airports?.to.iata).toBe("URC");
  });

  test("a flight's hours include ground transfer at both ends", () => {
    const bare = estimateLeg(beijing, urumqi);
    const aware = estimateLeg(beijing, urumqi, AIRPORTS);
    if (bare.kind !== "estimated" || aware.kind !== "estimated") throw new Error("expected estimates");
    // Both airports are well outside their city centres, so the airport-aware
    // estimate must be longer than the one that pretends you board downtown.
    expect(aware.hours).toBeGreaterThan(bare.hours);

    // A relational check alone cannot catch the transfer term being wildly
    // wrong (e.g. `*` instead of `/` in transferH) — `aware.hours` would
    // still be greater than `bare.hours`, just absurdly so. Pin the exact
    // value so the derivation is auditable instead of a moving target:
    //   cityKm 2411, airportKm 2430 (PEK → URC)
    //   Beijing → PEK 25 km, Ürümqi → URC 15 km
    //   transferH = (25 + 15) / 60 = 0.6667
    //   aware.hours = roundHalf(2430/700 + 2.5 + 0.6667)
    //               = roundHalf(3.4714 + 2.5 + 0.6667)
    //               = roundHalf(6.6381) = 6.5
    //   bare.hours (city-to-city, no ground transfer) = roundHalf(2411/700 + 2.5) = 6.0
    expect(aware.hours).toBe(6.5);
  });

  test("km stays city-to-city even when the flight is airport-to-airport", () => {
    const bare = estimateLeg(beijing, urumqi);
    const aware = estimateLeg(beijing, urumqi, AIRPORTS);
    if (bare.kind !== "estimated" || aware.kind !== "estimated") throw new Error("expected estimates");
    // The distance the user travels between cities has not changed; only the
    // duration has. Swapping km to the airport pair would silently restate the
    // trip's total distance.
    expect(aware.km).toBe(bare.km);
  });

  test("a leg into a city with no airport in range is forced to rail", () => {
    const leg = estimateLeg(beijing, remote, AIRPORTS);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.mode).toBe("rail");
    expect(leg.airports).toBeUndefined();
    // It is far enough that distance alone would have said "fly".
    expect(leg.km).toBeGreaterThan(TRANSPORT.flightThresholdKm);
    expect(leg.groundedForLackOfAirport).toBe(true);
  });

  test("a short leg between two served cities is still rail", () => {
    const leg = estimateLeg(beijing, { id: "tianjin", name: "Tianjin", lat: 39.084, lon: 117.201 }, AIRPORTS);
    if (leg.kind !== "estimated") throw new Error("expected an estimate");
    expect(leg.mode).toBe("rail");
    expect(leg.groundedForLackOfAirport).toBeUndefined();
  });

  test("an unlocated place is still unknown, airports or not", () => {
    expect(estimateLeg(beijing, village, AIRPORTS).kind).toBe("unknown");
  });
});

describe("TRANSPORT gains the airport constants", () => {
  test("reports what the airport-aware estimates assume", () => {
    expect(TRANSPORT.groundTransferKmh).toBe(60);
    expect(TRANSPORT.airportSearchRadiusKm).toBe(150);
  });
});

describe("suggestRoute with airports", () => {
  test("notes a leg that had to stay on the ground", () => {
    const { notes } = suggestRoute([beijing, remote], AIRPORTS);
    expect(notes.join(" ")).toMatch(/no airport/i);
    // The exclusion this task is named for: a grounded leg must not also earn
    // the all-rail note. Deleting the exclusion from the predicate leaves
    // this test — and the rest of the suite — green, because nothing here
    // previously checked for the note's absence.
    expect(notes.join(" ")).not.toMatch(/Every leg/i);
  });

  test("all-rail note is not claimed when close airports mask a long city-to-city hop", () => {
    // The door Finding 1b found: airports can sit closer together than the
    // cities they serve. Two cities just over FLIGHT_THRESHOLD_KM apart, with
    // airports pulled toward each other so the airport-to-airport hop is
    // under the threshold, comes back mode "rail" and *not* grounded (both
    // ends have an airport in range) — a leg the grounded flag cannot see.
    //
    // Built along a meridian, same idiom as "estimateLeg flips mode either
    // side of the exported threshold" above: great-circle distance is linear
    // in latitude there, so city-to-city and airport-to-airport distances can
    // be placed exactly instead of guessed at.
    //   cityA lat 0; airportA 100 km north of cityA
    //   cityB 1250 km north of cityA; airportB 100 km south of cityB
    //   -> city-to-city 1250 km (over the 1200 km threshold)
    //   -> airport-to-airport 1050 km (under the threshold)
    //   -> both ground transfers 100 km (comfortably inside the 150 km radius)
    // Verified numerically: haversineKm gives exactly 1250, 1050 and 100/100.
    const kmPerDegree = (6371 * Math.PI) / 180;
    const cityA: RoutePlace = { id: "meridian-city-a", name: "Meridian City A", lat: 0, lon: 0 };
    const cityB: RoutePlace = {
      id: "meridian-city-b",
      name: "Meridian City B",
      lat: 1250 / kmPerDegree,
      lon: 0,
    };
    const airportA: Airport = {
      iata: "NGA",
      icao: null,
      name: "Northgate Airport",
      municipality: "Meridian City A",
      country: "CN",
      lat: 100 / kmPerDegree,
      lon: 0,
      size: "large",
    };
    const airportB: Airport = {
      iata: "SGA",
      icao: null,
      name: "Southgate Airport",
      municipality: "Meridian City B",
      country: "CN",
      lat: (1250 - 100) / kmPerDegree,
      lon: 0,
      size: "large",
    };
    const meridianAirports = [airportA, airportB];

    const leg = estimateLeg(cityA, cityB, meridianAirports);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.mode).toBe("rail");
    expect(leg.groundedForLackOfAirport).toBeUndefined();
    expect(leg.km).toBeGreaterThan(TRANSPORT.flightThresholdKm);

    const { notes } = suggestRoute([cityA, cityB], meridianAirports);
    expect(notes.join(" ")).not.toMatch(/Every leg/i);
  });

  test("without airports the notes are unchanged", () => {
    expect(suggestRoute([beijing, urumqi], []).notes).toEqual(suggestRoute([beijing, urumqi]).notes);
  });
});
