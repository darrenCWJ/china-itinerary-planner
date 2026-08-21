import { monthFitForSeasons, REGION_MONTHS, type MonthFit } from "@/lib/months";
import { REGION_ORDER } from "@/lib/provinces";
import type { ChinaRegion, Season } from "@/lib/types";

/** Unified marker model: curated destinations + catalog cities. */
export interface MapPlace {
  id: string;
  kind: "curated" | "catalog";
  name: string;
  /** Name in the local language; renamed from `chineseName` for all-countries. */
  localName: string | null;
  province: string | null;
  /** A region label meaningful inside this place's own country — see Destination.region. */
  region: string;
  lat: number;
  lon: number;
  population: number | null;
  level: "curated" | "municipality" | "prefecture" | "county";
  attractionCount: number;
  blurb: string | null;
  emoji?: string;
  bestSeasons?: Season[];
  avoidSeasons?: Season[];
  seasonNotes?: Partial<Record<Season, string>>;
}

/** What a place outside China's month table gets: no claim either way. */
export const NEUTRAL_FIT: MonthFit = "unknown";

const CHINA_REGIONS = new Set<string>(REGION_ORDER);

/**
 * Whether a region label is one of China's own seven. The narrowing any
 * caller needs before reading China-only data (REGION_MONTHS and anything
 * keyed off it, like `regionMonthClimate`) for a place that might not be
 * Chinese. PlacePopup uses this directly; `regionFit` below uses it too.
 */
export function isChinaRegion(region: string): region is ChinaRegion {
  return CHINA_REGIONS.has(region);
}

/**
 * Shared by `fitForPlace` and `fitForRegion` — both index `REGION_MONTHS` by
 * region, and both can now be handed a region label from outside China's
 * seven (a catalog place from any country).
 */
function regionFit(region: string, month: number): MonthFit {
  if (!isChinaRegion(region)) return NEUTRAL_FIT;
  return REGION_MONTHS[region][month - 1].fit;
}

export function fitForPlace(place: MapPlace, month: number): MonthFit {
  if (place.bestSeasons) {
    return monthFitForSeasons(
      { bestSeasons: place.bestSeasons, avoidSeasons: place.avoidSeasons },
      month
    );
  }
  return regionFit(place.region, month);
}

export function fitForRegion(region: string, month: number): MonthFit {
  return regionFit(region, month);
}

export const FIT_COLORS: Record<MonthFit, string> = {
  great: "#2f7d54",
  ok: "#b98a2f",
  poor: "#8f9bab",
  avoid: "#c93b2e",
  unknown: "#c7ccd4",
};

export const FIT_LABELS: Record<MonthFit, string> = {
  great: "Great time",
  ok: "Decent time",
  poor: "Off-season",
  avoid: "Avoid",
  unknown: "No data",
};

/** Province tint strength for the selected month's regional fit. */
export const FIT_FILL_OPACITY: Record<MonthFit, number> = {
  great: 0.5,
  ok: 0.3,
  poor: 0.14,
  avoid: 0.08,
  unknown: 0.1,
};

export function formatPopulation(population: number | null): string | null {
  if (!population) return null;
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}M people`;
  if (population >= 1_000) return `${Math.round(population / 1_000)}k people`;
  return `${population} people`;
}
