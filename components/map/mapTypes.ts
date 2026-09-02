import { monthFitForSeasons, REGION_MONTHS, type MonthFit } from "@/lib/months";
import type { ChinaRegion, Season } from "@/lib/types";

/** Unified marker model: curated destinations + catalog cities. */
export interface MapPlace {
  id: string;
  kind: "curated" | "catalog";
  name: string;
  /** Name in the local language; renamed from `chineseName` for all-countries. */
  localName: string | null;
  province: string | null;
  /**
   * ISO 3166-1 alpha-2, and the only thing that makes `region` readable.
   *
   * `region` is overloaded — one of China's seven for CN, the raw admin-1 name
   * for the other 245 — and those two name spaces overlap: 122 committed
   * catalog rows outside China carry an admin-1 name that is literally one of
   * China's seven (Botswana's Central District, Cameroon, Iceland, Ghana,
   * Fiji). Without this field `isChinaRegion(place.region)` says yes to all of
   * them, and they render Chongqing's climate. See `isChinaPlace`.
   */
  country: string;
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

/**
 * Whether a region label is one of China's own seven. The narrowing any
 * caller needs before reading China-only data (REGION_MONTHS and anything
 * keyed off it, like `regionMonthClimate`) for a place that might not be
 * Chinese. PlacePopup uses this directly; `regionFit` below uses it too.
 *
 * Keyed off `REGION_MONTHS` rather than `REGION_ORDER`: `REGION_MONTHS` is a
 * `Record<ChinaRegion, …>`, so the compiler keeps it exhaustive over every
 * region. `REGION_ORDER` is only a `ChinaRegion[]`, which the compiler never
 * forces to be complete — an eighth region added to `ChinaRegion` and
 * `REGION_MONTHS` but not to `REGION_ORDER` would still typecheck and would
 * silently read as "no data" everywhere. Same fix `lib/countryProfile.ts`'s
 * `chinaClimate` already uses: ownership is checked rather than truthiness so
 * a plain index can't resolve an inherited key ("constructor", "toString")
 * to something that isn't a climate row.
 */
export function isChinaRegion(region: string): region is ChinaRegion {
  return Object.prototype.hasOwnProperty.call(REGION_MONTHS, region);
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

/**
 * The one country whose region labels index `REGION_MONTHS`.
 *
 * Deliberately not `CountryMap.CURATED_COUNTRY`, which is also "CN": that one
 * says which country ships a curated topology asset, this one says whose month
 * table `lib/months.ts` holds. They coincide today and are free to diverge — a
 * second curated map would not arrive with a second climate table. Importing
 * it from `CountryMap` would also make these two modules circular.
 */
export const CLIMATE_COUNTRY = "CN";

/**
 * Whether this place's `region` may be read as one of China's seven.
 *
 * `isChinaRegion` alone cannot answer this. It asks "is this string one of
 * China's seven region names?", which is true of Botswana's Central District,
 * Cameroon's South, and Iceland's Northeast — 122 committed rows in all. The
 * question every China-only read actually needs answered is "is this place in
 * China?", and only the country can answer it.
 */
export function isChinaPlace(place: MapPlace): boolean {
  return place.country === CLIMATE_COUNTRY && isChinaRegion(place.region);
}

export function fitForPlace(place: MapPlace, month: number): MonthFit {
  if (place.bestSeasons) {
    return monthFitForSeasons(
      { bestSeasons: place.bestSeasons, avoidSeasons: place.avoidSeasons },
      month
    );
  }
  return isChinaPlace(place) ? regionFit(place.region, month) : NEUTRAL_FIT;
}

export function fitForRegion(region: string, month: number): MonthFit {
  return regionFit(region, month);
}

/**
 * Categorical, so these stay literals rather than following the ramp: a legend
 * whose swatches inverted with the theme would stop meaning anything.
 *
 * Checked against the dark paper when the dark ramp was enabled (Task 37).
 * As solid swatches every one clears 3:1 there — the lowest is `avoid` at 3.71
 * and `great` at 3.74 — so none needed lifting. Lifting them would in fact cost
 * light, where those two sit at 5.06 and 5.02 against white.
 *
 * `unknown` was added by Task 35 (this PR) alongside the `NEUTRAL_FIT` split
 * from `poor`, and shipped at 1.61:1 on white — a new light-mode failure, not
 * an inherited one. Darkened to `#8a939f` (3.11 on white, matching `poor`'s
 * weight; 6.05 on dark paper) to actually clear the legend's contrast bar.
 */
export const FIT_COLORS: Record<MonthFit, string> = {
  great: "#2f7d54",
  ok: "#b98a2f",
  poor: "#8f9bab",
  avoid: "#c93b2e",
  unknown: "#8a939f",
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

/**
 * Where a surface says a place is: `"<origin> · <level>"`.
 *
 * Lifted out of `PlacePopup` unchanged when §5.3.3's card became a second
 * surface making the same claim. The rules below are subtle enough that two
 * copies would have drifted on the first one either of them changed, and the
 * cases they cover are real rather than defensive:
 *
 * "<region> China" is a claim about China, and `place.region` is only one of
 * China's seven when the place is Chinese — `MapExplorer` puts the admin-1 name
 * there for every other country, and 439 of the 58,742 committed shard rows
 * carry no admin-1 at all. Unguarded, a Peruvian city with a null province
 * rendered a bare " China". The fallback stays for the case it was written for:
 * every curated Chinese destination has `province: null` and one of the seven
 * regions.
 *
 * Joined rather than concatenated so the "· <level>" suffix cannot be left
 * hanging off an origin that resolved to nothing.
 */
export function originLineFor(place: MapPlace): string {
  const origin =
    place.province ?? (isChinaPlace(place) ? `${place.region} China` : place.region);
  return [origin, place.level === "curated" ? "" : place.level]
    .filter((part) => part !== "")
    .join(" · ");
}

export function formatPopulation(population: number | null): string | null {
  if (!population) return null;
  if (population >= 1_000_000) return `${(population / 1_000_000).toFixed(1)}M people`;
  if (population >= 1_000) return `${Math.round(population / 1_000)}k people`;
  return `${population} people`;
}
