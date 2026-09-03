import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AirportPicker } from "./AirportPicker";

/**
 * AirportInput's suggestions come from /api/airports/search; here the fetch
 * is a stub, and the pick is driven the way AirportInput.test.tsx drives it.
 */
const LIM = {
  iata: "LIM",
  icao: "SPJC",
  name: "Jorge Chávez International Airport",
  municipality: "Lima",
  country: "PE",
  lat: -12.0219,
  lon: -77.1143,
  size: "large",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AirportPicker", () => {
  test("shows the current code as its text", () => {
    render(<AirportPicker label="Arrive at" value="CUZ" onChange={() => {}} />);
    expect(screen.getByLabelText("Arrive at")).toHaveValue("CUZ");
  });

  test("a bare three-letter code is a pick only when allowed", () => {
    const strict = vi.fn();
    const { unmount } = render(<AirportPicker label="Arrive at" value={null} onChange={strict} />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "aqp" } });
    expect(strict).toHaveBeenLastCalledWith(null);
    unmount();

    const lenient = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={lenient} allowBareCode />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "aqp" } });
    expect(lenient).toHaveBeenLastCalledWith({ iata: "AQP", airport: null });
  });

  test("clearing the text is none", () => {
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value="LIM" onChange={onChange} allowBareCode />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("a list pick carries the whole airport, and editing the text afterwards drops it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ results: [LIM] }) }))
    );
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={onChange} />);
    const field = screen.getByLabelText("Arrive at");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "lima" } });
    // Past the 300 ms debounce and the stubbed fetch, as AirportInput.test.tsx
    // does — it exports no flush helper, so this is the fallback: advance the
    // fake clock past the debounce. Wrapped in act() because the resolved
    // fetch's setHits/setOpen land after the timer callback's own await, so
    // React schedules that update outside any act scope of ours; without the
    // wrapper the update lands one tick later than this line, and the very
    // next line's getByRole("option") throws.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jorge Chávez/ }));
    expect(onChange).toHaveBeenLastCalledWith({ iata: "LIM", airport: LIM });
    expect(field).toHaveValue("Jorge Chávez International Airport (LIM)");

    fireEvent.change(field, { target: { value: "Jorge" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
