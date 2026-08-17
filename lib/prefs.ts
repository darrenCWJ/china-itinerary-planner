import { accentColor, type AccentTheme } from "./accent";

export type ThemePref = "light" | "dark" | "system";

/**
 * A user's display preferences. Per user, never per trip: two members of a
 * shared trip may see different accents, which is the deliberate trade for not
 * needing shared-state conflict resolution (spec §4.3).
 */
export interface UserPrefs {
  theme: ThemePref;
  /**
   * "country" derives a hue per country; a number pins one hue everywhere.
   *
   * A hue and not a colour. Lightness and chroma live in lib/accent and are
   * pinned per role, so no value a user can pick is illegible — which is what
   * lets the picker be a hue wheel validated by a range check, and what makes
   * this field a bounded integer with no injection surface.
   */
  accent: "country" | number;
  /** Sparse per-country overrides, ISO alpha-2 to hue. Only what was changed. */
  accentHues: Record<string, number>;
}

export const DEFAULT_PREFS: UserPrefs = { theme: "light", accent: "country", accentHues: {} };

const THEMES: readonly ThemePref[] = ["light", "dark", "system"];

const isTheme = (value: unknown): value is ThemePref =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

export const isHue = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 359;

/**
 * Every read of prefs from outside this module's own writes — a stored row, a
 * cookie, a client — comes through here. Total and allowlist-only: an
 * unrecognised theme, an out-of-range hue or a malformed country key is
 * dropped individually rather than failing the whole record, so one bad field
 * never costs a user the rest of their settings.
 */
export function sanitizePrefs(value: unknown): UserPrefs {
  if (typeof value !== "object" || value === null) return DEFAULT_PREFS;
  const raw = value as Record<string, unknown>;

  const accentHues: Record<string, number> = {};
  const hues = raw.accentHues;
  if (typeof hues === "object" && hues !== null) {
    for (const [code, hue] of Object.entries(hues as Record<string, unknown>)) {
      if (/^[A-Z]{2}$/.test(code) && isHue(hue)) accentHues[code] = hue;
    }
  }

  return {
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
    accent: isHue(raw.accent) ? raw.accent : "country",
    accentHues,
  };
}

/**
 * Read by the first-paint inline script, so it is deliberately not HttpOnly
 * (see the plan's J8). That is safe only because of what it holds: a theme
 * enum and bounded integers, nothing sensitive, re-validated through the
 * allowlist on every single read.
 */
export const PREFS_COOKIE = "cip-prefs";

/**
 * `theme=dark&accent=210&hues=CN:200.JP:40`.
 *
 * Flat key=value pairs rather than JSON because the inline script has to read
 * this before any bundle loads: a handful of string splits is code that can be
 * written once as a constant and audited by eye.
 *
 * Overrides are separated by "." and not "," because RFC 6265's cookie-octet
 * excludes the comma — a comma would need percent-encoding, which the inline
 * script would then have to decode.
 */
export function parsePrefsCookie(value: string | undefined | null): UserPrefs {
  if (!value) return DEFAULT_PREFS;

  const fields: Record<string, string> = {};
  for (const pair of value.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const accentHues: Record<string, number> = {};
  for (const entry of (fields.hues ?? "").split(".")) {
    const [code, hue] = entry.split(":");
    if (code && hue !== undefined) accentHues[code] = Number(hue);
  }

  // Every field lands in sanitizePrefs rather than being trusted here, so the
  // cookie has exactly the same trust level as a stored row: none.
  return sanitizePrefs({
    theme: fields.theme,
    accent: fields.accent === undefined ? undefined : Number(fields.accent),
    accentHues,
  });
}

export function serializePrefsCookie(prefs: UserPrefs): string {
  const parts = [`theme=${prefs.theme}`, `accent=${prefs.accent}`];
  const hues = Object.entries(prefs.accentHues).map(([code, hue]) => `${code}:${hue}`);
  if (hues.length > 0) parts.push(`hues=${hues.join(".")}`);
  return parts.join("&");
}

/**
 * The hue a user's prefs impose on one country, or undefined when they impose
 * none and lib/accent should answer from curated-then-derived.
 *
 * This is the one definition of the *prefs* half of accent precedence, and it
 * is exported because not every accent surface consumes the two custom
 * properties: `CountryHero`'s gradient fallback needs the hue itself, to hand
 * to `pickHero`. A surface that reads `prefs.accentHues[code]` instead
 * reimplements the order and gets it wrong the same way every time — it
 * silently drops fixed mode, so it disagrees with the `--accent-*` tokens on
 * the page around it.
 *
 * Fixed mode ignores accentHues by construction — "one accent everywhere" and
 * "this country is different" cannot both be honoured, and the explicit choice
 * wins. `WorldMap`'s choropleth is the one intended exception and documents
 * itself as one: a fixed accent there would paint every country the same
 * colour and erase what the tint says. An exception has to be argued at its own
 * call site; the default is this function.
 *
 * Note what is deliberately *not* here: the curated and derived hues, which
 * stay in lib/accent behind `accentHue`. Returning undefined rather than a hue
 * is how that ownership is kept.
 */
export function resolveAccentOverride(prefs: UserPrefs, countryCode: string): number | undefined {
  if (typeof prefs.accent === "number") return prefs.accent;
  return prefs.accentHues[countryCode.trim().toUpperCase()];
}

/**
 * The two accent custom properties for one country under one theme.
 *
 * Precedence is not reimplemented here. The prefs half comes from
 * `resolveAccentOverride` above; everything else hands the resolution to
 * lib/accent's accentHue, which owns the user-override / curated / derived
 * order.
 *
 * Lightness and chroma never appear here at all, which is the guarantee: they
 * come from lib/accent's ramp whatever the user picked.
 */
export function resolveAccentVars(
  prefs: UserPrefs,
  countryCode: string,
  theme: AccentTheme
): { "--accent-ink": string; "--accent-fill": string } {
  const code = countryCode.trim().toUpperCase();
  const override = resolveAccentOverride(prefs, code);

  return {
    "--accent-ink": accentColor(code, theme, "ink", override),
    "--accent-fill": accentColor(code, theme, "fill", override),
  };
}
