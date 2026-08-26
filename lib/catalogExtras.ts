import { isGeoNamesId } from "./geoNamesId";
import type { CatalogHit } from "./tripShared";

/**
 * How `app/plan/page.tsx` folds a newly picked catalog city into the `extras`
 * it already holds for that id.
 *
 * Two surfaces write the same id. `MapExplorer.togglePlace` builds its hit from
 * a shard row or a catalog row and carries the real population, blurb and
 * attraction count; `DestinationStep.addPlace` builds one from a ranked search
 * row, which never held any of those, and sends `population: null`,
 * `description: null`, `attractionCount: 0`. `extras` was written with a plain
 * `{ ...prev, [qid]: hit }`, so whichever surface touched the city last won
 * outright — re-picking through search after tapping the map replaced a hit
 * that knew Cusco's population with one that did not, and nothing ever put it
 * back. Task 15's lazy fetch refills `description` on that path; the other
 * fields have no such repair, which is why the fix belongs here rather than in
 * one more producer.
 *
 * So: a later write may add and may correct, but may not erase. Every field
 * falls back to what was already stored when the incoming hit has nothing to
 * say about it.
 *
 * This lives in lib/ rather than inline in the page because no test file may
 * live under app/ — `vitest.config.mts` includes only lib/, scripts/ and
 * components/ — and a merge rule that no test can reach is a merge rule that
 * silently regresses. `lib/catalogExtras.test.ts` is its test.
 *
 * NOT a place to dedupe two ids for one city. See the note in
 * `app/plan/page.tsx`'s `addCatalog`: a `CatalogHit` carries no coordinates, so
 * the only key available here is the name, and `PlaceSearch`'s measurements say
 * name alone folds 32 genuinely different Chinese cities together — the two
 * Yushus are 2,852 km apart. Both producers already dedupe on better keys.
 */
export function mergeCatalogHit(
  stored: CatalogHit | undefined,
  incoming: CatalogHit
): CatalogHit {
  if (!stored) return incoming;
  return {
    qid: incoming.qid,
    name: incoming.name,
    localName: incoming.localName ?? stored.localName,
    province: incoming.province ?? stored.province,
    description: incoming.description ?? stored.description,
    // `??`, never `||`: 0 is a real population for 4,721 of the 58,742
    // committed shard rows — a place GeoNames carries no figure for — and only
    // `null` means "this producer does not know".
    population: incoming.population ?? stored.population,
    // Not `??`: `attractionCount` is a non-nullable number that the search
    // path hard-codes to 0 because a ranked row never held one, so 0 is this
    // field's "unknown" and must not overwrite a count the map supplied.
    attractionCount: incoming.attractionCount > 0 ? incoming.attractionCount : stored.attractionCount,
  };
}

/**
 * Whether a freshly merged catalog pick should trigger the lazy enrichment
 * fetch in `app/plan/page.tsx`'s `addCatalog`.
 *
 * Three refusals, and each one closes a request that could never have helped:
 *
 * 1. **It already has a description.** Either the map supplied one or an
 *    earlier fetch filled it in. Nothing to ask for.
 * 2. **It is not a GeoNames id.** `DestinationStep.addPlace` hard-codes
 *    `description: null` for every search pick, because a `RankedPlace` never
 *    held one — so rule 1 is false on *every* first search pick, Wikidata
 *    `Q…` ids included. `/api/cities/enrich` queries by `wdt:P1566`, the
 *    GeoNames id, so a `Q…` is a round trip that cannot answer by
 *    construction. `isGeoNamesId` comes from `lib/geoNamesId.ts`, the leaf —
 *    never from `lib/server/cityIndex.ts`, which re-exports it but
 *    static-imports the 3.65 MB city index along with it.
 * 3. **It has been asked about already this session.** A cached miss comes
 *    back with no description, so rule 1 stays false forever for a city
 *    Wikidata has never heard of, and re-picking it would re-ask on every
 *    pick. The caller holds the set in a ref that is never cleared.
 *
 * Here rather than inline in the page for the same reason `mergeCatalogHit`
 * is: `vitest.config.mts` includes only lib/, scripts/ and components/, so a
 * guard written inside app/ is a guard no test can reach.
 */
export function shouldFetchEnrichment(
  merged: CatalogHit,
  alreadyRequested: ReadonlySet<string>
): boolean {
  if (merged.description !== null) return false;
  if (!isGeoNamesId(merged.qid)) return false;
  return !alreadyRequested.has(merged.qid);
}
