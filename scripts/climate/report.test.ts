/**
 * ingest-climate — the report's `## Measured ranges` block.
 *
 * Moved out of scripts/ingest-climate.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-climate.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import path moved with it.
 */

import { describe, expect, test } from "vitest";
import { measuredRanges } from "./report.mjs";

describe("measuredRanges", () => {
  /** A row of five constant blocks, so a fixture reads as five numbers. */
  const flat = (lo: number, hi: number, precip: number, cloud: number, td: number): number[] => [
    ...Array<number>(12).fill(lo),
    ...Array<number>(12).fill(hi),
    ...Array<number>(12).fill(precip),
    ...Array<number>(12).fill(cloud),
    ...Array<number>(12).fill(td),
  ];

  /** One block's line, split on whitespace, so the padding is not the subject. */
  const fields = (lines: string[], label: string): string[] => {
    const line = lines.find((l) => l.startsWith(`${label} `));
    expect(line, `no ${label} line among ${JSON.stringify(lines)}`).toBeDefined();
    return line!.trim().split(/\s+/);
  };

  test("takes each block's min and max across rows, never within one", () => {
    // G1 holds the lo floor and the td floor, G2 every ceiling: a min/max
    // taken per ROW, or over the flat 60 ints, would blend the five blocks
    // into one range and still look like a plausible report.
    const lines = measuredRanges([
      ["G1", flat(-46, 12, 0, 0, -43)],
      ["G2", flat(0, 47, 2476, 93, 24)],
      ["G3", flat(-5, 20, 100, 50, 0)],
    ]);
    expect(fields(lines, "lo")).toEqual(["lo", "-46..0", "°C"]);
    expect(fields(lines, "hi")).toEqual(["hi", "12..47", "°C"]);
    expect(fields(lines, "precip")).toEqual(["precip", "0..2476", "mm/month"]);
    expect(fields(lines, "cloud")).toEqual(["cloud", "0..93", "%"]);
    expect(fields(lines, "td")).toEqual(["td", "-43..24", "°C"]);
    expect(lines.join("\n")).toMatch(/^36 city-months, of which \*\*0\*\* have/m);
  });

  test("counts the months where lo exceeds hi, which no single band would catch", () => {
    // 20 and 10 are both well inside the parser's -90..60 band, so only the
    // cross-field check sees the inversion — the shape a build that scaled
    // tasmin and tasmax differently would take.
    const lines = measuredRanges([
      ["G1", flat(0, 10, 0, 0, 0)],
      ["G2", flat(20, 10, 0, 0, 0)],
    ]);
    expect(lines.join("\n")).toMatch(/^24 city-months, of which \*\*12\*\* have/m);
  });

  test("returns a whole section, heading first and blank-terminated", () => {
    // buildReport splices these lines straight in ahead of '## Rasters', so
    // the trailing blank is the section separator, not decoration.
    const lines = measuredRanges([["G1", flat(0, 10, 0, 0, 0)]]);
    expect(lines[0]).toBe("## Measured ranges");
    expect(lines[1]).toBe("");
    expect(lines.at(-1)).toBe("");
  });

  test("refuses an empty row set rather than reporting Infinity..-Infinity", () => {
    // Every block's min/max starts at the opposite infinity; with no rows to
    // narrow it, that starting point is what would otherwise reach the
    // committed report.
    expect(() => measuredRanges([])).toThrow(/no rows to measure/);
  });
});
