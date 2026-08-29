import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { parseProvinceTopology } from "@/lib/provinceTopology";
import { CountryLevel } from "./CountryLevel";
import { SelectedPlaceCard } from "./SelectedPlaceCard";
import type { MapPlace } from "./mapTypes";

/**
 * §5.3.3: the surface `PlacePopup` is not.
 *
 * `PlacePopup` is `role="tooltip"`, `pointer-events-none`, and positioned from
 * `onMouseEnter`/`onMouseMove` alone — so on a touch screen, where there is no
 * hover, a marker's details are unreachable, and on any screen the popup's own
 * "Click to select" line is the only call to action it can offer, because
 * nothing inside it can be clicked. This card is the other half: it opens from
 * a tap, it takes focus when the keyboard opened it, it dismisses, and things
 * inside it can be operated. It is where PR7's climate line and PR8's airport
 * line land.
 *
 * **Additive.** The popup keeps hover; the card is what tap and Enter now get.
 * The two never both open for one marker — see the hover test at the foot.
 *
 * The fixture is one unit and two cities, deliberately unlike
 * `CountryLevel.test.tsx`'s Peru: seams for `merge()` to dissolve, a `sel: 0`
 * unit and an island the manifest trims are the specification of the LEVEL, and
 * none of them change what a card does when it is tapped. The ring is wound
 * clockwise in (lon, lat) for the reason that file gives — d3-geo reads rings
 * spherically, and the anticlockwise version is the globe minus the country.
 */

const TOPOLOGY = {
  type: "Topology",
  arcs: [
    [
      [-78, -14],
      [-78, -10],
      [-72, -10],
      [-72, -14],
      [-78, -14],
    ],
  ],
  objects: {
    provinces: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          id: "PE-LIM",
          arcs: [[0]],
          properties: { name: "Lima", name_en: "Lima", iso_3166_2: "PE-LIM", sel: 1 },
        },
      ],
    },
  },
};

const PE_FILE = parseProvinceTopology({
  country: "PE",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adm1_code",
  topology: TOPOLOGY,
  cityProvince: {},
});

function place(over: Partial<MapPlace> & Pick<MapPlace, "id" | "name">): MapPlace {
  return {
    kind: "catalog",
    localName: null,
    province: null,
    region: "",
    lat: -12,
    lon: -76,
    population: 500_000,
    level: "prefecture",
    attractionCount: 0,
    blurb: null,
    ...over,
  };
}

const LIMA = place({ id: "lima", name: "Lima", province: "Lima", lon: -77, lat: -12 });
const CUSCO = place({ id: "cusco", name: "Cusco", province: "Cuzco", lon: -73, lat: -13 });

function renderLevel(over: Partial<Parameters<typeof CountryLevel>[0]> = {}) {
  const props = {
    country: "PE",
    provinces: PE_FILE,
    projection: null,
    places: [LIMA, CUSCO],
    selected: [] as string[],
    month: 10,
    routeIds: [] as string[],
    onTogglePlace: vi.fn(),
    onHoverPlace: vi.fn(),
    ...over,
  };
  return { ...render(<CountryLevel {...props} />), props };
}

/** One card's props, with every callback its own spy. */
function cardProps(over: Partial<Parameters<typeof SelectedPlaceCard>[0]> = {}) {
  return {
    place: LIMA,
    month: 10,
    selected: false,
    anchor: { x: 100, y: 200 },
    takeFocus: false,
    onToggle: vi.fn(),
    onDismiss: vi.fn(),
    ...over,
  };
}

/** The card on its own, beside something outside it to click. */
function showCard(over: Partial<Parameters<typeof SelectedPlaceCard>[0]> = {}) {
  const props = cardProps(over);
  return {
    ...render(
      <div>
        <SelectedPlaceCard {...props} />
        <button type="button">elsewhere</button>
      </div>
    ),
    props,
  };
}

function marker(container: HTMLElement, id: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-place="${id}"]`);
  if (!node) throw new Error(`no marker for ${id}`);
  return node;
}

afterEach(cleanup);

describe("SelectedPlaceCard", () => {
  test("is not a tooltip — it has pointer events and an accessible name", () => {
    const { props } = showCard();

    const card = screen.getByRole("dialog", { name: "Lima" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(card.className).not.toContain("pointer-events-none");
    // The assertion that would still fail if only the class were dropped: a
    // control inside it that a pointer can actually reach. `PlacePopup` cannot
    // hold one at all, which is why its own call to action is a sentence
    // telling you to click the marker underneath it.
    fireEvent.click(screen.getByRole("button", { name: "Add Lima to trip" }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);

    // And it says which way that toggle goes, rather than making someone
    // remember whether the tap that opened the card added or removed the place.
    cleanup();
    showCard({ selected: true });
    expect(
      screen.getByRole("button", { name: "Remove Lima from trip" })
    ).toBeInTheDocument();
  });

  test("dismisses on Escape and on click outside", () => {
    const { props } = showCard();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(props.onDismiss).toHaveBeenCalledTimes(2);

    // Never from inside itself: a card that dismissed on its own mousedown
    // would be gone before the click on its toggle ever landed.
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(props.onDismiss).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Close Lima" }));
    expect(props.onDismiss).toHaveBeenCalledTimes(3);
  });

  test("has a slot for the climate and airport lines", () => {
    // PR7 puts the climate lo/hi line here and PR8 "Main airport: TNA · 30 km"
    // (§10.2). Asserted EMPTY today rather than stubbed with placeholder copy,
    // because a stub is the first thing either PR would have to delete — and a
    // slot that renders nothing is indistinguishable from no slot until
    // something is put through it, which the second half does.
    const { container, rerender } = render(<SelectedPlaceCard {...cardProps()} />);

    const slot = container.querySelector("[data-place-facts]");
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("");

    rerender(
      <SelectedPlaceCard {...cardProps()}>
        <p>Main airport: LIM · 12 km</p>
      </SelectedPlaceCard>
    );
    expect(container.querySelector("[data-place-facts]")!.textContent).toBe(
      "Main airport: LIM · 12 km"
    );
  });
});

describe("SelectedPlaceCard in the country level", () => {
  test("opens on tap, the modality PlacePopup's hover-only positioning never served", () => {
    const { container, props } = renderLevel();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(marker(container, "cusco"));

    expect(screen.getByRole("dialog", { name: "Cusco" })).toBeInTheDocument();
    // The tap still does what it did: the card reports what the tap selected
    // rather than intercepting it, so nothing that took one interaction with a
    // mouse now takes two.
    expect(props.onTogglePlace).toHaveBeenCalledWith(CUSCO);
    // A pointer user is not yanked out of the map, though — focus follows the
    // keyboard only, which is the next test.
    expect(document.activeElement).not.toBe(screen.getByRole("dialog"));
  });

  test("takes focus when opened from the keyboard, and returns it on dismiss", () => {
    const { container } = renderLevel();
    const lima = marker(container, "lima");

    // Announced before it happens: a caret that leaves the marker layer with no
    // warning reads as focus being lost, which is what the roving tabindex was
    // added to prevent.
    expect(lima).toHaveAttribute("aria-haspopup", "dialog");

    act(() => lima.focus());
    fireEvent.keyDown(lima, { key: "Enter" });

    const card = screen.getByRole("dialog", { name: "Lima" });
    expect(document.activeElement).toBe(card);

    fireEvent.keyDown(card, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Back on the marker it came from, and not on the body: a keyboard user who
    // dismisses the card has to be able to press ArrowRight next, which is the
    // whole point of the roving tabindex §5.3.1 gave the marker layer.
    expect(document.activeElement).toBe(lima);
  });

  test("does not replace PlacePopup's hover behaviour", () => {
    const { container, props } = renderLevel();
    const lima = marker(container, "lima");

    fireEvent.mouseEnter(lima, { clientX: 40, clientY: 50 });
    expect(props.onHoverPlace).toHaveBeenCalledWith(LIMA, expect.anything());
    // Hover stays the tooltip's, and ONLY the tooltip's. `MapExplorer` draws
    // `PlacePopup` from this callback, at the cursor; a card opening under it
    // would be two surfaces describing one marker, on top of each other.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(lima);
    expect(screen.getByRole("dialog", { name: "Lima" })).toBeInTheDocument();
    // And the reporting path is untouched with the card open: this is an
    // addition to the level, not a rewiring of it.
    fireEvent.mouseMove(lima, { clientX: 60, clientY: 70 });
    expect(props.onHoverPlace).toHaveBeenLastCalledWith(LIMA, expect.anything());
    fireEvent.mouseLeave(lima);
    expect(props.onHoverPlace).toHaveBeenLastCalledWith(null, null);
  });
});
