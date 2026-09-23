/**
 * ingest-country-facts — the per-country comparison behind `assertFactsSane`'s
 * official-language check, and the acceptance a human gives a change it finds.
 *
 * WHY PER COUNTRY. Until 2026-09-24 the only thing that noticed a published
 * language list move was `expect(scanned).toBe(426)` in
 * lib/countryTips.test.ts — a sum over every country, run in the nightly
 * job's verify step after this ingest had already written. A sum nets out. On
 * 2026-09-08 Q36368's English label went from "Kurdish" to "Kurdish language"
 * and that night's refresh shipped "Arabic and Kurdish language are official
 * languages" for Iraq: one name out, one name in, the total unmoved. Measured
 * over two years of Wikidata history
 * (docs/superpowers/specs/2026-09-24-language-change-gate-design.md §1.2), 45
 * changes reached a published list on 43 nights, and the total would have
 * seen 27 of them — never a relabel, never a same-count swap.
 *
 * So the gate compares each country's list, as a set of the labels a
 * traveller reads, against the previous artifact, and names every
 * difference. Nothing here decides whether a change is right: every one stops
 * the run, and a human refuses it (scripts/country-facts/curated.mjs) or
 * accepts it (below).
 *
 * Imports nothing, for the reason scripts/ingest-country-facts.mjs gives for
 * its own imports: build-time logic may not reach into lib/.
 */

/**
 * The one variable that lets a reviewed change through. Read by the entry
 * guard in scripts/ingest-country-facts.mjs and nowhere else, and never set
 * by .github/workflows/refresh-cities.yml: the nightly job accepts nothing.
 * Set it inline on the one command being run and never let it outlive that
 * command: the acceptance is per COUNTRY, not per change — it checks only
 * that a listed country changed this run, not that the change matches what
 * was reviewed — so a value that stays armed would silently wave a second,
 * different change to the same country through in a later run.
 *
 * Inline as `CIP_ACCEPT_LANGUAGE_CHANGES=IQ,MR node ...` is bash / Git Bash
 * syntax. In PowerShell, set and clear it around the one command instead of
 * exporting it:
 *
 *   try { $env:CIP_ACCEPT_LANGUAGE_CHANGES = 'IQ,MR'; node scripts/ingest-country-facts.mjs } finally { Remove-Item Env:CIP_ACCEPT_LANGUAGE_CHANGES }
 */
export const ACCEPT_LANGUAGE_CHANGES_ENV = 'CIP_ACCEPT_LANGUAGE_CHANGES';

/**
 * One country whose published official languages differ between two
 * artifacts. `withdrawn` means the field is absent now, `appeared` that it
 * was absent before; a relabel is one removal and one addition.
 * @typedef {{ code: string, removed: string[], added: string[], withdrawn: boolean, appeared: boolean }} LanguageChange
 */

/**
 * `CIP_ACCEPT_LANGUAGE_CHANGES` as the list of countries a human reviewed.
 * Unset or blank is no acceptance.
 *
 * Strict on purpose. The value names exactly what somebody checked, so a
 * lowercase code, a stray comma or a repeated code is a typo in a command a
 * human is running, and it stops the run rather than being read generously.
 * Codes are never uppercased here, for `buildFacts`' reason: normalising a
 * code is how a wrong one starts to look right.
 *
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseAcceptedLanguageChanges(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return [];
  const codes = text.split(',').map((entry) => entry.trim());
  if (codes.some((code) => !/^[A-Z]{2}$/.test(code))) {
    throw new Error(
      `${ACCEPT_LANGUAGE_CHANGES_ENV} must be two-letter uppercase country codes separated by ` +
      `commas, e.g. "IQ,MR" — got ${JSON.stringify(raw)}. Nothing is uppercased for you: the ` +
      `value names exactly what a human reviewed`
    );
  }
  const repeated = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
  if (repeated.length > 0) {
    throw new Error(
      `${ACCEPT_LANGUAGE_CHANGES_ENV} names ${repeated.join(', ')} more than once — a repeated ` +
      `code is a typo in a list a human wrote, and the list must say exactly what was reviewed`
    );
  }
  return codes;
}

/**
 * Every country whose published official languages differ between two
 * `countries` maps, sorted by code.
 *
 * Compared as SETS of labels: the label is what `languageTip` renders, so a
 * relabel is a change here exactly as it is to a traveller, and list order is
 * not (`pickLanguages` sorts, but a curated row is typed by hand). A country
 * present on only one side counts as its whole list appearing or going.
 *
 * @param {Record<string, { officialLanguages?: string[] }>} previousCountries
 * @param {Record<string, { officialLanguages?: string[] }>} countries
 * @returns {LanguageChange[]}
 */
export function languageChanges(previousCountries, countries) {
  const codes = [...new Set([...Object.keys(previousCountries), ...Object.keys(countries)])].sort();
  /** @type {LanguageChange[]} */
  const changes = [];
  for (const code of codes) {
    const before = previousCountries[code]?.officialLanguages;
    const after = countries[code]?.officialLanguages;
    const was = new Set(before ?? []);
    const now = new Set(after ?? []);
    const removed = [...was].filter((name) => !now.has(name)).sort();
    const added = [...now].filter((name) => !was.has(name)).sort();
    if (removed.length === 0 && added.length === 0) continue;
    changes.push({ code, removed, added, withdrawn: after === undefined, appeared: before === undefined });
  }
  return changes;
}

/**
 * The changes as one line, one entry per distinct change: countries that
 * changed identically share an entry, so one upstream relabel reaching twenty
 * countries reads as the single edit it was.
 *
 * Names are JSON-quoted — a label may carry spaces, hyphens or commas — and
 * removals come before additions, so a relabel reads from -> to. A withdrawn
 * field says so, and says why when the build knows (`scoped`, the build's
 * `scopedLanguages` diagnostic); a new field says so.
 *
 * @param {LanguageChange[]} changes
 * @param {{ scoped?: string[] }} [context]
 * @returns {string}
 */
export function summariseLanguageChanges(changes, { scoped = [] } = {}) {
  const scopedCodes = new Set(scoped);
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const change of changes) {
    const parts = [
      ...change.removed.map((name) => `-${JSON.stringify(name)}`),
      ...change.added.map((name) => `+${JSON.stringify(name)}`),
    ];
    if (change.withdrawn) {
      parts.push(
        scopedCodes.has(change.code)
          ? '(field withdrawn: every statement is now territorially scoped)'
          : '(field withdrawn: no publishable statement came back)'
      );
    }
    if (change.appeared) parts.push('(field new)');
    const signature = parts.join(' ');
    groups.set(signature, [...(groups.get(signature) ?? []), change.code]);
  }
  return [...groups.entries()]
    .map(([signature, codes]) => `${codes.join(', ')}: ${signature}`)
    .sort()
    .join('; ');
}

/**
 * The gate's whole message: what changed, why it stops the run, and the
 * three ways a human answers it, down to the acceptance to copy.
 *
 * It is the only output a rejected run leaves — the report is written after
 * the gate — so it has to be enough to decide from. `accept` is the
 * acceptance to suggest: every country that changed this run, which the gate
 * passes explicitly, because re-running with only the countries reported here
 * would drop one a human had already accepted.
 *
 * @param {LanguageChange[]} changes
 * @param {{ scoped?: string[], accept?: string[] }} [context]
 * @returns {string}
 */
export function describeLanguageChanges(changes, { scoped = [], accept = changes.map((change) => change.code) } = {}) {
  const subject = changes.length === 1 ? '1 country changed its' : `${changes.length} countries changed their`;
  return (
    `${subject} published official languages since the committed artifact: ` +
    `${summariseLanguageChanges(changes, { scoped })} — a published language list never changes ` +
    `without a human. Check each statement upstream, then refuse a wrong one in ` +
    `REFUSED_LANGUAGE_ITEMS, restore a wrongly withheld field in CURATED_FACTS (both in ` +
    `scripts/country-facts/curated.mjs), or accept it by re-running with ` +
    `${ACCEPT_LANGUAGE_CHANGES_ENV}=${accept.join(',')} and committing the regenerated artifact`
  );
}
