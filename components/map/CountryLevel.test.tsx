import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProjectionEntry } from "@/lib/countryProjection";
import { parseProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import type { RegionId } from "@/lib/regionScheme";
import {
  buildCountryView,
  CountryLevel,
  MAP_MAX_RENDER_W,
  TAP_MIN_PX,
  TAP_MIN_R_FALLBACK,
  tapTargetRadius,
} from "./CountryLevel";
import {
  PE_CITY_PROVINCE,
  PE_ENTRY,
  PE_FILE,
  PE_TOPOLOGY,
  peFileWith,
} from "./countryFixture";
import { MAP_VIEW_W, ZOOM_MS } from "./mapShared";
import type { MapPlace } from "./mapTypes";

/**
 * The generic country level: the map 245 countries never had.
 *
 * The four admin-1 units it is drawn from live in `countryFixture.ts`, which
 * documents why each of them is shaped the way it is. They moved out of this
 * file when `CountryMap.test.tsx` started rendering the same country: §12.2 is
 * asserted against both renderers now, and one copy of the topology is what
 * keeps the two from testing different countries under the same name.
 */

/**
 * A passthrough spy over the one O(n²) pass this file runs.
 *
 * `nonOverlappingRadii` is deliberately called with `Infinity` so the cap it
 * computes is a fact about where the cities are and about nothing else — not
 * about the measured width, and not about the zoom. That is what lets its
 * ~560k distance checks run once per country instead of once per frame, and it
 * is invisible in the DOM: a version that folded `k` in would produce a
 * slightly different radius and no other trace at all. The spy is what makes
 * the ceiling and the call count assertable; it forwards to the real function,
 * so every other test in this file sees the module unchanged.
 */
const { capCall } = vi.hoisted(() => ({ capCall: vi.fn() }));

vi.mock("@/lib/dragLayer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dragLayer")>();
  return {
    ...actual,
    nonOverlappingRadii: (
      points: Parameters<typeof actual.nonOverlappingRadii>[0],
      ceiling: number
    ) => {
      capCall(ceiling);
      return actual.nonOverlappingRadii(points, ceiling);
    },
  };
});

function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "catalog",
    localName: null,
    province: null,
    region: "",
    lat: -12,
    lon: -76,
    population: 500_000,
    level: "prefecture",
    attractionCount: 0,
    blurb: null,
    ...over,
  };
}

/** On the mainland's western edge, so its x pins the left of the frame. */
const LIMA = place({ id: "lima", name: "Lima", province: "Lima", lon: -78, lat: -12 });
/** On the eastern edge: the pair's separation IS the mainland's rendered width. */
const CUSCO = place({ id: "cusco", name: "Cusco", province: "Cuzco", lon: -72, lat: -12 });
/** Out on the island the manifest leaves out of frame. */
const ISLA = place({
  id: "isla",
  name: "Puerto Lejano",
  province: "Isla Lejana",
  lon: -109.5,
  lat: -27.5,
});

/**
 * A SECOND country, drawn from the same arcs under different unit ids.
 *
 * The whole of what makes it useful is that no id in it is an id in Peru:
 * `RegionId` is `string`, so a region taken in one country stays assignable in
 * the next and nothing in the type system objects. This is what a stale one
 * has to be handed to.
 *
 * Same geometry on purpose. A second topology would let a difference in the
 * SHAPES explain a difference in the render, and the property under test is
 * about the ids alone.
 */
const BO_FILE: ProvinceFile = parseProvinceTopology({
  country: "BO",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adm1_code",
  topology: {
    ...PE_TOPOLOGY,
    objects: {
      provinces: {
        ...PE_TOPOLOGY.objects.provinces,
        geometries: PE_TOPOLOGY.objects.provinces.geometries.map((geometry) => ({
          ...geometry,
          id: geometry.id.replace("PE-", "BO-"),
        })),
      },
    },
  },
  cityProvince: { lima: "BO-LIM", cusco: "BO-XXX", isla: "BO-ISL" },
});

function renderLevel(over: Partial<Parameters<typeof CountryLevel>[0]> = {}) {
  const props = {
    country: "PE",
    provinces: PE_FILE,
    projection: PE_ENTRY as ProjectionEntry | null,
    places: [LIMA, CUSCO, ISLA],
    selected: [] as string[],
    month: 10,
    routeIds: [] as string[],
    onTogglePlace: vi.fn(),
    onHoverPlace: vi.fn(),
    ...over,
  };
  return { ...render(<CountryLevel {...props} />), props };
}

afterEach(cleanup);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Subpath count: one `M` per ring, which is what `merge()` changes. */
function rings(d: string | null): number {
  return (d ?? "").match(/M/g)?.length ?? 0;
}

function markerX(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-dot").getAttribute("cx"));
}

/** One of a marker's circles, told apart by the attribute that names its job. */
function circleFor(container: HTMLElement, id: string, attr: string): Element {
  const circle = container.querySelector(`[data-place="${id}"] circle[${attr}]`);
  if (!circle) throw new Error(`no ${attr} circle for ${id}`);
  return circle;
}

/** The transparent target's radius, in viewBox units. */
function hitR(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-hit").getAttribute("r"));
}

/** The visible dot's radius — §5.3.2 says this one does not change. */
function dotR(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-dot").getAttribute("r"));
}

/** Every marker group, in the order they are drawn. */
function markers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-markers] [data-place]")];
}

/**
 * The width jsdom will never compute.
 *
 * jsdom lays nothing out and answers 0 to every `getBoundingClientRect`, which
 * is the "nothing measurable" branch the component falls back on — so a test
 * about the MEASURED path has to supply the measurement itself. Stubbed on the
 * prototype rather than on a node because the node being measured is the
 * component's own container ref, which a test has no handle on until the render
 * that reads it has already happened.
 */
function stubRenderedWidth(width: number): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 620,
    top: 0,
    left: 0,
    right: width,
    bottom: 620,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

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
    // Named on hover, and only the three: `getByTitle` cannot see these —
    // testing-library's selector is `svg > title`, a DIRECT child — so the
    // titles are read off the paths that carry them.
    const titles = [...container.querySelectorAll("[data-units] title")].map(
      (title) => title.textContent
    );
    expect(titles).toEqual(["Lima", "Cuzco", "Isla Lejana"]);
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
 * What the view memo hands the rest of the level.
 *
 * It used to hand over three things — the unit paths, the merged outline and a
 * projector for lon/lat — and throw away the two the province zoom needs: the
 * path generator, and the units as geometry rather than as `d` strings.
 * `transformForFeatures` takes exactly that pair, so a zoom that could not
 * reach them would have to build a second projection of its own, on every
 * region click, to answer a question this pass already answered.
 *
 * The memo is where that matters. It is the expensive half of the file — a
 * TopoJSON decode, a `merge()` over every unit and one path render each — and
 * it is keyed on the topology alone. Returning more must not turn it into a
 * memo keyed on the zoom.
 */
describe("CountryLevel view", () => {
  test("exposes a bounds accessor per unit without re-projecting", () => {
    const view = buildCountryView(PE_FILE, PE_ENTRY);

    // Selectable units only, and drawn ones only. A group's `unitIds` come
    // from `regionSchemeFor`, which drops `sel: 0` for §7.2's reason — the
    // disputed zone shapes this country's outline and is not a place anyone
    // travels to — so the set that can be zoomed to is exactly the set
    // `data-unit` marks, and a lookup that should miss cannot be made to hit.
    expect(view.units.map((u) => u.id)).toEqual(["PE-LIM", "PE-CUS", "PE-XXX", "PE-ISL"]);
    expect([...view.selectableFeatures.keys()]).toEqual(["PE-LIM", "PE-CUS", "PE-ISL"]);

    // The generator that drew the country, kept rather than rebuilt: it
    // reproduces every committed path exactly, so what a zoom measures is the
    // frame the user is already looking at.
    for (const unit of view.units) {
      const shape = view.selectableFeatures.get(unit.id);
      if (shape) expect(view.pathGen(shape)).toBe(unit.d);
    }

    // And the pair IS the bounds accessor, answering per unit rather than per
    // country. `PE_ENTRY` frames the mainland flush across the padded box, so
    // x is 840 units over 6° — 140 per degree, `x(lon) = 10 + (lon + 78) * 140`
    // — and each unit's own longitudes fall out of it.
    const xOf = (id: string): [number, number] => {
      const feat = view.selectableFeatures.get(id);
      if (!feat) throw new Error(`no feature for ${id}`);
      const [[x0], [x1]] = view.pathGen.bounds(feat);
      return [x0, x1];
    };
    // Only x: a parallel is not a straight line under d3's resampling, so the
    // rings bulge in y and the corner latitudes are not the y bounds.
    expect(xOf("PE-LIM")).toEqual([expect.closeTo(10, 6), expect.closeTo(290, 6)]);
    expect(xOf("PE-CUS")).toEqual([expect.closeTo(290, 6), expect.closeTo(570, 6)]);
    // The island the §5.4 trim leaves out of frame is measurable too — 32° west
    // of the mainland, and so is its zoom.
    expect(xOf("PE-ISL")).toEqual([expect.closeTo(-4470, 6), expect.closeTo(-4330, 6)]);
  });

  test("the memo still runs once per topology, not once per zoom", () => {
    // The dependency array is the whole of this memo's policy, and adding the
    // zoom to it is the mistake returning more invites: the decode, the
    // `merge()` and one `pathGen` call per unit would re-run on every region
    // click to produce the same four paths.
    //
    // `provinces.topology` is read by `buildCountryView` and by nothing else,
    // so a getter on it counts the builds exactly. `provinces.units` is read
    // once by that build — for the id-to-unit join — and once by
    // `regionSchemeFor`, which is the other per-country pass this level runs;
    // counting both is what pins that a zoom re-runs NEITHER of them.
    let decodes = 0;
    let unitReads = 0;
    const counted: ProvinceFile = {
      ...PE_FILE,
      get topology() {
        decodes++;
        return PE_FILE.topology;
      },
      get units() {
        unitReads++;
        return PE_FILE.units;
      },
    };
    const props = {
      country: "PE",
      provinces: counted,
      projection: PE_ENTRY as ProjectionEntry | null,
      places: [LIMA, CUSCO, ISLA],
      selected: [] as string[],
      month: 10,
      routeIds: [] as string[],
      onTogglePlace: vi.fn(),
      onHoverPlace: vi.fn(),
    };

    const { rerender } = render(<CountryLevel {...props} />);
    expect(decodes).toBe(1);
    expect(unitReads).toBe(2);

    // Everything a zoom changes alongside itself, and the zoom.
    rerender(
      <CountryLevel
        {...props}
        places={[CUSCO, LIMA, ISLA]}
        selected={["lima"]}
        month={3}
        routeIds={["lima", "cusco"]}
        region="PE-ISL"
      />
    );
    expect(decodes).toBe(1);
    expect(unitReads).toBe(2);
  });
});

/**
 * The province zoom, and the `/ k` discipline it drags in behind it (§6.1).
 *
 * Until now this level applied no transform at all: `k` was implicitly 1, and
 * every stroke, radius and font was written as the plain number it wanted to be
 * on screen. A zoom makes that assumption false everywhere at once. The group
 * is magnified by `k`, so a constant left undivided is drawn over `k` times as
 * many CSS pixels — a 0.7-unit border becomes a 2.4-pixel one, and the 44px tap
 * target becomes 44k.
 *
 * So the property asserted here is ONE property, not fifteen: **everything
 * except the projected position divides by `k`.** The positions do not, because
 * the transform is what moves them; every length, radius, dash and font does,
 * because the transform is what magnifies them. The test renders the same map
 * twice — once unzoomed and once framed on one province — and holds every
 * attribute to that ratio, so a constant added later without a `/ k` fails here
 * rather than on someone's screen.
 *
 * `PE-ISL` is the region under test because it is the only one of the three
 * that magnifies. The two mainland units are 2° wide and 4° tall inside a frame
 * that is 6° by 4°, so latitude constrains their fit and `k` lands just under 1
 * — arithmetically correct, and useless for telling `x` from `x / k`. The
 * island is 1° square and reaches 3.46.
 */
describe("CountryLevel province zoom", () => {
  /**
   * `PE-ISL`'s transform, hand-checkable from the bounds `CountryLevel view`
   * pins: the island measures [[-4470, 2544.726…], [-4330, 2702.562…]], so
   * `k = 0.88 * 620 / 157.836…`, `tx = 430 - k * -4400` and
   * `ty = 310 - k * 2623.644…`. Literals rather than a call to
   * `transformForFeatures`, which would be the component's own arithmetic
   * grading its own homework.
   */
  const ISL_K = 3.456740277026829;
  const ISL_TX = 15639.657218918048;
  const ISL_TY = -8759.25772396361;

  /**
   * The same country, with the cities a test measures placed in the unit it
   * frames.
   *
   * Every test in this block is about the zoom's ARITHMETIC — how a length
   * scales, what the tap target measures, how often the O(n²) pass runs — and
   * each of them reads attributes off a marker, so the marker has to be drawn
   * while the map is zoomed. §6.5's filter draws the cities `cityProvince`
   * assigns to the framed group and no others, and the shared fixture places
   * this cast across three different units, so without this they would be
   * measuring markers that are correctly absent.
   *
   * The filter itself is asserted next door, in "CountryLevel zoomed markers".
   * Weakening it here to keep these green would be testing the zoom against a
   * map the app does not draw.
   */
  function allInIsla(ids: string[]): ProvinceFile {
    return peFileWith(Object.fromEntries(ids.map((id) => [id, "PE-ISL"])));
  }

  /**
   * Two places, chosen so one render exercises every scaled attribute: the
   * curated one is labelled and its 7-unit dot clears the `r > 5` branch of the
   * stop number's offset, the county one does neither and is 4.5. Both are
   * selected and both are route stops, which is what draws the selection rings,
   * the stop numbers and the route line.
   */
  const ZOOM_PLACES = [
    place({ id: "cur", name: "Machu Picchu", kind: "curated", lon: -77.5, lat: -12 }),
    place({ id: "cty", name: "Nazca", level: "county", lon: -73, lat: -12 }),
  ];

  function num(el: Element | null, attr: string): number {
    if (!el) throw new Error(`no element carrying ${attr}`);
    const raw = el.getAttribute(attr);
    if (raw === null) throw new Error(`no ${attr} on ${el.nodeName}`);
    return Number(raw);
  }

  function dash(el: Element | null, attr: string): [number, number] {
    if (!el) throw new Error(`no element carrying ${attr}`);
    const [on, off] = (el.getAttribute(attr) ?? "").trim().split(/\s+/).map(Number);
    return [on, off];
  }

  /** Every length the zoom has to divide, read off one rendered map. */
  function lengths(container: HTMLElement): Record<string, number> {
    const q = (selector: string) => container.querySelector(selector);
    const dot = circleFor(container, "cur", "data-dot");
    const cy = num(dot, "cy");
    const label = q('[data-place="cur"] text[data-label]');
    const stop = q('[data-place="cur"] text[data-stop]');
    const route = q("polyline");
    const [routeOn, routeOff] = dash(route, "stroke-dasharray");
    const focus = circleFor(container, "cur", "data-focus-ring");
    const [focusOn, focusOff] = dash(focus, "stroke-dasharray");
    const ring = circleFor(container, "cur", "data-selection-ring");
    return {
      unitStroke: num(q("[data-units] path"), "stroke-width"),
      outlineStroke: num(q("[data-outline]"), "stroke-width"),
      routeStroke: num(route, "stroke-width"),
      routeDashOn: routeOn,
      routeDashOff: routeOff,
      dotR: num(dot, "r"),
      dotStroke: num(dot, "stroke-width"),
      hitR: num(circleFor(container, "cur", "data-hit"), "r"),
      focusR: num(focus, "r"),
      focusStroke: num(focus, "stroke-width"),
      focusDashOn: focusOn,
      focusDashOff: focusOff,
      selectionR: num(ring, "r"),
      selectionStroke: num(ring, "stroke-width"),
      labelFont: num(label, "font-size"),
      labelStroke: num(label, "stroke-width"),
      // The label sits above the dot by the dot's own radius plus a gap, so the
      // LIFT is the scaled quantity and the `y` it produces is not.
      labelLift: cy - num(label, "y"),
      stopFont: num(stop, "font-size"),
      stopDrop: num(stop, "y") - cy,
    };
  }

  /** The same map, framed on `region`, with the caret on the curated marker. */
  function renderZoom(region: RegionId | null) {
    const rendered = renderLevel({
      places: ZOOM_PLACES,
      provinces: allInIsla(ZOOM_PLACES.map((p) => p.id)),
      selected: ["cur", "cty"],
      routeIds: ["cur", "cty"],
      region,
    });
    // The focus ring is drawn only for the marker the caret is on, and it is
    // one of the radii under test.
    act(() => markers(rendered.container)[0].focus());
    return rendered;
  }

  test("draws one transform group, and applies no transform until a region is selected", () => {
    const { container, rerender, props } = renderLevel();

    const zoom = container.querySelector<SVGGElement>("[data-zoom]");
    expect(zoom).not.toBeNull();
    expect(container.querySelectorAll("[data-zoom]")).toHaveLength(1);
    // Everything the map draws is inside it, or a zoom would frame the
    // provinces and leave the markers where they were.
    expect(zoom!.querySelector("[data-units]")).not.toBeNull();
    expect(zoom!.querySelector("[data-outline]")).not.toBeNull();
    expect(zoom!.querySelector("[data-markers]")).not.toBeNull();
    expect(zoom!.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(zoom!.getAttribute("style")).toContain(`transform ${ZOOM_MS}ms`);

    rerender(<CountryLevel {...props} region="PE-ISL" />);

    // The SAME node, not a replacement. That is why the group is
    // unconditional: a wrapper mounted only while zoomed would give the
    // transition nothing to animate from, and would unmount and remount every
    // marker under it on each zoom — taking the roving tabindex's node refs and
    // whatever the caret was on with them.
    const zoomed = container.querySelector<SVGGElement>("[data-zoom]");
    expect(zoomed).toBe(zoom);
    expect(zoomed!.style.transform).toBe(`translate(${ISL_TX}px, ${ISL_TY}px) scale(${ISL_K})`);

    // A region no group answers to is an unzoomed map rather than a vanished
    // one. `PE-XXX` is real geometry and `sel: 0`, so `regionSchemeFor` omits
    // it — which is exactly the shape of the 43 committed `cityProvince` values
    // that name a unit nobody can zoom to.
    rerender(<CountryLevel {...props} region="PE-XXX" />);
    expect(container.querySelector<SVGGElement>("[data-zoom]")!.style.transform).toBe(
      "translate(0px, 0px) scale(1)"
    );
  });

  test("a country with one selectable unit cannot be zoomed at all", () => {
    // §6.6 D10, arriving at the transform rather than at the chrome. At one
    // selectable unit `regionSchemeFor` returns no groups, so the id of that
    // very unit names nothing zoomable — and the difference is only visible
    // because this level resolves a region through the SCHEME rather than
    // straight into `selectableFeatures`. A group is not always a unit (China's
    // are five provinces each), and a unit is not always a group.
    const lone = parseProvinceTopology({
      country: "PE",
      generatedAt: "2026-08-30T00:00:00.000Z",
      idKey: "adm1_code",
      topology: {
        ...PE_TOPOLOGY,
        objects: {
          provinces: {
            ...PE_TOPOLOGY.objects.provinces,
            geometries: PE_TOPOLOGY.objects.provinces.geometries.map((geometry) =>
              geometry.id === "PE-LIM"
                ? geometry
                : { ...geometry, properties: { ...geometry.properties, sel: 0 } }
            ),
          },
        },
      },
      cityProvince: {},
    });

    const { container } = renderLevel({ provinces: lone, region: "PE-LIM" });

    // The unit is real, drawn and offered — so the identity transform below is
    // the gate answering, not the geometry having gone missing.
    const offered = [...container.querySelectorAll("[data-unit]")].map((el) =>
      el.getAttribute("data-unit")
    );
    expect(offered).toEqual(["PE-LIM"]);
    expect(container.querySelector<SVGGElement>("[data-zoom]")!.style.transform).toBe(
      "translate(0px, 0px) scale(1)"
    );
  });

  test("every stroke, radius and font divides by k", () => {
    const flat = lengths(renderZoom(null).container);
    cleanup();
    const { container } = renderZoom("PE-ISL");
    const zoomed = lengths(container);

    for (const key of Object.keys(flat)) {
      // Positive, so `x / k` is a claim about a real length rather than about a
      // zero that divides to a zero whatever the implementation does.
      expect(flat[key]).toBeGreaterThan(0);
      expect(zoomed[key]).toBeCloseTo(flat[key] / ISL_K, 9);
    }

    // And the one family that must NOT scale. The markers stay where the
    // projection put them — `x(lon) = 10 + (lon + 78) * 140`, the frame
    // `CountryLevel view` pins — and the transform is what moves them.
    expect(markerX(container, "cur")).toBeCloseTo(10 + 0.5 * 140, 6);
    expect(markerX(container, "cty")).toBeCloseTo(10 + 5 * 140, 6);
  });

  test("the measured tap target stays 44 CSS px when zoomed", () => {
    // Plan 3 made the radius a MEASUREMENT rather than a constant, so the zoom
    // has to divide the measurement — `tapTargetRadius(width) / k`, never
    // `TAP_MIN_R_FALLBACK / k`. At 390px the two differ by a factor of three,
    // which is the whole reason the measurement exists.
    for (const width of [1120, 390]) {
      stubRenderedWidth(width);
      const { container } = renderLevel({
        provinces: allInIsla(["lima", "cusco", "isla"]),
        region: "PE-ISL",
      });

      for (const id of ["lima", "cusco", "isla"]) {
        expect(hitR(container, id)).toBeCloseTo(tapTargetRadius(width) / ISL_K, 9);
        // The same claim in WCAG 2.5.8's own units: the radius the component
        // chose, magnified by the zoom, over the pixels this width gives a
        // viewBox unit.
        expect(hitR(container, id) * ISL_K * 2 * (width / MAP_VIEW_W)).toBeCloseTo(44, 9);
      }
      if (width === 390) {
        expect(hitR(container, "lima")).not.toBeCloseTo(TAP_MIN_R_FALLBACK / ISL_K, 3);
      }

      cleanup();
      vi.restoreAllMocks();
    }
  });

  test("does not fold k into nonOverlappingRadii", () => {
    // The cap is half the gap between two markers IN THE FRAME THEY WERE
    // PROJECTED INTO, and a zoom does not move them in that frame — it
    // magnifies the frame. So the cap is zoom-independent, `Infinity` stays the
    // ceiling, and the O(n²) pass runs once per country rather than once per
    // zoom frame.
    capCall.mockClear();
    const near = [
      place({ id: "a", name: "Barranco", lon: -76, lat: -12 }),
      place({ id: "b", name: "Chorrillos", lon: -75.95, lat: -12 }),
    ];
    const { container, rerender, props } = renderLevel({
      places: near,
      provinces: allInIsla(["a", "b"]),
    });

    const gap = markerX(container, "b") - markerX(container, "a");
    expect(gap).toBeCloseTo(7, 9);
    expect(capCall).toHaveBeenCalledTimes(1);
    expect(capCall).toHaveBeenCalledWith(Infinity);

    rerender(<CountryLevel {...props} region="PE-ISL" />);

    // Not a second pass — ~560k distance checks is what one is worth on the
    // largest shard.
    expect(capCall).toHaveBeenCalledTimes(1);
    // Half the gap, unchanged. Folding `k` in would have produced 1.012, below
    // the 6.5 / k floor these prefecture dots set, so the target would have
    // clamped to 1.880 and quietly stopped being the cap at all.
    expect(hitR(container, "a")).toBeCloseTo(gap / 2, 9);
    expect(hitR(container, "a")).not.toBeCloseTo(6.5 / ISL_K, 3);
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
