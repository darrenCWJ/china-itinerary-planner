# Planner Redesign — PR2 + PR3 Implementation Plan

**Date:** 2026-08-17
**Spec:** `docs/superpowers/specs/2026-08-17-planner-redesign-design.md` (authoritative; this plan implements §10 steps 6–11 and PR3)
**Branch:** `redesign/planner-shell`
**Stack:** Next.js 16 App Router · React 19 · TS strict · Tailwind v4 · vitest (node env, `lib/**/*.test.ts` only)

---

## 0. Ground rules

**Verification loop after every task** (the tree must be green after each):

```
npm test
npx tsc --noEmit
npm run build
```

**Test placement.** `vitest.config.ts` runs `lib/**/*.test.ts` in a **node** environment — there is no jsdom or component-testing infrastructure and this plan does not add any. Every piece of testable logic therefore lives as a **pure module in `lib/`** with the React hook or component as a thin binding. Tasks that are genuinely visual/interaction work (rail layout, hero scrim, drag feel, map rendering) say so explicitly and are verified by build + a manual visual pass at 375/768/1440 per spec §9 — they are *not* given fake unit tests.

**Contract tests (spec §9).** C1/C2/C3/C4 are asserted by source-scanning tests in `lib/contracts.test.ts` (node `fs` over `components/` and `app/` — the vitest node env supports this). C2's scan lands only in Task 19, when the wizard footer is actually removed; landing it earlier would require a dishonest allowlist.

**What PR1 hands this plan** (a parallel agent owns PR1; do not re-plan it, build on it):

| Deliverable | Referenced here as |
|---|---|
| `lib/accent` — pure `(iso2, theme, role) → OKLCH string` | accent fills/tints |
| `lib/countryProfile` — `getCountryProfile(code)`, never throws | season/climate/packing seams |
| `lib/countries` — country records, ISO codes, curated overrides | ISO tables, map keying |
| Trip-payload accessor hook — `payload, loadState, refetch(force), mutate(url, init)`; the ONLY module fetching trip data; `TripView` already refactored onto it | `useTripPayload` (adjust the import path to whatever PR1 shipped — see Judgement call J12) |
| `country` readable off trip data, `"CN"` default | `payload.data.country` (or PR1's actual accessor shape) |
| `ScheduledItem.startMinutes/durationMinutes` (nullable), `PlanOp` `setTiming`, round-tripping stores | timing fields — PR2 is where UI starts using them |
| New design tokens alongside old `@theme` block in `app/globals.css`; theme + accent providers; toggle light-only/hidden | `--ink-*, --line-*, --surf-*, --paper, --raise, --scrim, --accent-ink, --accent-fill`, safe-area + 44px tokens (C5) |

If a PR1 symbol is missing when a task starts, stop and reconcile with the PR1 plan — do not re-implement it inline.

**Verified current-state facts this plan relies on:**

- `components/TripView.tsx` (644 lines): `TABS = ["Itinerary","Tracker","Money","Tickets","Packing","Crew","Briefing"]` at line 26; local `Shell` wrapper at line 595; Packing tab is inline JSX (lines 491–524); Crew tab inline (526–575) includes the "Good to know" tips block; Briefing tab (577–584) renders `BriefingShare` + `BriefingView`; polling/mutate logic lines 62–225 (PR1 moves this into the accessor).
- `app/plan/page.tsx` (230 lines): `STEPS = ["Destinations","Trip details","Your plan"]` line 13; season derived client-side via `seasonOfMonth(m)` at line 162; **fixed footer at line 183** (`<footer className="fixed inset-x-0 bottom-0 …">`).
- `components/DestinationStep.tsx` (262 lines): curated grid + region filter + `CatalogSearch` + `MapExplorer`, map/cards toggle.
- `components/CatalogSearch.tsx` (149 lines): debounced `GET /api/destinations?q=`, returns `CatalogHit[]`.
- `components/map/ChinaMap.tsx` (334 lines): `geoMercator` + `geoPath` over `public/china-provinces.json`; `zoomRegion: Region | null` prop; hardcoded hex literals (`#c93b2e`, `#d9e7f4`, `#17263b`, `#ffffff`, `FIT_COLORS`).
- `components/map/MapExplorer.tsx` (320 lines): fetches topology + `/api/map/cities`; builds `RoutePlace[]` from selected; calls `suggestRoute`.
- `lib/route.ts`: `RoutePlace extends LatLon` (required numbers); `FLIGHT_THRESHOLD_KM = 1200`, `RAIL_KMH = 230` (lines 27–29).
- `lib/types.ts`: `Region` union (line 16), `Destination.chineseName` (line 46), required `lat/lon` (lines 48–50).
- `lib/months.ts`: `seasonOfMonth` hardcoded northern (line 29); `REGION_MONTHS: Record<Region, …>` (line 116).
- `lib/server/schemas.ts`: `PlanOpSchema` (line 60), `CreateTripSchema` (line 30), `TripInputSchema` (line 19).
- `components/shell/AppHeader.tsx` (63 lines): global header, hidden on `/login`, `/signup`, `/b/*`; rendered from `app/layout.tsx`.
- `GET /api/me/trips` exists (`app/api/me/trips`, consumed by `components/home/TripsDashboard.tsx`).
- `chineseName` appears in exactly 17 files: `components/CatalogSearch.tsx`, `components/DestinationStep.tsx`, `components/map/MapExplorer.tsx`, `components/map/PlacePopup.tsx`, `components/map/mapTypes.ts`, `components/trip/BriefingView.tsx`, `lib/briefing.test.ts`, `lib/briefing.ts`, `lib/data/east.ts`, `lib/data/north.ts`, `lib/data/south.ts`, `lib/data/west.ts`, `lib/server/catalog.test.ts`, `lib/server/catalog.ts`, `lib/tripShared.ts`, `lib/types.ts`, `scripts/ingest-destinations.mjs`.
- Old palette utilities (`bg-rail`, `border-sky`, `text-ink-soft`, `bg-paper`, `bg-mist`, `text-seal`, …) are used in ~25 component/app files. This makes PR3's `@theme` removal unsafe unless PR2 re-tokenises the survivors — see Task 33 and Judgement call J11.

---

## PR2 — Redesign

### Sequencing strategy

Build new alongside old, cut over atomically, never strand a surface:

1. **Step 6 first** — nav source + shell are pure additions; the old header keeps working until the layout swap (Task 5), which is the first user-visible change and is self-contained.
2. **Step 7 is decomposed into extractions (7–11) + one atomic cutover (12)** — the four tab components and the two header menus are built and compiling *before* the `TripView` rewrite, so the highest-churn task is a wiring change, not a construction job.
3. **Step 8 before Step 9** — the wizard reorder and merged search are independent of the day builder; the C2 footer removal (Task 19) unlocks the C2 contract test.
4. **Step 9's state machine lands before its UI** — `lib/dayBuilder.ts` and `lib/timeline.ts` are the top-ranked risk (C3) and are fully unit-tested in node before any component exists.
5. **Steps 10–11 last** — the map generalisation and imagery are leaf features; nothing else depends on them.
6. **Task 33 (re-tokenisation sweep) closes PR2** so PR3's deletions are mechanical.

**Tasks that touch a live user-facing surface** are marked ⚠ with the mitigation stated inline. Every other task is additive.

---

### Step 6 — App shell (spec §2.3, C1/C2/C5/C7)

#### Task 1 — Nav source of truth
- **Goal:** One nav configuration feeding the rail now and the mobile bottom bar later (C1), with labels that fit a 375px tab (C7).
- **Test first** (`lib/nav.test.ts`): exactly 4 items; ids `plan | today | money | kit`; labels are `Plan`, `Today`, `Money`, `Kit`; every label ≤ 6 characters (375/4 ≈ 93px budget at the token type size — 6 chars is the conservative bound); each item carries an `icon` name and an `aria-label`.
- **Files:** create `lib/nav.ts` (exports `TRIP_NAV` as a readonly array + `TripTabId` union type), `lib/nav.test.ts`.
- **Verify:** `npm test` (new test red → green), `npx tsc --noEmit`.

#### Task 2 — Contract scan tests (C1, C4)
- **Goal:** Cheap-to-fail assertions for the §7 contracts that already hold after PR1.
- **Test first** (`lib/contracts.test.ts`, node `fs`/`path` walking `components/` and `app/`):
  - **C4:** no file outside the PR1 accessor module contains `fetch(\`/api/trips/${` or `fetch("/api/trips/` *for trip-payload reads* — allowlist the accessor file itself and non-payload endpoints already outside its remit only if PR1's accessor deliberately scoped them out (`/join`, `/briefing` share-state); the allowlist is an explicit array in the test with a comment per entry.
  - **C1:** exactly one file under `components/` renders nav from a hardcoded tab list — assert the string literal `"Itinerary"` (the old tab name) appears in at most one component file, dropping to zero after Task 12; and that `TRIP_NAV` is imported wherever tab labels render.
  - **C3 (armed later):** placeholder assertion that `lib/dayBuilder.ts`, once present, contains no `react` import — written now, `test.skipIf(!fs.existsSync(...))` until Task 21.
- **Files:** create `lib/contracts.test.ts`.
- **Verify:** `npm test`.

#### Task 3 — AppShell component (additive, not yet mounted)
- **Goal:** The 76px left rail (icon + short label per `TRIP_NAV`) plus a header frame with slots: brand · trip zone (switcher, name/dates, crew, Share) · account chip · theme toggle. Uses PR1 tokens exclusively (`--surf-*`, `--ink-*`, `--line-*`); applies safe-area padding and ≥44px interactive targets (C5). The shell owns the bottom edge: it renders the (currently empty) bottom-bar slot so no other component ever needs `position: fixed` at the bottom (C2 groundwork).
- **Files:** create `components/shell/AppShell.tsx`, `components/shell/RailNav.tsx` (renders from `lib/nav`; rail hidden on non-trip routes — see J1), `components/shell/ShellTripContext.tsx` (React context carrying `{ payload, mutate, tripId } | null`, published by the trip page in Task 12).
- **Test/verification:** compile-only + `lib/contracts.test.ts` C1 (RailNav imports `TRIP_NAV`). Visual work — no unit test claimed.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 4 — Trip switcher + theme toggle header pieces
- **Goal:** `TripSwitcher` — dropdown listing the user's trips from `GET /api/me/trips` (same endpoint `TripsDashboard` uses), current trip highlighted, navigates to `/trip/[id]`. `ThemeToggle` — binds PR1's theme provider; per PR1 the dark option stays hidden/disabled (enabled in PR3 Task 37); accent "per country / fixed" override control per spec §4.3 if PR1's prefs endpoint carries it, else deferred to PR3 with a TODO referencing this task.
- **Files:** create `components/shell/TripSwitcher.tsx`, `components/shell/ThemeToggle.tsx`; modify `components/shell/AppShell.tsx` to mount them.
- **Test/verification:** switcher fetch shaping is trivial (list → links) — no pure logic worth extracting; visual/interaction verification in browser. Build must pass.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 5 — ⚠ Mount the shell in the layout
- **Goal:** `app/layout.tsx` swaps `AppHeader` for `AppShell` (children render inside the shell's content region). `AppShell` keeps `AppHeader`'s route-hiding behaviour (`/login`, `/signup`, `/b/*` stay chrome-free — copy the pathname guard from `components/shell/AppHeader.tsx:18-24`). `AppHeader.tsx` is deleted in the same task; its brand mark and `AccountChip` mount move into the shell header.
- **⚠ Surface kept whole:** every page renders inside the new shell immediately; the rail shows only on `/trip/[id]` routes (J1), so home/plan/account look like the old header with new chrome. Manually verify: `/`, `/plan`, `/trip/[id]`, `/login`, `/b/[code]`.
- **Files:** modify `app/layout.tsx`; delete `components/shell/AppHeader.tsx`; grep for remaining `AppHeader` imports (only `app/layout.tsx` imports it today — verified).
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`, manual pass on the five routes.

---

### Step 7 — Trip page collapse (spec §2.1) — highest churn, sequenced as extract-then-cutover

#### Task 6 — Extract PackingSection (pure move)
- **Goal:** The inline Packing JSX (`components/TripView.tsx:491-524`) becomes `components/trip/PackingSection.tsx` with props `{ packing, checkedBy, isMember, onToggle }`. TripView renders it in the existing Packing tab — zero behaviour change, old 7 tabs intact.
- **Files:** create `components/trip/PackingSection.tsx`; modify `components/TripView.tsx`.
- **Test/verification:** mechanical extraction — build + existing tests are the check. Manually confirm Packing tab unchanged.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

#### Task 7 — KitTab (additive)
- **Goal:** `components/trip/KitTab.tsx` composes `TicketsTab` (bookings section) above `PackingSection` (bag section) under two labelled headings — "things you carry, checkable, night-before + at-the-barrier" per spec §2.1. Props are the union of the two children's props (both verified: `TicketsTab` takes `tickets/isMember/hasStartDate/onAdd/onUpdate/onDelete`; `PackingSection` per Task 6). Not yet wired into TripView.
- **Files:** create `components/trip/KitTab.tsx`.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 8 — PlanTab (additive)
- **Goal:** `components/trip/PlanTab.tsx` absorbs the Itinerary tab body (`TripView.tsx:395-448`): the `DayCard` loop with per-day tickets, the start-date hint, and the add-day controls (state `newDayDest/addingDay/addDayError` moves here). Adds the **map ⇄ list toggle** shell (spec §2.1: route map is a view inside Plan) — the map pane renders a "route map" placeholder panel until Task 30 supplies `CountryMap`; the list view is the default and fully functional. Also hosts the "Good to know" tips block relocated from the Crew tab (J4).
- **Files:** create `components/trip/PlanTab.tsx`.
- **Test/verification:** composition of already-tested pieces; toggle is interaction work. Build + later manual pass at cutover.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 9 — TodayTab wrapper (additive, trivial)
- **Goal:** `TrackerTab` is already the Today surface. Create `components/trip/TodayTab.tsx` as a thin re-export/wrapper (rename surface without touching Tracker internals; keeps Task 12's diff mechanical). `onOpenMoney` callback now targets tab id `"money"` from `lib/nav`.
- **Files:** create `components/trip/TodayTab.tsx`.
- **Verify:** `npx tsc --noEmit`.

#### Task 10 — CrewMenu (header, additive)
- **Goal:** Crew moves to the header (spec §2.1: "membership is ambient context, not a page"). `components/shell/CrewMenu.tsx`: overlapping avatar initials (from `payload.members`, reusing the initial-circle styling at `TripView.tsx:535-537`) + a popover containing the member list with joined dates and the invite block (join code + copy-invite-link, moved from `TripView.tsx:363-376` and `551-562`). Reads from `ShellTripContext` — **no fetch of its own** (C4; single accessor call stays in the trip page, J3).
- **Files:** create `components/shell/CrewMenu.tsx`.
- **Test/verification:** popover/menu is interaction work; keyboard reachability (spec §9 a11y) verified manually: trigger focusable, Esc closes, focus returns.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 11 — ShareMenu (header, additive)
- **Goal:** Briefing becomes a **Share** action (spec §2.1: "an output you generate, not a room you occupy" — content unchanged, relocation only per §1 non-goals). `components/shell/ShareMenu.tsx`: a Share button opening a panel with (a) copy-invite-link + join code (member-only, from `TripView.tsx` `copyShareLink`), (b) the `BriefingShare` controls (verified props `{ tripId, memberName }`), (c) a "view briefing" disclosure rendering `BriefingView` with `buildBriefing(payload, { redacted: false, includeBookings: true })` exactly as the old tab did (`TripView.tsx:577-584`). Reads `ShellTripContext`.
- **Files:** create `components/shell/ShareMenu.tsx`.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 12 — ⚠ THE CUTOVER: TripView collapses 7 tabs → 4
- **Goal:** Rewrite `components/TripView.tsx`:
  - `TABS` local const deleted; tab state becomes the `?tab=` search param (`TripTabId`, default `plan`) so the rail, a future bottom bar, and deep links share one source (J2). `RailNav` (shell) and an in-page tab strip fallback both render from `TRIP_NAV`.
  - Renders `PlanTab | TodayTab | MoneyTab | KitTab` from Tasks 7–9 (Money passes through unchanged — verified props at `TripView.tsx:463-478`).
  - Publishes `ShellTripContext` (payload + mutate + tripId) so `CrewMenu`, `ShareMenu`, `TripSwitcher` context, and the header trip name/dates light up (J3). The trip hero header inside the page slims down (crew count chip, invite button and join-code strip move to the header menus).
  - Local `Shell` wrapper (`TripView.tsx:595-606`) deleted; the eyebrow strip goes with it (J5). Guest view (`GuestTripView`, `GuestHeader`, `PrivateGate`, `JoinClaimDialog`) is untouched except for rendering inside `AppShell`.
  - The old Crew and Briefing tab JSX is deleted (its content now lives in Tasks 10–11's components).
- **⚠ Surface kept whole:** this is atomic — every replacement part exists and compiles before this task starts, so the diff is wiring. The task is not split further because a half-cutover (e.g. 4 tabs but Crew still a tab) would ship a nav with five items, violating the spec's central constraint.
- **Contract flip:** `lib/contracts.test.ts` C1 assertion tightens — the literal `"Itinerary"` now appears in zero component files; `TRIP_NAV` is the only tab source.
- **Files:** modify `components/TripView.tsx` (expect it to shrink well under the 800-line cap), `lib/contracts.test.ts`; possibly `components/shell/AppShell.tsx` (mount CrewMenu/ShareMenu in the trip zone).
- **Verification:** `npm test` (contracts), `npx tsc --noEmit`, `npm run build`; manual pass as member (all 4 tabs, crew popover, share panel, invite copy, add-day, packing checks, expense add) and as guest (join-code view unchanged) and private-gate flow.

#### Task 13 — Consumer migration: `chineseName` → `localName` on surviving trip surfaces
- **Goal:** Spec §10: "Consumers migrate to `localName` and `country` here." Every *surviving* UI read of `chineseName` switches to `localName` (PR1 added it alongside): `components/trip/BriefingView.tsx`, `components/map/PlacePopup.tsx`, `components/map/mapTypes.ts` (`MapPlace.chineseName` field renamed `localName`), `components/map/MapExplorer.tsx` (construction sites at lines 81, 100, 145). `lib/briefing.ts` output fields likewise. If PR1 added `localName` to types but left the data files (`lib/data/*.ts`) unpopulated, populate them here by mirroring `chineseName` (mechanical; see J15). **Do not delete `chineseName` anywhere — that is PR3.**
- **Test:** `lib/briefing.test.ts` updated expectations; `npm test`.
- **Files:** the six files above + `lib/data/east.ts|north.ts|south.ts|west.ts` if needed.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

---

### Step 8 — Planner (spec §3.2.1–3, §5.6, C2)

#### Task 14 — Feasibility arithmetic (pure, TDD)
- **Goal:** The live counter's math: `assessFeasibility(selections, daysSet) → { cities, nightsNeededMin, nightsNeededMax, daysSet, delta, verdict }` where each selection contributes its `suggestedDays` range and **off-map/coordinate-less places default to `[1, 2]`** (spec §5.6). Output feeds the `5 cities · 12 nights needed · 7 days set — 5 over` string.
- **Test first** (`lib/feasibility.test.ts`): empty selection; single city inside budget; the spec's own example (5 cities, 12 nights min, 7 days → 5 over); off-map default contribution; catalog cities (which carry `suggestedDays: [1, maxDays]` per `lib/server/catalog.ts:272` — clamp their contribution to the curated-style min, test it).
- **Files:** create `lib/feasibility.ts`, `lib/feasibility.test.ts`.
- **Verify:** `npm test` red → green.

#### Task 15 — Merged search ranking (pure, TDD)
- **Goal:** One ranked result list from two sources (spec §3.2.2): `rankPlaces(query, curated, catalogHits) → RankedPlace[]` — curated matches first (name, `localName`, `knownFor` prefix > substring), catalog hits below, already-selected flagged, and a terminal **"add ‹query› as its own place"** off-map row when the query matches nothing exactly (spec §3.2.7: hand-typed, no coordinates, flagged `no map pin`, `suggestedDays [1,2]`).
- **Test first** (`lib/placeSearch.test.ts`): curated-above-catalog for an ambiguous query; prefix beats substring; dedupe when a catalog hit shadows a curated id; off-map row present/absent; ranking stable.
- **Files:** create `lib/placeSearch.ts`, `lib/placeSearch.test.ts`.
- **Verify:** `npm test`.

#### Task 16 — PlaceSearch component (additive)
- **Goal:** `components/plan/PlaceSearch.tsx` (spec §8 module): one always-focused input; debounced catalog fetch reusing the exact pattern from `components/CatalogSearch.tsx:25-52` (`GET /api/destinations?q=`, AbortController, 300ms); results via `rankPlaces`; **arrow-key navigation + Enter to add, Esc to clear** (`aria-activedescendant` listbox semantics — the a11y path spec §9 requires); selected places render as removable chips. Off-map row creates a local `Destination`-shaped object with `lat/lon: null` (PR1 widened the type), `country` from the active country, flagged for the "no map pin" badge.
- **Files:** create `components/plan/PlaceSearch.tsx`.
- **Test/verification:** ranking already unit-tested (Task 15); keyboard interaction verified manually (documented in task notes: ↓↑ moves active option, Enter adds, input keeps focus). Visual work beyond that.
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 17 — Route safety for coordinate-less places (pure, TDD)
- **Goal:** Spec §5.6: a route leg with a coordinate-less endpoint yields no distance/duration and renders as an untimed transfer. `lib/route.ts`: `RoutePlace.lat/lon` widen to `number | null`; `estimateLeg` returns a discriminated result (`{ kind:"estimated", … } | { kind:"unknown", from, to }`); `suggestRoute` places coordinate-less stops at the end of the order (matching the existing `unresolvedCount` behaviour in `MapExplorer.tsx:116-128`) and skips them in `totalKm`.
- **Test first** (`lib/route.test.ts` additions): leg with one null endpoint → `unknown`; tour with a null-coord member → member last, totalKm over known legs only; all-known behaviour unchanged (existing tests keep passing).
- **Files:** modify `lib/route.ts`, `lib/route.test.ts`, `components/map/MapExplorer.tsx` (render `unknown` legs as "· transfer" without km/h).
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

#### Task 18 — ⚠ Wizard reorder: details before destinations
- **Goal:** Spec §3.2.1. In `app/plan/page.tsx`: `STEPS` becomes `["Trip details", "Destinations", "Your plan"]`; step 0 renders `DetailsStep`, step 1 renders the destination step. State already lives in the page component above both steps, so **reordering loses nothing across steps** — assert that with a pure gate module: `lib/wizard.ts` exporting `canAdvance(step, { selectedCount, days })` (step 0 always advanceable once days ≥ 1; step 1 requires ≥ 1 selection) replacing the inline `canNext` (line 106), plus the step-label list so the page and tests share it. Destination step now receives `days` and renders the **FeasibilityCounter** (`components/plan/FeasibilityCounter.tsx`, a thin presenter over `assessFeasibility` — persistent, updates on every add/remove). `DestinationStep` is refactored to compose `PlaceSearch` (Task 16) as the primary input with the map (`MapExplorer`) as the secondary discovery pane; the curated card grid and separate `CatalogSearch` mount are removed from the wizard path (`CatalogSearch.tsx` itself is deleted in PR3 once nothing imports it — check imports at that point).
- **Test first** (`lib/wizard.test.ts`): gate truth table; steps list order.
- **⚠ Surface kept whole:** single task; the wizard is fully functional at its end (details → destinations with merged search + counter → plan). The `goToPlan` catalog-resolve flow (lines 79–99) moves unchanged behind the new step order.
- **Files:** create `lib/wizard.ts`, `lib/wizard.test.ts`, `components/plan/FeasibilityCounter.tsx`; modify `app/plan/page.tsx`, `components/DestinationStep.tsx`.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`; manual wizard walk-through including a catalog city and an off-map place.

#### Task 19 — ⚠ Kill the fixed wizard footer (C2) + arm the C2 contract test
- **Goal:** Spec C2: the shell owns the bottom edge; the `fixed inset-x-0 bottom-0` footer at `app/plan/page.tsx:183` is **removed, not deferred**. Back/Next/status controls move into normal document flow at the bottom of each step (or into the shell's bottom-edge slot from Task 3 — implementer's choice, but no `position: fixed` outside `components/shell/`). Then extend `lib/contracts.test.ts`: scan `components/` and `app/` for `fixed` combined with `bottom-0|inset-x-0 bottom|bottom:` outside `components/shell/` — zero matches allowed, no allowlist.
- **Files:** modify `app/plan/page.tsx`, `lib/contracts.test.ts`.
- **⚠ Surface kept whole:** footer controls are relocated in the same commit that deletes the fixed element.
- **Verify:** `npm test` (C2 scan), `npx tsc --noEmit`, `npm run build`, manual: wizard nav reachable on all three steps.

#### Task 20 — Server-side season derivation (flagged — see J9)
- **Goal:** Spec §5.2 resolution: season derivation moves server-side behind the profile. `CreateTripSchema` (`lib/server/schemas.ts:30`) gains optional `month: z.number().int().min(1).max(12)`; when present, the trip-create path derives `input.season` via `getCountryProfile(country).seasonOfMonth(month)` (PR1 module) instead of trusting the client value; the wizard sends the picked month (it already captures one via `onMonthPicked`, `app/plan/page.tsx:162`) alongside the season it still computes for backward compatibility. `seasonOfMonth` import in `app/plan/page.tsx` stays until PR3 (guest/legacy path).
- **Test first:** extend `lib/server/schemas.test.ts` (month bounds accepted/rejected); a trip-create service test asserting month → profile-derived season wins over a contradictory client season (place next to existing store tests, e.g. `lib/server/tripStore.test.ts` pattern).
- **Files:** modify `lib/server/schemas.ts`, `lib/server/schemas.test.ts`, the create handler under `app/api/trips/route.ts` (or `lib/server/planService.ts` if creation flows through it — follow the actual call chain at implementation time), `app/plan/page.tsx` (send `month`).
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

---

### Step 9 — Day builder (spec §3.2.4–6, §5.3, C3) — state machine first, UI second

#### Task 21 — Timeline reflow engine (pure, TDD)
- **Goal:** Spec §3.2.6 adopted from the prototype's `timeline()`: `lib/timeline.ts` operating on `ScheduledItem[]` (PR1's nullable `startMinutes/durationMinutes`):
  - `reflow(items)` — later **timed** blocks push down when an earlier block grows/moves; pushed blocks are marked (`pushedBy` id); **untimed items never move** and render in their slot's band (spec §5.3: no fabricated starts for legacy items).
  - `adjustDuration(items, id, deltaMinutes)` — ±15m steps, floor at 15m.
  - `dayLoad(items)` — `{ plannedMinutes, gaps }` for the `9h 40m planned · 2 gaps` readout.
- **Test first** (`lib/timeline.test.ts`): grow pushes exactly the overlapped successors and marks them; shrink un-pushes; untimed item between two timed ones stays put; mixed legacy day (all-null timing) is a no-op; gap counting; 15m floor.
- **Files:** create `lib/timeline.ts`, `lib/timeline.test.ts`.
- **Verify:** `npm test` red → green.

#### Task 22 — Day-builder state machine (pure, TDD — the C3 core and the spec's top-ranked risk)
- **Goal:** `lib/dayBuilder.ts`: a reducer with **zero React and zero layout knowledge** — `dayBuilderReducer(state, action)` over `{ shelf, targetDay, days, pendingOps, interaction }`:
  - Actions: `setTargetDay`, `addFromShelf(placeOrActivity)` (→ emits an `addItem`/`setTiming` op against the target day), `moveBlock(up|down)`, `adjustTiming(±15)`, `beginInteraction` / `endInteraction` (drag or press-and-hold), `serverPayload(payload)`.
  - **Poll-gate:** while `interaction` is active, `serverPayload` is buffered, not applied — the 4s poll can never stomp a mid-drag local edit; on `endInteraction` the newest buffered payload applies through the same version-monotonic rule the accessor uses. This is the exact hazard the task brief names; it gets its own tests.
  - Shelf derivation: unscheduled activities of the target day's destination + a free-text custom entry (J6).
- **Test first** (`lib/dayBuilder.test.ts`): tap-to-add lands in the explicit target day (never the visible day); target chip changes routing; `serverPayload` during interaction leaves state untouched; buffered payload applies after `endInteraction`; stale (lower-version) buffered payload is dropped; move/adjust compose with `lib/timeline` reflow.
- **Contract:** un-skip the C3 assertion in `lib/contracts.test.ts` (Task 2): `lib/dayBuilder.ts` imports nothing from `react` or `components/`.
- **Files:** create `lib/dayBuilder.ts`, `lib/dayBuilder.test.ts`; modify `lib/contracts.test.ts`.
- **Verify:** `npm test`.

#### Task 23 — useDayBuilder hook (thin binding)
- **Goal:** `components/plan/useDayBuilder.ts`: `useReducer` over `dayBuilderReducer`; wires `serverPayload` to the accessor's payload stream and translates emitted ops into the accessor's `mutate` → `POST /api/trips/[id]/plan` (`setTiming` op from PR1; `addItem`/`moveItem` already in `PlanOpSchema`, `lib/server/schemas.ts:60-86`). No JSX, no layout constants. Failure of a mutate falls back to `refetch(force)` exactly as the accessor prescribes.
- **Files:** create `components/plan/useDayBuilder.ts`.
- **Test/verification:** all logic already covered in Task 22; the hook is glue — compile + C4 scan (it must use the accessor's `mutate`, not `fetch`).
- **Verify:** `npm test` (contracts), `npx tsc --noEmit`.

#### Task 24 — ⚠ DayBuilder UI: shelf, target chip, tap-to-add, time blocks
- **Goal:** `components/plan/DayBuilder.tsx` (spec §8 module) + private subcomponents (`ShelfPanel`, `TargetDayChip`, `TimeBlock`): split pane — shelf on one side, day list on the other; explicit **"adding to Day 03"** chip; `+` on a shelf item is the primary add (no modal, no navigation); blocks show start/duration with ±15m controls calling `adjustTiming`; pushed blocks visibly marked; day-load readout from `dayLoad`; untimed legacy items render in morning/afternoon/evening lanes; **keyboard path** = per-block move up/down buttons (pattern exists in `DayCard.tsx` IconButtons) + focusable ±15m controls, which is also the accessible fallback spec §3.2.5 requires. Mounted inside `PlanTab` as the member editing surface; `DayCard` remains the read-only renderer for guests and print (J13). All targets ≥ 44px (C5 tokens).
- **⚠ Surface kept whole:** `PlanTab` keeps the `DayCard` list working until `DayBuilder` mounts in this same task; members see the new builder, guests are untouched.
- **Files:** create `components/plan/DayBuilder.tsx`; modify `components/trip/PlanTab.tsx`.
- **Test/verification:** honest split — **state transitions are already unit-tested (Tasks 21–22); the layout, lane rendering, and touch affordances are visual/interaction work** verified manually at 375/768/1440 and by keyboard-only walkthrough (add, retarget, move, ±15m without a pointer).
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`, manual pass.

#### Task 25 — Desktop drag-and-drop layer
- **Goal:** Spec §3.2.5: drag layered **on top** of tap-to-target, desktop only, pointer-events-based (no new dependency, J14): drag a shelf item onto a day, drag blocks to reorder; `beginInteraction`/`endInteraction` bracket every drag so the Task 22 poll-gate engages; drop translates to the same reducer actions the keyboard path uses (one code path for mutation).
- **Files:** modify `components/plan/DayBuilder.tsx` (or a `components/plan/dragLayer.ts` helper for hit-testing math — if any pure geometry emerges, it goes to `lib/` with a test).
- **Test/verification:** **interaction work — explicitly better covered by manual/visual verification than unit tests.** Verify: drag mid-flight while a poll tick lands (throttle network in devtools) — no visual stomp; Esc cancels; keyboard path still fully equivalent.
- **Verify:** `npx tsc --noEmit`, `npm run build`, manual drag matrix.

---

### Step 10 — World map + country map generalisation (spec §6)

#### Task 26 — World topology asset + ISO reconciliation (TDD on the mapping)
- **Goal:** `public/world-countries.json` — Natural Earth **50m** (not 110m, per spec: Singapore/Malta/Maldives/Bahrain must exist), keyed by ISO alpha-2. Build via `scripts/build-world-topology.mjs`: download the NE-derived 50m countries TopoJSON (world-atlas 50m, public domain), re-key features to alpha-2 using a numeric→alpha-2 table added to `lib/countries` (PR1 owns the module; the table is an additive export — coordinate with the PR1 surface, J7), strip unneeded properties to keep the payload lean, and emit a `smallCountries` list (features below an area threshold) for the point layer. Script is run manually and the JSON committed — same pattern as `public/china-provinces.json`.
- **Test first** (`lib/isoTopology.test.ts`): every ISO code in `lib/countries` either resolves to a topology feature or appears in a documented `SEARCH_ONLY` set (HK/MO and disputed territories — spec accepts these; **search remains the guaranteed path**); the numeric→alpha2 table has no duplicate targets; the spec's named small countries (SG, MT, MV, BH) are present in features or `smallCountries`.
- **Files:** create `scripts/build-world-topology.mjs`, `public/world-countries.json`, `lib/isoTopology.ts` (loader/lookup helpers + `SEARCH_ONLY`), `lib/isoTopology.test.ts`.
- **Verify:** `node scripts/build-world-topology.mjs` then `npm test`.

#### Task 27 — Extract shared map machinery (pure move)
- **Goal:** Projection/zoom/hover mechanics leave `ChinaMap` so both levels share them (spec §6): `components/map/mapShared.ts` — fit-extent projection builder, bounds→transform zoom math (from `ChinaMap.tsx:56-100`), marker-visibility-during-zoom timing, hover reporting. `ChinaMap` consumes the extraction with **zero behaviour change**.
- **Files:** create `components/map/mapShared.ts`; modify `components/map/ChinaMap.tsx`.
- **Test/verification:** the zoom transform math is pure — move it to `lib/mapTransform.ts` with `lib/mapTransform.test.ts` (bounds → `{k, tx, ty}` for known fixtures, clamp at k=5). Rendering unchanged: manual visual check of the China map in the wizard.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

#### Task 28 — WorldMap component (additive, lazy)
- **Goal:** `components/map/WorldMap.tsx` (spec §8): countries as selectable features tinted by `lib/accent` (per-country fill role), point-feature circles for `smallCountries`, hover + keyboard selection mirroring `ChinaMap`'s marker a11y pattern (`role="button"`, Enter/Space — `ChinaMap.tsx:266-275`). Topology fetched **only when the picker opens** (fetch-on-mount of the lazily rendered component + `next/dynamic` import, matching the `MapExplorer` fetch pattern). Colours come exclusively from tokens/accent — no hex literals.
- **Files:** create `components/map/WorldMap.tsx`.
- **Test/verification:** accent assignment is PR1-tested; tint/selection rendering is visual. Manual: tab through small-country points; select CN; verify no network request for the topology until the picker opens (devtools).
- **Verify:** `npx tsc --noEmit`, `npm run build`.

#### Task 29 — ⚠ CountryMap generalisation + wizard wiring
- **Goal:** Two-level picker per spec §6. `components/map/CountryMap.tsx` = generalised `ChinaMap`: takes `country: string`; for `"CN"` renders the existing province/region/city behaviour (the `ChinaMap` internals move here; `zoomRegion` prop stays typed to the China region union until PR3); for any other country renders the list+search fallback inside the same shell (a panel hosting `PlaceSearch` scoped to that country). `MapExplorer` becomes the level coordinator: world level (`WorldMap`) ⇄ country level (`CountryMap`), shared projection/zoom machinery from Task 27. The wizard's destination step gains the country picker entry point. `ChinaMap.tsx` is deleted in this task once `CountryMap` absorbs it (single-consumer: only `MapExplorer` imports it — verified).
- **⚠ Surface kept whole:** the China flow must be pixel-equivalent after the rename; the world level is a strict addition in front of it. Manual before/after comparison of the China map is the gate.
- **Files:** create `components/map/CountryMap.tsx`; modify `components/map/MapExplorer.tsx`, `components/DestinationStep.tsx`; delete `components/map/ChinaMap.tsx`.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`, manual: world → CN → region zoom → marker toggle → route order apply; world → JP → list+search fallback; off-map add still works.

---

### Step 11 — Country imagery (spec §4.4)

#### Task 30 — Hero-selection logic + image data (pure, TDD)
- **Goal:** `lib/countryImagery.ts`: `pickHero(country) → { kind: "image", url, credit } | { kind: "gradient", fromColor, toColor }` — image from country data (curated `Country.image` override wins, then ingested P18), **credit is mandatory whenever kind is image** (Commons licence requirement), gradient built from the country's two accent roles when no image exists ("must look intentional"). Image data ingested by `scripts/ingest-country-images.mjs` (mirrors the existing `scripts/ingest-destinations.mjs` P18→Commons pipeline — no new dependency, no API key) into `data/country-images.json`, loaded server-side and passed down (J8).
- **Test first** (`lib/countryImagery.test.ts`): curated override beats ingested; ingested beats gradient; gradient carries both accent stops; image without attribution is impossible (constructor enforces); unknown country code degrades to gradient, never throws.
- **Files:** create `lib/countryImagery.ts`, `lib/countryImagery.test.ts`, `scripts/ingest-country-images.mjs`, `data/country-images.json` (committed output; CN + a handful fetched, rest gradient).
- **Verify:** `npm test`.

#### Task 31 — CountryHero component: scrim, fallback, attribution
- **Goal:** `components/shell/CountryHero.tsx`: hero band behind the trip header and on picker country cards. **The scrim gradient is structurally mandatory** — it is rendered unconditionally between photo and text (a fixed overlay element, not a conditional class), so contrast holds regardless of the returned image (spec §4.4 rule 1). Gradient fallback path renders the accent gradient. Attribution renders as a small credit line over images. Mount points: trip hero in `TripView`'s header block and `WorldMap`/picker country cards.
- **Files:** create `components/shell/CountryHero.tsx`; modify `components/TripView.tsx`, `components/map/WorldMap.tsx`.
- **Test/verification:** selection logic already tested (Task 30). **Scrim contrast is visual-regression territory per spec §9:** verify manually against one light photo and one dark photo (swap the CN entry temporarily) plus the no-image fallback, at 375/768/1440. No unit test claimed.
- **Verify:** `npx tsc --noEmit`, `npm run build`, manual scrim pass.

#### Task 32 — PR2 closeout verification
- **Goal:** The spec §9 matrix, run once end-to-end before the re-tokenisation sweep: full `npm test` / `npx tsc --noEmit` / `npm run build`; contract tests all armed (C1, C2, C3, C4); keyboard pass (4 rail items reachable, day-builder keyboard path, PlaceSearch listbox); visual pass at 375/768/1440 in light theme; guest + private-gate + join flows manually.
- **Files:** none (fixes discovered here become follow-up commits inside their owning task's file set).
- **Verify:** the three commands + manual matrix; record results in the PR description.

#### Task 33 — Re-tokenisation sweep of surviving components (PR3 enabler)
- **Goal:** PR3 removes the old `@theme` block (`app/globals.css:3-12`), which would silently unstyle every `bg-rail`/`border-sky`/`text-ink-soft`/`bg-paper`/`bg-mist`/`text-seal` utility — currently used in ~25 files (measured; worst offenders: `TrackerTab` 37 uses, `BriefingView` 26, `PlanStep` 26, `DayCard` 24, `MoneyTab` 23, `JournalSection` 22). Components rebuilt in PR2 already use new tokens; this task mechanically migrates the *survivors*: `components/trip/{TrackerTab,MoneyTab,TicketsTab,DayCard,JournalSection,ExpenseForm,BalancesCard,BriefingView,BriefingShare,GuestTripView,JoinClaimDialog,PrivateGate,PackingSection}.tsx`, `components/{PlanStep,DetailsStep}.tsx`, `components/auth/{AuthForm,AccountChip}.tsx`, `components/home/TripsDashboard.tsx`, `components/map/{PlacePopup,MonthTimeline}.tsx`, `app/{account,login,signup,b}/**.tsx`, `components/briefing/charts/*`. Mapping table (old utility → token utility) written once at the top of the PR and applied uniformly; `.stamp`/`.seal-round` CSS in `globals.css` re-pointed at new tokens.
- **Files:** the list above + `app/globals.css` (helper classes only — the old `@theme` block itself stays until PR3).
- **Test/verification:** mechanical restyle — build + a grep gate: `grep -rn "bg-rail\|rail-deep\|border-sky\|bg-sky\|text-seal\|bg-seal\|bg-mist\|text-ink-soft\|bg-paper" components app --include="*.tsx"` trending to zero (the PR3 task requires exactly zero); visual spot-check of Money/Today/Kit/auth/dashboard.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`, grep gate, manual spot-check.

> **PR2 ships after Task 33.** Task count: Step 6 → 5 tasks, Step 7 → 8 tasks (6–13), Step 8 → 7 tasks (14–20), Step 9 → 5 tasks (21–25), Step 10 → 4 tasks (26–29), Step 11 → 4 tasks (30–33).

---

## PR3 — Cleanup (deletions only; each task independently green)

#### Task 34 — Delete `Destination.chineseName` (and siblings)
- **Goal:** With every consumer on `localName` (PR2 Task 13), delete `chineseName` from: `lib/types.ts:46` (Destination), `lib/tripShared.ts` (`MapCity:150`, `CatalogHit:164`), `lib/server/catalog.ts` (+ its test), `lib/briefing.ts` (+ test fixtures), `lib/data/{east,north,south,west}.ts` (bulk field removal), `scripts/ingest-destinations.mjs` (emit `localName` only), and any residual reads in `components/` (there must be none — Task 13's job). Delete `components/CatalogSearch.tsx` and any dead `DestinationStep` grid code if Task 18 left them import-free (check with grep first; if still imported, fix the import instead of keeping the file).
- **Gate before starting:** `grep -rn "chineseName" --include="*.ts*" --include="*.mjs" app components lib scripts` — every remaining hit must be in the deletion list above.
- **Verify:** grep returns zero after; `npm test`, `npx tsc --noEmit`, `npm run build`.

#### Task 35 — Retire the `Region` union
- **Goal:** `Destination.region` becomes `string` (free-form within its country, spec §5.1); the seven-value union moves to `lib/provinces.ts` as `ChinaRegion` (PR1 added the alias — this task deletes the `Region` name from `lib/types.ts:16-23`). Downstream fixes: `lib/provinces.ts` (`ProvinceMeta.region`, `REGION_META` keying), `lib/months.ts:116` (`REGION_MONTHS: Record<ChinaRegion, …>` — and per spec §5.2 it is now reached only through the China profile's `climateFor`, which returns `null` for unknown region strings instead of throwing; add that regression test in `lib/months.test.ts` or the profile's test file), `components/map/mapTypes.ts` (`MapPlace.region: string`; `fitForPlace`/`fitForRegion` route through `climateFor` and degrade to a neutral fit on `null`), `components/map/CountryMap.tsx` (`zoomRegion: ChinaRegion | null`), `components/map/MapExplorer.tsx`, `lib/data/*.ts` (values unchanged — they are valid strings).
- **Test:** existing `months`/`briefing`/`packing` tests keep passing; new test: `fitForPlace` with an unknown region string returns the degraded fit, no throw.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

#### Task 36 — Remove the superseded `@theme` block
- **Goal:** Delete `app/globals.css` lines 3–12 (the `--color-ink … --color-seal` block). Precondition (hard gate): the Task 33 grep returns **zero** old-utility uses. The new token set (PR1) is now the sole palette; `.stamp`/`.seal-round` already re-pointed (Task 33).
- **Verify:** `npm run build`; manual visual pass of every major surface (an unstyled element here fails silently, not at build — the visual pass is the real check): `/`, `/plan` all steps, `/trip/[id]` all four tabs, guest view, `/login`, `/account`, `/b/[code]`.

#### Task 37 — Enable the dark theme toggle
- **Goal:** Flip the PR1 provider's gate so the header `ThemeToggle` (Task 4) offers Light · Dark · System; persistence + pre-first-paint application are PR1's (prefs + cookie + inline script) — this task only un-hides the option and fixes what the dark pass reveals.
- **Test/verification:** accent contrast in dark is covered by PR1's `lib/accent` tests (both themes, all ISO codes). Page-level dark correctness is **visual work**: full surface pass in dark at 375/768/1440; AA spot-checks on body text and the CountryHero scrim over images in dark.
- **Files:** provider gate (PR1's file), `components/shell/ThemeToggle.tsx`.
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`, dark visual pass.

#### Task 38 — Dead-code and doc sweep
- **Goal:** Grep-driven: no imports of deleted files; `lib/wall.ts`/others untouched by accident (`git diff --stat` review); `README.md`/`docs/PLAN.md` references to "seven tabs" or "China-only" updated only where factually wrong (no doc rewrite).
- **Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`. PR3 ships.

> PR3 task count: 5 (34–38).

---

## Judgement calls (spec ambiguities — decided here, not silently)

- **J1 — Rail visibility outside trip routes.** The four rail items are trip tabs, but the shell wraps every page. Decision: the rail renders only when a trip context exists (`/trip/[id]`); home, `/plan`, and `/account` render the shell header without the rail. The nav config stays single-source (C1) either way. If the intent was a persistent rail with disabled items, only `RailNav`'s visibility guard changes.
- **J2 — Tab state lives in the `?tab=` search param,** not component state — deep-linkable, survives refresh, and gives the future bottom bar the same source as the rail with no new plumbing. The spec is silent on tab-state mechanics.
- **J3 — One accessor call per trip page, shared via `ShellTripContext`.** Crew/Share/switcher header pieces read context instead of calling the accessor themselves, so the page cannot double-poll. If PR1's accessor already dedupes concurrent subscribers internally, the context can thin out — but the context is correct under either accessor design.
- **J4 — The "Good to know" tips block** (old Crew tab, `TripView.tsx:563-573`) moves to the bottom of **Plan**, since tips are generation-time planning content. The spec routes Crew's *membership* content to the header but never places the tips.
- **J5 — The "Shared trip mode — live for every member" eyebrow strip** (old local `Shell`) is dropped, not relocated — the shell header's trip zone (name, crew avatars) now communicates shared-ness. Spec doesn't mention it.
- **J6 — Shelf contents** (spec says "places shelf" without a source definition): unscheduled activities of the target day's destination, plus a free-text custom entry. Catalog attractions for arbitrary cities are out of scope for this PR.
- **J7 — World topology source:** world-atlas 50m (a Natural Earth 50m derivative, public domain, ships as TopoJSON) downloaded at script time and re-keyed to ISO alpha-2 via a numeric→alpha-2 table — satisfies "Natural Earth 50m, ISO-keyed, no new dependencies" without hand-processing shapefiles. Small-country point layer threshold chosen empirically in Task 26 such that SG/MT/MV/BH are selectable at default zoom.
- **J8 — Country hero image storage:** the spec names the P18 pipeline but countries have no storage analogue to `CatalogCity.image`. Decision: a committed `data/country-images.json` produced by a new ingest script mirroring `scripts/ingest-destinations.mjs`, read server-side. No runtime Wikidata calls, no API key.
- **J9 — Server-side season derivation (Task 20)** is §5.2's explicit resolution but is assigned to no PR by §10. Placed in PR2 step 8 (it is generation-time and wizard-adjacent) with a backward-compatible optional `month` field so old clients keep working. If the PR1 agent claimed it, drop Task 20 and reconcile.
- **J10 — Currency pivot (§5.5) is excluded** — the task brief scopes PR2 to §10 steps 6–11 and PR3 to the four named deletions; the pivot appears in neither and is not in PR1's handoff list. It must be scheduled before the first non-CNY trip ships; flagged, not smuggled in.
- **J11 — Re-tokenisation sweep (Task 33) added to PR2.** The spec's PR3 line "remove the superseded `@theme` block" is only safe once nothing references the old utilities; ~25 surviving files do. Migrating them is consumer migration, which §10 assigns to PR2 ("consumers migrate … here") — so the sweep is a PR2 task, and PR3's removal gets a zero-grep hard gate.
- **J12 — PR1 accessor import path is unknown at planning time** (the module does not exist in the tree yet). All references here say `useTripPayload`; substitute PR1's actual export/module path at execution. Same for the theme/accent provider file names.
- **J13 — `DayCard` survives** as the read-only day renderer (guest view, print) while `DayBuilder` is the member editing surface. The spec replaces the *editing* interaction, and guests need a render path that never mounts builder state.
- **J14 — Drag-and-drop is hand-rolled on pointer events** (no `dnd-kit`/`react-dnd` dependency). The spec's research-first rule loses to its own "no new dependencies" posture and the small surface (one list + one shelf); revisit if the interaction grows.
- **J15 — `localName` population:** if PR1 added the field to `lib/types.ts` but left `lib/data/*.ts` entries without it, Task 13 mirrors `chineseName` into `localName` mechanically. If PR1 already populated it, Task 13's data-file edits are a no-op.
