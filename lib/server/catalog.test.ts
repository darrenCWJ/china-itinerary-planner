import { describe, expect, test } from "vitest";
import { buildItinerary } from "../itinerary";
import type { Destination } from "../types";
import {
  catalogCityToDestination,
  geoNamesCityToDestination,
  resolveDestinations,
  type CatalogCity,
} from "./catalog";

function city(overrides: Partial<CatalogCity> = {}): CatalogCity {
  return {
    qid: "Q123456",
    name: "Luoyang",
    localName: "洛阳",
    province: "Henan",
    country: "CN",
    lat: 34.6,
    lon: 112.4,
    population: 7000000,
    description: "Luoyang is a city in Henan known for the Longmen Grottoes. It was an ancient capital.",
    interests: ["history"],
    image: null,
    level: "prefecture",
    ...overrides,
  };
}

describe("catalogCityToDestination", () => {
  test("builds a plannable destination with generic activities when no attractions exist", () => {
    const dest = catalogCityToDestination(city());
    expect(dest.id).toBe("Q123456");
    expect(dest.region).toBe("Central");
    expect(dest.country).toBe("CN");
    expect(dest.activities.length).toBeGreaterThanOrEqual(3);
    expect(dest.tagline).toContain("Luoyang");
    expect(dest.suggestedDays[0]).toBeGreaterThanOrEqual(1);
  });

  test("maps provinces to app regions", () => {
    expect(catalogCityToDestination(city({ province: "Gansu" })).region).toBe("Northwest");
    expect(catalogCityToDestination(city({ province: "Zhejiang" })).region).toBe("East");
    expect(catalogCityToDestination(city({ province: null, name: "Lhasa", description: null })).region).toBe(
      "Central"
    );
  });

  test("uses the province verbatim outside China rather than a China region", () => {
    // `regionForProvinceText` is a China-only keyword table and `?? "Central"`
    // is one of China's own seven — which `mapTypes.isChinaRegion` then treats
    // as real, giving a Swiss town a Chinese month-fit. Outside China the
    // admin-1 name IS the region label (lib/types.ts:57-63).
    const zermatt = catalogCityToDestination(
      city({ qid: "Q27494", name: "Zermatt", province: "Valais", country: "CH" })
    );
    expect(zermatt.region).toBe("Valais");
    expect(zermatt.country).toBe("CH");
  });

  test("a destination with no foods and no evening activities still gets a dinner suggestion", () => {
    const dest: Destination = {
      ...catalogCityToDestination(city()),
      foods: [],
      activities: [
        { name: "Day sight", interests: ["history"], slots: 1, timeOfDay: "day" },
        { name: "Another day sight", interests: ["nature"], slots: 1, timeOfDay: "day" },
      ],
    };
    const plan = buildItinerary(
      {
        destinationIds: [dest.id],
        days: 2,
        season: "autumn",
        adults: 2,
        kids: 0,
        interests: [],
      },
      [dest]
    );
    const evening = plan.days[0].items.find((i) => i.slot === "evening");
    expect(evening).toBeDefined();
    expect(evening!.title.toLowerCase()).toContain("local speciality");
  });

  test("claims no seasons — the map derives them from the climate artifact (§9.6)", () => {
    // `["spring", "autumn"]` was a northern-hemisphere guess stamped on
    // Sydney and Reykjavík alike, and the trip map read it as `great` every
    // northern spring. `[]` is the value `mapTypes.fitForPlace` reads as
    // "nobody has said", and app/plan/page.tsx already stamps it on a
    // hand-typed place.
    const dest = catalogCityToDestination(city());
    expect(dest.bestSeasons).toEqual([]);
    expect(dest.seasonNotes).toEqual({});
  });
});

describe("geoNamesCityToDestination", () => {
  // The real committed row for G3941584, verbatim. Its admin-1 is "Cuzco
  // Department" and not "Cusco": a fixture whose name and region read the same
  // cannot tell a correct mapping from one that wires `region` to `name`.
  const cusco = {
    id: "G3941584",
    name: "Cusco",
    country: "PE",
    lat: -13.53188,
    lon: -71.96701,
    region: "Cuzco Department",
  };

  test("builds a plannable destination from an index entry alone", () => {
    // The server has no shard and no attractions for a GeoNames city — it has
    // exactly the six fields the bundled index carries. What it produces has
    // to be plannable anyway, because this is what `/api/destinations/resolve`
    // hands the itinerary generator.
    const dest = geoNamesCityToDestination(cusco);
    expect(dest.id).toBe("G3941584");
    expect(dest.name).toBe("Cusco");
    expect(dest.country).toBe("PE");
    expect(dest.lat).toBe(-13.53188);
    expect(dest.lon).toBe(-71.96701);
    expect(dest.region).toBe("Cuzco Department");
    expect(dest.activities.length).toBeGreaterThanOrEqual(3);
    expect(dest.suggestedDays[0]).toBeGreaterThanOrEqual(1);
    expect(dest.suggestedDays[1]).toBeGreaterThanOrEqual(dest.suggestedDays[0]);
  });

  test("names the city in its tagline, so a plan card is not blank", () => {
    expect(geoNamesCityToDestination(cusco).tagline).toContain("Cusco");
  });

  test("falls back to an empty region rather than inventing a Chinese one", () => {
    // "Central" is one of China's seven, and `mapTypes.isChinaRegion` would
    // accept it — handing a Peruvian city a Chinese month-fit.
    expect(geoNamesCityToDestination({ ...cusco, region: null }).region).toBe("");
  });

  test("produces an itinerary the generator can actually schedule", () => {
    const dest = geoNamesCityToDestination(cusco);
    const plan = buildItinerary(
      { destinationIds: [dest.id], days: 2, season: "autumn", adults: 2, kids: 0, interests: [] },
      [dest]
    );
    expect(plan.days).toHaveLength(2);
    expect(plan.days[0].items.length).toBeGreaterThan(0);
  });

  test("claims no seasons either (§9.6)", () => {
    const dest = geoNamesCityToDestination(cusco);
    expect(dest.bestSeasons).toEqual([]);
    expect(dest.seasonNotes).toEqual({});
  });
});

describe("resolveDestinations", () => {
  test("resolves curated ids and drops unknown ids", () => {
    const resolved: Destination[] = resolveDestinations(["beijing", "definitely-not-real"]);
    expect(resolved.map((d) => d.id)).toEqual(["beijing"]);
  });

  test("resolves a GeoNames id out of the bundled index", () => {
    // This is the server half of the acceptance test: a tap on Cusco reaches
    // `/api/destinations/resolve?ids=G3941584`, and `public/` is unreadable
    // from the lambda, so the bundled index is the only thing that can answer.
    const resolved = resolveDestinations(["G3941584"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ id: "G3941584", name: "Cusco", country: "PE" });
  });

  test("mixes curated, catalog and GeoNames ids in one call", () => {
    const resolved = resolveDestinations(["beijing", "G2657928", "nope"]);
    expect(resolved.map((d) => d.id)).toEqual(["beijing", "G2657928"]);
    expect(resolved.map((d) => d.country)).toEqual(["CN", "CH"]);
  });

  test("drops a well-formed GeoNames id that the index does not hold", () => {
    // The only id shape that reaches the GeoNames branch and finds nothing.
    // "definitely-not-real" and "nope" above both fail `isGeoNamesId` and go
    // down the *catalog* branch instead, so neither exercises the missing-entry
    // arm — mutate it to `geoNamesCityToDestination(entry!)` and they stay
    // green while this throws. G999999999 is absent from all 58,742 rows of
    // data/cities-index.json.
    //
    // Worth its own test because a dropped id is a city the user picked
    // silently vanishing from their plan: dropping is the intended answer, and
    // throwing would take the rest of the ids down with it.
    expect(() => resolveDestinations(["G999999999"])).not.toThrow();
    expect(resolveDestinations(["G999999999"])).toEqual([]);
    expect(resolveDestinations(["beijing", "G999999999", "G2657928"]).map((d) => d.id)).toEqual([
      "beijing",
      "G2657928",
    ]);
  });
});
