import { describe, expect, test } from "vitest";
import {
  DEFAULT_PREFS,
  PREFS_COOKIE,
  parsePrefsCookie,
  sanitizePrefs,
  serializePrefsCookie,
  type UserPrefs,
} from "./prefs";

describe("sanitizePrefs", () => {
  test("passes a well-formed record through unchanged", () => {
    const prefs: UserPrefs = { theme: "dark", accent: 210, accentHues: { CN: 200 } };

    expect(sanitizePrefs(prefs)).toEqual(prefs);
  });

  test("replaces an unknown theme with the default rather than rejecting the record", () => {
    expect(sanitizePrefs({ theme: "purple", accent: 210, accentHues: {} })).toEqual({
      theme: "light",
      accent: 210,
      accentHues: {},
    });
  });

  test("drops out-of-range and non-integer hues", () => {
    expect(sanitizePrefs({ theme: "dark", accent: 400, accentHues: {} }).accent).toBe("country");
    expect(sanitizePrefs({ theme: "dark", accent: -1, accentHues: {} }).accent).toBe("country");
    expect(sanitizePrefs({ theme: "dark", accent: 12.5, accentHues: {} }).accent).toBe("country");
    expect(sanitizePrefs({ theme: "dark", accent: 359, accentHues: {} }).accent).toBe(359);
  });

  test("a hex accent is not a valid accent any more", () => {
    // Hues only, at every layer: a hex would bypass the pinned lightness in
    // lib/accent and void the contrast guarantee.
    expect(sanitizePrefs({ theme: "light", accent: "#1d5c9e", accentHues: {} }).accent).toBe(
      "country"
    );
  });

  test("drops individual bad override entries and keeps the good ones", () => {
    const result = sanitizePrefs({
      theme: "light",
      accent: "country",
      accentHues: { CN: 200, china: 10, JP: 999, KR: 40 },
    });

    expect(result.accentHues).toEqual({ CN: 200, KR: 40 });
  });

  test("garbage input degrades to the defaults instead of throwing", () => {
    for (const value of [null, undefined, 7, "theme=dark", [], NaN]) {
      expect(() => sanitizePrefs(value)).not.toThrow();
      expect(sanitizePrefs(value)).toEqual(DEFAULT_PREFS);
    }
  });
});

describe("prefs cookie", () => {
  test("no cookie means the defaults", () => {
    expect(parsePrefsCookie(undefined)).toEqual(DEFAULT_PREFS);
    expect(parsePrefsCookie("")).toEqual(DEFAULT_PREFS);
  });

  test("reads a theme and a per-country accent", () => {
    expect(parsePrefsCookie("theme=dark&accent=country")).toEqual({
      theme: "dark",
      accent: "country",
      accentHues: {},
    });
  });

  test("reads a fixed accent hue and sparse overrides", () => {
    expect(parsePrefsCookie("theme=system&accent=210&hues=CN:200.JP:40")).toEqual({
      theme: "system",
      accent: 210,
      accentHues: { CN: 200, JP: 40 },
    });
  });

  test("round-trips every field", () => {
    const prefs: UserPrefs = { theme: "dark", accent: 300, accentHues: { CN: 12, KR: 200 } };

    expect(parsePrefsCookie(serializePrefsCookie(prefs))).toEqual(prefs);
    expect(parsePrefsCookie(serializePrefsCookie(DEFAULT_PREFS))).toEqual(DEFAULT_PREFS);
  });

  test("the serialized value is cookie-safe", () => {
    const value = serializePrefsCookie({ theme: "dark", accent: 10, accentHues: { CN: 1 } });

    expect(value).not.toMatch(/[;,\s"\\]/);
  });

  test("a hostile theme value cannot survive the read", () => {
    // theme is the one field that is a string, so it is the one field that
    // could reach an attribute or a script if it were ever trusted. It is not.
    for (const attack of [
      "theme=</script><script>alert(1)</script>",
      'theme="><img src=x onerror=alert(1)>',
      "theme=javascript:alert(1)",
      "theme=light;background:url(x)",
    ]) {
      expect(parsePrefsCookie(attack).theme).toBe("light");
    }
  });

  test("garbage anywhere degrades field by field", () => {
    expect(parsePrefsCookie("nonsense")).toEqual(DEFAULT_PREFS);
    expect(parsePrefsCookie("theme=dark&accent=nope&hues=%%%")).toEqual({
      theme: "dark",
      accent: "country",
      accentHues: {},
    });
    expect(parsePrefsCookie("theme=dark&hues=CN:200.broken.JP:40").accentHues).toEqual({
      CN: 200,
      JP: 40,
    });
  });

  test("the cookie name is stable", () => {
    // The first-paint inline script matches this name as a literal.
    expect(PREFS_COOKIE).toBe("cip-prefs");
  });
});
