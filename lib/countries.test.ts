import { describe, expect, test } from "vitest";
import { getCountry, isCountryCode, uningestedCountryName } from "./countries";

describe("getCountry", () => {
  test("returns the curated record for China", () => {
    const cn = getCountry("CN");

    expect(cn.code).toBe("CN");
    expect(cn.name).toBe("China");
    expect(cn.localName).toBe("中国");
    expect(cn.mark).toBe("同行");
    expect(cn.hemisphere).toBe("north");
    expect(typeof cn.accentHue).toBe("number");
  });

  test("normalises a lowercase code to the same record", () => {
    expect(getCountry("cn")).toEqual(getCountry("CN"));
  });

  test("synthesises a neutral record for an unknown code", () => {
    const unknown = getCountry("XZ");

    expect(unknown.code).toBe("XZ");
    expect(unknown.name).toBe("XZ");
    expect(unknown.localName).toBeNull();
    expect(unknown.hemisphere).toBe("north");
    expect(unknown.accentHue).toBeUndefined();
    expect(unknown.mark).toBeUndefined();
  });

  test("never throws on garbage input", () => {
    // Total function: callers render whatever comes back rather than branching
    // on undefined, so a bad code must degrade instead of crashing a page.
    for (const bad of ["", "   ", "CHN", "1", "🙂"]) {
      expect(() => getCountry(bad)).not.toThrow();
      expect(getCountry(bad).localName).toBeNull();
    }
  });

  test("knows which countries sit in the southern hemisphere", () => {
    // Drives hemisphere-aware seasons — the northern-only assumption in
    // seasonOfMonth is what this data exists to fix.
    expect(getCountry("AU").hemisphere).toBe("south");
    expect(getCountry("NZ").hemisphere).toBe("south");
    expect(getCountry("AR").hemisphere).toBe("south");
    expect(getCountry("ZA").hemisphere).toBe("south");
    expect(getCountry("JP").hemisphere).toBe("north");
  });
});

describe("uningestedCountryName", () => {
  // The accessor lib/countryFacts.ts reads `UNINGESTED_NAMES` through, shaped
  // like `curatedCountryName` beside it so both resolvers see the same rows.
  // lib/countryFacts.test.ts owns the question of WHICH rows; this owns the
  // narrower one of what the function returns.
  test("answers for the four codes nothing else names", () => {
    expect(uningestedCountryName("AQ")).toBe("Antarctica");
    expect(uningestedCountryName("HM")).toBe("Heard Island and McDonald Islands");
  });

  test("normalises its input the way every other reader here does", () => {
    expect(uningestedCountryName("aq")).toBe("Antarctica");
    expect(uningestedCountryName("  aq  ")).toBe("Antarctica");
  });

  test("is null for a code another table already names", () => {
    // Which is what makes the precedence in `getCountry` structural rather than
    // a rule about the order of two `??`: there is no row here to reorder to.
    expect(uningestedCountryName("CN")).toBeNull();
    expect(uningestedCountryName("GA")).toBeNull();
  });

  test("is null for anything that is not a country code", () => {
    for (const bad of ["", "   ", "CHN", "1", "🙂", "constructor", "ZZ"]) {
      expect(uningestedCountryName(bad), bad).toBeNull();
    }
  });
});

describe("isCountryCode", () => {
  test("accepts exactly two letters, case-insensitively", () => {
    expect(isCountryCode("CN")).toBe(true);
    expect(isCountryCode("cn")).toBe(true);
  });

  test("rejects anything that is not two letters", () => {
    for (const bad of ["C", "CHN", "", "C1", "12", " CN"]) {
      expect(isCountryCode(bad)).toBe(false);
    }
  });
});
