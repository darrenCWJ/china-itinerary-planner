/**
 * ingest-climate — the gates.
 *
 * Moved verbatim out of scripts/ingest-climate.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `main`, the run guard — is still
 * scripts/ingest-climate.mjs.
 */

/**
 * The two per-file budgets, imported rather than restated so there is one
 * number to change. `build-provinces.mjs` is argv-guarded exactly like this
 * module, so importing it runs its module body and nothing else.
 */
import { GZIP_BUDGET, RAW_TRIPWIRE } from '../build-provinces.mjs';
import { BLOCK_META, MONTHS_PER_YEAR, TUPLE_LENGTH } from './sample.mjs';

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * One climate shard per city shard, in both directions.
 *
 * Two-way, unlike `build-provinces.mjs`'s one-way coverage gate, because the
 * two artifacts have different failure modes. A province file for a country
 * with no cities is harmless geometry; a climate file for one is a file whose
 * every key joins to nothing, and a missing one is a country whose map renders
 * with no climate at all. Neither should be decided by a count — a run that
 * loses one country and gains another keeps the count identical.
 */
export function assertShardCoverage(emitted, reference) {
  const missing = [...reference].filter((code) => !emitted.has(code)).sort();
  const extra = [...emitted].filter((code) => !reference.has(code)).sort();
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} country/countries have a city shard and no climate shard: ${missing.join(', ')}`
    );
  }
  if (extra.length > 0) {
    throw new Error(
      `${extra.length} climate shard(s) name a country with no city shard: ${extra.join(', ')}`
    );
  }
}

/**
 * The ids the shards carry are exactly the catalog's ids, each exactly once.
 *
 * This is the join Task 8's loader and every map component depend on: a
 * climate row is looked up by the city id that came out of
 * `public/cities/<CC>.json`, and `elev` is read from the city row beside it.
 * An id in one file and not the other is a city that renders with no climate,
 * or a row nothing will ever read — both silent.
 *
 * `written` is an ITERABLE and not a Set on purpose, so a duplicate survives
 * long enough to be caught. The failure this is really written for is a bad
 * range in `buildShards`: the catalog is one flat array sliced per country by
 * offset and length, and an overlapping or short slice writes some city twice
 * and another not at all — with a Set on both sides, an overlap would compare
 * equal and every remaining gate would pass.
 *
 * Names at most ten of each, because a build that has lost the join has lost
 * tens of thousands and the list is the wrong thing to print.
 */
export function assertCityParity(written, catalog) {
  const seen = new Set();
  const duplicated = [];
  for (const id of written) {
    if (seen.has(id)) duplicated.push(id);
    else seen.add(id);
  }
  const missing = [...catalog].filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !catalog.has(id));
  if (missing.length === 0 && extra.length === 0 && duplicated.length === 0) return;
  const sample = (ids) => `${ids.length} (e.g. ${ids.slice(0, 10).join(', ')})`;
  throw new Error(
    'the climate rows and the city catalog do not agree: ' +
    `${missing.length > 0 ? `catalogued cities with no row: ${sample(missing)}; ` : ''}` +
    `${extra.length > 0 ? `rows for uncatalogued cities: ${sample(extra)}; ` : ''}` +
    `${duplicated.length > 0 ? `cities written into more than one shard: ${sample(duplicated)}; ` : ''}` +
    'the artifact is joined by city id and nothing downstream would notice the gap'
  );
}

/**
 * Every row is exactly `TUPLE_LENGTH` integers, inside the parser's own bands.
 *
 * `tupleFor` already guarantees the LENGTH for anything it returns, so that
 * half of the gate is about what happens between there and disk. A positional
 * tuple carries no field names: one short row and every index after it means
 * something else, and `JSON.parse` will accept it happily.
 *
 * The guard bands and the per-month `lo <= hi` cross-check are the same ones
 * `lib/climateShard.ts` applies at read time, restated here because this gate
 * was the weaker of the two and it is the one that runs BEFORE the first
 * write. Without them an unscaled decode — 246 shards of Singapore at 298 °C —
 * passes this build, lands on disk, and only announces itself 66 minutes later
 * when `npm test` parses the committed artifact back. `lo > hi` earns its own
 * check because both values can sit inside every band and still be wrong: it
 * is what a build that scaled `tasmin` and `tasmax` differently looks like.
 *
 * Naming the city, the block and the month costs nothing here and is the
 * difference between "a shard is wrong" and "tasmax is unscaled". This
 * changes no output: it either passes, or it stops the run before any write.
 */
export function assertRowShape(rows) {
  for (const [id, row] of rows) {
    if (!Array.isArray(row) || row.length !== TUPLE_LENGTH) {
      throw new Error(`${id}: row is ${Array.isArray(row) ? `${row.length} long` : typeof row}, expected ${TUPLE_LENGTH} integers`);
    }
    const bad = row.findIndex((value) => !Number.isInteger(value));
    if (bad >= 0) throw new Error(`${id}: row[${bad}] is ${row[bad]}, which is not an integer`);
    for (let b = 0; b < BLOCK_META.length; b += 1) {
      const { label, min, max } = BLOCK_META[b];
      for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
        const value = row[b * MONTHS_PER_YEAR + m];
        if (value < min || value > max) {
          throw new Error(
            `${id}: ${label} in month ${m} is ${value}, outside the ${min}..${max} guard band — looks like an unscaled decode`
          );
        }
      }
    }
    for (let m = 0; m < MONTHS_PER_YEAR; m += 1) {
      const lo = row[m];
      const hi = row[MONTHS_PER_YEAR + m];
      if (lo > hi) throw new Error(`${id}: lo in month ${m} is ${lo}, greater than hi (${hi})`);
    }
  }
}

/**
 * Aborts the build when any shard breaches either limit, naming all of them.
 *
 * Same two numbers as the province files, imported from that build rather than
 * restated. The gzip budget is the one that binds — it measures what crosses
 * the wire — and the raw tripwire catches the pathological shape a runaway
 * build takes even when it happens to compress well.
 */
export function assertBudget(sizes) {
  const over = (key, limit, label) => {
    const breaches = sizes.filter((s) => s[key] > limit).sort((a, b) => a.code.localeCompare(b.code));
    if (breaches.length === 0) return;
    throw new Error(
      `${breaches.length} climate shard(s) over the ${limit} B ${label}: ` +
      breaches.map((s) => `${s.code} ${s[key]}`).join(', ')
    );
  };
  over('gzip', GZIP_BUDGET, 'gzip budget');
  over('raw', RAW_TRIPWIRE, 'raw tripwire');
}

