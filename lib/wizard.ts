/**
 * The planning wizard's step order and advance gate.
 *
 * Extracted from `app/plan/page.tsx` for the reorder in spec §3.2.1: details
 * now come before destinations, because you cannot judge whether five cities fit
 * until the trip knows how many days it has. The risk of that reorder is a gate
 * that keeps checking the old step number, which is exactly the kind of thing a
 * truth table catches and a click-through does not.
 */

export const WIZARD_STEPS = ["Trip details", "Destinations", "Your plan"] as const;

export type WizardStep = 0 | 1 | 2;

export interface WizardState {
  selectedCount: number;
  days: number;
}

/**
 * Whether the Next control is live on a given step.
 *
 * Unknown steps return false rather than true: a gate that defaults open lets a
 * renumbering ship a wizard that skips its own validation.
 */
export function canAdvance(step: number, state: WizardState): boolean {
  if (state.days < 1) return false;
  switch (step) {
    case 0:
      // Details only needs a day count — destinations come next, by design.
      return true;
    case 1:
      return state.selectedCount > 0;
    default:
      // Step 2 is terminal, and anything else is out of range.
      return false;
  }
}
