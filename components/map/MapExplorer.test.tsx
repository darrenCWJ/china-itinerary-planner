import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PrefsProvider } from "@/components/shell/PrefsProvider";
import { GLOBE_TOPOLOGY_PATH } from "@/lib/globeTopology";
import { WORLD_TOPOLOGY_PATH } from "@/lib/isoTopology";
import { DEFAULT_PREFS, PREFS_COOKIE, serializePrefsCookie, type UserPrefs } from "@/lib/prefs";
import { MapExplorer, type MapLevel } from "./MapExplorer";
import { fitForPlace, fitForRegion, type MapPlace } from "./mapTypes";

/**
 * What is asserted here is the coordination the component exists for: which
 * level is showing, that picking a country at the world level hands the code up
 * and drops back to the country level, and that a country with no detail level
 * costs no China assets. Layout, tint and the legend are visual.
 */

/**
 * Two countries is enough to prove a pick is carried; see WorldMap.test.tsx.
 *
 * Carries both `smallCountries` (WorldTopology's shape) and `points`
 * (GlobeTopology's shape, `lib/globeTopology.ts`) so the same fixture body —
 * this file's `fetchMock` returns it for any URL that isn't a China or
 * catalog endpoint — parses under whichever world-level renderer a test
 * exercises. `GlobeLevel.test.tsx` keeps its own richer, two-hemisphere
 * fixture for what it actually tests (rotation, clipping); this one only
 * needs to stay parseable.
 */
const WORLD_FIXTURE = {
  topology: {
    type: "Topology",
    arcs: [
      [
        [116, 39],
        [120, 39],
        [120, 43],
        [116, 43],
        [116, 39],
      ],
      [
        [136, 34],
        [140, 34],
        [140, 38],
        [136, 38],
        [136, 34],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "CN", arcs: [[0]], properties: { name: "China" } },
          { type: "Polygon", id: "JP", arcs: [[1]], properties: { name: "Japan" } },
        ],
      },
    },
  },
  smallCountries: [],
  points: [],
};

/** One province, so the China level has something to draw. */
const CHINA_FIXTURE = {
  type: "Topology",
  arcs: [
    [
      [116, 39.5],
      [117, 39.5],
      [117, 40.5],
      [116, 40.5],
      [116, 39.5],
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
      ],
    },
  },
};

const CHINA_TOPOLOGY_PATH = "/china-provinces.json";

/** A generic catalog place — the shape MapExplorer builds for a catalog city. */
const A_CATALOG_PLACE: MapPlace = {
  id: "some-catalog-qid",
  kind: "catalog",
  name: "Some City",
  localName: null,
  province: "Some Province",
  region: "East",
  lat: 30,
  lon: 120,
  population: 100_000,
  level: "prefecture",
  attractionCount: 2,
  blurb: null,
};
/**
 * MapExplorer pulls WorldMap in through `next/dynamic`: real code-splitting in
 * production, and a wall-clock dependency in tests. The module load plus
 * React.lazy's unwrap costs ~90ms cold on an idle machine, and it is the only
 * reason these tests ever needed a timeout budget at all. Under full-suite
 * parallel load it stretched past Testing Library's polling window and failed
 * as "Unable to find role=…" — which reads like a missing element rather than
 * a slow one, and sent two rounds of fixes at the timeout instead.
 *
 * Raising a budget only moves the threshold; the test still races the machine,
 * and the next busy CI box moves it back. Resolving the components up front
 * removes the race outright: both are imported once, here, and `dynamic()`
 * hands the right one straight back, so nothing in this file suspends and no
 * assertion depends on how loaded the CPU is.
 *
 * A previous version of this mock said exactly that and then did the opposite.
 * Extended to tell the two renderers apart, it began returning a wrapper that
 * started at `useState(null)`, ran the loader in an effect and rendered
 * nothing until the promise landed — which is precisely the deferral the mock
 * exists to delete, reintroduced under a docblock claiming it was gone. That
 * is how the wall clock got back in, and the symptom was then treated as a
 * budget problem twice over. Anything added here must hand a component back
 * *synchronously*.
 *
 * Dispatch reads the loader's own source, which survives Vite's transform as
 * `__vite_ssr_dynamic_import__("/components/map/GlobeLevel.tsx").then((m) =>
 * m.GlobeLevel)` — the component's name appears whether or not the specifier
 * is rewritten. It throws rather than guessing when a loader matches neither
 * name or both: with two dynamic imports, a mock that quietly fell back to one
 * of them would render the flat map in the globe's place and every globe
 * assertion here would pass against the wrong component.
 *
 * What is given up is coverage of the `loading` fallback, which no test here
 * asserts on.
 */
vi.mock("next/dynamic", async () => {
  const { WorldMap } = await import("./WorldMap");
  const { GlobeLevel } = await import("./GlobeLevel");
  const byName: Record<string, ComponentType<Record<string, unknown>>> = {
    WorldMap: WorldMap as unknown as ComponentType<Record<string, unknown>>,
    GlobeLevel: GlobeLevel as unknown as ComponentType<Record<string, unknown>>,
  };
  return {
    default: (loader: () => Promise<unknown>) => {
      const source = loader.toString();
      const matched = Object.keys(byName).filter((name) => source.includes(name));
      if (matched.length !== 1) {
        throw new Error(
          `next/dynamic mock matched ${matched.length} components for this loader, expected 1: ${source}`
        );
      }
      return byName[matched[0]];
    },
  };
});

/**
 * Peru's first row and its Cusco row, lifted byte-for-byte from the committed
 * `public/cities/PE.json` (Lima is index 0 of 750, Cusco index 7). Every field
 * differs between the two, so a cross-wire — the wrong row under a name, or
 * one row's admin-1 pasted onto the other — is visible rather than absorbed.
 */
const PE_SHARD = {
  country: "PE",
  generatedAt: "2026-08-25T09:23:00.949Z",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    {
      id: "G3936456",
      n: "Lima",
      lat: -12.04318,
      lon: -77.02824,
      a1: "Lima Province",
      p: 7_737_002,
      tz: "America/Lima",
    },
    {
      id: "G3941584",
      n: "Cusco",
      lat: -13.53188,
      lon: -71.96701,
      a1: "Cuzco Department",
      p: 428_450,
      tz: "America/Lima",
    },
  ],
};

/**
 * Only Cusco is enriched. A fixture that gave every row a description would
 * pass even if the index were ignored and one blurb pasted onto everything, so
 * Lima's `null` is what makes the merge's key observable.
 *
 * The description is abridged; the committed file's is four lines long.
 */
const PE_ENRICHMENT = {
  country: "PE",
  generatedAt: "2026-08-25T10:03:02.391Z",
  source: "Wikidata (CC0) + Wikipedia (CC BY-SA) summaries",
  cities: {
    G3941584: {
      description: "Cusco is a city in southeastern Peru, near the Sacred Valley.",
      image: null,
    },
  },
};

/**
 * A second foreign country with a shard of its own — the one thing the
 * foreign-to-foreign switch test needs that Japan cannot give it.
 *
 * Japan is this file's shard-less country: `/cities/JP.json` 404s below, which
 * is what `keeps working for a country whose shard 404s` reads and what keeps
 * `No map for Japan yet` true for the two tests that assert it. A PE→JP switch
 * could therefore only ever show that Peru's cities left, never that the new
 * country's arrived — half a country-scoping proof, and the half that passes
 * just as well if the shard leg died outright.
 */
const DE_SHARD = {
  country: "DE",
  generatedAt: "2026-08-25T09:23:00.949Z",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    {
      id: "G2950159",
      n: "Berlin",
      lat: 52.52437,
      lon: 13.41053,
      a1: "State of Berlin",
      p: 3_426_354,
      tz: "Europe/Berlin",
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const href = String(url);
    const body =
      href === CHINA_TOPOLOGY_PATH
        ? CHINA_FIXTURE
        : href.startsWith("/api/map/cities")
          ? { available: true, cities: [] }
          : href.startsWith("/api/map/airports")
            ? { airports: [] }
            : href === "/cities/PE.json"
              ? PE_SHARD
              : href === "/cities/enrich/PE.json"
                ? PE_ENRICHMENT
                : href === "/cities/DE.json"
                  ? DE_SHARD
                  // Every other country's shard and enrichment file — Japan's
                  // and China's included — 404s. That is the honest answer for
                  // the four codes with no shard at all, and the map has to
                  // keep working through it.
                  : href.startsWith("/cities/")
                    ? null
                    : WORLD_FIXTURE;
    return Promise.resolve({
      ok: body !== null,
      status: body === null ? 404 : 200,
      json: async () => body ?? {},
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

/**
 * A request that never answers and rejects when it is aborted — what a real
 * in-flight fetch does when the country changes under it.
 *
 * Neither the shared mock (which resolves immediately and ignores the signal)
 * nor a bare `new Promise(() => {})` (which never settles at all) reproduces
 * that, and the abort path is the one where a *previous* country's answer can
 * still reach `setState`.
 */
function pendingUntilAbort(init?: { signal?: AbortSignal }): Promise<never> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("The operation was aborted.", "AbortError"))
    );
  });
}

/** A catalog that reports itself down, for a country with no shard to fall back on. */
function deadCatalog(url: string) {
  const href = String(url);
  if (href.startsWith("/api/map/cities")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ available: false, cities: [] }),
    });
  }
  if (href.startsWith("/cities/")) {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [] }) });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Written by `Harness`'s `prefs` prop, via the same cookie `PrefsProvider`
  // reads on mount — cleared so one test's prefs never leak into the next.
  document.cookie = `${PREFS_COOKIE}=; Path=/; Max-Age=0`;
});

function requested(path: string): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url) === path);
}

/**
 * Flush mount effects, the promises they start, and the renders those cause —
 * then let the test query synchronously.
 *
 * Used instead of `findBy*` throughout this file. Those poll against a
 * wall-clock budget, and mounting this component is real CPU work (jsdom plus
 * d3-geo projection) rather than anything that waits. That is comfortably
 * inside the budget on an idle machine and can fall outside it when the full
 * suite has every core busy, which is exactly the shape of the flake: it never
 * reproduced on this file alone, only in a full run. Nothing here was ever slow
 * to *settle* — it was slow to *compute*, and a poll timeout cannot tell those
 * apart, so it reported "Unable to find role=…" as though the element were
 * missing.
 *
 * The "~165ms" this note used to quote for that mount was measured off the
 * first test in the file, and was mostly not the mount: the bulk of it was the
 * one-time jsdom environment warmup that every file's first role query used to
 * pay, which now happens in vitest.setup.ts instead. Removing it from this file
 * takes the first test from ~347ms to ~164ms. The sibling tests that mount and
 * settle the same world level land at ~35-45ms; the first test stays longer
 * than they do because it also pays React's first render and the world
 * renderer's first module evaluation, neither of which the setup warmup covers.
 *
 * Draining to a fixed point removes the clock from the assertion entirely. The
 * work still takes however long it takes; the test simply waits for it rather
 * than racing it. vitest's own testTimeout stays as the backstop for a genuine
 * hang, which is the only thing a timeout should be catching.
 */
async function settle(): Promise<void> {
  let previous = "";
  for (let i = 0; i < 10 && document.body.innerHTML !== previous; i++) {
    previous = document.body.innerHTML;
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function Harness({
  country = "CN",
  level = "country",
  prefs,
  onAddCatalog = () => {},
}: {
  country?: string;
  level?: MapLevel;
  /**
   * Seeds `PrefsProvider` with a specific `UserPrefs`, via the same cookie it
   * reads on mount — written here, synchronously, before the provider below
   * renders and its lazy `useState` initialiser reads it back. Omitted, the
   * provider reads no cookie and falls back to `DEFAULT_PREFS` itself, which
   * is the "no explicit choice" case these tests need too.
   */
  prefs?: UserPrefs;
  onAddCatalog?: (hit: unknown) => void;
}) {
  const [activeCountry, setCountry] = useState(country);
  const [activeLevel, setLevel] = useState<MapLevel>(level);
  if (prefs) {
    document.cookie = `${PREFS_COOKIE}=${serializePrefsCookie(prefs)}; Path=/`;
  }
  // Re-rendering with a new `country` prop must actually move the map, or the
  // foreign-to-foreign refetch tests would be asserting against frozen state.
  useEffect(() => setCountry(country), [country]);
  return (
    <PrefsProvider>
      <MapExplorer
        selected={[]}
        visited={[]}
        country={activeCountry}
        level={activeLevel}
        onCountryChange={setCountry}
        onLevelChange={setLevel}
        onToggleSelect={() => {}}
        onAddCatalog={onAddCatalog}
        onRemoveCatalog={() => {}}
        onReorder={() => {}}
      />
    </PrefsProvider>
  );
}

describe("MapExplorer", () => {
  test("carries a world-level pick down into that country's level", async () => {
    render(<Harness level="world" />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Japan/ }));

    // Japan has no detail level, so the same shell shows the fallback.
    await settle();
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
    // And the world level is gone: the two levels never render at once.
    // Either renderer's group is named "… — pick a country", so this covers
    // both the flat map and the globe regardless of which one was active.
    expect(screen.queryByRole("group", { name: /pick a country/ })).not.toBeInTheDocument();
  });

  test("goes back to the country level without changing the country", async () => {
    render(<Harness level="world" />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: "← Back to China" }));

    await settle();
    expect(
      screen.getByRole("group", { name: "Map of China segmented by region" })
    ).toBeInTheDocument();
  });

  test("buys no China assets for a country that cannot use them", async () => {
    render(<Harness country="JP" />);

    await settle();
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
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
    render(<Harness level="world" />);

    await settle();
    expect(screen.getByRole("button", { name: "← Back to China" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("gives its zoom-out control the C5 tap target", async () => {
    render(<Harness />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Zoom into North China/ }));

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
    screen.getByRole("group", { name: "Map of China segmented by region" });
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
    // Peru has no detail level, so the same shell shows CountryPlaceList —
    // which, before this task, was always empty outside China.
    render(<Harness country="PE" />);

    await settle();
    expect(screen.getByRole("button", { name: /Lima/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
  });

  test("a tap on a shard city resolves and is added under its GeoNames id", async () => {
    // The half of the acceptance test the client owns. `togglePlace` re-looks
    // the tapped place up in the `cities` state array and silently drops the
    // add on a miss, so this fails the moment shard cities stop being merged
    // into that array.
    const onAddCatalog = vi.fn();
    render(<Harness country="PE" onAddCatalog={onAddCatalog} />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Cusco/ }));

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
    fireEvent.click(screen.getByRole("button", { name: /Lima/ }));
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
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();

    rerender(<Harness country="DE" />);
    await settle();

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("/cities/DE.json");
    expect(screen.getByRole("button", { name: /Berlin/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cusco/ })).not.toBeInTheDocument();
  });

  test("drops the previous country's cities on the switch, not when the new ones land", async () => {
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();

    // Germany's legs never answer, so everything on screen from here is what
    // the switch itself did — the only way to observe the window between a
    // country change and the new data landing. A marker from the country you
    // just left is a wrong answer, not a stale one.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    rerender(<Harness country="DE" />);
    await settle();

    expect(screen.queryByRole("button", { name: /Cusco/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lima/ })).not.toBeInTheDocument();
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
    // Three of the four legs swallow their own rejection, so an abort resolves
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

  test("keeps working for a country whose shard 404s", async () => {
    render(<Harness country="JP" />);

    await settle();
    // The fallback names the country and points at search, exactly as before.
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
    // A country with no shard is a country with no cities to offer, not an
    // outage: the catalog answered, so nothing is broken.
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });
});

describe("fit lookups degrade instead of throwing on a foreign region label", () => {
  test("an unknown region label gets a neutral fit instead of throwing", () => {
    // bestSeasons: undefined is load-bearing — fitForPlace returns early when a
    // place has its own seasons, so a fixture that sets them would never reach
    // the REGION_MONTHS lookup this test exists to cover.
    const abroad = { ...A_CATALOG_PLACE, region: "Kansai", bestSeasons: undefined };
    expect(() => fitForPlace(abroad, 4)).not.toThrow();
    // Literal, not NEUTRAL_FIT: the constant is what's under test here, so
    // comparing against itself can't catch it regressing from "unknown" back
    // to "poor" — the exact distinction this fit exists to preserve.
    expect(fitForPlace(abroad, 4)).toBe("unknown");
  });

  test("fitForRegion degrades on a label outside China's seven", () => {
    expect(fitForRegion("Kansai", 4)).toBe("unknown");
  });
});
