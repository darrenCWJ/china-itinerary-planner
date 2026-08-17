import { describe, expect, test } from "vitest";
import { accentColor } from "./accent";
import { getCountry } from "./countries";
import {
  COUNTRY_IMAGES,
  type CountryImageIndex,
  type Hero,
  pickHero,
  readCountryImageIndex,
} from "./countryImagery";

/** A complete, well-formed ingest entry. Tests mutate copies of this. */
const CREDITED_ENTRY = {
  url: "https://upload.wikimedia.org/ingested.jpg",
  artist: "Ingested Photographer",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Ingested.jpg",
};

const CURATED_ENTRY = {
  url: "https://upload.wikimedia.org/curated.jpg",
  artist: "Curated Photographer",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Curated.jpg",
};

const indexOf = (entries: Record<string, unknown>): CountryImageIndex =>
  readCountryImageIndex(entries);

/** Forge an index the parser would have rejected, to test pickHero's own guard. */
const forge = (entries: Record<string, unknown>): CountryImageIndex =>
  entries as unknown as CountryImageIndex;

describe("pickHero — source precedence", () => {
  test("a curated override beats an ingested image", () => {
    const hero = pickHero(getCountry("CN"), {
      curated: indexOf({ CN: CURATED_ENTRY }),
      images: indexOf({ CN: CREDITED_ENTRY }),
    });

    expect(hero.kind).toBe("image");
    if (hero.kind !== "image") return;
    expect(hero.url).toBe(CURATED_ENTRY.url);
    expect(hero.credit.artist).toBe("Curated Photographer");
  });

  test("an ingested image beats the gradient", () => {
    const hero = pickHero(getCountry("CN"), {
      curated: {},
      images: indexOf({ CN: CREDITED_ENTRY }),
    });

    expect(hero.kind).toBe("image");
    if (hero.kind !== "image") return;
    expect(hero.url).toBe(CREDITED_ENTRY.url);
    expect(hero.credit).toMatchObject({
      artist: "Ingested Photographer",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Ingested.jpg",
    });
  });

  test("a country with no entry anywhere falls to the gradient", () => {
    const hero = pickHero(getCountry("CN"), { curated: {}, images: indexOf({ JP: CREDITED_ENTRY }) });

    expect(hero.kind).toBe("gradient");
  });

  test("lookup is case-insensitive on the country code", () => {
    const hero = pickHero(getCountry("cn"), {
      curated: {},
      images: indexOf({ cn: CREDITED_ENTRY }),
    });

    expect(hero.kind).toBe("image");
  });
});

describe("pickHero — attribution is not optional", () => {
  // Commons licences require a credit line, so an uncredited file is not a
  // usable hero at all: it must degrade to the gradient rather than render
  // bare. Both layers are checked — the parser that reads the data file, and
  // pickHero itself for indexes that did not come through the parser.
  const incomplete: Record<string, Record<string, unknown>> = {
    "missing artist": { ...CREDITED_ENTRY, artist: undefined },
    "blank artist": { ...CREDITED_ENTRY, artist: "   " },
    "missing license": { ...CREDITED_ENTRY, license: undefined },
    "blank license": { ...CREDITED_ENTRY, license: "" },
    "missing source page": { ...CREDITED_ENTRY, sourceUrl: undefined },
    "missing url": { ...CREDITED_ENTRY, url: undefined },
    "non-string artist": { ...CREDITED_ENTRY, artist: 42 },
  };

  for (const [label, entry] of Object.entries(incomplete)) {
    test(`the parser drops an entry with a ${label}`, () => {
      expect(readCountryImageIndex({ CN: entry }).CN).toBeUndefined();
    });

    test(`pickHero refuses an unparsed entry with a ${label}`, () => {
      const hero = pickHero(getCountry("CN"), { curated: {}, images: forge({ CN: entry }) });

      expect(hero.kind).toBe("gradient");
    });
  }

  test("an uncredited curated entry does not shadow a credited ingested one", () => {
    // Precedence is over *usable* heroes; a half-filled override must not
    // blank out a country that does have a licensed photo.
    const hero = pickHero(getCountry("CN"), {
      curated: forge({ CN: { ...CURATED_ENTRY, license: "" } }),
      images: indexOf({ CN: CREDITED_ENTRY }),
    });

    expect(hero.kind).toBe("image");
    if (hero.kind !== "image") return;
    expect(hero.url).toBe(CREDITED_ENTRY.url);
  });

  test("an image hero cannot be written without a credit", () => {
    // Compile-time half of the rule: ImageCredit is branded, so the only way
    // to obtain one is through the validating constructor inside the module.
    const forged: Hero = {
      kind: "image",
      url: "https://upload.wikimedia.org/uncredited.jpg",
      // @ts-expect-error — a bare object cannot satisfy the branded ImageCredit.
      credit: { artist: "x", license: "y", licenseUrl: null, sourceUrl: "z" },
    };

    expect(forged.kind).toBe("image");
  });
});

describe("pickHero — gradient fallback", () => {
  test("carries both accent roles as its two stops", () => {
    const hero = pickHero(getCountry("CN"), { curated: {}, images: {} });

    expect(hero.kind).toBe("gradient");
    if (hero.kind !== "gradient") return;
    expect(hero.fromColor).toBe(accentColor("CN", "light", "fill"));
    expect(hero.toColor).toBe(accentColor("CN", "light", "ink"));
    expect(hero.fromColor).not.toBe(hero.toColor);
  });

  test("stays a two-stop gradient in dark, where the ramp collapses the roles", () => {
    // The dark ramp pins ink and fill to the same lightness and chroma, so
    // using the two roles verbatim would render a flat band.
    const hero = pickHero(getCountry("CN"), { curated: {}, images: {}, theme: "dark" });

    expect(hero.kind).toBe("gradient");
    if (hero.kind !== "gradient") return;
    expect(hero.fromColor).toBe(accentColor("CN", "dark", "fill"));
    expect(hero.fromColor).not.toBe(hero.toColor);
    expect(hero.toColor).toMatch(/^oklch\(/);
  });

  test("both stops share the country's hue, and two countries do not", () => {
    const hueOf = (css: string): string => {
      const match = /^oklch\([\d.]+% [\d.]+ ([\d.]+)\)$/.exec(css);
      if (!match) throw new Error(`unparseable stop: ${css}`);
      return match[1];
    };
    const th = pickHero(getCountry("TH"), { curated: {}, images: {} });
    const cn = pickHero(getCountry("CN"), { curated: {}, images: {} });

    if (th.kind !== "gradient" || cn.kind !== "gradient") throw new Error("expected gradients");
    expect(hueOf(th.fromColor)).toBe(hueOf(th.toColor));
    expect(hueOf(th.fromColor)).not.toBe(hueOf(cn.fromColor));
  });

  test("a user accent override reaches both stops", () => {
    const hero = pickHero(getCountry("CN"), { curated: {}, images: {}, accentHue: 200 });

    if (hero.kind !== "gradient") throw new Error("expected a gradient");
    expect(hero.fromColor).toBe(accentColor("CN", "light", "fill", 200));
    expect(hero.toColor).toBe(accentColor("CN", "light", "ink", 200));
  });

  test("an unknown country code degrades to a gradient and never throws", () => {
    for (const code of ["XZ", "ZZ", "", "   ", "CHN", "1", "🙂"]) {
      const country = getCountry(code);
      expect(() => pickHero(country, { curated: {}, images: {} })).not.toThrow();
      const hero = pickHero(country, { curated: {}, images: {} });
      expect(hero.kind).toBe("gradient");
      if (hero.kind !== "gradient") continue;
      expect(hero.fromColor).toMatch(/^oklch\(/);
      expect(hero.toColor).toMatch(/^oklch\(/);
    }
  });

  test("a malformed country record still yields a gradient", () => {
    // pickHero sits behind server payloads; a missing record must not take a
    // page down with it.
    for (const bad of [undefined, null, {}, { code: 7 }]) {
      const country = bad as unknown as ReturnType<typeof getCountry>;
      expect(() => pickHero(country)).not.toThrow();
      expect(pickHero(country).kind).toBe("gradient");
    }
  });
});

describe("readCountryImageIndex", () => {
  test("accepts the ingest script's wrapper shape", () => {
    const index = readCountryImageIndex({
      generatedAt: "2026-08-18T00:00:00.000Z",
      source: "Wikidata P18",
      countries: { CN: CREDITED_ENTRY },
    });

    expect(index.CN?.url).toBe(CREDITED_ENTRY.url);
  });

  test("normalises codes to uppercase", () => {
    expect(readCountryImageIndex({ countries: { cn: CREDITED_ENTRY } }).CN?.artist).toBe(
      "Ingested Photographer"
    );
  });

  test("drops keys that are not country codes", () => {
    const index = readCountryImageIndex({ CHN: CREDITED_ENTRY, "": CREDITED_ENTRY });

    expect(Object.keys(index)).toEqual([]);
  });

  test("defaults a missing licence URL to null rather than dropping the entry", () => {
    // The file page plus the licence name satisfy attribution; the canonical
    // licence link is a nicety.
    const index = readCountryImageIndex({ CN: { ...CREDITED_ENTRY, licenseUrl: undefined } });

    expect(index.CN?.licenseUrl).toBeNull();
  });

  test("returns an empty index for garbage input, never throwing", () => {
    for (const bad of [null, undefined, 7, "x", [], { countries: 3 }]) {
      expect(() => readCountryImageIndex(bad)).not.toThrow();
      expect(readCountryImageIndex(bad)).toEqual({});
    }
  });
});

describe("the committed data file", () => {
  test("every entry it exposes carries a full credit", () => {
    // The ingest must never emit a partially attributed record, and nobody
    // may hand-edit one in.
    for (const [code, entry] of Object.entries(COUNTRY_IMAGES)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.artist.trim().length).toBeGreaterThan(0);
      expect(entry.license.trim().length).toBeGreaterThan(0);
      expect(entry.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });

  test("picks a hero for every curated country without options", () => {
    for (const code of ["CN", "JP", "FR", "TH", "XZ"]) {
      const hero = pickHero(getCountry(code));

      if (hero.kind === "image") {
        expect(hero.credit.artist.trim().length).toBeGreaterThan(0);
        expect(hero.credit.license.trim().length).toBeGreaterThan(0);
      } else {
        expect(hero.fromColor).toMatch(/^oklch\(/);
      }
    }
  });
});
