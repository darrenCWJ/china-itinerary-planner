import { describe, expect, test } from "vitest";
import { getCountry, isCountryCode } from "./countries";

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
