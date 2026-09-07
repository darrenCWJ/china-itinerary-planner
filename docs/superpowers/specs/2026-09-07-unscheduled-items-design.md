# Unscheduled items — design

**Date:** 2026-09-07
**Status:** approved in chat on 2026-09-07 — the three forks below (§2's scope, §4's gating, §1's examples) were put to the owner as questions and answered; every other decision here is the design's, and a reviewer may overrule it.
**Scope:** the four items the 2026-09-07 audit found still open after PR #30, none of them a roadmap feature: China-flavoured copy outside the plan path; source files over the 800-line guidance, including the one follow-up PR #27 recorded; documentation that describes the app as it was in August; and the world level's prefetch of China's map assets. Nothing here adds a feature or changes what the map draws.

## 0. What was checked first

Verified against `main` at 434220a — level with `origin/main`, tree clean, CI green, the three refresh workflows green on their last runs, no open PRs, issues or branches, and no `TODO`/`FIXME` anywhere under `app components lib scripts .github`:

- Every plan under `docs/superpowers/plans/` is executed and merged, and every handoff finding is closed (PR #30 §8 put the status table in the handoff itself).
- Of the follow-ups the country-guidance design listed under *Non-goals* ("App chrome beyond the plan path"), two are already closed: `lib/meta.ts`'s season months are hemisphere-aware and reconciled by `lib/meta.test.ts`, and `ExpenseForm`'s quick currencies are the trip's own (commit d2ae2a6). What remains of that list is §1.
- PR #27's non-blocking follow-up — "`buildReport` in `scripts/ingest-climate.mjs` could move to a sibling module" — is still open, and the file has grown to 1,630 lines since. It is inside §2.
- The one failing unit test, `lib/climateModel.test.ts`'s Lima `test.fails` tripwire, fails by decision (Plan 6, P6-3). It is not an item.

## 1. China-flavoured copy outside the plan path

**Problem.** Phase 3 made the plan path country-neutral; the trip page was not part of that work. Verified today:

| Site | Text | What it assumes |
|---|---|---|
| `components/trip/TicketsTab.tsx:293` | `e.g. G2 · CA1858 · Disneyland` | a Chinese train number and an Air China flight |
| `TicketsTab.tsx:327`, `:333` | `Beijing or PEK`, `Shanghai or SHA` | the flight endpoints |
| `TicketsTab.tsx:340`, `:344` | `Beijing`, `Shanghai` | the train and other endpoints |
| `TicketsTab.tsx:350` | `¥553` | a price in yuan |
| `components/trip/ExpenseForm.tsx:139` | `Hotpot dinner` | an expense title |

Every one is a `placeholder` — a format hint, never stored. A Peru trip's ticket form still teaches its members to type Beijing.

**Decision — trip-derived examples (the owner's choice).** The form's examples come from the trip it is on. One pure helper in `lib/tickets.ts`, the module that already holds the tickets helpers:

```ts
ticketExamples({ firstStop, lastStop, arrival, departure, currency }): TicketExamples
// TicketExamples = { from: string; to: string; flightFrom: string; flightTo: string; price: string }
```

- `from` is the first stop's name and `to` the last stop's; `"City"` when the trip has no stops, and for `to` when it would repeat `from`.
- `flightFrom` is `"<first stop> or <arrival IATA>"`, `flightTo` is `"<last stop> or <departure IATA>"` — the stop half of `flightTo` follows the same rule as `to`, so a one-city trip does not offer its only stop as both ends — each half falling back on its own: `"Lima or airport code"` without a gateway, `"City or LIM"` without a stop, `"City or airport code"` with neither. It is the hint `"Beijing or PEK"` was — *a name or a code* — in the trip's own terms.
- `price` is `formatMinor(553 × 10^digits, currency)` with `digits = minorUnitDigits(currency)` — the amount the old placeholder used, rendered by the app's own money formatter so the hint shows the notation the Money tab uses (`¥553.00`, `PEN 553.00`, `JPY 553`); `"Amount"` when the trip has no currency.

`TripView` already holds every input: `data.destinationNames`, `tripGateways(data)`, and `tripCurrency(data)`, which it computes for `MoneyTab`; the currency falls back to `currencySettings.home` before `null`. It computes the examples once (`useMemo`) and passes them as one prop, `ticketExamples`, through `KitTab` — "purely compositional: props are the union of the two children's" — to `TicketsTab` and its `TicketForm`. `KitTab`'s docblock sentence "Not wired into TripView until Task 12", false since PR #6, goes in the same edit.

**Why the helper takes primitives.** `lib/countryFacts.test.ts` pins the exact set of `"use client"` entry points that reach the 70 KB facts artifact. `TicketsTab` is not on it, and `lib/tickets.ts` imports `lib/tripShared` as types only. A helper that called `tripCurrency` itself would put `lib/tickets.ts`, and through it `TicketsTab`, on that list for the sake of a placeholder. Taking the currency as a string keeps the edge in `TripView`, which already pays. `lib/money.ts` is safe to import from the helper: it too imports `tripShared` as types only.

**Title placeholders.** No trip can supply a flight number, so the title hint becomes kind-aware and neutral — one table, `TICKET_TITLE_EXAMPLES: Record<TicketKind, string>`, beside the helper: flight *"Flight number"*, train *"Train number or route"*, hotel *"Hotel name"* (unchanged), attraction *"Venue or event"*, other *"What it's for"*. No carrier, venue or station from any one country.

**`ExpenseForm`.** `"Hotpot dinner"` becomes `"Group dinner"` — a title any group trip has. `ExpenseForm.test.tsx:79` reads the placeholder and follows it; `lib/server/schemas.test.ts:28` uses the phrase as a *value* and is untouched.

**Left as they are, on purpose.**
- `"Seat 05A, carriage 3…"` (`TicketsTab.tsx:354`): rail-flavoured, not Chinese.
- The `游` mark in `AppShell` and `TripsDashboard`: the brand, not content. The standing note is to keep the ticket identity when extending the UI.
- `.font-kai` (`app/globals.css:90`): applied to `localName` at seven sites, correct for Chinese names, and a name in another script falls through the stack to `serif`. The guidance design raised this "as a question, not a change"; the answer is no change.
- `DestinationStep.tsx:489`'s `{dest.region} China`: the curated cards are China-only by data.
- The README's title: it is the product's name, the repository's and the live URL's. Its tagline is §3.

**Rejected.** Neutral wording everywhere ("City or airport code", "Amount"): smaller, but it throws away the one thing a format example is for, and the trip already knows better.

**Verification.** Unit tests for every fallback branch of the helper (`lib/tickets.test.ts`); a new `components/trip/TicketsTab.test.tsx` — none exists today — rendering the form with examples and asserting each placeholder; and one e2e on `e2e/gateways.spec.ts`'s Peru trip: open the Kit tab, add a flight, and read `Lima or LIM` and `Cusco or CUZ` off the gateways the server really stamped.

## 2. Files over the 800-line guidance

**Problem.** The house rules cap a file at 800 lines (`coding-style.md`: "200-400 lines typical, 800 max"). Measured today:

| File | Lines | of which comment-ish |
|---|---|---|
| `scripts/ingest-country-facts.mjs` | 2,804 | 1,419 |
| `scripts/ingest-climate.mjs` | 1,630 | 731 |
| `components/map/CountryLevel.tsx` | 1,610 | 855 |
| `scripts/ingest-cities.mjs` | 1,185 | 488 |
| `scripts/enrich-cities.mjs` | 866 | 377 |

and nine tests: `ingest-country-facts.test.ts` 2,973, `CountryLevel.test.tsx` 2,184, `ingest-cities.test.ts` 1,532, `contracts.test.ts` 1,332, `countryFacts.test.ts` 1,107, `ingest-climate.test.ts` 1,064, `GlobeLevel.test.tsx` 900, `countryTips.test.ts` 887, `climateShard.test.ts` 806.

**Decision — all five source files (the owner's choice), by behaviour-preserving moves.** The rule for every split is PR #30's: no function body changes; the existing tests pass without their bodies changing; each test file splits along its `describe` blocks into files named for the module they cover, and a test imports from the file that defines what it tests; every resulting file is under 800 lines; the number of tests before and after is the same. Test files over 800 whose source is not split — `contracts`, `countryFacts`, `GlobeLevel`, `countryTips`, `climateShard` — are left alone. That is the owner's choice, recorded here so it is not mistaken for an oversight.

### 2.1 The four ingest scripts

All four already carry the same section banners — pure parse or build, the build gate, paths and network, writing, report, fetching, and `run`, "the seam between the pure build and its network/filesystem edges". The seams are drawn; the split follows them.

**Layout.** One directory per script, `scripts/<topic>/`, holding the modules; the entry `scripts/ingest-<x>.mjs` keeps its header docblock, `run`, `main` and the `import.meta.url` guard, so `node scripts/ingest-<x>.mjs` in the workflows is unchanged. The entry re-exports nothing — a re-export layer is a second name for everything — and the importers outside each script follow the code instead: `lib/contracts.test.ts:7` (`buildReport` from `ingest-cities.mjs`), `scripts/sample-climate-anchors.mjs:34` (`decodeSample`, `pixelFor`, `tupleFor` from `ingest-climate.mjs`), and each script's own tests. Vitest's node project already collects `scripts/**/*.test.ts`, subdirectories included, and `lib/contracts.test.ts`'s tree walk is recursive.

**Paths.** `REPO_ROOT`-style constants are computed from `import.meta.url` in exactly one module per script — the entry, or a `paths.mjs` where two modules need one — and passed down as parameters; `ensureRaster` already takes `{ cacheDir }`. A module one directory deeper that copied `join(dirname(fileURLToPath(import.meta.url)), '..')` would silently resolve to `scripts/`.

**Modules, with today's line ranges.** The plan names every export; these are where they sit today.

`scripts/ingest-country-facts.mjs` (2,804):

| Module | Today's section | ≈ lines |
|---|---|---|
| `country-facts/parse.mjs` | Pure parse (135–243) | 110 |
| `country-facts/picks.mjs` | the plug, language and emergency tables and the `pick*` functions (244–729) | 485 |
| `country-facts/curated.mjs` | `CURATED_FACTS` (957–1101) — the hand-verified override table people edit when Wikidata breaks (aec9295, PR #24) | 150 |
| `country-facts/facts.mjs` | `FACT_FIELDS` … `carryForwardFields` (730–1210, less the table) | 330 |
| `country-facts/gate.mjs` | The build gate (1211–1846) | 635 |
| `country-facts/io.mjs` | Paths, sources, network (1847–2076) + Writing (2077–2147) + Fetching the property queries (2377–2652) | 575 |
| `country-facts/report.mjs` | Report (2148–2376) | 230 |
| the entry | header (1–134) + run (2653–2804) | 290 |

`scripts/ingest-cities.mjs` (1,185):

| Module | Today's section | ≈ lines |
|---|---|---|
| `cities/geonames.mjs` | ZIP + GeoNames TSV (73–290) | 220 |
| `cities/build.mjs` | Ranking + Deduplication + Shard construction (291–458) | 170 |
| `cities/gate.mjs` | The build gate (459–766) | 310 |
| `cities/io.mjs` | Paths, sources, network + Writing + Fetching (767–932, 1011–1028) | 185 |
| `cities/report.mjs` | Report (933–1010) | 80 |
| the entry | header + run (1–72, 1029–1185) | 230 |

`scripts/enrich-cities.mjs` (866):

| Module | Today's section | ≈ lines |
|---|---|---|
| `enrich/plan.mjs` | Pure (228–490) | 265 |
| `enrich/io.mjs` | Network + Writing (491–633) | 145 |
| the entry | the header essay ("why there are five gates", 1–227) + run (634–866) | 460 |

`scripts/ingest-climate.mjs` (1,630):

| Module | Today's section | ≈ lines |
|---|---|---|
| `climate/sample.mjs` | Constants + `pixelFor` + `decodeSample` + `tupleFor` (78–381) — what `sample-climate-anchors.mjs` imports | 305 |
| `climate/acquire.mjs` | Paths and the source + The catalog + Acquisition + Tags (382–697) | 315 |
| `climate/raster.mjs` | Sampling + Assembly (698–853) | 155 |
| `climate/gate.mjs` | Gates (854–989) | 135 |
| `climate/payload.mjs` | Payloads + Writing (990–1091) | 100 |
| `climate/report.mjs` | Report (1092–1363) — PR #27's follow-up | 270 |
| the entry | header + Entry point: `sampleAll`, `assertSampleHealth`, `buildShards`, `main` (1–77, 1364–1630) | 340 |

**Two contracts move with the code.** `lib/contracts.test.ts` reads `scripts/ingest-cities.mjs` *by path* to assert that the generator of `data/cities-report.md` names `GeoNamesCredit` and no longer says "NOT YET RENDERED IN THE UI". That sentence lives in `buildReport`, so the path in the contract becomes `scripts/cities/report.mjs`; left where it is, the contract would fail with "no longer mentions the credit at all", which is the contract doing its job. And the workflow headers cite `scripts/ingest-<x>.mjs` in prose — updated where a sentence would become false (`refresh-climate.yml:33` names the script's `assertCityParity`), not for the sake of it.

**Import cycles.** The modules point one way: gate, report and io import from facts or build; facts imports picks and curated; nothing imports the entry. The plan verifies with `node --check` on every file, a dry `import()` of every module, and the suite — a cycle between two `const` tables surfaces as a `ReferenceError` on import, not in a test.

**Rejected.** Flat siblings (`scripts/climate-report.mjs`, …): `scripts/` already holds twelve scripts and ten tests, and twenty more files at one level is the shape the rule is against. Re-exporting from the entry: stated above.

### 2.2 `components/map/CountryLevel.tsx`

**Problem.** 1,610 lines, 855 of them documentation — the file everyone who touches the map reads first. Its structure is already in named pieces: a constants block, a pure view builder, a self-contained selection hook, a chain of `useMemo`s that lay the markers out, and an `<svg>` whose three layers are already `<g data-units>`, `<g data-airports>` and `<g data-markers>`.

**Decision.** Eight extractions, each an existing seam:

| New file | Takes | Today |
|---|---|---|
| `components/map/markerGeometry.ts` | the marker geometry constants (`UNIT_STROKE` … `TAP_MIN_R_FALLBACK`, `tapTargetRadius`, `MIN_FRAMED_EXTENT`, `ADMIN1_MAX_ZOOM_K`), `paintedAt`, `labelFor`, `radiusFor` — pure | 133–323, 374–412 |
| `components/map/useRenderedWidth.ts` | the hook | 336–372 |
| `components/map/countryView.ts` | `fromManifest`, `UnitShape`, `UnitFeature`, `CountryView`, `buildCountryView` — pure | 413–549 |
| `components/map/useMarkerSelection.ts` | `MarkerInteractionProps`, `ReadOnlyMarkerProps`, `READ_ONLY_MARKER`, the hook | 550–731 |
| `components/map/markerLayout.ts` | the bodies of the `routePoints`, `points`, `marks`, `fills` and `visible` memos as pure functions; the memos stay in the component as one-liners over them | 995–1131 |
| `components/map/UnitsLayer.tsx` | `<g data-units>` and the national outline over it | 1295–1365 |
| `components/map/AirportLayer.tsx` | the `airportMarks` memo and `<g data-airports>` | 1242–1256, 1366–1393 |
| `components/map/MarkerLayer.tsx` | `<g data-markers>` — the hit circle, dot, label and ring per visible place | 1419–1518 |

`CountryLevel.tsx` keeps its props and their docblock, the state, the memos, the `<svg>` skeleton with the route polyline, `SelectedPlaceCard`, `belowMap` and `CountryPlaceList`: estimated at about 745 lines after the moves (the plan measures it), so the last two extractions are not optional. Importers follow the code, as in §2.1: `CountryMap.test.tsx` takes `TAP_MIN_R_FALLBACK` from `markerGeometry.ts`; `mapTypes.test.tsx`'s `type CountryLevelProps` and `SelectedPlaceCard.test.tsx`'s `CountryLevel` stay where they are.

The `"use client"` directive goes on the three `.tsx` layers, as `WorldPane.tsx` and `RoutePanel.tsx` carry it, and on the two hook files, as `useCountryAssets.ts` does; the pure `.ts` modules do without, as `explorerPlaces.ts` does.

**Contracts.** The eight files join `lib/countryFacts.test.ts`'s `MUST_STAY_CHEAP` list, as PR #30's four did — map surfaces, and the contract is about map surfaces — and so does `CountryLevel.tsx` itself, which the list covered only transitively through `MapExplorer.tsx` until now; its pinned length moves from 13 to 22 in the same commit. `CountryLevel.tsx` names none of the C7 credit contract's tokens today (`MapCity`, `RouteSuggestion`, `destinationNames`, …), so neither will the layers; the plan runs the contract rather than assuming.

**The test.** `CountryLevel.test.tsx` (2,184) splits along its thirteen `describe`s. Its 329-line preamble — the fixtures, the `capCall` spy, the two `vi.mock`s, `renderLevel` and the DOM helpers — moves to `test/countryLevelHarness.tsx` beside `test/mapExplorerHarness.tsx`, for the reason PR #30 found: under `components/` a module that value-imports `CountryLevel` reads to the C7 contract as a second, uncredited mount. The `vi.mock`s apply from the harness (hoistMocksPlugin runs on every module) provided the harness is the first import in each file — the same comment PR #30 left in the four `MapExplorer` tests.

| Test file | `describe` blocks |
|---|---|
| `CountryLevel.test.tsx` | `CountryLevel`, `read-only`, `where L3 would be L2`, `derived climate`, `belowMap slot` |
| `CountryLevel.markers.test.tsx` | `markers`, `zoomed markers` |
| `CountryLevel.zoom.test.tsx` | the two `province zoom` blocks |
| `CountryLevel.airports.test.tsx` | `main airport`, `airport layer`, `airport agreement` |
| `countryView.test.tsx` | `view` — `.test.tsx` because the jsdom project collects only that extension under `components/` |

Test bodies are byte-identical before and after; `paintedAt`'s tests import it from `markerGeometry.ts`.

**Rejected.** Extracting the whole `<svg>` as one `CountryCanvas`: a component with some twenty-five props that is not a seam anyone named. Stopping short of `UnitsLayer` and `MarkerLayer`: about 900 lines, over the ceiling the work exists to meet.

## 3. Stale documentation

**Problem.** `README.md` says "Plan a trip to China … every city in China", lists one ingest script where there are twelve and four workflows, leaves eleven of the 32 API routes out of its table, and says trip state lives in SQLite. `docs/PLAN.md` — which the README names as "Architecture and roadmap" — still has Open-Meteo climate, a static rail matrix and "Deploy to Vercel" as future work; every one shipped or was superseded. Ten specs carry a `**Status:**` line saying "awaiting review" or "implementing" for work merged weeks ago.

**Decision.**

- **`README.md`.** The sections that are wrong are rewritten from the tree: the tagline; Features → Planning (the globe, a map of every country with its provinces, 246 country shards of GeoNames cities beside China's Wikidata catalog and the 16 curated destinations, climate fit colours, the airport layer and trip gateways, country facts and tips); the API table completed from `find app/api -name route.ts`, each route's own docblock the source of its one line; Getting started (the data artifacts are committed — `npm install` and `npm run dev` is a working app; the ingest scripts refresh them; the four workflows and their schedules); the storage sentence deferring to Deploying; Project layout (the tree as it is when the PR merges). The name stays. The sections PR #30 just touched — Deploying, Environment variables — are current and untouched.
- **`docs/PLAN.md`.** Rewritten as the status document it is named as: where things stand (a dated table of what shipped, by PR, from `gh pr list --state merged`); how the planner core works (kept; paths corrected — the wizard is `app/plan/page.tsx`); the data pipeline (the four workflows, six sources, each with the licence its `data/*-report.md` records: GeoNames CC BY 4.0, Wikidata CC0, CHELSA CC0, OurAirports public domain, Natural Earth public domain); and the roadmap that is actually open — content parity (the Wikivoyage extraction, designed 2026-08-27, unbuilt, with its own hand-review and share-alike caveats), Phase 5 flight data (unspecified by design; no free feed), and nothing else. The "never scrape" paragraph stays. `docs/RESEARCH.md` stays as the dated research it is.
- **Spec status lines.** Each `**Status:**` line becomes "shipped — PR #N, merged YYYY-MM-DD" (or "shipped 2026-08-1x, before the repository had pull requests" for the three specs of 10–12 August); the country-guidance and Wikivoyage designs, which have none, gain one — "shipped in PR #21" and "designed, not built — see docs/PLAN.md". The findings and reasoning in every spec are left as written: they are the record.

**Rejected.** Deleting `docs/PLAN.md` and pointing the README at `docs/superpowers/specs/`: sixteen specs are the design record, not a roadmap, and the one question a new reader has — what is left — has no answer there. Rewriting `RESEARCH.md`: it is research, dated, and still true of the sources it surveyed.

**Verification.** Every claim in the two documents is derived from a command or a file the task names — routes from `find`, PRs from `gh`, licences from the reports, counts from `ls | wc -l` — never from memory; the README's API table is cross-checked against the route list by a one-off script the task runs and shows in its report.

## 4. The world level's prefetch of China's assets

**Problem.** `MapExplorer` opens on the world level since PR #29, with `country` still `"CN"` — and `useCountryAssets` is keyed on the country alone, so the moment the step mounts it fetches China's map, for a visitor who is looking at the globe and may never open China. Measured today, gzipped:

| Request | gzipped |
|---|---|
| `/provinces/CN.json` | 23.1 KB |
| `/country-projections.json` | 6.9 KB |
| `/api/map/cities?country=CN` (695 catalog cities with blurbs) | 38.7 KB |
| `/cities/CN.json` | 12.6 KB |
| `/api/map/airports?country=CN` (261 airports) | 9.5 KB |
| **five requests** | **90.8 KB** |

alongside the globe's own `world-globe.json` (40.3 KB gzipped) and its code chunk — the thing the visitor is waiting for. The hook's docblock calls this a prefetch for the default country; that was written when the map opened on China. PR #29 and PR #30 each left it alone as out of scope; neither measured it.

**Decision — fetch only once a country is opened (the owner's choice).** `useCountryAssets(countryCode, hasDetail, enabled)`. Both effects do nothing while `enabled` is false — no fetch, no state change, so the hook's state stays at its initial empties. `MapExplorer` passes `openedCountry`, the render-derived flag it already keeps for the "← All countries" control: false until any country level has shown, true from then on, never back. So at mount on the world level nothing is fetched; a globe pick sets the country and the level in one handler (`pickCountry`), so the first country render runs one fetch round for that country; returning to the world level changes nothing, because the flag stays true and the effects' inputs are unchanged; picking another country changes `countryCode`, which the effects already handle. `retry()` is unchanged. Nothing at the country level changes: the test harness's default level is `"country"`, and every existing country-level test runs as before.

**Why `openedCountry` and not `level !== "world"`.** A flag that flips back would re-run the effects on every return to a country, refetching the same files — cheaply, since the APIs carry `max-age=3600` and the statics revalidate, but for nothing. A one-way latch has no such churn and needs no bookkeeping of what is already loaded.

**What China users pay.** The first open of China's map waits on the same round trip Peru's does — the list-first loading path the level already has (`provinces: null` draws the list; the hook's docblock says the country load "needs no loading state of its own"). The prefetch bought China one round trip; everyone's first paint of the globe was what it cost.

**Verification.** A unit test in `MapExplorer.test.tsx` renders the world level and asserts that no country-scoped URL (`/provinces/`, `/cities/`, `/api/map/`, the manifest) is requested until a country is picked, and that the pick then requests exactly that country's; the two docblocks (`useCountryAssets.ts:114–141`, `MapExplorer.tsx:119–128`) carry the 90.8 KB figure so the question is not reopened without a new number; `e2e/map.spec.ts` gains a `page.on("request")` check that no `/provinces/` request precedes the pick, since that is the one thing jsdom cannot prove about the real bundle; and the browser glance confirms China's map still opens from the A–Z list at desktop and phone widths.

## 5. Shape of the work

Two pull requests, in this order, from one plan:

1. **`chore/unscheduled-items`** — §1, §4 and §3: small, behaviour-changing, reviewable on its own. The README's project layout is written for the tree as it is when this merges.
2. **`chore/split-oversized-files`** — §2: a pure-move PR whose diff is large and whose review is mechanical (byte-identical bodies, the same test count). Its last task updates the README's project layout for the new files.

The behaviour changes ship first because they are the ones a user notices; the split waits so that its review is not also a review of a placeholder. The second branch starts from `main` after the first merges — the repository rebase-merges, and a stacked branch on a fast-moving `main` is a rebase waiting to happen (memory, v14).

## 6. Verification

Per PR: `npx tsc --noEmit`; `npm test` (baseline at PR #30's merge: 140 files, 2,667 passed, 1 expected fail — re-measured at the start of the plan); `npx playwright test` (baseline 20; §1 and §4 add one each); `npx next build`; the browser glance through `.superpowers/sdd/glance` for anything the map draws (§2.2, §4). The split PR additionally: `node --check` and a dry import of every new module, the four ingest scripts' tests by module, and `lib/contracts.test.ts` and `lib/countryFacts.test.ts` green with their pinned counts updated in the same commit that moves the code.

## 7. Out of scope

The Wikivoyage extraction and Phase 5 (roadmap; the owner's decisions). Plan 6's by-design non-builds (province tint, a legend on the trip map, coastal-desert overrides, fit on the list chips). The five test files over 800 lines with no source split. Any change to what the map draws, to the tickets API, or to `docs/RESEARCH.md`. The `.font-kai` stack and the `游` mark.

## 8. Corrections from execution (2026-09-07, PR #31)

Found by this design's own verification; the branch is right and the sections above are left as the dated record.

- **§4 was short by one request and one requester.** The prefetch was six requests, 94.7 KB gzipped — `/cities/enrich/CN.json` (3.9 KB) was missing from the table — and `useCountryAssets` was not the only thing fetching: `PlaceSearch`, the search box beside the map, is live on the globe step scoped to the default country and fetched `/cities/CN.json` on mount, which the e2e caught on the real bundle. It now fetches its shard on the box's first focus or first keystroke (a one-way latch of its own), so search behaves as before and a visitor who never searches pays nothing. Gating it on the opened-country latch was rejected: it would need a second latch in `DestinationStep` and would drop China's shard-only rows from globe-step search. The docblocks carry 94.7 KB.
- **§1's `useMemo`** became a plain computation: it sits below `TripView`'s early returns, where a hook cannot.
- **§3's census** was short by three specs (backlog-clearance, map-timeline-explorer, app-shell-login); every spec carries a status line now, and this one keeps "approved in chat" until it merges.
- **The C7 credit contract** pinned `TripView`'s `destinationNames` occurrences at 2; deriving the placeholders added three. It now counts render sites (`destinationNames.map(`), pin unchanged.
