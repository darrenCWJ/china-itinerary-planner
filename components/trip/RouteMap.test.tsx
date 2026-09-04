import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PROJECTION_PATH } from "@/lib/countryProjection";
import { provincePath } from "@/lib/provinceTopology";
import { DESTINATIONS } from "@/lib/data";
import type { DayPlan, TripPlan } from "@/lib/itinerary";
import type { Destination } from "@/lib/types";
import { fitForPlace, NEUTRAL_FIT } from "@/components/map/mapTypes";
import { RouteMap, routeDestinationIds, routeMonth, routePlaces, unresolvedStopIds } from "./RouteMap";

/**
 * Spec §2.1 justified removing Route from the nav by promising this view inside
 * Plan; for the whole of PR2 the branch rendered a placeholder instead. What is
 * testable without a browser is the derivation — which stops are drawn, in what
 * order, and which month the season fit is coloured against.
 *
 * PR4 adds a second half that a browser IS needed for. This surface was blank
 * for every worldwide trip on two counts, not one: its stops came from the
 * bundled curated set, which is sixteen Chinese cities, and its geometry came
 * from `/china-provinces.json` whatever country the trip was in. Both are
 * fetches now, and the block at the foot of this file is about what happens on
 * the wire — including for a guest, who reaches this page through a shared trip
 * link and has no session at all.
 */

const day = (n: number, destinationId: string): DayPlan => ({
  day: n,
  destinationId,
  destinationName: destinationId,
  items: [],
});

const plan = (days: DayPlan[]): TripPlan => ({ days, tips: [] }) as unknown as TripPlan;

/**
 * Cusco, in the shape `/api/destinations/resolve` answers with.
 *
 * Copied from `geoNamesCityToDestination`'s own output rather than invented:
 * the six fields the bundled GeoNames index carries, plus the empty season claim §9.6
 * leaves and the generic activities that function stamps on. `lib/server/catalog.test.ts` pins the
 * server half of the same value.
 */
const CUSCO: Destination = {
  id: "G3941584",
  name: "Cusco",
  localName: null,
  region: "Cuzco Department",
  country: "PE",
  lat: -13.53188,
  lon: -71.96701,
  emoji: "📍",
  tagline: "Cusco, Cuzco Department",
  knownFor: [],
  bestSeasons: [],
  seasonNotes: {},
  foods: [],
  suggestedDays: [1, 2],
  activities: [],
};

const PERU_TRIP = plan([day(1, "G3941584"), day(2, "G3941584")]);

describe("routeDestinationIds", () => {
  test("keeps day order and de-duplicates on first appearance", () => {
    const ids = routeDestinationIds(
      plan([day(1, "beijing"), day(2, "beijing"), day(3, "xian"), day(4, "beijing")])
    );
    expect(ids).toEqual(["beijing", "xian"]);
  });

  test("an empty plan yields no stops rather than throwing", () => {
    expect(routeDestinationIds(plan([]))).toEqual([]);
  });
});

describe("routePlaces", () => {
  test("draws the trip's curated stops in day order", () => {
    const places = routePlaces(plan([day(1, "xian"), day(2, "beijing")]));
    expect(places.map((p) => p.id)).toEqual(["xian", "beijing"]);
    for (const place of places) {
      expect(Number.isFinite(place.lat)).toBe(true);
      expect(Number.isFinite(place.lon)).toBe(true);
    }
  });

  test("drops a stop the curated set does not know", () => {
    // Catalog cities (Qxxxx) carry no bundled Destination, and off-map ids never
    // reach a saved plan at all. Both are absent rather than drawn at 0,0.
    const places = routePlaces(plan([day(1, "beijing"), day(2, "Q71284")]));
    expect(places.map((p) => p.id)).toEqual(["beijing"]);
  });

  test("carries the fields the map colours and labels with", () => {
    const [place] = routePlaces(plan([day(1, "beijing")]));
    const source = DESTINATIONS.find((d) => d.id === "beijing")!;
    expect(place).toMatchObject({
      kind: "curated",
      name: source.name,
      region: source.region,
      attractionCount: source.activities.length,
    });
  });
});

describe("routeMonth", () => {
  test("a start date is the fact", () => {
    expect(routeMonth("2026-11-03", "summer", "CN")).toBe(11);
  });

  test("falls back to a month the country's own profile calls that season", () => {
    expect(routeMonth(null, "winter", "CN")).toBe(1);
  });

  test("the fallback is hemisphere-aware, not a northern table", () => {
    // Southern seasons are inverted, and the loop takes the first matching
    // month: January is summer in Australia and June is winter. A northern
    // table would answer 6 and 12.
    expect(routeMonth(null, "summer", "AU")).toBe(1);
    expect(routeMonth(null, "winter", "AU")).toBe(6);
    expect(routeMonth(null, "summer", "CN")).toBe(6);
    expect(routeMonth(null, "winter", "CN")).toBe(1);
  });

  test("a malformed start date falls through rather than producing NaN", () => {
    expect(routeMonth("not-a-date", "winter", "CN")).toBe(1);
  });
});

describe("unresolvedStopIds", () => {
  test("names only the stops the bundled curated set cannot describe", () => {
    expect(unresolvedStopIds(plan([day(1, "beijing"), day(2, "G3941584")]))).toEqual(["G3941584"]);
  });

  test("a wholly curated trip needs no resolve call at all", () => {
    expect(unresolvedStopIds(plan([day(1, "beijing"), day(2, "xian")]))).toEqual([]);
  });

  test("stops at the ceiling `/api/destinations/resolve` silently slices to", () => {
    // The route takes 12 and drops the rest without saying so. Asking for
    // exactly what it will answer keeps the truncation here, where the
    // docblock can name it, rather than on the wire where nothing sees it.
    const days = Array.from({ length: 20 }, (_, i) => day(i + 1, `G${1000 + i}`));
    expect(unresolvedStopIds(plan(days))).toHaveLength(12);
  });
});

describe("routePlaces with resolved stops", () => {
  test("draws a catalog stop the curated set has never heard of", () => {
    const places = routePlaces(plan([day(1, "G3941584")]), [CUSCO]);
    expect(places.map((p) => p.id)).toEqual(["G3941584"]);
    expect(places[0]).toMatchObject({ name: "Cusco", lat: CUSCO.lat, lon: CUSCO.lon });
  });

  test("keeps day order when curated and resolved stops are mixed", () => {
    const places = routePlaces(plan([day(1, "G3941584"), day(2, "beijing")]), [CUSCO]);
    expect(places.map((p) => p.id)).toEqual(["G3941584", "beijing"]);
  });

  test("a resolved stop with no coordinates is still not drawn", () => {
    const offMap = { ...CUSCO, id: "offmap:grandmas-village", lat: null, lon: null };
    expect(routePlaces(plan([day(1, offMap.id)]), [offMap])).toEqual([]);
  });

  test("a resolved stop carries no season claim, so its verdict is the artifact's or nothing", () => {
    // Before §9.6 every resolved stop was `great` in April through the
    // stamp; the trip map coloured Sydney's autumn as a northern spring.
    const [place] = routePlaces(plan([day(1, "G3941584")]), [CUSCO]);
    expect(place.bestSeasons).toEqual([]);
    expect(fitForPlace(place, 4)).toBe(NEUTRAL_FIT);
  });
});

/**
 * Two admin-1 units, each wound clockwise in (lon, lat), together covering the
 * box Peru sits in — the western half and the eastern half Cusco is in.
 *
 * d3-geo reads rings spherically, so the anticlockwise version of either square
 * is the globe MINUS the square: `geoBounds` answers ±180 and every fit
 * collapses. `MapExplorer.test.tsx`'s fixture carries the same warning.
 *
 * **Two and not one, and that is load-bearing rather than decorative.**
 * `regionSchemeFor` returns NO groups for a country with a single selectable
 * unit (§6.6 D10: an admin-1 layer with nothing to divide is the national
 * outline drawn twice), so a one-unit Peru has nowhere to zoom and every
 * assertion about not zooming there is vacuously true. With two, this country
 * genuinely has a province level — the picker would put a `<select>` beside its
 * heading — and "the trip map does not offer one" becomes a fact about this
 * surface rather than about the fixture.
 *
 * `cityProvince` stays empty, as every committed fixture's does, which is also
 * what makes a wrong framing visible: §6.5 draws only the framed group's own
 * cities, and Cusco is assigned to neither half.
 */
/**
 * China's file in the shape the build writes it — `idKey: "adcode"`, Chinese
 * `name`, no `name_en`, and the nine-dash envelope as a `sel: 0` unit.
 *
 * Small and inline for the reason `PE_PROVINCES` is: the real
 * `public/provinces/CN.json` is 67 KB of geometry and nothing here reads a
 * shape. What this fixture has to be faithful about is the ENVELOPE, because
 * that is what changed — China used to be fetched as a bare TopoJSON from
 * `/china-provinces.json` and is now parsed through the same reader as
 * everyone else, which rejects a missing `idKey` or `sel`.
 */
const CN_PROVINCES = {
  country: "CN",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adcode",
  topology: {
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
            id: "110000",
            arcs: [[0]],
            properties: { name: "北京市", sel: 1 },
          },
          {
            // The nine-dash envelope: drawn, never a subdivision (§7.2).
            type: "Polygon",
            id: "100000_JD",
            arcs: [[1]],
            properties: { name: "南海诸岛", sel: 0 },
          },
        ],
      },
    },
  },
  cityProvince: {},
};

const PE_PROVINCES = {
  country: "PE",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adm1_code",
  topology: {
    type: "Topology",
    arcs: [
      [
        [-78, -18],
        [-78, -4],
        [-74, -4],
        [-74, -18],
        [-78, -18],
      ],
      [
        [-74, -18],
        [-74, -4],
        [-70, -4],
        [-70, -18],
        [-74, -18],
      ],
    ],
    objects: {
      provinces: {
        type: "GeometryCollection",
        geometries: [
          {
            type: "Polygon",
            id: "PE-AYA",
            arcs: [[0]],
            properties: {
              name: "Ayacucho",
              name_en: "Ayacucho",
              iso_3166_2: "PE-AYA",
              gn_a1_code: "PE.03",
              sel: 1,
            },
          },
          {
            // The half Cusco's own coordinates fall in — lon -71.97 — so a map
            // framed on this group draws the province the trip is in and still
            // drops the trip's stop, because nothing assigned it here.
            type: "Polygon",
            id: "PE-CUS",
            arcs: [[1]],
            properties: {
              name: "Cuzco",
              name_en: "Cuzco",
              iso_3166_2: "PE-CUS",
              gn_a1_code: "PE.08",
              sel: 1,
            },
          },
        ],
      },
    },
  },
  cityProvince: {},
};

/** The §5.4 entry framing that square. `scale` is recomputed from `bounds`. */
const PE_MANIFEST = {
  PE: {
    rotate: 0,
    bounds: [
      [-78, -18],
      [-70, -4],
    ],
    scale: 2469,
  },
};

function answer(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

/** Everything a signed-in member's trip page can ask for, answered. */
function tripFetch(url: string) {
  const href = String(url);
  if (href.startsWith("/api/destinations/resolve")) return answer({ destinations: [CUSCO] });
  if (href === "/provinces/PE.json") return answer(PE_PROVINCES);
  if (href === PROJECTION_PATH) return answer(PE_MANIFEST);
  return answer({}, 404);
}

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Install an answer table AND keep `requestedUrls()` pointed at it.
 *
 * `vi.stubGlobal("fetch", vi.fn(...))` on its own leaves `fetchMock` on the
 * previous spy, so a test that overrides the table and then asks what was
 * requested reads an empty call list and passes for the wrong reason.
 */
function stubFetch(answers: (url: string, init?: { signal?: AbortSignal }) => unknown) {
  fetchMock = vi.fn(answers);
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  stubFetch(tripFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Drain the effect chain — the same helper `MapExplorer.test.tsx` uses. */
async function settle(): Promise<void> {
  let previous = "";
  for (let i = 0; i < 10 && document.body.innerHTML !== previous; i++) {
    previous = document.body.innerHTML;
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function renderPeru() {
  return render(<RouteMap plan={PERU_TRIP} country="PE" startDate="2026-05-02" season="spring" />);
}

describe("the trip map draws the trip's own country", () => {
  test("draws a Peruvian trip's places on Peru, not on a blank pane", async () => {
    const { container } = renderPeru();
    await settle();

    // Geometry, not an empty state: an outline path exists and it was drawn
    // through Peru's own units.
    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    expect(container.querySelector("[data-outline]")).not.toBeNull();
    // And the trip's own stop is a marker on it, which it could never be while
    // `routePlaces` read the sixteen bundled Chinese destinations alone.
    expect(container.querySelector('[data-place="G3941584"]')).not.toBeNull();
    expect(screen.queryByText(/None of this trip/)).not.toBeInTheDocument();
  });

  test("fetches the trip's own country file rather than China's", async () => {
    renderPeru();
    await settle();

    const urls = requestedUrls();
    expect(urls).toContain("/provinces/PE.json");
    expect(urls).toContain(PROJECTION_PATH);
    expect(urls).not.toContain("/provinces/CN.json");
  });

  test("does not claim a trip has nothing to draw while its stops resolve", async () => {
    // The empty state is a CLAIM — "none of this trip's stops can be drawn" —
    // and it was true the instant this component mounted, before the resolve
    // call it now depends on had answered.
    stubFetch((url: string) =>
      String(url).startsWith("/api/destinations/resolve")
        ? new Promise(() => {})
        : tripFetch(String(url))
    );
    renderPeru();
    await settle();

    expect(screen.queryByText(/None of this trip/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("still renders for a guest, with no session", async () => {
    // The signed-out shape of the wire, whoever is looking at it. A signed-out
    // request for a static asset is redirected to /login by `lib/wall.ts`,
    // `fetch` follows the redirect, so `res.ok` is TRUE and `res.json()`
    // rejects on the login page's `<` — a failure mode no status check catches.
    //
    // §5.1 calls this a guest-reachable surface, and that is true of the page
    // and not of this component: `resolveTripAccess` answers `guest` without a
    // session and `TripView` renders `GuestTripView` for anything short of
    // `member`. The property is pinned anyway because losing it is silent —
    // `/api/destinations/resolve` reads no session and sits behind no wall, so
    // the stops resolve either way, and the geometry degrades to the same
    // list-only fallback a 500 gets.
    const loginPage = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      });
    stubFetch((url: string) => {
      const href = String(url);
      if (href.startsWith("/api/destinations/resolve")) return answer({ destinations: [CUSCO] });
      return loginPage();
    });

    renderPeru();
    await settle();

    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
    expect(screen.queryByText(/None of this trip/)).not.toBeInTheDocument();
  });

  test("asks for nothing that needs a session", async () => {
    renderPeru();
    await settle();

    for (const url of requestedUrls()) {
      // The two families a member has and a guest does not. Either one here
      // would 401 behind a shared link and take the map down with it.
      expect(url.startsWith("/api/me")).toBe(false);
      expect(url.startsWith("/api/trips")).toBe(false);
    }
    expect(requestedUrls().some((u) => u.startsWith("/api/destinations/resolve"))).toBe(true);
  });

  test("renders the places even when the province fetch fails", async () => {
    // §5.2: the map is the enhancement and the stops are the spine. A 500 on
    // the geometry costs the drawing, never the list of what is on the trip.
    stubFetch((url: string) =>
      String(url).startsWith("/provinces/") ? answer({}, 500) : tripFetch(String(url))
    );

    renderPeru();
    await settle();

    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
    expect(screen.queryByText(/None of this trip/)).not.toBeInTheDocument();
  });

  test("a China trip takes the same province path as every other country", async () => {
    // It used to take a path of its own — `/china-provinces.json`, the curated
    // asset, fetched under a `hasCuratedTopology` branch that existed nowhere
    // else. China now reads `/provinces/CN.json`, which §6.3 already specified
    // as a re-envelope of those same shapes, through the same code as Peru.
    //
    // A wholly curated trip still resolves nothing, so the resolve endpoint is
    // still not called: that half of the old assertion was never about China's
    // renderer and is kept.
    stubFetch((url: string) =>
      String(url) === provincePath("CN")
        ? answer(CN_PROVINCES)
        : String(url) === PROJECTION_PATH
          ? answer({ generatedAt: "2026-01-01T00:00:00.000Z", countries: {} })
          : answer({}, 404)
    );

    render(
      <RouteMap
        plan={plan([day(1, "beijing"), day(2, "xian")])}
        country="CN"
        startDate="2026-05-02"
        season="spring"
      />
    );
    await settle();

    const urls = requestedUrls();
    expect(urls).toContain(provincePath("CN"));
    expect(urls).not.toContain("/china-provinces.json");
    expect(urls.some((u) => u.startsWith("/api/destinations/resolve"))).toBe(false);
  });
});

/**
 * §2.1 makes this surface a VIEW of the itinerary — "a map ⇄ list toggle inside
 * Plan", not a sibling picker — and the component has always said so by passing
 * `noop` for the toggle.
 *
 * A noop is not a mode. Plan 3 gave `CountryLevel`'s markers a keyboard model, a
 * `role="button"` with `aria-pressed`, and a `role="dialog"` card whose primary
 * button reads "Remove <name> from trip"; wired to a noop, all of that still
 * renders and none of it does anything. The card is the sharp end: a user taps a
 * stop on a page a shared link is one component away from reaching, is offered a
 * destructive action by name, presses it, and the trip does not change.
 *
 * So the read-only mode is asserted from the outside, on the surface that has
 * it: the markers claim nothing they cannot do, and the stop list under the map
 * stays the spine it is everywhere else (§5.2).
 */
describe("the trip map is a view of the trip, not a picker", () => {
  test("its markers do not announce themselves as toggles", async () => {
    const { container } = renderPeru();
    await settle();

    const marker = container.querySelector('[data-place="G3941584"]')!;
    // A marker that says it is a pressable toggle and does nothing is worse
    // than one that says nothing at all — and one that is also a tab stop
    // spends a keyboard user's Tab on it to prove it.
    expect(marker.getAttribute("role")).toBeNull();
    expect(marker.getAttribute("aria-pressed")).toBeNull();
    expect(marker.getAttribute("aria-haspopup")).toBeNull();
    expect(marker.getAttribute("tabindex")).toBeNull();

    // One control for the stop, not two: the list chip below the map. The
    // marker was the second, and it was the inert one.
    expect(screen.getAllByRole("button", { name: /Cusco/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Cusco/ }).tagName).toBe("BUTTON");
  });

  test("tapping a stop offers no removal it cannot perform", async () => {
    const { container } = renderPeru();
    await settle();

    const marker = container.querySelector('[data-place="G3941584"]')!;
    fireEvent.click(marker);
    fireEvent.keyDown(marker, { key: "Enter" });

    // Neither modality opens §5.3.3's card here. Its primary button is named
    // for the place and for the direction — "Remove Cusco from trip" — and on
    // this surface there is nothing behind it.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Cusco from trip/ })).toBeNull();
    // The stop is still drawn and still named. Read-only is the map claiming
    // less, not the map showing less.
    expect(marker).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
  });

  /**
   * The province level's own version of the same statement — Plan 4's Task 10.
   *
   * `zoomRegion` used to be `ChinaRegion | null`, which made this surface's
   * `null` the only value it could carry outside China. Phase 4 widened it to
   * `RegionId` — `string` — so `null` stayed assignable, `tsc` stayed quiet,
   * and this call site is the one the widening could not point at. Everything
   * else that reads the prop is in `MapExplorer`, where the change is obvious;
   * here it is invisible, which is why it gets asserted rather than assumed.
   *
   * A known gap, seen and left alone: on the China branch `ChinaLevel` still
   * draws its seven provinces with `role="button"` and "Zoom into East China"
   * for a name, wired here to `noop`. That IS a control that cannot do
   * anything, and it is exactly what `readOnly` exists to suppress — but
   * `readOnly` is deliberately not spread into `ChinaLevel` (§9.5 freezes
   * China's rendered output for the whole of Phase 4, and `CountryMap` says so
   * at its own prop). Suppressing it is a change to a China render, so it
   * belongs to whoever lifts §9.5, not to this task.
   */
  test("the trip map does not offer a region zoom", async () => {
    const { container } = renderPeru();
    await settle();

    // The picker's two region affordances: a `<select>` labelled "Zoom to a
    // province", and the "← All Peru" step-up beside it. Both live in
    // `MapExplorer`, which this surface does not render — so what is pinned is
    // that neither arrived here by some other route.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText(/zoom to a province/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^←/ })).toBeNull();

    // And the half `zoomRegion={null}` decides on its own: the map is framed
    // on the whole country. A framed one filters its markers to the framed
    // group's own cities (§6.5), and `/provinces/PE.json` assigns Cusco to
    // none — so a trip map that had quietly acquired a region would draw a
    // trip with no stops on it, and would look like a working map doing it.
    expect(container.querySelector<SVGGElement>("[data-zoom]")!.style.transform).toBe(
      "translate(0px, 0px) scale(1)"
    );
    expect(container.querySelector('[data-place="G3941584"]')).not.toBeNull();
  });

  test("still renders with no airports of its own", async () => {
    // The second `CountryMap` caller, and the reason §10.2's new prop is
    // optional. `MapExplorer` fetches the open country's airports and threads
    // them down; this surface fetches nothing of the kind and never will — a
    // trip map is a drawing of a plan, and the "Main airport" line lives on a
    // card `readOnly` does not open. A required prop would break it at the
    // type level; one that arrived `undefined` would break it at the first
    // read.
    const { container } = renderPeru();
    await settle();

    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    expect(container.querySelector('[data-place="G3941584"]')).not.toBeNull();
    expect(container.querySelector("[data-main-airport]")).toBeNull();
    expect(requestedUrls().some((url) => url.startsWith("/api/map/airports"))).toBe(false);
  });

  test("passing null is deliberate and documented, not an unmigrated default", () => {
    // Read as text, because there is nothing else to read it with. `region`
    // defaults to null inside `CountryLevel`, so dropping the prop entirely
    // would leave every assertion above green and every render identical —
    // the failure this guards against is silent at runtime and silent at
    // compile time, and only the source says which of the two nulls it is.
    const source = readFileSync(join(process.cwd(), "components", "trip", "RouteMap.tsx"), "utf8");
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(stripped).toContain("zoomRegion={null}");

    // Stated, and stated adjacently: the contiguous comment lines directly
    // above it. Read off the raw source rather than the stripped copy for the
    // obvious reason, and split on `\r?\n` because this repo is checked out
    // with `core.autocrlf` on Windows.
    const lines = source.split(/\r?\n/);
    const at = lines.findIndex((line) => line.includes("zoomRegion={null}"));
    expect(at).toBeGreaterThan(0);
    const preamble: string[] = [];
    for (let i = at - 1; i >= 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[i]); i--) {
      preamble.unshift(lines[i]);
    }
    const prose = preamble.join(" ");
    // The two facts a reader needs and cannot recover from the line itself:
    // what the type became, and that this null is a choice rather than a
    // leftover.
    expect(prose).toMatch(/RegionId/);
    expect(prose).toMatch(/null/);
  });
});
