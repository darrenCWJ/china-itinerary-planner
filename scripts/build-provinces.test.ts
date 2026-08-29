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
