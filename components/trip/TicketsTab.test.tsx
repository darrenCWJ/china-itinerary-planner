import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { TicketExamples } from "@/lib/tickets";
import { TicketsTab } from "./TicketsTab";

afterEach(cleanup);

/** What `TripView` derives for a Lima → Cusco trip: real names, real codes. */
const PERU: TicketExamples = {
  from: "Lima",
  to: "Cusco",
  flightFrom: "Lima or LIM",
  flightTo: "Cusco or CUZ",
  price: "PEN 553.00",
};

function openTheForm() {
  render(
    <TicketsTab
      tickets={[]}
      isMember
      hasStartDate={false}
      examples={PERU}
      onAdd={async () => null}
      onUpdate={async () => null}
      onDelete={async () => null}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "+ Add ticket" }));
}

describe("the ticket form's placeholders are the trip's own", () => {
  test("a train's endpoints and price", () => {
    openTheForm();
    // The form opens on `train` (`toFields` defaults the kind).
    expect(screen.getByPlaceholderText("Train number or route")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Lima")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cusco")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("PEN 553.00")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Beijing|Shanghai|¥553|CA1858/)).toBeNull();
  });

  test("a flight's endpoints carry the gateway codes", () => {
    openTheForm();
    fireEvent.click(screen.getByRole("button", { name: /Flight/ }));
    expect(screen.getByPlaceholderText("Flight number")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Lima or LIM")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cusco or CUZ")).toBeInTheDocument();
  });

  test("a hotel asks for its name, as before", () => {
    openTheForm();
    fireEvent.click(screen.getByRole("button", { name: /Hotel/ }));
    expect(screen.getByPlaceholderText("Hotel name")).toBeInTheDocument();
  });
});
