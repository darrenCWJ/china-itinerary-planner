import { shardRowToMapCity, type CityEnrichmentIndex, type CityShardRow } from "@/lib/cityShard";
import { curatedPlaceNames } from "@/lib/curatedNames";
import { DESTINATIONS } from "@/lib/data";
import { foldPlaceName } from "@/lib/foldPlaceName";
import { haversineKm, latLonOf } from "@/lib/geo";
import { regionForProvinceText } from "@/lib/provinces";
import type { MapCity } from "@/lib/tripShared";
import { CLIMATE_COUNTRY, type MapPlace } from "./mapTypes";

/**
 * What the open country's cities are, before anything draws them.
 *
 * The three steps `MapExplorer` used to hold inline: which of the two city
 * sources a row came from, which rows are the same place twice, and what a
 * `MapCity` looks like once it is a `MapPlace`. All pure, all functions of
 * their arguments alone, and none of them touching React — which is what makes
 * them testable without a DOM.
 */

/**
 * How near two places of the same name have to be before they are one place.
 *
 * 25 km, not the ingest's `DEDUP_RADIUS_KM = 5`. GeoNames puts a Chinese
 * prefecture-level city's point on the urban seat and Wikidata puts it on the
 * administrative centroid, and the gap between the two is what these rows are
 * made of: every duplicate measured lands between 5.0 km (Qinzhou, Dezhou) and
 * 18.7 km (Tacheng), so 5 km is exactly the gate they all cleared. 25 km still
 * leaves daylight above the widest of them and well below the nearest pair
 * that must survive — Longnan's two points, 42.9 km apart.
 */
const SAME_CITY_KM = 25;

/**
 * Shard rows that are a second marker for a city the catalog already answered.
 *
 * The sibling of `dropCatalogDuplicates` in `scripts/cities/build.mjs`, not a
 * reuse of it: that one is a Node build script reading the GeoNames dump's row
 * shape, it cannot be imported into a "use client" bundle, and it runs at a
 * different radius. A re-ingest would not help here anyway — it would leave the
 * client just as defenceless against the next catalog row that lands beside a
 * shard row already shipped.
 *
 * The two legs are concatenated below, and China is the one country where both
 * of them answer — so without this a duplicate draws twice: two
 * `<g role="button">` with the same `aria-label`, which a screen reader reads
 * out as two cities, and two ids that `togglePlace` resolves separately, so the
 * plan allocates days to Nantong twice with a ~5 km route leg between the
 * copies. Search offers one Nantong (Task 13); this is the same catalog's other
 * surface, and the two have to agree.
 *
 * Keyed on distance, not on the admin-1 string, because `MapCity` carries
 * coordinates on both sides and the strings disagree. Measured against
 * data/catalog.json and public/cities/CN.json with the real `foldPlaceName`
 * and `haversineKm`: of the 19 duplicate rows, 6 would slip through a
 * name-plus-admin-1 test because the catalog labels them by prefecture where
 * the shard labels them by province (Pizhou/Xuzhou, Xingning/Meizhou,
 * Laizhou/Yantai, Laohekou/Xiangyang, plus Yining and Tacheng in Xinjiang) —
 * and that test would also wrongly fold Liaoning's two Jinzhous, 229.5 km
 * apart under one province label. Name alone is worse again: 32 of the 51
 * shard rows sharing a folded name with a catalog city are genuinely different
 * places, the widest being the two Yushus at 2,852 km.
 *
 * The shard row is the one dropped. The catalog row carries the QID that
 * `resolveDestinations` sends down the Wikidata branch, plus its attraction
 * count and blurb; the GeoNames row carries none of that.
 */
export function dropCatalogTwins(rows: CityShardRow[], catalog: MapCity[]): CityShardRow[] {
  const byFoldedName = new Map<string, MapCity[]>();
  for (const city of catalog) {
    const key = foldPlaceName(city.name);
    const found = byFoldedName.get(key);
    if (found) found.push(city);
    else byFoldedName.set(key, [city]);
  }
  return rows.filter((row) => {
    const twins = byFoldedName.get(foldPlaceName(row.n));
    return !twins?.some((twin) => haversineKm(twin, row) <= SAME_CITY_KM);
  });
}

/**
 * The open country's cities for the map: the Wikidata catalog's rows first,
 * then the GeoNames shard's, minus the ones that would draw twice.
 *
 * A GeoNames row for a place a curated card already covers is a second marker
 * for the same place. `dropCatalogDuplicates` in the ingest only removes rows
 * that duplicate a data/catalog.json QID city, and Yangshuo — a curated
 * destination — has no catalog.json row, so its row survives and would draw
 * beside "Guilin & Yangshuo".
 *
 * China is the one country that gets both halves, and they are not disjoint.
 * Measured on the committed data: /api/map/cities answers CN with 676
 * Wikidata cities, and of the shard's 413 rows 3 fold to a curated name and
 * 19 more are `dropCatalogTwins` duplicates, so 391 join them — 1,067
 * catalog markers rather than the 1,086 a plain concatenation draws.
 */
export function mergeCountryCities(
  countryCode: string,
  catalogCities: MapCity[],
  shardRows: CityShardRow[],
  enrichment: CityEnrichmentIndex
): MapCity[] {
  const suppressed = curatedPlaceNames(countryCode);
  const shardCities = dropCatalogTwins(
    shardRows.filter((row) => !suppressed.has(foldPlaceName(row.n))),
    catalogCities
  ).map((row) => shardRowToMapCity(row, enrichment));
  return [...catalogCities, ...shardCities];
}

/**
 * Every marker the open country's map has to draw: its curated destinations,
 * then the cities `mergeCountryCities` answered with.
 *
 * `visited` is subtracted from the curated half alone — a curated card the
 * traveller has already been to is not offered again, and the catalog half has
 * no such history to read.
 */
export function buildExplorerPlaces(
  cities: MapCity[],
  visited: readonly string[],
  countryCode: string
): MapPlace[] {
  const curated = DESTINATIONS.filter(
    // Every destination states its own country, so there is no default here
    // that a non-Chinese destination could fall through.
    (d) => !visited.includes(d.id) && d.country === countryCode
  ).flatMap(
    (d): MapPlace[] => {
      // A place with no coordinates cannot be drawn on a map or routed
      // through, so it is dropped here rather than given a fake pin. Every
      // curated destination has real coordinates, so nothing is lost today.
      const at = latLonOf(d);
      if (!at) return [];
      return [
        {
          id: d.id,
          kind: "curated",
          name: d.name,
          localName: d.localName,
          province: null,
          // The destination's own country, not the open one. A curated place
          // is only ever drawn on its own country's map today, but `region`
          // is only readable against the country it belongs to.
          country: d.country,
          region: d.region,
          lat: at.lat,
          lon: at.lon,
          population: null,
          level: "curated",
          attractionCount: d.activities.length,
          blurb: d.tagline,
          emoji: d.emoji,
          bestSeasons: d.bestSeasons,
          seasonNotes: d.seasonNotes,
        },
      ];
    }
  );
  const catalog = cities.map(
    (c): MapPlace => ({
      id: c.qid,
      kind: "catalog",
      name: c.name,
      localName: c.localName,
      province: c.province,
      // Every city in this list came out of the open country's shard, so the
      // open country IS its country. Carried on the place because `region`
      // below cannot be read without it: outside China the admin-1 name is
      // the region label, and some of those names ARE China's — Botswana's
      // Central District spells the same as China's Central. See `isChinaPlace`.
      country: countryCode,
      // `regionForProvinceText` is a China-only keyword table and its
      // `?? "Central"` fallback is one of China's own seven — which
      // `isChinaRegion` then accepts, handing a Peruvian city a Chinese
      // month-fit rather than the neutral one that guard exists to give.
      // Outside China the admin-1 name IS the region label.
      region:
        countryCode === CLIMATE_COUNTRY
          ? (regionForProvinceText(`${c.province ?? ""} ${c.name}`) ?? "Central")
          : (c.province ?? ""),
      lat: c.lat,
      lon: c.lon,
      population: c.population,
      level: c.level,
      attractionCount: c.attractionCount,
      blurb: c.blurb,
    })
  );
  return [...curated, ...catalog];
}
