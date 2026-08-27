import { getCountryProfile } from "./countryProfile";
import { DESTINATIONS } from "./data";
import type { ItemKind } from "./itinerary";
import { dayDate, sortTickets } from "./tickets";
import { interestMeta } from "./meta";
import { tripCountry, type Ticket, type TicketKind, type TripPayload } from "./tripShared";
import type { Interest, TimeSlot } from "./types";

export interface BriefingCity {
  id: string;
  name: string;
  /** Name in the local language. Curated destinations carry one; catalog cities do not. */
  localName: string | null;
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
  /**
   * What our data does not cover for this trip's country — muted copy rendered
   * as a note beside `logistics.tips`, never as one of them (T28).
   *
   * Derived here rather than carried on `TripData`, and the distinction is the
   * point. `logistics.tips` above is a *copy of a snapshot*: `plan.tips` was
   * frozen when the trip was created and is served back unchanged forever,
   * which is right for advice a traveller acted on. This is a statement about
   * our current coverage, so it is recomputed from `tripCountry(payload.data)`
   * every time a briefing is built — a briefing is a per-request view of the
   * trip, never persisted — and it shrinks as the facts artifact grows.
   *
   * Empty for China, which is researched by hand and has nothing to disclaim.
   *
   * Computed in this module rather than in `BriefingView` so the briefing
   * *renderer* stays free of the 70 KB facts artifact: `app/b/[code]/page.tsx`
   * is an unauthenticated server page that calls `buildBriefing` server-side,
   * and a client component resolving the note itself would ship those bytes to
   * every bearer-link holder. See `lib/countryFacts.test.ts`.
   */
  gapNote: string[];
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

function localNameFor(destinationId: string): string | null {
  const destination = DESTINATIONS.find((d) => d.id === destinationId);
  return destination?.localName ?? null;
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
      localName: localNameFor(day.destinationId),
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

function interestMixOf(payload: TripPayload): ChartSlice[] {
  const counts = new Map<Interest, number>();
  for (const day of payload.data.plan.days) {
    for (const item of day.items) {
      for (const tag of item.interests ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ label: interestMeta(id)?.label ?? id, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/**
 * `showSecrets` gates confirmation refs, prices and free-text notes. Route,
 * time and title always survive — they are what make the document useful,
 * while the reference number is what makes it sensitive.
 */
function toBooking(t: Ticket, showSecrets: boolean): BriefingBooking {
  return {
    kind: t.kind,
    title: t.title,
    date: t.date,
    endDate: t.endDate,
    time: t.time,
    from: t.from,
    to: t.to,
    confirmation: showSecrets ? t.confirmation : null,
    price: showSecrets ? t.price : null,
    notes: showSecrets ? t.notes : null,
  };
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
    subtitle: `${dayCount} ${dayCount === 1 ? "day" : "days"} · ${cities.length} ${
      cities.length === 1 ? "city" : "cities"
    } · ${data.input.season}`,
    dateRange: start && range ? { start, end: range } : null,
    party: { adults: data.input.adults, kids: data.input.kids },
    cities,
    days,
    charts: {
      daysPerCity: cities.map((c) => ({ label: c.name, value: c.days.length })),
      interestMix: interestMixOf(payload),
      pace: days.map((d) => ({ day: d.day, items: d.items.length })),
    },
    logistics: {
      tips: [...data.plan.tips],
      bookings: sortTickets(payload.tickets).map((t) =>
        toBooking(t, !opts.redacted || opts.includeBookings)
      ),
    },
    gapNote: getCountryProfile(tripCountry(data)).gapNote,
    crew: opts.redacted
      ? null
      : { members: payload.members.map((m) => m.name), checkedCount: payload.checks.length },
    redacted: opts.redacted,
  };
}
