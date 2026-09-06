"use client";

import dynamic from "next/dynamic";
import { usePrefs } from "@/components/shell/PrefsProvider";
import { useReducedMotion } from "@/lib/useReducedMotion";
import type { MapLevel } from "./MapExplorer";
import { STEP_UP_BUTTON } from "./stepUpButton";

/**
 * The world topology is 730KB, so `WorldMap` is a dynamic import as well as a
 * conditional render — the asset *and* the code that parses it stay off any
 * page where the picker is never opened. `GlobeLevel` carries the same asset
 * weight for its own 110m topology, so it is dynamic for the same reason.
 */
const WorldMap = dynamic(() => import("./WorldMap").then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-[var(--line-1)]/40" />,
});

const GlobeLevel = dynamic(() => import("./GlobeLevel").then((m) => m.GlobeLevel), {
  ssr: false,
  // Aspect ratio matches the globe's viewBox (860x620): the skeleton preserves
  // the globe's proportions so no visible resize occurs on swap-in. aria-busy
  // so a screen reader is told it is waiting, matching the skeleton inside
  // WorldMap itself.
  loading: () => (
    <div
      className="aspect-[860/620] w-full animate-pulse rounded-lg bg-[var(--line-1)]/40"
      aria-busy="true"
    />
  ),
});

interface Props {
  /** The country the picker highlights — ISO alpha-2, already normalised. */
  countryCode: string;
  /** What the way back down is named after. */
  countryLabel: string;
  /** Whether this pane has shown a country level yet, so a way back exists. */
  openedCountry: boolean;
  onPickCountry: (code: string) => void;
  onLevelChange: (level: MapLevel) => void;
}

/**
 * The world level: the picker, the way back down, and the renderer choice.
 *
 * Its own file because the two levels share nothing but the shell around them
 * — this one draws from its own asset, holds the two dynamic imports and is
 * the only reader of `worldView` — and because the branch that returned it was
 * `MapExplorer`'s longest.
 */
export function WorldPane({
  countryCode,
  countryLabel,
  openedCountry,
  onPickCountry,
  onLevelChange,
}: Props) {
  const { prefs, setPrefs } = usePrefs();
  const reducedMotion = useReducedMotion();
  /**
   * Reduced motion wins over an explicit globe preference.
   *
   * The globe's rotation is direct manipulation, which the guideline does not
   * forbid — but selecting a country spins it 650ms unprompted, which it does.
   * Rather than shipping a globe with the spin disabled, which is a worse globe
   * than the flat map is a map, the preference resolves to flat and the user
   * keeps a renderer that was designed to be still.
   */
  const WorldLevel = prefs.worldView === "flat" || reducedMotion ? WorldMap : GlobeLevel;

  return (
    <div className="mt-5 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-bold">Where in the world?</h3>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            {/* Was "search above": review proved that false — PlaceSearch is
                scoped to the country already chosen and cannot change it. The
                control that can is the list beneath the map. */}
            Pick a country to plan in it — or use the list below the map, which
            reaches every country whether the map draws it as a shape or a dot.
          </p>
        </div>
        {openedCountry && (
          <button
            type="button"
            onClick={() => onLevelChange("country")}
            className={STEP_UP_BUTTON}
          >
            ← Back to {countryLabel}
          </button>
        )}
      </div>
      <div className="mt-3">
        <WorldLevel selectedCountry={countryCode} onSelectCountry={onPickCountry} />
      </div>
      {/*
        Hidden under reduced motion: `WorldLevel` above has already resolved
        to the flat map in that case, and offering a globe the same render
        then refuses to show would be worse than not offering it.
      */}
      {!reducedMotion && (
        <button
          type="button"
          onClick={() =>
            setPrefs({ ...prefs, worldView: prefs.worldView === "flat" ? "globe" : "flat" })
          }
          className="mt-3 min-h-[var(--tap-min)] rounded-lg border px-3 text-sm"
          style={{ borderColor: "var(--line-1)", color: "var(--accent-ink)" }}
        >
          {prefs.worldView === "flat" ? "Show the globe" : "Show a flat map"}
        </button>
      )}
    </div>
  );
}
