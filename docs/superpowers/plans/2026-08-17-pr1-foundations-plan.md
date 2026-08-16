# PR1 — Foundations: Implementation Plan

**Date:** 2026-08-17
**Branch:** `redesign/planner-shell`
**Spec:** `docs/superpowers/specs/2026-08-17-planner-redesign-design.md` (§10 "PR1 Foundations" — authoritative; this plan executes it, it does not redesign it)
**Scope discipline:** strictly additive. The existing UI must render identically after every task. After every task the tree must pass all three gates:

```
npm test
npx tsc --noEmit
npm run build
```

Run all three after **every** numbered task. Commit per task with a conventional-commit message so any task can be reverted in isolation.

**Test infrastructure facts (verified against the repo):**
- vitest config (`vitest.config.ts`) ships node-only (`lib/**/*.test.ts`, environment `node`). **Task 1 restructures it into two projects**: the node project unchanged, plus a jsdom project (`@testing-library/react`) for component/hook tests. Convention from Task 1 onward: pure-logic tests are `.test.ts` under `lib/` (node project); anything that renders is `.test.tsx` (jsdom project). See J2 (resolved).
- sqlite store tests run live against a temp DB (`lib/server/tripStore.test.ts` pattern: set `CIP_DB_PATH` before importing, `closeDb()` in before/after). The **pg store is inspection-verified only** in this repo (no live pg in CI — see project memory); pg changes in this plan mirror the sqlite changes structurally and are flagged for the live-pg matrix before any pg deploy.

**Boundary contract this PR must hand to PR2** (a parallel agent plans against exactly this — do not rename these exports):
- `lib/accent` exports a pure function mapping `(iso2, theme, role)` → OKLCH colour string.
- `lib/countryProfile` exports `getCountryProfile(code)` returning the spec §5.2 interface, never throwing on unknown codes.
- The trip-payload accessor is a hook exporting `payload`, `loadState`, `refetch(force)`, and a `mutate(url, init)` helper, and is the only module that fetches trip data.
- `country` is readable off trip data with a guaranteed `"CN"` default (via `tripCountry()` — see J1); no caller handles `undefined`.
- Timing fields exist on `ScheduledItem` and round-trip through both store backends.

---

## Task 0 — Preflight baseline

**Goal:** prove the tree is green before any change, so later failures are attributable.

**Files:** none.

**Steps:**
1. `git status` — confirm on `redesign/planner-shell`, working tree clean (stash or exclude the untracked `family_trip_presentation_deck.html`, `interactive_trip_planner.html`, `.superpowers/` — they are not part of this PR).
2. Run all three gates and record the pass.

**Verify:** `npm test && npx tsc --noEmit && npm run build` all pass.

---

## Task 1 — component test harness (jsdom project)

**Goal:** approved test infrastructure so component and hook tests can render for real: `jsdom` + `@testing-library/react` devDependencies and a two-project vitest config. Lands before any task whose test wants to render (the providers in Task 15, the hook in Task 17). No existing test is modified or reclassified.

**Test first** — create `components/harness.test.tsx`: render a trivial inline component with `@testing-library/react` and assert its text is present. RED two ways before the change: `npm test` does not pick the file up at all (include is `lib/**/*.test.ts`), and the targeted run `npx vitest run components/harness.test.tsx` fails (no matching test file / missing deps / no DOM). Record both, then:

**Implement:**
- `npm i -D jsdom @testing-library/react @testing-library/jest-dom` — versions compatible with React 19 (`@testing-library/react` ≥ 16). jest-dom is included deliberately: `toBeInTheDocument()`-style matchers keep component assertions readable; dev-only (see J2).
- Create `vitest.setup.ts`: `import "@testing-library/jest-dom/vitest";`
- Restructure `vitest.config.ts` into two projects sharing the existing `@` alias:
  - **node** (existing semantics untouched): include `["lib/**/*.test.ts"]`, environment `node`.
  - **jsdom** (new): include `["components/**/*.test.tsx", "lib/**/*.test.tsx"]`, environment `jsdom`, `setupFiles: ["./vitest.setup.ts"]`.
  The `.ts` / `.tsx` split means the two includes cannot overlap — every pre-existing test stays in the node project, untouched.
- `components/harness.test.tsx` stays in the tree as the harness canary.

**Verify:** `npm test` runs both projects and every pre-existing lib test passes with identical counts; `npx vitest run components/harness.test.tsx` passes; `npx tsc --noEmit`; `npm run build` (test-only deps must not leak into the build).

---

## Workstream A — Pure country modules (spec PR1 step 2)

Ordered first: zero dependencies on anything else, pure, highest test leverage.

### Task 2 — `lib/countries`

**Goal:** country records, ISO alpha-2 codes, curated overrides, safe fallback for unknown codes.

**Test first** — create `lib/countries.test.ts`:
- `getCountry("CN")` returns name "China", `localName` "中国", `mark` "同行", hemisphere "north", a curated `accentHue` (number).
- `getCountry("cn")` (lowercase) normalises and returns the same record.
- `getCountry("XZ")` (unknown) returns a record — never `undefined`, never throws — with `code: "XZ"`, `name: "XZ"`, `localName: null`, hemisphere `"north"`, no `accentHue`, no `mark`.
- `getCountry("")` / garbage input returns the neutral record without throwing.
- `isCountryCode("CN")` true, `isCountryCode("C")` / `"CHN"` false.

Run `npm test` — new file fails (module missing). RED.

**Implement** — create `lib/countries.ts`:
```ts
export type CountryCode = string; // ISO 3166-1 alpha-2, uppercase

export interface Country {
  code: CountryCode;
  name: string;
  localName: string | null;
  hemisphere: "north" | "south";
  /** Curated accent hue override (OKLCH hue, 0–360). Omitted = derive from hash. */
  accentHue?: number;
  image?: string; // Wikimedia Commons hero (unused in PR1)
  mark?: string;  // cultural glyph, e.g. 同行 for CN
}
```
- A small curated table: at minimum `CN` (accentHue ≈ 29 — matches the existing vermilion `--color-seal #c93b2e`, mark `同行`, localName `中国`). Other entries optional.
- `getCountry(code: string): Country` — uppercase-normalise; curated hit, else a synthesised neutral record. Total function, never throws.
- `isCountryCode(s: string): boolean` — `/^[A-Z]{2}$/` after uppercase.
- Note per spec §5.1 the interface names `accent?: string`; PR1 implements the curated override as `accentHue?: number` so role-pinned lightness/chroma cannot be bypassed by a hex — see Judgement call J5.

**Verify:** `npm test` green; `npx tsc --noEmit`; `npm run build`.

---

### Task 3 — `lib/accent` (role-pinned OKLCH derivation)

**Goal:** the PR2 contract function: `(iso2, theme, role) → OKLCH string`, with contrast guaranteed by construction (spec §4.2), chroma clamped to the sRGB gamut max.

**Test first** — create `lib/accent.test.ts`:
- **Shape:** `accentColor("CN", "light", "ink")` matches `/^oklch\(\d+(\.\d+)?% 0(\.\d+)? \d+(\.\d+)?\)$/`.
- **Determinism:** same input twice → identical string; `"jp"` and `"JP"` identical.
- **Role-pinned lightness (spec §4.2 table):** light/ink → L 50%; light/fill → L 72%; dark/ink and dark/fill → L 80%. Assert the L component parses to exactly those values.
- **Resolution order (three layers, spec §4.2):** a user override hue wins over the curated hue, which wins over derivation. Assert all three with `"CN"`: override 200 → hue 200; no override → curated `accentHue` from `lib/countries`; a code with neither → the derived hue.
- **Separation, not merely distinction — this is a regression test.** A plain `hash(iso2) → hue` was tried first and measured badly: `CN` 324°, `TH` 321°, `VN` 325° (three countries that routinely share a trip list, all the same pink) and `IT` 48° beside `FR` 49°. Assert that **every pair in `["CN","VN","TH","JP","KR"]` differs by ≥ 20° on the hue circle**, and likewise for `["IT","FR","ES","GB","DE"]`. Circular distance — `min(d, 360 - d)`.
- **Adding a country does not reshuffle:** the hue for `"JP"` is unchanged when a code later in the ISO list is added to `lib/countries`. Pin `"JP"`'s hue as a literal so any change to the derivation is caught.
- **Gamut clamp:** exported `ACCENT_CHROMA` ≤ 0.12, and for every hue 0…359 at each pinned L (50, 72, 80), `oklchToSrgb(L, ACCENT_CHROMA, hue)` lands inside [0,1]³ (no channel clipped) — this is the "clamped to sRGB gamut maximum across all hues" requirement made executable.
- **Contrast by construction (spec §9):** iterate all 676 two-letter codes (superset of the 195 real ISO codes):
  - light theme, ink role: WCAG contrast vs white `#ffffff` ≥ 4.5.
  - light theme, fill role: contrast between the fill and the light-theme `--ink-0` value (`#17263b`, current `--color-ink`) ≥ 3.0.
  - dark theme, ink role: contrast vs the dark paper value `DARK_PAPER` exported from `lib/accent` ≥ 4.5. (`DARK_PAPER` is the single source of truth the CSS dark ramp in Task 12 must copy — keep them in sync, the test cites the CSS line.)

RED (module missing).

**Implement** — create `lib/accent.ts` (pure, no imports beyond `lib/countries`):
- `derivedHue(code: string): number` — **golden-angle over the ISO list, not a hash.** `ISO_CODES` is a sorted, frozen array of ISO 3166-1 alpha-2 codes; `hue = (indexOf(code) × 137.508) mod 360`, rounded. Consecutive indices land ~137° apart, so neighbours cannot collide. A code absent from the list (defensive only) falls back to appending its position by lexical insertion point, so it is still deterministic. Because the ISO list is a stable standard and the index comes from the code's position in it, adding a country never moves an existing one.
- `export const ACCENT_CHROMA = 0.12` (lower it if the gamut test forces it — the test is the authority, per spec: "the test is the guarantee").
- `export type AccentRole = "ink" | "fill"; export type AccentTheme = "light" | "dark";`
- `export function accentHue(iso2: string, overrideHue?: number): number` — the three-layer resolution: `overrideHue ?? curated accentHue ?? derivedHue(iso2)`. Exported separately so the Task 14 prefs picker and the Task 15 provider resolve hue through exactly this path rather than reimplementing precedence.
- `export function accentColor(iso2: string, theme: AccentTheme, role: AccentRole, overrideHue?: number): string` — L per the §4.2 table, hue from `accentHue`; returns `oklch(L% C H)`. Because L and C are pinned here, **a user-supplied hue cannot produce an illegible colour** — which is why the picker in Task 14 offers a hue wheel and not a colour field.
- `export function oklchToSrgb(l: number, c: number, h: number): [number, number, number]` — standard OKLab → linear sRGB → sRGB conversion (needed by the tests and later by any canvas/SVG consumer; ~30 lines, no dependency).
- `export const DARK_PAPER = "..."` — the dark-theme paper colour (pick ≈ `oklch(18% 0.015 250)`-equivalent hex) used by both the test and Task 12's CSS.
- Also export a plain `relativeLuminance([r,g,b])` + `contrastRatio(a, b)` used by the test (kept in `lib/accent.ts` so PR2's visual checks can reuse them).

**Verify:** three gates. This is the highest-value test in the PR — do not weaken the 676-code sweep.

---

### Task 4 — additive exports feeding the China profile

**Goal:** make the China-specific constants referenceable without duplication. Pure export additions; no behaviour change.

**Test first** — extend `lib/itinerary.test.ts` (exists) with one assertion: `GENERAL_TIPS` is exported, has length ≥ 3, and `buildTips`' output for a minimal input starts with those tips (locks the export to the value actually used). Extend `lib/route.test.ts`: `TRANSPORT.railKmh === 230`, `TRANSPORT.flightThresholdKm === 1200`, and `estimateLeg` mode flips at the exported threshold. RED (symbols not exported).

**Implement:**
- `lib/itinerary.ts` — change `const GENERAL_TIPS` (line 47) to `export const GENERAL_TIPS`.
- `lib/route.ts` — add
  ```ts
  export const TRANSPORT = {
    railKmh: RAIL_KMH,
    flightThresholdKm: FLIGHT_THRESHOLD_KM,
    flightKmh: FLIGHT_KMH,
    railBufferH: RAIL_BUFFER_H,
    flightBufferH: FLIGHT_BUFFER_H,
  } as const;
  ```
  (keeps the private consts as the single definition; existing functions untouched).

**Verify:** three gates.

---

### Task 5 — `lib/countryProfile`

**Goal:** the §5.2 seam: `getCountryProfile(code)` with China fully populated and a neutral default that degrades instead of throwing.

**Test first** — create `lib/countryProfile.test.ts`:
- `getCountryProfile("CN").seasonOfMonth(4) === "spring"` and `(1) === "winter"` (northern).
- Neutral southern profile: `getCountryProfile("AU").seasonOfMonth(1) === "summer"`, `(7) === "winter"` — the hemisphere bug fixed structurally. (Requires `AU` in the curated table with `hemisphere: "south"`, or hemisphere passed in — add `AU`, `NZ`, `ZA`, `AR`, `CL`, `PE`, `BR`, `ID` as hemisphere-only curated rows in `lib/countries`; a data row, not hand-authored content, so it does not violate the "no hand-authoring per country" rule.)
- `getCountryProfile("CN").crowdByMonth` deep-equals `NATIONAL_CROWD` from `lib/months`; `.holidays` equals `HOLIDAY_BANDS`; `.tips` equals `GENERAL_TIPS`; `.transport.railKmh === 230`; `.currency === "CNY"`.
- `getCountryProfile("CN").climateFor("East")` returns 12 rows (from `REGION_MONTHS`); `climateFor("Bavaria")` returns `null` — degrades, never throws.
- Neutral default: `getCountryProfile("XX")` — flat `crowdByMonth` (twelve equal values), `holidays: []`, `climateFor(anything) === null`, generic non-China `packing` (no RMB/Alipay/VPN strings — assert `JSON.stringify(packing)` contains none of "Alipay", "VPN", "RMB"), `currency === "USD"` placeholder? **No** — neutral currency is `null`-unsafe per interface; use `"USD"`? See Judgement call J6: neutral profile currency is `"USD"` as a documented placeholder pivot; assert it.
- Never throws: `expect(() => getCountryProfile("")).not.toThrow()`.

RED.

**Implement** — create `lib/countryProfile.ts`:
```ts
import type { Season } from "./types";
import type { PackingGroup } from "./packing";
import type { HolidayBand, RegionMonthClimate } from "./months";

export interface TransportProfile {
  railKmh: number | null;         // null = no meaningful rail estimate
  flightThresholdKm: number;
  flightKmh: number;
  railBufferH: number;
  flightBufferH: number;
  bookingCopy: string[];          // generation-time strings (12306/Trip.com for CN)
}

export interface CountryProfile {
  seasonOfMonth(month: number): Season;              // hemisphere-aware
  crowdByMonth: number[];
  holidays: HolidayBand[];
  packing: PackingGroup[];                           // whole document, not deltas
  transport: TransportProfile;
  tips: string[];                                    // generation-time, persisted
  climateFor(region: string): RegionMonthClimate[] | null; // null degrades, never throws
  currency: string;                                  // conversion pivot — spec §5.5
}

export function getCountryProfile(code: string): CountryProfile;
```
- `chinaProfile`: wraps `seasonOfMonth`/`NATIONAL_CROWD`/`HOLIDAY_BANDS`/`REGION_MONTHS` from `lib/months.ts`, `GENERAL_TIPS` from `lib/itinerary.ts`, `TRANSPORT` from `lib/route.ts`, and a packing document. For packing, the profile carries a *static representative* China packing document (spec: "whole document") — reuse the group titles/items from `lib/packing.ts` verbatim where they are static; `buildPackingList` itself is untouched and remains the live generator until PR2 rewires generation through the profile.
- `neutralProfile(hemisphere)`: hemisphere-aware season (shift by 6 months for south), flat crowd curve `[3,3,…]`, `holidays: []`, generic packing (passport/adapter/meds/walking shoes — no China strings), `climateFor: () => null`, transport with `railKmh: null` and the generic flight numbers, generic tips.
- `getCountryProfile` resolves hemisphere via `getCountry(code).hemisphere`; `"CN"` → chinaProfile; everything else → neutral. Total function.
- **Note (spec §5.2):** the interface uses `PackingGroup[]` for `packing` and `string` for `currency` — the spec's `PackingDocument`/`CurrencyCode` names do not exist in the codebase; `PackingGroup[]` *is* the packing document shape the app persists. Recorded in J6.

**Verify:** three gates.

---

### Task 6 — currency pivot (spec §5.5, assigned to PR1 by coordinator decision)

Folded in after the original plan was written: the `lib/money.ts` half of §5.5 lands here; the MoneyTab label changes ("Total CNY" etc.) are PR2's. Sequenced directly after Task 5 because the pivot's supplier is `CountryProfile.currency`. Pure, node-testable.

**Goal:** the conversion pivot stops being the hardcoded `"CNY"` (`lib/money.ts:41`, and the `home === "CNY"` check at `:48`) and becomes a parameter defaulting to `"CNY"`. Existing trips are read with an explicit `"CNY"` pivot so their persisted rate semantics ("CNY per 1 unit", `lib/tripShared.ts:102`) are preserved, never reinterpreted — a correctness requirement.

**Test first** — extend `lib/money.test.ts`:
- Back-compat pin: `convertedTotals(totals, settings)` with no pivot argument returns exactly today's values for a CNY+SGD mix (existing tests already pin the numbers — extend one to also assert `result.pivot === "CNY"` and `result.grandTotal === result.cny`).
- Explicit pivot: with `rates = { USD: 150 }` read as "JPY per 1 USD" and pivot `"JPY"`: a JPY total converts at rate 1, a USD total multiplies by 150, an unknown currency lands in `unconverted`, `home: "JPY"` resolves at rate 1.
- Seam composition: `convertedTotals(totals, settings, getCountryProfile("CN").currency)` equals the default-pivot result — proves the profile supplies the pivot with no special-casing.
- Read helper: `currencyPivot({ home: null, rates: {} })` → `"CNY"` (legacy blob without the field — the explicit-CNY guarantee); `currencyPivot({ home: null, rates: {}, pivot: "JPY" })` → `"JPY"`.
- Extend `lib/server/schemas.test.ts`: `CurrencySettingsSchema` accepts optional `pivot: "JPY"`, rejects `pivot: "JP"`, and parses legacy `{ home, rates }` bodies unchanged.

RED.

**Implement:**
- `lib/money.ts` — `convertedTotals(totals, settings, pivot = "CNY")`; replace the two hardcoded `"CNY"` comparisons with `pivot`. `ConvertedTotals` gains `pivot: string` and `grandTotal: number` (grand total in pivot minor units); **`cny` is kept**, populated with the same number as `grandTotal`, doc-commented `@deprecated equal to grandTotal; named for the CNY-pivot era — PR3 deletes it` (added-field, not rename — see J12).
- `lib/tripShared.ts` — `CurrencySettings` gains `pivot?: string` ("absent = legacy CNY-relative rates") and export `currencyPivot(settings: CurrencySettings): string` returning `settings.pivot ?? "CNY"` — the same read-boundary idiom as `tripCountry` (Task 7).
- `lib/server/schemas.ts` — `CurrencySettingsSchema` gains `pivot: CurrencyCodeSchema.optional()` (zod strips unknown keys, so without this a PR2 client's pivot would be silently dropped by the currency route).
- No component changes: `MoneyTab` keeps calling `convertedTotals(totals, settings)` and reading `.cny` — compiles and behaves identically. `app/api/trips/[id]/currency` needs no edit (the schema flows through).

**Verify:** three gates.

---

## Workstream B — Additive type changes (spec PR1 step 3)

### Task 7 — `country` + `localName` + `ChinaRegion` alias (types + zod + read helper)

**Goal:** `country` optional everywhere with a guaranteed `"CN"` at the read boundary; `localName` added alongside `chineseName` (nothing deleted); `Region` retained and mechanically aliased.

**Test first:**
- Extend `lib/server/schemas.test.ts` (exists):
  - `TripInputSchema.parse({ …minimal valid input })` (no `country`) → `.country === "CN"` (zod default at the validated write boundary).
  - `TripInputSchema.parse({ …, country: "jp" })` → `"JP"` (uppercased); `country: "JPN"` → parse failure.
- Create `lib/tripShared.test.ts`:
  - `tripCountry(dataWithoutCountry) === "CN"` (legacy blob — build a `TripData` literal whose `input` lacks `country`).
  - `tripCountry(dataWith("JP")) === "JP"`.

RED.

**Implement:**
- `lib/types.ts`:
  ```ts
  export type CountryCode = string; // re-exported from lib/countries or defined once — define in lib/countries, import type here
  export type ChinaRegion = "North" | "Northeast" | "Northwest" | "East" | "South" | "Southwest" | "Central";
  /** @deprecated PR3 retires this — use ChinaRegion. */
  export type Region = ChinaRegion;
  ```
  (the existing union literally becomes `ChinaRegion`; `Region` is the alias — mechanically identical to every consumer, zero churn.)
- `Destination` gains `localName?: string | null;` and `country?: CountryCode;` — **`chineseName` and `region` stay exactly as they are.** `lat`/`lon` are handled in Task 6, not here.
- `lib/itinerary.ts` — `TripInput` gains `country?: CountryCode;`.
- `lib/server/schemas.ts` — add
  ```ts
  const CountryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "ISO alpha-2");
  ```
  and to `TripInputSchema`: `country: CountryCodeSchema.default("CN"),`. (Zod `.default` keeps the field optional on input and guaranteed on output — every create/update trip write from now on persists a country.)
- `lib/tripShared.ts` — add the read-boundary guarantee:
  ```ts
  import type { CountryCode } from "./types";
  /** Country of a trip with the legacy-"CN" guarantee. The ONLY way callers read country. */
  export function tripCountry(data: TripData): CountryCode {
    return data.input.country ?? "CN";
  }
  ```
- **No bulk backfill, ever** (spec §5.4): do not write migrations; `country` is written through on the next natural write via the zod default. Bulk rewrites through `updateTripData` are forbidden.

**Verify:** three gates. `npm run build` matters here: the plan route and trip PATCH route flow `parsed.data.input` (now carrying `country`) into `buildTripData` → persisted `TripData` — types must line up with `TripInput.country?` (they do: schema output `country: string` is assignable to the optional field).

---

### Task 8 — widen `lat`/`lon` to nullable

**Goal:** `Destination.lat/lon: number | null` (spec §5.6 prerequisite). Route behaviour changes (`RoutePlace`, untimed transfers) are **PR2** — PR1 only widens the type and guards the compile breaks.

**Test first:** this is a type-level change; the failing "test" is the typechecker. Procedure: widen the two fields in `lib/types.ts`, run `npx tsc --noEmit`, and record the exact error sites. Verified in advance, they are exactly two:
- `components/map/MapExplorer.tsx:84–85` — curated `Destination` mapped into `MapPlace` (whose `lat: number` stays non-null).
- `components/trip/TrackerTab.tsx:121` — `{ lat: d.lat, lon: d.lon }` returned to `railKmSoFar`'s resolver.

Additionally add one runtime regression test to `lib/route.test.ts`: construct the TrackerTab resolver shape — a destination-like `{ lat: null, lon: null }` — and assert the guard pattern returns `null` (mirrors the fix below), so the narrowing convention is pinned by a test, not just by tsc.

**Implement:**
- `lib/types.ts`: `lat: number | null; lon: number | null;` (doc comment: "null = off-map place, spec §5.6; all curated data has coordinates").
- `components/map/MapExplorer.tsx`: in the curated mapping, guard before map:
  ```ts
  DESTINATIONS.filter((d) => !visited.includes(d.id) && d.lat !== null && d.lon !== null)
  ```
  then `lat: d.lat as number` is unnecessary — TS narrows through the filter only with a type-guard; simplest robust form: `.flatMap((d) => d.lat === null || d.lon === null ? [] : [{ …, lat: d.lat, lon: d.lon, … }])`.
- `components/trip/TrackerTab.tsx:121`: `return d && d.lat !== null && d.lon !== null ? { lat: d.lat, lon: d.lon } : null;`
- `RoutePlace` (`lib/route.ts`) keeps required coordinates — do not touch.
- `lib/data/*` files all carry real coordinates — untouched.

**Verify:** three gates (tsc goes red mid-task by design, green at the end). **Risk callout:** this is the one task where the tree is intentionally red between the widen and the guards — do both edits in the same commit.

---

## Workstream C — Timing fields + `setTiming` (spec PR1 step 5, §5.3)

### Task 9 — `ScheduledItem` timing + `applyPlanOp` `setTiming`

**Goal:** persistable time blocks: nullable `startMinutes`/`durationMinutes`, a `setTiming` op, `addItem`/`updateItem` accepting the fields. No UI uses them yet.

**Test first** — extend `lib/planOps.test.ts` (exists):
- `setTiming` on an existing item sets both fields; result plan is a new object (immutability), other items untouched.
- `setTiming` with `startMinutes: null, durationMinutes: null` clears timing.
- `setTiming` on a missing itemId → `{ ok: false, error: "That item no longer exists" }`; missing day → `"Day not found"`.
- `addItem` with `startMinutes: 540, durationMinutes: 90` lands them on the created item; without them, fields are absent.
- `updateItem` (title-only) on a timed item **preserves** timing — legacy behaviour: untimed items stay untimed (reflow never invents times, spec §5.3).

RED.

**Implement:**
- `lib/itinerary.ts` — `ScheduledItem` gains:
  ```ts
  /** Minutes from midnight (0–1439). null/absent = untimed (legacy) — renders in slot lane. */
  startMinutes?: number | null;
  /** Duration in minutes. null/absent = untimed. */
  durationMinutes?: number | null;
  ```
  (optional **and** nullable — legacy persisted JSON lacks the keys; see J3.)
- `lib/planOps.ts`:
  - `PlanOp` union gains `{ op: "setTiming"; day: number; itemId: string; startMinutes: number | null; durationMinutes: number | null }`.
  - `addItem` op member gains `startMinutes?: number; durationMinutes?: number`; `updateItem` gains `startMinutes?: number | null; durationMinutes?: number | null` (null clears, undefined leaves unchanged — same convention as `time`/`note`).
  - `applyPlanOp`: new `case "setTiming"` producing a patched item immutably; extend the `addItem`/`updateItem` cases to carry the fields.

**Verify:** three gates.

---

### Task 10 — zod validation for timing

**Goal:** the server accepts and bounds the new fields.

**Test first** — extend `lib/server/schemas.test.ts`:
- `PlanOpSchema.parse({ op: "setTiming", day: 1, itemId: "x", startMinutes: 540, durationMinutes: 90 })` succeeds.
- `startMinutes: 1440` fails; `-1` fails; `durationMinutes: 0` fails; non-integers fail; `startMinutes: null` with `durationMinutes: null` succeeds.
- `addItem` with timing parses; `updateItem` with `startMinutes: null` parses.

RED.

**Implement** — `lib/server/schemas.ts`:
```ts
const StartMinutesSchema = z.number().int().min(0).max(1439);
const DurationMinutesSchema = z.number().int().min(1).max(1440);
```
- Extend the `addItem` object: `startMinutes: StartMinutesSchema.optional(), durationMinutes: DurationMinutesSchema.optional()`.
- Extend `updateItem`: both `.nullable().optional()`.
- Add the `setTiming` member to the `PlanOpSchema` discriminated union: `{ op: z.literal("setTiming"), day: DayNumberSchema, itemId: ItemIdSchema, startMinutes: StartMinutesSchema.nullable(), durationMinutes: DurationMinutesSchema.nullable() }`.
- `app/api/trips/[id]/plan/route.ts` needs **no change** — `PlanEditSchema` → `applyPlanOp` flows the new op automatically (verified: route parses then calls `applyPlanOp` generically).

**Verify:** three gates.

---

### Task 11 — timing round-trip through the stores

**Goal:** the PR2 contract "round-trippable through both store backends", proven live for sqlite, mirrored by inspection for pg.

**Test first** — extend `lib/server/tripStore.test.ts`:
- `createTrip` with a `TripData` whose plan contains a day with one timed item (`startMinutes: 540, durationMinutes: 90`) and one untimed item → `getTrip` returns both intact (timed keeps exact numbers; untimed has no keys).
- `updateTripDataIf` writing a plan where the timed item was changed via `applyPlanOp(setTiming …)` → re-read shows the new values (this is the exact write path the plan route uses).

RED only if serialisation mangles anything — likely GREEN immediately (both backends store `TripData` as an opaque JSON/jsonb blob; sqlite `JSON.stringify`, pg `s.json(JSON.parse(JSON.stringify(data)))`). A test that passes first-try is still required: it pins the contract.

**Implement:** nothing beyond the test, unless it fails (it should not — no schema change is needed in either backend for timing).

**pg note:** no pg code change at all for timing; the jsonb passthrough is inspection-verified (`lib/server/pgStore.ts:290–318`). Flag for the live-pg matrix regardless.

**Verify:** three gates.

---

## Workstream D — Tokens, prefs, providers (spec PR1 step 1)

### Task 12 — token set alongside the existing `@theme`

**Goal:** the §4.1 semantic tokens plus §C5 safe-area/touch tokens, added to `app/globals.css` **without touching** the existing `@theme` block (old utilities keep working; PR3 removes the old block).

**Test first:** CSS has no unit test in this repo's harness. The executable check is Task 3's `DARK_PAPER` constant: after writing the CSS, assert by eye + a comment cross-reference that the CSS dark `--paper` equals `lib/accent.DARK_PAPER`, and add one line to `lib/accent.test.ts`: a comment-anchored assertion `expect(DARK_PAPER).toBe("<the exact value written in globals.css>")` so a drive-by CSS edit that drifts the value fails a test. Gate otherwise = `npm run build` + visual identity of the old UI (tokens are defined but consumed by nothing).

**Implement** — append to `app/globals.css` (below the existing blocks, clearly commented `/* Redesign token set — PR1. Old @theme above is retired in PR3. */`):
```css
:root {
  /* text ramp, strongest → faintest */
  --ink-0: #17263b; --ink-1: #2c3e57; --ink-2: #4a5b72; --ink-3: #78889d; --ink-4: #a8b4c4;
  /* borders */
  --line-1: #d9e7f4; --line-2: #e8eff7;
  /* panel fills */
  --surf-1: #f1f5fa; --surf-2: #e6edf5;
  /* surfaces */
  --paper: #ffffff; --raise: #f8fafd; --scrim: rgb(23 38 59 / 0.55);
  /* country accent — light defaults; providers overwrite per country (PR2 consumes) */
  --accent-ink: oklch(50% 0.12 29);
  --accent-fill: oklch(72% 0.12 29);
  /* C5 — safe area + touch targets, present from the start */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --tap-min: 44px;
}
[data-theme="dark"] {
  /* Unreachable in PR1 (toggle ships light-only) — values land now so PR2 flips a switch. */
  --ink-0: #edf2f9; /* … full dark ramp … */
  --paper: /* MUST equal lib/accent DARK_PAPER */;
  --accent-ink: oklch(80% 0.12 29);
  --accent-fill: oklch(80% 0.12 29);
  /* … */
}
```
Light values are lifted from the existing palette so PR2's shell starts visually coherent. Do **not** map these into Tailwind `@theme` yet — PR2 owns utility wiring (see J7).

**Verify:** three gates; load the app (`npm run dev` or trust build) — old UI pixel-identical since nothing consumes the tokens.

---

### Task 13 — prefs storage in both backends

**Goal:** a `user_prefs` table in sqlite **and** postgres, store functions, and the facade — no such table exists today (verified: `lib/server/db.ts` SCHEMA and `pgStore.ts ensureSchema` both lack it).

**Test first** — extend `lib/server/tripStore.test.ts`:
- `getUserPrefs("u-none")` → `null`.
- `setUserPrefs("u1", { theme: "light", accent: "country" })` then `getUserPrefs("u1")` returns it.
- `setUserPrefs("u1", { theme: "dark", accent: "#aabbcc" })` overwrites (upsert), single row.
- Corrupted JSON in the row degrades to `null` (insert garbage via `getDb()` directly in the test — matches the repo's corruption-tolerant read convention).

RED (functions missing).

**Implement:**
- Shared type — create `lib/prefs.ts` (started here, finished in Task 14):
  ```ts
  export interface UserPrefs {
    theme: "light" | "dark" | "system";
    /** "country" = derive per country; a number = one fixed hue everywhere. */
    accent: "country" | number;
    /** Sparse per-country hue overrides, ISO alpha-2 → hue 0-359. */
    accentHues: Record<string, number>;
  }
  export const DEFAULT_PREFS: UserPrefs = { theme: "light", accent: "country", accentHues: {} };
  ```
- `lib/server/db.ts` — append to `SCHEMA` (CREATE TABLE IF NOT EXISTS — additive, existing DBs pick it up on next open):
  ```sql
  CREATE TABLE IF NOT EXISTS user_prefs (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  ```
- `lib/server/tripStore.ts` — `getUserPrefs(userId): UserPrefs | null` (JSON.parse with try/catch → null) and `setUserPrefs(userId, prefs): void` (INSERT … ON CONFLICT(user_id) DO UPDATE — same idiom as `trip_settings`).
- `lib/server/pgStore.ts` — mirror: `user_prefs (user_id text PRIMARY KEY, data jsonb NOT NULL, updated_at bigint NOT NULL)` added inside `ensureSchema()`, plus async `getUserPrefs`/`setUserPrefs` using the upsert idiom already used for `trip_settings` (`pgStore.ts:560`).
- `lib/server/store.ts` — facade passthroughs (same `storeMode()` switch as every other function).

**Verify:** three gates. **pg is inspection-only here** — see the rollback note R2 and the pre-deploy flag.

---

### Task 14 — prefs cookie + endpoint

**Goal:** read/write endpoint and the cookie used for correct first paint.

**Test first:**
- Finish `lib/prefs.ts` and create `lib/prefs.test.ts`:
  - `parsePrefsCookie(undefined)` → `DEFAULT_PREFS`.
  - `parsePrefsCookie("theme=dark&accent=country")` (or JSON form — pick URL-encoded `key=value` pairs; simplest to parse allowlist-safely in an inline script) → `{ theme: "dark", accent: "country" }`.
  - Garbage / unknown theme / out-of-range accent → `DEFAULT_PREFS` (strict allowlist: theme ∈ {light,dark,system}; accent = `"country"` or an integer 0–359; `accentHues` entries dropped individually unless the key matches `^[A-Z]{2}$` and the value is an integer 0–359).
  - `serializePrefsCookie(prefs)` round-trips through `parsePrefsCookie`.
- Extend `lib/server/schemas.test.ts`: `PrefsSchema` accepts `{ theme: "dark", accent: "country" }`, `{ theme: "light", accent: 210 }` and `{ accentHues: { CN: 200, JP: 40 } }`; rejects `theme: "purple"`, `accent: 400`, `accent: "#1d5c9e"` (hex is no longer a valid accent), `accentHues: { china: 10 }` (bad key) and `accentHues: { CN: 999 }`; missing fields → defaults applied (`.default("light")` / `.default("country")` / `.default({})`).

RED.

**Implement:**
- `lib/prefs.ts` — `PREFS_COOKIE = "cip-prefs"`, `parsePrefsCookie`, `serializePrefsCookie` (pure; usable server- and client-side).
- `lib/server/schemas.ts`:
  ```ts
  const HueSchema = z.number().int().min(0).max(359);
  export const PrefsSchema = z.object({
    theme: z.enum(["light", "dark", "system"]).default("light"),
    accent: z.union([z.literal("country"), HueSchema]).default("country"),
    accentHues: z.record(z.string().regex(/^[A-Z]{2}$/), HueSchema).default({}),
  });
  ```
  **Hues, not hex, everywhere** — both the fixed accent and the per-country
  overrides. A hex would bypass the role-pinned lightness in Task 3 and void the
  contrast guarantee; a hue cannot. This is also why no `javascript:`-style
  injection test is needed on the accent value: it is a bounded integer, not a
  string. Keep the injection test on `theme`.
- Create `app/api/me/prefs/route.ts`:
  - `GET`: `getSessionUser(req)` (from `lib/server/session.ts`); 401 `{ error }` when null; else `getUserPrefs(user.id) ?? DEFAULT_PREFS`; if `storeMode() === "unavailable"` → 503 `DB_UNAVAILABLE` (same guard as every route).
  - `PUT`: session-gated; `PrefsSchema.safeParse` → 400 on failure; `setUserPrefs`; respond with the prefs **and** `Set-Cookie: cip-prefs=<serialized>; Path=/; Max-Age=31536000; SameSite=Lax` — **not** HttpOnly, deliberately: the first-paint inline script must read it (contents are non-sensitive, allowlist-validated on every read; see J8).
- Route handler itself follows repo convention: thin wiring, no route-level test (all logic — schema, store, cookie codec — is lib-tested; `authz.test.ts` covers the session helper family).

**Verify:** three gates; manual: `curl -X PUT localhost:3000/api/me/prefs` unauthenticated → 401.

---

### Task 15 — theme + accent providers and first-paint script

**Goal:** providers wired into the layout; theme applied before first paint via cookie + inline script. Theme toggle ships **hidden** (PR1: old components hardcode the light palette; a dark toggle would restyle half the app — spec §10.1).

**Test first:** two layers, both RED before implementation.
- Pure: add to `lib/prefs.test.ts` (node project) the pure function introduced here: `resolveAccentVars(prefs, countryCode, theme)` → `{ "--accent-ink": string; "--accent-fill": string }`. Assert the full precedence chain from spec §4.2:
  - `accent: "country"`, no override → Task 3's `accentColor("CN", theme, role)`.
  - `accentHues: { CN: 200 }` → hue 200 for both vars, **beating the curated hue** for CN.
  - `accent: 40` (fixed mode) → hue 40 regardless of country, and `accentHues` is ignored in fixed mode.
  - Both roles keep their pinned lightness in every case above — the guarantee must survive a user-chosen hue, which is the whole reason the picker is a hue wheel.

  Implement `resolveAccentVars` in `lib/prefs.ts`, delegating precedence to Task 3's `accentHue()` rather than reimplementing it.
- Component (Task 1's jsdom project): create `components/shell/PrefsProvider.test.tsx` — renders children; pins `data-theme="light"` on `document.documentElement` regardless of a `cip-prefs=theme=dark…` cookie (the PR1 pinning behaviour); `usePrefs()` exposes the parsed cookie prefs; a `setPrefs` call writes the cookie (mock `fetch` for the fire-and-forget PUT).

**Implement:**
- Create `components/shell/PrefsProvider.tsx` (`"use client"`): React context holding `UserPrefs` + `setPrefs`; initial state from `parsePrefsCookie(document.cookie …)` (guarded for SSR); on change: writes the cookie, PUTs `/api/me/prefs` (fire-and-forget, errors swallowed to console), sets `data-theme` on `<html>` and the two accent vars on `document.documentElement.style`. Exports `usePrefs()`. In PR1 `data-theme` is **pinned to `"light"`** regardless of stored pref (old UI is light-hardcoded); the stored value is still persisted so PR2 honours it. No toggle UI is rendered anywhere.
- Inline first-paint script — in `app/layout.tsx`, inside `<html>` before `<body>` content (a `<script dangerouslySetInnerHTML>` with a **constant** string — no interpolation of any user value, so no injection surface):
  ```js
  (function(){try{
    var m=document.cookie.match(/(?:^|; )cip-prefs=([^;]*)/);
    var t="light"; // PR1: forced light; PR2 replaces this line with allowlist lookup
    document.documentElement.setAttribute("data-theme",t);
  }catch(e){document.documentElement.setAttribute("data-theme","light")}})();
  ```
  The cookie read is present (dead-stored into a var PR2 will use) so PR2's change is one line, and the no-flash mechanism is proven now.
- Wire `PrefsProvider` around `{children}` in `app/layout.tsx` (inside `<body>`, around `AppHeader` + children).
- Per `AGENTS.md`: before writing the layout/script changes, check `node_modules/next/dist/docs/` for the Next 16 guidance on inline scripts in the App Router root layout, and follow it if it differs from the above.

**Verify:** three gates; `npm run dev`, load `/` — visually identical, `<html data-theme="light">` present, no hydration warnings in the console.

---

## Workstream E — Trip-payload accessor (spec PR1 step 4, contract C4)

The riskiest workstream. Sequenced last so everything else lands even if this needs iteration. Three tasks: pure core (node-tested), hook (thin, jsdom-tested via the Task 1 harness), TripView swap (isolated commit).

### Task 16 — pure payload core

**Goal:** every piece of accessor logic that can be a pure function, extracted and unit-tested in the node harness.

**Test first** — create `lib/tripPayloadCore.test.ts` covering, at minimum:
- `reducePayload(prev, fresh, force)` — version-monotonic: fresh with lower/equal version is dropped unless `force`; higher version replaces; `prev === null` always accepts. (Mirrors `TripView.applyPayload`, `components/TripView.tsx:62–64`.)
- `applyOptimisticCheck(payload, key, checked, myName)` — checked adds/replaces `{key, by: myName}`; unchecked removes; input payload not mutated (immutability).
- `classifyTripResponse(status, json)` → discriminated union: `404 → {kind:"not-found"}`, `403 → {kind:"private"}`, `!ok → {kind:"error"}`, `json.guest === true → {kind:"guest", view}`, else `{kind:"member", payload}`. (Mirrors `fetchTrip`, lines 70–88.)
- `createSeqGuard()` — `issue()` returns increasing tokens; `isCurrent(t)` false after a newer issue; `invalidate()` bumps without issuing (the join-flow trick at line 139).
- `extractMutationError(json)` → string from `{error}` else the generic copy (mirrors `mutate`, lines 182–183).

RED.

**Implement** — create `lib/tripPayloadCore.ts` (pure, imports only types from `lib/tripShared`). Export `POLL_MS = 4000` from here too (single home for the constant).

**Verify:** three gates.

---

### Task 17 — `useTripPayload` hook

**Goal:** the C4 accessor. All fetching of trip-payload data lives here; components stop calling `fetch` for trip data.

**Test first** — create `lib/useTripPayload.test.tsx` (jsdom project, `renderHook` from `@testing-library/react`, `vi.stubGlobal("fetch", …)` + `vi.useFakeTimers()`):
- Initial fetch resolves a member payload → `loadState === "member"`, `payload` set.
- Version-monotonic through the hook: a poll response carrying a **lower** version does not regress `payload`; a higher one replaces it (advance timers past `POLL_MS`).
- Response classification: 403 → `"private"`; 404 → `"not-found"`; `{ guest: true }` body → `"guest"` with `guestView` set and the `cip-guest-code-*` localStorage write.
- `mutate` with a non-ok response returns the server's error string and triggers a forced refetch (assert an extra fetch call).
- `toggleCheck` applies the optimistic check synchronously (payload shows the tick before the mocked response resolves); a failed response forces a refetch.
- Unmount clears the poll interval — advancing timers after unmount issues no further fetch.

RED (module missing). The hook stays a thin composition of Task 16's tested core over `fetch`/`setInterval`/listeners: any branch more complex than "call core, set state" still belongs in `tripPayloadCore` with a node test — the jsdom tests cover the wiring the core cannot.

**Implement** — create `lib/useTripPayload.ts` (`"use client"`):
```ts
export type TripLoadState = "loading" | "member" | "guest" | "private" | "not-found";

export interface TripPayloadAccessor {
  payload: TripPayload | null;
  guestView: GuestTripPayload | null;
  loadState: TripLoadState;
  guestCode: string;
  setGuestCode(code: string): void;
  refetch(force?: boolean): Promise<void>;
  /** POST/PATCH/DELETE returning a fresh TripPayload; error string for forms, null on success. */
  mutate(url: string, init: RequestInit): Promise<string | null>;
  toggleCheck(key: string, checked: boolean, myName: string): Promise<void>;
  joinTrip(code: string, claimName: string | null): Promise<string | null>;
  loadClaimable(): Promise<string[]>;
}

export function useTripPayload(tripId: string): TripPayloadAccessor;
```
Absorbed from `TripView` (verbatim behaviour, expressed through the core):
- `POLL_MS` polling + visibilitychange/focus refetch (lines 99–113), interval cleaned up on unmount.
- `fetchSeq` out-of-order guard (lines 53, 68–79) via `createSeqGuard`.
- Version-monotonic apply (lines 62–64) via `reducePayload`.
- Optimistic `toggleCheck` with forced-refetch reconciliation on failure (lines 145–170).
- Shared `mutate` (lines 175–192).
- `joinTrip` with seq invalidation + forced apply (lines 130–143); guest-code persistence to `localStorage` (`cip-guest-code-*`) moves in with `fetchTrip`.
- The boundary contract names `payload`, `loadState`, `refetch(force)`, `mutate` — those four are sacred; the additional members are the minimum TripView needs and are additive to the contract (PR2 may ignore them).

**Verify:** three gates (the hook is imported only by its test — nothing in the app consumes it yet, which keeps this commit revertible).

---

### Task 18 — TripView consumes the hook

**Goal:** delete the duplicated logic from `components/TripView.tsx`; behaviour unchanged from the user's perspective. **One isolated commit** (see rollback R1).

**Test first:** the existing suite + gates are the harness. Before editing, record the observable behaviours to re-verify manually: initial load → member view; poll updates version; checkbox optimistic tick + server reconcile; add-day; guest code path (`?code=`); private gate wrong/right code; join flow; not-found forgets the trip.

**Implement:**
- `components/TripView.tsx`: replace `payload/guestView/loadState/guestCode` state, `fetchSeq`, `applyPayload`, `fetchTrip`, both effects, `toggleCheck`, `mutate`, `joinTrip`, `loadClaimable` with `const trip = useTripPayload(tripId);` destructuring. Local `POLL_MS` and `TABS` — delete `POLL_MS` (now in core). All the per-endpoint helpers (`planOp`, `addTicket`, …) stay in TripView but call `trip.mutate`. `PrivateGate.onSubmitCode`'s probe fetch (line 252) is replaced by `setGuestCode(code)` + `refetch` classification through the hook (the hook's `refetch` after `setGuestCode` reproduces the probe; on `private` state the gate re-renders with the error — implement `probeCode(code): Promise<string | null>` on the accessor if the inline error copy cannot be reproduced otherwise, and note it as an accessor member addition).
- `claimable` UI state (`useState<string[] | null>`) stays in TripView, populated via `trip.loadClaimable()`.
- Confirm with a grep that after the swap, `fetch(` appears in `components/TripView.tsx` **zero** times.

**Verify:** three gates, then `npm run dev` and walk the recorded behaviours (member trip, guest code, private gate, checkbox, add day). C4 grep (also rechecked in Task 19): the only `fetch` calls touching `/api/trips/${tripId}` outside `lib/useTripPayload.ts` are `components/trip/BriefingShare.tsx` (briefing-link management — its own endpoint, does not return `TripPayload`) and `components/trip/JournalSection.tsx:66` (multipart photo upload). Both are outside the trip-payload contract as specced; recorded in J9 so PR2 does not "fix" them accidentally.

---

## Task 19 — final gate + contract sweep

**Goal:** prove PR1's promises before handing to PR2.

**Steps:**
1. All three gates from a clean checkout of the branch.
2. Contract greps (record output in the PR description):
   - C4: `grep -rn "fetch(\`/api/trips/" components app lib --include="*.tsx" --include="*.ts"` → only `lib/useTripPayload.ts` + the two documented exceptions.
   - Boundary exports exist: `lib/accent` `accentColor`, `lib/countryProfile` `getCountryProfile`, `lib/useTripPayload` `useTripPayload`, `lib/tripShared` `tripCountry` and `currencyPivot`, `lib/money` pivot-aware `convertedTotals`.
   - No consumer reads `data.input.country` directly except `tripCountry` (grep `input.country`).
3. `npm test` — full suite, both projects (node + jsdom); optionally `npx vitest run --coverage` if `@vitest/coverage-v8` is present (it is **not** a current devDependency — do not add it silently; note coverage was assessed by inspection against the 80% standard: every new module in this PR carries a test file — including the hook and `PrefsProvider` via the Task 1 jsdom harness; the only untested wrappers are the thin route handlers, per repo convention).
4. Visual: `npm run dev`, click through `/`, `/plan`, a trip page — identical to `main`.
5. Confirm the diff contains **no** edits to: `lib/packing.ts`, `lib/months.ts` behaviour (only possible export additions), `components/DestinationStep.tsx`, `components/DetailsStep.tsx`, wizard order, `ChinaMap`, money/settlement logic — all PR2/PR3 territory.

---

## Rollback notes (the two riskiest tasks)

**R1 — Accessor extraction (Tasks 16–18).** Tasks 16 and 17 are purely additive (new files, imported only by their tests) — reverting them is deleting files. All behavioural risk is concentrated in Task 18, which must therefore be a single commit touching only `components/TripView.tsx` (plus at most one accessor-member addition in `lib/useTripPayload.ts`). Rollback = `git revert <task-18-sha>`: TripView returns to its self-contained implementation, the hook remains as dead-but-tested code, tree green. Do not interleave any other change into that commit. If a subtle regression (polling storm, stale-guest flash, lost optimistic tick) is found after later commits land, the revert still applies cleanly because no other PR1 task touches TripView.

**R2 — Prefs table across two backends (Task 13).** Both backends add the table via `CREATE TABLE IF NOT EXISTS` inside the existing schema bootstrap — no ALTER, no data migration, no touch of existing tables. Rollback = revert the commit; an already-created `user_prefs` table is left behind in any DB that ran the code, which is inert (nothing else references it) and can be dropped manually later. Two cautions: (a) **pg**: `ensureSchema` caches its promise in `globalThis.__cipSchemaReady` and clears it on failure — keep the new DDL inside the existing `(async () => { … })()` block so a failure in the new statement retains the retry semantics, and mis-typed DDL will fail *every* request on a fresh deploy: test the exact statement against a scratch Postgres before merging (project memory: pg path is inspection-verified only — run the live-pg matrix before any pg deploy). (b) **sqlite**: the SCHEMA string executes on every `getDb()` cold start including tests; a syntax error breaks every store test — the Task 13 tests catch this immediately.

---

## Judgement calls

- **J1 — "Read-boundary zod default" has no zod read path to hang on.** The spec (§5.4, PR1 step 3) says `country` defaults to `"CN"` "at the read boundary via a zod default". Verified reality: nothing zod-parses `TripData` on read — `getTrip` casts `JSON.parse` output (`tripStore.ts:119`, `pgStore.ts:245`). Introducing full zod validation of persisted blobs on every read would be new (risky, non-additive) behaviour. Decision: the zod `.default("CN")` lands on `TripInputSchema` (the validated **write** boundary, so every new write persists a country), and the read-side guarantee is the exported `tripCountry(data)` helper, which PR2 must use exclusively. The boundary contract's wording ("readable off trip data with a guaranteed CN default") is satisfied; the mechanism differs from the spec's letter.
- **J2 — Component test infrastructure (RESOLVED — was: hook testing without jsdom).** Originally flagged: vitest was node-only (`vitest.config.ts`: `lib/**/*.test.ts`, `environment: "node"`) with no React testing library, and this plan declined to add dependencies silently. The decision came back approving them: Task 1 adds `jsdom` + `@testing-library/react` + `@testing-library/jest-dom` and restructures vitest into two projects (node for `lib/**/*.test.ts`, untouched; jsdom for `*.test.tsx`). The accessor hook is therefore tested directly (Task 17) and `PrefsProvider` gets a component test (Task 15), rather than relying only on pure cores. The pure-core extraction (Task 16) is deliberately retained: framework-free logic with node tests is good design independent of testability, and the jsdom tests cover only the wiring the core cannot. jest-dom was a judgement within the mandate — dev-only, and its matchers keep component assertions readable.
- **J3 — Timing fields are `?: number | null`, not `: number | null`.** Spec §5.3 writes `startMinutes: number | null`. Legacy persisted items have **no** key at all, so a required-nullable field would make every existing blob type-lying. Optional-and-nullable matches the persisted reality and the existing `time?`/`note?` convention; zod ops use `.nullable()` where "explicit clear" semantics are needed.
- **J4 — `lat`/`lon` widening is not literally additive.** Widening a required property breaks assignability at exactly two verified call sites (`components/map/MapExplorer.tsx:84`, `components/trip/TrackerTab.tsx:121`); PR1 adds narrowing guards there. `RoutePlace` keeps required coordinates — the "untimed transfer / no estimate" behaviour of §5.6 is PR2. The tree is intentionally red *within* Task 6 between the widen and the guards; one commit.
- **J5 — Curated accent override is a hue, not a hex.** Spec §5.1 declares `Country.accent?: string`. A free-form hex override would bypass the role-pinned lightness that makes §9's contrast test pass by construction (the exact failure §4.2 documents). PR1 implements the curated override as `accentHue?: number` (hue only; L and C stay pinned). **Superseded in part:** the user-facing accent preference is now also hue-based, not hex — see J13. If a full-colour override is truly wanted later, it must carry its own contrast proof.

- **J13 — Accent is a hue at every layer, and users can override per country.** Decided after the plan was written, on seeing measured derivation output. Two changes. (a) Derivation is golden-angle over the ISO list rather than a hash: the hash put `CN` 324° / `TH` 321° / `VN` 325° and `IT` 48° / `FR` 49°, so countries that share a trip list rendered identically; Task 3 now carries a ≥20° separation regression test. (b) `UserPrefs` gains `accentHues`, a sparse ISO→hue map, and the fixed `accent` becomes a hue too. Everything the user can choose is a hue, so the role-pinned lightness in Task 3 applies uniformly and **no user selection can produce an illegible colour** — which is what lets the picker be a hue wheel with no validation beyond a range check. Overrides are per user, not per trip: shared trips may look different to different members, accepted deliberately to avoid shared-state conflict resolution.
- **J6 — Spec type names that don't exist in the code.** §5.2 references `PackingDocument` and `CurrencyCode` types and a `NATIONAL_CROWD`-behind-interface move; the codebase has `PackingGroup[]` (the actual persisted packing shape) and plain `string` currency codes. The profile interface uses the real types. The neutral profile's `currency` is `"USD"` as a documented placeholder pivot (spec gives no neutral value; `null` would violate the non-optional `currency` field and push undefined-handling onto PR2, which the money code (§5.5) resolves properly with per-trip pivots). Also: the spec's §5.2 note "`REGION_MONTHS` … throws" on unknown keys is accurate at the type level; `climateFor` wraps it with a null-degrade as specced.
- **J7 — Tokens are plain `:root` custom properties, not Tailwind `@theme` entries, in PR1.** Mapping them into `@theme` would generate utility classes nothing uses yet and risks colliding with the retiring block. PR2 (which builds the shell that consumes them) owns the Tailwind wiring; PR1 guarantees the variables exist with correct values in both ramps.
- **J8 — Prefs cookie is deliberately not HttpOnly.** The first-paint inline script must read it before React hydrates. Contents are a theme enum + an allowlisted accent token, validated on every parse (`parsePrefsCookie` rejects anything outside the allowlist); nothing sensitive. The inline script itself is a constant string with zero interpolation.
- **J9 — C4's blast radius.** Two components legitimately fetch trip-scoped endpoints that are not the trip payload: `BriefingShare` (briefing-link management, own response shape) and `JournalSection` (multipart photo upload). They are outside the "trip data" contract and stay as-is in PR1; PR2's cache layer under the accessor does not need them. Recorded so neither parallel plan "fixes" them into the hook unprompted.
- **J10 — Spec's "no migration runner in either backend" vs `lib/server/migrate.ts`.** The file exists but is a lazy read-time upgrader (`planIdMigration`, applied inside `getTrip`), not a fleet-wide runner — the spec's claim and its no-bulk-backfill conclusion stand. Noted only so the file's existence doesn't read as contradicting the spec.
- **J11 — Southern-hemisphere data rows in `lib/countries`.** Fixing the hemisphere bug structurally needs *some* country to be marked southern. A handful of hemisphere-only curated rows (AU, NZ, ZA, AR, CL, PE, BR, ID) is data, not per-country hand-authoring of content, and is the minimum to make the Task 4 hemisphere test meaningful. A latitude-derived hemisphere (spec §5.2 "hemisphere from latitude") needs per-country centroids PR1 doesn't have; the curated rows are the stopgap and the map data in PR2 can replace them.
- **J12 — Currency pivot: added fields, not a rename; optional trailing parameter.** Spec §5.5 (assigned to PR1 by coordinator decision) forces a choice on `ConvertedTotals.cny`. Renaming it would touch `MoneyTab` — UI territory that PR2 owns and the strictly-additive constraint forbids here. Decision (Task 6): `convertedTotals` gains an optional trailing `pivot = "CNY"` parameter (existing callers untouched, legacy correctness guaranteed by the default), `ConvertedTotals` gains `pivot` and `grandTotal`, and `cny` is kept as a deprecated field always equal to `grandTotal` until PR3 deletes it — its name is only *accurate* when the pivot is CNY, which is true for every caller that exists in PR1. Additionally `CurrencySettings` gains an optional persisted `pivot` (spec: "new trips record their pivot alongside the rates") with `currencyPivot(settings)` as the read-boundary helper mirroring `tripCountry` — legacy blobs lack the field and are read with an explicit `"CNY"` pivot, never reinterpreted. The zod schema must list `pivot` explicitly or the currency route would silently strip it (zod strips unknown keys).
