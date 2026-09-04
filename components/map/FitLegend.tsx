"use client";

import { FIT_COLORS, FIT_LABELS, FIT_ORDER } from "./mapTypes";

/**
 * The key to the marker colours.
 *
 * China's map had one until `ChinaLevel` was retired in 960a6bd. `MapExplorer`
 * draws it for every country whose geometry loaded, climate or no climate,
 * because "No data" is a colour that needs explaining too. Now that every
 * country's pins carry a verdict (§9.4), a map with five colours and no key
 * is one only its author can read.
 *
 * Five existing bands in `FIT_ORDER`, drawn from `FIT_COLORS` and
 * `FIT_LABELS` and nothing else: no new swatch, no colour change, so §9.4's
 * "no contrast re-audit" holds — these are the solid swatches the audit in
 * `mapTypes.ts` was run on.
 *
 * `role="list"` beside the element for the reason `MapExplorer`'s route list
 * gives: Tailwind's preflight strips list markers and Safari/VoiceOver then
 * drop the implicit role, so a labelled list without it is announced as a
 * bare group. Nothing here is operable — a key is not a control, and the
 * tap-target sweep counts controls.
 */
export const FIT_LEGEND_LABEL = "What the marker colours mean";

export function FitLegend() {
  return (
    <ul
      role="list"
      aria-label={FIT_LEGEND_LABEL}
      className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]"
    >
      {FIT_ORDER.map((fit) => (
        <li key={fit} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: FIT_COLORS[fit] }}
          />
          {FIT_LABELS[fit]}
        </li>
      ))}
    </ul>
  );
}
