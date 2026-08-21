import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DayPlan, ScheduledItem } from "@/lib/itinerary";
import type { TripPayload } from "@/lib/tripShared";
import type { Activity } from "@/lib/types";
import { DayBuilder } from "./DayBuilder";

/**
 * The plan verifies the builder's layout by hand and says so; per the ruling, the
 * part that is behaviour rather than appearance is tested here — the **keyboard
 * path**, which spec §3.2.5 requires as the accessible equivalent of dragging.
 *
 * Every assertion goes through a control a keyboard user can reach, and asserts on
 * the op that reaches the server. Nothing here touches lane layout or pane widths.
 */

const activity = (name: string, timeOfDay: Activity["timeOfDay"] = "morning"): Activity => ({
  name,
  interests: [],
  slots: 1,
  timeOfDay,
});

const item = (id: string, title: string, extra: Partial<ScheduledItem> = {}): ScheduledItem => ({
  id,
  slot: "morning",
  kind: "activity",
  title,
  ...extra,
});

const day = (n: number, items: ScheduledItem[]): DayPlan => ({
  day: n,
  destinationId: "beijing",
  destinationName: "Beijing",
  items,
});

const payload = (days: DayPlan[]): TripPayload =>
  ({ version: 5, data: { plan: { days, tips: [] } } }) as unknown as TripPayload;

/**
 * Flushes the settle dispatch every op leaves behind, inside `act`.
 *
 * `useDayBuilder` sends an op from an effect and awaits `mutate`, so the
 * `opSettled` dispatch that follows lands a microtask *after* the click that
 * queued it — outside the `act(...)` `fireEvent` wraps around the click alone.
 * Undrained it re-renders the builder in the gap between the last assertion and
 * `cleanup()`, where no assertion can reach it: the op settles, the shelf
 * re-derives, and the only trace is React's act warning. It does not reach the
 * next test — each warning was raised against the test whose own click caused
 * it — but "after everything that checks it" is not a state to leave a component
 * in silently.
 *
 * Ops are strictly serialised — the effect sends the next only once the previous
 * settles — so this drains until a flush queues no further request, rather than
 * taking a fixed number of turns that would silently under-drain the day a test
 * adds one more click.
 *
 * Call it **after** the assertions. The mock `mutate` resolves without
 * republishing a payload, which the real accessor always does before it returns,
 * so the settled DOM here is a state production never reaches: `addFromShelf`
 * writes nothing to `days`, so a shelf row hidden while its add was in flight
 * comes back the moment that op settles.
 */
async function drain(sent: unknown[]) {
  for (let seen = -1; seen !== sent.length; ) {
    seen = sent.length;
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Captures the op bodies the builder posts, so tests assert on the wire. */
function setup(days: DayPlan[]) {
  const sent: unknown[] = [];
  const mutate = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return null;
  });
  render(
    <DayBuilder
      tripId="t1"
      payload={payload(days)}
      forcedAt={0}
      mutate={mutate}
      activitiesByDestination={{
        beijing: [activity("Great Wall"), activity("Summer Palace"), activity("Night market", "any")],
      }}
    />
  );
  return { sent, mutate, settle: () => drain(sent) };
}

const lastOp = (sent: unknown[]) => (sent[sent.length - 1] as { op: unknown }).op;

describe("DayBuilder keyboard path", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("gives the target-day chips a visible keyboard focus ring", () => {
    setup([day(1, []), day(2, [])]);

    // The radio is `sr-only` and the ring has to be on the label, or tabbing
    // onto a chip moves focus somewhere invisible — no focus indicator at all
    // (WCAG 2.4.7). Asserted on the class because jsdom runs no Tailwind; that
    // the variant actually compiles is checked against the build output.
    const chip = screen.getByRole("radio", { name: "Day 01" }).closest("label");
    expect(chip).not.toBeNull();
    expect(chip!.className).toMatch(/has-\[:focus-visible\]:outline/);
  });

  test("names the day that will receive an add", () => {
    // Spec §3.2.4's explicit target, readable without opening anything.
    setup([day(1, []), day(2, [])]);

    expect(screen.getByText("Adding to")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Day 01" })).toBeChecked();
  });

  test("adds a shelf place to the target day with one op", async () => {
    const { sent, settle } = setup([day(1, []), day(2, [])]);

    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 1" }));

    expect(sent).toHaveLength(1);
    expect(lastOp(sent)).toEqual({
      op: "addItem",
      day: 1,
      title: "Great Wall",
      slot: "morning",
    });

    await settle();
  });

  test("retargeting changes where the next add lands, not the visible day", async () => {
    const { sent, settle } = setup([day(1, []), day(2, [])]);

    fireEvent.click(screen.getByRole("radio", { name: "Day 02" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 2" }));

    expect(lastOp(sent)).toMatchObject({ day: 2 });

    await settle();
  });

  test("derives a real slot for an unconstrained activity", async () => {
    // 'any' is common in the curated data; addItem demands a real slot and
    // §3.2.4 forbids a modal to ask for one.
    const { sent, settle } = setup([day(1, [])]);

    fireEvent.click(screen.getByRole("button", { name: "Add Night market to day 1" }));

    expect(lastOp(sent)).toMatchObject({ slot: "morning" });

    await settle();
  });

  test("hides a shelf row while its add is in flight", async () => {
    const { settle } = setup([day(1, [])]);

    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 1" }));

    // Read before the drain, deliberately: "in flight" is the whole claim, and
    // once the op settles nothing in this harness keeps the row away — only the
    // republished payload does that, and the mock `mutate` has none.
    expect(screen.queryByRole("button", { name: "Add Great Wall to day 1" })).not.toBeInTheDocument();

    await settle();
  });

  test("adds a hand-typed place from the custom row", async () => {
    const { sent, settle } = setup([day(1, [])]);

    fireEvent.change(screen.getByLabelText("Something else"), {
      target: { value: "Grandma's house" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add your own place to day 1" }));

    expect(lastOp(sent)).toEqual({
      op: "addItem",
      day: 1,
      title: "Grandma's house",
      slot: "morning",
    });

    await settle();
  });

  test("refuses to add an empty custom row", () => {
    setup([day(1, [])]);

    expect(screen.getByRole("button", { name: "Add your own place to day 1" })).toBeDisabled();
  });

  test("gives an untimed item its first block", async () => {
    // The affordance every existing trip needs: buildItinerary never set
    // startMinutes, so without this the ±15m controls have nothing to act on.
    const { sent, settle } = setup([day(1, [item("a", "Great Wall")])]);

    fireEvent.click(screen.getByRole("button", { name: "Give Great Wall a time" }));

    expect(lastOp(sent)).toEqual({
      op: "setTiming",
      day: 1,
      itemId: "a",
      startMinutes: 540,
      durationMinutes: 60,
    });

    await settle();
  });

  test("offers no ±15m control on an untimed item", () => {
    setup([day(1, [item("a", "Great Wall")])]);

    expect(
      screen.queryByRole("button", { name: "Lengthen Great Wall by 15 minutes" })
    ).not.toBeInTheDocument();
  });

  test("lengthens a timed block, resending its start", async () => {
    const { sent, settle } = setup([
      day(1, [item("a", "Great Wall", { startMinutes: 540, durationMinutes: 60 })]),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Lengthen Great Wall by 15 minutes" }));

    expect(lastOp(sent)).toEqual({
      op: "setTiming",
      day: 1,
      itemId: "a",
      startMinutes: 540,
      durationMinutes: 75,
    });

    await settle();
  });

  test("shortens a timed block", async () => {
    const { sent, settle } = setup([
      day(1, [item("a", "Great Wall", { startMinutes: 540, durationMinutes: 60 })]),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Shorten Great Wall by 15 minutes" }));

    expect(lastOp(sent)).toMatchObject({ durationMinutes: 45 });

    await settle();
  });

  test("clears a block as a whole, never half", async () => {
    const { sent, settle } = setup([
      day(1, [item("a", "Great Wall", { startMinutes: 540, durationMinutes: 60 })]),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Remove the time from Great Wall" }));

    expect(lastOp(sent)).toEqual({
      op: "setTiming",
      day: 1,
      itemId: "a",
      startMinutes: null,
      durationMinutes: null,
    });

    await settle();
  });

  test("moves a block with the arrow controls", async () => {
    const { sent, settle } = setup([day(1, [item("a", "First"), item("b", "Second")])]);

    fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));

    expect(lastOp(sent)).toEqual({ op: "moveItem", day: 1, itemId: "b", direction: "up" });

    await settle();
  });

  test("disables the move controls at the edges", () => {
    setup([day(1, [item("a", "First"), item("b", "Second")])]);

    expect(screen.getByRole("button", { name: "Move First up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Second down" })).toBeDisabled();
  });

  test("marks a pushed block without moving its stored start", () => {
    const { sent } = setup([
      day(1, [
        item("a", "First", { startMinutes: 540, durationMinutes: 180 }),
        item("b", "Second", { startMinutes: 600, durationMinutes: 60 }),
      ]),
    ]);

    // The push is visible…
    expect(screen.getByText("pushed")).toBeInTheDocument();
    // …and rendering it wrote nothing. reflow is a read-time view; persisting it
    // would POST over a block another member owns.
    expect(sent).toHaveLength(0);
  });

  test("reports the day load", () => {
    setup([
      day(1, [
        item("a", "First", { startMinutes: 540, durationMinutes: 60 }),
        item("b", "Second", { startMinutes: 720, durationMinutes: 60 }),
      ]),
    ]);

    expect(screen.getByText(/2h planned/)).toBeInTheDocument();
    expect(screen.getByText(/1 gap/)).toBeInTheDocument();
  });

  test("shows the slot band for an untimed item rather than a made-up clock", () => {
    setup([day(1, [item("a", "Evening stroll", { slot: "evening" })])]);

    expect(screen.getByText("evening")).toBeInTheDocument();
    expect(screen.queryByText(/^\d\d:\d\d$/)).not.toBeInTheDocument();
  });

  test("surfaces a rejected op", async () => {
    const failing = vi.fn(async () => "Day not found");
    render(
      <DayBuilder
        tripId="t1"
        payload={payload([day(1, [])])}
        forcedAt={0}
        mutate={failing}
        activitiesByDestination={{ beijing: [activity("Great Wall")] }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Day not found");
  });
});

/**
 * Every control in this surface destroys itself when used, so without explicit
 * management focus lands on `<body>` and the keyboard user is thrown to the top
 * of the page after each operation. Each action worked; every *sequence* was
 * unusable, which is why the single-action tests above never caught it.
 *
 * These assert the thing spec §3.2.5 actually promises — that the keyboard path
 * is a usable equivalent of dragging, not merely a reachable one.
 */
describe("DayBuilder focus retention", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("adding from the shelf moves focus to the next row, not to the body", async () => {
    const { settle } = setup([day(1, [])]);

    const first = screen.getByRole("button", { name: "Add Great Wall to day 1" });
    first.focus();
    fireEvent.click(first);

    // Great Wall's row is gone — its key is in flight — so the next one takes
    // the focus rather than the document.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add Summer Palace to day 1" })
    );

    await settle();
  });

  test("emptying the shelf falls back to the custom input", async () => {
    const { settle } = setup([day(1, [])]);

    // Clicked without settling between, which is also what a member mashing the
    // shelf does: all three ops are in flight at once and the shelf has nothing
    // left to hold focus. Settling here instead would refill it after the first.
    for (const name of ["Great Wall", "Summer Palace", "Night market"]) {
      fireEvent.click(screen.getByRole("button", { name: `Add ${name} to day 1` }));
    }

    expect(document.activeElement).toBe(screen.getByLabelText("Something else"));

    await settle();
  });

  test("giving a block a time focuses its replacement controls", async () => {
    const { settle } = setup([day(1, [item("x", "Summer Palace")])]);

    const setTime = screen.getByRole("button", { name: "Give Summer Palace a time" });
    setTime.focus();
    fireEvent.click(setTime);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Shorten Summer Palace by 15 minutes" })
    );

    await settle();
  });

  test("untiming a block focuses the control that replaces it", async () => {
    const { settle } = setup([
      day(1, [item("x", "Summer Palace", { startMinutes: 540, durationMinutes: 60 })]),
    ]);

    const untime = screen.getByRole("button", { name: "Remove the time from Summer Palace" });
    untime.focus();
    fireEvent.click(untime);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Give Summer Palace a time" })
    );

    await settle();
  });

  test("moving a block to the top keeps focus on the block, not the body", async () => {
    const { settle } = setup([day(1, [item("a", "Arrive"), item("b", "Summer Palace")])]);

    const up = screen.getByRole("button", { name: "Move Summer Palace up" });
    up.focus();
    fireEvent.click(up);

    // ↑ is now disabled — Summer Palace is first — so focus falls to ↓ on the
    // same block. The regression put it on <body>.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move Summer Palace down" })
    );
    expect(screen.getByRole("button", { name: "Move Summer Palace up" })).toBeDisabled();

    await settle();
  });

  test("a move that leaves the button enabled puts focus back on that button", async () => {
    // Four blocks, so Great Wall can be pressed up twice without reaching the
    // top and turning into the disabled-fallback case above.
    const { settle } = setup([
      day(1, [
        item("a", "Arrive"),
        item("b", "Summer Palace"),
        item("c", "Night stop"),
        item("d", "Great Wall"),
      ]),
    ]);

    const up = screen.getByRole("button", { name: "Move Great Wall up" });
    up.focus();
    fireEvent.click(up);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Great Wall up" }));

    /**
     * The press above cannot tell the plan from inertia: the button is still
     * enabled, React keeps its node across the reorder, and a node that has
     * focus keeps it. That assertion passes with every `focus()` call in the
     * builder deleted — probed, and it did.
     *
     * So press it again from a blurred start. `fireEvent.click` is synthetic and
     * never moves focus the way a real pointer does, so with the document
     * holding focus the only thing that can put it back on ↑ is the component
     * choosing it — the first key of `focus.after('up:…', 'down:…')`, which the
     * test above only ever exercises through its second key.
     */
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Move Great Wall up" }));

    const upAgain = screen.getByRole("button", { name: "Move Great Wall up" });
    expect(upAgain).toBeEnabled();
    expect(document.activeElement).toBe(upAgain);

    await settle();
  });
});
