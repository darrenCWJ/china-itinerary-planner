import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Topology } from "topojson-specification";
import type { Airport } from "@/lib/airports";
import { hasDetailLevel } from "@/lib/countryDetail";
import type { ProjectionEntry } from "@/lib/countryProjection";
import type { ProvinceFile } from "@/lib/provinceTopology";
import type { RegionId } from "@/lib/regionScheme";
import { TAP_MIN_R_FALLBACK } from "./CountryLevel";
import { CountryMap, hasCuratedTopology } from "./CountryMap";
import { PE_ENTRY, PE_FILE, peFileWith } from "./countryFixture";
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
    // "CN" because the default `region` below is one of China's seven — the
    // pair has to be coherent now that `fitForPlace` reads both.
    country: "CN",
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

/**
 * Where the reachability block's cities are committed to live, for the branch
 * that frames the map on one of them.
 *
 * `cityProvince` is the ONLY thing that places a city in a province (§6.5): a
 * marker's lon/lat decide where it is drawn, and this map decides which unit
 * contains it. So the split below is data, not geography, and it is chosen to
 * put all three of the level's outcomes into one render of the same 200 cities:
 *
 * - **120 in `PE-ISL`**, the framed unit, so the zoomed map draws them;
 * - **60 in `PE-CUS`**, a real selectable unit that is not the framed one;
 * - **20 in no unit at all** — the state 478 real cities are in, placed by
 *   neither containment nor `a1c`.
 *
 * 80 cities are therefore off the map while the country is framed, and every
 * one of them has to stay reachable through the list. That is the whole of
 * §12.2 on this branch.
 *
 * `G1` is the single place the tap-target case renders, framed too: a marker
 * that is correctly absent would turn that assertion into an empty loop, which
 * passes and proves nothing.
 */
const ZOOMED_CITY_PROVINCE: Readonly<Record<string, string>> = {
  G1: "PE-ISL",
  ...Object.fromEntries(
    peruvianShard().flatMap(({ id }, i) =>
      i < 120 ? [[id, "PE-ISL"]] : i < 180 ? [[id, "PE-CUS"]] : []
    )
  ),
};

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
   * Run once per RENDERING the country level can produce, and that is the
   * whole point of the shape below. When Plan 3 made `provinces: null` the
   * default in `renderMap`, every case here quietly became the list-only
   * fallback: the gate for a phase about drawing maps stopped rendering one,
   * and deleting `CountryPlaceList` from `CountryLevel` left all of it green.
   * The criterion is only proven once it has been proven for a country that
   * HAS a map, so the branch with geometry is asserted here rather than left
   * to `CountryLevel.test.tsx` — which is a different file, and not the one
   * §12.2 names.
   *
   * The first two are the dispatcher's; the third is the framing Phase 4 adds,
   * and it is where the criterion has the most to say. A province zoom draws a
   * SUBSET — §6.5 filters the markers to the cities `cityProvince` puts in the
   * framed group — so on that rendering the list is not merely a second way to
   * reach a place, it is the ONLY way to reach the 80 cities the map has just
   * taken off screen. A level that filtered the list alongside the markers, or
   * dropped it, would strand them; that is the mutation this branch exists to
   * catch, and no amount of coverage on the unzoomed map would catch it.
   */
  const BRANCHES: {
    label: string;
    provinces: ProvinceFile | null;
    projection: ProjectionEntry | null;
    /** What the branch must actually have rendered — see `renderCountry`. */
    hasMap: boolean;
    /** The framing, and null for the whole country. `CountryMapProps.zoomRegion`. */
    zoomRegion: RegionId | null;
    /** Markers drawn for `peruvianShard()` — 200 places, filtered by the framing. */
    markers: number;
  }[] = [
    // No geometry: the list IS the level. That is every country until its
    // province file arrives, and it is the case this block already covered.
    {
      label: "a country with no map",
      provinces: null,
      projection: null,
      hasMap: false,
      zoomRegion: null,
      markers: 0,
    },
    // Geometry plus its §5.4 manifest entry: `CountryLevel`, markers and all.
    {
      label: "a country with a map",
      provinces: PE_FILE,
      projection: PE_ENTRY,
      hasMap: true,
      zoomRegion: null,
      markers: 200,
    },
    // The same map framed on one province. `PE-ISL` because it is the only
    // unit of the three that MAGNIFIES — the two mainland units are 2° wide
    // and 4° tall inside a 6°-by-4° frame, so latitude constrains their fit and
    // `k` lands just under 1, which would let the tap-target assertion below
    // pass without ever dividing by anything. The island reaches 3.46, and
    // `CountryLevel.test.tsx` pins that number to the decimal.
    {
      label: "a country framed on one province",
      provinces: peFileWith(ZOOMED_CITY_PROVINCE),
      projection: PE_ENTRY,
      hasMap: true,
      zoomRegion: "PE-ISL",
      markers: 120,
    },
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

  /** Every marker the level actually drew, which a framing filters. */
  function drawnMarkers(container: HTMLElement): Element[] {
    return [...container.querySelectorAll("[data-markers] [data-place]")];
  }

  /**
   * The magnification the level is drawing at: `scale(k)` off its one
   * `[data-zoom]` group, and 1 where there is no map to carry one.
   *
   * Read from the DOM rather than recomputed, because it is the number the
   * component divided its own radii by and the assertion below has to be in
   * the same units. `k` round-trips exactly through `${k}` and `Number`, so
   * `TAP_MIN_R_FALLBACK / k` here is bit-identical to the value the level put
   * on the circle — which is what lets that comparison stay an inequality
   * instead of an epsilon.
   */
  function zoomScale(container: HTMLElement): number {
    const zoom = container.querySelector<SVGGElement>("[data-zoom]");
    if (!zoom) return 1;
    const k = Number(/scale\(([^)]+)\)/.exec(zoom.style.transform)?.[1]);
    if (!Number.isFinite(k)) throw new Error(`no scale in "${zoom.style.transform}"`);
    return k;
  }

  /**
   * Three airports over the shard's mainland, of which §10.1's layer draws two.
   *
   * `small` is in the fixture on purpose: the layer's allow-list is `large` and
   * `medium`, so a set of three that draws two is what makes the count below a
   * count of the layer rather than of the array it was handed.
   */
  const PERUVIAN_AIRPORTS: Airport[] = (
    [
      ["LIM", -77, -12, "large"],
      ["CUZ", -75, -13, "medium"],
      ["JAU", -74, -11, "small"],
    ] as const
  ).map(([iata, lon, lat, size]) => ({
    iata,
    icao: null,
    name: `${iata} Airport`,
    municipality: null,
    country: "PE" as const,
    lat,
    lon,
    size,
  }));

  /** Every mark §10.1's layer drew, which on a country with no map is none. */
  function airportMarks(container: HTMLElement): Element[] {
    return [...container.querySelectorAll("[data-airports] [data-airport]")];
  }

  describe.each(BRANCHES)("$label", ({ provinces, projection, hasMap, zoomRegion, markers }) => {
    function renderCountry(
      places: MapPlace[],
      /** §10.1's layer, for the case below that runs the criterion with it on. */
      over: Partial<Parameters<typeof CountryMap>[0]> = {}
    ) {
      const rendered = renderMap({
        country: "PE",
        topology: null,
        provinces,
        projection,
        places,
        zoomRegion,
        ...over,
      });
      // Which branch was taken, asserted rather than assumed. A `provinces`
      // value that stopped parsing — or a dispatcher that stopped routing on
      // it — would drop this case silently back onto the list-only fallback
      // and pass every assertion below, which is precisely how the block lost
      // its coverage of the map in the first place.
      expect(screen.queryAllByRole("group", { name: "Map of Peru" })).toHaveLength(hasMap ? 1 : 0);
      // And that the framing TOOK, which the group's name cannot say: it is
      // "Map of Peru" zoomed or not. `RegionId` is `string`, so a group id
      // that stopped resolving — a renamed unit, a scheme that no longer
      // offers it, a country whose file moved on — is not a type error and not
      // a crash. It is an identity transform, and this branch would quietly
      // become a second copy of the one above it.
      const scale = zoomScale(rendered.container);
      if (zoomRegion === null) expect(scale).toBe(1);
      else expect(scale).toBeGreaterThan(1);
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
      const drawn = drawnMarkers(container);
      expect(drawn.filter((el) => el.getAttribute("tabindex") === "0").length)
        .toBeLessThanOrEqual(1);

      // How many of the 200 the MAP shows, which is the count the 200 above is
      // measured against. On the framed branch it is 120: 60 cities sit in
      // another unit and 20 in none, and the only thing that reaches those 80
      // is the list this test just counted.
      expect(drawn).toHaveLength(markers);
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
      //
      // Over `k`, because the circle is drawn INSIDE the transform: the same
      // 44 CSS px is 16.89 viewBox units unzoomed and 4.89 at the island's
      // 3.46. Comparing against the unscaled token on the framed branch would
      // fail a compliant marker, so the floor is the token in the units of
      // this frame. A floor, not an equality — that the radius is exactly
      // `tapTargetRadius(width) / k` is `CountryLevel.test.tsx`'s claim, and
      // what §12.2 asks here is that no control on this branch opts out.
      const floor = TAP_MIN_R_FALLBACK / zoomScale(container);
      for (const marker of drawnMarkers(container)) {
        const hit = Number(marker.querySelector("circle[data-hit]")?.getAttribute("r"));
        expect(hit).toBeGreaterThanOrEqual(floor);
      }
      // Not vacuously: a place the framing filters out draws no marker, and an
      // empty loop is how this assertion would stop asserting anything.
      expect(drawnMarkers(container)).toHaveLength(hasMap ? 1 : 0);
    });

    /**
     * §10.1's layer, run against the criterion the phase is gated on.
     *
     * The three cases above render with the layer off, which is its default and
     * therefore the only state they will ever see — so on its own this block
     * would go on passing while the layer added a control, a tab stop or a
     * marker to every country in the app. What §12.2 asks is that the level not
     * change how a place is reached; an airport is not a place, so the layer's
     * correct effect on every count here is exactly zero, in both directions.
     *
     * Both directions, and that is not pedantry: the failure that matters is a
     * layer drawn as `<g role="button">` — the shape §5.3.1 already uses for a
     * marker, and the obvious way to make an airport clickable later — which
     * ADDS reachable controls that lead nowhere. A layer that swallowed taps
     * from the markers beneath it would subtract instead. Equality catches both
     * and is what "decorative" means when written as an assertion.
     *
     * The explicit timeout is the cost of that: three renderings of a 200-city
     * map where every neighbour in this block renders one, at ~700ms each with
     * `getAllByRole` over ~400 controls as most of it. ~2s in isolation, and
     * over vitest's 5s default under the full suite where 119 files share the
     * box. Raised rather than trimmed: the equality between the three IS the
     * deliverable, and a cheaper baseline would be a different claim.
     */
    test("the airport layer changes nothing the criterion counts", () => {
      /** The criterion's own counts, taken over one full render. */
      function counts(over: Partial<Parameters<typeof CountryMap>[0]>) {
        const { container } = renderCountry(peruvianShard(), over);
        // Expanded, so the count is of all 200 rather than of the caps.
        for (const button of screen.queryAllByRole("button", { name: /^Show all/ })) {
          fireEvent.click(button);
        }
        const measured = {
          /** Every control a reader can reach, markers and chips alike. */
          reachable: screen.getAllByRole("button").length,
          /** §5.2's spine, by tag — the list a framing must never filter. */
          chips: listChips(container).length,
          cities: listChips(container).filter((el) => /^City \d+$/.test(el.textContent ?? ""))
            .length,
          markers: drawnMarkers(container).length,
          /** Tab stops, which is the half of §12.2 a decoration could inflate. */
          tabStops: container.querySelectorAll('[tabindex="0"]').length,
          airports: airportMarks(container).length,
        };
        cleanup();
        return measured;
      }

      // Three renderings, because the array and the layer are two things and
      // the middle one is the state the app is actually in. `MapExplorer` has
      // fetched `airports` since PR1 for the route estimator and now passes it
      // for the card's line as well, so EVERY open country holds the array with
      // the toggle off. A comparison of `none` against `on` alone would leave
      // that state — the common one — asserted by nothing.
      const none = counts({});
      const held = counts({ airports: PERUVIAN_AIRPORTS });
      const on = counts({ airports: PERUVIAN_AIRPORTS, showAirports: true });

      for (const measured of [held, on]) {
        expect(measured.reachable).toBe(none.reachable);
        expect(measured.chips).toBe(none.chips);
        expect(measured.cities).toBe(200);
        expect(measured.markers).toBe(none.markers);
        expect(measured.markers).toBe(markers);
        expect(measured.tabStops).toBe(none.tabStops);
      }
      expect(none.cities).toBe(200);

      // And not vacuously. Two renders that both drew no layer would satisfy
      // every equality above while proving nothing, and that is a live risk
      // rather than a theoretical one: `none` passes no array at all, so its
      // count of marks is zero however the level behaves. The two claims that
      // carry the weight are therefore about `held` and `on` — the layer draws
      // when it is asked to, and only then.
      expect(held.airports).toBe(0);
      expect(on.airports).toBe(hasMap ? 2 : 0);
    }, 30_000);
  });
});
