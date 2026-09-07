/**
 * ingest-cities — the entry point: that the gates run before the first write,
 * and that `run()` really aborts before one when the feed is rejected.
 *
 * The pure functions this file used to cover moved to `scripts/cities/` with
 * the code they test on 2026-09-07 (spec 2026-09-07-unscheduled-items §2.1) —
 * `geonames.test.ts`, `build.test.ts`, `gate.test.ts`, `io.test.ts`. What stays
 * is what tests `run` itself. The module's entry-point guard means importing it
 * here does not also start the ingest and refetch 13 MB.
 *
 * Import note: the build reads `lib/geo.ts` and `lib/foldPlaceName.ts` via
 * Node's native type-stripping at runtime — from `scripts/cities/build.mjs`,
 * which `run` imports — but under Vitest the whole module graph goes through
 * Vite's transform pipeline, which resolves an explicit `.ts` extension same as
 * any other module — the idiom `scripts/ingest-airports.test.ts` already relies
 * on.
 *
 * `tsvRow` below is `scripts/cities/geonames.test.ts`'s fixture, kept here too
 * because `run()`'s describe feeds five of its rows in as a fake download.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const COLUMNS = 19;

/** One syntactically valid `cities500.txt` line. Indices are GeoNames' own. */
function tsvRow(overrides: Record<number, string> = {}): string {
  const base = Array.from({ length: COLUMNS }, () => "");
  base[0] = "2657928";
  base[1] = "Zermatt";
  base[2] = "Zermatt";
  base[3] = "Cermat,Zermat,Zermatt,ツェルマット";
  base[4] = "46.01998";
  base[5] = "7.74863";
  base[6] = "P";
  base[7] = "PPL";
  base[8] = "CH";
  base[10] = "VS";
  base[14] = "6629";
  // Column 15 (surveyed elevation) is blank for most of the real dump; column 16
  // (dem, modelled) is populated nearly everywhere. Zermatt sits at 1,608 m.
  base[16] = "1608";
  base[17] = "Europe/Zurich";
  base[18] = "2024-11-04";
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base.join("\t");
}

// ---------------------------------------------------------------------------
// main()'s ordering
// ---------------------------------------------------------------------------

describe("main()'s ordering", () => {
  const source = readFileSync(new URL("./ingest-cities.mjs", import.meta.url), "utf8");

  test("calls assertSane before it writes anything", () => {
    // `main()` is not invoked here — importing this module must never refetch
    // 13.5 MB — so the ordering is read out of the source. Crude, and the only
    // thing standing between "assertSane throws" (proved twenty-four times
    // above) and "assertSane gates the deploy", which is the property that
    // matters: the workflow commits whatever reaches disk and Vercel deploys
    // the commit.
    const gate = source.indexOf("assertSane(shards, previousIndex)");
    // Not "writeFileAtomic(path," alone. The function's own declaration
    // ("function writeFileAtomic(path, content)") is scripts/cities/io.mjs's
    // since 2026-09-07 and so is out of `source` entirely, but the narrower
    // substring stays: it names the shard write itself rather than whichever
    // of the five call sites reads first.
    const firstWrite = source.indexOf("writeFileAtomic(path, json)");
    expect(gate).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstWrite);
  });

  test("gates the admin-1 names before buildCities consumes them", () => {
    const gate = source.indexOf("assertAdmin1Sane(admin1Codes)");
    const use = source.indexOf("buildCities(rows, admin1Codes, catalogCities)");
    expect(gate).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(use);
  });

  test("exits non-zero when run() rejects, so the workflow does not commit", () => {
    expect(source).toMatch(/run\(\)\.catch\([\s\S]*process\.exit\(1\)/);
  });
});

// ---------------------------------------------------------------------------
// run() — proving the gate by behavior, not by source position
//
// The describe block above only proves that the SUBSTRING "assertSane(...)"
// sits earlier in the file than the SUBSTRING "writeFileAtomic(path, json)".
// A reviewer mutation-tested that claim and found four changes that leave it
// green while a corrupt feed still reaches disk: a gate hidden behind a
// never-set env flag, a write hoisted above the gate, an early-return branch
// that writes before returning, and a try/catch that swallows the gate's
// exception. It also only pins one of `writeFileAtomic`'s five call sites.
//
// This block instead drives the real, exported `run()` with fake network
// loaders and a small (5-row) corrupt-shaped fixture — few enough countries
// that `assertSane`'s own country-count check rejects it for a genuine
// reason — and asserts by BEHAVIOR: no write primitive ever fires. That is
// what actually matters, because the nightly workflow commits whatever
// reaches disk and Vercel deploys the commit.
// ---------------------------------------------------------------------------

import { mkdtempSync, renameSync, rmSync as rmSyncReal, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { afterEach, vi } from "vitest";
import { run } from "./ingest-cities.mjs";

/**
 * `vi.spyOn` cannot touch `node:fs` directly here — Vitest's ESM module
 * namespace for a Node builtin is non-configurable, so `vi.spyOn(fs,
 * "writeFileSync")` throws "Cannot redefine property" before the test body
 * even runs. `vi.mock` with `importOriginal` is Vitest's own prescribed
 * workaround: every other primitive (`readFileSync`, `existsSync`,
 * `mkdirSync`, `readdirSync`, `rmSync`) stays real, and only the two
 * primitives that actually commit bytes to disk — `writeFileSync` and
 * `renameSync` — become no-op spies. That keeps this test file hermetic (no
 * mutation of the gate can make it write a real file, whatever else it does)
 * while still letting `expect(...).toHaveBeenCalled()` prove whether the
 * write path ran.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), renameSync: vi.fn() };
});

describe("run() aborts before any write primitive fires when assertSane rejects the feed", () => {
  // 3,001 synthetic admin-1 names — over MIN_ADMIN1_NAMES (3,000) — so
  // `assertAdmin1Sane` passes and control actually reaches `assertSane`,
  // rather than the fixture being rejected one gate earlier for an unrelated
  // reason.
  const admin1Text = Array.from({ length: 3_001 }, (_, i) => `XX.${i}\tRegion ${i}`).join("\n");

  // Five well-formed rows across five distinct (fake) countries. `assertSane`
  // requires 246 +/-2 countries, so this is rejected for a real reason: the
  // feed looks nothing like a real GeoNames dump, the same way a truncated or
  // reshaped upstream download would.
  const citiesTsv = [
    tsvRow({ 0: "1001", 1: "Fixture City One", 3: "", 4: "10.0", 5: "10.0", 8: "ZZ", 10: "01", 14: "50000" }),
    tsvRow({ 0: "1002", 1: "Fixture City Two", 3: "", 4: "11.0", 5: "11.0", 8: "YY", 10: "01", 14: "20000" }),
    tsvRow({ 0: "1003", 1: "Fixture City Three", 3: "", 4: "-5.0", 5: "20.0", 8: "XA", 10: "01", 14: "15000" }),
    tsvRow({ 0: "1004", 1: "Fixture City Four", 3: "", 4: "40.0", 5: "-70.0", 8: "WW", 10: "01", 14: "5000" }),
    tsvRow({ 0: "1005", 1: "Fixture City Five", 3: "", 4: "-33.0", 5: "150.0", 8: "VV", 10: "01", 14: "1000" }),
  ].join("\n");

  const scratchDirs: string[] = [];

  afterEach(() => {
    // Cleanup only — created by the real, un-mocked `mkdirSync` the gate runs
    // before either check (a separate, already-tracked Minor finding). Not
    // part of what this test asserts.
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir) rmSyncReal(dir, { recursive: true, force: true });
    }
  });

  function fixtureDirs(): { dataDir: string; shardDir: string } {
    const root = mkdtempSync(pathJoin(tmpdir(), "ingest-cities-gate-test-"));
    scratchDirs.push(root);
    return { dataDir: pathJoin(root, "data"), shardDir: pathJoin(root, "cities") };
  }

  test("never calls writeFileSync or renameSync before assertSane throws", async () => {
    const { dataDir, shardDir } = fixtureDirs();
    const writeMock = vi.mocked(writeFileSync);
    const renameMock = vi.mocked(renameSync);
    writeMock.mockClear();
    renameMock.mockClear();
    await expect(
      run({
        loadCitiesTsv: async () => citiesTsv,
        loadAdmin1Text: async () => admin1Text,
        dataDir,
        shardDir,
      })
    ).rejects.toThrow(/countries produced a shard, expected 246/);
    expect(writeMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });
});
