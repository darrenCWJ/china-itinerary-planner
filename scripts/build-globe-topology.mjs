#!/usr/bin/env node
/**
 * build-globe-topology.mjs
 *
 * Builds public/world-globe.json — the coarse topology the orthographic globe
 * draws — from world-atlas 110m.
 *
 * Why a second asset at all: rotation is not an affine transform, so every
 * frame re-projects every feature, and the CSS-transform trick that makes the
 * flat map's zoom free does not apply. Measured in a production build with
 * every node mounted: 110m runs at p50 8.7ms / p95 13.1ms; the committed 50m
 * asset runs at p50 46.9ms / p95 60.6ms, or 21fps. Resolution is the binding
 * constraint, not the render target.
 *
 * WHY THIS IS NOT A COPY OF build-world-topology.mjs
 *
 * That script derives its point layer from whatever topology it is handed. Run
 * against 110m it emits 14 points instead of 76, because the 61 countries 110m
 * omits have no feature to take a centroid from — so the asset would reach 174
 * codes instead of 235, and Singapore, Malta, Hong Kong, Macau and 57 others
 * would vanish from the picker. It would not even fail loudly: the file parses
 * and renders 174 perfectly good controls.
 *
 * So the dependency runs the other way. public/world-countries.json (50m) is
 * the coverage source of truth and a build-time INPUT here; its point layer is
 * carried over, unioned with any 110m-only point, and the run aborts unless
 * polygons and points together reach every code the 50m asset draws.
 *
 * Run manually, after build-world-topology.mjs; the output is committed.
 *
 * Usage: node scripts/build-globe-topology.mjs
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  EXPECTED_UNKEYED,
  buildSmallCountries,
  rekeyGeometries,
} from './build-world-topology.mjs';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(ROOT_DIR, 'public', 'world-globe.json');
const REPORT_PATH = join(ROOT_DIR, 'data', 'world-globe-report.md');
const WORLD_PATH = join(ROOT_DIR, 'public', 'world-countries.json');

/** Pinned to the major, exactly as the 50m build pins its own source. */
const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const SOURCE_LICENSE = 'Public domain (Natural Earth 1:110m, via world-atlas@2)';

const FETCH_TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

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
            'public/world-globe.json stands — do not hand-write one.',
          { cause: error },
        );
      }
      console.warn(`  fetch failed (${error.message}); retrying`);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * The globe's point layer: every 50m point, plus any point 110m generalises
 * below the size threshold that 50m does not.
 *
 * A union rather than a straight copy because the two resolutions disagree in
 * both directions. TL is 110m-only (110m simplifies it under 15,000 km²); BS
 * and FK are 50m-only and keep real 110m polygons, which costs nothing — a
 * country with both a polygon and a point is the normal case for all 76 of
 * them on the flat map today.
 */
export function buildGlobePoints(small50, small110) {
  const seen = new Set(small50.map((p) => p.code));
  return [...small50, ...small110.filter((p) => !seen.has(p.code))].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

/**
 * The abort gate. One-way: the globe may reach more countries than the flat
 * map, never fewer.
 *
 * The single check that would have caught the naive build. Expressed as a set
 * operation rather than as the 50m script's four literal codes
 * ('SG','MT','MV','BH') precisely because the failure is not limited to four —
 * it is 61 today, and a future upstream could make it a different 61.
 */
export function assertCoverage(polygonCodes, pointCodes, referenceCodes) {
  const reachable = new Set([...polygonCodes, ...pointCodes]);
  const missing = [...referenceCodes].filter((code) => !reachable.has(code)).sort();
  if (missing.length > 0) {
    throw new Error(
      `the globe cannot reach ${missing.length} countries the flat map draws: ` +
        `${missing.join(', ')}. The point layer must carry every code 110m omits — ` +
        'do not recompute it from the 110m topology.',
    );
  }
}

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, content);
    // rmSync before rename, matching scripts/ingest-airports.mjs: renaming
    // onto an existing path is not reliably atomic on Windows, which is this
    // project's development platform.
    rmSync(path, { force: true });
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function buildReport(stats) {
  return [
    '# World globe topology',
    '',
    `- Source: ${SOURCE_URL}`,
    `- Licence: ${SOURCE_LICENSE}`,
    `- Generated: ${stats.generated}`,
    '',
    '## Coverage',
    '',
    `- Polygons drawn at 110m: **${stats.polygons}**`,
    `- Point-layer countries: **${stats.points}**`,
    `- Reachable codes (polygons union points): **${stats.reachable}**`,
    `- Codes the 50m flat map draws: **${stats.reference}**`,
    `- Codes 110m omits, carried as points: **${stats.carried}**`,
    '',
    'The globe reaches every country the flat map does, but gets there',
    'differently: 110m carries no feature at all for the codes below, so their',
    'point is the only thing that makes them selectable. On the flat map every',
    'point-layer country also has a polygon underneath it; on the globe most do',
    'not. That is why `lib/globeTopology.ts` exists rather than reusing',
    '`lib/isoTopology.ts`, whose contract asserts the opposite.',
    '',
    '```',
    stats.carriedCodes.join(' '),
    '```',
    '',
    '## Size',
    '',
    `- Raw: ${stats.kb} KB`,
    '',
  ].join('\n');
}

async function main() {
  if (!existsSync(WORLD_PATH)) {
    throw new Error(
      `${WORLD_PATH} is missing. The globe is built against the 50m asset's ` +
        'coverage — run `node scripts/build-world-topology.mjs` first.',
    );
  }
  const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));
  const referenceCodes = new Set(
    world.topology.objects.countries.geometries
      .map((g) => g.id)
      .filter((id) => typeof id === 'string'),
  );
  console.log(
    `  50m reference: ${referenceCodes.size} countries, ${world.smallCountries.length} points`,
  );

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
        'EXPECTED_UNKEYED in build-world-topology.mjs.',
    );
  }
  console.log(`  dropped ${unkeyed.length} unkeyed feature(s): ${unkeyed.join(', ')}`);

  const topology = {
    type: 'Topology',
    bbox: source.bbox,
    transform: source.transform,
    objects: { countries: { type: 'GeometryCollection', geometries } },
    arcs: source.arcs,
  };

  const codes = geometries.map((g) => g.id);
  if (new Set(codes).size !== codes.length) {
    throw new Error('duplicate alpha-2 ids survived the merge');
  }
  if (geometries.find((g) => g.id === 'AU')?.properties.name !== 'Australia') {
    throw new Error('AU kept the wrong name — check the merge order');
  }

  const points = buildGlobePoints(world.smallCountries, buildSmallCountries(topology));
  const polygonCodes = new Set(codes);
  const pointCodes = new Set(points.map((p) => p.code));

  // Aborts before writing. A globe asset that is merely smaller is not a
  // degraded map — it is a map that silently cannot select 61 countries.
  assertCoverage(polygonCodes, pointCodes, referenceCodes);

  const generated = new Date().toISOString().slice(0, 10);
  const payload = { version: 1, source: SOURCE_URL, license: SOURCE_LICENSE, generated, topology, points };
  const json = JSON.stringify(payload);
  writeFileAtomic(OUT_PATH, json);

  const carriedCodes = [...referenceCodes].filter((c) => !polygonCodes.has(c)).sort();
  writeFileAtomic(
    REPORT_PATH,
    buildReport({
      generated,
      polygons: polygonCodes.size,
      points: points.length,
      reachable: new Set([...polygonCodes, ...pointCodes]).size,
      reference: referenceCodes.size,
      carried: carriedCodes.length,
      carriedCodes,
      kb: (json.length / 1024).toFixed(0),
    }),
  );

  console.log(
    `Wrote ${OUT_PATH}\n` +
      `  ${polygonCodes.size} polygons, ${points.length} points, ` +
      `${new Set([...polygonCodes, ...pointCodes]).size} reachable, ` +
      `${(json.length / 1024).toFixed(0)} KB`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nbuild-globe-topology failed: ${error.message}`);
    process.exitCode = 1;
  });
}
