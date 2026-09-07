// First, before any import that could reach `./mapTypes` or `@/lib/dragLayer`:
// the harness registers those mocks, and vitest hoists a mock only above the
// imports of the file that declares it.
import {
  airportCodes,
  airportMarks,
  airportNear,
  CUSCO,
  installCountryLevelHarness,
  LIMA,
  markerX,
  markerY,
  renderLevel,
} from "@/test/countryLevelHarness";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

installCountryLevelHarness();

/**
 * §10.2's "Main airport" line — the first airport text attached to a place
 * anywhere in the app.
 *
 * The line lands in the card's `children`, the slot `SelectedPlaceCard` has
 * reserved and named since Plan 3, so nothing about the card changes to carry
 * it. What changes is that the array `MapExplorer` has fetched since PR1 and
 * spent only on the route estimator now reaches this level.
 *
 * `airports` is optional and NOT gated on §10.1's map-layer toggle. They are
 * two features with one data source: the toggle is about marker clutter on the
 * map, and this is a fact about the place whose card is open, which a reader
 * who has never found the toggle still deserves.
 */

describe("CountryLevel main airport", () => {
  test("the card shows the main airport for the selected place", () => {
    // Two airports, one per city, and that is what makes the assertion about
    // THIS place rather than about the array: a level that named the first
    // entry it was handed would put Lima's airport on Cusco's card and would
    // pass a one-airport fixture without a murmur.
    const { container } = renderLevel({
      airports: [airportNear(LIMA, "LIM", 12), airportNear(CUSCO, "CUZ", 30)],
    });

    fireEvent.click(container.querySelector('[data-place="cusco"]')!);

    const card = screen.getByRole("dialog", { name: "Cusco" });
    expect(card.textContent).toContain("Main airport: CUZ · 30 km");
    expect(card.textContent).not.toContain("LIM");
    // And it claims no proximity, because the ranking cannot promise any: a
    // large airport wins from up to 30 km further out than a small one (D12,
    // and `lib/mainAirport.test.ts` pins the boundary).
    expect(card.textContent).not.toMatch(/near|close/i);
  });

  test("the card shows no airport line when the country has none", () => {
    // `empty:hidden` on the facts wrapper means an empty `children` renders
    // nothing at all — so a card with a blank row and a card with no row are
    // the same pixels. Assert the ROW is absent, not that it is present and
    // empty, or a level that rendered "Main airport: undefined · NaN km" into
    // a hidden div would pass.
    const { container } = renderLevel();

    fireEvent.click(container.querySelector('[data-place="cusco"]')!);

    expect(screen.getByRole("dialog", { name: "Cusco" })).toBeInTheDocument();
    expect(container.querySelector("[data-main-airport]")).toBeNull();
    expect(container.querySelector("[data-place-facts]")!.textContent).toBe("");
  });

  test("the line follows the card from one place to the next", () => {
    // The card is keyed on its place and remounts when another marker is
    // tapped, so a line computed once at open would survive the remount and
    // describe the place the user just left.
    const { container } = renderLevel({
      airports: [airportNear(LIMA, "LIM", 12), airportNear(CUSCO, "CUZ", 30)],
    });

    fireEvent.click(container.querySelector('[data-place="cusco"]')!);
    expect(container.querySelector("[data-main-airport]")!.textContent).toBe(
      "Main airport: CUZ · 30 km"
    );

    fireEvent.click(container.querySelector('[data-place="lima"]')!);
    expect(container.querySelector("[data-main-airport]")!.textContent).toBe(
      "Main airport: LIM · 12 km"
    );

    // Puerto Lejano is 3,500 km out on the trimmed island and no airport in
    // the array is within the serving radius of it, so its card carries no
    // line — the same absence as an empty array, which is the point:
    // `mainAirportFor` answers per place and not per country.
    fireEvent.click(container.querySelector('[data-place="isla"]')!);
    expect(container.querySelector("[data-main-airport]")).toBeNull();
  });
});

/**
 * §10.1's map layer: the open country's airports, drawn behind a toggle.
 *
 * Decorative in the exact sense `readOnly` markers are, and for a stricter
 * reason. A read-only marker is a control the surface cannot honour; an airport
 * is not a place at all. "Airports are never selectable trip stops" is enforced
 * by an `Airport` never becoming a `MapPlace`, and this layer is where that
 * separation becomes visible: the marks are built from a different array, carry
 * no role, no tab stop and no handler, and nothing in this file can hand one to
 * `onTogglePlace`.
 *
 * `showAirports` is a flag rather than "pass an empty array when it is off",
 * because the array has two readers and only one of them is the layer. The
 * card's "Main airport" line is a fact about the place a user has just opened,
 * and a reader who never finds the map toggle still deserves it.
 */
describe("CountryLevel airport layer", () => {
  const LARGE = airportNear(LIMA, "LGE", 20, "large");
  const MEDIUM = airportNear(CUSCO, "MED", 20, "medium");
  const SMALL = airportNear(CUSCO, "SML", 8, "small");
  const AIRPORTS = [LARGE, MEDIUM, SMALL];

  test("draws nothing until the layer is asked for", () => {
    // §10.1's default, and it has to hold HERE rather than only in the toggle
    // that will drive it: `MapExplorer` has passed `airports` since PR1, so a
    // layer that drew whenever it was handed an array would already be on for
    // every country, with nothing anywhere to turn it off.
    const { container } = renderLevel({ airports: AIRPORTS });

    expect(container.querySelector("[data-airports]")).toBeNull();
    expect(airportMarks(container)).toHaveLength(0);
  });

  test("draws large and medium airports, never small", () => {
    // §10.1. The committed artifact is 1,148 large / 2,092 medium / 892 small,
    // so this drops a fifth of the set — and an allow-list is what drops it,
    // rather than `!== "small"`, so a size the upstream feed grows later is
    // drawn only once someone has said it should be.
    const { container } = renderLevel({ airports: AIRPORTS, showAirports: true });

    expect(airportCodes(container)).toEqual(["LGE", "MED"]);
  });

  test("airport marks are not in the tab order, and cost the list nothing", () => {
    const { container } = renderLevel({ airports: AIRPORTS, showAirports: true });

    for (const mark of airportMarks(container)) {
      // `READ_ONLY_MARKER`'s emptiness, one step further: there is no branch
      // here that could put any of these back.
      expect(mark.getAttribute("role")).toBeNull();
      expect(mark.getAttribute("tabindex")).toBeNull();
      expect(mark.getAttribute("aria-label")).toBeNull();
      expect(mark.getAttribute("aria-pressed")).toBeNull();
      expect(mark.getAttribute("aria-haspopup")).toBeNull();
    }

    // Out of the accessibility tree altogether, because the airport a reader
    // can act on is the one named on the card — a dialog they can open, focus
    // and read. A dot on a map with no name is not a second way to reach it.
    const layer = container.querySelector("[data-airports]")!;
    expect(layer).toHaveAttribute("aria-hidden");
    expect(layer.getAttribute("class")).toContain("pointer-events-none");

    // Plan 1's reachability criterion in miniature: the layer must not change
    // the number of controls a user can reach, in either direction. Task 7
    // re-runs the criterion itself.
    const withLayer = screen.getAllByRole("button").length;
    cleanup();
    renderLevel({ airports: AIRPORTS });
    expect(screen.getAllByRole("button")).toHaveLength(withLayer);
  });

  test("clicking an airport mark does not select anything", () => {
    // What makes the click inert is that no handler exists, which is §10.1's
    // invariant. `pointer-events-none` is not the thing under test: jsdom
    // dispatches straight through it, so a handler left on the mark would fire.
    const { container, props } = renderLevel({ airports: AIRPORTS, showAirports: true });
    const [mark] = airportMarks(container);

    fireEvent.click(mark);
    fireEvent.keyDown(mark, { key: "Enter" });
    fireEvent.mouseEnter(mark, { clientX: 10, clientY: 10 });

    expect(props.onTogglePlace).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Nor a tooltip: `PlacePopup` describes a MapPlace, and an airport is not
    // one. The hover reporter is typed on that and the layer never calls it.
    expect(props.onHoverPlace).not.toHaveBeenCalled();
  });

  test("airport marks sit inside the zoom wrapper, beneath the city markers", () => {
    const { container } = renderLevel({ airports: AIRPORTS, showAirports: true });
    const zoom = container.querySelector("[data-zoom]")!;
    const layer = container.querySelector("[data-airports]")!;

    // Everything drawn is inside the one transform group. A layer left outside
    // it would stay put while the country slid under it.
    expect(zoom.contains(layer)).toBe(true);
    for (const mark of airportMarks(container)) expect(zoom.contains(mark)).toBe(true);

    // And under the markers in paint order: the interactive layer is the one
    // that must never be obscured, decoratively or otherwise.
    const markerLayer = container.querySelector("[data-markers]")!;
    expect(
      layer.compareDocumentPosition(markerLayer) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("the zoom moves the mark; the mark does not move itself", () => {
    // An airport exactly on Lima, so the centre of its mark has a marker to be
    // checked against. The mark's `x` and `y` are a scaled inset off that
    // centre, which is the shape a raw length hides in — the centre itself is
    // where the projection put the airport and must not move at all.
    //
    // BOTH axes and the rotation, because the mark's position is three values
    // and any one of them alone leaves a hole. Pinned on x alone, `y={x -
    // AIRPORT_MARK / k}` draws every diamond on the x = y diagonal and passes,
    // which for this fixture puts Lima's airport 299 units up the frame from
    // Lima. Pinned on x and y alone, a rotation that lost its origin swings the
    // drawn square away about the viewBox corner while the attributes
    // underneath it stay exactly where they were.
    //
    // Drawn at BOTH framings, and deliberately: §6.5 filters cities to the
    // framed group through `cityProvince`, and nothing assigns an airport to a
    // province, so there is no honest filtered set to draw. It is also what
    // lets "every stroke, radius and font divides by k" see this layer at all.
    const airports = [airportNear(LIMA, "LGE", 0, "large")];
    const centre = (container: HTMLElement) => {
      const [mark] = airportMarks(container);
      const mid = (corner: string, side: string) =>
        Number(mark.getAttribute(corner)) + Number(mark.getAttribute(side)) / 2;
      return { x: mid("x", "width"), y: mid("y", "height") };
    };
    /**
     * The rotation, read as the string it is.
     *
     * The only transform on this map the zoom neither scales nor divides, and
     * the only one whose effect jsdom does not compute: it lays nothing out, so
     * the `x`/`y` above are the pre-rotation corner however the rotation is
     * written, and the attribute's own value is the only evidence there is that
     * the diamond spins in place rather than about the frame's corner.
     */
    const spin = (container: HTMLElement) => airportMarks(container)[0].getAttribute("transform");

    const flat = renderLevel({ airports, showAirports: true });
    const before = centre(flat.container);
    expect(before.x).toBeCloseTo(markerX(flat.container, "lima"), 9);
    expect(before.y).toBeCloseTo(markerY(flat.container, "lima"), 9);
    // Exact, not `toBeCloseTo`: the rotation's origin and the marker's own
    // `cx`/`cy` are the same two projected numbers stringified twice, so the
    // expected value can be spelled out — and every other origin, the dropped
    // one included, is a different string.
    const spun = `rotate(45 ${markerX(flat.container, "lima")} ${markerY(flat.container, "lima")})`;
    expect(spin(flat.container)).toBe(spun);
    cleanup();

    const zoomed = renderLevel({ airports, showAirports: true, region: "PE-ISL" });
    expect(airportMarks(zoomed.container)).toHaveLength(1);
    expect(centre(zoomed.container).x).toBeCloseTo(before.x, 9);
    expect(centre(zoomed.container).y).toBeCloseTo(before.y, 9);
    // The zoom moves the mark by moving the group around it, so the point it
    // spins about is the same number at both framings. Compared against the
    // flat render's string rather than against a re-read dot, because Lima's
    // marker is not drawn at this framing — §6.5 filters it out.
    expect(spin(zoomed.container)).toBe(spun);
  });

  test("the card names the main airport whether or not the layer is on", () => {
    // Two features over one array (§10.1 and §10.2). The toggle is about
    // clutter on the map; the card's line is a fact about the place a user has
    // just opened, and gating it on a control they may never have found would
    // withhold it from exactly the readers who never found the control.
    const { container } = renderLevel({ airports: [airportNear(CUSCO, "CUZ", 30)] });

    fireEvent.click(container.querySelector('[data-place="cusco"]')!);

    expect(airportMarks(container)).toHaveLength(0);
    expect(container.querySelector("[data-main-airport]")!.textContent).toBe(
      "Main airport: CUZ · 30 km"
    );
  });
});

/**
 * The card and the layer, held to ONE set (§10.1 + §10.2).
 *
 * Neither block above compares them. "draws large and medium airports, never
 * small" renders the layer and never opens a card; "the card shows the main
 * airport for the selected place" opens a card and never draws the layer. So
 * the two filtered the same array on different axes and nothing noticed — the
 * card ranking over all three sizes, the layer drawing an allow-list of two.
 *
 * A card naming a mark the map will not draw is the failure that matters: the
 * reader is handed a code, looks at the map for it, and there is nothing there.
 * This is the test that makes "the card's claim is verifiable on screen" a
 * property of the component rather than a coincidence of two fixtures.
 */
describe("CountryLevel airport agreement", () => {
  /**
   * A small airport near enough to Cusco to WIN the ranking: 3 km ranks
   * 3 + 15 = 18, against the medium's 20 - 0 = 20 (`SIZE_BONUS_KM`).
   *
   * That is the defect in one fixture. Every other airport fixture in this
   * file puts the small one far enough out to lose, which is exactly why the
   * disagreement survived: it is invisible on a set where the ranking and the
   * allow-list happen to pick the same row.
   */
  const AGREEMENT_AIRPORTS = [
    airportNear(LIMA, "LGE", 20, "large"),
    airportNear(CUSCO, "MED", 20, "medium"),
    airportNear(CUSCO, "SML", 3, "small"),
  ];

  /** The IATA code the open card claims, or null when it claims none. */
  function namedAirport(container: HTMLElement): string | null {
    const line = container.querySelector("[data-main-airport]");
    if (!line) return null;
    // The only run of three capitals in "Main airport: MED · 20 km" is the
    // code; the label carries none, which `MAIN_AIRPORT_LABEL` pins.
    return /\b([A-Z]{3})\b/.exec(line.textContent ?? "")?.[1] ?? null;
  }

  test("the airport the card names is one the layer drew", () => {
    const { container } = renderLevel({
      airports: AGREEMENT_AIRPORTS,
      showAirports: true,
    });

    // Both cities, because the disagreement is per place: Lima's ranking picks
    // a large airport and agrees by luck, Cusco's is the one that did not.
    // `isla` is left out on purpose — it is 3,500 km from every row here, so
    // its card carries no line and there would be nothing to compare.
    for (const id of ["lima", "cusco"]) {
      fireEvent.click(container.querySelector(`[data-place="${id}"]`)!);

      // Armed. A card with no line at all satisfies the membership below
      // vacuously, and a level that simply stopped naming airports is not the
      // fix this test is asking for.
      const named = namedAirport(container);
      expect(named, `no main airport named on ${id}`).not.toBeNull();
      expect(airportCodes(container)).toContain(named);
    }

    // And the layer is still a filter rather than a passthrough: `SML` is
    // absent from the map, which is what made naming it a broken promise.
    expect(airportCodes(container)).toEqual(["LGE", "MED"]);
  });

  test("the card names the drawable airport, not the small one that out-ranks it", () => {
    // The direction of the fix, stated once as a value rather than as a
    // membership: the ranking is restricted to the set the map can show, so
    // `MED` at 20 km wins a contest `SML` at 3 km would otherwise take.
    //
    // Asserted with the layer OFF, because the decision belongs to the card
    // and not to the toggle — §10.2's line is a fact about the open place, and
    // a reader who never finds the toggle gets the same answer.
    const { container } = renderLevel({ airports: AGREEMENT_AIRPORTS });

    fireEvent.click(container.querySelector('[data-place="cusco"]')!);

    expect(airportMarks(container)).toHaveLength(0);
    expect(container.querySelector("[data-main-airport]")!.textContent).toBe(
      "Main airport: MED · 20 km"
    );
  });
});
