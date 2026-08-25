/**
 * The one discriminator between the GeoNames and Wikidata id namespaces.
 *
 * Its own leaf module rather than a member of lib/server/cityIndex.ts: that
 * file static-imports the 3.5 MB data/cities-index.json, so importing the
 * predicate from it drags the whole artifact into every bundle that wants
 * nothing but a regex. `app/api/cities/enrich/route.ts` (Task 15) is exactly
 * that case — it validates ids and never resolves a city.
 *
 * `resolveDestinations` branches on this, and spec §3.3 calls merging the two
 * namespaces a real bug, so it is anchored at both ends and rejects a bare
 * integer — which is what a GeoNames id looks like before the prefix.
 */
const GEONAMES_ID = /^G[1-9][0-9]*$/;

export function isGeoNamesId(id: string): boolean {
  return typeof id === "string" && GEONAMES_ID.test(id);
}
