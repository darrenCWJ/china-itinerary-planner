export type Season = "spring" | "summer" | "autumn" | "winter";

export type Interest =
  | "food"
  | "history"
  | "nature"
  | "beach"
  | "themepark"
  | "arcade"
  | "shopping"
  | "nightlife"
  | "museums"
  | "hiking"
  | "family";

import type { CountryCode } from "./countries";

/** Defined once in lib/countries; re-exported so type-only consumers stay here. */
export type { CountryCode };

/**
 * China's own region split. Named for the country it describes because the
 * word "region" means something different in every other one.
 */
export type ChinaRegion =
  | "North"
  | "Northeast"
  | "Northwest"
  | "East"
  | "South"
  | "Southwest"
  | "Central";

export type TimeSlot = "morning" | "afternoon" | "evening";

/** When an activity can be scheduled. "day" = morning or afternoon, "any" = any slot. */
export type TimeOfDay = TimeSlot | "day" | "any";

export interface Activity {
  name: string;
  interests: Interest[];
  /** How many daytime slots it takes: 1 = half day, 2 = full day. */
  slots: 1 | 2;
  timeOfDay: TimeOfDay;
  bestSeasons?: Season[];
  /** Seasons in which the activity is closed or not worth doing — it is excluded from plans. */
  avoidSeasons?: Season[];
  mustSee?: boolean;
  note?: string;
}

export interface Destination {
  id: string;
  name: string;
  /** Name in the local language. `null` for a hand-typed place with none. */
  localName: string | null;
  /**
   * A region label meaningful inside this destination's country — "East" in
   * China, "Kansai" in Japan. Free-form by spec §5.1: there is no union that
   * could span every country, and inventing one per country would put the
   * catalog's vocabulary in the type system.
   */
  region: string;
  /**
   * ISO alpha-2, required.
   *
   * It was optional while the app was China-only, and four separate call sites
   * read an absent one as `"CN"`. Required is what makes the compiler enforce
   * spec §5's rule that "a future destination cannot silently claim China":
   * there is no longer anywhere to omit it, so no default can be wrong.
   */
  country: CountryCode;
  /**
   * City-centre coordinates for the map view. null = an off-map place, one
   * hand-typed with no location attached: it still takes days, nights and
   * budget, but contributes no distance. All curated data has coordinates.
   */
  lat: number | null;
  lon: number | null;
  emoji: string;
  tagline: string;
  /** What this place is famous for — shown on selection cards. */
  knownFor: string[];
  bestSeasons: Season[];
  seasonNotes: Partial<Record<Season, string>>;
  foods: string[];
  /** Recommended trip length range in days: [min, max]. */
  suggestedDays: [number, number];
  activities: Activity[];
}

/**
 * One titled block of a packing list.
 *
 * Lives here rather than in lib/packing.ts so lib/countryProfile.ts can name
 * the shape without importing the generator that builds it — the generator
 * has to import the profile, and a module cannot be on both ends of that.
 * lib/packing.ts re-exports this name, so every existing consumer keeps its
 * `from "@/lib/packing"` import.
 */
export interface PackingGroup {
  title: string;
  emoji: string;
  items: string[];
}
