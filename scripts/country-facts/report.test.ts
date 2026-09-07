/**
 * ingest-country-facts — `buildReport`, which writes
 * data/country-facts-report.md.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture.
 */

import { describe, expect, test } from "vitest";
import { buildReport } from "./report.mjs";

// ---------------------------------------------------------------------------
// buildReport
// ---------------------------------------------------------------------------

describe("buildReport", () => {
  const countries = { PE: { currencyCode: "PEN", lat: -9 }, SH: { lat: -15.9 } };

  test("states the CC0 licence and that no UI credit is added, and why", () => {
    const report = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    expect(report).toContain("CC0-1.0");
    expect(report).toContain("No UI credit is added for this source");
    expect(report).toContain("GeoNamesCredit.tsx");
  });

  test("carries the measurement behind each refusal, so it is not re-litigated", () => {
    const report = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    expect(report).toContain("## Not derivable");
    expect(report).toMatch(/high-speed railway line/);
    expect(report).toMatch(/204 of 246/);
  });

  test("has no per-run counts, so a quiet rebuild is byte-identical", () => {
    const first = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    const second = buildReport({ countries, generatedAt: "2026-08-27T00:00:00.000Z" });
    expect(first).toBe(second);
    expect(first).not.toMatch(/changed (this run|tonight)/i);
  });

  test("the withheld-language list is derived from the artifact, not a frozen literal", () => {
    // The defect: the bullet said "AF, AZ, BE, BQ, PW and US" — six — while the
    // artifact beside it withheld NINE, because the three countries upstream
    // states no language for at all were never in a sentence that claimed to
    // explain the gap. A hand-written copy of what a rule did drifts the first
    // time anything moves. Here the report is handed one country withheld for
    // each reason and has to name both.
    const report = buildReport({
      countries: {
        PE: { officialLanguages: ["Spanish"] },
        US: { currencyCode: "USD" },
        UY: { currencyCode: "UYU" },
      },
      generatedAt: "2026-08-27T00:00:00.000Z",
      scopedLanguages: ["US"],
    });
    expect(report).toContain("**Official languages for 2 of the 3 countries.**");
    expect(report).toMatch(/1 because every P37 statement upstream gives them is qualified/);
    expect(report).toMatch(/1 because upstream states no official language at all/);
    // And each country lands under the reason that actually applies to it. The
    // scoped bullet is the one that names US; the unstated bullet names UY.
    const scopedAt = report.indexOf("applies to part");
    const unstatedAt = report.indexOf("no official language at all");
    expect(report.slice(scopedAt, unstatedAt)).toMatch(/^\s{4}US$/m);
    expect(report.slice(unstatedAt)).toMatch(/^\s{4}UY$/m);
    // And PE is in none of the three lists, because it has its languages. The
    // whole-set line is asserted verbatim rather than by absence, so a build
    // that listed every country would fail here rather than pass by omission.
    expect(report).toMatch(/^\s{2}US, UY$/m);
  });

  test("a demoted P37 query withholds the SPLIT rather than guessing at it", () => {
    // `scopedLanguages: null` is "not measured this run", which is a different
    // thing from "nothing was scoped". On a night the P37 query is demoted and
    // its values carried forward, the artifact still withholds the same
    // countries while the diagnostic is empty — so attributing all of them to
    // "upstream states none" would be the frozen list's failure with extra
    // steps. The countries are still named; only the reason is withheld.
    const report = buildReport({
      countries: { PE: { officialLanguages: ["Spanish"] }, US: { currencyCode: "USD" } },
      generatedAt: "2026-08-27T00:00:00.000Z",
      scopedLanguages: null,
    });
    expect(report).toContain("**Official languages for 1 of the 2 countries.**");
    expect(report).toContain("Why each one is withheld is not stated this run");
    expect(report).not.toMatch(/because upstream states no official language at all/);
    expect(report).toMatch(/^\s{2}US$/m);
  });

  test("says nothing about withheld languages when nothing is withheld", () => {
    // The arming case for the two above: the bullet is not boilerplate that
    // renders regardless, so a build where the rule stopped firing does not
    // print a paragraph explaining a gap that is not there.
    const report = buildReport({
      countries: { PE: { officialLanguages: ["Spanish"] } },
      generatedAt: "2026-08-27T00:00:00.000Z",
      scopedLanguages: [],
    });
    expect(report).not.toMatch(/Official languages for/);
  });
});

