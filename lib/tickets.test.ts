import { describe, expect, it } from "vitest";
import { dayDate, sortTickets, ticketOnDate } from "./tickets";
import type { Ticket } from "./tripShared";

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
