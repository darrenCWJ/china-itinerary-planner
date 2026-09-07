/**
 * ingest-climate — the committed measurement record.
 *
 * Moved verbatim out of scripts/ingest-climate.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `main`, the run guard — is still
 * scripts/ingest-climate.mjs.
 */

import { GZIP_BUDGET, RAW_TRIPWIRE } from '../build-provinces.mjs';
import { PROBE_EXTRAPOLATION, SOURCE_URL_PATTERN } from './acquire.mjs';
import { BLOCK_META, MONTHS_PER_YEAR, SAMPLE_FIELDS, TUPLE_LENGTH } from './sample.mjs';

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const MB = (bytes) => (bytes / 1_000_000).toFixed(2);
const GB = (bytes) => (bytes / 1_000_000_000).toFixed(2);
export const pct = (part, whole) => `${((100 * part) / whole).toFixed(1)}%`;
export const seconds = (ms) => (ms / 1000).toFixed(1);
/** Signed, because "off by −6.3%" and "off by 6.3%" are different findings. */
const drift = (measured, predicted) =>
  `${measured >= predicted ? '+' : '−'}${(Math.abs(100 * (measured - predicted)) / predicted).toFixed(1)}%`;

/**
 * The report's `## Measured ranges` section: what the rows actually contain.
 *
 * Committed because this is the provenance behind `lib/climateShard.ts`'s
 * guard bands, and until it was written here it existed only in an agent
 * scratch file that `.gitignore` keeps out of the repository — eight comments
 * cited a document a reader could not open. The bands are deliberately wide of
 * anything CHELSA reports, and with no measured figures beside them a reader
 * cannot tell a generous guard rail from one a future release would trip.
 *
 * `lo > hi` is counted for the same reason: it is the one CROSS-FIELD
 * invariant the parser checks per month, so a decode that scaled `tasmin` and
 * `tasmax` differently would land inside every band and still be caught. The
 * count here is what says the artifact has never needed it.
 *
 * Pure, and takes the same `[id, row]` iterable `assertRowShape` does, so the
 * block can be recomputed from `public/climate/*.json` alone rather than only
 * as a side effect of a 26-minute build.
 *
 * @param {Iterable<[string, number[]]>} rows
 * @returns {string[]} the section's lines, heading first, blank-terminated
 */
export function measuredRanges(rows) {
  // Materialized up front so an empty set can be refused before any block
  // is touched — left as the iterable's own type, an empty `rows` would
  // otherwise leave every block at its opposite-infinity starting point and
  // ship `Infinity..-Infinity` straight into the committed report.
  const entries = [...rows];
  if (entries.length === 0) {
    throw new Error('measuredRanges: no rows to measure — refusing to report Infinity..-Infinity ranges');
  }
  // `BLOCK_META`'s own min/max are the GUARD BANDS; these are the measured
  // extremes, so they start at the opposite infinities and are named apart
  // from the band deliberately.
  const blocks = BLOCK_META.map((b) => ({
    label: b.label,
    unit: b.unit,
    min: Infinity,
    max: -Infinity,
  }));
  let cityMonths = 0;
  let inverted = 0;
  for (const [, row] of entries) {
    for (let b = 0; b < blocks.length; b += 1) {
      const block = blocks[b];
      for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
        const value = row[b * MONTHS_PER_YEAR + m];
        if (value < block.min) block.min = value;
        if (value > block.max) block.max = value;
      }
    }
    for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
      cityMonths += 1;
      if (row[m] > row[MONTHS_PER_YEAR + m]) inverted += 1;
    }
  }
  return [
    '## Measured ranges',
    '',
    'Per block, over every row written above — the provenance behind the guard',
    'bands `lib/climateShard.ts` refuses a row outside of. Those bands are',
    'deliberately wide of anything CHELSA reports, so these are the figures that',
    'say how much room is actually left under them:',
    '',
    '```',
    ...blocks.map((b) => `${b.label.padEnd(7)} ${`${b.min}..${b.max}`.padEnd(11)} ${b.unit}`),
    '```',
    '',
    `${cityMonths} city-months, of which **${inverted}** have \`lo\` greater than \`hi\` — the`,
    'one cross-field invariant the parser checks per month, and the one a decode',
    'that scaled `tasmin` and `tasmax` differently would trip while landing inside',
    'every band above.',
    '',
  ];
}

/**
 * The committed measurement record, in `data/provinces-report.md`'s shape:
 * provenance, bolded counts, a paragraph for the one consequence a reader
 * would otherwise get wrong, and a size block.
 *
 * Every figure comes from the run that is writing the files, and the timestamp
 * from the INDEX's envelope rather than a fresh `new Date()` — the report
 * describes the artifact, so it is stamped when the artifact was generated.
 * On a run that changes nothing those differ, because the index keeps its
 * previous stamp; the report is not rewritten then either, so the only way to
 * see the difference is to delete the report and rebuild, and even then the
 * date a reader wants is the artifact's.
 */
export function buildReport(stats) {
  const raw = stats.sizes.reduce((n, s) => n + s.raw, 0);
  const gzip = stats.sizes.reduce((n, s) => n + s.gzip, 0);
  const byGzip = [...stats.sizes].sort((a, b) => b.gzip - a.gzip);
  const byRaw = [...stats.sizes].sort((a, b) => b.raw - a.raw);
  const median = [...stats.sizes].sort((a, b) => a.raw - b.raw)[Math.floor(stats.sizes.length / 2)];
  const worst = byGzip[0];
  const largest = byRaw[0];
  const downloadedBytes = stats.rasters.reduce((n, r) => n + r.downloadedBytes, 0);
  const downloadMs = stats.rasters.reduce((n, r) => n + r.downloadMs, 0);
  const sampleMs = stats.rasters.reduce((n, r) => n + r.sampleMs, 0);
  const cachedCount = stats.rasters.filter((r) => r.downloadedBytes === 0).length;
  return [
    '# Climate normals',
    '',
    `- Source: ${SOURCE_URL_PATTERN}`,
    `- Licence: CC0 1.0 — CHELSA V2.1 climatologies 1981–2010, DOI 10.16904/envidat.228`,
    `- Generated: ${stats.generatedAt}`,
    `- Built by: \`node scripts/ingest-climate.mjs\`, Node ${process.version}`,
    `- Catalog: the ${stats.shardCount} committed shards under \`public/cities/\`, **${stats.cityCount} cities**`,
    '',
    '## Layout',
    '',
    'Per city, 60 positional integers — five blocks of twelve, **calendar-indexed**',
    'with January at index 0 of every block:',
    '',
    '```',
    '[ 0..11]  lo      °C          tasmin',
    '[12..23]  hi      °C          tasmax',
    '[24..35]  precip  mm/month    pr',
    '[36..47]  cloud   %           clt',
    '[48..59]  td      °C          derived',
    '```',
    '',
    '`td` is the August–Roche–Magnus dew point on `T = (lo + hi) / 2` and the raw',
    'monthly mean relative humidity from `hurs`, and it is **uncorrected**: spec',
    "§9.4's humidity-bias correction lives in the fit model at read time, where it",
    'can be retuned without re-running this build. `hurs` itself is never written',
    '(§13). Nothing here is hemisphere-flipped — the rasters come out',
    'calendar-ordered and no `seasonIn` is applied on the way in.',
    '',
    'The rows join `public/cities/<CC>.json` on the city id. Elevation is not',
    'repeated here; a consumer that needs it reads `elev` from the city row, where',
    `${stats.nullElevations} of ${stats.cityCount} rows carry \`null\` and must be treated as "no correction".`,
    '',
    '## Coverage',
    '',
    `- Country shards: **${stats.sizes.length}**`,
    `- Cities with a climate row: **${stats.rowCount}**`,
    `- Cities dropped for an unwritable month: **${stats.skipped}**`,
    `- Cities no raster could place: **${stats.offRaster}**`,
    `- Samples on the file's declared nodata sentinel: **${stats.atNodata}** of ${stats.sampleCount}`,
    '',
    'The last three are zero and are expected to stay zero, but none of them is',
    'guaranteed by the format. CHELSA V2.1 is modelled over ocean as well as land,',
    'so there is no coastline to fall off and no sentinel to land on — a property',
    'of this release, not of the product. A future release that changes it would',
    'drop whole cities silently, because 60 positional integers carry no per-month',
    'absence marker: one unwritable month and the city cannot be written at all.',
    'That is why all three are gates and not statistics.',
    '',
    ...measuredRanges(stats.rows),
    '## Rasters',
    '',
    `- Variables: ${SAMPLE_FIELDS.join(', ')} — 12 months each, ${stats.rasters.length} files`,
    `- On disk: ${stats.rasterBytes} B (${GB(stats.rasterBytes)} GB)`,
    `- Downloaded by this run: ${downloadedBytes} B (${GB(downloadedBytes)} GB); ${cachedCount} of ${stats.rasters.length} files were already cached`,
    '',
    '| variable | grid | rows touched | bytes | downloaded | sample |',
    '|---|---|---|---|---|---|',
    ...stats.variables.map((v) =>
      `| \`${v.variable}\` | ${v.grid.width}×${v.grid.height} @ ${v.grid.resX}° | ` +
      `${v.rowsTouched} of ${v.grid.height} | ${v.bytes} B | ${v.downloadedBytes} B | ${seconds(v.sampleMs)} s |`
    ),
    '',
    'Two grids, not one: `clt` is a coarser raster on its own origin that reaches',
    'both poles, where the other four stop at +84°. Each file carries its own',
    'transform, scale, offset and sentinel, and this build reads all of them off',
    'the file — §9.1 states the scale and omits the −273.15 offset, which alone',
    'would have reported Singapore at 298 °C.',
    '',
    '```',
    ...stats.variables.map((v) =>
      `${v.variable.padEnd(7)} scale ${String(v.scaling.scale).padEnd(5)} offset ${String(v.scaling.offset).padEnd(8)} nodata ${v.scaling.nodata}`
    ),
    '```',
    '',
    '## Cost',
    '',
    `- Download: ${downloadedBytes} B in ${seconds(downloadMs)} s`,
    `- Sample: ${seconds(sampleMs)} s over ${stats.rowReads} row reads`,
    `- Wall clock: ${seconds(stats.wallMs)} s (${(stats.wallMs / 60000).toFixed(1)} min)`,
    `- Peak RSS: ${stats.peakRss} B (${Math.round(stats.peakRss / 1024 / 1024)} MB)`,
    '',
    'Spec §14.8 budgeted this run at "tens of minutes, single-digit GB,',
    'sub-500 MB RSS" and asked for the truth. Two of the three hold. **The download',
    `does not**: ${GB(stats.rasterBytes)} GB, because §9.1's variables row omits \`hurs\`, and`,
    'the fifth variable is the second largest of the five. A runner that provisions',
    'for single-digit GB of scratch disk will not finish.',
    '',
    'Memory is a non-issue and stays one. A decoded row is 86 KB on the 1 km grid',
    'and is released before the next is read; the resident cost is the catalog plus',
    `the whole year's decoded samples, which is ${MB(stats.cityCount * TUPLE_LENGTH * 8)} MB of Float64 for`,
    `${stats.cityCount} cities. Nothing needs streaming, and nothing needs the 1.8 GB a`,
    'whole-raster decode would take.',
    '',
    '## Size',
    '',
    `- Raw: ${raw} B (${MB(raw)} MB)`,
    `- Gzip: ${gzip} B (${MB(gzip)} MB)`,
    `- Largest shard by raw bytes: ${largest.code}, ${largest.raw} B raw / ${largest.gzip} B gzip`,
    `- Worst shard by gzip bytes: ${worst.code}, ${worst.gzip} B gzip / ${worst.raw} B raw`,
    `- Median shard: ${median.code}, ${median.raw} B raw / ${median.gzip} B gzip`,
    `- Shards over the ${GZIP_BUDGET} B gzip budget: **0 of ${stats.sizes.length}**`,
    `- Shards over the ${RAW_TRIPWIRE} B raw tripwire: **0 of ${stats.sizes.length}**`,
    '',
    `**The cap is not saturated.** The worst shard uses ${pct(worst.gzip, GZIP_BUDGET)} of the`,
    `${GZIP_BUDGET} B gzip budget — ${pct(GZIP_BUDGET - worst.gzip, GZIP_BUDGET)} of it goes unused — and the`,
    `runners-up are clustered just below it (${byGzip.slice(1, 6).map((s) => `${s.code} ${s.gzip}`).join(', ')}),`,
    "so the result is not one country's luck. Unlike the city shard's cap, this one",
    'is not binding, and a future reader should not treat it as the constraint that',
    'shaped the layout: the fifth block was added on top of a 48-int layout the',
    'probe had already shown fits, and it still does not come close.',
    '',
    `The biggest file and the worst one are ${largest.code === worst.code ? 'the same country here, which is a coincidence' : `different countries (${largest.code} by raw, ${worst.code} by gzip)`}.`,
    'Raw bytes follow city count and id lengths; gzip follows how much the twelve',
    'months of a place actually vary. Any budget test must therefore be written',
    'against the maximum over all shards, not against the largest file.',
    '',
    '## Against the probe',
    '',
    '`data/climate-probe.md` sized this artifact from **January alone**, and never',
    'sampled `hurs` at all — its 60-int figures extrapolate the fifth block from the',
    'cloud column, and its gzip figure treats the twelve months as independent',
    'columns, which real months are not. It said so, and predicted the direction of',
    'its own error. Measured against those predictions:',
    '',
    '| | predicted | measured | off by |',
    '|---|---|---|---|',
    `| whole artifact, raw | ${PROBE_EXTRAPOLATION.raw} B | ${raw} B | ${drift(raw, PROBE_EXTRAPOLATION.raw)} |`,
    `| whole artifact, gzip | ${PROBE_EXTRAPOLATION.gzip} B | ${gzip} B | ${drift(gzip, PROBE_EXTRAPOLATION.gzip)} |`,
    `| worst shard, gzip | ${PROBE_EXTRAPOLATION.worstGzip} B | ${worst.gzip} B | ${drift(worst.gzip, PROBE_EXTRAPOLATION.worstGzip)} |`,
    '',
    'Raw came out almost exactly where January said it would; both gzip figures',
    'came in well under, in the direction the probe named — it measured that the',
    'marginal cost of a column FALLS as columns are added, so treating twelve',
    'months as independent could only overstate the total.',
    '',
    'The countries moved, as the probe warned they would. §9.3 named VN as the',
    `largest shard and the probe corrected that to ID; measured, it is ${largest.code}. The`,
    `probe named CO as the worst by gzip; measured, it is ${worst.code}. The leaders are a`,
    "few per cent apart because they all sit on the ingest's 750-city-per-country",
    'cap, so which one wins is decided by id lengths and digit widths and will move',
    'between refreshes — nothing should be written that depends on a particular',
    'country being the largest.',
    '',
    '## Source',
    '',
    'CHELSA V2.1 climatologies 1981–2010, **CC0 1.0**, DOI 10.16904/envidat.228.',
    '',
    'CC0 waives the licence conditions, so this section is a courtesy credit and',
    'not a term this project has to meet — deliberately `## Source` rather than the',
    '`## Attribution` heading `data/cities-report.md` uses for GeoNames, whose',
    'CC BY 4.0 credit is enforced by a byte-for-byte contract test. Karger, D.N.,',
    'Conrad, O., Böhner, J., Kawohl, T., Kreft, H., Soria-Auza, R.W., Zimmermann,',
    'N.E., Linder, H.P. & Kessler, M. (2017). Climatologies at high resolution for',
    "the earth's land surface areas. Scientific Data 4, 170122.",
    '',
  ].join('\n');
}

