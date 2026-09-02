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
    // Callao first though Cusco is first in the file — the branch sorts by
    // label, and the test below is where that is pinned. Written in the sorted
    // order here too, so this one cannot be read as file order surviving.
    expect(scheme.groups).toEqual([
      { id: "PER-2", label: "Callao Region", unitIds: ["PER-2"] },
      { id: "PER-1", label: "Cusco Region", unitIds: ["PER-1"] },
    ]);
  });

  test("orders those groups by label, never by the code the file is sorted on", () => {
    // `ProvinceFile.units` is `adm1_code` ascending — Natural Earth's own
    // numbering, which no user has ever seen — and for the 212 countries with
    // more than one selectable unit this list is the ONLY way into the province
    // level. Ordered by that code, a reader looking for Cusco in Peru scans 26
    // entries against a key that is not on the screen.
    //
    // Áncash is the second half of it: an English reader expects it between
    // Amazonas and Apurímac, which is where `localeCompare` puts it. A
    // code-unit sort puts it after Ucayali, with every other accented province
    // in the country.
    const scheme = regionSchemeFor("PE", [
      unit("PER-3505", { name: "Callao", nameEn: "Callao" }),
      unit("PER-571", { name: "Cusco", nameEn: "Cusco Departament" }),
      unit("PER-577", { name: "Ancash", nameEn: "Áncash" }),
      unit("PER-584", { name: "Amazonas", nameEn: "Amazonas" }),
      unit("PER-569", { name: "Apurimac", nameEn: "Apurímac" }),
    ]);

    expect(scheme.groups.map((g) => g.label)).toEqual([
      "Amazonas",
      "Áncash",
      "Apurímac",
      "Callao",
      "Cusco Departament",
    ]);
    // Each id travels with its own label rather than being sorted beside it,
    // which is the mutation a labels-only assertion would let through.
    expect(scheme.groups.map((g) => g.unitIds)).toEqual([
      ["PER-584"],
      ["PER-577"],
      ["PER-569"],
      ["PER-3505"],
      ["PER-571"],
    ]);
    expect(scheme.groups.map((g) => g.id)).toEqual(scheme.groups.map((g) => g.unitIds[0]));
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

  it("lists a real country's provinces alphabetically, file order and all", () => {
    // Peru in full, because the defect only has a size at a real country's
    // size. Its file order is `adm1_code` ascending and begins Callao,
    // Lambayeque, Piura, Tumbes — an order with no reading at all.
    const pe = readProvince("PE");
    const groups = regionSchemeFor(pe.country, pe.units).groups;

    expect(groups.map((g) => g.label)).toEqual([
      "Amazonas",
      "Áncash",
      "Apurímac",
      "Arequipa",
      "Ayacucho",
      "Cajamarca",
      "Callao",
      "Cusco Departament",
      "Huancavelica",
      "Huanuco",
      "Ica",
      "Junín",
      "La Libertad",
      "Lambayeque",
      "Lima",
      "Lima",
      "Loreto",
      "Madre de Dios",
      "Moquegua",
      "Pasco",
      "Piura",
      "Puno",
      "San Martín",
      "Tacna",
      "Tumbes",
      "Ucayali",
    ]);

    // Stated as a difference too: the assertion above would also pass on a
    // country whose two orders happen to agree, and 17 of the 211 do.
    const fileOrder = pe.units.filter((u) => u.selectable).map((u) => u.id);
    expect(groups.map((g) => g.id)).not.toEqual(fileOrder);
    expect([...groups.map((g) => g.id)].sort()).toEqual([...fileOrder].sort());

    // Natural Earth names two of Peru's units "Lima" — the province and the
    // department — so the comparator returns 0 for that pair. `sort` is stable,
    // so they hold file order instead of swapping between two renders of one
    // list.
    expect(groups.filter((g) => g.label === "Lima").map((g) => g.id)).toEqual([
      "PER-587",
      "PER-591",
    ]);
  });

  it("does the same for every country that offers a province level, China included", () => {
    // The blast radius, and why sorting is worth a test: 195 of the 212
    // countries with a province level ship a file order that is not the order a
    // reader would look in. Peru is not the exception, and neither is China —
    // its adcode order runs Beijing, Tianjin, Hebei, Shanxi, which is GB/T 2260
    // numbering rather than anything a reader scans.
    const unsorted: string[] = [];
    let differ = 0;
    for (const entry of index?.countries ?? []) {
      const file = readProvince(entry.code);
      const labels = regionSchemeFor(file.country, file.units).groups.map((g) => g.label);
      if (labels.length === 0) continue;
      const sorted = [...labels].sort((a, b) => a.localeCompare(b));
      if (labels.join("\u0000") !== sorted.join("\u0000")) unsorted.push(entry.code);
      const fileOrder = file.units.filter((u) => u.selectable).map((u) => unitLabel(entry.code, u));
      if (fileOrder.join("\u0000") !== sorted.join("\u0000")) differ += 1;
    }

    expect(unsorted, `came back in some other order: ${unsorted.join(", ")}`).toEqual([]);
    expect(differ).toBe(195);
  });

  it("gives China the same province groups as every other country", () => {
    // China used to be the one country whose groups were an editorial layer —
    // seven curated regions instead of admin-1 units. It is not any more: the
    // app is a worldwide planner, and a country that answers to a different
    // control than the other 245 is a country the reader has to learn twice.
    //
    // The seven regions are NOT gone. They survive where §6.4 puts them and
    // where they carry meaning: `REGION_MONTHS`, keyed by region, is neither
    // re-keyed nor re-derived, and `mapTypes.isChinaPlace` still reads a
    // Chinese city's region label off it. What changed is that they stopped
    // being the map's zoom level.
    const cn = readProvince("CN");
    const scheme = regionSchemeFor(cn.country, cn.units);

    expect(scheme.kind).toBe("admin1");

    const selectable = cn.units.filter((u) => u.selectable);
    expect(scheme.groups).toHaveLength(selectable.length);
    // One unit per group, which is what "L3 is uniformly admin-1" means: a
    // group that named several provinces would frame their union, and framing
    // a whole region is the behaviour this replaced.
    for (const group of scheme.groups) {
      expect(group.unitIds, group.id).toHaveLength(1);
    }

    // Labelled in English off `lib/provinces.ts`, not with the endonym, and
    // sorted like everyone else's — see the label test above.
    const labels = scheme.groups.map((g) => g.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    expect(labels).toContain("Beijing");
    expect(labels).toContain("Tibet");
    expect(labels.some((l) => /[一-鿿]/.test(l)), labels.join(", ")).toBe(false);

    // Every selectable unit is reachable, and nothing else is.
    const placed = scheme.groups.flatMap((g) => g.unitIds);
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual(selectable.map((u) => u.id).sort());

    // Taiwan, Hong Kong, Macau and the nine-dash envelope are all sel:0 — they
    // shape the outline without being a subdivision anyone can travel to.
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
