// First, before any import that could reach `./mapTypes` or `@/lib/dragLayer`:
// the harness registers those mocks, and vitest hoists a mock only above the
// imports of the file that declares it.
import {
  airportNear,
  circleFor,
  CUSCO,
  installCountryLevelHarness,
  levelProps,
  markers,
  markerX,
  PE_ONE_UNIT,
  place,
  renderLevel,
  rings,
  unitTitles,
} from "@/test/countryLevelHarness";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import fixture from "@/data/climate-anchors.json";
import { climateMonth, monthFit } from "@/lib/climateModel";
import { COUNTRY_DETAIL, detailFor } from "@/lib/countryDetail";
import { REGION_MONTHS } from "@/lib/months";
import { parseProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import { unitLabel } from "@/lib/regionScheme";
import FO_PROVINCES from "@/public/provinces/FO.json";
import { CountryLevel } from "./CountryLevel";
import { PE_FILE } from "./countryFixture";
import {
  FIT_COLORS,
  FIT_LABELS,
  fitForPlace,
  type DerivedClimateIndex,
} from "./mapTypes";

installCountryLevelHarness();

describe("CountryLevel", () => {
  test("draws the country outline from merge() over its units", () => {
    const { container } = renderLevel();

    const outline = container.querySelector("[data-outline]");
    expect(outline).not.toBeNull();
    // Two rings, not four: the three mainland units share arcs 0 and 2, so
    // `merge()` dissolves both seams and leaves one mainland ring plus the
    // island. A renderer that stroked the units instead would draw four.
    expect(rings(outline!.getAttribute("d"))).toBe(2);
    expect(container.querySelectorAll("[data-units] path")).toHaveLength(4);
  });

  test("draws only sel === 1 units as selectable", () => {
    const { container } = renderLevel();

    const selectable = [...container.querySelectorAll("[data-unit]")].map((el) =>
      el.getAttribute("data-unit")
    );
    expect(selectable).toEqual(["PE-LIM", "PE-CUS", "PE-ISL"]);
    // Drawn, though: Northern Cyprus shapes CY's outline and TW/HK/MO shape
    // CN's. Dropping the shape would change the country's coastline; offering
    // it would make it a subdivision.
    expect(container.querySelectorAll("[data-units] path")).toHaveLength(4);
    // Named on hover, and only the three.
    expect(unitTitles(container)).toEqual(["Lima", "Cuzco", "Isla Lejana"]);
  });

  test("projects through the manifest entry, not a per-render fit", () => {
    const { container } = renderLevel();

    // The mainland fills the frame: 840 padded units wide, west edge to east.
    // A fit over the features would have to hold the island too and would draw
    // the mainland at a sixth of this — which is precisely what the §5.4 trim
    // exists to prevent, and what would put Clipperton back in frame for FR.
    expect(markerX(container, "cusco") - markerX(container, "lima")).toBeGreaterThan(700);
    // The island is drawn and is out of frame, which is what `hiddenAreaPct`
    // records. The list below still reaches it.
    expect(markerX(container, "isla")).toBeLessThan(0);
  });

  test("falls back to a fit when the country has no manifest entry", () => {
    // The manifest and the code deploy independently, so a country whose entry
    // has not been built yet gets a smaller map — never a blank one, and never
    // a NaN.
    const { container } = renderLevel({ projection: null });

    const width = markerX(container, "cusco") - markerX(container, "lima");
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(300);
    // Everything is in frame under the fit, the island included.
    for (const id of ["lima", "cusco", "isla"]) {
      expect(markerX(container, id)).toBeGreaterThanOrEqual(0);
      expect(markerX(container, id)).toBeLessThanOrEqual(860);
    }
  });

  test("renders the list beside the map, never instead of it", () => {
    // §5.2's invariant, and Plan 1's acceptance criterion applied to the level
    // that finally draws geometry: adding a map must not cost a single place
    // its place in the list.
    renderLevel();

    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    for (const name of ["Lima", "Cusco", "Puerto Lejano"]) {
      // Two controls per place since §5.3.1 gave the markers a keyboard model
      // of their own: a `<g role="button">` on the map and a real `<button>`
      // in the list. The list one is the spine, and it is the one this test is
      // about — a map that swallowed it would leave a single control on an
      // SVG node, which is exactly what §5.2 forbids.
      const controls = screen.getAllByRole("button", { name });
      expect(controls).toHaveLength(2);
      expect(controls.filter((el) => el.tagName === "BUTTON")).toHaveLength(1);
    }
  });

  test("adds a place when its marker is tapped, and reports its hover", () => {
    const { container, props } = renderLevel();

    const marker = container.querySelector('[data-place="cusco"]')!;
    fireEvent.click(marker);
    expect(props.onTogglePlace).toHaveBeenCalledWith(CUSCO);

    fireEvent.mouseEnter(marker, { clientX: 40, clientY: 50 });
    expect(props.onHoverPlace).toHaveBeenCalledWith(CUSCO, expect.anything());
    fireEvent.mouseLeave(marker);
    expect(props.onHoverPlace).toHaveBeenLastCalledWith(null, null);
  });
});

/**
 * The mode `RouteMap` needs and could not previously state.
 *
 * That surface is a VIEW of an itinerary (§2.1) and has always passed `noop`
 * for the toggle. A noop is not a mode: every control §5.3 added still
 * rendered, so a marker announced itself as a pressed toggle, took a tab stop
 * to prove it, and opened a card whose primary button reads "Remove <name> from
 * trip" — with nothing behind it.
 *
 * The fix is a mode rather than a check inside `onTogglePlace`, because the
 * damage is in the ANNOUNCEMENT and not only in the callback: an inert
 * `role="button"` is a promise the accessibility tree makes on the map's
 * behalf. So read-only markers claim nothing — and the list beside them still
 * reaches every place, which is what keeps §12.2 true on a surface where the
 * map has stopped being operable at all.
 */
describe("CountryLevel read-only", () => {
  test("its markers claim nothing they cannot do", () => {
    const { container, props } = renderLevel({ readOnly: true });

    const drawn = markers(container);
    expect(drawn).toHaveLength(3);
    for (const el of drawn) {
      expect(el.getAttribute("role")).toBeNull();
      expect(el.getAttribute("aria-pressed")).toBeNull();
      expect(el.getAttribute("aria-haspopup")).toBeNull();
      expect(el.getAttribute("aria-label")).toBeNull();
      // No tab stop either: the marker layer costs one Tab in the picker
      // because that Tab reaches something. Here it would reach a drawing.
      expect(el.getAttribute("tabindex")).toBeNull();
      // And the cursor tells the same story the roles now do.
      expect(el.getAttribute("class")).toBeNull();
    }

    const [lima, cusco] = drawn;
    fireEvent.click(cusco);
    fireEvent.keyDown(lima, { key: "Enter" });
    fireEvent.keyDown(lima, { key: "ArrowRight" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.onTogglePlace).not.toHaveBeenCalled();
  });

  test("the list beside it is still the whole spine", () => {
    // §5.2 and §12.2 do not soften on a read-only surface. What changes is that
    // the list is now the ONLY control per place rather than the second one —
    // so it had better still be there, and still be a real button.
    renderLevel({ readOnly: true });

    for (const name of ["Lima", "Cusco", "Puerto Lejano"]) {
      const controls = screen.getAllByRole("button", { name });
      expect(controls).toHaveLength(1);
      expect(controls[0].tagName).toBe("BUTTON");
    }
    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
  });

  test("hover still reports, so the tooltip is unaffected", () => {
    // Read-only removes the claims, not the map. `PlacePopup` is drawn by the
    // caller from this callback and describes a place without offering to
    // change anything, which is exactly what this mode allows.
    const { container, props } = renderLevel({ readOnly: true });

    const cusco = markers(container)[1];
    fireEvent.mouseEnter(cusco, { clientX: 40, clientY: 50 });
    expect(props.onHoverPlace).toHaveBeenCalledWith(CUSCO, expect.anything());
    fireEvent.mouseLeave(cusco);
    expect(props.onHoverPlace).toHaveBeenLastCalledWith(null, null);
  });

  test("the picker is untouched — markers stay operable by default", () => {
    // The mode is opt-in, and `MapExplorer` opts out of nothing: a level with
    // no `readOnly` prop is the picker Plan 3 built, card and all.
    const { container, props } = renderLevel();
    const [, cusco] = markers(container);

    expect(cusco).toHaveAttribute("role", "button");
    expect(cusco).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(cusco);
    expect(props.onTogglePlace).toHaveBeenCalledWith(CUSCO);
    expect(screen.getByRole("dialog", { name: "Cusco" })).toBeInTheDocument();
  });
});

/**
 * §6.6 D10: where the province level would BE the country level, it is not
 * offered.
 *
 * 34 of the 246 countries ship exactly one selectable unit, and for them an
 * admin-1 layer is the national outline drawn a second time. `regionSchemeFor`
 * already refuses to make a group out of a lone unit, so no zoom can be reached
 * and no region control can be built out of one — what survives that refusal is
 * the unit's NAME, which this level paints into a `<title>` on the polygon.
 *
 * The Faroes are why that is not cosmetic. `FRO-1443` is a single MultiPolygon
 * spanning the whole archipelago — bbox −7.644..−6.276, 61.394..62.399, which is
 * Suðuroy to Fugloy — and Natural Earth names it `Eysturoyar`, one island of
 * eighteen. The file assigns Tórshavn to it, a city its own shard records under
 * Streymoy. Titling that polygon tells a reader the Faroe Islands are Eysturoy.
 * Monaco and Puerto Rico get the merely redundant version of the same label,
 * and all 34 are treated alike: where the province layer has nothing to divide,
 * it says nothing.
 *
 * The gate is the COUNT and never a list of codes, which is what the second
 * test holds it to — one country code, two files, differing in nothing but how
 * many of their units are `sel: 1`.
 */
describe("CountryLevel where L3 would be L2", () => {
  /** The real Faroes, through the real parser. 7 KB, and the whole of D10. */
  const FO_FILE: ProvinceFile = parseProvinceTopology(FO_PROVINCES, "FO");

  test("offers no region control for the 34 countries with one selectable unit", () => {
    // The registry is what says there are 34, and it says so by COUNT.
    // `regionSchemeFor` reads the units while this reads the index; the two
    // agree for all 246 committed files, and `lib/regionScheme.test.ts` pins it.
    const single = [...COUNTRY_DETAIL].filter(([, detail]) => detail.count <= 1);
    expect(single).toHaveLength(34);
    expect(single.map(([code]) => code)).toContain("FO");

    const lone = FO_FILE.units.filter((unit) => unit.selectable);
    expect(lone).toHaveLength(1);
    // The label exists and is deliberately withheld, so the absence below is a
    // decision rather than a unit that happened to carry no name at all.
    expect(unitLabel("FO", lone[0])).toBe("Eysturoy");

    const { container } = renderLevel({
      country: "FO",
      provinces: FO_FILE,
      projection: null,
      places: [],
    });

    // Drawn, and every island of it: D10 suppresses the province LAYER, never
    // the country's coastline. The map is the enhancement §5.2 promises.
    expect(container.querySelectorAll("[data-units] path")).toHaveLength(1);
    expect(container.querySelector("[data-outline]")).not.toBeNull();
    // And unnamed, anywhere on the surface — not in a title, not in a control.
    expect(unitTitles(container)).toEqual([]);
    expect(container.innerHTML).not.toContain("Eysturoy");
  });

  test("gates on the index count, not on a list of country codes", () => {
    // One country code, two files. A gate written as the 34 codes answers the
    // same for both of these — and so does one written as
    // `detailFor(country).count`, which reports on the COMMITTED Peru rather
    // than on the geometry being drawn. Only a count taken from the units in
    // hand tells them apart.
    expect(PE_FILE.units.filter((unit) => unit.selectable)).toHaveLength(3);
    expect(PE_ONE_UNIT.units.filter((unit) => unit.selectable)).toHaveLength(1);
    expect(detailFor("PE")?.count).toBeGreaterThan(1);

    const { container } = renderLevel();
    expect(unitTitles(container)).toEqual(["Lima", "Cuzco", "Isla Lejana"]);
    cleanup();

    const lone = renderLevel({ provinces: PE_ONE_UNIT });
    expect(unitTitles(lone.container)).toEqual([]);
    // The same country, drawn the same way, saying less: four paths and one
    // merged outline either way.
    expect(lone.container.querySelectorAll("[data-units] path")).toHaveLength(4);
    expect(lone.container.querySelector("[data-outline]")).not.toBeNull();
  });
});

/**
 * §9.4's fit colours, worldwide: the marker reads the index the level was
 * handed, and §5.3.3's card carries the climate line in the slot Plan 3
 * reserved — above the airport line, because the weather is the thing the
 * verdict beside it is about.
 */
describe("CountryLevel derived climate", () => {
  const JUNE = 6;
  const cusco = fixture.cities.find((c) => c.key === "cusco")!;
  const CUSCO_ROW = cusco.row;
  const climate: DerivedClimateIndex = new Map([[CUSCO.id, { row: CUSCO_ROW, elev: cusco.elev }]]);
  const cuscoJune = monthFit(CUSCO_ROW, cusco.elev, JUNE - 1);

  test("colours a marker by its derived verdict, and leaves a place with no row grey", () => {
    const { container } = renderLevel({ climate, month: JUNE });
    // Armed: the verdict is not the absence colour, so a level that ignored
    // the index would fail on Cusco and not merely agree on Lima.
    expect(FIT_COLORS[cuscoJune]).not.toBe(FIT_COLORS.unknown);
    expect(circleFor(container, "cusco", "data-dot").getAttribute("fill")).toBe(FIT_COLORS[cuscoJune]);
    expect(circleFor(container, "lima", "data-dot").getAttribute("fill")).toBe(FIT_COLORS.unknown);
  });

  test("the card carries the climate line, above the airport line, and its chip agrees with the marker", () => {
    const { container } = renderLevel({
      climate,
      month: JUNE,
      airports: [airportNear(CUSCO, "CUZ", 30)],
    });
    fireEvent.click(container.querySelector('[data-place="cusco"]')!);

    const june = climateMonth(CUSCO_ROW, JUNE - 1);
    const facts = container.querySelector("[data-place-facts]")!;
    expect(facts.querySelector("[data-climate]")!.textContent).toBe(`${june.lo}°–${june.hi}°C typical`);
    expect(facts.firstElementChild).toHaveAttribute("data-climate");
    expect(facts.lastElementChild).toHaveAttribute("data-main-airport");
    expect(screen.getByRole("dialog", { name: "Cusco" }).textContent).toContain(FIT_LABELS[cuscoJune]);
  });

  test("no row, no line — the slot stays empty rather than blank", () => {
    const { container } = renderLevel({ climate, month: JUNE });
    fireEvent.click(container.querySelector('[data-place="lima"]')!);
    expect(screen.getByRole("dialog", { name: "Lima" })).toBeInTheDocument();
    expect(container.querySelector("[data-climate]")).toBeNull();
    expect(container.querySelector("[data-place-facts]")!.textContent).toBe("");
  });

  test("a Chinese place reads the curated table on the card and the marker, never a derived row", () => {
    // Drawn on Peru's fixture geometry, which is fine: the place's OWN
    // country decides which table it reads, not the level's (RouteMap is
    // multi-country). The row in the lookup is real and is ignored (§9.5).
    const beijing = place({ id: "beijing", name: "Beijing", country: "CN", region: "North", lon: -78, lat: -12 });
    const { container } = renderLevel({
      places: [beijing],
      climate: new Map([[beijing.id, { row: CUSCO_ROW, elev: cusco.elev }]]),
      month: 10,
    });
    const october = REGION_MONTHS.North[9];
    expect(circleFor(container, "beijing", "data-dot").getAttribute("fill")).toBe(FIT_COLORS[october.fit]);
    fireEvent.click(container.querySelector('[data-place="beijing"]')!);
    expect(container.querySelector("[data-climate]")!.textContent).toBe(`${october.lo}°–${october.hi}°C typical`);
  });

  test("resolves each marker's verdict once per month, not once per hover", () => {
    /**
     * A host that re-renders the level on hover, as MapExplorer does — the
     * hover card is state above the level. Without it the level would not
     * re-render and the assertion would be vacuous.
     */
    function HoverHost(props: Parameters<typeof CountryLevel>[0]) {
      const [hovered, setHovered] = useState<string>("");
      return (
        <>
          <CountryLevel {...props} onHoverPlace={(place) => setHovered(place?.id ?? "")} />
          <output data-testid="hovered">{hovered}</output>
        </>
      );
    }
    const spy = vi.mocked(fitForPlace);
    const base = levelProps();
    const { container, rerender } = render(<HoverHost {...base} />);
    const settled = spy.mock.calls.length;
    expect(settled).toBeGreaterThan(0);

    const cusco = container.querySelector('[data-place="cusco"]')!;
    fireEvent.mouseEnter(cusco, { clientX: 40, clientY: 50 });
    fireEvent.mouseMove(cusco, { clientX: 41, clientY: 51 });
    fireEvent.mouseMove(cusco, { clientX: 42, clientY: 52 });
    // The host re-rendered (the hover reached it)…
    expect(screen.getByTestId("hovered").textContent).toBe("cusco");
    // …and no marker asked for its verdict again.
    expect(spy.mock.calls.length).toBe(settled);

    // A month change is a real reason to ask.
    rerender(<HoverHost {...base} month={base.month === 6 ? 7 : 6} />);
    expect(spy.mock.calls.length).toBeGreaterThan(settled);
  });
});

describe("CountryLevel belowMap slot", () => {
  test("renders the caller's content between the map and the list", () => {
    const { container } = renderLevel({ belowMap: <p data-testid="under-map">under the map</p> });
    const slot = container.querySelector("[data-below-map]");
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("under the map");
    // Directly after the map's container, directly before the list's.
    expect(slot!.previousElementSibling!.querySelector("svg")).not.toBeNull();
    expect(slot!.nextElementSibling!.querySelector("input")).not.toBeNull();
  });

  test("renders no wrapper when nothing is passed", () => {
    const { container } = renderLevel();
    expect(container.querySelector("[data-below-map]")).toBeNull();
  });
});
