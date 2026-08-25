import { describe, expect, test } from "vitest";
import { DESTINATIONS, getDestination } from "./index";

/**
 * The curated set's country claim, made explicit.
 *
 * Until the worldwide catalog, `Destination.country` was optional and four
 * separate call sites read an absent one as `"CN"` — which meant a Japanese
 * destination added later would have been offered while browsing China, and no
 * type error would have said so. The field is required now; this file states
 * what the sixteen entries actually answer, so the answer is data rather than
 * a default.
 */

describe("DESTINATIONS", () => {
  test("has sixteen entries with unique ids", () => {
    expect(DESTINATIONS).toHaveLength(16);
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(16);
  });

  test("every destination names its country explicitly", () => {
    const missing = DESTINATIONS.filter((d) => !/^[A-Z]{2}$/.test(d.country)).map((d) => d.id);
    expect(missing, `destinations with no ISO alpha-2 country: ${missing.join(", ")}`).toEqual([]);
  });

  test("all sixteen are in China, which is what the region labels assume", () => {
    // `regionForProvinceText` and REGION_MONTHS are China-only tables, and
    // `region: "North"` means nothing anywhere else. The day this stops being
    // true, this test is the thing that says so.
    expect([...new Set(DESTINATIONS.map((d) => d.country))]).toEqual(["CN"]);
  });

  test("getDestination still resolves by id", () => {
    expect(getDestination("suzhou")?.country).toBe("CN");
    expect(getDestination("definitely-not-real")).toBeUndefined();
  });
});
