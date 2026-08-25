import fs from "node:fs";
import path from "node:path";
import bundledCatalogJson from "../../data/catalog.json";
import { getCountry } from "../countries";
import { curatedPlaceNames } from "../curatedNames";
import { DESTINATIONS } from "../data";
import { foldPlaceName } from "../foldPlaceName";
import { regionForProvinceText } from "../provinces";
import type { CatalogHit, MapCity } from "../tripShared";
import type { Activity, CountryCode, Destination, Interest } from "../types";
import { cityIndexEntry, isGeoNamesId, type CityIndexEntry } from "./cityIndex";

export interface CatalogCity {
  qid: string;
  name: string;
  /**
   * Local-language name. The on-disk artifact predates the rename and may
   * still spell this `chineseName`; `normaliseCatalog` accepts either, so an
   * artifact generated before PR3 keeps working without a re-ingest.
   */
  localName: string | null;
  province: string | null;
  /**
   * ISO alpha-2. The on-disk artifact predates this field and every one of its
   * 695 cities is Chinese; `normaliseCatalog` fills `"CN"` at the read
   * boundary, so an artifact generated before the worldwide catalog keeps
   * working without a re-ingest — the same accommodation `chineseName` gets.
   *
   * The default lives here and only here. This task removes the same default
   * from four UI call sites for the reason spec §5 gives: a value that is
   * inferred in five places cannot be trusted in any of them.
   */
  country: CountryCode;
  lat: number;
  lon: number;
  population: number | null;
  description: string | null;
  interests: Interest[];
  image: string | null;
  level: "municipality" | "prefecture" | "county";
}

export interface CatalogAttraction {
  qid: string;
  name: string;
  /**
   * Local-language name. The on-disk artifact predates the rename and may
   * still spell this `chineseName`; `normaliseCatalog` accepts either, so an
   * artifact generated before PR3 keeps working without a re-ingest.
   */
  localName: string | null;
  cityQid: string | null;
  lat: number;
  lon: number;
  description: string | null;
  interests: Interest[];
  image: string | null;
}

export interface Catalog {
  generatedAt: string;
  source: string;
  cities: CatalogCity[];
  attractions: CatalogAttraction[];
}

/** Overridable for tests via CIP_CATALOG_PATH, as db.ts does with CIP_DB_PATH. */
function catalogPath(): string {
  return process.env.CIP_CATALOG_PATH ?? path.join(process.cwd(), "data", "catalog.json");
}

/**
 * The catalog is bundled into the build so serverless deployments (read-only
 * filesystem, no data/ directory) still have the full all-China dataset. The
 * on-disk copy takes precedence locally so /api/destinations/refresh works.
 */
const BUNDLED_CATALOG = bundledCatalogJson as unknown as Catalog;

let cache: { mtimeMs: number; catalog: Catalog; byCity: Map<string, CatalogAttraction[]> } | null =
  null;

type LegacyNamed = { localName?: string | null; chineseName?: string | null };

/** The artifact's field was renamed in PR3; read both spellings, emit one. */
function withLocalName<T extends LegacyNamed>(row: T): T {
  const { chineseName, ...rest } = row;
  return { ...rest, localName: row.localName ?? chineseName ?? null } as T;
}

/**
 * Every city in the Wikidata catalog is Chinese and always will be: the 695
 * keep their QIDs so their enrichment survives a worldwide re-ingest, and
 * every other country is served from a GeoNames shard instead. The artifact
 * predates the field, so it is filled here — the one read boundary — rather
 * than defaulted at each of the places that reads it.
 */
const LEGACY_CATALOG_COUNTRY: CountryCode = "CN";

function withCityDefaults(row: CatalogCity): CatalogCity {
  // `Omit` matters: in a plain intersection the required `country` wins over
  // the optional one, so `legacy.country` would still be non-nullable and the
  // default below would be dead weight the compiler never checks. Written this
  // way, dropping the `??` is a type error.
  const legacy = row as Omit<CatalogCity, "country"> & { country?: CountryCode };
  return { ...withLocalName(row), country: legacy.country ?? LEGACY_CATALOG_COUNTRY };
}

function normaliseCatalog(raw: Catalog): Catalog {
  return {
    ...raw,
    cities: raw.cities.map(withCityDefaults),
    attractions: raw.attractions.map(withLocalName),
  };
}

function setCache(catalog: Catalog, mtimeMs: number): void {
  const normalised = normaliseCatalog(catalog);
  const byCity = new Map<string, CatalogAttraction[]>();
  for (const a of normalised.attractions) {
    if (!a.cityQid) continue;
    const list = byCity.get(a.cityQid) ?? [];
    list.push(a);
    byCity.set(a.cityQid, list);
  }
  cache = { mtimeMs, catalog: normalised, byCity };
}

export function loadCatalog(): Catalog | null {
  try {
    const stat = fs.statSync(catalogPath());
    if (!cache || cache.mtimeMs !== stat.mtimeMs) {
      setCache(JSON.parse(fs.readFileSync(catalogPath(), "utf8")) as Catalog, stat.mtimeMs);
    }
  } catch {
    if (!cache) setCache(BUNDLED_CATALOG, -1);
  }
  return cache?.catalog ?? null;
}

const DEFAULT_CATALOG_URL =
  "https://raw.githubusercontent.com/darrenCWJ/china-itinerary-planner/main/data/catalog.json";

let remoteLoad: Promise<void> | null = null;

/**
 * Serverless deployments may ship only a stub catalog (the full file is too
 * large to inline in the deploy payload). Fetch the real catalog from the
 * GitHub repo once per instance and cache it in memory. No-op when a full
 * catalog is already available from disk or the bundle. Call this before the
 * synchronous catalog helpers in any API route that needs catalog data.
 */
export async function ensureCatalogLoaded(): Promise<void> {
  const current = loadCatalog();
  if (current && current.cities.length > 0) return;
  if (!remoteLoad) {
    remoteLoad = (async () => {
      // `||` so a present-but-empty CATALOG_URL falls back instead of fetching "".
      const url = process.env.CATALOG_URL?.trim() || DEFAULT_CATALOG_URL;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Catalog fetch failed (${res.status})`);
      setCache((await res.json()) as Catalog, -2);
    })().catch((err) => {
      remoteLoad = null; // allow the next request to retry
      throw err;
    });
  }
  try {
    await remoteLoad;
  } catch {
    // Catalog stays unavailable; endpoints degrade gracefully.
  }
}

export function catalogStatus(): { available: boolean; generatedAt?: string; cities?: number; attractions?: number } {
  const catalog = loadCatalog();
  if (!catalog) return { available: false };
  return {
    available: true,
    generatedAt: catalog.generatedAt,
    cities: catalog.cities.length,
    attractions: catalog.attractions.length,
  };
}

/**
 * Normalised through `getCountry`, so " cn " and "CN" agree and anything that
 * is not a country code — "CHN", "C", a non-string — comes back as `""`.
 *
 * `getCountry` rather than a local trim/uppercase/regex: `lib/countries.ts`
 * owns what an acceptable code is, and `lib/cityShard.ts` — the client half of
 * this same country scoping — already asks it through `isCountryCode`. A
 * second copy of the rule here would let the two halves drift apart on the one
 * value this whole phase scopes everything by.
 */
function normaliseCountryCode(country: string): string {
  return getCountry(country).code;
}

/**
 * Ranked search over the Wikidata catalog, scoped to one country.
 *
 * The country is required and unrecognised values return nothing rather than
 * everything: failing open would serve the whole China catalog to a request
 * that named no country, which is the bug the China-only allowlist
 * `PlaceSearch` used to hold existed to paper over (deleted in Task 13).
 *
 * The GeoNames half of the catalog is not searched here. It lives in
 * per-country files under `public/`, which a lambda cannot read (spec §3.2),
 * so the client searches the shard it already fetched and merges the two
 * result sets in `rankPlaces`.
 */
export function searchCities(query: string, country: string, limit = 25): CatalogHit[] {
  const catalog = loadCatalog();
  if (!catalog) return [];
  const wanted = normaliseCountryCode(country);
  if (wanted === "") return [];
  const q = foldPlaceName(query);
  if (q.length < 1) return [];
  const curated = curatedPlaceNames(wanted);

  const scored = catalog.cities
    .filter((c) => c.country === wanted && !curated.has(foldPlaceName(c.name)))
    .map((c) => {
      const name = foldPlaceName(c.name);
      const zh = c.localName ?? "";
      const province = foldPlaceName(c.province ?? "");
      let score = -1;
      if (name.startsWith(q) || zh.startsWith(query.trim())) score = 3;
      else if (name.includes(q) || zh.includes(query.trim())) score = 2;
      else if (province.startsWith(q)) score = 1;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || (b.c.population ?? 0) - (a.c.population ?? 0)
    )
    .slice(0, limit);

  return scored.map(({ c }): CatalogHit => {
    const attractions = cache?.byCity.get(c.qid) ?? [];
    return {
      qid: c.qid,
      name: c.name,
      localName: c.localName,
      province: c.province,
      description: c.description,
      population: c.population,
      attractionCount: attractions.length,
    };
  });
}

/**
 * A region label meaningful inside this city's own country.
 *
 * `regionForProvinceText` is a China-only keyword table and its `?? "Central"`
 * fallback is one of China's own seven regions — which `mapTypes.isChinaRegion`
 * then accepts, giving a Swiss town a Chinese month-fit rather than the
 * neutral one the guard exists to produce. Outside China the admin-1 name IS
 * the region label (see `Destination.region`, lib/types.ts:57-63).
 */
function regionFor(country: string, province: string | null, cityName: string): string {
  if (country !== "CN") return province ?? "";
  return regionForProvinceText(`${province ?? ""} ${cityName}`) ?? "Central";
}

function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim().slice(0, 200);
}

// Fillers for cities with little catalogued data — never must-sees, so real
// attractions always outrank them.
const GENERIC_ACTIVITIES = (cityName: string): Activity[] => [
  {
    name: `Old town & main streets of ${cityName}`,
    interests: ["history", "shopping"],
    slots: 1,
    timeOfDay: "day",
  },
  {
    name: "Local market & food street",
    interests: ["food", "nightlife"],
    slots: 1,
    timeOfDay: "evening",
  },
  {
    name: "City museum & central park",
    interests: ["museums", "nature"],
    slots: 1,
    timeOfDay: "day",
  },
];

/**
 * The Wikidata catalog's cities for one country, in map-marker form.
 *
 * Curated destinations are filtered out — the map renders those from the
 * richer curated data instead. Every city in this catalog is Chinese, so this
 * is empty for every country but CN; the map merges in the GeoNames shard it
 * fetched for whichever country is open (spec §5, gate 3).
 */
export function mapCities(country: string): MapCity[] {
  const catalog = loadCatalog();
  if (!catalog) return [];
  const wanted = normaliseCountryCode(country);
  if (wanted === "") return [];
  const curated = curatedPlaceNames(wanted);
  return catalog.cities
    .filter((c) => c.country === wanted && !curated.has(foldPlaceName(c.name)))
    .map((c): MapCity => ({
      qid: c.qid,
      name: c.name,
      localName: c.localName,
      province: c.province,
      lat: c.lat,
      lon: c.lon,
      population: c.population,
      level: c.level,
      attractionCount: cache?.byCity.get(c.qid)?.length ?? 0,
      blurb: firstSentence(c.description),
    }));
}

/** Build a plannable Destination from a catalog city and its attractions. */
export function catalogCityToDestination(city: CatalogCity): Destination {
  loadCatalog();
  const attractions = cache?.byCity.get(city.qid) ?? [];
  const fromAttractions: Activity[] = attractions.slice(0, 12).map(
    (a, i): Activity => ({
      name: a.name,
      // Untagged notable attractions default to history+nature — the safest
      // prior for enwiki-notable Chinese sights.
      interests: a.interests.length > 0 ? a.interests : ["history", "nature"],
      slots: 1,
      timeOfDay: "day",
      mustSee: i < 2,
      note: firstSentence(a.description) ?? undefined,
    })
  );
  // Cities with few catalogued attractions still deserve a full day plan.
  const activities: Activity[] =
    fromAttractions.length >= 3
      ? fromAttractions
      : [...fromAttractions, ...GENERIC_ACTIVITIES(city.name)];

  const maxDays = Math.min(4, Math.max(2, Math.ceil(activities.length / 3)));
  const knownFor =
    attractions.length > 0
      ? attractions.slice(0, 5).map((a) => a.name)
      : city.interests.map((i) => i[0].toUpperCase() + i.slice(1));

  return {
    id: city.qid,
    name: city.name,
    localName: city.localName,
    region: regionFor(city.country, city.province, city.name),
    country: city.country,
    lat: city.lat,
    lon: city.lon,
    emoji: "📍",
    tagline:
      firstSentence(city.description) ??
      `${city.name}${city.province ? `, ${city.province}` : ""} — from the all-China catalog`,
    knownFor,
    bestSeasons: ["spring", "autumn"],
    seasonNotes: {},
    foods: [],
    suggestedDays: [1, maxDays],
    activities,
  };
}

/**
 * A plannable Destination from nothing but a bundled index entry.
 *
 * GeoNames carries no descriptions, no images and no attractions, and the
 * shard that would carry enrichment is under `public/`, which a lambda cannot
 * read. So this builds from the six fields the index has — which is enough,
 * because a city with no catalogued attractions already takes this path today
 * through `GENERIC_ACTIVITIES`, and the wizard's enrichment call fills the
 * description in on the client.
 */
export function geoNamesCityToDestination(entry: CityIndexEntry): Destination {
  const activities = GENERIC_ACTIVITIES(entry.name);
  return {
    id: entry.id,
    name: entry.name,
    localName: null,
    // The admin-1 name, or nothing. Never "Central": that is one of China's
    // seven, and `mapTypes.isChinaRegion` would accept it.
    region: entry.region ?? "",
    country: entry.country,
    lat: entry.lat,
    lon: entry.lon,
    emoji: "📍",
    tagline: entry.region ? `${entry.name}, ${entry.region}` : entry.name,
    knownFor: [],
    bestSeasons: ["spring", "autumn"],
    seasonNotes: {},
    foods: [],
    suggestedDays: [1, 2],
    activities,
  };
}

/**
 * Resolve any mix of curated ids, Wikidata qids and GeoNames ids into
 * Destination objects.
 *
 * Three namespaces, checked in order of specificity. The GeoNames branch is
 * keyed on the `G` prefix rather than on a failed catalog lookup, because
 * §3.3's whole point is that the namespaces stay distinguishable: a bare
 * integer or an unprefixed id must resolve to nothing rather than to whichever
 * source happens to hold that string.
 */
export function resolveDestinations(ids: string[]): Destination[] {
  const catalog = loadCatalog();
  return ids
    .map((id) => {
      const curated = DESTINATIONS.find((d) => d.id === id);
      if (curated) return curated;
      if (isGeoNamesId(id)) {
        const entry = cityIndexEntry(id);
        return entry ? geoNamesCityToDestination(entry) : undefined;
      }
      const city = catalog?.cities.find((c) => c.qid === id);
      return city ? catalogCityToDestination(city) : undefined;
    })
    .filter((d): d is Destination => Boolean(d));
}
