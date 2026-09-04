import { describe, expect, test } from "vitest";
import { climateGapNote, DERIVED_CLIMATE_NOTE } from "./climateNote";

describe("climateGapNote", () => {
  test("renders nothing for China, whose climate is hand-authored, however it is spelled", () => {
    for (const code of ["CN", "cn", " cn "]) {
      expect(climateGapNote(code, 412), code).toEqual([]);
    }
  });

  test("renders nothing where no derived row was read", () => {
    // A country whose climate file 404s, or one whose shard has not landed
    // yet: grey pins carry no claim, so there is nothing to be honest about.
    expect(climateGapNote("PE", 0)).toEqual([]);
    expect(climateGapNote("PE", -1)).toEqual([]);
    expect(climateGapNote("PE", Number.NaN)).toEqual([]);
  });

  test("says what the derived figures are, in the spec's own words", () => {
    const lines = climateGapNote("PE", 750);
    expect(lines).toEqual([DERIVED_CLIMATE_NOTE]);
    // §9.7, verbatim: the three claims a reader needs to weigh a grey-to-green
    // pin — grid not station, the mountain bias, and what is not modelled.
    expect(DERIVED_CLIMATE_NOTE).toContain("1981–2010 grid normals sampled at each city, not station records");
    expect(DERIVED_CLIMATE_NOTE).toContain("above 2,000 m typically read about 3–4 °C colder");
    expect(DERIVED_CLIMATE_NOTE).toContain("coastal fog and monsoon timing are not modelled");
  });

  test("a fresh array each call", () => {
    // GapNote keys its paragraphs on the line text and never mutates, but a
    // shared array is a shared array: the same policy every profile table in
    // lib/countryBaseProfile.ts takes.
    expect(climateGapNote("PE", 1)).not.toBe(climateGapNote("PE", 1));
  });
});
