/** ISO 3166-1 alpha-2, uppercase. */
export type CountryCode = string;

export interface Country {
  code: CountryCode;
  name: string;
  localName: string | null;
  hemisphere: "north" | "south";
  /**
   * Curated OKLCH hue override, 0–359. Omitted means derive it.
   * A hue rather than a colour deliberately: lightness and chroma stay pinned
   * in lib/accent, so no override can produce an illegible accent.
   */
  accentHue?: number;
  /** Wikimedia Commons hero image. Unused until the imagery work. */
  image?: string;
  /** Cultural glyph shown as a chop mark, e.g. 同行 for China. */
  mark?: string;
}

/**
 * Hand-tuned records. Everything absent here is synthesised, so this table
 * grows only when a country earns bespoke treatment — it is not a registry of
 * supported countries. Adding a country to the app is data elsewhere.
 */
const CURATED: Record<string, Omit<Country, "code" | "hemisphere">> = {
  CN: {
    name: "China",
    localName: "中国",
    // Matches the vermilion seal (#c93b2e) the app already uses.
    accentHue: 29,
    mark: "同行",
  },
};

/**
 * Southern-hemisphere countries, which invert the seasons.
 *
 * A latitude lookup would be better and is what the spec calls for, but no
 * country centroid data exists in the repo yet. Until it does, an explicit
 * list beats silently treating the whole world as northern — the bug this
 * data exists to fix. Countries straddling the equator are listed by where
 * their travel season actually falls.
 */
const SOUTHERN = new Set([
  "AO", "AR", "AU", "BI", "BO", "BR", "BW", "CD", "CL", "FJ", "ID", "KE",
  "LS", "MG", "MW", "MZ", "NA", "NC", "NZ", "PE", "PF", "PG", "PY", "RW",
  "SB", "SZ", "TL", "TZ", "UY", "VU", "WS", "ZA", "ZM", "ZW",
]);

export function isCountryCode(s: string): boolean {
  return /^[A-Za-z]{2}$/.test(s);
}

/**
 * Total function: always returns a record, never throws. Callers render what
 * they get rather than branching on undefined, so an unrecognised code
 * degrades to a plain one instead of breaking the page it appears on.
 */
export function getCountry(code: string): Country {
  const normalised = typeof code === "string" ? code.trim().toUpperCase() : "";
  const known = isCountryCode(normalised) ? normalised : "";
  const curated = known ? CURATED[known] : undefined;

  return {
    code: known,
    name: curated?.name ?? known,
    localName: curated?.localName ?? null,
    hemisphere: SOUTHERN.has(known) ? "south" : "north",
    ...(curated?.accentHue !== undefined ? { accentHue: curated.accentHue } : {}),
    ...(curated?.image !== undefined ? { image: curated.image } : {}),
    ...(curated?.mark !== undefined ? { mark: curated.mark } : {}),
  };
}
