/**
 * ingest-country-facts — `buildReport`, which writes
 * data/country-facts-report.md.
 *
 * Moved verbatim out of scripts/ingest-country-facts.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `run`, the run guard — is still
 * scripts/ingest-country-facts.mjs.
 *
 * The report's `## Attribution` section is one of the three coupled places
 * that record the CC0 decision, so the source name and licence it prints are
 * imported from scripts/country-facts/io.mjs rather than restated here — the
 * same two constants the artifact envelope is stamped with.
 *
 * The `EmergencyNumber` and `CountryFacts` typedefs below are a byte-identical
 * copy of the ones scripts/ingest-country-facts.mjs declared before the split
 * — that file keeps only `Row` now — for the reason the twin in
 * scripts/country-facts/parse.mjs gives. `CountryFacts` annotates
 * `buildReport`'s parameter and cannot be written without `EmergencyNumber`.
 */

import { RECORD_FIELDS, RENDERED_FIELDS, factCount } from './facts.mjs';
import { SOURCE_LICENSE, SOURCE_NAME, SPARQL_ENDPOINT } from './io.mjs';

/**
 * One emergency number and the role its P366 qualifier gave it. `role` is null
 * only on the single-number path, where there is no ambiguity to resolve.
 * @typedef {{ number: string, role: string | null }} EmergencyNumber
 */
/**
 * One country's record as it sits in data/country-facts.json. Every field is
 * optional and an ABSENT field is the honest answer — never an empty string,
 * never an empty array, never a placeholder.
 * @typedef {{
 *   name?: string,
 *   currencyCode?: string,
 *   currencyName?: string,
 *   plugs?: string[],
 *   voltageV?: number,
 *   drivingSide?: string,
 *   emergency?: EmergencyNumber[],
 *   officialLanguages?: string[],
 *   callingCode?: string,
 *   lat?: number,
 * }} CountryFacts
 */

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The report describes the ARTIFACT, never the run.
 *
 * No "N countries changed tonight" line, deliberately, for the reason
 * scripts/ingest-cities.mjs's `buildReport` gives: that number is 246 on a
 * first run and 0 on a quiet one, which would make this committed file differ
 * every time the previous run's numbers differed. Everything below is a pure
 * function of the records, so a rebuild with no data change produces a
 * byte-identical report and `git status` stays clean.
 *
 * `scopedLanguages` is the one input that is NOT a record, and it is still not
 * a run count: it is `diagnostics.scopedLanguages`, the set of countries whose
 * P37 statements upstream qualified `applies to part`. Same query, same
 * answer, same output — see `languageGap` below for why the alternative was a
 * literal that drifted, and for what `null` means.
 *
 * @param {{
 *   countries: Record<string, CountryFacts>,
 *   generatedAt: string,
 *   scopedLanguages?: string[] | null,
 * }} input
 */
export function buildReport({ countries, generatedAt, scopedLanguages = null }) {
  const records = Object.entries(countries);
  const coverage = RECORD_FIELDS.map((field) => {
    const covered = records.filter(([, record]) => record[field] !== undefined).length;
    return `| \`${field}\` | ${covered} | ${records.length === 0 ? '0.0' : ((covered / records.length) * 100).toFixed(1)}% |`;
  });
  const byFacts = records
    .map(([code, record]) => [code, factCount(record)])
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])));
  const thinnest = byFacts.slice(-15).reverse();
  /**
   * How many of the SEVEN rendered fields each country carries. The design's
   * first stated risk is that the bar "as clear as China for all countries" is
   * not met literally, and this histogram is the number that risk turns on:
   * it says how many countries get the full set of fact-derived lines and how
   * many are visibly thin. `currencyName` rides with `currencyCode` and `lat`
   * is never rendered, so neither is counted here.
   */
  const rendered = new Map();
  for (const [, record] of records) {
    const carried = RENDERED_FIELDS.filter((field) => record[field] !== undefined).length;
    rendered.set(carried, (rendered.get(carried) ?? 0) + 1);
  }
  const histogram = [...rendered.entries()].sort((a, b) => b[0] - a[0]);

  /**
   * The languages bullet under `## Not derivable`, DERIVED — and the only
   * reader `diagnostics.scopedLanguages` has.
   *
   * It used to be a frozen literal reading "AF, AZ, BE, BQ, PW and US", which
   * named six while the artifact beside it withheld nine: the three the rule
   * has nothing to do with (upstream states no official language for them at
   * all) were simply missing from a sentence that claimed to explain the gap.
   * A hand-written list of what a rule did is a second copy of the answer, and
   * the two drifted the first time anything moved.
   *
   * Both halves come from what actually happened: the WHO from the artifact,
   * the WHY from the run's own diagnostic. That is the point of reading the
   * diagnostic rather than re-deriving the rule here — a diagnostic nothing
   * reads is one nobody notices going wrong.
   *
   * `scopedLanguages === null` means the P37 query was demoted this run and
   * its values were carried forward, so the diagnostic is empty because
   * nothing was measured rather than because nothing was scoped. Attributing
   * every withheld country to "upstream states none" on that night would be
   * the frozen list's failure with extra steps, so the split is withheld
   * instead and the reason is printed.
   */
  const withheldLanguages = records
    .filter(([, record]) => record.officialLanguages === undefined)
    .map(([code]) => code)
    .sort();
  const scopedSet = new Set(scopedLanguages ?? []);
  const scopedHere = withheldLanguages.filter((code) => scopedSet.has(code));
  const unstatedHere = withheldLanguages.filter((code) => !scopedSet.has(code));
  const languageGap = withheldLanguages.length === 0 ? [] : [
    `- **Official languages for ${withheldLanguages.length} of the ${records.length} countries.**`,
    '  The gap note names the field for every one of them. Both the list and the split below',
    '  are derived from this run rather than written down, so neither can drift from what was',
    '  actually published:',
    `  ${withheldLanguages.join(', ')}`,
    ...(scopedLanguages === null
      ? [
        '  - **Why each one is withheld is not stated this run.** The P37 query was demoted and',
        '    its values carried forward, so the scope diagnostic is empty because nothing was',
        '    measured rather than because nothing was scoped. A split written down anyway is',
        '    exactly the frozen list this derivation replaced.',
      ]
      : [
        `  - **${scopedHere.length} because every P37 statement upstream gives them is qualified`,
        '    `applies to part`** — or enough of them that the remainder is not a national list.',
        '    Upstream is stating, on the statement itself, that this is not a claim about the',
        '    whole country. The United States is the case that forces the rule: Carolinian and',
        '    Chamorro apply to the Northern Marianas, Hawaiian to Hawaii, Samoan to American',
        '    Samoa and Spanish to Puerto Rico, while English sits at deprecated rank — so an',
        '    unfiltered query told a traveller the United States has five official languages and',
        '    none of them is English. Publishing the unscoped remainder instead was measured and',
        '    rejected: it leaves Azerbaijan with `Azerbaijani Sign Language` alone, trading one',
        '    false sentence for another. Where the qualifier names a PART of the country',
        '    (Belgium\'s language regions) or a VARIETY of the language (Standard Azerbaijani)',
        '    rather than a territory the national claim excludes, a hand-verified value is',
        '    carried instead and the whole field is not lost — see `CURATED_FACTS`.',
        `    ${scopedHere.join(', ') || '(none)'}`,
        `  - **${unstatedHere.length} because upstream states no official language at all** —`,
        '    no truthy P37 statement, or none this ingest can publish.',
        `    ${unstatedHere.join(', ') || '(none)'}`,
      ]),
  ];

  return [
    '# Country facts report',
    '',
    `- Generated: ${generatedAt}`,
    `- Source: ${SPARQL_ENDPOINT} (${SOURCE_NAME})`,
    `- Licence: ${SOURCE_LICENSE}`,
    '- Contents: structured scalars only. Never prose, never a sentence.',
    '',
    `**${records.length} countries carry at least one fact.**`,
    '',
    "Every record also carries the country's English NAME, from the item's own",
    '`rdfs:label`. It is identity rather than a fact — it is what the sentences in',
    '`lib/countryTips.ts` call the country — so it is not counted as one, and a record',
    'carrying nothing but a name would be omitted exactly like an empty one.',
    '',
    'A country with none is absent from the artifact entirely and falls through to',
    "`lib/countryProfile.ts`'s neutral profile, which is the honest default. A field",
    'with no supporting data is ABSENT from its record — never an empty string, never',
    'an empty array, never a placeholder — and the template that would render it',
    'simply does not run.',
    '',
    '## Coverage by field',
    '',
    '| Field | Countries | Share |',
    '| --- | --- | --- |',
    ...coverage,
    '',
    '## Countries by rendered-field count',
    '',
    'Of the seven fields that reach a traveller. A country lower down this table is',
    'not a country we got wrong — it is one whose gap note names, per field, exactly',
    'what we do not have.',
    '',
    '| Rendered fields | Countries |',
    '| --- | --- |',
    ...histogram.map(([carried, count]) => `| ${carried} of ${RENDERED_FIELDS.length} | ${count} |`),
    '',
    '## Thinnest records',
    '',
    '| Country | Facts |',
    '| --- | --- |',
    ...thinnest.map(([code, count]) => `| ${code} | ${count} |`),
    '',
    '## Not derivable',
    '',
    'Recorded so it is not re-litigated. Each of these was measured, not assumed.',
    '',
    '- **Rail speed outside China.** Wikidata\'s "high-speed railway line" class returns',
    '  lines for Peru, Panama, Ecuador, Bangladesh, Venezuela, Colombia, Australia and',
    '  the Philippines. Either that or the World Bank\'s route-kilometre series would',
    '  tell the app Peru is high-speed-rail friendly. Rail speed for a new country is a',
    '  hand-written, cited entry in `lib/countryData/`.',
    '- **Public holidays.** The open dataset with the best coverage reaches 204 of 246',
    '  and misses IN, TH, MY, LK, NP, PK, MM, LA, IL, AE, SA, QA, KW, OM, JO, LB, TW,',
    '  MO, MU, MV, FJ, UZ, IR, AZ and 18 more — disproportionately where holiday',
    '  crowding matters most. It returns single dates rather than travel-impact bands.',
    '  Wikidata\'s own holiday property reaches 73 of 246.',
    '- **Per-month crowd pressure.** No open per-country per-month tourism seasonality',
    '  source exists at this granularity.',
    '- **Climate normals.** These need station data of a different order of size, and',
    '  they are the highest-value future addition — climate is what actually answers',
    '  "when should I go".',
    '- **A currency NAME a traveller could be shown.** The code is carried and rendered;',
    '  the name is carried and never rendered. Measured 2026-08-27 on the currency items',
    '  themselves: PE\'s is `Nuevo sol`, the pre-2015 name Peru dropped that year, and the',
    '  `mul` fallback does not fix it (Q204656 has an English label and no `mul` one).',
    '  Nor is the field consistent in what it names — JP\'s is `yen` and MX\'s is `peso`,',
    '  generic units rather than the Japanese yen or the Mexican peso — and P1813',
    '  ("short name") is empty for every one sampled, so no better property exists to',
    '  switch to. One label being provably stale while 238 more are unchecked is not a',
    '  one-country correction; it is a field that cannot be shown. See the block comment',
    '  in `lib/countryFacts.ts`.',
    '- **Payment apps, connectivity, booking channels, tipping, tap water, visa rules.**',
    '  No structured source. Visa rules also depend on the traveller\'s passport, which',
    '  the app does not know.',
    ...languageGap,
    '- **Plug letters for the fifteen BS 546 countries.** Measured 2026-08-27: the whole',
    '  distinct P2853 value set across these countries is fourteen items, thirteen',
    '  standards plus one Wikipedia article. One of the thirteen, `BS 546`, is a single',
    '  Wikidata item covering both of its sizes — the 5 A variant is IEC type D and the',
    '  15 A variant is type M — and the statement carries nothing that separates them.',
    '  Guessing D would publish "South Africa uses type C/D/N" when South Africa\'s',
    '  round-pin sockets are the 15 A type M, and a traveller who buys a type D adapter',
    '  on that sentence finds it does not fit. So the whole plug field is withheld for',
    '  MO, BT, MZ, PK, IL, PS, ZA, IN, BW, LK, NP, SZ, NG, NA and LS, and the gap note',
    '  names it. Splitting the item upstream, or a qualifier that gives the current',
    '  rating, is what would fix this.',
    '- **Anything about a country the app has no city shard for.** The query is bounded',
    '  to the 246 codes under `public/cities`. Measured 2026-08-27, an unbounded P297',
    '  query answers with 259: the extra thirteen are AC, AN, AQ, BV, CP, CQ, DD, DG,',
    '  HM, PC, TA, UM and YU — exceptionally reserved codes, uninhabited territories,',
    '  and the historical Netherlands Antilles, East Germany and Yugoslavia. Facts about',
    '  East Germany would pass every gate in the ingest and answer a question no user',
    '  can ask.',
    '',
    '## Attribution',
    '',
    'Wikidata\'s main and property namespaces are CC0 — a public domain dedication with',
    'NO attribution condition to discharge. **No UI credit is added for this source,',
    'and that is a decision rather than an oversight.**',
    '',
    '`components/plan/GeoNamesCredit.tsx` already argues this exact case for this exact',
    'source in its own doc-comment: naming a CC0 source inside a legal notice would',
    'imply the credits beside it are discretionary, when every one of them is required.',
    'Adding one here would weaken the notice.',
    '',
    'This file is therefore deliberately outside the C7 derived contract in',
    '`lib/contracts.test.ts`, which names `data/cities-report.md` specifically. If a',
    'future task adds a source that DOES carry an attribution condition, that task owns,',
    'in a single commit: the clause in `GeoNamesCredit.tsx`, the C7 token-list widening,',
    'and the enumerated-surface update in `data/cities-report.md`.',
    '',
  ].join('\n');
}

