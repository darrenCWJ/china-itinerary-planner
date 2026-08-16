import { getCountry } from "./countries";

export type AccentRole = "ink" | "fill";
export type AccentTheme = "light" | "dark";

/**
 * Lightness and chroma per role and theme. Pinned, never derived.
 *
 * This is what makes contrast a property of the system rather than of any
 * particular colour: hue carries identity, lightness carries legibility, and
 * they never trade against each other. A user-chosen hue is therefore safe by
 * construction — which is why the accent picker offers a hue wheel and not a
 * colour field.
 *
 * Chroma is pinned *per lightness*, not globally. sRGB holds different amounts
 * of chroma at different lightnesses (measured maxima across all hues: 0.085 at
 * L50, 0.122 at L72, 0.100 at L80), so one global constant would drag every
 * accent down to the worst role's ceiling for no benefit — countries only need
 * to be consistent with each other within a role, not across roles. The gamut
 * sweep in accent.test.ts is the authority on these values; do not raise one
 * without rerunning it.
 */
const RAMP: Record<AccentTheme, Record<AccentRole, { l: number; c: number }>> = {
  light: {
    ink: { l: 50, c: 0.08 },
    fill: { l: 72, c: 0.115 },
  },
  dark: {
    ink: { l: 80, c: 0.095 },
    fill: { l: 80, c: 0.095 },
  },
};

export const chromaFor = (theme: AccentTheme, role: AccentRole): number => RAMP[theme][role].c;
export const lightnessFor = (theme: AccentTheme, role: AccentRole): number => RAMP[theme][role].l;

/**
 * Derived hues snap to a fixed palette rather than landing anywhere on the
 * circle.
 *
 * With ~249 ISO codes over 360 degrees, average spacing is 1.4 degrees, so
 * separating every pair is arithmetically impossible — colours must repeat.
 * What matters is *how* they repeat. Two countries one degree apart reads as a
 * rendering fault; two countries sharing a hue exactly reads as intentional.
 * Snapping to PALETTE_SIZE evenly spaced hues guarantees the second and
 * eliminates the first.
 *
 * The stride is coprime with the palette size, so consecutive ISO indices land
 * far apart (105 degrees) instead of adjacent.
 */
const PALETTE_SIZE = 24;
const PALETTE_STRIDE = 7;
const PALETTE_STEP = 360 / PALETTE_SIZE;

/**
 * ISO 3166-1 alpha-2. Sorted and frozen: a country's hue comes from its
 * position here, so the list being a stable external standard is what
 * guarantees adding a country never reshuffles the ones already assigned.
 */
export const ISO_CODES: readonly string[] = Object.freeze(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI " +
    "BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
    "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK " +
    "FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
    "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
    "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP " +
    "NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF " +
    "TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
    "VN VU WF WS YE YT ZA ZM ZW"
  ).split(" ")
);

const INDEX_OF = new Map(ISO_CODES.map((code, i) => [code, i]));

const normalise = (code: string): string =>
  typeof code === "string" ? code.trim().toUpperCase() : "";

/**
 * Hue from the country's position in the ISO list, snapped to the palette.
 *
 * Two earlier attempts are worth recording so they are not retried. A plain
 * hash put CN 324 / TH 321 / VN 325 and IT 48 / FR 49 — countries that share a
 * trip list rendering as one colour. Raw golden-angle spacing fixed exactly
 * those pairs and created others: GR 221 beside US 222. Neither approach can
 * succeed, because separating 249 codes on a 360-degree circle is impossible;
 * the fix is to make repeats exact instead of near.
 */
export function derivedHue(code: string): number {
  const key = normalise(code);
  // Unknown codes fall back to their lexical insertion point so they are still
  // deterministic rather than all collapsing onto one hue.
  const index = INDEX_OF.get(key) ?? ISO_CODES.filter((c) => c < key).length;
  return ((index * PALETTE_STRIDE) % PALETTE_SIZE) * PALETTE_STEP;
}

/**
 * Resolution order: user override, then curated, then derived. Exported so
 * every consumer resolves precedence through one path instead of
 * reimplementing it.
 */
export function accentHue(code: string, overrideHue?: number): number {
  if (overrideHue !== undefined) return ((Math.round(overrideHue) % 360) + 360) % 360;
  return getCountry(code).accentHue ?? derivedHue(code);
}

export function accentColor(
  code: string,
  theme: AccentTheme,
  role: AccentRole,
  overrideHue?: number
): string {
  const { l, c } = RAMP[theme][role];
  return `oklch(${l}% ${c} ${accentHue(code, overrideHue)})`;
}

/** OKLCH to sRGB, each channel 0–1. Values outside that range are out of gamut. */
export function oklchToSrgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube,
    -1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube,
    -0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube,
  ];

  return linear.map((v) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055
  ) as [number, number, number];
}

const toLinear = (channel: number): number => {
  const v = Math.min(1, Math.max(0, channel));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Dark-theme paper. Single source of truth: the dark ramp in globals.css must
 * copy this value, and the contrast sweep asserts against it.
 */
export const DARK_PAPER: [number, number, number] = oklchToSrgb(0.18, 0.015, 250);
