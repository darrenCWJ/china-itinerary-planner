import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { geoMercator, geoArea, geoBounds, geoCentroid } from 'd3-geo';
import { merge } from 'topojson-client';

const REPO = 'C:/Users/msn-f/OneDrive/Desktop/China Itenary Planner';
const BOX = [[0, 0], [860, 620]];          // lib/mapView.ts — the real viewport
const KM2 = 510072000 / (4 * Math.PI);

// --- rule 1: rotation ------------------------------------------------------
function rotationFor(polys) {
  const lons = [];
  for (const p of polys) for (const r of p) for (const [lon] of r) lons.push(lon);
  if (lons.length === 0) return 0;
  const s = lons.sort((a, b) => a - b);
  let gap = -1, at = 0;
  for (let i = 0; i < s.length; i++) {
    const b = i + 1 === s.length ? s[0] + 360 : s[i + 1];
    if (b - s[i] > gap) { gap = b - s[i]; at = i; }
  }
  const start = s[(at + 1) % s.length];
  const span = 360 - gap;
  if (!(start <= 180 && start + span > 180)) return 0;
  let c = start + span / 2;
  while (c > 180) c -= 360;
  while (c < -180) c += 360;
  return -c;
}

const norm = (x) => { while (x > 180) x -= 360; while (x < -180) x += 360; return x; };

/** One polygon's bbox in the ROTATED frame — computed once, reused everywhere. */
function boxOf(poly, l) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const ring of poly) for (const [lon, lat] of ring) {
    const rx = norm(lon + l);
    if (rx < x0) x0 = rx; if (rx > x1) x1 = rx;
    if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
  }
  return { x0, x1, y0, y1 };
}

function unionOf(boxes, idx) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of idx) {
    const b = boxes[i];
    if (b.x0 < x0) x0 = b.x0; if (b.x1 > x1) x1 = b.x1;
    if (b.y0 < y0) y0 = b.y0; if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, x1, y0, y1 };
}

/** Spec §5.5: three longitudes, two latitudes, as a MultiPoint. Never a Polygon. */
function scaleOf(u, l) {
  const xm = (u.x0 + u.x1) / 2;
  const coordinates = [];
  for (const x of [u.x0, xm, u.x1]) for (const y of [u.y0, u.y1]) coordinates.push([x - l, y]);
  return geoMercator().rotate([l, 0, 0]).fitExtent(BOX, { type: 'MultiPoint', coordinates }).scale();
}

/**
 * Gate B. The spec gives no formula or unit for "separation >= 0.5"; raw
 * radians cannot be it (Prince Edward Is. is 0.356 rad from South Africa and
 * the spec accepts it). This is centroid separation in degrees normalised by
 * the anchor's own bbox diagonal — scale-free, so 0.5 means the same thing for
 * Australia and for the Netherlands. Validated against the spec's published
 * answer on the 50m source: it reproduces NL, ZA, NC and FJ, and correctly
 * refuses to hide Tasmania and Stewart Island.
 */
function separation(anchorPoly, poly) {
  const [[ax0, ay0], [ax1, ay1]] = geoBounds({ type: 'Polygon', coordinates: anchorPoly });
  const diag = Math.hypot(ax1 - ax0, ay1 - ay0);
  if (diag === 0) return Infinity;
  const a = geoCentroid({ type: 'Polygon', coordinates: anchorPoly });
  const c = geoCentroid({ type: 'Polygon', coordinates: poly });
  return Math.hypot(norm(c[0] - a[0]), c[1] - a[1]) / diag;
}

const EPS = 1e-9;

const files = readdirSync(`${REPO}/public/provinces`).filter((n) => /^[A-Z]{2}\.json$/.test(n));
const manifest = {};
const accepted = [];
const refused = [];
let crossers = 0;

for (const name of files) {
  const code = name.slice(0, 2);
  const env = JSON.parse(readFileSync(`${REPO}/public/provinces/${name}`, 'utf8'));
  const topo = env.topology;
  const merged = merge(topo, topo.objects.provinces.geometries);
  const polys = merged.type === 'MultiPolygon' ? merged.coordinates : [merged.coordinates];
  const l = rotationFor(polys);
  if (l !== 0) crossers++;
  const boxes = polys.map((p) => boxOf(p, l));
  const all = polys.map((_, i) => i);
  const baseU = unionOf(boxes, all);
  const base = scaleOf(baseU, l);

  let entry = { rotate: +l.toFixed(4), bounds: [[+baseU.x0.toFixed(4), +baseU.y0.toFixed(4)], [+baseU.x1.toFixed(4), +baseU.y1.toFixed(4)]], scale: +base.toFixed(4) };

  if (polys.length > 1) {
    const areas = polys.map((p) => geoArea({ type: 'Polygon', coordinates: p }));
    const total = areas.reduce((a, b) => a + b, 0);
    const anchor = areas.indexOf(Math.max(...areas));

    // --- rule 2: the trajectory ---------------------------------------------
    // Candidates are the polygons DRIVING the current extent — the ones whose
    // bbox touches an edge of the union. That is what "extent-driving" means,
    // and it is also what makes this tractable: trying every polygon is
    // O(n^2) over vertices and CA alone has 412 of them.
    let keep = all.slice();
    let u = baseU;
    const dropped = [];
    let best = null;
    for (let step = 0; step < 40 && keep.length > 1; step++) {
      const driving = keep.filter((i) => i !== anchor && (
        Math.abs(boxes[i].x0 - u.x0) < EPS || Math.abs(boxes[i].x1 - u.x1) < EPS ||
        Math.abs(boxes[i].y0 - u.y0) < EPS || Math.abs(boxes[i].y1 - u.y1) < EPS));
      if (driving.length === 0) break;
      let pick = null;
      for (const i of driving) {
        const rest = keep.filter((j) => j !== i);
        const s = scaleOf(unionOf(boxes, rest), l);
        if (pick === null || s > pick.scale) pick = { i, rest, scale: s };
      }
      keep = pick.rest;
      u = unionOf(boxes, keep);
      dropped.push(pick.i);
      const hidden = dropped.reduce((a, i) => a + areas[i], 0) / total;
      const gain = pick.scale / base;
      const sep = Math.min(...dropped.map((i) => separation(polys[anchor], polys[i])));
      // Rule 2: the best point on the WHOLE trajectory, not the first
      // improving step — NL's three Caribbean polygons each gain ~1.1x alone
      // and 11.5x together, so a per-step gate loses it entirely.
      if (hidden <= 0.01 && sep >= 0.5 && gain >= 1.5 && (best === null || gain > best.gain)) {
        best = { n: dropped.length, hidden, gain, sep, scale: pick.scale, u,
                 km2: dropped.map((i) => +(areas[i] * KM2).toFixed(1)) };
      }
    }
    if (best) {
      accepted.push({ code, base, ...best });
      entry = { rotate: +l.toFixed(4),
                bounds: [[+best.u.x0.toFixed(4), +best.u.y0.toFixed(4)], [+best.u.x1.toFixed(4), +best.u.y1.toFixed(4)]],
                scale: +best.scale.toFixed(4),
                hiddenAreaPct: +(best.hidden * 100).toFixed(3) };
    } else if (polys.length > 2) {
      refused.push(code);
    }
  }
  manifest[code] = entry;
}

writeFileSync('country-projections.json', JSON.stringify(manifest));
const raw = Buffer.byteLength(JSON.stringify(manifest));
console.log('entries: ' + Object.keys(manifest).length + '  raw ' + raw + ' B  gzip ' + gzipSync(JSON.stringify(manifest)).length + ' B  mean ' + (raw / Object.keys(manifest).length).toFixed(1) + ' B/entry');
console.log('antimeridian crossers (rotate != 0): ' + crossers);
console.log('ACCEPTED (trim applied): ' + accepted.length);
accepted.sort((a, b) => b.gain - a.gain);
for (const r of accepted) {
  console.log('  ' + r.code + '  hides ' + r.n + ' (' + (r.hidden * 100).toFixed(3) + '%, km2 ' + r.km2.join('/') + ')  '
    + r.base.toFixed(2) + ' -> ' + r.scale.toFixed(2) + '  gain ' + r.gain.toFixed(2) + 'x  sep ' + r.sep.toFixed(2));
}
console.log('REFUSED by the gates (carried untrimmed), ' + refused.length + ': ' + refused.join(' '));
