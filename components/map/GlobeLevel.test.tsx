import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GLOBE_CX, GLOBE_CY, GLOBE_R } from "@/lib/globeRotation";
import { GLOBE_TOPOLOGY_PATH } from "@/lib/globeTopology";
import { GlobeLevel } from "./GlobeLevel";
import { ZOOM_MS } from "./mapShared";
import { WORLD_FIXTURE } from "./worldFixture";

/**
 * The same world `WorldMap.test.tsx` is held to, re-shaped into the globe
 * asset's envelope: `points` plays the role `smallCountries` plays there.
 *
 * Spanning both hemispheres is the whole reason the fixture looks like this
 * (see `worldFixture.ts`). At the opening rotation — centred on China, the
 * app's default country — FR, JP, MT and SG face the viewer and NZ and PE do
 * not, which is the only configuration in which the back-face behaviour is
 * reachable by a test at all. A same-hemisphere fixture makes every one of
 * these tests pass for the wrong reason.
 */
const GLOBE_FIXTURE = {
  topology: WORLD_FIXTURE.topology,
  points: WORLD_FIXTURE.smallCountries,
};

/**
 * A hand-driven `requestAnimationFrame`.
 *
 * The suite has no other rAF in it, and `MapExplorer.test.tsx`'s `settle()`
 * drains microtasks until the DOM stops changing without advancing a single
 * frame. A test that waited for a real frame would therefore assert against
 * whatever the environment felt like scheduling, over a 650ms wall-clock
 * tween. Driving the frames by hand makes the tween's start, its middle and
 * its end three separate, deterministic assertions — and makes "no frame is
 * scheduled once it lands" something a test can actually see.
 */
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;
let clock: number;

function installFrameDriver() {
  frames = new Map();
  nextFrameId = 1;
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
}

/** Runs every frame scheduled right now, `ms` later on the component's clock. */
function advance(ms: number) {
  clock += ms;
  const due = [...frames.values()];
  frames.clear();
  act(() => {
    for (const frame of due) frame(clock);
  });
}

/** Runs the tween out. Returns how many frames are still pending — must be 0. */
function runSpin(): number {
  for (let i = 0; i < 10 && frames.size > 0; i++) advance(ZOOM_MS);
  return frames.size;
}

/**
 * jsdom reports every element as 0x0, so the component's client-pixel to
 * viewBox-unit conversion falls back to 1:1 and `dx` reads directly as viewBox
 * units — `90 / GLOBE_R` degrees each.
 */
function dragGlobe(
  svg: Element,
  dx: number,
  { pointerType = "mouse", cancel = false }: { pointerType?: string; cancel?: boolean } = {}
) {
  fireEvent.pointerDown(svg, { pointerId: 1, pointerType, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(svg, { pointerId: 1, pointerType, clientX: dx, clientY: 0 });
  if (cancel) fireEvent.pointerCancel(svg, { pointerId: 1, pointerType });
  else fireEvent.pointerUp(svg, { pointerId: 1, pointerType, clientX: dx, clientY: 0 });
}

const tabStops = () =>
  screen.getAllByRole("button").filter((el) => el.getAttribute("tabindex") === "0");

let fetchMock: ReturnType<typeof vi.fn>;

function serveFixture() {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => GLOBE_FIXTURE });
}

beforeEach(() => {
  installFrameDriver();
  fetchMock = vi.fn();
  serveFixture();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GlobeLevel", () => {
  test("fetches the globe asset, not the flat one", async () => {
    render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("combobox", { name: /pick from the list/i });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GLOBE_TOPOLOGY_PATH);
  });

  test("the A-Z list reaches every country, including the far side", async () => {
    // `entries` must not be a function of rotation: a country on the back of
    // the globe has no SVG node, and the list is how it stays reachable.
    render(<GlobeLevel onSelectCountry={() => {}} />);

    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    const codes = [...picker.querySelectorAll("option")].map((o) => o.getAttribute("value"));

    expect(codes).toEqual(["", "FR", "JP", "MT", "NZ", "PE", "SG"]);
  });

  test("draws no control for a country on the far side", async () => {
    // The back face must be genuinely absent, not present-but-transparent:
    // `opacity: 0` leaves a focusable, screen-reader-announced control with no
    // visible focus indicator (WCAG 2.2 AA 2.4.7 and 2.4.11), and `aria-hidden`
    // on a focusable element is its own violation.
    render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });

    expect(screen.getByRole("button", { name: "Japan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Zealand" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Peru" })).not.toBeInTheDocument();
  });

  test("keeps a point-layer country off the disc rather than floating it on top", async () => {
    // Orthographic clips polygons but NOT points: without the isFrontFacing
    // guard, Singapore's circle projects onto the middle of the disc, drawn
    // over Europe and fully clickable, from the other side of the planet.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });

    // Turn the Pacific away: Malta stays facing and keeps its point, Singapore
    // does not — and Peru, which was on the far side, comes round.
    dragGlobe(container.querySelector("svg")!, 420);

    expect(screen.getByRole("button", { name: "Malta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Peru" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Singapore" })).not.toBeInTheDocument();
  });

  test("draws the ocean as a circle, so the fill guard measures countries only", async () => {
    // `WorldMap.test.tsx` and the tint test below both collect every <path> and
    // assert an oklch fill. A <path fill="var(--surf-2)"> sphere would break
    // them for a reason that has nothing to do with what they check.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });

    const sphere = container.querySelector(`circle[r="${GLOBE_R}"]`);
    expect(sphere).toBeInTheDocument();
    expect(sphere).toHaveAttribute("cx", String(GLOBE_CX));
    expect(sphere).toHaveAttribute("cy", String(GLOBE_CY));
    for (const path of container.querySelectorAll("path")) {
      expect(path.getAttribute("fill")).not.toBe("var(--surf-2)");
    }
  });

  test("tints from the accent ramp, never a literal colour", async () => {
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });

    const paths = [...container.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.getAttribute("fill")).toMatch(/^oklch\(/);
  });

  test("turns the globe to show a country chosen from the list", async () => {
    // The reason rotate-on-select exists: picking a back-face country from the
    // A-Z list must show it, not highlight something invisible.
    const onSelect = vi.fn();
    render(<GlobeLevel onSelectCountry={onSelect} />);

    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    fireEvent.change(picker, { target: { value: "NZ" } });

    expect(onSelect).toHaveBeenCalledWith("NZ");
    expect(screen.queryByRole("button", { name: /New Zealand/ })).not.toBeInTheDocument();

    expect(runSpin()).toBe(0);
    expect(screen.getByRole("button", { name: /New Zealand/ })).toBeInTheDocument();
  });

  test("eases the spin over frames and schedules none once it lands", async () => {
    // Bounded and self-stopping. An ambient loop would either spin
    // MapExplorer.test.tsx's `settle()` to its cap or, worse, have every
    // assertion in this file read a frame that happened to be mid-flight.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    expect(frames.size).toBe(0);

    fireEvent.change(picker, { target: { value: "NZ" } });
    expect(frames.size).toBe(1);

    const japan = () => container.querySelector('[aria-label="Japan"] path')!.getAttribute("d");
    advance(ZOOM_MS * 0.1);
    const midFlight = japan();
    expect(frames.size).toBe(1);

    advance(ZOOM_MS);
    expect(frames.size).toBe(0);
    // It interpolated rather than jumping, and it is genuinely finished.
    expect(japan()).not.toEqual(midFlight);
  });

  test("always leaves exactly one mounted country in the tab order", async () => {
    // The keyboard trap. tabIndex 0 on a country with no rendered node leaves
    // the map with no tab stop at all, and Shift+Tab cannot re-enter it.
    render(<GlobeLevel selectedCountry="NZ" onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });

    expect(tabStops()).toHaveLength(1);
    expect(tabStops()[0]).toHaveAttribute("aria-label", "France");

    expect(runSpin()).toBe(0);
    expect(tabStops()).toHaveLength(1);
    expect(tabStops()[0]).toHaveAttribute("aria-label", "New Zealand (selected)");
  });

  test("keeps the selected country's card while it is on the far side", async () => {
    // `entries` feeds `selectedEntry`, which gates the <select> value and the
    // hero card. Pruning entries by rotation reads to a user as "the app forgot
    // which country I picked".
    render(<GlobeLevel selectedCountry="nz" onSelectCountry={() => {}} />);

    const picker = await screen.findByRole("combobox", { name: /pick from the list/i });
    expect(picker).toHaveValue("NZ");
    expect(screen.queryByRole("button", { name: /New Zealand/ })).not.toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
  });

  test("leaves a facing country where it is when it is selected", async () => {
    // Re-selecting something already in view must not re-centre the map under
    // the user — the spin is for countries that cannot be seen.
    render(<GlobeLevel selectedCountry="JP" onSelectCountry={() => {}} />);
    const japan = await screen.findByRole("button", { name: "Japan (selected)" });

    expect(frames.size).toBe(0);
    expect(japan).toHaveAttribute("tabindex", "0");
  });

  test("rotates on a pointer drag and does not select on release", async () => {
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    await screen.findByRole("button", { name: "France" });

    dragGlobe(container.querySelector("svg")!, -200);
    // The globe turned: New Zealand was on the far side and now is not.
    expect(screen.getByRole("button", { name: "New Zealand" })).toBeInTheDocument();

    // A drag that happens to end over a country is a drag, not a click.
    fireEvent.click(screen.getByRole("button", { name: "Japan" }));
    expect(onSelect).not.toHaveBeenCalled();

    // Exactly one click is swallowed — the one the gesture generated.
    fireEvent.click(screen.getByRole("button", { name: "Japan" }));
    expect(onSelect).toHaveBeenCalledWith("JP");
  });

  test("treats a press that barely moved as a tap, not a drag", async () => {
    // `DRAG_SLOP` is the whole difference between a globe you can turn and a
    // globe you cannot select anything on: a finger never lands perfectly
    // still, so a one-unit wobble must not swallow the tap it belongs to.
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    const france = await screen.findByRole("button", { name: "France" });
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "touch", clientX: 11, clientY: 10 });
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: "touch", clientX: 11, clientY: 10 });
    fireEvent.click(france);

    expect(onSelect).toHaveBeenCalledWith("FR");
  });

  test("abandons a drag cleanly when the browser cancels it", async () => {
    // The browser fires pointercancel the moment it claims a vertical scroll,
    // and no click follows it. Arming the click-suppression flag there would
    // swallow the next genuine tap instead of the gesture's own.
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    await screen.findByRole("button", { name: "France" });

    dragGlobe(container.querySelector("svg")!, 50, { pointerType: "touch", cancel: true });

    fireEvent.click(screen.getByRole("button", { name: "France" }));
    expect(onSelect).toHaveBeenCalledWith("FR");
  });

  test("is rotatable by touch, not only by mouse", async () => {
    // DayBuilder gates on `pointerType !== "mouse"` because tap-to-target is
    // its touch path. Copied here that would make the globe unrotatable on
    // every phone. The globe claims horizontal drags from any pointer type and
    // leaves vertical scrolling to the page through `touch-action: pan-y`.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });
    const svg = container.querySelector("svg")!;

    expect(svg).toHaveClass("touch-pan-y");
    expect(svg).not.toHaveClass("touch-none");

    dragGlobe(svg, -200, { pointerType: "touch" });

    expect(screen.getByRole("button", { name: "New Zealand" })).toBeInTheDocument();
  });

  test("ignores a second finger landing part-way through a drag", async () => {
    // One pointer owns the globe. Without the guard the second finger
    // re-anchors the rotation to itself, the first finger's remaining travel
    // is dropped, and its pointerup never reaches `endDrag` — so the click it
    // generates is judged by whichever gesture last wrote the flag.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });
    const svg = container.querySelector("svg")!;
    const touch = { pointerType: "touch", clientY: 0 };

    fireEvent.pointerDown(svg, { ...touch, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -100 });
    // A second finger lands and drags the other way. It owns nothing.
    fireEvent.pointerDown(svg, { ...touch, pointerId: 2, clientX: 500 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 2, clientX: 600 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -200 });
    fireEvent.pointerUp(svg, { ...touch, pointerId: 1, clientX: -200 });

    // The first finger's full 200 units of travel is what turned the globe.
    expect(screen.getByRole("button", { name: "New Zealand" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "France" })).not.toBeInTheDocument();
  });

  test("turns the globe when the keyboard moves to a country on the far side", async () => {
    // Focus drives rotation. `useCountrySelection` refuses to pretend a missing
    // node took focus; the globe is the renderer that can do something about
    // it, and focus lands once the rotation has brought the node into being.
    render(<GlobeLevel onSelectCountry={() => {}} />);
    const malta = await screen.findByRole("button", { name: "Malta" });

    // France, Japan, Malta, New Zealand, Peru, Singapore — one step past Malta.
    fireEvent.keyDown(malta, { key: "ArrowRight" });
    expect(screen.queryByRole("button", { name: "New Zealand" })).not.toBeInTheDocument();

    expect(runSpin()).toBe(0);
    const newZealand = screen.getByRole("button", { name: "New Zealand" });
    expect(newZealand).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(newZealand);
  });

  test("cancels an in-flight spin when it unmounts, rather than leaking it", async () => {
    // The picker is mounted and unmounted as the level changes, and a frame
    // still queued against a gone component is a leak the next level pays for.
    const { unmount } = render(<GlobeLevel selectedCountry="NZ" onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });
    expect(frames.size).toBe(1);

    unmount();

    expect(frames.size).toBe(0);
  });

  test("shows no country when the chosen code is not one the globe knows", async () => {
    // Same rule as the flat map: a code the globe never drew selects nothing,
    // rather than silently presenting the first country as chosen — and it
    // must not send the globe spinning toward a country that does not exist.
    render(<GlobeLevel selectedCountry="ZZ" onSelectCountry={() => {}} />);
    await screen.findByRole("button", { name: "France" });

    expect(screen.getByRole("combobox", { name: /pick from the list/i })).toHaveValue("");
    expect(frames.size).toBe(0);
  });

  test("offers a retry instead of crashing when the asset is missing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    render(<GlobeLevel onSelectCountry={() => {}} />);

    expect(await screen.findByText(/Couldn't load the world map/)).toBeInTheDocument();

    serveFixture();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "France" })).toBeInTheDocument();
  });
});
