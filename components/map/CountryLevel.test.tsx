import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProjectionEntry } from "@/lib/countryProjection";
import { parseProvinceTopology } from "@/lib/provinceTopology";
import { CountryLevel } from "./CountryLevel";
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

/** Subpath count: one `M` per ring, which is what `merge()` changes. */
function rings(d: string | null): number {
  return (d ?? "").match(/M/g)?.length ?? 0;
}

function markerX(container: HTMLElement, id: string): number {
  const circle = container.querySelector(`[data-place="${id}"] circle`);
  if (!circle) throw new Error(`no marker for ${id}`);
  return Number(circle.getAttribute("cx"));
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
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  test("keeps the markers out of the accessibility tree, so each place is one control", () => {
    // The list is the spine (§5.2) and the markers are a backdrop until PR4's
    // roving tabindex gives them a keyboard model of their own. Announcing
    // both would read every city twice and put 750 tab stops on the map — the
    // arrangement `worldLevelShared.tsx` calls "indefensible for 235".
    const { container } = renderLevel();

    expect(screen.getAllByRole("button", { name: "Lima" })).toHaveLength(1);
    expect(container.querySelector("[data-markers]")).toHaveAttribute("aria-hidden");
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
