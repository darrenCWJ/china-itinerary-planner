import { describe, expect, it } from "vitest";
import { dayDate, sortTickets, ticketOnDate, ticketExamples, TICKET_TITLE_EXAMPLES } from "./tickets";
import type { Ticket } from "./tripShared";
import { TICKET_KINDS } from "./meta";

function ticket(partial: Partial<Ticket>): Ticket {
  return {
    id: "t1",
    kind: "train",
    title: "G2",
    date: null,
    endDate: null,
    time: null,
    from: null,
    to: null,
    confirmation: null,
    price: null,
    notes: null,
    addedBy: "Darren",
    ...partial,
  };
}

describe("dayDate", () => {
  it("maps day 1 to the start date", () => {
    expect(dayDate("2026-09-14", 1)).toBe("2026-09-14");
  });

  it("adds days, crossing month boundaries", () => {
    expect(dayDate("2026-09-29", 3)).toBe("2026-10-01");
  });

  it("returns null without a start date or with a malformed one", () => {
    expect(dayDate(null, 1)).toBeNull();
    expect(dayDate("14/09/2026", 1)).toBeNull();
  });
});

describe("ticketOnDate", () => {
  it("matches the exact date", () => {
    const t = ticket({ date: "2026-09-15" });
    expect(ticketOnDate(t, "2026-09-15")).toBe(true);
    expect(ticketOnDate(t, "2026-09-16")).toBe(false);
  });

  it("matches every day of a span (hotel)", () => {
    const t = ticket({ kind: "hotel", date: "2026-09-14", endDate: "2026-09-16" });
    expect(ticketOnDate(t, "2026-09-14")).toBe(true);
    expect(ticketOnDate(t, "2026-09-15")).toBe(true);
    expect(ticketOnDate(t, "2026-09-16")).toBe(true);
    expect(ticketOnDate(t, "2026-09-17")).toBe(false);
  });

  it("ignores an endDate before the start date", () => {
    const t = ticket({ date: "2026-09-14", endDate: "2026-09-10" });
    expect(ticketOnDate(t, "2026-09-14")).toBe(true);
    expect(ticketOnDate(t, "2026-09-12")).toBe(false);
  });

  it("never matches undated tickets", () => {
    expect(ticketOnDate(ticket({}), "2026-09-14")).toBe(false);
  });
});

describe("sortTickets", () => {
  it("orders by date, then time, with undated last", () => {
    const sorted = sortTickets([
      ticket({ id: "undated", date: null }),
      ticket({ id: "late", date: "2026-09-15", time: "18:00" }),
      ticket({ id: "early", date: "2026-09-15", time: "08:05" }),
      ticket({ id: "first", date: "2026-09-14" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["first", "early", "late", "undated"]);
  });

  it("does not mutate the input", () => {
    const input = [ticket({ id: "b", date: "2026-09-15" }), ticket({ id: "a", date: "2026-09-14" })];
    sortTickets(input);
    expect(input[0].id).toBe("b");
  });
});

describe("ticketExamples", () => {
  const PERU = {
    firstStop: "Lima",
    lastStop: "Cusco",
    arrival: "LIM",
    departure: "CUZ",
    currency: "PEN",
  };

  it("uses the first and last stops and both gateways", () => {
    expect(ticketExamples(PERU)).toEqual({
      from: "Lima",
      to: "Cusco",
      flightFrom: "Lima or LIM",
      flightTo: "Cusco or CUZ",
      price: "PEN 553.00",
    });
  });

  it("falls back half by half when a gateway is missing", () => {
    const examples = ticketExamples({ ...PERU, arrival: null, departure: null });
    expect(examples.flightFrom).toBe("Lima or airport code");
    expect(examples.flightTo).toBe("Cusco or airport code");
    // The train and other endpoints never carried a code, so they are unchanged.
    expect(examples.from).toBe("Lima");
    expect(examples.to).toBe("Cusco");
  });

  it("falls back to City when the trip has no stops", () => {
    const examples = ticketExamples({ ...PERU, firstStop: null, lastStop: null });
    expect(examples.from).toBe("City");
    expect(examples.to).toBe("City");
    expect(examples.flightFrom).toBe("City or LIM");
    expect(examples.flightTo).toBe("City or CUZ");
  });

  it("does not offer the only stop as both ends of a one-city trip", () => {
    const examples = ticketExamples({ ...PERU, lastStop: "Lima" });
    expect(examples.from).toBe("Lima");
    expect(examples.to).toBe("City");
    expect(examples.flightFrom).toBe("Lima or LIM");
    expect(examples.flightTo).toBe("City or CUZ");
  });

  it("renders the price through the app's own money formatter", () => {
    // The same 553 the old placeholder used, in the trip's currency and in the
    // notation the Money tab uses for it: a symbol where one is known, the
    // code otherwise, and the currency's own number of decimals.
    expect(ticketExamples({ ...PERU, currency: "CNY" }).price).toBe("¥553.00");
    expect(ticketExamples({ ...PERU, currency: "JPY" }).price).toBe("JPY 553");
    expect(ticketExamples({ ...PERU, currency: "KWD" }).price).toBe("KWD 553.000");
  });

  it("says Amount when the trip has no currency", () => {
    expect(ticketExamples({ ...PERU, currency: null }).price).toBe("Amount");
  });
});

describe("TICKET_TITLE_EXAMPLES", () => {
  it("covers every ticket kind", () => {
    for (const kind of TICKET_KINDS) {
      expect(TICKET_TITLE_EXAMPLES[kind.id]).toMatch(/\S/);
    }
  });

  it("names no carrier, station, venue or city from any one country", () => {
    // The strings the old placeholders carried. A new example that quotes a
    // real train, flight or attraction fails here, whichever country it is from.
    const banned = /G2|CA1858|Disneyland|Beijing|Shanghai|PEK|SHA|¥/;
    for (const text of Object.values(TICKET_TITLE_EXAMPLES)) {
      expect(text).not.toMatch(banned);
    }
  });
});
