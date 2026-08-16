import { describe, expect, test } from "vitest";
import { tripCountry } from "./tripShared";
import type { TripData } from "./tripShared";
import type { TripInput } from "./itinerary";
import type { ChinaRegion, Region } from "./types";

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

describe("ChinaRegion alias", () => {
  test("is the same type as Region, so existing consumers are untouched", () => {
    // A compile-time assertion first: the two names have to stay mutually
    // assignable or the "mechanical alias" claim is false and every Region
    // consumer would need touching.
    const asChina: ChinaRegion = "East" satisfies Region;
    const asRegion: Region = asChina;
    expect(asRegion).toBe("East");
  });
});
