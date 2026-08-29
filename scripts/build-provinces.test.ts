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
    //
    // The fixture has to BRACKET the tolerance or this test cannot fail for
    // any value of it: [0.5, 0.00005] sits almost on the bottom edge, so its
    // Visvalingam weight (~2.5e-5) is under 1e-4 while every corner's (0.5) is
    // far above. At tol 0 it survives; at 1e-4 it goes and the squares remain.
    const withSliver = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature", id: "AAA-1", properties: { name: "Left" },
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [0.5, 0.00005], [1, 0], [1, 1], [0, 1], [0, 0]]],
          },
        },
        {
          type: "Feature", id: "AAA-2", properties: { name: "Right" },
          geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] },
        },
      ],
    };
    const vertices = (t: ReturnType<typeof buildCountryTopology>) =>
      t.arcs.reduce((n: number, arc: unknown[]) => n + arc.length, 0);

    const kept = buildCountryTopology(withSliver, 0);
    const simplified = buildCountryTopology(withSliver, 1e-4);

    // Both units survive — that is the cliff §8.2 warns about not happening here.
    expect(provinceGeometries(simplified)).toHaveLength(2);
    // And the tolerance did something, which the previous version of this test
    // never checked: it could not fail for any tolerance at all.
    expect(vertices(simplified)).toBeLessThan(vertices(kept));
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

  test("rejects an iso_a2 that is not a country code rather than passing it on", () => {
    // The guard that catches the ISO_A2 defect, and it has to REACH the iso_a2
    // branch to test it: gu_a3 must not resolve and iso_3166_2 must not carry
    // a prefix, or an earlier rule answers first and the guard is never run.
    // Everything downstream uses this value as a filename.
    expect(attributeFeature(
      { adm1_code: "X", gu_a3: "ZZZ", iso_3166_2: "-99-X01~", iso_a2: "FR-971", adm0_a3: "ZZZ" },
      index
    )).toBeNull();
  });

  test("prefers the gu_a3 answer over a malformed iso_a2 on the same feature", () => {
    // Rule precedence, kept separate from the guard above: this one is
    // answered by step 1 and never reaches iso_a2 at all.
    expect(attributeFeature(
      { adm1_code: "FRA-4603", gu_a3: "GLP", iso_3166_2: "-99-X01~", iso_a2: "FR-971", adm0_a3: "FRA" },
      index
    )).toBe("GP");
  });
});

import { EXCLUDED, FOLD_INTO, resolveTerritory } from "./build-provinces.mjs";

describe("resolveTerritory — spec §7.2 line by line", () => {
  const index = buildAlpha2Index(mapUnits([
    { GU_A3: "CYP", ADM0_A3: "CYP", ISO_A2: "CY", ISO_A2_EH: "CY" },
    { GU_A3: "SOM", ADM0_A3: "SOM", ISO_A2: "SO", ISO_A2_EH: "SO" },
    { GU_A3: "CUB", ADM0_A3: "CUB", ISO_A2: "CU", ISO_A2_EH: "CU" },
    { GU_A3: "UKR", ADM0_A3: "UKR", ISO_A2: "UA", ISO_A2_EH: "UA" },
    { GU_A3: "NOR", ADM0_A3: "NOR", ISO_A2: "NO", ISO_A2_EH: "NO" },
  ]));
  const props = (over: Record<string, string>) => ({
    adm1_code: "X", gu_a3: "", iso_3166_2: "-99-X00~", iso_a2: "-99", adm0_a3: "", ...over,
  });

  test("Northern Cyprus, Akrotiri and Dhekelia shape Cyprus without being clickable", () => {
    // ISO 3166-1 governs territorial extent; 3166-2 governs subdivision
    // identity. So Cyprus's outline includes the north while its selectable
    // subdivisions do not.
    for (const gu of ["CYN", "WSB", "ESB"]) {
      expect(resolveTerritory(props({ gu_a3: gu }), index)).toEqual({ country: "CY", selectable: false });
    }
  });

  test("Somaliland shapes Somalia; Guantánamo shapes Cuba", () => {
    expect(resolveTerritory(props({ gu_a3: "SOL" }), index)).toEqual({ country: "SO", selectable: false });
    expect(resolveTerritory(props({ gu_a3: "USG" }), index)).toEqual({ country: "CU", selectable: false });
  });

  test("Siachen and the Spratlys are excluded from every file", () => {
    // ISO gives neither any guidance, and excluding is the only non-editorial
    // option available.
    for (const gu of ["KAS", "PGA"]) {
      expect(resolveTerritory(props({ gu_a3: gu }), index)).toEqual({ country: null, selectable: false });
    }
    expect([...EXCLUDED].sort()).toEqual(["KAS", "PGA"]);
  });

  test("Jan Mayen folds into SJ, because ISO 3166 SJ is Svalbard AND Jan Mayen", () => {
    expect(resolveTerritory(props({ gu_a3: "NJM" }), index)).toEqual({ country: "SJ", selectable: false });
  });

  test("Crimea and Sevastopol stay selectable under Ukraine", () => {
    // Natural Earth's iso_a2 says RU; iso_3166_2 says UA. ISO decides, and the
    // §7.1 order already reaches that answer without an override — this test
    // exists so a future reordering cannot silently change it.
    expect(resolveTerritory(props({ gu_a3: "UKR", iso_3166_2: "UA-43", iso_a2: "RU" }), index))
      .toEqual({ country: "UA", selectable: true });
    expect(resolveTerritory(props({ gu_a3: "UKR", iso_3166_2: "UA-40", iso_a2: "RU" }), index))
      .toEqual({ country: "UA", selectable: true });
  });

  test("an ordinary feature is selectable under its own country", () => {
    expect(resolveTerritory(props({ gu_a3: "CYP", iso_3166_2: "CY-01" }), index))
      .toEqual({ country: "CY", selectable: true });
  });

  test("the fold table names exactly the six territories §7.2 lists", () => {
    expect(Object.keys(FOLD_INTO).sort()).toEqual(["CYN", "ESB", "NJM", "SOL", "USG", "WSB"]);
  });
});

import { assertCoverage, groupByCountry } from "./build-provinces.mjs";

/**
 * `groupByCountry`'s `byCountry` is a bare `new Map()` in a `.mjs`, so it
 * infers as `Map<any, any>` — and a callback handed to a method on `any` gets
 * no contextual type, which trips TS7006 under `strict`. Narrowed here to the
 * shape `projectProperties` actually emits, the same way `provinceGeometries`
 * above narrows the pipeline's return, so `npx tsc --noEmit` stays clean.
 */
type ProvinceFeature = {
  id: string;
  properties: {
    name: string | null;
    name_en: string | null;
    iso_3166_2: string | null;
    gn_a1_code: string | null;
    sel: 0 | 1;
  };
};

function countryFeatures(byCountry: unknown, code: string): ProvinceFeature[] {
  return (byCountry as Map<string, ProvinceFeature[]>).get(code)!;
}

describe("groupByCountry", () => {
  const index = buildAlpha2Index(mapUnits([
    { GU_A3: "PER", ADM0_A3: "PER", ISO_A2: "PE", ISO_A2_EH: "PE" },
    { GU_A3: "CYP", ADM0_A3: "CYP", ISO_A2: "CY", ISO_A2_EH: "CY" },
  ]));
  const admin1 = (rows: Array<Record<string, unknown>>) => ({
    type: "FeatureCollection",
    features: rows.map((properties) => ({ type: "Feature", properties, geometry: null })),
  });

  test("sorts features by adm1_code so a rebuild is byte-stable", () => {
    // Without this the file's feature order follows the source's, which is not
    // guaranteed stable across a Natural Earth refresh — and an unstable order
    // makes the churn-free write comparison useless.
    const { byCountry } = groupByCountry(admin1([
      { adm1_code: "PER-9", gu_a3: "PER", iso_3166_2: "PE-LIM", name: "Z" },
      { adm1_code: "PER-1", gu_a3: "PER", iso_3166_2: "PE-CUS", name: "A" },
    ]), index);
    expect(countryFeatures(byCountry, "PE").map((f) => f.id)).toEqual(["PER-1", "PER-9"]);
  });

  test("carries only the five properties the app reads", () => {
    // The source has 121 properties per feature. Carrying them all costs far
    // more than the geometry does.
    const { byCountry } = groupByCountry(admin1([
      { adm1_code: "PER-1", gu_a3: "PER", iso_3166_2: "PE-CUS", gn_a1_code: "PE.08",
        name: "Cusco", name_en: "Cusco", name_alt: "Cuzco", wikidataid: "Q1", type_en: "Region" },
    ]), index);
    expect(Object.keys(countryFeatures(byCountry, "PE")[0].properties).sort())
      .toEqual(["gn_a1_code", "iso_3166_2", "name", "name_en", "sel"]);
  });

  test("a folded territory joins the outline but is marked non-selectable", () => {
    const { byCountry } = groupByCountry(admin1([
      { adm1_code: "CYP-1", gu_a3: "CYP", iso_3166_2: "CY-01", name: "Nicosia" },
      { adm1_code: "CYN+00?", gu_a3: "CYN", iso_3166_2: "-99-X04~", name: "Northern Cyprus" },
    ]), index);
    const cy = countryFeatures(byCountry, "CY");
    expect(cy).toHaveLength(2);
    expect(cy.map((f) => f.properties.sel).sort()).toEqual([0, 1]);
  });

  test("reports an unattributable feature rather than dropping it silently", () => {
    const { byCountry, orphans } = groupByCountry(admin1([
      { adm1_code: "ZZZ+00?", gu_a3: "ZZZ", iso_3166_2: "-99-X99~", iso_a2: "-99", adm0_a3: "ZZZ", name: "Nowhere" },
    ]), index);
    expect(byCountry.size).toBe(0);
    expect(orphans.map((o) => o.adm1_code)).toEqual(["ZZZ+00?"]);
  });
});

describe("assertCoverage", () => {
  test("names every country it cannot reach, not just a count", () => {
    // build-globe-topology.test.ts:41-46 pins the same property for the globe.
    // A count tells an operator a gate failed; the names tell them what broke.
    expect(() => assertCoverage(new Set(["PE", "CN"]), new Set(["PE", "CN", "MT", "SG"])))
      .toThrow(/cannot reach 2 countries[\s\S]*MT, SG/);
  });

  test("is one-way — an extra emitted country is not an error", () => {
    // The province set can legitimately exceed the city set: AQ, BV, HM and XD
    // have admin-1 geometry and no city shard. The emit rule excludes them, but
    // the gate must not be what enforces that.
    expect(() => assertCoverage(new Set(["PE", "CN", "AQ"]), new Set(["PE", "CN"]))).not.toThrow();
  });

  test("passes when the two sets agree", () => {
    expect(() => assertCoverage(new Set(["PE"]), new Set(["PE"]))).not.toThrow();
  });
});

import { assignCities } from "./build-provinces.mjs";

/**
 * `assignCities` fills `cityProvince` through a computed key, so TypeScript
 * infers the empty object literal it starts as and reports TS2339 on any named
 * lookup. Narrowed to the documented contract — `Record<string, string>` — the
 * same way `provinceGeometries` and `countryFeatures` above narrow the other
 * two `.mjs` returns, so `npx tsc --noEmit` stays clean.
 */
function placed(cityProvince: unknown): Record<string, string> {
  return cityProvince as Record<string, string>;
}

describe("assignCities", () => {
  /**
   * Two unit squares side by side, as GeoJSON features — wound CLOCKWISE.
   *
   * d3-geo is spherical, and a ring's winding is what says which side is the
   * inside: clockwise is the exterior of a polygon smaller than a hemisphere,
   * anticlockwise is the exterior of one larger than a hemisphere. A
   * counterclockwise unit square is therefore not a square at all — it is the
   * whole planet minus a square, and `geoContains` answers true for every
   * point on Earth. That is the opposite of RFC 7946's right-hand rule, so the
   * winding here is load-bearing rather than cosmetic.
   *
   * Clockwise is also what the real source ships: the first five rings of
   * ne_10m_admin_1_states_provinces.geojson v5.1.2 all have negative signed
   * planar area, because the file is an ogr2ogr conversion of a shapefile and
   * keeps the shapefile convention. `assignCities` is fed those rings
   * unchanged — `groupByCountry` passes `source.geometry` straight through —
   * so the fixture matches the data.
   *
   * The "neither containment nor a1c can place" test below is the regression
   * guard: under the wrong winding a point at 40N 40E lands in AAA-1.
   */
  const features = [
    { type: "Feature", id: "AAA-1", properties: { gn_a1_code: "AA.01" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] } },
    { type: "Feature", id: "AAA-2", properties: { gn_a1_code: "AA.02" },
      geometry: { type: "Polygon", coordinates: [[[1, 0], [1, 1], [2, 1], [2, 0], [1, 0]]] } },
  ];

  test("places a city in the polygon that contains it", () => {
    const { cityProvince } = assignCities(features, [
      { id: "G1", lat: 0.5, lon: 0.5, a1c: null },
      { id: "G2", lat: 0.5, lon: 1.5, a1c: null },
    ]);
    expect(cityProvince).toEqual({ G1: "AAA-1", G2: "AAA-2" });
  });

  test("falls back to a1c for a city inside no polygon at all", () => {
    // 2,301 real cities (3.92%) fall outside every polygon — offshore, or in
    // the gap between a coastline and a 10m generalisation of it. This is the
    // reason §11 makes a1c mandatory rather than merely useful.
    const { cityProvince, unplaced } = assignCities(features, [
      { id: "G9", lat: 40, lon: 40, a1c: "AA.02" },
    ]);
    expect(cityProvince).toEqual({ G9: "AAA-2" });
    expect(unplaced).toEqual([]);
  });

  test("reports a city that neither containment nor a1c can place", () => {
    const { cityProvince, unplaced } = assignCities(features, [
      { id: "G9", lat: 40, lon: 40, a1c: null },
    ]);
    expect(cityProvince).toEqual({});
    expect(unplaced).toEqual(["G9"]);
  });

  test("does not resolve an a1c that matches no feature", () => {
    const { cityProvince, unplaced } = assignCities(features, [
      { id: "G9", lat: 40, lon: 40, a1c: "AA.99" },
    ]);
    expect(cityProvince).toEqual({});
    expect(unplaced).toEqual(["G9"]);
  });

  test("prefers containment over a1c when the two disagree", () => {
    // Cross-validated on 37,438 cities: the code join agrees with containment
    // 96.11% of the time, and the residual is a hierarchy mismatch no key can
    // fix — GeoNames holds NUTS-1-style regions where NE holds NUTS-2/3.
    // Geometry is the thing being drawn, so geometry wins.
    const { cityProvince } = assignCities(features, [
      { id: "G1", lat: 0.5, lon: 0.5, a1c: "AA.02" },
    ]);
    expect(placed(cityProvince).G1).toBe("AAA-1");
  });
});

import { provincePayload } from "./build-provinces.mjs";

describe("provincePayload", () => {
  const topo = { type: "Topology", objects: { provinces: { type: "GeometryCollection", geometries: [] } }, arcs: [] };
  const now = "2026-08-30T00:00:00.000Z";

  test("stamps generatedAt on a first build", () => {
    expect(provincePayload("PE", topo, {}, null, now).generatedAt).toBe(now);
  });

  test("keeps the previous timestamp when the topology is unchanged", () => {
    // 246 files whose only difference is a timestamp is 246 diffs of noise,
    // and it hides the one file that really did change.
    const before = provincePayload("PE", topo, {}, null, "2026-01-01T00:00:00.000Z");
    const after = provincePayload("PE", topo, {}, before, now);
    expect(after.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("restamps when the topology changes", () => {
    const before = provincePayload("PE", topo, {}, null, "2026-01-01T00:00:00.000Z");
    const changed = { ...topo, arcs: [[[0, 0], [1, 1]]] };
    expect(provincePayload("PE", changed, {}, before, now).generatedAt).toBe(now);
  });

  test("restamps when only the city assignment changes", () => {
    // cityProvince is part of what the file is for, so a change to it is a
    // real change even though the geometry is identical.
    const before = provincePayload("PE", topo, {}, null, "2026-01-01T00:00:00.000Z");
    expect(provincePayload("PE", topo, { G1: "PER-1" }, before, now).generatedAt).toBe(now);
  });

  test("compares payload only, never the envelope", () => {
    // If the comparison included generatedAt it could never match, and the
    // guard would be dead code that looks alive.
    const before = { ...provincePayload("PE", topo, {}, null, now), source: "something else" };
    expect(provincePayload("PE", topo, {}, before, "2026-12-31T00:00:00.000Z").generatedAt).toBe(now);
  });

  test("China declares its own id scheme", () => {
    // §6.3 D7: CN is a re-envelope of the curated topology, whose join key is
    // adcode (GB/T 2260), not adm1_code. The loader reads idKey rather than
    // assuming, so the two schemes can coexist.
    expect(provincePayload("CN", topo, {}, null, now).idKey).toBe("adcode");
    expect(provincePayload("PE", topo, {}, null, now).idKey).toBe("adm1_code");
  });
});

import { assertBudget, GZIP_BUDGET, RAW_TRIPWIRE, TOLERANCE_OVERRIDE } from "./build-provinces.mjs";

describe("assertBudget", () => {
  test("the budget is gzip, not raw — it measures what crosses the wire", () => {
    expect(GZIP_BUDGET).toBe(150_000);
    expect(RAW_TRIPWIRE).toBe(700_000);
  });

  test("names every country over the gzip budget", () => {
    expect(() => assertBudget([
      { code: "PE", raw: 1000, gzip: 400 },
      { code: "RU", raw: 500_000, gzip: 193_912 },
      { code: "CA", raw: 400_000, gzip: 193_318 },
    ])).toThrow(/CA 193318[\s\S]*RU 193912/);
  });

  test("names every country over the raw tripwire even when its gzip fits", () => {
    // A file that gzips well can still be pathological to parse. Measured, RU
    // at tol 0 is 707,485 B raw — the tripwire exists because that is the
    // shape a runaway build takes.
    expect(() => assertBudget([{ code: "RU", raw: 707_485, gzip: 100_000 }]))
      .toThrow(/raw tripwire[\s\S]*RU 707485/);
  });

  test("passes the measured shipping configuration", () => {
    // Largest two after the override: CA 135,244 gz / 416,697 raw and
    // RU 123,667 gz / 411,356 raw. Both clear both limits.
    expect(() => assertBudget([
      { code: "CA", raw: 416_697, gzip: 135_244 },
      { code: "RU", raw: 411_356, gzip: 123_667 },
      { code: "US", raw: 363_154, gzip: 96_518 },
    ])).not.toThrow();
  });

  test("the override table is exactly the two countries that need it", () => {
    // Measured at tol 0: RU 193,912 gz and CA 193,318 gz are the only two of
    // 246 over the cap. Every other country ships quantise-only, because 1e-5
    // erases the Vatican and 1e-4 erases 30 units including 13 Maldivian atolls.
    expect(TOLERANCE_OVERRIDE).toEqual({ CA: 1e-4, RU: 1e-4 });
  });
});

import { reEnvelopeCurated } from "./build-provinces.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Only what these tests read off a curated geometry. */
type CuratedGeometry = { properties: { adcode: number | string }; arcs: unknown };

describe("reEnvelopeCurated — China (D7)", () => {
  const curated = JSON.parse(
    readFileSync(join(process.cwd(), "public/china-provinces.json"), "utf8")
  );

  test("renames the object key to `provinces` so every country parses alike", () => {
    // CountryMap.tsx:196 already does Object.keys(topology.objects)[0] and
    // never mentions the curated key, so this is a tidy rather than a fix —
    // but a uniform key is what lets the loader stop guessing.
    const t = reEnvelopeCurated(curated);
    expect(Object.keys(t.objects)).toEqual(["provinces"]);
  });

  test("keeps all 35 curated features, including the nine-dash line", () => {
    // §7.3 records this as a deliberate exception: CN carries a cartographic
    // claim the other 245 files do not. Removing it would change what China's
    // map has rendered since 2026-08-10.
    const t = reEnvelopeCurated(curated);
    const geometries: CuratedGeometry[] = t.objects.provinces.geometries;
    expect(geometries).toHaveLength(35);
    expect(geometries.some((g) => String(g.properties.adcode) === "100000_JD")).toBe(true);
  });

  test("Shaanxi and Shanxi resolve to different polygons", () => {
    // THE China regression test. foldPlaceName strips NFD combining marks, so
    // Shǎnxī (CN-SN, adcode 610000) and Shānxī (CN-SX, 140000) both fold to
    // "shanxi". Any name-based match collapses them and one province silently
    // draws the other's outline — in the country the app is named after.
    const t = reEnvelopeCurated(curated);
    const geometries: CuratedGeometry[] = t.objects.provinces.geometries;
    const byAdcode = new Map<string, CuratedGeometry>(
      geometries.map((g) => [String(g.properties.adcode), g])
    );
    const shanxi = byAdcode.get("140000");
    const shaanxi = byAdcode.get("610000");
    expect(shanxi).toBeDefined();
    expect(shaanxi).toBeDefined();
    expect(shanxi!.arcs).not.toEqual(shaanxi!.arcs);
  });

  test("stamps an id, because cityProvince joins on it in all 246 files", () => {
    // The curated asset has no geometry id at all — its join key is
    // properties.adcode. Without an id, China's city assignments name Natural
    // Earth ids that appear nowhere in the file China actually ships, all 409
    // resolve to nothing, and every gate stays green.
    const geometries = provinceGeometries(reEnvelopeCurated(curated));
    expect(geometries.every((g) => typeof g.id === "string" && g.id !== "")).toBe(true);
    expect(geometries.map((g) => g.id)).toContain("110000");
  });

  test("marks Taiwan, Hong Kong, Macau and the nine-dash line non-selectable", () => {
    // §7.2: the three carry their own ISO 3166-1 codes and get their own
    // files, so inside CN.json they are geometry rather than clickable
    // provinces. §7.3: the nine-dash line is not a subdivision of anything.
    const geometries = provinceGeometries(reEnvelopeCurated(curated)) as Array<{
      id?: string; properties: { adcode: string | number; sel: number };
    }>;
    const bySel = (v: number) => geometries.filter((g) => g.properties.sel === v).map((g) => String(g.properties.adcode));
    expect(bySel(0).sort()).toEqual(["100000_JD", "710000", "810000", "820000"]);
    expect(bySel(1)).toHaveLength(31);
  });

  test("does not re-quantise — the curated arcs are carried verbatim", () => {
    // Re-running the pipeline over an already-quantised topology would either
    // throw `already quantized` or degrade geometry that was hand-tuned to
    // 58,650 B. The re-envelope is a rename, not a rebuild.
    const t = reEnvelopeCurated(curated);
    expect(t.arcs).toBe(curated.arcs);
    expect(t.transform).toEqual(curated.transform);
  });
});
