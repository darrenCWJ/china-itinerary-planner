import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { DayPlan, ScheduledItem } from "@/lib/itinerary";
import type { TripPayload } from "@/lib/tripShared";
import type { Activity } from "@/lib/types";
import { useDayBuilder } from "./useDayBuilder";

/**
 * The reducer's rules live in lib/dayBuilder.test.ts and the keyboard path in
 * DayBuilder.test.tsx. What neither can see is the *sending* — this file's one
 * real job beyond wiring, and the place a browser found two POSTs on the wire
 * together where the docblock promises one.
 */

const activity = (name: string): Activity => ({
  name,
  interests: [],
  slots: 1,
  timeOfDay: "morning",
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
 * A `mutate` that parks every call, so a test can hold one request open and
 * watch whether a second goes out beside it — the thing a resolved-immediately
 * stub can never show.
 */
function deferredMutate() {
  const sent: Array<Record<string, unknown>> = [];
  const pending: Array<(error: string | null) => void> = [];
  const mutate = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<string | null>((resolve) => {
        sent.push(JSON.parse(String(init.body)).op);
        pending.push(resolve);
      })
  );
  return { sent, pending, mutate };
}

function setup(days: DayPlan[] = [day(1, [item("a", "Arrive")])]) {
  const { sent, pending, mutate } = deferredMutate();
  // Built once, outside the render callback. `renderHook`'s callback re-runs on
  // every render, so inline literals would hand the payload and activities
  // effects a fresh identity each time and spin forever — the real component
  // passes stable references down, which is what this mirrors.
  const options = {
    tripId: "t1",
    payload: payload(days),
    mutate,
    activitiesByDestination: {
      beijing: [activity("Great Wall"), activity("Summer Palace"), activity("Night market")],
    },
  };
  const view = renderHook(() => useDayBuilder(options));
  return { ...view, sent, pending, mutate };
}

describe("useDayBuilder op sending", () => {
  afterEach(cleanup);

  test("holds the second op until the first settles, and sends them FIFO", async () => {
    const { result, sent, pending, mutate } = setup();

    const keys = result.current.state.shelf
      .filter((row) => !row.isCustom)
      .map((row) => row.key);
    expect(keys.length).toBeGreaterThanOrEqual(2);

    act(() => { result.current.addFromShelf(keys[0]); });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));

    // Queued in its own render while the first is still open — the exact shape
    // that used to put two POSTs on the wire at once.
    act(() => { result.current.addFromShelf(keys[1]); });
    expect(result.current.state.pendingOps).toHaveLength(2);
    expect(mutate).toHaveBeenCalledTimes(1);

    act(() => { pending[0](null); });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ op: "addItem", title: "Great Wall" });
    expect(sent[1]).toMatchObject({ op: "addItem", title: "Summer Palace" });
  });

  test("a rejected op does not wedge the queue", async () => {
    const { result, sent, pending, mutate } = setup();
    const keys = result.current.state.shelf
      .filter((row) => !row.isCustom)
      .map((row) => row.key);

    act(() => { result.current.addFromShelf(keys[0]); });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    act(() => { result.current.addFromShelf(keys[1]); });
    expect(mutate).toHaveBeenCalledTimes(1);

    act(() => { pending[0]("That item no longer exists"); });

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(sent[1]).toMatchObject({ title: "Summer Palace" });
    expect(result.current.state.error).toBe("That item no longer exists");
  });

  /**
   * Staggered, one `act` each. Three adds in a *single* act are safe even
   * without the gate — React batches them into one render, so the effect fires
   * once and the old code also serialised. The bug only shows when each add
   * gets its own render while a request is open, which is what a real second
   * tap 5-30ms later produces.
   */
  test("three staggered adds go out one at a time, in order", async () => {
    const { result, sent, pending, mutate } = setup();
    const keys = result.current.state.shelf
      .filter((row) => !row.isCustom)
      .map((row) => row.key);
    expect(keys).toHaveLength(3);

    act(() => { result.current.addFromShelf(keys[0]); });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    act(() => { result.current.addFromShelf(keys[1]); });
    act(() => { result.current.addFromShelf(keys[2]); });

    expect(result.current.state.pendingOps).toHaveLength(3);
    expect(mutate).toHaveBeenCalledTimes(1);

    act(() => { pending[0](null); });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate).toHaveBeenCalledTimes(2);

    act(() => { pending[1](null); });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(3));

    expect(sent.map((op) => op.title)).toEqual([
      "Great Wall",
      "Summer Palace",
      "Night market",
    ]);
  });
});
