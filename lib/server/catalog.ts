import fs from "node:fs";
import path from "node:path";
import bundledCatalogJson from "../../data/catalog.json";
import { DESTINATIONS } from "../data";
import { foldPlaceName } from "../foldPlaceName";
import { regionForProvinceText } from "../provinces";
import type { CatalogHit, MapCity } from "../tripShared";
import type { Activity, Destination, Interest, Region } from "../types";

export interface CatalogCity {
  qid: string;
  name: string;
  chineseName: string | null;
  province: string | null;
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
  chineseName: string | null;
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

function setCache(catalog: Catalog, mtimeMs: number): void {
  const byCity = new Map<string, CatalogAttraction[]>();
  for (const a of catalog.attractions) {
    if (!a.cityQid) continue;
    const list = byCity.get(a.cityQid) ?? [];
    list.push(a);
    byCity.set(a.cityQid, list);
  }
  cache = { mtimeMs, catalog, byCity };
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

/** Curated destinations already cover these — hide them from catalog search. */
const CURATED_NAMES = new Set(
  [
    ...DESTINATIONS.map((d) => d.name),
    "Guilin",
    "Yangshuo",
    "Kunming",
    "Dali",
    "Lijiang",
    "Zhangjiajie",
  ].map(foldPlaceName)
);

export function searchCities(query: string, limit = 25): CatalogHit[] {
  const catalog = loadCatalog();
  if (!catalog) return [];
  const q = foldPlaceName(query);
  if (q.length < 1) return [];

  const scored = catalog.cities
    .filter((c) => !CURATED_NAMES.has(foldPlaceName(c.name)))
    .map((c) => {
      const name = foldPlaceName(c.name);
      const zh = c.chineseName ?? "";
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
      chineseName: c.chineseName,
      province: c.province,
      description: c.description,
      population: c.population,
      attractionCount: attractions.length,
    };
  });
}

function regionFor(province: string | null, cityName: string): Region {
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
 * Every catalog city in map-marker form. Curated destinations are filtered
 * out — the map renders those from the richer curated data instead.
 */
export function mapCities(): MapCity[] {
  const catalog = loadCatalog();
  if (!catalog) return [];
  return catalog.cities
    .filter((c) => !CURATED_NAMES.has(foldPlaceName(c.name)))
    .map((c): MapCity => ({
      qid: c.qid,
      name: c.name,
      chineseName: c.chineseName,
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
    chineseName: city.chineseName ?? "",
    region: regionFor(city.province, city.name),
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

/** Resolve any mix of curated ids and catalog qids into Destination objects. */
export function resolveDestinations(ids: string[]): Destination[] {
  const catalog = loadCatalog();
  return ids
    .map((id) => {
      const curated = DESTINATIONS.find((d) => d.id === id);
      if (curated) return curated;
      const city = catalog?.cities.find((c) => c.qid === id);
      return city ? catalogCityToDestination(city) : undefined;
    })
    .filter((d): d is Destination => Boolean(d));
}
