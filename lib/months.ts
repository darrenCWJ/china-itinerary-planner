import type { Region, Season } from "./types";

/** How well a month suits a place. Drives map tinting and popup verdicts. */
export type MonthFit = "great" | "ok" | "poor" | "avoid";

export interface MonthInfo {
  /** 1–12 */
  id: number;
  label: string;
  short: string;
  season: Season;
}

export const MONTHS: MonthInfo[] = [
  { id: 1, label: "January", short: "Jan", season: "winter" },
  { id: 2, label: "February", short: "Feb", season: "winter" },
  { id: 3, label: "March", short: "Mar", season: "spring" },
  { id: 4, label: "April", short: "Apr", season: "spring" },
  { id: 5, label: "May", short: "May", season: "spring" },
  { id: 6, label: "June", short: "Jun", season: "summer" },
  { id: 7, label: "July", short: "Jul", season: "summer" },
  { id: 8, label: "August", short: "Aug", season: "summer" },
  { id: 9, label: "September", short: "Sep", season: "autumn" },
  { id: 10, label: "October", short: "Oct", season: "autumn" },
  { id: 11, label: "November", short: "Nov", season: "autumn" },
  { id: 12, label: "December", short: "Dec", season: "winter" },
];

export function seasonOfMonth(month: number): Season {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/**
 * National crowd pressure per month, 1 (quiet) – 5 (peak). Spikes inside a
 * month (Golden Week, CNY) are carried by the holiday bands below.
 */
export const NATIONAL_CROWD: number[] = [2, 4, 2, 3, 3, 2, 4, 4, 2, 4, 2, 2];

export function crowdForMonth(month: number): number {
  return NATIONAL_CROWD[month - 1] ?? 2;
}

/**
 * Holiday/crowd bands rendered on the timeline. `from`/`to` are fractional
 * 0-indexed months (0 = 1 Jan, 11.99 ≈ 31 Dec) so bands can span partial
 * months. CNY dates shift year to year; the band covers the usual window.
 */
export interface HolidayBand {
  name: string;
  emoji: string;
  from: number;
  to: number;
  crowd: number;
  note: string;
}

export const HOLIDAY_BANDS: HolidayBand[] = [
  {
    name: "Chinese New Year",
    emoji: "🧧",
    from: 0.65,
    to: 1.55,
    crowd: 5,
    note: "The world's biggest annual migration — trains sell out weeks ahead, many shops close.",
  },
  {
    name: "Labour Day",
    emoji: "🚩",
    from: 4.0,
    to: 4.17,
    crowd: 5,
    note: "May 1–5 holiday: major sights hit capacity.",
  },
  {
    name: "School summer holidays",
    emoji: "🎒",
    from: 6.0,
    to: 8.0,
    crowd: 4,
    note: "Families travel Jul–Aug — theme parks and big-ticket sights run busy.",
  },
  {
    name: "National Day Golden Week",
    emoji: "🇨🇳",
    from: 9.0,
    to: 9.23,
    crowd: 5,
    note: "Oct 1–7: the busiest sightseeing week of the year. Avoid if you can.",
  },
];

/** Bands overlapping a given month (1–12). */
export function bandsForMonth(month: number): HolidayBand[] {
  const start = month - 1;
  const end = month;
  return HOLIDAY_BANDS.filter((b) => b.from < end && b.to > start);
}

export interface RegionMonthClimate {
  /** Typical daily low/high, °C. */
  lo: number;
  hi: number;
  fit: MonthFit;
  note?: string;
}

/**
 * Approximate month-by-month climate + travel fit per app region, anchored on
 * a representative city (North→Beijing, Northeast→Harbin, East→Shanghai,
 * South→Guangzhou, Southwest→Chengdu/Kunming, Northwest→Xi'an/Dunhuang,
 * Central→Wuhan). Used for catalog cities that lack curated season data.
 */
export const REGION_MONTHS: Record<Region, RegionMonthClimate[]> = {
  North: [
    { lo: -9, hi: 2, fit: "poor", note: "Bitter dry cold, clear skies" },
    { lo: -7, hi: 5, fit: "poor" },
    { lo: 0, hi: 12, fit: "ok", note: "Windy; occasional dust" },
    { lo: 7, hi: 20, fit: "great", note: "Blossom season" },
    { lo: 13, hi: 26, fit: "great" },
    { lo: 18, hi: 30, fit: "ok", note: "Getting hot" },
    { lo: 22, hi: 31, fit: "ok", note: "Hot with thunderstorms" },
    { lo: 20, hi: 30, fit: "ok" },
    { lo: 14, hi: 26, fit: "great", note: "Crisp blue-sky season" },
    { lo: 7, hi: 19, fit: "great" },
    { lo: -1, hi: 10, fit: "ok", note: "Late foliage early Nov" },
    { lo: -6, hi: 3, fit: "poor" },
  ],
  Northeast: [
    { lo: -24, hi: -13, fit: "ok", note: "Brutally cold — but Ice Festival season" },
    { lo: -20, hi: -8, fit: "ok", note: "Ice Festival runs to late Feb" },
    { lo: -10, hi: 2, fit: "poor", note: "Grey thaw" },
    { lo: 0, hi: 13, fit: "ok" },
    { lo: 8, hi: 21, fit: "great" },
    { lo: 14, hi: 26, fit: "great" },
    { lo: 18, hi: 28, fit: "great", note: "Cool escape from southern heat" },
    { lo: 16, hi: 26, fit: "great" },
    { lo: 8, hi: 20, fit: "great" },
    { lo: 0, hi: 12, fit: "ok" },
    { lo: -10, hi: 0, fit: "poor" },
    { lo: -20, hi: -9, fit: "ok", note: "Ice Festival opens late Dec" },
  ],
  East: [
    { lo: 1, hi: 8, fit: "poor", note: "Damp chill" },
    { lo: 2, hi: 10, fit: "poor" },
    { lo: 6, hi: 14, fit: "ok" },
    { lo: 11, hi: 20, fit: "great", note: "Peak garden season" },
    { lo: 17, hi: 25, fit: "great" },
    { lo: 21, hi: 28, fit: "ok", note: "Plum-rain season" },
    { lo: 25, hi: 33, fit: "poor", note: "Hot and humid" },
    { lo: 25, hi: 33, fit: "poor", note: "Typhoon season peaks" },
    { lo: 21, hi: 28, fit: "ok", note: "Warm; typhoon risk lingers" },
    { lo: 15, hi: 23, fit: "great" },
    { lo: 9, hi: 17, fit: "great", note: "Autumn foliage" },
    { lo: 3, hi: 11, fit: "ok" },
  ],
  South: [
    { lo: 10, hi: 18, fit: "great", note: "Mild, dry winter escape" },
    { lo: 12, hi: 19, fit: "ok", note: "CNY crowds; coastal mist" },
    { lo: 15, hi: 22, fit: "ok", note: "Humid mist season" },
    { lo: 19, hi: 26, fit: "ok", note: "Warm; showers building" },
    { lo: 22, hi: 30, fit: "ok" },
    { lo: 24, hi: 32, fit: "poor", note: "Hot, heavy rain" },
    { lo: 26, hi: 33, fit: "poor", note: "Typhoons possible" },
    { lo: 26, hi: 33, fit: "poor", note: "Typhoons possible" },
    { lo: 24, hi: 31, fit: "ok", note: "Typhoon tail-end" },
    { lo: 20, hi: 28, fit: "great" },
    { lo: 15, hi: 24, fit: "great" },
    { lo: 11, hi: 20, fit: "great", note: "Dry and comfortable" },
  ],
  Southwest: [
    { lo: 3, hi: 12, fit: "ok", note: "Kunming stays springlike" },
    { lo: 5, hi: 14, fit: "ok" },
    { lo: 9, hi: 18, fit: "great" },
    { lo: 13, hi: 22, fit: "great" },
    { lo: 17, hi: 25, fit: "great" },
    { lo: 20, hi: 27, fit: "ok", note: "Rainy season starts" },
    { lo: 21, hi: 29, fit: "ok", note: "Wettest month" },
    { lo: 21, hi: 29, fit: "ok" },
    { lo: 18, hi: 25, fit: "great" },
    { lo: 14, hi: 21, fit: "great" },
    { lo: 8, hi: 16, fit: "great" },
    { lo: 4, hi: 12, fit: "ok" },
  ],
  Northwest: [
    { lo: -8, hi: 3, fit: "poor" },
    { lo: -5, hi: 7, fit: "poor" },
    { lo: 2, hi: 14, fit: "ok" },
    { lo: 8, hi: 21, fit: "great" },
    { lo: 13, hi: 26, fit: "great" },
    { lo: 18, hi: 30, fit: "great", note: "Best window for Xinjiang" },
    { lo: 21, hi: 32, fit: "ok", note: "Desert heat" },
    { lo: 20, hi: 31, fit: "ok" },
    { lo: 14, hi: 26, fit: "great" },
    { lo: 6, hi: 18, fit: "great" },
    { lo: -1, hi: 9, fit: "ok" },
    { lo: -6, hi: 3, fit: "poor" },
  ],
  Central: [
    { lo: 1, hi: 8, fit: "poor" },
    { lo: 3, hi: 10, fit: "poor" },
    { lo: 8, hi: 15, fit: "ok" },
    { lo: 14, hi: 22, fit: "great" },
    { lo: 19, hi: 27, fit: "great" },
    { lo: 23, hi: 31, fit: "ok" },
    { lo: 26, hi: 34, fit: "avoid", note: "'Furnace city' heat" },
    { lo: 25, hi: 34, fit: "avoid", note: "'Furnace city' heat" },
    { lo: 20, hi: 28, fit: "ok" },
    { lo: 14, hi: 22, fit: "great" },
    { lo: 8, hi: 16, fit: "great" },
    { lo: 3, hi: 10, fit: "ok" },
  ],
};

export function regionMonthClimate(region: Region, month: number): RegionMonthClimate {
  return REGION_MONTHS[region][month - 1];
}

/**
 * Fit for a place with curated season data. avoidSeasons wins, then
 * bestSeasons, otherwise "ok".
 */
export function monthFitForSeasons(
  seasons: { bestSeasons: Season[]; avoidSeasons?: Season[] },
  month: number
): MonthFit {
  const season = seasonOfMonth(month);
  if (seasons.avoidSeasons?.includes(season)) return "avoid";
  if (seasons.bestSeasons.includes(season)) return "great";
  return "ok";
}

/**
 * Month-specific one-liners for curated destinations — festivals, foliage,
 * harvests. Shown in the map popup for the selected month.
 */
export const CURATED_HIGHLIGHTS: Record<string, Partial<Record<number, string>>> = {
  beijing: {
    4: "Blossoms at the Summer Palace and Jingshan",
    9: "Crisp blue-sky season — the classic time",
    10: "Fragrant Hills foliage from late Oct",
  },
  xian: {
    3: "City-wall cycling weather begins",
    9: "Clear days for Terracotta Army day-trips",
  },
  qingdao: {
    6: "Beach season warms up",
    7: "Peak beach season",
    8: "Qingdao International Beer Festival",
  },
  harbin: {
    1: "Ice & Snow Festival in full swing — the reason to come",
    2: "Ice Festival runs to late Feb",
    7: "Cool 'ice city' summer escape",
    12: "Ice & Snow World opens late December",
  },
  shanghai: {
    4: "Peak garden season in nearby water towns",
    11: "Plane-tree foliage in the former French Concession",
  },
  hangzhou: {
    3: "Longjing tea harvest — pickers on the hills",
    4: "Tea season and misty West Lake mornings",
    9: "Osmanthus bloom perfumes the city",
    10: "Osmanthus + the Qiantang tidal bore",
  },
  suzhou: {
    4: "Classical gardens at their freshest",
    10: "Osmanthus scents the gardens",
  },
  xiamen: {
    4: "Warm and clear before the rains",
    10: "Best beach-walking weather",
    11: "Warm, dry island days",
  },
  sanya: {
    1: "High season — warm and dry",
    2: "Warm, but CNY crowds spike prices",
    11: "Dry season starts",
    12: "Peak dry-season beach weather",
  },
  guangzhou: {
    6: "Lychee season",
    10: "Canton Fair periods book out hotels",
    12: "Dim-sum weather — mild and dry",
  },
  shenzhen: {
    11: "Cool and clear — hiking season",
    12: "Mild theme-park weather",
  },
  chengdu: {
    3: "Rapeseed and plum-blossom day-trips",
    4: "Peak season for pandas and teahouses",
    9: "Mild panda-watching weather",
  },
  chongqing: {
    4: "River mist lifts — best skyline views",
    7: "Famous 'furnace' heat — plan for indoors",
    11: "Hotpot weather; autumn colours upriver",
  },
  guilin: {
    4: "Rivers full, karst at its greenest",
    5: "Longji terraces flooded for planting — mirror season",
    6: "Terraces lush green",
    10: "Clear skies over the karst",
  },
  zhangjiajie: {
    4: "Waterfalls at full flow",
    10: "Autumn colours between the pillars",
    12: "Occasional snow dusts the pillars — few crowds",
  },
  yunnan: {
    2: "Camellias and plum blossom in Kunming",
    3: "Dali's flower season begins",
    6: "Alpine wildflowers above Lijiang",
    12: "Black-necked cranes winter at Napahai",
  },
};

export function highlightFor(destId: string, month: number): string | undefined {
  return CURATED_HIGHLIGHTS[destId]?.[month];
}
