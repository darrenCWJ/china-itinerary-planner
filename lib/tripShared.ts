import type { TripInput, TripPlan } from "./itinerary";
import type { PackingGroup } from "./packing";

/** Snapshot stored per trip and served to every member. */
export interface TripData {
  tripName: string;
  startDate: string | null;
  input: TripInput;
  plan: TripPlan;
  packing: PackingGroup[];
  foods: { destination: string; emoji: string; dishes: string[] }[];
  destinationNames: string[];
}

export interface TripMember {
  name: string;
  joinedAt: number;
}

export interface TripCheck {
  key: string;
  by: string;
}

export type TicketKind = "flight" | "train" | "hotel" | "attraction" | "other";

/** A structured booking attached to the trip (no file uploads). */
export interface Ticket {
  id: string;
  kind: TicketKind;
  title: string;
  /** ISO yyyy-mm-dd; tickets without a date only show in the Tickets tab. */
  date: string | null;
  /** Span end (hotel checkout, multi-day pass) — inclusive. */
  endDate: string | null;
  /** Free text, e.g. "08:05". */
  time: string | null;
  from: string | null;
  to: string | null;
  confirmation: string | null;
  price: string | null;
  notes: string | null;
  addedBy: string;
}

/** GET /api/trips/:id response. */
export interface TripPayload {
  id: string;
  version: number;
  updatedAt: number;
  data: TripData;
  members: TripMember[];
  checks: TripCheck[];
  tickets: Ticket[];
  /** Only present when the requesting member is part of the trip. */
  joinCode?: string;
}

/** Compact catalog city served to the map view. */
export interface MapCity {
  qid: string;
  name: string;
  chineseName: string | null;
  province: string | null;
  lat: number;
  lon: number;
  population: number | null;
  level: "municipality" | "prefecture" | "county";
  attractionCount: number;
  blurb: string | null;
}

/** Compact catalog search hit shown in the destination search UI. */
export interface CatalogHit {
  qid: string;
  name: string;
  chineseName: string | null;
  province: string | null;
  description: string | null;
  population: number | null;
  attractionCount: number;
}

/** Legacy index-based schedule key — only used to migrate old trips. */
export function scheduleCheckKey(day: number, itemIndex: number): string {
  return `day:${day}:${itemIndex}`;
}

/** Id-based schedule key — survives edits and reorders. */
export function itemCheckKey(itemId: string): string {
  return `item:${itemId}`;
}

export function packingCheckKey(group: string, item: string): string {
  return `pack:${group}:${item}`;
}
