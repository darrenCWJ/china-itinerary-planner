/**
 * ingest-country-facts — the record build, the fact count, and the
 * per-property demotion and carry-forward rules.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file. Every upstream answer is a
 * fixture.
 *
 * `plugRows` and `entity` come from scripts/country-facts/fixtures.ts, their
 * single home since 2026-09-07: `buildFacts`'s describe builds its `plugs`
 * rows with the first and its `languages` rows with the second, and the picker
 * describes in scripts/country-facts/picks.test.ts read the same declarations
 * rather than a second copy.
 */

import { describe, expect, test } from "vitest";
import {
  RECORD_FIELDS,
  buildFacts,
  carryForwardFields,
  countAnsweredCountries,
  countPreviousCoverage,
  factCount,
  isPropertyAnswerPlausible,
} from "./facts.mjs";
import { entity, plugRows } from "./fixtures";

// ---------------------------------------------------------------------------
// buildFacts
// ---------------------------------------------------------------------------

describe("buildFacts", () => {
  const byProperty = {
    codes: [{ code: "PE" }, { code: "XX" }],
    currency: [{ country: "PE", code: "PEN", name: "Peruvian sol" }],
    plugs: plugRows("NEMA 1-15", "NEMA 5-15", "Europlug").map((row) => ({ ...row, country: "PE" })),
    voltage: [{ country: "PE", value: "220" }],
    drivingSide: [{ country: "PE", value: "right-hand traffic" }],
    emergency: [
      { country: "PE", number: "105", role: "police" },
      { country: "PE", number: "116", role: "fire department" },
      { country: "PE", number: "106", role: "emergency medical services" },
    ],
    languages: [{ country: "PE", item: entity("Q1321"), value: "Spanish" }],
    callingCode: [{ country: "PE", value: "+51" }],
    coordinate: [{ country: "PE", lat: "-9.19" }],
    name: [{ country: "PE", value: "Peru" }],
  };

  test("builds one ordered record per country that has facts", () => {
    const built = buildFacts(byProperty);
    expect(built.countries.PE).toEqual({
      name: "Peru",
      currencyCode: "PEN",
      currencyName: "Peruvian sol",
      plugs: ["A", "B", "C"],
      voltageV: 220,
      drivingSide: "right",
      emergency: [
        { number: "105", role: "police" },
        { number: "116", role: "fire" },
        { number: "106", role: "ambulance" },
      ],
      officialLanguages: ["Spanish"],
      callingCode: "+51",
      lat: -9.19,
    });
  });

  test("puts the name first, so a reader sees which country a record is about", () => {
    // Also the byte-identical-rebuild rule: key order is RECORD_FIELDS order,
    // never insertion order, or a quiet night rewrites the file for nothing.
    expect(Object.keys(buildFacts(byProperty).countries.PE)).toEqual(RECORD_FIELDS);
  });

  test("OMITS a country with no facts rather than writing an empty record", () => {
    // lib/countryProfile.ts already falls through to the neutral profile for a
    // country it has no facts for. An empty record would be a second way of
    // saying the same thing, and the two would drift.
    const built = buildFacts(byProperty);
    expect(Object.keys(built.countries)).toEqual(["PE"]);
  });

  test("OMITS a country that has a name and nothing else, because a name is not a fact", () => {
    // The whole reason `name` is outside FACT_FIELDS: it must not be able to
    // keep an otherwise empty record alive, and it must not move `factCount` —
    // the unit every drift band in the gate is calibrated in.
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "PE" }, { code: "XX" }],
      name: [
        { country: "PE", value: "Peru" },
        { country: "XX", value: "Nowhere" },
      ],
    });
    expect(Object.keys(built.countries)).toEqual(["PE"]);
    expect(factCount(built.countries.PE)).toBe(9);
  });

  test("records the meta-item drop and the withheld name, which a finished record cannot show", () => {
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "PE" }, { code: "GN" }],
      languages: [
        { country: "PE", item: entity("Q1321"), value: "Spanish" },
        { country: "GN", item: entity("Q1339026"), value: "languages of Guinea" },
      ],
      currency: [
        { country: "PE", code: "PEN", name: "Peruvian sol" },
        { country: "GN", code: "GNF", name: "Guinean franc" },
      ],
      name: [
        { country: "PE", value: "Peru" },
        { country: "GN", value: "Guinea" },
        { country: "GN", value: "Republic of Guinea" },
      ],
    });
    expect(built.diagnostics.soleDroppedLanguages).toEqual(["GN"]);
    expect(built.countries.GN.officialLanguages).toBeUndefined();
    expect(built.diagnostics.withheld.name).toEqual(["GN"]);
    expect(built.countries.GN.name).toBeUndefined();
  });

  test("does not uppercase or reshape a country code, so the gate can see a reshape", () => {
    // The lowercase code carries its OWN rows, which is what makes this a pin
    // rather than a restatement. Fed only `[{code:"pe"},{code:"PE"}]` against
    // rows that all say `country: "PE"`, the "pe" record ends up empty and is
    // omitted by `factCount` — so a build that quietly uppercased every code
    // would produce the identical answer and this test would pass through the
    // mutation it names. With rows of its own, "pe" survives as a separate key
    // under the real rule and merges into "PE" under the mutated one.
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "pe" }, { code: "PE" }],
      currency: [
        { country: "PE", code: "PEN", name: "Peruvian sol" },
        { country: "pe", code: "PEN", name: "Peruvian sol" },
      ],
    });
    expect(Object.keys(built.countries).sort()).toEqual(["PE", "pe"]);
    expect(built.countries.pe.currencyCode).toBe("PEN");
  });

  test("records which rule withheld which field", () => {
    const built = buildFacts({
      ...byProperty,
      codes: [{ code: "PE" }, { code: "BZ" }],
      drivingSide: [
        { country: "PE", value: "right-hand traffic" },
        { country: "BZ", value: "right-hand traffic" },
      ],
      voltage: [
        { country: "PE", value: "220" },
        { country: "BZ", value: "550" },
        { country: "BZ", value: "220" },
      ],
      currency: [
        { country: "PE", code: "PEN", name: "Peruvian sol" },
        { country: "BZ", code: "PLN", name: "złoty" },
        { country: "BZ", code: "PLZ", name: "Polish zloty" },
      ],
    });
    expect(built.diagnostics.withheld.voltage).toEqual(["BZ"]);
    expect(built.diagnostics.withheld.currency).toEqual(["BZ"]);
    expect(built.countries.BZ.voltageV).toBeUndefined();
  });
});

describe("factCount", () => {
  test("counts only fields that are actually present", () => {
    expect(factCount({ currencyCode: "PEN", plugs: ["A"] })).toBe(2);
    expect(factCount({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-property demotion and carry-forward
// ---------------------------------------------------------------------------

describe("per-property demotion", () => {
  test("a first run has no previous coverage and accepts any answer", () => {
    expect(isPropertyAnswerPlausible(0, 0)).toBe(true);
  });

  test("an answer covering less than 80% of last run's countries is not an answer", () => {
    expect(isPropertyAnswerPlausible(195, 246)).toBe(false);
    expect(isPropertyAnswerPlausible(197, 246)).toBe(true);
  });

  test("counts previous coverage per FIELD GROUP, not per country", () => {
    const previous = {
      countries: {
        PE: { currencyCode: "PEN", currencyName: "Peruvian sol" },
        CN: { plugs: ["A"] },
      },
    };
    expect(countPreviousCoverage(previous, ["currencyCode", "currencyName"])).toBe(1);
    expect(countPreviousCoverage(previous, ["plugs"])).toBe(1);
    expect(countPreviousCoverage(null, ["plugs"])).toBe(0);
  });

  test("counts distinct countries in an answer, not rows", () => {
    expect(
      countAnsweredCountries([
        { country: "PE", value: "a" },
        { country: "PE", value: "b" },
        { country: "CN", value: "c" },
      ])
    ).toBe(2);
  });
});

/** What `buildFacts` returns, loosened so a test can hand-build a fixture. */
type Built = {
  countries: Record<string, Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
};

describe("carryForwardFields", () => {
  const previous = {
    countries: {
      PE: { currencyCode: "PEN", currencyName: "Peruvian sol", plugs: ["A", "B", "C"] },
      CN: { plugs: ["A", "C", "I"] },
    },
  };

  test("restores a demoted property's previous values instead of deleting them", () => {
    const built: Built = {
      countries: { PE: { currencyCode: "PEN", currencyName: "Peruvian sol" }, CN: { currencyCode: "CNY", currencyName: "renminbi" } },
      diagnostics: {},
    };
    carryForwardFields(built, previous, ["plugs"]);
    expect(built.countries.PE.plugs).toEqual(["A", "B", "C"]);
    expect(built.countries.CN.plugs).toEqual(["A", "C", "I"]);
  });

  test("discards the demoted property's own partial answer rather than merging it", () => {
    // A result set already judged untrustworthy is not a better source than
    // the last state that passed every gate, and mixing the two produces a
    // record no run ever verified as a whole.
    const built: Built = { countries: { PE: { plugs: ["G"] } }, diagnostics: {} };
    carryForwardFields(built, previous, ["plugs"]);
    expect(built.countries.PE.plugs).toEqual(["A", "B", "C"]);
  });

  test("does not invent a country the previous artifact never had", () => {
    const built: Built = { countries: { PE: { currencyCode: "PEN", currencyName: "sol" } }, diagnostics: {} };
    carryForwardFields(built, previous, ["plugs"]);
    expect(built.countries.JP).toBeUndefined();
  });

  test("a first run has nothing to carry and leaves the build alone", () => {
    const built: Built = { countries: { PE: { plugs: ["A"] } }, diagnostics: {} };
    carryForwardFields(built, null, ["plugs"]);
    expect(built.countries.PE.plugs).toEqual(["A"]);
  });
});

