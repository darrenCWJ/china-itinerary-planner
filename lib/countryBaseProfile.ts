import { DEFAULT_AIRPORT_RADIUS_KM } from "./airports";
import { getCountry } from "./countries";
import {
  CN_BOOKING_COPY,
  CN_DEPARTURE_AFTERNOON,
  CN_DEPARTURE_EVENING,
  CN_HOP_NOTE,
  CN_HOP_TITLE,
  CN_KIDS_TIP,
  CN_RAIL_KMH,
  CN_WINTER_CLOTHING_NOTE,
} from "./countryData/cn";
import {
  NEUTRAL_BOOKING_COPY,
  NEUTRAL_DEPARTURE_AFTERNOON,
  NEUTRAL_DEPARTURE_EVENING,
  NEUTRAL_HOP_NOTE,
  NEUTRAL_HOP_TITLE,
  NEUTRAL_KIDS_TIP,
  NEUTRAL_WINTER_CLOTHING_NOTE,
} from "./countryData/neutral";
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
import type { CountryCode, Season } from "./types";

/**
 * The half of a country profile that costs no data artifact — and the module
 * every map, route and calendar surface reads.
 *
 * **This split is a bundle constraint, not a taste.** `getCountryProfile` in
 * lib/countryProfile.ts is imported by four `"use client"` components
 * (components/map/MapExplorer.tsx, MonthTimeline.tsx, PlacePopup.tsx and
 * components/trip/RouteMap.tsx), and since T27 that module reads
 * `data/country-facts.json` — 70,443 bytes, measured 2026-08-27. Every one of
 * those four reads only what is defined below: seasons, crowd, holidays,
 * climate and transport. None of them reads `tips`, `packing`, `currency` or
 * `gapNote`, which are the only facts-derived fields. So the artifact would
 * have shipped to the browser on every page that renders a map, to be read by
 * nothing on it.
 *
 * The shape is lib/geoNamesId.ts's against the 3.65 MB city index, and
 * lib/countries.ts's against this same artifact: the cheap half is a module of
 * its own, and the module that already pays for the heavy data layers on top
 * rather than the other way round. lib/countryFacts.test.ts holds it down with
 * a transitive import walk, so a client component that reaches the artifact by
 * any path at all fails the build rather than quietly costing 70 KB.
 *
 * Nothing here is facts-derived, and nothing here should become facts-derived:
 * Wikidata carries no crowd curve, no holiday band, no climate row and no rail
 * speed. If it ever did, that field belongs in the layer above, not here.
 */

/**
 * The country a generator assumes when its input does not name one.
 *
 * One constant rather than a `?? "CN"` in each generator: `buildItinerary` and
 * `buildPackingList` are handed the same `TripInput`, and two literals that
 * drift apart would give one trip two countries' copy. `TripInput.country` is
 * optional because trips saved before the field existed do not carry it, and
 * every one of those is a China trip — the same reasoning `tripCountry` in
 * lib/tripShared.ts documents at length for the persisted side.
 */
export const DEFAULT_COUNTRY: CountryCode = "CN";

/**
 * Country-specific sentences the generators splice into their own output.
 *
 * These are not tips or packing items in their own right — each one is a
 * fragment that only makes sense in the place the generator puts it, which is
 * why they live here rather than in `tips`.
 */
export interface CountryCopy {
  /** Added to the tips when the party includes children. */
  kidsTip: string;
  /**
   * Extra winter clothing item, appended after the generic cold-weather ones.
   * `null` when nothing country-specific is known — never a hedge.
   */
  winterClothingNote: string | null;
}

export interface TransportProfile {
  /**
   * null = no meaningful rail estimate for this country.
   *
   * Read by `estimateLeg` in lib/route.ts, and load-bearing there: null means
   * no leg is ever scored as rail. Such a leg is flown when an airport pair
   * resolves and beats the ground transfer to reach it, and is an `overland`
   * leg — distance, and deliberately no duration — otherwise.
   */
  railKmh: number | null;
  flightThresholdKm: number;
  flightKmh: number;
  railBufferH: number;
  flightBufferH: number;
  /** Average door-to-door speed between a city centre and its airport — not country-specific. */
  groundTransferKmh: number;
  /** Radius searched for a nearby airport, in km — not country-specific. */
  airportSearchRadiusKm: number;
  /**
   * Generation-time copy: where and how far ahead to book.
   *
   * `suggestRoute` emits it on two different conditions, because the two
   * versions of this copy make two different claims. A researched country's
   * names its network ("every leg is high-speed-rail friendly — book on
   * 12306"), so it is emitted only on an all-ground route and only when
   * `railKmh` is non-null; its premise is that the traveller is about to spend
   * the trip on trains, which is false wherever rail is withheld. The neutral
   * version names no network and no vendor, so it rides out on any route with
   * a measured distance — a country with no rail still has transport to book,
   * and going silent there would be a gap where there is no gap.
   */
  bookingCopy: string[];
  /**
   * Title for the itinerary item that moves the party to a new city.
   * A template: `{city}` is substituted with the arrival city by the caller,
   * so the sentence stays reviewable as one string rather than as
   * concatenation spread across the generator.
   */
  hopTitle: string;
  /** Note under the hop title, or `null` when nothing can be claimed. */
  hopNote: string | null;
  /**
   * Last-day copy. `evening` is used when transit already took the morning,
   * `afternoon` when the afternoon is free to travel.
   */
  departureCopy: { evening: string; afternoon: string };
}

/**
 * Seasons, crowd, holidays, climate, transport and spliced copy — every field
 * a country has without the facts artifact.
 *
 * `CountryProfile` in lib/countryProfile.ts extends this with the four
 * facts-derived fields. Read THIS one wherever none of those four is needed;
 * the extension costs 70 KB in whatever bundle it lands in.
 */
export interface CountryBaseProfile {
  /** Hemisphere-aware, unlike the bare months.ts version it wraps. */
  seasonOfMonth(month: number): Season;
  /**
   * Crowd pressure per calendar month, 1 (quiet) – 5 (peak), or `null` when
   * nobody has researched this country.
   *
   * `null` rather than a flat twelve-long row of 3s, and the distinction is the
   * whole point: a flat row is not the absence of a claim. Rendered under the
   * label its consumers use — *typical national crowd pressure this month* — it
   * states that every month is equally busy, which is a brand-new unsourced
   * claim invented by the very code that was meant to remove one. Consumers
   * render no crowd element at all when this is null.
   */
  crowdByMonth: number[] | null;
  holidays: HolidayBand[];
  transport: TransportProfile;
  /** Sentences the generators splice into their own output. */
  copy: CountryCopy;
  /** Rows for a region, or null when this country has no climate table. */
  climateFor(region: string): RegionMonthClimate[] | null;
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
 * The half of a transport profile that is about aircraft, airports and taxis
 * rather than about one country's networks. Read from the leaf the estimator
 * used to read directly, and now the only definition of these numbers: since
 * T22, `route.ts`'s exported `TRANSPORT` *is* the default country's profile,
 * so the two cannot disagree because they are the same object.
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

function chinaBase(): CountryBaseProfile {
  return {
    seasonOfMonth: (month) => seasonIn("north", month),
    crowdByMonth: [...NATIONAL_CROWD],
    holidays: HOLIDAY_BANDS.map((band) => ({ ...band })),
    transport: {
      railKmh: CN_RAIL_KMH,
      ...TRANSPORT_DEFAULTS,
      bookingCopy: [...CN_BOOKING_COPY],
      hopTitle: CN_HOP_TITLE,
      hopNote: CN_HOP_NOTE,
      departureCopy: { evening: CN_DEPARTURE_EVENING, afternoon: CN_DEPARTURE_AFTERNOON },
    },
    copy: { kidsTip: CN_KIDS_TIP, winterClothingNote: CN_WINTER_CLOTHING_NOTE },
    climateFor: chinaClimate,
  };
}

function neutralBase(hemisphere: "north" | "south"): CountryBaseProfile {
  return {
    seasonOfMonth: (month) => seasonIn(hemisphere, month),
    // Absent, not flat — see the field's doc comment on CountryBaseProfile.
    crowdByMonth: null,
    holidays: [],
    transport: {
      // Rail speed is a claim about a specific network, so it is withheld.
      // Cruise speed and airport overhead are not country-specific, so the
      // flight estimate stays useful everywhere. What this null buys, in
      // lib/route.ts: no rail leg, no rail glyph, and no rail booking copy for
      // any country nobody has researched a network for.
      railKmh: null,
      ...TRANSPORT_DEFAULTS,
      bookingCopy: [...NEUTRAL_BOOKING_COPY],
      hopTitle: NEUTRAL_HOP_TITLE,
      hopNote: NEUTRAL_HOP_NOTE,
      departureCopy: {
        evening: NEUTRAL_DEPARTURE_EVENING,
        afternoon: NEUTRAL_DEPARTURE_AFTERNOON,
      },
    },
    copy: { kidsTip: NEUTRAL_KIDS_TIP, winterClothingNote: NEUTRAL_WINTER_CLOTHING_NOTE },
    climateFor: () => null,
  };
}

/**
 * Total function: every code yields a profile, including codes that are not
 * countries. Callers read the profile rather than branching on whether the
 * country is supported, which is what keeps an unresearched country from
 * breaking generation.
 *
 * Two branches, not three: the facts artifact carries no crowd curve, no
 * holiday, no climate row and no rail speed, so a country the ingest reached
 * and one it did not are the same country to everything defined here. The
 * three-way dispatch lives one layer up, where the difference exists.
 *
 * Fresh objects each call: the arrays are copies, so a caller that mutates
 * what it is handed cannot corrupt the curated tables for everyone else.
 */
export function getCountryBaseProfile(code: string): CountryBaseProfile {
  const country = getCountry(code);
  return country.code === "CN" ? chinaBase() : neutralBase(country.hemisphere);
}
