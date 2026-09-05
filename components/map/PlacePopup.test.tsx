import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import fixture from "@/data/climate-anchors.json";
import { climateMonth, monthFit } from "@/lib/climateModel";
import { NATIONAL_CROWD, REGION_MONTHS } from "@/lib/months";
import { PlacePopup } from "./PlacePopup";
import { FIT_LABELS, type DerivedClimateIndex, type MapPlace } from "./mapTypes";

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

/**
 * Defaults to Peru — the opposite of `show`'s CN default below, and
 * deliberately. `country` is the place's OWN country and is what unlocks its
 * region label; `show`'s is the country being planned. The two are independent
 * (a route map draws stops from several countries at once), so every Chinese
 * fixture here states `country: "CN"` rather than inheriting it.
 */
function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "catalog",
    localName: null,
    province: null,
    country: "PE",
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

/**
 * `country` defaults to CN so the origin-line cases below read exactly as they
 * did before the prop existed — they are about `place`, not about the country
 * being planned. The crowd cases pass it explicitly, in both directions.
 */
function show(subject: MapPlace, country = "CN", month = 10, climate?: DerivedClimateIndex) {
  return render(
    <PlacePopup
      place={subject}
      month={month}
      position={{ x: 100, y: 100 }}
      containerWidth={640}
      country={country}
      climate={climate}
    />
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
        // Spelled out now that the place's own country is what unlocks its
        // region label — Botswana's Central District is spelled like China's.
        country: "CN",
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

  test("prefers a Chinese catalog city's province over its region", () => {
    // The one shape where the two fields genuinely disagree, and so the only
    // one that pins the `place.province ??` precedence. Outside China
    // `MapExplorer` sets `region: c.province ?? ""` (MapExplorer.tsx), which is
    // why Cusco above carries the same string twice and cannot tell the two
    // apart; inside China it sets the seven-region label instead, so a Jiangsu
    // city arrives with `province: "Jiangsu"` and `region: "East"`. Dropping
    // the precedence renders "East China" over the province the catalog knows.
    show(
      place({
        id: "Q57947",
        name: "Nantong",
        province: "Jiangsu",
        country: "CN",
        region: "East",
      })
    );

    expect(screen.getByText("Jiangsu · prefecture")).toBeInTheDocument();
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

/**
 * The hover card used to read `crowdForMonth` and `bandsForMonth` straight out
 * of lib/months.ts — China's tables — so every Peruvian city hover showed
 * China's national crowd curve, and February showed 🧧.
 *
 * Both directions, in the same file, for the reason
 * components/map/MonthTimeline.test.tsx spells out: "Peru shows no crowd dots"
 * passes just as well against a card that renders nothing.
 */
describe("PlacePopup — whose crowd curve it shows", () => {
  const cusco = { id: "G3941584", name: "Cusco", province: "Cuzco Department", region: "Cuzco Department" };

  test("a Chinese place still shows China's crowd dots and October's band glyph", () => {
    const { container } = show(
      place({
        id: "beijing",
        name: "Beijing",
        kind: "curated",
        level: "curated",
        country: "CN",
        region: "North",
      }),
      "CN"
    );

    // October's real value from the curated curve, not a constant — a card
    // rendering the same figure every month would pass a presence check.
    const october = NATIONAL_CROWD[9];
    expect(container.textContent).toContain(`Crowds ${"●".repeat(october)}${"○".repeat(5 - october)}`);
    expect(screen.getByTitle("National Day Golden Week falls in this month")).toBeInTheDocument();
    expect(container.textContent).toContain("🇨🇳");
  });

  test("a Peruvian place shows no crowd element at all, and no band glyph", () => {
    const { container } = show(place(cusco), "PE");

    expect(container.textContent).not.toContain("Crowds");
    expect(container.textContent).not.toContain("●");
    expect(container.textContent).not.toContain("○");
    expect(screen.queryByTitle(/falls in this month/)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("🇨🇳");
    // Positive half: the card is still a card. Without this the four absences
    // above are satisfied by a component that returned null.
    expect(screen.getByText("Cusco")).toBeInTheDocument();
    expect(screen.getByText("Click to select")).toBeInTheDocument();
  });

  test("February shows no red envelope over a Peruvian city, and still does over a Chinese one", () => {
    // The single sharpest string on this surface, and the month it fires in.
    show(place(cusco), "PE", 2);
    expect(screen.queryByTitle(/Chinese New Year/)).not.toBeInTheDocument();
    cleanup();

    show(
      place({
        id: "beijing",
        name: "Beijing",
        kind: "curated",
        level: "curated",
        country: "CN",
        region: "North",
      }),
      "CN",
      2
    );
    expect(screen.getByTitle("Chinese New Year falls in this month")).toBeInTheDocument();
  });
});

/**
 * The last consumer of `isChinaRegion` on this surface, and the only one with
 * no coverage before Phase 4: `regionMonthClimate` is China-only data behind a
 * NON-nullable return type, so a region label from outside the seven does not
 * yield an empty row — it throws. The ternary at PlacePopup.tsx:40 is the whole
 * guard, and Phase 4 widened what can reach it: the third map level identifies
 * a region by `regionScheme.RegionId`, which for the other 245 countries is an
 * admin-1 unit id.
 */
describe("PlacePopup — the climate row is China-only", () => {
  test("reads October out of the region table for a Chinese place", () => {
    const { container } = show(
      place({
        id: "beijing",
        name: "Beijing",
        kind: "curated",
        level: "curated",
        country: "CN",
        region: "North",
      })
    );

    // The real row rather than a literal, for the reason the crowd test above
    // uses NATIONAL_CROWD: a card printing one fixed range every month would
    // satisfy a presence check.
    const october = REGION_MONTHS.North[9];
    expect(container.textContent).toContain(`${october.lo}°–${october.hi}°C typical`);
  });

  test("degrades to no climate row for a place outside China's seven", () => {
    const { container } = show(
      place({ id: "G3941584", name: "Cusco", province: "Cuzco Department", region: "Cuzco Department" }),
      "PE"
    );

    expect(container.textContent).not.toContain("typical");
    // Positive half: the fit dot beside where the climate would have gone is
    // still rendered, so the absence above is a missing row and not a missing
    // card. "No data" is FIT_LABELS.unknown — mapTypes.NEUTRAL_FIT.
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});

/**
 * The derived half of the climate row. The China-only tests above are kept
 * as they are: this surface still reads `REGION_MONTHS` for a Chinese place,
 * and `chinaBaseline.test.tsx` pins that output byte for byte.
 */
describe("PlacePopup — the derived climate row", () => {
  const JUNE = 6;
  const cuscoRow = fixture.cities.find((c) => c.key === "cusco")!.row;
  const cusco = () =>
    place({ id: "G3941584", name: "Cusco", province: "Cuzco Department", region: "Cuzco Department" });

  test("reads a derived row for a place outside China — the verdict and the temperatures", () => {
    const subject = cusco();
    const climate: DerivedClimateIndex = new Map([[subject.id, { row: cuscoRow, elev: 3312 }]]);
    const { container } = show(subject, "PE", JUNE, climate);

    const june = climateMonth(cuscoRow, JUNE - 1);
    expect(container.textContent).toContain(`${june.lo}°–${june.hi}°C typical`);
    expect(screen.getByText(FIT_LABELS[monthFit(cuscoRow, 3312, JUNE - 1)])).toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  test("the elevation it was handed reaches the verdict", () => {
    // Cusco at 3,312 m is `great` in June and `ok` without the lapse-rate
    // correction (mapTypes.test.tsx pins the model); the label on the card
    // has to move with it, or the popup is reading the row and not the pair.
    const subject = cusco();
    expect(monthFit(cuscoRow, 3312, JUNE - 1)).not.toBe(monthFit(cuscoRow, null, JUNE - 1));
    show(subject, "PE", JUNE, new Map([[subject.id, { row: cuscoRow, elev: null }]]));
    expect(screen.getByText(FIT_LABELS[monthFit(cuscoRow, null, JUNE - 1)])).toBeInTheDocument();
  });

  test("a Chinese place ignores a derived row, inside the seven and outside them", () => {
    // Mianyang: admin-1 "Sichuan", not one of the seven, with a row in the
    // lookup. §9.5 — no derived read for any CN place.
    const mianyang = place({
      id: "G1800627",
      name: "Mianyang",
      country: "CN",
      province: "Sichuan",
      region: "Sichuan",
    });
    const { container } = show(mianyang, "CN", 10, new Map([[mianyang.id, { row: cuscoRow, elev: 500 }]]));
    expect(container.textContent).not.toContain("typical");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  test("still degrades to no row for a place the lookup does not hold", () => {
    const { container } = show(cusco(), "PE", JUNE, new Map());
    expect(container.textContent).not.toContain("typical");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
