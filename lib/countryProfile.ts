import { getCountryBaseProfile, type CountryBaseProfile } from "./countryBaseProfile";
import { getCountry } from "./countries";
import { CN_GENERAL_TIPS, CN_PACKING } from "./countryData/cn";
import {
  NEUTRAL_ADAPTER_ITEM,
  NEUTRAL_DOCUMENTS_GROUP,
  NEUTRAL_OFFLINE_MAPS_ITEM,
  NEUTRAL_PACKING,
  NEUTRAL_PAYMENT_CARD_ITEM,
  NEUTRAL_TECH_GROUP,
  NEUTRAL_TIPS,
} from "./countryData/neutral";
import { getCountryFacts, getCountryName, type CountryFacts } from "./countryFacts";
import {
  buildGapNote,
  cashBackupItem,
  factTips,
  powerAdapterItem,
  translationPackItem,
} from "./countryTips";
import type { PackingGroup } from "./types";

/**
 * Where the CC0 country facts finally reach a traveller.
 *
 * Three branches, and the middle one is the whole point of Tasks 24–27:
 *
 * - **CN** — the hand-written profile, untouched. It is researched by a human,
 *   it is richer than anything the ingest produces, and `countryProfile.test.ts`
 *   pins it byte for byte. Those pins are the ingest's self-check, not a test
 *   to relax: `countryTips.test.ts` proves the same template layer fed China's
 *   *ingested* facts reproduces a line a human wrote here before Wikidata was
 *   ever queried.
 * - **facts present** — the neutral profile with the ingested sentences layered
 *   on: `tips` gains the five fact templates, `packing` gains the plug line,
 *   the cash line and the translation pack, `currency` becomes the ISO code and
 *   `gapNote` names what is still missing.
 * - **neither** — the neutral profile, with a gap note if we at least know what
 *   the country is called. `factsProfile` fed an empty record is exactly this,
 *   and a test pins the two equal, so the branch is a readable name for a
 *   boundary rather than a second definition that can drift.
 *
 * **`currency` is `string | null` since T27, and the null is load-bearing.**
 * It used to fall back to a documented `"USD"` placeholder, with
 * `isCurrencyResearched` mirroring `getCountryProfile`'s CN-only dispatch to
 * keep that placeholder off the money surfaces. The placeholder is gone: an
 * unknown currency is now absent, and `isCurrencyResearched` reads the absence
 * instead of re-deriving it. The two must always move together — see its
 * docblock at the bottom of this file.
 *
 * **The 70 KB lives here, deliberately, and not one module lower.** This is the
 * only country module that reads `data/country-facts.json`, through
 * lib/countryFacts.ts. Everything that does not need a fact reads
 * lib/countryBaseProfile.ts instead — see that file's header for the four
 * client components this split exists for, and lib/countryFacts.test.ts for the
 * transitive import walk that fails the build if one of them reaches back here.
 */

/**
 * Re-exported so the generators keep one import for "which country, and what
 * does it say". The types are not re-exported: a caller that wants
 * `TransportProfile` or `CountryCopy` alone wants lib/countryBaseProfile.ts,
 * and reaching for them through here would pull the artifact into its bundle
 * for a type that is erased at compile time.
 */
export { DEFAULT_COUNTRY } from "./countryBaseProfile";

export interface CountryProfile extends CountryBaseProfile {
  /**
   * What to call this country to a traveller, or `""` when the code is not one.
   *
   * `getCountryName`'s answer, carried here so a renderer can have it without
   * naming lib/countryFacts.ts: hand-tuned first (lib/countries.ts's 24, so
   * "China" and not Wikidata's "People's Republic of China"), the CC0 artifact
   * for the other 222, blank last. It lives on the profile rather than being
   * looked up at the call site because `getCountryProfile` already resolves it
   * for the gap note — and because the alternative for a client component is
   * `getCountry(code).name`, which falls back to the bare code and so put "Your
   * PE itinerary" on the wizard for 90% of the world.
   *
   * The blank is a real answer and must stay renderable as one: a caller that
   * would otherwise print "Your  itinerary" should drop the name, not print a
   * code in its place.
   */
  name: string;
  /** The whole packing document, not a set of deltas. */
  packing: PackingGroup[];
  /** Generation-time tips, snapshotted into the trip when it is created. */
  tips: string[];
  /**
   * ISO 4217 conversion pivot, or `null` when no currency is known.
   *
   * Null rather than a placeholder. A guessed pivot reaches the Money tab as a
   * fact about the destination, and every consumer of this field has to be able
   * to tell "we know" from "we do not" — which a fallback code makes impossible.
   * `isCurrencyResearched` is exactly `currency !== null`.
   */
  currency: string | null;
  /**
   * The honesty surface: what our data does not cover for this country.
   *
   * Empty for China (researched by hand, nothing to disclaim) and for a code
   * that is not a country (a note that cannot say whose data is missing is not
   * a statement anyone can act on). Never snapshotted into a trip — it is a
   * claim about our current coverage, not about the trip, so it must shrink as
   * coverage improves. T28 renders it.
   */
  gapNote: string[];
}

/** Fresh groups with fresh item arrays, so a caller may edit what it is handed. */
function copyPacking(groups: readonly PackingGroup[]): PackingGroup[] {
  return groups.map((group) => ({ ...group, items: [...group.items] }));
}

/**
 * Put `item` next to `anchor`, or at the end when the anchor has gone.
 *
 * The fallback is the point. The anchors are the neutral document's own
 * exported strings, so they cannot drift by rewording — but a future edit that
 * *removes* one would otherwise silently drop the fact item, which is the one
 * outcome this whole feature exists to prevent. Appending keeps the sentence.
 * `countryProfile.test.ts` pins that every anchor is still found, so the
 * fallback stays a safety net rather than the path production takes.
 */
function spliced(items: string[], anchor: string, offset: 0 | 1, item: string): string[] {
  const at = items.indexOf(anchor);
  const out = [...items];
  out.splice(at === -1 ? out.length : at + offset, 0, item);
  return out;
}

/**
 * The neutral packing document with the facts spliced in, group by group.
 *
 * Shaped after China's hand-written document, which is the one packing list in
 * this repo a human verified: the plug-and-voltage line *replaces* the generic
 * adapter rather than sitting beside it, and the currency cash line follows the
 * payment-card item. The translation pack is an addition, not a replacement —
 * `NEUTRAL_OFFLINE_MAPS_ITEM` covers maps too, and it fires for the many
 * countries that have more than one official language.
 */
function factsPacking(countryName: string, facts: CountryFacts): PackingGroup[] {
  const adapter = powerAdapterItem(countryName, facts);
  const cash = cashBackupItem(facts);
  const pack = translationPackItem(facts);

  return copyPacking(NEUTRAL_PACKING).map((group) => {
    if (group.title === NEUTRAL_DOCUMENTS_GROUP && cash !== null) {
      return { ...group, items: spliced(group.items, NEUTRAL_PAYMENT_CARD_ITEM, 1, cash) };
    }
    if (group.title === NEUTRAL_TECH_GROUP) {
      let items = group.items;
      if (adapter !== null) {
        const at = items.indexOf(NEUTRAL_ADAPTER_ITEM);
        items = at === -1 ? [adapter, ...items] : items.map((it, i) => (i === at ? adapter : it));
      }
      if (pack !== null) items = spliced(items, NEUTRAL_OFFLINE_MAPS_ITEM, 0, pack);
      return { ...group, items };
    }
    return group;
  });
}

function chinaProfile(): CountryProfile {
  return {
    ...getCountryBaseProfile("CN"),
    // Resolved the same way as every other country's rather than written as a
    // literal here, so the hand-tuned-beats-ingested precedence has one
    // implementation. `getCountryName("CN")` is "China" because
    // lib/countries.ts says so, not because this branch does.
    name: getCountryName("CN"),
    packing: copyPacking(CN_PACKING),
    tips: [...CN_GENERAL_TIPS],
    currency: "CNY",
    // Researched by hand. There is no open-reference-data caveat to make.
    gapNote: [],
  };
}

/**
 * Everything a country gets before its facts are known.
 *
 * The gap note still fires here, and that is the case it matters most for: a
 * country the ingest never reached is the one whose blank tips panel most needs
 * an explanation. It is empty only when `countryName` is blank, which means the
 * code is not a country at all.
 */
function neutralProfile(code: string, countryName: string): CountryProfile {
  return {
    ...getCountryBaseProfile(code),
    name: countryName,
    packing: copyPacking(NEUTRAL_PACKING),
    tips: [...NEUTRAL_TIPS],
    currency: null,
    gapNote: buildGapNote(countryName, {}),
  };
}

function factsProfile(code: string, countryName: string, facts: CountryFacts): CountryProfile {
  return {
    ...getCountryBaseProfile(code),
    name: countryName,
    packing: factsPacking(countryName, facts),
    // Neutral first, facts after: the three neutral lines are about the trip
    // (passport, bank, offline maps) and hold everywhere, and the fact lines
    // are about the place. Reversing them would open the panel with a currency
    // code.
    tips: [...NEUTRAL_TIPS, ...factTips(facts)],
    currency: facts.currencyCode ?? null,
    gapNote: buildGapNote(countryName, facts),
  };
}

/**
 * Total function: every code yields a profile, including codes that are not
 * countries. Callers read the profile rather than branching on whether the
 * country is supported, which is what keeps an unresearched country from
 * breaking generation.
 *
 * Fresh objects each call: the arrays are copies, so a caller that mutates
 * what it is handed cannot corrupt the curated tables for everyone else. That
 * survives the facts artifact only because `getCountryFacts` re-reads through
 * its own validator on every call — see its docblock, which names this contract
 * as the reason it is not memoised.
 */
export function getCountryProfile(code: string): CountryProfile {
  if (getCountry(code).code === "CN") return chinaProfile();

  const facts = getCountryFacts(code);
  const countryName = getCountryName(code);
  return Object.keys(facts).length > 0
    ? factsProfile(code, countryName, facts)
    : neutralProfile(code, countryName);
}

/**
 * Whether `getCountryProfile(code).currency` is a fact rather than an absence.
 *
 * Exists for callers (the live-rates page, Task 7) that must never present a
 * guess as fact — see judgment call J-C1 in
 * docs/superpowers/plans/2026-08-17-pr4-currency-pivot-plan.md. Before T27 the
 * profile handed out a documented `"USD"` placeholder for every unresearched
 * country and this predicate mirrored `getCountryProfile`'s CN-only dispatch to
 * keep that placeholder off the money surfaces.
 *
 * The placeholder is gone: `currency` is `null` where nothing is known, and
 * this reads that null instead of re-deriving which countries are researched.
 * Re-deriving is what it must never go back to. **The predicate and the field
 * have to move together** — a predicate that still answered "CN only" while the
 * field carried Japan's real JPY would report a fact as a guess, and one that
 * answered "always" while the field could be null would report a guess as a
 * fact. Neither is a compile error, and `countryProfile.test.ts` sweeps the two
 * against each other over every country there is.
 */
export function isCurrencyResearched(code: string): boolean {
  return getCountryProfile(code).currency !== null;
}
