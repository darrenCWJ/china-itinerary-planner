import type { MapPlace } from "@/components/map/mapTypes";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Grouping and filtering for the country place list.
 *
 * Pure, and in `lib/` rather than beside the component, for two reasons: the
 * node project runs it without a DOM, and a `.test.ts` under `components/`
 * matches no vitest project and would never run at all.
 */

/**
 * The group holding places whose country records no admin-1 for them.
 *
 * A leading space so it cannot collide with a real province name — this key
 * is compared against `place.province`, which is a value from a data file.
 */
export const UNGROUPED_KEY = " ungrouped";

export interface PlaceGroup {
  key: string;
  /** The province name, or null for the ungrouped remainder. */
  label: string | null;
  places: MapPlace[];
}

/**
 * Places by admin-1, in first-appearance order.
 *
 * `places` arrives in population order from the shard, so first appearance
 * puts the province a user is most likely to want at the top and keeps the
 * recognisable city first inside it. Alphabetical would open Peru on
 * Amazonas.
 */
export function groupPlacesByAdmin1(places: MapPlace[]): PlaceGroup[] {
  // A Map, not an object: the key is a province name from a data file, and
  // `"constructor"` on a plain object resolves to a function.
  const byKey = new Map<string, PlaceGroup>();
  for (const place of places) {
    const label = place.province && place.province !== "" ? place.province : null;
    const key = label ?? UNGROUPED_KEY;
    const group = byKey.get(key);
    if (group) group.places.push(place);
    else byKey.set(key, { key, label, places: [place] });
  }
  const groups = [...byKey.values()];
  // The remainder goes last. In the 19 countries with no admin-1 at all it is
  // the only group, so this is a no-op there rather than a special case.
  const ungrouped = groups.findIndex((g) => g.key === UNGROUPED_KEY);
  if (ungrouped >= 0 && ungrouped < groups.length - 1) {
    groups.push(...groups.splice(ungrouped, 1));
  }
  return groups;
}

/**
 * Places whose name or province matches `query`.
 *
 * `foldPlaceName` strips accents, case and apostrophes on both sides, because
 * the shard carries endonyms — a user typing "Zurich" must reach "Zürich",
 * and the same function is what both search legs already use.
 */
export function filterPlaces(places: MapPlace[], query: string): MapPlace[] {
  const needle = foldPlaceName(query);
  if (needle === "") return places;
  return places.filter((place) => {
    if (foldPlaceName(place.name).includes(needle)) return true;
    return place.province ? foldPlaceName(place.province).includes(needle) : false;
  });
}
