/**
 * ingest-country-facts — `CURATED_FACTS`, the hand-verified overrides.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture.
 *
 * `entity` and `CURATED_UPSTREAM` come from
 * scripts/country-facts/fixtures.ts, their single home since 2026-09-07:
 * `CURATED_UPSTREAM` builds its `languages` rows with `entity`, and
 * `healthyFeed` in scripts/country-facts/runHarness.ts enumerates the same
 * table to give every curated country its measured upstream shape — from the
 * one declaration now, not from a copy apiece.
 */

import { describe, expect, test } from "vitest";
import { CURATED_FACTS } from "./curated.mjs";
import { applyCurated, buildFacts, factCount } from "./facts.mjs";
import { CURATED_UPSTREAM, entity } from "./fixtures";

// ---------------------------------------------------------------------------
// CURATED_FACTS
// ---------------------------------------------------------------------------

describe("CURATED_FACTS", () => {
  test("every shipped row fires against the measured upstream shape that caused its withhold", () => {
    // The CURATED_HEROES rule: a hand-verified value is only honest while it
    // is actually needed. A row that never fires is a claim nobody re-checks.
    for (const [code, overrides] of Object.entries(CURATED_FACTS)) {
      const upstream = CURATED_UPSTREAM[code];
      expect(upstream, `no measured upstream shape recorded for ${code}`).toBeDefined();
      const built = buildFacts({
        codes: [{ code }],
        currency: (upstream.currency ?? []).map(([c, name]) => ({ country: code, code: c, name })),
        voltage: (upstream.voltage ?? []).map((value) => ({ country: code, value })),
        languages: (upstream.languages ?? []).map(([item, value, scoped]) => ({
          country: code,
          item: entity(item),
          value,
          scoped,
        })),
        // Wired from the fixture like the three above, so a row covering one
        // of these fields is proven to fire against the shape that withheld
        // it. Left unwired, `before?.[field]` would be undefined because
        // nothing was SUPPLIED, and the assertion below would pass for a
        // reason that has nothing to do with the withhold.
        name: (upstream.name ?? []).map((value) => ({ country: code, value })),
        emergency: (upstream.emergency ?? []).map(([number, role]) => ({
          country: code,
          number,
          role,
        })),
        coordinate: (upstream.coordinate ?? []).map((lat) => ({ country: code, lat })),
        drivingSide: [{ country: code, value: "right-hand traffic" }],
      });
      const before = built.countries[code] as Record<string, unknown> | undefined;
      for (const field of Object.keys(overrides)) {
        expect(before?.[field], `${code}.${field} was not withheld upstream`).toBeUndefined();
      }
      applyCurated(built);
      expect(built.diagnostics.curatedStale).toEqual([]);
      const after = built.countries[code] as Record<string, unknown>;
      for (const [field, value] of Object.entries(overrides)) {
        expect(built.diagnostics.curatedFired).toContain(`${code}.${field}`);
        expect(after[field]).toEqual(value);
      }
    }
  });

  test("the shipped rows are exactly the six currencies, the one voltage and the two languages", () => {
    expect(Object.keys(CURATED_FACTS).sort()).toEqual(["AZ", "BA", "BE", "FR", "MO", "NL", "PL", "ZW"]);
    expect(CURATED_FACTS.FR.voltageV).toBe(230);
    // The two rescued by hand from the territorial-scope rule, VALUE and all.
    // Belgium's constitutional trio, and Azerbaijan's single state language
    // WITHOUT the sign language the unscoped remainder would have left alone.
    expect(CURATED_FACTS.BE.officialLanguages).toEqual(["Dutch", "French", "German"]);
    expect(CURATED_FACTS.AZ.officialLanguages).toEqual(["Azerbaijani"]);
  });

  test("a curated language row rescues the field the scope rule withheld, end to end", () => {
    // The claim the previous repair was abandoned on — that `CURATED_FACTS`
    // could not reach a withheld field "since applyCurated marks a row stale
    // when the field is present" — driven rather than argued. A withheld field
    // is ABSENT, `applyCurated` keys on `!== undefined`, so the row fires. If
    // the withhold ever stops firing this goes red as STALE instead, which is
    // the whole point of the pair.
    const built = buildFacts({
      codes: [{ code: "BE" }],
      drivingSide: [{ country: "BE", value: "right-hand traffic" }],
      languages: [
        { country: "BE", item: entity("Q7411"), value: "Dutch", scoped: "true" },
        { country: "BE", item: entity("Q150"), value: "French", scoped: "true" },
        { country: "BE", item: entity("Q188"), value: "German", scoped: "true" },
      ],
    });
    expect(built.diagnostics.scopedLanguages).toContain("BE");
    expect(built.countries.BE.officialLanguages).toBeUndefined();
    applyCurated(built);
    expect(built.countries.BE.officialLanguages).toEqual(["Dutch", "French", "German"]);
    expect(built.diagnostics.curatedFired).toContain("BE.officialLanguages");
    expect(built.diagnostics.curatedStale).toEqual([]);
  });

  test("the NL split was undone upstream: name, emergency and lat come from Wikidata again, and only the currency rows fire", () => {
    // THE SHAPE THAT TOOK THE NIGHTLY JOB DOWN, and how it ended. At
    // 2026-08-28T09:46:29Z Q55 "Netherlands"'s `P297 = "NL"` was promoted from
    // deprecated to normal rank beside Q29999, `wdt:P297` matched both items,
    // and three curated rows restored the name, emergency number and latitude
    // the single-valued pickers withheld. At 2026-09-22T00:49:30Z the edit was
    // undone as vandalism, those rows went STALE on that night's run — the
    // gate's `no longer fire` refusal, exactly as written — and were deleted.
    //
    // The measured shape after the revert, NL only: one name, one number,
    // one point, and still the four currencies.
    const built = buildFacts({
      codes: [{ code: "NL" }],
      name: [{ country: "NL", value: "Kingdom of the Netherlands" }],
      currency: [
        { country: "NL", code: "EUR", name: "euro" },
        { country: "NL", code: "USD", name: "United States dollar" },
        { country: "NL", code: "AWG", name: "Aruban florin" },
        { country: "NL", code: "XCG", name: "Caribbean guilder" },
      ],
      emergency: [{ country: "NL", number: "112", role: "" }],
      coordinate: [{ country: "NL", lat: "52.366666666667" }],
      drivingSide: [{ country: "NL", value: "right-hand traffic" }],
    });
    // The same three values the deleted rows carried, now from upstream — so
    // deleting them moved nothing in the artifact.
    expect(built.countries.NL.name).toBe("Kingdom of the Netherlands");
    expect(built.countries.NL.emergency).toEqual([{ number: "112", role: null }]);
    expect(built.countries.NL.lat).toBe(52.366666666667);
    expect(built.countries.NL.currencyCode).toBeUndefined();

    applyCurated(built);
    expect(built.diagnostics.curatedStale).toEqual([]);
    expect(built.diagnostics.curatedFired.filter((row) => row.startsWith("NL."))).toEqual([
      "NL.currencyCode",
      "NL.currencyName",
    ]);
    expect(built.countries.NL.currencyCode).toBe("EUR");
    // drivingSide, emergency, lat and the two currency facts: the same five
    // the split's rescue reached, with three of them now from upstream. The
    // name is identity, not a fact, so `factCount` never counted it.
    expect(factCount(built.countries.NL)).toBe(5);
  });

  test("an override upstream has since made redundant is reported STALE, not applied silently", () => {
    const built = buildFacts({
      codes: [{ code: "NL" }],
      currency: [{ country: "NL", code: "EUR", name: "euro" }],
    });
    applyCurated(built);
    expect(built.diagnostics.curatedStale).toContain("NL.currencyCode");
    expect(built.diagnostics.curatedFired).not.toContain("NL.currencyCode");
  });

  test("applyCurated leaves the country keys sorted, so a rebuild is byte-identical", () => {
    const built = buildFacts({ codes: [{ code: "ZW" }, { code: "AA" }], currency: [{ country: "AA", code: "AAA", name: "test" }] });
    applyCurated(built);
    expect(Object.keys(built.countries)).toEqual([...Object.keys(built.countries)].sort());
  });
});

