#!/usr/bin/env node
/**
 * build-world-topology.mjs
 *
 * Builds public/world-countries.json — the world map's country boundaries,
 * keyed by ISO 3166-1 alpha-2.
 *
 * Source: world-atlas 50m, a public-domain Natural Earth 1:50m derivative that
 * already ships as quantised TopoJSON. Nothing here processes shapefiles and no
 * new runtime dependency is introduced: d3-geo and topojson-client are already
 * dependencies, used by the existing China map.
 *
 * Not 110m. At that resolution Singapore, Malta, Maldives and Bahrain — prime
 * destinations — are absent or sub-pixel, and Hong Kong and Macau carry no ISO
 * id. 50m has all six.
 *
 * Run manually; the output is committed, exactly like public/china-provinces.json.
 * The asset changes only when this script or its upstream does, so making it a
 * build step would put a network fetch on every CI run for a file that almost
 * never moves.
 *
 * Usage: node scripts/build-world-topology.mjs
 *
 * Two harmless notes on that command. It reads the numeric→alpha-2 table
 * straight out of lib/countries.ts, relying on Node's native type stripping
 * (stable since Node 22.18 / 24) so the table has exactly one definition rather
 * than a copy here that could drift. Node prints a MODULE_TYPELESS_PACKAGE_JSON
 * warning for that import because package.json has no `"type": "module"`; the
 * import still works and the warning is not worth changing the package's module
 * type for.
 */

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoCentroid } from 'd3-geo';
import { feature } from 'topojson-client';
import { ISO_NUMERIC_TO_ALPHA2 } from '../lib/countries.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT_DIR, 'public', 'world-countries.json');

/**
 * Pinned to the major so a republished patch cannot silently reshape the asset,
 * while a genuine upstream fix still arrives on a deliberate re-run.
 */
const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
const SOURCE_LICENSE = 'Public domain (Natural Earth 1:50m, via world-atlas@2)';

const FETCH_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

/** Mean Earth surface area / 4π — converts d3's steradians to km². */
const KM2_PER_STERADIAN = 510_072_000 / (4 * Math.PI);

/**
 * Countries below this get a point in addition to their polygon.
 *
 * A rendering judgement, not a fact: at 15,000 km² a country is roughly three
 * pixels across on a 1000px-wide world map, well under the 44px tap minimum, so
 * the polygon alone is not a target. Expressed in km² rather than steradians
 * because that is the number a reviewer can sanity-check. The four the spec
 * names sit far inside it — Maldives 67, Malta 276, Singapore 484, Bahrain 544.
 * Retuning this is a re-run of this script, nothing more.
 */
const SMALL_COUNTRY_MAX_KM2 = 15_000;

/**
 * Feature ids Natural Earth leaves unset, which therefore cannot be re-keyed.
 * Listed so the run can assert it dropped exactly these and no more — a new
 * unkeyed feature appearing upstream should stop the build, not vanish quietly.
 * Their ISO counterparts, where any exist, are documented in lib/isoTopology's
 * SEARCH_ONLY.
 */
const EXPECTED_UNKEYED = [
  'Indian Ocean Ter.',
  'Kosovo',
  'N. Cyprus',
  'Siachen Glacier',
  'Somaliland',
];

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSource() {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(SOURCE_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'ChinaItineraryPlanner/1.0 (personal project)' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw new Error(
          `could not download ${SOURCE_URL}: ${error.message}. ` +
            'The asset is committed, so a blocked network means the existing ' +
            'public/world-countries.json stands — do not hand-write one.',
          { cause: error },
        );
      }
      console.warn(`  fetch failed (${error.message}); retrying`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// ---------------------------------------------------------------------------
// Re-key
// ---------------------------------------------------------------------------

/**
 * Re-keys country geometries from ISO numeric to alpha-2, merging any that
 * resolve to the same country.
 *
 * The merge is not hypothetical: Natural Earth ships "Ashmore and Cartier Is."
 * with id 036, the same numeric ISO assigns to Australia, because ISO treats it
 * as Australian territory. Keying naively would produce two features both called
 * AU and let whichever came second win — Australia replaced by two uninhabited
 * sand cays. Merging into one MultiPolygon keeps both shapes under one code.
 */
function rekeyGeometries(geometries) {
  const byCode = new Map();
  const unkeyed = [];

  for (const geometry of geometries) {
    if (typeof geometry.id !== 'string') {
      unkeyed.push(geometry.properties?.name ?? '(unnamed)');
      continue;
    }
    const code = ISO_NUMERIC_TO_ALPHA2[geometry.id];
    if (!code) {
      throw new Error(
        `numeric id ${geometry.id} (${geometry.properties?.name}) is not in ` +
          'ISO_NUMERIC_TO_ALPHA2 — add it in lib/countries.ts',
      );
    }

    // Properties are stripped to the name: it is the only one upstream carries
    // that the app uses, and lib/countries owns display names anyway.
    const next = {
      type: geometry.type,
      arcs: geometry.arcs,
      id: code,
      properties: { name: geometry.properties?.name ?? code },
    };

    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, next);
      continue;
    }
    byCode.set(code, mergeGeometry(existing, next));
  }

  return { geometries: [...byCode.values()], unkeyed };
}

/** Polygon rings and MultiPolygon members are the same arc lists one level down. */
function polygonList(geometry) {
  if (geometry.type === 'Polygon') return [geometry.arcs];
  if (geometry.type === 'MultiPolygon') return geometry.arcs;
  throw new Error(`cannot merge geometry of type ${geometry.type}`);
}

function mergeGeometry(a, b) {
  // The larger name wins nothing here — the first-seen name is kept, and for the
  // one real collision (AU) upstream orders Australia first. Asserted below.
  return {
    type: 'MultiPolygon',
    arcs: [...polygonList(a), ...polygonList(b)],
    id: a.id,
    properties: a.properties,
  };
}

// ---------------------------------------------------------------------------
// Point layer
// ---------------------------------------------------------------------------

function buildSmallCountries(topology) {
  const collection = feature(topology, topology.objects.countries);
  const small = [];

  for (const f of collection.features) {
    const km2 = geoArea(f) * KM2_PER_STERADIAN;
    if (km2 > SMALL_COUNTRY_MAX_KM2) continue;
    const [lon, lat] = geoCentroid(f);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`no centroid for ${f.id} (${f.properties?.name})`);
    }
    small.push({
      code: f.id,
      name: f.properties?.name ?? f.id,
      lon: Number(lon.toFixed(3)),
      lat: Number(lat.toFixed(3)),
    });
  }

  small.sort((a, b) => a.code.localeCompare(b.code));
  return small;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Downloading ${SOURCE_URL}`);
  const source = await fetchSource();
  if (!source?.objects?.countries) {
    throw new Error('source is not a world-atlas countries topology');
  }

  const { geometries, unkeyed } = rekeyGeometries(source.objects.countries.geometries);

  const unexpected = unkeyed.filter((name) => !EXPECTED_UNKEYED.includes(name));
  if (unexpected.length) {
    throw new Error(
      `upstream gained features with no ISO id: ${unexpected.join(', ')}. ` +
        'Decide whether each belongs in SEARCH_ONLY, then add it to ' +
        'EXPECTED_UNKEYED here.',
    );
  }
  console.log(`  dropped ${unkeyed.length} unkeyed feature(s): ${unkeyed.join(', ')}`);

  // `land` is a second rendering of the same arcs and nothing consumes it.
  // Dropping it is the whole of the "strip unneeded properties" win, since the
  // arcs themselves are shared and stay.
  const topology = {
    type: 'Topology',
    bbox: source.bbox,
    transform: source.transform,
    objects: {
      countries: { type: 'GeometryCollection', geometries },
    },
    arcs: source.arcs,
  };

  const smallCountries = buildSmallCountries(topology);

  // Cheap invariants that would each have shipped a broken map. They mirror
  // lib/isoTopology.test.ts so a bad run fails here rather than in CI.
  const codes = geometries.map((g) => g.id);
  if (new Set(codes).size !== codes.length) throw new Error('duplicate alpha-2 ids survived the merge');
  if (geometries.find((g) => g.id === 'AU')?.properties.name !== 'Australia') {
    throw new Error('AU kept the wrong name — check the merge order');
  }
  for (const code of ['SG', 'MT', 'MV', 'BH']) {
    if (!smallCountries.some((s) => s.code === code)) {
      throw new Error(`${code} fell outside the point layer — raise SMALL_COUNTRY_MAX_KM2`);
    }
  }

  const payload = {
    version: 1,
    source: SOURCE_URL,
    license: SOURCE_LICENSE,
    generated: new Date().toISOString().slice(0, 10),
    smallCountryMaxKm2: SMALL_COUNTRY_MAX_KM2,
    topology,
    smallCountries,
  };

  // Atomic write, matching scripts/ingest-destinations.mjs: a killed run must
  // not leave a truncated asset that parses as valid JSON.
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const temp = `${OUT_PATH}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(payload));
    renameSync(temp, OUT_PATH);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }

  console.log(
    `Wrote ${OUT_PATH}\n` +
      `  ${geometries.length} countries, ${smallCountries.length} points, ` +
      `${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`,
  );
}

main().catch((error) => {
  console.error(`\nbuild-world-topology failed: ${error.message}`);
  process.exitCode = 1;
});
