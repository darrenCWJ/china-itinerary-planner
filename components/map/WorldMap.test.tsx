import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { geoArea } from "d3-geo";
import { useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { WORLD_TOPOLOGY_PATH } from "@/lib/isoTopology";
import { WorldMap } from "./WorldMap";
import { WORLD_FIXTURE } from "./worldFixture";

/**
 * Tint, layout and the shape of the coastlines are visual and are not asserted
 * here. What is asserted is behaviour: when the topology is fetched, that a
 * country is a `role="button"` reachable and operable from the keyboard —
 * including the small-country point layer, which is the whole reason that layer
 * exists — and that a missing asset degrades instead of crashing.
 *
 * The fixture is a hand-built six-country topology rather than the real 730KB
 * asset: these tests are about the component, and a fixture makes the expected
 * keyboard order something the test states rather than something it discovers.
 * It lives in `./worldFixture` because `GlobeLevel.test.tsx` is held to the
 * same world; importing it from here would make vitest collect this file's
 * suite a second time inside that one.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function serveFixture() {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => WORLD_FIXTURE });
}

beforeEach(() => {
  fetchMock = vi.fn();
  serveFixture();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The picker: the map exists only while it is open, which is the whole point. */
function Picker({ onSelect }: { onSelect?: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open picker
      </button>
      {open && <WorldMap onSelectCountry={onSelect ?? (() => {})} />}
    </div>
  );
}

describe("WorldMap", () => {
  /**
   * The fixture's rings were wound inside-out from the day it was written, and
   * every assertion in this file passed anyway.
   *
   * d3 reads a ring's winding as which side is the interior, so
   * east-north-west-south described "the whole sphere except this rectangle" —
   * `geoArea` 12.56 steradians (4π) with bounds [[-180,-90],[180,90]] for each
   * of the four. Mercator never clips a whole feature, so it emitted a correct
   * ~322-character rectangle and nothing noticed.
   *
   * It matters because the globe's projection DOES clip: with these rings every
   * country paints the entire disc and none is ever on the far side, so the
   * back-face tests this fixture exists to support would be green and hollow.
   */
  test("the fixture describes countries, not the whole sphere minus a country", () => {
    const collection = feature(
      WORLD_FIXTURE.topology as unknown as Topology,
      WORLD_FIXTURE.topology.objects.countries as GeometryCollection
    );

    for (const f of collection.features) {
      // A real country is a rounding error against 4π = 12.566 steradians.
      expect(geoArea(f), `${f.id} covers the whole sphere — its ring is reversed`).toBeLessThan(1);
    }
  });

  test("fetches the topology only once the picker opens", async () => {
    render(<Picker />);

    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Open picker" }));
    await screen.findByRole("button", { name: "France" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(WORLD_TOPOLOGY_PATH);
  });

  test("makes every country a control, small ones through the point layer", async () => {
    render(<WorldMap onSelectCountry={() => {}} />);

    // Singapore and Malta are below the area threshold: their polygons are inert
    // and the point circles carry the role, so all four are still controls.
    expect(await screen.findByRole("button", { name: "France" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Japan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Singapore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Malta" })).toBeInTheDocument();
  });

  test("selects a country on Enter", async () => {
    const onSelect = vi.fn();
    render(<WorldMap onSelectCountry={onSelect} />);

    fireEvent.keyDown(await screen.findByRole("button", { name: "France" }), {
      key: "Enter",
    });

    expect(onSelect).toHaveBeenCalledWith("FR");
  });

  test("selects a small country from its point, and Space does not scroll", async () => {
    const onSelect = vi.fn();
    render(<WorldMap onSelectCountry={onSelect} />);

    const singapore = await screen.findByRole("button", { name: "Singapore" });
    // fireEvent returns false when the handler called preventDefault, which is
    // what stops Space paging the picker away under the user.
    const notCancelled = fireEvent.keyDown(singapore, { key: " " });

    expect(onSelect).toHaveBeenCalledWith("SG");
    expect(notCancelled).toBe(false);
  });

  test("is a single tab stop that arrow keys move through in name order", async () => {
    const onSelect = vi.fn();
    render(<WorldMap onSelectCountry={onSelect} />);

    const france = await screen.findByRole("button", { name: "France" });
    const japan = screen.getByRole("button", { name: "Japan" });
    expect(france).toHaveAttribute("tabindex", "0");
    expect(japan).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(france, { key: "ArrowRight" });

    // France, Japan, Malta, Singapore — the tab stop moved one step along it.
    expect(japan).toHaveAttribute("tabindex", "0");
    expect(france).toHaveAttribute("tabindex", "-1");
    // Moving is not choosing.
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("End jumps to the last country and wraps past it", async () => {
    render(<WorldMap onSelectCountry={() => {}} />);

    const france = await screen.findByRole("button", { name: "France" });
    fireEvent.keyDown(france, { key: "End" });
    const singapore = screen.getByRole("button", { name: "Singapore" });
    expect(singapore).toHaveAttribute("tabindex", "0");
    expect(france).toHaveAttribute("tabindex", "-1");

    // Past the end is the start again, so the map has no dead edge.
    fireEvent.keyDown(singapore, { key: "ArrowRight" });
    expect(france).toHaveAttribute("tabindex", "0");
    expect(singapore).toHaveAttribute("tabindex", "-1");
  });

  test("marks the selected country and starts the tab stop there", async () => {
    render(<WorldMap selectedCountry="sg" onSelectCountry={() => {}} />);

    const singapore = await screen.findByRole("button", { name: "Singapore (selected)" });
    expect(singapore).toHaveAttribute("aria-pressed", "true");
    expect(singapore).toHaveAttribute("tabindex", "0");

    const france = screen.getByRole("button", { name: "France" });
    expect(france).toHaveAttribute("aria-pressed", "false");
    // First in name order, but not the tab stop: the chosen country is.
    expect(france).toHaveAttribute("tabindex", "-1");
  });

  test("tints countries from the accent ramp, never a literal colour", async () => {
    const { container } = render(<WorldMap onSelectCountry={() => {}} />);

    await screen.findByRole("button", { name: "France" });
    const fills = [...container.querySelectorAll("path")].map((p) => p.getAttribute("fill"));

    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) expect(fill).toMatch(/^oklch\(/);
  });

  test("offers a retry instead of crashing when the asset is missing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    render(<WorldMap onSelectCountry={() => {}} />);

    // Search stays the guaranteed path, so the copy says so rather than dying.
    expect(await screen.findByText(/Couldn't load the world map/)).toBeInTheDocument();

    serveFixture();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "France" })).toBeInTheDocument();
  });

  /**
   * The point circle is r=9 in an 860-unit viewBox: ~22 CSS px across where
   * `/plan` renders the map and ~6.5 px at 375px, both under WCAG 2.2 AA 2.5.8.
   * It cannot grow — San Marino and Vatican City are ~6 units apart — so the
   * compliant target is this second control, and these tests hold it to being a
   * real one: full tap size, every country, and one tab stop.
   */
  test("offers a full-size list control that selects a point-layer country", async () => {
    const onSelect = vi.fn();
    render(<WorldMap onSelectCountry={onSelect} />);

    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    expect(picker).toHaveClass("min-h-[var(--tap-min)]");

    // Malta's polygon is inert and its circle is the sub-24px target; the list is
    // how a pointer reaches it at all.
    fireEvent.change(picker, { target: { value: "MT" } });

    expect(onSelect).toHaveBeenCalledWith("MT");
  });

  test("the list reaches every country the map drew, in name order", async () => {
    render(<WorldMap onSelectCountry={() => {}} />);

    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    const codes = [...picker.querySelectorAll("option")].map((o) => o.getAttribute("value"));

    // Placeholder, then France, Japan, Malta, New Zealand, Peru, Singapore —
    // polygon and point countries alike, so the map is never the only route to
    // a selection. NZ and PE are the far-hemisphere pair: on a globe they are
    // routinely on the back face, and this list must reach them anyway.
    expect(codes).toEqual(["", "FR", "JP", "MT", "NZ", "PE", "SG"]);
  });

  test("the list mirrors the selection without adding 235 tab stops", async () => {
    render(<WorldMap selectedCountry="sg" onSelectCountry={() => {}} />);

    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    expect(picker).toHaveValue("SG");
    // One native control, so the roving tabindex over the countries is untouched
    // and the map costs one extra Tab rather than one per country.
    expect(picker).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("button", { name: "Singapore (selected)" })).toHaveAttribute(
      "tabindex",
      "0"
    );
  });

  test("the list shows no country when the chosen one is not on the map", async () => {
    render(<WorldMap selectedCountry="ZZ" onSelectCountry={() => {}} />);

    await screen.findByRole("button", { name: "France" });

    // Same rule as the hero card: a code the map never drew selects nothing,
    // rather than silently presenting the first country as chosen.
    expect(screen.getByRole("combobox", { name: /pick from the list/i })).toHaveValue("");
  });

  /**
   * `theme` is documented as an override of the ramp `PrefsProvider` resolved —
   * override only to render a fixed ramp, and the whole point is that the map
   * then matches that ramp rather than the page's. That guarantee broke when
   * country selection started resolving its own `usePrefs()` theme instead of
   * taking the caller's: the override still reached the selected-country card,
   * just not the fills next to it. Two renders, two ramps, and the fills had
   * better not be the same set.
   */
  test("honours an explicit theme override in the country fills", async () => {
    const light = render(<WorldMap theme="light" onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });
    const lightFills = [...light.container.querySelectorAll("path")].map((p) =>
      p.getAttribute("fill")
    );
    light.unmount();

    const dark = render(<WorldMap theme="dark" onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });
    const darkFills = [...dark.container.querySelectorAll("path")].map((p) =>
      p.getAttribute("fill")
    );

    expect(lightFills.length).toBeGreaterThan(0);
    expect(darkFills).not.toEqual(lightFills);
  });
});
