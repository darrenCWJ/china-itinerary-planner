import { describe, expect, test } from "vitest";
import fixture from "@/data/climate-anchors.json";
import { monthFit } from "@/lib/climateModel";
import { GEONAMES_NO_DATA_ELEVATION, parseCityShard, type CityShardRow } from "@/lib/cityShard";
import { parseClimateShard } from "@/lib/climateShard";
import { buildClimateIndex, NO_CLIMATE } from "./climateIndex";
import { fitForPlace, NEUTRAL_FIT, type MapPlace } from "./mapTypes";

/**
 * `.test.tsx` because `components/**\/*.test.ts` matches NO vitest project —
 * the module is components-local (it returns `mapTypes.DerivedClimateIndex`,
 * and lib/ cannot import components/), so this is its home.
 */

const row = (key: string): number[] => {
  const found = fixture.cities.find((c) => c.key === key);
  if (!found) throw new Error(`data/climate-anchors.json has no city "${key}"`);
  return found.row;
};

const LIMA = "G3936456";
const CUSCO = "G3941584";

/** Two real rows under their real ids, through the real parser. */
const PE_CLIMATE = parseClimateShard(
  {
    country: "PE",
    generatedAt: "2026-09-03T19:48:35.466Z",
    source: "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228",
    cities: { [LIMA]: row("lima"), [CUSCO]: row("cusco") },
  },
  "PE"
);

/** The city rows those ids join to, in the shape the shard parser hands out. */
function cityRows(elevations: Record<string, unknown>): CityShardRow[] {
  return parseCityShard(
    {
      country: "PE",
      generatedAt: "2026-08-25T09:23:00.949Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities: Object.entries(elevations).map(([id, elev]) => ({
        id,
        n: id === LIMA ? "Lima" : "Cusco",
        lat: id === LIMA ? -12.04318 : -13.53188,
        lon: id === LIMA ? -77.02824 : -71.96701,
        a1: id === LIMA ? "Lima Province" : "Cuzco Department",
        a1c: id === LIMA ? "PE.15" : "PE.08",
        p: id === LIMA ? 7_737_002 : 428_450,
        elev,
        tz: "America/Lima",
      })),
    },
    "PE"
  ).cities;
}

const cusco: MapPlace = {
  id: CUSCO,
  kind: "catalog",
  name: "Cusco",
  localName: null,
  province: "Cuzco Department",
  country: "PE",
  region: "Cuzco Department",
  lat: -13.53188,
  lon: -71.96701,
  population: 428_450,
  level: "prefecture",
  attractionCount: 0,
  blurb: null,
};

const JUNE = 6;

describe("buildClimateIndex", () => {
  test("joins every climate row to its city's elevation, by id", () => {
    const index = buildClimateIndex(PE_CLIMATE, cityRows({ [LIMA]: 152, [CUSCO]: 3312 }));
    expect(index.size).toBe(2);
    expect(index.get(CUSCO)).toEqual({ row: row("cusco"), elev: 3312 });
    expect(index.get(LIMA)).toEqual({ row: row("lima"), elev: 152 });
  });

  test("a climate row whose city is not in the shard gets no correction, not a guess", () => {
    // The drift case lib/climateShard.test.ts bounds: the nightly cities
    // refresh can drop a city the climate artifact still carries. Its row is
    // kept — an id the map never draws costs nothing — with `elev: null`,
    // which lib/climateModel.ts reads as "apply no lapse-rate correction".
    const index = buildClimateIndex(PE_CLIMATE, cityRows({ [LIMA]: 152 }));
    expect(index.get(CUSCO)).toEqual({ row: row("cusco"), elev: null });
    expect(index.get(LIMA)?.elev).toBe(152);
  });

  test("a null elevation stays null, and the -9999 sentinel never reaches the index", () => {
    // 301 committed rows carry `elev: null`; shards written before 2026-09-03
    // carried -9999 there, and a browser cache can still serve one. The city
    // parser nulls the sentinel at the boundary, so this proves the pipeline
    // rather than re-implementing the guard here.
    const index = buildClimateIndex(
      PE_CLIMATE,
      cityRows({ [LIMA]: null, [CUSCO]: GEONAMES_NO_DATA_ELEVATION })
    );
    expect(index.get(LIMA)?.elev).toBeNull();
    expect(index.get(CUSCO)?.elev).toBeNull();
  });

  test("no shard, or an empty one, is the one shared empty index", () => {
    // Referentially the same value every time, so a component can hold it as
    // a default prop and a `useMemo` keyed on it never re-fires for "still
    // nothing".
    expect(buildClimateIndex(null, cityRows({ [LIMA]: 152 }))).toBe(NO_CLIMATE);
    const empty = parseClimateShard(
      { country: "PE", generatedAt: "2026-09-03T19:48:35.466Z", source: "CHELSA", cities: {} },
      "PE"
    );
    expect(buildClimateIndex(empty, cityRows({ [LIMA]: 152 }))).toBe(NO_CLIMATE);
    expect(NO_CLIMATE.size).toBe(0);
  });

  test("is exactly what fitForPlace reads, elevation and all", () => {
    const withElevation = buildClimateIndex(PE_CLIMATE, cityRows({ [CUSCO]: 3312 }));
    const without = buildClimateIndex(PE_CLIMATE, cityRows({}));
    // Armed: the two verdicts differ, so the join is observable through the
    // resolver and not just through `.get`.
    expect(monthFit(row("cusco"), 3312, JUNE - 1)).toBe("great");
    expect(monthFit(row("cusco"), null, JUNE - 1)).toBe("ok");
    expect(fitForPlace(cusco, JUNE, withElevation)).toBe("great");
    expect(fitForPlace(cusco, JUNE, without)).toBe("ok");
    expect(fitForPlace(cusco, JUNE, NO_CLIMATE)).toBe(NEUTRAL_FIT);
  });
});
