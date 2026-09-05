import type { CityShardRow } from "@/lib/cityShard";
import type { ClimateShard } from "@/lib/climateShard";
import type { DerivedClimate, DerivedClimateIndex } from "./mapTypes";

/**
 * The join between the two artifacts a derived verdict needs.
 *
 * `public/climate/<CC>.json` carries the 60-int row and `public/cities/
 * <CC>.json` carries the elevation, keyed by the same `G`-prefixed GeoNames
 * id — `lib/climateShard.ts`'s docblock: "Elevation is NOT in the row. A
 * consumer that needs it joins `elev` from that same city's row." This is
 * that consumer, and the only one: `MapExplorer` and `RouteMap` both build
 * their index here, so the two maps cannot disagree about what a row is.
 *
 * Here and not in lib/, because the value it returns is
 * `mapTypes.DerivedClimateIndex` and lib/ never imports components/.
 *
 * Pure. It reads the parsed shapes and never a raw file, so the `-9999`
 * elevation sentinel cannot reach it — `parseCityShard` nulls it at the
 * boundary — and `usableElevation` in the model nulls it again on the way
 * out. A city absent from `cities` gets `elev: null`, which the model reads
 * as "no lapse-rate correction": the honest answer, and the one the 301
 * committed `elev: null` rows already get.
 */

/**
 * The empty index, as one shared value.
 *
 * A default prop written `climate = new Map()` allocates on every render and
 * defeats any `useMemo` keyed on it — the same reason `CountryLevel` holds
 * `NO_AIRPORTS` as a module constant rather than `airports = []`.
 */
export const NO_CLIMATE: DerivedClimateIndex = new Map();

export function buildClimateIndex(
  shard: ClimateShard | null,
  cities: readonly Pick<CityShardRow, "id" | "elev">[]
): DerivedClimateIndex {
  if (shard === null || shard.cities.size === 0) return NO_CLIMATE;
  const elevations = new Map<string, number | null>();
  for (const city of cities) elevations.set(city.id, city.elev);
  const index = new Map<string, DerivedClimate>();
  for (const [id, row] of shard.cities) {
    index.set(id, { row, elev: elevations.get(id) ?? null });
  }
  return index;
}
