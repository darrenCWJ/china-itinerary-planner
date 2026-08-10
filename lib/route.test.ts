import { describe, expect, test } from "vitest";
import { estimateLeg, suggestRoute, type RoutePlace } from "./route";

const beijing: RoutePlace = { id: "beijing", name: "Beijing", lat: 39.904, lon: 116.407 };
const xian: RoutePlace = { id: "xian", name: "Xi'an", lat: 34.342, lon: 108.94 };
const shanghai: RoutePlace = { id: "shanghai", name: "Shanghai", lat: 31.23, lon: 121.474 };
const chengdu: RoutePlace = { id: "chengdu", name: "Chengdu", lat: 30.657, lon: 104.066 };
const urumqi: RoutePlace = { id: "urumqi", name: "Ürümqi", lat: 43.826, lon: 87.616 };

describe("estimateLeg", () => {
  test("Beijing–Shanghai distance is roughly 1070 km by rail", () => {
    const leg = estimateLeg(beijing, shanghai);
    expect(leg.km).toBeGreaterThan(1000);
    expect(leg.km).toBeLessThan(1150);
    expect(leg.mode).toBe("rail");
    expect(leg.hours).toBeGreaterThanOrEqual(4);
    expect(leg.hours).toBeLessThanOrEqual(7);
  });

  test("legs beyond 1200 km are flagged as flights", () => {
    const leg = estimateLeg(beijing, urumqi);
    expect(leg.km).toBeGreaterThan(2000);
    expect(leg.mode).toBe("flight");
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
});
