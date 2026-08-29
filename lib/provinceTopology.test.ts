import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, test } from "vitest";
import {
  PROVINCE_INDEX_PATH,
  PROVINCE_OBJECT,
  parseProvinceTopology,
  provincePath,
  type ProvinceIndex,
} from "./provinceTopology";

/**
 * One unit, in the shape `scripts/build-provinces.mjs` emits: a TopoJSON
 * geometry whose `id` is the join key and whose five projected properties are
 * all the app keeps of Natural Earth's 121.
 *
 * `name` and `name_en` are kept DIFFERENT strings for the reason
 * `lib/cityShard.test.ts` keeps `n` and `a1` different: the exhaustive
 * `toEqual` below is blind to the two being wired to each other's source field
 * while both spellings produce the same object.
 */
const unit = (id: string, over: Record<string, unknown> = {}) => ({
  type: "Polygon",
  arcs: [[0]],
  id,
  properties: {
    name: "Cusco",
    name_en: "Cusco Region",
    iso_3166_2: "PE-CUS",
    gn_a1_code: "PE.08",
    sel: 1,
    ...over,
  },
});

const file = (over: Record<string, unknown> = {}) => ({
  country: "PE",
  generatedAt: "2026-08-29T17:22:38.278Z",
  source: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/x.geojson",
  license: "Natural Earth (public domain), via nvkelso/natural-earth-vector v5.1.2",
  idKey: "adm1_code",
  topology: {
    type: "Topology",
    bbox: [-81.337558, -18.337746, -68.684252, -0.029093],
    transform: { scale: [0.0001, 0.0001], translate: [-81.337558, -18.337746] },
    objects: {
      provinces: {
        type: "GeometryCollection",
        geometries: [
          unit("PER-1"),
          unit("PER-2", {
            name: "Callao",
            name_en: "Callao Region",
            iso_3166_2: "PE-CAL",
            gn_a1_code: "PE.07",
          }),
        ],
      },
    },
    arcs: [[[0, 0], [100, 0], [0, 100]]],
  },
  cityProvince: { G3941584: "PER-1" },
  ...over,
});

/** One unit, wrapped in an otherwise valid file — for the per-unit guards. */
const fileWithUnits = (geometries: unknown[]) =>
  file({
    topology: {
      ...file().topology,
      objects: { provinces: { type: "GeometryCollection", geometries } },
    },
  });

/** The curated China file, whose properties are a different set entirely. */
const chinaFile = () =>
  file({
    country: "CN",
    idKey: "adcode",
    topology: {
      type: "Topology",
      transform: { scale: [0.0001, 0.0001], translate: [73, 3] },
      objects: {
        provinces: {
          type: "GeometryCollection",
          geometries: [
            { type: "Polygon", arcs: [[0]], id: "110000", properties: { adcode: 110000, name: "北京市", sel: 1 } },
            { type: "Polygon", arcs: [[0]], id: "710000", properties: { adcode: 710000, name: "台湾省", sel: 0 } },
          ],
        },
      },
      arcs: [[[0, 0], [100, 0], [0, 100]]],
    },
    cityProvince: { G1816670: "110000" },
  });

describe("province paths", () => {
  test("are root-relative so a fetch resolves the same from every route", () => {
    // The rule lib/cityShard.ts, lib/isoTopology.ts and lib/globeTopology.ts
    // all pin for their own assets: /plan and /trip/:id sit at different
    // depths, so a relative path resolves to two different files.
    expect(provincePath("PE")).toBe("/provinces/PE.json");
    expect(PROVINCE_INDEX_PATH).toBe("/provinces/index.json");
  });

  test("normalise the code the way cityShardPath does", () => {
    expect(provincePath(" pe ")).toBe("/provinces/PE.json");
  });

  test("refuse anything that is not a two-letter code", () => {
    // The value reaches a URL. A country of "../china-provinces" would resolve
    // out of /provinces/ entirely and hand this parser a bare topology.
    expect(() => provincePath("../china-provinces")).toThrow(/not a country code/);
    expect(() => provincePath("")).toThrow(/not a country code/);
    expect(() => provincePath("PER")).toThrow(/not a country code/);
  });
});

describe("parseProvinceTopology", () => {
  test("accepts a well-formed file, projecting every field of a unit", () => {
    const raw = file();
    const parsed = parseProvinceTopology(raw);
    expect(parsed.country).toBe("PE");
    expect(parsed.generatedAt).toBe("2026-08-29T17:22:38.278Z");
    // Field by field, not merely counted: the parser rebuilds each unit as a
    // fresh object literal, so every field is a separate chance to mis-wire and
    // a `toHaveLength(2)` stays green for all of them.
    expect(parsed.units).toEqual([
      { id: "PER-1", name: "Cusco", nameEn: "Cusco Region", iso3166_2: "PE-CUS", gnA1Code: "PE.08", selectable: true },
      { id: "PER-2", name: "Callao", nameEn: "Callao Region", iso3166_2: "PE-CAL", gnA1Code: "PE.07", selectable: true },
    ]);
    // The topology is carried through by reference, not rebuilt. PR4 runs
    // `merge()` over this object to get the country outline (§4.1), so a parser
    // that reconstructed it would be reconstructing the thing being drawn.
    expect(parsed.topology).toBe(raw.topology);
    expect(parsed.topology.objects[PROVINCE_OBJECT]).toBe(raw.topology.objects.provinces);
  });

  test("throws rather than returning a half-parsed file", () => {
    // Same policy as parseCityShard, parseWorldTopology and parseGlobeTopology:
    // a silently partial parse draws a country whose map is quietly missing
    // provinces, and nothing downstream can tell that from a country that
    // genuinely has few.
    expect(() => parseProvinceTopology(null)).toThrow(/province file: root is not an object/);
    expect(() => parseProvinceTopology(file({ country: 7 }))).toThrow(/country is not a country code/);
    expect(() => parseProvinceTopology(file({ topology: undefined }))).toThrow(/is not a TopoJSON Topology/);
    expect(() =>
      parseProvinceTopology(file({ topology: { type: "Topology", arcs: [], objects: {} } }))
    ).toThrow(/topology\.objects\.provinces/);
    expect(() =>
      parseProvinceTopology(
        file({ topology: { type: "Topology", arcs: [], objects: { provinces: { geometries: {} } } } })
      )
    ).toThrow(/topology\.objects\.provinces/);
  });

  test("rejects a file whose envelope names a different country than the path", () => {
    // The guard lib/cityShard.ts:110-121 documents, on an asset with exactly
    // the same exposure. Nothing downstream reads `country` — PR4 takes the
    // topology and the unit list — so a CDN rewrite, a stale cache entry or a
    // mis-copied fixture serving Peru's provinces under /provinces/JP.json
    // would draw Peruvian departments on Japan with every test still green.
    // That is the shape of PR #17's inside-out globe fixture.
    expect(() => parseProvinceTopology(file(), "JP")).toThrow(/is PE's file, but JP was requested/);
    expect(() => parseProvinceTopology(file(), "pe")).not.toThrow();
    expect(() => parseProvinceTopology(file())).not.toThrow();
  });

  test("accepts both id schemes and reports which one the file uses", () => {
    // §6.3 D7: CN is a re-envelope of the curated topology, whose join key is
    // adcode (GB/T 2260) and whose properties carry neither name_en nor a
    // GeoNames code. Every other country keys on adm1_code. The loader reads
    // idKey rather than assuming, so the two schemes coexist in one type.
    expect(parseProvinceTopology(file()).idKey).toBe("adm1_code");
    const china = parseProvinceTopology(chinaFile(), "CN");
    expect(china.idKey).toBe("adcode");
    expect(china.units).toEqual([
      { id: "110000", name: "北京市", nameEn: null, iso3166_2: null, gnA1Code: null, selectable: true },
      // Taiwan holds its own ISO 3166-1 code and its own province file; inside
      // CN.json it is geometry that shapes the outline, not a clickable unit.
      { id: "710000", name: "台湾省", nameEn: null, iso3166_2: null, gnA1Code: null, selectable: false },
    ]);
    expect(china.cityProvince.get("G1816670")).toBe("110000");
    // And an id scheme nobody builds is a hard error rather than a third mode:
    // everything joins on this field, and the wrong one joins nothing.
    expect(() => parseProvinceTopology(file({ idKey: "name" }))).toThrow(/idKey/);
  });

  test("throws on a unit that does not say whether it is selectable", () => {
    // `sel` decides whether a unit is clickable, and both defaults are wrong:
    // defaulting to selectable makes Northern Cyprus a clickable district of
    // Cyprus, the exact outcome §7.2 exists to prevent, and defaulting the
    // other way makes a whole country unclickable. So it is read, never
    // assumed — and `true` is not `1`, because the wire format is 1 or 0.
    expect(() => parseProvinceTopology(fileWithUnits([unit("PER-1", { sel: undefined })]))).toThrow(
      /PER-1[\s\S]*sel/
    );
    expect(() => parseProvinceTopology(fileWithUnits([unit("PER-1", { sel: true })]))).toThrow(
      /PER-1[\s\S]*sel/
    );
  });

  test("throws on a unit with no id, which nothing could join to", () => {
    expect(() => parseProvinceTopology(fileWithUnits([{ type: "Polygon", arcs: [[0]], properties: { sel: 1 } }]))).toThrow(
      /unit 0 has no id/
    );
  });

  test("throws on a duplicate unit id, which no city could be joined to", () => {
    // adm1_code is unique across all 4,596 source features and adcode across
    // the 35 curated ones; iso_3166_2 is NOT — 4,596 features carry 4,501
    // distinct values and PH-MNL appears 17 times — which is why it is not the
    // id. A duplicate here means the id moved to a field with no such
    // guarantee, and every city in the pair joins to whichever polygon a
    // lookup happens to reach first.
    expect(() => parseProvinceTopology(fileWithUnits([unit("PER-1"), unit("PER-1")]))).toThrow(
      /duplicate unit id/
    );
  });

  test("drops a cityProvince entry pointing at no feature", () => {
    // The one place this parser degrades rather than throwing, for the reason
    // parseCityEnrichment gives for the same split: a dangling entry costs one
    // city its province, while throwing costs the whole country its map. The
    // build already gates this, so a drop here means a committed file
    // disagrees with itself — which the artifact test below is what catches.
    const parsed = parseProvinceTopology(
      file({ cityProvince: { G3941584: "PER-1", G1: "PER-404", G2: 7, G3: null } })
    );
    expect([...parsed.cityProvince]).toEqual([["G3941584", "PER-1"]]);
  });

  test("returns a Map, so a city id out of the file cannot resolve to a function", () => {
    // The keys come from a data file. On a plain object literal
    // `cityProvince["constructor"]` resolves to a function and a lookup that
    // should miss looks like a hit — the same reason lib/cityShard.ts shape-
    // checks `a1c` before it becomes a Map key.
    const parsed = parseProvinceTopology(file({ cityProvince: { constructor: "PER-1" } }));
    expect(parsed.cityProvince.get("toString")).toBeUndefined();
    expect(parsed.cityProvince.get("constructor")).toBe("PER-1");
  });

  test("names the file in every message, so a browser error says which asset", () => {
    expect(() => parseProvinceTopology(undefined)).toThrow(/^province file:/);
  });
});

// ---------------------------------------------------------------------------
// The committed province files
// ---------------------------------------------------------------------------

const PROVINCE_DIR = join(process.cwd(), "public", "provinces");
const SHARD_DIR = join(process.cwd(), "public", "cities");
const INDEX_ASSET = join(PROVINCE_DIR, "index.json");

/**
 * The province files are committed build artefacts, not source — `npm ci` does
 * not produce them and `scripts/build-provinces.mjs` needs ~54 MB of network
 * egress. Tests that need them skip when they are missing rather than failing,
 * exactly as lib/cityShard.test.ts, lib/isoTopology.test.ts and
 * lib/globeTopology.test.ts do for their own assets, so a checkout without them
 * is honest about what went unchecked instead of red for the wrong reason.
 */
const hasAssets = existsSync(INDEX_ASSET);
const index: ProvinceIndex | null = hasAssets
  ? (JSON.parse(readFileSync(INDEX_ASSET, "utf8")) as ProvinceIndex)
  : null;

const provinceCodes = (): string[] =>
  readdirSync(PROVINCE_DIR)
    .filter((name) => /^[A-Z]{2}\.json$/.test(name))
    .map((name) => name.slice(0, 2));

/** Parsed under the code its filename claims, so the envelope is cross-checked. */
const readProvince = (code: string) =>
  parseProvinceTopology(JSON.parse(readFileSync(join(PROVINCE_DIR, `${code}.json`), "utf8")), code);

const selectableCount = (code: string): number =>
  readProvince(code).units.filter((u) => u.selectable).length;

/**
 * The per-file gzip budget `scripts/build-provinces.mjs` gates on
 * (`GZIP_BUDGET`), restated rather than imported: importing the build script
 * into a lib test would pull topojson-server, topojson-simplify and d3-geo in
 * for one number.
 */
const GZIP_BUDGET = 150_000;

describe.skipIf(!hasAssets)("the committed province files", () => {
  it("names exactly 246 countries", () => {
    // 246, not 250: the §2.2 emit rule is "a country gets a province file when
    // it has a city shard", and AQ, BV, HM and XD have admin-1 geometry with
    // no shard. `toHaveLength`, never `toBeGreaterThanOrEqual` — a 247th
    // country means the emit set moved, and that is a decision for a human.
    expect(index!.countries).toHaveLength(246);
    // Two of the 13 countries §2.3 says Phase 4 exists to reach, and the two
    // the §7.1 attribution rule is easiest to break for: XK carries no ISO
    // numeric id at all, and BQ is reachable only through the explicit
    // /^NL-BQ\d$/ rule that runs before every general one.
    const codes = index!.countries.map((c) => c.code);
    expect(codes).toContain("XK");
    expect(codes).toContain("BQ");
  });

  it("has a file for every country the index names, and no orphans", () => {
    // Both directions, as lib/cityShard.test.ts pins for the shards: an index
    // entry pointing at a 404 is as broken as a file nothing names.
    const named = new Set(index!.countries.map((c) => c.code));
    const onDisk = new Set(provinceCodes());
    expect([...named].filter((c) => !onDisk.has(c)).sort()).toEqual([]);
    expect([...onDisk].filter((c) => !named.has(c)).sort()).toEqual([]);
  });

  it("gives every country with a city shard a province file", () => {
    // The invariant PR4 depends on, and the one `assertCoverage` gates at build
    // time: every country the picker can open has geometry to draw. Checked
    // here as well, because that gate only fires when somebody runs the build,
    // and the shards refresh nightly while these files do not.
    const shards = readdirSync(SHARD_DIR)
      .filter((name) => /^[A-Z]{2}\.json$/.test(name))
      .map((name) => name.slice(0, 2));
    const provinces = new Set(provinceCodes());
    const missing = shards.filter((code) => !provinces.has(code));
    expect(missing, `countries with a city shard and no province file: ${missing.join(", ")}`).toEqual([]);
  });

  it("parses every file, under the code its own filename claims", () => {
    // Which also checks the envelope against the filename 246 times: a file
    // whose `country` disagrees with its path would be rejected at run time by
    // the loader, so it must never be committed in the first place.
    const failures: string[] = [];
    for (const code of provinceCodes()) {
      try {
        readProvince(code);
      } catch (error) {
        failures.push(`${code}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("agrees with the index about how many units each country offers", () => {
    // index.json's `count` is what a picker reads before it fetches anything.
    // It counts SELECTABLE units rather than geometries, so CN's 35 features
    // are 31 choices — and a count taken off the wrong set is exactly the kind
    // of drift no rendering test would notice.
    const mismatched: string[] = [];
    for (const entry of index!.countries) {
      const selectable = selectableCount(entry.code);
      if (selectable !== entry.count) mismatched.push(`${entry.code} ${selectable}!=${entry.count}`);
    }
    expect(mismatched, `index disagrees with the file for: ${mismatched.join(", ")}`).toEqual([]);
  });

  it("keeps every file inside a single fetch a user will not notice", () => {
    // The budget measures gzip, because that is what crosses the wire and
    // these files compress about 3:1. CA is the binding case at ~139 KB — 13
    // units of almost pure Arctic coastline, already simplified at 1e-4, which
    // is why the two-country TOLERANCE_OVERRIDE exists at all.
    const sizes = provinceCodes()
      .map((code) => [code, gzipSync(readFileSync(join(PROVINCE_DIR, `${code}.json`))).length] as const)
      .sort((a, b) => b[1] - a[1]);
    const oversized = sizes.filter(([, bytes]) => bytes > GZIP_BUDGET);
    expect(oversized, `over the ${GZIP_BUDGET} B gzip budget: ${JSON.stringify(oversized)}`).toEqual([]);
    // And that the budget is still a binding constraint rather than decoration.
    // If the largest file were small, the assertion above would be pinning a
    // limit nothing approaches — which is how a cap silently stops applying.
    expect(sizes[0][0]).toBe("CA");
    expect(sizes[0][1]).toBeGreaterThan(100_000);
  });

  it("has no cityProvince entry the parser has to drop", () => {
    // The on-disk counterpart of build-provinces.mjs's `dangling` gate. The
    // parser drops unjoinable entries silently by design, so without this a
    // file whose city assignments name geometry it does not ship would parse
    // green and draw a country whose cities highlight nothing — which is
    // precisely what CN did before c83c8af.
    const dangling: string[] = [];
    for (const code of provinceCodes()) {
      const raw = JSON.parse(readFileSync(join(PROVINCE_DIR, `${code}.json`), "utf8")) as {
        cityProvince: Record<string, string>;
      };
      const written = Object.keys(raw.cityProvince).length;
      const kept = readProvince(code).cityProvince.size;
      if (kept !== written) dangling.push(`${code} ${written - kept}`);
    }
    expect(dangling, `files with unjoinable cityProvince entries: ${dangling.join(", ")}`).toEqual([]);
  });

  it("gives 34 countries exactly one selectable unit", () => {
    // §6.6 D10, measured within the 246-country emit set (37 across all 250).
    // These are the countries whose province level is a single polygon, so PR5
    // must not offer a province step for them. Asserted rather than bounded: a
    // country gaining or losing its subdivisions changes what the picker does.
    const single = provinceCodes().filter((code) => selectableCount(code) === 1);
    expect(single).toHaveLength(34);
    // VA is the reason §8.2 rules out a global 1e-5 tolerance: the Vatican's
    // entire admin-1 representation is that one polygon, and simplifying at
    // 1e-5 erases it.
    expect(single).toContain("VA");
  });

  it("gives China 35 features, 31 of them selectable, keyed on adcode", () => {
    // §6.3 D7 and §7.3. The curated asset is the one file not sliced from
    // Natural Earth: 35 geometries including the nine-dash line, which is a
    // cartographic claim rather than a subdivision, plus TW, HK and MO, which
    // hold their own ISO 3166-1 codes and their own province files. All four
    // shape China's outline and none of them is clickable.
    const china = readProvince("CN");
    expect(china.idKey).toBe("adcode");
    expect(china.units).toHaveLength(35);
    expect(china.units.filter((u) => u.selectable)).toHaveLength(31);
    expect(china.units.filter((u) => !u.selectable).map((u) => u.id).sort()).toEqual([
      "100000_JD",
      "710000",
      "810000",
      "820000",
    ]);
    // THE China regression: Shǎnxī (610000) and Shānxī (140000) fold to the
    // same string under foldPlaceName, so any name-keyed join collapses them
    // and one province silently draws the other's outline. Ids keep them apart.
    const byId = new Map(china.units.map((u) => [u.id, u]));
    expect(byId.get("140000")!.name).not.toBe(byId.get("610000")!.name);
  });
});
