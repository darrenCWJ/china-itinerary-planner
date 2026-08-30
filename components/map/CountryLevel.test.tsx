import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProjectionEntry } from "@/lib/countryProjection";
import { parseProvinceTopology } from "@/lib/provinceTopology";
import {
  CountryLevel,
  MAP_MAX_RENDER_W,
  TAP_MIN_PX,
  TAP_MIN_R_FALLBACK,
  tapTargetRadius,
} from "./CountryLevel";
import { MAP_VIEW_W } from "./mapShared";
import type { MapPlace } from "./mapTypes";

/**
 * The generic country level: the map 245 countries never had.
 *
 * The fixture is four admin-1 units rather than a real file, and its shape is
 * the specification of what this level has to get right:
 *
 * - **three units tile the mainland and share their arcs**, so `merge()` has a
 *   seam to dissolve and the outline is one ring rather than three;
 * - **one of those three is `sel: 0`** — the Northern-Cyprus case of §7.2, drawn
 *   because it shapes the country's extent, never offered as a choice;
 * - **the fourth is an island 32° west of the mainland**, which is what makes
 *   the manifest observable: framed by the manifest entry the mainland fills
 *   the viewport, and framed by a fit over the features it is a sixth of it.
 *
 * Rings are wound clockwise in (lon, lat). d3-geo reads them spherically, and
 * the anticlockwise version of this same fixture measures 25.1 steradians —
 * twice the whole sphere — because each ring reads as the globe minus itself.
 * `geoBounds` then answers ±180/±90 and every fit collapses.
 */

const A = [-78, -14];
const B = [-76, -14];
const C = [-74, -14];
const G = [-72, -14];
const F = [-78, -10];
const E = [-76, -10];
const D = [-74, -10];
const H = [-72, -10];

/**
 * Absolute (untransformed) TopoJSON, as `CountryMap.test.tsx`'s China fixture
 * is. Arcs 0 and 2 are the seams: each is referenced forward by one unit and
 * reversed (`~i`) by its neighbour, which is the only thing that lets `merge()`
 * dissolve them.
 */
const PE_TOPOLOGY = {
  type: "Topology",
  arcs: [
    [B, E],
    [E, F, A, B],
    [C, D],
    [B, C],
    [D, E],
    [C, G, H, D],
    [
      [-110, -28],
      [-110, -27],
      [-109, -27],
      [-109, -28],
      [-110, -28],
    ],
  ],
  objects: {
    provinces: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          id: "PE-LIM",
          arcs: [[~0, ~1]],
          properties: {
            name: "Lima",
            name_en: "Lima",
            iso_3166_2: "PE-LIM",
            gn_a1_code: "PE.15",
            sel: 1,
          },
        },
        {
          type: "Polygon",
          id: "PE-CUS",
          arcs: [[0, ~4, ~2, ~3]],
          properties: {
            name: "Cuzco",
            name_en: "Cuzco",
            iso_3166_2: "PE-CUS",
            gn_a1_code: "PE.08",
            sel: 1,
          },
        },
        {
          // §7.2: geometry that shapes the outline without being a subdivision.
          type: "Polygon",
          id: "PE-XXX",
          arcs: [[2, ~5]],
          properties: { name: "Disputed Zone", name_en: "Disputed Zone", sel: 0 },
        },
        {
          type: "Polygon",
          id: "PE-ISL",
          arcs: [[6]],
          properties: { name: "Isla Lejana", name_en: "Isla Lejana", sel: 1 },
        },
      ],
    },
  },
};

const PE_FILE = parseProvinceTopology({
  country: "PE",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adm1_code",
  topology: PE_TOPOLOGY,
  cityProvince: {},
});

/**
 * The mainland and nothing else, in the frame `rotate: 0` leaves it in — the
 * nine-country trim of §5.4 in miniature, and the only reason the island can be
 * out of frame while still being drawn.
 */
const PE_ENTRY: ProjectionEntry = {
  rotate: 0,
  bounds: [
    [-78, -14],
    [-72, -10],
  ],
  hiddenAreaPct: 0.3,
  // Recomputed from `bounds` by `projectionFor`; carried because the manifest
  // carries it, and never read by the renderer.
  scale: 8021.4062,
};

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
