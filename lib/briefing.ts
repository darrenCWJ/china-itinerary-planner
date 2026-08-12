import { DESTINATIONS } from "./data";
import type { ItemKind } from "./itinerary";
import { dayDate } from "./tickets";
import type { TicketKind, TripPayload } from "./tripShared";
import type { TimeSlot } from "./types";

export interface BriefingCity {
  id: string;
  name: string;
  /** Curated destinations carry one; catalog cities do not. */
  chineseName: string | null;
  days: number[];
}

export interface BriefingItem {
  id: string;
  slot: TimeSlot;
  kind: ItemKind;
  title: string;
  time: string | null;
  note: string | null;
}

export interface BriefingDay {
  day: number;
  /** ISO date, or null when the trip has no start date. */
  date: string | null;
  destinationName: string;
  items: BriefingItem[];
}

/**
 * A ticket flattened for display. Deliberately has no `addedBy` field: the
 * shape itself is the guarantee that a public briefing cannot name a member.
 */
export interface BriefingBooking {
  kind: TicketKind;
  title: string;
  date: string | null;
  endDate: string | null;
  time: string | null;
  from: string | null;
  to: string | null;
  confirmation: string | null;
  price: string | null;
  notes: string | null;
}

export interface ChartSlice {
  label: string;
  value: number;
}

export interface PacePoint {
  day: number;
  items: number;
}

export interface Briefing {
  title: string;
  subtitle: string;
  dateRange: { start: string; end: string } | null;
  party: { adults: number; kids: number };
  cities: BriefingCity[];
  days: BriefingDay[];
  charts: {
    daysPerCity: ChartSlice[];
    interestMix: ChartSlice[];
    pace: PacePoint[];
  };
  logistics: { tips: string[]; bookings: BriefingBooking[] };
  /** Members and progress — null on a redacted (public) briefing. */
  crew: { members: string[]; checkedCount: number } | null;
  redacted: boolean;
}

export interface BriefingOptions {
  /** True for the public link: drops member identity and (by default) booking secrets. */
  redacted: boolean;
  /** Public links may opt back into confirmation refs, prices and notes. */
  includeBookings: boolean;
}

function chineseNameFor(destinationId: string): string | null {
  return DESTINATIONS.find((d) => d.id === destinationId)?.chineseName ?? null;
}

function citiesOf(payload: TripPayload): BriefingCity[] {
  const cities: BriefingCity[] = [];
  for (const day of payload.data.plan.days) {
    const seen = cities.find((c) => c.id === day.destinationId);
    if (seen) {
      seen.days.push(day.day);
      continue;
    }
    cities.push({
      id: day.destinationId,
      name: day.destinationName,
      chineseName: chineseNameFor(day.destinationId),
      days: [day.day],
    });
  }
  return cities;
}

function daysOf(payload: TripPayload): BriefingDay[] {
  const { startDate } = payload.data;
  return payload.data.plan.days.map((day) => ({
    day: day.day,
    date: dayDate(startDate, day.day),
    destinationName: day.destinationName,
    items: day.items.map((i) => ({
      id: i.id,
      slot: i.slot,
      kind: i.kind,
      title: i.title,
      time: i.time ?? null,
      note: i.note ?? null,
    })),
  }));
}

export function buildBriefing(payload: TripPayload, opts: BriefingOptions): Briefing {
  const { data } = payload;
  const cities = citiesOf(payload);
  const days = daysOf(payload);
  const dayCount = days.length;
  const range = dayCount > 0 ? dayDate(data.startDate, dayCount) : null;
  const start = dayDate(data.startDate, 1);

  return {
    title: data.tripName,
    subtitle: `${dayCount} days · ${cities.length} ${
      cities.length === 1 ? "city" : "cities"
    } · ${data.input.season}`,
    dateRange: start && range ? { start, end: range } : null,
    party: { adults: data.input.adults, kids: data.input.kids },
    cities,
    days,
    charts: { daysPerCity: [], interestMix: [], pace: [] },
    logistics: { tips: [], bookings: [] },
    crew: null,
    redacted: opts.redacted,
  };
}
