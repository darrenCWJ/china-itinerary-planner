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

import { attributeFeature, buildAlpha2Index } from "./build-provinces.mjs";

/** A map_units feature collection, in the shape Natural Earth ships. */
function mapUnits(rows: Array<Record<string, string>>) {
  return { type: "FeatureCollection", features: rows.map((properties) => ({ properties })) };
}

describe("buildAlpha2Index", () => {
  test("resolves GU_A3 through ISO_A2_EH, because ISO_A2 is not always a country code", () => {
    // 67 of the real file's 298 rows carry either "-99" or an "FR-971"-style
    // value in ISO_A2. Reading that field folds Guadeloupe, Martinique, French
    // Guiana, Réunion and Mayotte into the pseudo-code "FR-971" — five of the
    // 13 countries Phase 4 exists to reach, lost to a field choice.
    const index = buildAlpha2Index(mapUnits([
      { GU_A3: "GLP", ADM0_A3: "FRA", ISO_A2: "FR-971", ISO_A2_EH: "GP", NAME: "Guadeloupe" },
      { GU_A3: "FXX", ADM0_A3: "FRA", ISO_A2: "FR", ISO_A2_EH: "FR", NAME: "France" },
      { GU_A3: "SOL", ADM0_A3: "SOL", ISO_A2: "-99", ISO_A2_EH: "-99", NAME: "Somaliland" },
    ]));
    expect(index.byGuA3.get("GLP")).toBe("GP");
    expect(index.byGuA3.get("FXX")).toBe("FR");
    // Neither field yields a code, so the row contributes nothing rather than
    // contributing "-99" as though it were one.
    expect(index.byGuA3.has("SOL")).toBe(false);
  });

  test("keeps the first ADM0_A3 mapping and does not let a later unit overwrite it", () => {
    const index = buildAlpha2Index(mapUnits([
      { GU_A3: "FXX", ADM0_A3: "FRA", ISO_A2: "FR", ISO_A2_EH: "FR" },
      { GU_A3: "GLP", ADM0_A3: "FRA", ISO_A2: "FR-971", ISO_A2_EH: "GP" },
    ]));
    expect(index.byAdm0A3.get("FRA")).toBe("FR");
  });
});

describe("attributeFeature", () => {
  const index = buildAlpha2Index(mapUnits([
    { GU_A3: "GLP", ADM0_A3: "FRA", ISO_A2: "FR-971", ISO_A2_EH: "GP" },
    { GU_A3: "FXX", ADM0_A3: "FRA", ISO_A2: "FR", ISO_A2_EH: "FR" },
    { GU_A3: "NLX", ADM0_A3: "NLD", ISO_A2: "-99", ISO_A2_EH: "NL" },
    { GU_A3: "CHN", ADM0_A3: "CHN", ISO_A2: "CN", ISO_A2_EH: "CN" },
  ]));

  test("prefers gu_a3, which is what separates Guadeloupe from France", () => {
    expect(attributeFeature(
      { adm1_code: "FRA-4603", gu_a3: "GLP", iso_3166_2: "FR-GP", iso_a2: "FR", adm0_a3: "FRA" },
      index
    )).toBe("GP");
  });

  test("falls back to the iso_3166_2 prefix when gu_a3 resolves to nothing", () => {
    expect(attributeFeature(
      { adm1_code: "XXX-1", gu_a3: "ZZZ", iso_3166_2: "CN-11", iso_a2: "-99", adm0_a3: "ZZZ" },
      index
    )).toBe("CN");
  });

  test("routes the three Caribbean-Netherlands units to BQ by explicit rule", () => {
    // They carry gu_a3 = NLD, so every general rule sends them to NL. ISO 3166
    // gives them their own alpha-2, and Phase 4 targets it.
    for (const code of ["NL-BQ1", "NL-BQ2", "NL-BQ3"]) {
      expect(attributeFeature(
        { adm1_code: "NLD-" + code, gu_a3: "NLD", iso_3166_2: code, iso_a2: "NL", adm0_a3: "NLD" },
        index
      )).toBe("BQ");
    }
  });

  test("returns null for a feature no rule reaches", () => {
    // Seven real features land here, and every one is a row of §7.2's override
    // table: Northern Cyprus, Somaliland, Akrotiri, Dhekelia, Guantánamo,
    // Siachen and the Spratlys.
    expect(attributeFeature(
      { adm1_code: "SOL+00?", gu_a3: "SOL", iso_3166_2: "-99-X11~", iso_a2: "-99", adm0_a3: "SOL" },
      index
    )).toBeNull();
  });

  test("never returns a value that is not a two-letter code", () => {
    // The guard that would have caught the ISO_A2 defect. Everything
    // downstream uses this as a filename.
    const odd = attributeFeature(
      { adm1_code: "X", gu_a3: "GLP", iso_3166_2: "-99-X01~", iso_a2: "FR-971", adm0_a3: "FRA" },
      index
    );
    expect(odd).toMatch(/^[A-Z]{2}$/);
  });
});
