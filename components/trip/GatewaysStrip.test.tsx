import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GatewaysStrip } from "./GatewaysStrip";

afterEach(() => cleanup());

describe("GatewaysStrip", () => {
  test("names both gateways", () => {
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} />);
    const strip = screen.getByTestId("gateways");
    expect(strip).toHaveTextContent("Fly in via LIM");
    expect(strip).toHaveTextContent("out via CUZ");
  });

  test("says when a side has none, rather than leaving a blank", () => {
    // "not set" rather than "no airport": this branch also renders a legacy
    // row that predates the fields, which has not claimed there is no
    // airport — it has said nothing at all.
    render(<GatewaysStrip gateways={{ arrival: null, departure: null }} />);
    expect(screen.getByTestId("gateways")).toHaveTextContent(/arrival airport not set/i);
    expect(screen.getByTestId("gateways")).toHaveTextContent(/departure not set/i);
  });

  test("offers no editing without a save handler — guests read, members write", () => {
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  test("edit, change one side, save: the handler gets both codes", async () => {
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Depart from"), { target: { value: "aqp" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ arrival: "LIM", departure: "AQP" }));
    // Back to the summary once the save resolves.
    expect(screen.queryByLabelText("Depart from")).not.toBeInTheDocument();
  });

  test("clearing a field saves null", async () => {
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ arrival: null, departure: "CUZ" }));
  });

  test("shows the server's refusal and stays open", async () => {
    const onSave = vi.fn(async () => "Unknown airport code ZZZ");
    render(<GatewaysStrip gateways={{ arrival: null, departure: null }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "ZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Unknown airport code ZZZ")).toBeInTheDocument();
    expect(screen.getByLabelText("Arrive at")).toBeInTheDocument();
  });

  test("typed text that names no airport cannot be saved", () => {
    // The trap this closes: a member types a name, taps Save without picking
    // from the list — and the tap itself blurs the field and closes the list,
    // so it reads as a deliberate save. The picker reports null for text that
    // names no airport, so the draft would have gone out as "no arrival
    // airport" and silently dropped the code that was already stored.
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "Jorge" } });

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(screen.getByText(/pick an airport from the list/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();

    // Finishing the thought releases it: a bare code is a gateway the server
    // can check, which is exactly what this editor accepts.
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "LIM" } });
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
    expect(screen.queryByText(/pick an airport from the list/i)).not.toBeInTheDocument();
  });

  test("cancel discards the draft", () => {
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "AQP" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("gateways")).toHaveTextContent("Fly in via LIM");
  });
});
