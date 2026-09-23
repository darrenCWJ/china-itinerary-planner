# Per-country language-change gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the country-facts ingest, before any write, whenever any country's published `officialLanguages` list differs from the committed artifact — naming the country and the exact languages — and let a human accept a reviewed change with `CIP_ACCEPT_LANGUAGE_CHANGES`.

**Architecture:** A new pure module, `scripts/country-facts/languages.mjs`, compares two artifacts' lists per country as label sets and formats the message. `assertFactsSane` (`scripts/country-facts/gate.mjs`) gains the check as its last drift section, plus two acceptance guards. `run()` (`scripts/ingest-country-facts.mjs`) parses the acceptance first and passes it to the gate, and only the entry guard reads the environment variable. Spec: `docs/superpowers/specs/2026-09-24-language-change-gate-design.md`.

**Tech Stack:** Node 24 ESM `.mjs` with JSDoc types (node built-ins only, no npm imports), Vitest 4 (the `node` project picks up `scripts/**/*.test.ts`), TypeScript `tsc --noEmit` over `allowJs`.

## Global Constraints

- **Before any write.** Every gate aborts before any write primitive fires. The new check lives inside `assertFactsSane`, after the existing drift checks (`emptied`, shrink/growth, `collapsed`), so a broader failure still reports first.
- **What is compared.** The FINAL build — after `applyCurated`, the refusals inside `buildFacts`, and carry-forward — against the previous artifact, as SETS of `officialLanguages` labels.
- **Every change counts:** an addition, a removal, a relabel, a field appearing, a field withdrawn (the owner's choice).
- **Inert on first runs.** The check does not run on a first run (`previous === null`) or on an empty baseline (`previous.countries` has no keys) — the shrink band already treats the latter as no baseline.
- **The acceptance variable** is exactly `CIP_ACCEPT_LANGUAGE_CHANGES`:
  - comma-separated two-letter UPPERCASE codes, whitespace around codes tolerated; unset or blank means none;
  - never uppercased or deduplicated for the caller;
  - read ONLY by the entry guard of `scripts/ingest-country-facts.mjs`, and never set in `.github/workflows/refresh-cities.yml`.
- **Scripts stay dependency-free.** `scripts/ingest-country-facts.mjs` and `scripts/country-facts/*.mjs` import only `node:fs`, `node:path`, `node:url` and each other — no `lib/`, no npm packages.
- **No data change.** `data/country-facts.json` and `data/country-facts-report.md` stay byte-identical to `main`'s.
- **The 426 pin** in `lib/countryTips.test.ts` stays exact; only its comment changes.
- **Files stay under 800 lines**, test files included. The exception is the five test files the owner chose on 2026-09-07 to leave over the line: `lib/contracts.test.ts`, `lib/countryFacts.test.ts`, `lib/countryTips.test.ts` (900 lines before this plan; Task 2 adds its 426 comment there), `components/map/GlobeLevel.test.tsx` and `lib/climateShard.test.ts`.
- **Style.** `.mjs` files: single quotes, 2-space indent, semicolons, docblocks that say WHY. `.ts` tests: double quotes, the house's per-branch test naming.
- **Line endings.** The working copy is CRLF (core.autocrlf). Edit files with the Edit/Write tools; do not patch them with heredoc-fed node scripts (backslashes get mangled).
- **No network in any test.** The one test that spawns the real script disables `fetch` in the child first.
- **Commits.** Conventional commits (`feat:`, `test:`, `docs:`, `fix:`), each ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Exact message wording** — tests pin these strings:
  - change: `<N> countries changed their published official languages since the committed artifact: <entries> — a published language list never changes without a human. ...`, with `1 country changed its` for one;
  - entry: `<codes joined ", ">: <-"removed" ...> <+"added" ...>` plus `(field withdrawn: every statement is now territorially scoped)` / `(field withdrawn: no publishable statement came back)` / `(field new)`; entries joined `; ` and sorted;
  - unused acceptance: `CIP_ACCEPT_LANGUAGE_CHANGES names <codes>, whose published official languages did not change this run — ...`;
  - acceptance without a baseline: `CIP_ACCEPT_LANGUAGE_CHANGES names <codes> but there is no previous artifact to compare against — ...`;
  - malformed: `CIP_ACCEPT_LANGUAGE_CHANGES must be two-letter uppercase country codes separated by commas, ...` and `CIP_ACCEPT_LANGUAGE_CHANGES names <code> more than once — ...`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scripts/country-facts/languages.mjs` | Create | The comparison (`languageChanges`), the message (`summariseLanguageChanges`, `describeLanguageChanges`), the acceptance parser, the variable's name. Pure; imports nothing. |
| `scripts/country-facts/languages.test.ts` | Create | One `describe` per export. |
| `scripts/country-facts/gate.mjs` | Modify (`assertFactsSane`, ~line 325-686) | Three new throw sites: acceptance without a baseline, unaccepted changes, unused acceptance. |
| `scripts/country-facts/gate.test.ts` | Modify | One test per new branch; the "one field of churn" test moves from `officialLanguages` to `plugs`. |
| `scripts/ingest-country-facts.mjs` | Modify (header, `run()`, entry guard) | Parse the acceptance first, pass it to the gate, log what was accepted; the entry guard reads the variable. |
| `scripts/ingest-country-facts.test.ts` | Modify | `run()`-level behaviour: aborts write nothing, demotion never reads as change, acceptance, env isolation, the spawned entry guard. |
| `lib/countryTips.test.ts` | Modify (comment at ~695-702) | The 426 pin's new division of labour, in words. |
| `scripts/country-facts/curated.mjs` | Modify (`REFUSED_LANGUAGE_ITEMS` docblock) | One paragraph: detection is now the gate's. |
| `.github/workflows/refresh-cities.yml` | Modify (header comment, line ~47) | Throw-site count 38 → 41. |

---

### Task 1: The comparison, the message and the acceptance parser

**Files:**
- Create: `scripts/country-facts/languages.mjs`
- Test: `scripts/country-facts/languages.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks import these by exactly these names):
  - `ACCEPT_LANGUAGE_CHANGES_ENV: 'CIP_ACCEPT_LANGUAGE_CHANGES'`
  - `parseAcceptedLanguageChanges(raw: string | undefined): string[]` — throws on malformed input
  - `languageChanges(previousCountries: Record<string, { officialLanguages?: string[] }>, countries: Record<string, { officialLanguages?: string[] }>): LanguageChange[]` — sorted by code
  - `summariseLanguageChanges(changes: LanguageChange[], context?: { scoped?: string[] }): string`
  - `describeLanguageChanges(changes: LanguageChange[], context?: { scoped?: string[], accept?: string[] }): string`
  - `LanguageChange = { code: string, removed: string[], added: string[], withdrawn: boolean, appeared: boolean }`

- [ ] **Step 1: Write the failing test file**

Create `scripts/country-facts/languages.test.ts`:

```ts
/**
 * ingest-country-facts — the per-country official-language comparison and the
 * acceptance a human gives it, one function at a time.
 *
 * The three gate branches built from these are pinned in
 * scripts/country-facts/gate.test.ts, and their place in the path a nightly
 * run takes in scripts/ingest-country-facts.test.ts. No network call is made
 * anywhere in this file.
 */

import { describe, expect, test } from "vitest";
import {
  ACCEPT_LANGUAGE_CHANGES_ENV,
  describeLanguageChanges,
  languageChanges,
  parseAcceptedLanguageChanges,
  summariseLanguageChanges,
} from "./languages.mjs";

type Countries = Record<string, { officialLanguages?: string[] }>;

/** A `countries` map from bare lists; `undefined` is a country with no language field. */
function lists(entries: Record<string, string[] | undefined>): Countries {
  return Object.fromEntries(
    Object.entries(entries).map(([code, officialLanguages]) => [
      code,
      officialLanguages === undefined ? {} : { officialLanguages },
    ])
  );
}

describe("languageChanges", () => {
  test("an unchanged artifact has nothing to report", () => {
    const countries = lists({ IQ: ["Arabic", "Kurdish"], MR: ["Arabic"], US: undefined });
    expect(languageChanges(countries, structuredClone(countries))).toEqual([]);
  });

  test("an added language is named, for that country alone — Mauritania's shape", () => {
    expect(
      languageChanges(lists({ IQ: ["Arabic"], MR: ["Arabic"] }), lists({ IQ: ["Arabic"], MR: ["Arabic", "French"] }))
    ).toEqual([{ code: "MR", removed: [], added: ["French"], withdrawn: false, appeared: false }]);
  });

  test("a removed language is named — Kyrgyzstan's shape", () => {
    expect(languageChanges(lists({ KG: ["Kyrgyz", "Russian"] }), lists({ KG: ["Kyrgyz"] }))).toEqual([
      { code: "KG", removed: ["Russian"], added: [], withdrawn: false, appeared: false },
    ]);
  });

  test("a relabel is one name out and one name in — Iraq's shape", () => {
    expect(
      languageChanges(lists({ IQ: ["Arabic", "Kurdish"] }), lists({ IQ: ["Arabic", "Kurdish language"] }))
    ).toEqual([{ code: "IQ", removed: ["Kurdish"], added: ["Kurdish language"], withdrawn: false, appeared: false }]);
  });

  test("a swap between two countries is two changes, although the total does not move", () => {
    const previous = lists({ AA: ["English", "French"], AB: ["English"] });
    const next = lists({ AA: ["English"], AB: ["English", "French"] });
    const total = (countries: Countries) =>
      Object.values(countries).reduce((sum, record) => sum + (record.officialLanguages?.length ?? 0), 0);
    // Armed: this is the build a 426-style total passes untouched.
    expect(total(next)).toBe(total(previous));
    expect(languageChanges(previous, next)).toEqual([
      { code: "AA", removed: ["French"], added: [], withdrawn: false, appeared: false },
      { code: "AB", removed: [], added: ["French"], withdrawn: false, appeared: false },
    ]);
  });

  test("a field withdrawn and a field appearing say so", () => {
    expect(
      languageChanges(lists({ EH: undefined, UY: ["Spanish"] }), lists({ EH: ["Arabic"], UY: undefined }))
    ).toEqual([
      { code: "EH", removed: [], added: ["Arabic"], withdrawn: false, appeared: true },
      { code: "UY", removed: ["Spanish"], added: [], withdrawn: true, appeared: false },
    ]);
  });

  test("a country on one side only is its whole list appearing or going", () => {
    expect(languageChanges(lists({ XA: ["English"] }), lists({ XB: ["French"] }))).toEqual([
      { code: "XA", removed: ["English"], added: [], withdrawn: true, appeared: false },
      { code: "XB", removed: [], added: ["French"], withdrawn: false, appeared: true },
    ]);
  });

  test("order is not a change: the lists are compared as sets", () => {
    expect(
      languageChanges(lists({ BE: ["German", "Dutch", "French"] }), lists({ BE: ["Dutch", "French", "German"] }))
    ).toEqual([]);
  });
});

describe("summariseLanguageChanges", () => {
  test("quotes every name and puts removals first, so a relabel reads from -> to", () => {
    const changes = languageChanges(lists({ IQ: ["Arabic", "Kurdish"] }), lists({ IQ: ["Arabic", "Kurdish language"] }));
    expect(summariseLanguageChanges(changes)).toBe('IQ: -"Kurdish" +"Kurdish language"');
  });

  test("one relabel reaching many countries is one entry, not one per country", () => {
    const changes = languageChanges(
      lists({ CY: ["Greek", "Turkish"], MR: ["Arabic"], TR: ["Turkish"] }),
      lists({ CY: ["Greek", "Turkish language"], MR: ["Arabic", "French"], TR: ["Turkish language"] })
    );
    expect(summariseLanguageChanges(changes)).toBe('CY, TR: -"Turkish" +"Turkish language"; MR: +"French"');
  });

  test("says why a field was withdrawn when the build knows, and says so when it does not", () => {
    const changes = languageChanges(lists({ PW: ["English"], UY: ["Spanish"] }), lists({ PW: undefined, UY: undefined }));
    expect(summariseLanguageChanges(changes, { scoped: ["PW"] })).toBe(
      'PW: -"English" (field withdrawn: every statement is now territorially scoped); ' +
        'UY: -"Spanish" (field withdrawn: no publishable statement came back)'
    );
  });

  test("marks a field that is new", () => {
    const changes = languageChanges(lists({ EH: undefined }), lists({ EH: ["Arabic"] }));
    expect(summariseLanguageChanges(changes)).toBe('EH: +"Arabic" (field new)');
  });
});

describe("describeLanguageChanges", () => {
  test("names the change, why it stops the run, and the three answers, down to the acceptance to copy", () => {
    const changes = languageChanges(
      lists({ IQ: ["Arabic", "Kurdish"], MR: ["Arabic"] }),
      lists({ IQ: ["Arabic", "Kurdish language"], MR: ["Arabic", "French"] })
    );
    const message = describeLanguageChanges(changes);
    expect(message).toMatch(
      /^2 countries changed their published official languages since the committed artifact: IQ: -"Kurdish" \+"Kurdish language"; MR: \+"French" — a published language list never changes without a human\./
    );
    expect(message).toContain("REFUSED_LANGUAGE_ITEMS");
    expect(message).toContain("CURATED_FACTS");
    expect(message).toContain("CIP_ACCEPT_LANGUAGE_CHANGES=IQ,MR and committing the regenerated artifact");
  });

  test("one country is singular", () => {
    const changes = languageChanges(lists({ MR: ["Arabic"] }), lists({ MR: ["Arabic", "French"] }));
    expect(describeLanguageChanges(changes)).toMatch(/^1 country changed its published official languages/);
  });

  test("suggests every country that changed, including one a human already accepted", () => {
    // Copying a suggestion that dropped the accepted country would un-accept it.
    const changes = languageChanges(lists({ AB: ["English"] }), lists({ AB: ["English", "German"] }));
    expect(describeLanguageChanges(changes, { accept: ["AA", "AB"] })).toContain(
      "CIP_ACCEPT_LANGUAGE_CHANGES=AA,AB and committing"
    );
  });
});

describe("parseAcceptedLanguageChanges", () => {
  test("is the variable the documented command sets", () => {
    expect(ACCEPT_LANGUAGE_CHANGES_ENV).toBe("CIP_ACCEPT_LANGUAGE_CHANGES");
  });

  test("an unset or blank variable accepts nothing", () => {
    expect(parseAcceptedLanguageChanges(undefined)).toEqual([]);
    expect(parseAcceptedLanguageChanges("")).toEqual([]);
    expect(parseAcceptedLanguageChanges("   ")).toEqual([]);
  });

  test("reads one code, several, and spaces around them", () => {
    expect(parseAcceptedLanguageChanges("IQ")).toEqual(["IQ"]);
    expect(parseAcceptedLanguageChanges("IQ,MR")).toEqual(["IQ", "MR"]);
    expect(parseAcceptedLanguageChanges(" IQ , MR ")).toEqual(["IQ", "MR"]);
  });

  test.each(["iq", "IQX", "I", "IQ,", ",IQ", "IQ,,MR", "IQ;MR", "IQ MR"])(
    "refuses %j rather than reading it generously",
    (raw) => {
      expect(() => parseAcceptedLanguageChanges(raw)).toThrow(
        /CIP_ACCEPT_LANGUAGE_CHANGES must be two-letter uppercase country codes separated by commas/
      );
    }
  );

  test("refuses a code named twice", () => {
    expect(() => parseAcceptedLanguageChanges("IQ,MR,IQ")).toThrow(
      /CIP_ACCEPT_LANGUAGE_CHANGES names IQ more than once/
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/country-facts/languages.test.ts`
Expected: FAIL — the suite cannot load `./languages.mjs` ("Failed to load url ./languages.mjs" or "Cannot find module").

- [ ] **Step 3: Write the module**

Create `scripts/country-facts/languages.mjs`:

```js
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run scripts/country-facts/languages.test.ts`
Expected: PASS — every test in the file green (27, counting each `test.each` case).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/country-facts/languages.mjs scripts/country-facts/languages.test.ts
git commit -m "feat: compare each country's official languages as a set, and parse a reviewed acceptance" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The gate stops every change to a published list

**Files:**
- Modify: `scripts/country-facts/gate.mjs` — the import block (line 15-33); `assertFactsSane`'s docblock and signature (line 325-344); `if (!previous) return;` (line 634); the end of the function (after the `collapsed` check, line 685).
- Modify: `scripts/country-facts/gate.test.ts` — "tolerates one field of churn in one country" (line 502-507); a new `describe` after the `assertFactsSane` describe closes (line 520).
- Modify: `lib/countryTips.test.ts` — the comment above `expect(scanned).toBe(426);` (line 695-702).
- Modify: `scripts/country-facts/curated.mjs` — the `REFUSED_LANGUAGE_ITEMS` docblock (line 159-187).
- Modify: `.github/workflows/refresh-cities.yml` — the header's throw-site count (line 47-48).

**Interfaces:**
- Consumes (Task 1): `ACCEPT_LANGUAGE_CHANGES_ENV`, `languageChanges`, `describeLanguageChanges` from `./languages.mjs`.
- Produces (Task 3 relies on it): `assertFactsSane(built, previous, options?: { acceptLanguageChanges?: string[] })`. The existing two-argument calls are unchanged. It throws:
  - an acceptance without a baseline, before `if (!previous) return;`;
  - unaccepted changes, with `describeLanguageChanges(unaccepted, { scoped: diagnostics.scopedLanguages, accept: <every changed code> })`;
  - an unused acceptance.

- [ ] **Step 1: Write the failing gate tests**

In `scripts/country-facts/gate.test.ts`, replace the test at line 502-507:

```ts
  test("tolerates one field of churn in one country", () => {
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    const built = sampleBuilt();
    delete built.countries[ANY].officialLanguages;
    expect(() => assertFactsSane(built, previous)).not.toThrow();
  });
```

with:

```ts
  test("tolerates one field of churn in one country", () => {
    // `plugs`, not `officialLanguages`: a language list moving is never churn —
    // see "a published language list never changes without a human" below —
    // while one other field in one country still is.
    const previous = { countries: structuredClone(sampleBuilt().countries) };
    const built = sampleBuilt();
    delete built.countries[ANY].plugs;
    expect(() => assertFactsSane(built, previous)).not.toThrow();
  });
```

Then insert this block after the closing `});` of `describe("assertFactsSane", ...)` (line 520), before the `// The committed artifact — live data` banner:

```ts
// ---------------------------------------------------------------------------
// assertFactsSane — a published language list never changes without a human
//
// A total over every country cannot see a relabel or a same-count swap, so the
// gate compares each country's list. The helpers are pinned one by one in
// scripts/country-facts/languages.test.ts; these pin the three branches the
// gate adds and the order they report in.
// ---------------------------------------------------------------------------

/** A second ordinary country, for the swap a total cannot see. */
const OTHER = FILLER_POOL[1];

/** A healthy previous artifact and a build identical to it, for one mutation each. */
function unchangedPair() {
  return { previous: { countries: structuredClone(sampleBuilt().countries) }, built: sampleBuilt() };
}

describe("assertFactsSane — a published language list never changes without a human", () => {
  test("an unchanged build passes, so every rejection below is the language check", () => {
    const { previous, built } = unchangedPair();
    expect(() => assertFactsSane(built, previous)).not.toThrow();
  });

  test("rejects an added language, naming the country and the language — Mauritania's shape", () => {
    const { previous, built } = unchangedPair();
    built.countries[ANY].officialLanguages = ["English", "French"];
    expect(() => assertFactsSane(built, previous)).toThrow(
      `1 country changed its published official languages since the committed artifact: ${ANY}: +"French"`
    );
  });

  test("rejects a same-count swap between two countries — the change a total cannot see", () => {
    const { previous, built } = unchangedPair();
    previous.countries[ANY].officialLanguages = ["English", "French"];
    built.countries[OTHER].officialLanguages = ["English", "French"];
    const total = (countries: Record<string, Record<string, unknown>>) =>
      Object.values(countries).reduce(
        (sum, record) => sum + ((record.officialLanguages as string[] | undefined)?.length ?? 0),
        0
      );
    // Armed: lib/countryTips.test.ts's 426-style total passes this build untouched.
    expect(total(built.countries)).toBe(total(previous.countries));
    expect(() => assertFactsSane(built, previous)).toThrow(
      `2 countries changed their published official languages since the committed artifact: ` +
        `${ANY}: -"French"; ${OTHER}: +"French"`
    );
  });

  test("rejects a relabel — Iraq's shape, one name out and one in", () => {
    const { previous, built } = unchangedPair();
    built.countries[ANY].officialLanguages = ["English language"];
    expect(() => assertFactsSane(built, previous)).toThrow(`${ANY}: -"English" +"English language"`);
  });

  test("rejects a withdrawn field, and names territorial scope when that is why", () => {
    const { previous, built } = unchangedPair();
    delete built.countries[ANY].officialLanguages;
    expect(() => assertFactsSane(built, previous)).toThrow(
      `${ANY}: -"English" (field withdrawn: no publishable statement came back)`
    );
    built.diagnostics.scopedLanguages = [ANY];
    expect(() => assertFactsSane(built, previous)).toThrow(
      `${ANY}: -"English" (field withdrawn: every statement is now territorially scoped)`
    );
  });

  test("rejects a field appearing where the committed artifact had none", () => {
    const { previous, built } = unchangedPair();
    delete previous.countries[ANY].officialLanguages;
    expect(() => assertFactsSane(built, previous)).toThrow(`${ANY}: +"English" (field new)`);
  });

  test("lets an accepted change through while still rejecting one nobody accepted", () => {
    const { previous, built } = unchangedPair();
    built.countries[ANY].officialLanguages = ["English", "French"];
    built.countries[OTHER].officialLanguages = ["English", "German"];
    const partly = () => assertFactsSane(built, previous, { acceptLanguageChanges: [ANY] });
    expect(partly).toThrow(
      `1 country changed its published official languages since the committed artifact: ${OTHER}: +"German"`
    );
    // The suggestion keeps the country already accepted, so copying it works.
    expect(partly).toThrow(`CIP_ACCEPT_LANGUAGE_CHANGES=${ANY},${OTHER} and committing`);
    expect(() => assertFactsSane(built, previous, { acceptLanguageChanges: [ANY, OTHER] })).not.toThrow();
  });

  test("rejects an acceptance naming a country whose languages did not change", () => {
    const { previous, built } = unchangedPair();
    expect(() => assertFactsSane(built, previous, { acceptLanguageChanges: [ANY] })).toThrow(
      `CIP_ACCEPT_LANGUAGE_CHANGES names ${ANY}, whose published official languages did not change this run`
    );
  });

  test("reports an unaccepted change before an unused acceptance", () => {
    const { previous, built } = unchangedPair();
    built.countries[OTHER].officialLanguages = ["English", "German"];
    expect(() => assertFactsSane(built, previous, { acceptLanguageChanges: [ANY] })).toThrow(
      /^1 country changed its published official languages/
    );
  });

  test("rejects an acceptance where there is nothing to accept against", () => {
    const noBaseline = new RegExp(
      `CIP_ACCEPT_LANGUAGE_CHANGES names ${ANY} but there is no previous artifact to compare against`
    );
    expect(() => assertFactsSane(sampleBuilt(), null, { acceptLanguageChanges: [ANY] })).toThrow(noBaseline);
    expect(() => assertFactsSane(sampleBuilt(), { countries: {} }, { acceptLanguageChanges: [ANY] })).toThrow(
      noBaseline
    );
  });
});
```

- [ ] **Step 2: Run the gate tests and watch the new ones fail**

Run: `npx vitest run scripts/country-facts/gate.test.ts`
Expected: FAIL. The rejection tests fail with "expected function to throw an error, but it didn't". The unaccepted-change assertions inside "lets an accepted change through…" fail the same way. The moved churn test and "an unchanged build passes" PASS, as do all the pre-existing tests. This confirms nothing in the gate rejects a language change today.

- [ ] **Step 3: Import the helpers in `gate.mjs`**

In `scripts/country-facts/gate.mjs`, directly after the existing `from './picks.mjs';` import (line 33), add:

```js
import {
  ACCEPT_LANGUAGE_CHANGES_ENV,
  describeLanguageChanges,
  languageChanges,
} from './languages.mjs';
```

- [ ] **Step 4: Document the new parameter and extend the signature**

In `assertFactsSane`'s docblock (the block ending at line 343 with "…and a finished record cannot show either."), append before the closing `*/`:

```js
 *
 * `options.acceptLanguageChanges` is the parsed `CIP_ACCEPT_LANGUAGE_CHANGES`
 * (scripts/country-facts/languages.mjs): the countries whose language change
 * a human reviewed. It is empty on every nightly run, which never sets the
 * variable.
 *
 * @param {*} built
 * @param {*} previous
 * @param {{ acceptLanguageChanges?: string[] }} [options]
```

and change the signature line from:

```js
export function assertFactsSane(built, previous) {
```

to:

```js
export function assertFactsSane(built, previous, { acceptLanguageChanges = [] } = {}) {
```

- [ ] **Step 5: Refuse an acceptance with no baseline**

Replace the four lines at line 634-637:

```js
  if (!previous) return;

  // --- Drift, against the previous artifact --------------------------------
  const previousCountries = previous.countries ?? {};
```

with:

```js
  // An acceptance is a reviewed difference from the published lists, and with
  // no baseline there are none: one set here names nothing a human could have
  // seen. Checked before the return below, because every drift check after it
  // is inert on this run. An empty baseline is a first run by another name —
  // the shrink band below skips it the same way — so it is refused alike.
  const previousCountries = previous?.countries ?? {};
  if (acceptLanguageChanges.length > 0 && Object.keys(previousCountries).length === 0) {
    throw new Error(
      `${ACCEPT_LANGUAGE_CHANGES_ENV} names ${acceptLanguageChanges.join(', ')} but there is no ` +
      `previous artifact to compare against — there is nothing to accept a change against, and ` +
      `every drift check is inert on a first run`
    );
  }

  if (!previous) return;

  // --- Drift, against the previous artifact --------------------------------
```

- [ ] **Step 6: Add the per-country check as the function's last section**

Immediately after the `collapsed` check's closing `}` (the `if (collapsed.length > 0) { … }` block ending at line 685), before the function's own closing `}`, insert:

```js

  // --- Official languages, per country -------------------------------------
  // Every change to a published list stops the run and names itself. See
  // scripts/country-facts/languages.mjs for why a total could not, and
  // docs/superpowers/specs/2026-09-24-language-change-gate-design.md for the
  // two years of upstream history this was measured against: 45 changes on 43
  // nights, 18 of which no total can see.
  //
  // Last, so a broader failure above reports first. Against `built` as it will
  // be written — curated rows, refusals and carry-forward already applied — so
  // a demoted P37 night, whose every list was carried forward, compares equal
  // by construction, and an upstream revert heals the next run on its own,
  // because a rejected run writes nothing. An empty baseline is skipped for
  // the reason given above the drift section.
  if (Object.keys(previousCountries).length === 0) return;
  const changes = languageChanges(previousCountries, countries);
  const accepted = new Set(acceptLanguageChanges);
  const unaccepted = changes.filter((change) => !accepted.has(change.code));
  if (unaccepted.length > 0) {
    throw new Error(
      describeLanguageChanges(unaccepted, {
        scoped: diagnostics.scopedLanguages ?? [],
        accept: changes.map((change) => change.code),
      })
    );
  }
  const unused = acceptLanguageChanges.filter((code) => !changes.some((change) => change.code === code));
  if (unused.length > 0) {
    throw new Error(
      `${ACCEPT_LANGUAGE_CHANGES_ENV} names ${unused.join(', ')}, whose published official ` +
      `languages did not change this run — an acceptance names exactly what a human reviewed, so ` +
      `a stale or mistyped one must not stay armed for tomorrow's change`
    );
  }
```

- [ ] **Step 7: Run the gate tests and watch them pass**

Run: `npx vitest run scripts/country-facts/gate.test.ts scripts/country-facts/languages.test.ts`
Expected: PASS, both files. Also confirm the pre-existing drift tests still pass *for their own reason*: "rejects a fact count that fell…", "…rose…", "…hollowed out…" and "…lost every fact…" each still throw their original message. The language check is last, so they must not start reporting a language change.

- [ ] **Step 8: Record the division of labour in the three places that describe it**

In `lib/countryTips.test.ts`, replace:

```ts
    // made it 427 on 2026-09-13 by giving Mauritania French; that statement
    // is refused, so the count held — see the test above.
    expect(scanned).toBe(426);
```

with:

```ts
    // made it 427 on 2026-09-13 by giving Mauritania French; that statement
    // is refused, so the count held — see the test above.
    //
    // This total is NOT the change detector, and must not be read as one: a
    // relabel or a same-count swap never moves it — Iraq's "Kurdish" became
    // "Kurdish language" on 2026-09-08 and shipped straight past it. Every
    // change to one country's list is stopped before any write by the
    // ingest's own gate (scripts/country-facts/languages.mjs). This pin stays
    // exact as the sweep's arming check, and as a count check on the commits
    // that gate never sees — human PRs included.
    expect(scanned).toBe(426);
```

In `scripts/country-facts/curated.mjs`, in the `REFUSED_LANGUAGE_ITEMS` docblock, insert a paragraph after the first paragraph (after the line ` * rules would publish and a human has checked are false.`):

```js
 *
 * A statement like this no longer waits for a total to be noticed. Since
 * 2026-09-24 `assertFactsSane` stops any run in which a country's published
 * list changes, naming the language (scripts/country-facts/languages.mjs), so
 * the night upstream adds one is the night a human hears about it. This table
 * is one of the three answers to that message, with `CURATED_FACTS` and an
 * accepted change.
```

In `.github/workflows/refresh-cities.yml`, change:

```yaml
# run. country-facts/gate.mjs's `assertFactsSane` carries 38 throw sites and
```

to:

```yaml
# run. country-facts/gate.mjs's `assertFactsSane` carries 41 throw sites and
```

Run: `grep -c "throw new Error" scripts/country-facts/gate.mjs`
Expected: `41`

- [ ] **Step 9: Run the three touched suites and the type-check**

Run: `npx vitest run scripts/country-facts/ lib/countryTips.test.ts && npx tsc --noEmit`
Expected: all green; `tsc` exits 0 with no output.

- [ ] **Step 10: Commit**

```bash
git add scripts/country-facts/gate.mjs scripts/country-facts/gate.test.ts lib/countryTips.test.ts scripts/country-facts/curated.mjs .github/workflows/refresh-cities.yml
git commit -m "feat: stop the facts ingest when any country's published languages change" -m "The 426 total nets out: a relabel or a same-count swap never moves it, and Iraq's 'Kurdish language' shipped past it on 2026-09-08. assertFactsSane now compares each country's list against the previous artifact before any write and names every change; a reviewed change is accepted through CIP_ACCEPT_LANGUAGE_CHANGES." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `run()` parses the acceptance first, and only the entry guard reads it

**Files:**
- Modify: `scripts/ingest-country-facts.mjs` — header "Usage" (line 66); imports (line 91-114); `run()`'s docblock, signature and body (line 125-256); the entry guard and its docblock (line 258-279).
- Modify: `scripts/ingest-country-facts.test.ts` — imports (line 39-59 and 82-87); `expectNoWrite` (line 148-158); a new `describe` after `describe("run() — the positive control", ...)` closes (line 339).

**Interfaces:**
- Consumes (Task 1): `ACCEPT_LANGUAGE_CHANGES_ENV`, `parseAcceptedLanguageChanges`, `languageChanges`, `summariseLanguageChanges`. Consumes (Task 2): `assertFactsSane(built, previous, { acceptLanguageChanges })`.
- Produces: `run({ fetchBindings?, dataDir?, acceptLanguageChanges?: string })`, where `acceptLanguageChanges` is the RAW variable value and defaults to `''`. The entry guard calls `run({ acceptLanguageChanges: process.env[ACCEPT_LANGUAGE_CHANGES_ENV] })`.

- [ ] **Step 1: Write the failing `run()` tests**

In `scripts/ingest-country-facts.test.ts`, add this import at the top of the second import group (beside `import { existsSync, mkdtempSync, … } from "node:fs";`, line 82):

```ts
import { spawnSync } from "node:child_process";
```

Replace `expectNoWrite` (line 148-158) with:

```ts
async function expectNoWrite(
  feed: Feed,
  pattern: RegExp,
  previous?: unknown,
  acceptLanguageChanges?: string
): Promise<void> {
  const dataDir = freshDataDir();
  if (previous !== undefined) await seedPrevious(dataDir, previous);
  await expect(run({ fetchBindings: loaderFor(feed), dataDir, acceptLanguageChanges })).rejects.toThrow(
    pattern
  );
  expect(vi.mocked(writeFileSync), "writeFileSync fired on a rejected run").not.toHaveBeenCalled();
  expect(vi.mocked(renameSync), "renameSync fired on a rejected run").not.toHaveBeenCalled();
}
```

Insert this block after the closing `});` of `describe("run() — the positive control", ...)` (line 339):

```ts
// ---------------------------------------------------------------------------
// run() — a published language list never changes without a human
//
// The gate's language branches driven end to end. scripts/country-facts/
// gate.test.ts pins each message; these pin that the check sits in the path a
// nightly job takes, that a rejected run leaves nothing on disk, that a
// demoted P37 night is never mistaken for change, and that the acceptance is
// read where the documentation says and nowhere else.
// ---------------------------------------------------------------------------

/** One more language for one country, the way the P37 query returns it. */
function addLanguage(feed: Feed, code: string, label: string): Feed {
  (feed.languages as Row[]).push({ country: code, item: languageItem(label), value: label });
  return feed;
}

/** The healthy artifact, except that the first filler already speaks Welsh. */
function welshPrevious(): typeof healthyPayload {
  const previous = structuredClone(healthyPayload);
  previous.countries[FILLERS[0]].officialLanguages = ["English", "Welsh"];
  return previous;
}

describe("run() — a published language list never changes without a human", () => {
  test("one country gaining a language while another loses one aborts before any write", async () => {
    // The swap a total cannot see: one value in, one value out.
    const feed = addLanguage(healthyFeed(), FILLERS[0], "French");
    feed.languages = (feed.languages as Row[]).filter(
      (row) => !(row.country === "PE" && row.value === "Aymara")
    );
    await expectNoWrite(
      feed,
      new RegExp(`^2 countries changed their[^]*: ${FILLERS[0]}: \\+"French"; PE: -"Aymara" — `),
      healthyPayload
    );
  });

  test("a relabel reaching every country that uses the language reads as one entry, and aborts", async () => {
    // Iraq's shape at full size: one label edit on one item, every country
    // that publishes it changed in the same night.
    const feed = healthyFeed();
    for (const row of feed.languages as Row[]) if (row.value === "English") row.value = "English language";
    const english = Object.keys(healthyPayload.countries).filter((code) =>
      (healthyPayload.countries[code].officialLanguages as string[] | undefined)?.includes("English")
    );
    await expectNoWrite(
      feed,
      new RegExp(
        `^${english.length} countries changed their published official languages since the committed ` +
          `artifact: ${english.join(", ")}: -"English" \\+"English language" — `
      ),
      healthyPayload
    );
  });

  test("a demoted P37 night — the fetch throws — writes, carrying every list forward", async () => {
    // Were carry-forward skipped, the build would answer ["English"] against a
    // previous ["English", "Welsh"] and stop a run whose only fault was an
    // outage.
    const dataDir = freshDataDir();
    const previous = welshPrevious();
    await seedPrevious(dataDir, previous);
    const feed = healthyFeed();
    feed.languages = "throw";
    await run({ fetchBindings: loaderFor(feed), dataDir });
    const { countries } = writtenPayload();
    for (const [code, record] of Object.entries(previous.countries)) {
      expect(countries[code]?.officialLanguages, code).toEqual(record.officialLanguages);
    }
  });

  test("a demoted P37 night — an implausibly small answer — writes the same way", async () => {
    const dataDir = freshDataDir();
    await seedPrevious(dataDir, welshPrevious());
    const feed = healthyFeed();
    feed.languages = [];
    await run({ fetchBindings: loaderFor(feed), dataDir });
    expect(writtenPayload().countries[FILLERS[0]].officialLanguages).toEqual(["English", "Welsh"]);
  });

  test("an accepted change is written, for that country alone, and the log names it", async () => {
    const dataDir = freshDataDir();
    await seedPrevious(dataDir, healthyPayload);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await run({
        fetchBindings: loaderFor(addLanguage(healthyFeed(), FILLERS[0], "Welsh")),
        dataDir,
        acceptLanguageChanges: FILLERS[0],
      });
      expect(log.mock.calls.flat().join("\n")).toContain(
        `accepted official-language changes: ${FILLERS[0]}: +"Welsh"`
      );
    } finally {
      log.mockRestore();
    }
    const { countries } = writtenPayload();
    expect(countries[FILLERS[0]].officialLanguages).toEqual(["English", "Welsh"]);
    expect(countries[FILLERS[1]].officialLanguages).toEqual(["English"]);
  });

  test("an acceptance naming a country whose languages did not change aborts before any write", async () => {
    await expectNoWrite(
      healthyFeed(),
      new RegExp(`CIP_ACCEPT_LANGUAGE_CHANGES names ${FILLERS[0]}, whose published official languages did not change`),
      healthyPayload,
      FILLERS[0]
    );
  });

  test("a malformed acceptance aborts before a single request, leaving no trace", async () => {
    const fetchBindings = vi.fn(loaderFor(healthyFeed()));
    const dataDir = freshDataDir();
    await expect(run({ fetchBindings, dataDir, acceptLanguageChanges: "aa" })).rejects.toThrow(
      /CIP_ACCEPT_LANGUAGE_CHANGES must be two-letter uppercase country codes/
    );
    expect(fetchBindings).not.toHaveBeenCalled();
    expect(existsSync(dataDir)).toBe(false);
  });

  test("run() ignores the variable exported in its own process — only the entry guard reads it", async () => {
    vi.stubEnv("CIP_ACCEPT_LANGUAGE_CHANGES", FILLERS[0]);
    try {
      await expectNoWrite(
        addLanguage(healthyFeed(), FILLERS[0], "Welsh"),
        /^1 country changed its published official languages/,
        healthyPayload
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("the documented command reaches run(): a malformed variable stops the script before any request", () => {
    // The real entry guard, in a child whose fetch is disabled before the
    // script loads — so even a regression that parsed the variable late could
    // reach neither Wikidata nor data/: it would fail on the country-code
    // query instead, with a different message, and this test would go red.
    const noNetwork =
      'data:text/javascript,globalThis.fetch=async()=>{throw new Error("network disabled in this test")}';
    const child = spawnSync(
      process.execPath,
      ["--import", noNetwork, pathJoin("scripts", "ingest-country-facts.mjs")],
      { encoding: "utf8", env: { ...process.env, CIP_ACCEPT_LANGUAGE_CHANGES: "aa" } }
    );
    expect(child.status).toBe(1);
    expect(child.stderr).toMatch(/CIP_ACCEPT_LANGUAGE_CHANGES must be two-letter uppercase country codes/);
    expect(child.stderr).toContain("Nothing was written");
  });
});
```

- [ ] **Step 2: Run them and watch the new ones fail**

Run: `npx vitest run scripts/ingest-country-facts.test.ts`
Expected: FAIL, as follows:
- The two abort tests already PASS, because Task 2's gate throws.
- "an accepted change is written…" FAILS: `run()` does not forward the acceptance yet, so the gate rejects the Welsh change.
- "an acceptance naming a country whose languages did not change…" FAILS: the run writes.
- "a malformed acceptance…" FAILS: the run fetches and writes.
- The spawned-guard test FAILS: the child ignores the variable, reaches the disabled fetch and fails on the country-code query, with the wrong message.
- The demotion tests and the env-isolation test PASS.

All pre-existing tests PASS.

- [ ] **Step 3: Import the helpers in `scripts/ingest-country-facts.mjs`**

After the `import { buildReport } from './country-facts/report.mjs';` line (line 114), add:

```js
import {
  ACCEPT_LANGUAGE_CHANGES_ENV,
  languageChanges,
  parseAcceptedLanguageChanges,
  summariseLanguageChanges,
} from './country-facts/languages.mjs';
```

- [ ] **Step 4: Parse first, pass to the gate, log what was accepted**

In `run()`'s docblock, replace the two lines:

```js
 * produced a complete wipe at exit 0. The entry guard below calls `run()` with
 * no arguments, so every parameter defaults to the real implementation.
```

with:

```js
 * produced a complete wipe at exit 0. The entry guard below passes only
 * `acceptLanguageChanges`, read from the environment there and nowhere else;
 * every other parameter defaults to the real implementation.
 *
 * `acceptLanguageChanges` is the raw `CIP_ACCEPT_LANGUAGE_CHANGES` value
 * (scripts/country-facts/languages.mjs): the countries whose language change
 * a human reviewed. It is parsed before anything else happens — a typo in it
 * is a typo in a command a human is running, and it must stop the run before
 * the previous artifact is read or a single request is made. It defaults to
 * NONE rather than to `process.env`, so a variable exported in a developer's
 * shell can never leak into the `run()` tests.
```

and replace the JSDoc parameter line and signature:

```js
 * @param {{ fetchBindings?: (name: string, codes: string[]) => Promise<Row[]>, dataDir?: string }} [options]
 */
export async function run({ fetchBindings = fetchPropertyRows, dataDir = DATA_DIR } = {}) {
  const factsPath = join(dataDir, FACTS_FILE);
```

with:

```js
 * @param {{ fetchBindings?: (name: string, codes: string[]) => Promise<Row[]>, dataDir?: string, acceptLanguageChanges?: string }} [options]
 */
export async function run({ fetchBindings = fetchPropertyRows, dataDir = DATA_DIR, acceptLanguageChanges = '' } = {}) {
  const accepted = parseAcceptedLanguageChanges(acceptLanguageChanges);
  const factsPath = join(dataDir, FACTS_FILE);
```

Change the gate call from:

```js
  assertFactsSane(built, previous);
```

to:

```js
  assertFactsSane(built, previous, { acceptLanguageChanges: accepted });
```

After the `refused statements fired` logging block:

```js
  if (built.diagnostics.refusedFired.length > 0) {
    console.log(`  refused statements fired: ${built.diagnostics.refusedFired.join(', ')}`);
  }
```

add:

```js
  if (accepted.length > 0) {
    const changes = languageChanges(previous?.countries ?? {}, built.countries);
    console.log(`  accepted official-language changes: ${summariseLanguageChanges(changes)}`);
  }
```

- [ ] **Step 5: Read the variable in the entry guard, and nowhere else**

Replace the entry guard's call line:

```js
  run().catch((error) => {
```

with:

```js
  run({ acceptLanguageChanges: process.env[ACCEPT_LANGUAGE_CHANGES_ENV] }).catch((error) => {
```

In the entry guard's docblock (the block beginning ` * Only runs when this file is invoked directly.`), append before its closing `*/`:

```js
 *
 * It passes one thing: `CIP_ACCEPT_LANGUAGE_CHANGES`, read here and nowhere
 * else, so the documented acceptance command reaches `run()` while a variable
 * exported in a shell can never reach a test's.
```

In the file header, replace:

```js
 * Usage: node scripts/ingest-country-facts.mjs
```

with:

```js
 * Usage: node scripts/ingest-country-facts.mjs
 *
 * To write a language change a human has reviewed — the nightly job never
 * does; see scripts/country-facts/languages.mjs:
 *
 *   CIP_ACCEPT_LANGUAGE_CHANGES=IQ,MR node scripts/ingest-country-facts.mjs
```

- [ ] **Step 6: Run the `run()` tests and watch them pass**

Run: `npx vitest run scripts/ingest-country-facts.test.ts`
Expected: PASS, every test in the file, including the spawned entry-guard test. The spawned child exits in well under a second, and its stderr carries the parse error and "Nothing was written".

- [ ] **Step 7: Type-check and run every facts suite**

Run: `npx tsc --noEmit && npx vitest run scripts/ lib/countryTips.test.ts lib/countryFacts.test.ts`
Expected: `tsc` exits 0 with no output; all files green.

- [ ] **Step 8: Commit**

```bash
git add scripts/ingest-country-facts.mjs scripts/ingest-country-facts.test.ts
git commit -m "feat: accept a reviewed language change with CIP_ACCEPT_LANGUAGE_CHANGES" -m "run() parses the acceptance before it reads anything or makes a request, passes it to the gate and logs what it let through. Only the entry guard reads the variable, so the documented command reaches run() while one exported in a shell never reaches the tests." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Whole-branch verification, mutation checks and the live proof

**Files:**
- No source change is expected. Any fix a step forces goes in its own `fix:` commit, and the step is re-run.

**Interfaces:**
- Consumes: everything above.
- Produces: evidence for the PR body:
  - the suite count before and after;
  - the five mutation results;
  - `cmp` silence on both artifacts.

- [ ] **Step 1: Whole suite and type-check**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` silent; vitest reports every file passing. Record the totals. The known `lib/climateModel.test.ts` `test.fails` tripwire counts as expected, not as a failure. If a timeout appears, re-run the named file alone before treating it as a regression; the repo records concurrent-load timeouts as flakes.

- [ ] **Step 2: Mutation 1 — delete the check's call**

In `scripts/country-facts/gate.mjs`, change `const changes = languageChanges(previousCountries, countries);` to `const changes = [];`.
Run: `npx vitest run scripts/country-facts/gate.test.ts scripts/ingest-country-facts.test.ts`
Expected: FAIL — among others "rejects a same-count swap between two countries…" and "one country gaining a language while another loses one aborts before any write".
Revert: `git checkout -- scripts/country-facts/gate.mjs`

- [ ] **Step 3: Mutation 2 — compare lengths instead of sets**

In `scripts/country-facts/languages.mjs`, change `if (removed.length === 0 && added.length === 0) continue;` to `if ((before ?? []).length === (after ?? []).length) continue;`.
Run: `npx vitest run scripts/country-facts/languages.test.ts scripts/country-facts/gate.test.ts`
Expected: FAIL — "a relabel is one name out and one name in…", "a swap between two countries is two changes…", "rejects a relabel…".
Revert: `git checkout -- scripts/country-facts/languages.mjs`

- [ ] **Step 4: Mutation 3 — skip withdrawn fields**

In `scripts/country-facts/languages.mjs`, insert `if (after === undefined) continue;` as the first line inside the `for (const code of codes)` loop.
Run: `npx vitest run scripts/country-facts/languages.test.ts scripts/country-facts/gate.test.ts`
Expected: FAIL — "a field withdrawn and a field appearing say so", "rejects a withdrawn field, and names territorial scope when that is why".
Revert: `git checkout -- scripts/country-facts/languages.mjs`

- [ ] **Step 5: Mutation 4 — drop the unused-acceptance throw**

In `scripts/country-facts/gate.mjs`, change `if (unused.length > 0) {` to `if (false) {`.
Run: `npx vitest run scripts/country-facts/gate.test.ts scripts/ingest-country-facts.test.ts`
Expected: FAIL — "rejects an acceptance naming a country whose languages did not change" and "an acceptance naming a country whose languages did not change aborts before any write".
Revert: `git checkout -- scripts/country-facts/gate.mjs`

- [ ] **Step 6: Mutation 5 — read the variable inside `run()`'s default**

In `scripts/ingest-country-facts.mjs`, change `acceptLanguageChanges = ''` in `run()`'s signature to `acceptLanguageChanges = process.env.CIP_ACCEPT_LANGUAGE_CHANGES`.
Run: `npx vitest run scripts/ingest-country-facts.test.ts`
Expected: FAIL — "run() ignores the variable exported in its own process — only the entry guard reads it".
Revert: `git checkout -- scripts/ingest-country-facts.mjs`

Run: `git status --short`
Expected: no output (every mutation reverted).

- [ ] **Step 7: The live proof — today's upstream passes the new gate, byte-identical**

**Wikimedia returns 403 to this machine for the repo's own User-Agent** (spec §6.2). Unless the User-Agent fix has merged by now (`grep -n "USER_AGENT =" scripts/country-facts/io.mjs` shows a `+https://github.com/darrenCWJ/china-itinerary-planner` form), run the proof through a scratch preload that swaps only the UA header. It lives in the session scratchpad, never the repo:

Create `<scratchpad>/ua.mjs`:

```js
// Swap the shipping UA for the house's compliant form (scripts/build-provinces.mjs's), for this proof only.
const UA = 'china-itinerary-planner/language-gate-proof (+https://github.com/darrenCWJ/china-itinerary-planner)';
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => realFetch(url, { ...init, headers: { ...(init.headers ?? {}), 'User-Agent': UA } });
```

Create `<scratchpad>/proof.mjs` (replace `<repo>` with the worktree's absolute path, forward slashes):

```js
// The diagnosis recipe's step 4: the real run() into a temp dir seeded with the committed artifact.
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const repo = '<repo>';
const { run } = await import(`file:///${repo}/scripts/ingest-country-facts.mjs`);
const dataDir = join(mkdtempSync(join(tmpdir(), 'language-gate-proof-')), 'data');
mkdirSync(dataDir, { recursive: true });
for (const file of ['country-facts.json', 'country-facts-report.md']) copyFileSync(join(repo, 'data', file), join(dataDir, file));
await run({ dataDir });
console.log(`PROOF_DIR=${dataDir}`);
```

Run: `node --import "<scratchpad>/ua.mjs" "<scratchpad>/proof.mjs" 2>&1 | grep -v " batch "`
Expected: `Wrote …country-facts.json (246 countries, 2094 facts, unchanged)`, then `PROOF_DIR=…`.

Then run: `cmp "<PROOF_DIR>/country-facts.json" data/country-facts.json && cmp "<PROOF_DIR>/country-facts-report.md" data/country-facts-report.md && echo BYTE-IDENTICAL`
Expected: `BYTE-IDENTICAL`

If the run instead throws `… changed their published official languages …`, upstream changed a list since last night's refresh. That is the gate working on live data:
- record the message;
- look the change up (the recipe's step 3);
- report it to the owner;
- do NOT accept it inside this PR.

- [ ] **Step 8: Hand off**

Once steps 1-7 hold:
1. Run the review loop.
2. Run Fable's final pass (standing instruction). Give it the spec, the whole-branch diff, and where the earlier reviews already looked.
3. Then use superpowers:finishing-a-development-branch.

The PR body carries:
- §1.2's measurement;
- the ~13.5 decisions a year this design costs;
- the five mutation results and the byte-identical proof;
- a pointer to the §6.1 baseline follow-up, to be filed as its own task once the PR exists.

---

## Execution record (2026-09-24)

Executed subagent-driven, with one implementer and one reviewer per task, then an Opus whole-branch review. What the review loop changed against the text above is recorded here, so the plan does not keep telling a future reader to do what did not happen.

- **Task 1.** The plan's test file could not detect the module's four `.sort()` calls: every fixture was already alphabetical, and no change had two names. The task review caught it, and three tests were added (4d8ac73), each seen failing when its sort is removed.
- **Task 2.** Its review flagged `lib/countryTips.test.ts` at 908 lines against "Files stay under 800 lines". The file was 900 before this plan and is one of the five test files the owner chose on 2026-09-07 to leave over; Global Constraints now names them (eb9f092).
- **Rebase.** Between Tasks 3 and 4 the branch was rebased onto `origin/main` 3f9cf53 (PR #34, compliant User-Agents; no file overlap). Task 4's live proof therefore ran on the repo's own User-Agent, with no `ua.mjs` preload.
- **Task 4, Step 3 (Mutation 2).** "a swap between two countries is two changes…" does NOT fail under a per-country length comparison, because each country's length changes in that swap. The mutation is killed by the relabel tests, as the plan also lists.
- **Task 4, Step 4 (Mutation 3).** The instruction inserts `if (after === undefined) continue;` BEFORE `const after` is declared, so it throws a temporal-dead-zone ReferenceError and 27 tests fail by crashing. Re-run correctly, after the declaration, it is killed by exactly the five withdrawn-field tests.
- **Task 4, Step 7.** The live proof came out byte-identical. The P37 query answered live; only `currency` was demoted, by a Wikidata 502, and carried forward.
- **Whole-branch review.** Opus returned "with fixes" and one wave closed them:
  - `run()`'s accepted-change log now passes `{ scoped }`, as spec §2.7 required and this plan's Task 3 code omitted (c43ae78, with a test seen red on the wrong reason first).
  - The floor docblock, the scoped comment and one test comment stopped claiming the nightly job lets six silent losses through. The per-country check stops the first on any run with a baseline.
  - A stale test pointer was corrected.
  - The acceptance's usage notes now say to set it inline for one command, because an exported variable stays armed for a second change to the same country (6195fc3).
  - The review's triage of nine logged Minor findings was "leave" for all of them.
- **Attribution.** Implementer commits carry the implementing model's own `Co-Authored-By` line (Haiku 4.5 or Sonnet 5), per each subagent's attribution rule, rather than this plan's hard-coded one.
