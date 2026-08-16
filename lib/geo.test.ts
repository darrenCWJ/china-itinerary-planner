import { describe, expect, test } from "vitest";
import { haversineKm, latLonOf } from "./geo";

describe("haversineKm", () => {
  test("measures a known long-haul distance", () => {
    // Beijing → Xi'an is about 910 km great-circle.
    const km = haversineKm({ lat: 39.9, lon: 116.4 }, { lat: 34.26, lon: 108.94 });
    expect(km).toBeGreaterThan(880);
    expect(km).toBeLessThan(940);
  });

  test("is zero for a point against itself", () => {
    expect(haversineKm({ lat: 31.23, lon: 121.47 }, { lat: 31.23, lon: 121.47 })).toBe(0);
  });
});

describe("latLonOf", () => {
  test("passes a fully located place straight through", () => {
    expect(latLonOf({ lat: 39.9, lon: 116.4 })).toEqual({ lat: 39.9, lon: 116.4 });
  });

  test("returns null for an off-map place", () => {
    // A hand-typed place with no coordinates. Refusing to produce a LatLon is
    // the point: distance code downstream then has nothing to estimate from,
    // rather than a fabricated position at 0,0 in the Gulf of Guinea.
    expect(latLonOf({ lat: null, lon: null })).toBeNull();
  });

  test("returns null when only one coordinate is present", () => {
    expect(latLonOf({ lat: 39.9, lon: null })).toBeNull();
    expect(latLonOf({ lat: null, lon: 116.4 })).toBeNull();
  });

  test("treats a real zero coordinate as a location, not as absence", () => {
    // 0,0 is a valid point, and null is the only marker for "unknown" —
    // a falsy check here would silently drop places on the equator.
    expect(latLonOf({ lat: 0, lon: 0 })).toEqual({ lat: 0, lon: 0 });
  });
});
