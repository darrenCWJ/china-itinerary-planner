/**
 * sample-climate-anchors.mjs
 *
 * Regenerates `data/climate-anchors.json`: the CHELSA rows the fit model in
 * `lib/climateModel.ts` is calibrated and tested against, sampled from the
 * cached rasters with the same three pure functions the real ingest uses.
 *
 *     node scripts/sample-climate-anchors.mjs
 *
 * Why a fixture exists at all: spec §9.5's calibration set is the curated
 * China table (`REGION_MONTHS` in lib/months.ts), whose nine anchors are
 * `Q`-prefixed catalog cities. The climate artifact is keyed on `G`-prefixed
 * GeoNames ids and none of the nine is in it, so the key spaces do not meet.
 * This script bridges them the only way they can be bridged — by sampling the
 * anchors' coordinates directly — and commits the result so the model's tests
 * run in milliseconds against nineteen rows rather than against 10 GB of
 * rasters nobody else has cached.
 *
 * It downloads nothing. Every raster must already be in `CIP_CHELSA_CACHE`
 * (else `<tmpdir>/cip-chelsa`), and each is checked before it is trusted: the
 * January files byte-for-byte against the sizes `data/climate-probe.md`
 * recorded, and every file structurally — it must open as a TIFF, its
 * geometry must match its variable's family, and its LAST strip must decode,
 * which a truncated download cannot.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fromFile } from 'geotiff';

import { decodeSample, pixelFor, tupleFor } from './ingest-climate.mjs';

/** Resolved from this file, never `process.cwd()` — see build-provinces.mjs. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CITY_DIR = join(REPO_ROOT, 'public', 'cities');
const OUT_PATH = join(REPO_ROOT, 'data', 'climate-anchors.json');
const CACHE_DIR = process.env.CIP_CHELSA_CACHE || join(tmpdir(), 'cip-chelsa');

/**
 * What goes in the committed fixture's `cache` field. The RESOLVED
 * `CACHE_DIR` must not: it is one machine's absolute path (a home directory,
 * a username), it changes the artifact for every person who regenerates it,
 * and it tells a reader nothing the rule does not.
 */
const CACHE_DESCRIPTION = 'CIP_CHELSA_CACHE, else os.tmpdir()/cip-chelsa';

const SOURCE = 'CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228';

/** Block order of the 60-int tuple, and the fifth input that is never written. */
const VARIABLES = ['tasmin', 'tasmax', 'pr', 'clt', 'hurs'];
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const fileFor = (variable, month) => `CHELSA_${variable}_${month}_1981-2010_V.2.1.tif`;

/**
 * The only sizes the repo has on record, from `data/climate-probe.md`: the
 * four January rasters it downloaded, and `hurs`, whose header it range-read.
 */
const PROBED_JANUARY_BYTES = {
  tasmin: 115_680_174,
  tasmax: 114_438_763,
  pr: 229_542_124,
  clt: 60_474_540,
  hurs: 361_353_211,
};

// ---------------------------------------------------------------------------
// The cities
// ---------------------------------------------------------------------------

/**
 * §9.5's nine region–anchor pairs, one row per anchor. Coordinates are the
 * catalog's own (`data/catalog.json`, the `Q`-prefixed rows) — the spec's key
 * space. Six of the nine also exist as curated destinations in lib/data and
 * differ from these by under 0.05°; Dunhuang, Wuhan and a standalone Kunming
 * do not, which is why one source is used for all nine.
 *
 * Neither the catalog nor the curated destinations carry an elevation, so the
 * anchors' are hard-coded from Wikipedia's city infobox "Elevation" field
 * (read 2026-09-04). Fix 4's correction is what they feed, and it is only
 * material for the two highland anchors, Kunming and Dunhuang.
 *
 * `role` decides what this script PRINTS. The protocol in spec §9.4 forbids
 * inspecting the four holdout regions while tuning, so the holdout anchors'
 * rows go to the fixture and nowhere else.
 */
const ANCHORS = [
  { key: 'shanghai', name: 'Shanghai', region: 'East', role: 'tuning', id: 'Q8686', lat: 31.2325, lon: 121.469166666, elev: 4 },
  { key: 'xian', name: "Xi'an", region: 'Northwest', role: 'tuning', id: 'Q5826', lat: 34.261111111, lon: 108.942222222, elev: 405 },
  { key: 'dunhuang', name: 'Dunhuang', region: 'Northwest', role: 'tuning', id: 'Q319114', lat: 40.141111111, lon: 94.663888888, elev: 1142 },
  { key: 'wuhan', name: 'Wuhan', region: 'Central', role: 'tuning', id: 'Q11746', lat: 30.595, lon: 114.2975, elev: 37 },
  { key: 'beijing', name: 'Beijing', region: 'North', role: 'holdout', id: 'Q956', lat: 39.90403, lon: 116.407526, elev: 44 },
  { key: 'harbin', name: 'Harbin', region: 'Northeast', role: 'holdout', id: 'Q42956', lat: 45.75, lon: 126.633333333, elev: 150 },
  { key: 'guangzhou', name: 'Guangzhou', region: 'South', role: 'holdout', id: 'Q16572', lat: 23.13, lon: 113.26, elev: 21 },
  { key: 'chengdu', name: 'Chengdu', region: 'Southwest', role: 'holdout', id: 'Q30002', lat: 30.66, lon: 104.063333333, elev: 500 },
  { key: 'kunming', name: 'Kunming', region: 'Southwest', role: 'holdout', id: 'Q182852', lat: 25.043333333, lon: 102.706111111, elev: 1892 },
];
const ANCHOR_ELEVATION_SOURCE = 'Wikipedia city infobox, Elevation, read 2026-09-04';

/**
 * The symptom cities §9.4's four fixes are named after, plus the two the
 * brief's other tests need. Coordinates and `elev` come from the committed
 * `G` shards, read at run time so the fixture cannot drift from the catalog
 * without this script noticing. Tromsø is here for its `elev: null`.
 */
const SYMPTOMS = [
  { key: 'lima', cc: 'PE', id: 'G3936456', why: 'fix 1: garúa cloud with ~3 mm/month year-round' },
  { key: 'tokyo', cc: 'JP', id: 'G1850147', why: 'fix 2: hurs biased low, July read great' },
  { key: 'nairobi', cc: 'KE', id: 'G184745', why: 'fix 3: two rain maxima, Apr and Nov' },
  { key: 'mombasa', cc: 'KE', id: 'G186301', why: 'fix 3: second Kenyan cycle, coastal' },
  { key: 'kisumu', cc: 'KE', id: 'G191245', why: 'fix 3: third Kenyan cycle, lakeside' },
  { key: 'cusco', cc: 'PE', id: 'G3941584', why: 'fix 4: 3,312 m, Jun-Aug must be reachable as great' },
  { key: 'iquitos', cc: 'PE', id: 'G3696183', why: 'fix 2/3: hurs 72% vs ~85% observed; ~330 mm/month' },
  { key: 'oslo', cc: 'NO', id: 'G3143244', why: 'Norway January is never great' },
  { key: 'bergen', cc: 'NO', id: 'G3161732', why: 'Norway January is never great' },
  { key: 'tromso', cc: 'NO', id: 'G3133895', why: 'Norway January is never great; elev is null' },
];

function readShardRow(cc, id) {
  const shard = JSON.parse(readFileSync(join(CITY_DIR, `${cc}.json`), 'utf8'));
  const row = shard.cities.find((city) => city.id === id);
  if (!row) throw new Error(`${cc}.json has no row ${id}`);
  return row;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * `GDAL_METADATA` is a deferred field in geotiff 3: reading it as a property
 * yields `undefined` in silence, and the synchronous `getValue` throws. It has
 * to be `loadValue`d — the trap `data/climate-probe.md` records.
 */
async function tagText(directory, name) {
  if (!directory.hasTag(name)) return null;
  const value = await directory.loadValue(name);
  if (typeof value === 'string') return value.replace(/\0+$/, '');
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return Buffer.from(Array.from(value)).toString('latin1').replace(/\0+$/, '');
  }
  return null;
}

async function tagScalar(directory, name) {
  if (!directory.hasTag(name)) return null;
  const value = await directory.loadValue(name);
  return ArrayBuffer.isView(value) || Array.isArray(value) ? Array.from(value) : value;
}

/** GDAL's convention: `real = raw * SCALE + OFFSET`, both in GDAL_METADATA. */
function scalingFrom(gdalMetadata, gdalNoData) {
  const item = (role) => {
    const match = new RegExp(`role="${role}"[^>]*>([^<]+)<`).exec(gdalMetadata ?? '');
    return match ? Number(match[1]) : null;
  };
  const scale = item('scale');
  const offset = item('offset');
  if (scale === null || offset === null || !Number.isFinite(scale) || !Number.isFinite(offset)) {
    throw new Error(`raster declares no usable scale/offset in GDAL_METADATA: ${gdalMetadata}`);
  }
  const nodata = gdalNoData === null || gdalNoData === '' ? null : Number(gdalNoData);
  return { scale, offset, nodata: Number.isFinite(nodata) ? nodata : null };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Opens one raster, verifies it, and samples every city on it. Returns the
 * per-city raw values plus everything worth recording about the file.
 *
 * `sweep` is only asked for on `hurs`: the probe never sampled that variable,
 * so its observed range is unknown, and Task 6 needs it. Every row a city
 * lands on is swept whole (43,200 cells) rather than only the city's cell.
 */
async function sampleRaster(variable, month, cities, expectedGeometry, { sweep = false } = {}) {
  const file = fileFor(variable, month);
  const path = join(CACHE_DIR, file);
  if (!existsSync(path)) throw new Error(`${file} is not in the cache (${CACHE_DIR}); this script downloads nothing`);
  const bytes = statSync(path).size;
  if (month === '01' && bytes !== PROBED_JANUARY_BYTES[variable]) {
    throw new Error(`${file}: ${bytes} B on disk, data/climate-probe.md recorded ${PROBED_JANUARY_BYTES[variable]} B`);
  }

  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0);
    const width = image.getWidth();
    const height = image.getHeight();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    // `pixelFor` counts rows downward from `originY` itself, so `resY` must be
    // a magnitude; geotiff reports it negative for a north-up raster.
    const grid = { width, height, originX, originY, resX: Math.abs(resX), resY: Math.abs(resY) };
    if (expectedGeometry && (width !== expectedGeometry.width || height !== expectedGeometry.height)) {
      throw new Error(`${file}: ${width}x${height}, expected ${expectedGeometry.width}x${expectedGeometry.height}`);
    }

    const directory = image.getFileDirectory();
    const scaling = scalingFrom(await tagText(directory, 'GDAL_METADATA'), await tagText(directory, 'GDAL_NODATA'));
    const bitsPerSample = await tagScalar(directory, 'BitsPerSample');
    const sampleFormat = await tagScalar(directory, 'SampleFormat');

    // A truncated download fails here, deep in the last deflate block, and
    // nowhere earlier.
    await image.readRasters({ window: [0, height - 1, 1, height] });

    const raw = [];
    const swept = { cells: 0, min: Infinity, max: -Infinity, atNodata: 0 };
    for (const city of cities) {
      const pixel = pixelFor(city.lon, city.lat, grid);
      if (!pixel) throw new Error(`${city.name} is off ${file}`);
      const window = sweep ? [0, pixel.y, width, pixel.y + 1] : [pixel.x, pixel.y, pixel.x + 1, pixel.y + 1];
      const rasters = await image.readRasters({ window });
      const band = rasters[0];
      raw.push(sweep ? band[pixel.x] : band[0]);
      if (sweep) {
        for (let k = 0; k < band.length; k += 1) {
          const v = band[k];
          if (v === scaling.nodata) swept.atNodata += 1;
          if (v < swept.min) swept.min = v;
          if (v > swept.max) swept.max = v;
        }
        swept.cells += band.length;
      }
    }

    return {
      file,
      bytes,
      geometry: { width, height, originX, originY, resX: grid.resX, resY: grid.resY },
      bitsPerSample,
      sampleFormat,
      scaling,
      raw,
      swept: sweep ? swept : null,
    };
  } finally {
    await tiff.close();
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Pretty JSON, except that an array of numbers stays on one line: a 60-int
 * row printed one integer per line is unreadable and un-diffable.
 */
function serialise(value) {
  return `${JSON.stringify(value, null, 2).replace(
    /\[\n\s+(-?\d+(?:\.\d+)?(?:,\n\s+-?\d+(?:\.\d+)?)*)\n\s+\]/g,
    (_, body) => `[${body.replace(/,\n\s+/g, ', ')}]`,
  )}\n`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function printRow(city) {
  const block = (i) => city.row.slice(12 * i, 12 * i + 12);
  console.log(`\n${city.name} (${city.id}) ${city.lat}, ${city.lon}, elev ${city.elev}`);
  console.log(`          ${MONTH_NAMES.map((m) => m.padStart(5)).join('')}`);
  for (const [label, i] of [['lo', 0], ['hi', 1], ['precip', 2], ['cloud', 3], ['td', 4]]) {
    console.log(`  ${label.padEnd(8)}${block(i).map((v) => String(v).padStart(5)).join('')}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = performance.now();
  const cities = [
    ...ANCHORS.map((a) => ({ ...a, elevSource: ANCHOR_ELEVATION_SOURCE })),
    ...SYMPTOMS.map((s) => {
      const row = readShardRow(s.cc, s.id);
      return {
        key: s.key,
        name: row.n,
        region: null,
        role: 'symptom',
        id: s.id,
        lat: row.lat,
        lon: row.lon,
        elev: row.elev,
        elevSource: `public/cities/${s.cc}.json`,
        why: s.why,
      };
    }),
  ];
  console.log(`cache: ${CACHE_DIR}`);
  console.log(`cities: ${cities.length} (${ANCHORS.length} anchors, ${SYMPTOMS.length} symptom cities)`);

  // samples[variable][month] = { raw[], ... }
  const samples = {};
  const rasters = [];
  const geometryByVariable = {};
  let hursSweep = { cells: 0, min: Infinity, max: -Infinity, atNodata: 0 };
  for (const variable of VARIABLES) {
    samples[variable] = [];
    for (const month of MONTHS) {
      const sample = await sampleRaster(variable, month, cities, geometryByVariable[variable], { sweep: variable === 'hurs' });
      geometryByVariable[variable] ??= sample.geometry;
      samples[variable].push(sample);
      rasters.push({ file: sample.file, bytes: sample.bytes, scale: sample.scaling.scale, offset: sample.scaling.offset, nodata: sample.scaling.nodata });
      if (sample.swept) {
        hursSweep = {
          cells: hursSweep.cells + sample.swept.cells,
          min: Math.min(hursSweep.min, sample.swept.min),
          max: Math.max(hursSweep.max, sample.swept.max),
          atNodata: hursSweep.atNodata + sample.swept.atNodata,
        };
      }
    }
    const first = samples[variable][0];
    const g = first.geometry;
    console.log(
      `${variable}: 12 files, ${g.width}x${g.height}, origin ${g.originX}, ${g.originY}, res ${g.resX}` +
        `, bps ${first.bitsPerSample} fmt ${first.sampleFormat}` +
        `, scale ${first.scaling.scale} offset ${first.scaling.offset} nodata ${first.scaling.nodata}`,
    );
    const scalings = new Set(samples[variable].map((s) => JSON.stringify(s.scaling)));
    if (scalings.size !== 1) throw new Error(`${variable}: scaling differs between months: ${[...scalings].join(' ')}`);
  }

  // Decode, then tuple, per city — exactly what Task 6 will do per city.
  const hursCity = { min: Infinity, max: -Infinity };
  for (let i = 0; i < cities.length; i += 1) {
    const decoded = {};
    for (const variable of VARIABLES) {
      decoded[variable] = samples[variable].map((sample) => decodeSample(sample.raw[i], sample.scaling));
    }
    for (const value of decoded.hurs) {
      if (value === null) continue;
      hursCity.min = Math.min(hursCity.min, value);
      hursCity.max = Math.max(hursCity.max, value);
    }
    const row = tupleFor(decoded);
    if (row === null) throw new Error(`${cities[i].name}: tupleFor returned null — a month is nodata or non-finite`);
    cities[i].row = row;
  }

  const hursScaling = samples.hurs[0].scaling;
  const hurs = {
    geometry: geometryByVariable.hurs,
    bitsPerSample: samples.hurs[0].bitsPerSample,
    sampleFormat: samples.hurs[0].sampleFormat,
    declaredNodata: hursScaling.nodata,
    scale: hursScaling.scale,
    offset: hursScaling.offset,
    sweptRows: { cells: hursSweep.cells, rawMin: hursSweep.min, rawMax: hursSweep.max, cellsAtDeclaredNodata: hursSweep.atNodata },
    sweptRowsPct: { min: hursSweep.min * hursScaling.scale + hursScaling.offset, max: hursSweep.max * hursScaling.scale + hursScaling.offset },
    cityPct: { min: hursCity.min, max: hursCity.max },
  };
  console.log(
    `\nhurs: declared nodata ${hurs.declaredNodata}, scale ${hurs.scale}, offset ${hurs.offset}` +
      `; swept ${hurs.sweptRows.cells} cells over the cities' rows: raw ${hurs.sweptRows.rawMin}..${hurs.sweptRows.rawMax}` +
      ` (${hurs.sweptRowsPct.min.toFixed(2)}..${hurs.sweptRowsPct.max.toFixed(2)} %), ${hurs.sweptRows.cellsAtDeclaredNodata} at nodata` +
      `; at the ${cities.length} cities ${hurs.cityPct.min.toFixed(2)}..${hurs.cityPct.max.toFixed(2)} %`,
  );

  const fixture = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/sample-climate-anchors.mjs',
    node: process.version,
    source: SOURCE,
    cache: CACHE_DESCRIPTION,
    layout: '60 ints: [12 lo C, 12 hi C, 12 precip mm/month, 12 cloud %, 12 td C], January at index 0 of every block; td is the UNCORRECTED Magnus dew point',
    anchorElevationSource: ANCHOR_ELEVATION_SOURCE,
    rasters,
    hurs,
    cities: cities.map((c) => ({
      key: c.key,
      name: c.name,
      role: c.role,
      region: c.region,
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      elev: c.elev,
      elevSource: c.elevSource,
      ...(c.why ? { why: c.why } : {}),
      row: c.row,
    })),
  };
  writeFileSync(OUT_PATH, serialise(fixture));
  console.log(`\nwrote ${OUT_PATH} (${statSync(OUT_PATH).size} B) in ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);

  // The holdout anchors are in the file and deliberately not on the screen.
  for (const city of cities) if (city.role !== 'holdout') printRow(city);
  console.log(`\n(${ANCHORS.filter((a) => a.role === 'holdout').length} holdout anchors written, not printed — spec §9.4)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nSampling failed: ${error.message}`);
    process.exit(1);
  });
}
