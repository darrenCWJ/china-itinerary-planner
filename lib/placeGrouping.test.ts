import { describe, expect, test } from "vitest";
import type { MapPlace } from "@/components/map/mapTypes";
import { filterPlaces, groupPlacesByAdmin1, UNGROUPED_KEY } from "./placeGrouping";

function place(name: string, province: string | null): MapPlace {
  return {
    id: `G-${name}`,
    kind: "catalog",
    name,
    localName: null,
    province,
    country: "CN",
    region: "East",
    lat: 0,
    lon: 0,
    population: null,
    level: "county",
    attractionCount: 0,
    blurb: null,
  };
}

describe("groupPlacesByAdmin1", () => {
  test("groups places under their province, keeping input order within a group", () => {
    const groups = groupPlacesByAdmin1([
      place("Lima", "Lima"),
      place("Cusco", "Cuzco"),
      place("Callao", "Lima"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Lima", "Cuzco"]);
    // Population order arrives from the shard and must survive grouping —
    // it is what makes the first name in each group the recognisable one.
    expect(groups[0].places.map((p) => p.name)).toEqual(["Lima", "Callao"]);
  });

  test("orders groups by their first appearance, not alphabetically", () => {
    // First appearance is population order, so the province a user is most
    // likely to want is first. Alphabetical would put Amazonas above Lima.
    const groups = groupPlacesByAdmin1([
      place("Lima", "Lima"),
      place("Chachapoyas", "Amazonas"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Lima", "Amazonas"]);
  });

  test("collects places with no province into one trailing group", () => {
    const groups = groupPlacesByAdmin1([
      place("Nowhere", null),
      place("Lima", "Lima"),
      place("Elsewhere", null),
    ]);
    // Last, not first: 19 countries have no admin-1 at all, and in those the
    // single group is the whole list; everywhere else it is a remainder.
    expect(groups[groups.length - 1].key).toBe(UNGROUPED_KEY);
    expect(groups[groups.length - 1].label).toBeNull();
    expect(groups[groups.length - 1].places).toHaveLength(2);
  });

  test("treats an empty province string as no province at all", () => {
    // `parseCityShard` already nulls `""`, but `MapPlace` also arrives from
    // the curated catalog, which has no such guard.
    const groups = groupPlacesByAdmin1([place("Blank", "")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(UNGROUPED_KEY);
  });

  test("does not resolve a province named like an Object property", () => {
    // Grouping is keyed on a user-facing string that arrives from a data file.
    // A plain object would give "constructor" a function as its group.
    const groups = groupPlacesByAdmin1([place("Odd", "constructor")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("constructor");
    expect(groups[0].places).toHaveLength(1);
  });

  test("returns no groups for no places", () => {
    expect(groupPlacesByAdmin1([])).toEqual([]);
  });
});

describe("filterPlaces", () => {
  const places = [place("Lima", "Lima"), place("Cusco", "Cuzco"), place("Callao", "Lima")];

  test("returns everything for an empty or whitespace query", () => {
    expect(filterPlaces(places, "")).toHaveLength(3);
    expect(filterPlaces(places, "   ")).toHaveLength(3);
  });

  test("matches a city name case-insensitively, anywhere in the string", () => {
    expect(filterPlaces(places, "cus").map((p) => p.name)).toEqual(["Cusco"]);
    expect(filterPlaces(places, "LA").map((p) => p.name)).toEqual(["Callao"]);
  });

  test("matches the province too, so typing a region narrows to it", () => {
    expect(filterPlaces(places, "cuzco").map((p) => p.name)).toEqual(["Cusco"]);
  });

  test("ignores accents in both the query and the name", () => {
    // The shard carries endonyms: a user typing "Nuremberg" must reach
    // "Nürnberg", and a user typing "Zurich" must reach "Zürich".
    const zurich = [place("Zürich", "Zürich")];
    expect(filterPlaces(zurich, "zurich")).toHaveLength(1);
    expect(filterPlaces(zurich, "ZÜRICH")).toHaveLength(1);
  });

  test("returns nothing when nothing matches", () => {
    expect(filterPlaces(places, "zzz")).toEqual([]);
  });
});
