import { DESTINATIONS } from "./data";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Place names a curated destination already covers, keyed by country.
 *
 * One list with three readers — `lib/server/catalog.ts` filters the Wikidata
 * catalog, `PlaceSearch` filters the GeoNames shard, and `MapExplorer` filters
 * the map's markers. It lives in a client-safe leaf rather than in
 * lib/server/catalog.ts precisely so all three can reach it: two of them run in
 * the browser, and a second copy of the list is how they drift apart.
 *
 * Keyed by country now that the catalog is worldwide. "Dali" is a Chinese city
 * the curated set covers and could plausibly name a place somewhere else; a
 * global name blocklist would hide that other place with no way to notice.
 */
const ACTIVITY_COVERED: Readonly<Record<string, readonly string[]>> = {
  // Covered by a curated destination's activities rather than by a card of
  // their own — Guilin's entry plans Yangshuo, Yunnan's plans Dali and
  // Lijiang. Yangshuo in particular has no data/catalog.json row, so it
  // survives the ingest's dedup and reaches the CN shard; without this list
  // the picker offers a bare "Yangshuo" chip beside "Guilin & Yangshuo".
  CN: ["Guilin", "Yangshuo", "Kunming", "Dali", "Lijiang", "Zhangjiajie"],
};

const BY_COUNTRY: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const byCountry = new Map<string, Set<string>>();
  const add = (country: string, name: string) => {
    const set = byCountry.get(country) ?? new Set<string>();
    set.add(foldPlaceName(name));
    byCountry.set(country, set);
  };
  for (const destination of DESTINATIONS) add(destination.country, destination.name);
  for (const [country, names] of Object.entries(ACTIVITY_COVERED)) {
    for (const name of names) add(country, name);
  }
  return byCountry;
})();

const NONE: ReadonlySet<string> = new Set();

/** Normalised the way `getCountry` normalises, so " cn " and "CN" agree. */
export function curatedPlaceNames(country: string): ReadonlySet<string> {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code)) return NONE;
  return BY_COUNTRY.get(code) ?? NONE;
}
