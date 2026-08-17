"use client";

import { assessFeasibility, type FeasibilityPlace } from "@/lib/feasibility";

/**
 * The live counter (spec §3.2.3): `5 cities · 12 nights needed · 7 days set —
 * 5 over`. Persistently visible while picking, so the conflict surfaces at the
 * moment of choice rather than three screens later.
 *
 * A presenter over `assessFeasibility` and nothing more — the arithmetic, and
 * every argument about how many nights a place needs, is tested in lib.
 */
interface Props {
  places: readonly FeasibilityPlace[];
  daysSet: number;
}

export function FeasibilityCounter({ places, daysSet }: Props) {
  const { cities, nightsNeededMin, delta, verdict } = assessFeasibility(places, daysSet);

  /** Explicit plural form, because "city" does not take a bare -s. */
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <p
      // Polite, not assertive: this updates on every add and remove, and an
      // assertive region would interrupt the screen reader mid-word each time.
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-2 rounded-lg border px-3 py-2 text-sm ${
        verdict === "over" ? "border-seal/50 bg-seal/5" : "border-sky bg-paper"
      }`}
    >
      {verdict === "empty" ? (
        <span className="text-ink-soft">
          Pick your first place — {count(daysSet, "day", "days")} to fill.
        </span>
      ) : (
        <>
          <span className="font-semibold">{count(cities, "city", "cities")}</span>
          <span aria-hidden className="text-ink-soft">·</span>
          <span>{count(nightsNeededMin, "night", "nights")} needed</span>
          <span aria-hidden className="text-ink-soft">·</span>
          <span>{count(daysSet, "day", "days")} set</span>
          {delta < 0 && (
            <span className="font-semibold text-seal">— {Math.abs(delta)} over</span>
          )}
          {delta > 0 && <span className="text-ink-soft">— {delta} spare</span>}
        </>
      )}
    </p>
  );
}
