# Fable full-PR2 review — findings after re-review

**Date:** 2026-08-18
**Branch:** `redesign/planner-shell` at `2881aee`
**Scope:** the whole of PR2 (Tasks 1-33) against spec and plan — not the recent diff
**Status:** six confirmed, **all six now fixed** (§5). A corrected second pass then
verified all 31 findings rather than the top 9 — 20 remained open (§6), of which
**both highs are now closed** (§7), **all five contract-scan gaps** with them
(§8), and **the five a11y findings** after that (§9).
**§6 is empty** — every enumerated finding is closed or refuted (§10, §11).

⚠ The original tally does not add up, and never did. §6 says "2 high, 12
medium, 6 low" — 20 — but its **Low** paragraph names only five items, so 19 were
ever written down. One low was counted and never recorded; it is not recoverable
from this document. Going by the stated numbers the remainder is 8; going by what
is actually named, 7. The list below is the one to work from.

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

**Medium** — ~~five more contract-scan gaps~~ **all five closed 2026-08-21, see
§8** (`:204` C1 blind to JSX text children, `:39` `stripComments` blanking string
literals so a URL's `//` hides trip paths, `:294` C3 blind on a directory split,
`:169` C4's allowlist keying on the path string rather than on fetching, `:20`
the collector never seeing repo-root files); still open:
`lib/server/schemas.ts:144` a half-timed pair still storable via
`addItem`/`updateItem`; `lib/server/catalog.ts:138` the catalog leg not folding
apostrophes, so Xi'an-class cities stay unfindable through the server path (the
same bug §5d fixed client-side — if real, that fix was half a fix);
`ThemeToggle.tsx:91`/`:104` spec §4.3's per-country hue override shipped with no
UI and no TODO; `TripView.tsx:203` the 同行 chop hardcoded while `Country.mark`
is consumed nowhere. ~~`CountryMap.tsx:241` `role="img"`, `MapExplorer.tsx:299`
tap targets, `PlanTab.tsx:192` no live region~~ **— all three closed 2026-08-21,
see §9.**

**Low** — `DayBuilder.tsx:521` spec §5.3's slot lanes dropped with no recorded
decision; `:171` unmounting the builder silently discards queued-but-unsent ops;
~~`:383` target-day chips with no visible focus ring; `lib/nav.ts:34` Kit's
accessible name omitting its visible label~~ **— both closed 2026-08-21, see
§9**; `lib/redactTrip.ts:15`
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

---

## 8. All five contract-scan gaps closed (2026-08-21)

The largest single cluster in §6, and the one worth taking together: a scan with
a gap reads as a guarantee, and these five were the guarantees PR3 was going to
lean on. Each was hand-verified first, then driven red — six failing tests, each
for its own stated reason — then fixed. 810/810, tsc and build clean.

### The five

**M2 — `stripComments` could not tell a comment from a URL.** The sharpest of
them, because nobody has to be evading anything: `fetch("https://host/api/trips/1")`
was blanked from the `//` in `https://` onward, so the trip path vanished from
`code` and **C4 never saw the call**. Replaced the two regexes with a hand-walked
scanner that tracks string state. Single and double quotes reset at a newline,
matching JS — an unterminated one is an apostrophe in JSX text, not a string, and
letting it run would swallow every comment after it.

**M3 — the collector stopped at four directories.** `ROOTS` never included the
repo root, so `proxy.ts` and `instrumentation.ts` — both of which run on every
request and can fetch a trip payload as readily as anything under `app/` — were
outside every contract. Now walked one level deep at the root (not recursively:
`node_modules` and `.next` are there too). `.d.ts` is excluded for having no
runtime code to constrain.

**M4 — C1 counted only quoted labels.** A second hardcoded tab list written as
JSX children — `<span>Plan</span>` — carries no quoted label at all, so the whole
thing counted as zero. Now counts `>Label<` as well. Also switched both C1
helpers onto comment-stripped source: a **commented-out** nav import used to
grant the exemption, which is the fail-silent direction.

**M5 — C4's allowlist honesty check keyed on the wrong thing.** The entry exempts
a file from `fetchesTripData`, but the check asked only whether the raw text
still contained a trip path. An entry could survive on a leftover comment long
after the fetch it excused was deleted, silently licensing the next real
violation in that file. It now calls `fetchesTripData` itself — one contract, one
definition, the rule `callsFetch` already states.

**M6 — C3 was blind to a directory split.** `isCore` admitted `dayBuilder.ts` and
`dayBuilder/index.ts` and nothing beside the index: split the core into
`reducer.ts` and `ops.ts` and the contract silently stopped applying to the parts
holding the logic while still reporting a pass. Now any `.ts`/`.tsx` under
`lib/dayBuilder/`, still excluding `use`-prefixed names, which are the hook's
separate rule.

**Also closes handoff §5f item 5.** The C3 silent-skip hazard is gone: `it.skipIf`
remains, but a separate hard test now asserts `lib/dayBuilder.ts` is among the
matched builders, so a pattern that stops matching fails instead of reporting a
permanent green skip.

### Verified by trying to evade it

The scanner is the risky change — every contract depends on it — so it was probed
past its tests:

- **Nine unit probes**, all passing: protocol-relative `//cdn/…`, an escaped
  quote wrapping a `//`, a template literal holding a trip path, an apostrophe in
  JSX text followed by a real comment, a comment containing an apostrophe, and a
  `/*` inside a block comment.
- **145 files walked**: zero runaway quotes, so no file in the tree has an
  unterminated template or apostrophe that swallows the rest of it.
- **No file is blanked more than the old version was.** That is the one that
  matters: the change can only have made the contracts see *more* source, never
  less, so it cannot have opened a hole while closing one.
- The widened C1 count was checked against the whole tree: only `lib/nav.ts`
  (excluded by path, count 4) and `TrackerTab.tsx` (count 1 — a lone `<p>Today</p>`
  heading, below the two-label threshold) register at all. No false positive.

### Known-and-left

A regex literal ending in `\//` would still trip the line-comment branch and
blank the rest of that line. It is the one residual case, it exists in no file
here, and closing it needs regex-vs-division disambiguation — a real parser,
which is more than a grep-shaped contract is worth.

---

## 9. The a11y sweep — five findings closed (2026-08-21)

Three mediums and two lows, taken as one pass because they share a surface and a
review lens. Each hand-verified first, then driven red — eight failing tests —
then fixed. 818/818, tsc and build clean.

### M7 — CountryMap's `role="img"` hides every control inside it
`components/map/CountryMap.tsx`

The `<svg>` carried `role="img"`, which makes its whole subtree presentational:
every province zoom control (`role="button"`) and every place toggle
(`role="button" tabIndex={0} aria-pressed`) is removed from the accessibility
tree. They stay *focusable*, so a keyboard user tabs onto controls a screen
reader announces as nothing — worse than either half alone.

WorldMap had already reached the opposite conclusion and said so in its own
docblock: "A group, not an image: `role='img'` would drop every country button."
Same role, two components, incompatible decisions — the H3 pattern exactly. Now
`role="group"`, matching WorldMap.

⚠ **Three existing tests pinned `role="img"`** and had to be repointed. Two of
them were `queryByRole("img")` asserting *no map is drawn*; left alone they would
have kept passing while asserting nothing, since nothing renders that role any
more. They are now `queryByRole("group")` and mean something again.

The new test asserts the container's role rather than going through the buttons,
and says why: testing-library does not implement ARIA's presentational-children
rule, so `getByRole("button")` finds them either way. The browser is where this
bites, so the role is the honest thing to pin.

### M8 — MapExplorer's own controls miss the C5 tap target
`components/map/MapExplorer.tsx`

Three buttons written with `py-1`/`py-1.5` instead of `min-h-[var(--tap-min)]`,
landing near 24px against the token's 44px — while roughly thirty components
across the tree apply it. The three are the back-out, the zoom-out and the
retry: each is the only way out of the state it appears in, so they are the worst
ones to make hard to hit. WorldMap's country dots stay exempt, as its docblock
records.

### M9 — a failed add-day was silent to a screen reader
`components/trip/PlanTab.tsx`

`addDayError` rendered as a bare `<span>`, conditionally. No role, no live
region: the only signal that an edit did not land was red text appearing. Now
`role="status" aria-live="polite"`, and **rendered unconditionally** — a live
region created in the same tick as its first content is unreliably announced, so
the region has to already be in the tree for the insertion to register.

⚠ **The finding named "add-day and wizard-resolve failures"; only add-day
exists.** PlanTab has exactly one error surface (`addDayError`) — there is no
wizard-resolve path in this component. Half the finding was wrong.

### L1 — target-day chips had no focus indicator at all
`components/plan/DayBuilder.tsx`

The chip is a `<label>` wrapping an `sr-only` radio, so focus lands on something
invisible and nothing renders a ring: not a weak indicator, none (WCAG 2.4.7).
Fixed with `has-[:focus-visible]:outline-…` on the label.

### L2 — Kit's accessible name omits its visible label
`lib/nav.ts`

`label: "Kit"` against `ariaLabel: "Bookings and packing"` — a speech-input user
saying "click Kit" addresses a control whose name does not contain "Kit" (WCAG
2.5.3 Label in Name). The other three satisfied it by accident. Now
`"Kit — bookings and packing"`, and the rule is a test over all four rather than
a property three of them happened to have.

### A sixth scan gap, found by the fix

`lib/tokens.test.ts`'s "emits a rule for every arbitrary colour utility" check
failed on the focus-ring fix — reporting `outline-[var(--accent-ink)]` as never
emitted. **It was emitted.** The extraction regex's variant pattern admitted only
bare words (`focus-visible:`, `hover:`), so against the tree's first *bracketed*
variant — `has-[:focus-visible]:` — it captured the tail alone and looked up a
rule Tailwind never emits under that name.

Diagnosed by reading the built CSS rather than trusting the failure: all three
rules are there, `--tw-outline-style: solid` included. The variant pattern now
carries an optional `-[…]`, which is what every `has-[…]:`, `data-[…]:`,
`group-has-[…]:` and `@[…]:` utility needs. Swept the tree afterwards: this is
still its only bracketed variant, so the gap was hiding nothing else.

Worth recording as its own lesson — **the test that catches your fix may be
wrong about why.** Verifying against the build output before touching the check
is what separated "the utility is dead" from "the extraction is incomplete", and
the first reading would have sent the fix in the wrong direction.

---

## 10. Catalog folding closed (2026-08-21)

`lib/server/catalog.ts:138` — confirmed, and the finding's guess that "if real,
that fix was half a fix" was right. §5d added `norm` to `placeSearch` and
stopped; `searchCities` still compared raw lowercase, so the client and server
legs answered differently and `/api/destinations` got the broken half.

**It bites real data:** 23 of the 695 catalog cities carry an apostrophe (Xi'an,
Tai'an, Yan'an, Ma'anshan, Lu'an, Ya'an, Pu'er City …) and two carry diacritics
(Ürümqi, Lüliang). "taian" and "urumqi" returned nothing.

The fold now lives in `lib/foldPlaceName.ts` and both legs import it. Two extra
call sites were wrong the same way: `CURATED_NAMES` built its exclusion set with
`toLowerCase`, and both `searchCities` and `mapCities` tested membership that
way — a catalog entry spelled with a curly apostrophe would not have been
excluded by the curated straight-quote one and would have appeared twice.

`searchCities` had no test. It has one now, against a fixture reached through a
`CIP_CATALOG_PATH` override mirroring `CIP_DB_PATH`.

⚠ **The first red was for the wrong reason** — without the override the test read
the real catalog, so it failed on data rather than on folding. Re-checked by
reverting the fold with the fixture in place: 3 of 4 go red. Worth repeating as
the standing lesson: a red is not automatically the right red.

**6 findings remain enumerated: 3 medium, 3 low.**

---

## 11. The last of §6 (2026-08-21)

`831 → 833` tests, tsc and build clean. Five more closed, one **refuted**.

- **Timing pair on every op** (`schemas.ts:144`). The agreement rule guarded
  `setTiming` only, so `addItem` stored a half pair directly and `updateItem`
  accepted one half against an explicit clear. Enforced in two places because
  the two are knowable in different places: the schema for what the op alone
  decides, `planOps` for the state-dependent case, gated on the op actually
  touching timing so legacy half data can still be renamed.
- **Day count from the plan** (`redactTrip.ts:15`). And the member header had it
  too, thirty lines below a line already doing it right. The existing test
  pinned the bug — fixture asks for 3 days against a 1-day plan and asserted 3.
  It now asserts `days === planDays.length`.
- **The builder's queue survives a view change** (`DayBuilder.tsx:171`). PlanTab
  unmounted the builder on a view switch, taking `pendingOps` with it. Now
  mounted-once-opened and `hidden`, so the send effect drains while the subtree
  leaves the a11y tree and tab order.
- **The chop is the country's** (`TripView.tsx:203`). `Country.mark` had been
  threaded through the profile and read by nobody, so a Japan trip wore 同行.
  Needed `country` on `GuestTripPayload`, which the guest header's own docblock
  had deferred as "a server change outside this task's file set" — while naming
  the exact hazard it caused.
- **Per-country hue override** (`ThemeToggle.tsx:91`). Real: spec §4.3 layer 1
  is per-user *per-country* and what ships is per-user global. **Recorded rather
  than built** — this menu is app-wide and not trip-scoped, so the override needs
  a surface that can name a country, which is a design question the spec does
  not answer. Layers 2 and 3 are live, so every country still gets a sensible
  hue. The finding was that nothing was written down; now something is.

### Refuted — do not re-open

**`DayBuilder.tsx:521` — "spec §5.3's slot lanes dropped with no recorded
decision" is wrong on all three counts.** The band is implemented
(`DayBuilder.tsx:603-607`), carries the spec reference in a comment beside it
("Untimed items keep their slot band — spec §5.3 forbids inventing a start"),
and is tested (`DayBuilder.test.tsx:266`, "shows the slot band for an untimed
item rather than a made-up clock"). Nothing was dropped.

That is the third finding from this review to be wrong on inspection, after the
"wizard-resolve failures" half of the live-region finding and the two refutation
artifacts in §6. **Every §6 finding was confirmed by a lens and survived a
refuter, and roughly one in six still did not hold.** Hand-verify before fixing.

**§6 is now empty.**

---

## 12. Why PR #6's Vercel check is red (2026-08-21) — ⚠ WRONG, SEE §13

> **This diagnosis is incorrect.** Kept as written because the reasoning is
> instructive, not because it is right. The real cause is in §13.

**Not the branch.** The Preview environment has no `BETTER_AUTH_SECRET`, and the
fail-closed wall refuses to start without one — which is the guard working
exactly as designed.

### The evidence

| | |
|---|---|
| `335915e` **Preview**, 2026-08-15 | **success** — before the wall existed |
| `0d35d20` / `1fefde2` on main, 2026-08-17 | "refuse to boot / refuse every request without a usable secret" |
| `316b80c` "merge: bring the fail-closed wall into the redesign branch" | **first branch build, first failure** |
| every Preview since | failure |
| every **Production** deploy from main | success |

The comparison that looked like "main works, branch is broken" was
**Production against Preview**. Main has never had a Preview build since the wall
landed, and the branch has never had a Production one. Apples to oranges — that
was the wrong conclusion, drawn before the environment column was read.

`.env.example` states the mechanism in its own words: "On a deployment a blank or
example value refuses to start (see instrumentation.ts), because an absent secret
also disables the login wall and would serve every page publicly."

### Ruled out along the way

All tested locally, all clean: case-sensitive imports (209 files scanned, zero
mismatches), imports of uncommitted files, unresolved imports, deployment payload
size (3.4 MB tracked), Next version and every build config file (identical to
main), `package.json` scripts (identical — only four devDependencies differ), the
lockfile (in sync; none of the 62 added packages has an install script or an
os/cpu lock), and the build under `VERCEL=1 VERCEL_ENV=preview CI=1` with a
missing secret *and* an unreachable `DATABASE_URL`. It passes every time.

### The fix, which needs a human

**Vercel → Settings → Environment Variables → add `BETTER_AUTH_SECRET` scoped to
Preview**, with a value different from production:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then redeploy — env vars are read at build. An agent cannot do this: it is a
secret, and handling secrets is out of bounds.

**Do not weaken the guard to make previews boot.** A preview serving the whole
site publicly is the same leak the wall exists to prevent. The gap is
provisioning, not policy.

### Why it went unnoticed for three days

Vercel builds every branch push, but a failing Preview only becomes *visible* as
a PR check, and no PR was open until 2026-08-21. Nothing else surfaces it. The
Vercel MCP available here 401s on this team's deployment endpoints and the CLI is
not installed, so the build log was never readable — the diagnosis is entirely
from deployment metadata and local reproduction.

---

## 13. §12 was wrong — the real cause, and it is worse (2026-08-21)

**The build log settled it, and it was not the Preview secret.** The project's
Install Command had been overridden in the Vercel dashboard to:

```
curl -sL https://codeload.github.com/darrenCWJ/china-itinerary-planner/tar.gz/refs/heads/main \
  | tar -xz --strip-components=1 && npm install --no-audit --no-fund
```

It downloads **main** as a tarball and extracts it over the branch Vercel has
just cloned. `tar -xz` overwrites but never deletes, so every non-main build was
a chimera — branch-only files survived, and every file that also exists on main
was silently replaced by main's copy:

| file | on main? | outcome |
|---|---|---|
| `app/api/me/prefs/route.ts` | no | survived |
| `lib/server/schemas.ts` | yes | replaced — no `PrefsSchema` |
| `lib/server/store.ts` | yes | replaced — no `getUserPrefs` / `setUserPrefs` |

Hence three `Export … doesn't exist in target module` errors against a route
whose imports are perfectly valid on the branch. The log's `removed 2 packages`
is the same cause from the other side: npm ran against **main's** `package.json`
and pruned the branch's devDependencies.

Fixed by `vercel.json`, which takes precedence over the dashboard field.
**Confirmed green on `b53721e`.**

### Why this is worse than a broken build

A build could have *succeeded* this way and served main's code under a branch
URL. Every preview anyone reviewed since 2026-08-17 was, at best, not the thing
they thought they were looking at. The dashboard override should still be
cleared at source (Settings → General → Install Command); `vercel.json` is now
the only thing preventing it.

### What §12 got wrong, and why

§12 blamed a missing Preview `BETTER_AUTH_SECRET`. The reasoning was a chain of
real observations — Preview succeeded before the wall landed, every Preview
failed after, Production always passed — assembled into a story that fit and was
false. **The correlation was genuine and the causation invented.** The wall
landing on 2026-08-17 and the branch's first build happening on 2026-08-17 were
the same date for unrelated reasons: that is simply when the branch started.

Three wrong turns on one problem, all from the same habit — concluding from
metadata because the primary source was hard to reach:

1. "Main works, the branch is broken" — Production compared against Preview.
2. "It failed instantly, so the build never ran" — GitHub records only the final
   state; the successes resolve in one second too.
3. "Preview is missing the secret" — §12, above.

The log was available the whole time, from the one person who could open the
dashboard. **Ask for the primary source an hour earlier.**

The Preview secret is now set regardless, which is correct on its own merits.
