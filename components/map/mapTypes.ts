import { monthFit } from "@/lib/climateModel";
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

/**
 * What a place no source can speak for gets: no claim either way. Outside
 * China's month table, and — since the fit resolution gained a derived branch
 * below it — with no derived row for it either.
 */
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

/**
 * One city's derived climate, as the caller already holds it.
 *
 * The two halves come from two different artifacts and neither is on
 * `MapPlace`, which is why this is a pair and not a bare row:
 *
 *   - `row` is `public/climate/<CC>.json`'s positional tuple — `[12 lo, 12 hi,
 *     12 precip, 12 cloud, 12 td]`, calendar-indexed, January at index 0 of
 *     every block (spec §9.4).
 *   - `elev` is `public/cities/<CC>.json`'s `CityShardRow.elev`, metres or
 *     null. The climate artifact does not carry it and `MapPlace` has no
 *     elevation field, but the model's fix 4 — the lapse-rate correction —
 *     reads it, and it is worth a whole band: Cusco's June is `great` at
 *     3,312 m and `ok` without.
 */
export interface DerivedClimate {
  row: readonly number[];
  elev: number | null;
}

/**
 * `MapPlace.id` → that city's derived climate. `undefined` means "no row",
 * which resolves to `NEUTRAL_FIT` — never a fabricated verdict.
 *
 * A `ReadonlyMap`, deliberately, on three counts:
 *
 *   1. **A `Record` is not safe here.** The keys are city ids out of a fetched
 *      artifact, and on a plain object `lookup["constructor"]` resolves to
 *      something through the prototype chain. This module already carries that
 *      hazard once — `isChinaRegion` is a `hasOwnProperty` check and not `in`
 *      for exactly this reason — and a `Map` closes it by construction rather
 *      than by remembering to guard every read.
 *   2. **Not a function.** A `(id: string) => DerivedClimate | undefined`
 *      would let a caller hand in a closure that fetches, memoises or
 *      otherwise does work at render time. The rule this seam exists to obey
 *      is that the fit resolution stays *synchronous over rows already in
 *      hand* — `lib/countryFacts.test.ts` walks value imports and fails the
 *      build if a client component reaches a data artifact, so the rows have
 *      to arrive by `fetch`, from the component, and be passed down. Inert
 *      data cannot break that rule; a callback can.
 *   3. **`Readonly`.** The join belongs to the caller, which memoises it
 *      across renders; nothing here may mutate it.
 */
export type DerivedClimateIndex = ReadonlyMap<string, DerivedClimate>;

/**
 * A region id → the verdict for the month being asked about, for regions
 * outside China's seven.
 *
 * The seam, not the aggregation. HOW a region's cities collapse into one
 * verdict — mean penalty, modal band, population weighting — is Plan 6's
 * decision; this type only says that the answer arrives already computed, so
 * `fitForRegion` stays synchronous and holds no opinion.
 *
 * Keyed by `regionScheme.RegionId`, which is `string` because the ids come out
 * of a data file. Same `ReadonlyMap` reasoning as `DerivedClimateIndex`.
 *
 * **It cannot enforce §9.5 by itself, and it does not try.** `fitForRegion`
 * receives a region id and nothing else — no country — so the China check in
 * front of this lookup is the string test, which the seven admin-1 names in
 * `MapPlace.region`'s docblock are known to pass from five other countries.
 * That is safe here only because the entries are the caller's own: a caller
 * that is rendering Botswana can only ever have put Botswana's regions in it.
 * The corollary is a rule for the caller — **do not build one of these for
 * China** — and it is why the *place* branch is gated on the country instead
 * (see `fitForPlace`), where the country is actually available.
 */
export type DerivedRegionFits = ReadonlyMap<string, MonthFit>;

/**
 * Spec §9.5's resolution order: curated `bestSeasons` → curated
 * `REGION_MONTHS` → derived worldwide → `unknown`.
 *
 * **Why the derived branch is here and not in `regionFit`.** §9.4 places it in
 * `regionFit` and §9.5's last paragraph explicitly forbids placing it in
 * `fitForPlace`; the two cannot both be honoured, because `regionFit` receives
 * a region label and a month and the derived artifact is keyed **per city**.
 * `fitForPlace` is the only one of the pair that holds a `MapPlace`, so it is
 * the only one that knows which city — and the only one that can be given a
 * row to read. §9.5's *reason* survives the move intact: what it is protecting
 * is that curated China wins, and putting the branch below the China step
 * gives that by construction rather than by ordering luck.
 *
 * **Why the China step is gated on `place.country` and not `isChinaPlace`.**
 * `isChinaPlace` also requires the region to be one of China's seven, and
 * measured over `public/cities/CN.json` **not one of its 412 rows satisfies
 * that** — their admin-1 names are "Sichuan", "Guangdong", "Beijing". Gating
 * on it would drop every Chinese catalog city through to the derived branch
 * the day a CN climate shard ships, which is exactly the regression §9.5's
 * success test ("China's rendered output is byte-identical") exists to catch.
 * On the country, a China place never reaches the derived branch at all and a
 * derived row for a Chinese city is simply ignored. A Chinese place outside
 * the seven keeps the `NEUTRAL_FIT` it has today.
 *
 * A month outside 1–12 throws, on the derived branch as on the curated one:
 * `REGION_MONTHS[region][12]` is `undefined` and `.fit` on it is a TypeError,
 * so that has always been this function's contract, and the derived branch
 * inherits it rather than adding a second rule. `monthFit` likewise throws on
 * a malformed row — parsing the artifact is the loader's job (Plan 5 Task 8),
 * and swallowing it here would hide a real bug behind a grey pin.
 */
export function fitForPlace(
  place: MapPlace,
  month: number,
  climate?: DerivedClimateIndex
): MonthFit {
  if (place.bestSeasons) {
    return monthFitForSeasons(
      { bestSeasons: place.bestSeasons, avoidSeasons: place.avoidSeasons },
      month
    );
  }
  if (place.country === CLIMATE_COUNTRY) return regionFit(place.region, month);
  const derived = climate?.get(place.id);
  // `month` is 1-based here and the model is calendar-indexed from 0 (§9.4).
  return derived === undefined ? NEUTRAL_FIT : monthFit(derived.row, derived.elev, month - 1);
}

/**
 * The same order one level up, for a region tint rather than a pin.
 *
 * China's seven are answered by `regionFit` exactly as before. Everything else
 * gets the caller's aggregate if it has one and `NEUTRAL_FIT` if it does not —
 * the lookup adds a source of verdicts, never a default. `isChinaRegion` is
 * asked directly rather than inferred from `regionFit` returning `NEUTRAL_FIT`,
 * so that a curated cell that ever *did* read `unknown` could not fall through
 * to a derived one.
 */
export function fitForRegion(
  region: string,
  month: number,
  derived?: DerivedRegionFits
): MonthFit {
  if (isChinaRegion(region)) return regionFit(region, month);
  return derived?.get(region) ?? NEUTRAL_FIT;
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
