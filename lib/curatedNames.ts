import { getCountry } from "./countries";
import { DESTINATIONS } from "./data";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Place names a curated destination already covers, keyed by country.
 *
 * One list, written for three readers. `lib/server/catalog.ts` filters the
 * Wikidata catalog with it today; `PlaceSearch` (the GeoNames shard) and
 * `MapExplorer` (the map's markers) are the two that still have to be switched
 * over, and both run in the browser. That is why the list lives in a
 * client-safe leaf rather than inside lib/server/catalog.ts: a server-only home
 * would force the browser halves to keep a second copy, and a second copy of
 * the list is how the three answers drift apart.
 *
 * Keyed by country now that the catalog is worldwide. "Dali" is a Chinese city
 * the curated set covers and could plausibly name a place somewhere else; a
 * global name blocklist would hide that other place with no way to notice.
 */
const ACTIVITY_COVERED: Readonly<Record<string, readonly string[]>> = {
  // Covered by a curated destination's activities rather than by a card of
  // their own — Guilin's entry plans Yangshuo, Yunnan's plans Kunming, Dali
  // and Lijiang.
  //
  // Forward defence, not a description of today's shard. Measured against the
  // committed public/cities/CN.json (413 rows): of the 21 folded names this
  // module puts in the CN set, exactly three match a shard row — "qingdao",
  // "chongqing" and "dali" — and of the six below only "Dali" does. Guilin,
  // Yangshuo, Kunming, Lijiang and Zhangjiajie are all absent, because the
  // shard is China's top 750 of GeoNames cities500 by notability minus the
  // catalog duplicates, and they did not make that cut.
  //
  // The list stays whole anyway: refresh-cities.yml rebuilds every shard from
  // a fresh GeoNames dump nightly, and a name that misses the cut today can
  // make it tomorrow. The failure it prevents — a bare "Yangshuo" chip offered
  // beside the curated "Guilin & Yangshuo" card — costs one array entry to
  // hold open and needs a re-ingest to notice if it is dropped.
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

/**
 * Normalised through `getCountry`, so " cn " and "CN" agree and anything that
 * is not a country code answers the empty set.
 *
 * `getCountry` rather than a local trim/uppercase/regex, for the reason
 * `lib/server/catalog.ts` gives at its own call: `lib/countries.ts` owns what
 * an acceptable code is, and `lib/cityShard.ts` already asks it. Two copies of
 * that rule is how the server and browser halves of one country scoping drift.
 */
export function curatedPlaceNames(country: string): ReadonlySet<string> {
  const code = getCountry(country).code;
  if (code === "") return NONE;
  return BY_COUNTRY.get(code) ?? NONE;
}
