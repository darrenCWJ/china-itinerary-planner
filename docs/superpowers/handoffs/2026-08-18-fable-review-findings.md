# Fable full-PR2 review — findings after re-review

**Date:** 2026-08-18
**Branch:** `redesign/planner-shell` at `2881aee`
**Scope:** the whole of PR2 (Tasks 1-33) against spec and plan — not the recent diff
**Status:** six confirmed, **all six now fixed** (§5). A corrected second pass then
verified all 31 findings rather than the top 9 — 20 remained open (§6), of which
**both highs are now closed** (§7). **18 remain open: 12 medium, 6 low.**

This is the §5g review. Six Fable lenses (spec conformance, cross-step drift,
contract scans, state correctness, a11y/surface, write boundary) produced 31 raw
findings; the top 9 by severity went through an adversarial refuter; every
survivor was then re-verified by hand in this session. That last pass is what
this document records — the workflow's own numbers are in §4.

**Every one of the six is cross-step drift**, which is exactly what the review
existed to find: each is invisible if you only look at the step that introduced
it, because the contradiction lives between two tasks.

---

## 1. Confirmed, re-verified

### H1 — Failed day-builder ops leave phantom edits on screen
`components/plan/useDayBuilder.ts:84` · Task 22 reducer ↔ Task 23 wiring

The reducer implements a `force` channel; the wiring never populates it, and the
accessor exposes no way to. Three facts compound:

- `applyPayload` drops a payload when `!force && baselineVersion >= payload.version`
  (`lib/dayBuilder.ts:259-261`).
- The hook dispatches `serverPayload` with **no** force (`useDayBuilder.ts:83-85`).
- `opFailed` deliberately does not unwind the optimistic patch, on the stated
  ground that "the hook force-refetches on failure … and that payload is the
  truth" (`lib/dayBuilder.ts:491-493`).

That comment is load-bearing and false. A rejected op writes nothing, so the
forced refetch returns the **same** version, and the unforced dispatch is dropped
by the `>=` rule. The network path is worse: `mutate`'s catch returns a string
with no refetch at all (`lib/useTripPayload.ts:144-146`).

Net effect: a timing or reorder edit renders as saved, never was, and on a
single-member trip nothing ever bumps the version to heal it. The Days view,
rendering the untouched payload, shows the pre-edit plan at the same time — a
torn view between two toggles of one tab.

The invariants doc forbids this on three separate entries
(`force-survives-the-buffer`, `pending-ops-need-settle-and-fail-actions`,
`rejection-reaches-the-reducer-explicitly`). Tests are green only because
rejection is exercised solely through `addFromShelf`, the one op with no
optimistic days patch.

**Re-verified:** by code read of all four sites. ⚠ **Not reproduced in a
browser** — it needs a forced failure, which I did not stage.

**Fix:** thread forced-ness through to the dispatch; add `refetch(true)` to
`mutate`'s catch; and unwind the optimistic patch in `opFailed` as belt-and-braces.

---

### H2 — Pending ops POST concurrently, against the module's own contract
`components/plan/useDayBuilder.ts:91` · docblock ↔ implementation

The send effect picks `pendingOps.find(p => !inFlight.current.has(p.id))` and
never checks whether anything is already in flight, so a second op can be POSTed
while the first is outstanding. The module's docblock (lines 17-19) promises
"send one pending op at a time."

**Re-verified empirically — and the finding's stated trigger is wrong.**

- Two `+15m` taps **in the same React batch** are safe: both dispatches land in
  one render, the effect runs once, and the ops go out strictly sequentially
  (measured: op1 120292→120317, op2 started 120324).
- The race needs the second tap in a **separate render while the first is still
  in flight** — roughly 5-30ms later. Measured with a 6ms gap: op1 158710→158740,
  op2 started **158715**. Genuinely concurrent.

So "member taps +15m twice" overstates it; a fast double-tap or key-repeat is the
real trigger. **The corruption itself I did not reproduce** — in my run op2 landed
last and won, giving the right answer. The wrong-value path (op1 409s, the route's
CAS-retry re-applies its stale absolute value on top of op2) is real code
(`app/api/trips/[id]/plan/route.ts:44-66`) but unobserved.

Downgraded accordingly: **confirmed contract violation, plausible-but-unproven
corruption.**

**Fix:** one line — bail when `inFlight.current.size > 0`, so the effect drains
serially as each op settles. That also makes the docblock true.

---

### H3 — Active rail tab is white on `--accent-fill`: 2.60:1, fails AA
`components/shell/RailNav.tsx:102` · Task 3 rail ↔ Task 12 strip, and vs spec §4.2

Found independently by three of the six lenses.

**Re-verified by measurement in the running app**, resolving the tokens through
the browser's own colour engine:

| pairing | ratio |
|---|---|
| rail active — `--paper` on `--accent-fill` | **2.60:1** |
| the designed pairing — `--ink-0` on `--accent-fill` | 5.86:1 |
| mobile strip active — white on `--accent-ink` | 6.23:1 |

The 11px label needs 4.5:1; the icon needs 3:1. It fails both. Spec §4.2's table
(design doc line 208) defines `--accent-fill` as "accent **as fill** behind dark
ink", and the prose at lines 200-201 exists precisely to record that this
lightness behind light ink fails. Spec §9 requires AA.

The drift is the sharp part: the mobile strip renders the **same** `TRIP_NAV`
active state correctly at 6.23:1 (`components/TripView.tsx:235`). Two tasks
styled one role incompatibly, and the failing one is on the primary navigation of
every desktop trip page — in the only theme PR2 ships. Under the dark ramp the
pairing would read fine, which is why it survived review.

**Fix:** one line — `color: "var(--ink-0)"` on the active state.

---

### H4 — Plan tab's Route view is still the Task 8 placeholder
`components/trip/PlanTab.tsx:137` · ownership gap between Tasks 8, 29 and 30

**Not a new finding** — handoff §5f already lists it as fix-before-merge item 2.
Re-verified as still open at `2881aee`: the `view === "map"` branch renders the
dashed stub ("The map view arrives with the country map. Use Days for now."), and
the "🗺️ Route" toggle is offered to every member *and* guest, so the dead end is
one click from the primary tab of every trip.

Spec §2.1 justified removing Route from the nav by making it "a map ⇄ list toggle
*inside* Plan". CountryMap landed in Task 29, but that task's file list never
included PlanTab and Task 30 turned out to be hero-selection logic — no task ever
owned the wiring. `git log -- components/trip/PlanTab.tsx` ends at the token
sweep, so none of the remediation commits touched it.

Not a regression: `main`'s trip page never had a Route tab. It is an unshipped
spec surface plus a visible dead-end control.

**Fix:** render CountryMap in that branch, read-only, fed from the plan's
destinations. If it cannot land now, hide the toggle and record that as a
decision — leaving the stub is the one option that is neither.

---

### H5 — Keyboard path drops focus to `<body>` after almost every builder operation
`components/plan/DayBuilder.tsx:428` · Task 16 ↔ Task 24

**Re-verified empirically in the browser**, two of the three mechanisms:

- Focused the shelf `+`, activated it → the row unmounted (`queue` → `withShelf`
  hides the in-flight key, `lib/dayBuilder.ts:181-187, 225-227`) and
  `document.activeElement` became **`BODY`**. Adding five activities means
  re-tabbing from the top of the page five times.
- Focused "Move Summer Palace up", pressed it until the block reached index 0 →
  `disabled={isFirst}` (`DayBuilder.tsx:581`) applied to the button under focus →
  `document.activeElement` became **`BODY`**.
- The third, "Set a time"/"Untime" swapping the focused control out of the tree
  (`DayBuilder.tsx:543-576`), is the same structure and confirmed by code read.

Each single action works; every *sequence* strands the user. This is the
accessible equivalent of drag that spec §3.2.5 mandates, and Task 24's own gate —
a keyboard-only walkthrough — was never run. Task 16 solved this exact problem
deliberately in `PlaceSearch.tsx:141-143` ("Focus is never surrendered: the whole
point of this input is that a user can add five places without touching the
mouse") and pinned it in tests; Task 24 rebuilt add-from-a-list without it.

**Fix:** port PlaceSearch's pattern to the three sites and pin it the same way.

---

### M1 — C4's TripView pin uses the substring match its own block proves wrong
`lib/contracts.test.ts:151` · two definitions of "calls fetch" in one contract

`expect(view!.text.includes("fetch(")).toBe(false)` — the loose form the same
describe block documents as a verified false positive at lines 123-131
(`"void refetch(true)".includes("fetch(")` is true), and which `callsFetch`
(`/\bfetch\s*\(/`, line 132) was rebuilt to avoid. It also runs on `.text` (raw)
rather than `.code` (comment-stripped), which `fetchesTripData` uses — so a
comment can fail it too.

TripView passes today by one character: its docblock says "is not a fetch."
with no parenthesis. The moment it adds the `refetch(true)` retry the accessor
*prescribes* as the failure path, CI goes red on compliant code — and the likely
remediation is deleting the pin, eroding C4's one sanctioned-pattern guard.

This is the §5e class exactly: a scan whose gap reads as a guarantee, which is
worse than a defect.

**Fix:** one line — `expect(callsFetch(view!.code)).toBe(false)`.

---

## 2. Unverified — 22 findings nobody refuted or confirmed

The workflow capped verification at 9, so 22 lower-ranked findings went forward
unproven. **They are not endorsed.** Four look most worth a pass:

- `lib/server/pgStore.ts:321` — pg `updateTripDataIf`'s guard and version bump are
  two autocommit statements, so ops can be lost under concurrency. Pre-PR2 code,
  but H2's sender makes concurrent plan POSTs routine. **Only bites on the pg
  path**, which memory records as inspection-verified only.
- `lib/contracts.test.ts:204` — C1's label scan sees only quote-delimited labels,
  so JSX text children evade all three tests.
- `lib/server/schemas.ts:144` — a half-timed pair may still be storable via
  `addItem`/`updateItem` despite the hole being reported closed; the invariants
  doc flagged the `addItem` twin.
- `lib/server/catalog.ts:138` — merged search folds apostrophes client-side but
  `searchCities` does not, so Xi'an-class cities stay unfindable through the
  server leg. This is the same bug class §5d fixed in `lib/placeSearch.ts`; if
  real, the fix there was half a fix.

The remaining 18 are in the workflow output
(`tasks/wt9jupzyr.output`), mostly medium/low: C2 blind to Tailwind v4 var
shorthand, §4.3's per-country hue override having no UI, `Country.mark` consumed
nowhere, CountryMap's `role="img"` over descendant buttons, MapExplorer controls
below the C5 44px token, missing live regions on add-day errors.

---

## 3. What this review could not see

- **Anything needing a forced failure.** H1 is a code-read confirmation; nobody
  staged a 401/503/network drop against a live builder.
- **The pg path.** Every runtime check in this session ran on sqlite.
- **Dark theme.** Unreachable until PR3 Task 37, so H3's dark-ramp behaviour and
  every other two-theme claim are arithmetic, not observation.
- **Real assistive tech.** H5 is `document.activeElement` evidence; no screen
  reader was run.
- **The 22 unverified**, above.

---

## 4. Process note — the refutation round did not refute

**0 of 9 findings were refuted**, which is itself a signal worth recording, given
§5g's standing claim that the refutation round "has repeatedly killed
confident-sounding findings that were wrong". Two contributing faults, both in
how the workflow was written rather than in the reviewers:

- **The dedupe key was too strict.** It included a title stem, and the six lenses
  phrased the same defect differently — so the rail contrast finding consumed
  three of the nine verify slots and the force-channel finding consumed two. Nine
  verifications bought six distinct answers. Key on file plus a line window only.
- **The cap was too low for the yield.** 31 findings against a 9-slot budget left
  22 unexamined, including the pg lost-update candidate that outranks two of the
  confirmed six on blast radius.

The hand re-review in §1 is what actually caught something: H2's trigger as
written does not reproduce, because React batches same-turn taps. The refuter
accepted the failure narrative without running it.

---

## 5. Resolution — all six fixed (2026-08-18)

801 tests across 56 files, tsc clean, production build clean.

| | Fix | Commit |
|---|---|---|
| H1 | `opFailed` restores the days the op was queued against; later-queued ops drop with it; the accessor gained a `forcedAt` counter so a forced reconciliation reaches the reducer even at the same version | `33b5d9f` |
| H2 | The send effect holds until the in-flight op settles and takes the queue head, so ops go out FIFO | `fa42bd9` |
| H3 | Active rail tab draws in `--ink-0` (5.82:1 worst case across all hues) instead of `--paper` (2.62:1 best) | `5f55195` |
| H4 | `RouteMap` renders `CountryMap` read-only over the plan's stops in day order | `28beb05` |
| H5 | A `FocusPlan` names where focus goes after each self-destroying control | `de199d4` |
| M1 | The pin uses `callsFetch(view!.code)`, the predicate defined 19 lines above it | `eae52bc` |

Three things worth carrying forward, all found while fixing rather than while
reviewing:

- **H1's rollback tests had to use a timing op, not `addFromShelf`.** An add
  queues without patching `days` — the item appears only when the payload lands
  — so it is the one action with nothing to unwind. It was also the only action
  the pre-existing rejection test used, which is precisely how the phantom-edit
  bug stayed behind a green suite.
- **`refetch` never caught network errors**, and every caller is
  `void refetch(…)` including the 4s poll — so any blip was already an unhandled
  rejection. Pre-existing; surfaced because H1's fix calls it from `mutate`'s
  catch. Fixed in the same commit.
- **H2's real trigger is narrower than reported.** Two taps in one React batch
  were always safe: one render, one effect run, one POST. Only a tap that gets
  its own render while a request is open races, so the new tests stagger their
  `act` calls deliberately. A test written to the finding's wording would have
  passed against the broken code.

## 6. Second pass — 31 findings verified, 20 still open

The first run capped verification at 9 and keyed dedupe on a title stem, so one
defect ate three verify slots and 22 findings went unexamined (§4). Re-run with
dedupe on `file:line` and no cap: **31 raw → 27 deduped → 24 confirmed, 3
refuted**.

⚠ **Two of those three refutations are artifacts, not refutations.** Both
refuters wrote that the technical claim was *correct*, then killed the finding
under the brief's "already recorded in the prior-findings document" rule —
against this very document, which was committed before the re-run. They are H1
and H2, both since fixed. Only the third is a real kill: the rail rendering
active tabs for guests and the private gate, which the refuter showed is J1 as
actually written ("the rail renders only when a trip context exists
(`/trip/[id]`)" — a route condition), documented in AppShell's docblock, and
tested. **Do not re-open it.**

Read that as: re-running a review after committing its own output teaches the
refuters to reject it. Either re-run before writing anything down, or drop the
prior-findings rule from the refuter brief.

### Still open — 12 medium, 6 low

Confirmed by a lens and survived refutation, but **not** re-verified by hand the
way §1's six were. Treat the severities as the reviewers' own.

**High — both closed 2026-08-21, see §7.**

**Medium** — five more contract-scan gaps (`:204` C1 blind to JSX text children,
`:39` `stripComments` blanking string literals so a URL's `//` hides trip paths,
`:294` C3 blind on a directory split, `:169` C4's allowlist keying on the path
string rather than on fetching, `:20` the collector never seeing repo-root
files); `lib/server/schemas.ts:144` a half-timed pair still storable via
`addItem`/`updateItem`; `lib/server/catalog.ts:138` the catalog leg not folding
apostrophes, so Xi'an-class cities stay unfindable through the server path (the
same bug §5d fixed client-side — if real, that fix was half a fix);
`ThemeToggle.tsx:91`/`:104` spec §4.3's per-country hue override shipped with no
UI and no TODO; `TripView.tsx:203` the 同行 chop hardcoded while `Country.mark`
is consumed nowhere; `CountryMap.tsx:241` `role="img"` over descendant buttons,
the pattern WorldMap's own docblock calls wrong; `MapExplorer.tsx:299` controls
below the C5 44px token their siblings apply; `PlanTab.tsx:192` add-day and
wizard-resolve failures with no live region.

**Low** — `DayBuilder.tsx:521` spec §5.3's slot lanes dropped with no recorded
decision; `:171` unmounting the builder silently discards queued-but-unsent ops;
`:383` target-day chips with no visible focus ring; `lib/nav.ts:34` Kit's
accessible name omitting its visible label (label-in-name); `lib/redactTrip.ts:15`
the guest header's day count reading `input.days`, which disagrees with the plan
after an `addDay`.

Full text, including each refuter's reasoning, is in the workflow output at
`tasks/wi2gxfruv.output`.

---

## 7. Both highs closed (2026-08-21)

Each was hand-verified by code read first — §6's findings had only a lens and a
refuter behind them — then fixed test-first, with the test run against the
unfixed code and confirmed red for the stated reason. 803/803, tsc and build
clean.

### H7 — `updateTripDataIf` lost updates on the pg path — **fixed**
`lib/server/pgStore.ts` · confirmed, then fixed

Verified by reading the function against its sibling. The guard and the bump
were two autocommit statements:

```
UPDATE trips SET data=…, name=… WHERE id=… AND version = $expected   -- guard
UPDATE trips SET version = version + 1, updated_at = …  WHERE id = …  -- touch()
```

Two writers that both read version 7 both clear the identical guard in the
window before either bump lands. The second overwrites the first, **both callers
are told `true`**, and one op is gone. `putWallet` in the same file has always
done it correctly — one statement that guards and bumps together — so the fix is
that shape, and `touch()` is dropped from this path (still used by 12 others).

**Second-order find:** the route's retry loop was near-dead on pg.
`app/api/trips/[id]/plan/route.ts:58` does `if (!written) continue;` and 409s
only after `MAX_WRITE_ATTEMPTS`, with a comment promising "nobody's edit is
silently overwritten by a stale snapshot" — but a guard that rarely fires never
triggers the retry. That comment was load-bearing and false on the pg path, the
same defect shape as H1. The fix makes the loop live: a conflict now genuinely
returns `false`, so the op is re-applied rather than lost.

**Test:** `lib/server/pgStore.test.ts` — new. There is no database here, so it
swaps the `postgres` tagged template cached on `globalThis.__cipSql` for a
recorder. That runs the real function body against the real driver shape and
fakes only the database, which is exactly right when the thing under test is
*statement boundaries*. Red before the fix with "expected 2 to have a length of
1". It also pins `updated_at`, which `touch()` used to carry.

⚠ **Not run against a live postgres.** The correctness argument is READ
COMMITTED's re-check of the WHERE after a row lock releases — standard, and the
same one `putWallet` already relies on. Still worth one pass on the live-pg
matrix memory already calls for.

⚠ **The sqlite path has the identical two-statement shape and was deliberately
left alone** (`lib/server/tripStore.ts:215`). better-sqlite3 is synchronous, so
the two statements cannot interleave inside one process and **no test can be made
to fail**. Writing the fix without a failing test would violate the standing TDD
rule. It becomes real only if a second process ever writes the same file.

### H8 — C2 blind to Tailwind v4 `var` and CSS `inset` shorthands — **fixed**
`lib/contracts.test.ts` · confirmed, then fixed

Verified by evading the predicate. `fixed bottom-(--safe-bottom)` and
`position: fixed; inset: auto 0 0 0` both pin the bottom edge and both walked
straight through — the offset alternation admitted only `\d+|\[|full|auto`, and
`inset-y-0` was matched as a literal for no stated reason.

Widened to three branches: any `bottom-` offset including `px` and the v4
`(--var)` shorthand, the same set for `inset-y-`, and the CSS declarations
`bottom:` / `inset:` / `inset-block:` / `inset-block-end:`.

**Verified by trying to evade it** — ten probes, six of them negative.
`inset-block-start` (top-only) and `inset-inline` / `inset-inline-end`
(horizontal) correctly stay false; `-bottom-4`, `-inset-y-2`, `[bottom:0]` and
`inset:0` correctly fire. No new offenders in the tree.

**Known-and-left:** `fixed inset-0` still reads as false. It does set
`bottom: 0`, but a full-screen overlay does not compete for the bottom edge the
way a second bottom bar does, and the existing suite asserts it deliberately.
Whole-file co-occurrence also still can't see `fixed` and `bottom-0` split
across two files — inherent to the scan's shape and already in its docblock.
