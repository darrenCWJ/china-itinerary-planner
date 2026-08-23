import { describe, expect, test } from "vitest";
import { accentColor, lightnessFor } from "./accent";
import { getCountry } from "./countries";
import { type Hero, pickHero } from "./countryImagery";
import {
  DEFAULT_PREFS,
  PREFS_COOKIE,
  parsePrefsCookie,
  resolveAccentOverride,
  resolveAccentVars,
  sanitizePrefs,
  serializePrefsCookie,
  type UserPrefs,
} from "./prefs";

describe("sanitizePrefs", () => {
  test("passes a well-formed record through unchanged", () => {
    const prefs: UserPrefs = {
      theme: "dark",
      accent: 210,
      accentHues: { CN: 200 },
      worldView: "globe",
    };

    expect(sanitizePrefs(prefs)).toEqual(prefs);
  });

  test("replaces an unknown theme with the default rather than rejecting the record", () => {
    expect(sanitizePrefs({ theme: "purple", accent: 210, accentHues: {} })).toEqual({
      theme: "light",
      accent: 210,
      accentHues: {},
      worldView: "globe",
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
      worldView: "globe",
    });
  });

  test("reads a fixed accent hue and sparse overrides", () => {
    expect(parsePrefsCookie("theme=system&accent=210&hues=CN:200.JP:40")).toEqual({
      theme: "system",
      accent: 210,
      accentHues: { CN: 200, JP: 40 },
      worldView: "globe",
    });
  });

  test("round-trips every field", () => {
    const prefs: UserPrefs = {
      theme: "dark",
      accent: 300,
      accentHues: { CN: 12, KR: 200 },
      worldView: "globe",
    };

    expect(parsePrefsCookie(serializePrefsCookie(prefs))).toEqual(prefs);
    expect(parsePrefsCookie(serializePrefsCookie(DEFAULT_PREFS))).toEqual(DEFAULT_PREFS);
  });

  test("the serialized value is cookie-safe", () => {
    const value = serializePrefsCookie({
      theme: "dark",
      accent: 10,
      accentHues: { CN: 1 },
      worldView: "globe",
    });

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
      worldView: "globe",
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

describe("worldView", () => {
  test("defaults to the globe", () => {
    expect(DEFAULT_PREFS.worldView).toBe("globe");
  });

  test("keeps an explicit flat choice", () => {
    expect(sanitizePrefs({ theme: "light", accent: "country", accentHues: {}, worldView: "flat" }).worldView).toBe("flat");
  });

  test("drops an unrecognised value rather than the whole record", () => {
    const prefs = sanitizePrefs({ theme: "dark", accent: 210, accentHues: {}, worldView: "hologram" });
    expect(prefs.worldView).toBe("globe");
    // One bad field never costs a user the rest of their settings.
    expect(prefs.theme).toBe("dark");
    expect(prefs.accent).toBe(210);
  });

  test("round-trips through the cookie", () => {
    const prefs: UserPrefs = { theme: "dark", accent: 210, accentHues: {}, worldView: "flat" };
    expect(parsePrefsCookie(serializePrefsCookie(prefs))).toEqual(prefs);
  });

  test("reads as the globe when an older cookie has no view field", () => {
    // Cookies predating this field are live in browsers right now; they must
    // land on the default rather than on undefined.
    expect(parsePrefsCookie("theme=dark&accent=210").worldView).toBe("globe");
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
    const prefs: UserPrefs = {
      theme: "light",
      accent: "country",
      accentHues: { CN: 200 },
      worldView: "globe",
    };
    const vars = resolveAccentVars(prefs, "CN", "light");

    expect(hueOf(vars["--accent-ink"])).toBe(200);
    expect(hueOf(vars["--accent-fill"])).toBe(200);
  });

  test("an override applies only to the country it names", () => {
    const prefs: UserPrefs = {
      theme: "light",
      accent: "country",
      accentHues: { CN: 200 },
      worldView: "globe",
    };

    expect(hueOf(resolveAccentVars(prefs, "JP", "light")["--accent-ink"])).toBe(
      hueOf(accentColor("JP", "light", "ink"))
    );
  });

  test("a fixed accent applies everywhere and ignores the override map", () => {
    const prefs: UserPrefs = {
      theme: "light",
      accent: 40,
      accentHues: { CN: 200, JP: 300 },
      worldView: "globe",
    };

    for (const code of ["CN", "JP", "XZ"]) {
      expect(hueOf(resolveAccentVars(prefs, code, "light")["--accent-ink"])).toBe(40);
      expect(hueOf(resolveAccentVars(prefs, code, "light")["--accent-fill"])).toBe(40);
    }
  });

  test("a country code is matched case-insensitively", () => {
    const prefs: UserPrefs = {
      theme: "light",
      accent: "country",
      accentHues: { CN: 200 },
      worldView: "globe",
    };

    expect(hueOf(resolveAccentVars(prefs, "cn", "light")["--accent-ink"])).toBe(200);
  });

  test("the two vars are exactly the override resolver's answer, not a second copy of it", () => {
    // resolveAccentVars must not re-derive the prefs half; if it ever does, the
    // page's tokens and every surface that resolves the hue itself drift apart.
    const prefs: UserPrefs = {
      theme: "light",
      accent: 40,
      accentHues: { CN: 200 },
      worldView: "globe",
    };

    expect(resolveAccentVars(prefs, "CN", "light")).toEqual({
      "--accent-ink": accentColor("CN", "light", "ink", resolveAccentOverride(prefs, "CN")),
      "--accent-fill": accentColor("CN", "light", "fill", resolveAccentOverride(prefs, "CN")),
    });
  });

  test("both roles keep their pinned lightness whatever the user chose", () => {
    // The point of storing a hue rather than a colour: no selection a user can
    // make moves lightness, so the contrast guarantee survives the picker.
    const cases: UserPrefs[] = [
      DEFAULT_PREFS,
      { theme: "light", accent: "country", accentHues: { CN: 200 }, worldView: "globe" },
      { theme: "light", accent: 40, accentHues: {}, worldView: "globe" },
      { theme: "light", accent: 0, accentHues: {}, worldView: "globe" },
      { theme: "light", accent: 359, accentHues: {}, worldView: "globe" },
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

/**
 * `CountryHero`'s gradient fallback is the accent surface that needs the hue
 * rather than the two custom properties, so it is the surface most able to
 * disagree with the rest of the page. What it computes is
 * `pickHero(country, { theme, accentHue: resolveAccentOverride(prefs, code) })`
 * — reproduced here, in the node project, because the precedence is the part
 * worth pinning and it is pure. The band's structure (scrim, credit, stacking)
 * is asserted where it renders, in components/shell/CountryHero.test.tsx.
 *
 * `JP` is the case the whole block turns on: it has a curated hue (345), it has
 * no photograph in data/country-images.json, and so it is a country where the
 * gradient path runs and all three candidate hues — fixed, per-country, curated
 * — are different numbers. If Japan is ever given a hero photograph these tests
 * fail at the `kind` guard rather than passing vacuously.
 */
describe("the accent gradient a hero paints", () => {
  const hueOf = (css: string): number => Number(/ (\d+(?:\.\d+)?)\)$/.exec(css)![1]);

  const heroFor = (prefs: UserPrefs, code: string): Hero =>
    pickHero(getCountry(code), { theme: "light", accentHue: resolveAccentOverride(prefs, code) });

  const gradient = (prefs: UserPrefs, code: string) => {
    const hero = heroFor(prefs, code);
    if (hero.kind !== "gradient") throw new Error(`${code} now has a photograph, not a gradient`);
    return hero;
  };

  test("a fixed accent is what the gradient paints, over a per-country override", () => {
    // The defect this replaces: the hero read accentHues directly, so it painted
    // 300 while every token on the page was at 210.
    const prefs: UserPrefs = {
      theme: "light",
      accent: 210,
      accentHues: { JP: 300 },
      worldView: "globe",
    };
    const hero = gradient(prefs, "JP");

    expect(hueOf(hero.fromColor)).toBe(210);
    expect(hueOf(hero.toColor)).toBe(210);
  });

  test("a fixed accent is what the gradient paints, over the curated hue", () => {
    expect(getCountry("JP").accentHue).toBe(345);
    const prefs: UserPrefs = {
      theme: "light",
      accent: 210,
      accentHues: {},
      worldView: "globe",
    };

    expect(hueOf(gradient(prefs, "JP").fromColor)).toBe(210);
  });

  test("the gradient stops are the same two colours as the accent tokens", () => {
    // The band sits under `--accent-ink` content and beside `--accent-ink`
    // chrome, so "the hero agrees with the page" is the actual requirement —
    // stronger than any single hue assertion, and it holds in every mode.
    const cases: UserPrefs[] = [
      DEFAULT_PREFS,
      { theme: "light", accent: 210, accentHues: { JP: 300 }, worldView: "globe" },
      { theme: "light", accent: 210, accentHues: {}, worldView: "globe" },
      { theme: "light", accent: "country", accentHues: { JP: 300 }, worldView: "globe" },
      { theme: "light", accent: 0, accentHues: {}, worldView: "globe" },
    ];
    for (const prefs of cases) {
      const hero = gradient(prefs, "JP");
      const vars = resolveAccentVars(prefs, "JP", "light");

      expect(hero.fromColor).toBe(vars["--accent-fill"]);
      expect(hero.toColor).toBe(vars["--accent-ink"]);
    }
  });

  test("per-country mode still lets a recoloured country show its own hue", () => {
    // Fixed mode winning must not cost the override its meaning where the user
    // has not pinned one hue everywhere.
    const prefs: UserPrefs = {
      theme: "light",
      accent: "country",
      accentHues: { JP: 300 },
      worldView: "globe",
    };

    expect(hueOf(gradient(prefs, "JP").fromColor)).toBe(300);
  });
});
