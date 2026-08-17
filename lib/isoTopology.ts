import type { Topology } from "topojson-specification";

/**
 * Reconciliation layer between `public/world-countries.json` and the alpha-2
 * codes the rest of the app speaks.
 *
 * The asset is built by `scripts/build-world-topology.mjs` from world-atlas 50m
 * (a public-domain Natural Earth derivative) and committed, exactly as
 * `public/china-provinces.json` is. This module is the only thing that knows the
 * file's shape, so the on-disk layout stays an implementation detail.
 */

/** Root-relative so the fetch resolves the same from every route. */
export const WORLD_TOPOLOGY_PATH = "/world-countries.json";

/** The single TopoJSON object in the asset. `land` is stripped at build time. */
export const WORLD_COUNTRIES_OBJECT = "countries";

/**
 * A country whose polygon is smaller than a hit target at world zoom, carried
 * as a point so it stays selectable. Coordinates are the feature's geodesic
 * centroid in degrees, computed at build time — the client does no geometry.
 */
export interface SmallCountry {
  code: string;
  name: string;
  lon: number;
  lat: number;
}

export interface WorldTopology {
  /** Features re-keyed so `id` is the alpha-2 code, not ISO numeric. */
  topology: Topology;
  smallCountries: SmallCountry[];
}

/**
 * ISO codes with no drawable feature in the 50m topology, and why.
 *
 * Spec §6 accepts these: **search is the guaranteed path to every country**, and
 * the map is a discovery affordance. What matters is that the gap is declared —
 * an undeclared one is a country that silently vanishes from the picker.
 *
 * Not what the plan predicted. It expected Hong Kong and Macau here; that is
 * true of the 110m file, but 50m carries both as real ISO-coded features (344,
 * 446), which is a further reason the coarser asset was rejected. What is
 * actually missing splits three ways: territories Natural Earth folds into their
 * parent state, small islands it omits, and places it draws without an ISO id.
 */
export const SEARCH_ONLY_REASONS: Readonly<Record<string, string>> = {
  // Drawn as part of metropolitan France — Natural Earth carries no separate
  // geometry for the overseas departments.
  GF: "French Guiana is drawn inside France",
  GP: "Guadeloupe is drawn inside France",
  MQ: "Martinique is drawn inside France",
  RE: "Réunion is drawn inside France",
  YT: "Mayotte is drawn inside France",
  // Drawn, but without an ISO id, so it cannot be re-keyed.
  CX: "Christmas Island is inside Natural Earth's unkeyed Indian Ocean Ter.",
  CC: "Cocos (Keeling) Islands are inside the same unkeyed feature",
  XK: "Kosovo is drawn with no ISO id at all (983/XK is user-assigned)",
  // Absent from the 50m countries layer entirely.
  BQ: "Caribbean Netherlands has no 50m feature",
  BV: "Bouvet Island has no 50m feature",
  GI: "Gibraltar has no 50m feature",
  SJ: "Svalbard and Jan Mayen are drawn inside Norway",
  TK: "Tokelau has no 50m feature",
  TV: "Tuvalu has no 50m feature",
  UM: "US Minor Outlying Islands have no 50m feature",
};

export const SEARCH_ONLY: ReadonlySet<string> = new Set(
  Object.keys(SEARCH_ONLY_REASONS),
);

function normalise(code: string): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

export function isSearchOnly(code: string): boolean {
  return SEARCH_ONLY.has(normalise(code));
}

interface CountriesObject {
  geometries: { id?: unknown }[];
}

function countriesObject(topology: Topology): CountriesObject {
  return topology.objects[WORLD_COUNTRIES_OBJECT] as unknown as CountriesObject;
}

/** Alpha-2 codes with a drawable polygon. */
export function worldCountryCodes(world: WorldTopology): ReadonlySet<string> {
  const out = new Set<string>();
  for (const geometry of countriesObject(world.topology).geometries) {
    if (typeof geometry.id === "string") out.add(geometry.id);
  }
  return out;
}

/** Alpha-2 codes in the point layer. Always a subset of the drawable codes. */
export function smallCountryCodes(world: WorldTopology): ReadonlySet<string> {
  return new Set(world.smallCountries.map((c) => c.code));
}

export function hasPolygon(world: WorldTopology, code: string): boolean {
  return worldCountryCodes(world).has(normalise(code));
}

export function hasPoint(world: WorldTopology, code: string): boolean {
  return smallCountryCodes(world).has(normalise(code));
}

function fail(field: string, detail: string): never {
  throw new Error(`world-countries.json: ${field} ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the asset at the boundary and narrows it.
 *
 * Throws rather than degrading: a malformed topology cannot be rendered into
 * anything meaningful, and a caller that silently got an empty world would
 * render a blank picker with no clue why. The picker's own error state is the
 * place to handle this.
 */
export function parseWorldTopology(raw: unknown): WorldTopology {
  if (!isRecord(raw)) fail("root", "is not an object");

  const topology = raw.topology;
  if (!isRecord(topology) || topology.type !== "Topology" || !Array.isArray(topology.arcs)) {
    // The likeliest cause is a raw world-atlas download dropped in as-is,
    // skipping the re-key — which would leave every feature keyed by numeric.
    fail("topology", "is missing or is not a TopoJSON Topology (was the build script run?)");
  }

  const objects = topology.objects;
  if (!isRecord(objects) || !isRecord(objects[WORLD_COUNTRIES_OBJECT])) {
    fail(`topology.objects.${WORLD_COUNTRIES_OBJECT}`, "is missing");
  }
  const countries = objects[WORLD_COUNTRIES_OBJECT] as Record<string, unknown>;
  if (!Array.isArray(countries.geometries)) {
    fail(`topology.objects.${WORLD_COUNTRIES_OBJECT}.geometries`, "is not an array");
  }

  if (!Array.isArray(raw.smallCountries)) fail("smallCountries", "is not an array");
  const smallCountries = raw.smallCountries.map((entry, index): SmallCountry => {
    if (
      !isRecord(entry) ||
      typeof entry.code !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.lon !== "number" ||
      typeof entry.lat !== "number"
    ) {
      fail(`smallCountries[${index}]`, "is not { code, name, lon, lat }");
    }
    return {
      code: entry.code,
      name: entry.name,
      lon: entry.lon,
      lat: entry.lat,
    };
  });

  return { topology: topology as unknown as Topology, smallCountries };
}

/**
 * Fetches and validates the asset. Callers mount this lazily — spec §6 requires
 * the topology to load only once the picker opens, so nothing here runs on a
 * page that never shows a map.
 */
export async function fetchWorldTopology(signal?: AbortSignal): Promise<WorldTopology> {
  const response = await fetch(WORLD_TOPOLOGY_PATH, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`world topology ${response.status}`);
  return parseWorldTopology(await response.json());
}
