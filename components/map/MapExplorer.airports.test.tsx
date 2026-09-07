// First, before any import that could reach `next/dynamic`: the harness
// registers that mock, and vitest hoists a mock only above the imports of the
// file that declares it.
import {
  chip,
  defaultFetch,
  Harness,
  installMapExplorerHarness,
  PROVINCE_FILE,
  settle,
} from "@/test/mapExplorerHarness";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PREFS_COOKIE } from "@/lib/prefs";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

installMapExplorerHarness();

/**
 * §10.2's "Main airport" line, end to end.
 *
 * `MapExplorer` has fetched the open country's airports since PR1 and spent
 * them on one thing — `suggestRoute`'s flight legs — so the array reached the
 * route panel and nothing else. The three prop hops between it and
 * `SelectedPlaceCard` carried no airport field, which is why this line could
 * not exist until they did.
 *
 * Rendered here rather than only against `CountryLevel` because the level's own
 * tests are handed the array directly: a `MapExplorer` that fetched the
 * airports and then failed to pass them down would leave every one of them
 * green and every real card blank.
 */
describe("the open country's airports on its map", () => {
  /** Exactly 12 km north of the committed Cusco row, along its own meridian. */
  const CUZ = {
    iata: "CUZ",
    icao: "SPZO",
    name: "Alejandro Velasco Astete International Airport",
    municipality: "Cusco",
    country: "PE",
    lat: -13.53188 + 12 / ((6371 * Math.PI) / 180),
    lon: -71.96701,
    size: "medium",
  };

  test("the country's airports reach the card its markers open", async () => {
    vi.stubGlobal(
      "fetch",
      (fetchMock = vi.fn((url: string) => {
        const href = String(url);
        if (href.startsWith("/api/map/airports")) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: [CUZ] }) });
        }
        return defaultFetch(href);
      }))
    );

    const { container } = render(<Harness country="PE" />);
    await settle();

    // The country it asked for, not a global set: the route is per-country and
    // the line has to be about the country whose map is open.
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(
      "/api/map/airports?country=PE"
    );

    fireEvent.click(container.querySelector('[data-place="G3941584"]')!);

    expect(screen.getByRole("dialog", { name: "Cusco" }).textContent).toContain(
      "Main airport: CUZ · 12 km"
    );
  });

  test("a country whose airports never arrive still opens a card", async () => {
    // The default answer table returns an empty array for every country, which
    // is also what a failed fetch leaves behind (the effect clears first). The
    // card is not gated on it.
    const { container } = render(<Harness country="PE" />);
    await settle();

    fireEvent.click(container.querySelector('[data-place="G3941584"]')!);

    expect(screen.getByRole("dialog", { name: "Cusco" })).toBeInTheDocument();
    expect(container.querySelector("[data-main-airport]")).toBeNull();
  });
});

/**
 * §10.1's toggle for the airport layer, and D11's decision about where its
 * state lives.
 *
 * The layer is off by default and there is nothing else that can turn it on,
 * so this control is the whole of the feature's reachability: `CountryLevel`
 * has drawn `showAirports` since the layer landed and no caller passed it.
 *
 * The state is ephemeral — a `useState` of this component's own — and NOT a
 * fifth `UserPrefs` field. That is not merely "one less thing to persist":
 * `PrefsSchema` is a `z.object()`, Zod 4 strips unlisted keys, and the PUT to
 * `/api/me/prefs` answers 200 with the stripped object, so an unlisted key is
 * actively clobbered rather than merely dropped. `lib/server/schemas.ts:325-328`
 * is the scar that records that happening to `pivot` for real. The globe/flat
 * button a few lines above IS a prefs writer, which makes it the closest
 * visual precedent and the wrong one to copy — hence the assertion below that
 * this one writes nothing.
 */
describe("the airport layer's toggle", () => {
  /**
   * Two drawable rows — one `large`, one `medium` — so a layer that hard-coded
   * a single mark is visible as an undercount rather than passing.
   *
   * `small` is deliberately absent: which sizes are drawn is `CountryLevel`'s
   * question and is pinned there, and a third row here would only make this
   * file's counts depend on that filter.
   */
  const PE_AIRPORTS = [
    {
      iata: "LIM",
      icao: "SPJC",
      name: "Jorge Chávez International Airport",
      municipality: "Lima",
      country: "PE",
      lat: -12.0219,
      lon: -77.1143,
      size: "large",
    },
    {
      iata: "CUZ",
      icao: "SPZO",
      name: "Alejandro Velasco Astete International Airport",
      municipality: "Cusco",
      country: "PE",
      lat: -13.5358,
      lon: -71.9388,
      size: "medium",
    },
  ];

  /** The shared answer table, with the airports leg answering for real. */
  function withAirports(rows: unknown[] = PE_AIRPORTS) {
    fetchMock = vi.fn((url: string) => {
      const href = String(url);
      if (href.startsWith("/api/map/airports")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ airports: rows }) });
      }
      return defaultFetch(href);
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  function toggle(): HTMLElement {
    return screen.getByRole("button", { name: "Airports" });
  }

  /**
   * Every mark §10.1's layer drew — the same query
   * `CountryLevel.airports.test.tsx` uses, through `airportMarks` in
   * `test/countryLevelHarness.tsx`.
   */
  function marks(container: HTMLElement): Element[] {
    return [...container.querySelectorAll("[data-airports] [data-airport]")];
  }

  test("airports are off by default", async () => {
    withAirports();
    const { container } = render(<Harness country="PE" />);
    await settle();

    // Armed by the toggle being there at all: the array HAS landed, and the
    // layer is still not drawn. Without this line an empty answer would pass.
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(marks(container)).toHaveLength(0);
  });

  test("the toggle shows and hides the layer", async () => {
    withAirports();
    const { container } = render(<Harness country="PE" />);
    await settle();

    fireEvent.click(toggle());
    expect(marks(container)).toHaveLength(2);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    // Both ways: a one-way button would satisfy every assertion above.
    fireEvent.click(toggle());
    expect(marks(container)).toHaveLength(0);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  test("the toggle does not write to prefs", async () => {
    withAirports();
    const { container } = render(<Harness country="PE" />);
    await settle();

    fireEvent.click(toggle());
    // Armed: the click did something, so the negatives below are about where
    // the state went rather than about a dead button.
    expect(marks(container)).toHaveLength(2);

    // `setPrefs` does two observable things, and neither happened: it writes
    // the cookie `PrefsProvider` reads on mount, and it PUTs the whole object
    // to the route whose schema would strip an unlisted key back out.
    expect(document.cookie).not.toContain(PREFS_COOKIE);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(
      "/api/me/prefs"
    );
  });

  test("the state does not survive a remount", async () => {
    withAirports();
    const first = render(<Harness country="PE" />);
    await settle();
    fireEvent.click(toggle());
    expect(marks(first.container)).toHaveLength(2);
    first.unmount();

    // Ephemeral is the requirement, so what is pinned is the consequence — a
    // fresh mount is off again — rather than the absence of a persistence key,
    // which a later `localStorage` shortcut would satisfy just as well.
    const second = render(<Harness country="PE" />);
    await settle();
    expect(marks(second.container)).toHaveLength(0);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  test("the toggle clears the minimum tap target", async () => {
    withAirports();
    render(<Harness country="PE" />);
    await settle();

    // C5's 44px minimum. The three step-up controls share `STEP_UP_BUTTON`
    // precisely so this token cannot go missing from one of them; this button
    // is not a step-up control and carries its own classes, so it is exactly
    // the case that constant does not cover.
    expect(toggle()).toHaveClass("min-h-[var(--tap-min)]");
  });

  test("offers no toggle where there is no layer to draw", async () => {
    // Every rendering that is NOT `CountryLevel` with airports in hand. A
    // control that cannot change what is on screen is the thing the legend
    // beside it already refuses to be, and the reduced-motion branch withdraws
    // the globe button for the same reason rather than leaving it lying.
    const CASES: { label: string; country: string; rows: unknown[] }[] = [
      // China used to head this list — `ChinaLevel` had no layer and no
      // `showAirports`, and `canDrawAirports` was gated on `!hasCurated`. It
      // renders `CountryLevel` now, so it has a layer like everyone else and
      // the case below asserts that instead.
      //
      // The array is empty for the first moment of every country, and forever
      // for one with no rows of its own.
      { label: "a country whose airports have not landed", country: "PE", rows: [] },
    ];

    for (const { label, country, rows } of CASES) {
      withAirports(rows);
      const { unmount } = render(<Harness country={country} />);
      await settle();
      expect(
        screen.queryByRole("button", { name: "Airports" }),
        `expected no airport toggle for ${label}`
      ).toBeNull();
      unmount();
    }
  });

  test("offers no toggle to a country whose geometry never arrived", async () => {
    // No province file means `CountryPlaceList` — the list IS the level, and
    // there is no map for a mark to sit on. §5.2 keeps that country working;
    // a layer toggle over it would be a control with nothing to control.
    fetchMock = vi.fn((url: string) => {
      const href = String(url);
      if (href.startsWith("/api/map/airports")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ airports: PE_AIRPORTS }),
        });
      }
      if (PROVINCE_FILE.test(href)) {
        return Promise.reject(new Error("offline"));
      }
      return defaultFetch(href);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Harness country="PE" />);
    await settle();

    // Armed: the list-only fallback really is what rendered.
    expect(chip(/Lima/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Airports" })).toBeNull();
  });
});
