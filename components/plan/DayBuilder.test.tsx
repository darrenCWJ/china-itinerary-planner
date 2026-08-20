import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  return { sent, mutate };
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

  test("adds a shelf place to the target day with one op", () => {
    const { sent } = setup([day(1, []), day(2, [])]);

    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 1" }));

    expect(sent).toHaveLength(1);
    expect(lastOp(sent)).toEqual({
      op: "addItem",
      day: 1,
      title: "Great Wall",
      slot: "morning",
    });
  });

  test("retargeting changes where the next add lands, not the visible day", () => {
    const { sent } = setup([day(1, []), day(2, [])]);

    fireEvent.click(screen.getByRole("radio", { name: "Day 02" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 2" }));

    expect(lastOp(sent)).toMatchObject({ day: 2 });
  });

  test("derives a real slot for an unconstrained activity", () => {
    // 'any' is common in the curated data; addItem demands a real slot and
    // §3.2.4 forbids a modal to ask for one.
    const { sent } = setup([day(1, [])]);

    fireEvent.click(screen.getByRole("button", { name: "Add Night market to day 1" }));

    expect(lastOp(sent)).toMatchObject({ slot: "morning" });
  });

  test("hides a shelf row while its add is in flight", () => {
    setup([day(1, [])]);

    fireEvent.click(screen.getByRole("button", { name: "Add Great Wall to day 1" }));

    expect(screen.queryByRole("button", { name: "Add Great Wall to day 1" })).not.toBeInTheDocument();
  });

  test("adds a hand-typed place from the custom row", () => {
    const { sent } = setup([day(1, [])]);

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
  });

  test("refuses to add an empty custom row", () => {
    setup([day(1, [])]);

    expect(screen.getByRole("button", { name: "Add your own place to day 1" })).toBeDisabled();
  });

  test("gives an untimed item its first block", () => {
    // The affordance every existing trip needs: buildItinerary never set
    // startMinutes, so without this the ±15m controls have nothing to act on.
    const { sent } = setup([day(1, [item("a", "Great Wall")])]);

    fireEvent.click(screen.getByRole("button", { name: "Give Great Wall a time" }));

    expect(lastOp(sent)).toEqual({
      op: "setTiming",
      day: 1,
      itemId: "a",
      startMinutes: 540,
      durationMinutes: 60,
    });
  });

  test("offers no ±15m control on an untimed item", () => {
    setup([day(1, [item("a", "Great Wall")])]);

    expect(
      screen.queryByRole("button", { name: "Lengthen Great Wall by 15 minutes" })
    ).not.toBeInTheDocument();
  });

  test("lengthens a timed block, resending its start", () => {
    const { sent } = setup([
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
  });

  test("shortens a timed block", () => {
    const { sent } = setup([
      day(1, [item("a", "Great Wall", { startMinutes: 540, durationMinutes: 60 })]),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Shorten Great Wall by 15 minutes" }));

    expect(lastOp(sent)).toMatchObject({ durationMinutes: 45 });
  });

  test("clears a block as a whole, never half", () => {
    const { sent } = setup([
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
  });

  test("moves a block with the arrow controls", () => {
    const { sent } = setup([day(1, [item("a", "First"), item("b", "Second")])]);

    fireEvent.click(screen.getByRole("button", { name: "Move Second up" }));

    expect(lastOp(sent)).toEqual({ op: "moveItem", day: 1, itemId: "b", direction: "up" });
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

  test("adding from the shelf moves focus to the next row, not to the body", () => {
    setup([day(1, [])]);

    const first = screen.getByRole("button", { name: "Add Great Wall to day 1" });
    first.focus();
    fireEvent.click(first);

    // Great Wall's row is gone — its key is in flight — so the next one takes
    // the focus rather than the document.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add Summer Palace to day 1" })
    );
  });

  test("emptying the shelf falls back to the custom input", () => {
    setup([day(1, [])]);

    for (const name of ["Great Wall", "Summer Palace", "Night market"]) {
      fireEvent.click(screen.getByRole("button", { name: `Add ${name} to day 1` }));
    }

    expect(document.activeElement).toBe(screen.getByLabelText("Something else"));
  });

  test("giving a block a time focuses its replacement controls", () => {
    setup([day(1, [item("x", "Summer Palace")])]);

    const setTime = screen.getByRole("button", { name: "Give Summer Palace a time" });
    setTime.focus();
    fireEvent.click(setTime);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Shorten Summer Palace by 15 minutes" })
    );
  });

  test("untiming a block focuses the control that replaces it", () => {
    setup([day(1, [item("x", "Summer Palace", { startMinutes: 540, durationMinutes: 60 })])]);

    const untime = screen.getByRole("button", { name: "Remove the time from Summer Palace" });
    untime.focus();
    fireEvent.click(untime);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Give Summer Palace a time" })
    );
  });

  test("moving a block to the top keeps focus on the block, not the body", () => {
    setup([day(1, [item("a", "Arrive"), item("b", "Summer Palace")])]);

    const up = screen.getByRole("button", { name: "Move Summer Palace up" });
    up.focus();
    fireEvent.click(up);

    // ↑ is now disabled — Summer Palace is first — so focus falls to ↓ on the
    // same block. The regression put it on <body>.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move Summer Palace down" })
    );
    expect(screen.getByRole("button", { name: "Move Summer Palace up" })).toBeDisabled();
  });

  test("a move that leaves the button enabled keeps focus on that button", () => {
    setup([
      day(1, [item("a", "Arrive"), item("b", "Summer Palace"), item("c", "Great Wall")]),
    ]);

    const up = screen.getByRole("button", { name: "Move Great Wall up" });
    up.focus();
    fireEvent.click(up);

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Great Wall up" }));
  });
});
