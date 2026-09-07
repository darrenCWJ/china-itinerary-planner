/**
 * ingest-climate — the shard and index payloads.
 *
 * Moved out of scripts/ingest-climate.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-climate.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import path moved with it.
 */

import { describe, expect, test } from "vitest";
import { climatePayload, indexPayload } from "./payload.mjs";

describe("climatePayload", () => {
  const rows = { G1: Array.from({ length: 60 }, (_, i) => i) };
  const now = "2026-09-04T00:00:00.000Z";

  test("writes the envelope the loader reads, in that order", () => {
    const payload = climatePayload("PE", rows, null, now);
    expect(Object.keys(payload)).toEqual(["country", "generatedAt", "source", "cities"]);
    expect(payload.country).toBe("PE");
    expect(payload.source).toMatch(/CHELSA V2\.1/);
    expect(payload.cities).toBe(rows);
  });

  test("stamps generatedAt on a first build", () => {
    expect(climatePayload("PE", rows, null, now).generatedAt).toBe(now);
  });

  test("keeps the previous timestamp when the rows are unchanged", () => {
    // 246 files whose only difference is a timestamp is 246 diffs of noise,
    // and it hides the one file that really did change.
    const before = climatePayload("PE", rows, null, "2026-01-01T00:00:00.000Z");
    expect(climatePayload("PE", rows, before, now).generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("restamps when a single integer of a single month moves", () => {
    const before = climatePayload("PE", rows, null, "2026-01-01T00:00:00.000Z");
    const nudged = { G1: rows.G1.map((v, i) => (i === 37 ? v + 1 : v)) };
    expect(climatePayload("PE", nudged, before, now).generatedAt).toBe(now);
  });

  test("restamps when a city is added", () => {
    // The row SET is the artifact. A country that gained a city has changed
    // even though every row it already had is identical.
    const before = climatePayload("PE", rows, null, "2026-01-01T00:00:00.000Z");
    expect(climatePayload("PE", { ...rows, G2: rows.G1 }, before, now).generatedAt).toBe(now);
  });

  test("compares the rows only, never the envelope", () => {
    // If the comparison included generatedAt it could never match, and the
    // guard would be dead code that looks alive.
    const before = { ...climatePayload("PE", rows, null, now), source: "something else" };
    expect(climatePayload("PE", rows, before, "2026-12-31T00:00:00.000Z").generatedAt).toBe(now);
  });
});

describe("indexPayload", () => {
  const countries = [{ code: "AD", count: 20 }, { code: "PE", count: 750 }];
  const now = "2026-09-04T00:00:00.000Z";

  test("keeps the previous timestamp when the listing is unchanged", () => {
    // The one place this build departs from build-provinces.mjs, which stamps
    // its index unconditionally. That is safe for a hand-run script, because
    // someone is looking at the diff. Spec 9.2 gives this artifact a
    // workflow_dispatch over decadal normals, so most runs change nothing at
    // all — and an unchanged run has to produce a byte-identical tree, or
    // every dispatch commits one line of pure noise in the one file a
    // reviewer opens first.
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    expect(before.generatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(indexPayload(countries, before, now).generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("restamps when a country's city count changes", () => {
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    const grown = [{ code: "AD", count: 21 }, { code: "PE", count: 750 }];
    expect(indexPayload(grown, before, now).generatedAt).toBe(now);
  });

  test("restamps when a country appears or disappears", () => {
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    expect(indexPayload(countries.slice(0, 1), before, now).generatedAt).toBe(now);
  });

  test("restamps when a shard's rows changed even though the listing did not", () => {
    // A CHELSA erratum — the one event refresh-climate.yml's header names as
    // a reason to dispatch — rewrites rows in every shard and adds or removes
    // no city at all, so the {code, count} listing comes out identical. On the
    // listing alone all 246 shards would restamp while this index, and
    // data/climate-report.md's `Generated:` line with it, kept the previous
    // decade's date.
    const before = indexPayload(countries, null, "2026-01-01T00:00:00.000Z");
    expect(indexPayload(countries, before, now, 246).generatedAt).toBe(now);
    expect(indexPayload(countries, before, now, 1).generatedAt).toBe(now);
    // Zero changed shards is still the quiet case, which is the whole point
    // of preserving the stamp at all.
    expect(indexPayload(countries, before, now, 0).generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
