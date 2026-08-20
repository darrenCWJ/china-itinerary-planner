import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MapExplorer, type MapLevel } from "./MapExplorer";

/**
 * What is asserted here is the coordination the component exists for: which
 * level is showing, that picking a country at the world level hands the code up
 * and drops back to the country level, and that a country with no detail level
 * costs no China assets. Layout, tint and the legend are visual.
 */

/** Two countries is enough to prove a pick is carried; see WorldMap.test.tsx. */
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const body =
      url === CHINA_TOPOLOGY_PATH
        ? CHINA_FIXTURE
        : url.startsWith("/api/map/cities")
          ? { available: true, cities: [] }
          : WORLD_FIXTURE;
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function requested(path: string): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url) === path);
}

function Harness({
  country = "CN",
  level = "country",
}: {
  country?: string;
  level?: MapLevel;
}) {
  const [activeCountry, setCountry] = useState(country);
  const [activeLevel, setLevel] = useState<MapLevel>(level);
  return (
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
  );
}

describe("MapExplorer", () => {
  test("carries a world-level pick down into that country's level", async () => {
    render(<Harness level="world" />);

    fireEvent.click(await screen.findByRole("button", { name: /Japan/ }));

    // Japan has no detail level, so the same shell shows the fallback.
    expect(await screen.findByText(/No map for Japan yet/)).toBeInTheDocument();
    // And the world level is gone: the two levels never render at once.
    expect(screen.queryByRole("group", { name: /World map/ })).not.toBeInTheDocument();
  });

  test("goes back to the country level without changing the country", async () => {
    render(<Harness level="world" />);

    fireEvent.click(await screen.findByRole("button", { name: "← Back to China" }));

    expect(
      await screen.findByRole("group", { name: "Map of China segmented by region" })
    ).toBeInTheDocument();
  });

  test("buys no China assets for a country that cannot use them", async () => {
    render(<Harness country="JP" />);

    expect(await screen.findByText(/No map for Japan yet/)).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "← Back to China" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("gives its zoom-out control the C5 tap target", async () => {
    render(<Harness />);

    fireEvent.click(await screen.findByRole("button", { name: /Zoom into North China/ }));

    expect(await screen.findByRole("button", { name: "← All China" })).toHaveClass(
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

    expect(await screen.findByRole("button", { name: "Try again" })).toHaveClass(
      "min-h-[var(--tap-min)]"
    );
  });

  test("fetches the world topology only once the world level is open", async () => {
    const { unmount } = render(<Harness />);

    await screen.findByRole("group", { name: "Map of China segmented by region" });
    expect(requested("/world-countries.json")).toBe(false);
    unmount();

    render(<Harness level="world" />);
    // Named by regex: the selected country's label carries a suffix.
    await screen.findByRole("button", { name: /China/ });
    expect(requested("/world-countries.json")).toBe(true);
  });
});
