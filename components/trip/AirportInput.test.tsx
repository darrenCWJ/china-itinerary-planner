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

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText("From"), { target: { value: text } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ results: HITS }) }) as unknown as Response)
  );
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

  test("offers matching airports once the query is long enough", async () => {
    render(<Harness />);
    type("Jinan");
    // Appears only after the 300ms debounce and the fetch resolve; findBy*
    // polls for up to the 5s asyncUtilTimeout set in vitest.setup.ts.
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
  });

  test("does not query for a one-character value", async () => {
    render(<Harness />);
    type("J");
    // Comfortably past the 300ms debounce: if a request were coming, it has had
    // its chance.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fetch).not.toHaveBeenCalled();
  });
});
