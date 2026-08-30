# Phase 4 — Plan 5: worldwide climate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `public/climate/<CC>.json` — monthly normals for all 58,748 catalogued cities — and the derived fit model that turns them into a `MonthFit`, with the four corrections §9.4 requires before any fit colour is allowed to render.

**Architecture:** CHELSA V2.1 rasters are read once at build time, one whole object at a time, and sampled at every city's coordinate. Nothing renders in this PR — that is PR7. **This plan opens with a reconnaissance build**, because too much of §9 is unverified to commit a 6.4 GB pipeline to it sight-unseen.

**Tech Stack:** Node 24, `geotiff@3.0.5` (MIT, 9 packages / 8.0 MB, no native deps) as a new devDependency, TypeScript 7, Vitest 4.

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) §9.1–§9.5 and the climate rows of §12.3. **§9.6 (the northern-hemisphere season stamp) and §9.7 (the honesty note) are NOT in this plan** — the spec assigns both to PR7, because that is the PR with a signal to replace the stamp with.

---

## Read this before touching anything

Four things in §9 do not survive contact with the code. Three are the plan's opening tasks; one is a straight correction.

### 1. The artifact §9.3 specifies cannot feed the model §9.4 specifies

```
§9.4 penalty = heat(hi) + cold(hi, lo) + mugginess(td ← RH) + rain(precip) + cloud(clt)
§9.3 ships   = 12 lo, 12 hi, 12 precip            — 36 ints, no cloud, no humidity
§13 excludes = "humidity in the shipped artifact"
§9.3 also    = "fit is derived at READ time, never stored"
```

**Those four statements cannot all hold.** A reader with 36 ints has no `clt` and no `RH`, so it can compute neither the cloud term — the one §9.4 fix 1 says Lima needs, without which it is `great` in all twelve months including the *garúa* — nor the mugginess term that fix 2 exists to correct.

Scaling §9.3's own measured largest shard (VN, 97,941 B against a 150,000 B cap):

| layout | largest shard | of cap |
|---|---|---|
| 36 ints (lo, hi, precip) | 97,941 B | 65% |
| **48 ints (+ cloud)** | **~130,588 B** | **87%** |
| 60 ints (+ cloud + dew point) | ~163,235 B | **109% — over** |

So there is room for exactly one more block. **Task 1 measures this for real rather than trusting the scaling**, and Task 1 is what picks the layout. The decision is deferred to evidence on purpose: 97,941 is itself a `DERIVED` figure in the spec and nothing has ever built this artifact.

### 2. §9.4 and §9.5 contradict each other on where the derived branch goes

§9.5: *"The derived branch lands in `regionFit`; do not add it to `fitForPlace` or curated China loses precedence."*

But `regionFit(region: string, month: number)` (`mapTypes.ts:54-57`) receives **neither a country code nor a city id**, and the artifact is per-city, sharded per country. `fitForPlace` is the only one of the two that holds a `MapPlace` — which is to say, the only one that knows *which city*. The instruction and the data shape are incompatible, and Task 5 resolves it.

### 3. Plan 4 built a merge gate against exactly this change

`components/map/mapTypes.test.tsx:71` asserts `fitForRegion(group.id, 6) === NEUTRAL_FIT` for every Peruvian L3 group id. Its own docblock says it exists because "`RegionId` is `string`, so nothing in the type system keeps a Peruvian unit id away from the China tables — this does."

**It goes red on the first derived verdict, and that is correct behaviour, not an obstacle.** It must be *rewritten*, never deleted, and the hostile-key half at `:47-57` (`fitForRegion("constructor", 6) === NEUTRAL_FIT`) must survive intact.

### 4. The download is 6.4 GB across 48 GETs, not 5.2 GB across 36

§9.2's transfer table predates §9.4's `clt` requirement. Measured by `HEAD` against the live endpoints:

| variable | per month | × 12 |
|---|---|---|
| `tasmin` | 115,680,174 B | 1.39 GB |
| `tasmax` | 127,491,220 B | 1.53 GB |
| `pr` | 229,542,124 B | 2.75 GB |
| `clt` | 60,474,540 B | 0.73 GB |
| | | **≈ 6.4 GB / 48 objects** |

**The spec names no URL** — `grep https:// ` over it returns zero hits, the third time this phase. The pattern, verified 200 OK on all four variables:

```
https://os.zhdk.cloud.switch.ch/chelsav2/GLOBAL/climatologies/1981-2010/<var>/CHELSA_<var>_<MM>_1981-2010_V.2.1.tif
```

### Six more facts the research established

- **`elev` is never null in the committed data** — 58,748 of 58,748 are non-null integers — **but 300 rows carry `-9999`**, GeoNames' `dem` nodata sentinel. It is finite, it is an integer, and it passes `Number.isFinite`. Fed to fix 4's lapse-rate correction it applies a *false 30 °C warming*. §11's "null only when both are blank" describes an intent the data does not satisfy: **do not write `if (elev === null) skip`** — write a sentinel guard.
- **Every one of §9.5's China calibration anchors is a `Q`-prefixed catalog city and is absent from the `G`-prefixed shards.** The CN shard's 409 rows contain none of them. The calibration set is not in the artifact's key space, and Task 4 has to bridge that before it can reproduce the 35/48 holdout figure at all.
- **`climateFor` (`countryBaseProfile.ts:171`) has no production consumer.** Only tests call it. Wiring the derived source into it alone changes nothing on screen — `PlacePopup.tsx:40` reads `lib/months.ts` directly.
- **`getCountryBaseProfile` cannot read the artifact synchronously.** Its docblock calls the split "a bundle constraint, not a taste", and `lib/countryFacts.test.ts` enforces it with a transitive import walk: a client component that reaches a data artifact by any path fails the build. `climateFor` must stay synchronous over rows already in hand.
- **`lib/contracts.test.ts`'s C7 is structurally incapable of seeing `data/` or `public/`** — its universe is `["components","app","lib","scripts"]` plus repo-root files. The licence risk §9.1 warns about is therefore smaller than feared, but the four things it must not be added to are named in Task 8.
- **No `data/*.md` uses a `## Source` heading today**, so §9.1's request for one that is deliberately distinct from `cities-report.md`'s `## Attribution` is free.

### Corrected anchors

| Spec says | Actually |
|---|---|
| `PlacePopup.tsx:106` (the unformatted interpolation) | **`:92`**, `{climate.lo}°–{climate.hi}°C typical` |
| `countryProfile.test.ts:43-49` (hasOwnProperty) | **`:42-45` and `:47-50`** |
| `countryBaseProfile.ts:192` (fresh objects) | **`:191`** |
| `catalog.ts:204-206` (`regionFor`) | **`:262-265`** |
| `countryProfile.test.ts:38` and `:100` | **exact** |
| `months.test.ts:86-88` | **exact** |

Incidental: **16 comments across the repo say the shard count is 58,742; it is 58,748.** Worth a sweep, not in this plan.

---

## Global Constraints

- **The penalty model does not exist and must be written from scratch.** There is no arithmetic fit anywhere in the repo — the four existing fit functions are all lookups over 84 hand-authored rows.
- **China stays authoritative (§9.5).** `REGION_MONTHS` is not re-keyed and not re-derived. Resolution order: curated `bestSeasons` → curated `REGION_MONTHS` → derived worldwide → `unknown`. `components/map/chinaBaseline.test.tsx` byte-pins China's render; run it, never re-record it.
- **Rows are calendar-indexed. Index 0 is January. Everywhere.** `seasonIn` is never applied to this index — a data-derived table is hemisphere-correct by construction, and passing the month through `seasonIn` would read Sydney's January at index 6, a double inversion. Verified by peak-warmth phase: NO Jul, JP Jul, CN Jul vs **PE Jan, KE Feb**.
- **CC0 imposes no attribution condition.** No `ChelsaCredit.tsx`, no new C7 token, no new C7 `ALLOWED` entry. A courtesy credit goes in `data/climate-report.md` under `## Source` — deliberately not `## Attribution`.
- **`refresh-climate.yml` is `workflow_dispatch` only, no schedule.** These are decadal WMO normals. A nightly job would pull 6.4 GB/night from an academic host to produce a byte-identical tree. **Do not add a third consumer to `refresh-cities.yml`** — back-to-back upstream workloads on one runner caused two real outages, which is why cities and facts were split on 2026-08-28.
- **The climate job needs `npm ci`.** The cities and facts jobs deliberately have none because "both ingest scripts run on Node built-ins alone"; `geotiff` is a real import and cannot copy that.
- **Resolve script paths from `import.meta.url`, not `process.cwd()`** — `build-projections.mjs:455` is the newer, correct form.
- **`.test.ts` under `components/` runs in NO vitest project.** `--reporter=basic` does not exist in Vitest 4.
- **Commit messages:** conventional commits ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `scripts/probe-chelsa.mjs` | **new, throwaway** — the reconnaissance build | Create, then delete in Task 6 |
| `data/climate-probe.md` | its committed findings | Create |
| `scripts/ingest-climate.mjs` | **new** — the real build | Create |
| `scripts/ingest-climate.test.ts` | its pure functions | Create |
| `lib/climateModel.ts` | **new** — the penalty model and the four fixes | Create |
| `lib/climateModel.test.ts` | the four contract requirements | Create |
| `lib/climateShard.ts` | **new** — parse/validate a committed shard | Create |
| `lib/climateShard.test.ts` | the 246 committed files as data | Create |
| `public/climate/*.json` | the artifact | Generated |
| `data/climate-report.md` | the committed record, with `## Source` | Generated |
| `components/map/mapTypes.ts` | the derived branch | Modify |
| `components/map/mapTypes.test.tsx` | **rewrite** `:59-73`, keep `:47-57` | Modify |
| `.github/workflows/refresh-climate.yml` | **new**, dispatch-only | Create |

---

### Task 1: The reconnaissance build

**Nothing about this artifact has ever been measured.** Before committing to a 6.4 GB pipeline, download **one month of each of the four variables (~533 MB)**, sample every committed city, and settle the open questions. This task produces a committed measurement document and no artifact.

**Files:** Create `scripts/probe-chelsa.mjs`, `data/climate-probe.md`

- [ ] **Step 1: Add the dependency**

```bash
npm install --save-dev geotiff@3.0.5
```

- [ ] **Step 2: Write the probe**

Fetch January `tasmin`, `tasmax`, `pr`, `clt`. For all 58,748 cities across the 246 committed shards, sample each raster at the city's lon/lat and record:

- **the nodata rate per variable** — §9.1 says nodata is `65535`; report how many cities land on it and which countries they cluster in
- **the TIFF flavour actually served** — §9.1 claims `tas*`/`pr` are classic (magic 42) and `hurs` is BigTIFF (43). Report the magic number of each of the four, because `clt` is not in that claim at all
- **the scale factors that reproduce sane values** — §9.1 says 0.1 for `tas*`/`pr`. Verify by checking that a few known cities come out plausible, and **report the actual numbers rather than asserting the spec's**
- **the grid geometry** — §9.1 says 43200 × 20880 over −180..+180 / **−90..+84** (not +90). Confirm, and report how many cities fall outside that latitude band
- **the serialised size of one shard under both candidate layouts** — 36 ints and 48 ints — for the largest country and the median one. **This is what picks the layout.**
- **the `-9999` elevation sentinel** — confirm the 300 rows and name their countries

- [ ] **Step 3: Commit `data/climate-probe.md`**

Write the findings as prose with the numbers inline, following `data/provinces-report.md`'s shape. **This document is the input to every task below**, and any task that contradicts it is wrong.

```bash
git add package.json package-lock.json scripts/probe-chelsa.mjs data/climate-probe.md
git commit -m "chore: probe CHELSA before committing to a 6.4 GB pipeline"
```

---

### Task 2: The sampler, as pure functions

**Files:** Create `scripts/ingest-climate.mjs`, `scripts/ingest-climate.test.ts`

**Interfaces:** Exported — `pixelFor(lon, lat, grid) -> {x, y} | null`, `decodeSample(raw, variable) -> number | null`, `tupleFor(samples) -> number[]`. I/O stays module-private behind the argv guard, as `build-provinces.mjs` establishes.

- [ ] **Step 1: Write the failing test**

```ts
test("maps a coordinate to a pixel on CHELSA's grid", () => {
  // 43200 x 20880 over -180..+180 / -90..+84. The latitude band is NOT
  // symmetric — the top is +84 — so the naive (90 - lat) / 180 mapping is
  // wrong by 3.3% of the height everywhere.
});
test("returns null for a city outside the covered latitude band", () => {});
test("decodes the nodata sentinel as null, not as a temperature", () => {
  // 65535 scaled by 0.1 is 6553.5 degrees, which Number.isFinite accepts.
});
test("applies the scale factor the probe measured, not an assumed one", () => {});
test("rounds to integers, because the artifact is a positional int tuple", () => {});
test("orders the tuple lo, hi, precip[, cloud] with January at index 0", () => {
  // Calendar-indexed everywhere. seasonIn is never applied to this index.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

---

### Task 3: The penalty model and the four fixes

**Files:** Create `lib/climateModel.ts`, `lib/climateModel.test.ts`

This is entirely net-new. `penalty = heat(hi) + cold(hi, lo) + mugginess(td) + rain(precip) + cloud(clt)`, banded to `great | ok | poor | avoid`.

- [ ] **Step 1: Write the failing test — the four fixes, each by the symptom that proves it**

```ts
test("fix 1 — Lima is not great in all twelve months", () => {
  // Without the cloud term it is: Lima's precipitation is ~3 mm/month
  // year-round, so nothing else distinguishes the Jun-Sep garúa.
});
test("fix 2 — Tokyo July is not great", () => {
  // hurs runs systematically low in humid climates (Iquitos 72% vs ~85%
  // observed), which made Tokyo July penalty 0.41 and 338 of 750 Japanese
  // cities great in July. The mugginess TERM works — it fires correctly for
  // Sanya and Shanghai at Td 21 — the INPUT is wrong.
});
test("fix 3 — Kenya shows two rain maxima, not 78.1% great", () => {
  // The 140 mm/month knee was calibrated on China. Nairobi: Apr 191,
  // Jun-Sep 18-26, Nov 118. One global threshold cannot serve Dunhuang at
  // 1 mm and Iquitos at 330.
});
test("fix 4 — Cusco's Jun-Aug is reachable as great", () => {
  // The bias runs -1.94 C overall and -3.62 C above 2,000 m, which is exactly
  // why Cusco was never great during its actual peak season.
});
test("fix 4 does not apply a 30 C correction to a -9999 elevation", () => {
  // 300 committed rows carry GeoNames' dem nodata sentinel. It is finite, it
  // is an integer, and it passes Number.isFinite. THE trap.
});
test("Norway January is never great", () => {});
test("Lima's winter is not great", () => {});
```

- [ ] **Step 2: Calibrate, and preserve the protocol**

§9.4 is explicit and it is a scientific constraint, not a style note: the knobs were fitted on **only the three China regions whose anchors are not in the validation set — East, Northwest, Central — and the four validation regions were never inspected during tuning.** Untuned first-guess parameters scored 25/48 on holdout; tuned, 35/48.

> **A re-tune that looks at the holdout before reporting a number produces a meaningless number.**

Record in `lib/climateModel.ts`'s docblock which regions were used to tune and what the holdout score was. **If you cannot reproduce a holdout figure, say so and report the number you got** — do not tune until it matches.

**Blocker to surface, not to work around:** every one of §9.5's China calibration anchors is a `Q`-prefixed catalog city, absent from the `G`-prefixed shards this artifact is keyed on. The calibration set is not in the artifact's key space. Bridging that — sampling the anchors' coordinates directly rather than through the shard — is part of this task, and if it cannot be done, **stop and report** rather than calibrating against a different set of cities than the spec did.

- [ ] **Steps 3–5:** implement → pass → commit.

---

### Task 4: The four contract requirements

Two are pinned today; two are not, and §9.4 says the missing two must be **written fresh, not ported**.

**Files:** `lib/climateModel.test.ts`

- [ ] **Step 1: Write the two that are missing**

```ts
test("returns fresh objects per call", () => {
  // Implemented at countryBaseProfile.ts:191, but the existing mutation test
  // at countryProfile.test.ts:52-63 covers only crowdByMonth and tips.
  // Mutate a returned row and assert the next call is unaffected.
});
test("every temperature is an integer", () => {
  // PlacePopup.tsx:92 interpolates {climate.lo}°-{climate.hi}°C typical with
  // no formatting, so a float renders "8.437°". NOTHING asserts this anywhere.
  // Note the curated China data is already all-integer, so this test is green
  // on day one and only becomes load-bearing against the derived rows — say
  // so in the test, or a later reader will think it is redundant.
});
```

- [ ] **Step 2: Verify the two that are pinned still pin what they claim** — `countryProfile.test.ts:42-45` / `:47-50` (total, `hasOwnProperty`) and `:38` / `:100` (12 rows or null). Note the 12-row half is pinned through `climateFor` for **East only**, never for all seven; widen it if cheap.

- [ ] **Step 3: Commit**

---

### Task 5: Where the derived branch goes

§9.4 says `regionFit`; §9.5 forbids `fitForPlace`; `regionFit` has neither a country code nor a city id. Resolve it, and rewrite the gate Plan 4 built.

**Files:** Modify `components/map/mapTypes.ts`, `components/map/mapTypes.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("curated China still wins over any derived row", () => {
  // The whole point of §9.5. Resolution order: curated bestSeasons -> curated
  // REGION_MONTHS -> derived worldwide -> unknown.
});
test("a hostile region id still resolves to unknown", () => {
  // KEEP mapTypes.test.tsx:47-57 intact. "constructor" must not reach a table.
});
test("a Peruvian L3 group id no longer forces NEUTRAL_FIT when a derived row exists", () => {
  // This REPLACES mapTypes.test.tsx:59-73, which Plan 4 wrote as a merge gate
  // against exactly this change. Rewrite it, never delete it: the property it
  // protects — that an L3 id cannot index China's tables — still holds and
  // still needs a test.
});
test("China's rendered output is byte-identical", () => {
  // Run components/map/chinaBaseline.test.tsx. Do not re-record it.
});
```

- [ ] **Steps 2–5:** fail → implement → pass → commit.

**Implementer note:** `climateFor` is a ready-made, test-pinned seam — but it must stay **synchronous over rows already in hand**, because `lib/countryFacts.test.ts`'s transitive import walk fails the build if a client component reaches a data artifact by any path. The rows arrive by `fetch`, from the component, and are passed in.

---

### Task 6: The full build

**Files:** Modify `scripts/ingest-climate.mjs`; create `public/climate/*.json`, `data/climate-report.md`; delete `scripts/probe-chelsa.mjs`

- [ ] **Step 1: Add the I/O**, following `build-provinces.mjs`: `writeFileAtomic` (PID-suffixed temp, `rmSync` before `renameSync`), all gates before any write, per-file payload comparison excluding the envelope, a single `now`.

  **One correction to that template:** it writes `index.json` with an unconditional `generatedAt: now`, which is safe only because it is hand-run. This artifact gets a workflow, so the index must carry the previous timestamp when the payload is unchanged, or every dispatch commits a diff of noise.

- [ ] **Step 2: Run it.** ~6.4 GB, 48 objects, one variable at a time — never hold two rasters in memory. Report wall-clock and peak RSS.

- [ ] **Step 3: Verify against §9.3 and against the probe.** Expected: 246 shards, **0 over the cap**, largest VN. The probe's Task 1 numbers are the prediction; report the real ones. **The budget test's comment must say the cap is not saturated**, unlike the city shard's, so a future reader does not assume it is binding.

- [ ] **Step 4: `npm test && npx tsc --noEmit`, then commit** with the real totals.

---

### Task 7: The refresh workflow

**Files:** Create `.github/workflows/refresh-climate.yml`

- [ ] `workflow_dispatch` only, **no `schedule`**.
- [ ] **Needs `npm ci`** — unlike the cities and facts jobs, which run on Node built-ins alone.
- [ ] Its own runner. **Do not add a job to `refresh-cities.yml`.**
- [ ] Keep the "verify the artifacts against the repo's own tests" step: GitHub does not create workflow runs from pushes authenticated with the default `GITHUB_TOKEN`, so `ci.yml` never runs on a refresh workflow's commit while Vercel deploys it regardless.
- [ ] Commit.

---

### Task 8: The committed artifact as data, and the licence non-additions

**Files:** Create `lib/climateShard.ts`, `lib/climateShard.test.ts`; verify `.gitattributes`

- [ ] **Step 1: The loader**, following `lib/provinceTopology.ts`.

- [ ] **Step 2: The committed-artifact tests**, guarded by `describe.skipIf(!existsSync(...))`:

```ts
test("names exactly 246 countries", () => { /* toHaveLength(246), never toBeGreaterThan */ });
test("its city-id set equals public/cities/, in BOTH directions", () => { /* §12.3 says both */ });
test("no shard exceeds the gzip budget, and the cap is NOT saturated", () => {});
test("every shard has twelve values per block, with no missing months", () => {});
```

- [ ] **Step 3: Verify the licence non-additions.** The climate artifact must **not** be added to: `CITY_NAME_TOKENS` (`contracts.test.ts:664-670`); C7's `ALLOWED` (`:790-841`); the six-file `test.each` floor (`:1174-1181`); or the bullet list inside `data/cities-report.md`'s `## Attribution`. C7 cannot see `data/` or `public/` at all, so no test needs to change — **assert that nothing did**.

- [ ] **Step 4:** `.gitattributes` already pins `public/climate/*.json text eol=lf` — Plan 2 added it ahead of time. Confirm, do not duplicate.

- [ ] **Step 5: Commit.**

---

## The rest of the series

| Plan | Covers | Unblocked by |
|---|---|---|
| 6 | PR7 — climate in the UI, **plus §9.6's season stamp and §9.7's honesty note** | Plan 4 and this plan |
| 7 | PR8 — airport map layer | Plan 3 (**ready now**) |
| 8 | PR9 — trip gateways | Plan 7 |

**Plan 7 is writable today** and touches none of this.

---

## Self-review

**Spec coverage.** §9.1 source and licence → Tasks 1, 8. §9.2 acquisition → Tasks 1, 2, 6, 7. §9.3 artifact → Tasks 1, 6, 8, **with the layout deferred to measurement because the spec's own tuple cannot feed its own model**. §9.4 the model and the four fixes → Tasks 3, 4. §9.5 China authoritative → Task 5. §12.3's climate rows → Tasks 4, 8. §9.6 and §9.7 are PR7's, per the spec.

**The three unresolved things, stated rather than buried.** (a) The tuple layout is Task 1's to decide, because 48 ints fit at 87% of cap and 60 do not, and nobody has measured either. (b) The `regionFit`-vs-`fitForPlace` contradiction is Task 5's, and the spec cannot settle it because §9.4 and §9.5 disagree. (c) §9.5's calibration anchors are not in the artifact's key space at all, and Task 3 must bridge that or stop.

**Placeholder scan.** Tasks 2–8 give test names and the property each must prove. Task 1 is prose because it is a measurement, not an implementation — it names every quantity to report and commits the result. **Task 3 is the one carrying real risk without real code**: the penalty model is net-new, its calibration protocol is a scientific constraint, and no amount of plan text substitutes for the tuning run.

**Type consistency.** `pixelFor`, `decodeSample`, `tupleFor` (Task 2) are consumed under those names in Task 6. The artifact envelope and `climateShard`'s parse (Task 8) read what Task 6 writes. `MonthFit` and `RegionMonthClimate` are **not** changed — §9.4 is explicit that there is no new band, no `FIT_COLORS` change and no contrast re-audit, and `unknown` already exists as the absence marker with an audited colour.
