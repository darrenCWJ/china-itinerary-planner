import { describe, expect, test } from "vitest";
import { buildCountryTopology } from "./build-provinces.mjs";

/** Two adjacent unit squares — a shared edge is what makes this a topology. */
function twoSquares() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature", id: "AAA-1", properties: { name: "Left" },
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      },
      {
        type: "Feature", id: "AAA-2", properties: { name: "Right" },
        geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] },
      },
    ],
  };
}

/**
 * The pipeline returns topojson's wide `GeometryObject` union, on which
 * `geometries` does not exist; what this build always puts under `provinces`
 * is a GeometryCollection. Narrowed here the same way lib/globeTopology.ts:64
 * narrows the committed topologies, so `npx tsc --noEmit` stays clean.
 */
function provinceGeometries(t: ReturnType<typeof buildCountryTopology>) {
  return (t.objects.provinces as unknown as { geometries: Array<{ id?: string | number }> })
    .geometries;
}

describe("buildCountryTopology", () => {
  test("quantises last, so the topology is not already quantised when quantize runs", () => {
    // `quantize` throws `already quantized` if `topology()` was handed a
    // quantisation argument. That is the whole reason the order is fixed.
    const t = buildCountryTopology(twoSquares(), 0);
    expect(t.transform).toBeDefined();
    expect(t.transform!.scale).toHaveLength(2);
  });

  test("strips presimplify's weights even at tolerance 0", () => {
    // presimplify annotates every coordinate with a third element (its
    // triangle-area weight); simplify is what removes them. Treating tol 0 as
    // "skip simplify" ships the weights: measured 25,313,808 B raw across the
    // 246 files instead of 8,906,972, with 12 countries over the gzip cap
    // instead of none.
    const t = buildCountryTopology(twoSquares(), 0);
    for (const arc of t.arcs) {
      for (const point of arc) {
        expect(point).toHaveLength(2);
      }
    }
  });

  test("keeps both features and their ids", () => {
    const t = buildCountryTopology(twoSquares(), 0);
    expect(provinceGeometries(t).map((g) => g.id)).toEqual(["AAA-1", "AAA-2"]);
  });

  test("a non-zero tolerance drops vertices rather than whole units", () => {
    // Spec §8.2: the damage from over-simplifying is a cliff, not a slope — a
    // unit keeps its name, its id and its place in the file and draws nothing.
    // Only CA and RU take a non-zero tolerance, and neither loses a unit.
    const t = buildCountryTopology(twoSquares(), 1e-4);
    expect(provinceGeometries(t)).toHaveLength(2);
  });
});
