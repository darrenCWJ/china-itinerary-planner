import { describe, expect, test } from "vitest";
import { estimateLeg, suggestRoute, TRANSPORT, type RoutePlace } from "./route";

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
