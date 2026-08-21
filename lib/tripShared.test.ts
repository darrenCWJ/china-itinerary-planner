import { describe, expect, test } from "vitest";
import { tripCountry } from "./tripShared";
import type { TripData } from "./tripShared";
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
    expect(tripCountry(tripData({}))).toBe("CN");
  });

  test("reads the stored country once a trip carries one", () => {
    expect(tripCountry(tripData({ country: "JP" }))).toBe("JP");
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
