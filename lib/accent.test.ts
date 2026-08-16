import { describe, expect, test } from "vitest";
import {
  DARK_PAPER,
  accentColor,
  accentHue,
  chromaFor,
  contrastRatio,
  derivedHue,
  lightnessFor,
  oklchToSrgb,
  relativeLuminance,
} from "./accent";
import { getCountry } from "./countries";

/** Light-theme paper and ink, mirroring app/globals.css. */
const WHITE: [number, number, number] = [1, 1, 1];
const LIGHT_INK: [number, number, number] = [0x17 / 255, 0x26 / 255, 0x3b / 255];

const ALL_CODES: string[] = [];
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    ALL_CODES.push(String.fromCharCode(a) + String.fromCharCode(b));
  }
}

const hueOf = (css: string): number => {
  const m = /^oklch\((\d+(?:\.\d+)?)% (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)\)$/.exec(css);
  if (!m) throw new Error(`unparseable accent: ${css}`);
  return Number(m[3]);
};
const lightnessOf = (css: string): number => {
  const m = /^oklch\((\d+(?:\.\d+)?)%/.exec(css);
  if (!m) throw new Error(`unparseable accent: ${css}`);
  return Number(m[1]);
};
/** Shortest way round the hue circle. */
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe("accentColor", () => {
  test("emits a parseable oklch string", () => {
    expect(accentColor("CN", "light", "ink")).toMatch(
      /^oklch\(\d+(\.\d+)?% 0(\.\d+)? \d+(\.\d+)?\)$/
    );
  });

  test("is deterministic and case-insensitive", () => {
    expect(accentColor("JP", "light", "ink")).toBe(accentColor("JP", "light", "ink"));
    expect(accentColor("jp", "light", "ink")).toBe(accentColor("JP", "light", "ink"));
  });

  test("pins lightness per role and theme", () => {
    expect(lightnessOf(accentColor("JP", "light", "ink"))).toBe(50);
    expect(lightnessOf(accentColor("JP", "light", "fill"))).toBe(72);
    expect(lightnessOf(accentColor("JP", "dark", "ink"))).toBe(80);
    expect(lightnessOf(accentColor("JP", "dark", "fill"))).toBe(80);
  });

  test("a user hue cannot change lightness, only hue", () => {
    // The reason the picker is a hue wheel: every selection stays legible.
    const withOverride = accentColor("JP", "light", "ink", 123);
    expect(lightnessOf(withOverride)).toBe(50);
    expect(hueOf(withOverride)).toBe(123);
  });
});

describe("accentHue resolution order", () => {
  test("user override beats curated", () => {
    expect(accentHue("CN", 200)).toBe(200);
  });

  test("curated beats derived", () => {
    const curated = getCountry("CN").accentHue;
    expect(curated).toBeDefined();
    expect(accentHue("CN")).toBe(curated);
    expect(accentHue("CN")).not.toBe(derivedHue("CN"));
  });

  test("derived is the fallback when nothing is curated", () => {
    expect(accentHue("JP")).toBe(derivedHue("JP"));
  });
});

describe("derivedHue", () => {
  test("repeats are exact, never near — the invariant that matters", () => {
    // 249 ISO codes over 360 degrees average 1.4 degrees apart, so separating
    // every pair is impossible and colours must repeat. What is enforceable is
    // HOW they repeat: two countries a degree apart looks like a rendering
    // fault, two sharing a hue looks deliberate. Snapping to a fixed palette
    // buys exactly that.
    //
    // Comparing the distinct hues rather than all 457k code pairs: if no two
    // distinct hues are within 15 degrees, no two codes can be either.
    const hues = [...new Set(ALL_CODES.map((c) => derivedHue(c)))].sort((a, b) => a - b);

    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(hueGap(hues[i], hues[j]), `${hues[i]} vs ${hues[j]}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  test("the palette is small enough to be distinguishable", () => {
    const hues = new Set(ALL_CODES.map((c) => derivedHue(c)));
    expect(hues.size).toBeLessThanOrEqual(24);
    expect(hues.size).toBeGreaterThanOrEqual(12);
  });

  test("consecutive ISO codes do not land next to each other", () => {
    // The stride is coprime with the palette size for this reason: without it,
    // alphabetically adjacent countries would share a colour region.
    expect(hueGap(derivedHue("ES"), derivedHue("ET"))).toBeGreaterThanOrEqual(15);
    expect(hueGap(derivedHue("IT"), derivedHue("JE"))).toBeGreaterThanOrEqual(15);
  });

  test("regression: every pair of curated countries is distinguishable", () => {
    // Three derivations were tried and each collided somewhere: a plain hash
    // gave CN 324 / TH 321 / VN 325 and IT 48 / FR 49; raw golden angle gave
    // GR 221 / US 222; palette snapping put EG, MA, GR and US all on 240.
    // Derivation alone cannot fix this -- 249 codes do not fit on a circle --
    // so the countries people actually travel to are curated one per slot.
    // Resolved hues, not derived ones: this is what a user sees.
    const curated = [
      "VN", "MA", "CN", "EG", "ES", "MX", "TR", "TH",
      "DE", "KR", "SG", "PT", "GR", "US", "FR", "IN",
      "GB", "AU", "ZA", "IT", "NZ", "ID", "BR", "JP",
    ];

    for (let i = 0; i < curated.length; i++) {
      for (let j = i + 1; j < curated.length; j++) {
        const [a, b] = [curated[i], curated[j]];
        expect(
          hueGap(accentHue(a), accentHue(b)),
          `${a} (${accentHue(a)}) vs ${b} (${accentHue(b)})`
        ).toBeGreaterThanOrEqual(15);
      }
    }
  });

  test("hues are stable and in range", () => {
    expect(derivedHue("JP")).toBe(derivedHue("jp"));
    expect(derivedHue("JP")).toBeGreaterThanOrEqual(0);
    expect(derivedHue("JP")).toBeLessThan(360);
  });
});

describe("contrast holds by construction", () => {
  test("chroma stays inside the sRGB gamut at every hue and pinned lightness", () => {
    const roles = [
      ["light", "ink"],
      ["light", "fill"],
      ["dark", "ink"],
      ["dark", "fill"],
    ] as const;

    for (const [theme, role] of roles) {
      const l = lightnessFor(theme, role) / 100;
      const c = chromaFor(theme, role);
      for (let hue = 0; hue < 360; hue++) {
        for (const channel of oklchToSrgb(l, c, hue)) {
          expect(
            channel,
            `${theme}/${role} hue=${hue} out of gamut: ${channel}`
          ).toBeGreaterThanOrEqual(-0.001);
          expect(
            channel,
            `${theme}/${role} hue=${hue} out of gamut: ${channel}`
          ).toBeLessThanOrEqual(1.001);
        }
      }
    }
  });

  test("every two-letter code passes AA in both themes", () => {
    const at = (theme: "light" | "dark", role: "ink" | "fill", hue: number) =>
      oklchToSrgb(lightnessFor(theme, role) / 100, chromaFor(theme, role), hue);

    for (const code of ALL_CODES) {
      const hue = accentHue(code);

      expect(
        contrastRatio(at("light", "ink", hue), WHITE),
        `${code} accent text on white paper`
      ).toBeGreaterThanOrEqual(4.5);

      expect(
        contrastRatio(at("light", "fill", hue), LIGHT_INK),
        `${code} dark ink on accent fill`
      ).toBeGreaterThanOrEqual(3.0);

      expect(
        contrastRatio(at("dark", "ink", hue), DARK_PAPER),
        `${code} accent text on dark paper`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("colour maths", () => {
  test("relativeLuminance matches known anchors", () => {
    expect(relativeLuminance([1, 1, 1])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
  });

  test("contrastRatio is symmetric and bounded", () => {
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 2);
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 2);
    expect(contrastRatio([1, 1, 1], [1, 1, 1])).toBeCloseTo(1, 5);
  });
});
