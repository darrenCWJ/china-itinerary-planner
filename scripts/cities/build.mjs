/**
 * ingest-cities — ranking, deduplication against the catalog, shard construction.
 *
 * Moved verbatim out of scripts/ingest-cities.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-cities.mjs.
 *
 * This is the module that reads lib/geo.ts and lib/foldPlaceName.ts straight
 * out of lib/ — see scripts/ingest-cities.mjs's header for why, and for the
 * MODULE_TYPELESS_PACKAGE_JSON warning those two imports print.
 */

import { foldPlaceName } from '../../lib/foldPlaceName.ts';
import { haversineKm } from '../../lib/geo.ts';

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Cities kept per country. Measured: 750 from cities500 captures 13 of the 14
 * destinations a population >= 15,000 filter excluded entirely (all but
 * Giverny, which is a place you visit from Vernon rather than sleep in, and so
 * belongs in the attractions layer). Total across 246 countries: 59,073.
 */
export const CITIES_PER_COUNTRY = 750;

/**
 * The composite notability score, §2.1: `altNameCount + 2 * log10(population)`.
 *
 * `altNameCount` is the size of the alternate-names column already in the
 * dump — no second source and no extra fetch. Alone it is not a clean
 * separator (tourist towns run 9-26, communes 0-12, and they overlap); ranked
 * within a country it separates well, because it is compared against a local
 * baseline rather than a global threshold.
 *
 * Population is clamped to 1. `Math.log10(0)` is `-Infinity`, and adding any
 * finite alternate-name count to `-Infinity` is still `-Infinity`, so without
 * the clamp all 30,648 unpopulated rows tie at the bottom and the id tiebreak
 * — not notability — decides which of them make a small country's cut.
 */
export function cityScore(row) {
  return row.altNameCount + 2 * Math.log10(Math.max(1, row.population));
}

/**
 * Every country's kept rows, in ranking order.
 *
 * A Map, not an object: "CO" is a real country code and "constructor" is a
 * real string, and a plain object cannot tell an inherited member from a
 * missing key — see `parseAdmin1Codes` for the same reasoning.
 *
 * The id tiebreak is not cosmetic. GeoNames reorders rows between nightly
 * rebuilds, so two rows with an identical score would otherwise swap places
 * and rewrite a shard that carries no new data — which the daily workflow
 * would then commit.
 */
export function topPerCountry(rows, perCountry = CITIES_PER_COUNTRY) {
  const byCountry = new Map();
  for (const row of rows) {
    const list = byCountry.get(row.country);
    if (list) list.push(row);
    else byCountry.set(row.country, [row]);
  }
  const kept = new Map();
  for (const [country, list] of byCountry) {
    list.sort((a, b) => cityScore(b) - cityScore(a) || a.id.localeCompare(b.id));
    kept.set(country, list.slice(0, perCountry));
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Deduplication against the existing Wikidata catalog
// ---------------------------------------------------------------------------

/**
 * How close two records have to be to be the same city, given their names
 * already match. Cities are a few kilometres across and the two sources place
 * their centres differently — GeoNames puts Jinan at 36.66833/116.99722 and
 * Wikidata at 36.6667/116.9833, 1.2 km apart. 5 km covers that disagreement
 * without reaching the next town.
 */
export const DEDUP_RADIUS_KM = 5;

/**
 * The GeoNames rows that are NOT already in the Wikidata catalog.
 *
 * The 695 existing China cities keep their Wikidata QIDs so their descriptions,
 * images and interest tags survive and no trip data migrates — which means a
 * GeoNames row for the same place is a duplicate, and the QID record is the
 * richer one. Both halves of the test are needed: name alone collapses the two
 * distinct Peruvian Cuscos 1,400 km apart, and distance alone collapses a city
 * with its neighbouring district.
 *
 * Names fold through `foldPlaceName`, the same fold search uses, because the
 * two sources disagree about apostrophes and diacritics: 23 of the 695 catalog
 * names carry an apostrophe and 2 carry diacritics.
 *
 * Indexed by folded name so this is one pass rather than 695 x 750 haversines
 * per country, and stable: the kept rows come back in the order they arrived,
 * which is ranking order and is what decides who gets enriched.
 */
export function dropCatalogDuplicates(rows, catalogCities) {
  if (catalogCities.length === 0) return [...rows];
  const byName = new Map();
  for (const city of catalogCities) {
    const key = foldPlaceName(city.name);
    const list = byName.get(key);
    if (list) list.push(city);
    else byName.set(key, [city]);
  }
  return rows.filter((row) => {
    const twins = byName.get(foldPlaceName(row.name));
    if (!twins) return true;
    return !twins.some((twin) => haversineKm(row, twin) <= DEDUP_RADIUS_KM);
  });
}

// ---------------------------------------------------------------------------
// Shard construction
// ---------------------------------------------------------------------------

/**
 * Cities per country that get a Wikipedia summary and image at build time.
 * Measured total across 246 countries: 6,244 — fewer than 246 x 30 because
 * most countries have fewer than 30 cities in cities500. Everything else is
 * enriched lazily on first selection.
 */
export const ENRICH_PER_COUNTRY = 30;

/**
 * The per-country shards, plus the enrichment target list ranking order would
 * otherwise throw away.
 *
 * Order of operations is load-bearing: cut to `perCountry` FIRST, dedup
 * SECOND. Reversing them lets China backfill the 337 slots its QID cities
 * occupy with rank-751-and-below rows — 750 GeoNames cities on top of 695
 * Wikidata ones, which is not what "top 750 per country" means.
 *
 * `shards` are in display order (population descending) because §3.2 says the
 * score decides inclusion only and must never surface in the UI. `targets` are
 * in ranking order because notability, not size, is what makes a description
 * worth fetching ahead of time.
 */
export function buildCities(rows, admin1Codes, catalogCities, perCountry = CITIES_PER_COUNTRY) {
  const ranked = topPerCountry(rows, perCountry);
  const shards = new Map();
  const targets = new Map();
  let total = 0;
  for (const country of [...ranked.keys()].sort()) {
    const kept = dropCatalogDuplicates(ranked.get(country), catalogCities);
    // An empty shard is a file the client would fetch and learn nothing from.
    if (kept.length === 0) continue;
    targets.set(country, kept.slice(0, ENRICH_PER_COUNTRY).map((row) => row.id));
    const display = [...kept].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
    shards.set(
      country,
      display.map((row) => ({
        id: row.id,
        n: row.name,
        lat: row.lat,
        lon: row.lon,
        // `?? null`, not `?? row.admin1Code`: this value is rendered to the
        // user as a province, and "22" is not a province of Japan. A Map
        // lookup, so a code spelled "constructor" cannot resolve to a function.
        a1: admin1Codes.get(`${country}.${row.admin1Code}`) ?? null,
        // The code the name was resolved FROM. Kept because the name join to
        // Natural Earth admin-1 was measured at 63.4% with 35 countries at
        // zero, while this code matches `gn_a1_code` on 83% of features and
        // is the only way to verify a geometric assignment. A row with no
        // admin-1 gets null, never the dangling prefix `"PE."`.
        a1c: row.admin1Code === '' ? null : `${country}.${row.admin1Code}`,
        p: row.population,
        elev: row.elevation ?? null,
        tz: row.timezone,
      }))
    );
    total += display.length;
  }
  return { shards, targets, total };
}

