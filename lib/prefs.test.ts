import { describe, expect, test } from "vitest";
import { accentColor, lightnessFor } from "./accent";
import { getCountry } from "./countries";
import {
  DEFAULT_PREFS,
  PREFS_COOKIE,
  parsePrefsCookie,
  resolveAccentVars,
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

describe("resolveAccentVars", () => {
  const lightnessOf = (css: string): number => Number(/oklch\((\d+(?:\.\d+)?)%/.exec(css)![1]);
  const hueOf = (css: string): number => Number(/ (\d+(?:\.\d+)?)\)$/.exec(css)![1]);

  test("per-country mode with no override is exactly lib/accent's answer", () => {
    const vars = resolveAccentVars(DEFAULT_PREFS, "CN", "light");

    expect(vars).toEqual({
      "--accent-ink": accentColor("CN", "light", "ink"),
      "--accent-fill": accentColor("CN", "light", "fill"),
    });
  });

  test("an unknown country still resolves, through derivation", () => {
    expect(resolveAccentVars(DEFAULT_PREFS, "XZ", "light")).toEqual({
      "--accent-ink": accentColor("XZ", "light", "ink"),
      "--accent-fill": accentColor("XZ", "light", "fill"),
    });
  });

  test("a per-country override beats the curated hue", () => {
    // CN is curated at 30; the user's 200 must win, or the override does
    // nothing for exactly the countries anyone has bothered to curate.
    expect(getCountry("CN").accentHue).toBe(30);
    const prefs: UserPrefs = { theme: "light", accent: "country", accentHues: { CN: 200 } };
    const vars = resolveAccentVars(prefs, "CN", "light");

    expect(hueOf(vars["--accent-ink"])).toBe(200);
    expect(hueOf(vars["--accent-fill"])).toBe(200);
  });

  test("an override applies only to the country it names", () => {
    const prefs: UserPrefs = { theme: "light", accent: "country", accentHues: { CN: 200 } };

    expect(hueOf(resolveAccentVars(prefs, "JP", "light")["--accent-ink"])).toBe(
      hueOf(accentColor("JP", "light", "ink"))
    );
  });

  test("a fixed accent applies everywhere and ignores the override map", () => {
    const prefs: UserPrefs = { theme: "light", accent: 40, accentHues: { CN: 200, JP: 300 } };

    for (const code of ["CN", "JP", "XZ"]) {
      expect(hueOf(resolveAccentVars(prefs, code, "light")["--accent-ink"])).toBe(40);
      expect(hueOf(resolveAccentVars(prefs, code, "light")["--accent-fill"])).toBe(40);
    }
  });

  test("a country code is matched case-insensitively", () => {
    const prefs: UserPrefs = { theme: "light", accent: "country", accentHues: { CN: 200 } };

    expect(hueOf(resolveAccentVars(prefs, "cn", "light")["--accent-ink"])).toBe(200);
  });

  test("both roles keep their pinned lightness whatever the user chose", () => {
    // The point of storing a hue rather than a colour: no selection a user can
    // make moves lightness, so the contrast guarantee survives the picker.
    const cases: UserPrefs[] = [
      DEFAULT_PREFS,
      { theme: "light", accent: "country", accentHues: { CN: 200 } },
      { theme: "light", accent: 40, accentHues: {} },
      { theme: "light", accent: 0, accentHues: {} },
      { theme: "light", accent: 359, accentHues: {} },
    ];
    for (const prefs of cases) {
      for (const theme of ["light", "dark"] as const) {
        const vars = resolveAccentVars(prefs, "CN", theme);
        expect(lightnessOf(vars["--accent-ink"])).toBe(lightnessFor(theme, "ink"));
        expect(lightnessOf(vars["--accent-fill"])).toBe(lightnessFor(theme, "fill"));
      }
    }
  });
});
