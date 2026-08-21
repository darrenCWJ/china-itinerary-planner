import { describe, expect, test } from "vitest";
import { buildItinerary } from "../itinerary";
import type { Destination } from "../types";
import { catalogCityToDestination, resolveDestinations, type CatalogCity } from "./catalog";

function city(overrides: Partial<CatalogCity> = {}): CatalogCity {
  return {
    qid: "Q123456",
    name: "Luoyang",
    localName: "洛阳",
    province: "Henan",
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
});

describe("resolveDestinations", () => {
  test("resolves curated ids and drops unknown ids", () => {
    const resolved: Destination[] = resolveDestinations(["beijing", "definitely-not-real"]);
    expect(resolved.map((d) => d.id)).toEqual(["beijing"]);
  });
});
