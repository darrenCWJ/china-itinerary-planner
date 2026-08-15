import type { TripInput, TripPlan } from "./itinerary";
import type { PackingGroup } from "./packing";
import type { Season } from "./types";

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

export type ExpenseCategory =
  | "food"
  | "transport"
  | "lodging"
  | "tickets"
  | "shopping"
  | "other";

/** A group expense. Amount is in minor units (fen/cents) — always integer. */
export interface Expense {
  id: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  /** 3-letter uppercase code, e.g. "CNY". */
  currency: string;
  paidBy: string;
  /** Member names to split among (equal split). [] = all members at computation time. */
  splitAmong: string[];
  notes: string | null;
  addedBy: string;
  createdAt: number;
}

/** A recorded repayment: `from` paid `to` back. Nets against expense debts. */
export interface Settlement {
  id: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  recordedBy: string;
  createdAt: number;
}

export interface JournalPhoto {
  /** "upload" ref = stored filename, "link" ref = https URL. */
  kind: "upload" | "link";
  ref: string;
}

export interface JournalEntry {
  id: string;
  /** ISO yyyy-mm-dd — the trip day this entry belongs to. */
  date: string;
  text: string;
  photos: JournalPhoto[];
  by: string;
  createdAt: number;
  updatedAt: number;
}

/** Optional per-trip conversion: rates are CNY per 1 unit of the currency. */
export interface CurrencySettings {
  home: string | null;
  rates: Record<string, number>;
}

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = { home: null, rates: {} };

/** GET /api/trips/:id response. */
export interface TripPayload {
  id: string;
  version: number;
  updatedAt: number;
  data: TripData;
  members: TripMember[];
  checks: TripCheck[];
  tickets: Ticket[];
  expenses: Expense[];
  settlements: Settlement[];
  journal: JournalEntry[];
  currencySettings: CurrencySettings;
  /** Injected by the store facade — whether this host accepts photo uploads. */
  features?: { photoUploads: boolean };
  /** Only present when the requesting member is part of the trip. */
  joinCode?: string;
}

/** What a join-code guest may see: the plan basics, nothing personal. */
export interface GuestTripPayload {
  id: string;
  version: number;
  guest: true;
  tripName: string;
  startDate: string | null;
  days: number;
  season: Season;
  destinationNames: string[];
  planDays: TripPlan["days"];
  packing: PackingGroup[];
  memberCount: number;
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
