import { getCountryProfile, isCurrencyResearched } from "./countryProfile";
import { tripCountry } from "./tripCountry";
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
 * Re-exported, not defined here. It moved to lib/tripCountry.ts — a leaf that
 * value-imports nothing — because this module reaches the 70 KB CC0 facts
 * artifact through `getCountryProfile` above, and every caller that wanted only
 * the trip's country was paying for that. lib/tripCountry.ts carries the
 * `?? "CN"` backfill's reasoning, which is unchanged, and lib/tripShared.test.ts
 * still pins the behaviour through this name.
 *
 * The re-export is deliberate rather than a migration left half-done: callers
 * that already read a fact (lib/briefing.ts, lib/redactTrip.ts,
 * components/TripView.tsx) keep getting both from one import, and the callers
 * that must stay cheap import the leaf directly.
 */
export { tripCountry };

/**
 * The trip's destination currency, or `null` when nothing is known about that
 * country's currency.
 *
 * Read through `isCurrencyResearched` rather than off the profile directly,
 * and that is not redundant now that the predicate IS `currency !== null`: it
 * is the one place the "fact or absence?" question is answered, and routing
 * every money surface through it is what stops a future caller from
 * re-deriving the answer with its own rule (judgment call J-C1).
 *
 * Until T27 the profile handed out an admitted "USD" placeholder for every
 * country besides China, and this guard was what kept that guess off the Money
 * tab. The guess is gone — an unknown currency is now absent at the source —
 * so this returns null on strictly fewer countries than it did, and never on a
 * country whose ISO currency code the CC0 facts artifact actually carries.
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
  /**
   * The currency the rates are against. Three states, and they are three
   * different facts rather than two:
   *
   * - a code — this trip's rates are expressed in it;
   * - `null` — recorded at creation: nobody has researched a currency for this
   *   trip's country, so there is no pivot to name;
   * - ABSENT — legacy. Saved before this field existed, which means CNY.
   *
   * `null` exists because absent used to mean both of the last two at once.
   * See `initialCurrencySettings` below.
   */
  pivot?: string | null;
}

/**
 * The pivot a trip's rates are expressed in, or `null` when the trip has none.
 *
 * The only way callers should read the field, and the reason it is not
 * `settings.pivot ?? "CNY"` any more.
 *
 * THAT DEFAULT WAS RIGHT ABOUT LEGACY ROWS AND WRONG ABOUT NEW ONES. The
 * docblock said an absent pivot means legacy CNY — settings saved before the
 * field existed, all of which belong to China trips, the same reasoning
 * `tripCountry` documents for the persisted side. But `initialCurrencySettings`
 * only ever STAMPED a pivot when `isCurrencyResearched` passed, so a
 * brand-new trip to any of the eleven codes with no researched currency —
 * Panama, Namibia, Lesotho, the Faroes, the Isle of Man, Saint Helena, the
 * BIOT, and the four the facts artifact never reached — got an absent pivot
 * too, and was then told its rates were in Chinese yuan. The Money tab read
 * "Total CNY" and its rate editor asked a Panama traveller to price every
 * currency against CNY.
 *
 * The fix is at the write end: `initialCurrencySettings` now always writes the
 * key, so ABSENT can only be a legacy row and keeps meaning exactly what it
 * meant. An unresearched country records `null` instead, which the money
 * surfaces read as "no basis to convert" rather than as a currency.
 *
 * Trips created by earlier builds of this branch keep an absent pivot and will
 * still read CNY. That population is dev-only — the branch is unmerged — and it
 * is not distinguishable from a genuine legacy row by any rule, which is
 * precisely why the distinction had to be written down at creation.
 */
export function currencyPivot(settings: CurrencySettings): string | null {
  // `=== undefined`, not `??`: `null` is an answer here, not a missing one.
  return settings.pivot === undefined ? "CNY" : settings.pivot;
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
 * The pivot's VALUE is still stamped only when `isCurrencyResearched` says the
 * country's currency is a fact rather than an absence (judgment call J-C1, see
 * the comment on `tripCurrency` above) — stamping a guess would persist it as
 * though it were researched. What changed is that the KEY is now always
 * written, with `null` for an unresearched country.
 *
 * The old shape omitted the key entirely in that case, and the sentence
 * justifying it — "an absent pivot is not a gap: `currencyPivot` reads it as
 * the legacy CNY default" — was the defect. It reasoned about legacy China
 * trips and applied the conclusion to a brand-new Panama one: absent meant
 * both "saved before this field existed" and "this country has no researched
 * currency", and the first of those means CNY. So a trip to Panama, Namibia,
 * Lesotho or any of the other eight unresearched codes was priced in Chinese
 * yuan from the moment it was created, on a live path.
 *
 * Writing `null` is what makes the two distinguishable. Absent can now only be
 * a legacy row, and keeps meaning exactly what it meant.
 *
 * The predicate and the null check below ask the same question twice, and
 * deliberately: the predicate is the rule, the null is what TypeScript can
 * narrow on. Dropping the predicate for a bare `?? null` would stamp the same
 * values while saying nothing about why.
 */
export function initialCurrencySettings(countryCode: CountryCode): CurrencySettings {
  const pivot = isCurrencyResearched(countryCode)
    ? getCountryProfile(countryCode).currency
    : null;
  return { home: null, rates: {}, pivot };
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
 * is `undefined` there too, so the resolution below is `undefined`, and the
 * spread adds no key at all — never an explicit `pivot: undefined`, which
 * would be a different (and wrong) stored shape.
 *
 * THE ONE CASE THAT WRITES A PIVOT THE TRIP DID NOT HAVE is a stored `null`
 * — a country with no researched currency — meeting a save that sets a home
 * currency. The rates the member is about to enter need a unit, and the only
 * one anybody has named is the home currency they just chose. Stamping it
 * here is not a guess about the country: it is the member's own declaration,
 * recorded once. Recorded rather than resolved at read time on purpose — a
 * pivot that tracked `home` would silently reinterpret every stored rate the
 * next time somebody changed it, and `existing.pivot` is a string from this
 * point on, so it never moves again.
 */
export function applyCurrencySettingsUpdate(
  existing: CurrencySettings,
  incoming: { home: string | null; rates: Record<string, number>; pivot?: string }
): CurrencySettings {
  const stored =
    existing.pivot === null && incoming.home !== null ? incoming.home : existing.pivot;
  const pivot = incoming.pivot ?? stored;
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
