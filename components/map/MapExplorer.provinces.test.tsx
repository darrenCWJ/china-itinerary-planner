// First, before any import that could reach `next/dynamic`: the harness
// registers that mock, and vitest hoists a mock only above the imports of the
// file that declares it.
import {
  CHINA_TOPOLOGY_PATH,
  chip,
  defaultFetch,
  Harness,
  installMapExplorerHarness,
  pendingUntilAbort,
  settle,
} from "@/test/mapExplorerHarness";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { COUNTRY_DETAIL, hasDetailLevel } from "@/lib/countryDetail";
import { PROJECTION_PATH } from "@/lib/countryProjection";
import { PE_TOPOLOGY } from "./countryFixture";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

installMapExplorerHarness();

/**
 * The open country's own admin-1 geometry (spec §5.1).
 *
 * `/china-provinces.json` was the only topology any country could open, so 245
 * of them opened none — the registry says every country has a file, and this is
 * the fetch that goes and gets it. What these cases pin is the loading half —
 * which URL is asked for, how often, what happens to the one already in flight,
 * and that a country whose file never arrives still reaches every one of its
 * cities. How the result is drawn is `CountryLevel.test.tsx`'s; that the result
 * reaches a renderer at all is pinned here, because nothing else would notice
 * a component holding geometry it never passes on.
 */
describe("the open country's province file", () => {
  test("fetches the opened country's province file, not China's", async () => {
    render(<Harness country="PE" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/provinces/PE.json");
    // Both negatives matter and they are different assets: the curated
    // topology is China's hand-built one, and `/provinces/CN.json` is the
    // build's re-envelope of it. Peru has no use for either.
    expect(urls).not.toContain(CHINA_TOPOLOGY_PATH);
    expect(urls).not.toContain("/provinces/CN.json");
  });

  test("asks for no file for a country the build wrote none for", async () => {
    // AQ, BV, HM and XD have no admin-1 geometry at all. `hasDetailLevel` is
    // what keeps a guaranteed 404 off the wire, and it is the only thing that
    // does — `provincePath("AQ")` is a perfectly well-formed URL.
    render(<Harness country="AQ" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith("/provinces/"))).toBe(false);
    // Armed: the country was genuinely opened, so the absence above is a
    // decision rather than a component that never mounted.
    expect(urls).toContain("/api/map/cities?country=AQ");
  });

  test("still emits the file for those countries, so the loader needs no special case", async () => {
    // §6.6 D10 suppresses the region CONTROL, never the map. All 34 countries
    // with one selectable unit are in the registry — `lib/countryDetail.test.ts`
    // pins that every entry has a file and every file has an entry — so this
    // loader asks for their geometry exactly as it asks for Peru's, and the
    // gate lives where the affordance is drawn instead.
    //
    // A gate placed HERE would read as the tidier fix and would cost the
    // Faroes their coastline to spare them a control they were never offered.
    // §5.2 makes the map an enhancement over the list; it does not make it
    // optional for 34 countries.
    const single = [...COUNTRY_DETAIL].filter(([, detail]) => detail.count <= 1);
    expect(single).toHaveLength(34);
    for (const [code] of single) expect(hasDetailLevel(code), code).toBe(true);

    render(<Harness country="FO" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/provinces/FO.json");
    // And it reached a renderer: the country level draws the file it fetched,
    // which is the half a fetch assertion on its own cannot see.
    expect(screen.getByRole("group", { name: "Map of Faroe Islands" })).toBeInTheDocument();
  });

  test("does not refetch when the country has not changed", async () => {
    // The largest file in the artifact is Canada's at 139 KB gzipped, and one
    // is fetched on every map open — so an effect that refires on an unrelated
    // re-render is not a wasted microtask, it is a wasted download.
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    rerender(<Harness country="PE" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u === "/provinces/PE.json")).toHaveLength(1);
  });

  test("aborts an in-flight fetch when the user opens another country", async () => {
    // The effect's existing AbortController has to reach the new leg too. It
    // is observed through the signal the fetch was handed rather than through
    // the DOM, because the failure this guards is a *silent* one: Peru's
    // geometry landing under Germany looks like a map, not like an error.
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        const href = String(url);
        if (href.startsWith("/provinces/")) {
          if (init?.signal) signals.push(init.signal);
          return pendingUntilAbort(init);
        }
        if (href.startsWith("/api/map/cities")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ available: true, cities: [] }),
          });
        }
        if (href.startsWith("/api/map/airports")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [] }) });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      })
    );

    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    rerender(<Harness country="DE" />);
    await settle();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    // The replacement is live, not aborted with it — a cleanup that tore down
    // the new controller would pass the line above and break the map.
    expect(signals[1].aborted).toBe(false);
  });

  test("renders the list alone when the province fetch fails", async () => {
    // §5.2: the map is the enhancement, the list is the spine. A 500 on the
    // geometry must not reach `loadError`, which replaces the whole pane with
    // a retry button and takes every city with it.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url);
        return href.startsWith("/provinces/")
          ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
          : defaultFetch(href);
      })
    );

    render(<Harness country="PE" />);
    await settle();

    expect(screen.getByRole("button", { name: /Lima/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    // Nor is a missing map an outage of the city catalog, which answered.
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  test("China fetches its province file and manifest, like every other country", async () => {
    // The inversion of what this used to assert. China's geometry came from
    // `/china-provinces.json` and from nothing else, and fetching
    // `/provinces/CN.json` was called out here as "68 KB for a map that never
    // draws it". That file is now the map: §6.3 always specified it as a
    // re-envelope of the same curated shapes, and China reads it through the
    // same code as Peru.
    render(<Harness country="CN" />);
    await settle();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/provinces/CN.json");
    // And the manifest, which China used to skip because `ChinaLevel` fitted
    // itself to the curated provinces.
    expect(urls).toContain(PROJECTION_PATH);
    // The asset that renderer read is not fetched by anyone any more.
    expect(urls).not.toContain("/china-provinces.json");
    expect(screen.getByRole("group", { name: "Map of China" })).toBeInTheDocument();
  });
});

/**
 * §6.1's chrome, taken off China.
 *
 * Every region affordance this component draws was gated on `hasCurated`, so
 * the other 245 countries got a bare header with no way in and no way out of a
 * province: the zoom existed inside `CountryLevel` from Task 4 and nothing on
 * screen could reach it. What is asserted here is the coordination — which
 * control is offered in which of the two machines' states, what it moves, and
 * that China's own chrome came through the generalisation untouched.
 *
 * How the zoom is DRAWN is `CountryLevel.test.tsx`'s; that a control here
 * reaches it at all is pinned below, because nothing else would notice a
 * `<select>` wired to state no renderer ever receives.
 */
describe("the province level's chrome", () => {
  /**
   * Peru with something to choose between — the shared four-unit fixture,
   * three selectable and one `sel: 0`, served where `provinceFixture` serves
   * its single square. §6.6's gate makes that square a country with no region
   * control at all, which is the wrong country to test a region control in.
   *
   * `cityProvince` names the two ids `PE_SHARD` actually ships, in two
   * different units, so a zoom is observable as the markers it stops drawing
   * rather than only as a transform nobody can see.
   */
  const PE_ZOOMABLE = {
    country: "PE",
    generatedAt: "2026-08-30T00:00:00.000Z",
    idKey: "adm1_code",
    topology: PE_TOPOLOGY,
    cityProvince: { G3936456: "PE-LIM", G3941584: "PE-CUS" },
  };

  /**
   * The manifest answers for nobody here, so `CountryLevel` falls back to a fit
   * over its own units. `PROJECTION_FIXTURE` frames a one-degree square at the
   * origin and this fixture lives at 78°W — framed by that entry every marker
   * would be projected off the viewBox, which is a rendering nothing asserted
   * below is about and a confusing thing to leave true.
   */
  function zoomableFetch(url: string) {
    const href = String(url);
    if (href === "/provinces/PE.json") {
      return Promise.resolve({ ok: true, status: 200, json: async () => PE_ZOOMABLE });
    }
    if (href === PROJECTION_PATH) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return defaultFetch(href);
  }

  beforeEach(() => {
    fetchMock = vi.fn(zoomableFetch);
    vi.stubGlobal("fetch", fetchMock);
  });

  /** The map's markers, by the name a screen reader gets — never the list's chips. */
  function markerNames(container: HTMLElement): string[] {
    return [...container.querySelectorAll("[data-markers] [data-place]")].map(
      (el) => el.getAttribute("aria-label") ?? ""
    );
  }

  function regionControl(): HTMLSelectElement {
    return screen.getByRole("combobox", { name: "Zoom to a province" }) as HTMLSelectElement;
  }

  test("a non-China country gets a region control", async () => {
    const { container } = render(<Harness country="PE" />);
    await settle();

    // The country's SELECTABLE units and no others. `PE-XXX` is real geometry
    // that shapes the outline without being a subdivision (§7.2), so it is
    // drawn and it is not a destination — offering it here would be the
    // Northern-Cyprus bug with a Peruvian name.
    //
    // In label order, and not the fixture's own order — which is Lima, Cuzco,
    // Isla Lejana, standing in for the `adm1_code` ascending a real file ships.
    // `lib/regionScheme.test.ts` holds the sort itself; what this pins is that
    // it survives the trip into the control, and that "All of Peru" stays at
    // the top of it, because it is the way out of the choice rather than one of
    // the choices.
    expect([...regionControl().querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "All of Peru",
      "Cuzco",
      "Isla Lejana",
      "Lima",
    ]);
    expect(markerNames(container).sort()).toEqual(["Cusco", "Lima"]);
    // C5's 44px minimum, which its sibling controls are each pinned to
    // separately in MapExplorer.test.tsx. This one is the only way into
    // a province, and it is the one control in the header that is not a
    // `STEP_UP_BUTTON` and so cannot inherit the token from that constant.
    expect(regionControl().className).toContain("min-h-[var(--tap-min)]");

    fireEvent.change(regionControl(), { target: { value: "PE-CUS" } });
    await settle();

    // It reaches the renderer, which is the half a control cannot prove about
    // itself: §6.5 draws the group's own cities and drops the rest.
    expect(markerNames(container)).toEqual(["Cusco"]);
    // And §5.2 is untouched — the map filters, the spine does not.
    expect(chip("Lima")).toBeInTheDocument();
  });

  test("the back path is level-aware: region -> country -> world", async () => {
    render(<Harness country="PE" />);
    await settle();

    // One rung is offered at a time, and which one is a question about BOTH
    // machines: the country level's step up is the world, a region's step up
    // is the country, and a control that read only `level` could not tell them
    // apart.
    expect(screen.getByRole("button", { name: "← All countries" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "← All Peru" })).toBeNull();

    fireEvent.change(regionControl(), { target: { value: "PE-CUS" } });
    await settle();
    expect(screen.getByRole("button", { name: "← All Peru" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "← All countries" })).toBeNull();

    // region -> country. The LEVEL machine does not move with it: the two are
    // independent, and a back control that folded the zoom into `MapLevel`
    // would land the user in the world picker from one press.
    fireEvent.click(screen.getByRole("button", { name: "← All Peru" }));
    await settle();
    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /pick a country/ })).toBeNull();
    expect(regionControl().value).toBe("");

    // country -> world, which is the level machine and only the level machine.
    fireEvent.click(screen.getByRole("button", { name: "← All countries" }));
    await settle();
    expect(screen.getByRole("group", { name: /pick a country/ })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Map of Peru" })).toBeNull();

    // And back down again, to the whole country rather than to a region the
    // user had already stepped out of.
    fireEvent.click(screen.getByRole("button", { name: "← Back to Peru" }));
    await settle();
    expect(regionControl().value).toBe("");
    expect(screen.getByRole("button", { name: "← All countries" })).toBeInTheDocument();
  });

  test("the caption names the zoomed region", async () => {
    render(<Harness country="PE" />);
    await settle();
    // Nothing to caption while the whole country is drawn: the map is showing
    // every city it has, so there is no absence to explain.
    expect(screen.queryByText(/Showing/)).toBeNull();

    fireEvent.change(regionControl(), { target: { value: "PE-CUS" } });
    await settle();

    // Named, and paired with where the cities it stopped drawing went. A zoom
    // that silently removes markers reads as a country with fewer cities in
    // it, which is the reading §5.2 exists to prevent.
    expect(
      screen.getByText("Showing Cuzco — the list below still reaches every city")
    ).toBeInTheDocument();
  });

  test("China gets the same chrome as everyone else", async () => {
    // This used to assert the opposite, under the name "China's chrome is
    // unchanged": no `<select>`, a "Click a region to zoom in" heading, and a
    // caption explaining that markers were curated picks until a region was
    // opened. All three were `ChinaLevel`'s, and all three are gone.
    //
    // What China gains is what it was missing: `regionSchemeFor` is now asked
    // about it, so it has a province control — and the heading is its own name,
    // because the map no longer needs an instruction to be usable.
    render(<Harness country="CN" />);
    await settle();

    expect(screen.getByRole("combobox", { name: "Zoom to a province" })).toBeInTheDocument();
    // Two of them: the country heading and `CountryPlaceList`'s own. Either
    // way the point is that neither is "Click a region to zoom in".
    expect(screen.getAllByRole("heading", { name: "China" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Click a region to zoom in" })).toBeNull();
    expect(
      screen.queryByText("Markers show curated picks — zoom into a region for every city")
    ).toBeNull();
  });
});
