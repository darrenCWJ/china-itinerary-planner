"use client";

import type { AccentTheme } from "@/lib/accent";
import { getCountry } from "@/lib/countries";
import { type ImageCredit, pickHero } from "@/lib/countryImagery";
import { usePrefs } from "./PrefsProvider";

/**
 * Hero band for a country: a Commons photograph where one exists, the accent
 * gradient where none does, and — either way — a scrim between the background
 * and whatever the caller renders on top (spec §4.4).
 *
 * Three things are load-bearing here.
 *
 * **The scrim is an element, and it is never conditional.** Not a class on the
 * band, not a modifier applied when an image happens to be present: a sibling
 * that always renders, always between the background layers and the content.
 * The rule the spec states is that contrast holds *regardless of which image is
 * returned* (§4.4 rule 1) — a scrim that depends on the image cannot make that
 * promise, and neither can one whose absence is a class name someone can drop
 * while restyling. `data-scrim` is how the test names it.
 *
 * **The band's own background belongs to the caller**, and it is the ground a
 * photograph falls back to — while it loads, if Commons blocks the hotlink, or
 * if the URL fails the scheme check below. Pass an opaque, dark-enough one:
 * everything above the scrim is light text by construction.
 *
 * **Attribution is not optional either.** `ImageCredit` cannot be minted
 * outside `lib/countryImagery`, so an image hero always carries one and this
 * component always renders it. The gradient path renders none because there is
 * nothing to attribute, which is the only reason the credit line is conditional
 * where the scrim is not.
 */

/**
 * Flat scrim across the whole band, plus more of it towards the bottom.
 *
 * Two layers of one token rather than a `color-mix` of it: the flat layer is
 * what protects text at the *top* of the band (an eyebrow and a heading, in
 * both mount points), and a gradient alone fades to nothing exactly there.
 */
const SCRIM = "linear-gradient(to top, var(--scrim), transparent), var(--scrim)";

export interface CountryHeroProps {
  /** ISO 3166-1 alpha-2. Anything unrecognised degrades to the gradient. */
  countryCode: string;
  /**
   * Which accent ramp the gradient fallback draws from. Defaults to light for
   * the same reason `WorldMap` does: the shell still pins `data-theme="light"`,
   * and resolving the theme a second time here would let the band disagree with
   * the page it sits on. PR3 drops the pin and wires this.
   */
  theme?: AccentTheme;
  /** Load the photograph immediately — true for a page's first hero (its LCP). */
  eager?: boolean;
  /** Radius, padding, text colour and the opaque ground. */
  className?: string;
  children?: React.ReactNode;
}

export function CountryHero({
  countryCode,
  theme = "light",
  eager = false,
  className = "",
  children,
}: CountryHeroProps) {
  const { prefs } = usePrefs();
  const country = getCountry(countryCode);
  // Per-country hue overrides are honoured; the gradient fallback has to look
  // deliberate, and a user who has recoloured a country expects to see it.
  const hero = pickHero(country, { theme, accentHue: prefs.accentHues[country.code] });
  const photo = hero.kind === "image" ? httpUrl(hero.url) : undefined;

  return (
    <div className={`relative isolate overflow-hidden ${className}`}>
      {/*
        Negative z-index, so painting order is: the caller's background, then
        these layers in document order, then everything in normal flow. The
        scrim's position between photo and text is therefore structural — it
        does not depend on a z-index anyone can outbid.
      */}
      {photo && (
        <img
          data-hero-bg
          src={photo}
          // Decorative: the country is named in the content above it, and the
          // photograph is a mood, not information.
          alt=""
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      )}
      {hero.kind === "gradient" && (
        <div
          data-hero-bg
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{ background: `linear-gradient(135deg, ${hero.fromColor}, ${hero.toColor})` }}
        />
      )}
      <div
        data-scrim
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: SCRIM }}
      />
      {children}
      {hero.kind === "image" && <Credit credit={hero.credit} />}
    </div>
  );
}

/**
 * In normal flow, deliberately. Pinned to a corner it would eventually land on
 * the chips and headings the callers put in the band — and a credit line that
 * overlaps the copy is a credit line someone deletes, which is the one outcome
 * the licence does not allow.
 */
function Credit({ credit }: { credit: ImageCredit }) {
  const source = httpUrl(credit.sourceUrl);
  const deed = httpUrl(credit.licenseUrl);
  return (
    <p className="mt-3 font-mono text-[10px] leading-4 text-white/70">
      Photo{" "}
      {source ? (
        <a href={source} target="_blank" rel="noopener noreferrer" className="underline">
          {credit.artist}
        </a>
      ) : (
        credit.artist
      )}{" "}
      ·{" "}
      {deed ? (
        <a href={deed} target="_blank" rel="noopener noreferrer" className="underline">
          {credit.license}
        </a>
      ) : (
        credit.license
      )}
    </p>
  );
}

/**
 * Exported for its test.
 *
 * Every URL here reaches us from Commons through `scripts/ingest-country-
 * images.mjs`, which is outside this repo's control: `lib/countryImagery`
 * guarantees the credit fields are *present*, not that they are addresses. A
 * `javascript:` licence deed would be script execution one click away, so the
 * scheme is checked before anything becomes an `href` or a `src`. Relative
 * paths are rejected too, and correctly — every hero is a remote file.
 */
export function httpUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
