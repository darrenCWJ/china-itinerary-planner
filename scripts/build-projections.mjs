/**
 * The §5.4 projection rule: how each of the 246 countries is fitted into the
 * map viewport, and which of its outlying polygons may be left out of frame.
 *
 * Builds public/country-projections.json and data/projections-report.md from
 * the committed province files, whose units `merge()` into each country's
 * outline (spec §4.1) — so one artifact feeds both the fit and the drawing.
 *
 * Run by hand and the output committed:
 *
 *     node scripts/build-projections.mjs
 *
 * Modelled on build-provinces.mjs: every gate fires before any write, the pure
 * functions are exported for tests and the I/O is not, and an entry-point
 * guard keeps an import from rewriting the manifest.
 *
 * Two things about this file are load-bearing and neither is obvious:
 *
 * 1. **The viewport comes from lib/mapView.ts, never a literal.** The spec's
 *    own committed manifest was computed against 860x600 while the app renders
 *    into 860x620, so every scale in it is wrong by 3.3% and the build-time
 *    test §5.4 describes would fail on all of them.
 * 2. **d3-geo reads rings spherically.** A ring wound the other way is the
 *    globe MINUS the shape, which is why the fit uses a `MultiPoint` and never
 *    a `Polygon` rectangle (§5.5), and why `separation`'s fixtures have to be
 *    wound the way `merge()` winds real outlines.
 */

import { geoArea, geoBounds, geoCentroid, geoMercator } from 'd3-geo';
import { merge } from 'topojson-client';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { MAP_VIEW_H, MAP_VIEW_W } from '../lib/mapView.ts';

/**
 * The extent every scale is fitted to.
 *
 * Taken from the module the renderer takes it from, so the manifest and the
 * component can never disagree about how big the map is.
 */
export const VIEW_BOX = [[0, 0], [MAP_VIEW_W, MAP_VIEW_H]];

/** A longitude folded back into ±180. */
function norm(x) {
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

/**
 * Rule 1: the rotation that un-splits a country crossing the antimeridian.
 *
 * The largest gap between sorted longitudes is the empty arc, so the rest is
 * the minimal covering arc. Return 0 unless that arc crosses ±180 — §5.4's
 * rule 1 is that everyone else takes `rotate: 0` — and otherwise return the
 * negated centre, normalised, so the country lands on the prime meridian.
 *
 * Five countries take a non-zero rotation: FJ, KI, NZ, RU and US.
 */
export function rotationFor(polygons) {
  const lons = [];
  for (const polygon of polygons) for (const ring of polygon) for (const [lon] of ring) lons.push(lon);
  if (lons.length === 0) return 0;
  const sorted = lons.sort((a, b) => a - b);
  let gap = -1;
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 === sorted.length ? sorted[0] + 360 : sorted[i + 1];
    if (next - sorted[i] > gap) {
      gap = next - sorted[i];
      at = i;
    }
  }
  const start = sorted[(at + 1) % sorted.length];
  const span = 360 - gap;
  if (!(start <= 180 && start + span > 180)) return 0;
  return -norm(start + span / 2);
}

/**
 * One polygon's bbox in the ROTATED frame — computed once, reused everywhere.
 *
 * `lon + lambda` is normalised back into ±180 because it must be: rotating
 * Fiji by -178 sends its lon -179 vertex to -357, and the country reads as a
 * 357° span instead of a 3° one. The fit then collapses.
 */
export function boxOf(polygon, lambda) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const ring of polygon) {
    for (const [lon, lat] of ring) {
      const rx = norm(lon + lambda);
      if (rx < x0) x0 = rx;
      if (rx > x1) x1 = rx;
      if (lat < y0) y0 = lat;
      if (lat > y1) y1 = lat;
    }
  }
  return { x0, x1, y0, y1 };
}

/** The bbox covering a chosen subset of already-computed boxes. */
export function unionOf(boxes, indices) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const i of indices) {
    const b = boxes[i];
    if (b.x0 < x0) x0 = b.x0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y0 < y0) y0 = b.y0;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, x1, y0, y1 };
}

/**
 * The Mercator scale that fits a bbox into the viewport.
 *
 * Spec §5.5: three longitudes, two latitudes, as a MultiPoint. **Never a
 * Polygon rectangle** — d3-geo reads a ring spherically, so the rectangle is
 * read as the globe minus itself and every fit collapses to about
 * height / 2π. The middle longitude is what keeps the corner order unambiguous
 * as a span approaches 180°.
 *
 * The points are un-rotated (`x - lambda`) because the projection re-applies
 * the rotation; the bbox arrives already in the rotated frame.
 */
export function scaleOf(union, lambda, viewBox = VIEW_BOX) {
  const xm = (union.x0 + union.x1) / 2;
  const coordinates = [];
  for (const x of [union.x0, xm, union.x1]) {
    for (const y of [union.y0, union.y1]) coordinates.push([x - lambda, y]);
  }
  return geoMercator()
    .rotate([lambda, 0, 0])
    .fitExtent(viewBox, { type: 'MultiPoint', coordinates })
    .scale();
}

/**
 * Gate B, whose formula the spec never gives.
 *
 * §5.4 says "separation >= 0.5, measured from the polygon to the anchor" and
 * defines neither the measure nor the unit. Raw great-circle radians cannot be
 * it: Prince Edward Is. sits 0.356 rad from South Africa and the spec ACCEPTS
 * that trim.
 *
 * This is centroid separation in degrees normalised by the anchor's own bbox
 * diagonal — scale-free, so 0.5 means the same thing for Australia and for the
 * Netherlands. Recovered by treating the spec's published gains as an oracle:
 * on the 50m source the spec measured against, it reproduces NL, ZA, NC and
 * FJ, and it correctly refuses to hide Tasmania and Stewart Island, which are
 * the two cases §5.4 says the gate exists for.
 *
 * An anchor with no extent returns Infinity rather than dividing by zero.
 */
export function separation(anchorPolygon, polygon) {
  const [[ax0, ay0], [ax1, ay1]] = geoBounds({ type: 'Polygon', coordinates: anchorPolygon });
  const diagonal = Math.hypot(ax1 - ax0, ay1 - ay0);
  if (diagonal === 0) return Infinity;
  const a = geoCentroid({ type: 'Polygon', coordinates: anchorPolygon });
  const c = geoCentroid({ type: 'Polygon', coordinates: polygon });
  return Math.hypot(norm(c[0] - a[0]), c[1] - a[1]) / diagonal;
}

/** Floating-point slack for "this bbox edge IS the union's edge". */
const EPS = 1e-9;

/**
 * A ceiling on trimming, so a pathological country cannot loop for ever.
 * The deepest real trajectory that is accepted drops 7 polygons (FJ, TF).
 */
export const MAX_TRIM_STEPS = 40;

/**
 * Rule 2: every prefix of the greedy trim, best-first, with its cost.
 *
 * At each step the candidates are the polygons **driving the current extent** —
 * the ones whose bbox touches an edge of the union. That is what
 * "extent-driving" means, and it is also what makes this tractable: trying
 * every polygon is O(n²) over vertices and CA has 412 of them. **The
 * restriction is not lossy, and that was checked rather than assumed:** the
 * exhaustive every-polygon search was run to completion over all 246 countries
 * and returns the same nine accepted countries with identical gains, hidden
 * areas and scales to the digit.
 *
 * **The anchor is never a candidate.** Dropping it maximises scale trivially,
 * and ZA-without-South-Africa is Prince Edward Island at a 146× "gain".
 *
 * The WHOLE trajectory is returned and the caller picks the best point on it,
 * because a per-step gate loses the answer: NL's three Caribbean polygons each
 * gain ≈1.1× alone and 11.5× together.
 */
export function trimTrajectory(polygons, lambda, anchor, viewBox = VIEW_BOX) {
  const boxes = polygons.map((polygon) => boxOf(polygon, lambda));
  const all = polygons.map((_, i) => i);
  const areas = polygons.map((polygon) => geoArea({ type: 'Polygon', coordinates: polygon }));
  const total = areas.reduce((a, b) => a + b, 0);
  const base = scaleOf(unionOf(boxes, all), lambda, viewBox);

  const trajectory = [];
  const dropped = [];
  let keep = all.slice();
  let union = unionOf(boxes, keep);

  for (let step = 0; step < MAX_TRIM_STEPS && keep.length > 1; step++) {
    const driving = keep.filter((i) => i !== anchor && (
      Math.abs(boxes[i].x0 - union.x0) < EPS || Math.abs(boxes[i].x1 - union.x1) < EPS ||
      Math.abs(boxes[i].y0 - union.y0) < EPS || Math.abs(boxes[i].y1 - union.y1) < EPS));
    if (driving.length === 0) break;

    let pick = null;
    for (const i of driving) {
      const rest = keep.filter((j) => j !== i);
      const scale = scaleOf(unionOf(boxes, rest), lambda, viewBox);
      if (pick === null || scale > pick.scale) pick = { i, rest, scale };
    }

    keep = pick.rest;
    union = unionOf(boxes, keep);
    dropped.push(pick.i);
    trajectory.push({
      dropped: dropped.slice(),
      hidden: dropped.reduce((sum, i) => sum + areas[i], 0) / total,
      gain: pick.scale / base,
      // The MINIMUM over everything dropped so far, so one close-in polygon
      // cannot ride along on a set that is otherwise remote.
      sep: Math.min(...dropped.map((i) => separation(polygons[anchor], polygons[i]))),
      scale: pick.scale,
      union,
    });
  }

  return trajectory;
}
/* -------------------------------------------------------------------------
 * The entry: applying the rule to one country
 * ---------------------------------------------------------------------- */

/**
 * One country's manifest entry.
 *
 * `bounds` is in the ROTATED frame — the frame `rotate` puts the country in —
 * so a renderer that applies `rotate` and then fits `bounds` reproduces
 * `scale` exactly. `scale` is therefore redundant by construction, which is
 * the point: §5.4's build-time test recomputes it, and a manifest edited by
 * hand fails that test rather than quietly mis-fitting a country.
 *
 * `hiddenAreaPct` is a PERCENT, not a fraction, and is present only on the
 * countries a trim was actually applied to.
 *
 * @typedef {object} ProjectionEntry
 * @property {number} rotate
 * @property {number[][]} bounds
 * @property {number} scale
 * @property {number} [hiddenAreaPct]
 */

/**
 * The polygons of a merged outline, whichever shape `merge()` returned.
 *
 * `merge()` gives a MultiPolygon today, but a Polygon's `coordinates` are
 * RINGS, not polygons — passing them straight through would make a country
 * with one landmass and one lake look like two polygons, and hand the lake its
 * own centroid, its own area and a place in the trim trajectory.
 */
export function polygonsOf(merged) {
  return merged.type === 'MultiPolygon' ? merged.coordinates : [merged.coordinates];
}

/** Gate A: how much of a country may go out of frame. §5.4, as a fraction. */
export const MAX_HIDDEN_AREA = 0.01;

/** Gate B: how far a hidden polygon must sit from the anchor. See `separation`. */
export const MIN_SEPARATION = 0.5;

/** Gate C: how much bigger the country must draw before a trim is worth it. */
export const MIN_GAIN = 1.5;

/**
 * The best point on a trim trajectory that clears all three gates, or null.
 *
 * Best-over-the-whole-trajectory rather than first-passing, because a per-step
 * gate loses the answer: NL's three Caribbean polygons each gain about 1.1x
 * alone and 11.5x together, so every prefix but the last fails Gate C on its
 * way to a trim that passes it comfortably.
 *
 * @param {ReturnType<typeof trimTrajectory>} trajectory
 * @returns {ReturnType<typeof trimTrajectory>[number] | null}
 */
export function bestTrim(trajectory) {
  let best = null;
  for (const step of trajectory) {
    if (step.hidden > MAX_HIDDEN_AREA) continue;
    if (step.sep < MIN_SEPARATION) continue;
    if (step.gain < MIN_GAIN) continue;
    if (best === null || step.gain > best.gain) best = step;
  }
  return best;
}

/**
 * Coordinates and scales are stored to 4 dp.
 *
 * Not cosmetic: a country's bounds carry no meaning below about 11 m, and a
 * full double costs ~17 characters a number against ~8. Across 246 entries
 * that is the difference between a ~20 KB manifest and a ~50 KB one, for a
 * file every visitor downloads.
 */
const DP = 4;
const round = (x) => Number(x.toFixed(DP));

/** Square kilometres per steradian, for the report's hidden-area figures. */
const KM2_PER_STERADIAN = 510_072_000 / (4 * Math.PI);

/**
 * One country's entry, plus the measurements the report needs.
 *
 * The anchor is the largest polygon by area — the landmass the country
 * unmistakably IS. `trimTrajectory` never offers it as a candidate, because
 * dropping it maximises scale trivially and ZA-without-South-Africa is Prince
 * Edward Island at a 146x "gain".
 *
 * @returns {{ entry: ProjectionEntry, baseScale: number, trim: (ReturnType<typeof trimTrajectory>[number] | null), hiddenKm2: number[] }}
 */
export function measureCountry(polygons, viewBox = VIEW_BOX) {
  const lambda = rotationFor(polygons);
  const boxes = polygons.map((polygon) => boxOf(polygon, lambda));
  const base = unionOf(boxes, polygons.map((_, i) => i));
  const baseScale = scaleOf(base, lambda, viewBox);
  const untrimmed = {
    entry: {
      rotate: round(lambda),
      bounds: [[round(base.x0), round(base.y0)], [round(base.x1), round(base.y1)]],
      scale: round(baseScale),
    },
    baseScale,
    trim: null,
    hiddenKm2: [],
  };
  if (polygons.length < 2) return untrimmed;

  const areas = polygons.map((polygon) => geoArea({ type: 'Polygon', coordinates: polygon }));
  const anchor = areas.indexOf(Math.max(...areas));
  const trim = bestTrim(trimTrajectory(polygons, lambda, anchor, viewBox));
  if (trim === null) return untrimmed;

  return {
    entry: {
      rotate: round(lambda),
      bounds: [
        [round(trim.union.x0), round(trim.union.y0)],
        [round(trim.union.x1), round(trim.union.y1)],
      ],
      scale: round(trim.scale),
      // A percent, and to 3 dp: FR's trim hides 0.001% of France, and a 2 dp
      // field would round the only number that explains the entry to zero.
      hiddenAreaPct: Number((trim.hidden * 100).toFixed(3)),
    },
    baseScale,
    trim,
    hiddenKm2: trim.dropped.map((i) => Number((areas[i] * KM2_PER_STERADIAN).toFixed(1))),
  };
}

/* -------------------------------------------------------------------------
 * The gate
 * ---------------------------------------------------------------------- */

/**
 * One entry per committed province file, and the count is not a floor.
 *
 * A build that silently emitted 240 would ship a manifest whose six missing
 * countries fall back to a whole-world fit and look merely bad rather than
 * broken. If `build-provinces.mjs` ever emits a different number this must be
 * updated deliberately, by a human who has looked at why.
 */
export const EXPECTED_COUNTRIES = 246;

/**
 * Aborts the build unless every entry could actually be rendered.
 *
 * `scale` finite and positive is the load-bearing check — a NaN reaches
 * `fitExtent` from any non-finite bound and produces a blank map with no
 * error. Bounds ordering is checked too, because an inverted box does NOT
 * produce a NaN: it fits, silently, to a mirrored country.
 *
 * @param {Record<string, ProjectionEntry>} manifest
 */
export function assertManifest(manifest) {
  const codes = Object.keys(manifest).sort();
  if (codes.length !== EXPECTED_COUNTRIES) {
    throw new Error(
      `manifest has ${codes.length} entries, expected ${EXPECTED_COUNTRIES} — every country ` +
      `with a province file must have one, and the count is a match rather than a floor`
    );
  }
  const badScale = codes.filter((code) => {
    const scale = manifest[code].scale;
    return !Number.isFinite(scale) || scale <= 0;
  });
  if (badScale.length > 0) {
    throw new Error(
      `${badScale.length} entries with a scale that is not finite and positive: ` +
      badScale.map((code) => `${code} ${manifest[code].scale}`).join(', ')
    );
  }
  const badBounds = codes.filter((code) => {
    const [[x0, y0], [x1, y1]] = manifest[code].bounds;
    return ![x0, y0, x1, y1].every(Number.isFinite) || x1 < x0 || y1 < y0;
  });
  if (badBounds.length > 0) {
    throw new Error(
      `${badBounds.length} entries with non-finite or inverted bounds: ${badBounds.join(', ')} — ` +
      `fitExtent accepts an inverted box in silence and mirrors the country`
    );
  }
}

/* -------------------------------------------------------------------------
 * I/O
 * ---------------------------------------------------------------------- */

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROVINCE_DIR = join(ROOT_DIR, 'public', 'provinces');
const MANIFEST_PATH = join(ROOT_DIR, 'public', 'country-projections.json');
const REPORT_PATH = join(ROOT_DIR, 'data', 'projections-report.md');

/** A province file, as build-provinces.mjs names them. */
const PROVINCE_FILE = /^([A-Z]{2})\.json$/;

/**
 * Write via a PID-suffixed temp file, removing the destination first.
 *
 * Lifted from build-provinces.mjs unchanged: `rmSync` before `renameSync`
 * because renaming onto an existing path is not reliably atomic on Windows,
 * which is this project's dev platform, and the PID suffix because a bare
 * `.tmp` collides if two builds ever overlap.
 */
function writeFileAtomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, contents);
    rmSync(path, { force: true });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * The committed measurement record, in build-provinces.mjs's shape:
 * provenance, a `## Coverage` block of bolded counts, one paragraph for the
 * single consequence a reader would otherwise get wrong, and a `## Size` block.
 *
 * Every figure comes from the run that is writing the manifest, and the
 * timestamp from the same `now` — a second `new Date()` here would make the
 * report claim a build that never happened.
 */
function buildReport(stats) {
  const rows = [...stats.trimmed].sort((a, b) => b.gain - a.gain);
  const worst = rows.length === 0
    ? 'none'
    : `${Math.max(...rows.map((r) => r.hiddenAreaPct)).toFixed(3)}%`;
  return [
    '# Country projections',
    '',
    '- Source: the committed `public/provinces/<CC>.json` outlines, merged with `topojson-client`',
    '- Licence: as the province files — see [provinces-report.md](provinces-report.md)',
    `- Viewport: ${MAP_VIEW_W} x ${MAP_VIEW_H}, read from \`lib/mapView.ts\``,
    `- Generated: ${stats.now}`,
    '',
    '## Coverage',
    '',
    `- Entries: **${stats.count}**`,
    `- Countries drawn from more than one polygon: **${stats.multi}**`,
    `- Countries rotated off the antimeridian: **${stats.rotated.length}**`,
    `- Countries whose fit leaves a polygon out of frame: **${rows.length}**`,
    `- Multi-polygon countries the gates refused to trim: **${stats.multi - rows.length}**`,
    `- Largest hidden area: **${worst}**`,
    '',
    'The nine trims below are far fewer, and far smaller, than the spec',
    "predicted — and the reason is not cartographic. The spec's headline case",
    'was the Netherlands at 11.51x, hiding Bonaire, Saba and Sint Eustatius;',
    'those three are now `BQ.json`, a country of their own, so there is no',
    'longer a Dutch polygon for a projection to hide. New Zealand went the same',
    'way when Tokelau became `TK.json`. A cartographic workaround was retired',
    'by a data-model decision, and anyone comparing this table against the',
    "spec's should read the difference as the territory policy working rather",
    'than as the rule disagreeing.',
    '',
    '## Rotations',
    '',
    'Rule 1: everyone else takes `rotate: 0`. These cross the antimeridian,',
    'where an unrotated fit reads a 3-degree-wide country as a 357-degree one',
    'and collapses.',
    '',
    '```',
    stats.rotated.map((r) => `${r.code} ${r.rotate}`).join('  '),
    '```',
    '',
    '## Trims accepted',
    '',
    'Gate A: at most 1% of the country hidden. Gate B: separation at least 0.5,',
    "as centroid distance in degrees over the anchor's own bbox diagonal. Gate",
    'C: the country must draw at least 1.5x bigger for the loss to be worth it.',
    '',
    '| code | hides | % area | km2 hidden | scale before | scale after | gain | sep |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) =>
      `| ${r.code} | ${r.hides} | ${r.hiddenAreaPct.toFixed(3)}% | ${r.km2.join(' / ')} | ` +
      `${r.baseScale.toFixed(2)} | ${r.scale.toFixed(2)} | ${r.gain.toFixed(2)}x | ${r.sep.toFixed(2)} |`
    ),
    '',
    '## Size',
    '',
    `- Raw: ${stats.raw} B`,
    `- Gzip: ${stats.gzip} B`,
    `- Mean: ${(stats.raw / stats.count).toFixed(1)} B/entry`,
    '',
  ].join('\n');
}

/** How many artifacts this run has put on disk, for the failure message. */
let written = 0;

function main() {
  const files = readdirSync(PROVINCE_DIR).filter((name) => PROVINCE_FILE.test(name)).sort();
  if (files.length === 0) {
    throw new Error(`no province files in ${PROVINCE_DIR} — run build-provinces.mjs first`);
  }

  /** @type {Record<string, ProjectionEntry>} */
  const manifest = {};
  const trimmed = [];
  const rotated = [];
  let multi = 0;

  for (const name of files) {
    const code = PROVINCE_FILE.exec(name)[1];
    const { topology } = JSON.parse(readFileSync(join(PROVINCE_DIR, name), 'utf8'));
    // `merge()` over the very features the picker lists — spec §4.1. It is
    // what makes one fetch feed both the outline and the selectable units.
    const polygons = polygonsOf(merge(topology, topology.objects.provinces.geometries));
    if (polygons.length === 0) throw new Error(`${code}: merge() produced no polygons`);
    if (polygons.length > 1) multi += 1;

    const { entry, baseScale, trim, hiddenKm2 } = measureCountry(polygons);
    manifest[code] = entry;
    if (entry.rotate !== 0) rotated.push({ code, rotate: entry.rotate });
    if (trim !== null) {
      trimmed.push({
        code,
        hides: trim.dropped.length,
        hiddenAreaPct: entry.hiddenAreaPct,
        km2: hiddenKm2,
        baseScale,
        scale: trim.scale,
        gain: trim.gain,
        sep: trim.sep,
      });
    }
  }

  // Every gate fires before anything reaches disk.
  assertManifest(manifest);

  const json = `${JSON.stringify(manifest)}\n`;
  const raw = Buffer.byteLength(json);
  const gzip = gzipSync(json).length;
  const now = new Date().toISOString();
  const count = Object.keys(manifest).length;

  writeFileAtomic(MANIFEST_PATH, json);
  written += 1;
  writeFileAtomic(REPORT_PATH, buildReport({ count, multi, rotated, trimmed, raw, gzip, now }));
  written += 1;

  console.log(
    `entries: ${count}  raw ${raw} B  gzip ${gzip} B  mean ${(raw / count).toFixed(1)} B/entry`
  );
  console.log(`rotate != 0 (${rotated.length}): ${rotated.map((r) => r.code).join(' ')}`);
  console.log(`hiddenAreaPct (${trimmed.length}): ${trimmed.map((r) => r.code).join(' ')}`);
  for (const r of [...trimmed].sort((a, b) => b.gain - a.gain)) {
    console.log(
      `  ${r.code}  hides ${r.hides} (${r.hiddenAreaPct.toFixed(3)}%, km2 ${r.km2.join('/')})  ` +
      `${r.baseScale.toFixed(2)} -> ${r.scale.toFixed(2)}  gain ${r.gain.toFixed(2)}x  sep ${r.sep.toFixed(2)}`
    );
  }
  console.log(`Wrote ${MANIFEST_PATH}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`\nProjection build failed: ${error.message}`);
    console.error(written === 0
      ? 'Nothing was written — the committed manifest and report are untouched.'
      : `${written} artifact(s) reached disk and now disagree with each other. Re-run to ` +
        `completion before committing, or "git checkout -- public/country-projections.json ` +
        `data/projections-report.md".`);
    process.exit(1);
  }
}
