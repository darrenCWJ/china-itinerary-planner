// First, before any import that could reach `./mapTypes` or `@/lib/dragLayer`:
// the harness registers those mocks, and vitest hoists a mock only above the
// imports of the file that declares it.
import {
  airportNear,
  capCall,
  circleFor,
  dotR,
  hitR,
  installCountryLevelHarness,
  markers,
  markerX,
  PE_ONE_UNIT,
  place,
  renderLevel,
  stubRenderedWidth,
} from "@/test/countryLevelHarness";
import { act, cleanup, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  IDENTITY_TRANSFORM,
  MAX_ZOOM_K,
  ZOOM_FILL,
  type MapTransform,
} from "@/lib/mapTransform";
import { parseProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import type { RegionId } from "@/lib/regionScheme";
import { CountryLevel } from "./CountryLevel";
import { buildCountryView } from "./countryView";
import {
  ADMIN1_MAX_ZOOM_K,
  MIN_FRAMED_EXTENT,
  paintedAt,
  TAP_MIN_R_FALLBACK,
  tapTargetRadius,
} from "./markerGeometry";
import { PE_ENTRY, PE_FILE, peFileWith } from "./countryFixture";
import { MAP_VIEW_H, MAP_VIEW_W, ZOOM_MS } from "./mapShared";

installCountryLevelHarness();

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

  /**
   * One airport, and `showAirports` on, so §10.1's layer is drawn in BOTH
   * renders below.
   *
   * The layer is the newest thing inside `[data-zoom]` and the easiest to add a
   * raw length to, since its mark is a square rather than a circle and carries
   * three of them — a width, a height and a stroke. Drawing it here is what puts
   * those three inside "every stroke, radius and font divides by k" instead of
   * beside it.
   */
  const ZOOM_AIRPORT = airportNear(ZOOM_PLACES[0], "CUZ", 20, "large");

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
    const airport = q("[data-airport]");
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
      // §10.1's layer. Its `x` and `y` are positions rather than lengths — the
      // mark's CENTRE is where the projection put the airport and does not
      // scale — so what is held here is the square it is drawn as.
      airportWidth: num(airport, "width"),
      airportHeight: num(airport, "height"),
      airportStroke: num(airport, "stroke-width"),
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
      airports: [ZOOM_AIRPORT],
      showAirports: true,
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
    const { container } = renderLevel({ provinces: PE_ONE_UNIT, region: "PE-LIM" });

    // The unit is real, drawn and MARKED — so the identity transform below is
    // the gate answering, not the geometry having gone missing. The mark is
    // §7.2's ("this polygon is a subdivision, not just territorial extent"),
    // which stays true of a lone unit; what a lone unit is not is a place to
    // zoom to, and that is decided through the scheme rather than through the
    // mark.
    const marked = [...container.querySelectorAll("[data-unit]")].map((el) =>
      el.getAttribute("data-unit")
    );
    expect(marked).toEqual(["PE-LIM"]);
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

  /**
   * §6.5's card anchor, and the axis jsdom cannot be asked about.
   *
   * `SelectedPlaceCard` is an HTML sibling of the `<svg>`, so no transform
   * inside it reaches the card: it positions itself from a percentage of the
   * frame, and the anchor therefore has to be where the marker is PAINTED
   * rather than where it was projected. That the rendered card follows is
   * asserted in `SelectedPlaceCard.test.tsx` — on the `top` axis only, because
   * the `left` declaration is wrapped in a `clamp()` for §5.4's off-frame
   * markers and jsdom's CSS parser drops a declaration it cannot compute
   * rather than storing it. So the maths is a named function, and both axes
   * are pinned here.
   */
  test("paints a point where the transform leaves it, on both axes", () => {
    const view = buildCountryView(PE_FILE, PE_ENTRY);
    const island = view.selectableFeatures.get("PE-ISL");
    if (!island) throw new Error("no feature for PE-ISL");
    const [[x0, y0], [x1, y1]] = view.pathGen.bounds(island);
    const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };

    // Unzoomed the island is nowhere near the frame — 4,400 units west of it
    // and four frame-heights below — which is the separation an untransformed
    // anchor would leave between a card and the marker it names.
    expect(centre.x).toBeLessThan(0);
    expect(centre.y).toBeGreaterThan(MAP_VIEW_H);

    // Framed on it, its centre IS the frame's centre, because that is what
    // `transformForBounds` computes: k * midpoint + t === view / 2.
    const painted = paintedAt(centre, { k: ISL_K, tx: ISL_TX, ty: ISL_TY });
    expect(painted.x).toBeCloseTo(MAP_VIEW_W / 2, 9);
    expect(painted.y).toBeCloseTo(MAP_VIEW_H / 2, 9);

    // And an unzoomed card anchors to the projection untouched, which is what
    // every render before this plan did.
    expect(paintedAt(centre, IDENTITY_TRANSFORM)).toEqual(centre);
  });
});

/**
 * How much of the frame a framed unit actually fills — the property nobody
 * measured, and the one the zoom exists to deliver.
 *
 * Every other assertion about the zoom is about a RATIO: that lengths divide by
 * `k`, that the tap target survives it, that the centre of the framed unit
 * lands on the centre of the view. All of them hold at `k = 5` and all of them
 * hold at `k = 80`, so none of them can tell a province that fills the viewport
 * from a province that is a speck in the middle of one. That is the shape the
 * defect shipped in.
 *
 * Measured over the 246 committed province files, `MAX_ZOOM_K = 5` clamps
 * **3,039 of the 4,525 zoomable groups (67.2%)**. The ceiling was tuned for
 * `ChinaLevel`, whose seven groups are five provinces each and never ask for
 * more than 3.5x; ONE admin-1 unit asks for far more, and got 5x. What that
 * costs, as the fraction of the viewBox's area the unit's own bounding box
 * covers — measured against the committed files, not estimated:
 *
 * | unit              | bbox (viewBox units) | at k <= 5 | framed |
 * | ----------------- | -------------------- | --------- | ------ |
 * | Rhode Island (US) | 4.4 x 6.7            | 0.14%     | 36.3%  |
 * | Delhi (IN)        | 9.7 x 9.8            | 0.45%     | 54.9%  |
 * | Paris (FR)        | 10.5 x 5.5           | 0.27%     | 56.4%  |
 * | Jakarta (ID)      | 5.6 x 5.9            | 0.16%     | 52.5%  |
 * | Berlin (DE)       | 31.7 x 25.4          | 3.8%      | 69.7%  |
 * | Moscow (RU)       | 24.7 x 23.5          | 2.7%      | 58.6%  |
 * | Texas (US)        | 75.8 x 72.0          | 25.6%     | 58.8%  |
 * | Tokyo (JP)        | 344 x 309            | 62.2%     | 62.2%  |
 *
 * Tokyo is the control: it is big enough that the ceiling never bound on it,
 * which is why the defect was invisible to anyone who tried the feature on a
 * large province.
 *
 * So this block asserts the fill fraction directly, for a large unit and a
 * small one, off the transform the component actually rendered rather than off
 * `transformForFeatures` — the arithmetic grading its own homework is what the
 * "province zoom" block above already avoids.
 */
describe("CountryLevel province zoom — the fraction of the frame the unit fills", () => {
  /** A square ring wound clockwise in (lon, lat), which d3-geo reads as inside. */
  function ring(x0: number, y0: number, size: number): number[][] {
    return [
      [x0 + size, y0 + size],
      [x0 + size, y0],
      [x0, y0],
      [x0, y0 + size],
      [x0 + size, y0 + size],
    ];
  }

  /**
   * One country, three units, spanning the whole range of the problem.
   *
   * Separate arcs rather than the shared ones `countryFixture` uses, because
   * nothing here is about `merge()`: what matters is that the three differ in
   * SIZE by three orders of magnitude, which is the real spread of admin-1 units
   * and the reason one ceiling cannot serve them all.
   *
   * - **XA-BIG**, 4 degrees square, is a province the size of Texas — the fit
   *   already frames it and no ceiling was ever in its way;
   * - **XA-SML**, 0.05 degrees square, is Rhode Island's case — big enough to be
   *   a real place with real cities, small enough that `MAX_ZOOM_K` decided its
   *   framing instead of the fit;
   * - **XA-DOT**, 0.003 degrees square, is Jarvis Island's — an uninhabited
   *   speck that a ceiling must still catch, because "frame it" has no useful
   *   answer.
   */
  const XA_TOPOLOGY = {
    type: "Topology",
    arcs: [ring(0, 0, 4), ring(5, 0, 0.05), ring(6, 0, 0.003)],
    objects: {
      provinces: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            id: "XA-BIG",
            arcs: [[0]],
            properties: { name: "Grande", name_en: "Grande", sel: 1 },
          },
          {
            type: "Polygon",
            id: "XA-SML",
            arcs: [[1]],
            properties: { name: "Pequena", name_en: "Pequena", sel: 1 },
          },
          {
            type: "Polygon",
            id: "XA-DOT",
            arcs: [[2]],
            properties: { name: "Mota", name_en: "Mota", sel: 1 },
          },
        ],
      },
    },
  };

  const XA_FILE: ProvinceFile = parseProvinceTopology({
    country: "XA",
    generatedAt: "2026-08-30T00:00:00.000Z",
    idKey: "adm1_code",
    topology: XA_TOPOLOGY,
    cityProvince: {},
  });

  /** No manifest entry, so the fit over the three units is the frame. */
  const XA_VIEW = buildCountryView(XA_FILE, null);

  /** The `translate(...px, ...px) scale(...)` the component wrote, as numbers. */
  function renderedTransform(container: HTMLElement): MapTransform {
    const style = container.querySelector<SVGGElement>("[data-zoom]")?.style.transform ?? "";
    const [tx, ty, k] = [...style.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)].map((m) =>
      Number(m[0])
    );
    if (k === undefined) throw new Error(`unparseable transform: ${style}`);
    return { k, tx, ty };
  }

  /**
   * How much of the viewBox the unit's bounding box covers once the rendered
   * transform has been applied to it — per axis, and as area.
   *
   * The unit's bounds come from the same `pathGen` that drew it and the
   * transform comes off the DOM, so this is the composition a browser performs
   * rather than a re-derivation of it.
   */
  function framed(
    container: HTMLElement,
    unitId: string
  ): { x: number; y: number; area: number; k: number } {
    const shape = XA_VIEW.selectableFeatures.get(unitId);
    if (!shape) throw new Error(`no feature for ${unitId}`);
    const [[x0, y0], [x1, y1]] = XA_VIEW.pathGen.bounds(shape);
    const transform = renderedTransform(container);
    const min = paintedAt({ x: x0, y: y0 }, transform);
    const max = paintedAt({ x: x1, y: y1 }, transform);
    const x = (max.x - min.x) / MAP_VIEW_W;
    const y = (max.y - min.y) / MAP_VIEW_H;
    return { x, y, area: x * y, k: transform.k };
  }

  function renderXa(region: RegionId | null) {
    return render(
      <CountryLevel
        country="XA"
        provinces={XA_FILE}
        projection={null}
        places={[]}
        selected={[]}
        month={10}
        routeIds={[]}
        region={region}
        onTogglePlace={vi.fn()}
        onHoverPlace={vi.fn()}
      />
    );
  }

  test("a large unit fills the frame, and always did", () => {
    // The control. `XA-BIG` is 4 of this country's 6.003 degrees, so the fit
    // asks for k just under 1 and no ceiling was ever involved — which is why a
    // suite that only framed big provinces could not see the defect.
    const { container } = renderXa("XA-BIG");
    const fill = framed(container, "XA-BIG");

    expect(fill.k).toBeLessThan(MAX_ZOOM_K);
    expect(Math.max(fill.x, fill.y)).toBeCloseTo(ZOOM_FILL, 9);
    expect(fill.area).toBeGreaterThan(0.5);
  });

  test("a small unit fills the frame too, instead of sitting as a speck in it", () => {
    // Rhode Island's case, and the defect. `XA-SML` is 0.05 degrees across —
    // 6.997 viewBox units — so the fit asks for k = 77.98 and `MAX_ZOOM_K` used
    // to answer 5. At 5 the unit covered 4.07% of the frame's width and 0.23%
    // of its area: framed dead centre, and invisible. Fitted it is 63.4% and
    // 55.8%.
    const { container } = renderXa("XA-SML");
    const fill = framed(container, "XA-SML");

    expect(fill.k).toBeGreaterThan(MAX_ZOOM_K);
    expect(Math.max(fill.x, fill.y)).toBeCloseTo(ZOOM_FILL, 9);
    // The claim the defect fails, in the terms a user sees it in.
    expect(fill.area).toBeGreaterThan(0.5);
  });

  test("a speck below the framing floor is still clamped, so the ceiling is real", () => {
    // `XA-DOT` is 0.003 degrees — 0.42 viewBox units, under the framing floor —
    // and the fit would ask for k = 1299.7. Below `MIN_FRAMED_EXTENT` there is
    // nothing left to frame: the geometry is finer than the coordinate system
    // it is drawn in, and more magnification only magnifies the simplifier's
    // rounding. Clamped it still covers 39.4% of the frame, against 0.0008% at
    // the old ceiling — a clamp is a worse frame, never no frame.
    const { container } = renderXa("XA-DOT");
    const fill = framed(container, "XA-DOT");

    expect(fill.k).toBe(ADMIN1_MAX_ZOOM_K);
    expect(Math.max(fill.x, fill.y)).toBeLessThan(ZOOM_FILL);
    // Finite, centred, and still two orders of magnitude better than 5x — a
    // clamp is a worse frame, never a broken one.
    expect(Number.isFinite(fill.area)).toBe(true);
    expect(fill.area).toBeGreaterThan(0.1);
  });

  test("the admin-1 ceiling is derived from an extent, not picked", () => {
    // What makes the two paths differ, as arithmetic: the ceiling is the scale
    // a square unit of `MIN_FRAMED_EXTENT` viewBox units is framed at, so the
    // number that has to be defensible is an EXTENT in the map's own units
    // rather than a magnification with no units at all.
    expect(ADMIN1_MAX_ZOOM_K).toBe(
      (ZOOM_FILL * Math.min(MAP_VIEW_W, MAP_VIEW_H)) / MIN_FRAMED_EXTENT
    );
    expect(MIN_FRAMED_EXTENT).toBe(0.5);
    expect(ADMIN1_MAX_ZOOM_K).toBeCloseTo(1091.2, 9);

    // And China's ceiling has not moved — `chinaBaseline.test.tsx` pins that
    // byte for byte. Two constants because they answer two questions.
    expect(MAX_ZOOM_K).toBe(5);
  });
});
