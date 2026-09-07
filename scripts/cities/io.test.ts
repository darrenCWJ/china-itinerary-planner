/**
 * ingest-cities — the payload stampers and the stale-shard sweep.
 *
 * Moved out of scripts/ingest-cities.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-cities.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import paths moved with them.
 *
 * The sweep's describe mentions "the mock above": that `vi.mock("node:fs")` is
 * `run()`'s, and it stayed with `run()`'s describe in
 * scripts/ingest-cities.test.ts. Nothing here depends on it — the sweep writes
 * its fixture files through `fs/promises`, which the mock never touched either.
 */

import { mkdirSync, mkdtempSync, rmSync as rmSyncReal } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { describe, expect, test } from "vitest";
import { staleShardFiles } from "./io.mjs";

/**
 * The nine-field shard record, copied from `scripts/cities/build.test.ts` where
 * it used to sit further up the same file. `shardRow` below fills all nine
 * fields, so the second, seven-field declaration that came with it still needs
 * this one to merge with — which is what its own docblock says.
 */
interface ShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  a1: string | null;
  /** The GeoNames admin-1 code `a1` was resolved from, `"<CC>.<CODE>"`. */
  a1c: string | null;
  p: number;
  /** Metres. Surveyed where GeoNames has it, modelled otherwise. */
  elev: number | null;
  tz: string;
}

interface ShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  a1: string | null;
  p: number;
  tz: string;
}

/**
 * A shard row that passes every per-record check, so a test can break one.
 *
 * `ShardRow` is declared twice in this file and TypeScript merges the two, so
 * the two new Phase 4 fields are declared once, above, and are in scope here.
 *
 * `a1` defaults to a resolved name rather than null: the real admin-1
 * resolution rate is 99.26%, and a fixture that left every row unresolved
 * would fail Finding A's floor by default, in every test in this file that
 * doesn't care about admin-1 at all.
 */
function shardRow(over: Partial<ShardRow> & Pick<ShardRow, "id">): ShardRow {
  return {
    n: `City ${over.id}`, lat: 10, lon: 20, a1: "Region", a1c: "XX.01",
    p: 1_000, elev: 100, tz: "UTC", ...over,
  };
}

// ---------------------------------------------------------------------------
// shardPayload
// ---------------------------------------------------------------------------

import { shardPayload, stampedPayload } from "./io.mjs";

describe("shardPayload", () => {
  const cities = [shardRow({ id: "G1", p: 900 }), shardRow({ id: "G2", p: 100 })];

  test("stamps a fresh timestamp when there is no previous shard", () => {
    const payload = shardPayload("PE", cities, null, "2026-08-25T00:00:00.000Z");
    expect(payload).toEqual({
      country: "PE",
      generatedAt: "2026-08-25T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities,
    });
  });

  test("preserves the previous timestamp when the rows are identical", () => {
    // Idempotency lives here rather than in the workflow: 246 shards totalling
    // 6.5 MB are committed, and rewriting all of them nightly for a timestamp
    // would bloat the repo. Only the countries that actually moved appear as
    // changed, so the workflow's `git status --porcelain` guard sees a clean
    // tree on a quiet day.
    const previous = {
      country: "PE",
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities,
    };
    expect(shardPayload("PE", cities, previous, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });

  test("takes the fresh timestamp when a single field moved", () => {
    const previous = {
      country: "PE",
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities: [shardRow({ id: "G1", p: 901 }), shardRow({ id: "G2", p: 100 })],
    };
    expect(shardPayload("PE", cities, previous, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-25T00:00:00.000Z"
    );
  });

  test("compares only the rows, never the envelope", () => {
    // Comparing the whole previous object would make the timestamp compare
    // against itself and never match.
    const previous = {
      country: "PE",
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "something else entirely",
      cities,
    };
    expect(shardPayload("PE", cities, previous, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });
});

// ---------------------------------------------------------------------------
// stampedPayload — the same rule for the three run-level index files
// ---------------------------------------------------------------------------

describe("stampedPayload", () => {
  const body = { source: "GeoNames cities500 (CC BY 4.0)", countries: [{ code: "PE", count: 2 }] };

  test("preserves the previous timestamp when the payload is identical", () => {
    // This is what makes `refresh-cities.yml`'s commit guard able to fire at
    // all. public/cities/index.json, data/cities-index.json and
    // data/cities-enrich-targets.json are all inside the guard's paths; if any
    // of them carries `new Date()` unconditionally, `git status` is never
    // clean, the guard's short-circuit is dead code, and 3.7 MB is committed
    // and auto-deployed to production every night for no data change.
    const previous = { generatedAt: "2026-08-01T00:00:00.000Z", ...body };
    const stamped = stampedPayload(previous, body, "2026-08-25T00:00:00.000Z");
    expect(stamped.generatedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(JSON.stringify(stamped)).toBe(JSON.stringify(previous));
  });

  test("takes the fresh timestamp when any part of the payload moved", () => {
    const previous = {
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: body.source,
      countries: [{ code: "PE", count: 3 }],
    };
    expect(stampedPayload(previous, body, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-25T00:00:00.000Z"
    );
  });

  test("stamps fresh when there is no previous file, or it was unreadable", () => {
    // `readJson` answers null for both a missing file and a parse failure.
    expect(stampedPayload(null, body, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-25T00:00:00.000Z"
    );
  });

  test("puts generatedAt first, so a human diff of index.json reads the same way", () => {
    expect(Object.keys(stampedPayload(null, body, "x"))).toEqual([
      "generatedAt",
      "source",
      "countries",
    ]);
  });
});

describe("staleShardFiles — the sweep that runs after every shard has been written", () => {
  test("names stale shard files and never a directory, whatever it is called", async () => {
    // `rmSync(dir, { force: true })` throws ERR_FS_EISDIR — `force` forgives a
    // missing path, not a directory — so a directory reaching the sweep ended
    // the nightly refresh at its final step, after every shard was on disk.
    // `enrich/` was safe only by NAME; `climate/` here stands for the first
    // directory nobody thought to name.
    const dir = mkdtempSync(pathJoin(tmpdir(), "ingest-cities-sweep-test-"));
    try {
      // `writeFileSync` is a no-op spy in this file (see the mock above), so
      // the fixture files go through fs/promises, which the mock does not touch.
      await writeFile(pathJoin(dir, "PE.json"), "{}");
      await writeFile(pathJoin(dir, "ZZ.json"), "{}");
      await writeFile(pathJoin(dir, "index.json"), "{}");
      mkdirSync(pathJoin(dir, "enrich"));
      mkdirSync(pathJoin(dir, "climate"));
      expect(staleShardFiles(dir, ["PE"])).toEqual(["ZZ.json"]);
      // And the positive control: with nothing written, both files are stale
      // and both directories still are not.
      expect(staleShardFiles(dir, [])).toEqual(["PE.json", "ZZ.json"]);
    } finally {
      rmSyncReal(dir, { recursive: true, force: true });
    }
  });
});
