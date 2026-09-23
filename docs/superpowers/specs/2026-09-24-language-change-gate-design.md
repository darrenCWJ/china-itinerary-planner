# Per-country language-change gate — design

**Date:** 2026-09-24
**Status:** approved in chat on 2026-09-24 — the three forks below were put to the owner as questions and answered: every change to a published list stops the run (§2.2), the run aborts before writing rather than quarantining (§2.1), and the defects already in the baseline are a separate follow-up (§6). Every other decision here is the design's, and a reviewer may overrule it.
**Scope:** detect ANY change to a country's published `officialLanguages` list in the country-facts ingest's gate, before any write, and name the country and the exact languages — replacing a repo-wide total that can net out. Nothing here changes which languages are published today; the artifact this ships beside is byte-identical to `main`'s.

## 0. What was checked first

Verified against `main` at 5aee64b, tree clean:

- `Refresh cities` is green: the PR #33 confirmation dispatch (run 35796972575) and last night's scheduled run (35870125427, 2026-09-23T13:52Z) both passed; the latter's facts job wrote `(246 countries, 2094 facts, unchanged)`.
- The shipping pipeline, run read-only against the live endpoint (the diagnosis recipe's step 2 — `fetchPropertyRows` per `PROPERTIES`, `buildFacts`, `applyCurated`, diff, `assertFactsSane`; nothing written), reproduces `data/country-facts.json` exactly: 0 field differences, the gate passes, 426 language values across 239 countries, `refusedFired: MR.Q150`.
- The gap as the PR #33 review stated it is real. The ONLY check that stopped Mauritania's French was `expect(scanned).toBe(426)` at `lib/countryTips.test.ts:702`, a sum of every country's list length, which runs in the commit job's verify step after the facts job has already gone green. `assertFactsSane` accepted the statement every night.

## 1. The problem, measured

### 1.1 The pin has already missed one

At 2026-09-08T09:43:43Z (rev 2542178027) a single `wbsetlabel-set:1|en` edit changed Q36368's English label from `Kurdish` to `Kurdish language`. That night's refresh (b6b916d, committed 13:30:27Z) shipped Iraq as `["Arabic", "Kurdish language"]` — "Arabic and Kurdish language are official languages" — and nothing noticed, because a relabel moves no count. It is still in production. It is the netting-out case in its smallest form: one country losing a name and gaining one in the same night.

### 1.2 Two years of upstream churn

The repo's precedent is to measure the live source rather than guess, so the question "how often does a published list really change?" was answered from Wikidata's own history, read-only, with a policy-compliant User-Agent (§6.2).

**Method.**
- **Country side.** The 255 truthy `P297` statements for the 246 codes resolve to 251 items (CY, BQ, GE, BY and AI each have two; NL, EH, SC and DK have a deprecated second). Their revision metadata for 2024-09-23 → 2026-09-23 is 59,537 revisions, 171 of which name `[[Property:P37]]`. Every revision that could move the published set — a P37 edit, a `P518` qualifier edit, an undo, restore, rollback or merge, a generic `wbeditentity` — was grouped into nightly windows (snapshot 13:30 UTC, when the facts job actually queries) and each item's state was diffed from one snapshot to the next with `action=compare`: all 844 windows holding a direct, qualifier or revert edit, plus a seeded random 300 of the 3,056 windows holding only generic bot edits. The 74 windows whose diff touched P37 were then resolved EXACTLY: the full entity at both ends, with today's rules applied — best rank, `P518` on any best-rank statement withholds the field, `DROPPED_LANGUAGE_ITEMS` removed, the union over a code's items, curated BE/AZ filling a withheld field. The MR refusal is not applied: it was a response to the churn being counted.
- **Label side.** The 215 language items the artifact publishes were scanned the same way for changes to the English label, and to `mul` where an item has no English one — exactly `labelWithMulFallback`'s `COALESCE(en, mul)` — and each change was mapped to the countries publishing that item ON THAT NIGHT. Two apparent label deletions (Amharic, Persian, 2026-03-05) are the `mul` migration — a "Remove all redundant labels" run deleting `en` where `mul` held the same word — and change nothing the query reads; they are excluded.
- **Coverage.** Zero diff errors. None of the 300 sampled generic windows, on either side, changed a published list, and the 52 items with touched windows chain with zero breaks — no unsampled window changed state between two checked ones.
- **Validation.** Replayed over the artifact's own lifetime (2026-08-28 onwards), the reconstruction finds exactly the two changes the committed history shows: IQ on 09-08 and MR on 09-14.

**Result.**

| | 2024-09-23 → 2026-09-23 |
|---|---|
| Changes to a published language list | **45** — 30 statement edits, 15 label edits reaching 20 country lists (Appendix A) |
| Distinct nights a per-country check would stop | **43**, about **21.5 a year** |
| Changes the 426 pin would have caught | **27 of 45** — it misses all 15 label edits and the 3 same-count swaps (NE `French→Hausa`, GI and FK `English→British English`) |
| Reverted upstream on their own | 18 changes in 9 episodes, after 1, 2, 3, 10, 18, 23, 50, 55 and 445 days |
| One-way changes needing a human decision | 27, about **13.5 a year** |

**What this means.** The pin already turns the nightly red on roughly 13.5 nights a year from language churn alone, each time with a count ("expected 426, got 427") that the recipe needs ~20 minutes to trace to a country. A per-country check turns it red on roughly 21.5 nights a year, each naming the country and the languages. Eight more red nights a year is the price of seeing the 18 changes the pin cannot; the cost per red night falls from a diagnosis to a Wikidata lookup.

## 2. Design

### 2.1 The check

One new drift check in `assertFactsSane` (`scripts/country-facts/gate.mjs`), after the existing ones (`emptied`, the shrink and growth bands, `collapsed`), so a broader failure still reports first: for every country in the previous artifact or the build, compare the published `officialLanguages` as a SET OF LABELS. Any difference throws before any write — the same abort every other gate in the file makes (the owner's choice over quarantining; §3). Labels, not Q-ids, because a label is what the traveller reads and §1.1 was a label.

It compares the FINAL build — after `applyCurated`, the refusals inside `buildFacts`, and carry-forward — against the previous artifact: what would be written against what is published.

### 2.2 What counts as a change

Every kind, by the owner's choice: a language added, removed, or relabelled (a removal and an addition in one country), a field appearing where the previous artifact had none, and a field withdrawn — every statement now territorially scoped, or no publishable statement left. Measured cost of including withdrawals: 4 of the 45 changes (SJ, PW, UY, US).

What never reads as a change, by construction rather than by special case:

- **A demoted P37 night.** `run()` carries every list forward from the previous artifact before the gate, so the build equals the previous artifact. Both demotion paths (the fetch throws; the answer covers under 80% of last run's countries) get a `run()` test.
- **A curated row or a refusal that fires as it did yesterday.** BE, AZ and MR come out exactly as published.
- **An upstream revert.** A rejected run writes nothing, so the previous artifact still holds the pre-edit list; when upstream reverts, the next run matches and goes green with no repo change. 9 of the measured episodes healed this way.
- **A first run.** Inert, like every drift check (`previous === null`).

What deliberately DOES read as a change: a new curated row, refusal or dropped item that alters a published list. That is a human changing what travellers read, and it goes through §2.4 in the same PR.

A partial P37 answer that still passes plausibility would drop the lists of the countries it missed; they are reported as withdrawn and the run stops, where today up to six countries could go silent under the `officialLanguages` floor. No committed version of the artifact since it was first built on 2026-08-27 shows a list lost that way; a re-run tells a transient partial answer from a real removal.

### 2.3 The message

One throw naming every changed country, grouped so that one upstream edit reads as one entry (a single line in the log; wrapped here):

```
2 countries changed their published official languages since the committed artifact:
IQ: -"Kurdish" +"Kurdish language"; MR: +"French" — ...
```

- Names are `JSON.stringify`'d (labels may carry spaces, hyphens or commas); removals before additions, so a relabel reads from → to.
- Countries with an identical signature share a line (`CY, TR: -"Turkish" +"Turkish language"`), sorted by first code.
- A withdrawn field says so, and says `every statement is now territorially scoped` when the build's `scopedLanguages` diagnostic names the country; a new field says so.
- It ends with the three responses and the exact acceptance to copy: `CIP_ACCEPT_LANGUAGE_CHANGES=IQ,MR`.

It is the only output a rejected run leaves — the report is not written — so it must be enough to decide from.

### 2.4 Accepting a change

```
CIP_ACCEPT_LANGUAGE_CHANGES=IQ,MR node scripts/ingest-country-facts.mjs
```

then commit the regenerated artifact and report, plus any exact pin the change moves (§2.6), in a PR — the shape every fix PR on this ingest already has.

- Named `CIP_…` after the repo's one existing ingest variable, `CIP_CHELSA_CACHE` (`scripts/climate/acquire.mjs:46`).
- **Validated before anything else happens**, including reading the previous artifact: comma-separated two-letter uppercase codes, whitespace around the codes tolerated, nothing else — no empty entries, no duplicates, no lowercase. An unset or blank variable means no acceptance. Codes are never uppercased for you; the house refuses to normalise codes (`buildFacts`).
- **Exact.** A listed country whose list did not change aborts the run: an acceptance names what a human reviewed, and a stale or mistyped one must not stay armed for tomorrow's change. Set on a first run, it aborts too — there is nothing to accept against. When a run has both unaccepted changes and an unused acceptance, the unaccepted changes are reported first.
- **Read only at the process edge.** The entry guard passes `process.env.CIP_ACCEPT_LANGUAGE_CHANGES` to `run()`; `run()` itself defaults to none, so an exported variable in a developer's shell can never leak into the suite's `run()` tests.
- **Never set by the workflow.** An accepted run logs what it let through (`accepted official-language changes: IQ -"Kurdish" +"Kurdish language"`).

### 2.5 Refusing a change

Unchanged, and already in `scripts/country-facts/curated.mjs`: `REFUSED_LANGUAGE_ITEMS` for a wrong statement added, `CURATED_FACTS` for a field wrongly withheld. The message names both. Refusals for a relabel and for a wrongful removal inside a multi-language list do not exist yet; the baseline follow-up needs both and adds them there (§6.1).

### 2.6 The 426 pin and the other exact pins

Kept exactly, per the brief's "keep its semantics or explain replacing it". Its comment gains the new division of labour: per-country detection is the gate's, before any write; the pin remains the sweep's arming check ("an artifact that failed to parse would leave both empty and green") and an independent net-count check in the verify step, which also runs on human PRs the gate never sees. The pins on 239 countries with languages (`lib/countryTips.test.ts:200`, `:432`, `lib/countryFacts.test.ts:91`, `lib/countryProfile.test.ts:637`) and `MEASURED_FIELD_COVERAGE.officialLanguages` are untouched; an accepted change that moves one of them updates it in the same PR.

### 2.7 Where the code goes

- **`scripts/country-facts/languages.mjs`** (new, one docblocked unit), exporting:
  - `ACCEPT_LANGUAGE_CHANGES_ENV`
  - `parseAcceptedLanguageChanges(raw)` → `string[]`, throwing on anything malformed
  - `languageChanges(previousCountries, countries)` → `{ code, removed, added, withdrawn, appeared }[]`, sorted by code
  - `describeLanguageChanges(changes, { scoped })` → the §2.3 message body
- **`gate.mjs`.** `assertFactsSane(built, previous, { acceptLanguageChanges = [] } = {})` — existing callers unchanged — gains three throw sites: unaccepted changes, an acceptance naming an unchanged country, an acceptance on a first run. The throws stay in this file because `refresh-cities.yml` names it as where `assertFactsSane`'s throw sites are; that header's count, 38, is updated.
- **`scripts/ingest-country-facts.mjs`.** `run({ fetchBindings, dataDir, acceptLanguageChanges = '' })` parses first, before `readJson`; passes the list to the gate; logs accepted changes. The entry guard and its docblock ("calls `run()` with no arguments") change to pass the variable.
- **Size.** `gate.mjs` stays near 730 lines and `gate.test.ts` near 770, both under the 800-line guidance.

## 3. Rejected alternatives

- **A committed per-country lock file checked by the gate.** An explicit approved baseline, independent of `previous`, but:
  - a second copy of 239 lists to keep in lockstep with the artifact;
  - a demotion special case — a carried-forward night disagrees with a freshly edited lock;
  - a lock injected into every `run()` test;
  - acceptance would still need a regenerated artifact, because the exact pins sit on the committed file.
- **A per-country pin in the test suite only.** Detection stays in the commit job after the facts job is green (Mauritania's exact shape), a local ingest writes the change without complaint, and it too duplicates the 239 lists.
- **Quarantine** — hold the previous list for a changed country, commit the rest of the refresh, turn the run red afterwards. It keeps cities flowing through a dispute, but "red" would stop meaning "nothing committed", and it needs a new workflow step. The owner chose to abort; §6.4 records when to revisit.
- **Additions only.** About half the red nights, but a wrongful removal ships silently — KG's Russian (§6.1) did. The owner chose every change.
- **Relaxing the 426 pin so a `workflow_dispatch` input could accept changes without a PR.** The 239 pins and `MEASURED_FIELD_COVERAGE` would still block any acceptance that moves coverage, so it would work only for relabels and equal swaps, at the cost of the verify step's only independent check.
- **Refusing automatically by source quality** (e.g. a statement referenced only by "imported from Wikimedia project", MR's shape). Antigua's English carries only a Wikimedia import URL; the rule would refuse correct statements wholesale.
- **Carrying Q-ids in the artifact to compare by id.** The client bundle pays for it, and a label change — the case that already shipped — would still need the label comparison.

## 4. Verification (test-first)

Every test is written before the code it pins and seen failing first.

- **`scripts/country-facts/languages.test.ts`** (new). `languageChanges`:
  - unchanged
  - added, removed, relabelled
  - appeared, withdrawn
  - order-insensitive
  - both absent
  - a country present on one side only

  `describeLanguageChanges`:
  - grouping by identical signature
  - quoting, and removals before additions
  - the withdrawn, scoped and new notes
  - the acceptance line naming every code

  `parseAcceptedLanguageChanges`:
  - unset and empty give no list
  - one code, several, spaces around commas
  - lowercase, three letters, an empty entry, a trailing comma and a duplicate each throw
- **`scripts/country-facts/gate.test.ts`** — one test per branch, each naming what it kills:
  - an added language (MR shape)
  - **a same-count swap between two countries, the case the pin cannot see**
  - a relabel (IQ shape)
  - a withdrawn field and a new one
  - an accepted change passing while an unaccepted one in the same build still throws
  - an acceptance naming an unchanged country
  - an acceptance on a first run

  The existing "tolerates one field of churn in one country" deletes `officialLanguages`, and that is now a change by design; it moves to `plugs`, with a comment pointing here.
- **`scripts/ingest-country-facts.test.ts`** — `run()`, by behaviour:
  - the two-country swap aborts before any write primitive fires and leaves no directory
  - a relabel does the same
  - both demotion paths write with every list equal to the previous artifact's
  - an accepted change is written, for that country only
  - an acceptance naming an unchanged country aborts before any write
  - a malformed acceptance aborts before a single request — the loader is a spy
  - `run()` ignores `CIP_ACCEPT_LANGUAGE_CHANGES` exported in the test process itself: a changed feed still aborts, because only the entry guard reads the variable

  One spawned `node scripts/ingest-country-facts.mjs` with `CIP_ACCEPT_LANGUAGE_CHANGES=iq` must exit 1 with the parse error before any request, proving the documented command's variable really reaches `run()`.
- **Mutation check.** Each of the following must turn a named test red:
  - delete the new check's call
  - compare lengths instead of sets
  - skip withdrawn fields
  - drop the "unused acceptance" throw
  - read the variable inside `run()`'s default
- **Whole branch.** `npx tsc --noEmit` and `npm test` green. Then the recipe's step 4 against today's live endpoint: `run({ dataDir })` into a temp directory seeded with the committed artifact and report, whose output must be BYTE-IDENTICAL (`cmp`) — the proof that today's upstream passes the new gate with nothing to accept.

## 5. Shape of the work

One PR, test-first, conventional commits, in this order:

1. the three helpers;
2. the gate branches;
3. the `run()` wiring and entry guard;
4. the moved churn test;
5. docs:
   - the new check's docblock carrying §1's measurement;
   - a sentence in `REFUSED_LANGUAGE_ITEMS`'s docblock that detection is now the gate's;
   - `run()`'s and the entry guard's docblocks;
   - the 426 comment;
   - the workflow header's throw count.

Then the byte-identical live proof, the review loop, and Fable's final pass. The 13.5-a-year decision rate is the operating cost of this design, stated in the PR body so it is chosen rather than discovered.

## 6. Out of scope, and the follow-ups it leaves

### 6.1 The baseline review (separate follow-up, the owner's choice)

The gate freezes today's lists as the reference, and the measurement found defects already in them. Each was verified upstream on 2026-09-23/24:

- **CY** `["Greek", "Modern Greek", "Turkish"]` names one language twice. Q644636, "Cyprus — island in the Eastern Basin of the Mediterranean Sea", carries `P297 = CY` at normal rank beside the country item Q229, so the query unions the island's Greek (Q9129) with the country's Modern Greek (Q36510).
- **KP** `["Korean", "North Korean standard language"]`, the same duplication Norway's Bokmål and Nynorsk once caused.
- **Relabels that read badly:**
  - **IQ** "Kurdish language" (§1.1);
  - **GI and FK** "British English" — statement swaps Q1860 → Q7979 on 2026-06-16 and 07-17, which give "Offline British English translation pack";
  - **CN** "Putonghua" — Q24841726 replaced Standard Chinese on 2025-05-04.
- **KG** `["Kyrgyz"]`: Russian was removed 2025-01-20; Kyrgyzstan's constitution makes it an official language.
- **AG** gained Spanish on 2026-08-16. It is sourced — Antigua Newsroom, 2026-05-14, "Cabinet Approves Spanish as Antigua and Barbuda's Official Second Language" — so it is plausibly right; it is listed because nobody reviewed it.
- **MW** gained Tumbuka on 2025-09-20.
- **Sign languages are inconsistent.** `CURATED_FACTS`' AZ row excludes Azerbaijani Sign Language as "not the language a traveller needs a phrasebook for", while AT, KR, NZ, PG, TW, VE, ZA and ZW publish theirs. For AT, KR and VE that turns one language into two and silently removes the translation-pack packing line.

The follow-up adds the two refusal shapes §2.5 lacks — a hand-verified display name by Q-id, and a restored statement — under the same fires-or-stale rules as the existing tables. The owner decides each item. Every fix changes a published list, so each PR regenerates the artifact through §2.4.

### 6.2 Wikimedia User-Agent policy (filed separately)

While measuring, both `query.wikidata.org` and `www.wikidata.org` answered this machine with HTTP 403 "Please respect our robot policy" for the repo's shared UA `ChinaItineraryPlanner/1.0 (personal project)`, and 200 for one carrying a contact URL (`scripts/build-provinces.mjs`'s form). GitHub's runners still get answers — last night's run did. If the policy reaches them, the fatal `codes` query fails and the whole refresh goes red. It was filed as its own task; it is not this change.

### 6.3 Plugs and emergency numbers

They are multi-valued too, and a count cannot see a swap in them either. No incident, no measurement and no request, so not here.

### 6.4 When to revisit quarantine

If language red nights run well above the measured ~2 a month in practice, or a refresh held for a language dispute ever costs something real, quarantine (§3) can be layered onto this check without changing what it detects.

## Appendix A — the 45 measured changes

Night = the first 13:30 UTC snapshot that could see the edit. "Healed" = upstream restored the previous list on its own.

**Statement edits (30).**

| Night | Code | Change | |
|---|---|---|---|
| 2024-11-17 | RE | −Reunionese Creole | |
| 2024-12-14 | PM | −Basque | |
| 2025-01-20 | KG | −Russian | |
| 2025-01-22 | MX | −languages of Mexico | |
| 2025-03-03 | SJ | −Norwegian (withdrawn) | healed after 18 d |
| 2025-03-21 | SJ | +Norwegian (appeared) | the heal |
| 2025-04-14 | NE | −French +Hausa | same count |
| 2025-05-04 | CN | −Standard Chinese −Chinese −languages of China +Putonghua | |
| 2025-05-23 | PW | −English −Palauan −Japanese (withdrawn: scoped) | |
| 2025-09-10 | SS | −Arabic | |
| 2025-09-20 | MW | +Tumbuka | |
| 2025-10-03 | RW | −Swahili | healed after 1 d |
| 2025-10-04 | RW | +Swahili | the heal |
| 2025-10-28 | TJ | −Russian | |
| 2025-12-23 | KZ | −Russian | healed after 3 d |
| 2025-12-26 | KZ | +Russian | the heal |
| 2025-12-28 | VA | −French | |
| 2026-01-21 | UY | −Spanish (withdrawn) | |
| 2026-04-01 | FI | +Sámi | healed after 23 d |
| 2026-04-23 | US | −English (withdrawn: deprecated, only scoped statements remain) | |
| 2026-04-24 | FI | −Sámi | the heal |
| 2026-05-16 | PT | −Mirandese | |
| 2026-06-16 | GI | −English +British English | same count |
| 2026-06-20 | GR | −Demotic Greek −Modern Greek | |
| 2026-06-20 | GE | −Abkhaz | |
| 2026-07-05 | EH | +Arabic (appeared) | |
| 2026-07-17 | FK | −English +British English | same count |
| 2026-07-25 | AU | −Auslan −Australian English +English | |
| 2026-08-17 | AG | +Spanish | |
| 2026-09-14 | MR | +French | refused, PR #33 |

**Label edits (15, reaching 20 country lists).**

| Night | Item | Change | Countries | |
|---|---|---|---|---|
| 2024-12-10 | Q1740805 | Quichua → Northern Quichua | EC | |
| 2024-12-18 | Q32656 | Maldivian → Divehi | MV | healed after 445 d |
| 2024-12-24 | Q727694 | Standard Mandarin → Standard Chinese | CN, HK, MO, SG | |
| 2025-09-21 | Q9260 | Tajik → Tajik language | TJ | healed after 50 d |
| 2025-09-22 | Q256 | Turkish → Turkish language | CY, TR | healed after 2 d |
| 2025-09-24 | Q256 | Turkish language → Turkish | CY, TR | the heal |
| 2025-11-10 | Q9260 | Tajik language → Tajik | TJ | the heal |
| 2025-11-15 | Q7598268 | Standard Moroccan Amazigh → Standard Moroccan Tamazight | MA | |
| 2025-12-21 | Q61055662 | O-ku-uā → Wuqiu dialect | TW | |
| 2026-03-08 | Q32656 | Divehi → Maldivian | MV | the heal |
| 2026-03-08 | Q9610 | Bangla → Bengali | BD | healed after 10 d |
| 2026-03-18 | Q9610 | Bengali → Bangla | BD | the heal |
| 2026-06-13 | Q13300 | Nahuatl → nahuatl | MX | healed after 55 d |
| 2026-08-07 | Q13300 | nahuatl → Nahuatl | MX | the heal |
| 2026-09-08 | Q36368 | Kurdish → Kurdish language | IQ | shipped (§1.1) |

Not counted: Q24841726's `Putonghua → Putonghua （Mandarin）` and back (2024-10-01/02), published nowhere at the time (CN adopted the item on 2025-05-04); Amharic and Persian on 2026-03-05, the `mul` migration.
