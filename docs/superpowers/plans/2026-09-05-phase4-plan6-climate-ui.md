# Phase 4 — Plan 6: climate in the UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not tick them in the committed file — this repo leaves plan files untouched during execution.

**Goal:** Every catalog city outside China gets a real month verdict — marker colour, hover label, card label and a `lo°–hi°C typical` line — read from the committed `public/climate/<CC>.json` shards through the model Plan 5 shipped, with the northern-hemisphere season stamp removed, a legend that explains the colours, and an honesty note under the map saying what the derived figures are.

**Architecture:** The fit resolution already has its seams — `fitForPlace(place, month, climate?)` and `DerivedClimateIndex` in `components/map/mapTypes.ts` (Plan 5 Task 5) — so this plan builds the index and threads it. `MapExplorer` fetches the shard as a sixth leg of the country `Promise.all`, joins each row to its city's `elev` from the city shard it already holds (`buildClimateIndex`), and passes the resulting `ReadonlyMap` down to `CountryMap → CountryLevel → SelectedPlaceCard` and to `PlacePopup`. `RouteMap` does the same for the trip map. One resolver, `placeClimateFor`, answers the lo/hi line for both surfaces so China keeps its curated table and everyone else reads the model. Nothing server-side reads climate.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Vitest 4 (node + jsdom projects), Playwright. **No new dependency, no new artifact, no schema change, no migration.**

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) §9.4 (fit colours worldwide), §9.5 (China stays authoritative), §9.6 (the season stamp), §9.7 (honesty surface), §5.3.3 (the card is where the climate line lives), decision D4. This is PR7 in §4.2's table and the last plan of Phase 4. Plan 5 (`2026-08-31-phase4-plan5-climate.md`) shipped the artifact, the loader and the model; its ledger (`.superpowers/sdd/plan5-ledger.md`) hands three things to this plan and every one of them is a task below.

---

## What the research established

### The seams exist and have zero callers

`fitForPlace(place, month, climate?)` (`components/map/mapTypes.ts:219-234`) already resolves curated `bestSeasons` → curated `REGION_MONTHS` → derived row → `unknown`, and gates the China step on `place.country === "CN"` rather than `isChinaPlace` so that no Chinese catalog city can ever reach the derived branch (`mapTypes.test.tsx:375`, "no Chinese catalog city reaches the derived branch, not just the seven"). Every call site in the tree passes **no** index today: `CountryLevel.tsx:1425`, `PlacePopup.tsx:34`, `SelectedPlaceCard.tsx:200`. `DerivedClimateIndex` is `ReadonlyMap<string, { row, elev }>` keyed by `MapPlace.id`, and `MapPlace.id` for a shard city IS the `G`-prefixed GeoNames id (`shardRowToMapCity`, `lib/cityShard.ts:228`) — the same id the climate shard keys on. **The join is by id, and it is already the same id on both sides.**

`fitForRegion` / `DerivedRegionFits` (`mapTypes.ts:246-253`) also has zero callers. Nothing draws a province by fit any more: `CountryLevel` fills every unit `var(--surf-2)` (`CountryLevel.tsx:1249`), and the `FIT_FILL_OPACITY` tint died with `ChinaLevel` in `960a6bd`. `CountryMap.tsx:1-31` still imports `fitForRegion`, `FIT_FILL_OPACITY`, `FIT_COLORS`, `fitForPlace`, `feature`, `REGION_META` and a dozen more it never uses — dead since that commit (`tsconfig.json` sets `strict` but not `noUnusedLocals`, and there is no ESLint config in the repo). Task 5 removes them because it touches that file anyway.

### Elevation is not in the climate row, and it is worth a band

`lib/climateShard.ts`'s docblock: "Elevation is NOT in the row. A consumer that needs it joins `elev` from that same city's `public/cities/<CC>.json` row. 301 of the 58,757 committed rows carry `elev: null`, and a consumer must treat that as no correction." `parseCityShard` (`lib/cityShard.ts:163-167`) already nulls GeoNames' `-9999` sentinel at the read boundary and `lib/climateModel.ts`'s `usableElevation` nulls it again. Measured on the anchors fixture: Cusco (3,312 m) is `great` in June with its elevation and `ok` without (`mapTypes.test.tsx:399`). `MapExplorer` holds the parsed shard rows at the moment it needs them (`MapExplorer.tsx:463-470`, the `shardRes` leg); `RouteMap` holds none and has to fetch the city shard for this one field (Task 9).

### The season stamp reaches the trip map, not the wizard card

Spec §9.6 named `DestinationStep.tsx:473-474` as the stamp's one consumer. That was true of the line and not of the data: `DestinationCard` renders `available`, which is `countryDestinations.filter(...)` — the bundled curated `DESTINATIONS` (`DestinationStep.tsx:76`, `:381`). No catalog or GeoNames destination ever reaches that chip. What the stamp DOES reach, verified by grep of every `bestSeasons` reader:

- `components/trip/RouteMap.tsx:175` copies `destination.bestSeasons` onto the trip map's `MapPlace`, and `fitForPlace` takes a non-empty `bestSeasons` as the first word. **Every resolved GeoNames or catalog stop on a worldwide trip map is therefore `great` in the northern spring and autumn and `ok` otherwise — Sydney included.** That is the fabrication §9.6 exists to remove, and it is live today.
- `/api/destinations/resolve` returns it to any caller (`README.md` calls the app API-first).
- `lib/itinerary.ts:101` reads `Activity.bestSeasons`, not the destination's; `:300` reads `seasonNotes[season]`, stamped `{}`. Neither changes.

`app/plan/page.tsx:217` already stamps `bestSeasons: []` on a hand-typed place, so the empty array is the established "no claim" value — but `fitForPlace` reads `if (place.bestSeasons)`, and `[]` is truthy, so an empty list currently resolves to `"ok"` every month through `monthFitForSeasons`. Task 1 closes that before Task 8 relies on it.

### The two China baselines pin the popup, not the card

`components/map/chinaBaseline.test.tsx` holds two byte-for-byte popup baselines (curated Beijing, catalog Chengdu-province city) captured at `3030f29`, rendered through `PlacePopup` with `country="CN"` and **no** climate index. Plan 5's Task 5 review flagged that this "does not guard the resolution order — re-run it with a populated CN lookup once a caller passes one" (`plan5-ledger.md:17-18`). `public/climate/CN.json` really does carry 412 rows keyed by the same `G` ids `public/cities/CN.json` uses (measured: first id `G1814906`, Chongqing), so a caller that ever passed it would be handing every Chinese catalog city a derived row. Task 10 renders both baselines WITH such a lookup. `MapExplorer` never fetches CN's shard at all (Task 7), so production never builds one; the test guards the future caller.

### Fixture facts, verified against the committed artifacts on 2026-09-05

- `public/cities/PE.json`: Lima `G3936456` (−12.04318, −77.02824, elev 152, pop 7,737,002, a1 "Lima Province"), Cusco `G3941584` (−13.53188, −71.96701, elev 3312, a1 "Cuzco Department"), Callao `G3946083` (elev 5), Trujillo `G3691175` (elev 31), Ica `G3938527` (elev 396), Iquitos `G3696183`. `public/cities/CL.json`: Arica `G3899361` (elev 80).
- `public/climate/PE.json`: 750 rows, `generatedAt` `2026-09-03T19:48:35.466Z`. Lima's row and Cusco's row are byte-identical to `data/climate-anchors.json`'s `lima` and `cusco` entries (`lib/climateShard.test.ts:638` pins that for all ten `G` anchors), so tests read the fixture and never `public/`.
- `data/climate-anchors.json`: 19 cities (9 `Q` anchors, 10 `G` symptoms), each `{ key, name, role, region, elev, row }`. `lib/climateShard.test.ts:655` asserts `gAnchors` `toHaveLength(10)` — Task 10 adds four `G` rows and moves it to 14.
- The raster cache is present on this machine: 61 files, 10 GB, at `%TEMP%\cip-chelsa` (`CIP_CHELSA_CACHE`). `scripts/sample-climate-anchors.mjs` reads its `SYMPTOMS` list (`:108-119`) with `{ key, cc, id, why }` and takes coordinates and `elev` from the committed city shard.
- Verdicts at the default month, October (`MapExplorer.tsx`'s `DEFAULT_MONTH = 10`), computed with `KNOBS`: Cusco `great` (hi 16 + 4 °C elevation warming = 20, cold 0.18; cloud 49 → 0.13; total ≈ 0.31), Lima `great` (total ≈ 0.18). June: Cusco `great` with elevation, `ok` without. Tests below compute expectations through `monthFit` rather than hard-coding these, but the numbers say which fixture choices make a test meaningful.
- `FIT_COLORS`: great `#2f7d54`, ok `#b98a2f`, poor `#8f9bab`, avoid `#c93b2e`, unknown `#8a939f` (`mapTypes.ts:269-275`). `FIT_LABELS.unknown` is `"No data"`.
- The world level's country list is a `<select>` labelled **"Or pick from the list"** (`worldLevelShared.tsx:320-340`); the step-up control at country level reads **"← All countries"** (`MapExplorer.tsx:789`). `GapNote` renders `role="note"` with `aria-label="About these notes"` (`components/plan/GapNote.tsx:36-38`).

### Test plumbing this plan reuses

- `MapExplorer.test.tsx`: `defaultFetch(url)` answer table (`:488-549`), `Harness` (`:660-700`), `settle()`, `requested(path)`, `PE_SHARD` (`:194-224`, Lima and Cusco, **no `elev` field today**).
- `CountryLevel.test.tsx`: `renderLevel(over)` (`:192`), `place()`, `LIMA`/`CUSCO`/`ISLA`, `airportNear()`, `circleFor(container, id, attr)` (`:239`), the airport-line tests at `:1715-1778`.
- `SelectedPlaceCard.test.tsx`: `cardProps(over)` (`:105`), the slot test at `:181`.
- `PlacePopup.test.tsx`: `place()`, `show(subject, country = "CN", month = 10)` (`:39-49`).
- `mapTypes.test.tsx`: `city(over)` (`:186`), `anchor(key)` (`:209`), `JUNE = 6`.
- `RouteMap.test.tsx`: `CUSCO` destination (`:42-58`), `PERU_TRIP`, `tripFetch(url)` (`:319-325`), `stubFetch`, `settle()`, `requestedUrls()`, `renderPeru()`.
- `chinaBaseline.test.tsx`: `CHINA_PLACES`, `CHINA_MONTH`, `CHINA_BASELINE_MARKUP.popupCurated` / `.popupCatalog`.

---

## Decisions this plan takes

| # | Decision | Why |
|---|---|---|
| P6-1 | **No province tint.** `fitForRegion` and `DerivedRegionFits` stay as they are, uncalled. | Nothing draws a unit by fit today; the tint left with `ChinaLevel` in `960a6bd`. Spec §9.4 asks for fit *colours* (pins), and an aggregation policy — mean penalty, modal band, population weighting — is a design question §9.4 never answered. Building one would be a fourth surface with no spec. |
| P6-2 | **A legend comes back.** `FitLegend` lists the five existing bands under any drawn country map. | `MapExplorer.tsx:374` and `:832` still describe "the legend beside it" — China had one and lost it with `ChinaLevel`. Fit colours worldwide with no key is a map only its author can read. Five existing swatches, no new band, no `FIT_COLORS` change, no contrast re-audit: §9.4's constraints hold. The trip map gets no legend — its pins are all the trip's own stops. |
| P6-3 | **Coastal-desert climates are presented honestly, not specially.** The §9.7 note's own sentence — "coastal fog and monsoon timing are not modelled" — is the presentation. No per-city override table. | Plan 5 escalated that CHELSA `clt` inverts Lima's seasons and no stored signal can mark its winter down (the `test.fails` tripwire at `lib/climateModel.test.ts:128`). A curated list of coastal exceptions would be a second hand-authored climate table, which is the thing §9.5 says only China has earned. The four coastal cities the tripwire's rationale cites go into the fixture instead (Task 10), so the inversion is data rather than a comment. |
| P6-4 | **The trip map takes the feed.** `RouteMap` fetches the trip country's climate shard and city shard (for `elev`) and passes the index down. | Removing the stamp (§9.6) turns every worldwide trip stop from a fabricated green to grey; §4.2 calls this PR "fit colours worldwide", and a trip map that disagrees with the wizard about Cusco's June is the class of defect this project keeps finding. Cost: two cached static fetches on the trip page. |
| P6-5 | **China's shard is never fetched.** Both `MapExplorer` and `RouteMap` skip the climate leg when the country is `CLIMATE_COUNTRY`. | `fitForPlace` ignores a derived row for any CN place (§9.5), so CN's 412 rows would be 20 KB per map open that nothing reads. |
| P6-6 | **An empty `bestSeasons` is no claim.** `fitForPlace` reads a curated season only from a non-empty list. | `[]` is what `app/plan/page.tsx:217` already stamps and what Task 8 makes `lib/server/catalog.ts` stamp; today it resolves to `"ok"` every month, which is a verdict nobody gave. |

---

## Global Constraints

- **The type surface is unchanged** (spec §9.4): no new band, no `FIT_COLORS` change, no new legend swatch, no contrast re-audit. `MonthFit`, `RegionMonthClimate`, `FIT_COLORS`, `FIT_LABELS`, `FIT_FILL_OPACITY` are not edited.
- **Rows are calendar-indexed, January at 0, both hemispheres** (spec §9.4). `fitForPlace` and `placeClimateFor` take a 1-based month and pass `month - 1` to `lib/climateModel.ts`. `seasonIn` is never applied to a row index.
- **Curated China wins, by construction** (spec §9.5): the China step is gated on `place.country === CLIMATE_COUNTRY`, never on `isChinaPlace`, and a derived row for a Chinese place is ignored. `chinaBaseline.test.tsx`'s two popup baselines stay byte-identical, including with a populated CN lookup (Task 10).
- **Fit resolution stays synchronous over rows already in hand** (`mapTypes.ts` docblock on `DerivedClimateIndex`): rows arrive by `fetch` in a component effect and are passed down as a `ReadonlyMap`; no callback, no fetch at render.
- **`elev: null` is no correction, never `-9999`** (`lib/climateShard.ts` docblock): elevation is joined from the parsed city shard row, which already nulls the sentinel.
- **Nothing server-side reads climate** (spec §9.3): `public/` is unreadable from a Vercel lambda. No file under `lib/server/` or `app/api/` imports `lib/climateShard.ts` or `lib/climateModel.ts`.
- **`GapNote` takes lines, never a country code** (spec §9.7, `GapNote.tsx` docblock): the note text is built by a leaf, and the component "must not resolve the climate artifact itself, and it renders nothing for China".
- **The CC0 non-additions hold** (spec §9.1): no `ChelsaCredit` component, no climate token in `lib/contracts.test.ts`'s C7 list; `lib/climateShard.test.ts:770-806` enforces this and stays green.
- **`MUST_STAY_CHEAP` holds** (`lib/countryFacts.test.ts:917`): `MapExplorer.tsx`, `PlacePopup.tsx` and `RouteMap.tsx` must not reach `lib/countryFacts.ts`. The new imports — `lib/climateShard.ts` (→ `lib/countries.ts`), `lib/climateNote.ts` (leaf), `components/map/climateIndex.ts`, `components/plan/GapNote.tsx` (leaf) — reach nothing under `lib/server/` or the facts artifact.
- **Vitest projects split by extension:** `.test.ts` under `lib/` and `scripts/` runs in node; `.test.tsx` under `components/` and `lib/` runs in jsdom. **A `.test.ts` under `components/` runs nowhere** — every new components-side test in this plan is `.test.tsx`.
- **`lib/` never imports `components/`.** `DerivedClimateIndex` lives in `components/map/mapTypes.ts`, so the index builder lives beside it in `components/map/`, and `lib/climateNote.ts` restates the `"CN"` literal with a cross-module test that it agrees with `CLIMATE_COUNTRY`.
- Every new control is a real 44 CSS px target: `inline-flex min-h-[var(--tap-min)] items-center`. This plan adds **no** control — the legend and the note are static — and `e2e/tap-targets.spec.ts` stays green without edits.
- Commit messages: conventional commits, body explaining why, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run `npx tsc --noEmit` before every commit; it must be clean. Run the touched test files before every commit; `npm test` before the PR (expect 1 `test.fails` — the Lima tripwire — and 0 failures).
- Branch: `feat/phase4-plan6-climate-ui` from `main` at `d4b0a90`. Do not push until the PR step; rebase-merge like every Phase 4 PR.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `components/map/mapTypes.ts` | `fitForPlace` empty-list guard; `PlaceClimate` + `placeClimateFor` (the lo/hi resolver); `FIT_ORDER` | Modify |
| `components/map/mapTypes.test.tsx` | jsdom | Modify |
| `components/map/climateIndex.ts` | **new** — `buildClimateIndex(shard, cities)`, `NO_CLIMATE` | Create |
| `components/map/climateIndex.test.tsx` | jsdom | Create |
| `lib/climateNote.ts` | **new leaf** — `DERIVED_CLIMATE_NOTE`, `climateGapNote(country, derivedRows)` | Create |
| `lib/climateNote.test.ts` | node | Create |
| `components/map/PlacePopup.tsx` | `climate` prop; reads `placeClimateFor` | Modify |
| `components/map/PlacePopup.test.tsx` | jsdom | Modify |
| `components/map/SelectedPlaceCard.tsx` | `climate` prop for the fit chip | Modify |
| `components/map/SelectedPlaceCard.test.tsx` | jsdom | Modify |
| `components/map/CountryLevel.tsx` | `climate` prop; marker colour; card line `[data-climate]` | Modify |
| `components/map/CountryLevel.test.tsx` | jsdom | Modify |
| `components/map/CountryMap.tsx` | threads `climate`; dead imports removed | Modify |
| `components/map/CountryMap.test.tsx` | jsdom | Modify |
| `components/map/FitLegend.tsx` | **new** — the five-band key | Create |
| `components/map/FitLegend.test.tsx` | jsdom | Create |
| `components/map/MapExplorer.tsx` | sixth fetch leg, index state, legend, note, threading | Modify |
| `components/map/MapExplorer.test.tsx` | jsdom | Modify |
| `lib/server/catalog.ts` | §9.6: `bestSeasons: []` at `:367` and `:400` | Modify |
| `lib/server/catalog.test.ts` | node | Modify |
| `components/trip/RouteMap.tsx` | climate + city shard fetch, index, threading | Modify |
| `components/trip/RouteMap.test.tsx` | jsdom; fixture loses the stamp | Modify |
| `components/map/chinaBaseline.test.tsx` | the populated-CN-lookup re-run | Modify |
| `scripts/sample-climate-anchors.mjs` | four coastal symptom cities | Modify |
| `data/climate-anchors.json` | regenerated: 23 cities | Modify (generated) |
| `lib/climateModel.test.ts` | the coast-wide inversion, pinned on fixture rows | Modify |
| `lib/climateShard.test.ts` | anchor count 10 → 14 | Modify |
| `e2e/climate.spec.ts` | browser proof, signed-in | Create |
| `playwright.config.ts` | `chromium` project also matches the new spec | Modify |

---

### Task 1: The lo/hi resolver, the empty-list guard, and the band order

**Files:**
- Modify: `components/map/mapTypes.ts:1-2` (imports), `:219-234` (`fitForPlace`), append after `originLineFor`
- Test: `components/map/mapTypes.test.tsx`

**Interfaces:**
- Consumes: `climateMonth(row, month0)` from `lib/climateModel.ts`; `regionMonthClimate(region, month1)` from `lib/months.ts`; the file's own `CLIMATE_COUNTRY`, `isChinaRegion`, `DerivedClimateIndex`.
- Produces: `interface PlaceClimate { lo: number; hi: number; note?: string; source: "curated" | "derived" }`; `placeClimateFor(place: MapPlace, month: number, climate?: DerivedClimateIndex): PlaceClimate | null`; `FIT_ORDER: readonly MonthFit[]`; `fitForPlace` unchanged in signature, but `bestSeasons: []` now falls through.

- [ ] **Step 1: Write the failing tests**

Append to `components/map/mapTypes.test.tsx`. Add `climateMonth` to the existing `@/lib/climateModel` import, `monthFitForSeasons` to the `@/lib/months` import, and `FIT_COLORS`, `FIT_ORDER`, `placeClimateFor` to the `./mapTypes` import. Add `import { climateGapNote } from "@/lib/climateNote";` — Task 3 creates it; until then this one test fails to compile, which is the RED it is meant to show.

```tsx
/**
 * The lo/hi line's one resolver. `PlacePopup` used to hold this decision
 * inline (`isChinaPlace(place) && isChinaRegion(place.region) ?
 * regionMonthClimate(...) : null`); §5.3.3's card is a second surface making
 * the same claim, and two copies would drift on the first change to either.
 */
describe("placeClimateFor", () => {
  const OCTOBER = 10;

  test("a Chinese place in one of the seven reads the curated table, note included", () => {
    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    const expected = REGION_MONTHS.North[OCTOBER - 1];
    expect(placeClimateFor(beijing, OCTOBER)).toEqual({
      lo: expected.lo,
      hi: expected.hi,
      note: expected.note,
      source: "curated",
    });
  });

  test("a Chinese place never reads a derived row — inside the seven or outside them", () => {
    // Mianyang's real shard row: admin-1 "Sichuan", which is not one of the
    // seven. The row in the lookup is the one a caller that fetched CN.json
    // would hand over, and §9.5 says it is ignored.
    const mianyang = city({
      id: "G1800627",
      name: "Mianyang",
      country: "CN",
      province: "Sichuan",
      region: "Sichuan",
    });
    expect(placeClimateFor(mianyang, OCTOBER, new Map([[mianyang.id, anchor("chengdu")]]))).toBeNull();

    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    const withRow = placeClimateFor(beijing, OCTOBER, new Map([[beijing.id, anchor("beijing")]]));
    expect(withRow?.source).toBe("curated");
    expect(withRow?.lo).toBe(REGION_MONTHS.North[OCTOBER - 1].lo);
  });

  test("a place outside China reads its derived row, calendar-indexed from January at 0", () => {
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    const row = anchor("cusco");
    const june = climateMonth(row.row, JUNE - 1);
    expect(placeClimateFor(cusco, JUNE, new Map([[cusco.id, row]]))).toEqual({
      lo: june.lo,
      hi: june.hi,
      source: "derived",
    });
    // Integers, straight off the row: spec §9.4 — the popup interpolates
    // these unformatted, so a float here would render as `8.437°`.
    expect(Number.isInteger(june.lo) && Number.isInteger(june.hi)).toBe(true);
  });

  test("no row, no line — and an admin-1 name that spells like China's is still not China", () => {
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    expect(placeClimateFor(cusco, JUNE)).toBeNull();
    expect(placeClimateFor(cusco, JUNE, new Map())).toBeNull();
    // Botswana's Central District, the collision commit 1407502 fixed at the
    // place level: no China row, and with no derived row, nothing at all.
    const serowe = city({ id: "G933366", name: "Serowe", country: "BW", region: "Central" });
    expect(placeClimateFor(serowe, JUNE)).toBeNull();
  });

  test("a month outside 1-12 throws on both branches, as fitForPlace does", () => {
    const beijing = city({ id: "Q956", name: "Beijing", country: "CN", region: "North" });
    expect(() => placeClimateFor(beijing, 13)).toThrow();
    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco" });
    expect(() => placeClimateFor(cusco, 0, new Map([[cusco.id, anchor("cusco")]]))).toThrow();
  });
});

describe("an empty bestSeasons is no claim", () => {
  test("falls through to the derived row, and to unknown without one", () => {
    // `[]` is what app/plan/page.tsx stamps on a hand-typed place and what
    // lib/server/catalog.ts stamps on every catalog and GeoNames destination
    // since §9.6. It used to read as "ok" in every month — a verdict nobody
    // gave — because `[]` is truthy and `monthFitForSeasons` answers "ok" for
    // any season outside an empty list.
    expect(monthFitForSeasons({ bestSeasons: [] }, JUNE)).toBe("ok");

    const cusco = city({ id: "G3941584", name: "Cusco", country: "PE", region: "Cusco", bestSeasons: [] });
    const row = anchor("cusco");
    expect(fitForPlace(cusco, JUNE)).toBe(NEUTRAL_FIT);
    expect(fitForPlace(cusco, JUNE, new Map([[cusco.id, row]]))).toBe(monthFit(row.row, row.elev, JUNE - 1));
  });

  test("a non-empty list is still the first word", () => {
    const beijing = city({
      id: "D-beijing",
      name: "Beijing",
      country: "CN",
      kind: "curated",
      level: "curated",
      region: "North",
      bestSeasons: ["autumn"],
    });
    expect(fitForPlace(beijing, 10)).toBe("great");
    expect(fitForPlace(beijing, JUNE)).toBe("ok");
  });
});

describe("FIT_ORDER", () => {
  test("names every band exactly once, best first and absence last", () => {
    expect([...FIT_ORDER].sort()).toEqual(Object.keys(FIT_COLORS).sort());
    expect(new Set(FIT_ORDER).size).toBe(FIT_ORDER.length);
    expect(FIT_ORDER[0]).toBe("great");
    expect(FIT_ORDER[FIT_ORDER.length - 1]).toBe("unknown");
  });
});

describe("the honesty note agrees with the fit resolution about which country is curated", () => {
  test("lib/climateNote's China is mapTypes' China", () => {
    // Two literals, two layers: lib/ cannot import components/, so
    // lib/climateNote.ts restates "CN". This is the one place they meet.
    expect(climateGapNote(CLIMATE_COUNTRY, 412)).toEqual([]);
    expect(climateGapNote("PE", 750)).toHaveLength(1);
  });
});
```

`CLIMATE_COUNTRY` must be added to the `./mapTypes` import in the test if it is not already imported there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/mapTypes.test.tsx`
Expected: FAIL — `placeClimateFor`, `FIT_ORDER` are not exported; `@/lib/climateNote` does not resolve; "falls through to the derived row" fails with `expected "ok" to be "unknown"`.

- [ ] **Step 3: Write the implementation**

In `components/map/mapTypes.ts`, change the first two imports to:

```ts
import { climateMonth, monthFit } from "@/lib/climateModel";
import { monthFitForSeasons, regionMonthClimate, REGION_MONTHS, type MonthFit } from "@/lib/months";
```

Replace the body of `fitForPlace` (`:219-234`) with:

```ts
export function fitForPlace(
  place: MapPlace,
  month: number,
  climate?: DerivedClimateIndex
): MonthFit {
  // A non-empty list, not a truthy one. `[]` is the established "nobody has
  // said" value — app/plan/page.tsx stamps it on a hand-typed place and
  // lib/server/catalog.ts on every catalog and GeoNames destination (§9.6) —
  // and `monthFitForSeasons` answers "ok" for any season outside an empty
  // list, which is a verdict nobody gave.
  const seasons = place.bestSeasons;
  if (seasons !== undefined && seasons.length > 0) {
    return monthFitForSeasons({ bestSeasons: seasons, avoidSeasons: place.avoidSeasons }, month);
  }
  if (place.country === CLIMATE_COUNTRY) return regionFit(place.region, month);
  const derived = climate?.get(place.id);
  // `month` is 1-based here and the model is calendar-indexed from 0 (§9.4).
  return derived === undefined ? NEUTRAL_FIT : monthFit(derived.row, derived.elev, month - 1);
}
```

Append after `originLineFor`:

```ts
/**
 * What a surface says the weather typically is: the `lo°–hi°C typical` line
 * on `PlacePopup` and on `SelectedPlaceCard` (§5.3.3).
 *
 * `note` is the curated table's editorial one-liner ("Blossom season",
 * "'Furnace city' heat"); a derived row never has one — the model produces a
 * band, not prose. `source` is carried so a surface can say which it is
 * showing without re-deriving the decision below.
 */
export interface PlaceClimate {
  lo: number;
  hi: number;
  note?: string;
  source: "curated" | "derived";
}

/**
 * The one resolver for that line, on the same gate `fitForPlace` uses.
 *
 * Lifted out of `PlacePopup` when the card became a second surface making the
 * same claim, for the reason `originLineFor` gives: two copies drift on the
 * first change to either. The order is `fitForPlace`'s, minus the curated
 * `bestSeasons` step — a season claim carries no temperatures — so a Chinese
 * place reads `REGION_MONTHS` or nothing, and every other place reads its
 * derived row or nothing. A Chinese place outside the seven gets `null`, not a
 * derived row, however many rows the caller holds (§9.5): `public/climate/
 * CN.json` really does carry 412 rows keyed by the same ids, and ignoring
 * them is the whole point of the gate.
 *
 * A month outside 1–12 throws on both branches, exactly as `fitForPlace`
 * does: `REGION_MONTHS[region][12]` is `undefined` and `.lo` on it is a
 * TypeError, and `climateMonth` refuses the index outright.
 */
export function placeClimateFor(
  place: MapPlace,
  month: number,
  climate?: DerivedClimateIndex
): PlaceClimate | null {
  if (place.country === CLIMATE_COUNTRY) {
    if (!isChinaRegion(place.region)) return null;
    const row = regionMonthClimate(place.region, month);
    return { lo: row.lo, hi: row.hi, note: row.note, source: "curated" };
  }
  const derived = climate?.get(place.id);
  if (derived === undefined) return null;
  const { lo, hi } = climateMonth(derived.row, month - 1);
  return { lo, hi, source: "derived" };
}

/**
 * The bands in the order a legend reads them: best first, the absence marker
 * last. A list rather than `Object.keys(FIT_COLORS)`, because object key
 * order is an accident of declaration and a legend's order is a decision.
 * `mapTypes.test.tsx` pins that the two name the same set.
 */
export const FIT_ORDER: readonly MonthFit[] = ["great", "ok", "poor", "avoid", "unknown"];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/map/mapTypes.test.tsx`
Expected: every test in the file passes except "lib/climateNote's China is mapTypes' China", which still cannot resolve `@/lib/climateNote` (Task 3 lands it). Also run `npx vitest run components/map/chinaBaseline.test.tsx components/map/PlacePopup.test.tsx` — PASS: the guard changes nothing for a curated place with a non-empty list.

- [ ] **Step 5: Commit**

```bash
git add components/map/mapTypes.ts components/map/mapTypes.test.tsx
git commit -m "feat: resolve the climate line once, and read an empty season list as no claim" -m "placeClimateFor is the one resolver for the lo/hi line both the popup and the card will render (spec 5.3.3), on fitForPlace's own China gate so a derived row for a Chinese place is ignored (9.5). fitForPlace now takes a curated season only from a NON-EMPTY bestSeasons: [] is what app/plan/page.tsx already stamps and what catalog.ts is about to (9.6), and a truthy empty array resolved to ok every month. FIT_ORDER fixes the legend's reading order.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The commit will not typecheck against `@/lib/climateNote` in the test file until Task 3 — run `npx tsc --noEmit` and confirm the only error is that missing module, then commit; Task 3's commit clears it. If you would rather keep every commit clean, move the last `describe` into Task 3's step 1 instead.

---

### Task 2: The join — `buildClimateIndex`

**Files:**
- Create: `components/map/climateIndex.ts`
- Test: `components/map/climateIndex.test.tsx`

**Interfaces:**
- Consumes: `ClimateShard` (`lib/climateShard.ts`: `{ country, generatedAt, source, cities: ReadonlyMap<string, ClimateRow> }`); `CityShardRow` (`lib/cityShard.ts`: `{ id, n, lat, lon, a1, a1c, p, elev: number | null, tz }`); `DerivedClimate`, `DerivedClimateIndex` (`./mapTypes`).
- Produces: `NO_CLIMATE: DerivedClimateIndex` (one shared empty `Map`); `buildClimateIndex(shard: ClimateShard | null, cities: readonly Pick<CityShardRow, "id" | "elev">[]): DerivedClimateIndex`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/map/climateIndex.test.tsx
import { describe, expect, test } from "vitest";
import fixture from "@/data/climate-anchors.json";
import { monthFit } from "@/lib/climateModel";
import { GEONAMES_NO_DATA_ELEVATION, parseCityShard, type CityShardRow } from "@/lib/cityShard";
import { parseClimateShard } from "@/lib/climateShard";
import { buildClimateIndex, NO_CLIMATE } from "./climateIndex";
import { fitForPlace, NEUTRAL_FIT, type MapPlace } from "./mapTypes";

/**
 * `.test.tsx` because `components/**\/*.test.ts` matches NO vitest project —
 * the module is components-local (it returns `mapTypes.DerivedClimateIndex`,
 * and lib/ cannot import components/), so this is its home.
 */

const row = (key: string): number[] => {
  const found = fixture.cities.find((c) => c.key === key);
  if (!found) throw new Error(`data/climate-anchors.json has no city "${key}"`);
  return found.row;
};

const LIMA = "G3936456";
const CUSCO = "G3941584";

/** Two real rows under their real ids, through the real parser. */
const PE_CLIMATE = parseClimateShard(
  {
    country: "PE",
    generatedAt: "2026-09-03T19:48:35.466Z",
    source: "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228",
    cities: { [LIMA]: row("lima"), [CUSCO]: row("cusco") },
  },
  "PE"
);

/** The city rows those ids join to, in the shape the shard parser hands out. */
function cityRows(elevations: Record<string, unknown>): CityShardRow[] {
  return parseCityShard(
    {
      country: "PE",
      generatedAt: "2026-08-25T09:23:00.949Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities: Object.entries(elevations).map(([id, elev]) => ({
        id,
        n: id === LIMA ? "Lima" : "Cusco",
        lat: id === LIMA ? -12.04318 : -13.53188,
        lon: id === LIMA ? -77.02824 : -71.96701,
        a1: id === LIMA ? "Lima Province" : "Cuzco Department",
        a1c: id === LIMA ? "PE.15" : "PE.08",
        p: id === LIMA ? 7_737_002 : 428_450,
        elev,
        tz: "America/Lima",
      })),
    },
    "PE"
  ).cities;
}

const cusco: MapPlace = {
  id: CUSCO,
  kind: "catalog",
  name: "Cusco",
  localName: null,
  province: "Cuzco Department",
  country: "PE",
  region: "Cuzco Department",
  lat: -13.53188,
  lon: -71.96701,
  population: 428_450,
  level: "prefecture",
  attractionCount: 0,
  blurb: null,
};

const JUNE = 6;

describe("buildClimateIndex", () => {
  test("joins every climate row to its city's elevation, by id", () => {
    const index = buildClimateIndex(PE_CLIMATE, cityRows({ [LIMA]: 152, [CUSCO]: 3312 }));
    expect(index.size).toBe(2);
    expect(index.get(CUSCO)).toEqual({ row: row("cusco"), elev: 3312 });
    expect(index.get(LIMA)).toEqual({ row: row("lima"), elev: 152 });
  });

  test("a climate row whose city is not in the shard gets no correction, not a guess", () => {
    // The drift case lib/climateShard.test.ts bounds: the nightly cities
    // refresh can drop a city the climate artifact still carries. Its row is
    // kept — an id the map never draws costs nothing — with `elev: null`,
    // which lib/climateModel.ts reads as "apply no lapse-rate correction".
    const index = buildClimateIndex(PE_CLIMATE, cityRows({ [LIMA]: 152 }));
    expect(index.get(CUSCO)).toEqual({ row: row("cusco"), elev: null });
    expect(index.get(LIMA)?.elev).toBe(152);
  });

  test("a null elevation stays null, and the -9999 sentinel never reaches the index", () => {
    // 301 committed rows carry `elev: null`; shards written before 2026-09-03
    // carried -9999 there, and a browser cache can still serve one. The city
    // parser nulls the sentinel at the boundary, so this proves the pipeline
    // rather than re-implementing the guard here.
    const index = buildClimateIndex(
      PE_CLIMATE,
      cityRows({ [LIMA]: null, [CUSCO]: GEONAMES_NO_DATA_ELEVATION })
    );
    expect(index.get(LIMA)?.elev).toBeNull();
    expect(index.get(CUSCO)?.elev).toBeNull();
  });

  test("no shard, or an empty one, is the one shared empty index", () => {
    // Referentially the same value every time, so a component can hold it as
    // a default prop and a `useMemo` keyed on it never re-fires for "still
    // nothing".
    expect(buildClimateIndex(null, cityRows({ [LIMA]: 152 }))).toBe(NO_CLIMATE);
    const empty = parseClimateShard(
      { country: "PE", generatedAt: "2026-09-03T19:48:35.466Z", source: "CHELSA", cities: {} },
      "PE"
    );
    expect(buildClimateIndex(empty, cityRows({ [LIMA]: 152 }))).toBe(NO_CLIMATE);
    expect(NO_CLIMATE.size).toBe(0);
  });

  test("is exactly what fitForPlace reads, elevation and all", () => {
    const withElevation = buildClimateIndex(PE_CLIMATE, cityRows({ [CUSCO]: 3312 }));
    const without = buildClimateIndex(PE_CLIMATE, cityRows({}));
    // Armed: the two verdicts differ, so the join is observable through the
    // resolver and not just through `.get`.
    expect(monthFit(row("cusco"), 3312, JUNE - 1)).toBe("great");
    expect(monthFit(row("cusco"), null, JUNE - 1)).toBe("ok");
    expect(fitForPlace(cusco, JUNE, withElevation)).toBe("great");
    expect(fitForPlace(cusco, JUNE, without)).toBe("ok");
    expect(fitForPlace(cusco, JUNE, NO_CLIMATE)).toBe(NEUTRAL_FIT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/map/climateIndex.test.tsx`
Expected: FAIL — `Cannot find module './climateIndex'`.

- [ ] **Step 3: Write the implementation**

```ts
// components/map/climateIndex.ts
import type { CityShardRow } from "@/lib/cityShard";
import type { ClimateShard } from "@/lib/climateShard";
import type { DerivedClimate, DerivedClimateIndex } from "./mapTypes";

/**
 * The join between the two artifacts a derived verdict needs.
 *
 * `public/climate/<CC>.json` carries the 60-int row and `public/cities/
 * <CC>.json` carries the elevation, keyed by the same `G`-prefixed GeoNames
 * id — `lib/climateShard.ts`'s docblock: "Elevation is NOT in the row. A
 * consumer that needs it joins `elev` from that same city's row." This is
 * that consumer, and the only one: `MapExplorer` and `RouteMap` both build
 * their index here, so the two maps cannot disagree about what a row is.
 *
 * Here and not in lib/, because the value it returns is
 * `mapTypes.DerivedClimateIndex` and lib/ never imports components/.
 *
 * Pure. It reads the parsed shapes and never a raw file, so the `-9999`
 * elevation sentinel cannot reach it — `parseCityShard` nulls it at the
 * boundary — and `usableElevation` in the model nulls it again on the way
 * out. A city absent from `cities` gets `elev: null`, which the model reads
 * as "no lapse-rate correction": the honest answer, and the one the 301
 * committed `elev: null` rows already get.
 */

/**
 * The empty index, as one shared value.
 *
 * A default prop written `climate = new Map()` allocates on every render and
 * defeats any `useMemo` keyed on it — the same reason `CountryLevel` holds
 * `NO_AIRPORTS` as a module constant rather than `airports = []`.
 */
export const NO_CLIMATE: DerivedClimateIndex = new Map();

export function buildClimateIndex(
  shard: ClimateShard | null,
  cities: readonly Pick<CityShardRow, "id" | "elev">[]
): DerivedClimateIndex {
  if (shard === null || shard.cities.size === 0) return NO_CLIMATE;
  const elevations = new Map<string, number | null>();
  for (const city of cities) elevations.set(city.id, city.elev);
  const index = new Map<string, DerivedClimate>();
  for (const [id, row] of shard.cities) {
    index.set(id, { row, elev: elevations.get(id) ?? null });
  }
  return index;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/map/climateIndex.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add components/map/climateIndex.ts components/map/climateIndex.test.tsx
git commit -m "feat: join the climate shard to the city shard's elevations" -m "buildClimateIndex is the one consumer lib/climateShard.ts's docblock describes: it keys the 60-int rows by the same G id public/cities/ uses and joins elev from the parsed city row, null when the city is absent so the model applies no correction. Both map surfaces will build their index here, so they cannot disagree about what a row is.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The honesty note's lines — `lib/climateNote.ts`

**Files:**
- Create: `lib/climateNote.ts`
- Test: `lib/climateNote.test.ts`

**Interfaces:**
- Consumes: nothing (a leaf).
- Produces: `DERIVED_CLIMATE_NOTE: string`; `climateGapNote(country: string, derivedRows: number): string[]` — `[]` for China or for no derived rows, else `[DERIVED_CLIMATE_NOTE]`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/climateNote.test.ts
import { describe, expect, test } from "vitest";
import { climateGapNote, DERIVED_CLIMATE_NOTE } from "./climateNote";

describe("climateGapNote", () => {
  test("renders nothing for China, whose climate is hand-authored, however it is spelled", () => {
    for (const code of ["CN", "cn", " cn "]) {
      expect(climateGapNote(code, 412), code).toEqual([]);
    }
  });

  test("renders nothing where no derived row was read", () => {
    // A country whose climate file 404s, or one whose shard has not landed
    // yet: grey pins carry no claim, so there is nothing to be honest about.
    expect(climateGapNote("PE", 0)).toEqual([]);
    expect(climateGapNote("PE", -1)).toEqual([]);
    expect(climateGapNote("PE", Number.NaN)).toEqual([]);
  });

  test("says what the derived figures are, in the spec's own words", () => {
    const lines = climateGapNote("PE", 750);
    expect(lines).toEqual([DERIVED_CLIMATE_NOTE]);
    // §9.7, verbatim: the three claims a reader needs to weigh a grey-to-green
    // pin — grid not station, the mountain bias, and what is not modelled.
    expect(DERIVED_CLIMATE_NOTE).toContain("1981–2010 grid normals sampled at each city, not station records");
    expect(DERIVED_CLIMATE_NOTE).toContain("above 2,000 m typically read about 3–4 °C colder");
    expect(DERIVED_CLIMATE_NOTE).toContain("coastal fog and monsoon timing are not modelled");
  });

  test("a fresh array each call", () => {
    // GapNote keys its paragraphs on the line text and never mutates, but a
    // shared array is a shared array: the same policy every profile table in
    // lib/countryBaseProfile.ts takes.
    expect(climateGapNote("PE", 1)).not.toBe(climateGapNote("PE", 1));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/climateNote.test.ts`
Expected: FAIL — `Cannot find module './climateNote'`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/climateNote.ts
/**
 * Spec §9.7's honesty surface, as lines for `components/plan/GapNote.tsx`.
 *
 * `GapNote` takes `string[]` rather than a country code so it drags no data
 * module into any bundle, and the spec is explicit that "it must not resolve
 * the climate artifact itself, and it renders nothing for China". So the
 * decision is made here, from two facts the caller already holds — which
 * country is open, and how many derived rows it is drawing — and the
 * component is handed the answer.
 *
 * One paragraph, deliberately: it is a footnote under a map, not a second
 * tip list, and `GapNote` renders each line as its own `<p>`.
 */
export const DERIVED_CLIMATE_NOTE =
  "Temperatures are 1981–2010 grid normals sampled at each city, not station records. " +
  "Mountain towns above 2,000 m typically read about 3–4 °C colder than they are, and " +
  "coastal fog and monsoon timing are not modelled.";

/**
 * The one country whose month table is hand-authored (`lib/months.ts`'s
 * `REGION_MONTHS`) and whose pins therefore carry a curated claim rather than
 * a derived one. Restates `components/map/mapTypes.ts`'s `CLIMATE_COUNTRY`
 * because lib/ cannot import components/; `mapTypes.test.tsx` pins that the
 * two agree.
 */
const CURATED_CLIMATE_COUNTRY = "CN";

/**
 * `[]` for China, and `[]` where no derived row was read — a country whose
 * climate file 404s draws grey pins, and grey is the absence of a claim, so
 * there is nothing to qualify. Otherwise the one paragraph above.
 */
export function climateGapNote(country: string, derivedRows: number): string[] {
  if (country.trim().toUpperCase() === CURATED_CLIMATE_COUNTRY) return [];
  if (!Number.isFinite(derivedRows) || derivedRows <= 0) return [];
  return [DERIVED_CLIMATE_NOTE];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/climateNote.test.ts components/map/mapTypes.test.tsx`
Expected: PASS — including Task 1's cross-module test. Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add lib/climateNote.ts lib/climateNote.test.ts
git commit -m "feat: the derived-climate honesty note, as lines for GapNote" -m "Spec 9.7's paragraph, built by a leaf from the two facts the map already holds - which country is open and how many derived rows it drew - so GapNote keeps taking strings and never resolves the artifact itself. Empty for China, whose table is curated, and empty where nothing derived was read.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The hover card reads the index

**Files:**
- Modify: `components/map/PlacePopup.tsx:1-53` (imports, `Props`, the two resolutions) and the two JSX reads of `climate`
- Test: `components/map/PlacePopup.test.tsx`

**Interfaces:**
- Consumes: `placeClimateFor`, `fitForPlace(place, month, climate)`, `DerivedClimateIndex` (Task 1).
- Produces: `PlacePopup` gains `climate?: DerivedClimateIndex`. Markup is unchanged byte for byte when the prop is absent — `chinaBaseline.test.tsx` is the proof.

- [ ] **Step 1: Write the failing tests**

In `components/map/PlacePopup.test.tsx`, add the imports:

```tsx
import fixture from "@/data/climate-anchors.json";
import { climateMonth, monthFit } from "@/lib/climateModel";
import { FIT_LABELS, type DerivedClimateIndex, type MapPlace } from "./mapTypes";
```

(`MapPlace` is already imported; merge rather than duplicate.) Widen `show` to take the index:

```tsx
function show(subject: MapPlace, country = "CN", month = 10, climate?: DerivedClimateIndex) {
  return render(
    <PlacePopup
      place={subject}
      month={month}
      position={{ x: 100, y: 100 }}
      containerWidth={640}
      country={country}
      climate={climate}
    />
  );
}
```

Append:

```tsx
/**
 * The derived half of the climate row. The China-only tests above are kept
 * as they are: this surface still reads `REGION_MONTHS` for a Chinese place,
 * and `chinaBaseline.test.tsx` pins that output byte for byte.
 */
describe("PlacePopup — the derived climate row", () => {
  const JUNE = 6;
  const cuscoRow = fixture.cities.find((c) => c.key === "cusco")!.row;
  const cusco = () =>
    place({ id: "G3941584", name: "Cusco", province: "Cuzco Department", region: "Cuzco Department" });

  test("reads a derived row for a place outside China — the verdict and the temperatures", () => {
    const subject = cusco();
    const climate: DerivedClimateIndex = new Map([[subject.id, { row: cuscoRow, elev: 3312 }]]);
    const { container } = show(subject, "PE", JUNE, climate);

    const june = climateMonth(cuscoRow, JUNE - 1);
    expect(container.textContent).toContain(`${june.lo}°–${june.hi}°C typical`);
    expect(screen.getByText(FIT_LABELS[monthFit(cuscoRow, 3312, JUNE - 1)])).toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  test("the elevation it was handed reaches the verdict", () => {
    // Cusco at 3,312 m is `great` in June and `ok` without the lapse-rate
    // correction (mapTypes.test.tsx pins the model); the label on the card
    // has to move with it, or the popup is reading the row and not the pair.
    const subject = cusco();
    expect(monthFit(cuscoRow, 3312, JUNE - 1)).not.toBe(monthFit(cuscoRow, null, JUNE - 1));
    show(subject, "PE", JUNE, new Map([[subject.id, { row: cuscoRow, elev: null }]]));
    expect(screen.getByText(FIT_LABELS[monthFit(cuscoRow, null, JUNE - 1)])).toBeInTheDocument();
  });

  test("a Chinese place ignores a derived row, inside the seven and outside them", () => {
    // Mianyang: admin-1 "Sichuan", not one of the seven, with a row in the
    // lookup. §9.5 — no derived read for any CN place.
    const mianyang = place({
      id: "G1800627",
      name: "Mianyang",
      country: "CN",
      province: "Sichuan",
      region: "Sichuan",
    });
    const { container } = show(mianyang, "CN", 10, new Map([[mianyang.id, { row: cuscoRow, elev: 500 }]]));
    expect(container.textContent).not.toContain("typical");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  test("still degrades to no row for a place the lookup does not hold", () => {
    const { container } = show(cusco(), "PE", JUNE, new Map());
    expect(container.textContent).not.toContain("typical");
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/PlacePopup.test.tsx`
Expected: FAIL — the four new tests: no `typical` text and `No data` rendered where a verdict was expected (the prop is silently ignored today; TypeScript will also reject the unknown `climate` prop under `tsc`).

- [ ] **Step 3: Write the implementation**

In `components/map/PlacePopup.tsx`, replace the imports with:

```tsx
import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { bandsIn, highlightFor } from "@/lib/months";
import {
  FIT_COLORS,
  FIT_LABELS,
  fitForPlace,
  formatPopulation,
  originLineFor,
  placeClimateFor,
  type DerivedClimateIndex,
  type MapPlace,
} from "./mapTypes";
```

Add to `Props`, after `country: string;`:

```tsx
  /**
   * The open country's derived climate, keyed by `MapPlace.id` (§9.4), for
   * every place whose country is not China. Optional: the trip map's markers
   * have no hover card, and every caller before Plan 6 passed nothing. A
   * Chinese place never reads it (§9.5) — `chinaBaseline.test.tsx` renders
   * this component with and without one and pins the same bytes.
   */
  climate?: DerivedClimateIndex;
```

Replace the head of the component body (from `const profile` through the `climate` const) with:

```tsx
export function PlacePopup({ place, month, position, containerWidth, country, climate }: Props) {
  const profile = getCountryBaseProfile(country);
  const fit = fitForPlace(place, month, climate);
  // Curated for a Chinese place in one of the seven, derived for a place
  // outside China with a row in the lookup, nothing otherwise — one resolver
  // shared with `SelectedPlaceCard`, so the two surfaces cannot disagree.
  // Keyed off the place's own country, not the open one: Botswana's Central
  // District is spelled exactly like one of China's seven.
  const typical = placeClimateFor(place, month, climate);
```

Then rename the two JSX reads: `{climate && (` → `{typical && (`, `{climate.lo}°–{climate.hi}°C typical` → `{typical.lo}°–{typical.hi}°C typical`, and `{climate?.note && !seasonNote && (` → `{typical?.note && !seasonNote && (` with `{climate.note}` → `{typical.note}`. Nothing else in the file changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/map/PlacePopup.test.tsx components/map/chinaBaseline.test.tsx`
Expected: PASS — all popup tests, and both China popup baselines still byte-identical. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add components/map/PlacePopup.tsx components/map/PlacePopup.test.tsx
git commit -m "feat: let the hover card read a derived climate row" -m "PlacePopup takes the open country's index and resolves both the verdict and the lo/hi line through the shared resolvers, so a Peruvian city hovers with its own temperatures instead of No data. A Chinese place still reads the curated table and never the row; the China popup baselines are unchanged byte for byte.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The card, the markers, and the dispatcher

**Files:**
- Modify: `components/map/SelectedPlaceCard.tsx:53-92` (props), `:149` (the fit)
- Modify: `components/map/CountryLevel.tsx:7-29` (imports), `:731-815` (props), `:817-830` (destructure), `:1170-1173` (beside `mainAirport`), `:1425` (marker fill), `:1477-1531` (the card)
- Modify: `components/map/CountryMap.tsx:1-32` (imports), `:56-61` (dead types), `:91-145` (props), `:147-185` (threading)
- Test: `components/map/SelectedPlaceCard.test.tsx`, `components/map/CountryLevel.test.tsx`, `components/map/CountryMap.test.tsx`

**Interfaces:**
- Consumes: `NO_CLIMATE` (Task 2); `placeClimateFor`, `DerivedClimateIndex` (Task 1).
- Produces: `SelectedPlaceCard` gains `climate?: DerivedClimateIndex`; `CountryLevelProps` and `CountryMapProps` gain `climate?: DerivedClimateIndex` (default `NO_CLIMATE`); the card's facts slot renders `<p data-climate="">{lo}°–{hi}°C typical</p>` as its first child when there is a row.

- [ ] **Step 1: Write the failing tests**

`components/map/SelectedPlaceCard.test.tsx` — add imports `import fixture from "@/data/climate-anchors.json";`, `import { monthFit } from "@/lib/climateModel";`, and `FIT_LABELS`, `type MapPlace` from `./mapTypes` (merge with existing imports). Append inside the first `describe` (the one holding "has a slot for the climate and airport lines"):

```tsx
  test("the fit chip reads the derived verdict when the level hands it the index", () => {
    // The chip and the marker it opened from must agree. The level colours
    // the marker through `fitForPlace(place, month, climate)`; a card that
    // called `fitForPlace(place, month)` would say "No data" over a green pin.
    const row = fixture.cities.find((c) => c.key === "cusco")!;
    const cusco: MapPlace = {
      id: "G3941584",
      kind: "catalog",
      name: "Cusco",
      localName: null,
      province: "Cuzco Department",
      country: "PE",
      region: "Cuzco Department",
      lat: -13.53188,
      lon: -71.96701,
      population: 428_450,
      level: "prefecture",
      attractionCount: 0,
      blurb: null,
    };
    const JUNE = 6;

    const withIndex = render(
      <SelectedPlaceCard
        {...cardProps({ place: cusco, month: JUNE })}
        climate={new Map([[cusco.id, { row: row.row, elev: row.elev }]])}
      />
    );
    expect(withIndex.getByText(FIT_LABELS[monthFit(row.row, row.elev, JUNE - 1)])).toBeInTheDocument();
    expect(withIndex.queryByText("No data")).not.toBeInTheDocument();
    withIndex.unmount();

    const without = render(<SelectedPlaceCard {...cardProps({ place: cusco, month: JUNE })} />);
    expect(without.getByText("No data")).toBeInTheDocument();
  });
```

`components/map/CountryLevel.test.tsx` — add imports `import fixture from "@/data/climate-anchors.json";`, `import { climateMonth, monthFit } from "@/lib/climateModel";`, `import { REGION_MONTHS } from "@/lib/months";`, and `FIT_COLORS`, `FIT_LABELS`, `type DerivedClimateIndex` from `./mapTypes` (merge with the existing `type MapPlace` import). Append:

```tsx
/**
 * §9.4's fit colours, worldwide: the marker reads the index the level was
 * handed, and §5.3.3's card carries the climate line in the slot Plan 3
 * reserved — above the airport line, because the weather is the thing the
 * verdict beside it is about.
 */
describe("CountryLevel derived climate", () => {
  const JUNE = 6;
  const CUSCO_ROW = fixture.cities.find((c) => c.key === "cusco")!.row;
  const climate: DerivedClimateIndex = new Map([[CUSCO.id, { row: CUSCO_ROW, elev: 3312 }]]);
  const cuscoJune = monthFit(CUSCO_ROW, 3312, JUNE - 1);

  test("colours a marker by its derived verdict, and leaves a place with no row grey", () => {
    const { container } = renderLevel({ climate, month: JUNE });
    // Armed: the verdict is not the absence colour, so a level that ignored
    // the index would fail on Cusco and not merely agree on Lima.
    expect(FIT_COLORS[cuscoJune]).not.toBe(FIT_COLORS.unknown);
    expect(circleFor(container, "cusco", "data-dot").getAttribute("fill")).toBe(FIT_COLORS[cuscoJune]);
    expect(circleFor(container, "lima", "data-dot").getAttribute("fill")).toBe(FIT_COLORS.unknown);
  });

  test("the card carries the climate line, above the airport line, and its chip agrees with the marker", () => {
    const { container } = renderLevel({
      climate,
      month: JUNE,
      airports: [airportNear(CUSCO, "CUZ", 30)],
    });
    fireEvent.click(container.querySelector('[data-place="cusco"]')!);

    const june = climateMonth(CUSCO_ROW, JUNE - 1);
    const facts = container.querySelector("[data-place-facts]")!;
    expect(facts.querySelector("[data-climate]")!.textContent).toBe(`${june.lo}°–${june.hi}°C typical`);
    expect(facts.firstElementChild).toHaveAttribute("data-climate");
    expect(facts.lastElementChild).toHaveAttribute("data-main-airport");
    expect(screen.getByRole("dialog", { name: "Cusco" }).textContent).toContain(FIT_LABELS[cuscoJune]);
  });

  test("no row, no line — the slot stays empty rather than blank", () => {
    const { container } = renderLevel({ climate, month: JUNE });
    fireEvent.click(container.querySelector('[data-place="lima"]')!);
    expect(screen.getByRole("dialog", { name: "Lima" })).toBeInTheDocument();
    expect(container.querySelector("[data-climate]")).toBeNull();
    expect(container.querySelector("[data-place-facts]")!.textContent).toBe("");
  });

  test("a Chinese place reads the curated table on the card and the marker, never a derived row", () => {
    // Drawn on Peru's fixture geometry, which is fine: the place's OWN
    // country decides which table it reads, not the level's (RouteMap is
    // multi-country). The row in the lookup is real and is ignored (§9.5).
    const beijing = place({ id: "beijing", name: "Beijing", country: "CN", region: "North", lon: -78, lat: -12 });
    const { container } = renderLevel({
      places: [beijing],
      climate: new Map([[beijing.id, { row: CUSCO_ROW, elev: 3312 }]]),
      month: 10,
    });
    const october = REGION_MONTHS.North[9];
    expect(circleFor(container, "beijing", "data-dot").getAttribute("fill")).toBe(FIT_COLORS[october.fit]);
    fireEvent.click(container.querySelector('[data-place="beijing"]')!);
    expect(container.querySelector("[data-climate]")!.textContent).toBe(`${october.lo}°–${october.hi}°C typical`);
  });
});
```

`components/map/CountryMap.test.tsx` — add imports `import fixture from "@/data/climate-anchors.json";`, `import { monthFit } from "@/lib/climateModel";`, `import type { ProjectionEntry } from "@/lib/countryProjection";`, `import { PE_ENTRY, PE_FILE } from "./countryFixture";` and `FIT_COLORS`, `type MapPlace` from `./mapTypes` (merge with whatever the file already imports). Append:

```tsx
describe("CountryMap threads the climate index", () => {
  test("the level it draws reads the index the dispatcher was handed", () => {
    const row = fixture.cities.find((c) => c.key === "cusco")!.row;
    const cusco: MapPlace = {
      id: "G3941584",
      kind: "catalog",
      name: "Cusco",
      localName: null,
      province: "Cuzco Department",
      country: "PE",
      region: "Cuzco Department",
      lat: -13.53188,
      lon: -71.96701,
      population: 428_450,
      level: "prefecture",
      attractionCount: 0,
      blurb: null,
    };
    const { container } = render(
      <CountryMap
        country="PE"
        provinces={PE_FILE}
        projection={PE_ENTRY as ProjectionEntry}
        places={[cusco]}
        selected={[]}
        month={6}
        zoomRegion={null}
        routeIds={[]}
        climate={new Map([[cusco.id, { row, elev: 3312 }]])}
        onZoomRegion={() => {}}
        onTogglePlace={() => {}}
        onHoverPlace={() => {}}
      />
    );
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS[monthFit(row, 3312, 5)]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/SelectedPlaceCard.test.tsx components/map/CountryLevel.test.tsx components/map/CountryMap.test.tsx`
Expected: FAIL — the new tests: markers grey, no `[data-climate]`, chip says "No data" (and `tsc` rejects the unknown `climate` prop on all three components).

- [ ] **Step 3: Write the implementation**

**`components/map/SelectedPlaceCard.tsx`.** Add `type DerivedClimateIndex` to the `./mapTypes` import. Add to `SelectedPlaceCardProps`, before `children`:

```tsx
  /**
   * The open country's derived climate, keyed by `MapPlace.id`, so the fit
   * chip agrees with the marker this card opened from — `CountryLevel`
   * colours that marker through `fitForPlace(place, month, climate)`, and a
   * chip that resolved without the index would read "No data" over a green
   * pin. Optional for the same reason the marker's is: a level with none
   * draws every non-China place grey, and the chip should say so too.
   */
  climate?: DerivedClimateIndex;
```

Destructure `climate` in the component signature and change `const fit = fitForPlace(place, month);` to `const fit = fitForPlace(place, month, climate);`.

**`components/map/CountryLevel.tsx`.** Change the `./mapTypes` import to:

```tsx
import { FIT_COLORS, fitForPlace, placeClimateFor, type DerivedClimateIndex, type MapPlace } from "./mapTypes";
```

and add `import { NO_CLIMATE } from "./climateIndex";`. Add to `CountryLevelProps`, after `showAirports?: boolean;`:

```tsx
  /**
   * The open country's derived climate (§9.4), keyed by `MapPlace.id`: what
   * colours every marker outside China and fills the card's climate line.
   *
   * Built by the caller from two fetches it already makes — the climate
   * shard and the city shard's elevations (`buildClimateIndex`) — and passed
   * down already in hand, so the fit resolution stays synchronous over rows
   * the component holds. Never a callback: `mapTypes.ts`'s docblock on
   * `DerivedClimateIndex` is the rule.
   *
   * Optional, defaulting to the shared empty index: `RouteMap` builds its
   * own, and a level with none is the correct render for a country whose
   * file has not landed yet — grey pins, no line, no claim. A Chinese place
   * never reads it however full it is (§9.5): `fitForPlace` and
   * `placeClimateFor` both gate on the place's own country.
   */
  climate?: DerivedClimateIndex;
```

Destructure `climate = NO_CLIMATE,` after `showAirports = false,`. After the `mainAirport` memo (`:1170-1173`) add:

```tsx
  /**
   * The card's climate line (§5.3.3, "where the climate lo/hi line lives"):
   * the curated table for a Chinese place in one of the seven, the derived
   * row for anyone else who has one, nothing otherwise. Cheap enough to
   * resolve per render — one Map lookup and five array reads.
   */
  const cardClimate = cardPlace === null ? null : placeClimateFor(cardPlace, month, climate);
```

Change the marker fill at `:1425` to `fill={FIT_COLORS[fitForPlace(place, month, climate)]}`. In the `<SelectedPlaceCard>` element add the prop `climate={climate}` (after `selected=`), and put this as the FIRST child of the card, above the `{mainAirport && (...)}` block:

```tsx
            {/*
              The weather the verdict beside it is about, in the same words the
              hover card uses. Above the airport line because it is the fact a
              reader opened the card to check; absent rather than "no data"
              because the wrapper is `empty:hidden` and the chip already says
              "No data" when there is none.
            */}
            {cardClimate && (
              <p data-climate="">
                {cardClimate.lo}°–{cardClimate.hi}°C typical
              </p>
            )}
```

**`components/map/CountryMap.tsx`.** Replace lines 1–31 (the `"use client"` line through the `./mapTypes` import) with:

```tsx
"use client";

import type { Airport } from "@/lib/airports";
import type { ProjectionEntry } from "@/lib/countryProjection";
import type { ProvinceFile } from "@/lib/provinceTopology";
import type { RegionId } from "@/lib/regionScheme";
import { CountryLevel } from "./CountryLevel";
import { CountryPlaceList } from "./CountryPlaceList";
import type { HoverPos } from "./mapShared";
import type { DerivedClimateIndex, MapPlace } from "./mapTypes";
```

Delete the unused `ProvinceProps` interface and `ProvinceFeature` type (`:56-61`) — both were `ChinaLevel`'s, dead since `960a6bd`, and nothing else in the file or its tests names them (`npx tsc --noEmit` is the check). Add to `CountryMapProps`, after `showAirports?: boolean;`:

```tsx
  /**
   * The open country's derived climate, for `CountryLevel`'s markers and its
   * card's climate line (§9.4). Threaded, not held: `MapExplorer` and
   * `RouteMap` each build their own from the fetches they already make.
   * Optional because the list-only branch below has no marker to colour.
   */
  climate?: DerivedClimateIndex;
```

Destructure `climate,` after `showAirports,` and pass `climate={climate}` to `<CountryLevel>` after `showAirports={showAirports}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/map/SelectedPlaceCard.test.tsx components/map/CountryLevel.test.tsx components/map/CountryMap.test.tsx components/map/chinaBaseline.test.tsx`
Expected: PASS. `npx tsc --noEmit` clean — which is also the proof that the dispatcher's removed imports were dead.

- [ ] **Step 5: Commit**

```bash
git add components/map/SelectedPlaceCard.tsx components/map/SelectedPlaceCard.test.tsx components/map/CountryLevel.tsx components/map/CountryLevel.test.tsx components/map/CountryMap.tsx components/map/CountryMap.test.tsx
git commit -m "feat: colour every marker by its derived verdict, and put the climate line on the card" -m "CountryLevel takes the open country's index: the marker reads it through fitForPlace, the card's chip reads the same index so it cannot disagree with the pin it opened from, and the lo/hi line lands in the slot Plan 3 reserved (spec 5.3.3), above the airport line. A Chinese place still reads the curated table (9.5). CountryMap threads the prop and drops the ChinaLevel-era imports nothing has used since 960a6bd.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The legend

**Files:**
- Create: `components/map/FitLegend.tsx`
- Test: `components/map/FitLegend.test.tsx`
- Modify: `components/map/MapExplorer.tsx` (import; one line after the map wrap `</div>` at `:907`)
- Test: `components/map/MapExplorer.test.tsx`

**Interfaces:**
- Consumes: `FIT_COLORS`, `FIT_LABELS`, `FIT_ORDER` (Task 1).
- Produces: `FIT_LEGEND_LABEL = "What the marker colours mean"`; `FitLegend()` — a `<ul role="list" aria-label={FIT_LEGEND_LABEL}>` of five `<li>`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/map/FitLegend.test.tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { FitLegend, FIT_LEGEND_LABEL } from "./FitLegend";
import { FIT_COLORS, FIT_LABELS, FIT_ORDER } from "./mapTypes";

afterEach(cleanup);

/**
 * Decision P6-2: the key China's map used to have, back for every country
 * now that the colours mean something everywhere. Five existing bands, no
 * new swatch, no `FIT_COLORS` change (§9.4).
 */
describe("FitLegend", () => {
  test("lists every band once, in FIT_ORDER, with its own swatch", () => {
    render(<FitLegend />);
    const list = screen.getByRole("list", { name: FIT_LEGEND_LABEL });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.trim())).toEqual(FIT_ORDER.map((fit) => FIT_LABELS[fit]));
    items.forEach((li, i) => {
      const swatch = li.querySelector("span[aria-hidden]") as HTMLElement | null;
      expect(swatch, FIT_ORDER[i]).not.toBeNull();
      expect(swatch!.style.backgroundColor).toBe(hex2rgb(FIT_COLORS[FIT_ORDER[i]]));
    });
  });

  test("is a key and not a control — nothing in it is operable", () => {
    // The tap-target sweep (e2e/tap-targets.spec.ts) counts every control the
    // map panel owns; a legend that rendered buttons would add five 20px ones.
    const { container } = render(<FitLegend />);
    expect(container.querySelectorAll("button, a, input, select, [tabindex]")).toHaveLength(0);
  });
});

/** jsdom normalises an inline hex colour to `rgb(r, g, b)`. */
function hex2rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
```

In `components/map/MapExplorer.test.tsx`, add `import { FIT_LEGEND_LABEL } from "./FitLegend";` and append:

```tsx
describe("the legend", () => {
  test("appears under a drawn country map", async () => {
    render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of Peru" })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: FIT_LEGEND_LABEL });
    expect(legend.textContent).toContain("Great time");
    expect(legend.textContent).toContain("No data");
  });

  test("does not appear over the list-only fallback, which has no colours to read", async () => {
    // "It reads the marker colours, so it appears only where there are
    // markers to read" — the rule this file's own comments have carried since
    // the China legend it describes was lost with ChinaLevel.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url) === "/provinces/PE.json"
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : defaultFetch(String(url))
      )
    );
    render(<Harness country="PE" />);
    await settle();
    expect(screen.queryByRole("group", { name: "Map of Peru" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: FIT_LEGEND_LABEL })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/FitLegend.test.tsx components/map/MapExplorer.test.tsx -t "legend"`
Expected: FAIL — `Cannot find module './FitLegend'`.

- [ ] **Step 3: Write the implementation**

```tsx
// components/map/FitLegend.tsx
"use client";

import { FIT_COLORS, FIT_LABELS, FIT_ORDER } from "./mapTypes";

/**
 * The key to the marker colours.
 *
 * China's map had one until `ChinaLevel` was retired in 960a6bd, and
 * `MapExplorer` still describes it — "it reads the marker colours, so it
 * appears only where there are markers to read". Now that every country's
 * pins carry a verdict (§9.4), a map with five colours and no key is one
 * only its author can read.
 *
 * Five existing bands in `FIT_ORDER`, drawn from `FIT_COLORS` and
 * `FIT_LABELS` and nothing else: no new swatch, no colour change, so §9.4's
 * "no contrast re-audit" holds — these are the solid swatches the audit in
 * `mapTypes.ts` was run on.
 *
 * `role="list"` beside the element for the reason `MapExplorer`'s route list
 * gives: Tailwind's preflight strips list markers and Safari/VoiceOver then
 * drop the implicit role, so a labelled list without it is announced as a
 * bare group. Nothing here is operable — a key is not a control, and the
 * tap-target sweep counts controls.
 */
export const FIT_LEGEND_LABEL = "What the marker colours mean";

export function FitLegend() {
  return (
    <ul
      role="list"
      aria-label={FIT_LEGEND_LABEL}
      className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]"
    >
      {FIT_ORDER.map((fit) => (
        <li key={fit} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: FIT_COLORS[fit] }}
          />
          {FIT_LABELS[fit]}
        </li>
      ))}
    </ul>
  );
}
```

In `components/map/MapExplorer.tsx`, add `import { FitLegend } from "./FitLegend";` beside the other `./` imports, and directly after the map wrap's closing `</div>` (the one that closes `<div ref={mapWrapRef} className="relative mt-3">`, just before `{caption && (`) add:

```tsx
      {/*
        The key, under the map it explains. Gated on the geometry rather than
        on the climate: a country whose climate file 404s still draws grey
        pins, and "No data" is a colour the reader needs explained too.
      */}
      {provinces !== null && <FitLegend />}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/map/FitLegend.test.tsx components/map/MapExplorer.test.tsx`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add components/map/FitLegend.tsx components/map/FitLegend.test.tsx components/map/MapExplorer.tsx components/map/MapExplorer.test.tsx
git commit -m "feat: bring the marker-colour legend back, for every country" -m "China's map had a key until ChinaLevel went; with fit colours worldwide (spec 9.4) every map needs one. Five existing bands from FIT_COLORS and FIT_LABELS in FIT_ORDER - no new swatch, no colour change, nothing operable - drawn under any country whose geometry loaded.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `MapExplorer` fetches the shard, builds the index, and says what it is

**Files:**
- Modify: `components/map/MapExplorer.tsx` — imports (`:1-38`), state after `showAirports` (`:277`), the country effect (`:419-510`), `<CountryMap>` (`:873-898`), `<PlacePopup>` (`:899-906`), and one element after `{caption && (...)}` (`:909-913`)
- Test: `components/map/MapExplorer.test.tsx`

**Interfaces:**
- Consumes: `fetchClimateShard(country, fetchImpl)` (`lib/climateShard.ts` — note it takes a `fetchImpl`, not a signal); `buildClimateIndex`, `NO_CLIMATE` (Task 2); `climateGapNote` (Task 3); `GapNote` (`components/plan/GapNote.tsx`); `CLIMATE_COUNTRY`, `DerivedClimateIndex` (`./mapTypes`).
- Produces: `MapExplorer` holds `climate: DerivedClimateIndex` state, passes it to `CountryMap` and `PlacePopup`, and renders `<GapNote lines={climateGapNote(countryCode, climate.size)} />` under the map.

- [ ] **Step 1: Write the failing tests**

In `components/map/MapExplorer.test.tsx`:

Add imports:

```tsx
import fixture from "@/data/climate-anchors.json";
import { climateMonth, monthFit } from "@/lib/climateModel";
import { DERIVED_CLIMATE_NOTE } from "@/lib/climateNote";
import { FIT_COLORS } from "./mapTypes";
```

(`./mapTypes` may already be imported for `type MapPlace`; merge.)

Give `PE_SHARD`'s two rows their real elevations — add `elev: 152,` to Lima's row and `elev: 3312,` to Cusco's (after `p:`), and extend the fixture's docblock with: "`elev` is the field §9.4's lapse-rate correction reads; Cusco's 3,312 m is worth a whole band."

Add, after `DE_SHARD`:

```tsx
const anchorRow = (key: string): number[] => {
  const found = fixture.cities.find((c) => c.key === key);
  if (!found) throw new Error(`data/climate-anchors.json has no city "${key}"`);
  return found.row;
};

/**
 * Peru's climate shard, cut to the two cities `PE_SHARD` carries. The rows
 * are the anchors fixture's, which `lib/climateShard.test.ts` pins
 * byte-identical to the committed `public/climate/PE.json`, so what the map
 * colours here is what it colours in production.
 */
const PE_CLIMATE = {
  country: "PE",
  generatedAt: "2026-09-03T19:48:35.466Z",
  source: "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228",
  cities: { G3936456: anchorRow("lima"), G3941584: anchorRow("cusco") },
};
```

In `defaultFetch`, replace the tail of the ternary chain — the three lines

```tsx
                    : href.startsWith("/cities/")
                      ? null
                      : WORLD_FIXTURE;
```

with

```tsx
                    : href === "/climate/PE.json"
                      ? PE_CLIMATE
                      // Every other country's climate file 404s — the honest
                      // answer for the four codes with no shard, and the shape
                      // a country takes between a catalog refresh and the next
                      // climate dispatch.
                      : href.startsWith("/climate/")
                        ? null
                        : href.startsWith("/cities/")
                          ? null
                          : WORLD_FIXTURE;
```

Append:

```tsx
/**
 * §9.4's fit colours worldwide, on the wire and on the pins. The model and
 * the join are pinned in their own files; what this pins is the effect —
 * which file is asked for, for whom, and what the marker under the cursor
 * ends up reading.
 */
describe("derived climate", () => {
  /** `MapExplorer`'s DEFAULT_MONTH. */
  const OCTOBER = 10;
  const CUSCO_ROW = anchorRow("cusco");
  const NOTE = { name: "About these notes" };

  test("fetches the open country's climate file", async () => {
    render(<Harness country="PE" />);
    await settle();
    expect(requested("/climate/PE.json")).toBe(true);
  });

  test("never fetches China's — nothing would read it", async () => {
    // `fitForPlace` ignores a derived row for any CN place (§9.5), and CN.json
    // is 412 rows the map would download on every open for nothing.
    render(<Harness country="CN" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of China" })).toBeInTheDocument();
    expect(requested("/climate/CN.json")).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/climate/"))).toBe(false);
  });

  test("colours a marker by the verdict the model gives its row and its elevation", async () => {
    const { container } = render(<Harness country="PE" />);
    await settle();
    const expected = FIT_COLORS[monthFit(CUSCO_ROW, 3312, OCTOBER - 1)];
    // Armed twice: the verdict is a colour and not the absence grey, and the
    // elevation changes it — so a map that dropped the join would fail here
    // rather than agree by accident.
    expect(expected).not.toBe(FIT_COLORS.unknown);
    expect(monthFit(CUSCO_ROW, 3312, OCTOBER - 1)).not.toBe(monthFit(CUSCO_ROW, null, OCTOBER - 1));
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(expected);
  });

  test("the elevation comes from the city shard, not from the climate row", async () => {
    // The same shard with the elevations withheld: the row is identical, so
    // only the join can move the colour.
    const noElevations = {
      ...PE_SHARD,
      cities: PE_SHARD.cities.map(({ elev: _elev, ...row }) => row),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url) === "/cities/PE.json"
          ? Promise.resolve({ ok: true, status: 200, json: async () => noElevations })
          : defaultFetch(String(url))
      )
    );
    const { container } = render(<Harness country="PE" />);
    await settle();
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS[monthFit(CUSCO_ROW, null, OCTOBER - 1)]);
  });

  test("the hover card reads the same index as the marker", async () => {
    const { container } = render(<Harness country="PE" />);
    await settle();
    // React's onMouseEnter is delivered from mouseover; testing-library's
    // `mouseEnter` fires both. The position is client pixels the reporter
    // measures against a zero rect in jsdom, which only moves the card.
    fireEvent.mouseEnter(container.querySelector('[data-place="G3941584"]')!, {
      clientX: 300,
      clientY: 200,
    });
    const october = climateMonth(CUSCO_ROW, OCTOBER - 1);
    expect(screen.getByRole("tooltip").textContent).toContain(`${october.lo}°–${october.hi}°C typical`);
  });

  test("a country whose climate file 404s draws grey pins and makes no claim", async () => {
    const { container } = render(<Harness country="DE" />);
    await settle();
    expect(requested("/climate/DE.json")).toBe(true);
    expect(
      container.querySelector('[data-place="G2950159"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS.unknown);
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });

  test("says what the derived figures are, under a derived map and never under China's", async () => {
    render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("note", NOTE).textContent).toContain(DERIVED_CLIMATE_NOTE);
    cleanup();

    render(<Harness country="CN" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of China" })).toBeInTheDocument();
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });

  test("the index belongs to the country it was fetched for", async () => {
    // A PE→DE switch: Peru's rows must not colour Germany's cities, and the
    // note that was true of Peru is a claim about a country the user left.
    const view = render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("note", NOTE)).toBeInTheDocument();

    view.rerender(<Harness country="DE" />);
    await settle();
    expect(screen.getByRole("group", { name: "Map of Germany" })).toBeInTheDocument();
    expect(view.container.querySelector('[data-place="G3941584"]')).toBeNull();
    expect(
      view.container.querySelector('[data-place="G2950159"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS.unknown);
    expect(screen.queryByRole("note", NOTE)).not.toBeInTheDocument();
  });
});
```

`fireEvent` and `cleanup` are already imported from `@testing-library/react` in this file; if `fireEvent` is not, add it. The `DE_SHARD` row id `G2950159` (Berlin) and the "Map of Germany" name come from the file's existing DE fixture and `lib/countries.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/MapExplorer.test.tsx -t "derived climate"`
Expected: FAIL — no `/climate/PE.json` request, grey Cusco, no note, no `typical` in the tooltip.

- [ ] **Step 3: Write the implementation**

In `components/map/MapExplorer.tsx`:

Add imports (keep the file's grouping — `@/` modules first, then `./`):

```tsx
import { GapNote } from "@/components/plan/GapNote";
import { climateGapNote } from "@/lib/climateNote";
import { fetchClimateShard } from "@/lib/climateShard";
import { buildClimateIndex, NO_CLIMATE } from "./climateIndex";
```

and change the `./mapTypes` import to `import { CLIMATE_COUNTRY, type DerivedClimateIndex, type MapPlace } from "./mapTypes";`.

After the `showAirports` state (`:277`) add:

```tsx
  /**
   * The open country's derived climate (§9.4): every shard row joined to its
   * city's elevation, keyed by `MapPlace.id`. What colours the markers
   * outside China, what the hover card and the selected-place card read
   * their `lo°–hi°C typical` line from, and what the honesty note under the
   * map is about.
   *
   * Built once per country load, in the effect below, from two of the legs
   * it already runs — the climate shard and the city shard's `elev` — and
   * never at render: `mapTypes.ts`'s rule is that the fit resolution stays
   * synchronous over rows already in hand. `NO_CLIMATE` rather than a fresh
   * `Map` so "nothing yet" is one referentially stable value.
   */
  const [climate, setClimate] = useState<DerivedClimateIndex>(NO_CLIMATE);
```

In the country effect, add `setClimate(NO_CLIMATE);` to the up-front clears (after `setProjection(null);`), with the comment: `// Peru's rows left in place across a switch would colour Germany's cities.` Add a sixth leg to the `Promise.all` array, after the enrichment leg:

```tsx
      // The open country's climate normals (§9.4), for every country but the
      // one whose month table is hand-authored: `fitForPlace` never reads a
      // derived row for a Chinese place (§9.5), so CN.json's 412 rows would be
      // 20 KB per open that nothing consults. `fetchClimateShard` takes a
      // fetch rather than a signal — lib/rates.ts's pattern — so the abort is
      // wrapped in. Swallows its own rejection like the shard leg above it: a
      // country with no climate file draws grey pins, which is the absence of
      // a claim and not an outage.
      countryCode === CLIMATE_COUNTRY
        ? Promise.resolve(null)
        : fetchClimateShard(countryCode, (input, init) =>
            fetch(input, { ...init, signal: controller.signal })
          ).catch(() => null),
```

Extend the `.then` destructuring to `([provinceFile, manifest, catalogRes, shardRes, enrichment, climateRes])` and, after `setCitiesUnavailable(...)`, add:

```tsx
        // Joined here, where the parsed shard rows are still in hand: the
        // climate row carries no elevation and `MapPlace` has no field for
        // one, so this is the only moment the two halves meet.
        setClimate(buildClimateIndex(climateRes, shardRes?.cities ?? []));
```

Pass `climate={climate}` to `<CountryMap>` (after `showAirports={showAirports}`) and to `<PlacePopup>` (after `country={countryCode}`). After the `{caption && (...)}` block add:

```tsx
      {/*
        §9.7's honesty surface, through the note the tip surfaces already use
        rather than a second one. Lines, not a country: `GapNote` must not
        resolve the artifact itself, and `climateGapNote` answers `[]` for
        China and for a country that drew no derived row — so this renders
        nothing exactly where there is nothing to qualify.
      */}
      <GapNote lines={climateGapNote(countryCode, climate.size)} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/map/MapExplorer.test.tsx lib/countryFacts.test.ts`
Expected: PASS — the new block, every existing MapExplorer test (the shared `defaultFetch` change is additive), and `MUST_STAY_CHEAP` still holds for `MapExplorer.tsx`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add components/map/MapExplorer.tsx components/map/MapExplorer.test.tsx
git commit -m "feat: fetch the open country's climate and colour its cities by it" -m "A sixth leg of the country load fetches public/climate/<CC>.json for every country but China, joins it to the city shard's elevations, and hands the index to the map and the hover card. Under the map, GapNote carries spec 9.7's one paragraph about what the derived figures are, and nothing where nothing derived was read.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The season stamp goes (§9.6)

**Files:**
- Modify: `lib/server/catalog.ts:367-368`, `:400-401`
- Test: `lib/server/catalog.test.ts`, `components/trip/RouteMap.test.tsx:42-58` (fixture) and its `routePlaces` block

**Interfaces:**
- Consumes: `fitForPlace`'s empty-list guard (Task 1).
- Produces: `catalogCityToDestination` and `geoNamesCityToDestination` emit `bestSeasons: []`; `seasonNotes: {}` is unchanged.

- [ ] **Step 1: Write the failing tests**

In `lib/server/catalog.test.ts`, inside `describe("catalogCityToDestination")` add:

```ts
  test("claims no seasons — the map derives them from the climate artifact (§9.6)", () => {
    // `["spring", "autumn"]` was a northern-hemisphere guess stamped on
    // Sydney and Reykjavík alike, and the trip map read it as `great` every
    // northern spring. `[]` is the value `mapTypes.fitForPlace` reads as
    // "nobody has said", and app/plan/page.tsx already stamps it on a
    // hand-typed place.
    const dest = catalogCityToDestination(city());
    expect(dest.bestSeasons).toEqual([]);
    expect(dest.seasonNotes).toEqual({});
  });
```

and inside `describe("geoNamesCityToDestination")`:

```ts
  test("claims no seasons either (§9.6)", () => {
    const dest = geoNamesCityToDestination(cusco);
    expect(dest.bestSeasons).toEqual([]);
    expect(dest.seasonNotes).toEqual({});
  });
```

(`city()` and `cusco` are that file's existing fixtures, at `:11` and `:90`.)

In `components/trip/RouteMap.test.tsx`, change the `CUSCO` fixture's `bestSeasons: ["spring", "autumn"],` to `bestSeasons: [],` and its docblock's "plus the generic seasons and activities that function stamps on" to "plus the empty season claim §9.6 leaves and the generic activities that function stamps on". Add `import { fitForPlace, NEUTRAL_FIT } from "@/components/map/mapTypes";` and, inside `describe("routePlaces with resolved stops")`:

```tsx
  test("a resolved stop carries no season claim, so its verdict is the artifact's or nothing", () => {
    // Before §9.6 every resolved stop was `great` in April through the
    // stamp; the trip map coloured Sydney's autumn as a northern spring.
    const [place] = routePlaces(plan([day(1, "G3941584")]), [CUSCO]);
    expect(place.bestSeasons).toEqual([]);
    expect(fitForPlace(place, 4)).toBe(NEUTRAL_FIT);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/server/catalog.test.ts components/trip/RouteMap.test.tsx`
Expected: FAIL — the two catalog tests receive `["spring", "autumn"]`; the RouteMap test passes already (the fixture was edited by hand) — that is fine, it exists to pin the seam once the server matches it.

- [ ] **Step 3: Write the implementation**

In `lib/server/catalog.ts`, at both `:367` and `:400`, replace

```ts
    bestSeasons: ["spring", "autumn"],
```

with

```ts
    // No season claim (§9.6). `[]` is what `mapTypes.fitForPlace` reads as
    // "nobody has said", so a resolved stop's verdict comes from the climate
    // artifact or is `unknown`. The `["spring", "autumn"]` this replaced was
    // a northern-hemisphere guess stamped on Sydney and Reykjavík alike; the
    // wizard's season chip never read it (it renders curated cards only), but
    // the trip map did, and coloured every worldwide stop `great` in March.
    bestSeasons: [],
```

(Write the comment once, at `:367`, and at `:400` use the one-line form `// No season claim — see catalogCityToDestination (§9.6).`)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/server/catalog.test.ts components/trip/RouteMap.test.tsx components/map/mapTypes.test.tsx components/plan/wizardCountry.test.tsx components/PlanStep.test.tsx lib/itinerary.test.ts`
Expected: PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/server/catalog.ts lib/server/catalog.test.ts components/trip/RouteMap.test.tsx
git commit -m "fix: stop stamping a northern spring and autumn on every worldwide destination" -m "Spec 9.6. The stamp's real reader was the trip map, not the wizard chip: routePlaces copies bestSeasons onto the MapPlace and fitForPlace takes a non-empty list as the first word, so every resolved stop on a worldwide trip was great in the northern spring. An empty list is no claim; the verdict now comes from the climate artifact or is unknown.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The trip map takes the feed (P6-4)

**Files:**
- Modify: `components/trip/RouteMap.tsx` — imports (`:1-19`), state and one effect after the provinces effect (`:290-334`), `<CountryMap>` (`:352-385`)
- Test: `components/trip/RouteMap.test.tsx`

**Interfaces:**
- Consumes: `fetchClimateShard(country, fetchImpl)`; `fetchCityShard(country, signal)` (`lib/cityShard.ts`); `buildClimateIndex`, `NO_CLIMATE`; `CLIMATE_COUNTRY`, `DerivedClimateIndex`; `CountryMap`'s `climate` prop (Task 5).
- Produces: `RouteMap` passes a `climate` index built from the trip country's two shards.

- [ ] **Step 1: Write the failing tests**

In `components/trip/RouteMap.test.tsx`, add imports (merge with Task 8's):

```tsx
import fixture from "@/data/climate-anchors.json";
import { monthFit } from "@/lib/climateModel";
import { FIT_COLORS, fitForPlace, NEUTRAL_FIT } from "@/components/map/mapTypes";
```

After `PE_MANIFEST`, add:

```tsx
const CUSCO_ROW = fixture.cities.find((c) => c.key === "cusco")!.row;

/** Peru's climate shard, cut to the one stop the trip has. */
const PE_CLIMATE = {
  country: "PE",
  generatedAt: "2026-09-03T19:48:35.466Z",
  source: "CHELSA V2.1 climatologies 1981-2010, CC0 1.0, DOI 10.16904/envidat.228",
  cities: { G3941584: CUSCO_ROW },
};

/**
 * Peru's city shard, cut the same way. The trip map fetches it for ONE field:
 * `elev`, which the climate row does not carry and `Destination` has no slot
 * for, and which is worth a whole band at Cusco's 3,312 m.
 */
const PE_CITIES = {
  country: "PE",
  generatedAt: "2026-08-25T09:23:00.949Z",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    {
      id: "G3941584",
      n: "Cusco",
      lat: -13.53188,
      lon: -71.96701,
      a1: "Cuzco Department",
      a1c: "PE.08",
      p: 428_450,
      elev: 3312,
      tz: "America/Lima",
    },
  ],
};
```

In `tripFetch`, add two answers before the 404 fallback:

```tsx
  if (href === "/climate/PE.json") return answer(PE_CLIMATE);
  if (href === "/cities/PE.json") return answer(PE_CITIES);
```

Append:

```tsx
/**
 * §9.4 on the trip map (decision P6-4). Removing the season stamp (§9.6)
 * turned every worldwide stop from a fabricated green to grey; this is what
 * turns it into the artifact's own verdict, with the same join the wizard's
 * map uses so the two cannot disagree about Cusco's June.
 */
describe("the trip map colours its stops by the trip country's climate", () => {
  const JUNE = 6;
  const renderJune = () =>
    render(<RouteMap plan={PERU_TRIP} country="PE" startDate="2026-06-15" season="winter" />);

  test("asks for the trip country's climate and city shards, and never China's", async () => {
    renderJune();
    await settle();
    const urls = requestedUrls();
    expect(urls).toContain("/climate/PE.json");
    expect(urls).toContain("/cities/PE.json");
    expect(urls.some((u) => u.startsWith("/climate/CN") || u.startsWith("/cities/CN"))).toBe(false);
  });

  test("a China trip asks for no climate at all", async () => {
    // Curated China reads its own table (§9.5); the shard would be 412 rows
    // nothing consults.
    render(
      <RouteMap plan={plan([day(1, "beijing"), day(2, "xian")])} country="CN" startDate={null} season="autumn" />
    );
    await settle();
    expect(requestedUrls().some((u) => u.startsWith("/climate/") || u.startsWith("/cities/"))).toBe(false);
  });

  test("colours a resolved stop by its derived verdict, elevation included", async () => {
    const { container } = renderJune();
    await settle();
    const verdict = monthFit(CUSCO_ROW, 3312, JUNE - 1);
    // Armed: the elevation moves the band, and the band is not the grey.
    expect(verdict).not.toBe(monthFit(CUSCO_ROW, null, JUNE - 1));
    expect(FIT_COLORS[verdict]).not.toBe(FIT_COLORS.unknown);
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS[verdict]);
  });

  test("a stop whose climate file 404s stays grey", async () => {
    stubFetch((url: string) =>
      String(url) === "/climate/PE.json" ? answer({}, 404) : tripFetch(String(url))
    );
    const { container } = renderJune();
    await settle();
    expect(
      container.querySelector('[data-place="G3941584"] circle[data-dot]')!.getAttribute("fill")
    ).toBe(FIT_COLORS.unknown);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/trip/RouteMap.test.tsx -t "colours its stops"`
Expected: FAIL — no `/climate/PE.json` request; Cusco's dot is `#8a939f`.

- [ ] **Step 3: Write the implementation**

In `components/trip/RouteMap.tsx`, add imports:

```tsx
import { buildClimateIndex, NO_CLIMATE } from "@/components/map/climateIndex";
import { fetchCityShard } from "@/lib/cityShard";
import { fetchClimateShard } from "@/lib/climateShard";
```

and change the `mapTypes` import to `import { CLIMATE_COUNTRY, type DerivedClimateIndex, type MapPlace } from "@/components/map/mapTypes";`.

After the provinces effect (the one ending `}, [wantsProvinces, countryCode]);`) add:

```tsx
  /**
   * The trip country's derived climate (§9.4), for the stops' colours.
   *
   * Two static fetches the wizard's map also makes, joined the same way
   * (`buildClimateIndex`), so this surface and `MapExplorer` cannot disagree
   * about a stop's verdict. The city shard is fetched for ONE field — `elev`
   * — because the climate row does not carry it and `Destination` has no
   * slot for it, and at Cusco's 3,312 m it is worth a whole band. Both files
   * are served with a day of cache (next.config.ts), so the second trip page
   * that opens on the same country pays nothing.
   *
   * Skipped for China (§9.5): `fitForPlace` never reads a derived row for a
   * Chinese place, and the shard would be 412 rows nothing consults.
   *
   * Both legs swallow their own rejection, for §5.2's reason: a stop is drawn
   * whether or not its verdict arrives, and grey is the absence of a claim.
   * Cleared up front so one country's rows are never read against another's
   * stops between a switch and the new file landing.
   */
  const [climate, setClimate] = useState<DerivedClimateIndex>(NO_CLIMATE);

  useEffect(() => {
    setClimate(NO_CLIMATE);
    if (countryCode === CLIMATE_COUNTRY) return;
    const controller = new AbortController();
    // `fetchClimateShard` takes a fetch rather than a signal — lib/rates.ts's
    // pattern — so the abort is wrapped in.
    const scoped: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
    Promise.all([
      fetchClimateShard(countryCode, scoped).catch(() => null),
      fetchCityShard(countryCode, controller.signal).catch(() => null),
    ]).then(([shard, cities]) => {
      if (controller.signal.aborted) return;
      setClimate(buildClimateIndex(shard, cities?.cities ?? []));
    });
    return () => controller.abort();
  }, [countryCode]);
```

Pass `climate={climate}` to `<CountryMap>`, after `readOnly`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/trip/RouteMap.test.tsx lib/countryFacts.test.ts`
Expected: PASS — including "still renders for a guest, with no session" (the two new legs reject on the login page's `<` and are swallowed) and `MUST_STAY_CHEAP` for `RouteMap.tsx`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add components/trip/RouteMap.tsx components/trip/RouteMap.test.tsx
git commit -m "feat: colour the trip map's stops by the trip country's climate" -m "The same two shards the wizard's map reads, joined by the same buildClimateIndex, so the trip map and the picker agree about a stop's June. The city shard is fetched for elev alone, which the climate row does not carry and is worth a band at altitude. Skipped for China, whose table is curated.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The two hand-offs from Plan 5 — the CN lookup re-run, and the coast in the fixture

**Files:**
- Modify: `components/map/chinaBaseline.test.tsx`
- Modify: `scripts/sample-climate-anchors.mjs:108-119` (`SYMPTOMS`)
- Modify (generated): `data/climate-anchors.json`
- Modify: `lib/climateModel.test.ts` (docblock `:26-30`, the fix-1 describe `:97-157`), `lib/climateShard.test.ts:638-668`

**Interfaces:**
- Consumes: `PlacePopup`'s `climate` prop (Task 4); the sampler's `SYMPTOMS` shape `{ key, cc, id, why }`; the fixture's `FixtureCity` shape in `climateModel.test.ts`.
- Produces: four new fixture rows — `callao`, `trujillo`, `ica`, `arica` — `role: "symptom"`, with `elev` from the committed city shards.

- [ ] **Step 1: Write the failing test — the populated CN lookup**

In `components/map/chinaBaseline.test.tsx`, add `import fixture from "@/data/climate-anchors.json";` and `import type { DerivedClimateIndex } from "./mapTypes";`, then append:

```tsx
/**
 * Plan 5's Task 5 review, verbatim from its ledger: "chinaBaseline.test.tsx
 * passes no derived lookup, so it does not guard the resolution order —
 * re-run it with a populated CN lookup once a caller passes one."
 *
 * `public/climate/CN.json` is real — 412 rows keyed by the same `G` ids
 * `public/cities/CN.json` uses — so a caller that ever fetched it would be
 * handing every Chinese catalog city a derived row. `MapExplorer` never
 * fetches it (Task 7 skips the leg for CLIMATE_COUNTRY), so today this pins a
 * future caller: the popup with a lookup that DOES hold a row for each China
 * place must render the same bytes as the popup with none.
 */
describe("China's card output with a populated CN lookup", () => {
  const chengdu = fixture.cities.find((c) => c.key === "chengdu")!;
  const populated: DerivedClimateIndex = new Map(
    CHINA_PLACES.map((p) => [p.id, { row: chengdu.row, elev: chengdu.elev }])
  );

  test("the lookup really holds a row for every China place", () => {
    for (const p of CHINA_PLACES) expect(populated.get(p.id), p.id).toBeDefined();
  });

  test("a curated place's popup is still byte-identical", () => {
    const { container } = render(
      <PlacePopup
        place={CHINA_PLACES[0]}
        month={CHINA_MONTH}
        position={{ x: 400, y: 220 }}
        containerWidth={860}
        country="CN"
        climate={populated}
      />
    );
    expect(container.innerHTML).toBe(CHINA_BASELINE_MARKUP.popupCurated);
  });

  test("a catalog city's popup is still byte-identical", () => {
    const { container } = render(
      <PlacePopup
        place={CHINA_PLACES[2]}
        month={CHINA_MONTH}
        position={{ x: 120, y: 40 }}
        containerWidth={860}
        country="CN"
        climate={populated}
      />
    );
    expect(container.innerHTML).toBe(CHINA_BASELINE_MARKUP.popupCatalog);
  });
});
```

Run: `npx vitest run components/map/chinaBaseline.test.tsx`
Expected: PASS already — the gate is `fitForPlace`'s and `placeClimateFor`'s, and both are on the country. That is the point: this test's job is to go red the day someone reorders either resolver. Confirm it is ARMED by temporarily editing `placeClimateFor` to read the derived branch before the China one, re-running (expect FAIL on the catalog city: its popup gains a `typical` line), and reverting.

- [ ] **Step 2: Add the four coastal cities to the sampler**

In `scripts/sample-climate-anchors.mjs`, extend `SYMPTOMS` (after the `tromso` entry):

```js
  // The coast the fix-1 tripwire's rationale cites (lib/climateModel.test.ts):
  // CHELSA clt reads the Peruvian coast's garúa months as its CLEAREST, and
  // Arica — 400 km south, in Chile — is the one coastal-desert city whose
  // winter reads cloudier. In the fixture so the inversion is a measurement
  // and not a comment.
  { key: 'callao', cc: 'PE', id: 'G3946083', why: 'fix 1 deviation: coastal-desert clt inversion, Lima\'s port' },
  { key: 'trujillo', cc: 'PE', id: 'G3691175', why: 'fix 1 deviation: coastal-desert clt inversion, northern coast' },
  { key: 'ica', cc: 'PE', id: 'G3938527', why: 'fix 1 deviation: coastal-desert clt inversion, southern coast' },
  { key: 'arica', cc: 'CL', id: 'G3899361', why: 'fix 1 deviation: the coastal-desert city whose winter IS cloudier' },
```

Update the docblock line "nineteen rows" (`:16`) to "twenty-three rows".

- [ ] **Step 3: Regenerate the fixture**

Run: `node scripts/sample-climate-anchors.mjs`
Expected: it prints `cache: <CIP_CHELSA_CACHE or %TEMP%\cip-chelsa>`, `cities: 23 (9 anchors, 14 symptom cities)`, one printed row per city, and rewrites `data/climate-anchors.json`. It downloads nothing; if it reports a missing raster, the cache is not where `CIP_CHELSA_CACHE` says — stop and report rather than downloading (~10 GB).

Then verify the nineteen pre-existing rows are byte-identical (only `generatedAt` and the four new entries may differ):

```bash
node -e "const fs=require('fs');const {execSync}=require('child_process');const before=JSON.parse(execSync('git show HEAD:data/climate-anchors.json')).cities;const after=JSON.parse(fs.readFileSync('data/climate-anchors.json','utf8')).cities;let changed=0;for(const b of before){const a=after.find(c=>c.key===b.key);if(!a||JSON.stringify(a.row)!==JSON.stringify(b.row)||a.elev!==b.elev||a.role!==b.role)changed++;}console.log('pre-existing rows changed:',changed,'total now:',after.length,'new keys:',after.filter(c=>!before.some(b=>b.key===c.key)).map(c=>c.key).join(','));"
```

Expected: `pre-existing rows changed: 0 total now: 23 new keys: callao,trujillo,ica,arica`. Anything else is a finding to report, not to absorb.

- [ ] **Step 4: Write the tests that read the new rows**

In `lib/climateShard.test.ts:655`, change `expect(gAnchors).toHaveLength(10);` to `expect(gAnchors).toHaveLength(14);`, the test name "the ten catalogued anchor cities…" to "the fourteen catalogued anchor cities…", and the comment "10 of the fixture's 19 entries: the other 9" to "14 of the fixture's 23 entries: the other 9".

In `lib/climateModel.test.ts`, change the docblock's "Nineteen cities, about 21 KB of fixture" to "Twenty-three cities, about 26 KB of fixture", and inside `describe("fix 1 — cloud cover")` add:

```ts
  test("the coast-wide inversion the tripwire rests on is in the fixture, not only in a comment", () => {
    // Mean cloud in the garúa months against the summer months, off the
    // sampled rows. For the Peruvian coast winter reads CLEARER; Arica, in
    // Chile, is the coastal-desert city whose winter reads cloudier — which
    // is what makes the inversion a fact about CHELSA's Peruvian coast and
    // not about coastal deserts. If a re-sample ever flips one of these, the
    // rationale above is what changes, and in the open.
    const WINTER = [JUN, JUL, AUG, SEP];
    const SUMMER = [JAN, FEB, MAR];
    const meanCloud = (c: FixtureCity, months: number[]): number =>
      months.reduce((sum, m) => sum + climateMonth(c.row, m).cloud, 0) / months.length;

    for (const key of ["lima", "callao", "trujillo", "ica"]) {
      const c = city(key);
      expect(c.role, key).toBe("symptom");
      expect(meanCloud(c, WINTER), `${c.name}: winter cloud vs summer`).toBeLessThan(meanCloud(c, SUMMER));
    }
    const arica = city("arica");
    expect(arica.role).toBe("symptom");
    expect(meanCloud(arica, WINTER)).toBeGreaterThan(meanCloud(arica, SUMMER));
  });
```

Then update the fix-1 docblock's parenthetical — it spans two lines, `Callao 39 vs 58, Trujillo 23 vs 55, Ica 12 vs 55; only Arica in` and `Chile shows winter cloud)` — so that it ends with "— all four are fixture rows now, and the test below reads them)".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/climateModel.test.ts lib/climateShard.test.ts components/map/chinaBaseline.test.tsx components/map/mapTypes.test.tsx`
Expected: PASS, with the Lima tripwire still the one expected failure (`test.fails`). If the coast test fails on Arica, the sampled row disagrees with the rationale: report the four rows' winter and summer cloud means rather than editing the assertion, because the fixture is the measurement and the comment is the claim.

- [ ] **Step 6: Commit**

```bash
git add components/map/chinaBaseline.test.tsx scripts/sample-climate-anchors.mjs data/climate-anchors.json lib/climateModel.test.ts lib/climateShard.test.ts
git commit -m "test: re-run the China baselines with a populated CN lookup, and put the coast in the fixture" -m "Plan 5's two hand-offs. The popup baselines now render with a lookup that holds a row for every China place and pin the same bytes, so a reordered resolver goes red. Callao, Trujillo, Ica and Arica join data/climate-anchors.json as symptom rows, and the clt inversion the Lima tripwire rests on is asserted on sampled data instead of cited in a comment.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The browser proof

**Files:**
- Create: `e2e/climate.spec.ts`
- Modify: `playwright.config.ts:86` (`testMatch` of the `chromium` project)

**Interfaces:**
- Consumes: the real `public/climate/PE.json`, `public/cities/PE.json`, `public/provinces/PE.json`; `FIT_LEGEND_LABEL`'s text; `GapNote`'s `aria-label`; the world level's "Or pick from the list" select; the "← All countries" step-up.
- Produces: three signed-in specs in the `chromium` project.

- [ ] **Step 1: Write the spec**

```ts
// e2e/climate.spec.ts
import { test, expect, type Page } from "@playwright/test";

/**
 * Fit colours worldwide (spec §9.4), against the real committed data.
 *
 * What this reaches that jsdom cannot: the actual `public/climate/PE.json`
 * (750 rows) parsed by the real loader, joined to the actual city shard's
 * elevations, and drawn by a real SVG engine — the unit suite renders two
 * fixture rows. It is also the only test of the whole path from the world
 * level's country list to a coloured pin in another country.
 */

const UNKNOWN = "#8a939f";
/** `FIT_COLORS` less `unknown` — the four colours that are a verdict. */
const VERDICT_COLOURS = new Set(["#2f7d54", "#b98a2f", "#8f9bab", "#c93b2e"]);
const LEGEND = { name: "What the marker colours mean" };
const NOTE = { name: "About these notes" };

/** `/plan` opens on the details step; the map is the step after it. */
async function openTheMap(page: Page) {
  await page.goto("/plan");
  await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(page.getByRole("group", { name: /^Map of / })).toBeVisible({ timeout: 30_000 });
}

/**
 * China → the world level → Peru, through the list rather than the globe:
 * the list is the one path that reaches every country whichever renderer the
 * world level chose, and it is a native select, which Playwright can drive
 * without knowing where Peru is drawn.
 */
async function openPeru(page: Page) {
  await openTheMap(page);
  await page.getByRole("button", { name: "← All countries" }).click();
  await page.getByRole("combobox", { name: "Or pick from the list" }).selectOption({ label: "Peru" });
  await expect(page.getByRole("group", { name: "Map of Peru" })).toBeVisible({ timeout: 30_000 });
}

test("a country outside China draws its cities in verdict colours, from the committed climate shard", async ({
  page,
}) => {
  await openPeru(page);

  const dots = page.locator("[data-markers] [data-place] circle[data-dot]");
  await expect(dots.first()).toBeVisible();
  // Not "every pin is coloured": the nightly catalog can hold a city the
  // climate artifact has not caught up with (lib/climateShard.test.ts bounds
  // that drift), and grey is the honest colour for it. What must be true is
  // that the artifact reached the map at all — before this plan, every one of
  // these was `#8a939f`.
  await expect
    .poll(async () => {
      const fills = await dots.evaluateAll((els) => els.map((el) => el.getAttribute("fill") ?? ""));
      return fills.filter((fill) => VERDICT_COLOURS.has(fill)).length;
    })
    .toBeGreaterThan(0);

  // The key to those colours, and the paragraph saying what they are.
  const legend = page.getByRole("list", LEGEND);
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("Great time");
  await expect(legend).toContainText("No data");
  await expect(page.getByRole("note", NOTE)).toContainText("grid normals");
});

test("hovering a city reads its own temperatures off the same index", async ({ page }) => {
  await openPeru(page);

  // `dispatchEvent` rather than `hover()`: 750 markers' hit circles overlap
  // near Lima, and Playwright's hover refuses an element another one
  // intercepts. React derives onMouseEnter from a bubbling `mouseover`, so a
  // synthetic one on Lima's own group opens Lima's card, whatever is painted
  // over its centre.
  await page.locator('[data-place="G3936456"]').dispatchEvent("mouseover");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Lima");
  await expect(tooltip).toContainText("°C typical");
  await expect(tooltip).not.toContainText("No data");
});

test("China keeps its curated table, and gets no derived-climate note", async ({ page }) => {
  await openTheMap(page);
  await expect(page.getByRole("group", { name: "Map of China" })).toBeVisible();

  // The legend is for everyone; the note is for derived data only (§9.7:
  // "it renders nothing for China").
  await expect(page.getByRole("list", LEGEND)).toBeVisible();
  await expect(page.getByRole("note", NOTE)).toHaveCount(0);

  await page.locator('[data-place="beijing"]').dispatchEvent("mouseover");
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("North China");
  await expect(tooltip).toContainText("°C typical");

  // And a curated pin is still a curated colour, never the derived grey.
  const fill = await page.locator('[data-place="beijing"] circle[data-dot]').getAttribute("fill");
  expect(fill).not.toBe(UNKNOWN);
});
```

In `playwright.config.ts`, change the `chromium` project's `testMatch: /(map|gateways)\.spec\.ts/` to `testMatch: /(map|gateways|climate)\.spec\.ts/` and extend the comment above it with "climate.spec.ts drives the wizard through the world level to Peru with the saved session, so it belongs here too."

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/climate.spec.ts --project=chromium`
Expected: 3 passed. (The `setup` project runs first and signs in; `next dev` compiles `/plan` on the first navigation, which is why the group assertion carries a 30 s timeout.) If "Or pick from the list" is not found, the world level did not render its picker — read `components/map/worldLevelShared.tsx`'s `CountryPicker` for the label before changing the spec.

- [ ] **Step 3: Run the whole e2e suite**

Run: `npx playwright test`
Expected: every project green — `setup`, `chromium` (map, gateways, climate), `signed-out`, `mobile`. The mobile tap-target sweep counts controls inside `[data-map-panel]`; the legend and the note add none.

- [ ] **Step 4: Commit**

Playwright rewrites `next-env.d.ts` on a dev-server start (memory: "Playwright rewrites next-env.d.ts — revert before committing"); run `git checkout -- next-env.d.ts` first if `git status` shows it.

```bash
git add e2e/climate.spec.ts playwright.config.ts
git commit -m "test: prove the derived colours, the legend and the note in a browser" -m "Peru through the world level's list, against the real committed shards: at least one pin is a verdict colour where every pin was grey, the hover card reads real temperatures, the legend and the honesty note are on screen. China keeps its curated table and gets no note.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Verify everything, then finish the branch

**Files:** none new.

- [ ] **Step 1: The full gates**

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npm test
```
Expected: every file passes; the run reports one expected failure (`lib/climateModel.test.ts`'s Lima `test.fails` tripwire) and zero failures. Before this plan: 129 files / 2,579 passed + 1 expected fail; expect roughly +40 tests across 14 files.

```bash
npx playwright test
```
Expected: all projects green (14 + 3 specs).

- [ ] **Step 2: The bundle rule, and the licence rule, by name**

```bash
npx vitest run lib/countryFacts.test.ts lib/climateShard.test.ts lib/contracts.test.ts
```
Expected: PASS — `MUST_STAY_CHEAP` still holds for `MapExplorer.tsx`, `PlacePopup.tsx` and `RouteMap.tsx`; the CC0 non-additions still hold; C7's token list is unchanged.

- [ ] **Step 3: Confirm nothing server-side reads climate**

```bash
grep -rn "climateShard\|climateModel\|climateIndex" lib/server app/api --include=*.ts
```
Expected: no output.

- [ ] **Step 4: Finish**

Use **superpowers:finishing-a-development-branch**. The PR title: `feat: climate in the UI — fit colours worldwide (Phase 4, Plan 6)`. The PR body must carry, for the human:

1. **Decisions P6-1 to P6-6** from the table above, each in one line, with P6-2 (the legend is an addition beyond the spec's letter) and P6-4 (the trip map costs two cached static fetches) called out as the two a reviewer might overrule.
2. **Plan 5's three hand-offs, closed:** the CN-lookup baseline re-run (Task 10), the coastal-desert presentation (P6-3), and the four coastal cities in the fixture (Task 10).
3. **The §9.6 finding:** the stamp's real consumer was the trip map, not the wizard chip — every resolved stop on a worldwide trip was `great` in the northern spring — and what it reads now.
4. **What is deliberately not built** (the section below).
5. The verification figures from Step 1, as run.

Rebase-merge, as every Phase 4 PR was. Delete the branch after.

---

## Deliberately not built

- **A province tint by aggregated fit.** `fitForRegion` / `DerivedRegionFits` keep their zero callers (P6-1). If a later phase wants it, the seam is there and the open question is the aggregation policy, which is a design decision and not a task.
- **A legend on the trip map.** Its pins are all the trip's own stops; the key belongs to the picker (P6-2).
- **Per-city coastal-desert overrides, or a `test.fails` flip.** The Lima tripwire stays red on purpose (P6-3); the note's sentence is the presentation.
- **Fit on the place list's chips.** The list is §5.2's accessibility spine and D2 gave it grouping and a filter; a screen-reader user reaches a verdict through a marker's card (Enter opens it, roving tabindex). Adding five colours' worth of text to 750 chips is a separate accessibility design.
- **Reading `elev` from the city index instead of the city shard on the trip map.** `Destination` has no elevation field and `cities-index.json` is a server-bundled artifact; fetching the shard is one cached request and keeps the join in one function.
- **`README.md` changes.** No API changed. The `## Project layout` block predates `public/` artifacts entirely and is a separate docs task.

---

## Self-review record (written with the plan)

**Spec coverage.** §9.4 fit colours worldwide → Tasks 5, 7, 9; the four contract requirements were Plan 5's and are pinned in `climateModel.test.ts`; "integers" is re-asserted in Task 1's derived-line test. §9.5 China stays authoritative → Tasks 1, 4, 5 (country gate), 10 (populated lookup), P6-5. §9.6 → Tasks 1 (the guard) and 8. §9.7 → Tasks 3 and 7. §5.3.3 "where the climate lo/hi line lives" → Task 5. §9.3's cache header and §9.1's `.gitattributes` line already landed in Plan 5 (`next.config.ts:134`, `.gitattributes`) — nothing to add. §12.3's "China's rendered fit output is byte-identical" → Task 10. §9.1's non-additions → Task 12 Step 2.

**Placeholder scan.** No "TBD", "TODO", "implement later", "add error handling", "similar to Task N". Every code step shows the code; every test step shows the test.

**Type consistency.** `placeClimateFor(place, month, climate?) → PlaceClimate | null` with `PlaceClimate = { lo, hi, note?, source }` is defined in Task 1 and consumed by that name in Tasks 4 and 5. `buildClimateIndex(shard: ClimateShard | null, cities: readonly Pick<CityShardRow, "id" | "elev">[]) → DerivedClimateIndex` and `NO_CLIMATE` are defined in Task 2 and consumed in Tasks 5 (default), 7 and 9. `climateGapNote(country: string, derivedRows: number) → string[]` and `DERIVED_CLIMATE_NOTE` are defined in Task 3 and consumed in Tasks 1 (cross-module test) and 7. `FIT_ORDER` (Task 1) → `FitLegend` (Task 6). `FIT_LEGEND_LABEL = "What the marker colours mean"` (Task 6) → Tasks 6 and 11. The prop is named `climate` on `PlacePopup`, `SelectedPlaceCard`, `CountryLevel` and `CountryMap` alike. `fetchClimateShard(country, fetchImpl)` takes a fetch, not a signal, and both callers (Tasks 7, 9) wrap the abort the same way. The fixture ids — Lima `G3936456`, Cusco `G3941584`, Berlin `G2950159` — match the committed shards and the existing test fixtures they join.
