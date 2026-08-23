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
 * and the next busy CI box moves it back. Resolving the component up front
 * removes the race outright: WorldMap is imported once, here, and `dynamic()`
 * hands it straight back, so nothing in this file suspends and no assertion
 * depends on how loaded the CPU is.
 *
 * What is given up is coverage of the `loading` fallback, which no test here
 * asserts on.
 *
 * Resolves both world-level components up front and dispatches on which
 * loader `dynamic()` was handed, by running it and reading the module it
 * resolves.
 *
 * The previous version returned `WorldMap` for every call, which was safe
 * only while `MapExplorer` had exactly one `dynamic()` import. With two, an
 * undispatched mock renders the flat map in the globe's place and every globe
 * assertion here passes against the wrong component.
 */
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const Resolved = (props: Record<string, unknown>) => {
      const [Component, setComponent] = useState<ComponentType<Record<string, unknown>> | null>(
        null
      );
      useEffect(() => {
        void loader().then((mod) =>
          setComponent(() => mod as ComponentType<Record<string, unknown>>)
        );
      }, []);
      return Component ? <Component {...props} /> : null;
    };
    return Resolved;
  },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const body =
      url === CHINA_TOPOLOGY_PATH
        ? CHINA_FIXTURE
        : url.startsWith("/api/map/cities")
          ? { available: true, cities: [] }
          : url.startsWith("/api/map/airports")
            ? { airports: [] }
            : WORLD_FIXTURE;
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  vi.stubGlobal("fetch", fetchMock);
});

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
 * wall-clock budget, and mounting this component is ~165ms of real CPU (jsdom
 * plus d3-geo projection). That is comfortably inside the budget on an idle
 * machine and comfortably outside it when the full suite has every core busy,
 * which is exactly the shape of the flake: it never reproduced on this file
 * alone, only in a full run. Nothing here was ever slow to *settle* — it was
 * slow to *compute*, and a poll timeout cannot tell those apart, so it reported
 * "Unable to find role=…" as though the element were missing.
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

/**
 * `findBy*`'s default 1000ms wait, used for anything that must observe a
 * world-level renderer's dynamic import resolving (see the `next/dynamic`
 * mock's docblock above). That import goes through real module resolution —
 * an actual event-loop turn, not a microtask `settle()` can drain — and on an
 * idle machine it clears in well under 300ms, but a full-suite run with every
 * core busy can push it past the default budget, which is exactly the shape
 * of flake this mock's docblock warns about. Raised, not removed: the wait is
 * still bounded, and vitest's own testTimeout is still the backstop for a
 * genuine hang.
 */
const RESOLVE_TIMEOUT = { timeout: 3000 };

function Harness({
  country = "CN",
  level = "country",
  prefs,
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
}) {
  const [activeCountry, setCountry] = useState(country);
  const [activeLevel, setLevel] = useState<MapLevel>(level);
  if (prefs) {
    document.cookie = `${PREFS_COOKIE}=${serializePrefsCookie(prefs)}; Path=/`;
  }
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
        onAddCatalog={() => {}}
        onRemoveCatalog={() => {}}
        onReorder={() => {}}
      />
    </PrefsProvider>
  );
}

describe("MapExplorer", () => {
  test("carries a world-level pick down into that country's level", async () => {
    render(<Harness level="world" />);

    // findBy*, not settle(): the dynamic-imported world renderer resolves
    // through a real module import, which needs an event-loop turn settle()'s
    // microtask draining cannot observe (see the mock's docblock above).
    fireEvent.click(await screen.findByRole("button", { name: /Japan/ }, RESOLVE_TIMEOUT));

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
    // Nor the China-only city catalog, whose "unavailable" notice would
    // otherwise appear for a request nobody made.
    expect(screen.queryByText(/catalog is unavailable/)).not.toBeInTheDocument();
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
    // findBy*, not settle(): WorldMap only mounts (and only then fetches)
    // once its dynamic import resolves, which needs a real event-loop turn
    // that settle()'s microtask draining cannot observe.
    await screen.findByRole("group", { name: /World map/ }, RESOLVE_TIMEOUT);
    expect(requested("/world-countries.json")).toBe(true);
  });

  test("renders the globe by default", async () => {
    render(<Harness level="world" />);
    // findBy*, not settle(): see the note on the previous test.
    await screen.findByRole("group", { name: /World globe/ }, RESOLVE_TIMEOUT);
    // The globe fetches its own asset; the flat map fetches world-countries.json.
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(GLOBE_TOPOLOGY_PATH);
  });

  test("renders the flat map when the user has chosen it", async () => {
    render(<Harness level="world" prefs={{ ...DEFAULT_PREFS, worldView: "flat" }} />);
    await screen.findByRole("group", { name: /World map/ }, RESOLVE_TIMEOUT);
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(WORLD_TOPOLOGY_PATH);
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
    await screen.findByRole("group", { name: /World map/ }, RESOLVE_TIMEOUT);

    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(WORLD_TOPOLOGY_PATH);
    expect(screen.queryByRole("button", { name: /flat map|globe/i })).not.toBeInTheDocument();
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
