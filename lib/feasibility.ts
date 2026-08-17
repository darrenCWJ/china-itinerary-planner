/**
 * The arithmetic behind the live feasibility counter (spec §3.2.3), which reads
 * `5 cities · 12 nights needed · 7 days set — 5 over` and is visible the whole
 * time the user is picking places, so the conflict surfaces at the moment of
 * choice rather than three screens later.
 *
 * Pure and free of React so the counter is a presenter over this, and so the
 * one part worth arguing about — how many nights a place actually needs — is
 * testable without rendering anything.
 */

/**
 * What a hand-typed, coordinate-less place contributes (spec §5.6). Nobody
 * researched it, but it still consumes nights: counting it as free is the one
 * answer that makes the counter lie.
 */
export const OFF_MAP_NIGHTS: readonly [number, number] = [1, 2];

/**
 * The floor applied to a catalog city's minimum.
 *
 * `lib/server/catalog.ts` builds every catalog city with `suggestedDays:
 * [1, maxDays]`. That 1 is the same for Kyoto and for a village of 400 people —
 * it is a placeholder, not research. Curated destinations carry researched
 * minimums, and all but one of them are 2 or more. Taking the catalog's 1
 * literally makes the counter most optimistic about exactly the cities the user
 * knows least about, which is backwards.
 */
export const CATALOG_MIN_NIGHTS = 2;

export interface FeasibilityPlace {
  id: string;
  /** [minNights, maxNights]. Absent is treated as off-map — see `nightsFor`. */
  suggestedDays?: readonly [number, number];
  /** No coordinates: hand-typed by the user, not from any dataset. */
  offMap?: boolean;
  /** From the all-country catalog, whose minimum is synthetic. */
  fromCatalog?: boolean;
}

export type FeasibilityVerdict = "empty" | "fits" | "over";

export interface Feasibility {
  cities: number;
  nightsNeededMin: number;
  nightsNeededMax: number;
  daysSet: number;
  /**
   * `daysSet - nightsNeededMin`. Negative is the shortfall the counter renders
   * as "N over"; positive is slack. Signed rather than split into two fields so
   * the presenter formats one number and cannot disagree with the verdict.
   */
  delta: number;
  verdict: FeasibilityVerdict;
}

/** One place's night range, after the off-map default and the catalog floor. */
function nightsFor(place: FeasibilityPlace): readonly [number, number] {
  // Off-map wins over any range on the object: nothing researched these, so a
  // range here is noise — most likely a Destination-shaped default passing
  // through — and honouring it would let a hand-typed entry claim nine nights.
  if (place.offMap || !place.suggestedDays) return OFF_MAP_NIGHTS;

  const [min, max] = place.suggestedDays;
  if (!place.fromCatalog) return [min, max];

  const raised = Math.max(min, CATALOG_MIN_NIGHTS);
  // A one-activity catalog city can arrive as [1, 1]; raising the min past the
  // max would hand the counter a range that runs backwards.
  return [raised, Math.max(max, raised)];
}

export function assessFeasibility(
  places: readonly FeasibilityPlace[],
  daysSet: number
): Feasibility {
  let nightsNeededMin = 0;
  let nightsNeededMax = 0;
  for (const place of places) {
    const [min, max] = nightsFor(place);
    nightsNeededMin += min;
    nightsNeededMax += max;
  }

  const delta = daysSet - nightsNeededMin;
  // "empty" rather than "fits" for nothing selected: zero nights technically fit
  // any budget, but telling a user their empty trip fits is noise, and the
  // counter needs to render differently before the first pick.
  const verdict: FeasibilityVerdict =
    places.length === 0 ? "empty" : delta < 0 ? "over" : "fits";

  return { cities: places.length, nightsNeededMin, nightsNeededMax, daysSet, delta, verdict };
}
