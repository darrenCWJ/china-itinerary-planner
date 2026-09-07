/**
 * ingest-climate — the payloads, and writing them.
 *
 * Moved verbatim out of scripts/ingest-climate.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `main`, the run guard — is still
 * scripts/ingest-climate.mjs.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { SOURCE } from './acquire.mjs';

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * One country's shard, with its timestamp preserved when nothing changed.
 *
 * Compared on the rows alone — never the envelope, which carries the very
 * timestamp being decided. A comparison that included `generatedAt` could
 * never match and the guard would be dead code that looks alive.
 *
 * @param {string} country
 * @param {Record<string, number[]>} cities
 * @param {object | null} previous
 * @param {string} now
 */
export function climatePayload(country, cities, previous, now) {
  const unchanged = previous !== null && JSON.stringify(previous.cities) === JSON.stringify(cities);
  return {
    country,
    generatedAt: unchanged ? previous.generatedAt : now,
    source: SOURCE,
    cities,
  };
}

/**
 * `index.json`, with ITS timestamp preserved too.
 *
 * This is the one place this build departs from `build-provinces.mjs`, which
 * stamps `generatedAt: now` on the index unconditionally. That is safe there
 * only because it is hand-run: a person who rebuilds the provinces is looking
 * at the diff. Spec §9.2 gives this artifact a `workflow_dispatch`, and an
 * unattended run over unchanged decadal normals must produce a byte-identical
 * tree — otherwise every dispatch commits one line of pure noise in the one
 * file a reviewer checks first, and learning to ignore it is how the real
 * change gets waved through.
 *
 * `shardsChanged` is why the listing alone cannot decide this. The listing is
 * `{code, count}` per country, and a CHELSA erratum — the one event
 * `.github/workflows/refresh-climate.yml`'s header names as a reason to
 * dispatch — rewrites rows in every shard while adding and removing no city
 * at all. On the listing alone, all 246 shards would restamp while this index
 * kept the previous decade's date, and `buildReport` takes the report's
 * `Generated:` line from THIS stamp, so the record of the run would be stale
 * too. Defaulted to 0 so the three-argument form still means "the listing
 * decides", which is what the unchanged-case tests are about.
 *
 * @param {{ code: string, count: number }[]} countries
 * @param {object | null} previous
 * @param {string} now
 * @param {number} shardsChanged how many shard files this run's bytes differ in
 */
export function indexPayload(countries, previous, now, shardsChanged = 0) {
  const unchanged =
    previous !== null &&
    shardsChanged === 0 &&
    JSON.stringify(previous.countries) === JSON.stringify(countries);
  return { generatedAt: unchanged ? previous.generatedAt : now, countries };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Write via a PID-suffixed temp file, removing the destination first.
 *
 * `build-provinces.mjs`'s, for its reasons: renaming onto an existing path is
 * not reliably atomic on Windows, which is this project's dev platform, and a
 * bare `.tmp` collides if two builds ever overlap.
 */
export function writeFileAtomic(path, contents) {
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
 * A previously committed artifact, as both its bytes and its parse.
 *
 * The bytes decide whether this run CHANGED anything; the parse is what the
 * payload builders compare against to decide whether to restamp. A file that
 * will not parse yields a null parse — not an abort — because restamping and
 * overwriting is exactly the right answer to a corrupt artifact.
 */
export function readPrevious(path) {
  if (!existsSync(path)) return { text: null, value: null };
  const text = readFileSync(path, 'utf8');
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    return { text, value: null };
  }
}

