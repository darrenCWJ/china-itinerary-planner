import countryImagesJson from "../data/country-images.json";
import { type AccentTheme, accentColor } from "./accent";
import type { Country } from "./countries";

/**
 * Commons attribution for one photograph.
 *
 * The brand is load-bearing, not decoration: nothing outside this module can
 * produce the symbol, so `ImageCredit` is unforgeable and an image hero cannot
 * be written down without one. Commons licences require a credit line, and a
 * requirement kept in a comment is a requirement someone eventually skips.
 */
declare const CREDITED: unique symbol;

export interface ImageCredit {
  /** Plain-text author, as the credit line renders it. At most MAX_CREDIT_TEXT_LENGTH. */
  readonly artist: string;
  /** Short licence name, e.g. "CC BY-SA 4.0". At most MAX_CREDIT_TEXT_LENGTH. */
  readonly license: string;
  /** Canonical licence deed; null when Commons did not supply one. */
  readonly licenseUrl: string | null;
  /** Commons file page — the "link to source" half of attribution. */
  readonly sourceUrl: string;
  readonly [CREDITED]: true;
}

export type Hero =
  | { readonly kind: "image"; readonly url: string; readonly credit: ImageCredit }
  | { readonly kind: "gradient"; readonly fromColor: string; readonly toColor: string };

/** One record as it sits in data/country-images.json. */
export interface CountryImage {
  readonly url: string;
  readonly artist: string;
  readonly license: string;
  readonly licenseUrl: string | null;
  readonly sourceUrl: string;
}

/** Keyed by uppercase ISO 3166-1 alpha-2. */
export type CountryImageIndex = Readonly<Record<string, CountryImage>>;

export interface PickHeroOptions {
  /** Which accent ramp the gradient fallback draws from. Default light. */
  readonly theme?: AccentTheme;
  /**
   * User accent override (a hue, 0–359); undefined lets lib/accent answer from
   * curated-then-derived. Callers holding a `UserPrefs` must derive this with
   * lib/prefs' `resolveAccentOverride` rather than reading `accentHues`
   * themselves — a fixed accent has to reach the gradient too, or the band
   * disagrees with the accent tokens around it.
   */
  readonly accentHue?: number;
  /** Ingested heroes. Defaults to the committed data file. */
  readonly images?: CountryImageIndex;
  /** Hand-picked heroes, which win. Defaults to CURATED_HEROES below. */
  readonly curated?: CountryImageIndex;
}

/**
 * Hand-picked overrides, for the escape hatch the spec's risk register asks
 * for: Wikimedia's P18 for a country is often a flag, a map, or — as with
 * Japan — a satellite photograph, none of which work as a hero band.
 *
 * Empty until someone curates a file *and* records its real Commons credit.
 * Attribution is never invented to fill this table; an uncredited entry would
 * be dropped by the same guard that drops a malformed ingested one.
 */
const CURATED_HEROES: CountryImageIndex = {};

const isCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);

const normaliseCode = (code: unknown): string =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Longest credit text a hero band can carry.
 *
 * `Credit` in components/shell/CountryHero.tsx sets the author and licence
 * inline in a 10px/16px monospace paragraph, inside a band whose own content is
 * two short lines. Commons `Artist` fields are HTML-derived and occasionally
 * enormous — a composite image can list every source file and its uploader —
 * and at that length the credit stops annotating the hero and becomes it.
 *
 * 120 is deliberately generous rather than tight: the longest real credit the
 * ingest has produced is 56 characters, and the longest plausible Commons
 * `LicenseShortName` ("Creative Commons Attribution-ShareAlike 4.0
 * International") is 57, so nothing legitimate is near the ceiling.
 *
 * Kept in step with the same constant in scripts/ingest-country-images.mjs —
 * the ingest must not emit records this boundary will refuse. A test asserts
 * the two numbers are equal.
 */
export const MAX_CREDIT_TEXT_LENGTH = 120;

/**
 * Credit text: present, non-blank, and short enough to render as one.
 *
 * Over-long credits are **rejected, never truncated**. An ellipsised credit
 * drops the very names the licence requires while still looking like
 * compliance, so it is worse than not publishing the photograph at all; a CSS
 * clamp is the same defect one layer down. Rejecting takes the whole entry with
 * it and the country renders the accent gradient — a designed state that
 * carries no attribution obligation. The remedy for a specific country is a
 * curated hero with a short, honest credit, not a longer ceiling.
 */
const creditText = (value: unknown): string | null => {
  const trimmed = text(value);
  return trimmed !== null && trimmed.length <= MAX_CREDIT_TEXT_LENGTH ? trimmed : null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The only mint for `ImageCredit`. Returns null unless every field the licence
 * needs is actually present *and renderable*, so neither an incomplete record
 * nor one with an unusably long credit can become an image.
 */
function credited(entry: unknown): ImageCredit | null {
  const record = asRecord(entry);
  if (!record) return null;

  const artist = creditText(record.artist);
  const license = creditText(record.license);
  const sourceUrl = text(record.sourceUrl);
  if (!artist || !license || !sourceUrl) return null;

  return {
    artist,
    license,
    licenseUrl: text(record.licenseUrl),
    sourceUrl,
  } as ImageCredit;
}

/**
 * Validate the ingest output at the boundary. Anything short of a complete,
 * credited record is dropped rather than repaired — a hero that cannot be
 * attributed is not publishable, and the gradient path is a good outcome. That
 * includes a credit longer than MAX_CREDIT_TEXT_LENGTH: the data file is
 * generated, so this boundary is the only thing standing between a freak
 * Commons `Artist` field and the hero band.
 */
export function readCountryImageIndex(raw: unknown): CountryImageIndex {
  const wrapper = asRecord(raw);
  if (!wrapper) return {};
  const entries = asRecord(wrapper.countries) ?? wrapper;

  const index: Record<string, CountryImage> = {};
  for (const [key, value] of Object.entries(entries)) {
    const code = normaliseCode(key);
    if (!isCode(code)) continue;
    const credit = credited(value);
    const url = text(asRecord(value)?.url);
    if (!credit || !url) continue;
    index[code] = {
      url,
      artist: credit.artist,
      license: credit.license,
      licenseUrl: credit.licenseUrl,
      sourceUrl: credit.sourceUrl,
    };
  }
  return index;
}

/**
 * Bundled rather than read from disk at request time, mirroring how
 * lib/server/catalog.ts ships data/catalog.json: serverless deployments have
 * no data/ directory, and there are no runtime Wikidata calls by design (J8).
 */
export const COUNTRY_IMAGES: CountryImageIndex = readCountryImageIndex(countryImagesJson);

function gradient(code: string, options: PickHeroOptions): Hero {
  const theme: AccentTheme = options.theme ?? "light";
  const from = accentColor(code, theme, "fill", options.accentHue);
  const to = accentColor(code, theme, "ink", options.accentHue);
  if (from !== to) return { kind: "gradient", fromColor: from, toColor: to };

  // The dark ramp pins both roles to one lightness and chroma, so the two
  // roles verbatim would render a flat band — and the fallback has to look
  // deliberate, since across all countries most will land here. Borrowing the
  // other ramp's ink keeps a real gradient without inventing a lightness
  // outside lib/accent; these are background stops beneath the mandatory
  // scrim, so nothing legible depends on them.
  const counterpart: AccentTheme = theme === "dark" ? "light" : "dark";
  return {
    kind: "gradient",
    fromColor: from,
    toColor: accentColor(code, counterpart, "ink", options.accentHue),
  };
}

/**
 * Curated override, then ingested photo, then the accent gradient.
 *
 * Precedence runs over *usable* heroes: a half-filled override falls through
 * to a properly credited ingested photo instead of blanking the country. Total
 * function — an unknown code, or a malformed country record off a payload,
 * degrades to the gradient rather than throwing inside a render.
 */
export function pickHero(country: Country, options: PickHeroOptions = {}): Hero {
  const code = normaliseCode(asRecord(country)?.code);

  for (const source of [options.curated ?? CURATED_HEROES, options.images ?? COUNTRY_IMAGES]) {
    const entry = asRecord(source)?.[code];
    const credit = credited(entry);
    const url = text(asRecord(entry)?.url);
    if (credit && url) return { kind: "image", url, credit };
  }

  return gradient(code, options);
}
