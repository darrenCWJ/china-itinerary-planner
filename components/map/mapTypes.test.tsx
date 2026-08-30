import { describe, expect, test } from "vitest";
import { REGION_MONTHS } from "@/lib/months";
import { regionSchemeFor } from "@/lib/regionScheme";
import type { ProvinceUnit } from "@/lib/provinceTopology";
import { fitForRegion, isChinaRegion, NEUTRAL_FIT } from "./mapTypes";

/**
 * The guard between a region label and China's month table.
 *
 * `REGION_MONTHS` is read as `REGION_MONTHS[region][month - 1]` behind a
 * non-nullable return type, so a label from outside China's seven does not
 * miss — it throws. `isChinaRegion` is the only thing standing in front of
 * that, and Phase 4 made its job materially harder: the third map level's
 * identifier is `regionScheme.RegionId`, which is `string`, and for the other
 * 245 countries its values are admin-1 unit ids like `PER-1`. Those now flow
 * through `zoomRegion` and into the same chrome China's seven do.
 *
 * `.test.tsx` rather than `.test.ts` because `components/**\/*.test.ts` matches
 * NO vitest project — a `.test.ts` beside this file would sit on disk and never
 * run. The module under test is components-local, so lib/ is not its home
 * either.
 */

/** A unit in the shape `parseProvinceTopology` hands out. */
const unit = (id: string, over: Partial<ProvinceUnit> = {}): ProvinceUnit => ({
  id,
  name: "Cusco",
  nameEn: "Cusco Region",
  iso3166_2: "PE-CUS",
  gnA1Code: "PE.08",
  selectable: true,
  ...over,
});

describe("isChinaRegion", () => {
  test("narrows to exactly the seven keys REGION_MONTHS carries", () => {
    for (const region of Object.keys(REGION_MONTHS)) {
      expect(isChinaRegion(region), region).toBe(true);
    }
    // And nothing else, including the admin-1 names `MapExplorer` puts in
    // `place.region` for every country but China.
    for (const label of ["Cuzco Department", "Kansai", "north", "North China", ""]) {
      expect(isChinaRegion(label), label).toBe(false);
    }
  });

  test("does not resolve an inherited Object property to a climate row", () => {
    // The reason the predicate is `hasOwnProperty` and not `region in
    // REGION_MONTHS` or a truthiness test: on a plain object literal every one
    // of these resolves to something through the prototype chain, and
    // `REGION_MONTHS.constructor[month - 1]` is `undefined` — a TypeError one
    // line later, from a guard that said yes.
    for (const hostile of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(isChinaRegion(hostile), hostile).toBe(false);
      expect(fitForRegion(hostile, 6), hostile).toBe(NEUTRAL_FIT);
    }
  });

  test("no L3 region id from another country is mistaken for one of China's seven", () => {
    // Phase 4's new exposure. `regionSchemeFor` group ids reach `zoomRegion`,
    // and `RegionId` is `string`, so nothing in the type system keeps a
    // Peruvian unit id away from the China tables — this does.
    const peru = regionSchemeFor("PE", [
      unit("PER-1"),
      unit("PER-2", { name: "Callao", nameEn: "Callao Region" }),
    ]);

    expect(peru.groups.length).toBeGreaterThan(0);
    for (const group of peru.groups) {
      expect(isChinaRegion(group.id), group.id).toBe(false);
      expect(fitForRegion(group.id, 6), group.id).toBe(NEUTRAL_FIT);
    }
  });

  test("China's own group ids still are the seven — by value, not by type", () => {
    // The other side of the same coin, and the reason `RegionId` may not be
    // narrowed to `ChinaRegion` even though this passes: China's curated
    // grouping yields the seven strings, so the chrome can hand one straight
    // back to `REGION_MONTHS`. That is a coincidence of value which this pins,
    // not a licence to narrow the type — `lib/chinaRegion.test.ts` holds the
    // other half.
    const china = regionSchemeFor("CN", [
      unit("110000", { name: "北京市", nameEn: null }),
      unit("310000", { name: "上海市", nameEn: null }),
      unit("510000", { name: "四川省", nameEn: null }),
      unit("100000_JD", { name: "九段线", nameEn: null, selectable: false }),
    ]);

    expect(china.kind).toBe("curated");
    expect(china.groups.map((g) => g.id)).toEqual(["North", "East", "Southwest"]);
    for (const group of china.groups) {
      expect(isChinaRegion(group.id), group.id).toBe(true);
      expect(fitForRegion(group.id, 6), group.id).not.toBe(NEUTRAL_FIT);
    }
  });
});
