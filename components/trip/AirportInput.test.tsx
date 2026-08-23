import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
function Harness({ onValue }: { onValue?: (v: string) => void } = {}) {
  const [value, setValue] = useState("");
  return (
    <AirportInput
      label="From"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
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
      // `toFields`). The query effect still runs — the debounce below is what
      // proves the fetch actually happened — but nobody focused this field, so
      // the list must never open under it.
      render(<AirportInput label="From" value="Beijing" onChange={() => {}} />);

      await new Promise((resolve) => setTimeout(resolve, 450));

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("From")).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    test("blurring during the debounce window does not reopen the list afterwards", async () => {
      render(<Harness />);
      const input = screen.getByLabelText("From");
      type("Jinan");

      // Well inside the 300ms debounce window: the fetch has not fired yet.
      fireEvent.blur(input);

      // Past the debounce window and the mocked fetch's resolution. If blur
      // failed to cancel the pending timer, or the response reopened the list
      // regardless of focus, this is where it would show up.
      await new Promise((resolve) => setTimeout(resolve, 450));

      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  test("offers matching airports once the query is long enough", async () => {
    render(<Harness />);
    type("Jinan");
    // Appears only after the 300ms debounce and the fetch resolve; findBy*
    // polls for up to testing-library's own 1000ms default -- nothing here
    // configures asyncUtilTimeout, so that default is the real budget.
    expect(await screen.findByRole("option", { name: /Jinan Yaoqiang/ })).toBeInTheDocument();
  });

  test("picking an option writes name and code into the field", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("Jinan");
    // mouseDown, not click: the component commits on mouseDown so that blur
    // cannot close the list first.
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(onValue).toHaveBeenLastCalledWith("Jinan Yaoqiang International Airport (TNA)");
  });

  test("closes the list after a pick rather than re-querying the new value", async () => {
    render(<Harness />);
    type("Jinan");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Real time, past the 300ms debounce. `pick()`'s own synchronous
    // `setOpen(false); setHits([])` only proves the list closes immediately —
    // it says nothing about whether the picked value's own query effect run
    // was suppressed. If it wasn't, the pending timeout fires here, re-queries
    // the picked string, and silently reopens the dropdown with a second
    // fetch call. Waiting past the debounce (vitest's 5000ms default
    // testTimeout, the only budget in force here, leaves ample room) is what
    // actually exercises the suppression guard rather than just `pick()`'s own
    // state updates.
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("does not query for a one-character value", async () => {
    render(<Harness />);
    type("J");
    // Comfortably past the 300ms debounce: if a request were coming, it has had
    // its chance.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a failed fetch after the list was open leaves aria-expanded false, not stuck pointing at an absent listbox", async () => {
    render(<Harness />);
    type("Jinan");
    await screen.findByRole("option", { name: /Jinan Yaoqiang/ });
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
    // Comfortably past the 300ms debounce, same margin as the other
    // debounce-dependent tests above.
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(screen.getByLabelText("From")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  describe("displayValue branches (Finding 1)", () => {
    test("a short name passes through unchanged", async () => {
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("Jinan");
      fireEvent.mouseDown(await screen.findByRole("option", { name: /Jinan Yaoqiang/ }));
      expect(onValue).toHaveBeenLastCalledWith("Jinan Yaoqiang International Airport (TNA)");
    });

    test("a long name falls back to the municipality", async () => {
      stubSearchResults([LONG_NAME_WITH_MUNICIPALITY]);
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("long");
      fireEvent.mouseDown(await screen.findByRole("option", { name: /Shortcity/ }));
      expect(onValue).toHaveBeenLastCalledWith("Shortcity (XXL)");
    });

    test("a long name with no municipality is truncated to exactly the cap", async () => {
      stubSearchResults([LONG_NAME_NO_MUNICIPALITY]);
      const onValue = vi.fn();
      render(<Harness onValue={onValue} />);
      type("long");
      fireEvent.mouseDown(await screen.findByRole("option", { name: /B{20,}/ }));
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
      await screen.findAllByRole("option");
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
      await screen.findByRole("option", { name: /Jinan Yaoqiang/ });

      fireEvent.keyDown(screen.getByLabelText("From"), { key: "Escape" });

      expect(screen.queryByRole("option")).not.toBeInTheDocument();
      expect(screen.getByLabelText("From")).toHaveValue("Jinan");
    });

    test("aria-activedescendant tracks the active option", async () => {
      render(<Harness />);
      type("Jinan");
      const options = await screen.findAllByRole("option");
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
