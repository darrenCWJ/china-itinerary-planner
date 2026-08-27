import type { CountryFacts, EmergencyNumber } from "./countryFacts";

/**
 * Facts become sentences. This module is the whole template layer.
 *
 * **The honest-gap rule, which is the point of the feature.** A template fires
 * only when every fact it names is present. There is no partial sentence, no
 * hedge ("possibly", "typically around"), no placeholder ("unknown", "N/A",
 * "—"). A country with no facts produces no fact-tips at all — just the gap
 * note, which says out loud what is missing so silence cannot be mistaken for
 * "we forgot Peru".
 *
 * That absent path is the COMMON path, not a defensive edge. Measured on the
 * committed artifact: plug types cover 207 of 246 countries, and 15 of the 39
 * absences are deliberate — one Wikidata item covers both BS 546 type D and
 * type M, so India, South Africa, Pakistan, Israel, Sri Lanka and ten others
 * carry no `plugs` field rather than a guessed one. Every template here is
 * exercised in both directions by `countryTips.test.ts`.
 *
 * **The reproduction gate.** `powerAdapterItem` fed China's ingested facts
 * emits, character for character, the line a human wrote in
 * `lib/countryData/cn.ts` before this ingest existed. That is an independent
 * check on this entire layer — the one country whose answer is known to be
 * right, by a source that never saw Wikidata.
 *
 * **What is deliberately not here.** `currencyName` is never rendered (Peru's
 * committed label is the pre-2015 "Nuevo sol", 238 more are unchecked, and the
 * 2026-08-27 re-measurement found no better property — see lib/countryFacts.ts),
 * no template picks a "primary" official language out of an alphabetical set,
 * and nothing states a season, a crowd level or a holiday.
 *
 * **Where the country name comes from.** The two templates that need one take
 * it as a PARAMETER, so this module has one import and no table of its own.
 * `getCountryName` in lib/countryFacts.ts is the single place that resolves it
 * — the hand-tuned name where lib/countries.ts has one, the ingested Wikidata
 * label for the other 222 countries, and `""` for a code that is not a
 * country, which both name-taking functions treat as "say nothing".
 */

/**
 * "A", "A and B", "A, B and C" — or the same with "or".
 *
 * Never emits a dangling separator, which is the shape a partial sentence
 * takes when a list template is fed a shorter list than it expected.
 */
function joinWith(items: readonly string[], conjunction: "and" | "or"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

/**
 * Prices and the money pivot.
 *
 * The ISO code and nothing else: `currencyName` is an unverified upstream
 * label and Peru's is provably wrong. Naming the Money tab is the actionable
 * half — the code alone tells a traveller nothing they can do.
 */
export function currencyTip(facts: CountryFacts): string | null {
  if (facts.currencyCode === undefined) return null;
  return `Prices are in ${facts.currencyCode}. Set your home currency on the Money tab for live conversions.`;
}

/**
 * Sockets. Needs both the plug letters and the voltage: "sockets are type A, B
 * and C" without a voltage is advice a traveller cannot act on, and a voltage
 * with no plug letters is a number with no socket attached to it.
 */
export function socketsTip(facts: CountryFacts): string | null {
  const { plugs, voltageV } = facts;
  if (plugs === undefined || voltageV === undefined) return null;
  return `Sockets are type ${joinWith(plugs, "and")} at ${voltageV} V — bring a universal adapter.`;
}

/**
 * Turn the raw entry list into clauses, losing no number and repeating none.
 *
 * Two upstream shapes force this, and each defeats the naive handling of the
 * other. Peru gives four entries with **two** roled ambulance (106 and 117),
 * so listing entries flat repeats the role: "106 ambulance, 117 ambulance".
 * South Africa gives 112 three times, once per role, so listing entries flat
 * repeats the number: "112 police, 112 fire, 112 ambulance". Dropping either
 * duplicate discards a fact a traveller may need.
 *
 * So: collect the numbers under each role, then merge the roles that ended up
 * with the identical number list. Peru becomes "106 or 117 ambulance", South
 * Africa becomes "112 police, fire and ambulance", and Switzerland — which has
 * both shapes at once — becomes "1414 or 144 ambulance, 112 emergency".
 * Measured: 28 of the 221 countries with emergency numbers repeat a role, so
 * neither shape is a special case.
 */
function emergencyClauses(entries: readonly EmergencyNumber[]): string[] {
  const roleOrder: (string | null)[] = [];
  const numbersByRole = new Map<string | null, string[]>();
  for (const entry of entries) {
    const numbers = numbersByRole.get(entry.role);
    if (numbers === undefined) {
      roleOrder.push(entry.role);
      numbersByRole.set(entry.role, [entry.number]);
    } else if (!numbers.includes(entry.number)) {
      numbers.push(entry.number);
    }
  }

  /** Roles sharing one number list, keyed by that list so they merge. */
  const clauseOrder: string[] = [];
  const rolesByNumbers = new Map<string, (string | null)[]>();
  for (const role of roleOrder) {
    const key = (numbersByRole.get(role) ?? []).join("|");
    const roles = rolesByNumbers.get(key);
    if (roles === undefined) {
      clauseOrder.push(key);
      rolesByNumbers.set(key, [role]);
    } else {
      roles.push(role);
    }
  }

  return clauseOrder.map((key) => {
    const numbers = joinWith(key.split("|"), "or");
    const roles = (rolesByNumbers.get(key) ?? []).filter((role): role is string => role !== null);
    // A roleless number is emitted bare rather than under an invented label:
    // 69 countries carry only roleless numbers, and calling one "general" or
    // "emergency" would be this module writing a fact upstream did not supply.
    return roles.length === 0 ? numbers : `${numbers} ${joinWith(roles, "and")}`;
  });
}

export function emergencyTip(facts: CountryFacts): string | null {
  const { emergency } = facts;
  if (emergency === undefined || emergency.length === 0) return null;
  const distinct = new Set(emergency.map((entry) => entry.number)).size;
  return `Emergency number${distinct === 1 ? "" : "s"}: ${emergencyClauses(emergency).join(", ")}.`;
}

/**
 * Official languages, all of them, in the artifact's alphabetical order.
 *
 * No template here picks a primary. Wikidata's P37 is a set and states no
 * primacy, so "Spanish is the official language, with Quechua and Aymara also
 * official" would be this module inventing a rank the data does not carry.
 * The cost is honest and visible: South Africa's twelve are all named, and
 * `countryTips.test.ts` carries that exact output as a golden so the cost is
 * reviewed rather than discovered.
 *
 * **It states the fact and stops.** It used to end "— download an offline
 * translation pack before you go", four lines under `NEUTRAL_TIPS`' own
 * "Download offline maps and a translation pack before you leave." Two
 * templates carrying one instruction is not two pieces of advice, it is the
 * same instruction twice — for 239 of the 246 countries — and a panel that
 * repeats itself is a panel a traveller stops reading, which costs them the
 * tips that were worth reading.
 *
 * The instruction stays on the neutral tip because that is the line every
 * country gets: the seven with no official language in the artifact (AF, BQ,
 * GP, MQ, PW, US, UY) never had this tip, so they lose nothing here and still
 * get the advice. Stripping the neutral line instead and letting this one
 * carry the instruction is the mirror-image mistake — it would leave exactly
 * those seven, the countries we know least about, the only ones never told to
 * download a translation pack. `countryProfile.test.ts` sweeps every country
 * for the instruction and pins the count at one.
 */
export function languageTip(facts: CountryFacts): string | null {
  const languages = facts.officialLanguages;
  if (languages === undefined || languages.length === 0) return null;
  return languages.length === 1
    ? `${languages[0]} is the official language.`
    : `${joinWith(languages, "and")} are official languages.`;
}

/**
 * Two independent clauses in one tip, each a complete sentence on its own.
 *
 * Not one template needing both facts: driving side covers 245 countries and
 * the dialling code 237, so an all-or-nothing rule would throw away a true
 * driving side for eight countries to protect a sentence that was never at
 * risk. Whichever clauses fire are joined; if neither does, the tip is absent.
 */
export function roadAndDiallingTip(facts: CountryFacts): string | null {
  const clauses: string[] = [];
  if (facts.drivingSide !== undefined) clauses.push(`Traffic drives on the ${facts.drivingSide}.`);
  if (facts.callingCode !== undefined) {
    clauses.push(`The international dialling code is ${facts.callingCode}.`);
  }
  return clauses.length > 0 ? clauses.join(" ") : null;
}

/**
 * The five fact-derived tips, in the order the design's Peru example lists
 * them, with the ones that could not fire simply absent.
 */
export function factTips(facts: CountryFacts): string[] {
  return [currencyTip, socketsTip, emergencyTip, languageTip, roadAndDiallingTip]
    .map((template) => template(facts))
    .filter((tip): tip is string => tip !== null);
}

/**
 * THE REPRODUCTION GATE.
 *
 * Fed China's ingested facts and the name "China", this emits
 * `Universal power adapter (China uses type A/C/I plugs, 220V)` — the exact
 * string a human wrote in `lib/countryData/cn.ts`, moved there from
 * `lib/packing.ts` by T20, without ever seeing Wikidata. China's P2853 values
 * are Europlug + NEMA 1-15 + AS/NZS 3112, which sort to A, C and I, and its
 * P2884 is 220.
 *
 * `countryTips.test.ts` asserts this against the string read out of
 * `CN_PACKING` itself rather than a retyped copy, so an edit to either side
 * fails the build. It is the strongest check in this layer precisely because
 * it is not self-referential.
 *
 * Takes the country name as an argument rather than looking it up, so this
 * module stays a pure template layer with one import. Callers get the name
 * from `getCountryName`, which prefers lib/countries.ts's hand-tuned "China"
 * over the artifact's "People's Republic of China" — this exact string is why
 * that precedence is the way round it is.
 */
export function powerAdapterItem(countryName: string, facts: CountryFacts): string | null {
  const { plugs, voltageV } = facts;
  if (plugs === undefined || voltageV === undefined) return null;
  if (countryName.trim().length === 0) return null;
  return `Universal power adapter (${countryName} uses type ${plugs.join("/")} plugs, ${voltageV}V)`;
}

/** Cash backup for the Documents & Money group. Code only — see `currencyTip`. */
export function cashBackupItem(facts: CountryFacts): string | null {
  if (facts.currencyCode === undefined) return null;
  return `Some ${facts.currencyCode} cash as a backup`;
}

/**
 * Offline translation pack — only when there is exactly one official language.
 *
 * "Download an offline pack for X" is actionable only when there is one answer
 * to X, and picking one of Peru's three would invent the primacy `languageTip`
 * refuses to invent. Where this does not fire nothing is lost: `NEUTRAL_PACKING`
 * already carries "Offline maps and a translation app downloaded before you
 * fly", which is a non-claim that covers the same ground.
 */
export function translationPackItem(facts: CountryFacts): string | null {
  const languages = facts.officialLanguages;
  if (languages === undefined || languages.length !== 1) return null;
  return `Offline ${languages[0]} translation pack`;
}

/**
 * The six fields the gap note names, in the order it names them, with the
 * label each is called by in the sentence.
 *
 * Six, not the seven rendered fields: driving side is deliberately absent.
 * It covers 245 of 246 countries, and "we also have no driving side for X"
 * would spend the note's one line on the field least likely to be missing.
 */
export const GAP_NOTE_FIELDS = [
  { field: "currencyCode", label: "currency" },
  { field: "plugs", label: "plug types" },
  { field: "voltageV", label: "mains voltage" },
  { field: "emergency", label: "emergency numbers" },
  { field: "officialLanguages", label: "official language" },
  { field: "callingCode", label: "dialling code" },
] as const satisfies readonly { field: keyof CountryFacts; label: string }[];

/**
 * The honesty surface: muted copy rendered as a note, never as a tip.
 *
 * Line 1 always. Silence alone is not enough — a user cannot tell "there is
 * nothing to say" from "we forgot Peru" — so the note states where the
 * guidance came from and what it does not cover.
 *
 * Line 2 only when one of the six fields above is absent, naming exactly
 * those and nothing else. A country carrying all six gets one line.
 *
 * **Line 2 is about our data, and names no country.** It read "We also have no
 * official language for United States", which a reader takes as a claim about
 * the country — the exact opposite of what this note is for. Two things were
 * wrong with it and the second is the larger one. It wanted an article the
 * template cannot supply: "for Netherlands", "for Philippines", "for Isle of
 * Man", "for Czech Republic" all want a "the" that "for Peru" and "for Japan"
 * must not have, and a rule that decides that for 246 names is a rule that
 * will be wrong for some of them forever — while the two names that carry
 * their own article ("The Bahamas", "The Gambia") would need it taken away
 * again. So the sentence stops putting a name in a slot that needs one.
 *
 * Nothing is lost by dropping it. Line 1 has already said whose data this is,
 * one paragraph above and always rendered with it, and it says so
 * ATTRIBUTIVELY — "United States-specific guidance" — which is the one
 * position every name in the artifact reads correctly in without an article.
 * What is left is a sentence whose subject is our data, which is what this
 * note always meant to be about.
 *
 * Returns `[]` for a blank country name. A note that cannot say whose data is
 * missing is not a statement anyone can act on, and the only codes that
 * produce a blank name are not countries: `getCountry("🙂").name` is `""`.
 * China's note is `[]` too, but for the opposite reason — it is researched by
 * hand — and that dispatch belongs to `getCountryProfile`, not here.
 *
 * Never snapshotted into a trip. It is a statement about our current data, not
 * about the trip, so it must shrink as coverage improves.
 */
export function buildGapNote(countryName: string, facts: CountryFacts): string[] {
  const name = countryName.trim();
  if (name.length === 0) return [];

  const lines = [
    `These notes come from open reference data. We don't have ${name}-specific guidance on ` +
      `payments, connectivity, booking channels or public holidays yet — and we'd rather leave ` +
      `that blank than guess.`,
  ];

  const missing = GAP_NOTE_FIELDS.filter(({ field }) => facts[field] === undefined).map(
    ({ label }) => label
  );
  if (missing.length > 0) {
    lines.push(`Our data also has no ${joinWith(missing, "or")} for this country.`);
  }
  return lines;
}
