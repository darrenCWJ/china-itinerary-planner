import type { ReactElement } from "react";

/**
 * The honesty surface, rendered. T28.
 *
 * `CountryProfile.gapNote` says what our data does not cover for a country —
 * one line naming the source and the four subjects we have nothing on, plus a
 * second line naming the individual facts we are missing when any are. This
 * component is the only place it is drawn, on all three tip surfaces:
 * `components/PlanStep.tsx`, `components/trip/PlanTab.tsx` and
 * `components/trip/BriefingView.tsx`.
 *
 * **It takes lines, not a country code, and that is load-bearing.** Resolving
 * the note needs `lib/countryProfile.ts`, which reaches the 70 KB facts
 * artifact; a component that resolved it itself would drag those bytes into
 * every bundle that renders a briefing, including the unauthenticated
 * `/b/[code]` page. Taking `string[]` keeps this file free, so each caller pays
 * only if it was already paying. `lib/countryFacts.test.ts` enforces that.
 *
 * **`role="note"`, and never a list item.** The design's requirement is
 * "structurally distinct from a tip", not merely styled like one — a screen
 * reader announcing this as the sixth tip would turn a disclaimer *about* the
 * advice into a piece of advice. `note` is the ARIA role for content that is
 * parenthetic to the main content, and it gives every surface's test a stable
 * handle to assert the element sits outside the tips `<ul>`.
 *
 * Renders nothing for an empty array, which is China (researched by hand) and
 * any code that is not a country (a note that cannot name whose data is
 * missing is not actionable).
 */
export function GapNote({ lines }: { lines: readonly string[] }): ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <div
      role="note"
      aria-label="About these notes"
      // Muted and visibly not advice: no bullet, no seal glyph, smaller and
      // dimmer than a tip, separated from the list by a rule.
      className="mt-3 border-t border-dashed border-[var(--line-1)] pt-3 text-xs italic leading-relaxed text-[var(--ink-2)]"
    >
      {lines.map((line) => (
        <p key={line} className="[&+p]:mt-1.5">
          {line}
        </p>
      ))}
    </div>
  );
}
