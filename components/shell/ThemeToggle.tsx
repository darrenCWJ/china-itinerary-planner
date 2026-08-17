"use client";

import { isHue, type ThemePref } from "@/lib/prefs";
import { usePrefs } from "./PrefsProvider";

/**
 * Display preferences in the header (spec §2.3, §4.3): theme, and whether the
 * accent follows the country or is pinned.
 *
 * Uses `<details>` rather than a hand-built popover. Native disclosure gives a
 * focusable trigger and correct semantics for free; Task 10's CrewMenu has a
 * stricter brief (Esc closes, focus returns) and is the right place to build
 * that pattern — and if it does, this can adopt it rather than the two being
 * half-built in parallel.
 */

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Where a newly-pinned accent starts, when there is no previous hue to keep. */
const DEFAULT_FIXED_HUE = 210;

export function ThemeToggle() {
  const { prefs, setPrefs } = usePrefs();
  const fixedHue = isHue(prefs.accent) ? prefs.accent : DEFAULT_FIXED_HUE;

  return (
    <details className="relative print:hidden">
      <summary
        aria-label="Display settings"
        className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] cursor-pointer list-none items-center justify-center rounded-lg"
        style={{ color: "var(--ink-2)" }}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.1 5.1l1.4 1.4M17.5 17.5l1.4 1.4M18.9 5.1l-1.4 1.4M6.5 17.5l-1.4 1.4" />
        </svg>
      </summary>

      <div
        className="absolute right-0 z-20 mt-1 w-56 rounded-xl border p-3 shadow-lg"
        style={{
          borderColor: "var(--line-1)",
          background: "var(--raise)",
          color: "var(--ink-1)",
        }}
      >
        <fieldset>
          <legend className="text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
            Theme
          </legend>
          <div className="mt-1 flex flex-col">
            {THEME_OPTIONS.map((option) => {
              // PR1 pins rendering to light because today's components hardcode
              // light palette utilities; offering a choice that changes nothing
              // would be a lie. PR3 Task 37 drops the pin and this `disabled`.
              const locked = option.value !== "light";
              return (
                <label
                  key={option.value}
                  className="flex min-h-[var(--tap-min)] items-center gap-2 text-sm"
                  style={locked ? { color: "var(--ink-4)" } : undefined}
                  title={locked ? "Dark mode lands with the redesign" : undefined}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={prefs.theme === option.value}
                    disabled={locked}
                    onChange={() => setPrefs({ ...prefs, theme: option.value })}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-2 border-t pt-2" style={{ borderColor: "var(--line-2)" }}>
          <legend className="text-xs font-semibold" style={{ color: "var(--ink-2)" }}>
            Accent
          </legend>
          <label className="flex min-h-[var(--tap-min)] items-center gap-2 text-sm">
            <input
              type="radio"
              name="accent"
              checked={prefs.accent === "country"}
              onChange={() => setPrefs({ ...prefs, accent: "country" })}
            />
            Per country
          </label>
          <label className="flex min-h-[var(--tap-min)] items-center gap-2 text-sm">
            <input
              type="radio"
              name="accent"
              checked={prefs.accent !== "country"}
              onChange={() => setPrefs({ ...prefs, accent: fixedHue })}
            />
            Fixed
          </label>
          {prefs.accent !== "country" && (
            <label className="mt-1 block text-xs" style={{ color: "var(--ink-2)" }}>
              Hue
              {/*
                A hue and nothing else. Lightness and chroma are pinned per role
                in lib/accent, so no value reachable from this slider can produce
                an illegible accent — which is what lets the control be a bare
                range input with no contrast validation behind it.
              */}
              <input
                type="range"
                min={0}
                max={359}
                value={fixedHue}
                onChange={(event) => setPrefs({ ...prefs, accent: Number(event.target.value) })}
                className="mt-1 block w-full"
                aria-label="Accent hue"
              />
            </label>
          )}
        </fieldset>
      </div>
    </details>
  );
}
