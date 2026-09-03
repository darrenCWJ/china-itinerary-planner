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
    render(<GatewaysStrip gateways={{ arrival: null, departure: null }} />);
    expect(screen.getByTestId("gateways")).toHaveTextContent(/no arrival airport/i);
    expect(screen.getByTestId("gateways")).toHaveTextContent(/no departure airport/i);
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
