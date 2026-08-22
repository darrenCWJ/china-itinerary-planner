import { getCountry } from "./countries";
import { GENERAL_TIPS } from "./itinerary";
import {
  HOLIDAY_BANDS,
  NATIONAL_CROWD,
  REGION_MONTHS,
  seasonOfMonth,
  type HolidayBand,
  type RegionMonthClimate,
} from "./months";
import type { PackingGroup } from "./packing";
import { TRANSPORT } from "./route";
import type { Season } from "./types";

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

/**
 * The static half of the China packing document. The seasonal and
 * interest-driven groups still come from buildPackingList, which remains the
 * live generator — this is the country-level document that generation will be
 * rewired onto, not a second implementation of it.
 */
const CHINA_PACKING: PackingGroup[] = [
  {
    title: "Documents & Money",
    emoji: "🛂",
    items: [
      "Passport (6+ months validity) and visa or visa-free confirmation",
      "Printed hotel bookings and return flight (border control may ask)",
      "Alipay + WeChat Pay set up and tested with your bank card",
      "Some RMB cash (¥300–500) as a backup",
      "Travel insurance policy details",
    ],
  },
  {
    title: "Tech",
    emoji: "🔌",
    items: [
      "Phone + power bank — everything in China runs through your phone",
      "VPN installed and tested before departure",
      "Universal power adapter (China uses type A/C/I plugs, 220V)",
      "Offline translation app (Pleco or Google Translate offline pack)",
      "Offline maps app (Amap 高德 has the best China coverage)",
    ],
  },
  {
    title: "Health & Comfort",
    emoji: "💊",
    items: [
      "Prescription medicines in original packaging",
      "Pocket tissues and hand sanitiser — many restrooms lack paper",
      "Basic meds: stomach relief, cold tablets, motion sickness",
      "Reusable water bottle — hotels have kettles; tap water isn't potable",
    ],
  },
];

/**
 * Deliberately thin. Anything a country has not been researched for is absent
 * rather than guessed: no holidays, no climate, no rail estimate. The one
 * thing it must get right is the hemisphere, which is the bug this seam
 * exists to fix.
 */
const NEUTRAL_PACKING: PackingGroup[] = [
  {
    title: "Documents & Money",
    emoji: "🛂",
    items: [
      "Passport with at least six months' validity, plus any visa you need",
      "A payment card that works abroad, and a small amount of local cash",
      "Travel insurance policy details",
      "Copies of your bookings, stored offline",
    ],
  },
  {
    title: "Tech",
    emoji: "🔌",
    items: [
      "Universal power adapter",
      "Phone and power bank",
      "Offline maps and a translation app downloaded before you fly",
    ],
  },
  {
    title: "Health & Comfort",
    emoji: "💊",
    items: [
      "Prescription medicines in their original packaging",
      "Basic meds: stomach relief, painkillers, motion sickness",
      "Reusable water bottle",
      "Comfortable broken-in walking shoes",
    ],
  },
];

const NEUTRAL_TIPS: string[] = [
  "Check your passport validity and entry requirements well before you book.",
  "Tell your bank you are travelling so your cards keep working.",
  "Download offline maps and a translation pack before you leave.",
];

/** Flat, so nothing is claimed about a country nobody has researched. */
const FLAT_CROWD = 3;

function chinaProfile(): CountryProfile {
  return {
    seasonOfMonth: (month) => seasonIn("north", month),
    crowdByMonth: [...NATIONAL_CROWD],
    holidays: HOLIDAY_BANDS.map((band) => ({ ...band })),
    packing: CHINA_PACKING.map((group) => ({ ...group, items: [...group.items] })),
    transport: {
      railKmh: TRANSPORT.railKmh,
      flightThresholdKm: TRANSPORT.flightThresholdKm,
      flightKmh: TRANSPORT.flightKmh,
      railBufferH: TRANSPORT.railBufferH,
      flightBufferH: TRANSPORT.flightBufferH,
      groundTransferKmh: TRANSPORT.groundTransferKmh,
      airportSearchRadiusKm: TRANSPORT.airportSearchRadiusKm,
      bookingCopy: [
        "High-speed rail seats open about 15 days ahead on 12306 or Trip.com.",
        "Your passport is the ticket — carry it to collect seats and to board.",
      ],
    },
    tips: [...GENERAL_TIPS],
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
      flightThresholdKm: TRANSPORT.flightThresholdKm,
      flightKmh: TRANSPORT.flightKmh,
      railBufferH: TRANSPORT.railBufferH,
      flightBufferH: TRANSPORT.flightBufferH,
      groundTransferKmh: TRANSPORT.groundTransferKmh,
      airportSearchRadiusKm: TRANSPORT.airportSearchRadiusKm,
      bookingCopy: ["Book long-distance transport ahead — fares climb close to the date."],
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
