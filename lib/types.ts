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

export type Region =
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
  chineseName: string;
  region: Region;
  /** City-centre coordinates for the map view. */
  lat: number;
  lon: number;
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
