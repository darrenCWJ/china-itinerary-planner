import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { climateMonth, monthFit } from "@/lib/climateModel";
import { DERIVED_CLIMATE_NOTE } from "@/lib/climateNote";
import { FIT_LEGEND_LABEL } from "./FitLegend";
import {
  A_CATALOG_PLACE,
  anchorRow,
  defaultFetch,
  Harness,
  installMapExplorerHarness,
  PE_SHARD,
  settle,
} from "./mapExplorerHarness";
import { fitForPlace, fitForRegion, FIT_COLORS } from "./mapTypes";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

installMapExplorerHarness();

function requested(path: string): boolean {
  return fetchMock.mock.calls.some(([url]) => String(url) === path);
}

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

describe("the legend", () => {
  test("appears under a drawn country map", async () => {
    render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: FIT_LEGEND_LABEL });
    expect(legend.textContent).toContain("Great time");
    expect(legend.textContent).toContain("No data");
    // Under the MAP, not under the 750-chip list that is part of the level:
    // the legend and the note both precede the list's filter box in the DOM.
    const filter = screen.getByPlaceholderText(/^Filter /);
    expect(legend.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const note = screen.getByRole("note", { name: "About the climate colours" });
    expect(note.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("does not appear over the list-only fallback, which has no colours to read", async () => {
    // "It reads the marker colours, so it appears only where there are
    // markers to read" — the rule this file's own comments have carried since
    // the China legend it describes was lost with ChinaLevel. The honesty
    // note follows the same gate, so it is asserted absent right alongside it.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url) === "/provinces/PE.json"
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : defaultFetch(String(url))
      )
    );
    render(<Harness country="PE" />);
    await settle();
    expect(screen.queryByRole("group", { name: "Map of Peru" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: FIT_LEGEND_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "About the climate colours" })).not.toBeInTheDocument();
  });
});

/**
 * §9.4's fit colours worldwide, on the wire and on the pins. The model and
 * the join are pinned in their own files; what this pins is the effect —
 * which file is asked for, for whom, and what the marker under the cursor
 * ends up reading.
 */
describe("derived climate", () => {
  /** `MapExplorer`'s DEFAULT_MONTH. */
  const OCTOBER = 10;
  const CUSCO_ROW = anchorRow("cusco");
  const NOTE = { name: "About the climate colours" };

  test("fetches the open country's climate file", async () => {
    render(<Harness country="PE" />);
    await settle();
    expect(requested("/climate/PE.json")).toBe(true);
  });

  test("never fetches China's — nothing would read it", async () => {
    // `fitForPlace` ignores a derived row for any CN place (§9.5), and CN.json
    // is 412 rows the map would download on every open for nothing.
    render(<Harness country="CN" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of China" })).toBeInTheDocument();
    expect(requested("/climate/CN.json")).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/climate/"))).toBe(false);
  });

  test("colours a marker by the verdict the model gives its row and its elevation", async () => {
    const { container } = render(<Harness country="PE" />);
    await settle();
    const expected = FIT_COLORS[monthFit(CUSCO_ROW, 3312, OCTOBER - 1)];
    // Armed twice: the verdict is a colour and not the absence grey, and the
    // elevation changes it — so a map that dropped the join would fail here
    // rather than agree by accident.
    expect(expected).not.toBe(FIT_COLORS.unknown);
    expect(monthFit(CUSCO_ROW, 3312, OCTOBER - 1)).not.toBe(monthFit(CUSCO_ROW, null, OCTOBER - 1));
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(expected);
  });

  test("the elevation comes from the city shard, not from the climate row", async () => {
    // The same shard with the elevations withheld: the row is identical, so
    // only the join can move the colour.
    const noElevations = {
      ...PE_SHARD,
      cities: PE_SHARD.cities.map(({ elev: _elev, ...row }) => row),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url) === "/cities/PE.json"
          ? Promise.resolve({ ok: true, status: 200, json: async () => noElevations })
          : defaultFetch(String(url))
      )
    );
    const { container } = render(<Harness country="PE" />);
    await settle();
    // Armed on its own: the elevation-less verdict is still a colour, so a
    // map that built no index at all cannot pass this by rendering grey.
    expect(FIT_COLORS[monthFit(CUSCO_ROW, null, OCTOBER - 1)]).not.toBe(FIT_COLORS.unknown);
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS[monthFit(CUSCO_ROW, null, OCTOBER - 1)]);
  });

  test("the hover card reads the same index as the marker", async () => {
    const { container } = render(<Harness country="PE" />);
    await settle();
    // React's onMouseEnter is delivered from mouseover; testing-library's
    // `mouseEnter` fires both. The position is client pixels the reporter
    // measures against a zero rect in jsdom, which only moves the card.
    fireEvent.mouseEnter(container.querySelector('[data-place="G3941584"]')!, {
      clientX: 300,
      clientY: 200,
    });
    const october = climateMonth(CUSCO_ROW, OCTOBER - 1);
    expect(screen.getByRole("tooltip").textContent).toContain(`${october.lo}°–${october.hi}°C typical`);
  });

  test("a country whose climate file 404s draws grey pins and makes no claim", async () => {
    const { container } = render(<Harness country="DE" />);
    await settle();
    expect(requested("/climate/DE.json")).toBe(true);
    expect(
      container.querySelector('[data-place="G2950159"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS.unknown);
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });

  test("a city shard that 404s while the climate file answers builds no index, and makes no claim", async () => {
    // The climate artifact is derived from the shards, so the two cannot
    // disagree at rest — but a transient failure of the cities leg can
    // leave the climate leg standing, and an index built from it alone
    // has rows no pin can look up. The note must not render over that.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url) === "/cities/PE.json"
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : defaultFetch(String(url))
      )
    );
    const { container } = render(<Harness country="PE" />);
    await settle();
    expect(container.querySelector('[data-place="G3941584"]')).toBeNull();
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });

  test("says what the derived figures are, under a derived map and never under China's", async () => {
    render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("note", NOTE).textContent).toContain(DERIVED_CLIMATE_NOTE);
    cleanup();

    render(<Harness country="CN" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of China" })).toBeInTheDocument();
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });

  test("the index belongs to the country it was fetched for", async () => {
    // A PE→DE switch: Peru's rows must not colour Germany's cities, and the
    // note that was true of Peru is a claim about a country the user left.
    const view = render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("note", NOTE)).toBeInTheDocument();

    view.rerender(<Harness country="DE" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of Germany" })).toBeInTheDocument();
    expect(view.container.querySelector('[data-place="G3941584"]')).toBeNull();
    expect(
      view.container.querySelector('[data-place="G2950159"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS.unknown);
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });
});
