import { describe, expect, it } from "vitest";
import { resolveTripSeason } from "./tripSeason";

/**
 * Spec §5.2: season derivation moves server-side behind the country profile.
 *
 * The client computes a season from a month using lib/months.ts, which is
 * hardcoded northern-hemisphere. That is wrong for half the planet and the app
 * is going to all countries, so when the client sends the month it picked, the
 * server derives the season itself and ignores the one it was told.
 */

describe("resolveTripSeason", () => {
  it("keeps the client season when no month was sent", () => {
    // Old clients send no month at all. Their season is all there is.
    expect(resolveTripSeason("summer", undefined, "CN")).toBe("summer");
  });

  it("derives the season from the month for a northern country", () => {
    expect(resolveTripSeason("winter", 7, "CN")).toBe("summer");
  });

  it("overrides a contradictory client season", () => {
    // The whole point: the month is the fact, the season is the client's
    // interpretation of it, and the client interprets it with a northern table.
    expect(resolveTripSeason("summer", 1, "CN")).toBe("winter");
  });

  it("gets the southern hemisphere right, which the client cannot", () => {
    // January in Australia is summer. lib/months.ts says winter, and that is
    // exactly the bug §5.2 objects to.
    expect(resolveTripSeason("winter", 1, "AU")).toBe("summer");
    expect(resolveTripSeason("summer", 7, "AU")).toBe("winter");
  });

  it("falls back to the client season on an out-of-range month", () => {
    // The schema rejects these before they reach here, so this is defence in
    // depth: a nonsense month must not produce a nonsense season.
    expect(resolveTripSeason("autumn", 0, "CN")).toBe("autumn");
    expect(resolveTripSeason("autumn", 13, "CN")).toBe("autumn");
    expect(resolveTripSeason("autumn", 6.5, "CN")).toBe("autumn");
  });

  it("still derives for a country with no researched profile", () => {
    // getCountryProfile is total — an unresearched country gets the neutral
    // northern profile rather than throwing, so derivation never fails.
    expect(resolveTripSeason("winter", 7, "ZZ")).toBe("summer");
  });

  it("is case-insensitive about the country code", () => {
    expect(resolveTripSeason("winter", 1, "au")).toBe("summer");
  });
});
