import { describe, expect, it } from "vitest";
import { seasonOfMonth } from "./months";
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

  it("gives the wizard preview and the saved trip the same answer for a southern June", () => {
    // The bug this closes, stated as the two calls that used to disagree.
    // app/plan/page.tsx now calls exactly this for the month the user scrubs
    // to, and app/api/trips/route.ts calls it for the month the client then
    // sends — one function, so the preview and the saved trip cannot part
    // company. The wizard used to call the bare `seasonOfMonth` below.
    expect(seasonOfMonth(6)).toBe("summer");
    expect(resolveTripSeason(seasonOfMonth(6), 6, "PE")).toBe("winter");
    // And the arming: the same two calls agree for a northern country, so
    // "they agree" above is a fact about the hemisphere and not about a
    // function that returns one season for everything.
    expect(resolveTripSeason(seasonOfMonth(6), 6, "CN")).toBe("summer");
    expect(resolveTripSeason(seasonOfMonth(6), 6, "CN")).toBe(seasonOfMonth(6));
  });

  it("agrees with the country profile in every month, for both hemispheres", () => {
    // A single month could agree by accident — two of the four seasons match
    // across hemispheres at the boundaries. Sweeping all twelve does not.
    for (let month = 1; month <= 12; month++) {
      const north = resolveTripSeason("autumn", month, "CN");
      const south = resolveTripSeason("autumn", month, "PE");
      expect(north).toBe(seasonOfMonth(month));
      expect(south).toBe(seasonOfMonth(((month + 5) % 12) + 1));
    }
  });
});
