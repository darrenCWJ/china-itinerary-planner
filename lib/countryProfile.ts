import { DEFAULT_AIRPORT_RADIUS_KM } from "./airports";
import { getCountry } from "./countries";
import { CN_BOOKING_COPY, CN_GENERAL_TIPS, CN_PACKING, CN_RAIL_KMH } from "./countryData/cn";
import { NEUTRAL_BOOKING_COPY, NEUTRAL_PACKING, NEUTRAL_TIPS } from "./countryData/neutral";
import {
  FLIGHT_BUFFER_H,
  FLIGHT_KMH,
  FLIGHT_THRESHOLD_KM,
  GROUND_TRANSFER_KMH,
  RAIL_BUFFER_H,
} from "./countryData/transportDefaults";
import {
  HOLIDAY_BANDS,
  NATIONAL_CROWD,
  REGION_MONTHS,
  seasonOfMonth,
  type HolidayBand,
  type RegionMonthClimate,
} from "./months";
import type { PackingGroup, Season } from "./types";

export interface TransportProfile {
  /** null = no meaningful rail estimate for this country. */
  railKmh: number | null;
  flightThresholdKm: number;
  flightKmh: number;
  railBufferH: number;
  flightBufferH: number;
  /** Average door-to-door speed between a city centre and its airport — not country-specific. */
  groundTransferKmh: number;
  /** Radius searched for a nearby airport, in km — not country-specific. */
  airportSearchRadiusKm: number;
  /** Generation-time copy: where and how far ahead to book. */
  bookingCopy: string[];
}

export interface CountryProfile {
  /** Hemisphere-aware, unlike the bare months.ts version it wraps. */
  seasonOfMonth(month: number): Season;
  /** Crowd pressure per calendar month, 1 (quiet) – 5 (peak). */
  crowdByMonth: number[];
  holidays: HolidayBand[];
  /** The whole packing document, not a set of deltas. */
  packing: PackingGroup[];
  transport: TransportProfile;
  /** Generation-time tips, snapshotted into the trip when it is created. */
  tips: string[];
  /** Rows for a region, or null when this country has no climate table. */
  climateFor(region: string): RegionMonthClimate[] | null;
  /** Currency conversion pivot. */
  currency: string;
}

/**
 * Southern seasons are the northern ones half a year away. Shifting the month
 * rather than mapping the season keeps months.ts as the single definition of
 * where the season boundaries fall.
 */
function seasonIn(hemisphere: "north" | "south", month: number): Season {
  return seasonOfMonth(hemisphere === "south" ? ((month + 5) % 12) + 1 : month);
}

/**
 * China's climate table is keyed by the app's own region union. A plain index
 * would resolve inherited keys ("constructor", "toString") to something that
 * is not a climate row, so ownership is checked rather than truthiness.
 */
function chinaClimate(region: string): RegionMonthClimate[] | null {
  if (!Object.prototype.hasOwnProperty.call(REGION_MONTHS, region)) return null;
  const rows = (REGION_MONTHS as Record<string, RegionMonthClimate[]>)[region];
  return rows.map((row) => ({ ...row }));
}

/** Flat, so nothing is claimed about a country nobody has researched. */
const FLAT_CROWD = 3;

/**
 * The half of a transport profile that is about aircraft, airports and taxis
 * rather than about one country's networks. Read from the leaf the estimator
 * reads, so `TRANSPORT` and every profile can never disagree.
 */
const TRANSPORT_DEFAULTS = {
  flightThresholdKm: FLIGHT_THRESHOLD_KM,
  flightKmh: FLIGHT_KMH,
  railBufferH: RAIL_BUFFER_H,
  flightBufferH: FLIGHT_BUFFER_H,
  groundTransferKmh: GROUND_TRANSFER_KMH,
  /** Not country-specific: the radius the airport index is searched over. */
  airportSearchRadiusKm: DEFAULT_AIRPORT_RADIUS_KM,
} as const;

function chinaProfile(): CountryProfile {
  return {
    seasonOfMonth: (month) => seasonIn("north", month),
    crowdByMonth: [...NATIONAL_CROWD],
    holidays: HOLIDAY_BANDS.map((band) => ({ ...band })),
    packing: CN_PACKING.map((group) => ({ ...group, items: [...group.items] })),
    transport: {
      railKmh: CN_RAIL_KMH,
      ...TRANSPORT_DEFAULTS,
      bookingCopy: [...CN_BOOKING_COPY],
    },
    tips: [...CN_GENERAL_TIPS],
    climateFor: chinaClimate,
    currency: "CNY",
  };
}

function neutralProfile(hemisphere: "north" | "south"): CountryProfile {
  return {
    seasonOfMonth: (month) => seasonIn(hemisphere, month),
    crowdByMonth: Array.from({ length: 12 }, () => FLAT_CROWD),
    holidays: [],
    packing: NEUTRAL_PACKING.map((group) => ({ ...group, items: [...group.items] })),
    transport: {
      // Rail speed is a claim about a specific network, so it is withheld.
      // Cruise speed and airport overhead are not country-specific, so the
      // flight estimate stays useful everywhere.
      railKmh: null,
      ...TRANSPORT_DEFAULTS,
      bookingCopy: [...NEUTRAL_BOOKING_COPY],
    },
    tips: [...NEUTRAL_TIPS],
    climateFor: () => null,
    currency:
      // Placeholder pivot. A country without a researched profile has no known
      // currency, and the interface has no room for "unknown" — see the money
      // module, where the pivot a trip was priced in is persisted per trip.
      "USD",
  };
}

/**
 * Total function: every code yields a profile, including codes that are not
 * countries. Callers read the profile rather than branching on whether the
 * country is supported, which is what keeps an unresearched country from
 * breaking generation.
 *
 * Fresh objects each call: the arrays are copies, so a caller that mutates
 * what it is handed cannot corrupt the curated tables for everyone else.
 */
export function getCountryProfile(code: string): CountryProfile {
  const country = getCountry(code);
  return country.code === "CN" ? chinaProfile() : neutralProfile(country.hemisphere);
}

/**
 * Whether `getCountryProfile(code).currency` reflects real currency research
 * rather than `neutralProfile`'s admitted USD placeholder (see the comment on
 * that field above). Only China has a currency-researched profile today —
 * this mirrors `getCountryProfile`'s own CN-only dispatch exactly, so the two
 * can never disagree about which countries are "researched."
 *
 * Exists for callers (the live-rates page, Task 7) that must never present a
 * placeholder pivot as fact — see judgment call J-C1 in
 * docs/superpowers/plans/2026-08-17-pr4-currency-pivot-plan.md. A future
 * researched profile for another country should extend the check here, which
 * keeps this the one place "researched" is decided.
 */
export function isCurrencyResearched(code: string): boolean {
  return getCountry(code).code === "CN";
}
