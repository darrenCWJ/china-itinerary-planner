import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Airport } from "@/lib/airports";
import { AirportPicker } from "./AirportPicker";

/**
 * AirportInput's suggestions come from /api/airports/search; here the fetch
 * is a stub, and the pick is driven the way AirportInput.test.tsx drives it.
 */
const LIM: Airport = {
  iata: "LIM",
  icao: "SPJC",
  name: "Jorge Chávez International Airport",
  municipality: "Lima",
  country: "PE",
  lat: -12.0219,
  lon: -77.1143,
  size: "large",
};

/**
 * Fake timers plus a fetch stub resolving to LIM as the only result — the
 * same setup "a list pick carries the whole airport..." below uses, shared
 * with the tests added after it that also drive a pick from the list.
 */
function stubLimSearch() {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ results: [LIM] }) }))
  );
}

/**
 * Past the 300 ms debounce and the stubbed fetch, as AirportInput.test.tsx
 * does — it exports no flush helper, so this is the fallback: advance the
 * fake clock past the debounce. Wrapped in act() because the resolved
 * fetch's setHits/setOpen land after the timer callback's own await, so
 * React schedules that update outside any act scope of ours; without the
 * wrapper the update lands one tick later than this line, and the very
 * next line's getByRole("option") throws.
 */
async function pastDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

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
    expect(strict).toHaveBeenLastCalledWith(null, "aqp");
    unmount();

    const lenient = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={lenient} allowBareCode />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "aqp" } });
    expect(lenient).toHaveBeenLastCalledWith({ iata: "AQP", airport: null }, "aqp");
  });

  test("clearing the text is none", () => {
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value="LIM" onChange={onChange} allowBareCode />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null, "");
  });

  test("reports the raw text beside the pick, so a caller can tell empty from unrecognised", () => {
    // Both report a null pick, and a parent that sees only the null cannot
    // tell them apart: one is a traveller clearing the field, the other is a
    // traveller halfway through typing a name. GatewaysStrip needs the
    // difference — it refuses to save the second (spec §10.3).
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value="LIM" onChange={onChange} allowBareCode />);
    const field = screen.getByLabelText("Arrive at");

    fireEvent.change(field, { target: { value: "Jorge" } });
    expect(onChange).toHaveBeenLastCalledWith(null, "Jorge");

    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null, "");
  });

  test("a list pick carries the whole airport, and editing the text afterwards drops it", async () => {
    stubLimSearch();
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={onChange} />);
    const field = screen.getByLabelText("Arrive at");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "lima" } });
    await pastDebounce();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jorge Chávez/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      { iata: "LIM", airport: LIM },
      "Jorge Chávez International Airport (LIM)"
    );
    expect(field).toHaveValue("Jorge Chávez International Airport (LIM)");

    fireEvent.change(field, { target: { value: "Jorge" } });
    expect(onChange).toHaveBeenLastCalledWith(null, "Jorge");
  });

  test("drives a list pick from the keyboard", async () => {
    // Mirrors AirportInput.test.tsx's "arrowing to an option and pressing
    // Enter selects it" — here there is only one hit, so it is already
    // active and Enter alone picks it; no ArrowDown needed.
    stubLimSearch();
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={onChange} />);
    const field = screen.getByLabelText("Arrive at");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "lima" } });
    await pastDebounce();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(
      { iata: "LIM", airport: LIM },
      "Jorge Chávez International Airport (LIM)"
    );
  });

  test("follows the parent when it hands over a new code, but not when it echoes the report", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AirportPicker label="Arrive at" value={null} onChange={onChange} allowBareCode />
    );
    // An async load: the parent now knows the stamped gateway.
    rerender(<AirportPicker label="Arrive at" value="LIM" onChange={onChange} allowBareCode />);
    expect(screen.getByLabelText("Arrive at")).toHaveValue("LIM");
    // The user types a bare code and the parent echoes it back: the text must not jump.
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "aqp" } });
    expect(onChange).toHaveBeenLastCalledWith({ iata: "AQP", airport: null }, "aqp");
    rerender(<AirportPicker label="Arrive at" value="AQP" onChange={onChange} allowBareCode />);
    expect(screen.getByLabelText("Arrive at")).toHaveValue("aqp");
    // A reverted save: the parent puts the old code back.
    rerender(<AirportPicker label="Arrive at" value="LIM" onChange={onChange} allowBareCode />);
    expect(screen.getByLabelText("Arrive at")).toHaveValue("LIM");
  });

  test("after a list pick, editing to a bare code reports the code without the airport", async () => {
    stubLimSearch();
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={onChange} allowBareCode />);
    const field = screen.getByLabelText("Arrive at");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "lima" } });
    await pastDebounce();
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jorge Chávez/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      { iata: "LIM", airport: LIM },
      "Jorge Chávez International Airport (LIM)"
    );

    fireEvent.change(field, { target: { value: "cuz" } });
    expect(onChange).toHaveBeenLastCalledWith({ iata: "CUZ", airport: null }, "cuz");
  });
});
