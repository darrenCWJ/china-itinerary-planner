import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import { PROVINCES, REGION_META } from "./provinces";
import { parseProvinceTopology, type ProvinceIndex, type ProvinceUnit } from "./provinceTopology";
import { regionSchemeFor, unitLabel } from "./regionScheme";
import type { ChinaRegion } from "./types";

/**
 * One unit, in the shape `parseProvinceTopology` hands out.
 *
 * `name` and `nameEn` are kept DIFFERENT strings, as `lib/provinceTopology.test.ts`
 * keeps them, so a label assertion cannot pass while the two fields are wired
 * to each other's source.
 */
const unit = (id: string, over: Partial<ProvinceUnit> = {}): ProvinceUnit => ({
  id,
  name: "Cusco",
  nameEn: "Cusco Region",
  iso3166_2: "PE-CUS",
  gnA1Code: "PE.08",
  selectable: true,
  ...over,
});

describe("unitLabel", () => {
  test("labels a unit nameEn ?? name ?? id, matching what CountryLevel already does", () => {
    // CountryLevel.tsx:538 is the precedence this has to agree with, because
    // once the zoom ships the same unit is named twice on one screen — the
    // polygon's <title> and the region control — and two spellings of one
    // province read as two provinces.
    expect(unitLabel("PE", unit("PER-1"))).toBe("Cusco Region");
    expect(unitLabel("PE", unit("PER-1", { nameEn: null }))).toBe("Cusco");
    expect(unitLabel("PE", unit("PER-1", { nameEn: null, name: null }))).toBe("PER-1");
  });
});

describe("regionSchemeFor", () => {
  test("gives every other country one group per selectable unit", () => {
    const scheme = regionSchemeFor("PE", [
      unit("PER-1"),
      unit("PER-2", { name: "Callao", nameEn: "Callao Region" }),
      unit("CYN+00?", { name: "Northern Cyprus", nameEn: null, selectable: false }),
    ]);

    expect(scheme.kind).toBe("admin1");
    expect(scheme.groups).toEqual([
      { id: "PER-1", label: "Cusco Region", unitIds: ["PER-1"] },
      { id: "PER-2", label: "Callao Region", unitIds: ["PER-2"] },
    ]);
  });

  test("does not resolve a country code that is an Object property name", () => {
    // The curated table is a Map and not a Record, for the reason `cityProvince`
    // is one: on a plain object `CURATED["constructor"]` resolves to a function,
    // so a lookup that should miss reads as a hit and some other country gets
    // China's grouping applied to units China has never heard of.
    for (const hostile of ["constructor", "__proto__", "toString", "valueOf"]) {
      const scheme = regionSchemeFor(hostile, [unit("A"), unit("B")]);
      expect(scheme.kind).toBe("admin1");
      expect(scheme.groups.map((g) => g.id)).toEqual(["A", "B"]);
    }
  });
});

// ---------------------------------------------------------------------------
// The committed province files
// ---------------------------------------------------------------------------

/**
 * Skipped rather than failed when the artefacts are absent, exactly as
 * `lib/provinceTopology.test.ts` skips: they are committed build output that
 * `npm ci` does not produce, so a lean checkout is honest about what went
 * unchecked instead of red for the wrong reason.
 */
const PROVINCE_DIR = join(process.cwd(), "public", "provinces");
const INDEX_ASSET = join(PROVINCE_DIR, "index.json");
const hasAssets = existsSync(INDEX_ASSET);
const index: ProvinceIndex | null = hasAssets
  ? (JSON.parse(readFileSync(INDEX_ASSET, "utf8")) as ProvinceIndex)
  : null;

/** Parsed under the code its filename claims, so the envelope is cross-checked. */
const readProvince = (code: string) =>
  parseProvinceTopology(JSON.parse(readFileSync(join(PROVINCE_DIR, `${code}.json`), "utf8")), code);

describe.skipIf(!hasAssets)("regionSchemeFor over the committed files", () => {
  it("omits non-selectable units — a user cannot zoom to Northern Cyprus", () => {
    const cy = readProvince("CY");
    const scheme = regionSchemeFor(cy.country, cy.units);
    const reachable = new Set(scheme.groups.flatMap((g) => g.unitIds));

    // ISO 3166-1 governs territorial EXTENT while ISO 3166-2 governs
    // SUBDIVISION identity (§7.2). Northern Cyprus, Dhekelia and Akrotiri shape
    // Cyprus's outline without being districts of it.
    const unreachable = cy.units.filter((u) => !u.selectable).map((u) => u.id);
    expect(unreachable.length).toBeGreaterThan(0);
    for (const id of unreachable) expect(reachable.has(id)).toBe(false);
    expect(reachable.size).toBe(index?.countries.find((c) => c.code === "CY")?.count);

    // And the point of the omission: cities really are assigned to those units,
    // so "no city names it" is NOT why it is absent. 43 committed cityProvince
    // values across CY, SO and CU name a unit that is not a destination.
    const stranded = [...cy.cityProvince.values()].filter((id) => !reachable.has(id));
    expect(stranded.length).toBeGreaterThan(0);
  });

  it("labels China's units in English by joining lib/provinces.ts on adcode", () => {
    // Every CN unit has nameEn === null, so the shared precedence would yield
    // the endonym. The curated table carries the English name and the join key
    // is the unit id, which for the curated asset is the adcode.
    const cn = readProvince("CN");
    expect(cn.units.every((u) => u.nameEn === null)).toBe(true);

    for (const meta of PROVINCES) {
      const found = cn.units.find((u) => u.id === String(meta.adcode));
      expect(found, `CN.json has no unit ${meta.adcode}`).toBeDefined();
      if (!found) continue;
      expect(unitLabel("CN", found)).toBe(meta.nameEn);
      expect(unitLabel("CN", found)).not.toBe(found.name);
    }
  });

  it("falls back to the raw id for the six units that carry no name at all", () => {
    // AI/AIA+99?, CO/COL+99?, KI/KIR+99?, MX/MEX+99?, RU/RUS+99?, VE/VEN+99?.
    // Zero assigned cities each, so unreachable by a city and reachable by a
    // click — which is why the label cannot be allowed to come out empty.
    const nameless: string[] = [];
    for (const entry of index?.countries ?? []) {
      const file = readProvince(entry.code);
      for (const u of file.units) {
        if (!u.selectable || u.name !== null || u.nameEn !== null) continue;
        nameless.push(`${entry.code}/${u.id}`);
        expect(unitLabel(entry.code, u)).toBe(u.id);
      }
    }
    expect(nameless).toEqual([
      "AI/AIA+99?",
      "CO/COL+99?",
      "KI/KIR+99?",
      "MX/MEX+99?",
      "RU/RUS+99?",
      "VE/VEN+99?",
    ]);
  });

  it("groups China's units into its seven curated regions", () => {
    // §6.4: the regions are a grouping ABOVE admin-1, not a replacement. The
    // seven group ids are the seven ChinaRegion strings by coincidence of
    // value; RegionId stays `string` so the coincidence cannot narrow the type.
    const cn = readProvince("CN");
    const scheme = regionSchemeFor(cn.country, cn.units);

    expect(scheme.kind).toBe("curated");
    expect(scheme.groups.map((g) => g.id)).toEqual(Object.keys(REGION_META));
    expect(scheme.groups.map((g) => g.label)).toEqual(
      (Object.keys(REGION_META) as ChinaRegion[]).map((r) => REGION_META[r].label)
    );

    // Every selectable unit lands in exactly one group, and nothing else does.
    // This is what goes red if the curated table ever drifts from the asset: a
    // province in no group is a province the user cannot reach.
    const placed = scheme.groups.flatMap((g) => g.unitIds);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(
      cn.units
        .filter((u) => u.selectable)
        .map((u) => u.id)
        .sort()
    );

    const byId = new Map(scheme.groups.map((g) => [g.id, g.unitIds]));
    expect(byId.get("East")).toContain("310000");
    expect(byId.get("Southwest")).toContain("540000");
    // Taiwan, Hong Kong, Macau and the nine-dash envelope are all sel:0.
    expect(placed).not.toContain("710000");
    expect(placed).not.toContain("100000_JD");
  });

  it("returns no groups for a country with one selectable unit", () => {
    // §6.6 D10: 34 countries where L3 would be identical to L2. The gate is
    // index.countries[].count <= 1, which counts SELECTABLE units — never a
    // hard-coded list of country codes.
    const disagreed: string[] = [];
    for (const entry of index?.countries ?? []) {
      const file = readProvince(entry.code);
      const scheme = regionSchemeFor(file.country, file.units);
      const offered = scheme.groups.length > 0;
      if (offered !== entry.count > 1) disagreed.push(`${entry.code} (count ${entry.count})`);
    }
    expect(disagreed, `scheme disagrees with the index count for: ${disagreed.join(", ")}`).toEqual(
      []
    );
    expect(index?.countries.filter((c) => c.count <= 1)).toHaveLength(34);
  });
});
