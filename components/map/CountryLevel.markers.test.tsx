// First, before any import that could reach `./mapTypes` or `@/lib/dragLayer`:
// the harness registers those mocks, and vitest hoists a mock only above the
// imports of the file that declares it.
import {
  BO_FILE,
  circleFor,
  CUSCO,
  dotR,
  hitR,
  installCountryLevelHarness,
  LIMA,
  markers,
  markerX,
  place,
  renderLevel,
  stubRenderedWidth,
} from "@/test/countryLevelHarness";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CountryLevel } from "./CountryLevel";
import { MAP_MAX_RENDER_W, TAP_MIN_PX, TAP_MIN_R_FALLBACK, tapTargetRadius } from "./markerGeometry";
import { PE_CITY_PROVINCE, peFileWith } from "./countryFixture";
import { MAP_VIEW_W } from "./mapShared";

installCountryLevelHarness();

/**
 * §5.3.1 and §5.3.2, which opening 245 countries is what made load-bearing.
 *
 * The markers used to be `aria-hidden` with no keyboard model at all, and the
 * arrangement they would otherwise have inherited from `ChinaLevel` — a tab
 * stop per curated marker — is the one `worldLevelShared.tsx` calls "fine for
 * thirty of them and indefensible for 235". A country shard runs to 750.
 *
 * Two properties are asserted together throughout, because either alone is
 * satisfiable by a wrong implementation: the marker layer costs ONE tab stop,
 * and the list still reaches every place at full size.
 */
describe("CountryLevel markers", () => {
  test("the marker group is one tab stop, not one per marker", () => {
    const { container } = renderLevel();

    const drawn = markers(container);
    expect(drawn).toHaveLength(3);
    expect(drawn.map((el) => el.getAttribute("role"))).toEqual(["button", "button", "button"]);
    // The roving tabindex: one 0, the rest -1. Three markers is a weak fixture
    // for the claim on its own, so the COUNT is asserted rather than the set —
    // 750 of them must still add exactly one stop between the map and the
    // control after it.
    expect(drawn.filter((el) => el.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(drawn[0]).toHaveAttribute("tabindex", "0");
  });

  test("arrow keys move the active marker without leaving the group", () => {
    const { container } = renderLevel();
    const [lima, cusco, isla] = markers(container);

    act(() => lima.focus());
    expect(document.activeElement).toBe(lima);

    fireEvent.keyDown(lima, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cusco);
    // The stop moves with the caret — that is what makes it roving rather than
    // a fixed first marker Tab always lands on.
    expect(cusco).toHaveAttribute("tabindex", "0");
    expect(lima).toHaveAttribute("tabindex", "-1");
    // And the caret is visible, which a roving tabindex nobody can see is not.
    expect(cusco.querySelector("[data-focus-ring]")).not.toBeNull();
    expect(lima.querySelector("[data-focus-ring]")).toBeNull();

    // Off the end it wraps rather than escaping: an arrow key must not be a
    // way out of the group, or the roving stop stops being one stop.
    fireEvent.keyDown(cusco, { key: "ArrowRight" });
    expect(document.activeElement).toBe(isla);
    fireEvent.keyDown(isla, { key: "ArrowRight" });
    expect(document.activeElement).toBe(lima);
    fireEvent.keyDown(lima, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(isla);

    fireEvent.keyDown(isla, { key: "Home" });
    expect(document.activeElement).toBe(lima);
    fireEvent.keyDown(lima, { key: "End" });
    expect(document.activeElement).toBe(isla);

    expect(container.querySelector("[data-markers]")!.contains(document.activeElement)).toBe(true);
  });

  test("Enter and Space act on the marker the caret is on", () => {
    // A roving tabindex that cannot activate anything is a tour of the map,
    // not a way to plan with it.
    const { container, props } = renderLevel();
    const [lima, cusco] = markers(container);

    act(() => lima.focus());
    fireEvent.keyDown(lima, { key: "Enter" });
    expect(props.onTogglePlace).toHaveBeenLastCalledWith(LIMA);

    fireEvent.keyDown(cusco, { key: " " });
    expect(props.onTogglePlace).toHaveBeenLastCalledWith(CUSCO);
    expect(props.onTogglePlace).toHaveBeenCalledTimes(2);
  });

  test("announces its own selected state, and starts the caret on the selection", () => {
    const { container } = renderLevel({ selected: ["cusco"] });
    const [lima, cusco] = markers(container);

    expect(cusco).toHaveAttribute("aria-pressed", "true");
    expect(cusco).toHaveAttribute("aria-label", "Cusco (selected)");
    expect(lima).toHaveAttribute("aria-pressed", "false");
    // Tab lands on what the user already chose rather than on whichever place
    // the shard happens to list first — `useCountrySelection`'s `tabStop`
    // ordering, with `selected` widened from one code to a set of ids.
    expect(cusco).toHaveAttribute("tabindex", "0");
    expect(lima).toHaveAttribute("tabindex", "-1");
  });

  test("keyboard focus stays visible on a marker that is already selected", () => {
    // The two states land on the same marker constantly — selecting from the
    // keyboard means focusing and then pressing Enter — and at the same radius
    // the solid `--seal` ring paints over the dashed focus one, so the
    // indicator disappears exactly when someone is relying on it.
    const { container } = renderLevel({ selected: ["cusco"] });
    const [, cusco] = markers(container);
    act(() => cusco.focus());

    const focus = Number(circleFor(container, "cusco", "data-focus-ring").getAttribute("r"));
    const selection = Number(
      circleFor(container, "cusco", "data-selection-ring").getAttribute("r")
    );
    expect(focus).toBeGreaterThan(selection);
    expect(circleFor(container, "cusco", "data-focus-ring")).toHaveAttribute(
      "stroke-dasharray",
      "3 2"
    );
  });

  test("the visible radius is unchanged", () => {
    // §5.3.2 is explicit that the DOT stays where `radiusFor` put it and only
    // the target grows. A fix that inflated the circle would be visible on
    // every map in the app and would bury the country under its own cities.
    const { container } = renderLevel({
      places: [
        place({ id: "cur", name: "Machu Picchu", kind: "curated", lon: -77.5, lat: -12 }),
        place({ id: "mun", name: "Callao", level: "municipality", lon: -76, lat: -12 }),
        place({ id: "pref", name: "Arequipa", level: "prefecture", lon: -74.5, lat: -12 }),
        place({ id: "cty", name: "Nazca", level: "county", lon: -73, lat: -12 }),
      ],
    });

    const ids = ["cur", "mun", "pref", "cty"];
    expect(ids.map((id) => dotR(container, id))).toEqual([7, 8, 6.5, 4.5]);
    for (const id of ids) {
      expect(dotR(container, id)).toBeGreaterThanOrEqual(4.5);
      expect(dotR(container, id)).toBeLessThanOrEqual(9);
      // Hit area first, so the dot is never the target's edge (`WorldMap.tsx`).
      expect(hitR(container, id)).toBeGreaterThan(dotR(container, id));
    }
  });

  test("the external numbers the target is built from are what they claim", () => {
    // Literals, deliberately. The version of this that read
    //   TAP_MIN_R * 2 * (MAP_MAX_RENDER_W / MAP_VIEW_W) === TAP_MIN_PX
    // substitutes to TAP_MIN_PX === TAP_MIN_PX and holds for ANY values of all
    // four — it cannot catch a wrong token or a wrong layout width, which are
    // the only two things about it that can go wrong. Each number is checked
    // against the external fact it encodes instead.
    expect(TAP_MIN_PX).toBe(44); // `--tap-min` in app/globals.css; WCAG 2.5.8
    expect(MAP_VIEW_W).toBe(860); // the viewBox every level shares
    expect(MAP_MAX_RENDER_W).toBe(1120); // max-w-6xl (72rem) less px-4 gutters

    // And the direction, which the docblock used to state backwards: fewer
    // pixels across the same viewBox means each unit is worth less, so the
    // compliant radius is BIGGER on a phone than on a desktop, not smaller.
    expect(tapTargetRadius(390)).toBeGreaterThan(tapTargetRadius(1120));
  });

  test("a marker with room around it gets 44 CSS px at the width it renders at", () => {
    // The radii are hand-computed from the token and the viewBox — 22 * 860 /
    // width — rather than from the code that produces them, so a change to
    // either constant fails here instead of silently redefining the target.
    for (const [width, radius] of [
      [1120, 16.892857142857142], // the widest /plan ever lays the map out
      [768, 24.635416666666668], // tablet
      [390, 48.51282051282052], // phone: nearly 3x the desktop radius
    ] as const) {
      stubRenderedWidth(width);
      const { container } = renderLevel();
      for (const id of ["lima", "cusco", "isla"]) {
        expect(hitR(container, id)).toBeCloseTo(radius, 9);
        // The same claim in the units WCAG states it in: viewBox units the
        // component chose, times the CSS pixels per unit this width implies.
        expect(hitR(container, id) * 2 * (width / MAP_VIEW_W)).toBeCloseTo(44, 9);
      }
      cleanup();
      vi.restoreAllMocks();
    }
  });

  test("falls back to the widest-layout radius when nothing is measurable", () => {
    // jsdom lays nothing out, and neither has a browser at first paint. The
    // fallback is the floor of the honest range — the radius the WIDEST layout
    // needs — so an unmeasured frame undershoots for one commit rather than
    // drawing a phone-sized target across a desktop map.
    expect(TAP_MIN_R_FALLBACK).toBeCloseTo(16.892857142857142, 9);

    const { container } = renderLevel();
    for (const id of ["lima", "cusco", "isla"]) {
      expect(hitR(container, id)).toBeCloseTo(TAP_MIN_R_FALLBACK, 9);
    }
  });

  test("re-measures the target when the container is resized", () => {
    // A rotation or a window drag changes the pixels-per-unit ratio without
    // remounting anything, so a target sized once at mount would stay at the
    // old width's radius for the rest of the session.
    let notify: (() => void) | null = null;
    class FakeResizeObserver {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        notify = null;
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);

    stubRenderedWidth(1120);
    const { container } = renderLevel();
    expect(hitR(container, "lima")).toBeCloseTo(16.892857142857142, 9);

    stubRenderedWidth(390);
    act(() => notify!());
    expect(hitR(container, "lima")).toBeCloseTo(48.51282051282052, 9);
  });

  test("a crowded marker's target shrinks rather than swallowing its neighbour", () => {
    // The trade `nonOverlappingRadii` was written for, applied to cities
    // instead of micro-states: two overlapping transparent circles let paint
    // order decide which place a tap adds, and a wrong selection is worse than
    // a hard one. It is only acceptable because the list below reaches both at
    // full size, which the last assertion is.
    const near = [
      place({ id: "a", name: "Barranco", lon: -76, lat: -12 }),
      place({ id: "b", name: "Chorrillos", lon: -75.9, lat: -12 }),
    ];
    const { container } = renderLevel({ places: near });

    const gap = markerX(container, "b") - markerX(container, "a");
    expect(gap).toBeGreaterThan(0);
    expect(hitR(container, "a") + hitR(container, "b")).toBeLessThanOrEqual(gap + 1e-9);
    expect(hitR(container, "a")).toBeLessThan(TAP_MIN_R_FALLBACK);
    // Never below the dot it sits behind, though: a target inside the visible
    // circle would make the dot's own edge the target's edge.
    expect(hitR(container, "a")).toBeGreaterThanOrEqual(dotR(container, "a"));

    // Half the gap, whatever the width asks for. The cap is where the cities
    // are, and a phone — which wants nearly three times the desktop radius —
    // does not get to widen it: this is the one place the honest radius is NOT
    // what is drawn, and the list below is why that is allowed.
    cleanup();
    stubRenderedWidth(390);
    const phone = renderLevel({ places: near }).container;
    expect(hitR(phone, "a")).toBeCloseTo(gap / 2, 9);
    expect(hitR(phone, "a")).toBeLessThan(tapTargetRadius(390));

    for (const name of ["Barranco", "Chorrillos"]) {
      const chip = screen.getAllByRole("button", { name }).find((el) => el.tagName === "BUTTON");
      expect(chip).toBeDefined();
      expect(chip!.className).toContain("min-h-[var(--tap-min)]");
    }
  });

  test("Plan 1's reachability criterion still passes", () => {
    // §12.2, re-run against the level that now draws geometry AND owns a
    // keyboard model for it. The map gaining tab stops must not cost the list
    // a single one: every place stays a real `<button>` in the list, at the
    // minimum tap target, and the marker layer adds exactly one stop on top.
    const shard = Array.from({ length: 60 }, (_, i) =>
      place({ id: `G${i}`, name: `City ${i}`, province: i < 40 ? "Lima" : "Cuzco" })
    );
    const { container } = renderLevel({ places: shard });

    for (const button of screen.getAllByRole("button", { name: /^Show all/ })) {
      fireEvent.click(button);
    }

    const chips = [...container.querySelectorAll("button")].filter((el) =>
      /^City \d+$/.test(el.textContent ?? "")
    );
    expect(chips).toHaveLength(60);
    for (const chip of chips) {
      expect(chip.getAttribute("tabindex")).not.toBe("-1");
      expect(chip.className).toContain("min-h-[var(--tap-min)]");
    }

    expect(markers(container)).toHaveLength(60);
    expect(markers(container).filter((el) => el.getAttribute("tabindex") === "0")).toHaveLength(1);
  });
});

/**
 * §6.5: the zoomed map draws one province's cities, and `cityProvince` is what
 * says which those are.
 *
 * Plan 2 shipped that Map and nothing has ever read it — this is its first
 * consumer, and the field it joins on is the only thing that places a city.
 * NOT the coordinates: a marker's lon/lat decide where it is DRAWN, and the
 * committed assignment decides which province CONTAINS it. Re-deriving
 * containment here would be a second answer to a question `build-provinces`
 * already answered, recomputed per frame, and the two would disagree the
 * moment a boundary moved.
 *
 * Three properties, and the third is what keeps §5.2 true while the first two
 * hide things:
 *
 * - a zoomed map draws only the cities the group's units hold;
 * - a city the file never placed is drawn in NO province rather than in every
 *   one — 478 real cities are in exactly that state, and a containment
 *   fallback would put the same city in all 25 of Peru's departments;
 * - the LIST is untouched at every zoom. The map filters; the spine does not.
 *
 * The filter is applied where the markers are DRAWN and nowhere earlier, which
 * is why "does not fold k into nonOverlappingRadii" above still sees one call:
 * `points` and `caps` are computed over the whole country, so the O(n²) pass
 * stays keyed on the country and a zoom re-runs none of it.
 */
describe("CountryLevel zoomed markers", () => {
  /** A city the fixture places nowhere, drawn over the mainland's west unit. */
  const UNPLACED = place({ id: "unplaced", name: "Sin Ubicacion", lon: -77, lat: -12 });

  /** The ids the marker layer actually drew, in draw order. */
  function drawn(container: HTMLElement): string[] {
    return markers(container).map((el) => el.getAttribute("data-place") ?? "");
  }

  /** Which of these places the list beside the map reaches as a real button. */
  function listed(names: string[]): string[] {
    return names.filter((name) =>
      screen.getAllByRole("button", { name }).some((el) => el.tagName === "BUTTON")
    );
  }

  test("shows only the cities the zoomed unit contains", () => {
    const { container, rerender, props } = renderLevel();

    // Unzoomed, the country's whole shard.
    expect(drawn(container)).toEqual(["lima", "cusco", "isla"]);

    // `lima` is the only city the fixture assigns to PE-LIM, and `cusco` is
    // drawn inside the same frame two units east of it — which is the point:
    // the committed assignment places a city, not the pixel it lands on.
    rerender(<CountryLevel {...props} region="PE-LIM" />);
    expect(drawn(container)).toEqual(["lima"]);

    rerender(<CountryLevel {...props} region="PE-ISL" />);
    expect(drawn(container)).toEqual(["isla"]);

    // And back out again: a zoom hides markers, it does not drop them.
    rerender(<CountryLevel {...props} region={null} />);
    expect(drawn(container)).toEqual(["lima", "cusco", "isla"]);
  });

  test("the marker layer is still one tab stop, over the cities that remain", () => {
    // §5.3.1 has to survive the filter. The roving tabindex is chosen from the
    // places the layer DRAWS, or `tabIndex 0` lands on a node the level has
    // stopped rendering — a tab stop that goes nowhere, which is the failure
    // the pattern exists to prevent.
    const { container, rerender, props } = renderLevel({ region: "PE-LIM" });

    const stops = () => markers(container).filter((el) => el.getAttribute("tabindex") === "0");
    expect(drawn(container)).toEqual(["lima"]);
    expect(stops()).toHaveLength(1);

    // Arrows wrap inside the visible set rather than stepping onto a hidden
    // neighbour: one drawn marker means every arrow is the same marker.
    act(() => markers(container)[0].focus());
    fireEvent.keyDown(markers(container)[0], { key: "ArrowRight" });
    expect(stops()).toHaveLength(1);
    expect(stops()[0].getAttribute("data-place")).toBe("lima");

    rerender(<CountryLevel {...props} region="PE-ISL" />);
    expect(drawn(container)).toEqual(["isla"]);
    expect(stops()).toHaveLength(1);
    expect(stops()[0].getAttribute("data-place")).toBe("isla");
  });

  test("the caret steps through the drawn markers, not the country's full list", () => {
    // The one property the `index` / `order` split in the JSX exists for, and
    // the one a wrong implementation survives most easily: arrow keys wrap
    // modulo the number of markers the hook was given, so passing the COUNTRY
    // index instead of the DRAWN one is invisible whenever the two happen to
    // be congruent. Three visible cities at country indices 0, 1 and 4 is a
    // cast where they are not — stepping right off the third wraps to
    // `4 % 3 = 1`, the middle marker, instead of back to the first.
    const cast = [
      place({ id: "n0", name: "Ancon", lon: -77.8, lat: -11.8 }),
      place({ id: "n1", name: "Barranca", lon: -77.4, lat: -12.4 }),
      place({ id: "e0", name: "Sicuani", lon: -75.4, lat: -11.8 }),
      place({ id: "e1", name: "Urubamba", lon: -74.6, lat: -12.4 }),
      place({ id: "n2", name: "Canta", lon: -76.6, lat: -13 }),
    ];
    const { container } = renderLevel({
      places: cast,
      provinces: peFileWith({
        n0: "PE-LIM",
        n1: "PE-LIM",
        n2: "PE-LIM",
        e0: "PE-CUS",
        e1: "PE-CUS",
      }),
      region: "PE-LIM",
    });

    expect(drawn(container)).toEqual(["n0", "n1", "n2"]);
    const [first, middle, third] = markers(container);

    act(() => third.focus());
    fireEvent.keyDown(third, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);
    expect(document.activeElement).not.toBe(middle);

    // And the stop went with it, so Tab re-enters where the caret is.
    expect(first).toHaveAttribute("tabindex", "0");
    expect(third).toHaveAttribute("tabindex", "-1");
  });

  test("a city whose id is absent from cityProvince is hidden when zoomed, not shown everywhere", () => {
    // 478 cities across the 246 committed files are placed by neither
    // containment nor `a1c`. Showing an unplaced city inside every province is
    // worse than showing it in none: it would assert a fact the build was
    // careful not to invent, once per province.
    const places = [LIMA, UNPLACED];
    const { container, rerender, props } = renderLevel({ places });

    expect(PE_CITY_PROVINCE).not.toHaveProperty(UNPLACED.id);
    expect(drawn(container)).toEqual(["lima", "unplaced"]);

    // Drawn at lon -77, inside PE-LIM's own span of -78..-76, so a containment
    // fallback would show it here. It has no assignment, so nothing places it.
    rerender(<CountryLevel {...props} places={places} region="PE-LIM" />);
    expect(drawn(container)).toEqual(["lima"]);

    // And in no other province either — hidden once, not moved.
    for (const region of ["PE-CUS", "PE-ISL"]) {
      rerender(<CountryLevel {...props} places={places} region={region} />);
      expect(drawn(container)).not.toContain("unplaced");
    }

    // Same for a city placed in a unit nobody can zoom to: `cusco` is assigned
    // to PE-XXX, which is `sel: 0`, so no group names it and no zoom draws it.
    // The list below is where it stays reachable.
    rerender(<CountryLevel {...props} places={[CUSCO]} region="PE-CUS" />);
    expect(drawn(container)).toEqual([]);
  });

  test("the list still reaches every city in the country, zoomed or not", () => {
    // §5.2's invariant, and the reason the filter is allowed to hide anything
    // at all. The map is the enhancement; the list is the spine, and it is
    // built from `places` whole at every zoom.
    const names = ["Lima", "Cusco", "Puerto Lejano"];
    const { container, rerender, props } = renderLevel();

    expect(listed(names)).toEqual(names);

    rerender(<CountryLevel {...props} region="PE-ISL" />);
    expect(drawn(container)).toEqual(["isla"]);
    expect(listed(names)).toEqual(names);

    // Including the two the zoom can never reach from here — so while the map
    // is framed on the island, the list is the only control either of them has.
    for (const name of ["Lima", "Cusco"]) {
      const chip = screen.getAllByRole("button", { name }).find((el) => el.tagName === "BUTTON");
      expect(chip).toBeDefined();
      expect(chip!.getAttribute("tabindex")).not.toBe("-1");
    }
  });

  test("clears the zoom when the country changes", () => {
    // A region id belongs to the country it was taken in. `MapExplorer` drops
    // it on the way down into a new one, but nothing MAKES it: `RegionId` is
    // `string`, so a stale id stays assignable and no compiler points at it.
    //
    // So the level answers for it too, and answers with an UNZOOMED map rather
    // than an empty one. The scheme is what resolves a region, and the new
    // country's scheme has never heard of the old country's group — which is
    // no transform AND no filter, because a filter keyed on a group that does
    // not exist would hide every city in the country that just opened.
    const { container, rerender, props } = renderLevel({ region: "PE-ISL" });

    expect(drawn(container)).toEqual(["isla"]);
    expect(container.querySelector<SVGGElement>("[data-zoom]")!.style.transform).not.toBe(
      "translate(0px, 0px) scale(1)"
    );

    rerender(<CountryLevel {...props} country="BO" provinces={BO_FILE} region="PE-ISL" />);

    expect(container.querySelector<SVGGElement>("[data-zoom]")!.style.transform).toBe(
      "translate(0px, 0px) scale(1)"
    );
    expect(drawn(container)).toEqual(["lima", "cusco", "isla"]);
  });
});
