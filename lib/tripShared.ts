import { getCountryProfile, isCurrencyResearched } from "./countryProfile";
import type { TripInput, TripPlan } from "./itinerary";
import type { PackingGroup } from "./packing";
import type { CountryCode, Season } from "./types";

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

/**
 * The country a trip is in. The only way callers should read it: every trip
 * saved before the field existed is a China trip, so an absent country is an
 * explicit "CN" rather than an unknown — which is what removes the need for a
 * backfill. No caller should ever see `undefined` here.
 */
export function tripCountry(data: TripData): CountryCode {
  return data.input.country ?? "CN";
}

/**
 * The trip's destination currency, or `null` when that country has no
 * currency-researched profile yet. Deliberately never
 * `getCountryProfile(code).currency` unguarded — for every country besides
 * China that value is an admitted placeholder ("USD", see
 * `neutralProfile` in lib/countryProfile.ts), and showing a guess to a
 * member as though it were the destination's real currency is worse than
 * showing nothing (judgment call J-C1). `isCurrencyResearched` is the one
 * place that distinction is decided, so this and `getCountryProfile` can
 * never disagree about which countries are "researched."
 */
export function tripCurrency(data: TripData): string | null {
  const code = tripCountry(data);
  return isCurrencyResearched(code) ? getCountryProfile(code).currency : null;
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

/** Optional per-trip conversion: rates are pivot units per 1 unit of the currency. */
export interface CurrencySettings {
  home: string | null;
  rates: Record<string, number>;
  /** The currency the rates are against. Absent = legacy CNY-relative rates. */
  pivot?: string;
}

/**
 * The pivot a trip's rates are expressed in. The only way callers should read
 * it: settings saved before the field existed are CNY-relative, so an absent
 * pivot is an explicit CNY rather than an unknown.
 */
export function currencyPivot(settings: CurrencySettings): string {
  return settings.pivot ?? "CNY";
}

/**
 * The currency settings a freshly created trip should start with. Always a
 * fresh object — never a shared module-level instance reused across calls,
 * since a caller that later mutated one returned settings object in place
 * would otherwise poison every other trip that reads the same reference.
 * (There used to be a shared `DEFAULT_CURRENCY_SETTINGS` constant exported
 * for exactly that fallback; it was removed once nothing constructed a
 * trip's settings from it any more — see the store fallbacks in
 * `lib/server/tripStore.ts` / `pgStore.ts`, which build their own fresh
 * literal instead.)
 *
 * The pivot is stamped only when `isCurrencyResearched` says the country's
 * currency is a fact rather than `neutralProfile`'s admitted USD placeholder
 * (judgment call J-C1, see the comment on `tripCurrency` above) — stamping a
 * guess would persist it as though it were researched, which is worse than
 * leaving the pivot absent. An absent pivot is not a gap: `currencyPivot`
 * already reads it as the legacy CNY default, so an unresearched country's
 * trip degrades to exactly the behaviour every pre-pivot trip has today.
 */
export function initialCurrencySettings(countryCode: CountryCode): CurrencySettings {
  if (!isCurrencyResearched(countryCode)) return { home: null, rates: {} };
  return { home: null, rates: {}, pivot: getCountryProfile(countryCode).currency };
}

/**
 * What the currency-settings PUT route should persist, given what a trip
 * already has stored and what the request body sent.
 *
 * `home`/`rates` always come from the request — that's the whole point of
 * the save. `pivot` is different: it is never client-editable (no UI sends
 * one — see `CurrencySettingsEditor`), so the request omits it on every
 * real save. Because the store replaces the whole settings blob on write
 * (see `setCurrencySettings` in `lib/server/tripStore.ts` / `pgStore.ts`),
 * naively writing back only what the client sent would silently erase a
 * trip's stamped pivot the first time anyone touched their home currency or
 * a single rate — the pivot key would simply be missing from the new blob.
 * Falling back to `existing.pivot` when the request has none is what keeps
 * the save from ever discarding meaning it didn't intend to change.
 *
 * A legacy trip with no stored pivot must stay pivot-free: `existing.pivot`
 * is `undefined` there too, so `incoming.pivot ?? existing.pivot` is
 * `undefined`, and the spread below adds no key at all — never an explicit
 * `pivot: undefined`, which would be a different (and wrong) stored shape.
 */
export function applyCurrencySettingsUpdate(
  existing: CurrencySettings,
  incoming: { home: string | null; rates: Record<string, number>; pivot?: string }
): CurrencySettings {
  const pivot = incoming.pivot ?? existing.pivot;
  return {
    home: incoming.home,
    rates: incoming.rates,
    ...(pivot !== undefined ? { pivot } : {}),
  };
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
  expenses: Expense[];
  settlements: Settlement[];
  journal: JournalEntry[];
  currencySettings: CurrencySettings;
  /** Injected by the store facade — whether this host accepts photo uploads. */
  features?: { photoUploads: boolean };
  /** Only present when the requesting member is part of the trip. */
  joinCode?: string;
  /** Injected by the route — the requesting member's own name. */
  myMemberName?: string;
}

/** What a join-code guest may see: the plan basics, nothing personal. */
export interface GuestTripPayload {
  id: string;
  version: number;
  guest: true;
  tripName: string;
  /**
   * The trip's country. Not sensitive — the destination names below already say
   * where the trip goes — and without it the guest header can only guess, which
   * is how a Japan trip ended up wearing a Chinese chop.
   */
  country: CountryCode;
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
  /** Name in the local language; `null` when the catalog has none. */
  localName: string | null;
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
  /** Name in the local language; `null` when the catalog has none. */
  localName: string | null;
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
