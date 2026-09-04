import { describe, expect, test, vi } from "vitest";
import fixture from "@/data/climate-anchors.json";
import type { Airport } from "@/lib/airports";
import { climateMonth, monthFit } from "@/lib/climateModel";
import { climateGapNote } from "@/lib/climateNote";
import { monthFitForSeasons, REGION_MONTHS, type MonthFit } from "@/lib/months";
import { regionSchemeFor } from "@/lib/regionScheme";
import type { ProvinceUnit } from "@/lib/provinceTopology";
import type { CountryLevelProps } from "./CountryLevel";
import type { CountryMapProps } from "./CountryMap";
import {
  CLIMATE_COUNTRY,
  FIT_COLORS,
  FIT_ORDER,
  fitForPlace,
  fitForRegion,
  isChinaRegion,
  NEUTRAL_FIT,
  originLineFor,
  placeClimateFor,
  type DerivedClimate,
  type DerivedClimateIndex,
  type DerivedRegionFits,
  type MapPlace,
} from "./mapTypes";

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

/**
 * The month every fit assertion below is read at, in `fitForPlace`'s own
 * 1-based numbering. `lib/climateModel.ts` is 0-based (January at 0, spec
 * §9.4), so a derived expectation is `monthFit(row, elev, JUNE - 1)` — the one
 * conversion the derived branch has to get right.
 */
const JUNE = 6;

/** Every key that resolves through a plain object's prototype chain. */
const HOSTILE_KEYS = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];

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

  test("a hostile region id still resolves to unknown", () => {
    // The same hazard one step further down. `fitForRegion` now consults a
    // caller-supplied lookup after the China check fails, so there is a second
    // table a hostile id could resolve against — and the reason it cannot is
    // the reason that lookup is a `ReadonlyMap` and not a `Record`.
    const derived: DerivedRegionFits = new Map([["PE-CUS", "great"]]);
    const asRecord: Record<string, MonthFit> = { "PE-CUS": "great" };

    for (const hostile of HOSTILE_KEYS) {
      // The hazard is real: a plain object answers every one of these.
      expect(asRecord[hostile], hostile).toBeDefined();
      // A Map answers none, so the branch below it is never entered.
      expect(derived.get(hostile), hostile).toBeUndefined();
      expect(fitForRegion(hostile, JUNE, derived), hostile).toBe(NEUTRAL_FIT);
    }

    // And the lookup really does resolve a key it holds, or the five rows
    // above pass because the parameter is ignored rather than because it is
    // safe.
    expect(fitForRegion("PE-CUS", JUNE, derived)).toBe("great");
  });

  test("a Peruvian L3 group id no longer forces NEUTRAL_FIT when a derived row exists", () => {
    // The rewrite of Plan 4's merge gate, which asserted that a Peruvian group
    // id resolves to NEUTRAL_FIT — written against exactly this change, and
    // for a property that has NOT gone away. Both halves are pinned here.
    //
    // Phase 4's exposure is unchanged: `regionSchemeFor` group ids reach
    // `zoomRegion`, and `RegionId` is `string`, so nothing in the type system
    // keeps a Peruvian unit id away from the China tables. What changes is
    // only what happens after the China check says no — `unknown` if the
    // caller passed nothing, the caller's verdict if it passed one. A Peruvian
    // id never indexes `REGION_MONTHS` either way.
    const peru = regionSchemeFor("PE", [
      unit("PER-1"),
      unit("PER-2", { name: "Callao", nameEn: "Callao Region" }),
    ]);

    expect(peru.groups.length).toBeGreaterThan(0);

    // Half one, Plan 4's property, byte for byte: no lookup, no fit, and not
    // one of China's seven.
    for (const group of peru.groups) {
      expect(isChinaRegion(group.id), group.id).toBe(false);
      expect(fitForRegion(group.id, 6), group.id).toBe(NEUTRAL_FIT);
    }

    // Half two, the new seam. Plan 6 declined to aggregate (P6-1); the seam
    // stays uncalled. All this pins is that a verdict handed in is
    // handed back, and that being answerable did not make the id Chinese.
    const bands: MonthFit[] = ["great", "ok", "poor", "avoid"];
    const derived: DerivedRegionFits = new Map(
      peru.groups.map((group, i) => [group.id, bands[i % bands.length]])
    );
    for (const group of peru.groups) {
      expect(isChinaRegion(group.id), group.id).toBe(false);
      expect(fitForRegion(group.id, JUNE, derived), group.id).toBe(derived.get(group.id));
    }

    // A group id the lookup does not hold is still `unknown`: the seam adds a
    // source of verdicts, not a default.
    expect(fitForRegion("PER-404", JUNE, derived)).toBe(NEUTRAL_FIT);
  });

  test("not even China's own group ids reach the climate table any more", () => {
    // This used to assert the opposite, and the change is the point.
    //
    // China's groups were its seven curated regions, so their ids WERE the
    // seven `ChinaRegion` strings and the chrome could hand one straight back
    // to `REGION_MONTHS`. That was a coincidence of value, pinned here so
    // nobody mistook it for a licence to narrow `RegionId` to `ChinaRegion`.
    //
    // China now takes the same admin-1 path as the other 245, so its group ids
    // are GB/T 2260 adcodes and the coincidence is gone. `RegionId` stays
    // `string` for the same reason as before — the ids come from a data file —
    // but the hazard it guards against has moved from "a region id is a valid
    // climate key" to "no region id is", which is the safer of the two and
    // worth pinning in its own right.
    const china = regionSchemeFor("CN", [
      unit("110000", { name: "北京市", nameEn: null }),
      unit("310000", { name: "上海市", nameEn: null }),
      unit("510000", { name: "四川省", nameEn: null }),
      unit("100000_JD", { name: "九段线", nameEn: null, selectable: false }),
    ]);

    expect(china.kind).toBe("admin1");
    expect(china.groups.map((g) => g.id)).toEqual(["110000", "310000", "510000"]);
    for (const group of china.groups) {
      expect(isChinaRegion(group.id), group.id).toBe(false);
      expect(fitForRegion(group.id, 6), group.id).toBe(NEUTRAL_FIT);
    }

    // The seven are still real, and still the climate key — they just are not
    // map identifiers any more. `REGION_MONTHS` is untouched (§6.4).
    for (const region of Object.keys(REGION_MONTHS)) {
      expect(isChinaRegion(region), region).toBe(true);
    }
  });
});

/** A catalog city in the shape `MapExplorer` builds one. */
const city = (over: Partial<MapPlace> & Pick<MapPlace, "id" | "name" | "country">): MapPlace => ({
  kind: "catalog",
  localName: null,
  province: null,
  region: "",
  lat: 0,
  lon: 0,
  population: null,
  level: "prefecture",
  attractionCount: 0,
  blurb: null,
  ...over,
});

/**
 * One city's derived climate, out of the real fixture.
 *
 * `data/climate-anchors.json` is `scripts/sample-climate-anchors.mjs`'s
 * CHELSA sample — the same 19 rows `lib/climateModel.test.ts` is calibrated
 * against. Real rows rather than a stub, so every derived verdict below is
 * `lib/climateModel.ts`'s and not a value invented to agree with the
 * assertion next to it.
 */
function anchor(key: string): DerivedClimate {
  const found = fixture.cities.find((c) => c.key === key);
  if (!found) throw new Error(`data/climate-anchors.json has no city "${key}"`);
  return { row: found.row, elev: found.elev };
}

/**
 * The half of the guard `isChinaRegion` structurally cannot cover.
 *
 * `isChinaRegion` answers "is this string one of China's seven region names?"
 * — correctly, and every test above pins that. What it cannot answer is "is
 * this place in China?", and its callers were reading it as though it did.
 * `MapPlace.region` is overloaded: one of China's seven for CN, and the raw
 * admin-1 name for the other 245 countries. Those two name spaces overlap.
 *
 * Not hypothetically. Measured over the committed shards at the time this was
 * written: **122 non-CN rows** carry an admin-1 name that is literally one of
 * China's seven — Botswana 47 ("Central"), Cameroon 31, Iceland 26, Ghana 14,
 * Fiji 4. Every one of them rendered Chongqing's month fit and, on the popup,
 * Chongqing's actual temperatures.
 *
 * The tests above could not catch it because every label they try is one that
 * does not collide ("Cuzco Department", "Kansai", "north", `PER-1`). A
 * colliding label is the whole defect, so these use real ones.
 */
describe("a place outside China cannot read China's climate", () => {
  test("an admin-1 name colliding with one of China's seven gets no China fit", () => {
    const serowe = city({
      id: "G933778",
      name: "Serowe",
      country: "BW",
      province: "Central",
      region: "Central",
      lat: -22.38,
      lon: 26.71,
      population: 47_000,
    });

    // The label really does collide — this is not a strawman.
    expect(isChinaRegion(serowe.region)).toBe(true);
    // And Serowe still gets nothing, because Botswana is not China.
    expect(fitForPlace(serowe, 6)).toBe(NEUTRAL_FIT);

    // With a derived row it stops getting nothing — and what it gets is its
    // own row's verdict, never Chongqing's. The two differ, which is what
    // makes this row an assertion rather than a coincidence.
    const climate: DerivedClimateIndex = new Map([[serowe.id, anchor("cusco")]]);
    expect(REGION_MONTHS.Central[JUNE - 1].fit).toBe("ok");
    expect(fitForPlace(serowe, JUNE, climate)).toBe("great");
  });

  test("every colliding (country, label) pair in the shipped data is checked", () => {
    // Every distinct pair measured over `public/cities/*.json`, not a sample:
    // a fix that special-cases one label leaves the rest red. Counts are the
    // rows affected, and they sum to the 122 in the block comment above.
    const leaky: ReadonlyArray<readonly [string, string, number]> = [
      ["BW", "Central", 47],
      ["CM", "East", 12],
      ["CM", "North", 10],
      ["CM", "South", 9],
      ["FJ", "Central", 4],
      ["GH", "Central", 14],
      ["IS", "South", 9],
      ["IS", "East", 8],
      ["IS", "Northeast", 6],
      ["IS", "Northwest", 3],
    ];
    expect(leaky.reduce((n, [, , rows]) => n + rows, 0)).toBe(122);

    for (const [country, region] of leaky) {
      // Each label must really be one of China's seven, or the row below
      // would pass for the wrong reason and this test would rot into a
      // tautology the first time someone mistypes a province name.
      expect(isChinaRegion(region), `${region} must collide to be worth testing`).toBe(true);
      const place = city({ id: `X${country}${region}`, name: "Somewhere", country, region });
      expect(fitForPlace(place, 6), `${country}/${region}`).toBe(NEUTRAL_FIT);
    }
  });

  test("China's own catalog cities still resolve a real month fit", () => {
    // The other side: the guard must not have been closed by making it always
    // say no. A Chinese city with one of the seven still reads its row.
    for (const region of Object.keys(REGION_MONTHS)) {
      const place = city({ id: `G${region}`, name: "Somewhere", country: "CN", region });
      expect(fitForPlace(place, 6), region).not.toBe(NEUTRAL_FIT);
    }
  });

  test("the origin line does not place a Botswana district inside China", () => {
    // `originLineFor` reads the same guard to build "<region> China". It is
    // reached only when `province` is null, which is every curated place.
    const curated = city({
      id: "D-serowe",
      name: "Serowe",
      country: "BW",
      kind: "curated",
      level: "curated",
      province: null,
      region: "Central",
    });
    expect(originLineFor(curated)).toBe("Central");

    const beijing = city({
      id: "D-beijing",
      name: "Beijing",
      country: "CN",
      kind: "curated",
      level: "curated",
      province: null,
      region: "North",
    });
    expect(originLineFor(beijing)).toBe("North China");
  });
});

/**
 * §9.5's resolution order, and where its one contradiction was resolved.
 *
 * The full order is: curated `bestSeasons` → curated `REGION_MONTHS` →
 * derived worldwide → `unknown`. §9.4 puts the derived step in `regionFit`
 * and §9.5's last paragraph forbids `fitForPlace`; `regionFit` receives
 * neither a country code nor a city id, and the artifact is keyed per city,
 * so §9.4's instruction cannot be carried out as written. The branch went
 * into `fitForPlace` — the only one of the two that holds a `MapPlace`, and
 * therefore the only one that knows which city — placed BELOW the China step,
 * which is what keeps §9.5's "China stays authoritative" true.
 *
 * Nothing here fetches. The lookup is a `ReadonlyMap` the caller has already
 * joined from the two artifacts it fetched, and `mapTypes.ts` reads it
 * synchronously.
 */
describe("the derived branch sits below curated China", () => {
  test("curated China still wins over any derived row", () => {
    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    const row = anchor("beijing");
    const climate: DerivedClimateIndex = new Map([[beijing.id, row]]);

    // Armed both ways: the row is really in the lookup, and the model really
    // would return something else for it. Without these two the assertion
    // below passes whether the branch is ordered correctly or missing.
    expect(climate.get(beijing.id)).toBeDefined();
    expect(monthFit(row.row, row.elev, JUNE - 1)).toBe("great");
    expect(REGION_MONTHS.North[JUNE - 1].fit).toBe("ok");
    expect(fitForPlace(beijing, JUNE, climate)).toBe("ok");

    // The region half of the same rule: a China region id is answered by
    // `REGION_MONTHS` and never by the region lookup.
    const regions: DerivedRegionFits = new Map([["North", "avoid"]]);
    expect(regions.get("North")).toBe("avoid");
    expect(fitForRegion("North", JUNE, regions)).toBe("ok");

    // And step 1 still precedes both — a curated place's own seasons are read
    // before either table is consulted.
    const curated = city({
      id: "D-beijing",
      name: "Beijing",
      country: "CN",
      kind: "curated",
      level: "curated",
      region: "North",
      bestSeasons: ["autumn"],
      avoidSeasons: ["summer"],
    });
    expect(fitForPlace(curated, JUNE, new Map([[curated.id, row]]))).toBe("avoid");
  });

  test("no Chinese catalog city reaches the derived branch, not just the seven", () => {
    // Why the China step is gated on `place.country` and not on
    // `isChinaPlace`. Measured over `public/cities/CN.json`: not one of its
    // 412 rows carries an admin-1 name that is one of China's seven — they
    // are "Sichuan", "Guangdong", "Beijing" — so `isChinaPlace` is false for
    // every Chinese catalog city on the map. Gate the derived branch on it
    // and all 412 would change colour if a caller ever handed the map CN's
    // climate shard — which `MapExplorer` never fetches (P6-5) — which is
    // precisely the regression §9.5's success test exists to catch.
    const mianyang = city({
      id: "G1800627",
      name: "Mianyang",
      country: "CN",
      province: "Sichuan",
      region: "Sichuan",
    });
    // Chengdu's anchor row, 90 km away, standing in for the artifact Task 6
    // builds; the identity is Mianyang's real shard row.
    const climate: DerivedClimateIndex = new Map([[mianyang.id, anchor("chengdu")]]);

    expect(isChinaRegion(mianyang.region)).toBe(false);
    expect(climate.get(mianyang.id)).toBeDefined();
    expect(fitForPlace(mianyang, JUNE, climate)).toBe(NEUTRAL_FIT);
  });

  test("the lookup carries an elevation, not just a row", () => {
    // `MapPlace` has no elevation field and the model's fix 4 — the
    // lapse-rate correction — cannot run without one, which is why the
    // lookup's value is `{ row, elev }` and not the row alone. Not a
    // formality: Cusco sits at 3,312 m and the correction is worth a whole
    // band in June.
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    const climate = anchor("cusco");
    expect(climate.elev).toBe(3312);

    const withElevation: DerivedClimateIndex = new Map([[cusco.id, climate]]);
    const without: DerivedClimateIndex = new Map([[cusco.id, { row: climate.row, elev: null }]]);
    expect(fitForPlace(cusco, JUNE, withElevation)).toBe("great");
    expect(fitForPlace(cusco, JUNE, without)).toBe("ok");
  });

  test("an id the lookup does not hold still resolves to unknown", () => {
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });

    // No lookup at all — every caller in the tree today, and what
    // `RouteMap` and `MapExplorer` pass for a place with no row.
    expect(fitForPlace(cusco, JUNE)).toBe(NEUTRAL_FIT);
    // A lookup that holds some other city.
    expect(fitForPlace(cusco, JUNE, new Map([["G3936456", anchor("lima")]]))).toBe(NEUTRAL_FIT);

    // And an id that would resolve against a plain object, for the same
    // reason `fitForRegion`'s does not: `.get` cannot walk a prototype chain.
    const climate: DerivedClimateIndex = new Map([[cusco.id, anchor("cusco")]]);
    for (const hostile of HOSTILE_KEYS) {
      const forged = city({ id: hostile, name: "Nowhere", country: "PE", region: "Cusco" });
      expect(climate.get(forged.id), hostile).toBeUndefined();
      expect(fitForPlace(forged, JUNE, climate), hostile).toBe(NEUTRAL_FIT);
    }
  });

  test("a month outside 1-12 throws on the derived branch, same as the curated one", () => {
    // Pinned because it is a real behaviour change: before this branch
    // existed, a non-China place returned NEUTRAL_FIT for any month,
    // including a nonsense one — nothing on this path could throw. Now
    // `month - 1` reaches `climateModel.ts`'s `assertMonth`, which throws for
    // anything outside 0..11. Not caught here on purpose: Task 8's loader is
    // the boundary meant to keep a malformed call out of production, not this
    // function.
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    const climate: DerivedClimateIndex = new Map([[cusco.id, anchor("cusco")]]);

    expect(() => fitForPlace(cusco, 0, climate)).toThrow(/month/i);
    expect(() => fitForPlace(cusco, 13, climate)).toThrow(/month/i);
  });

  test("a malformed derived row throws rather than resolving to unknown", () => {
    // Same reasoning as the month case: `monthFit` throws on a row that is
    // not exactly 60 safe integers (`climateModel.ts`'s `assertRow`), a
    // documented behaviour change from the old always-NEUTRAL_FIT path. Left
    // to throw rather than caught here: parsing the artifact is Task 8's
    // `lib/climateShard.ts`'s job, and swallowing a malformed row behind a
    // grey NEUTRAL_FIT pin would hide a real bug instead of surfacing it.
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    const truncated = anchor("cusco");
    const climate: DerivedClimateIndex = new Map([
      [cusco.id, { row: truncated.row.slice(0, 59), elev: truncated.elev }],
    ]);

    expect(() => fitForPlace(cusco, JUNE, climate)).toThrow(/row|60/i);
  });
});

/**
 * The lo/hi line's one resolver. `PlacePopup` used to hold this decision
 * inline (`isChinaPlace(place) && isChinaRegion(place.region) ?
 * regionMonthClimate(...) : null`); §5.3.3's card is a second surface making
 * the same claim, and two copies would drift on the first change to either.
 */
describe("placeClimateFor", () => {
  const OCTOBER = 10;

  test("a Chinese place in one of the seven reads the curated table, note included", () => {
    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    const expected = REGION_MONTHS.North[OCTOBER - 1];
    expect(placeClimateFor(beijing, OCTOBER)).toEqual({
      lo: expected.lo,
      hi: expected.hi,
      note: expected.note,
      source: "curated",
    });
  });

  test("a Chinese place never reads a derived row — inside the seven or outside them", () => {
    // Mianyang's real shard row: admin-1 "Sichuan", which is not one of the
    // seven. The row in the lookup is the one a caller that fetched CN.json
    // would hand over, and §9.5 says it is ignored.
    const mianyang = city({
      id: "G1800627",
      name: "Mianyang",
      country: "CN",
      province: "Sichuan",
      region: "Sichuan",
    });
    expect(placeClimateFor(mianyang, OCTOBER, new Map([[mianyang.id, anchor("chengdu")]]))).toBeNull();

    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    const withRow = placeClimateFor(beijing, OCTOBER, new Map([[beijing.id, anchor("beijing")]]));
    expect(withRow?.source).toBe("curated");
    expect(withRow?.lo).toBe(REGION_MONTHS.North[OCTOBER - 1].lo);
  });

  test("a place outside China reads its derived row, calendar-indexed from January at 0", () => {
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    const row = anchor("cusco");
    const june = climateMonth(row.row, JUNE - 1);
    expect(placeClimateFor(cusco, JUNE, new Map([[cusco.id, row]]))).toEqual({
      lo: june.lo,
      hi: june.hi,
      source: "derived",
    });
    // Integers, straight off the row: spec §9.4 — the popup interpolates
    // these unformatted, so a float here would render as `8.437°`.
    expect(Number.isInteger(june.lo) && Number.isInteger(june.hi)).toBe(true);
  });

  test("no row, no line — and an admin-1 name that spells like China's is still not China", () => {
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    expect(placeClimateFor(cusco, JUNE)).toBeNull();
    expect(placeClimateFor(cusco, JUNE, new Map())).toBeNull();
    // Botswana's Central District, the collision commit 1407502 fixed at the
    // place level: no China row, and with no derived row, nothing at all.
    const serowe = city({ id: "G933366", name: "Serowe", country: "BW", region: "Central" });
    expect(placeClimateFor(serowe, JUNE)).toBeNull();
  });

  test("a month outside 1-12 throws on both branches, as fitForPlace does", () => {
    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    expect(() => placeClimateFor(beijing, 13)).toThrow();
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    expect(() => placeClimateFor(cusco, 0, new Map([[cusco.id, anchor("cusco")]]))).toThrow();
  });
});

describe("an empty bestSeasons is no claim", () => {
  test("falls through to the derived row, and to unknown without one", () => {
    // `[]` is what app/plan/page.tsx stamps on a hand-typed place and what
    // lib/server/catalog.ts stamps on every catalog and GeoNames destination
    // since §9.6. It used to read as "ok" in every month — a verdict nobody
    // gave — because `[]` is truthy and `monthFitForSeasons` answers "ok" for
    // any season outside an empty list.
    expect(monthFitForSeasons({ bestSeasons: [] }, JUNE)).toBe("ok");

    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco", bestSeasons: [] });
    const row = anchor("cusco");
    expect(fitForPlace(cusco, JUNE)).toBe(NEUTRAL_FIT);
    expect(fitForPlace(cusco, JUNE, new Map([[cusco.id, row]]))).toBe(monthFit(row.row, row.elev, JUNE - 1));
  });

  test("a non-empty list is still the first word", () => {
    const beijing = city({
      id: "D-beijing",
      name: "Beijing",
      country: "CN",
      kind: "curated",
      level: "curated",
      region: "North",
      bestSeasons: ["autumn"],
    });
    expect(fitForPlace(beijing, 10)).toBe("great");
    expect(fitForPlace(beijing, JUNE)).toBe("ok");
  });
});

describe("FIT_ORDER", () => {
  test("names every band exactly once, best first and absence last", () => {
    expect([...FIT_ORDER].sort()).toEqual(Object.keys(FIT_COLORS).sort());
    expect(new Set(FIT_ORDER).size).toBe(FIT_ORDER.length);
    expect(FIT_ORDER[0]).toBe("great");
    expect(FIT_ORDER[FIT_ORDER.length - 1]).toBe("unknown");
  });
});

/**
 * §10.1's other clause: "Airports are never selectable trip stops and the
 * types must enforce it."
 *
 * A compile-time block on purpose. The runtime half already exists —
 * `CountryLevel.test.tsx`'s "clicking an airport mark does not select
 * anything" — and all it can prove is that the layer *as written* never calls
 * `onTogglePlace`. It cannot prove that a later edit could not, and that is
 * the failure the spec is worried about.
 *
 * Why the structural mismatch is not enough on its own: widening
 * `MapPlace["kind"]` to `"curated" | "catalog" | "airport"` — the obvious way
 * to draw the layer through the selection machinery that already exists — and
 * running `npx tsc --noEmit` over the whole repo reports ZERO errors. That was
 * measured before this block was written, not assumed. Every reader of `kind`
 * is `=== "curated"` with an implicit else (`CountryLevel.tsx:401`,
 * `CountryMap.tsx:290`, `PlacePopup.tsx:43`), so a third member changes no
 * branch and `MapExplorer.togglePlace` starts adding airports to trips. The
 * `kind` test below is the only line in the codebase that goes red for it.
 *
 * Each `@ts-expect-error` here is an assertion that reverses: it is satisfied
 * while the line beneath it is illegal, and becomes an error in its own right
 * — TS2578, unused directive — the moment that line becomes legal. `npx tsc
 * --noEmit` is what runs them; `vitest` only checks the companions.
 */
describe("airports are never trip stops, and the compiler is what says so", () => {
  /** Cusco's airport, in the shape `/api/map/airports?country=PE` returns. */
  const CUZ: Airport = {
    iata: "CUZ",
    icao: "SPZO",
    name: "Alejandro Velasco Astete International Airport",
    municipality: "Cusco",
    country: "PE",
    lat: -13.5357,
    lon: -71.9388,
    size: "medium",
  };

  /** The city it serves — a real trip stop, and the thing it is not. */
  const CUSCO: MapPlace = {
    id: "Q5582",
    kind: "catalog",
    name: "Cusco",
    localName: "Qosqo",
    province: "Cusco",
    country: "PE",
    region: "Cusco",
    lat: -13.5167,
    lon: -71.9789,
    population: 428450,
    level: "municipality",
    attractionCount: 0,
    blurb: null,
  };

  test("an Airport is not assignable to MapPlace", () => {
    // @ts-expect-error — an Airport is missing nine of the twelve fields a
    // MapPlace requires. It shares exactly three, `name`/`lat`/`lon`, which is
    // everything a marker is drawn from and nothing a trip stop is made of.
    const place: MapPlace = CUZ;

    // The runtime cannot help here, which is the point: the forged place has
    // no `kind` at all, so every `place.kind === "curated"` reader falls to its
    // implicit else and quietly treats an airport as a catalog city. Nothing
    // throws. The compiler is the only guard there is.
    expect(place.kind).toBeUndefined();
  });

  test("togglePlace's parameter type rejects an airport", () => {
    // `MapExplorer.togglePlace` is `(place: MapPlace) => void` and reaches both
    // levels through this prop, which is where its parameter type is
    // assertable from outside the component.
    const onTogglePlace: CountryMapProps["onTogglePlace"] = vi.fn();

    // @ts-expect-error — the array `MapExplorer` fetches for the estimator and
    // the layer cannot be spent on a trip stop.
    onTogglePlace(CUZ);

    // And that call really happened. JS has no opinion about the argument, so
    // "never a selectable trip stop" is a claim only the type system can make.
    expect(onTogglePlace).toHaveBeenCalledWith(CUZ);

    // The contravariant half, which pins `togglePlace` itself rather than one
    // call to it: a handler written to take an Airport is not a place handler,
    // so `togglePlace` cannot be rewritten into one and still be passed here.
    // @ts-expect-error — parameter types are checked against the prop, strictly.
    const wired: CountryLevelProps["onTogglePlace"] = (airport: Airport) => void airport.iata;

    expect(typeof wired).toBe("function");
  });

  test("MapPlace.kind never gains an airport member", () => {
    // @ts-expect-error — "airport" is not a place kind, and §10.1 says it must
    // never become one. Widening the union is how this rule fails silently;
    // see this block's header for the measurement that says so.
    const kind: MapPlace["kind"] = "airport";

    expect(kind).toBe("airport");
  });

  test("neither prop hop lets the two arrays cross", () => {
    // `CountryLevel` takes both — `places` as controls, `airports` as
    // decoration — and `CountryMap` threads them past each other. Each is
    // refused as the other, which is what stops a copy-paste between the two
    // `.map()`s from compiling.

    // @ts-expect-error — airports are not places.
    const places: CountryLevelProps["places"] = [CUZ];
    // @ts-expect-error — and places are not airports.
    const airports: CountryMapProps["airports"] = [CUSCO];

    expect(places).toHaveLength(1);
    expect(airports).toHaveLength(1);
  });
});

describe("the honesty note agrees with the fit resolution about which country is curated", () => {
  test("lib/climateNote's China is mapTypes' China", () => {
    // Two literals, two layers: lib/ cannot import components/, so
    // lib/climateNote.ts restates "CN". This is the one place they meet.
    expect(climateGapNote(CLIMATE_COUNTRY, 412)).toEqual([]);
    expect(climateGapNote("PE", 750)).toHaveLength(1);
  });
});
