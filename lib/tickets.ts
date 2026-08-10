import type { Ticket } from "./tripShared";

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
