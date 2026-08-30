import { REGION_META, provinceByAdcode } from "./provinces";
import type { ProvinceUnit } from "./provinceTopology";
import type { ChinaRegion } from "./types";

/**
 * The third map level's identifier, and the per-country scheme that produces it.
 *
 * The app has had a region level since long before it had 246 countries, but
 * that level is China's and only China's: `zoomRegion` is a `ChinaRegion`, its
 * seven values are hard-coded, and every affordance for it is gated on the
 * country being CN. This module is what the rest of the world zooms through.
 *
 * ## Why `RegionId` is `string` and not `ChinaRegion`
 *
 * `tsconfig.json` sets `"strict": true` and does NOT set
 * `noUncheckedIndexedAccess`. Once a `Record<K, …>`'s key type widens,
 * `record[k]` still types as the value type — never `value | undefined` — and
 * the compiler says nothing. Two records are load-bearing and both dereference
 * immediately:
 *
 * - `lib/months.ts` `REGION_MONTHS: Record<ChinaRegion, RegionMonthClimate[]>`,
 *   read as `REGION_MONTHS[region][month - 1]`. A non-China key yields
 *   `undefined[month-1]` — a TypeError at render, not a benign miss — and the
 *   declared return type is non-nullable, so no caller checks.
 * - `lib/provinces.ts` `REGION_META`, read for `.color`, `.anchor` and `.label`
 *   in `CountryMap.tsx`. Same failure.
 *
 * `REGION_MONTHS` is also the runtime basis of `isChinaRegion`
 * (`mapTypes.ts` tests `hasOwnProperty` on it), so widening the key type would
 * break the guard and the thing the guard protects in one edit.
 *
 * So `ChinaRegion` stays seven members, `REGION_MONTHS` and `REGION_META` stay
 * keyed to it, and the level this module describes gets its own, deliberately
 * wide identifier. China's group ids happen to BE the seven `ChinaRegion`
 * strings — that is convenient for the chrome and it is a coincidence of value,
 * not of type. Narrowing `RegionId` to `ChinaRegion` would let the widening
 * this file exists to avoid arrive through the back door.
 *
 * `Destination.region` in `lib/types.ts` is plain `string` for exactly this
 * reason, so this is the shape the codebase already reaches for.
 */
export type RegionId = string;

/**
 * One zoomable group of admin-1 units.
 *
 * `unitIds` is a list rather than a single id because China's groups are a
 * level ABOVE admin-1 (§6.4): "East" is five provinces, not one. For the other
 * 245 countries the list is one id long and the group IS the unit.
 */
export interface RegionGroup {
  id: RegionId;
  /** Already resolved for display — see `unitLabel` for the precedence. */
  label: string;
  /** Ids as `ProvinceFile.units` and `cityProvince` spell them. Selectable only. */
  unitIds: string[];
}

export interface RegionScheme {
  /**
   * Which scheme produced the groups. `"curated"` means the groups are an
   * editorial layer above admin-1 and a group holds several units; `"admin1"`
   * means one group per unit. Chrome that wants to say "province" for Peru and
   * "region" for China reads this rather than testing the country code again.
   */
  kind: "admin1" | "curated";
  /**
   * Empty when the country has at most one selectable unit — §6.6 D10. Not a
   * degenerate case to paper over: the Faroes' single unit is named
   * "Eysturoyar", one island of eighteen, so an L3 control there would be
   * actively wrong rather than merely redundant.
   */
  groups: RegionGroup[];
}

/**
 * How a unit is named on screen.
 *
 * The base precedence is `nameEn ?? name ?? id`, which is what
 * `CountryLevel.tsx` already applies to its `<title>`. The two ends of it both
 * matter:
 *
 * - Six selectable units carry neither name — `AI/AIA+99?`, `CO/COL+99?`,
 *   `KI/KIR+99?`, `MX/MEX+99?`, `RU/RUS+99?`, `VE/VEN+99?` — and all six have
 *   zero assigned cities, so they are unreachable by a city and reachable by a
 *   click. The raw id is ugly; a blank label is worse.
 * - Every CN unit has `nameEn === null`, because the curated asset (§6.3, D7)
 *   is a re-envelope of DataV boundary data that carries one Chinese name and
 *   no second name field. The precedence alone would therefore label China's
 *   provinces 北京市 inside an otherwise English UI. `lib/provinces.ts` has the
 *   English name and the join key is the unit id, which for the curated asset
 *   is the adcode — so the curated table stands in for the missing `nameEn`,
 *   and sits at that position in the precedence rather than ahead of a real one.
 */
export function unitLabel(country: string, unit: ProvinceUnit): string {
  return unit.nameEn ?? curatedNameEn(normalise(country), unit.id) ?? unit.name ?? unit.id;
}

/**
 * The zoomable groups for one country's units.
 *
 * `units` is `ProvinceFile.units` whole, non-selectable entries included: the
 * filtering happens here so no caller has to remember it. A unit is dropped
 * when `selectable` is false, because ISO 3166-1 governs territorial EXTENT
 * while ISO 3166-2 governs SUBDIVISION identity (§7.2) — Northern Cyprus,
 * Akrotiri and Dhekelia inside CY, Somaliland inside SO, Guantánamo inside CU,
 * and Taiwan, Hong Kong, Macau and the nine-dash envelope inside CN shape an
 * outline without being a subdivision anyone can travel to.
 *
 * That drop is not free and is deliberate: 43 committed `cityProvince` values
 * name a unit this function omits, so those cities are placed in a unit the
 * user can never zoom to. The map filters; `CountryPlaceList` does not, so
 * §5.2's invariant — the list reaches every city in the country — survives it.
 *
 * Pure, cheap and allocation-light so a caller can hold it in a `useMemo` keyed
 * on the province file.
 */
export function regionSchemeFor(country: string, units: ProvinceUnit[]): RegionScheme {
  const code = normalise(country);
  const curated = CURATED.get(code) ?? null;
  const kind: RegionScheme["kind"] = curated ? "curated" : "admin1";

  const selectable = units.filter((unit) => unit.selectable);
  // §6.6 D10, gated on the count and never on a list of country codes: at one
  // selectable unit the L3 view is pixel-for-pixel the L2 view, so the control
  // would promise a zoom it cannot deliver. `<= 1` rather than `=== 1` because
  // a country with none is the same non-choice.
  if (selectable.length <= 1) return { kind, groups: [] };

  return {
    kind,
    groups: curated
      ? // Curated groups keep the order their scheme gives them, which for
        // China is `REGION_ORDER` — see `chinaGroups`. That order means
        // something; the one below did not.
        curated(selectable)
      : selectable
          .map((unit) => ({
            id: unit.id,
            label: unitLabel(code, unit),
            unitIds: [unit.id],
          }))
          // Sorted, because `ProvinceFile.units` is `adm1_code` ascending —
          // Natural Earth's internal numbering, which is not on the screen and
          // never has been. This list is the ONLY way into the province level
          // for the 212 countries that offer one, and 194 of the 211 outside
          // China ship a file order that is not the order a reader looks in:
          // Peru's begins Callao, Lambayeque, Piura, Tumbes.
          //
          // `localeCompare` and not `<`, because the names are not ASCII:
          // Peru's Áncash belongs between Amazonas and Apurímac, and a
          // code-unit comparison puts it after Ucayali with every other
          // accented province. The country picker in `WorldMap` sorts its 235
          // entries the same way, so the two lists read as one system.
          //
          // `sort` is stable (ES2019), so the pairs that tie — Natural Earth
          // names two Peruvian units "Lima" — hold file order rather than
          // swapping between renders. The array is this function's own, so the
          // caller's `units` is not touched.
          .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/**
 * Countries whose groups are an editorial layer above admin-1.
 *
 * A `Map` and not a `Record`, for the reason `ProvinceFile.cityProvince` is a
 * Map: on a plain object `CURATED["constructor"]` resolves to a function, so a
 * lookup that should miss reads as a hit. The key comes from a data file, and
 * `normalise` uppercasing it is a second line of defence rather than the only
 * one.
 */
const CURATED: ReadonlyMap<string, (units: ProvinceUnit[]) => RegionGroup[]> = new Map([
  ["CN", chinaGroups],
]);

/**
 * China's seven regions, as a grouping above its 31 selectable provinces.
 *
 * Declared as a typed array rather than read off `REGION_META` with
 * `Object.keys(…) as ChinaRegion[]`: that assertion is unchecked, so it would
 * keep compiling and keep yielding whatever the object happens to hold. Here
 * every member is checked against `ChinaRegion`, and the test asserting the
 * seven groups against `REGION_META`'s keys catches an omission.
 *
 * The order is `REGION_META`'s declaration order, which is the order
 * `CountryMap.tsx` already paints the region labels in — a region control that
 * listed them differently from the map would read as a different set.
 */
const REGION_ORDER: readonly ChinaRegion[] = [
  "North",
  "Northeast",
  "East",
  "South",
  "Southwest",
  "Northwest",
  "Central",
];

function chinaGroups(units: ProvinceUnit[]): RegionGroup[] {
  const byRegion = new Map<ChinaRegion, string[]>();
  for (const unit of units) {
    const meta = curatedMeta(unit.id);
    // A selectable unit the curated table has never heard of belongs to no
    // region and is silently unreachable. Inventing a group for it would put a
    // raw adcode beside the seven names; the test that every selectable unit
    // lands in exactly one group is what makes the drift visible instead.
    if (!meta) continue;
    const existing = byRegion.get(meta.region);
    if (existing) existing.push(unit.id);
    else byRegion.set(meta.region, [unit.id]);
  }

  const groups: RegionGroup[] = [];
  for (const region of REGION_ORDER) {
    const unitIds = byRegion.get(region);
    if (!unitIds || unitIds.length === 0) continue;
    // `REGION_META[region]` is safe here and stays safe: `region` is a
    // `ChinaRegion`, which is the record's key type and is not widening.
    groups.push({ id: region, label: REGION_META[region].label, unitIds });
  }
  return groups;
}

/**
 * The curated row for a CN unit id.
 *
 * Digits only, so `100000_JD` — the nine-dash envelope, whose adcode is a
 * string — cannot be coerced into `100000` by `Number`'s prefix parsing and
 * join to something. It is `sel:0` today, and this is the kind of assumption
 * that stops being true quietly.
 */
function curatedMeta(id: string) {
  return /^\d+$/.test(id) ? provinceByAdcode(Number(id)) : undefined;
}

function curatedNameEn(code: string, id: string): string | null {
  // Gated on the country, not merely on the id shape: `PROVINCES` is China's
  // table and `adm1_code` ids elsewhere are never all-digits today, which is
  // exactly the sort of coincidence a new Natural Earth release could end.
  if (code !== "CN") return null;
  return curatedMeta(id)?.nameEn ?? null;
}

function normalise(country: string): string {
  return typeof country === "string" ? country.trim().toUpperCase() : "";
}
