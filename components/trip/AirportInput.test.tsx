import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Airport } from "@/lib/airports";
import { AirportInput } from "./AirportInput";

/**
 * `fireEvent`, not `@testing-library/user-event` — the latter is not a
 * dependency of this repo and every existing component test uses `fireEvent`.
 */

/** What /api/airports/search returns — full Airport rows. */
const HITS: Airport[] = [
  { iata: "TNA", icao: "ZSJN", name: "Jinan Yaoqiang International Airport", municipality: "Jinan", country: "CN", lat: 36.857, lon: 117.216, size: "large" },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
];

/**
 * `"A".repeat(70) (XXL)"` is 76 chars — over the 60-char cap — but its
 * municipality "Shortcity (XXL)" is only 15, so displayValue should fall back
 * to it. Exercises Finding 1's second branch.
 */
const LONG_NAME_WITH_MUNICIPALITY: Airport = {
  iata: "XXL",
  icao: null,
  name: "A".repeat(70),
  municipality: "Shortcity",
  country: "US",
  lat: 0,
  lon: 0,
  size: "large",
};

/**
 * `"B".repeat(80) (YYL)"` is 86 chars and there is no municipality to fall
 * back to, so displayValue must truncate the name so the whole string lands
 * exactly at the 60-char cap. Exercises Finding 1's third (truncation)
 * branch, otherwise unreachable against today's artifact.
 */
const LONG_NAME_NO_MUNICIPALITY: Airport = {
  iata: "YYL",
  icao: null,
  name: "B".repeat(80),
  municipality: null,
  country: "US",
  lat: 0,
  lon: 0,
  size: "large",
};

/**
 * The component is controlled, so a bare render would never show typed text.
 * This holds the value the way TicketForm does.
 */
function Harness({
  onValue,
  onPick,
}: { onValue?: (v: string) => void; onPick?: (airport: Airport) => void } = {}) {
  const [value, setValue] = useState("");
  return (
    <AirportInput
      label="From"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      onPick={onPick}
    />
  );
}

/**
 * Fires focus before change: a real user cannot type into a field without
 * focusing it first, and the component now gates opening the suggestion list
 * on focus (reviewer finding — see the "focus lifecycle" describe block
 * below). `fireEvent.change` alone never focuses the element, so every test
 * that expects the list to open has to go through this helper rather than
 * dispatching change directly.
 */
const type = (text: string) => {
  const input = screen.getByLabelText("From");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
};

/**
 * Drain to a fixed point — pending effects, the promises they started, and the
 * renders those cause — then let the test query synchronously.
 *
 * Kept identical to the helper in `components/map/MapExplorer.test.tsx` and
 * `lib/useTripPayload.test.tsx` so the three read as one pattern. Their
 * docblocks carry the general argument: a wait measured against a wall clock
 * cannot tell "has not finished yet" apart from "is never going to happen", so
 * it reports the second when it means the first.
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

/**
 * Wait out the component's 300ms debounce, then drain.
 *
 * Every wait in this file is this shape, because everything the component does
 * hangs off one real `setTimeout(…, DEBOUNCE_MS)`. The sleep is what lets that
 * timer *fire*; `settle()` is what makes its consequences *land*. Splitting
 * the wait along that seam is the whole point of the helper.
 *
 * A bare 450ms sleep used to be the entire wait, and its 150ms over the
 * debounce looked like headroom. It is not headroom, because both timers are
 * read off the same blocked clock: starve the event loop past 450ms and the
 * debounce (due at +300) and the sleep (due at +450) come due together and run
 * back to back inside one timers phase. The sleep then resolves in the very
 * turn the fetch was issued, with the promise settlement and React's re-render
 * still queued behind it, and the assertion reads a DOM exactly one commit
 * stale. That was measured, not assumed: at the moment of the failing
 * assertion `fetch` had already been called once, and a single `act` flush —
 * no further wall-clock time at all — flipped `aria-expanded` back to "false".
 *
 * What survives is only the half of the old sleep that is a real guarantee: a
 * timer due at +450 runs after one due at +300 however slow the machine,
 * because ordering does not depend on speed. Waiting for the work itself is
 * then `settle()`'s job, and it waits for the work rather than racing a clock.
 * vitest's own testTimeout stays as the backstop for a genuine hang, which is
 * the only thing a timeout should be catching.
 */
async function pastDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 450));
  await settle();
}

/** Swaps the default HITS response for a specific set of results, for tests
 * that need to exercise a particular airport's display string. */
function stubSearchResults(results: Airport[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ results }) }) as unknown as Response)
  );
}

beforeEach(() => {
  stubSearchResults(HITS);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AirportInput", () => {
  test("renders its label and current value", () => {
    render(<AirportInput label="From" value="Beijing" onChange={() => {}} />);
    expect(screen.getByLabelText("From")).toHaveValue("Beijing");
  });

  test("reports every keystroke, so free typing still works", () => {
    const onChange = vi.fn();
    render(<AirportInput label="From" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Grandma's airstrip" } });
    expect(onChange).toHaveBeenCalledWith("Grandma's airstrip");
  });

  describe("focus lifecycle (reviewer finding: opens on a field nobody focused)", () => {
    test("mounting with a prefilled value that matches airports does not open the list", async () => {
      // Editing a saved ticket prefills `from`/`to` on mount (TicketsTab's
      // `toFields`), and "Edit gateways" prefills both of its fields the
      // moment it opens. Nobody focused them, so the search must not even
      // fire: the only thing its answer could do is open a list under a field
      // with no focus to blur and no outside-click handler to close it, so the
      // request was pure waste (two of them, on every gateway edit).
      render(<AirportInput label="From" value="Beijing" onChange={() => {}} />);

      // All three assertions are assertions of absence, so they would hold
      // just as well against a response this test had simply not waited for.
      // Draining is what makes them mean "the debounce came due and nothing
      // happened" rather than "nothing has happened yet".
      await pastDebounce();

      expect(fetch).not.toHaveBeenCalled();
      expect(screen.getByLabelText("From")).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    test("a focused field with a prefilled value does fetch", async () => {
      // The gate is on focus, not on being prefilled. The same saved ticket,
      // once the traveller clicks into the field and edits it, must suggest
      // exactly as an empty field does — otherwise the gate above would have
      // quietly turned every prefilled field into a plain text box.
      const { rerender } = render(<AirportInput label="From" value="Beijing" onChange={() => {}} />);
      fireEvent.focus(screen.getByLabelText("From"));
      // `value` is what the effect watches, so the request rides on the edit
      // rather than on the focus: focusing alone changes nothing to search for.
      rerender(<AirportInput label="From" value="Beijing C" onChange={() => {}} />);

      await pastDebounce();

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("From")).toHaveAttribute("aria-expanded", "true");
    });

    test("blurring during the debounce window does not reopen the list afterwards", async () => {
      render(<Harness />);
      const input = screen.getByLabelText("From");
      type("Jinan");

      // Well inside the 300ms debounce window: the fetch has not fired yet.
      fireEvent.blur(input);

      // Past the debounce window and the mocked fetch's resolution. If blur
      // failed to cancel the pending timer, or the response reopened the list
      // regardless of focus, this is where it would show up — and the drain is
      // what guarantees such a reopen would already be committed by the time
      // the assertions run, rather than still sitting in React's queue.
      await pastDebounce();

      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  test("offers matching airports once the query is long enough", async () => {
    render(<Harness />);
    type("Jinan");
    // The option appears only after the 300ms debounce and the fetch resolve,
    // so the query has to come after `pastDebounce()` — but it is then a plain
    // synchronous `getByRole`, with no poll budget standing between the
    // component's work and the assertion.
    await pastDebounce();
    expect(screen.getByRole("option", { name: /Jinan Yaoqiang/ })).toBeInTheDocument();
  });

  test("picking an option writes name and code into the field", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("Jinan");
    await pastDebounce();
    // mouseDown, not click: the component commits on mouseDown so that blur
    // cannot close the list first.
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(onValue).toHaveBeenLastCalledWith("Jinan Yaoqiang International Airport (TNA)");
  });

  test("reports the picked airport itself, for callers that want the code", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    type("Jinan");
    await pastDebounce();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ iata: "TNA" });
  });

  test("closes the list after a pick rather than re-querying the new value", async () => {
    render(<Harness />);
    type("Jinan");
    await pastDebounce();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Past the debounce a second time. `pick()`'s own synchronous
    // `setOpen(false); setHits([])` only proves the list closes immediately —
    // it says nothing about whether the picked value's own query effect run
    // was suppressed. If it wasn't, the pending timeout fires here, re-queries
    // the picked string, and silently reopens the dropdown with a second fetch
    // call. Both assertions below are again assertions of absence, so the
    // drain is what rules out a reopen that had merely not been committed yet.
    await pastDebounce();

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("does not query for a one-character value", async () => {
    render(<Harness />);
    type("J");
    // A value this short schedules no debounce at all, so there is no timer
    // for the sleep to be ordered after and nothing for the drain to flush.
    // Here the elapsed time *is* the assertion — a request had its chance and
    // did not appear — and more time can only strengthen that, so this is the
    // one wait in the file with no race to lose. It goes through the same
    // helper anyway, so the file has exactly one way of waiting.
    await pastDebounce();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a failed fetch after the list was open leaves aria-expanded false, not stuck pointing at an absent listbox", async () => {
    render(<Harness />);
    type("Jinan");
    await pastDebounce();
    expect(screen.getByLabelText("From")).toHaveAttribute("aria-expanded", "true");

    // A later keystroke's fetch fails outright — the catch branch, not a
    // zero-result response.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    type("Jinan airport");
    // The wait `pastDebounce()` was written for: the catch branch's
    // `setHits([]); setOpen(false)` is a React update landing outside `act`,
    // so under load it is still queued at the moment a bare sleep resolves.
    await pastDebounce();

    expect(screen.getByLabelText("From")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  describe("displayValue branches (Finding 1)", () => {
    test("a short name passes through unchanged", async () => {
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("Jinan");
      await pastDebounce();
      fireEvent.mouseDown(screen.getByRole("option", { name: /Jinan Yaoqiang/ }));
      expect(onValue).toHaveBeenLastCalledWith("Jinan Yaoqiang International Airport (TNA)");
    });

    test("a long name falls back to the municipality", async () => {
      stubSearchResults([LONG_NAME_WITH_MUNICIPALITY]);
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("long");
      await pastDebounce();
      fireEvent.mouseDown(screen.getByRole("option", { name: /Shortcity/ }));
      expect(onValue).toHaveBeenLastCalledWith("Shortcity (XXL)");
    });

    test("a long name with no municipality is truncated to exactly the cap", async () => {
      stubSearchResults([LONG_NAME_NO_MUNICIPALITY]);
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("long");
      await pastDebounce();
      fireEvent.mouseDown(screen.getByRole("option", { name: /B{20,}/ }));
      const written = onValue.mock.calls.at(-1)?.[0] as string;
      expect(written).toBe(`${"B".repeat(54)} (YYL)`);
      expect(written).toHaveLength(60);
    });
  });

  describe("keyboard operability (Finding 2)", () => {
    test("arrowing to an option and pressing Enter selects it", async () => {
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("Jinan");
      await pastDebounce();
      expect(screen.getAllByRole("option")).toHaveLength(2);
      const input = screen.getByLabelText("From");

      // Two hits: TNA (Jinan) first, PEK (Beijing) second. One ArrowDown moves
      // the active option from the first to the second.
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(onValue).toHaveBeenLastCalledWith("Beijing Capital International Airport (PEK)");
      expect(screen.queryByRole("option")).not.toBeInTheDocument();
    });

    test("Escape closes the list without clearing the typed value", async () => {
      render(<Harness />);
      type("Jinan");
      await pastDebounce();
      expect(screen.getByRole("option", { name: /Jinan Yaoqiang/ })).toBeInTheDocument();

      fireEvent.keyDown(screen.getByLabelText("From"), { key: "Escape" });

      expect(screen.queryByRole("option")).not.toBeInTheDocument();
      expect(screen.getByLabelText("From")).toHaveValue("Jinan");
    });

    test("aria-activedescendant tracks the active option", async () => {
      render(<Harness />);
      type("Jinan");
      await pastDebounce();
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(2);
      const input = screen.getByLabelText("From");

      // Active index starts at 0: the input should already point at the
      // first option once the list opens, not leave the property unset.
      expect(input).toHaveAttribute("aria-activedescendant", options[0].id);

      fireEvent.keyDown(input, { key: "ArrowDown" });
      expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    });
  });
});
