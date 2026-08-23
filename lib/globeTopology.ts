import type { Topology } from "topojson-specification";

/**
 * Boundary for `public/world-globe.json`, the coarse topology the globe draws.
 *
 * Deliberately NOT `lib/isoTopology.ts`. That module is the 50m asset's
 * contract and its central invariant — every point-layer code also has a
 * drawable polygon (`lib/isoTopology.ts:101-102`) — is *false by design* here:
 * 110m carries no feature for 61 countries, and their points are the only
 * thing that keeps them reachable. Sharing a parser would mean either relaxing
 * a true 50m guarantee or rejecting the only correct globe asset.
 *
 * The relationship between the two assets runs one way: `world-countries.json`
 * is the coverage source of truth, and `world-globe.json` is built from it and
 * checked against it. See `scripts/build-globe-topology.mjs`.
 */

/** Root-relative so the fetch resolves the same from every route. */
export const GLOBE_TOPOLOGY_PATH = "/world-globe.json";

/** The single TopoJSON object in the asset. */
export const GLOBE_COUNTRIES_OBJECT = "countries";

/**
 * A country the globe reaches through a point rather than a polygon.
 *
 * Two populations share this layer and both belong in it: countries too small
 * to draw at any resolution (Monaco, Nauru), and countries 110m omits or
 * generalises away that 50m draws perfectly well (Hong Kong, Singapore).
 * Nothing downstream needs to tell them apart — both are "selectable, not
 * drawable" — so the type does not distinguish them.
 */
export interface GlobePoint {
  code: string;
  name: string;
  lon: number;
  lat: number;
}

export interface GlobeTopology {
  /** Features re-keyed so `id` is the alpha-2 code, not ISO numeric. */
  topology: Topology;
  points: GlobePoint[];
}

function fail(field: string, detail: string): never {
  throw new Error(`world-globe.json: ${field} ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ISO 3166-1 alpha-2 country code. */
function isAlpha2Code(value: string): boolean {
  return /^[A-Z]{2}$/.test(value);
}

interface CountriesObject {
  geometries: { id?: unknown }[];
}

function countriesObject(topology: Topology): CountriesObject {
  return topology.objects[GLOBE_COUNTRIES_OBJECT] as unknown as CountriesObject;
}

/** Alpha-2 codes the globe draws as a polygon. */
export function globePolygonCodes(globe: GlobeTopology): ReadonlySet<string> {
  const out = new Set<string>();
  for (const geometry of countriesObject(globe.topology).geometries) {
    if (typeof geometry.id === "string") out.add(geometry.id);
  }
  return out;
}

/** Alpha-2 codes carried in the point layer. NOT a subset of the polygons. */
export function globePointCodes(globe: GlobeTopology): ReadonlySet<string> {
  return new Set(globe.points.map((p) => p.code));
}

/**
 * Every code the globe can select, through either layer. This is the set the
 * coverage invariant compares against the 50m asset, and the set the picker's
 * A–Z list must equal.
 */
export function globeReachableCodes(globe: GlobeTopology): ReadonlySet<string> {
  return new Set([...globePolygonCodes(globe), ...globePointCodes(globe)]);
}

/**
 * Validates at the boundary and narrows. Throws rather than degrading: a
 * half-parsed globe renders a picker that is silently missing countries, which
 * is the exact failure this whole module exists to prevent.
 */
export function parseGlobeTopology(raw: unknown): GlobeTopology {
  if (!isRecord(raw)) fail("root", "is not an object");

  const topology = raw.topology;
  if (!isRecord(topology) || topology.type !== "Topology" || !Array.isArray(topology.arcs)) {
    fail("topology", "is missing or is not a TopoJSON Topology (was the build script run?)");
  }

  const objects = topology.objects;
  if (!isRecord(objects) || !isRecord(objects[GLOBE_COUNTRIES_OBJECT])) {
    fail(`topology.objects.${GLOBE_COUNTRIES_OBJECT}`, "is missing");
  }
  const countries = objects[GLOBE_COUNTRIES_OBJECT] as Record<string, unknown>;
  if (!Array.isArray(countries.geometries)) {
    fail(`topology.objects.${GLOBE_COUNTRIES_OBJECT}.geometries`, "is not an array");
  }
  for (const geometry of countries.geometries as { id?: unknown }[]) {
    if (!isRecord(geometry)) {
      fail("topology", `has a corrupt feature (got null or non-object)`);
    }
    if (typeof geometry.id !== "string") {
      // Numeric ids mean a raw world-atlas download was committed without the
      // re-key, so nothing on the globe would have a code to select.
      fail("topology", `has a non-string feature id (${String(geometry?.id)}) — the re-key did not run`);
    }
    if (!isAlpha2Code(geometry.id)) {
      fail("topology", `has a feature with an invalid country code (got "${geometry.id}") — must be ISO alpha-2`);
    }
  }

  if (!Array.isArray(raw.points)) fail("points", "is not an array");
  const points = raw.points.map((entry, index): GlobePoint => {
    if (
      !isRecord(entry) ||
      typeof entry.code !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.lon !== "number" ||
      typeof entry.lat !== "number"
    ) {
      fail(`points[${index}]`, "is not { code, name, lon, lat }");
    }
    if (!entry.code) {
      fail(`points[${index}]`, "code is empty");
    }
    if (!isAlpha2Code(entry.code)) {
      fail(`points[${index}]`, `code is invalid (got "${entry.code}") — must be ISO alpha-2`);
    }
    if (!Number.isFinite(entry.lon)) {
      fail(`points[${index}]`, `lon is not finite (got ${entry.lon})`);
    }
    if (!Number.isFinite(entry.lat)) {
      fail(`points[${index}]`, `lat is not finite (got ${entry.lat})`);
    }
    return { code: entry.code, name: entry.name, lon: entry.lon, lat: entry.lat };
  });

  return { topology: topology as unknown as Topology, points };
}

/** Fetches and validates the asset. Callers mount this lazily. */
export async function fetchGlobeTopology(signal?: AbortSignal): Promise<GlobeTopology> {
  const response = await fetch(GLOBE_TOPOLOGY_PATH, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`globe topology ${response.status}`);
  return parseGlobeTopology(await response.json());
}
