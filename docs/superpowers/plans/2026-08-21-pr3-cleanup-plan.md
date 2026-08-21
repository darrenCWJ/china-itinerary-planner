# Planner Redesign — PR3 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-21
**Spec:** `docs/superpowers/specs/2026-08-17-planner-redesign-design.md` §10 step 12 (authoritative)
**Supersedes:** the `## PR3 — Cleanup` section of `docs/superpowers/plans/2026-08-17-pr2-redesign-plan.md` (lines 312–341). Task numbers 34–38 are kept deliberately — `components/shell/ThemeToggle.tsx:67` names "PR3 Task 37" in a source comment, and renumbering would falsify it.
**Branch:** cut from `main` at `dc25033` — `redesign/pr3-cleanup`
**Stack:** Next.js 16 App Router · React 19 · TS strict · Tailwind v4 · vitest (node + jsdom projects)

**Goal:** Delete the four compatibility shims PR1 and PR2 left behind — `chineseName`, the `Region` union, the superseded `@theme` palette, and the pinned-light theme — so the redesign's token set and all-countries types are the only ones in the tree.

**Architecture:** Deletions only, in dependency order. Each task removes one shim and leaves the tree green, so any task can be the last one merged. Three of the five are mechanical renames guarded by existing tests; Task 37 is the only one that changes runtime behaviour, and it is gated behind a visual pass because a dark-theme regression fails silently rather than at build.

**Tech Stack:** TypeScript strict, Tailwind v4 `@theme`, CSS custom properties, vitest, Better Auth (untouched here).

---

## Global Constraints

- **Verification loop after every task** — the tree must be green after each:
  ```
  npm test
  npx tsc --noEmit
  npm run build
  ```
- **Baseline at branch cut:** 833 tests across 59 files, tsc clean, build clean. Any task ending below 833 must say which test it deleted and why.
- **`npm install` on this machine MUST use `--ignore-scripts`** — no MSVC toolchain is present and `better-sqlite3` would try `node-gyp rebuild`.
- **Move `.env.local` aside before a full test run.** `lib/authBoot.test.ts` needs `BETTER_AUTH_SECRET` absent from the ambient environment and captures whatever is there into its restore snapshot.
- **Write tests that can fail.** Run every new test against the unfixed code first and confirm it goes red. This project has repeatedly shipped tests that passed for the wrong reason.
- **Do not invent a second definition of anything.** Where a value already exists (a token, a country record, an accent ramp), point at it rather than restating it.
- **No `drop`-shaped changes to data.** Nothing in PR3 touches a database or a persisted payload.

---

## What changed since the PR2 plan's PR3 sketch

The sketch was written on 2026-08-17, before PR2's Task 33 sweep landed. Four of its statements are now false, and each one would send an implementer the wrong way:

| Sketch said | Actually true at `dc25033` |
|---|---|
| "Delete `app/globals.css` lines 3–12" | The `@theme` block is at **lines 71–80**. Lines 3–12 are a docblock. |
| "Precondition: the Task 33 grep returns zero old-utility uses" | It returns zero for `ink`, `ink-soft`, `rail`, `rail-deep`, `sky`, `mist`, `paper` — but **61 `-seal` utilities across 30 files survive by design**, pinned by `lib/tokens.test.ts:93`. Task 36 must give the vermilion a token before it can delete anything. |
| "`.stamp`/`.seal-round` already re-pointed (Task 33)" | Both still read `var(--color-seal)`, which is defined **only** inside the block being deleted. |
| "Task 37: flip the PR1 provider's gate ... this task only un-hides the option" | Un-hiding is one of **five** coupled changes. The first-paint script in `app/layout.tsx:44-47` hardcodes `var t="light"`, and `WorldMap` + `CountryHero` each take a `theme` prop that defaults to light precisely because the pin exists. |

Two items from the review backlog are folded in that the sketch never mentioned: the dead `WorldMap.onHoverCountry` prop and contract **C6**, which is asserted nowhere.

---

## File structure

Nothing is created except one test block. The work is deletion, so the map below is what each touched file is left responsible for.

| File | After PR3 it is responsible for |
|---|---|
| `lib/types.ts` | `Destination` with `localName: string \| null` and `region: string`; `ChinaRegion` as the only region union, no `Region` alias |
| `lib/tripShared.ts` | `MapCity`/`CatalogHit` carrying `localName`, not `chineseName` |
| `lib/server/catalog.ts` | The single read boundary that normalises the on-disk artifact's legacy `chineseName` into `localName` |
| `app/globals.css` | One palette: the semantic token ramp plus `--seal`. No `@theme` colour block; `@theme inline` (fonts) stays |
| `components/shell/PrefsProvider.tsx` | Resolving `light`/`dark`/`system` into a real `data-theme`, and publishing the resolved theme on context |
| `app/layout.tsx` | A first-paint script that applies the stored theme instead of forcing light |
| `lib/contracts.test.ts` | C1, C2, C3, C4 **and C6** |
| `lib/tokens.test.ts` | A grep gate over a fully-retired palette, seal included |

`components/CatalogSearch.tsx` is **deleted** — it is imported by zero files (verified: the only surviving mentions are two prose comments and its line in the `tokens.test.ts` pinned list).

---

## Task 34 — Delete `Destination.chineseName`

**Files:**
- Modify: `lib/types.ts:58`, `lib/tripShared.ts:177,191`, `lib/server/catalog.ts:12,26,149,168,222,264`, `lib/briefing.ts:90-94`, `components/DestinationStep.tsx:167,256,384`, `components/map/MapExplorer.tsx:132,155,200`, `components/plan/PlaceSearch.tsx:114-116`, `components/trip/RouteMap.tsx:67`, `app/plan/page.tsx:113-116`, `lib/data/{east,north,south,west}.ts`, `scripts/ingest-destinations.mjs`
- Delete: `components/CatalogSearch.tsx`
- Test: `lib/server/catalog.test.ts`, `lib/server/catalogSearch.test.ts`, `components/plan/PlaceSearch.test.tsx:197`, `lib/briefing.test.ts`

**Interfaces:**
- Consumes: `Destination.localName`, `MapPlace.localName` (both shipped by PR1/PR2).
- Produces: `CatalogCity.localName: string | null`, `CatalogHit.localName: string | null`, `MapCity.localName: string | null`, `Destination.localName: string | null` (now **required**, not optional). Tasks 35–38 rely on `chineseName` being absent from every type.

**The one decision this task makes:** `data/catalog.json` on disk stores `chineseName` per city and is regenerated only by a network ingest. Renaming the field in the *type* while leaving the artifact alone is correct — so `loadCatalog()` normalises at the read boundary, accepting either spelling. The ingest script emits `localName` from now on, and both old and new artifacts parse. This is the same read-boundary pattern PR1 used for the `country` default.

- [ ] **Step 1: Write the failing test for the read boundary**

Add to **`lib/server/catalogSearch.test.ts`** — it already owns the
`CIP_CATALOG_PATH` fixture harness, a `city()` builder and an `afterAll`
cleanup. `catalog.test.ts` has none of that and would need a second harness.

Follow that file's existing style: build the fixture with its `city()` helper
and point `CIP_CATALOG_PATH` at it the way its other cases do. The legacy row
is the one thing its helper cannot express, because the helper is typed against
the *new* shape — so cast that single row:

```ts
test("reads a legacy catalog artifact that still spells the field chineseName", () => {
  const legacy = {
    generatedAt: "2026-01-01",
    source: "test",
    cities: [
      {
        qid: "Q1",
        name: "Nanjing",
        chineseName: "南京",
        province: "Jiangsu",
        lat: 32.06,
        lon: 118.8,
        population: 8000000,
        description: null,
        interests: [],
        image: null,
        level: "prefecture",
      },
    ],
    attractions: [],
  };
  const file = path.join(os.tmpdir(), `cip-legacy-catalog-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(legacy));
  process.env.CIP_CATALOG_PATH = file;

  const hits = searchCities("Nanjing", 5);

  expect(hits[0].localName).toBe("南京");
  expect(hits[0]).not.toHaveProperty("chineseName");
});
```

The exported function is **`searchCities(query, limit)`** — there is no
`searchCatalog`. `loadCatalog()` caches on the file's `mtimeMs`, so a fixture
written inside the same millisecond as a previous one can be served stale;
write to a uniquely-named file per test, as above.

```
```

Match the file's existing import list and cache-reset helper — `lib/server/catalog.test.ts` already sets `CIP_CATALOG_PATH` for other cases; reuse whatever teardown it uses rather than adding a second one.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/server/catalog.test.ts -t "legacy catalog artifact"
```

Expected: FAIL — `hits[0].localName` is `undefined` because nothing maps the field yet.

- [ ] **Step 3: Add the normaliser at the read boundary**

In `lib/server/catalog.ts`, rename the field on both artifact interfaces:

```ts
export interface CatalogCity {
  qid: string;
  name: string;
  /**
   * Local-language name. The on-disk artifact predates the rename and may
   * still spell this `chineseName`; `normaliseCatalog` accepts either, so an
   * artifact generated before PR3 keeps working without a re-ingest.
   */
  localName: string | null;
  province: string | null;
  lat: number;
  lon: number;
  population: number | null;
  description: string | null;
  interests: Interest[];
  image: string | null;
  level: "municipality" | "prefecture" | "county";
}
```

Apply the identical `localName` rename to `CatalogAttraction`. Then add the normaliser above `loadCatalog`:

```ts
type LegacyNamed = { localName?: string | null; chineseName?: string | null };

/** The artifact's field was renamed in PR3; read both spellings, emit one. */
function withLocalName<T extends LegacyNamed>(row: T): T {
  const { chineseName, ...rest } = row;
  return { ...rest, localName: row.localName ?? chineseName ?? null } as T;
}

function normaliseCatalog(raw: Catalog): Catalog {
  return {
    ...raw,
    cities: raw.cities.map(withLocalName),
    attractions: raw.attractions.map(withLocalName),
  };
}
```

Call it in exactly one place: **inside `setCache()`**, on the `catalog`
argument before it is stored. Both of `loadCatalog()`'s paths — the
`CIP_CATALOG_PATH` file read and the `BUNDLED_CATALOG` fallback — funnel
through `setCache`, so normalising there covers both and cannot drift. Wrapping
the two call sites separately is the failure mode this instruction exists to
prevent.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run lib/server/catalog.test.ts
```

Expected: PASS, including the pre-existing cases.

- [ ] **Step 5: Rename the three remaining field sites in `lib/server/catalog.ts`**

- Line ~149 (search scoring): `const zh = c.chineseName ?? "";` becomes `const zh = c.localName ?? "";`
- Line ~168 and ~222 (`CatalogHit` construction): `chineseName: c.chineseName,` becomes `localName: c.localName,`
- Line ~264 (`Destination` construction): `chineseName: city.chineseName ?? "",` becomes `localName: city.localName,` — note the `?? ""` goes with it. An absent local name is now `null`, which is what `Destination.localName` means; the empty string was a workaround for a non-nullable field.

- [ ] **Step 6: Rename the wire types**

In `lib/tripShared.ts`, on both `MapCity` (line ~177) and `CatalogHit` (line ~191), replace `chineseName: string | null;` with:

```ts
  /** Name in the local language; `null` when the catalog has none. */
  localName: string | null;
```

- [ ] **Step 7: Delete the field from `lib/types.ts`**

Remove `chineseName: string;` from `Destination` and promote `localName` from optional to required:

```ts
export interface Destination {
  id: string;
  name: string;
  /** Name in the local language. `null` for a hand-typed place with none. */
  localName: string | null;
  region: Region;
```

Leave `region` alone — Task 35 owns it.

- [ ] **Step 8: Run tsc and let it drive the consumer edits**

```bash
npx tsc --noEmit
```

Every error is a site to fix. The complete expected set, with the edit for each:

| Site | Edit |
|---|---|
| `lib/data/{east,north,south,west}.ts` | Delete the `chineseName:` line from every record. Each already carries an identical `localName`, so no value is lost — spot-check one record to confirm before bulk-deleting. |
| `lib/briefing.ts:94` | `return destination?.localName ?? destination?.chineseName ?? null;` becomes `return destination?.localName ?? null;`. Delete the now-false comment on line 90 about falling back. |
| `components/DestinationStep.tsx:167` | `chineseName: null,` becomes `localName: null,` |
| `components/DestinationStep.tsx:256,384` | `d.localName ?? d.chineseName` becomes `d.localName` (twice) |
| `components/map/MapExplorer.tsx:132` | `localName: d.localName ?? d.chineseName,` becomes `localName: d.localName,` |
| `components/map/MapExplorer.tsx:153-155` | `localName: c.chineseName,` becomes `localName: c.localName,`; delete the two-line comment above it, which describes a server contract that no longer exists |
| `components/map/MapExplorer.tsx:200` | `chineseName: city.chineseName,` becomes `localName: city.localName,` |
| `components/plan/PlaceSearch.tsx:114-116` | `localName: h.chineseName,` becomes `localName: h.localName,`; delete the comment above it for the same reason |
| `components/trip/RouteMap.tsx:67` | `destination.localName ?? destination.chineseName` becomes `destination.localName` |
| `app/plan/page.tsx:113-116` | Delete the `chineseName: "",` line and its two-line comment. `localName: null` on the next line already says the right thing. |

- [ ] **Step 9: Delete the dead `CatalogSearch` component**

```bash
grep -rn "CatalogSearch" --include=*.tsx --include=*.ts app components lib
```

Expected: only `components/CatalogSearch.tsx` itself, two prose comments in `components/plan/PlaceSearch*.tsx`, and the pinned line in `lib/tokens.test.ts:99`. If anything **imports** it, stop — fix the import instead and leave the file.

```bash
git rm components/CatalogSearch.tsx
```

Then remove `"components/CatalogSearch.tsx"` from the pinned list in `lib/tokens.test.ts:99`, or that test fails on a file that no longer exists.

- [ ] **Step 10: Update the ingest script to emit the new spelling**

In `scripts/ingest-destinations.mjs`, change the four `chineseName` sites to `localName`. The read boundary from Step 3 accepts both, so a stale `data/catalog.json` keeps working and the next ingest writes the new field. Do **not** re-run the ingest — it is a network job against Wikidata and is not part of this task.

- [ ] **Step 11: Fix the test fixtures**

`components/plan/PlaceSearch.test.tsx:197` builds a fake API response with `chineseName: "南京"`; rename that key to `localName`. Check `lib/briefing.test.ts`, `lib/server/catalogSearch.test.ts` and `lib/server/catalog.test.ts` for the same and rename in place. Do not weaken an assertion to make it pass — if a test now asserts something untrue, say so rather than editing around it.

- [ ] **Step 12: Verify the field is gone**

```bash
grep -rn "chineseName" --include=*.ts --include=*.tsx --include=*.mjs app components lib scripts
```

Expected: **two** hits, both in `lib/server/catalog.ts` — the `LegacyNamed` type and the docblock explaining it. Anything else is an unfinished rename.

- [ ] **Step 13: Full verification and commit**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
git add -A && git commit -m "refactor: delete chineseName, the last China-only name field"
```

---

## Task 35 — Retire the `Region` union

**Files:**
- Modify: `lib/types.ts:25-35`, `lib/months.ts:1,116,217`, `lib/provinces.ts:1,11,61,62,66,76,88`, `lib/server/catalog.ts:8,177`, `components/map/mapTypes.ts:2,12,35`, `components/map/CountryMap.tsx:9,68,70,306`, `components/map/MapExplorer.tsx:11,64`
- Test: `lib/tripShared.test.ts:5,40-45`, `lib/months.test.ts`, `components/map/MapExplorer.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Destination.region: string`; `ChinaRegion` as the sole seven-value union, imported by name wherever China's own split is genuinely meant. The `Region` alias no longer exists.

**The distinction this task turns on:** `Region` and `ChinaRegion` are the same seven strings today, but they mean different things. `Destination.region` is "a region label meaningful inside this destination's country" and must widen to `string` per spec §5.1. `REGION_MONTHS`, `PROVINCES`, `REGION_ORDER` and `CountryMap`'s zoom level are China's own machinery and stay pinned to `ChinaRegion` — widening *those* would be a promise the data cannot keep. Do not widen everything to `string` and call it done.

- [ ] **Step 1: Write the failing test for the widened field**

Add to `lib/tripShared.test.ts`, replacing the `ChinaRegion alias` describe block at lines 40–45:

```ts
describe("Destination.region is free-form", () => {
  test("accepts a region label that is meaningful outside China", () => {
    const kansai: Destination["region"] = "Kansai";
    expect(kansai).toBe("Kansai");
  });

  test("still accepts China's own labels, which are just strings now", () => {
    const east: Destination["region"] = "East";
    expect(east).toBe("East");
  });
});
```

Also delete the `Region` import on line 5, leaving `ChinaRegion`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/tripShared.test.ts
```

Expected: FAIL at typecheck — `"Kansai"` is not assignable to the seven-value union.

- [ ] **Step 3: Widen the field and delete the alias**

In `lib/types.ts`, delete lines 34–35 entirely:

```ts
/** @deprecated Use ChinaRegion. Kept so existing consumers compile unchanged. */
export type Region = ChinaRegion;
```

and change `Destination.region` to:

```ts
  /**
   * A region label meaningful inside this destination's country — "East" in
   * China, "Kansai" in Japan. Free-form by spec §5.1: there is no union that
   * could span every country, and inventing one per country would put the
   * catalog's vocabulary in the type system.
   */
  region: string;
```

Keep `ChinaRegion` exactly as it is, including its docblock.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run lib/tripShared.test.ts
```

Expected: PASS.

- [ ] **Step 5: Re-point China's own machinery at `ChinaRegion`**

`npx tsc --noEmit` now lists every site. Each one is a decision, not a find-and-replace — here is the decision for all of them:

| Site | Becomes | Why |
|---|---|---|
| `lib/months.ts:1,116,217` | `ChinaRegion` | `REGION_MONTHS` is a `Record` over China's seven regions and has no rows for anywhere else |
| `lib/provinces.ts:1,11,61,62,66,76,88` | `ChinaRegion` | The whole module is China's province table |
| `lib/server/catalog.ts:8,177` | `ChinaRegion` | `regionFor()` maps a Chinese province name to a Chinese region |
| `components/map/CountryMap.tsx:9,68,70,306` | `ChinaRegion` | Its own docblock at line 60 says it: other countries have no regions to zoom into |
| `components/map/MapExplorer.tsx:11,64` | `ChinaRegion` | Holds `CountryMap`'s zoom state |
| `components/map/mapTypes.ts:12` (`MapPlace.region`) | `string` | Mirrors `Destination.region`; a catalog place from any country lands here |
| `components/map/mapTypes.ts:35` (`fitForRegion`) | `ChinaRegion` | Reads `REGION_MONTHS`, so it can only answer for China |

- [ ] **Step 6: Write the failing test for the degraded fit**

Widening `MapPlace.region` to `string` means an unknown label can now reach the climate lookup. **Two functions index it, not one** — `fitForPlace` (`mapTypes.ts:32`) and `fitForRegion` (`mapTypes.ts:35`) both do `REGION_MONTHS[region][month - 1].fit`, and `fitForPlace` is the one a catalog place actually reaches. Cover both:

```ts
test("an unknown region label gets a neutral fit instead of throwing", () => {
  const abroad = { ...aCatalogPlace, region: "Kansai", bestSeasons: undefined };
  expect(() => fitForPlace(abroad, 4)).not.toThrow();
  expect(fitForPlace(abroad, 4)).toBe(NEUTRAL_FIT);
});

test("fitForRegion degrades on a label outside China's seven", () => {
  expect(fitForRegion("Kansai", 4)).toBe(NEUTRAL_FIT);
});
```

`bestSeasons: undefined` is load-bearing — `fitForPlace` returns early when a place has its own seasons, so a fixture that sets them never reaches the lookup and the test would pass while asserting nothing.

Use the file's existing place fixture rather than building a second one. `NEUTRAL_FIT` does not exist yet; add it as a named export in Step 8 rather than a literal, so the test and the implementation cannot drift.

- [ ] **Step 7: Run it and confirm it fails**

```bash
npx vitest run components/map/MapExplorer.test.tsx -t "region label"
```

Expected: FAIL — `REGION_MONTHS["Kansai"]` is `undefined`, so indexing `[month - 1]` throws `Cannot read properties of undefined`.

- [ ] **Step 8: Make both lookups total**

In `components/map/mapTypes.ts`, add the guard and share it:

```ts
/** What a place outside China's month table gets: no claim either way. */
export const NEUTRAL_FIT: MonthFit = "poor";

const CHINA_REGIONS = new Set<string>(REGION_ORDER);

function regionFit(region: string, month: number): MonthFit {
  if (!CHINA_REGIONS.has(region)) return NEUTRAL_FIT;
  return REGION_MONTHS[region as ChinaRegion][month - 1].fit;
}

export function fitForRegion(region: string, month: number): MonthFit {
  return regionFit(region, month);
}
```

and change `fitForPlace`'s final line from `return REGION_MONTHS[place.region][month - 1].fit;` to `return regionFit(place.region, month);`.

The `as` is load-bearing and safe: the `Set` membership check is exactly the runtime proof the compiler cannot do.

**Pick `NEUTRAL_FIT`'s value deliberately.** `"poor"` renders as "Off-season", which is a claim. If `MonthFit` has no honest "unknown" member, widen the union with one and give it a neutral colour in `FIT_COLORS`/`FIT_LABELS` — a Japanese city should not be labelled off-season because China's table has no row for it.

- [ ] **Step 9: Run the test and confirm it passes**

```bash
npx vitest run components/map/MapExplorer.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Verify the alias is gone**

```bash
grep -rn "\bRegion\b" --include=*.ts --include=*.tsx app components lib | grep -v ChinaRegion | grep -v "Region labels\|Autonomous Region\|REGION_"
```

Expected: zero hits naming the bare type. Prose and constant names are fine.

- [ ] **Step 11: Full verification and commit**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
git add -A && git commit -m "refactor: retire the Region union; China keeps ChinaRegion"
```

---

## Task 36 — Give the seal a token, then delete the `@theme` block

**Files:**
- Modify: `app/globals.css:71-80` (delete), `:root` and `[data-theme="dark"]` blocks (add `--seal`), `.stamp` and `.seal-round` rules, plus the 30 files listed in `lib/tokens.test.ts:93`
- Test: `lib/tokens.test.ts:70,93`, `lib/accent.test.ts:250-253`

**Interfaces:**
- Consumes: the semantic ramp from PR1.
- Produces: `--seal` in both ramps. Task 37 relies on it having a dark value, or every chop mark in the app renders at 2:1 on dark paper.

**Why this is not a one-line deletion:** `--color-seal` is the brand vermilion and the one entry in the block with no token counterpart. 61 utilities across 30 files resolve through it, and `.stamp`/`.seal-round` read it directly. `lib/tokens.test.ts:93` pins that exact file list so PR3 inherits a closed set rather than a grep it must re-run blind. The block cannot be deleted until the vermilion lives somewhere else.

- [ ] **Step 1: Write the failing test for the token**

In `lib/accent.test.ts`, replace the test at lines ~250–253 — `"the existing @theme block is left intact"` — with:

```ts
test("the retiring @theme colour block is gone", () => {
  expect(css).not.toContain("--color-seal");
  expect(css).not.toContain("--color-ink:");
  expect(css).not.toContain("--color-rail");
});

test("the brand vermilion survives as a token in both ramps", () => {
  expect(varIn(blockAfter(":root"), "--seal")).toBe("#c93b2e");
  expect(varIn(blockAfter('[data-theme="dark"]'), "--seal")).toBeTruthy();
});
```

That old test asserted the block was intact. It is *supposed* to break here — it pinned a state this task exists to end. Deleting it is the point, not collateral damage.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/accent.test.ts -t "vermilion"
```

Expected: FAIL — no `--seal` in either block.

- [ ] **Step 3: Add the token to both ramps**

In `app/globals.css`, add to `:root` beside the accent pair:

```css
  /* Brand vermilion — the chop mark. Fixed, not derived: this is the product's
     identity, not a country accent, so it does not move with the trip. */
  --seal: #c93b2e;
```

and to `[data-theme="dark"]`:

```css
  /* Lifted off #c93b2e, which sits at ~3.1:1 on dark paper. Same hue, raised
     lightness — the chop reads as the same mark in both ramps. */
  --seal: #f0705f;
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx vitest run lib/accent.test.ts
```

Expected: the vermilion test PASSes; the "block is gone" test still FAILs, because the block is still there. That is the correct intermediate state.

- [ ] **Step 5: Re-point the two CSS rules**

In the same file, in `.stamp` and `.seal-round`, replace every `var(--color-seal)` with `var(--seal)` — three occurrences in `.stamp` (border, color) and `.seal-round` (border, color). Delete the paragraph in `.stamp`'s docblock beginning "`--color-seal` stays:" — it describes a decision this step reverses.

- [ ] **Step 6: Migrate the 61 utilities**

Across the 30 files pinned in `lib/tokens.test.ts:93` (minus `components/CatalogSearch.tsx`, deleted in Task 34):

```bash
grep -rl "\-seal" --include=*.tsx app components | xargs sed -i 's/text-seal/text-[var(--seal)]/g; s/bg-seal/bg-[var(--seal)]/g; s/border-seal/border-[var(--seal)]/g'
```

The opacity variants come along unchanged — `bg-seal/5` becomes `bg-[var(--seal)]/5`, which is the exact form PR2's sweep already uses for `[var(--accent-ink)]/50` and `[var(--line-1)]/60`, so Tailwind v4 resolves it the same way. Confirm the four `seal-round` occurrences were **not** touched: that is a CSS class name, not a utility, and `sed` on `bg-seal`/`text-seal`/`border-seal` will not match it.

- [ ] **Step 7: Delete the block**

Remove `app/globals.css` lines 71–80 in full:

```css
@theme {
  --color-ink: #17263b;
  --color-ink-soft: #4a5b72;
  --color-rail: #1d5c9e;
  --color-rail-deep: #164a80;
  --color-sky: #d9e7f4;
  --color-mist: #f1f5fa;
  --color-paper: #ffffff;
  --color-seal: #c93b2e;
}
```

**Leave `@theme inline` immediately below it.** That block wires the three font families and has nothing to do with the palette; deleting it unstyles every glyph in the app.

Then update the file's opening docblock: the sentence "it stays exactly as it is and is retired in PR3" is now false. Say what is true — one palette, the token ramp.

- [ ] **Step 8: Close the grep gate**

In `lib/tokens.test.ts`, add `"seal"` to the `RETIRED` array (line ~74) and delete the whole `it("leaves the seal utilities as the only survivors, in a pinned set of files", …)` block — its docblock starts at line ~85 and the closing `});` is at line ~127, immediately above the `min-h-11` test, which **stays**. The pin existed to hand PR3 a closed list; the list is now empty and the general gate covers it.

```ts
const RETIRED = ["rail-deep", "rail", "sky", "mist", "paper", "ink-soft", "ink", "seal"] as const;
```

- [ ] **Step 9: Verify the gate can actually fail**

Temporarily reintroduce `text-seal` in any component, run the gate, and confirm it goes red:

```bash
npx vitest run lib/tokens.test.ts -t "has no surviving"
```

Expected: FAIL naming your file. Revert the edit and confirm it passes. A gate nobody has seen fail is a guarantee nobody has checked.

- [ ] **Step 10: Verify against the built CSS, not the source**

```bash
npm run build
```

```bash
grep -o "\-\-seal:[^;]*" .next/static/chunks/*.css | head
```

Expected: both ramp values present. Read `.next/static/chunks/*.css` — **not** `.next/static/css/`, which does not exist in this project.

- [ ] **Step 11: Visual pass**

An unstyled element fails silently here, not at build. Walk every surface in light and confirm each chop mark and vermilion accent still renders: `/`, `/plan` (all three steps), `/trip/[id]` (Plan, Today, Money, Kit), the guest view, `/login`, `/account`, `/b/[code]`.

Use `{preset:"desktop"}` if driving the browser pane — `resize_window` with explicit width/height corrupts compositing and clicks land nowhere.

- [ ] **Step 12: Full verification and commit**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
git add -A && git commit -m "refactor: token the brand vermilion and delete the superseded @theme palette"
```

---

## Task 37 — Enable the dark theme

**Files:**
- Modify: `components/shell/PrefsProvider.tsx:22,74,83`, `app/layout.tsx:44-47`, `components/shell/ThemeToggle.tsx:65-70`, `components/map/WorldMap.tsx:113-120,494`, `components/shell/CountryHero.tsx:48-53`
- Test: `components/shell/PrefsProvider.test.tsx:72,139`, `components/shell/ThemeToggle.test.tsx` if present

**Interfaces:**
- Consumes: `--seal` in dark (Task 36), `resolveAccentVars(prefs, country, theme)`, `ThemePref = "light" | "dark" | "system"`.
- Produces: `usePrefs()` returns `{ prefs, setPrefs, theme }` where `theme: AccentTheme` is the **resolved** ramp. `WorldMap` and `CountryHero` default their `theme` prop from it.

**Why the resolved theme goes on context:** both `WorldMap` and `CountryHero` carry a `theme` prop defaulting to `"light"`, and both docblocks give the same reason — resolving the theme a second time locally would let the map disagree with the page it sits on. One resolution, published once, read by both. Do not call `matchMedia` in either component.

- [ ] **Step 1: Write the failing tests for real theme resolution**

In `components/shell/PrefsProvider.test.tsx`, replace the two pinning tests at lines ~72 and ~139 (`"pins data-theme to light even when the stored theme is dark"` and `"the theme stays pinned to light even after saving dark"`) with:

```ts
test("applies the stored dark theme to the document", () => {
  document.cookie = "cip-prefs=theme=dark&accent=country; Path=/";
  render(<PrefsProvider><span /></PrefsProvider>);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("resolves system against the media query", () => {
  matchMediaMock(true); // prefers-color-scheme: dark
  document.cookie = "cip-prefs=theme=system&accent=country; Path=/";
  render(<PrefsProvider><span /></PrefsProvider>);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("follows the system preference when it changes mid-session", () => {
  const mq = matchMediaMock(false);
  document.cookie = "cip-prefs=theme=system&accent=country; Path=/";
  render(<PrefsProvider><span /></PrefsProvider>);
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  act(() => mq.emit(true));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});
```

jsdom has no `matchMedia`, so add a helper at the top of the file that installs one returning a controllable `matches` plus a working `addEventListener`, and have `emit` invoke the registered `change` listener. Reset it in the existing `beforeEach` that already clears `data-theme`.

These two tests were asserting the pin. Breaking them is the deliverable.

- [ ] **Step 2: Run them and confirm they fail**

```bash
npx vitest run components/shell/PrefsProvider.test.tsx
```

Expected: FAIL — every assertion reports `"light"`, because `PINNED_THEME` overrides the preference.

- [ ] **Step 3: Resolve the theme in the provider**

In `components/shell/PrefsProvider.tsx`, delete `PINNED_THEME` and its docblock, and add:

```ts
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The stored preference is one of three; the ramp is one of two. */
function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): AccentTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}
```

Inside the component, track the media query and derive the ramp:

```ts
const [systemDark, setSystemDark] = useState(false);

useEffect(() => {
  const mq = window.matchMedia(DARK_QUERY);
  setSystemDark(mq.matches);
  const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}, []);

const theme = resolveTheme(prefs.theme, systemDark);
```

Then replace both `PINNED_THEME` uses — `resolveAccentVars(prefs, country, theme)` and `root.setAttribute("data-theme", theme)` — and add `theme` to the `useMemo`'d context value and to `PrefsContextValue`. Add `theme: "light"` to the context default so `usePrefs` outside a provider still degrades rather than throwing.

`systemDark` starts `false` and corrects in an effect. That is deliberate: the inline script in Step 5 has already set the attribute before React runs, so the one-frame default is never painted.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run components/shell/PrefsProvider.test.tsx
```

Expected: PASS, all three.

- [ ] **Step 5: Make the first paint honour the preference**

In `app/layout.tsx`, replace `FIRST_PAINT` (lines 44–47). It must stay a constant string with no interpolation — that is what keeps it free of an injection surface — and must allowlist the value it reads rather than trusting the cookie:

```ts
const FIRST_PAINT = `(function(){try{
var m=document.cookie.match(/(?:^|; )cip-prefs=([^;]*)/);
var p=m?decodeURIComponent(m[1]):"";
var s=p.match(/(?:^|&)theme=([a-z]+)/);
var v=s?s[1]:"light";
var t=v==="dark"?"dark":v==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"light";
document.documentElement.setAttribute("data-theme",t);
}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;
```

Anything not exactly `dark` or `system` falls to light, so a corrupted cookie degrades instead of injecting. Leave `<html data-theme="light">` as the server-rendered default — the script overwrites it before paint, and `suppressHydrationWarning` is already set.

- [ ] **Step 6: Un-hide the toggle**

In `components/shell/ThemeToggle.tsx`, delete the `locked` constant and its three-line comment, then remove `disabled={locked}`, the `style={locked ? … : undefined}` and the `title={locked ? … : undefined}` from the `<label>`. All three options become selectable.

- [ ] **Step 7: Wire the two components that were waiting on this**

`components/map/WorldMap.tsx` — it already calls `usePrefs()`, so replace the `theme = "light"` default with the resolved value from context and delete the docblock paragraph explaining the pin (lines 113–120). Same for `components/shell/CountryHero.tsx` (lines 48–53).

Then revisit `components/map/WorldMap.tsx:494`: the hero ground is `--ink-0` because everything above the scrim is light text, and that token inverts under `data-theme="dark"`. Check it in dark during Step 9 — if the scrim now fights the text, pin the ground to a fixed dark value rather than a ramp token, and say so in the comment.

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: green. Tests elsewhere that assumed light may break — for each one, decide whether it was asserting the pin (delete or update it) or asserting something real (fix the code). Do not blanket-update.

- [ ] **Step 9: Fix the hardcoded hex that cannot invert**

A CSS variable follows the ramp; a hex literal does not. These are every literal outside a test or a comment, and each one renders identically in both themes today:

| File | Literals | Decision |
|---|---|---|
| `components/map/CountryMap.tsx` | `#ffffff` ×4, `#c93b2e` ×2, `#17263b`, `#1d5c9e`, `#4a5b72` | Re-point at tokens: the whites are `--paper`, the ink is `--ink-0`, the vermilion is `--seal`. These are SVG `fill`/`stroke` attributes, which accept `var(…)` — the map is the surface that most obviously breaks in dark. |
| `components/map/mapTypes.ts` | `FIT_COLORS` — `#2f7d54`, `#b98a2f`, `#8f9bab`, `#c93b2e` | Categorical, and they must stay distinguishable rather than follow the ramp. Keep the hues, but check each against dark paper and lift lightness where a swatch disappears. |
| `lib/provinces.ts` | 7 `REGION_META` marker colours | Same reasoning as `FIT_COLORS`: categorical by design. Verify contrast on dark paper; do not tokenise. |

`components/shell/AppShell.tsx`'s two hex mentions are inside comments explaining what the retired palette used to supply — leave them, or delete the sentences if Task 36 made them stale.

- [ ] **Step 10: Dark visual pass — the real gate**

Nothing in the suite proves a page looks right. Walk every surface in dark at 375 / 768 / 1440, per spec §9: `/`, `/plan` (all three steps), `/trip/[id]` (Plan, Today, Money, Kit), the guest view, `/login`, `/signup`, `/account`, `/b/[code]`.

Check specifically: body text contrast, the `CountryHero` scrim over both a light and a dark photograph, chop marks using the new `--seal` dark value, and the active rail tab (it failed AA at 2.60:1 once already).

Computed colours come back as `oklab(…)` here, so resolve them through a 1×1 canvas `fillStyle` rather than regex-parsing `getComputedStyle().color`.

- [ ] **Step 11: Full verification and commit**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
git add -A && git commit -m "feat: enable the dark theme and drop the light pin"
```

---

## Task 38 — Dead code, contract C6, and the doc sweep

**Files:**
- Modify: `components/map/WorldMap.tsx:113,132,238`, `components/map/WorldMap.test.tsx:274-285`, `lib/contracts.test.ts`, `README.md`, `docs/PLAN.md`
- Test: `lib/contracts.test.ts`

**Interfaces:**
- Consumes: `TripPayload` from `lib/tripShared.ts`.
- Produces: C6 asserted. Nothing downstream.

- [ ] **Step 1: Confirm `onHoverCountry` is genuinely dead**

```bash
grep -rn "onHoverCountry" --include=*.tsx --include=*.ts app components lib
```

Expected: four hits — the prop declaration, the destructure, the `createHoverReporter` call in `WorldMap.tsx`, and one test. No consumer passes it.

The alternative to deleting is wiring a hover popup into the world picker, which the spec never asks for. Delete it, and if world-level hover is wanted later it comes back with a caller attached.

- [ ] **Step 2: Delete the prop and its test**

Remove `onHoverCountry` from `WorldMapProps` (line ~113), from the destructured parameters (line ~132), and the `reportHover` binding at line ~238 if `createHoverReporter` has no other consumer in the file — check before deleting, since the country-level map uses the same helper.

Delete the `"reports hover with a position relative to the map"` test at `components/map/WorldMap.test.tsx:274-285`.

- [ ] **Step 3: Write the failing test for C6**

Add to `lib/contracts.test.ts`:

```ts
describe("C6 — the trip payload stays serialisable", () => {
  /**
   * Two checks, because either alone passes vacuously. The round-trip proves
   * a fully-populated payload survives JSON; the source scan catches a field
   * added later that the fixture does not happen to set.
   */
  const NON_SERIALISABLE = ["Date", "Map<", "Set<", "RegExp", "bigint", "symbol", "=>"];

  test("a fully-populated payload round-trips through JSON unchanged", () => {
    const payload = fullPayload();
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  test("no payload interface declares a non-serialisable field type", () => {
    const source = readFileSync(join(process.cwd(), "lib", "tripShared.ts"), "utf8");
    const block = source.slice(
      source.indexOf("export interface TripPayload"),
      source.indexOf("export interface MapCity")
    );
    const offenders = NON_SERIALISABLE.filter((t) => block.includes(t));
    expect(offenders).toEqual([]);
  });
});
```

`fullPayload()` currently lives as a private helper in `lib/redactTrip.test.ts:5`. Export it from there and import it here rather than writing a second fixture — two payload fixtures drift, and the drift is invisible until one of them stops representing the real shape.

- [ ] **Step 4: Run it and confirm it can fail**

```bash
npx vitest run lib/contracts.test.ts -t "C6"
```

Expected: PASS on a clean tree. Then prove it bites: temporarily add `createdAt: Date;` to `TripPayload` and set it in the fixture, re-run, and confirm **both** tests go red. Revert.

A contract test that has only ever been green is a guarantee nobody has checked — and this project has found fifteen scan holes exactly this way.

- [ ] **Step 5: Sweep the docs**

```bash
grep -rn "seven tabs\|chineseName\|China-only\|Region union" README.md docs/PLAN.md docs/RESEARCH.md
```

Fix only what is now factually wrong. This is not a documentation rewrite, and prose describing the app's China-first *data* remains accurate — only claims about types and tabs have changed.

- [ ] **Step 6: Confirm nothing else moved**

```bash
git diff --stat main...HEAD
```

Read the list. Every file should be one this plan named. A file you do not recognise is a stray edit, not a bonus.

- [ ] **Step 7: Full verification and commit**

```bash
npm test
```

```bash
npx tsc --noEmit
```

```bash
npm run build
```

```bash
git add -A && git commit -m "chore: drop the dead world-map hover prop, assert C6, refresh docs"
```

---

## Judgement calls

- **J13 — The catalog artifact is not regenerated.** Task 34 renames the field in types and normalises at the read boundary; `data/catalog.json` keeps `chineseName` on disk until someone runs the Wikidata ingest for an unrelated reason. Regenerating it is a network job with its own sanity thresholds and does not belong in a deletion PR.
- **J14 — `ChinaRegion` survives; `Region` does not.** Spec §5.1 widens `Destination.region` to a free-form string, but China's month table, province table and map zoom level are genuinely China-shaped. They keep the union under its honest name. The alias is what goes.
- **J15 — The seal becomes a fixed token, not a country accent.** `--seal` is the product's identity and stays put when the trip's country changes. Routing it through `lib/accent` would make the chop mark drift per country, which is the opposite of what a chop is.
- **J16 — The resolved theme is published on context, not re-derived.** One `matchMedia` listener in `PrefsProvider`; `WorldMap` and `CountryHero` read the answer. Both components' existing docblocks argue for this.
- **J17 — `WorldMap.onHoverCountry` is deleted rather than wired.** YAGNI: it has never had a caller, and the spec does not ask for world-level hover cards.

---

## Self-review

**Spec coverage.** §10 step 12 lists four deletions: `chineseName` (Task 34), the `Region` union (Task 35), the superseded `@theme` block (Task 36), the dark toggle (Task 37). All four have a task. Task 38 carries the two review-backlog items the spec does not mention.

**Ordering.** 36 must precede 37 — enabling dark before `--seal` has a dark value renders every chop mark at ~3:1 on dark paper. 34 should precede 35 only because both touch `lib/data/*.ts` and doing them together makes a confusing diff; they are otherwise independent. 38 is last so its `git diff --stat` review sees the whole branch.

**Known risk, disclosed.** Task 37's real gate is a visual pass, not a test. Dark mode has never been rendered in this app, so the honest expectation is that Step 10 finds work beyond the enumerated hex. Step 9 turns the largest known source into a closed list of 18 literals across three files, which is why it is a step rather than a warning — but `WorldMap:494` already flags its ground token as needing a second look, and a surface nobody has viewed in dark can hide more. If Step 10 turns up more than a handful of new problems, split the fixes into a Task 37b rather than growing Task 37 past a reviewable size.

**Left deliberately open.** The per-country accent hue override (spec §4.3 layer 1) is *not* in this plan. It needs a surface that can name a country, which is a design question the spec does not answer — recorded in `ThemeToggle.tsx` and in the review findings, and it is a feature, not a cleanup.
