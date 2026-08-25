import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { PlacePopup } from "./PlacePopup";
import type { MapPlace } from "./mapTypes";

/**
 * What the hover card claims about where a place is.
 *
 * Until the worldwide catalog every marker on this map was Chinese, so the
 * origin line could fall back to "<region> China" for any place carrying no
 * province. Two things broke that: `MapExplorer` now puts the admin-1 name in
 * `region` for every country but China, and 439 of the 58,742 committed shard
 * rows carry no admin-1 at all — so `province: null` with `region: ""` is a
 * real Peruvian city, not a defensive fixture. Unguarded, it rendered a bare
 * " China".
 */

function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "catalog",
    localName: null,
    province: null,
    region: "",
    lat: -13.53188,
    lon: -71.96701,
    population: 428_450,
    level: "prefecture",
    attractionCount: 0,
    blurb: null,
    ...over,
  };
}

function show(subject: MapPlace) {
  return render(
    <PlacePopup place={subject} month={10} position={{ x: 100, y: 100 }} containerWidth={640} />
  );
}

afterEach(cleanup);

describe("PlacePopup — where it says a place is", () => {
  test("still reads '<region> China' for a Chinese place with no province", () => {
    // The behaviour the fallback exists for, and the reason it cannot simply
    // be deleted: every curated Chinese destination carries `province: null`
    // and one of China's seven regions.
    show(
      place({
        id: "beijing",
        name: "Beijing",
        kind: "curated",
        level: "curated",
        region: "North",
      })
    );

    expect(screen.getByText("North China")).toBeInTheDocument();
  });

  test("names a foreign city's admin-1 rather than putting it in China", () => {
    show(
      place({
        id: "G3941584",
        name: "Cusco",
        province: "Cuzco Department",
        region: "Cuzco Department",
      })
    );

    expect(screen.getByText("Cuzco Department · prefecture")).toBeInTheDocument();
    expect(screen.queryByText(/China/)).not.toBeInTheDocument();
  });

  test("says nothing about a country for a shard city with no admin-1 at all", () => {
    show(place({ id: "G3936456", name: "Somewhere in Peru" }));

    expect(screen.queryByText(/China/)).not.toBeInTheDocument();
    // And no orphaned separator where the origin used to be: the level is all
    // that is left, so it stands alone rather than after a dangling "·".
    expect(screen.getByText("prefecture")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});
