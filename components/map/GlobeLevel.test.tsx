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

/**
 * Flush the mount effect, the fetch it starts, and the renders that follow —
 * then let the test query synchronously.
 *
 * Used instead of `findBy*` throughout this file, for the reason
 * `MapExplorer.test.tsx` documents and one more that is specific to the globe.
 * `findBy*` resolves from a MutationObserver, which fires on the commit's DOM
 * change — but React flushes passive effects *after* that, so on a loaded
 * machine a `findByRole` can return with the countries painted and the
 * `[selected, topo]` effect that starts the opening spin not yet run. Every
 * assertion about that spin then reads a globe that never moved. Draining to a
 * fixed point inside `act` flushes effects as well as microtasks, which takes
 * the clock out of the assertion entirely.
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

/** Runs every frame scheduled right now, `ms` later on the component's clock. */
function advance(ms: number) {
  clock += ms;
  const due = [...frames.values()];
  frames.clear();
  act(() => {
    for (const frame of due) frame(clock);
  });
}

/** Frames a stepped spin is driven in, so `ZOOM_MS / 40` is one ~16ms frame. */
const SPIN_FRAMES = 40;

/**
 * Runs the tween out a frame at a time. Returns how many frames are still
 * pending — must be 0. `onFrame` observes the globe after every one of them.
 *
 * Asserts up front that something was actually in flight: a spin that never
 * started and a spin that has finished both leave zero pending frames, and a
 * helper that cannot tell them apart turns "the globe never moved" into a
 * silent pass.
 *
 * Stepping matters as much as running out. A single `advance(ZOOM_MS)` drove
 * `t` straight to 1 on the first iteration, collapsing the tween to one frame,
 * so no test ever observed its middle — where the origin country's node
 * unmounts at the limb and the target's does not exist yet. Deleting the "wait
 * until the node exists" gate in `GlobeLevel.tsx` left all 20 tests green
 * against the jumped version; against the stepped one it does not.
 */
function runSpin(onFrame?: () => void): number {
  expect(frames.size, "expected a spin to be in flight").toBeGreaterThan(0);
  // Three tweens' worth of headroom, so a spin re-targeted part-way through
  // still runs out rather than being reported as still pending.
  for (let i = 0; i < SPIN_FRAMES * 3 && frames.size > 0; i++) {
    advance(ZOOM_MS / SPIN_FRAMES);
    onFrame?.();
  }
  return frames.size;
}

/**
 * jsdom reports every element as 0x0, so the component's client-pixel to
 * viewBox-unit conversion falls back to 1:1 and `dx` reads directly as viewBox
 * units — `90 / GLOBE_R` degrees each.
 *
 * `isPrimary` is spelled out because jsdom's `PointerEvent` defaults it to
 * `false`, which no browser does for the pointer that begins a gesture: the
 * first pointer of a type is always its own type's primary. Left at the
 * default, every drag in this file would be simulating a second finger.
 */
function dragGlobe(
  svg: Element,
  dx: number,
  { pointerType = "mouse", cancel = false }: { pointerType?: string; cancel?: boolean } = {}
) {
  const down = { pointerId: 1, pointerType, isPrimary: true, clientX: 0, clientY: 0 };
  fireEvent.pointerDown(svg, down);
  fireEvent.pointerMove(svg, { pointerId: 1, pointerType, clientX: dx, clientY: 0 });
  if (cancel) fireEvent.pointerCancel(svg, { pointerId: 1, pointerType });
  else fireEvent.pointerUp(svg, { pointerId: 1, pointerType, clientX: dx, clientY: 0 });
}

const country = (name: string | RegExp) => screen.getByRole("button", { name });
const noCountry = (name: string | RegExp) => screen.queryByRole("button", { name });
const picker = () => screen.getByRole("combobox", { name: /pick from the list/i });
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
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(GLOBE_TOPOLOGY_PATH);
  });

  test("the A-Z list reaches every country, including the far side", async () => {
    // `entries` must not be a function of rotation: a country on the back of
    // the globe has no SVG node, and the list is how it stays reachable.
    render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();

    const codes = [...picker().querySelectorAll("option")].map((o) => o.getAttribute("value"));

    expect(codes).toEqual(["", "FR", "JP", "MT", "NZ", "PE", "SG"]);
  });

  test("draws no control for a country on the far side", async () => {
    // The back face must be genuinely absent, not present-but-transparent:
    // `opacity: 0` leaves a focusable, screen-reader-announced control with no
    // visible focus indicator (WCAG 2.2 AA 2.4.7 and 2.4.11), and `aria-hidden`
    // on a focusable element is its own violation.
    render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();

    expect(country("France")).toBeInTheDocument();
    expect(country("Japan")).toBeInTheDocument();
    expect(noCountry("New Zealand")).not.toBeInTheDocument();
    expect(noCountry("Peru")).not.toBeInTheDocument();
  });

  test("keeps a point-layer country off the disc rather than floating it on top", async () => {
    // Orthographic clips polygons but NOT points: without the isFrontFacing
    // guard, Singapore's circle projects onto the middle of the disc, drawn
    // over Europe and fully clickable, from the other side of the planet.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();

    // Turn the Pacific away: Malta stays facing and keeps its point, Singapore
    // does not — and Peru, which was on the far side, comes round.
    dragGlobe(container.querySelector("svg")!, 420);

    expect(country("Malta")).toBeInTheDocument();
    expect(country("Peru")).toBeInTheDocument();
    expect(noCountry("Singapore")).not.toBeInTheDocument();
  });

  test("draws the ocean as a circle, so the fill guard measures countries only", async () => {
    // `WorldMap.test.tsx` and the tint test below both collect every <path> and
    // assert an oklch fill. A <path fill="var(--surf-2)"> sphere would break
    // them for a reason that has nothing to do with what they check.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();

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
    await settle();

    const paths = [...container.querySelectorAll("path")];
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.getAttribute("fill")).toMatch(/^oklch\(/);
  });

  test("turns the globe to show a country chosen from the list", async () => {
    // The reason rotate-on-select exists: picking a back-face country from the
    // A-Z list must show it, not highlight something invisible.
    const onSelect = vi.fn();
    render(<GlobeLevel onSelectCountry={onSelect} />);
    await settle();

    fireEvent.change(picker(), { target: { value: "NZ" } });

    expect(onSelect).toHaveBeenCalledWith("NZ");
    expect(noCountry(/New Zealand/)).not.toBeInTheDocument();

    expect(runSpin()).toBe(0);
    expect(country(/New Zealand/)).toBeInTheDocument();
  });

  test("eases the spin over frames and schedules none once it lands", async () => {
    // Bounded and self-stopping. An ambient loop would either spin
    // MapExplorer.test.tsx's `settle()` to its cap or, worse, have every
    // assertion in this file read a frame that happened to be mid-flight.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    expect(frames.size).toBe(0);

    fireEvent.change(picker(), { target: { value: "NZ" } });
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
    await settle();

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
    await settle();

    expect(picker()).toHaveValue("NZ");
    expect(noCountry(/New Zealand/)).not.toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
  });

  test("leaves a facing country where it is when it is selected", async () => {
    // Re-selecting something already in view must not re-centre the map under
    // the user — the spin is for countries that cannot be seen.
    render(<GlobeLevel selectedCountry="JP" onSelectCountry={() => {}} />);
    await settle();

    expect(frames.size).toBe(0);
    expect(country("Japan (selected)")).toHaveAttribute("tabindex", "0");
  });

  test("rotates on a pointer drag and does not select on release", async () => {
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    await settle();

    dragGlobe(container.querySelector("svg")!, -200);
    // The globe turned: New Zealand was on the far side and now is not.
    expect(country("New Zealand")).toBeInTheDocument();

    // A drag that happens to end over a country is a drag, not a click.
    fireEvent.click(country("Japan"));
    expect(onSelect).not.toHaveBeenCalled();

    // Exactly one click is swallowed — the one the gesture generated.
    fireEvent.click(country("Japan"));
    expect(onSelect).toHaveBeenCalledWith("JP");
  });

  test("treats a press that barely moved as a tap, not a drag", async () => {
    // `DRAG_SLOP` is the whole difference between a globe you can turn and a
    // globe you cannot select anything on: a finger never lands perfectly
    // still, so a one-unit wobble must not swallow the tap it belongs to.
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    await settle();
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "touch", clientX: 11, clientY: 10 });
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: "touch", clientX: 11, clientY: 10 });
    fireEvent.click(country("France"));

    expect(onSelect).toHaveBeenCalledWith("FR");
  });

  test("abandons a drag cleanly when the browser cancels it", async () => {
    // The browser fires pointercancel the moment it claims a vertical scroll,
    // and no click follows it. Arming the click-suppression flag there would
    // swallow the next genuine tap instead of the gesture's own.
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    await settle();

    dragGlobe(container.querySelector("svg")!, 50, { pointerType: "touch", cancel: true });

    fireEvent.click(country("France"));
    expect(onSelect).toHaveBeenCalledWith("FR");
  });

  test("is rotatable by touch, not only by mouse", async () => {
    // DayBuilder gates on `pointerType !== "mouse"` because tap-to-target is
    // its touch path. Copied here that would make the globe unrotatable on
    // every phone. The globe claims horizontal drags from any pointer type and
    // leaves vertical scrolling to the page through `touch-action: pan-y`.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;

    expect(svg).toHaveClass("touch-pan-y");
    expect(svg).not.toHaveClass("touch-none");

    dragGlobe(svg, -200, { pointerType: "touch" });

    expect(country("New Zealand")).toBeInTheDocument();
  });

  test("ignores a second finger landing part-way through a drag", async () => {
    // One pointer owns the globe. Without the guard the second finger
    // re-anchors the rotation to itself, the first finger's remaining travel
    // is dropped, and its pointerup never reaches `endDrag` — so the click it
    // generates is judged by whichever gesture last wrote the flag.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;
    const touch = { pointerType: "touch", clientY: 0 };

    fireEvent.pointerDown(svg, { ...touch, pointerId: 1, isPrimary: true, clientX: 0 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -100 });
    // A second finger lands and drags the other way. It owns nothing.
    fireEvent.pointerDown(svg, { ...touch, pointerId: 2, isPrimary: false, clientX: 500 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 2, clientX: 600 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -200 });
    fireEvent.pointerUp(svg, { ...touch, pointerId: 1, clientX: -200 });

    // The first finger's full 200 units of travel is what turned the globe.
    expect(country("New Zealand")).toBeInTheDocument();
    expect(noCountry("France")).not.toBeInTheDocument();
  });

  test("recovers from a gesture whose pointerup never arrived", async () => {
    // `drag.current` is cleared only by `endDrag`, which itself needs a
    // pointerup or pointercancel carrying the held id. A terminating event that
    // never arrives — capture claimed by a browser gesture, a context menu
    // eating the release, a throw out of `setPointerCapture` — strands the ref,
    // and from then on every press is rejected and the globe never turns again.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;
    const mouse = { pointerId: 1, pointerType: "mouse", clientY: 0 };

    // A press and a drag, and then nothing at all: no up, no cancel.
    fireEvent.pointerDown(svg, { ...mouse, isPrimary: true, clientX: 0 });
    fireEvent.pointerMove(svg, { ...mouse, clientX: -200 });
    expect(noCountry("Peru")).not.toBeInTheDocument();

    // A complete second press-drag-release on the same pointer — which is what
    // a mouse always is, and proof the held gesture is long gone.
    dragGlobe(svg, -200);

    // It turned the globe the rest of the way round rather than being ignored.
    expect(country("Peru")).toBeInTheDocument();
  });

  test("starts no rotation from a right-click or a non-primary pointer", async () => {
    // A secondary button currently begins a rotation drag, and the context menu
    // it opens is the likeliest way for a pointerup to go missing — the lockout
    // above, entered by an ordinary right-click on the map.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;

    fireEvent.pointerDown(svg, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 2,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "mouse", clientX: 420, clientY: 0 });

    // +420 is the drag the point-layer test uses to bring Peru round and take
    // Singapore away. Neither happened, so nothing rotated.
    expect(country("Singapore")).toBeInTheDocument();
    expect(noCountry("Peru")).not.toBeInTheDocument();

    // Nor does a pointer that is not its type's primary — a second finger
    // reports exactly this, and it must not be able to arm a drag either.
    fireEvent.pointerDown(svg, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: false,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(svg, { pointerId: 2, pointerType: "touch", clientX: 420, clientY: 0 });

    expect(country("Singapore")).toBeInTheDocument();
    expect(noCountry("Peru")).not.toBeInTheDocument();
  });

  test("hands the globe back when the browser takes pointer capture away", async () => {
    // The browser-side half of the same recovery: capture can be revoked
    // without a pointerup ever being delivered, and `lostpointercapture` is the
    // only notice the page gets that the gesture is over.
    //
    // This and the same-id re-press above are the whole of the recovery that a
    // test can reach. `onPointerDown`'s third route — the element reporting it
    // no longer captures the held pointer — is unreachable here for the same
    // reason `setPointerCapture` always was: jsdom implements neither method,
    // so the clause reads `undefined === false` and is inert under test.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;
    const touch = { pointerType: "touch", clientY: 0 };

    fireEvent.pointerDown(svg, { ...touch, pointerId: 1, isPrimary: true, clientX: 0 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -200 });
    fireEvent.lostPointerCapture(svg, { ...touch, pointerId: 1 });

    // A fresh finger, under an id the stranded gesture would have rejected.
    fireEvent.pointerDown(svg, { ...touch, pointerId: 2, isPrimary: true, clientX: 0 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 2, clientX: -200 });
    fireEvent.pointerUp(svg, { ...touch, pointerId: 2, clientX: -200 });

    expect(country("Peru")).toBeInTheDocument();
  });

  test("keeps a pen that lands mid-drag from stealing the gesture", async () => {
    // The half of "one pointer owns the globe" that `isPrimary` cannot cover: a
    // pen is the primary pointer of its own type, so a rule about second
    // fingers says nothing about it — and the finger has not let go.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;
    const touch = { pointerType: "touch", clientY: 0 };
    const pen = { pointerType: "pen", clientY: 0 };

    fireEvent.pointerDown(svg, { ...touch, pointerId: 1, isPrimary: true, clientX: 0 });
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -200 });
    fireEvent.pointerDown(svg, { ...pen, pointerId: 2, isPrimary: true, clientX: 0 });
    fireEvent.pointerMove(svg, { ...pen, pointerId: 2, clientX: 400 });
    // The finger's full travel is what turned the globe; the pen's +400 the
    // other way would have left Peru on the far side.
    fireEvent.pointerMove(svg, { ...touch, pointerId: 1, clientX: -400 });
    fireEvent.pointerUp(svg, { ...touch, pointerId: 1, clientX: -400 });

    expect(country("Peru")).toBeInTheDocument();
  });

  test("turns the globe when the keyboard moves to a country on the far side", async () => {
    // Focus drives rotation. `useCountrySelection` refuses to pretend a missing
    // node took focus; the globe is the renderer that can do something about
    // it, and focus lands once the rotation has brought the node into being.
    render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();

    // France, Japan, Malta, New Zealand, Peru, Singapore — one step past Malta.
    fireEvent.keyDown(country("Malta"), { key: "ArrowRight" });
    expect(noCountry("New Zealand")).not.toBeInTheDocument();

    expect(runSpin()).toBe(0);
    const newZealand = country("New Zealand");
    expect(newZealand).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(newZealand);
  });

  test("never leaves focus on the page body part-way through a spin", async () => {
    // The origin country's node unmounts as it crosses the limb, and neither
    // jsdom nor a browser fires `blur` or `focusout` when a focused element is
    // removed — `document.activeElement` falls back to <body>, where an arrow
    // keypress reaches no handler and is silently swallowed. Measured against
    // the real `public/world-globe.json`, 18 of the 104 arrow transitions that
    // need a spin have such a gap, the worst about 104ms of dead zone for a
    // keyboard user holding an arrow key down.
    //
    // `fireEvent.keyDown` does not move focus, which is why the far-side test
    // above never reached this: the origin has to actually hold the caret.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;

    // Malta facing and New Zealand far behind it — the configuration where the
    // origin leaves the disc before the target arrives on it.
    dragGlobe(svg, 420);
    const malta = country("Malta");
    act(() => malta.focus());
    expect(document.activeElement).toBe(malta);

    fireEvent.keyDown(malta, { key: "ArrowRight" });

    const bothGone = () =>
      noCountry("Malta") === null && noCountry("New Zealand") === null;
    let strandedFrames = 0;
    let sawNeitherNode = false;
    runSpin(() => {
      if (document.activeElement === document.body) strandedFrames++;
      if (bothGone()) sawNeitherNode = true;
    });

    // Without this the test could pass on geometry rather than on the fix.
    expect(sawNeitherNode, "expected a frame with neither node mounted").toBe(true);
    expect(strandedFrames).toBe(0);
    expect(document.activeElement).toBe(country("New Zealand"));
    // Parked on the map, never inserted into the Tab order.
    expect(svg).toHaveAttribute("tabindex", "-1");
  });

  test("keeps arrow keys working while the caret is parked mid-spin", async () => {
    // Parking the caret is only half of it: the country the key logically
    // belongs to still has no node to carry a handler, so a key pressed in the
    // gap would land on the <svg> and stop there. The svg runs that country's
    // handler on its behalf, which is what turns "focus is not on <body>" into
    // "the arrow key still does something".
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;

    dragGlobe(svg, 420);
    const malta = country("Malta");
    act(() => malta.focus());
    fireEvent.keyDown(malta, { key: "ArrowRight" }); // Malta → New Zealand

    // Step to the frame where Malta's node has gone and New Zealand's does not
    // exist yet — the dead zone the caret is parked through.
    let parked = false;
    for (let i = 0; i < SPIN_FRAMES && !parked; i++) {
      advance(ZOOM_MS / SPIN_FRAMES);
      parked = document.activeElement === svg;
    }
    expect(parked, "expected the caret to be parked on the map").toBe(true);

    // Back one, onto the country whose node just left the disc — so the move
    // is provably to something unmounted, and the globe has to turn round.
    fireEvent.keyDown(svg, { key: "ArrowLeft" }); // New Zealand → Malta
    expect(runSpin()).toBe(0);

    expect(document.activeElement).toBe(country("Malta"));
  });

  test("selects from the parked caret and still lands focus on the country", async () => {
    // Enter is the key most likely to be pressed at the end of a keyboard
    // journey, and it does not go through `onFocusOffscreen` — it goes through
    // `pickCountry`, which turns the globe, which cancels the spin. Whatever
    // clears the pending focus target must not be on that path, or the caret is
    // left on the map with no country under it and every later key dead.
    const onSelect = vi.fn();
    const { container } = render(<GlobeLevel onSelectCountry={onSelect} />);
    await settle();
    const svg = container.querySelector("svg")!;

    dragGlobe(svg, 420);
    const malta = country("Malta");
    act(() => malta.focus());
    fireEvent.keyDown(malta, { key: "ArrowRight" }); // Malta → New Zealand

    let parked = false;
    for (let i = 0; i < SPIN_FRAMES && !parked; i++) {
      advance(ZOOM_MS / SPIN_FRAMES);
      parked = document.activeElement === svg;
    }
    expect(parked, "expected the caret to be parked on the map").toBe(true);

    fireEvent.keyDown(svg, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("NZ");

    expect(runSpin()).toBe(0);

    // The country it selected is the country it left the caret on.
    expect(document.activeElement).toBe(country("New Zealand"));
  });

  test("does not steal the caret back when a drag cancels the spin it belonged to", async () => {
    // `cancelSpin` stops the tween, but the focus target the spin was carrying
    // used to outlive it — so the focus was delivered by the *user's own drag*
    // instead, the caret jumping to a country the moment their gesture brought
    // it round. On a real page `.focus()` on an SVG node scrolls it into view
    // as well, so the map moves under the hand that is moving it.
    const { container } = render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();
    const svg = container.querySelector("svg")!;

    // Japan and Malta are 91° apart, so one turn of the globe can hold both —
    // which is what makes the caret's owner still be here at the end.
    dragGlobe(svg, -120); // Malta just off the disc, Japan dead centre
    const japan = country("Japan");
    act(() => japan.focus());
    fireEvent.keyDown(japan, { key: "ArrowRight" }); // Japan → Malta, far side
    expect(frames.size).toBe(1);

    // The user grabs the globe rather than waiting, and turns Malta into view
    // themselves.
    dragGlobe(svg, 220);

    expect(frames.size).toBe(0);
    expect(country("Malta")).toBeInTheDocument();
    expect(document.activeElement).toBe(country("Japan"));
  });

  test("cancels an in-flight spin when it unmounts, rather than leaking it", async () => {
    // The picker is mounted and unmounted as the level changes, and a frame
    // still queued against a gone component is a leak the next level pays for.
    const { unmount } = render(<GlobeLevel selectedCountry="NZ" onSelectCountry={() => {}} />);
    await settle();
    expect(frames.size).toBe(1);

    unmount();

    expect(frames.size).toBe(0);
  });

  test("shows no country when the chosen code is not one the globe knows", async () => {
    // Same rule as the flat map: a code the globe never drew selects nothing,
    // rather than silently presenting the first country as chosen — and it
    // must not send the globe spinning toward a country that does not exist.
    render(<GlobeLevel selectedCountry="ZZ" onSelectCountry={() => {}} />);
    await settle();

    expect(picker()).toHaveValue("");
    expect(frames.size).toBe(0);
  });

  test("offers a retry instead of crashing when the asset is missing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    render(<GlobeLevel onSelectCountry={() => {}} />);
    await settle();

    expect(screen.getByText(/Couldn't load the world map/)).toBeInTheDocument();

    serveFixture();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();

    expect(country("France")).toBeInTheDocument();
  });
});
