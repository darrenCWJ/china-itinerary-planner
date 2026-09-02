import { describe, expect, test, vi } from "vitest";
import type { Airport } from "@/lib/airports";
import { REGION_MONTHS } from "@/lib/months";
import { regionSchemeFor } from "@/lib/regionScheme";
import type { ProvinceUnit } from "@/lib/provinceTopology";
import type { CountryLevelProps } from "./CountryLevel";
import type { CountryMapProps } from "./CountryMap";
import {
  fitForPlace,
  fitForRegion,
  isChinaRegion,
  NEUTRAL_FIT,
  originLineFor,
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
