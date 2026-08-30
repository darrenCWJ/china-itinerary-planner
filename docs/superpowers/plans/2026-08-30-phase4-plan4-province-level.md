# Phase 4 — Plan 4: the province level

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third map level — zoom into one admin-1 unit of any country, filtered to the cities that unit contains — and make China's seven curated regions a grouping *above* admin-1 rather than a parallel scheme.

**Architecture:** The app already has a region level; it is China-only and it is not a `MapLevel` member. `zoomRegion` is a second, nullable state machine living beside `level`, and this plan generalises *that* machine rather than adding a third member to the first. Plan 2 shipped `cityProvince` and nothing has ever read it — this plan is its first consumer.

**Tech Stack:** React 19, TypeScript 7 (**`noUncheckedIndexedAccess` is OFF** — see below), `d3-geo`, `topojson-client`, Vitest 4.

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) — §6.1, §6.2, §6.4, §6.6. **This plan departs from §6.1's prescribed approach**, for a reason stated below and evidenced.

---

## The design decision, and why it departs from §6.1

§6.1 says: *"`MapLevel` gains a third member. `zoomRegion: ChinaRegion | null` widens to a region identifier resolved through a per-country provider."* **Both halves of that are the wrong shape for this codebase, and the evidence is in the code rather than in taste.**

### Do not widen `ChinaRegion`

`tsconfig.json` sets `"strict": true` and **does not set `noUncheckedIndexedAccess`**. Once a `Record<K, …>`'s key type widens, `record[k]` still types as the value type — never `value | undefined` — and the compiler says nothing. Two records are load-bearing and both dereference immediately:

- `lib/months.ts:132` `REGION_MONTHS: Record<ChinaRegion, RegionMonthClimate[]>`, read by `lib/months.ts:233` as `REGION_MONTHS[region][month - 1]`. A non-China key yields `undefined[month-1]` — **a TypeError at render**, not a benign miss. Its declared return type is non-nullable, so no caller checks.
- `lib/provinces.ts:85` `REGION_META: Record<ChinaRegion, {color; label; anchor}>`, read at `CountryMap.tsx:286`, `:322` and `:335` as `.color`, `.anchor` and `.label`. Same failure.

Worse, `REGION_MONTHS` is not only a table — it is the **runtime basis of the `isChinaRegion` predicate** (`mapTypes.ts:45-47` tests `hasOwnProperty` on it). Widening the key type breaks the guard and the thing the guard protects, in the same edit.

And `CountryMap.tsx:320-322` iterates `(Object.keys(REGION_META) as ChinaRegion[])` — **an unchecked assertion**. Widening `ChinaRegion` keeps that compiling and keeps it yielding exactly China's seven; the cast simply stops meaning anything, silently.

**So: `ChinaRegion` stays exactly as it is, seven members, and `REGION_MONTHS` and `REGION_META` stay keyed to it permanently.** L3 gets its own identifier type. This is the shape the codebase already reaches for elsewhere — `Destination.region` (`lib/types.ts:57-63`) is plain `string` for precisely this reason.

### Do not add a third `MapLevel` member

`MapLevel` is a two-member union at `MapExplorer.tsx:127`, switched on in **exactly one place in the whole codebase** — `if (level === "world")` at `MapExplorer.tsx:527`; `"country"` is pure fallthrough. There is no exhaustive match anywhere, so a third member is not type-checked into existence and would buy no safety. Meanwhile `MapLevel` is owned by `components/DestinationStep.tsx:59`, not by `MapExplorer`, and has three writers across the app.

**The app already has a region level:** the nullable `zoomRegion` state at `MapExplorer.tsx:160`. Adding a third `MapLevel` member without unifying the two would give the app *three* level machines. This plan generalises the machine that already exists.

### One consequence to accept deliberately

`zoomRegion`'s type widening will **not** break `components/trip/RouteMap.tsx:393`, because `null` is assignable to `T | null`. The compiler will not point at the one site §6.1 flags. **Task 10 schedules that edit explicitly**, because nothing else will.

---

## What the research established

Every anchor below was verified against `5dc57bb`. **The spec's anchors are stale twice over** — Plan 1 and Plan 3 both rewrote this layer — and *Plan 3's own "corrected anchors" list is also stale*, because it was written before Plan 3 was implemented.

| Symbol | Spec says | Actually |
|---|---|---|
| `zoomRegion` prop + J14 docblock | `CountryMap.tsx:76` / `:70-76` | **`:96`, docblock `:90-95`** |
| `REGION_META` iteration | `CountryMap.tsx:327` | **`:320-338`** |
| `transformForFeatures` call | `CountryMap.tsx:222` | **`:215`**, memo `:209-216` |
| zoomRegion `useState` | `MapExplorer.tsx:153` | **`:160`** |
| `zoomRegion` prop pass | `MapExplorer.tsx:566` | **`:658`** |
| RouteMap's hard-coded null | `RouteMap.tsx:171` | **`:393`** |
| ceiling-branch test | `mapTransform.test.ts:136-149` | starts `:136`, **runs to `:160`** |

`lib/mapTransform.ts` is the one file in this layer **untouched** by Plans 1 and 3 — the spec's `:39-47` anchor for its no-guard docblock is still exact.

### Six traps, all verified

1. **§6.2's guard belongs on an EMPTY filter, not on zero extent.** The spec says "only a genuine single point divides by zero" — true about the division, false about the consequence. Reproducing the arithmetic at W=860 H=620, a single point `[[400,300],[400,300]]` divides by zero and the ceiling branch clamps the resulting `Infinity` to a finite, sane `{k: 5, …}`. The real hazard is a filter that returns **nothing**.
2. **`chinaBaseline.test.tsx` byte-pins both the unzoomed AND the zoomed China renders**, captured from pre-Phase-4 commit `3030f29`. The zoomed baseline encodes the exact `k` for the East region. This is §9.5's gate and it is unusually sharp.
3. **`CountryLevel` applies no transform at all today.** `k` is implicitly 1 and every constant says so in its docblock — `UNIT_STROKE` 0.7, `OUTLINE_STROKE` 1.2, `MARKER_STROKE` 1.2, `SELECTION_RING` 3.5, `FOCUS_RING` 6.0, `ROUTE_STROKE`, and the measured `tapTargetRadius`. **All of them must gain `/ k`.**
4. **`SelectedPlaceCard` is an HTML sibling of the `<svg>`**, positioned by `anchor.x / MAP_VIEW_W * 100` percentages. **A transform applied inside the SVG will not move it**, so a zoomed marker and its card will separate unless the anchor is computed post-transform.
5. **The `view` memo (`CountryLevel.tsx:502-543`) discards `features` and `pathGen`**, returning only `{units, outline, project}`. A province zoom needs `pathGen.bounds(feature)` per unit, so that memo must return more.
6. **`caps` (`CountryLevel.tsx:592`) is deliberately computed with `Infinity`** so its O(n²) pass never re-runs on resize. **Do not fold `k` into `nonOverlappingRadii`** — that reintroduces ~560k distance checks per zoom frame. Clamp after, as the resize fix already does.

### Four data facts

- **`cityProvince` has never been read by production code.** Plan 3 shipped it unconsumed; this plan is its first consumer. Every existing fixture sets it to `{}` (`countryFixture.ts:119`, `MapExplorer.test.tsx:425`, `SelectedPlaceCard.test.tsx:62`).
- **43 committed `cityProvince` values point at non-selectable units** — CY 20 (Northern Cyprus, Dhekelia, Akrotiri), SO 22 (Somaliland), CU 1 (Guantánamo). A city can therefore be assigned to a unit the user can never zoom to.
- **China's units have `nameEn === null`**, and `CountryLevel`'s label precedence is `nameEn ?? name ?? id` — English first — so China's L3 labels come out Chinese (北京市) unless joined to `lib/provinces.ts`.
- **Six selectable units carry neither name** and would label as a raw id: `AI/AIA+99?`, `CO/COL+99?`, `KI/KIR+99?`, `MX/MEX+99?`, `RU/RUS+99?`, `VE/VEN+99?`. All six have zero assigned cities, so they are unreachable by a city but reachable by a click.
- `public/provinces/index.json`'s `count` counts **selectable** units and is asserted to per country, which is exactly what §6.6's `count <= 1` gate needs.

### Operational warning

There is a **stale sibling git worktree** at `.claude/worktrees/clever-sanderson-3d3312` (branch `claude/clever-sanderson-3d3312` @ `f85fd3c`), diverging at `948a63b` and **missing Plan 3's `readOnly` work**. A repo-wide grep returns two hits for everything in this layer, with close-but-wrong line numbers. **Read and edit only the main worktree.** If that branch merges, re-verify `CountryMap.tsx` and `RouteMap.tsx` before trusting any anchor here.

---

## Global Constraints

- **`ChinaRegion` does not change.** Seven members, `lib/types.ts:25-32`. `REGION_MONTHS` and `REGION_META` stay keyed to it. Any diff touching those key types is wrong.
- **`lib/mapTransform.ts` does not change.** Its no-guard docblock at `:39-47` is deliberate and stays; the guard goes at the call site.
- **`chinaBaseline.test.tsx` must stay green.** It byte-pins China zoomed and unzoomed. Spec §9.5.
- **Plan 1's `"reachability — the Phase 4 acceptance criterion"` block must stay green and stay meaningful.** Plan 3's fix made it run over both branches; a third branch means it runs over three.
- **`.test.ts` under `components/` runs in NO vitest project.** Pure logic goes in `lib/`.
- **`--reporter=basic` does not exist in Vitest 4.**
- **Commit messages:** conventional commits ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/regionScheme.ts` | **new** — the L3 identifier and the per-country provider | Create |
| `lib/regionScheme.test.ts` | node | Create |
| `lib/mapTransform.ts` | zoom maths | **unchanged** |
| `components/map/CountryLevel.tsx` | the zoom itself | Modify |
| `components/map/CountryLevel.test.tsx` | jsdom | Modify |
| `components/map/SelectedPlaceCard.tsx` | anchor under transform | Modify |
| `components/map/MapExplorer.tsx` | generalised `zoomRegion` state and chrome | Modify |
| `components/map/CountryMap.tsx` | thread the region prop to `CountryLevel` | Modify |
| `components/trip/RouteMap.tsx` | the explicit null the compiler will not flag | Modify |

---

### Task 1: The L3 identifier and the per-country scheme

**Files:** Create `lib/regionScheme.ts`, `lib/regionScheme.test.ts`

**Interfaces:** Produces `type RegionId = string` (branded if the implementer prefers), and
`regionSchemeFor(country: string, units: ProvinceUnit[]): RegionScheme` where
`RegionScheme = { kind: "admin1" | "curated"; groups: RegionGroup[] }` and
`RegionGroup = { id: RegionId; label: string; unitIds: string[] }`.

For 245 countries the scheme is one group per selectable unit. For China it is the seven curated regions, each grouping the adcodes `lib/provinces.ts` assigns to it (§6.4).

- [ ] **Step 1: Write the failing test**

```ts
describe("regionSchemeFor", () => {
  test("gives every other country one group per selectable unit", () => {});
  test("omits non-selectable units — a user cannot zoom to Northern Cyprus", () => {
    // 43 committed cityProvince values point at sel:0 units (CY 20, SO 22,
    // CU 1). Those cities exist; the unit they name is not a destination.
  });
  test("labels a unit nameEn ?? name ?? id, matching what CountryLevel already does", () => {});
  test("labels China's units in English by joining lib/provinces.ts on adcode", () => {
    // Every CN unit has nameEn === null, so the shared precedence yields 北京市.
    // The curated table has the English name and the join key is the id.
  });
  test("falls back to the raw id for the six units that carry no name at all", () => {
    // AI/AIA+99?, CO/COL+99?, KI/KIR+99?, MX/MEX+99?, RU/RUS+99?, VE/VEN+99?
    // Zero assigned cities each, so unreachable by a city and reachable by a click.
  });
  test("groups China's units into its seven curated regions", () => {
    // §6.4: the regions are a grouping ABOVE admin-1, not a replacement.
  });
  test("returns no groups for a country with one selectable unit", () => {
    // §6.6 D10: 34 countries where L3 would be identical to L2. The gate is
    // index.countries[].count <= 1, which counts SELECTABLE units.
  });
  test("does not resolve a country code that is an Object property name", () => {});
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

**Implementer note:** `RegionId` must not be `ChinaRegion`. If China's group ids happen to be the seven `ChinaRegion` strings that is convenient, but the *type* stays wide — otherwise the widening this plan exists to avoid arrives through the back door.

---

### Task 2: The empty-filter guard, at the call site

§6.2. `transformForBounds` keeps its no-guard docblock; the caller stops handing it nothing.

**Files:** Modify `components/map/CountryLevel.tsx`; test in `components/map/CountryLevel.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("zooming to a group whose units have no drawable feature stays unzoomed", () => {
  // The real hazard, and it is NOT zero extent. Reproduced numerically at
  // W=860 H=620: a single POINT does divide by zero, and the ceiling branch
  // clamps the Infinity to a finite {k: 5, …}. An EMPTY feature list is what
  // has no defined answer.
});
test("zooming to a group with exactly one unit pins to MAX_ZOOM_K", () => {
  // A single province has non-zero extent, so it never divides by zero — it
  // reaches the ceiling through the ordinary branch, which mapTransform.test.ts
  // :136-160 already pins.
});
test("lib/mapTransform.ts is not modified by this plan", () => {
  // Belt and braces: the guard belongs at the call site and the docblock at
  // mapTransform.ts:39-47 explains why. Assert the exported signature shape.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 3: Let the view memo yield unit bounds

**Files:** Modify `components/map/CountryLevel.tsx`

The `view` memo at `:502-543` returns `{units, outline, project}` and discards `features` and `pathGen`. A zoom needs `pathGen.bounds(feature)` per unit.

- [ ] **Step 1: Write the failing test**

```ts
test("exposes a bounds accessor per unit without re-projecting", () => {
  // Recomputing a path generator per zoom frame is the thing to avoid; the
  // memo already builds one and throws it away.
});
test("the memo still runs once per topology, not once per zoom", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 4: The zoom transform, and the `/ k` discipline

**Files:** Modify `components/map/CountryLevel.tsx`

Every stroke, radius and font in this file is currently written unscaled with a docblock saying "`k` is 1 here". That stops being true.

- [ ] **Step 1: Write the failing test**

```ts
test("draws a transform group when a region is selected, and none when it is not", () => {});
test("every stroke, radius and font divides by k", () => {
  // UNIT_STROKE 0.7, OUTLINE_STROKE 1.2, MARKER_STROKE 1.2, SELECTION_RING 3.5,
  // FOCUS_RING 6.0, ROUTE_STROKE, and the MEASURED tap radius. A magnified map
  // draws the same radius over k times as many CSS pixels, so an unscaled
  // constant is k times too fat.
  // Assert by rendering zoomed and unzoomed and comparing the attributes.
});
test("the measured tap target stays 44 CSS px when zoomed", () => {
  // tapTargetRadius(width) / k, not TAP_MIN_R_FALLBACK / k — Plan 3's fix made
  // the radius a measurement, and the zoom must divide the measurement.
});
test("does not fold k into nonOverlappingRadii", () => {
  // caps is computed with Infinity precisely so its O(n^2) pass never re-runs.
  // Folding k in reintroduces ~560k distance checks per zoom frame. Clamp after.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 5: Filter markers by the zoomed unit — `cityProvince`'s first reader

**Files:** Modify `components/map/CountryLevel.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("shows only the cities the zoomed unit contains", () => {
  // cityProvince is a ReadonlyMap<cityId, unitId> and nothing has ever read it.
});
test("a city whose id is absent from cityProvince is hidden when zoomed, not shown everywhere", () => {
  // 478 cities are placed by neither containment nor a1c. Showing an unplaced
  // city inside every province is worse than showing it in none.
});
test("the list still reaches every city in the country, zoomed or not", () => {
  // §5.2's invariant. The map filters; the spine does not.
});
test("clears the zoom when the country changes", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 6: The card follows the marker

**Files:** Modify `components/map/SelectedPlaceCard.tsx`, `components/map/CountryLevel.tsx`

The card is an HTML sibling of the `<svg>` positioned by `anchor.x / MAP_VIEW_W * 100`. An SVG transform will not move it.

- [ ] **Step 1: Write the failing test**

```ts
test("the card anchors to the marker's post-transform position", () => {
  // Zoom, open a card, and assert the anchor moved. Without this the card and
  // its marker separate — and the card is the only touch affordance there is.
});
test("the card closes when the zoom changes underneath it", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 7: China's seven regions, preserved exactly

§6.4 and §9.5. The regions become a grouping above admin-1; `REGION_MONTHS` is not re-keyed and not re-derived.

**Files:** Modify `components/map/CountryLevel.tsx` or `CountryMap.tsx` as the routing requires

- [ ] **Step 1: Write the failing test**

```ts
test("China's rendered output is byte-identical, zoomed and unzoomed", () => {
  // chinaBaseline.test.tsx already pins both against pre-Phase-4 commit 3030f29,
  // and the zoomed baseline encodes the exact k for East. Run it; do not
  // re-record it. A changed baseline is the regression, not the fix.
});
test("REGION_MONTHS and REGION_META are still keyed to the seven-member union", () => {
  // The whole design decision, pinned. noUncheckedIndexedAccess is off, so
  // nothing else would catch a widening.
});
test("isChinaRegion still narrows, and PlacePopup still degrades for a non-China place", () => {
  // mapTypes.ts:45-47 decides China-ness by hasOwnProperty on REGION_MONTHS,
  // and PlacePopup.tsx:40 is its only consumer.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 8: No L3 affordance where L3 would be L2

§6.6 D10, gated on `count <= 1`, never on a hard-coded list.

**Files:** Modify `components/map/CountryLevel.tsx`, `components/map/MapExplorer.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("offers no region control for the 34 countries with one selectable unit", () => {
  // The Faroes' single unit is named "Eysturoyar" — one island — so an L3 label
  // there would be actively WRONG, not merely redundant. KI-X02~ has a null name.
});
test("gates on the index count, not on a list of country codes", () => {});
test("still emits the file for those countries, so the loader needs no special case", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 9: The chrome

Today every region affordance in `MapExplorer` is gated on `hasCurated` — China only — and the other 245 countries get a bare header. `MapExplorer.tsx:602-622` is the three-way ternary.

**Files:** Modify `components/map/MapExplorer.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("a non-China country gets a region control", () => {});
test("the back path is level-aware: region -> country -> world", () => {
  // zoomRegion and level are two independent machines and stay that way; the
  // back control has to read both.
});
test("the caption names the zoomed region", () => {});
test("China's chrome is unchanged", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 10: The site the compiler will not flag

**Files:** Modify `components/trip/RouteMap.tsx`

`RouteMap.tsx:393` hard-codes `zoomRegion={null}`. Widening the type leaves that assignable, so **nothing will point at it**. It is scheduled here because it is the one edit in this plan with no compiler and no test pressure behind it.

- [ ] **Step 1: Write the failing test**

```ts
test("the trip map does not offer a region zoom", () => {
  // It is read-only (Plan 3's readOnly mode) and guest-reachable. A region
  // control there is a control that cannot do anything.
});
test("passing null is deliberate and documented, not an unmigrated default", () => {
  // Assert the comment exists, or assert the explicit prop — whichever the
  // implementer chooses, the point is that a reader can tell.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 11: The acceptance gate over three branches

**Files:** Modify `components/map/CountryMap.test.tsx`

Plan 3 made the `"reachability — the Phase 4 acceptance criterion"` block run over the list-only and map branches. There are now three.

- [ ] **Step 1: Extend the block to the zoomed branch, keeping its name**

- [ ] **Step 2: Verify it the way Plan 3's fix was verified** — delete the `<CountryPlaceList>` block from `CountryLevel.tsx`, confirm the gate goes RED for all three branches, restore. Report what you observed.

- [ ] **Step 3: Commit**

---

## The rest of the series

| Plan | Covers | Unblocked by |
|---|---|---|
| 5 | PR6 — climate ingest and the four fit-model fixes | **ready now**, and independent of every other plan |
| 6 | PR7 — climate in the UI | this plan and Plan 5 |
| 7 | PR8 — airport map layer | Plan 3 (**ready now**) |
| 8 | PR9 — trip gateways | Plan 7 |

**Plans 5 and 7 are both writable today.** Plan 5 is the largest single piece of work left in the phase — 36 whole-object GETs totalling ~5.2 GB, a new `geotiff@3.0.5` dependency, and four fit-model corrections that must land before any fit colour ships.

---

## Self-review

**Spec coverage.** §6.1's level and identifier → Tasks 1, 9, 10, **by a different mechanism than the spec prescribes, argued above**. §6.2 degenerate bounds → Task 2. §6.3 China's curated topology → already landed in Plan 2; Task 7 protects it. §6.4 regions as a grouping → Tasks 1 and 7. §6.5 city→province → Task 5, the first ever reader of `cityProvince`. §6.6 single-unit countries → Task 8. §9.5 China byte-identity → Task 7.

**The departure, restated so no one has to reconstruct it.** The spec asks to widen `ChinaRegion` and add a `MapLevel` member. Widening is unsafe because `noUncheckedIndexedAccess` is off and two records dereference immediately; the `MapLevel` member buys nothing because the union is switched on in exactly one place with no exhaustiveness anywhere, and would make a third level machine beside the two that already exist. If a reviewer disagrees, this is the decision to overrule — everything else in the plan follows from it.

**Placeholder scan.** Every task gives test names and the property each must prove rather than full bodies, and every one names the file to read first. That is the same trade Plan 3 made and for the same reason: these tasks modify existing components whose conventions are the specification. **Task 1 is the exception that most needs real code and does not have it** — the implementer should expect to design `RegionScheme`'s shape against `lib/provinceTopology.ts` rather than transcribe it.

**Type consistency.** `RegionId`, `RegionScheme`, `RegionGroup` and `regionSchemeFor` are defined in Task 1 and consumed under those names in Tasks 5, 8 and 9. `ChinaRegion`, `REGION_MONTHS`, `REGION_META` and `isChinaRegion` keep their current names, signatures and key types throughout — that is the plan's central invariant, and Task 7 pins it.
