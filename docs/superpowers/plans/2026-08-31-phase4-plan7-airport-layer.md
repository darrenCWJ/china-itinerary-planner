# Phase 4 — Plan 7: the airport layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put airports on the country map behind a toggle, and put a "Main airport" line on the selected-place card — the first airport text attached to a place anywhere in the app.

**Architecture:** Almost nothing is new. `MapExplorer` **already fetches the open country's airports** into ephemeral state; `lib/airports.ts` is **already client-safe** and already ranks them; `SelectedPlaceCard` **already reserves the slot**, naming this exact line in a comment. The work is threading the array through three prop hops that do not carry it, and a decorative marker layer that must stay out of the selection machinery.

**Tech Stack:** React 19, TypeScript 7, Vitest 4. **No new dependency, no new API route, no new fetch.**

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) §10.1 and §10.2. **§10.3 (gateways) is PR9 and is Plan 8.**

---

## What the research established

### The card's landing zone already exists, named

`SelectedPlaceCard.tsx:90-91`, written by Plan 3:

```tsx
/** §6.4's climate and airport lines. Nothing passes any yet. */
children?: ReactNode;
```

and `:223-232` renders it inside `<div data-place-facts="" className="mt-1 space-y-1 text-xs text-[var(--ink-2)] empty:hidden">` under a comment reading *"PR7's climate line and PR8's 'Main airport: TNA · 30 km' (§10.2). Empty today and deliberately not stubbed."*

**Nothing needs designing.** The card is `role="dialog"`, opens on tap and Enter/Space, and takes focus — so this line is reachable by touch and keyboard, which the one existing airport surface is not.

### §10.2 understates its own argument by 2×

`rank = km − SIZE_BONUS_KM[size]` with `{large:+15, medium:0, small:−15}` (`lib/airports.ts:60-64`, `:139`). Large beats medium up to **15 km** further — but large beats small up to **30 km** further, because the penalties are symmetric and compose. Verified numerically: large@42 km ranks 27 and beats small@13 km at rank 28; large@44 km ranks 29 and loses. **The boundary is exactly 30 km.**

So the copy must not imply proximity *at all*. `Main airport: TNA · 30 km` is right; anything with "nearest", "closest" or "just" in it is a lie the ranking will eventually tell. Grepping `components/` and `app/` for "Nearest" returns **zero** matches, so there is no existing copy to correct — this line is the first.

### The real work is prop threading, not ranking

`airports` lives at `MapExplorer.tsx:238` and dead-ends at `suggestRoute` (`:585`). Between it and the card sit three interfaces that carry no airport field: `LevelProps` (`CountryMap.tsx:87-113`), `CountryMapProps` (`:115-144`), `CountryLevelProps` (`CountryLevel.tsx:680-720`). `CountryLevel` renders `<SelectedPlaceCard>` at `:1280-1307` with no `children`.

### Five traps

1. **`lib/server/airports.ts` has no `server-only` guard.** A client component importing it **compiles clean** and silently ships `data/airports.json` — 876,823 B — to every visitor. The docblock says "server-only by convention"; convention is all there is. **Go through `/api/map/airports?country=XX`**, which `MapExplorer` already calls.
2. **`RouteMap` is a second `CountryMap` caller and loads no airports** (`RouteMap.tsx:379-411`, `readOnly` with `noop` handlers). Any new prop must be optional or default to `[]`, or the trip map breaks.
3. **Do not add `"airport"` to `MapPlace.kind`.** `kind` is never exhaustively switched anywhere — every reader is `=== "curated"` with an implicit else — so the compiler would report nothing and `MapExplorer.togglePlace` (`:596-610`) would happily accept one as a trip stop. §10.1 says the types must enforce it; a widened union does the opposite.
4. **`CountryLevel.test.tsx`'s "every stroke, radius and font divides by k"** renders the map twice and holds *every* length to the k ratio. Plan 4 wrote it. An airport radius without `/ k` fails there — by design.
5. **MapExplorer's array is country-filtered; `nearestAirports` is not.** `/api/map/airports?country=XX` returns only that country's rows, but the ranking applies no country predicate. **For a border city the true main airport can be across the border and simply absent.** Task 6 makes that a stated limit rather than a silent wrong answer.

### §10.1's justification is right, its citation is wrong three ways

- **The file does not exist.** §10.1 says `schemas.ts:329`; there is no `lib/schemas.ts`. It is **`lib/server/schemas.ts`**, and the scar comment is at **`:330-332`** (line 329 is the `accentHues` key).
- **"Not a fourth `UserPrefs` field" is a miscount.** `worldView` is already the fourth — commit `a417eb6`'s own message says so in those words. An airport toggle would be the **fifth**.
- **The spec cited the weaker of two scars.** The `worldView` scar at `:330-332` is *prophylactic* — comment and key landed in one commit, so that bug never bit. The scar that records a **real regression** is the sibling `pivot` one at **`:312-315`**.

**The conclusion survives all three corrections, and is stronger than the spec argued:** the discard is not merely data loss, it is an **active clobber** — Zod 4.4.3's `z.object()` strips unlisted keys, nothing opts out, and the server's own 200 response overwrites the correct value the browser had just written. That was proven by execution, not by reading. **Ephemeral state it is** — MapExplorer already holds eleven `useState` calls; this is the twelfth, and that is the entire cost of D11.

### "Below a zoom threshold" cannot be a threshold on `k`

There is **no precedent for gating rendering on a numeric `k`** anywhere in the map layer — `k` is only ever a divisor, and every visibility gate is on the framing *state*. Nor would it work: `k` is not stable (Plan 4 measured 3,039 of 4,525 groups clamped), and `transformForFeatures` returns `IDENTITY_TRANSFORM` with `k === 1` when a group's bounds are non-finite — a real case, since 43 committed `cityProvince` values name a `sel: 0` unit no group offers. **Gate on the framing state, not on a number.**

---

## Global Constraints

- **Airports are never selectable trip stops**, and the type system must be what says so — not a comment.
- **Every length inside `<g data-zoom>` divides by `k`.** Plan 4's test enforces it.
- **`MapExplorer` needs no new fetch and no new route.** It already has the array.
- **Any new `CountryMap` / `CountryLevel` prop is optional**, because `RouteMap` is a second caller.
- **`components/map/chinaBaseline.test.tsx` byte-pins China.** Airports off by default means China's default render is unchanged — run it and confirm.
- Plan 1's `"reachability — the Phase 4 acceptance criterion"` block stays green and meaningful. Airports are decorative and must not appear in it.
- **`.test.ts` under `components/` runs in NO vitest project.** `--reporter=basic` does not exist in Vitest 4.
- **Commit messages:** conventional commits ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/mainAirport.ts` | **new** — the one-line "main airport" resolver and its copy | Create |
| `lib/mainAirport.test.ts` | node | Create |
| `components/map/MapExplorer.tsx` | the toggle (12th `useState`) and the prop | Modify |
| `components/map/CountryMap.tsx` | thread `airports` through both interfaces | Modify |
| `components/map/CountryLevel.tsx` | the marker layer and the card's `children` | Modify |
| `components/map/CountryLevel.test.tsx` | jsdom | Modify |
| `components/map/SelectedPlaceCard.tsx` | **unchanged** — the slot already exists | — |

---

### Task 1: The main-airport resolver and its copy

**Files:** Create `lib/mainAirport.ts`, `lib/mainAirport.test.ts`

**Interfaces:** Produces `mainAirportFor(airports: Airport[], at: {lat, lon}): { iata: string; km: number } | null` and `MAIN_AIRPORT_LABEL`. Pure; takes the array as a parameter, exactly as `lib/airports.ts` does, so it stays client-safe.

- [ ] **Step 1: Write the failing test**

```ts
test("returns the RANKED first, which can be 30 km further than the true nearest", () => {
  // rank = km - SIZE_BONUS_KM[size], large +15 / medium 0 / small -15. The
  // penalties are symmetric and compose, so large beats small up to 30 km
  // further out — twice the bound §10.2 quotes. Verified: large@42km ranks 27
  // and beats small@13km at 28; large@44km ranks 29 and loses.
  // THIS is why the label cannot say "nearest".
});
test("the label says Main airport, and says nothing about proximity", () => {
  expect(MAIN_AIRPORT_LABEL).toBe("Main airport");
  expect(MAIN_AIRPORT_LABEL).not.toMatch(/near|close|closest/i);
});
test("returns null when the country has no airports at all", () => {});
test("rounds the distance the way the card renders it", () => {
  // The card shows "TNA · 30 km". Pin the rounding here rather than in JSX.
});
test("does not import the artifact", () => {
  // lib/server/airports.ts has NO server-only guard: a client import compiles
  // clean and ships 876,823 B to every visitor. This module takes the array.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 2: Thread the airports to the card

The array exists at `MapExplorer.tsx:238` and stops there. Three interfaces need an optional field.

**Files:** Modify `components/map/MapExplorer.tsx`, `components/map/CountryMap.tsx`, `components/map/CountryLevel.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("the card shows the main airport for the selected place", () => {
  // First visible airport text attached to a place anywhere in the app.
});
test("the card shows no airport line when the country has none", () => {
  // empty:hidden on the wrapper means an empty children renders nothing —
  // assert the ROW is absent, not that it is present and blank.
});
test("RouteMap still renders with no airports prop", () => {
  // Second CountryMap caller, readOnly, loads no airports. The prop must be
  // optional or default [] or the trip map breaks.
});
test("China's default render is unchanged", () => {
  // chinaBaseline.test.tsx. Airports are off by default, so this must hold.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 3: The marker layer

`large` and `medium` only (§10.1). Decorative: no `role`, no `tabIndex`, no `aria-pressed`, no click handler — the same shape Plan 3's `readOnly` mode produces for a marker.

**Files:** Modify `components/map/CountryLevel.tsx`, `components/map/CountryLevel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("draws large and medium airports, never small", () => {
  // §10.1. The committed artifact is 1,148 large / 2,092 medium / 892 small.
});
test("airport markers are not in the tab order and have no role", () => {});
test("clicking an airport marker does not select anything", () => {
  // Assert onTogglePlace was not called. This is the invariant §10.1 states.
});
test("every airport length divides by k", () => {
  // Plan 4's "every stroke, radius and font divides by k" test renders the map
  // twice and holds EVERY length to the ratio. A raw radius fails there.
});
test("airport markers sit inside the zoom wrapper", () => {
  // <g data-zoom> contains everything drawn; a sibling would slide off.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 4: The toggle

**Files:** Modify `components/map/MapExplorer.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("airports are off by default", () => {});
test("the toggle shows and hides the layer", () => {});
test("the toggle does not write to prefs", () => {
  // D11. Assert setPrefs was not called. The globe/flat button next to it IS
  // a prefs writer, which makes it the tempting and wrong precedent.
});
test("the state does not survive a remount", () => {
  // Ephemeral is the requirement, so pin the consequence rather than the
  // absence of a key: unmount, remount, assert off again.
});
test("the toggle clears the minimum tap target", () => {
  // MapExplorer's three step-up buttons share STEP_UP_BUTTON (:158-159)
  // precisely so min-h-[var(--tap-min)] cannot go missing from one of them.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

**Implementer note:** this is MapExplorer's twelfth `useState`. That is the whole cost of D11, and it buys avoiding a fifth `UserPrefs` key whose write path **actively clobbers** the correct client cookie — see the header.

---

### Task 5: Make "never a trip stop" a type, not a comment

§10.1: *"Airports are never selectable trip stops and the types must enforce it."*

**Files:** Modify `components/map/CountryLevel.tsx` and whichever type file the shape lands in

- [ ] **Step 1: Write the failing test**

```ts
test("an Airport is not assignable to MapPlace", () => {
  // A type-level test (@ts-expect-error) rather than a runtime one, because
  // the requirement is about the compiler.
});
test("togglePlace's parameter type rejects an airport", () => {
  // MapExplorer.togglePlace is MapExplorer.tsx:596-610.
});
```

- [ ] **Step 2: Implement — and do NOT do it by widening `MapPlace.kind`.**

`kind` is never exhaustively switched anywhere in the app; every reader is `=== "curated"` with an implicit else. Adding `"airport"` to the union makes the compiler report nothing while `togglePlace` starts accepting one. **Keep `Airport` a separate type that never flows into a place-shaped prop** — that is what enforces the rule.

- [ ] **Steps 3–5:** pass → commit.

---

### Task 6: The border-city limit, stated rather than hidden

`/api/map/airports?country=XX` returns only that country's rows; `nearestAirports` applies no country predicate. **For a city near a border the true main airport can be in the neighbouring country and simply absent from the array.**

**Files:** Modify `lib/mainAirport.ts` (docblock), `components/map/CountryLevel.tsx` or the card copy as the implementer judges

- [ ] **Step 1: Write the failing test**

```ts
test("names an airport from the loaded country only, and says so", () => {
  // Not a bug to fix in this PR — fixing it means a second fetch or an
  // unfiltered artifact, both out of scope. It is a limit to RECORD, so the
  // next reader does not treat the answer as globally ranked.
});
```

- [ ] **Step 2: Decide and record.** Either the copy carries the limit, or the docblock does and the copy stays clean. **Write down which, and why** — a later PR adding cross-border airports needs to know this was known.

- [ ] **Step 3: Commit.**

---

### Task 7: The full suite and the gates

- [ ] `npm test && npx tsc --noEmit`
- [ ] `components/map/chinaBaseline.test.tsx` — green, not re-recorded
- [ ] Plan 1's `"reachability — the Phase 4 acceptance criterion"` — green, and **verify airports did not leak into it**: with the layer ON, the reachable-button count must be unchanged
- [ ] Commit

---

## The rest of the series

| Plan | Covers | Unblocked by |
|---|---|---|
| 6 | PR7 — climate in the UI, plus §9.6's season stamp and §9.7's honesty note | Plan 4 and Plan 5 |
| 8 | PR9 — trip gateways | this plan |

Plan 8 is the last, and §10.3 already carries an unusual amount of settled detail: `arrivalAirport?: string | null` optional **and** nullable (`755c8dd` is the bug report for conflating absent and null), no migration (`0cfd0a9` is the written argument), a new `/gateways` sub-route because PATCH regenerates the plan and calls `clearScheduleChecks`, and `suggestRoute` gaining an **optional** `start` so the existing order-independent search is untouched.

---

## Self-review

**Spec coverage.** §10.1's toggle → Task 4; its `large`/`medium` filter and zoom gate → Task 3; its "never a trip stop" → Task 5. §10.2's "Main airport" → Tasks 1 and 2. §10.3 is Plan 8's.

**Corrections carried.** §10.2's bound is 30 km, not 15. §10.1's `schemas.ts:329` does not exist — it is `lib/server/schemas.ts:330-332`, its "fourth field" is a miscount (it would be the fifth), and it cites the prophylactic scar rather than the real one at `:312-315`. The conclusion survives all three and is stronger than argued: the failure is an active clobber, proven by execution. And "below a zoom threshold" cannot be a numeric gate on `k`, because `k` is not stable and is `1` for a non-finite group.

**Placeholder scan.** Tasks give test names and the property each must prove; every task names the file to read first. Task 6 is deliberately a decision-and-record task rather than a fix — the limit is real, fixing it is out of scope, and hiding it would be the failure.

**Type consistency.** `mainAirportFor` and `MAIN_AIRPORT_LABEL` are defined in Task 1 and consumed in Task 2. `Airport` keeps its existing shape and deliberately never becomes a `MapPlace` — that separation is Task 5's whole deliverable. `SelectedPlaceCard` is not modified: its `children` slot and `data-place-facts` wrapper already exist.
