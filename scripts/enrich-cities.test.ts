/**
 * enrich-cities — the entry point: that every gate runs before the first byte
 * is written, and that the wipe paths they exist for really are closed.
 *
 * The pure functions this file used to cover moved to `scripts/enrich/` with
 * the code they test on 2026-09-07 (spec 2026-09-07-unscheduled-items §2.1) —
 * `plan.test.ts` for the query, the merge, `planCountry` and the five gates,
 * `io.test.ts` for the SPARQL 404. What stays is what tests `run` itself: a
 * gate's BODY was fully covered while deleting the one line that invokes it
 * left the suite green and produced a complete wipe at exit 0, so the call
 * sites are the thing these tests hold.
 *
 * The module's entry-point guard means importing it here does not also start
 * the enrichment and talk to Wikidata.
 */

import { describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------
// The guards, driven end to end through run()
//
// `vi.spyOn` cannot touch `node:fs` here — Vitest's ESM module namespace for a
// Node builtin is non-configurable, so `vi.spyOn(fs, "writeFileSync")` throws
// "Cannot redefine property" before the test body runs. `vi.mock` with
// `importOriginal` is Vitest's own prescribed workaround, and the same one
// scripts/ingest-cities.test.ts uses: every other primitive stays real, and
// only the two that actually commit bytes to disk become no-op spies. Fixture
// files are written through `node:fs/promises`, which this mock does not
// touch.
// ---------------------------------------------------------------------------

import { renameSync, rmSync as rmSyncReal, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename as pathBasename, join as pathJoin } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { run } from "./enrich-cities.mjs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), renameSync: vi.fn() };
});

const scratch: string[] = [];

function cc(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `${alphabet[Math.floor(index / 26)]}${alphabet[index % 26]}`;
}

/** Deterministic, well-formed GeoNames ids: country index and rank, encoded. */
function idsFor(countryIndex: number, count: number): string[] {
  return Array.from({ length: count }, (_, rank) => `G${1_000_000 + countryIndex * 1_000 + rank}`);
}

function bindingsFor(ids: string[], { empty = false } = {}) {
  return ids.map((id) =>
    empty
      ? { gid: { value: id.slice(1) } }
      : {
          gid: { value: id.slice(1) },
          title: { value: `Title ${id}` },
          desc: { value: `wikidata short description for ${id}` },
          img: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/${id}.jpg` },
        }
  );
}

/** Rank of a fixture id inside its country's target list. */
function rankOf(id: string): number {
  return Number(id.slice(1)) % 1_000;
}

function countryIndexOf(id: string): number {
  return Math.floor((Number(id.slice(1)) - 1_000_000) / 1_000);
}

function rankBelow(limit: number) {
  return (id: string) => rankOf(id) < limit;
}

/** The ids a query asked about, read back out of its VALUES clause. */
function askedIds(query: string): string[] {
  return [...query.matchAll(/"(\d+)"/g)].map((match) => `G${match[1]}`);
}

const fullExtracts = async (titles: string[]) =>
  new Map(titles.map((title) => [title, `${title} is a city in the fixture. It has a second sentence.`]));

async function fixture({
  countries,
  perCountry,
  previousPerCountry,
  corrupt = [],
}: {
  countries: number;
  perCountry: number;
  previousPerCountry: (code: string, index: number) => number;
  corrupt?: string[];
}) {
  const root = await mkdtemp(pathJoin(tmpdir(), "enrich-cities-run-"));
  scratch.push(root);
  const enrichDir = pathJoin(root, "enrich");
  await mkdir(enrichDir, { recursive: true });

  const targets: Record<string, string[]> = {};
  for (let index = 0; index < countries; index++) targets[cc(index)] = idsFor(index, perCountry);
  const targetsPath = pathJoin(root, "cities-enrich-targets.json");
  await writeFile(targetsPath, JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", targets }), "utf8");

  for (let index = 0; index < countries; index++) {
    const code = cc(index);
    if (corrupt.includes(code)) {
      await writeFile(pathJoin(enrichDir, `${code}.json`), '{"country":"AA","cities":{', "utf8");
      continue;
    }
    const cities: Record<string, { description: string; image: string }> = {};
    for (const id of idsFor(index, previousPerCountry(code, index))) {
      cities[id] = { description: `previously committed ${id}`, image: `https://x/${id}.jpg?width=640` };
    }
    await writeFile(
      pathJoin(enrichDir, `${code}.json`),
      JSON.stringify({ country: code, generatedAt: "2026-01-01T00:00:00.000Z", source: "fixture", cities }),
      "utf8"
    );
  }
  return { targetsPath, enrichDir, targets };
}

function writtenFiles() {
  return vi.mocked(writeFileSync).mock.calls.map((call) => ({
    country: pathBasename(String(call[0])).replace(/\.tmp-\d+$/, "").replace(/\.json$/, ""),
    payload: JSON.parse(String(call[1])) as { cities: Record<string, unknown> },
  }));
}

describe("run() — the wipe path the guards must close", () => {
  beforeEach(() => {
    vi.mocked(writeFileSync).mockClear();
    vi.mocked(renameSync).mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (scratch.length > 0) {
      const dir = scratch.pop();
      if (dir) rmSyncReal(dir, { recursive: true, force: true });
    }
  });

  test("C3: a batch that answers 200 with a third of its rows deletes nothing", async () => {
    // The middle of the hazard. The HTTP call did not throw, so guard 1 counts
    // every id in the batch as answered; the response simply omitted most of
    // them. Every omitted id is then deleted, committed and deployed, while
    // the global floor sits far above the damage. A short body is an outage,
    // not an answer.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) => {
        const ids = askedIds(query);
        // Batch 1 (150 ids) answers in full; batch 2 (30 ids) returns 10 rows.
        return bindingsFor(ids.length > 30 ? ids : ids.slice(0, 10));
      },
    });
    const shortBatched = writtenFiles().find((file) => file.country === cc(5));
    expect(Object.keys(shortBatched?.payload.cities ?? {})).toHaveLength(30);
  });

  test("I2: a previous file that exists but does not parse aborts before any write", async () => {
    // `readJson` returns null for both "missing" and "unparseable", so a
    // corrupt file reads as previousTotal 0 — which is exactly the input that
    // makes the coverage gate early-return "a first run has nothing to lose".
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
      corrupt: Array.from({ length: 6 }, (_, index) => cc(index)),
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: fullExtracts,
        fetchBindings: async (query: string) => bindingsFor(askedIds(query), { empty: true }),
      })
    ).rejects.toThrow(/not valid JSON/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(renameSync)).not.toHaveBeenCalled();
  });

  test("C2: the coverage gate's CALL SITE, not just its body, stops the write", async () => {
    // The function was fully tested and the line that invokes it was not, so
    // deleting that one line left the suite green and produced the complete
    // `{"cities":{}}` wipe at exit 0. This is the mutant killer: a scenario
    // tuned so ONLY the global floor can fire — every country loses exactly
    // 20%, which the per-country gate permits, while the total falls to 80%,
    // which the global floor does not.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: fullExtracts,
        fetchBindings: async (query: string) => bindingsFor(askedIds(query).filter(rankBelow(24))),
      })
    ).rejects.toThrow(/under the 95% floor/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
    expect(vi.mocked(renameSync)).not.toHaveBeenCalled();
  });

  test("C3/I1: one country emptied inside a healthy global ratio still stops the write", async () => {
    // 30 countries, one of them zeroed: global coverage reads 96.7%, above the
    // floor, and the batch carrying it answers for 120 of the 150 ids it asked
    // about — exactly the ratio the batch check accepts. Only a per-country
    // floor can see this; without one the country is deleted and deployed.
    const { targetsPath, enrichDir } = await fixture({
      countries: 30,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: fullExtracts,
        fetchBindings: async (query: string) =>
          bindingsFor(askedIds(query).filter((id) => countryIndexOf(id) !== 0)),
      })
    ).rejects.toThrow(/AA 0\/30/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  test("I4: a Wikipedia outage is refused even though the record count is perfect", async () => {
    // Wikidata healthy, the Action API down: every description silently
    // becomes the Wikidata one-liner and not one record is lost, so every
    // count-based gate reports a flawless run.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 30,
    });
    await expect(
      run({
        targetsPath,
        enrichDir,
        argv: [],
        loadExtracts: async (titles: string[]) => new Map(titles.map((title) => [title, null])),
        fetchBindings: async (query: string) => bindingsFor(askedIds(query)),
      })
    ).rejects.toThrow(/fell back to the Wikidata one-liner/);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  test("the healthy path at the yield this catalog actually produces is written", async () => {
    // 25 of 30 per country — 83%, the live run's 82.0% to within a city — must
    // not look like an outage to any of the five gates.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 25,
    });
    const summary = await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) => bindingsFor(askedIds(query).filter(rankBelow(25))),
    });
    expect(summary.nextTotal).toBe(150);
    expect(summary.unasked).toBe(0);
    expect(writtenFiles()).toHaveLength(6);
    for (const file of writtenFiles()) expect(Object.keys(file.payload.cities)).toHaveLength(25);
  });

  test("a single country at low yield inside a healthy mix is written", async () => {
    // Switzerland's real shape: 14 of 30, while its neighbours run at 30 of
    // 30. A per-country floor reading yield against the TARGET count rather
    // than against the country's own previous file would reject this catalog
    // every single night.
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: (_code, index) => (index === 0 ? 14 : 30),
    });
    const summary = await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) =>
        bindingsFor(askedIds(query).filter((id) => (countryIndexOf(id) === 0 ? rankOf(id) < 14 : true))),
    });
    expect(summary.nextTotal).toBe(164);
    expect(summary.countryReport[0]).toMatchObject({ country: "AA", previousCount: 14, nextCount: 14 });
  });

  test("I3: every target id lands in exactly one disposition bucket", async () => {
    // The live run reported "82.0% of 6,245" and nothing else, so the missing
    // 1,127 were explained by guesswork — and explained wrong. These counts
    // are what tells "Wikidata has no P1566 row" apart from "it had one and
    // carried nothing usable" apart from "we never got a straight answer".
    const { targetsPath, enrichDir } = await fixture({
      countries: 6,
      perCountry: 30,
      previousPerCountry: () => 28,
    });
    const summary = await run({
      targetsPath,
      enrichDir,
      argv: [],
      loadExtracts: fullExtracts,
      fetchBindings: async (query: string) => {
        const ids = askedIds(query);
        return [
          ...bindingsFor(ids.filter(rankBelow(28))),
          // Matched, but carrying neither a description nor an image.
          ...bindingsFor(ids.filter((id) => rankOf(id) === 28), { empty: true }),
          // Rank 29 is simply absent: no P1566 row at all.
        ];
      },
    });
    expect(summary.dispositions).toEqual({
      asked: 180,
      unasked: 0,
      found: 168,
      noMatch: 6,
      droppedEmpty: 6,
    });
    expect(summary.batchReport.every((batch) => batch.accepted)).toBe(true);
    expect(summary.extracts).toEqual({ requested: 168, resolved: 168, fallback: 0 });
  });
});
