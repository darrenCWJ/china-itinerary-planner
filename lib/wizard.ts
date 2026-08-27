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
/**
 * Which country the trip being planned is FOR.
 *
 * Not the same question as "which country is the picker open on", and the
 * wizard used to answer it with that one. `app/plan/page.tsx` held a single
 * `country` state, written only by the world-level picker, and handed it
 * straight to `buildItinerary` — so selecting a place in Peru and then moving
 * the picker to Japan produced a Japan trip whose only destination was
 * Peruvian. Everything this branch derives from country followed it over: the
 * tips, the packing list, the currency pivot, the season, the hop glyph and
 * the chop.
 *
 * THE FIRST PICK THAT KNOWS ITS OWN COUNTRY WINS. Not a majority vote and not
 * the last pick: `selected` is the trip's stop order — `suggestRoute` starts
 * the route at `selected[0]` and `onReorder` is what changes it — so the first
 * entry is the trip's lead destination and the least arbitrary single answer
 * for a model that stores one country per trip. A pick nothing knows a country
 * for is skipped rather than treated as an answer, so one unattributed id
 * cannot silently hand the decision back to the picker.
 *
 * THE PICKER IS STILL THE ANSWER WHEN NOTHING IS PICKED, which is most of the
 * time this runs: on step 0 and on an empty step 1 there is no destination to
 * speak for the trip, and the country the user is browsing is the only
 * statement of intent there is. That is also what keeps China's behaviour
 * identical — the default country, with nothing selected, resolves to itself.
 *
 * Pure and free of React so the rule is testable without the page: no test
 * file may live under app/ (vitest.config.mts includes only lib/, scripts/ and
 * components/), and `components/plan/wizardCountry.test.tsx` drives the whole
 * wizard against it.
 */
export function tripCountryFromPicks(
  selected: readonly string[],
  countryOfPick: Readonly<Record<string, string>>,
  openCountry: string
): string {
  for (const id of selected) {
    // Ownership, not truthiness — the same rule `chinaClimate` applies in
    // lib/countryBaseProfile.ts. This is a plain object built from three id
    // spaces, so a plain index would resolve `"constructor"` or `"toString"` to
    // something off the prototype chain and hand `buildItinerary` a function
    // where a country code belongs.
    if (!Object.prototype.hasOwnProperty.call(countryOfPick, id)) continue;
    const picked = countryOfPick[id];
    if (typeof picked === "string" && picked !== "") return picked;
  }
  return openCountry;
}

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
