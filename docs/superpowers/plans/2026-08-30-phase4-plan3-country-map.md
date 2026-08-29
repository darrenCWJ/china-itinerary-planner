# Phase 4 — Plan 3: the L2 country map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a real map at the country level for all 246 countries — outline, selectable admin-1 units, city markers — replacing the list-only fallback, and ship the projection manifest that makes each country fit its viewport.

**Architecture:** Plan 2 committed `public/provinces/<CC>.json`, and `merge()` over a file's units yields that country's outline, so one fetch feeds both. This plan adds the manifest that tells the renderer how to project each country, turns `hasDetailLevel(country) === "CN"` into a registry read from `public/provinces/index.json`, and generalises `ChinaLevel` into a country level that China is one instance of. The list stays and stays authoritative — §5.2's invariant is that the map never becomes the only way to select a place, and Plan 1's §12.2 tests already enforce it.

**Tech Stack:** Node 24, `topojson-client@3.1.0` (`merge`, `feature`), `d3-geo@3.1.1` (`geoMercator`, `geoBounds`, `geoCentroid`, `geoArea`), React 19, TypeScript 7, Vitest 4.

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) — §5.1, §5.3, §5.4, §5.5, and §6.2. **§6.1's `MapLevel` third member and the province zoom are NOT in this plan** — that is L3, and it is Plan 4.

---

## What this plan already measured

The manifest was computed for real against the committed merged outlines, so §14.5 is settled and no task below asserts a derived number.

```
246 entries   20,842 B raw   6,881 B gzip   mean 84.7 B/entry
```

The spec predicted 235 entries at 20,939 B raw / 7,438 B gzip, mean 89.1 B/entry — so the **entry shape is confirmed**; only the population changed.

**The rule reproduces the spec's own published answer.** Run against the 50m admin-0 source the spec measured on, this implementation returns ZA at `1123.2072 → 2383.24`, gain 2.12×, hiding one polygon of **243.1 km²** — the spec's table says `1123.21 → 2383.24`, 2.12×, "Prince Edward Is. 243.1". NL comes back hiding 3 polygons at 0.681% ending at scale 7327.81, all three exactly as published.

### §14.5 answered: the manifest is smaller than the spec expected, because the territory policy did most of the work

Nine countries accept a trim, and **NL and NZ are no longer among them**:

| code | hides | % area | scale before → after | gain |
|---|---|---|---|---|
| FR | 1 | 0.001% | 414.79 → 2518.21 | 6.07× |
| FJ | 7 | 0.890% | 3671.62 → 11120.88 | 3.03× |
| PN | 1 | 0.338% | 8246.73 → 20006.43 | 2.43× |
| MU | 1 | 0.697% | 3354.36 → 7959.76 | 2.37× |
| TF | 7 | 0.345% | 774.84 → 1797.70 | 2.32× |
| ZA | 2 | 0.026% | 1159.74 → 2451.61 | 2.11× |
| AI | 1 | 0.288% | 78001.92 → 146235.93 | 1.87× |
| GQ | 1 | 0.053% | 6765.10 → 12463.37 | 1.84× |
| CR | 1 | 0.031% | 6168.83 → 11028.87 | 1.79× |

**NL's headline 11.51× is gone because the problem was solved structurally instead.** Bonaire, Saba and Sint Eustatius are now `BQ.json`, their own country, so they are no longer polygons of the Netherlands for a projection to hide. NZ's trim went the same way when Tokelau became `TK.json`. That is D5 and D6 paying off in a place the spec did not anticipate, and it is worth saying out loud: **a cartographic workaround was retired by a data-model decision.**

Five countries rotate: `FJ -178.19`, `KI 171.13`, `NZ -174.89`, `RU -105.31`, `US 130.18`. Everything else takes `rotate: 0`, as §5.4's rule 1 requires.

### Three spec defects this measurement found

1. **Every scale in the spec's committed manifest is computed against the wrong viewport.** Reproducing ZA's published `2383.2504` requires an **860 × 600** box; the app renders into **860 × 620** ([lib/mapView.ts:12-13](../../../lib/mapView.ts)). §5.4 says `scale` "is the committed expected value the build-time test recomputes" — so such a test would fail on all 235 entries. This plan computes against 860 × 620 and takes the constant from `lib/mapView.ts` rather than a literal.
2. **Gate B has no formula and no unit.** §5.4 says "separation ≥ 0.5, measured from the polygon to the anchor" and never defines it. Raw great-circle radians cannot be it — Prince Edward Is. sits 0.356 rad from South Africa and the spec accepts it. Task 1 uses **centroid separation in degrees, normalised by the anchor's own bbox diagonal**, which is scale-free and therefore comparable between Australia and the Netherlands. It was recovered by treating the spec's published gains as an oracle, and it reproduces NL, ZA, NC and FJ on the 50m source while correctly refusing to hide Tasmania and Stewart Island — the two cases §5.4 says the gate exists for.
3. **Every `CountryMap.tsx` anchor in the spec has drifted**, because Plan 1's own commit `35bfba6` rewrote `CountryPlaceList`. Corrected anchors are in Global Constraints below. The `MapExplorer.tsx` anchors were re-verified and are all still exact.

---

## Global Constraints

- **Corrected file anchors.** `hasDetailLevel` is at `CountryMap.tsx:49-51` (spec says `:55`); `radiusFor`/`labelFor` at `:283-293` (spec says `:250-255`); the projection `useMemo` at `:233-251`; the zoom transform at `:253-262`; `transformForFeatures` call at `:259` (spec says `:222`); markers at `:418-434`; `Object.keys(topology.objects)[0]` at `:234` (spec says `:196`); `REGION_META` iteration at `:364-382` (spec says `:327`). `MapExplorer.tsx:153/187/224/285/499/512/536/566/588` are exact. `RouteMap.tsx:171-172` hard-codes `zoomRegion={null}`.
- **`k` divides everything.** The zoom transform's `k` is destructured at `CountryMap.tsx:262` and divides every stroke width, radius, dash length and font size so visual weight is scale-invariant. A new renderer must keep that discipline. The one unscaled case is the curated marker radius `7` at `:289`, because `k` is 1 at country level.
- **Never a GeoJSON `Polygon` rectangle for `fitExtent`.** d3-geo reads rings spherically, so a clockwise rect is *the globe minus the rect* and every fit collapses. Use the three-longitude MultiPoint of §5.5.
- **The caller owns the loading state.** `CountryMap` renders `null` while `topology` is undefined (`:84-99`); `MapExplorer:499` and `RouteMap:149` own the skeletons. A new province fetch must preserve that contract or the skeletons double up.
- **The list is the accessibility spine and never becomes optional.** Plan 1's `components/map/CountryMap.test.tsx` "reachability — the Phase 4 acceptance criterion" block is the gate. If a task makes it fail, the task is wrong.
- **`.test.ts` under `components/` runs in NO vitest project.** Pure logic goes in `lib/` or `scripts/`.
- **`--reporter=basic` does not exist in Vitest 4.**
- **`scripts/*.mjs` may import `lib/*.ts` leaf modules only** — `lib/countries.ts` and `lib/mapView.ts` qualify; anything importing a sibling `.ts` does not.
- **Commit messages:** conventional commits, ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `scripts/build-projections.mjs` | **new** — the §5.4 rule over the committed outlines | Create |
| `scripts/build-projections.test.ts` | its pure functions | Create |
| `public/country-projections.json` | the manifest | Generated |
| `data/projections-report.md` | the committed measurement record | Generated |
| `lib/countryProjection.ts` | **new** — load a manifest entry, build its projection | Create |
| `lib/countryProjection.test.ts` | including the §5.5 renderer trap | Create |
| `lib/countryDetail.ts` | **new** — the `COUNTRY_DETAIL` registry | Create |
| `components/map/CountryLevel.tsx` | **new** — the generic country map | Create |
| `components/map/CountryLevel.test.tsx` | jsdom | Create |
| `components/map/SelectedPlaceCard.tsx` | **new** — §5.3.3's net-new surface | Create |
| `components/map/CountryMap.tsx` | dispatcher gains the map branch | Modify: `:49-51`, `:84-99` |
| `components/map/MapExplorer.tsx` | registry + per-country province fetch | Modify |
| `components/map/RouteMap.tsx` | stop being blank for worldwide trips | Modify |

`CountryLevel` is a new file rather than a rewrite of `ChinaLevel` because `ChinaLevel` carries China's region grouping, which is L3's problem (Plan 4). Keeping them separate means this plan never touches the code path §9.5 requires to stay byte-identical.

---

### Task 1: The projection rule, as pure functions

**Files:** Create `scripts/build-projections.mjs`, `scripts/build-projections.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported: `rotationFor(polygons) -> number`, `boxOf(polygon, lambda) -> {x0,x1,y0,y1}`, `unionOf(boxes, indices)`, `scaleOf(union, lambda, viewBox) -> number`, `separation(anchorPolygon, polygon) -> number`, `trimTrajectory(polygons, lambda, anchor) -> Array<{dropped, hidden, gain, sep, scale, union}>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { MAP_VIEW_H, MAP_VIEW_W } from "@/lib/mapView";
import { boxOf, rotationFor, scaleOf, separation, unionOf } from "./build-projections.mjs";

const BOX: [[number, number], [number, number]] = [[0, 0], [MAP_VIEW_W, MAP_VIEW_H]];
/** A closed square ring, as one polygon. */
const sq = (x: number, y: number, w = 1) =>
  [[[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]]];

describe("rotationFor", () => {
  test("is zero when the country does not cross the antimeridian", () => {
    expect(rotationFor([sq(10, 10)])).toBe(0);
  });

  test("centres a country that straddles ±180", () => {
    // Fiji really does span the antimeridian; without a rotation its bounds
    // read as a ~357° span instead of a ~3° one and the fit collapses.
    const l = rotationFor([sq(178, -18), sq(-179, -18)]);
    expect(l).toBeLessThan(0);
    expect(Math.abs(l)).toBeGreaterThan(170);
  });

  test("normalises the rotated longitude back into ±180", () => {
    // The bug this pins: rotating by -178 sends lon -179 to -357, not to +3.
    const l = rotationFor([sq(178, -18), sq(-179, -18)]);
    const b = unionOf([boxOf(sq(178, -18), l), boxOf(sq(-179, -18), l)], [0, 1]);
    expect(b.x1 - b.x0).toBeLessThan(10);
  });
});

describe("scaleOf", () => {
  test("uses the app's real viewport, not a rounded one", () => {
    // The spec's committed manifest was computed against 860x600 and the app
    // renders into 860x620 (lib/mapView.ts). Reproducing the spec's published
    // ZA scale of 2383.2504 requires the 600; this must not.
    const u = { x0: 16.4468, x1: 32.8845, y0: -34.7854, y1: -22.1456 };
    expect(scaleOf(u, 0, BOX)).toBeCloseTo(2462.6921, 3);
    expect(scaleOf(u, 0, [[0, 0], [860, 600]])).toBeCloseTo(2383.2504, 3);
  });

  test("does not collapse the way a Polygon rectangle would", () => {
    // §5.5: d3-geo reads rings spherically, so a clockwise rect is the globe
    // MINUS the rect and every fit collapses to about height/(2π).
    const u = { x0: 0, x1: 10, y0: 0, y1: 10 };
    expect(scaleOf(u, 0, BOX)).toBeGreaterThan(1000);
  });
});

describe("separation — Gate B", () => {
  test("is scale-free, so 0.5 means the same for a large country and a small one", () => {
    // The spec gives no formula and no unit. Raw radians cannot be it: Prince
    // Edward Is. is 0.356 rad from South Africa and the spec ACCEPTS it.
    const anchor = sq(0, 0, 10);
    const near = sq(11, 0);      // just off the edge of a 10°-wide anchor
    const far = sq(40, 40);
    expect(separation(anchor, near)).toBeLessThan(0.5);
    expect(separation(anchor, far)).toBeGreaterThan(0.5);
  });

  test("an anchor with no extent does not divide by zero", () => {
    expect(separation([[[0, 0], [0, 0], [0, 0]]], sq(10, 10))).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run scripts/build-projections.test.ts
```

Expected: FAIL — `Failed to resolve import "./build-projections.mjs"`.

- [ ] **Step 3: Write the rule**

The reference implementation is in this plan's companion scratch file and reproduces the spec's oracle. Port it verbatim, with these five behaviours, each of which a test above pins:

1. `rotationFor` — largest-gap on sorted longitudes gives the minimal covering arc; return `0` unless that arc crosses ±180; otherwise `-centre`, normalised into ±180.
2. `boxOf` — **normalise `lon + lambda` back into ±180**, or an antimeridian country reads as a 357° span.
3. `scaleOf` — three longitudes × two latitudes as a `MultiPoint`, `geoMercator().rotate([l,0,0]).fitExtent(viewBox, mp).scale()`. Take the viewport from `lib/mapView.ts`, never a literal.
4. `separation` — `hypot(Δlon normalised, Δlat) / anchor bbox diagonal`, `Infinity` when the anchor has no extent.
5. `trimTrajectory` — at each step the candidates are the polygons whose bbox **touches an edge of the current union** (that is what "extent-driving" means, and it is also what makes this tractable: trying every polygon is O(n²) over vertices and CA has 412 of them). **The anchor is never a candidate** — dropping it maximises scale trivially, and ZA-without-South-Africa is Prince Edward Island at a 146× "gain". Return the whole trajectory; the caller picks the best point on it, because NL's three Caribbean polygons each gain ≈1.1× alone and 11.5× together.

- [ ] **Step 4: Run to verify it passes, then `npx tsc --noEmit`**

- [ ] **Step 5: Commit**

```bash
git add scripts/build-projections.mjs scripts/build-projections.test.ts
git commit -m "feat: the country projection rule, with Gate B's missing formula recovered"
```

---

### Task 2: Build and commit the manifest

**Files:** Modify `scripts/build-projections.mjs`; create `public/country-projections.json`, `data/projections-report.md`

**Interfaces:** Consumes Task 1. Produces the committed manifest. Entry shape:
`{ rotate: number, bounds: [[x0,y0],[x1,y1]], scale: number, hiddenAreaPct?: number }` — `bounds` in the **rotated** frame, `hiddenAreaPct` present only on the nine trimmed countries.

- [ ] **Step 1: Add the I/O**

Read every `public/provinces/<CC>.json`, `merge()` its units, apply Task 1, write the manifest and the report. Reuse `build-provinces.mjs`'s `writeFileAtomic` (PID-suffixed temp, `rmSync` before `renameSync`) and its single-`now` discipline. Gate before writing: **246 entries or abort**, and every entry's `scale` finite and positive.

- [ ] **Step 2: Run it and check against the measured expectations**

```bash
node scripts/build-projections.mjs
```

Expected: **246 entries, ~20,842 B raw / ~6,881 B gzip, mean ~84.7 B/entry.** Five countries with `rotate !== 0` — FJ, KI, NZ, RU, US. Nine with `hiddenAreaPct` — FR, FJ, PN, MU, TF, ZA, AI, GQ, CR. If the accepted set differs, **stop**: the rule changed, and the plan's table is the expected answer.

- [ ] **Step 3: `npm test && npx tsc --noEmit`, then commit**

Record the real totals in the commit message.

---

### Task 3: The manifest loader and the renderer

**Files:** Create `lib/countryProjection.ts`, `lib/countryProjection.test.ts`

**Interfaces:**
- Consumes: the manifest.
- Produces: `parseProjectionManifest(raw) -> ReadonlyMap<string, ProjectionEntry>`, `projectionFor(entry, viewBox) -> GeoProjection`, `PROJECTION_PATH`.

- [ ] **Step 1: Write the failing test**

The tests that must exist, and the reason each does:

```ts
test("rebuilds the committed scale from the committed bounds", () => { /* scale is redundant by construction — that is the point. Recompute it from `bounds` and `rotate` and assert it matches, for EVERY entry in the committed manifest. This is the test §5.4 describes. */ });
test("uses three longitudes, so corner order stays unambiguous near a 180° span", () => { /* two longitudes leaves the corner order ambiguous as the span approaches 180 */ });
test("never builds a Polygon rectangle", () => { /* assert the fitted scale is nowhere near height/(2π) ≈ 98.7, which is what the collapse looks like */ });
test("falls back to a whole-world projection for a country with no entry", () => { /* the manifest and the code deploy independently */ });
test("rejects an entry whose bounds are inverted or non-finite", () => { /* a data file reaching fitExtent */ });
```

- [ ] **Steps 2–5:** fail → implement → pass → commit, following `lib/provinceTopology.ts` for conventions.

---

### Task 4: The registry

`hasDetailLevel(country) === "CN"` becomes `COUNTRY_DETAIL`, resolved from `public/provinces/index.json`. Every country now has a detail level; what varies is `count` and `idKey`.

**Files:** Create `lib/countryDetail.ts`, `lib/countryDetail.test.ts`; modify `components/map/CountryMap.tsx:49-51`

**Interfaces:** Produces `hasDetailLevel(country): boolean` (kept, now index-backed), `detailFor(country): { count: number; idKey: "adm1_code" | "adcode" } | null`.

- [ ] **Step 1: Write the failing test**

```ts
test("every country with a province file has a detail level", () => { /* all 246, not just CN */ });
test("a country with no province file has none", () => { /* AQ, BV, HM, XD */ });
test("reports China's id scheme as adcode and everyone else's as adm1_code", () => {});
test("does not resolve a country code that is an Object property name", () => { /* the index is a data file; "constructor" must not resolve */ });
test("34 countries report a single unit", () => { /* §6.6 D10 — the gate for suppressing an L3 affordance in Plan 4 */ });
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

**Note for the implementer:** `hasDetailLevel` keeps its name and signature. `MapExplorer` calls it to decide whether the topology is worth fetching, and that decision is now "always" — which is the point of the PR, and also the thing to watch in Task 5, because it turns one bundled fetch into 246 possible ones.

---

### Task 5: Fetch the right province file

**Files:** Modify `components/map/MapExplorer.tsx` (`:187`, the data effect at `:224`/`:285`, and the four render branches at `:499`, `:512`, `:536`, `:588`)

- [ ] **Step 1: Write the failing test** in `components/map/MapExplorer.test.tsx`

```ts
test("fetches the opened country's province file, not China's", () => {});
test("does not refetch when the country has not changed", () => {});
test("aborts an in-flight fetch when the user opens another country", () => { /* the existing effect already uses AbortController — keep it */ });
test("renders the list alone when the province fetch fails", () => { /* the map is the enhancement; the list is the spine */ });
test("China still fetches the curated asset and renders identically", () => { /* §9.5: China's rendered output must be byte-identical before and after Phase 4 */ });
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 6: The country level

**Files:** Create `components/map/CountryLevel.tsx`, `components/map/CountryLevel.test.tsx`; modify `components/map/CountryMap.tsx:84-99`

Generalises `ChinaLevel`'s shape: one `useMemo` keyed on the topology that splits selectable units from geometry-only ones and builds the path generator, then the projection from the manifest entry rather than a fit over the features.

- [ ] **Step 1: Write the failing test**

```ts
test("draws the country outline from merge() over its units", () => {});
test("draws only sel === 1 units as selectable", () => { /* Northern Cyprus shapes CY's outline and is not clickable; TW/HK/MO likewise inside CN */ });
test("projects through the manifest entry, not a per-render fit", () => { /* a fit over features would ignore the trim and put Clipperton back in frame for FR */ });
test("renders the list beside the map, never instead of it", () => { /* §5.2's invariant */ });
test("falls back to a fit when the country has no manifest entry", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 7: Roving tabindex and real tap targets

**Files:** Modify `components/map/CountryLevel.tsx`; test in `components/map/CountryLevel.test.tsx`

§5.3.1 and §5.3.2. Port `useCountrySelection`'s `tabStop`/`activeCode`/`refocus` pattern from `worldLevelShared.tsx`, and put a transparent hit circle sized to `--tap-min` behind each marker — `WorldMap.tsx` already establishes "hit area first so the visible dot is never the target's edge", including its `nonOverlappingRadii` helper for stopping neighbours swallowing each other.

Today's markers give `tabIndex={0}` to curated places and `-1` to catalog cities (`CountryMap.tsx:418-434`), which is exactly the arrangement `worldLevelShared.tsx` calls "fine for thirty of them and indefensible for 235".

- [ ] **Step 1: Write the failing test**

```ts
test("the marker group is one tab stop, not one per marker", () => {});
test("arrow keys move the active marker without leaving the group", () => {});
test("the visible radius is unchanged", () => { /* §5.3.2 says visual radius stays 4.5–9; only the TARGET grows */ });
test("every marker's hit target is at least --tap-min at the current scale", () => { /* jsdom computes no layout, so assert the r attribute against 44 / k */ });
test("Plan 1's reachability criterion still passes", () => { /* the list must still reach every city */ });
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 8: The selected-place card

**Files:** Create `components/map/SelectedPlaceCard.tsx` and its test; modify `components/map/CountryLevel.tsx`

§5.3.3. `PlacePopup` is `role="tooltip"`, `pointer-events-none`, and positioned from `onMouseEnter`/`onMouseMove` only — it has **no touch story at all**, and the card the roadmap assumed it could add a line to does not exist anywhere in the map layer. This is a net-new surface with focus and dismiss semantics, and it is where PR7's climate line and PR8's airport line will live.

- [ ] **Step 1: Write the failing test**

```ts
test("opens on tap as well as hover", () => { /* the whole reason it exists */ });
test("takes focus when opened from the keyboard, and returns it on dismiss", () => {});
test("dismisses on Escape and on click outside", () => {});
test("is not a tooltip — it has pointer events and an accessible name", () => {});
test("does not replace PlacePopup's hover behaviour", () => { /* hover stays; this is additive */ });
test("has a slot for the climate and airport lines", () => { /* PR7 and PR8 land here; assert the region exists and is empty today rather than inventing content */ });
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 9: The trip map stops being blank

**Files:** Modify `components/map/RouteMap.tsx`

§5.1 flags this as **a guest-reachable surface** that fetches `/china-provinces.json` directly and draws only bundled curated CN destinations, so it is blank today for every worldwide trip. A registry change that skips it leaves that blank.

- [ ] **Step 1: Write the failing test**

```ts
test("draws a Peruvian trip's places on Peru, not on a blank pane", () => {});
test("fetches the trip's own country file rather than China's", () => {});
test("still renders for a guest, with no session", () => { /* it is guest-reachable; a fetch that assumes auth breaks a shared trip link */ });
test("renders the places even when the province fetch fails", () => {});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 10: The committed manifest as data, and China's byte-identity

**Files:** Create/extend `lib/countryProjection.test.ts`; add the China regression

- [ ] **Step 1: Write the tests**

```ts
describe.skipIf(!existsSync(PROJECTION_PATH))("the committed manifest", () => {
  test("names exactly 246 countries", () => { /* toHaveLength(246), never toBeGreaterThan */ });
  test("has an entry for every province file, and no orphans", () => { /* both directions */ });
  test("recomputes every committed scale from its committed bounds", () => {});
  test("only FJ, KI, NZ, RU and US rotate", () => {});
  test("exactly nine countries carry hiddenAreaPct, and none exceeds 1%", () => { /* Gate A */ });
});

test("China's rendered fit is byte-identical to pre-Phase-4", () => {
  // §9.5's success test. Any change to a China pin colour or popup line is a
  // regression, and this is the only thing that would catch it.
});
```

- [ ] **Steps 2–3:** implement any gaps, then commit.

---

## The rest of the series

| Plan | Covers | Unblocked by |
|---|---|---|
| 4 | PR5 — L3 level, province zoom, China's regions as a grouping above admin-1 | this plan |
| 5 | PR6 — climate ingest and the four fit-model fixes | **ready now** — needs only `elev`, which Plan 1 landed |
| 6 | PR7 — climate in the UI | Plans 4 and 5 |
| 7 | PR8 — airport map layer | this plan |
| 8 | PR9 — trip gateways | Plan 7 |

Plans 4 and 7 both become writable the moment this one lands. **Plan 5 is writable today and independent of all of them** — it is also the largest download in the phase (36 whole-object GETs, ~5.2 GB) and adds `geotiff@3.0.5`.

---

## Self-review

**Spec coverage.** §5.1 registry → Tasks 4, 5, 9. §5.3.1 roving tabindex → Task 7. §5.3.2 tap targets → Task 7. §5.3.3 selected-place card → Task 8. §5.4 manifest → Tasks 1, 2, 10. §5.5 renderer trap → Tasks 1, 3. §6.2 degenerate bounds → Task 6's fallback (the guard goes at the call site; `transformForBounds` keeps its no-guard docblock). §9.5 China byte-identity → Task 10. **§6.1's `MapLevel` third member is deliberately Plan 4.**

**Gaps closed while writing.** §5.4's Gate B had no formula; one is recovered and validated against the spec's own published gains. The manifest's viewport was 860×600 against a real 860×620. Every `CountryMap.tsx` anchor in the spec had drifted and is corrected in Global Constraints.

**Placeholder scan.** Tasks 3–10 give test names and the property each must prove rather than full bodies. That is a deliberate and load-bearing difference from Plan 2, where the code was novel: here every task modifies an existing component whose conventions are the specification, and a 200-line transcription of `ChinaLevel` into this document would go stale against the file it copies. Task 1 and Task 2 — the genuinely new logic — carry real code and real expected numbers. **An implementer of Tasks 3–10 must read the named file first; the plan says which one every time.**

**Type consistency.** `ProjectionEntry` is `{ rotate, bounds, scale, hiddenAreaPct? }` in Task 2 and read under those names in Tasks 3 and 10. `detailFor` returns `{ count, idKey }` in Task 4 and is consumed under those names in Tasks 5 and 6. `hasDetailLevel` keeps its existing name and boolean signature throughout.
