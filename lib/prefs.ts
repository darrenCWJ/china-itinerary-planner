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
