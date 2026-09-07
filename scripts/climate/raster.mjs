/**
 * ingest-climate — sampling and assembly.
 *
 * Moved verbatim out of scripts/ingest-climate.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `main`, the run guard — is still
 * scripts/ingest-climate.mjs.
 */

import { basename } from 'node:path';

import { fromFile } from 'geotiff';

import { gridOf, readScaling, sameGrid, sameScaling } from './acquire.mjs';
import { SAMPLE_FIELDS, decodeSample, pixelFor, tupleFor } from './sample.mjs';

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Every city grouped by the raster ROW it lands on, rows ascending.
 *
 * The row is the unit because these files are stripped with RowsPerStrip 1 —
 * not the 512×512 COG tiles §9.1 describes, which is the finding that retires
 * its range-read analysis. Reading each touched row once keeps the working set
 * at one decoded row (86 KB on the 1 km grid) instead of the 1.8 GB a whole
 * raster would need, and the catalog touches only 11,771 of 20,880 rows, so
 * grouping also skips 44% of the file.
 *
 * Rows are returned ascending so the reads walk the file forwards; a
 * city-order walk would seek back and forth across 115 MB and re-decode the
 * same dense rows hundreds of times.
 *
 * A city `pixelFor` refuses is collected rather than thrown on, because "off
 * the raster" is a property of the catalog and belongs in a gate with a count
 * beside it. The probe found 0 of 58,757 outside either grid.
 *
 * @param {{lat: number, lon: number}[]} cities
 * @param {object} grid
 * @returns {{ rows: number[], byRow: Map<number, {i: number, x: number}[]>, offRaster: number[] }}
 */
export function bucketByRow(cities, grid) {
  const byRow = new Map();
  const offRaster = [];
  for (let i = 0; i < cities.length; i += 1) {
    const pixel = pixelFor(cities[i].lon, cities[i].lat, grid);
    if (pixel === null) {
      offRaster.push(i);
      continue;
    }
    const bucket = byRow.get(pixel.y);
    if (bucket) bucket.push({ i, x: pixel.x });
    else byRow.set(pixel.y, [{ i, x: pixel.x }]);
  }
  return { rows: [...byRow.keys()].sort((a, b) => a - b), byRow, offRaster };
}

/** Peak `rss` over the run, sampled on a timer and after every row read. */
export class PeakRss {
  constructor() {
    this.peak = process.memoryUsage().rss;
    this.timer = setInterval(() => this.sample(), 50);
    this.timer.unref();
  }
  sample() {
    const rss = process.memoryUsage().rss;
    if (rss > this.peak) this.peak = rss;
    return rss;
  }
  stop() {
    clearInterval(this.timer);
    return this.peak;
  }
}

/**
 * Decoded values for every city on one raster, as a Float64Array.
 *
 * `NaN` is the in-memory stand-in for `decodeSample`'s null, because a
 * Float64Array cannot hold one — and it is a faithful stand-in, because
 * `tupleFor` treats a null and a non-finite number identically and the caller
 * turns NaN back into null before handing it over. The count of sentinel hits
 * is returned separately so a gate can name it; folding it into the null-city
 * count would lose the distinction between "the file says nothing is here" and
 * "the arithmetic came out unusable".
 *
 * Deliberately NOT a sweep of every decoded cell for the sentinel. The probe
 * did that — 1.59 billion cells — and it roughly doubled the sampling time to
 * answer a question this build asks more cheaply: the cells that matter are
 * the ones a city reads.
 */
export async function sampleRaster(path, grid, scaling, buckets, cityCount, peak) {
  const values = new Float64Array(cityCount).fill(Number.NaN);
  let atNodata = 0;
  const tiff = await fromFile(path);
  try {
    const image = await tiff.getImage(0);
    // Every file's own tags, every month — not January's carried forward.
    // The buckets are computed once per variable because all twelve months
    // share a grid, and this is what makes that a verified saving rather than
    // an assumption. A month with a different transform would put every city
    // on the wrong cell; a month with a different scale would decode into
    // plausible nonsense. Neither would raise anything downstream.
    const actual = gridOf(image);
    if (!sameGrid(actual, grid)) {
      throw new Error(
        `${path}: grid is ${actual.width}x${actual.height} at ${actual.originX},${actual.originY} — ` +
        `the other months of this variable are ${grid.width}x${grid.height} at ${grid.originX},${grid.originY}`
      );
    }
    const actualScaling = await readScaling(image.getFileDirectory(), basename(path));
    if (!sameScaling(actualScaling, scaling)) {
      throw new Error(
        `${path}: scale ${actualScaling.scale} offset ${actualScaling.offset} nodata ${actualScaling.nodata} — ` +
        `the other months of this variable declare ${scaling.scale} / ${scaling.offset} / ${scaling.nodata}`
      );
    }
    for (const y of buckets.rows) {
      const rasters = await image.readRasters({ window: [0, y, grid.width, y + 1] });
      const band = rasters[0];
      // The window is the whole row, so `band[x]` IS the city's cell. That
      // only holds while the band is full width: a short read would shift
      // every city east of the gap onto a neighbour's value, which is a
      // plausible number and would never be noticed.
      if (band.length !== grid.width) {
        throw new Error(`${path}: row ${y} decoded ${band.length} cells, expected ${grid.width}`);
      }
      for (const { i, x } of buckets.byRow.get(y)) {
        const decoded = decodeSample(band[x], scaling);
        if (decoded === null) atNodata += 1;
        else values[i] = decoded;
      }
      peak.sample();
    }
  } finally {
    await tiff.close();
  }
  return { values, atNodata };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * The 60-int row for every city that has one, keyed by city id.
 *
 * `samples[field]` is twelve Float64Arrays in calendar order, `NaN` where the
 * raster had nothing. They are turned back into nulls here so `tupleFor` sees
 * exactly the `CitySamples` its contract describes rather than a second
 * encoding of absence it would have to know about.
 *
 * @param {{id: string}[]} cities
 * @param {Record<string, Float64Array[]>} samples
 */
export function assembleRows(cities, samples) {
  const rows = new Map();
  const skipped = [];
  for (let i = 0; i < cities.length; i += 1) {
    /** @type {Record<string, (number | null)[]>} */
    const citySamples = {};
    for (const field of SAMPLE_FIELDS) {
      citySamples[field] = samples[field].map((month) => (Number.isNaN(month[i]) ? null : month[i]));
    }
    const tuple = tupleFor(citySamples);
    if (tuple === null) skipped.push(cities[i]);
    else rows.set(cities[i].id, tuple);
  }
  return { rows, skipped };
}

