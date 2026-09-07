import { cleanup, render } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import type { Airport } from "@/lib/airports";
import type { ProjectionEntry } from "@/lib/countryProjection";
import { parseProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import { CountryLevel } from "@/components/map/CountryLevel";
import { PE_ENTRY, PE_FILE, PE_TOPOLOGY } from "@/components/map/countryFixture";
import type { MapPlace } from "@/components/map/mapTypes";

/**
 * The two mocks, the fixtures and the DOM readers the five CountryLevel test
 * files share: `CountryLevel.test.tsx`, its `.markers`, `.zoom` and `.airports`
 * siblings, and `countryView.test.tsx`.
 *
 * Everything below is `CountryLevel.test.tsx`'s own preamble, moved whole — the
 * `nonOverlappingRadii` spy and the `fitForPlace` spy, the Peru places and the
 * two alternate province files, the props builder and `renderLevel`, and the
 * readers that pull a marker's position, radii, titles and airport marks back
 * out of the rendered SVG.
 *
 * A plain non-test module for the reason `countryFixture.ts` gives and spec
 * §12.1 restates: importing one `.test.tsx` from another makes vitest collect
 * the imported file's `describe` blocks a second time.
 *
 * Lives under `test/`, not beside the component it mounts: it value-imports
 * `vitest`, `@testing-library/react` and `CountryLevel` itself, and
 * `lib/contracts.test.ts`'s C7 walks `components/`, `app/`, `lib/` and
 * `scripts/` for surfaces that render GeoNames data — sitting in
 * `components/map/` would make this file one more of them, uncredited.
 *
 * **Import it FIRST, before any other import in the file.** The two `vi.mock`
 * calls are hoisted above this module's imports and no further, so a file that
 * reaches `mapTypes` or `@/lib/dragLayer` through an earlier import of its own
 * gets the real module and the mock quietly does nothing — a `capCall` that is
 * never called and a `fitForPlace` that cannot be `vi.mocked`. So every one of
 * the five files opens with
 * `import { installCountryLevelHarness, … } from "@/test/countryLevelHarness";`
 * and calls `installCountryLevelHarness()` above its first `describe`.
 */

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
 * so every test in the five files that import this harness sees the module
 * unchanged.
 */
const { capCall } = vi.hoisted(() => ({ capCall: vi.fn() }));
// Exported as a specifier rather than as `export const`: vitest hoists this
// declaration above the imports and refuses to hoist an exported one
// ("Cannot export hoisted variable"). The binding is the same either way.
export { capCall };

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

// Wraps the real resolver in a spy so a test can count how often a render
// consults it. Behaviour is unchanged: every call goes through to the original.
vi.mock("@/components/map/mapTypes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/map/mapTypes")>();
  return { ...actual, fitForPlace: vi.fn(actual.fitForPlace) };
});

export function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "catalog",
    localName: null,
    province: null,
    country: "PE",
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
export const LIMA = place({ id: "lima", name: "Lima", province: "Lima", lon: -78, lat: -12 });
/** On the eastern edge: the pair's separation IS the mainland's rendered width. */
export const CUSCO = place({ id: "cusco", name: "Cusco", province: "Cuzco", lon: -72, lat: -12 });
/** Out on the island the manifest leaves out of frame. */
export const ISLA = place({
  id: "isla",
  name: "Puerto Lejano",
  province: "Isla Lejana",
  lon: -109.5,
  lat: -27.5,
});

/** Degrees of latitude per km, for an airport placed along a place's meridian. */
export const KM_PER_DEGREE = (6371 * Math.PI) / 180;

/**
 * An airport exactly `km` due north of a place.
 *
 * Along the meridian, where the great-circle distance is exactly `R · dLat` —
 * so "30 km away" is 30 km rather than 30-ish, and the number the card prints
 * is pinned by the fixture instead of by whichever way `Math.round` fell.
 */
export function airportNear(
  place: MapPlace,
  iata: string,
  km: number,
  size: Airport["size"] = "medium"
): Airport {
  return {
    iata,
    icao: null,
    name: `${iata} Airport`,
    municipality: place.name,
    country: "PE",
    lat: place.lat + km / KM_PER_DEGREE,
    lon: place.lon,
    size,
  };
}

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
export const BO_FILE: ProvinceFile = parseProvinceTopology({
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

/**
 * Peru with ONE selectable unit — §6.6 D10's shape, and 34 real countries'.
 *
 * The same four polygons under the same four ids: only `sel` moves, so any
 * difference in what the level draws is the COUNT answering and can be nothing
 * else. The country code stays "PE" throughout, and `provinces/index.json`
 * puts 26 selectable units under it — which is the whole point: the gate is the
 * geometry in hand, never the code on the envelope.
 */
export const PE_ONE_UNIT: ProvinceFile = parseProvinceTopology({
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

/**
 * The default props `renderLevel` renders with, reusable where a test needs
 * the props without a render — to build a second component around them, say.
 */
export function levelProps(over: Partial<Parameters<typeof CountryLevel>[0]> = {}) {
  return {
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
}

export function renderLevel(over: Partial<Parameters<typeof CountryLevel>[0]> = {}) {
  const props = levelProps(over);
  return { ...render(<CountryLevel {...props} />), props };
}

/**
 * The two hooks every file needs, registered where the file calls this rather
 * than at this module's top level: a top-level `afterEach` in an imported
 * module attaches to whichever suite happens to be collecting it first, which
 * is a coupling no reader of the test file can see.
 */
export function installCountryLevelHarness(): void {
  afterEach(cleanup);
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

/** Subpath count: one `M` per ring, which is what `merge()` changes. */
export function rings(d: string | null): number {
  return (d ?? "").match(/M/g)?.length ?? 0;
}

export function markerX(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-dot").getAttribute("cx"));
}

/**
 * The same reading on the other axis.
 *
 * A sibling rather than a parameterised `marker(container, id, "cx" | "cy")`,
 * so that every position assertion in this file names the axis it is about at
 * its own call site instead of passing an attribute nobody reads twice.
 *
 * It exists because §10.1's airport mark is positioned on BOTH — its `x` and
 * its `y` are each a scaled inset off the projected point — and a mark pinned
 * on x alone is satisfied by drawing every diamond on the x = y diagonal.
 */
export function markerY(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-dot").getAttribute("cy"));
}

/** One of a marker's circles, told apart by the attribute that names its job. */
export function circleFor(container: HTMLElement, id: string, attr: string): Element {
  const circle = container.querySelector(`[data-place="${id}"] circle[${attr}]`);
  if (!circle) throw new Error(`no ${attr} circle for ${id}`);
  return circle;
}

/** The transparent target's radius, in viewBox units. */
export function hitR(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-hit").getAttribute("r"));
}

/** The visible dot's radius — §5.3.2 says this one does not change. */
export function dotR(container: HTMLElement, id: string): number {
  return Number(circleFor(container, id, "data-dot").getAttribute("r"));
}

/**
 * The names the province layer paints onto the map, in draw order.
 *
 * `getByTitle` cannot see these — testing-library's selector is `svg > title`,
 * a DIRECT child — so they are read off the paths that carry them.
 */
export function unitTitles(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-units] title")].map((title) => title.textContent);
}

/** Every marker group, in the order they are drawn. */
export function markers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-markers] [data-place]")];
}

/** Every airport mark §10.1's layer drew, in the order they are drawn. */
export function airportMarks(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-airports] [data-airport]")];
}

/** The IATA codes the layer put on the map. */
export function airportCodes(container: HTMLElement): (string | null)[] {
  return airportMarks(container).map((mark) => mark.getAttribute("data-airport"));
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
export function stubRenderedWidth(width: number): void {
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
