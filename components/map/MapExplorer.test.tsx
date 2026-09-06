import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PROJECTION_PATH } from "@/lib/countryProjection";
import { GLOBE_TOPOLOGY_PATH } from "@/lib/globeTopology";
import { WORLD_TOPOLOGY_PATH } from "@/lib/isoTopology";
import { DEFAULT_PREFS } from "@/lib/prefs";
import {
  CHINA_TOPOLOGY_PATH,
  chip,
  deadCatalog,
  defaultFetch,
  Harness,
  installMapExplorerHarness,
  pendingUntilAbort,
  renderExplorer,
  settle,
  WORLD_FIXTURE,
} from "./mapExplorerHarness";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

installMapExplorerHarness();

function requested(path: string): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url) === path);
}

/**
 * What is asserted here is the coordination the component exists for: which
 * level is showing, that picking a country at the world level hands the code up
 * and drops back to the country level, and that a country with no detail level
 * costs no China assets — and, since Plan 6, the legend's own presence and
 * absence (`describe("the legend")` below). Layout and tint stay visual.
 */

describe("MapExplorer", () => {
  test("carries a world-level pick down into that country's level", async () => {
    render(<Harness level="world" />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Japan/ }));

    // Japan's own admin-1 file draws in the same shell China's does, with the
    // place list beneath it — and with no cities in this harness, the list says
    // so rather than repeating the "no map yet" line it carried for 245
    // countries before PR4.
    await settle();
    expect(screen.getByRole("group", { name: "Map of Japan" })).toBeInTheDocument();
    expect(screen.getByText(/No places in Japan yet/)).toBeInTheDocument();
    // And the world level is gone: the two levels never render at once.
    // Either renderer's group is named "… — pick a country", so this covers
    // both the flat map and the globe regardless of which one was active.
    expect(screen.queryByRole("group", { name: /pick a country/ })).not.toBeInTheDocument();
  });

  test("goes back to the country level without changing the country", async () => {
    // Up from the country first: the way back is offered only to someone who
    // has been down there (see the cold-start test below).
    render(<Harness />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: "← All countries" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "← Back to China" }));

    await settle();
    expect(
      screen.getByRole("group", { name: "Map of China" })
    ).toBeInTheDocument();
  });

  test("a cold start on the world level offers no way back to a country never opened", async () => {
    // The destinations step opens here now. "← Back to China" on a screen the
    // planner has not left would assert a history that has not happened; the
    // globe and the A–Z list are the ways forward, and the control appears
    // once a country has actually been shown.
    render(<Harness level="world" />);

    await settle();
    expect(screen.getByRole("group", { name: /pick a country/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^← Back to/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Japan/ }));
    await settle();
    expect(screen.getByRole("group", { name: "Map of Japan" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← All countries" }));
    await settle();
    expect(screen.getByRole("button", { name: "← Back to Japan" })).toBeInTheDocument();
  });

  test("buys no China assets for a country that cannot use them", async () => {
    render(<Harness country="JP" />);

    await settle();
    expect(screen.getByRole("group", { name: "Map of Japan" })).toBeInTheDocument();
    expect(requested(CHINA_TOPOLOGY_PATH)).toBe(false);
    // The city catalog is still asked about — every country has one now — but
    // it is asked about for Japan, not for China.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      "/api/map/cities?country=JP"
    );
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  /**
   * C5's 44px minimum. Roughly thirty components across the tree apply
   * `min-h-[var(--tap-min)]`; MapExplorer's own controls were written with
   * `py-1`/`py-1.5` instead, which lands them near 24px. Every one of them is
   * the only way out of the state it appears in — the back-out, the zoom-out
   * and the retry — so they are the worst ones to make hard to hit.
   *
   * WorldMap's country dots are deliberately exempt and stay so: its docblock
   * records that the A–Z list, not the circle, is the target that meets the
   * token.
   */
  test("gives its back-out control the C5 tap target its siblings apply", async () => {
    render(<Harness />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: "← All countries" }));
    await settle();
    expect(screen.getByRole("button", { name: "← Back to China" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("gives its zoom-out control the C5 tap target", async () => {
    render(<Harness />);

    await settle();
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom to a province" }), {
      target: { value: "CN+01" },
    });

    await settle();
    expect(screen.getByRole("button", { name: "← All China" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("gives its retry control the C5 tap target", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === CHINA_TOPOLOGY_PATH
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ ok: true, status: 200, json: async () => WORLD_FIXTURE })
      )
    );
    render(<Harness />);

    await settle();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("fetches the world topology only once the world level is open", async () => {
    // Pinned to the flat map: the globe is the default renderer since Task
    // 12, and this test is specifically about WorldMap's own lazy-fetch
    // behaviour, not about which renderer a bare `Harness` resolves to today
    // — that is `renders the globe by default`, below.
    const flatPrefs = { ...DEFAULT_PREFS, worldView: "flat" as const };
    const { unmount } = render(<Harness prefs={flatPrefs} />);

    await settle();
    screen.getByRole("group", { name: "Map of China" });
    expect(requested("/world-countries.json")).toBe(false);
    unmount();

    render(<Harness level="world" prefs={flatPrefs} />);
    // The mock hands the renderer back synchronously, so mounting it — and
    // the fetch it starts — is all inside settle()'s reach.
    await settle();
    screen.getByRole("group", { name: /World map/ });
    expect(requested("/world-countries.json")).toBe(true);
  });

  test("renders the globe by default", async () => {
    render(<Harness level="world" />);
    await settle();
    screen.getByRole("group", { name: /World globe/ });
    // The globe fetches its own asset; the flat map fetches world-countries.json.
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(GLOBE_TOPOLOGY_PATH);
  });

  test("renders the flat map when the user has chosen it", async () => {
    render(<Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "flat" }} />);
    await settle();
    screen.getByRole("group", { name: /World map/ });
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(WORLD_TOPOLOGY_PATH);
  });

  test("shows the toggle to switch renderers when reduced motion is not active (globe is default)", async () => {
    // Diagnostic test: verifies the toggle exists with the correct label
    // for the default globe state. Hard-coding the toggle to never render
    // must fail this test.
    render(<Harness level="world" />);
    await settle();
    screen.getByRole("group", { name: /World globe/ });

    // Toggle should be present and offer to switch to flat map
    expect(screen.getByRole("button", { name: "Show a flat map" })).toBeInTheDocument();
  });

  test("shows the toggle with correct label when the user has chosen the flat map", async () => {
    // Verifies the toggle label changes based on the current renderer state
    render(
      <Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "flat" }} />
    );
    await settle();
    screen.getByRole("group", { name: /World map/ });

    // Toggle should be present and offer to switch to globe
    expect(screen.getByRole("button", { name: "Show the globe" })).toBeInTheDocument();
  });

  test("falls back to the flat map under prefers-reduced-motion", async () => {
    // An explicit globe preference loses to the system request, and the toggle
    // that would re-offer it is withdrawn rather than left lying.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    render(<Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "globe" }} />);
    await settle();
    screen.getByRole("group", { name: /World map/ });

    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(WORLD_TOPOLOGY_PATH);
    expect(screen.queryByRole("button", { name: /flat map|globe/i })).not.toBeInTheDocument();
  });

  test("loads the open country's shard, not China's", async () => {
    render(<Harness country="PE" />);

    await settle();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/cities/PE.json");
    expect(urls).toContain("/api/map/cities?country=PE");
    expect(urls).not.toContain(CHINA_TOPOLOGY_PATH);
  });

  test("draws Peruvian cities in the country level's place list", async () => {
    // The list beside Peru's map, which is the accessibility spine (§5.2)
    // and which was empty outside China before this phase.
    render(<Harness country="PE" />);

    await settle();
    expect(chip(/Lima/)).toBeInTheDocument();
    expect(chip(/Cusco/)).toBeInTheDocument();
  });

  test("names the open country instead of printing its ISO code", async () => {
    // The defect, and it was invisible to every data-layer test: `getCountry`
    // fell back to the bare code for 222 of the 246 countries this map opens,
    // so the pane's heading read "GA". Gabon has no curated row, no catalog and
    // no shard here — the emptiest country there is — and it still has a name.
    render(<Harness country="GA" />);
    await settle();

    // Two headings carry it: the pane's own (h3) and the place list's (h4).
    expect(screen.getByRole("heading", { level: 3, name: "Gabon" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Gabon" })).toBeInTheDocument();
    // The negative is armed by the positives above: a pane that rendered
    // nothing at all would satisfy this line on its own.
    expect(screen.queryByRole("heading", { name: "GA" })).not.toBeInTheDocument();
    // And the country's name reaches the copy beside the heading, not just the
    // heading — this sentence read "No map for GA yet".
    expect(screen.getByText(/No places in Gabon yet/)).toBeInTheDocument();
  });

  test("the world level's way back names the country too", async () => {
    render(<Harness country="GA" />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "← All countries" }));
    await settle();
    expect(screen.getByRole("button", { name: "← Back to Gabon" })).toBeInTheDocument();
  });

  test("a curated country keeps its editorial name, not the artifact's", async () => {
    // The arming case for the whole change: the ingested table must not be
    // allowed to rename the 24 countries a human wrote down. Wikidata calls
    // this one "People's Republic of China".
    render(<Harness country="CN" />);
    await settle();
    expect(document.body.textContent).toContain("China");
    expect(document.body.textContent).not.toContain("People's Republic of China");
  });

  test("a tap on a shard city resolves and is added under its GeoNames id", async () => {
    // The half of the acceptance test the client owns. `togglePlace` re-looks
    // the tapped place up in the `cities` state array and silently drops the
    // add on a miss, so this fails the moment shard cities stop being merged
    // into that array.
    const onAddCatalog = vi.fn();
    render(<Harness country="PE" onAddCatalog={onAddCatalog} />);

    await settle();
    fireEvent.click(chip(/Cusco/));

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toEqual({
      qid: "G3941584",
      name: "Cusco",
      localName: null,
      province: "Cuzco Department",
      description: "Cusco is a city in southeastern Peru, near the Sacred Valley.",
      population: 428_450,
      attractionCount: 0,
    });

    // Lima has no entry in the enrichment fixture, so its blurb stays null:
    // the merge is keyed by id rather than applied to whatever the file held.
    // Its admin-1 and population are its own too, not Cusco's.
    fireEvent.click(chip(/Lima/));
    expect(onAddCatalog.mock.calls[1][0]).toEqual({
      qid: "G3936456",
      name: "Lima",
      localName: null,
      province: "Lima Province",
      description: null,
      population: 7_737_002,
      attractionCount: 0,
    });
  });

  test("refetches when the country changes between two foreign countries", async () => {
    // The trap: the cities effect was keyed on `hasDetail`, a boolean, so
    // PE → DE would not have refired it and Peru's cities would have stayed on
    // a German map. Both directions are asserted — Germany's city arrives AND
    // Peru's are gone — because either alone passes for the wrong reason: an
    // empty map passes "Cusco is gone" even if the shard leg died outright.
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(chip(/Cusco/)).toBeInTheDocument();

    rerender(<Harness country="DE" />);
    await settle();

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("/cities/DE.json");
    expect(chip(/Berlin/)).toBeInTheDocument();
    // Neither control, not merely neither chip: a marker left over from the
    // country the user just closed is exactly the bug this guards.
    expect(screen.queryAllByRole("button", { name: /Cusco/ })).toHaveLength(0);
  });

  test("drops the previous country's cities on the switch, not when the new ones land", async () => {
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(chip(/Cusco/)).toBeInTheDocument();

    // Germany's legs never answer, so everything on screen from here is what
    // the switch itself did — the only way to observe the window between a
    // country change and the new data landing. A marker from the country you
    // just left is a wrong answer, not a stale one.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    rerender(<Harness country="DE" />);
    await settle();

    expect(screen.queryAllByRole("button", { name: /Cusco/ })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /Lima/ })).toHaveLength(0);
    expect(screen.getByText(/No map for Germany yet/)).toBeInTheDocument();
  });

  test("earns the unavailable notice, then drops it the moment the country changes", async () => {
    // The one combination that earns the notice: the Wikidata catalog reports
    // itself down AND the country has no shard to fall back on. A country the
    // catalog simply has nothing for — the normal case for 245 of them — is
    // covered by `buys no China assets`, which asserts the notice stays away.
    vi.stubGlobal("fetch", vi.fn(deadCatalog));
    const { rerender } = render(<Harness country="AQ" />);
    await settle();
    expect(screen.getByText(/city list is unavailable/)).toBeInTheDocument();

    // The next country's legs never answer, so the notice can only go because
    // the switch itself cleared it. A stale "unavailable" is a claim about the
    // country you just left, made about the one you just opened.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    rerender(<Harness country="DE" />);
    await settle();

    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  test("never lets an aborted country's answer land on the country that replaced it", async () => {
    // All six legs swallow their own rejection, so an abort resolves
    // the combined promise instead of rejecting it. Without a check on the
    // signal before the write, Peru's effect lands Peru's answer — cities
    // emptied, "unavailable" set — on top of Germany's freshly cleared state,
    // one microtask after the switch.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) =>
        String(url).startsWith("/api/map/airports")
          ? Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [] }) })
          : pendingUntilAbort(init)
      )
    );
    const { rerender } = render(<Harness country="PE" />);
    await settle();

    rerender(<Harness country="DE" />);
    // Two settles: the abort's rejection travels through three `catch`es and a
    // `Promise.all` before the stale write would land, which is a longer
    // microtask chain than one settle's fixed-point loop is guaranteed to
    // drain — and a test that must observe a write *not* happening has to
    // out-wait it rather than beat it.
    await settle();
    await settle();

    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  /**
   * China is the only country where both legs of the merge answer, so it is the
   * only country where any of this is observable. Every other test in this file
   * runs against an empty `/api/map/cities`, which is why the catalog spread,
   * the curated-name suppression and the duplicate filter all needed a CN
   * fixture before a mutation to any of them could fail anything.
   *
   * These used to zoom into Central China first, because `ChinaLevel` drew
   * curated picks alone until a region was open. `CountryLevel` draws every
   * city it has from the country level, so the zoom was scaffolding for a
   * renderer that no longer exists and the merge is observable directly.
   */
  async function openChina() {
    const rendered = render(<Harness country="CN" />);
    await settle();
    return rendered;
  }

  /**
   * Markers named `name`, and never the list's chips.
   *
   * `getAllByRole("button", { name })` used to mean "markers" on this surface
   * because `ChinaLevel` was the whole of it. `CountryLevel` renders
   * `CountryPlaceList` beside the map (§5.2), and a chip is a button with the
   * same accessible name — so the unscoped query now counts one place twice
   * wherever the list happens to show it, which depends on `cityProvince` and
   * the per-group cap rather than on anything the merge does.
   */
  function markersNamed(container: HTMLElement, name: string): Element[] {
    return [
      ...container.querySelectorAll(`[data-markers] [data-place][aria-label="${name}"]`),
    ];
  }

  test("draws one marker for a city both legs answer with", async () => {
    // Jingzhou is in the shard at 30.35028,112.19028 and in the catalog at
    // 30.324444444,112.236111111 — 5.3 km apart, the same city twice. Drawn
    // twice it is two `role="button"`s a screen reader reads as two cities, two
    // ids `togglePlace` resolves separately, and a plan that spends days in
    // Jingzhou twice with a 5 km leg between the copies.
    await openChina();

    expect(screen.getAllByRole("button", { name: "Jingzhou" })).toHaveLength(1);
  });

  test("keeps the surviving Jingzhou's QID, not the GeoNames row's id", async () => {
    // Which of the two is dropped matters: the catalog row carries the QID that
    // `resolveDestinations` sends down the Wikidata branch, plus the attraction
    // count and blurb the GeoNames row has none of.
    const onAddCatalog = vi.fn();
    render(<Harness country="CN" onAddCatalog={onAddCatalog} />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Jingzhou" }));

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toEqual({
      qid: "Q71247",
      name: "Jingzhou",
      localName: "荆州市",
      province: "Hubei",
      description: "Jingzhou is a prefecture-level city in southern Hubei province, China.",
      population: 5_231_180,
      attractionCount: 3,
    });
  });

  test("keeps both of two distant cities that share a name", async () => {
    // The overcorrection guard. Hunan's Heshan and the catalog's Heshan in
    // Laibin, Guangxi are 631.3 km apart — a shared romanisation, not a
    // duplicate — so a filter keyed on the name alone would delete a real city
    // from the map. In the committed data 32 of the 51 shard rows that share a
    // folded name with a catalog city are distinct places like these, the
    // widest being the two Yushus at 2,852 km.
    const { container } = await openChina();

    expect(markersNamed(container, "Heshan")).toHaveLength(2);
  });

  test("draws a catalog city the shard has no row for", async () => {
    // The other half of the merge. Wuhan comes only from /api/map/cities, so
    // dropping the catalog spread loses it — and every other test in this file
    // answers that endpoint with an empty list, which is what made the spread
    // deletable without failing anything.
    await openChina();

    expect(screen.getByRole("button", { name: "Wuhan" })).toBeInTheDocument();
  });

  test("offers a place the curated set already covers once, as the curated card", async () => {
    // `curatedPlaceNames` folds, so the shard's capitalised "Zhangjiajie" only
    // matches through `foldPlaceName` — and the curated "Zhangjiajie" marker is
    // already on this map, so an unsuppressed shard row draws a second one
    // under the same aria-label. Enshi is asserted in the same test because a
    // shard leg deleted outright would otherwise pass this on its own.
    const onToggleSelect = vi.fn();
    const { container } = render(<Harness country="CN" onToggleSelect={onToggleSelect} />);
    await settle();

    expect(markersNamed(container, "Zhangjiajie")).toHaveLength(1);
    expect(markersNamed(container, "Enshi")).toHaveLength(1);

    // And the one that survived is the curated card, which reports through
    // `onToggleSelect`; a catalog marker would have gone to `onAddCatalog`.
    fireEvent.click(markersNamed(container, "Zhangjiajie")[0] as Element);
    expect(onToggleSelect).toHaveBeenCalledWith("zhangjiajie");
  });

  test("hands the file it fetched to the level that draws it", async () => {
    // The state was written and read by nobody for one commit, which is a
    // shape no other test here can see: every assertion above passes just as
    // well against a component that fetches Peru's geometry and drops it.
    render(<Harness country="PE" />);
    await settle();

    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    // The unit the fixture ships, drawn and marked selectable.
    expect(document.querySelector('[data-unit="PE+00"]')).not.toBeNull();
  });

  test("frames the map with the manifest it fetched, not with a fit", async () => {
    // Fetched in the SAME `Promise.all` as the geometry, not in an effect of
    // its own: the level falls back to a fit when it has no entry, so a
    // manifest landing one render later would frame every country twice — and
    // for the nine trimmed countries the first of those two frames shows the
    // island the trim exists to leave out.
    //
    // The entry here deliberately frames a box 10° away from the country, so
    // geometry drawn through it lands outside the viewBox. Nothing else can
    // tell an entry that reached the projection from one that was fetched and
    // dropped: a lookup that missed — the wrong case, the wrong key — falls
    // back to a fit, which draws this same square filling the frame.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const href = String(url);
        urls.push(href);
        return href === PROJECTION_PATH
          ? Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                PE: {
                  rotate: 0,
                  bounds: [
                    [10, 10],
                    [11, 11],
                  ],
                  scale: 34_377.468,
                },
              }),
            })
          : defaultFetch(href);
      })
    );

    render(<Harness country="PE" />);
    await settle();

    expect(urls).toContain(PROJECTION_PATH);
    const d = document.querySelector('[data-unit="PE+00"]')?.getAttribute("d") ?? "";
    const coordinates = (d.match(/-?[\d.]+/g) ?? []).map(Number);
    expect(coordinates.length).toBeGreaterThan(0);
    expect(Math.min(...coordinates)).toBeLessThan(0);
  });

  test("keeps working for a country whose shard 404s", async () => {
    render(<Harness country="JP" />);

    await settle();
    // The level names the country and points at search, exactly as before.
    expect(screen.getByText(/No places in Japan yet/)).toBeInTheDocument();
    // A country with no shard is a country with no cities to offer, not an
    // outage: the catalog answered, so nothing is broken.
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });
});

describe("the arrival gateway anchors the suggested route (spec §10.3, D3)", () => {
  /** Shanghai Hongqiao, at the artifact's coordinates. */
  const SHA = {
    iata: "SHA",
    icao: "ZSSS",
    name: "Shanghai Hongqiao International Airport",
    municipality: "Shanghai",
    country: "CN",
    lat: 31.198104,
    lon: 121.33426,
    size: "large" as const,
  };

  test("without an arrival, Beijing leads; anchored at Hongqiao, Shanghai does", async () => {
    // Beijing and Shanghai alone have exactly two tours, and the unanchored
    // search picks the lower id: "beijing". The anchor has to flip it.
    const unanchored = await renderExplorer({ selected: ["beijing", "shanghai"], country: "CN" });
    const first = () => within(screen.getByRole("list", { name: /suggested route/i })).getAllByRole("listitem")[0];
    expect(first()).toHaveTextContent("1. Beijing");
    unanchored.unmount();

    await renderExplorer({
      selected: ["beijing", "shanghai"],
      country: "CN",
      arrival: { iata: "SHA", airport: SHA },
    });
    expect(first()).toHaveTextContent("1. Shanghai");
    expect(screen.getByText(/starts near SHA/i)).toBeInTheDocument();
  });

  test("a bare code with no airport behind it does not anchor", async () => {
    await renderExplorer({
      selected: ["beijing", "shanghai"],
      country: "CN",
      arrival: { iata: "SHA", airport: null },
    });
    const first = within(screen.getByRole("list", { name: /suggested route/i })).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("1. Beijing");
  });

  test("the picker in the route panel reports the traveller's choice upward", async () => {
    const onArrivalChange = vi.fn();
    // Seeded with a real code, not the field's default empty string: React's
    // input value tracker treats a "change" to the value already on the node
    // as no change at all and never fires onChange, so clearing from "" would
    // dispatch nothing and the assertion would fail with zero calls. The seed
    // makes the clear a real transition, so what this test measures is the
    // wiring rather than jsdom — the same reason AirportPicker.test.tsx's own
    // "clearing the text is none" starts from value="LIM" rather than null.
    await renderExplorer({
      selected: ["beijing", "shanghai"],
      country: "CN",
      arrival: { iata: "SHA", airport: null },
      onArrivalChange,
    });
    fireEvent.change(screen.getByLabelText("Flying into"), { target: { value: "" } });
    // Two arguments now: the pick, and the raw text behind it. The wizard
    // ignores the second (its handler takes one parameter), but the report is
    // the same one GatewaysStrip reads to tell "cleared" from "typed
    // something that is not an airport".
    expect(onArrivalChange).toHaveBeenLastCalledWith(null, "");
  });
});
