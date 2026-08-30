import { describe, expect, test } from "vitest";
import { REGION_MONTHS, regionMonthClimate } from "./months";
import { REGION_META } from "./provinces";
import type { RegionId } from "./regionScheme";
import type { ChinaRegion } from "./types";

/**
 * Phase 4's central invariant: **`ChinaRegion` stays seven members, and
 * `REGION_MONTHS` and `REGION_META` stay keyed to it.**
 *
 * The spec's §6.1 proposed widening `ChinaRegion` into a general region
 * identifier. That is the one edit in this layer that fails silently.
 * `tsconfig.json` sets `"strict": true` and does NOT set
 * `noUncheckedIndexedAccess`, so once a `Record<K, …>`'s key type widens,
 * `record[k]` still types as the value type — never `value | undefined` — and
 * the compiler says nothing at all. Both records are dereferenced immediately
 * by their callers, so the first non-China key reaching them is a TypeError at
 * render rather than a benign miss:
 *
 * - `regionMonthClimate` reads `REGION_MONTHS[region][month - 1]` and declares
 *   a non-nullable return, so no caller checks.
 * - `CountryMap.tsx` reads `REGION_META[meta.region].color`, `.anchor` and
 *   `.label` straight into JSX attributes.
 *
 * `REGION_MONTHS` is also the runtime basis of `mapTypes.isChinaRegion`, which
 * decides China-ness by `hasOwnProperty` on it — so widening the key type
 * breaks the guard and the thing the guard protects in the same edit.
 *
 * Phase 4 therefore gave the third map level its OWN identifier,
 * `regionScheme.RegionId`, deliberately wide. This file pins both halves: the
 * China tables must not widen, and `RegionId` must not narrow to meet them.
 * Nothing else in the suite would notice either move — `lib/months.test.ts`
 * iterates a hand-written `ChinaRegion[]`, which an eighth member would simply
 * not appear in, and `components/map/chinaBaseline.test.tsx` compares rendered
 * bytes, which a widening does not change until the day it throws.
 */

/**
 * The seven, written out here rather than derived from either record.
 *
 * Deriving would make this file agree with whatever the tables happen to hold,
 * which is exactly the drift it exists to catch.
 */
const SEVEN = [
  "North",
  "Northeast",
  "Northwest",
  "East",
  "South",
  "Southwest",
  "Central",
] as const;

/**
 * Type equality, in both directions and invariantly.
 *
 * The doubled function signature is the standard trick: two conditional types
 * are only assignable to one another when their checked types are identical,
 * so unlike a bare `A extends B ? …` this does not quietly pass when one side
 * is a widening of the other — which is the entire failure mode below — and
 * does not pass for `any`.
 */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

/**
 * The compile-time half of the invariant. **`npx tsc --noEmit` is what reads
 * this, not Vitest** — the test runner transpiles without type checking, so a
 * widening would leave every assertion in this file green. `ci.yml` runs
 * `npx tsc --noEmit` beside `vitest run` for this class of pin.
 *
 * Widening `REGION_MONTHS` to `Record<string, …>` leaves its runtime keys
 * untouched, so the assertions below cannot see it and only this line goes
 * red: `Type 'false' is not assignable to type 'true'`.
 */
const NOT_WIDENED: [
  Exact<ChinaRegion, (typeof SEVEN)[number]>,
  Exact<keyof typeof REGION_MONTHS, ChinaRegion>,
  Exact<keyof typeof REGION_META, ChinaRegion>,
] = [true, true, true];

/**
 * And the other direction. `RegionId` is the third map level's identifier and
 * is `string` on purpose: China's group ids happen to BE the seven
 * `ChinaRegion` strings, which is a coincidence of value and must not become
 * one of type. Narrowing `RegionId` to `ChinaRegion` would let the widening
 * this file forbids arrive through the back door — every other country's
 * admin-1 unit id would then be typed as a key into the China tables.
 */
const REGION_ID_STAYS_WIDE: Exact<RegionId, string> = true;

describe("China's seven regions — Phase 4's central invariant", () => {
  test("REGION_MONTHS and REGION_META are still keyed to the seven-member union", () => {
    // The runtime half: an eighth region added to `ChinaRegion` and to both
    // tables typechecks perfectly and is caught here.
    expect(Object.keys(REGION_MONTHS).sort()).toEqual([...SEVEN].sort());
    expect(Object.keys(REGION_META).sort()).toEqual([...SEVEN].sort());
    // The compile-time half, referenced so it is part of the test rather than
    // an unused declaration. Its enforcement is tsc — see the docblock.
    expect(NOT_WIDENED).toEqual([true, true, true]);
    expect(REGION_ID_STAYS_WIDE).toBe(true);
  });

  test("the guard is load-bearing: a key outside the seven throws, it does not miss", () => {
    // Why the widening cannot be allowed, demonstrated rather than asserted.
    // `regionMonthClimate` declares a non-nullable `RegionMonthClimate`, so
    // there is no `?.` anywhere downstream to soften this: the cast below is
    // what a widened `ChinaRegion` would hand it for free, with no diagnostic.
    expect(() => regionMonthClimate("Cuzco Department" as ChinaRegion, 6)).toThrow(TypeError);
    // The same trap in the other table, read straight into a JSX attribute by
    // `CountryMap.tsx` — so the failure is a blank map, not a missing tint.
    expect(() => REGION_META["Cuzco Department" as ChinaRegion].color).toThrow(TypeError);

    // And that the seven really do all resolve, so the throw above is about
    // the key and not about the call.
    for (const region of SEVEN) {
      expect(regionMonthClimate(region, 6)).toBeDefined();
      expect(REGION_META[region].color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("every one of the seven carries a full twelve-month table", () => {
    // `isChinaRegion` narrows on `REGION_MONTHS` ownership alone, so a region
    // present as a key but short of rows would pass the guard and then throw
    // on the month index — the same TypeError one step later.
    for (const region of SEVEN) {
      expect(REGION_MONTHS[region]).toHaveLength(12);
      for (let month = 1; month <= 12; month++) {
        expect(regionMonthClimate(region, month)).toBeDefined();
      }
    }
  });
});
