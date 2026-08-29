# Phase 4 — Plan 2: the province artifact

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `public/provinces/<CC>.json` for all 246 countries that have a city shard — one file per country carrying its admin-1 units, from which `merge()` also yields its country outline — plus the index, the report, and the loader that reads them.

**Architecture:** A new `scripts/build-provinces.mjs`, modelled on `build-globe-topology.mjs`'s gate-everything-before-any-write discipline and `ingest-cities.mjs`'s churn-free many-file write. It fetches one 40.7 MB Natural Earth GeoJSON, attributes every admin-1 feature to a country by the spec's §7.1 rule, slices per country, runs the four-stage TopoJSON pipeline, and writes 246 files plus `index.json` and `data/provinces-report.md`. Nothing renders yet — this plan produces an artifact and its loader, and PR4 draws it.

**Tech Stack:** Node 24 (native TS type-stripping in `.mjs`), `topojson-server@3.0.1` + `topojson-simplify@3.0.3` (new devDependencies, ISC), `topojson-client@3.1.0` (already a runtime dep — supplies `merge` and `quantize`), `d3-geo@3.1.1` (already a dep), TypeScript 7, Vitest 4.

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) — this plan implements §4.1, §6.3, §6.5, §6.6, §7, §8, and the province rows of §12.3. **§5.4's projection manifest is NOT in this plan** — §14.5 requires it to be computed on the merged province outlines, which do not exist until this plan lands. It is Plan 3.

---

## What this plan already measured

Plan 1's closing table said Plan 2's first task is the build run, "because five of the numbers its later tasks assert do not exist yet". **That run has now been done**, as a throwaway prototype against the real source, and the numbers below are measured rather than derived. Every task that asserts a number asserts one of these.

| Spec claim | Status | Measured |
|---|---|---|
| §7.1 rule yields 250 codes, 7 unattributable | **confirmed** | 250 / 7, and the 7 are exactly §7.2's override rows |
| §2.3 all 13 targets have ≥1 admin-1 unit | **confirmed** | XK 30, BQ 3, and 1 each for YT RE GP MQ GF TV GI CC CX SJ TK |
| §6.6 34 single-unit countries | **confirmed** | 34, *within the 246-country emit set* (37 across all 250) |
| §14.1 feature total (DERIVED 4,580) | **settled** | **4,589** |
| §14.1 byte totals (DERIVED 8,775,960 / 3,074,772) | **settled** | **8,906,972 raw / 3,060,660 gzip** |
| §8.3 exactly two countries fail at tol = 0 | **confirmed** | exactly RU (193,912 gz) and CA (193,318 gz) |
| §8.3 CA @ 1e-4 = 416,022 / 135,304 | **confirmed** | 416,697 / 135,244 — 60 bytes apart |
| §8.3 RU @ 1e-4 = 402,791 / 122,649 | **confirmed** | 411,356 / 123,667 |
| §6.3 NE 10m CN slice = 295,239 / 89,578 | **confirmed** | 296,569 / 89,818 |
| §14.4 **does merged admin-1 tile each country?** | **ANSWERED — yes** | see below |

**§14.4, the item the spec said blocks PR4.** Merging a country's admin-1 set does tile it. Only **10 of 246** countries produce an outline with any interior ring, and every one is a genuine enclave: `ZA` 1 (Lesotho), `IT` 2 (San Marino, Vatican), `KG` 3 + `UZ` 1 (the Fergana Valley enclaves), `AE` 1 + `OM` 1 (Madha/Nahwa), `AM` 2 + `AZ` 1 (the Nakhchivan-area enclaves), `MZ` 2, `FR` 1. Only **11 of 246** have a merged 10m area below 97% of their 50m admin-0 area, and the two large ones are the **territory policy working as designed, not a gap**: `FR` 86.0% because the five DOMs are now their own countries, `NO` 82.7% because Svalbard is now `SJ`. The rest (`VA` 1.6%, `IO` 37.2%, `SX` 55.8%, `AX` 63.3%, `MH` 70.1%, `SM` 86.2%, `JE` 93.6%, `BM` 95.3%, `PS` 95.9%) are 50m-vs-10m generalisation differences on micro-territories. **No country needs a fallback outline, and PR4 is unblocked.**

### Two spec defects this measurement found

1. **§7.1 is underspecified in a way that silently loses five of the 13 targets.** It says to key on `GU_A3` but never says what to map it *to*. The obvious field, `ISO_A2`, is unusable: **67 of `admin_0_map_units`'s 298 rows** carry either `-99` or a `FR-971`-style value. Resolving `GLP` through `ISO_A2` yields the pseudo-code `"FR-971"`, and Guadeloupe, Martinique, French Guiana, Réunion and Mayotte all vanish into it — the exact fold the spec's own "**Do not use `iso_a2` first**" warning exists to prevent, reintroduced one field later. **`ISO_A2_EH` is the field that works.** Task 2 pins this.
2. **§8.1's pipeline snippet is correct but its most expensive trap is unstated.** `simplify` must be called *even when the tolerance is 0*, because `presimplify` annotates every coordinate with a third element (its triangle-area weight) and `simplify` is what strips them. Treating `tol === 0` as "skip simplify" ships those weights: the artifact measures **25,313,808 B raw / 9,402,207 B gzip** (2.8× correct) and **12 countries breach the gzip cap** instead of zero. Task 1 pins this.

### The source, which the spec never names

`grep https:// ` over the spec returns zero hits, and neither existing build script can supply admin-1 — `build-world-topology.mjs` and `build-globe-topology.mjs` both read `world-atlas@2`, which publishes only `countries-*.json` and `land-*.json`. The source is therefore new, and this plan fixes it:

```
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson   40,726,851 B
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson          13,526,439 B
```

GeoJSON, so **no shapefile parser is needed** — which is why the spec's §8.1 dependency budget of two ISC packages is achievable. `v5.1.2` was verified **byte-identical to `master`**, so the tag costs nothing and buys reproducibility. Every §6.5 figure in the spec verifies against this exact file: 4,596 features, 4,501 distinct `iso_3166_2`, 60 reused codes with `PH-MNL` ×17, 12 `-99-X##~` placeholders, and `adm1_code` unique across all 4,596.

---

## Global Constraints

- **Filename extension selects the vitest project.** `.test.ts` under `lib/` or `scripts/` runs in `node`; `.test.tsx` runs in `jsdom`. **A `.test.ts` under `components/` runs in NO project** — silently never executed. Pure logic goes in `lib/` or `scripts/`.
- **`--reporter=basic` does not exist in Vitest 4** and fails at startup. Use the default reporter or `--silent`.
- **The node project has no `setupFiles`.** A node test cannot use `jest-dom` matchers.
- **Directory is `public/provinces/`. Never `public/cities/` or a subdirectory of it.** `ingest-cities.mjs:1009` sweeps with `rmSync(path, { force: true })` and **no `recursive`**; a new subdirectory under `public/cities/` throws `ERR_FS_EISDIR` and kills the nightly refresh.
- **`scripts/*.mjs` may import `lib/*.ts` leaf modules only.** `lib/countries.ts` is the one permitted import (a zero-import leaf; `build-world-topology.mjs:38` already does it). **Never** import `lib/isoTopology.ts` or any `lib` module that imports a sibling `.ts` — extensionless `.ts` → `.ts` fails at runtime with `ERR_MODULE_NOT_FOUND`, and adding the extension fails `tsc` with TS5097. Do not add `"type": "module"` to `package.json`.
- **There is no npm script for a build.** `package.json`'s `scripts` block is dev/build/start/test/test:watch only. This script is invoked as `node scripts/build-provinces.mjs` and its output committed, matching `build-globe-topology.mjs:29-31`.
- **`ci.yml` runs `npm ci && npx tsc --noEmit && npm test` only** — no `next build`, no axe, no coverage provider. Build-time behaviour gets zero CI coverage unless a vitest test calls it.
- **Envelope field is `generatedAt`** (full ISO), never the topology scripts' date-only `generated`. Per-file payload comparison is on **`topology` alone, never the envelope**, or the churn guard never matches.
- **Deterministic ordering or the byte comparison is worthless:** features sorted by `adm1_code`, countries iterated sorted.
- **Every gate fires before any write.** `build-globe-topology.mjs` has six and its write at `:230` is unreachable unless all six pass. A 246-file build must not write and then discover a coverage hole.
- **Commit messages:** conventional commits, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `package.json` | dependency manifest | Modify: two devDependencies |
| `scripts/build-provinces.mjs` | **new** — the whole build | Create |
| `scripts/build-provinces.test.ts` | node-project tests for its pure functions | Create |
| `lib/provinceTopology.ts` | **new** — parse/validate a committed province file | Create |
| `lib/provinceTopology.test.ts` | the 246 committed files as data | Create |
| `public/provinces/*.json` | the 246 artifacts | Generated |
| `public/provinces/index.json` | country → `{count, idKey}` | Generated |
| `data/provinces-report.md` | the committed measurement record | Generated |
| `next.config.ts` | header rules | Modify: two new rules |
| `lib/cacheHeaders.test.ts` | header contract | Modify: both directions |
| `.gitattributes` | LF pinning for generated artifacts | Modify |

The build script holds four kinds of logic — attribution, slicing, the topology pipeline, and I/O. Only the first three are pure, and only those are exported; I/O stays module-private behind the argv guard, exactly as `build-globe-topology.mjs:91,107` does.

---

### Task 1: The topology pipeline, in the only order that works

The four stages have exactly one legal order and two traps. `quantize` throws `already quantized` if `topology()` was given a quantisation argument, and `simplify` must run even at tolerance 0 to strip `presimplify`'s weights.

**Files:**
- Modify: `package.json`
- Create: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildCountryTopology(featureCollection, tolerance) -> Topology`, exported. `tolerance` is a number; 0 means quantise-only.

- [ ] **Step 1: Add the two devDependencies**

```bash
npm install --save-dev topojson-server@3.0.1 topojson-simplify@3.0.3
```

Expected: 3 packages added, ~294 KB. Both ISC. Nothing at runtime imports them.

- [ ] **Step 2: Write the failing test**

Create `scripts/build-provinces.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { buildCountryTopology } from "./build-provinces.mjs";

/** Two adjacent unit squares — a shared edge is what makes this a topology. */
function twoSquares() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature", id: "AAA-1", properties: { name: "Left" },
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      },
      {
        type: "Feature", id: "AAA-2", properties: { name: "Right" },
        geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] },
      },
    ],
  };
}

describe("buildCountryTopology", () => {
  test("quantises last, so the topology is not already quantised when quantize runs", () => {
    // `quantize` throws `already quantized` if `topology()` was handed a
    // quantisation argument. That is the whole reason the order is fixed.
    const t = buildCountryTopology(twoSquares(), 0);
    expect(t.transform).toBeDefined();
    expect(t.transform.scale).toHaveLength(2);
  });

  test("strips presimplify's weights even at tolerance 0", () => {
    // presimplify annotates every coordinate with a third element (its
    // triangle-area weight); simplify is what removes them. Treating tol 0 as
    // "skip simplify" ships the weights: measured 25,313,808 B raw across the
    // 246 files instead of 8,906,972, with 12 countries over the gzip cap
    // instead of none.
    const t = buildCountryTopology(twoSquares(), 0);
    for (const arc of t.arcs) {
      for (const point of arc) {
        expect(point).toHaveLength(2);
      }
    }
  });

  test("keeps both features and their ids", () => {
    const t = buildCountryTopology(twoSquares(), 0);
    expect(t.objects.provinces.geometries.map((g) => g.id)).toEqual(["AAA-1", "AAA-2"]);
  });

  test("a non-zero tolerance drops vertices rather than whole units", () => {
    // Spec §8.2: the damage from over-simplifying is a cliff, not a slope — a
    // unit keeps its name, its id and its place in the file and draws nothing.
    // Only CA and RU take a non-zero tolerance, and neither loses a unit.
    const t = buildCountryTopology(twoSquares(), 1e-4);
    expect(t.objects.provinces.geometries).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: FAIL — `Failed to resolve import "./build-provinces.mjs"`.

- [ ] **Step 4: Write the pipeline**

Create `scripts/build-provinces.mjs`:

```js
/**
 * Builds public/provinces/<CC>.json — one admin-1 topology per country, from
 * which `merge()` also yields that country's outline (spec §4.1).
 *
 * Run by hand and the output committed:
 *
 *     node scripts/build-provinces.mjs
 *
 * Modelled on build-globe-topology.mjs: every gate fires before any write, the
 * pure functions are exported for tests and the I/O is not, and an entry-point
 * guard keeps an import from refetching 40 MB and rewriting 246 files.
 */

import { topology } from 'topojson-server';
import { presimplify, simplify } from 'topojson-simplify';
import { quantize } from 'topojson-client';

/**
 * Quantisation, per country over its own bbox. Not a guess: world-countries
 * .json's transform against its bbox measures Qx = Qy = 100000 exactly.
 */
const QUANTISATION = 1e5;

/**
 * The four stages, in the only order that works.
 *
 * `quantize` throws `already quantized` if `topology()` is handed a
 * quantisation argument, so quantisation is LAST and `topology()` is called
 * bare.
 *
 * `simplify` runs even at tolerance 0. `presimplify` annotates every
 * coordinate with a third element — its planar triangle area — and `simplify`
 * is what strips them. Skipping it at tol 0 measured 25,313,808 B raw across
 * the 246 files against 8,906,972 correct, and put 12 countries over the gzip
 * cap instead of none.
 */
export function buildCountryTopology(featureCollection, tolerance) {
  let t = topology({ provinces: featureCollection });
  t = presimplify(t);
  t = simplify(t, tolerance);
  return quantize(t, QUANTISATION);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: the province topology pipeline, in the only order that works"
```

---

### Task 2: Attribute every admin-1 feature to a country

Spec §7.1's rule, most-specific first: `gu_a3` → `iso_3166_2` prefix → `iso_a2` → `adm0_a3`, plus the explicit `/^NL-BQ\d$/` → `BQ`. The two A3-keyed steps need an A3 → alpha-2 index, and **that index must be built from `ISO_A2_EH`, not `ISO_A2`** — the defect noted above.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildAlpha2Index(mapUnits) -> { byGuA3: Map, byAdm0A3: Map }` and `attributeFeature(properties, index) -> string | null`, both exported.

- [ ] **Step 1: Write the failing test**

Add to `scripts/build-provinces.test.ts`:

```ts
import { attributeFeature, buildAlpha2Index } from "./build-provinces.mjs";

/** A map_units feature collection, in the shape Natural Earth ships. */
function mapUnits(rows: Array<Record<string, string>>) {
  return { type: "FeatureCollection", features: rows.map((properties) => ({ properties })) };
}

describe("buildAlpha2Index", () => {
  test("resolves GU_A3 through ISO_A2_EH, because ISO_A2 is not always a country code", () => {
    // 67 of the real file's 298 rows carry either "-99" or an "FR-971"-style
    // value in ISO_A2. Reading that field folds Guadeloupe, Martinique, French
    // Guiana, Réunion and Mayotte into the pseudo-code "FR-971" — five of the
    // 13 countries Phase 4 exists to reach, lost to a field choice.
    const index = buildAlpha2Index(mapUnits([
      { GU_A3: "GLP", ADM0_A3: "FRA", ISO_A2: "FR-971", ISO_A2_EH: "GP", NAME: "Guadeloupe" },
      { GU_A3: "FXX", ADM0_A3: "FRA", ISO_A2: "FR", ISO_A2_EH: "FR", NAME: "France" },
      { GU_A3: "SOL", ADM0_A3: "SOL", ISO_A2: "-99", ISO_A2_EH: "-99", NAME: "Somaliland" },
    ]));
    expect(index.byGuA3.get("GLP")).toBe("GP");
    expect(index.byGuA3.get("FXX")).toBe("FR");
    // Neither field yields a code, so the row contributes nothing rather than
    // contributing "-99" as though it were one.
    expect(index.byGuA3.has("SOL")).toBe(false);
  });

  test("keeps the first ADM0_A3 mapping and does not let a later unit overwrite it", () => {
    const index = buildAlpha2Index(mapUnits([
      { GU_A3: "FXX", ADM0_A3: "FRA", ISO_A2: "FR", ISO_A2_EH: "FR" },
      { GU_A3: "GLP", ADM0_A3: "FRA", ISO_A2: "FR-971", ISO_A2_EH: "GP" },
    ]));
    expect(index.byAdm0A3.get("FRA")).toBe("FR");
  });
});

describe("attributeFeature", () => {
  const index = buildAlpha2Index(mapUnits([
    { GU_A3: "GLP", ADM0_A3: "FRA", ISO_A2: "FR-971", ISO_A2_EH: "GP" },
    { GU_A3: "FXX", ADM0_A3: "FRA", ISO_A2: "FR", ISO_A2_EH: "FR" },
    { GU_A3: "NLX", ADM0_A3: "NLD", ISO_A2: "-99", ISO_A2_EH: "NL" },
    { GU_A3: "CHN", ADM0_A3: "CHN", ISO_A2: "CN", ISO_A2_EH: "CN" },
  ]));

  test("prefers gu_a3, which is what separates Guadeloupe from France", () => {
    expect(attributeFeature(
      { adm1_code: "FRA-4603", gu_a3: "GLP", iso_3166_2: "FR-GP", iso_a2: "FR", adm0_a3: "FRA" },
      index
    )).toBe("GP");
  });

  test("falls back to the iso_3166_2 prefix when gu_a3 resolves to nothing", () => {
    expect(attributeFeature(
      { adm1_code: "XXX-1", gu_a3: "ZZZ", iso_3166_2: "CN-11", iso_a2: "-99", adm0_a3: "ZZZ" },
      index
    )).toBe("CN");
  });

  test("routes the three Caribbean-Netherlands units to BQ by explicit rule", () => {
    // They carry gu_a3 = NLD, so every general rule sends them to NL. ISO 3166
    // gives them their own alpha-2, and Phase 4 targets it.
    for (const code of ["NL-BQ1", "NL-BQ2", "NL-BQ3"]) {
      expect(attributeFeature(
        { adm1_code: "NLD-" + code, gu_a3: "NLD", iso_3166_2: code, iso_a2: "NL", adm0_a3: "NLD" },
        index
      )).toBe("BQ");
    }
  });

  test("returns null for a feature no rule reaches", () => {
    // Seven real features land here, and every one is a row of §7.2's override
    // table: Northern Cyprus, Somaliland, Akrotiri, Dhekelia, Guantánamo,
    // Siachen and the Spratlys.
    expect(attributeFeature(
      { adm1_code: "SOL+00?", gu_a3: "SOL", iso_3166_2: "-99-X11~", iso_a2: "-99", adm0_a3: "SOL" },
      index
    )).toBeNull();
  });

  test("never returns a value that is not a two-letter code", () => {
    // The guard that would have caught the ISO_A2 defect. Everything
    // downstream uses this as a filename.
    const odd = attributeFeature(
      { adm1_code: "X", gu_a3: "GLP", iso_3166_2: "-99-X01~", iso_a2: "FR-971", adm0_a3: "FRA" },
      index
    );
    expect(odd).toMatch(/^[A-Z]{2}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "attributeFeature"
```

Expected: FAIL — `attributeFeature is not a function`.

- [ ] **Step 3: Write the attribution**

Add to `scripts/build-provinces.mjs`:

```js
/** A country code as this project uses it everywhere: two uppercase letters. */
const ALPHA2 = /^[A-Z]{2}$/;

/**
 * A3 -> alpha-2, from `admin_0_map_units`.
 *
 * Read `ISO_A2_EH`, not `ISO_A2`. 67 of the layer's 298 rows carry something
 * that is not a country code in `ISO_A2` — "-99" for the 13 disputed units,
 * and "FR-971"-style department numbers for the French overseas units. Keying
 * on `ISO_A2` resolves GLP to "FR-971" and quietly loses Guadeloupe,
 * Martinique, French Guiana, Réunion and Mayotte, which are five of the 13
 * countries this phase exists to reach. `ISO_A2_EH` is clean for all of them.
 *
 * Maps rather than object literals, because these keys come from a data file
 * and "constructor" on a plain object resolves to a function.
 */
export function buildAlpha2Index(mapUnits) {
  const byGuA3 = new Map();
  const byAdm0A3 = new Map();
  for (const feature of mapUnits.features) {
    const p = feature.properties;
    const code = ALPHA2.test(String(p.ISO_A2))
      ? p.ISO_A2
      : (ALPHA2.test(String(p.ISO_A2_EH)) ? p.ISO_A2_EH : null);
    if (code === null) continue;
    if (p.GU_A3) byGuA3.set(p.GU_A3, code);
    // First wins: FRA's own unit (FXX -> FR) is what ADM0_A3 "FRA" should mean,
    // not whichever overseas department happens to be iterated last.
    if (p.ADM0_A3 && !byAdm0A3.has(p.ADM0_A3)) byAdm0A3.set(p.ADM0_A3, code);
  }
  return { byGuA3, byAdm0A3 };
}

/**
 * The country an admin-1 feature belongs to, or null.
 *
 * Spec §7.1, most specific first. `iso_a2` is deliberately NOT first: that
 * order folds YT RE GP MQ GF into FR, TK into NZ, SJ into NO and BQ into NL,
 * and drops CC and CX entirely — precisely the set Phase 4 exists to reach.
 *
 * Seven real features return null, and all seven are rows of §7.2's override
 * table. Task 3 decides what happens to them; this function only reports that
 * no ISO rule reaches them.
 */
export function attributeFeature(properties, index) {
  // The three Caribbean-Netherlands units carry gu_a3 = NLD, so every general
  // rule sends them to NL. ISO 3166 gives them BQ.
  if (/^NL-BQ[0-9]$/.test(String(properties.iso_3166_2))) return 'BQ';
  const viaGu = index.byGuA3.get(properties.gu_a3);
  if (viaGu !== undefined) return viaGu;
  const prefix = /^([A-Z]{2})-/.exec(String(properties.iso_3166_2 ?? ''));
  if (prefix !== null) return prefix[1];
  if (ALPHA2.test(String(properties.iso_a2 ?? ''))) return properties.iso_a2;
  const viaAdm0 = index.byAdm0A3.get(properties.adm0_a3);
  if (viaAdm0 !== undefined) return viaAdm0;
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: attribute admin-1 features to countries by the ISO 3166 rule"
```

---

### Task 3: The territory override table

Spec §7.2, reviewed line by line. Seven features no ISO rule reaches, plus Jan Mayen. Three outcomes: folded into another country's **outline but not selectable**, excluded entirely, or left alone.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: `attributeFeature` (Task 2).
- Produces: `FOLD_INTO` (a frozen record), `EXCLUDED` (a Set), and `resolveTerritory(properties, index) -> { country: string | null, selectable: boolean }`, all exported.

- [ ] **Step 1: Write the failing test**

```ts
import { EXCLUDED, FOLD_INTO, resolveTerritory } from "./build-provinces.mjs";

describe("resolveTerritory — spec §7.2 line by line", () => {
  const index = buildAlpha2Index(mapUnits([
    { GU_A3: "CYP", ADM0_A3: "CYP", ISO_A2: "CY", ISO_A2_EH: "CY" },
    { GU_A3: "SOM", ADM0_A3: "SOM", ISO_A2: "SO", ISO_A2_EH: "SO" },
    { GU_A3: "CUB", ADM0_A3: "CUB", ISO_A2: "CU", ISO_A2_EH: "CU" },
    { GU_A3: "UKR", ADM0_A3: "UKR", ISO_A2: "UA", ISO_A2_EH: "UA" },
    { GU_A3: "NOR", ADM0_A3: "NOR", ISO_A2: "NO", ISO_A2_EH: "NO" },
  ]));
  const props = (over: Record<string, string>) => ({
    adm1_code: "X", gu_a3: "", iso_3166_2: "-99-X00~", iso_a2: "-99", adm0_a3: "", ...over,
  });

  test("Northern Cyprus, Akrotiri and Dhekelia shape Cyprus without being clickable", () => {
    // ISO 3166-1 governs territorial extent; 3166-2 governs subdivision
    // identity. So Cyprus's outline includes the north while its selectable
    // subdivisions do not.
    for (const gu of ["CYN", "WSB", "ESB"]) {
      expect(resolveTerritory(props({ gu_a3: gu }), index)).toEqual({ country: "CY", selectable: false });
    }
  });

  test("Somaliland shapes Somalia; Guantánamo shapes Cuba", () => {
    expect(resolveTerritory(props({ gu_a3: "SOL" }), index)).toEqual({ country: "SO", selectable: false });
    expect(resolveTerritory(props({ gu_a3: "USG" }), index)).toEqual({ country: "CU", selectable: false });
  });

  test("Siachen and the Spratlys are excluded from every file", () => {
    // ISO gives neither any guidance, and excluding is the only non-editorial
    // option available.
    for (const gu of ["KAS", "PGA"]) {
      expect(resolveTerritory(props({ gu_a3: gu }), index)).toEqual({ country: null, selectable: false });
    }
    expect([...EXCLUDED].sort()).toEqual(["KAS", "PGA"]);
  });

  test("Jan Mayen folds into SJ, because ISO 3166 SJ is Svalbard AND Jan Mayen", () => {
    expect(resolveTerritory(props({ gu_a3: "NJM" }), index)).toEqual({ country: "SJ", selectable: false });
  });

  test("Crimea and Sevastopol stay selectable under Ukraine", () => {
    // Natural Earth's iso_a2 says RU; iso_3166_2 says UA. ISO decides, and the
    // §7.1 order already reaches that answer without an override — this test
    // exists so a future reordering cannot silently change it.
    expect(resolveTerritory(props({ gu_a3: "UKR", iso_3166_2: "UA-43", iso_a2: "RU" }), index))
      .toEqual({ country: "UA", selectable: true });
    expect(resolveTerritory(props({ gu_a3: "UKR", iso_3166_2: "UA-40", iso_a2: "RU" }), index))
      .toEqual({ country: "UA", selectable: true });
  });

  test("an ordinary feature is selectable under its own country", () => {
    expect(resolveTerritory(props({ gu_a3: "CYP", iso_3166_2: "CY-01" }), index))
      .toEqual({ country: "CY", selectable: true });
  });

  test("the fold table names exactly the six territories §7.2 lists", () => {
    expect(Object.keys(FOLD_INTO).sort()).toEqual(["CYN", "ESB", "NJM", "SOL", "USG", "WSB"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "§7.2"
```

Expected: FAIL — `resolveTerritory is not a function`.

- [ ] **Step 3: Write the overrides**

```js
/**
 * Territories whose geometry shapes another country's outline but which are
 * not themselves selectable subdivisions (spec §7.2).
 *
 * ISO 3166-1 governs territorial EXTENT; ISO 3166-2 governs SUBDIVISION
 * identity. Cyprus's shape therefore includes the north while its clickable
 * subdivisions follow 3166-2, and that asymmetry is the intended reading of
 * "ISO 3166 as the single rule" rather than an inconsistency.
 *
 * Named overrides, not key precedence: nothing here should be decided by which
 * property happens to be read first.
 */
export const FOLD_INTO = Object.freeze({
  CYN: 'CY',  // Northern Cyprus — ISO 3166-1 treats the island as CY
  WSB: 'CY',  // Akrotiri — ISO 3166 gives it no code
  ESB: 'CY',  // Dhekelia — as above
  SOL: 'SO',  // Somaliland — ISO 3166-1 has no SO-split
  USG: 'CU',  // Guantánamo — within Cuba's ISO territory
  NJM: 'SJ',  // Jan Mayen — ISO 3166 SJ is "Svalbard and Jan Mayen" (D9)
});

/**
 * Geometry that lands in no file at all.
 *
 * ISO offers no guidance on either, and excluding them is the only option that
 * does not require this project to take an editorial position on a territorial
 * dispute. Recorded rather than silently dropped.
 */
export const EXCLUDED = new Set(['KAS', 'PGA']);

/** Which country's file a feature belongs in, and whether it can be clicked. */
export function resolveTerritory(properties, index) {
  const gu = properties.gu_a3;
  if (EXCLUDED.has(gu)) return { country: null, selectable: false };
  const folded = Object.prototype.hasOwnProperty.call(FOLD_INTO, gu) ? FOLD_INTO[gu] : undefined;
  if (folded !== undefined) return { country: folded, selectable: false };
  return { country: attributeFeature(properties, index), selectable: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: encode the Phase 4 territory policy as named overrides"
```

---

### Task 4: Group into countries, and gate coverage before any write

Grouping plus the §2.2 emit rule: a country gets a file when it has a city shard. Measured, that intersection is exactly 246 in both directions.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: `resolveTerritory` (Task 3).
- Produces: `groupByCountry(admin1, index) -> { byCountry: Map<string, Feature[]>, orphans: object[] }` and `assertCoverage(emitted, reference)`, both exported. Feature objects carry `{ id, properties: { name, name_en, iso_3166_2, gn_a1_code, sel }, geometry }`.

- [ ] **Step 1: Write the failing test**

```ts
import { assertCoverage, groupByCountry } from "./build-provinces.mjs";

describe("groupByCountry", () => {
  const index = buildAlpha2Index(mapUnits([
    { GU_A3: "PER", ADM0_A3: "PER", ISO_A2: "PE", ISO_A2_EH: "PE" },
    { GU_A3: "CYP", ADM0_A3: "CYP", ISO_A2: "CY", ISO_A2_EH: "CY" },
  ]));
  const admin1 = (rows: Array<Record<string, unknown>>) => ({
    type: "FeatureCollection",
    features: rows.map((properties) => ({ type: "Feature", properties, geometry: null })),
  });

  test("sorts features by adm1_code so a rebuild is byte-stable", () => {
    // Without this the file's feature order follows the source's, which is not
    // guaranteed stable across a Natural Earth refresh — and an unstable order
    // makes the churn-free write comparison useless.
    const { byCountry } = groupByCountry(admin1([
      { adm1_code: "PER-9", gu_a3: "PER", iso_3166_2: "PE-LIM", name: "Z" },
      { adm1_code: "PER-1", gu_a3: "PER", iso_3166_2: "PE-CUS", name: "A" },
    ]), index);
    expect(byCountry.get("PE")!.map((f) => f.id)).toEqual(["PER-1", "PER-9"]);
  });

  test("carries only the five properties the app reads", () => {
    // The source has 121 properties per feature. Carrying them all costs far
    // more than the geometry does.
    const { byCountry } = groupByCountry(admin1([
      { adm1_code: "PER-1", gu_a3: "PER", iso_3166_2: "PE-CUS", gn_a1_code: "PE.08",
        name: "Cusco", name_en: "Cusco", name_alt: "Cuzco", wikidataid: "Q1", type_en: "Region" },
    ]), index);
    expect(Object.keys(byCountry.get("PE")![0].properties).sort())
      .toEqual(["gn_a1_code", "iso_3166_2", "name", "name_en", "sel"]);
  });

  test("a folded territory joins the outline but is marked non-selectable", () => {
    const { byCountry } = groupByCountry(admin1([
      { adm1_code: "CYP-1", gu_a3: "CYP", iso_3166_2: "CY-01", name: "Nicosia" },
      { adm1_code: "CYN+00?", gu_a3: "CYN", iso_3166_2: "-99-X04~", name: "Northern Cyprus" },
    ]), index);
    const cy = byCountry.get("CY")!;
    expect(cy).toHaveLength(2);
    expect(cy.map((f) => f.properties.sel).sort()).toEqual([0, 1]);
  });

  test("reports an unattributable feature rather than dropping it silently", () => {
    const { byCountry, orphans } = groupByCountry(admin1([
      { adm1_code: "ZZZ+00?", gu_a3: "ZZZ", iso_3166_2: "-99-X99~", iso_a2: "-99", adm0_a3: "ZZZ", name: "Nowhere" },
    ]), index);
    expect(byCountry.size).toBe(0);
    expect(orphans.map((o) => o.adm1_code)).toEqual(["ZZZ+00?"]);
  });
});

describe("assertCoverage", () => {
  test("names every country it cannot reach, not just a count", () => {
    // build-globe-topology.test.ts:41-46 pins the same property for the globe.
    // A count tells an operator a gate failed; the names tell them what broke.
    expect(() => assertCoverage(new Set(["PE", "CN"]), new Set(["PE", "CN", "MT", "SG"])))
      .toThrow(/cannot reach 2 countries[\s\S]*MT, SG/);
  });

  test("is one-way — an extra emitted country is not an error", () => {
    // The province set can legitimately exceed the city set: AQ, BV, HM and XD
    // have admin-1 geometry and no city shard. The emit rule excludes them, but
    // the gate must not be what enforces that.
    expect(() => assertCoverage(new Set(["PE", "CN", "AQ"]), new Set(["PE", "CN"]))).not.toThrow();
  });

  test("passes when the two sets agree", () => {
    expect(() => assertCoverage(new Set(["PE"]), new Set(["PE"]))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "groupByCountry"
```

Expected: FAIL — `groupByCountry is not a function`.

- [ ] **Step 3: Write the grouping and the gate**

```js
/**
 * The five properties a province feature carries.
 *
 * Natural Earth ships 121 per feature and they cost more than the geometry.
 * `name` and `name_en` are what the UI renders; `iso_3166_2` and `gn_a1_code`
 * are join keys for later work; `sel` is §7.2's selectable flag, 1 or 0 rather
 * than a boolean because it is repeated 4,589 times.
 *
 * `iso_3166_2` is deliberately NOT the feature id: 4,596 features carry only
 * 4,501 distinct values, 60 codes are reused (worst PH-MNL ×17) and 12 are
 * `-99-X##~` placeholders. `adm1_code` is unique across all 4,596.
 */
function projectProperties(p, selectable) {
  return {
    name: p.name ?? null,
    name_en: p.name_en ?? null,
    iso_3166_2: p.iso_3166_2 ?? null,
    gn_a1_code: p.gn_a1_code ?? null,
    sel: selectable ? 1 : 0,
  };
}

/** Admin-1 features grouped by country, sorted so a rebuild is byte-stable. */
export function groupByCountry(admin1, index) {
  const byCountry = new Map();
  const orphans = [];
  for (const source of admin1.features) {
    const p = source.properties;
    const { country, selectable } = resolveTerritory(p, index);
    if (country === null) {
      if (!EXCLUDED.has(p.gu_a3)) orphans.push({ adm1_code: p.adm1_code, name: p.name });
      continue;
    }
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push({
      type: 'Feature',
      id: p.adm1_code,
      properties: projectProperties(p, selectable),
      geometry: source.geometry,
    });
  }
  for (const features of byCountry.values()) {
    features.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return { byCountry, orphans };
}

/**
 * Every country the reference set names must have a province file.
 *
 * One-way, like build-globe-topology.mjs's gate: extra emitted countries are
 * fine. The reference is the committed city-shard set, so this asserts the
 * invariant PR4 actually depends on — a country the picker can open has
 * geometry to draw.
 *
 * Names every offender. A count tells an operator a gate failed; the names
 * tell them what broke.
 */
export function assertCoverage(emitted, reference) {
  const missing = [...reference].filter((code) => !emitted.has(code)).sort();
  if (missing.length > 0) {
    throw new Error(
      `province build cannot reach ${missing.length} countries that have a city shard: ` +
      `${missing.join(', ')} — every country the picker can open must have geometry`
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts && npx tsc --noEmit
```

Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: group admin-1 into countries and gate coverage before any write"
```

---

### Task 5: Assign every city to a province by containment

Spec §6.5, D8. The name join is dead — 63.38% of pairs, **35 countries at literally zero**. Point-in-polygon reaches 96.08% with 0.00% ambiguous, and recovers 19,229 of the 20,124 cities the name join loses.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: `groupByCountry` (Task 4).
- Produces: `assignCities(features, cities) -> { cityProvince: Record<string, string>, unplaced: string[] }`, exported. `cities` is an array of `{ id, lat, lon, a1c }`.

- [ ] **Step 1: Write the failing test**

```ts
import { assignCities } from "./build-provinces.mjs";

describe("assignCities", () => {
  /** Two unit squares side by side, as GeoJSON features. */
  const features = [
    { type: "Feature", id: "AAA-1", properties: { gn_a1_code: "AA.01" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
    { type: "Feature", id: "AAA-2", properties: { gn_a1_code: "AA.02" },
      geometry: { type: "Polygon", coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]]] } },
  ];

  test("places a city in the polygon that contains it", () => {
    const { cityProvince } = assignCities(features, [
      { id: "G1", lat: 0.5, lon: 0.5, a1c: null },
      { id: "G2", lat: 0.5, lon: 1.5, a1c: null },
    ]);
    expect(cityProvince).toEqual({ G1: "AAA-1", G2: "AAA-2" });
  });

  test("falls back to a1c for a city inside no polygon at all", () => {
    // 2,301 real cities (3.92%) fall outside every polygon — offshore, or in
    // the gap between a coastline and a 10m generalisation of it. This is the
    // reason §11 makes a1c mandatory rather than merely useful.
    const { cityProvince, unplaced } = assignCities(features, [
      { id: "G9", lat: 40, lon: 40, a1c: "AA.02" },
    ]);
    expect(cityProvince).toEqual({ G9: "AAA-2" });
    expect(unplaced).toEqual([]);
  });

  test("reports a city that neither containment nor a1c can place", () => {
    const { cityProvince, unplaced } = assignCities(features, [
      { id: "G9", lat: 40, lon: 40, a1c: null },
    ]);
    expect(cityProvince).toEqual({});
    expect(unplaced).toEqual(["G9"]);
  });

  test("does not resolve an a1c that matches no feature", () => {
    const { cityProvince, unplaced } = assignCities(features, [
      { id: "G9", lat: 40, lon: 40, a1c: "AA.99" },
    ]);
    expect(cityProvince).toEqual({});
    expect(unplaced).toEqual(["G9"]);
  });

  test("prefers containment over a1c when the two disagree", () => {
    // Cross-validated on 37,438 cities: the code join agrees with containment
    // 96.11% of the time, and the residual is a hierarchy mismatch no key can
    // fix — GeoNames holds NUTS-1-style regions where NE holds NUTS-2/3.
    // Geometry is the thing being drawn, so geometry wins.
    const { cityProvince } = assignCities(features, [
      { id: "G1", lat: 0.5, lon: 0.5, a1c: "AA.02" },
    ]);
    expect(cityProvince.G1).toBe("AAA-1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "assignCities"
```

Expected: FAIL — `assignCities is not a function`.

- [ ] **Step 3: Write the assignment**

Add the import at the top of `scripts/build-provinces.mjs`:

```js
import { geoContains } from 'd3-geo';
```

And the function:

```js
/**
 * Which admin-1 unit each city sits in (spec §6.5, D8).
 *
 * Containment is primary and the GeoNames code is the fallback, not the other
 * way round. The NAME join is not used at all: it reaches 63.38% of pairs and
 * scores literally zero in 35 countries, including Great Britain, Ireland,
 * Kenya, Puerto Rico, Sri Lanka and Nepal. Containment reaches 96.08% with
 * 0.00% ambiguous, and of the 20,124 cities whose pair fails the name join,
 * 19,229 (95.55%) land in a polygon anyway — containment does not care that
 * GeoNames says "England" and Natural Earth says "Shropshire".
 *
 * The 2,301 cities (3.92%) inside no polygon are why `a1c` is mandatory rather
 * than merely useful.
 */
export function assignCities(features, cities) {
  const byGnCode = new Map();
  for (const f of features) {
    const code = f.properties.gn_a1_code;
    // First wins, and only the first: gn_a1_code is not unique across NE's
    // admin-1 set, and a later feature overwriting an earlier one would make
    // the fallback depend on iteration order.
    if (code && !byGnCode.has(code)) byGnCode.set(code, f.id);
  }
  const cityProvince = {};
  const unplaced = [];
  for (const city of cities) {
    const point = [city.lon, city.lat];
    let hit = null;
    for (const f of features) {
      if (geoContains(f, point)) { hit = f.id; break; }
    }
    if (hit === null && city.a1c) hit = byGnCode.get(city.a1c) ?? null;
    if (hit === null) unplaced.push(city.id);
    else cityProvince[city.id] = hit;
  }
  return { cityProvince, unplaced };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: assign cities to provinces by containment, with a1c as fallback"
```

---

### Task 6: The envelope, the churn-free write, and the index

246 files rewritten nightly-style is 246 diffs of timestamp noise unless the payload comparison excludes the envelope. Three preconditions, all of which `ingest-cities.mjs` already established.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `provincePayload(country, topology, cityProvince, previous, now)` and `buildIndex(entries, previous, now)`, exported. Envelope: `{ country, generatedAt, source, license, idKey, topology, cityProvince }`.

- [ ] **Step 1: Write the failing test**

```ts
import { provincePayload } from "./build-provinces.mjs";

describe("provincePayload", () => {
  const topo = { type: "Topology", objects: { provinces: { type: "GeometryCollection", geometries: [] } }, arcs: [] };
  const now = "2026-08-30T00:00:00.000Z";

  test("stamps generatedAt on a first build", () => {
    expect(provincePayload("PE", topo, {}, null, now).generatedAt).toBe(now);
  });

  test("keeps the previous timestamp when the topology is unchanged", () => {
    // 246 files whose only difference is a timestamp is 246 diffs of noise,
    // and it hides the one file that really did change.
    const before = provincePayload("PE", topo, {}, null, "2026-01-01T00:00:00.000Z");
    const after = provincePayload("PE", topo, {}, before, now);
    expect(after.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("restamps when the topology changes", () => {
    const before = provincePayload("PE", topo, {}, null, "2026-01-01T00:00:00.000Z");
    const changed = { ...topo, arcs: [[[0, 0], [1, 1]]] };
    expect(provincePayload("PE", changed, {}, before, now).generatedAt).toBe(now);
  });

  test("restamps when only the city assignment changes", () => {
    // cityProvince is part of what the file is for, so a change to it is a
    // real change even though the geometry is identical.
    const before = provincePayload("PE", topo, {}, null, "2026-01-01T00:00:00.000Z");
    expect(provincePayload("PE", topo, { G1: "PER-1" }, before, now).generatedAt).toBe(now);
  });

  test("compares payload only, never the envelope", () => {
    // If the comparison included generatedAt it could never match, and the
    // guard would be dead code that looks alive.
    const before = { ...provincePayload("PE", topo, {}, null, now), source: "something else" };
    expect(provincePayload("PE", topo, {}, before, "2026-12-31T00:00:00.000Z").generatedAt).toBe(now);
  });

  test("China declares its own id scheme", () => {
    // §6.3 D7: CN is a re-envelope of the curated topology, whose join key is
    // adcode (GB/T 2260), not adm1_code. The loader reads idKey rather than
    // assuming, so the two schemes can coexist.
    expect(provincePayload("CN", topo, {}, null, now).idKey).toBe("adcode");
    expect(provincePayload("PE", topo, {}, null, now).idKey).toBe("adm1_code");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "provincePayload"
```

Expected: FAIL — `provincePayload is not a function`.

- [ ] **Step 3: Write the envelope**

```js
const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';
const MAP_UNITS_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson';
/** Natural Earth is public domain; the vector repo redistributes it unchanged. */
const SOURCE_LICENSE = 'Natural Earth (public domain), via nvkelso/natural-earth-vector v5.1.2';

/** The one country whose file is a re-envelope of a curated asset (§6.3, D7). */
const CURATED_COUNTRY = 'CN';

/**
 * A province file, with its timestamp preserved when nothing changed.
 *
 * Compared on `topology` and `cityProvince` alone — never the envelope. A
 * comparison that included `generatedAt` could never match, and the guard
 * would be dead code that looks alive.
 *
 * `idKey` rather than an assumption: China's file is a re-envelope of the
 * committed curated topology, whose join key is `adcode` (GB/T 2260) while
 * every other country's is `adm1_code`. The loader reads this field.
 */
export function provincePayload(country, topology, cityProvince, previous, now) {
  const body = { topology, cityProvince };
  const unchanged =
    previous !== null &&
    JSON.stringify({ topology: previous.topology, cityProvince: previous.cityProvince }) ===
      JSON.stringify(body);
  return {
    country,
    generatedAt: unchanged ? previous.generatedAt : now,
    source: SOURCE_URL,
    license: SOURCE_LICENSE,
    idKey: country === CURATED_COUNTRY ? 'adcode' : 'adm1_code',
    ...body,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: churn-free province envelope with a per-country id scheme"
```

---

### Task 7: The size budget, and the two-country tolerance override

Spec §8.3. The city shard's `150_000` measures raw bytes; the province budget measures **what crosses the wire**, plus a raw tripwire so a runaway build fails loudly rather than committing 400 MB.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: `buildCountryTopology` (Task 1).
- Produces: `TOLERANCE_OVERRIDE`, `GZIP_BUDGET`, `RAW_TRIPWIRE`, and `assertBudget(sizes)`, all exported. `sizes` is an array of `{ code, raw, gzip }`.

- [ ] **Step 1: Write the failing test**

```ts
import { assertBudget, GZIP_BUDGET, RAW_TRIPWIRE, TOLERANCE_OVERRIDE } from "./build-provinces.mjs";

describe("assertBudget", () => {
  test("the budget is gzip, not raw — it measures what crosses the wire", () => {
    expect(GZIP_BUDGET).toBe(150_000);
    expect(RAW_TRIPWIRE).toBe(700_000);
  });

  test("names every country over the gzip budget", () => {
    expect(() => assertBudget([
      { code: "PE", raw: 1000, gzip: 400 },
      { code: "RU", raw: 500_000, gzip: 193_912 },
      { code: "CA", raw: 400_000, gzip: 193_318 },
    ])).toThrow(/CA 193318[\s\S]*RU 193912/);
  });

  test("names every country over the raw tripwire even when its gzip fits", () => {
    // A file that gzips well can still be pathological to parse. Measured, RU
    // at tol 0 is 707,485 B raw — the tripwire exists because that is the
    // shape a runaway build takes.
    expect(() => assertBudget([{ code: "RU", raw: 707_485, gzip: 100_000 }]))
      .toThrow(/raw tripwire[\s\S]*RU 707485/);
  });

  test("passes the measured shipping configuration", () => {
    // Largest two after the override: CA 135,244 gz / 416,697 raw and
    // RU 123,667 gz / 411,356 raw. Both clear both limits.
    expect(() => assertBudget([
      { code: "CA", raw: 416_697, gzip: 135_244 },
      { code: "RU", raw: 411_356, gzip: 123_667 },
      { code: "US", raw: 363_154, gzip: 96_518 },
    ])).not.toThrow();
  });

  test("the override table is exactly the two countries that need it", () => {
    // Measured at tol 0: RU 193,912 gz and CA 193,318 gz are the only two of
    // 246 over the cap. Every other country ships quantise-only, because 1e-5
    // erases the Vatican and 1e-4 erases 30 units including 13 Maldivian atolls.
    expect(TOLERANCE_OVERRIDE).toEqual({ CA: 1e-4, RU: 1e-4 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "assertBudget"
```

Expected: FAIL — `assertBudget is not a function`.

- [ ] **Step 3: Write the budget gate**

```js
/**
 * The province budget measures gzip, not raw.
 *
 * lib/cityShard.test.ts:371's 150,000 is a RAW measurement of a city shard.
 * The same UX intent applied to geometry measures what crosses the wire,
 * because these files compress roughly 3:1 and a raw cap would reject files
 * that cost a user nothing.
 */
export const GZIP_BUDGET = 150_000;

/**
 * A raw ceiling as well, so a runaway build fails loudly rather than
 * committing something pathological to parse. Measured, the worst tol-0 file
 * (RU, 707,485 B) is just over it, which is the shape this is written for.
 */
export const RAW_TRIPWIRE = 700_000;

/**
 * The only two countries that need simplification, and the whole table.
 *
 * Measured at tol 0 across all 246: RU 193,912 B gzip and CA 193,318 B gzip
 * are the sole breaches. Everything else ships quantise-only, because §8.2
 * disqualifies a global tolerance in both directions — 1e-5 erases the Vatican
 * (and VA's entire admin-1 representation is that one polygon) and 1e-4 erases
 * 30 units including 13 Maldivian atolls and both Bermudian cities.
 *
 * CA is the hardest slice in the dataset despite having only 13 features: its
 * vertices are almost all Arctic coastline, which is exactly what Visvalingam
 * defends longest.
 */
export const TOLERANCE_OVERRIDE = Object.freeze({ CA: 1e-4, RU: 1e-4 });

/** Aborts the build when any file breaches either limit, naming all of them. */
export function assertBudget(sizes) {
  const overGzip = sizes.filter((s) => s.gzip > GZIP_BUDGET).sort((a, b) => a.code.localeCompare(b.code));
  if (overGzip.length > 0) {
    throw new Error(
      `${overGzip.length} province file(s) over the ${GZIP_BUDGET} B gzip budget: ` +
      overGzip.map((s) => `${s.code} ${s.gzip}`).join(', ')
    );
  }
  const overRaw = sizes.filter((s) => s.raw > RAW_TRIPWIRE).sort((a, b) => a.code.localeCompare(b.code));
  if (overRaw.length > 0) {
    throw new Error(
      `${overRaw.length} province file(s) over the ${RAW_TRIPWIRE} B raw tripwire: ` +
      overRaw.map((s) => `${s.code} ${s.raw}`).join(', ')
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts && npx tsc --noEmit
```

Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: gate province files on a gzip budget with a raw tripwire"
```

---

### Task 8: China keeps its curated topology

Spec §6.3, D7. The committed `china-provinces.json` is **58,650 B raw / 20,183 gz for 35 features and 5,823 vertices**; the NE 10m slice measures **296,569 / 89,818 for 32 features**. Forced to parity the NE slice is still larger, its names are English, and it carries no nine-dash line. `CN.json` is therefore a re-envelope of the curated asset.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Test: `scripts/build-provinces.test.ts`

**Interfaces:**
- Consumes: `provincePayload` (Task 6).
- Produces: `reEnvelopeCurated(curatedTopology) -> Topology`, exported.

- [ ] **Step 1: Write the failing test**

```ts
import { reEnvelopeCurated } from "./build-provinces.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("reEnvelopeCurated — China (D7)", () => {
  const curated = JSON.parse(
    readFileSync(join(process.cwd(), "public/china-provinces.json"), "utf8")
  );

  test("renames the object key to `provinces` so every country parses alike", () => {
    // CountryMap.tsx:196 already does Object.keys(topology.objects)[0] and
    // never mentions the curated key, so this is a tidy rather than a fix —
    // but a uniform key is what lets the loader stop guessing.
    const t = reEnvelopeCurated(curated);
    expect(Object.keys(t.objects)).toEqual(["provinces"]);
  });

  test("keeps all 35 curated features, including the nine-dash line", () => {
    // §7.3 records this as a deliberate exception: CN carries a cartographic
    // claim the other 245 files do not. Removing it would change what China's
    // map has rendered since 2026-08-10.
    const t = reEnvelopeCurated(curated);
    expect(t.objects.provinces.geometries).toHaveLength(35);
    expect(t.objects.provinces.geometries.some((g) => String(g.properties.adcode) === "100000_JD")).toBe(true);
  });

  test("Shaanxi and Shanxi resolve to different polygons", () => {
    // THE China regression test. foldPlaceName strips NFD combining marks, so
    // Shǎnxī (CN-SN, adcode 610000) and Shānxī (CN-SX, 140000) both fold to
    // "shanxi". Any name-based match collapses them and one province silently
    // draws the other's outline — in the country the app is named after.
    const t = reEnvelopeCurated(curated);
    const byAdcode = new Map(t.objects.provinces.geometries.map((g) => [String(g.properties.adcode), g]));
    const shanxi = byAdcode.get("140000");
    const shaanxi = byAdcode.get("610000");
    expect(shanxi).toBeDefined();
    expect(shaanxi).toBeDefined();
    expect(shanxi!.arcs).not.toEqual(shaanxi!.arcs);
  });

  test("does not re-quantise — the curated arcs are carried verbatim", () => {
    // Re-running the pipeline over an already-quantised topology would either
    // throw `already quantized` or degrade geometry that was hand-tuned to
    // 58,650 B. The re-envelope is a rename, not a rebuild.
    const t = reEnvelopeCurated(curated);
    expect(t.arcs).toBe(curated.arcs);
    expect(t.transform).toEqual(curated.transform);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/build-provinces.test.ts -t "reEnvelopeCurated"
```

Expected: FAIL — `reEnvelopeCurated is not a function`.

- [ ] **Step 3: Write the re-envelope**

```js
/**
 * China's file, from the committed curated topology rather than Natural Earth.
 *
 * Measured side by side: the curated asset is 58,650 B raw / 20,183 gz for 35
 * features and 5,823 vertices; the NE 10m slice is 296,569 / 89,818 for 32.
 * Forced to vertex parity the NE slice is STILL 10.5% larger raw. It also
 * names provinces in English, keys on iso_3166_2 rather than adcode, and
 * carries no nine-dash line at all — it treats the Spratlys as their own
 * country and the Paracels as a Chinese province.
 *
 * A rename, not a rebuild: the arcs and transform are carried by reference.
 * Re-running the pipeline over an already-quantised topology would throw
 * `already quantized`, and re-quantising hand-tuned geometry would only
 * degrade it.
 */
export function reEnvelopeCurated(curated) {
  const key = Object.keys(curated.objects)[0];
  return {
    ...curated,
    objects: { provinces: curated.objects[key] },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/build-provinces.test.ts
```

Expected: PASS, including the Shaanxi/Shanxi regression.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-provinces.mjs scripts/build-provinces.test.ts
git commit -m "feat: re-envelope China's curated topology instead of slicing NE"
```

---

### Task 9: The build run

Everything above is pure and tested. This task adds the I/O, runs the build for real, and commits 246 files plus the index and the report.

**Files:**
- Modify: `scripts/build-provinces.mjs`
- Create: `public/provinces/*.json`, `public/provinces/index.json`, `data/provinces-report.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the committed artifact. No new export.

- [ ] **Step 1: Add the I/O and the entry point**

Add to `scripts/build-provinces.mjs`:

```js
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const OUT_DIR = join(process.cwd(), 'public', 'provinces');
const SHARD_DIR = join(process.cwd(), 'public', 'cities');
const CURATED_PATH = join(process.cwd(), 'public', 'china-provinces.json');
const REPORT_PATH = join(process.cwd(), 'data', 'provinces-report.md');
const RETRY_DELAYS_MS = [2000, 8000];
const USER_AGENT = 'china-itinerary-planner/build-provinces (+https://github.com/darrenCWJ/china-itinerary-planner)';

/**
 * Write via a PID-suffixed temp file, removing the destination first.
 *
 * `rmSync` before `renameSync` because renaming onto an existing path is not
 * reliably atomic on Windows, which is this project's dev platform. The PID
 * suffix is ingest-airports.mjs's: a bare `.tmp` collides if two builds ever
 * overlap.
 */
function writeFileAtomic(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temp, contents);
    rmSync(path, { force: true });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

async function fetchJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) {
        throw new Error(
          `could not fetch ${url}: ${error.message}. The committed province files stand — ` +
          `do not hand-write one.`
        );
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}
```

Then `main()`, in gate order — sibling asset, fetch, attribute, group, coverage, build, budget, and only then write:

```js
async function main() {
  // Cheap failures first: the curated China asset and the city shards are both
  // committed, and neither costs a 40 MB download to check.
  if (!existsSync(CURATED_PATH)) {
    throw new Error(`${CURATED_PATH} is missing — CN's file is a re-envelope of it (D7)`);
  }
  const shardCodes = new Set(
    readdirSync(SHARD_DIR).filter((n) => /^[A-Z]{2}\.json$/.test(n)).map((n) => n.slice(0, 2))
  );
  if (shardCodes.size === 0) throw new Error('no city shards found — the emit rule has nothing to follow');

  const [admin1, mapUnits] = await Promise.all([fetchJson(SOURCE_URL), fetchJson(MAP_UNITS_URL)]);
  const index = buildAlpha2Index(mapUnits);
  const { byCountry, orphans } = groupByCountry(admin1, index);

  // The seven §7.2 rows are expected; anything else is upstream drift and must
  // be looked at rather than read past.
  const EXPECTED_ORPHANS = 7;
  if (orphans.length !== EXPECTED_ORPHANS) {
    throw new Error(
      `${orphans.length} unattributable admin-1 features, expected ${EXPECTED_ORPHANS} — ` +
      orphans.map((o) => `${o.adm1_code} (${o.name})`).join(', ')
    );
  }

  const emitted = new Set([...byCountry.keys()].filter((c) => shardCodes.has(c)));
  assertCoverage(emitted, shardCodes);

  const now = new Date().toISOString();
  const curated = JSON.parse(readFileSync(CURATED_PATH, 'utf8'));
  const sizes = [];
  const entries = [];
  const payloads = new Map();

  for (const code of [...emitted].sort()) {
    const features = byCountry.get(code);
    const shard = JSON.parse(readFileSync(join(SHARD_DIR, `${code}.json`), 'utf8'));
    const topo = code === CURATED_COUNTRY
      ? reEnvelopeCurated(curated)
      : buildCountryTopology({ type: 'FeatureCollection', features }, TOLERANCE_OVERRIDE[code] ?? 0);
    const { cityProvince, unplaced } = assignCities(features, shard.cities.map((c) => ({
      id: c.id, lat: c.lat, lon: c.lon, a1c: c.a1c ?? null,
    })));
    const path = join(OUT_DIR, `${code}.json`);
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    const payload = provincePayload(code, topo, cityProvince, previous, now);
    const json = `${JSON.stringify(payload)}\n`;
    sizes.push({ code, raw: Buffer.byteLength(json), gzip: gzipSync(json).length });
    entries.push({ code, count: features.filter((f) => f.properties.sel === 1).length,
                   idKey: payload.idKey, unplaced: unplaced.length });
    payloads.set(code, json);
  }

  assertBudget(sizes);

  // Every gate has passed. Only now does anything reach disk.
  for (const [code, json] of payloads) writeFileAtomic(join(OUT_DIR, `${code}.json`), json);
  writeFileAtomic(join(OUT_DIR, 'index.json'), `${JSON.stringify({ generatedAt: now, countries: entries })}\n`);
  writeFileAtomic(REPORT_PATH, buildReport({ sizes, entries, orphans, now }));
  console.log(`Wrote ${payloads.size} province files to ${OUT_DIR}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nProvince build failed: ${error.message}`);
    console.error('Nothing was written — the previous artifacts are untouched.');
    process.exit(1);
  });
}
```

Write `buildReport` in the shape `build-globe-topology.mjs:136-166` establishes — an H1, Source, Licence, Generated, a `## Coverage` section of bolded counts, a paragraph explaining the one non-obvious consequence, and a `## Size` section. Take the timestamp from `now`, never a second `new Date()`.

- [ ] **Step 2: Run the build**

```bash
node scripts/build-provinces.mjs
```

Expected: two fetches (~54 MB total), then `Wrote 246 province files`. If a gate fires, the message names the offenders — fix the cause, never weaken the gate.

- [ ] **Step 3: Verify against the measured expectations**

```bash
node -e "const fs=require('fs'),z=require('zlib');const d='public/provinces';const f=fs.readdirSync(d).filter(n=>/^[A-Z]{2}\.json$/.test(n));let R=0,G=0,mx=['',0];for(const n of f){const b=fs.readFileSync(d+'/'+n);R+=b.length;const g=z.gzipSync(b).length;G+=g;if(g>mx[1])mx=[n,g];}console.log('files',f.length,'raw',R,'gzip',G,'largest',mx);"
```

Expected, from the prototype run: **246 files, ~8,906,972 B raw, ~3,060,660 B gzip, largest CA at ~135,244 B gzip.** Small drift is fine — the source is pinned, so a large drift means the pipeline differs from the prototype and must be explained, not accepted.

- [ ] **Step 4: Run the full suite**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS. On a fresh Windows clone with `core.autocrlf=true`, `lib/contracts.test.ts` can fail on line endings alone until Task 11 lands `.gitattributes`.

- [ ] **Step 5: Commit**

```bash
git add public/provinces data/provinces-report.md scripts/build-provinces.mjs
git commit -m "feat: build 246 province files from Natural Earth 10m admin-1"
```

---

### Task 10: The loader, and the committed files as data

`lib/provinceTopology.ts` is what PR4 imports. Its tests read the 246 committed files, guarded by `describe.skipIf(!existsSync(...))` so a checkout without the artifact does not fail.

**Files:**
- Create: `lib/provinceTopology.ts`, `lib/provinceTopology.test.ts`

**Interfaces:**
- Consumes: the artifact from Task 9.
- Produces: `parseProvinceTopology(raw, expectedCountry?) -> ProvinceFile`, `provincePath(country)`, `PROVINCE_INDEX_PATH`, and the `ProvinceFile` / `ProvinceIndex` types.

- [ ] **Step 1: Write the failing test**

Mirror `lib/cityShard.test.ts`'s shape. The tests that must exist:

```ts
describe("parseProvinceTopology", () => {
  test("throws rather than returning a half-parsed file", () => { /* null, bad country, missing topology */ });
  test("rejects a file whose envelope names a different country than the path", () => { /* the fixture-swap guard cityShard.ts:94 documents */ });
  test("accepts both id schemes and reports which one the file uses", () => { /* idKey adm1_code vs adcode */ });
  test("drops a cityProvince entry pointing at no feature", () => { /* dangling ids must not reach a Map lookup */ });
});

describe.skipIf(!existsSync(PROVINCE_DIR))("the committed province files", () => {
  test("has a file for every country the index names, and no orphans", () => { /* both directions, cityShard.test.ts:346 */ });
  test("names exactly 246 countries", () => { /* toHaveLength(246), never toBeGreaterThan — a 247th forces a human decision */ });
  test("every country with a city shard has a province file", () => { /* the coverage invariant PR4 depends on */ });
  test("no file exceeds the gzip budget", () => { /* 150,000, and say in the comment that CA at ~135 KB is the binding case */ });
  test("every file parses", () => { /* parseProvinceTopology over all 246 */ });
  test("34 countries have exactly one selectable unit", () => { /* §6.6 D10, measured within the emit set */ });
  test("China's file carries 35 features and idKey adcode", () => { /* D7 */ });
});
```

- [ ] **Step 2: Run to verify it fails, write `lib/provinceTopology.ts`, run again**

Follow `lib/cityShard.ts`'s conventions exactly: `fail()` throws with a prefixed message, every field is validated rather than trusted, and a `Map` is used wherever a key comes from the file.

- [ ] **Step 3: Commit**

```bash
git add lib/provinceTopology.ts lib/provinceTopology.test.ts
git commit -m "feat: parse and validate committed province topologies"
```

---

### Task 11: Cache headers and line endings

Two new header rules and two `.gitattributes` lines. Without the first, the largest province file is refetched on every map page under Next's default `public, max-age=0`; without the second, a fresh Windows clone fails a byte comparison on line endings alone.

**Files:**
- Modify: `next.config.ts`, `lib/cacheHeaders.test.ts`, `.gitattributes`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Extend `lib/cacheHeaders.test.ts`. It already has `matches()`, `headerRules()`, `CITIES_SOURCE` and `TOPOLOGY_SOURCE`; add sibling constants rather than extending `SHARD_PATHS`:

```ts
const PROVINCES_SOURCE = "/provinces/:path+";
const CLIMATE_SOURCE = "/climate/:path+";
const PROVINCE_PATHS = ["/provinces/PE.json", "/provinces/index.json"];
const CLIMATE_PATHS = ["/climate/PE.json"];
```

Then, mirroring the existing tests one-for-one: a rule exists for each with the 86400 / 604800 window; bare `/provinces` and `/climate` are excluded (`:path+`, not `:path*`), with the same vacuity guard; and **the disjointness test extended in both directions** — no path is claimed by two rules, and the single-segment `TOPOLOGY_SOURCE` cannot reach into either new subtree.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run lib/cacheHeaders.test.ts
```

Expected: FAIL — no rule matches `/provinces/PE.json`.

- [ ] **Step 3: Add the rules**

Two entries in `next.config.ts`'s `headers()`, after the `/cities/` rule, both `public, max-age=86400, stale-while-revalidate=604800`. Province and climate files are decadal or rebuilt-by-hand, so they take the topology assets' day-long window rather than the cities' six hours.

**Also fix the stale docblock at `next.config.ts:5-9`** — it says "this block describes the FIRST rule below only" and names the second by hand, which goes wrong the moment a third and fourth exist.

- [ ] **Step 4: Add the `.gitattributes` lines**

```
public/provinces/*.json text eol=lf
public/climate/*.json text eol=lf
```

`.gitattributes` pins `data/*.md` and `data/*.json` today but nothing under `public/`. Both lines land now, including climate's — Plan 5 creates that directory and the rule costs nothing until it does.

- [ ] **Step 5: Run everything**

```bash
npm test && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts lib/cacheHeaders.test.ts .gitattributes
git commit -m "feat: cache and line-ending rules for the province and climate artifacts"
```

---

## The rest of the series

| Plan | Covers | Unblocked by |
|---|---|---|
| **3** | PR4 — L2 map: outline via `merge()`, registry, markers, selected-place card, **and the §5.4 projection manifest** | this plan (the manifest must be computed on the merged outlines, §14.5) |
| 4 | PR5 — L3 level, province zoom, China regions as grouping | Plan 3 |
| 5 | PR6 — climate ingest and the four fit-model fixes | **ready now** (`elev` landed in Plan 1) |
| 6 | PR7 — climate in the UI | Plans 4 and 5 |
| 7 | PR8 — airport map layer | Plan 3 |
| 8 | PR9 — trip gateways | Plan 7 |

**Plan 5 is writable today and is independent of this one** — it needs only `elev`, which Plan 1 committed. It is also the largest single download in the phase (36 whole-object GETs, ~5.2 GB) and adds `geotiff@3.0.5`.

---

## Self-review

**Spec coverage.** §4.1 one-artifact-family → Tasks 1, 4, 6. §6.3 China D7 → Task 8. §6.5 city→province D8 → Task 5. §6.6 single-unit D10 → Task 10's index test. §7.1 attribution → Task 2. §7.2 overrides → Task 3. §7.3 nine-dash exception → Task 8. §8.1 toolchain and pipeline order → Task 1. §8.2 why not global simplification → Task 7's comment. §8.3 budget → Task 7. §8.4 hazards → Global Constraints, Task 6 (churn), Task 9 (`writeFileAtomic`), Task 11 (headers, `.gitattributes`). §12.3's province rows → Tasks 9 and 10. **§5.4 is deliberately deferred to Plan 3**, per §14.5.

**Gaps closed while writing.** The spec names no source URL and no wire format for the NE data; both are now fixed and pinned. §7.1's `GU_A3` step had no target field named; `ISO_A2_EH` is now specified and pinned by a test that names the five countries the wrong choice loses. §8.1's pipeline is correct but its tol-0 trap was unstated; Task 1 pins it with the measured cost.

**Placeholder scan.** Tasks 10 and 11 give test *names* and the properties they must prove rather than full bodies — deliberate, and the only two places it happens: both mirror an existing file (`lib/cityShard.test.ts`, `lib/cacheHeaders.test.ts`) closely enough that reproducing 200 lines here would be a worse instruction than "follow that file". Every other step carries the real code.

**Type consistency.** `buildCountryTopology`, `buildAlpha2Index`, `attributeFeature`, `FOLD_INTO`, `EXCLUDED`, `resolveTerritory`, `groupByCountry`, `assertCoverage`, `assignCities`, `provincePayload`, `TOLERANCE_OVERRIDE`, `GZIP_BUDGET`, `RAW_TRIPWIRE`, `assertBudget`, `reEnvelopeCurated` are each defined once and consumed under those exact names. The envelope is `{ country, generatedAt, source, license, idKey, topology, cityProvince }` in Task 6 and read under those names in Tasks 9 and 10. `sel` is `1 | 0` everywhere, never a boolean.
