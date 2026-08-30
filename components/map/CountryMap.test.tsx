import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Topology } from "topojson-specification";
import { hasDetailLevel } from "@/lib/countryDetail";
import type { ProjectionEntry } from "@/lib/countryProjection";
import type { ProvinceFile } from "@/lib/provinceTopology";
import { TAP_MIN_R_FALLBACK } from "./CountryLevel";
import { CountryMap, hasCuratedTopology } from "./CountryMap";
import { PE_ENTRY, PE_FILE } from "./countryFixture";
import type { MapPlace } from "./mapTypes";

/**
 * The China level is a verbatim move out of `ChinaMap`, so what is asserted
 * here is the behaviour that must survive the rename — provinces are zoom
 * controls, markers are keyboard-operable, zooming filters them — plus the two
 * things the rename adds: which country gets the detail level, and what a
 * country without one renders instead.
 *
 * Projection output, tint and label placement are visual and are not asserted.
 * The fixture is two provinces and a nine-dash feature rather than the real
 * 1.2MB asset, so the expected set of controls is something the test states.
 */

/**
 * Absolute (untransformed) TopoJSON: one closed ring per province, wound
 * south-west, north-west, north-east, south-east.
 *
 * That is the order `worldFixture.ts` documents, and load-bearing for the
 * reason it gives: d3 reads a ring spherically, so the other winding makes each
 * province *the whole globe minus the rectangle* (`geoArea` 4π against 2.3e-4).
 * It renders without error and drags `buildFitProjection` onto the entire
 * sphere, so nothing asserted below would catch it — but any assertion this
 * file later grows about a path, a fit, a projected marker or a zoom transform
 * would be measuring an inverted world.
 */
const CHINA_FIXTURE = {
  type: "Topology",
  arcs: [
    [
      [116, 39.5],
      [116, 40.5],
      [117, 40.5],
      [117, 39.5],
      [116, 39.5],
    ],
    [
      [121, 31],
      [121, 32],
      [122, 32],
      [122, 31],
      [121, 31],
    ],
    [
      [110, 10],
      [110, 12],
      [112, 12],
      [112, 10],
      [110, 10],
    ],
  ],
  objects: {
    provinces: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          arcs: [[0]],
          properties: { adcode: 110000, name: "北京市" },
        },
        {
          type: "Polygon",
          arcs: [[1]],
          properties: { adcode: 310000, name: "上海市" },
        },
        // No province owns adcode 0 — this is the nine-dash line, which the
        // level draws but never treats as a region.
        {
          type: "Polygon",
          arcs: [[2]],
          properties: { adcode: 0, name: "南海诸岛" },
        },
      ],
    },
  },
} as unknown as Topology;

function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "curated",
    localName: null,
    province: null,
    region: "East",
    lat: 31.2,
    lon: 121.5,
    population: null,
    level: "curated",
    attractionCount: 3,
    blurb: null,
    ...over,
  };
}

const SHANGHAI = place({ id: "shanghai", name: "Shanghai", localName: "上海" });
const BEIJING = place({
  id: "beijing",
  name: "Beijing",
  region: "North",
  lat: 39.9,
  lon: 116.4,
});

/**
 * 200 catalog cities across two provinces, the shape a real shard has.
 *
 * Module scope because two blocks below need the same one, and because the
 * coordinates are load-bearing for only one of them: spread over the
 * `countryFixture` mainland rather than stacked on a single point, so the
 * branch that DRAWS them draws what a shard would. 200 markers at one
 * coordinate would let `nonOverlappingRadii` collapse every target to nothing
 * and make the tap-target half of §12.2 unassertable.
 */
function peruvianShard(): MapPlace[] {
  return Array.from({ length: 200 }, (_, i) =>
    place({
      id: `G${1000 + i}`, name: `City ${i}`, kind: "catalog",
      province: i < 120 ? "Lima" : "Cuzco",
      lon: -78 + (i % 20) * 0.3,
      lat: -14 + Math.floor(i / 20) * 0.4,
    })
  );
}

function renderMap(over: Partial<Parameters<typeof CountryMap>[0]> = {}) {
  const props = {
    country: "CN",
    topology: CHINA_FIXTURE,
    // The dispatcher's other two branches, both off by DEFAULT and neither of
    // them therefore off everywhere: these cases are about China's renderer
    // and about the list a country with no geometry gets, and the reachability
    // block at the foot of this file passes a real province file so §12.2 is
    // proven against the level that draws one too.
    provinces: null,
    projection: null,
    places: [SHANGHAI, BEIJING],
    selected: [] as string[],
    month: 10,
    zoomRegion: null,
    routeIds: [] as string[],
    onZoomRegion: vi.fn(),
    onTogglePlace: vi.fn(),
    onHoverPlace: vi.fn(),
    ...over,
  };
  return { ...render(<CountryMap {...props} />), props };
}

afterEach(cleanup);

describe("hasCuratedTopology", () => {
  test("is China only, however the code is cased or padded", () => {
    expect(hasCuratedTopology("CN")).toBe(true);
    expect(hasCuratedTopology(" cn ")).toBe(true);
    expect(hasCuratedTopology("JP")).toBe(false);
    expect(hasCuratedTopology("")).toBe(false);
  });

  test("is a narrower question than whether the country has a detail level", () => {
    // The predicate this dispatcher used to ask was both questions at once,
    // and PR4 pulled them apart: the registry now says Japan has admin-1
    // geometry, while only China has the curated asset `ChinaLevel` draws.
    // Swapping this call site for the registry's answer — the obvious-looking
    // edit — would route Japan into China's renderer, so it is pinned here
    // rather than left to the two assertions further down that would catch it
    // by accident.
    expect(hasDetailLevel("JP")).toBe(true);
    expect(hasCuratedTopology("JP")).toBe(false);
  });
});

describe("CountryMap — China", () => {
  test("exposes the map as a group, so its controls survive in the a11y tree", () => {
    renderMap();

    // `role="img"` makes every descendant presentational, which drops the
    // province zoom buttons and every place toggle out of the accessibility
    // tree — while `tabIndex={0}` keeps them focusable, so a keyboard user
    // lands on controls a screen reader announces as nothing. WorldMap's own
    // docblock rejects exactly this pattern and uses a group.
    //
    // Asserted on the container's role rather than through the buttons,
    // because testing-library does not implement ARIA's presentational-children
    // rule: the assertions below find the buttons either way. The browser is
    // where this bites, so the role is the honest thing to pin.
    expect(screen.getByRole("group", { name: "Map of China segmented by region" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Map of China/ })).toBeNull();
  });

  test("makes every province a zoom control and reports the region clicked", () => {
    const { props } = renderMap();

    const north = screen.getByRole("button", { name: "Zoom into North China (Beijing)" });
    expect(screen.getByRole("button", { name: "Zoom into East China (Shanghai)" })).toBeInTheDocument();

    fireEvent.click(north);
    expect(props.onZoomRegion).toHaveBeenCalledWith("North");
  });

  test("stops offering the zoom once a region is open", () => {
    const { props } = renderMap({ zoomRegion: "East" });

    expect(
      screen.queryByRole("button", { name: "Zoom into North China (Beijing)" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Map of East China with selectable places" })
    ).toBeInTheDocument();
    expect(props.onZoomRegion).not.toHaveBeenCalled();
  });

  test("adds a place from the keyboard, and Space does not scroll the page", () => {
    const { props } = renderMap();

    const marker = screen.getByRole("button", { name: "Shanghai" });
    fireEvent.keyDown(marker, { key: "Enter" });
    expect(props.onTogglePlace).toHaveBeenCalledWith(SHANGHAI);

    // fireEvent returns false when the handler called preventDefault, which is
    // what stops Space paging the map away under the user.
    expect(fireEvent.keyDown(marker, { key: " " })).toBe(false);
    expect(props.onTogglePlace).toHaveBeenCalledTimes(2);
  });

  test("marks a selected place and shows only the open region's places", () => {
    renderMap({ zoomRegion: "East", selected: ["shanghai"] });

    expect(screen.getByRole("button", { name: "Shanghai (selected)" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Beijing is in North: zooming East takes it off the map entirely.
    expect(screen.queryByRole("button", { name: "Beijing" })).not.toBeInTheDocument();
  });

  test("draws nothing while the topology is still loading", () => {
    const { container } = renderMap({ topology: null });

    // The caller owns the loading state; a fallback here would claim China has
    // no map at all.
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CountryMap — countries with no curated topology", () => {
  test("names the country and points at search instead of drawing a map", () => {
    renderMap({ country: "JP", topology: null, places: [] });

    expect(screen.getByText("Japan")).toBeInTheDocument();
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  test("lists whatever places the country does have, as toggles", () => {
    const kyoto = place({ id: "kyoto", name: "Kyoto", lat: 35, lon: 135.7 });
    const { props } = renderMap({
      country: "JP",
      topology: null,
      places: [kyoto],
      selected: ["kyoto"],
    });

    const toggle = screen.getByRole("button", { name: /Kyoto/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(props.onTogglePlace).toHaveBeenCalledWith(kyoto);
  });

  test("ignores a China topology handed to another country", () => {
    renderMap({ country: "JP", places: [] });

    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
  });
});

describe("CountryPlaceList — a country with a full shard", () => {
  test("groups a full shard by province and reaches every city", () => {
    // Before this, the list rendered places.slice(0, 60) — which for 150 of
    // 246 countries hid most of the shard, 690 of Peru's 750 among them.
    renderMap({ country: "PE", topology: null, places: peruvianShard() });

    expect(screen.getByRole("group", { name: "Lima" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Cuzco" })).toBeInTheDocument();

    // Every city is reachable — collapsed groups expand, they do not truncate.
    for (const button of screen.getAllByRole("button", { name: /^Show all/ })) {
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: "City 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "City 199" })).toBeInTheDocument();
    expect(screen.queryByText(/more in Peru/)).not.toBeInTheDocument();
  });

  test("filtering narrows to matching cities across every group", () => {
    const places = [
      place({ id: "G1", name: "Lima", kind: "catalog", province: "Lima" }),
      place({ id: "G2", name: "Cusco", kind: "catalog", province: "Cuzco" }),
    ];
    renderMap({ country: "PE", topology: null, places });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cus" } });

    expect(screen.getByRole("button", { name: "Cusco" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lima" })).not.toBeInTheDocument();
  });

  test("says so when a filter matches nothing, rather than rendering blank", () => {
    renderMap({
      country: "PE", topology: null,
      places: [place({ id: "G1", name: "Lima", kind: "catalog", province: "Lima" })],
    });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText(/No places in Peru match/)).toBeInTheDocument();
  });

  test("says nothing about a remainder when everything fits", () => {
    renderMap({
      country: "PE",
      topology: null,
      places: [place({ id: "G1", name: "Lima", kind: "catalog" })],
    });

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });
});


describe("reachability — the Phase 4 acceptance criterion", () => {
  /**
   * Spec §12.2. This is the criterion the whole phase is gated on: a country
   * level that renders geometry must not become the ONLY way to select a
   * place. The repo already rejected per-marker tab stops once — see
   * worldLevelShared.tsx's "indefensible for 235" — and this test is what
   * makes that decision survive a later PR that adds an outline.
   *
   * Run once per DISPATCHER BRANCH, and that is the whole point of the shape
   * below. When Plan 3 made `provinces: null` the default in `renderMap`, every
   * case here quietly became the list-only fallback: the gate for a phase
   * about drawing maps stopped rendering one, and deleting `CountryPlaceList`
   * from `CountryLevel` left all of it green. The criterion is only proven
   * once it has been proven for a country that HAS a map, so the branch with
   * geometry is asserted here rather than left to `CountryLevel.test.tsx` —
   * which is a different file, and not the one §12.2 names.
   */
  const BRANCHES: {
    label: string;
    provinces: ProvinceFile | null;
    projection: ProjectionEntry | null;
    /** What the branch must actually have rendered — see `renderCountry`. */
    hasMap: boolean;
  }[] = [
    // No geometry: the list IS the level. That is every country until its
    // province file arrives, and it is the case this block already covered.
    { label: "a country with no map", provinces: null, projection: null, hasMap: false },
    // Geometry plus its §5.4 manifest entry: `CountryLevel`, markers and all.
    { label: "a country with a map", provinces: PE_FILE, projection: PE_ENTRY, hasMap: true },
  ];

  /**
   * The list's own controls: real `<button>` elements, never the markers.
   *
   * The distinction is load-bearing on the branch with a map, where §5.3.1
   * announces every place a SECOND time as an SVG `<g role="button">` with the
   * same accessible name. A count taken over `getAllByRole("button")` would
   * therefore still reach 200 with the list deleted outright — which is
   * exactly the mutation this block failed to catch — so what is counted is
   * the tag, and the tag is what §5.2 calls the spine.
   */
  function listChips(container: HTMLElement): HTMLButtonElement[] {
    return [...container.querySelectorAll("button")];
  }

  describe.each(BRANCHES)("$label", ({ provinces, projection, hasMap }) => {
    function renderCountry(places: MapPlace[]) {
      const rendered = renderMap({ country: "PE", topology: null, provinces, projection, places });
      // Which branch was taken, asserted rather than assumed. A `provinces`
      // value that stopped parsing — or a dispatcher that stopped routing on
      // it — would drop this case silently back onto the list-only fallback
      // and pass every assertion below, which is precisely how the block lost
      // its coverage of the map in the first place.
      expect(screen.queryAllByRole("group", { name: "Map of Peru" })).toHaveLength(hasMap ? 1 : 0);
      return rendered;
    }

    test("every place in an open country is reachable by keyboard", () => {
      const { container } = renderCountry(peruvianShard());

      // `queryAll`, so a level that renders no list at all fails on the count
      // below rather than on this line: "there are 0 of the 200 chips" names the
      // defect, "unable to find a Show all button" describes a symptom of it.
      for (const button of screen.queryAllByRole("button", { name: /^Show all/ })) {
        fireEvent.click(button);
      }

      const chips = listChips(container);
      expect(chips.filter((el) => /^City \d+$/.test(el.textContent ?? ""))).toHaveLength(200);
      for (const chip of chips) {
        expect(chip.getAttribute("tabindex")).not.toBe("-1");
      }

      // And where there is a map, all 200 markers cost ONE tab stop between
      // them. That bound is why the list has to reach every place rather than
      // merely duplicate a marker layer that was already tabbable: assert the
      // reachability without it and a level could satisfy §12.2 by giving 200
      // cities 200 tab stops, which the phase rejected.
      const markers = [...container.querySelectorAll("[data-markers] [data-place]")];
      expect(markers.filter((el) => el.getAttribute("tabindex") === "0").length)
        .toBeLessThanOrEqual(1);
    });

    test("every place is reachable by filtering, without expanding anything", () => {
      renderCountry(peruvianShard());
      // By ACCESSIBLE NAME, since §12.2 is an accessibility criterion — but
      // narrowed to the list, because on the branch with a map the marker
      // carries the same name and is present from the start.
      const chip = (name: string) =>
        screen.queryAllByRole("button", { name }).find((el) => el.tagName === "BUTTON") ?? null;

      // City 199 is past every per-group cap and is not rendered initially.
      expect(chip("City 199")).toBeNull();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "City 199" } });
      expect(chip("City 199")).not.toBeNull();
    });

    test("no interactive control opts out of the minimum tap target", () => {
      // One place, so the map branch has no neighbour to crowd its marker:
      // §5.3.2's cap is what a crowded target trades away, and this test is
      // about the size a target reaches when nothing is capping it.
      const { container } = renderCountry([
        place({ id: "G1", name: "Lima", kind: "catalog", province: "Lima", lon: -78, lat: -12 }),
      ]);

      // jsdom computes no layout, so this asserts the class contract rather
      // than a measured box — which is what the codebase can actually check,
      // and it still catches a control shipped without the token.
      for (const el of [...listChips(container), screen.getByRole("searchbox")]) {
        expect(el.className).toContain("min-h-[var(--tap-min)]");
      }

      // A marker's target is not a class: it is a transparent circle sized in
      // viewBox units from the same `--tap-min` token (§5.3.2), so the map half
      // of the criterion is asserted in the units the map draws in. That the
      // radius really is 44 CSS px is pinned against the token and the viewBox
      // as literals in `CountryLevel.test.tsx`; what is claimed HERE is that a
      // marker on this branch gets the whole of it — a single place has no
      // neighbour, so `nonOverlappingRadii` caps nothing.
      for (const marker of container.querySelectorAll("[data-markers] [data-place]")) {
        const hit = Number(marker.querySelector("circle[data-hit]")?.getAttribute("r"));
        expect(hit).toBeGreaterThanOrEqual(TAP_MIN_R_FALLBACK);
      }
    });
  });
});
