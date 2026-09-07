import { formatMinor, minorUnitDigits } from "./money";
import type { Ticket, TicketKind } from "./tripShared";

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO date of trip day N (1-based), or null without a valid start date. */
export function dayDate(startDate: string | null, day: number): string | null {
  const m = ISO_DATE.exec(startDate ?? "");
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(start + (day - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Whether the ticket belongs on the given date (spans are inclusive). */
export function ticketOnDate(t: Ticket, isoDate: string): boolean {
  if (!t.date) return false;
  if (t.endDate && t.endDate >= t.date) return t.date <= isoDate && isoDate <= t.endDate;
  return t.date === isoDate;
}

/** Date-ascending copy; undated tickets sort last, then by time, then title. */
export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const byDate = (a.date ?? "￿").localeCompare(b.date ?? "￿");
    if (byDate !== 0) return byDate;
    const byTime = (a.time ?? "￿").localeCompare(b.time ?? "￿");
    if (byTime !== 0) return byTime;
    return a.title.localeCompare(b.title);
  });
}

/** The placeholder text the ticket form shows, built from the trip it is on. */
export interface TicketExamples {
  /** Train and other endpoints: a stop's name. */
  from: string;
  to: string;
  /** Flight endpoints: a stop's name or its gateway's IATA code. */
  flightFrom: string;
  flightTo: string;
  /** A price in the trip's currency, in the Money tab's notation. */
  price: string;
}

export interface TicketExampleInput {
  firstStop: string | null;
  lastStop: string | null;
  /** The trip's fly-in and fly-out gateways, IATA or null (`tripGateways`). */
  arrival: string | null;
  departure: string | null;
  /** The trip's currency, or the member's home currency, or null. */
  currency: string | null;
}

/**
 * The amount the placeholder has always shown — "¥553" since the Kit tab was
 * built. Kept as a number so it renders in every currency's own decimals.
 */
const EXAMPLE_PRICE_MAJOR = 553;

/**
 * The ticket form's placeholders are format hints, never stored, and until
 * 2026-09-07 every one of them was Chinese — "Beijing or PEK", "¥553" — on
 * every trip. These are the same hints in the trip's own terms: its first and
 * last stops, the gateways the server stamped on it, and its currency.
 *
 * Takes primitives rather than the trip, on purpose: `lib/countryFacts.test.ts`
 * pins the client entry points that reach the 70 KB facts artifact, and
 * `tripCurrency` reaches it. `TripView` already pays and computes all five
 * inputs; this module must stay a leaf that does not.
 *
 * Each half of a flight hint falls back on its own, so a trip with stops but
 * no gateway still reads "Lima or airport code". The destination half of
 * both `to` and `flightTo` refuses to repeat the origin: on a one-city trip
 * the only stop is offered once, as the origin, and the destination half
 * falls back to City, so no hint ever reads Lima → Lima.
 */
export function ticketExamples(input: TicketExampleInput): TicketExamples {
  const first = input.firstStop;
  const last = input.lastStop !== null && input.lastStop !== input.firstStop ? input.lastStop : null;
  return {
    from: first ?? "City",
    to: last ?? "City",
    flightFrom: `${first ?? "City"} or ${input.arrival ?? "airport code"}`,
    flightTo: `${last ?? "City"} or ${input.departure ?? "airport code"}`,
    price:
      input.currency === null
        ? "Amount"
        : formatMinor(EXAMPLE_PRICE_MAJOR * 10 ** minorUnitDigits(input.currency), input.currency),
  };
}

/**
 * The title hint per ticket kind. No trip can supply a flight number, so
 * these are neutral and kind-aware rather than trip-derived — and none of
 * them may name a carrier, station or venue (pinned in lib/tickets.test.ts).
 */
export const TICKET_TITLE_EXAMPLES: Record<TicketKind, string> = {
  flight: "Flight number",
  train: "Train number or route",
  hotel: "Hotel name",
  attraction: "Venue or event",
  other: "What it's for",
};
