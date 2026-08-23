"use client";

import { useRef, useState } from "react";
import { accentColor, type AccentTheme } from "@/lib/accent";
import { getCountry } from "@/lib/countries";
import { usePrefs } from "@/components/shell/PrefsProvider";
import { CountryHero } from "@/components/shell/CountryHero";

/**
 * Everything the two world-level renderers share, which is most of them.
 *
 * `WorldMap` and `GlobeLevel` differ in exactly one thing that matters: which
 * projection turns a country into pixels, and therefore whether the set of
 * drawable countries changes as the user interacts. Selection, keyboard
 * navigation, tinting, the A-Z picker, the selected-country card, the error
 * state and the skeleton are identical in both, and identical to what
 * `WorldMap` did before this module existed.
 *
 * Extracted rather than copied because every one of these is an accessibility
 * affordance that was argued for once, in `WorldMap`'s docblock, and would
 * otherwise have to be re-argued and kept in step in a second file — the
 * roving tabindex, the `--tap-min` picker that exists because a 9-unit circle
 * cannot meet it, the dashed focus ring that distinguishes focus from
 * selection. Two copies of an accessibility guarantee is one guarantee and one
 * liability.
 */

/** One keyboard stop per country, whichever layer it is selected through. */
export interface Entry {
  code: string;
  name: string;
}

/** Curated names beat the topology's ("Türkiye", not "Turkey"). */
export function countryLabel(code: string, topologyName: string): string {
  const curated = getCountry(code).name;
  return curated && curated !== code ? curated : topologyName;
}

/** Tint strength by state. Hue carries identity; opacity carries interaction. */
const FILL_BASE = 0.5;
const FILL_HOVER = 0.75;
const FILL_SELECTED = 0.95;

export interface CountrySelectionOptions {
  /** The stable, rotation-independent list of every country, in name order. */
  entries: Entry[];
  /** Code to index, for arrow-key movement. */
  indexOf: Map<string, number>;
  /**
   * Codes with a node on screen right now.
   *
   * Equal to `entries` for the flat map, a strict subset for the globe. The
   * distinction is what keeps the map in the tab order: `tabIndex 0` on a
   * country that is not rendered leaves the whole map with no tab stop, and
   * Shift+Tab unable to re-enter it.
   */
  mounted: ReadonlySet<string>;
  /** ISO alpha-2 of the chosen country, already trimmed and upper-cased. */
  selected: string | null;
  onSelectCountry: (code: string) => void;
  /**
   * Called when the keyboard moves to a country that has no node on screen.
   *
   * The flat map never calls this — everything it draws is always mounted. The
   * globe uses it to turn to the country before focusing it, which is what
   * makes the roving ring cover all 235 rather than whichever hemisphere
   * happens to be facing the user.
   */
  onFocusOffscreen?: (code: string) => void;
  /**
   * Which accent ramp to tint fills with. Defaults to the ramp `usePrefs`
   * resolved — resolving the theme a second time here would let the map
   * disagree with the page it sits on. Override only to render a fixed ramp.
   *
   * Mirrors `WorldMap`'s own `theme` prop; a caller that overrides one must
   * pass the same value here, or the fills and the selected-country card
   * (which still resolves through `WorldMap`) will disagree.
   */
  theme?: AccentTheme;
}

/** Everything spread onto a country's `<g>`, whatever layer draws it. */
export interface CountryInteractionProps {
  ref: (node: SVGGElement | null) => void;
  role: "button";
  tabIndex: number;
  "aria-pressed": boolean;
  "aria-label": string;
  className: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export interface CountrySelection {
  /** Everything an interactive country needs, whatever layer draws it. */
  interactionProps: (code: string, name: string) => CountryInteractionProps;
  /** Stroke colour, width and dash for one country's current state. */
  strokeFor: (code: string) => {
    stroke: string;
    strokeWidth: number;
    strokeDasharray: string | undefined;
  };
  /** Fill opacity for one country's current state. */
  opacityFor: (code: string) => number;
  /** The country's own accent fill. */
  fillFor: (code: string) => string;
  /** The one code carrying `tabIndex 0`, or null when nothing is mounted. */
  tabStop: string | null;
  /** Re-focus whatever is active; the globe calls this after a spin lands. */
  refocus: () => void;
}

/**
 * Selection, hover, focus and keyboard navigation for a world-level map.
 *
 * Roving tabindex: the map is one tab stop, and arrows move within it.
 * `ChinaMap` makes every curated marker a tab stop, which is fine for thirty
 * of them and indefensible for 235 — a keyboard user would tab a quarter of
 * the way round the world to reach the control after the map. Enter/Space to
 * select is unchanged from that pattern; only which element is reachable by
 * Tab differs.
 */
export function useCountrySelection({
  entries,
  indexOf,
  mounted,
  selected,
  onSelectCountry,
  onFocusOffscreen,
  theme: themeOverride,
}: CountrySelectionOptions): CountrySelection {
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const { prefs, theme: resolvedTheme } = usePrefs();
  const theme = themeOverride ?? resolvedTheme;
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  const tabStop =
    (activeCode && mounted.has(activeCode) ? activeCode : null) ??
    (selected && mounted.has(selected) ? selected : null) ??
    entries.find((entry) => mounted.has(entry.code))?.code ??
    null;

  const focusEntry = (index: number) => {
    if (entries.length === 0) return;
    const wrapped = ((index % entries.length) + entries.length) % entries.length;
    const next = entries[wrapped];
    setActiveCode(next.code);
    // A country with no node cannot take focus, and `?.focus()` would no-op
    // silently — leaving React's idea of what is active pointing at nothing.
    // The renderer that can do something about it gets told instead.
    if (!mounted.has(next.code)) onFocusOffscreen?.(next.code);
    nodeRefs.current.get(next.code)?.focus();
  };

  const stepFor = (key: string): number => {
    if (key === "ArrowRight" || key === "ArrowDown") return 1;
    if (key === "ArrowLeft" || key === "ArrowUp") return -1;
    return 0;
  };

  const handleKeyDown = (event: React.KeyboardEvent, code: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectCountry(code);
      return;
    }
    const from = indexOf.get(code) ?? 0;
    const step = stepFor(event.key);
    if (step !== 0) {
      event.preventDefault();
      focusEntry(from + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusEntry(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusEntry(entries.length - 1);
    }
  };

  /**
   * Per-country hue overrides are honoured; a *fixed* accent is deliberately
   * not. "One accent everywhere" (spec §4.3) applied to this map would paint
   * 235 countries the same colour and erase the only thing the tint says.
   */
  const fillFor = (code: string): string =>
    accentColor(code, theme, "fill", prefs.accentHues[code]);

  return {
    tabStop,
    fillFor,
    refocus: () => {
      if (activeCode) nodeRefs.current.get(activeCode)?.focus();
    },
    interactionProps: (code: string, name: string) => {
      const isSelected = code === selected;
      return {
        ref: (node: SVGGElement | null) => {
          if (node) nodeRefs.current.set(code, node);
          else nodeRefs.current.delete(code);
        },
        role: "button",
        tabIndex: code === tabStop ? 0 : -1,
        "aria-pressed": isSelected,
        "aria-label": `${name}${isSelected ? " (selected)" : ""}`,
        className: "cursor-pointer",
        onClick: () => onSelectCountry(code),
        onKeyDown: (event: React.KeyboardEvent) => handleKeyDown(event, code),
        onFocus: () => {
          setActiveCode(code);
          setFocusedCode(code);
        },
        onBlur: () => setFocusedCode((current) => (current === code ? null : current)),
        onMouseEnter: () => setHoverCode(code),
        onMouseLeave: () => setHoverCode((current) => (current === code ? null : current)),
      };
    },
    strokeFor: (code: string) => {
      const isSelected = code === selected;
      const isFocused = code === focusedCode;
      return {
        stroke: isSelected || isFocused ? "var(--ink-0)" : "var(--paper)",
        strokeWidth: isSelected ? 1.6 : isFocused ? 1.2 : 0.4,
        // Dashed marks keyboard focus apart from selection, so the two states are
        // still distinguishable when they land on the same country.
        strokeDasharray: isFocused && !isSelected ? "3 2" : undefined,
      };
    },
    opacityFor: (code: string): number => {
      if (code === selected) return FILL_SELECTED;
      if (code === hoverCode) return FILL_HOVER;
      return FILL_BASE;
    },
  };
}

/**
 * The pointer target that meets `--tap-min` for the countries whose only shape
 * on the map is a ~22px circle at desktop and ~6px at 375px — `POINT_HIT_R`
 * cannot grow, because San Marino and Vatican City sit ~6 viewBox units apart
 * and a compliant circle would swallow its neighbours. Every country the map
 * knows about is here, so this is the equivalent control WCAG 2.2 AA 2.5.8
 * allows and the guaranteed path spec §6 requires, not a shortcut for small
 * ones only. It costs one tab stop, not 235.
 *
 * On the globe it does more: it is the only way to reach a country on the far
 * side at all, which is why `entries` must never be filtered by what is drawn.
 */
export function CountryPicker({
  id,
  entries,
  selectedCode,
  onSelectCountry,
}: {
  id: string;
  entries: Entry[];
  /** Empty when the chosen country is not one this map knows. */
  selectedCode: string;
  onSelectCountry: (code: string) => void;
}) {
  return (
    <div className="mt-3">
      <label
        htmlFor={id}
        className="block font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--ink-2)]"
      >
        Or pick from the list
      </label>
      <select
        id={id}
        value={selectedCode}
        onChange={(event) => {
          const code = event.target.value;
          if (code) onSelectCountry(code);
        }}
        className="mt-1 min-h-[var(--tap-min)] w-full rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-3 text-sm text-[var(--ink-0)]"
      >
        <option value="">Every country, A–Z…</option>
        {entries.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The chosen country's imagery (spec §4.4).
 *
 * The ground is a fixed dark value and not `--ink-0`, which is what it was
 * while the shell pinned light. Everything above the scrim here is literal
 * white — `text-white` below, and `white/70` on the eyebrow — so the ground
 * has to stay dark in *both* ramps. `--ink-0` inverts to near-white under
 * `data-theme="dark"` and would have put white type on a white band. This is
 * the light ramp's own `--ink-0` value, frozen: the band is unchanged in light
 * and reads as an elevated dark surface on dark paper.
 */
export function SelectedCountryCard({
  entry,
  theme,
}: {
  entry: Entry | undefined;
  theme: AccentTheme;
}) {
  if (!entry) return null;
  return (
    <CountryHero
      countryCode={entry.code}
      theme={theme}
      className="mt-3 rounded-xl bg-[#17263b] px-4 py-3 text-white"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/70">Selected</p>
      <p className="font-display text-lg font-bold">{entry.name}</p>
    </CountryHero>
  );
}

/**
 * A missing or malformed asset is a picker that cannot draw, not a page that
 * should crash — the map is a discovery affordance and search is the
 * guaranteed path (spec §6). Retry is offered; the caller keeps working.
 */
export function WorldLevelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="rounded-xl border p-6 text-center"
      style={{ borderColor: "var(--line-1)", background: "var(--raise)" }}
    >
      <p className="text-sm" style={{ color: "var(--ink-2)" }}>
        Couldn&apos;t load the world map. You can still search for a country.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-[var(--tap-min)] rounded-lg border px-4 text-sm font-medium"
        style={{ borderColor: "var(--line-1)", color: "var(--accent-ink)" }}
      >
        Try again
      </button>
    </div>
  );
}

export function WorldLevelSkeleton() {
  return (
    <div
      className="animate-pulse rounded-xl border p-6"
      style={{ borderColor: "var(--line-1)", background: "var(--surf-1)" }}
      aria-busy="true"
    >
      <div className="h-[420px] rounded-lg" style={{ background: "var(--surf-2)" }} />
      <p className="mt-3 text-center text-sm" style={{ color: "var(--ink-2)" }}>
        Unrolling the world…
      </p>
    </div>
  );
}
