# Phase 4 — Plan 1: ingest foundations and the L2 list

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the two city fields every later Phase 4 PR depends on (`a1c`, `elev`), and make every city in an open country reachable — replacing the 60-chip cap that currently hides 690 of Peru's 750 cities.

**Architecture:** Two independent slices, neither of which touches geometry. Slice A adds two fields to the GeoNames ingest and the shard schema; both artifacts regenerate from an existing daily workflow, so this is a re-run rather than a migration. Slice B rewrites `CountryPlaceList` to group its chips by admin-1 name and filter them, using the `a1` field that already exists in the shards today.

**Tech Stack:** Node 24 (native TS type-stripping in `.mjs` scripts), TypeScript 7, Vitest 4 (two projects: `node` for `lib/**` + `scripts/**` `.test.ts`, `jsdom` for `**/*.test.tsx`), React 19, Testing Library 16.

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) — this plan implements §11 (Slice A) and §5.2 + §12.2 (Slice B).

## Global Constraints

- **Filename extension selects the vitest project.** `.test.ts` under `lib/` or `scripts/` runs in `node`; `.test.tsx` runs in `jsdom`. **A `.test.ts` under `components/` runs in NO project** — it is silently never executed. Pure logic goes in `lib/` or `scripts/`.
- **`--reporter=basic` does not exist in Vitest 4** and fails at startup. Use the default reporter or `--silent`.
- **The node project has no `setupFiles`.** A node test cannot use `jest-dom` matchers.
- **No hex colour literals in map components.** Colour comes from `lib/accent` and the CSS token set.
- **Interactive controls are at least `var(--tap-min)`** (44px, `app/globals.css:49`).
- **`scripts/*.mjs` may import `lib/*.ts` leaf modules only** — an extensionless `.ts` → `.ts` import fails at runtime with `ERR_MODULE_NOT_FOUND`, and adding the extension fails `tsc` with TS5097. Do not add `"type": "module"` to `package.json`.
- **Never create a subdirectory under `public/cities/`.** `scripts/ingest-cities.mjs:1009` sweeps with `rmSync(path, { force: true })` and no `recursive`, which throws `ERR_FS_EISDIR` and kills the nightly refresh.
- **City shard budget is 150,000 B raw per file**, asserted at `lib/cityShard.test.ts:371`. Largest shard today is AR at 96,726 B.
- **Commit messages:** conventional commits, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

**Slice A — ingest**

| File | Responsibility | Change |
|---|---|---|
| `scripts/ingest-cities.mjs` | GeoNames dump → 246 committed shards | Modify: `COL`, `parseGeoNamesRows`, `buildCities`, `assertSane` |
| `scripts/ingest-cities.test.ts` | pure functions of the ingest | Modify: new cases for both fields |
| `lib/cityShard.ts` | shard parsing, validation, `MapCity` mapping | Modify: `CityShardRow`, `parseCityShard` row mapping |
| `lib/cityShard.test.ts` | shard contract + committed artifacts as data | Modify: fixtures, new field assertions |
| `public/cities/*.json` | the 246 committed shards | Regenerated |

**Slice B — the list**

| File | Responsibility | Change |
|---|---|---|
| `lib/placeGrouping.ts` | **new** — pure grouping and filtering of `MapPlace[]` | Create |
| `lib/placeGrouping.test.ts` | **new** — node-project tests for the above | Create |
| `components/map/CountryMap.tsx` | `CountryPlaceList` + `ChinaLevel` | Modify: `CountryPlaceList` only |
| `components/map/CountryMap.test.tsx` | jsdom tests for both levels | Modify: replace the cap test, add reachability tests |

The grouping and filtering logic lives in `lib/`, not in the component, for two reasons: the node project is where pure logic is tested fast, and a `.test.ts` beside the component would never run at all.

---

# Slice A — ingest foundations

### Task 1: Carry the admin-1 code and elevation out of the GeoNames parser

`parseGeoNamesRows` already reads `admin1Code` (used to look up the display name and then discarded). It does not read elevation at all. GeoNames' dump is a fixed 19-column shape; elevation is column 15 and `dem` — a digital-elevation-model fallback — is column 16. **`elevation` is frequently blank while `dem` is nearly always populated**, so the field takes `elevation` when present and falls back to `dem`.

**Files:**
- Modify: `scripts/ingest-cities.mjs:162-172` (the `COL` map), `:182-228` (`parseGeoNamesRows`)
- Test: `scripts/ingest-cities.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: rows from `parseGeoNamesRows` gain `elevation: number | null`. `admin1Code: string` already exists and is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `scripts/ingest-cities.test.ts`, in the `parseGeoNamesRows` describe block:

```ts
/** A GeoNames row is 19 tab-separated columns; this builds one. */
function geoNamesLine(overrides: Record<number, string> = {}): string {
  const cols = [
    "3936456", "Lima", "Lima", "Lima,LIM", "-12.04318", "-77.02824",
    "P", "PPLC", "PE", "", "15", "", "", "", "8472935", "", "154",
    "America/Lima", "2024-01-01",
  ];
  for (const [i, v] of Object.entries(overrides)) cols[Number(i)] = v;
  return cols.join("\t");
}

test("reads elevation, falling back to dem when the elevation column is blank", () => {
  const [row] = parseGeoNamesRows(geoNamesLine());
  // Column 15 (elevation) is blank for most of the dump; column 16 (dem) is
  // the modelled fallback and is populated nearly everywhere. Lima is 154 m.
  expect(row.elevation).toBe(154);
});

test("prefers the surveyed elevation over dem when both are present", () => {
  const [row] = parseGeoNamesRows(geoNamesLine({ 15: "161", 16: "154" }));
  expect(row.elevation).toBe(161);
});

test("carries a null elevation when neither column has a value", () => {
  const [row] = parseGeoNamesRows(geoNamesLine({ 15: "", 16: "" }));
  // Null, not 0: sea level is a real elevation and 0 would place a Himalayan
  // town at the coast for the climate bias correction that reads this.
  expect(row.elevation).toBeNull();
});

test("keeps the raw admin-1 code beside the row", () => {
  const [row] = parseGeoNamesRows(geoNamesLine({ 10: "15" }));
  expect(row.admin1Code).toBe("15");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/ingest-cities.test.ts
```

Expected: FAIL — the three elevation tests report `expected undefined to be 154` (and similar). The `admin1Code` test passes already; it is there to pin behaviour the next task depends on.

- [ ] **Step 3: Add the columns and the field**

In `scripts/ingest-cities.mjs`, extend the `COL` map at line 162:

```js
const COL = {
  geonameId: 0,
  name: 1,
  altNames: 3,
  lat: 4,
  lon: 5,
  country: 8,
  admin1: 10,
  population: 14,
  elevation: 15,
  dem: 16,
  timezone: 17,
};
```

In `parseGeoNamesRows`, add the field to the pushed record, beside `population`:

```js
      population,
      // GeoNames leaves column 15 blank for most rows and carries a modelled
      // value in `dem`; the climate bias correction needs *an* elevation far
      // more than it needs a surveyed one. Null rather than 0 — sea level is
      // a real elevation, and 0 would put a Himalayan town at the coast.
      elevation: integerOrNull(f[COL.elevation]) ?? integerOrNull(f[COL.dem]),
      timezone: f[COL.timezone].trim(),
```

And add the helper above `parseGeoNamesRows`:

```js
/** A GeoNames integer column, or null when blank or unparseable. */
function integerOrNull(raw) {
  const text = (raw ?? '').trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/ingest-cities.test.ts
```

Expected: PASS, all four new tests plus every pre-existing one.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
git commit -m "feat: read GeoNames elevation, falling back to the dem column

Column 15 is blank for most of the dump; column 16 carries a modelled value.
Null rather than 0 when both are empty, because sea level is a real elevation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Emit `a1c` and `elev` in the shard

`buildCities` currently emits a seven-field record and resolves `admin1Code` to a display name, discarding the code. The code is what joins a city to an admin-1 polygon; the name join was measured at 63.4% with 35 countries at zero, so the code has to survive.

**Files:**
- Modify: `scripts/ingest-cities.mjs:387-415` (`buildCities`)
- Test: `scripts/ingest-cities.test.ts`

**Interfaces:**
- Consumes: `parseGeoNamesRows` rows carrying `elevation: number | null` and `admin1Code: string` (Task 1).
- Produces: each shard row is now nine fields — `{ id, n, lat, lon, a1, a1c, p, elev, tz }`. `a1c` is `"<CC>.<CODE>"` or null; `elev` is `number | null`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/ingest-cities.test.ts`:

```ts
describe("buildCities — the nine-field record", () => {
  const rows = [
    {
      id: "G3936456", name: "Lima", altNameCount: 2, lat: -12.04, lon: -77.03,
      country: "PE", admin1Code: "15", population: 8472935, elevation: 154,
      timezone: "America/Lima",
    },
    {
      id: "G3931276", name: "Puno", altNameCount: 1, lat: -15.84, lon: -70.03,
      country: "PE", admin1Code: "21", population: 100168, elevation: 3830,
      timezone: "America/Lima",
    },
  ];
  const admin1Codes = new Map([["PE.15", "Lima"], ["PE.21", "Puno"]]);

  test("keeps the admin-1 code alongside the resolved name", () => {
    const { shards } = buildCities(rows, admin1Codes, []);
    const [lima] = shards.get("PE");
    // The name is what the user reads; the code is what joins to a polygon.
    // Both, because the name join was measured at 63% and the code at 85%.
    expect(lima.a1).toBe("Lima");
    expect(lima.a1c).toBe("PE.15");
  });

  test("carries elevation through to the shard", () => {
    const { shards } = buildCities(rows, admin1Codes, []);
    const puno = shards.get("PE").find((c) => c.n === "Puno");
    expect(puno.elev).toBe(3830);
  });

  test("nulls the code when GeoNames gives the row no admin-1", () => {
    const orphan = [{ ...rows[0], admin1Code: "" }];
    const { shards } = buildCities(orphan, admin1Codes, []);
    const [city] = shards.get("PE");
    // Not "PE." — a dangling prefix would look like a real key and would
    // match nothing, which is worse than an honest null.
    expect(city.a1c).toBeNull();
    expect(city.a1).toBeNull();
  });
});
```

Add `buildCities` to the import at the top of the file:

```ts
import {
  buildCities, parseAdmin1Codes, parseGeoNamesRows, readZipMember,
} from "./ingest-cities.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/ingest-cities.test.ts -t "nine-field record"
```

Expected: FAIL — `expected undefined to be 'PE.15'`.

- [ ] **Step 3: Emit the two fields**

In `scripts/ingest-cities.mjs`, replace the object literal inside `buildCities`'s `display.map(...)`:

```js
      display.map((row) => ({
        id: row.id,
        n: row.name,
        lat: row.lat,
        lon: row.lon,
        // `?? null`, not `?? row.admin1Code`: this value is rendered to the
        // user as a province, and "22" is not a province of Japan. A Map
        // lookup, so a code spelled "constructor" cannot resolve to a function.
        a1: admin1Codes.get(`${country}.${row.admin1Code}`) ?? null,
        // The code the name was resolved FROM. Kept because the name join to
        // Natural Earth admin-1 was measured at 63.4% with 35 countries at
        // zero, while this code matches `gn_a1_code` on 83% of features and
        // is the only way to verify a geometric assignment. A row with no
        // admin-1 gets null, never the dangling prefix `"PE."`.
        a1c: row.admin1Code === '' ? null : `${country}.${row.admin1Code}`,
        p: row.population,
        elev: row.elevation,
        tz: row.timezone,
      }))
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/ingest-cities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update the record-count docblock**

`scripts/ingest-cities.mjs` and `lib/cityShard.ts:42` both describe this as "the seven-field record". Both now say nine. Search and fix:

```bash
grep -rn "seven-field record" scripts lib docs
```

Change each to `nine-field record`.

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts lib/cityShard.ts docs
git commit -m "feat: persist the admin-1 code and elevation in city shards

The admin-1 NAME join to Natural Earth admin-1 measures 63.4%, with 35
countries matching nothing at all; the CODE matches gn_a1_code on 83% and is
the only way to verify a geometric assignment. Elevation feeds the climate
temperature bias correction, which runs -3.62 C above 2,000 m.

Both artifacts regenerate from the daily workflow, so this is a re-run rather
than a migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Parse and validate the new fields on the way back in

`parseCityShard` validates every field it reads and coerces anything malformed. The two new fields need the same treatment, and `a1c` needs a shape guard — it reaches a `Map` key and later a polygon join, and a value like `"constructor"` must not resolve to a function.

**Files:**
- Modify: `lib/cityShard.ts:42-52` (`CityShardRow`), `:128-140` (the row mapping)
- Test: `lib/cityShard.test.ts`

**Interfaces:**
- Consumes: shards emitted by Task 2.
- Produces: `CityShardRow` gains `a1c: string | null` and `elev: number | null`. **`MapCity` is unchanged** — `shardRowToMapCity` does not carry `a1c`, and the Phase 4 polygon join reads `CityShardRow` directly.

- [ ] **Step 1: Write the failing test**

Add to `lib/cityShard.test.ts`:

```ts
describe("parseCityShard — the two Phase 4 fields", () => {
  // Signature is `parseCityShard(raw, expectedCountry?)` — the payload first,
  // the country as an optional cross-check. Not `(country, raw)`.
  function shardWith(city: Record<string, unknown>) {
    return parseCityShard({
      country: "PE",
      generatedAt: "2026-08-29T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities: [{
        id: "G3936456", n: "Lima", lat: -12.04, lon: -77.03,
        a1: "Lima", a1c: "PE.15", p: 8472935, elev: 154,
        tz: "America/Lima", ...city,
      }],
    }, "PE");
  }

  test("keeps a well-formed admin-1 code", () => {
    expect(shardWith({}).cities[0].a1c).toBe("PE.15");
  });

  test("rejects an admin-1 code that is not <CC>.<CODE>", () => {
    // This value reaches a Map key and a polygon join. "constructor" resolving
    // to a function is the failure the shape guard exists to stop.
    expect(shardWith({ a1c: "constructor" }).cities[0].a1c).toBeNull();
    expect(shardWith({ a1c: "PE." }).cities[0].a1c).toBeNull();
    expect(shardWith({ a1c: 15 }).cities[0].a1c).toBeNull();
  });

  test("keeps a finite elevation and nulls anything else", () => {
    expect(shardWith({ elev: 3830 }).cities[0].elev).toBe(3830);
    expect(shardWith({ elev: -8 }).cities[0].elev).toBe(-8);
    expect(shardWith({ elev: null }).cities[0].elev).toBeNull();
    expect(shardWith({ elev: "154" }).cities[0].elev).toBeNull();
    expect(shardWith({ elev: Number.NaN }).cities[0].elev).toBeNull();
  });

  test("reads an older shard that has neither field", () => {
    // The committed artifact and the code deploy independently: Vercel ships
    // a build before the nightly refresh regenerates the shards. A shard
    // without these fields must parse, not throw.
    const reparsed = parseCityShard({
      country: "PE", generatedAt: "", source: "",
      cities: [{ id: "G1", n: "Lima", lat: 0, lon: 0, a1: null, p: 1, tz: "" }],
    }, "PE");
    expect(reparsed.cities[0].a1c).toBeNull();
    expect(reparsed.cities[0].elev).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run lib/cityShard.test.ts -t "Phase 4 fields"
```

Expected: FAIL — `expected undefined to be 'PE.15'`.

- [ ] **Step 3: Widen the type and the mapping**

In `lib/cityShard.ts`, extend the interface:

```ts
/** The nine-field record `scripts/ingest-cities.mjs` emits. */
export interface CityShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  /** Admin-1 name, already resolved from GeoNames' code. Null when it has none. */
  a1: string | null;
  /** The GeoNames admin-1 code the name came from, `"<CC>.<CODE>"`. */
  a1c: string | null;
  p: number;
  /** Metres. Surveyed where GeoNames has it, modelled otherwise. */
  elev: number | null;
  tz: string;
}
```

Add the guard above the parser:

```ts
/**
 * `"PE.15"`. Validated rather than trusted, because this value becomes a Map
 * key and then a polygon join: `"constructor"` must not resolve to a function,
 * and the dangling `"PE."` must not look like a key that could match.
 */
const ADMIN1_CODE = /^[A-Z]{2}\.[A-Za-z0-9]+$/;
```

And in the row mapping, beside `a1`:

```ts
      a1: typeof city.a1 === "string" && city.a1 !== "" ? city.a1 : null,
      a1c: typeof city.a1c === "string" && ADMIN1_CODE.test(city.a1c) ? city.a1c : null,
      p: city.p,
      elev: typeof city.elev === "number" && Number.isFinite(city.elev) ? city.elev : null,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run lib/cityShard.test.ts && npx tsc --noEmit
```

Expected: PASS, and `tsc` clean. If `tsc` reports errors in `shardRowToMapCity`, you have added `a1c` to `MapCity` — revert that; the spec is explicit that it stays out.

- [ ] **Step 5: Commit**

```bash
git add lib/cityShard.ts lib/cityShard.test.ts
git commit -m "feat: parse and validate a1c and elev on the shard boundary

a1c gets a shape guard because it becomes a Map key and then a polygon join.
A shard missing both fields still parses — the build and the nightly refresh
deploy independently, so old artifacts meet new code routinely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Gate the new fields in `assertSane`

`assertSane` aborts the build before writing when a run is degenerate. It counts `admin1Resolved` off `a1` only — so `a1c` could go entirely null while the existing gate stays green and the artifact silently loses the field the whole L3 join depends on.

**Files:**
- Modify: `scripts/ingest-cities.mjs:518-690` (`assertSane`)
- Test: `scripts/ingest-cities.test.ts`

**Interfaces:**
- Consumes: shards from Task 2.
- Produces: `assertSane` throws when `a1c` coverage collapses. No new export.

- [ ] **Step 1: Write the failing test**

```ts
describe("assertSane — the a1c gate", () => {
  /** 246 countries of one city each, all with a resolved admin-1 code. */
  function healthyShards() {
    const shards = new Map();
    for (let i = 0; i < 246; i++) {
      const cc = `X${String(i).padStart(2, "0")}`;
      shards.set(cc, [{
        id: `G${1000 + i}`, n: `City ${i}`, lat: 0, lon: 0,
        a1: "Region", a1c: `${cc}.01`, p: 10000, elev: 10, tz: "UTC",
      }]);
    }
    return shards;
  }

  test("throws when the admin-1 code has gone all-null", () => {
    const shards = healthyShards();
    for (const rows of shards.values()) for (const row of rows) row.a1c = null;
    // The existing admin1Resolved gate counts `a1` and would stay green here,
    // which is exactly how this field could vanish unnoticed.
    expect(() => assertSane(shards, null)).toThrow(/a1c/i);
  });

  test("does not throw when a realistic minority lack a code", () => {
    const shards = healthyShards();
    // Measured: 0.75% of committed rows have no admin-1 at all, and 19
    // countries genuinely have no subdivision to record.
    let n = 0;
    for (const rows of shards.values()) if (n++ < 12) for (const row of rows) row.a1c = null;
    expect(() => assertSane(shards, null)).not.toThrow();
  });
});
```

Add `assertSane` to the import list.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/ingest-cities.test.ts -t "a1c gate"
```

Expected: FAIL — the first test reports that no error was thrown.

- [ ] **Step 3: Add the gate**

Inside `assertSane`, beside the existing `admin1Resolved` count:

```js
  // Counted separately from `a1`, not folded into it: the name and the code
  // come from the same lookup but are emitted by different expressions, and a
  // gate on the name alone would stay green while the code went all-null —
  // silently removing the field the province join depends on.
  let admin1Coded = 0;
  let cityRows = 0;
  for (const rows of shards.values()) {
    for (const row of rows) {
      cityRows += 1;
      if (row.a1c !== null) admin1Coded += 1;
    }
  }
  // Measured 2026-08-29: 99.25% of rows carry an admin-1. The floor is set
  // well below that because 19 countries genuinely have no subdivision, not
  // because a slow decline is acceptable.
  const codedShare = cityRows === 0 ? 0 : admin1Coded / cityRows;
  if (codedShare < 0.8) {
    throw new Error(
      `a1c coverage collapsed: ${admin1Coded}/${cityRows} rows (${(codedShare * 100).toFixed(1)}%) carry an admin-1 code, expected at least 80%`
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run scripts/ingest-cities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
git commit -m "feat: abort the cities build when the admin-1 code collapses

The existing admin1Resolved gate counts a1, so a1c could go entirely null
while the build stayed green — removing the field the province join depends
on, in an artifact that auto-deploys.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Regenerate the shards and confirm the budget holds

The two new fields were measured to cost +9.7% raw across all 246 shards, taking the largest (AR) from 96,726 B to about 105,000 B against a 150,000 B cap. That was measured for `a1c` alone; **`elev`'s incremental cost is unmeasured**, so this task measures it rather than assuming.

**Files:**
- Regenerate: `public/cities/*.json` (246 files)
- Verify: `lib/cityShard.test.ts`, `data/cities-report.md`

**Interfaces:**
- Consumes: everything above.
- Produces: committed shards carrying both fields. No code interface.

- [ ] **Step 1: Run the ingest**

```bash
node scripts/ingest-cities.mjs
```

Expected: it fetches the GeoNames dump (~13 MB), writes 246 shards plus `index.json`, and prints a summary. If it aborts, the message names the failed gate — fix the cause, do not weaken the gate.

- [ ] **Step 2: Measure what actually changed**

```bash
git diff --stat public/cities | tail -3
node -e "const fs=require('fs');const d='public/cities';const f=fs.readdirSync(d).filter(n=>/^[A-Z]{2}\.json$/.test(n));const s=f.map(n=>[n,fs.statSync(d+'/'+n).size]).sort((a,b)=>b[1]-a[1]);console.log('files',f.length,'total',s.reduce((t,[,b])=>t+b,0));console.log('largest',s.slice(0,3));"
```

Expected: 246 files; largest well under 150,000 B. **Record the real total and the real largest in the commit message** — the spec's §14 lists this as unmeasured and this run is what settles it.

- [ ] **Step 3: Run the full suite**

```bash
npm test
```

Expected: PASS. Two known conditions, neither caused by this work: on a fresh Windows clone with `core.autocrlf=true`, `lib/contracts.test.ts` can fail on line endings alone (`.gitattributes` pins the generated artifacts to LF); and two node-project tests are known-flaky under load. If the shard budget test fails, **stop** — the fields cost more than measured and the spec's assumption needs revisiting, not the budget.

- [ ] **Step 4: Commit**

```bash
git add public/cities data/cities-report.md
git commit -m "chore: regenerate city shards with a1c and elev

<paste the real file count, total bytes and largest shard from step 2>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Slice B — the L2 list

### Task 6: Group and filter places, as pure functions

`CountryPlaceList` shows `places.slice(0, 60)`. For 150 of 246 countries that hides most of the shard — 690 of Peru's 750. The replacement groups by admin-1 name and filters by typed text. Both are pure functions, so they live in `lib/` where the fast node project can test them; a `.test.ts` beside the component would never run.

**Files:**
- Create: `lib/placeGrouping.ts`, `lib/placeGrouping.test.ts`

**Interfaces:**
- Consumes: `MapPlace` from `components/map/mapTypes`.
- Produces:
  - `groupPlacesByAdmin1(places: MapPlace[]): PlaceGroup[]` where `PlaceGroup = { key: string; label: string | null; places: MapPlace[] }`
  - `filterPlaces(places: MapPlace[], query: string): MapPlace[]`
  - `UNGROUPED_KEY: string`

- [ ] **Step 1: Write the failing test**

Create `lib/placeGrouping.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { MapPlace } from "../components/map/mapTypes";
import { filterPlaces, groupPlacesByAdmin1, UNGROUPED_KEY } from "./placeGrouping";

function place(name: string, province: string | null): MapPlace {
  return {
    id: `G-${name}`, name, localName: null, province,
    lat: 0, lon: 0, kind: "catalog",
  } as MapPlace;
}

describe("groupPlacesByAdmin1", () => {
  test("groups places under their province, keeping input order within a group", () => {
    const groups = groupPlacesByAdmin1([
      place("Lima", "Lima"), place("Cusco", "Cuzco"), place("Callao", "Lima"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Lima", "Cuzco"]);
    // Population order arrives from the shard and must survive grouping —
    // it is what makes the first name in each group the recognisable one.
    expect(groups[0].places.map((p) => p.name)).toEqual(["Lima", "Callao"]);
  });

  test("orders groups by their first appearance, not alphabetically", () => {
    // First appearance is population order, so the province a user is most
    // likely to want is first. Alphabetical would put Amazonas above Lima.
    const groups = groupPlacesByAdmin1([
      place("Lima", "Lima"), place("Chachapoyas", "Amazonas"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Lima", "Amazonas"]);
  });

  test("collects places with no province into one trailing group", () => {
    const groups = groupPlacesByAdmin1([
      place("Nowhere", null), place("Lima", "Lima"), place("Elsewhere", null),
    ]);
    // Last, not first: 19 countries have no admin-1 at all, and in those the
    // single group is the whole list; everywhere else it is a remainder.
    expect(groups[groups.length - 1].key).toBe(UNGROUPED_KEY);
    expect(groups[groups.length - 1].label).toBeNull();
    expect(groups[groups.length - 1].places).toHaveLength(2);
  });

  test("does not resolve a province named like an Object property", () => {
    // Grouping is keyed on a user-facing string that arrives from a data file.
    // A plain object would give "constructor" a function as its group.
    const groups = groupPlacesByAdmin1([place("Odd", "constructor")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].places).toHaveLength(1);
  });

  test("returns no groups for no places", () => {
    expect(groupPlacesByAdmin1([])).toEqual([]);
  });
});

describe("filterPlaces", () => {
  const places = [place("Lima", "Lima"), place("Cusco", "Cuzco"), place("Callao", "Lima")];

  test("returns everything for an empty or whitespace query", () => {
    expect(filterPlaces(places, "")).toHaveLength(3);
    expect(filterPlaces(places, "   ")).toHaveLength(3);
  });

  test("matches a city name case-insensitively, anywhere in the string", () => {
    expect(filterPlaces(places, "cus").map((p) => p.name)).toEqual(["Cusco"]);
    expect(filterPlaces(places, "LA").map((p) => p.name)).toEqual(["Callao"]);
  });

  test("matches the province too, so typing a region narrows to it", () => {
    expect(filterPlaces(places, "cuzco").map((p) => p.name)).toEqual(["Cusco"]);
  });

  test("ignores accents in both the query and the name", () => {
    // The shard carries endonyms: a user typing "Nuremberg" must reach
    // "Nürnberg", and a user typing "Zurich" must reach "Zürich".
    const zurich = [place("Zürich", "Zürich")];
    expect(filterPlaces(zurich, "zurich")).toHaveLength(1);
    expect(filterPlaces(zurich, "ZÜRICH")).toHaveLength(1);
  });

  test("returns nothing when nothing matches", () => {
    expect(filterPlaces(places, "zzz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run lib/placeGrouping.test.ts
```

Expected: FAIL — `Failed to resolve import "./placeGrouping"`.

- [ ] **Step 3: Write the implementation**

Create `lib/placeGrouping.ts`:

```ts
import type { MapPlace } from "../components/map/mapTypes";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Grouping and filtering for the country place list.
 *
 * Pure, and in `lib/` rather than beside the component, for two reasons: the
 * node project runs it without a DOM, and a `.test.ts` under `components/`
 * matches no vitest project and would never run at all.
 */

/** The group holding places whose country records no admin-1 for them. */
export const UNGROUPED_KEY = " ungrouped";

export interface PlaceGroup {
  key: string;
  /** The province name, or null for the ungrouped remainder. */
  label: string | null;
  places: MapPlace[];
}

/**
 * Places by admin-1, in first-appearance order.
 *
 * `places` arrives in population order from the shard, so first appearance
 * puts the province a user is most likely to want at the top and keeps the
 * recognisable city first inside it. Alphabetical would open Peru on
 * Amazonas.
 */
export function groupPlacesByAdmin1(places: MapPlace[]): PlaceGroup[] {
  // A Map, not an object: the key is a province name from a data file, and
  // `"constructor"` on a plain object resolves to a function.
  const byKey = new Map<string, PlaceGroup>();
  for (const place of places) {
    const label = place.province && place.province !== "" ? place.province : null;
    const key = label ?? UNGROUPED_KEY;
    const group = byKey.get(key);
    if (group) group.places.push(place);
    else byKey.set(key, { key, label, places: [place] });
  }
  const groups = [...byKey.values()];
  // The remainder goes last. In the 19 countries with no admin-1 at all it is
  // the only group, so this is a no-op there rather than a special case.
  const ungrouped = groups.findIndex((g) => g.key === UNGROUPED_KEY);
  if (ungrouped >= 0 && ungrouped < groups.length - 1) {
    groups.push(...groups.splice(ungrouped, 1));
  }
  return groups;
}

/**
 * Places whose name or province matches `query`.
 *
 * `foldPlaceName` strips accents and case on both sides, because the shard
 * carries endonyms — a user typing "Zurich" must reach "Zürich".
 */
export function filterPlaces(places: MapPlace[], query: string): MapPlace[] {
  const needle = foldPlaceName(query.trim());
  if (needle === "") return places;
  return places.filter((place) => {
    if (foldPlaceName(place.name).includes(needle)) return true;
    return place.province ? foldPlaceName(place.province).includes(needle) : false;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run lib/placeGrouping.test.ts && npx tsc --noEmit
```

Expected: PASS and clean. If `foldPlaceName`'s import path or signature differs, open `lib/foldPlaceName.ts` and match it — do not write a second folding function.

- [ ] **Step 5: Commit**

```bash
git add lib/placeGrouping.ts lib/placeGrouping.test.ts
git commit -m "feat: group and filter country places by admin-1

Pure functions in lib/ because a .test.ts under components/ matches no vitest
project and would never run. Grouped in first-appearance order, which is
population order from the shard — alphabetical would open Peru on Amazonas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Rebuild `CountryPlaceList` around the groups

This is the task that deletes `MAX_LIST_PLACES` and its test. The replacement caps *per group* rather than globally and shows a per-group "show all", so no city is unreachable.

**Files:**
- Modify: `components/map/CountryMap.tsx:48` (delete `MAX_LIST_PLACES`), `:114-179` (`CountryPlaceList`)
- Test: `components/map/CountryMap.test.tsx:230-247` (replace the cap test)

**Interfaces:**
- Consumes: `groupPlacesByAdmin1`, `filterPlaces`, `UNGROUPED_KEY` from Task 6.
- Produces: no new exports. `CountryPlaceList`'s props are unchanged.

- [ ] **Step 1: Write the failing test**

In `components/map/CountryMap.test.tsx`, **replace** the `"caps the chip list and says how many more there are"` test with:

```ts
  test("groups a full shard by province and reaches every city", () => {
    // Before this, the list rendered places.slice(0, 60) — which for 150 of
    // 246 countries hid most of the shard, 690 of Peru's 750 among them.
    const many = Array.from({ length: 200 }, (_, i) =>
      place({
        id: `G${1000 + i}`, name: `City ${i}`, kind: "catalog",
        province: i < 120 ? "Lima" : "Cuzco",
      })
    );
    renderMap({ country: "PE", topology: null, places: many });

    expect(screen.getByRole("group", { name: "Lima" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Cuzco" })).toBeInTheDocument();

    // Every city is reachable — collapsed groups expand, they do not truncate.
    for (const button of screen.getAllByRole("button", { name: /^Show all/ })) {
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: "City 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "City 199" })).toBeInTheDocument();
    expect(screen.queryByText(/more in Peru/)).not.toBeInTheDocument();
  });

  test("filtering narrows to matching cities across every group", () => {
    const places = [
      place({ id: "G1", name: "Lima", kind: "catalog", province: "Lima" }),
      place({ id: "G2", name: "Cusco", kind: "catalog", province: "Cuzco" }),
    ];
    renderMap({ country: "PE", topology: null, places });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cus" } });

    expect(screen.getByRole("button", { name: "Cusco" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lima" })).not.toBeInTheDocument();
  });

  test("says so when a filter matches nothing, rather than rendering blank", () => {
    renderMap({
      country: "PE", topology: null,
      places: [place({ id: "G1", name: "Lima", kind: "catalog", province: "Lima" })],
    });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(screen.getByText(/No places in Peru match/)).toBeInTheDocument();
  });
```

Confirm the local `place()` helper in this file accepts `province`; if it does not, add it with a `province: null` default.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run components/map/CountryMap.test.tsx
```

Expected: FAIL — `Unable to find role="group"` and `role="searchbox"`.

- [ ] **Step 3: Rewrite the component**

In `components/map/CountryMap.tsx`, delete `const MAX_LIST_PLACES = 60;` at line 48 and replace the whole `CountryPlaceList` function:

```tsx
/** Chips shown per province before the group offers to expand. */
const PLACES_PER_GROUP = 12;

function CountryPlaceList({
  country,
  places,
  selected,
  onTogglePlace,
}: {
  country: string;
  places: MapPlace[];
  selected: string[];
  onTogglePlace: (place: MapPlace) => void;
}) {
  const { name, code } = getCountry(country);
  const label = name || code || "this country";
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const matched = useMemo(() => filterPlaces(places, query), [places, query]);
  const groups = useMemo(() => groupPlacesByAdmin1(matched), [matched]);
  // A filter is a deliberate narrowing, so it expands everything it matched —
  // asking a user to expand a group they just searched into is a second step
  // for a decision they already made.
  const filtering = query.trim() !== "";

  return (
    <div className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--surf-1)]/50 p-5">
      <h4 className="font-display text-base font-bold">{label}</h4>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        {places.length > 0
          ? `Tap a place to add it, or filter to find one by name.`
          : `No map for ${label} yet — search above to add places, and they'll show up in your plan the same way.`}
      </p>

      {places.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={`Filter places in ${label}`}
          placeholder={`Filter ${places.length} places`}
          className="mt-3 min-h-[var(--tap-min)] w-full rounded-full border border-[var(--line-1)] bg-[var(--paper)] px-4 text-sm text-[var(--ink-1)] placeholder:text-[var(--ink-2)]"
        />
      )}

      {groups.map((group) => {
        const open = filtering || expanded.has(group.key);
        const shown = open ? group.places : group.places.slice(0, PLACES_PER_GROUP);
        const hidden = group.places.length - shown.length;
        const groupLabel = group.label ?? `Elsewhere in ${label}`;
        return (
          <section key={group.key} aria-label={groupLabel} role="group" className="mt-4">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-2)]">
              {groupLabel}
            </h5>
            <ul className="mt-2 flex flex-wrap gap-2">
              {shown.map((place) => {
                const isSelected = selected.includes(place.id);
                return (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => onTogglePlace(place)}
                      aria-pressed={isSelected}
                      className={`min-h-[var(--tap-min)] rounded-full border px-3.5 text-sm transition-colors ${
                        isSelected
                          ? "border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--paper)]"
                          : "border-[var(--line-1)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
                      }`}
                    >
                      {place.name}
                      {place.localName && (
                        <span className="ml-1.5 font-kai opacity-80">{place.localName}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => new Set(prev).add(group.key))
                }
                className="mt-2 min-h-[var(--tap-min)] text-xs font-semibold text-[var(--accent-ink)] underline"
              >
                {`Show all ${group.places.length} in ${groupLabel}`}
              </button>
            )}
          </section>
        );
      })}

      {places.length > 0 && groups.length === 0 && (
        <p className="mt-3 text-sm text-[var(--ink-2)]">
          {`No places in ${label} match "${query.trim()}".`}
        </p>
      )}
    </div>
  );
}
```

Add the imports at the top of the file:

```tsx
import { useMemo, useState } from "react";
import { filterPlaces, groupPlacesByAdmin1 } from "../../lib/placeGrouping";
```

(If `useMemo`/`useState` are already imported, extend the existing import rather than adding a second.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run components/map/CountryMap.test.tsx && npx tsc --noEmit
```

Expected: PASS. If `MapPlace` has no `province` field, stop and check `components/map/mapTypes.ts` — `shardRowToMapCity` sets `province: row.a1`, so it should exist on the `MapCity` path; confirm the `MapPlace` union carries it before working around it.

- [ ] **Step 5: Run the whole suite, since this deletes a pinned behaviour**

```bash
npm test
```

Expected: PASS. `MapExplorer.test.tsx` may assert on the old copy ("140 more in Peru") — update those assertions to the new grouped output; do not restore the cap.

- [ ] **Step 6: Commit**

```bash
git add components/map/CountryMap.tsx components/map/CountryMap.test.tsx
git commit -m "feat: group the country place list by province and make it filterable

Replaces places.slice(0, 60), which hid most of the shard for 150 of 246
countries — 690 of Peru's 750 cities among them. Groups cap per province and
expand rather than truncate, so every city in an open country is reachable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Pin the reachability criterion so it cannot regress

The spec's §12.2 makes this the acceptance criterion for all of Phase 4: *every city in an open country is reachable by keyboard and by search, and no interactive marker is smaller than `--tap-min`*. Nothing in CI checks it today — there is no `next build`, no axe pass, no coverage provider. Written now, it is what stops a later geometry PR from replacing the list with 4px inert dots.

**Files:**
- Test: `components/map/CountryMap.test.tsx`

**Interfaces:**
- Consumes: the component from Task 7.
- Produces: nothing. This task is only a test.

- [ ] **Step 1: Write the test**

```ts
describe("reachability — the Phase 4 acceptance criterion", () => {
  /**
   * Spec §12.2. This is the criterion the whole phase is gated on: a country
   * level that renders geometry must not become the ONLY way to select a
   * place. The repo already rejected per-marker tab stops once — see
   * worldLevelShared.tsx's "indefensible for 235" — and this test is what
   * makes that decision survive a later PR that adds an outline.
   */
  test("every place in an open country is reachable by keyboard", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      place({
        id: `G${1000 + i}`, name: `City ${i}`, kind: "catalog",
        province: i < 120 ? "Lima" : "Cuzco",
      })
    );
    renderMap({ country: "PE", topology: null, places: many });

    for (const button of screen.getAllByRole("button", { name: /^Show all/ })) {
      fireEvent.click(button);
    }

    const reachable = screen
      .getAllByRole("button")
      .filter((el) => !el.getAttribute("tabindex") || el.getAttribute("tabindex") !== "-1");
    // 200 chips plus no remaining "Show all" controls.
    expect(reachable.filter((el) => /^City \d+$/.test(el.textContent ?? ""))).toHaveLength(200);
  });

  test("every place is reachable by filtering, without expanding anything", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      place({
        id: `G${1000 + i}`, name: `City ${i}`, kind: "catalog",
        province: i < 120 ? "Lima" : "Cuzco",
      })
    );
    renderMap({ country: "PE", topology: null, places: many });

    // City 199 is past every per-group cap and is not rendered initially.
    expect(screen.queryByRole("button", { name: "City 199" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "City 199" } });
    expect(screen.getByRole("button", { name: "City 199" })).toBeInTheDocument();
  });

  test("no interactive control opts out of the minimum tap target", () => {
    renderMap({
      country: "PE", topology: null,
      places: [place({ id: "G1", name: "Lima", kind: "catalog", province: "Lima" })],
    });

    // jsdom computes no layout, so this asserts the class contract rather
    // than a measured box — which is what the codebase can actually check,
    // and it still catches a control shipped without the token.
    for (const el of [...screen.getAllByRole("button"), screen.getByRole("searchbox")]) {
      expect(el.className).toContain("min-h-[var(--tap-min)]");
    }
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run components/map/CountryMap.test.tsx -t "acceptance criterion"
```

Expected: PASS — Task 7 already satisfies all three. If any fails, the defect is in Task 7's component, not in this test.

- [ ] **Step 3: Commit**

```bash
git add components/map/CountryMap.test.tsx
git commit -m "test: pin the Phase 4 reachability acceptance criterion

Spec 12.2. Nothing in CI checks keyboard reachability or tap targets — there
is no next build, no axe pass, no coverage provider — so this test is what
stops a later geometry PR from replacing the list with 4px inert dots.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## The rest of the series

Plan 1 covers spec §11 and §5.2/§12.2. The remaining seven PRs each get their own plan, written when the one before it lands — the convention this repo already follows, and here it is forced: **§14 lists ten items no measurement settled, and five of them are values PR3's tasks would need in their expected output.** Writing those tasks now would mean inventing numbers, which is the exact failure this spec was written to correct.

| Plan | Covers | Cannot be written until |
|---|---|---|
| 2 | PR3 — `build-provinces.mjs`, 246 province files, projection manifest | — ready now; its first task is the build run that settles §14.1–14.5 |
| 3 | PR4 — L2 map, registry, markers, selected-place card | Plan 2's build run reports whether merged admin-1 tiles each country (§14.4) |
| 4 | PR5 — L3 level, province zoom, China regions as grouping | PR4 |
| 5 | PR6 — climate ingest and the four fit-model fixes | Task 5 above (needs `elev` committed) |
| 6 | PR7 — climate in the UI | Plans 4 and 5 |
| 7 | PR8 — airport map layer | PR4 |
| 8 | PR9 — trip gateways | PR8 |

**Plan 2 is the natural next one**, and its first task is not code: it is running the slicing build and committing `data/provinces-report.md`, because five of the numbers its later tasks assert do not exist yet.

---

## Self-review

**Spec coverage.** §11 (ingest) → Tasks 1–5. §5.2 (list as spine, `a1` grouping, filter, no 60-cap) → Tasks 6–7. §12.2 (acceptance criterion) → Task 8. §12.1 (test placement) → honoured: pure logic in `lib/placeGrouping.ts`, jsdom tests in `.test.tsx`. Everything else in the spec belongs to plans 2–8 and is mapped in the table above. **One gap found and closed while reviewing:** the spec's §11 lists `assertSane` as a forced follow-on but does not say what the gate should be — Task 4 sets it at 80% against a measured 99.25%, with the reason for the gap written into the code comment.

**Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Every code step carries the real code. Two places name a condition to check rather than an outcome to assume — Task 5 step 2 records real byte counts instead of asserting the predicted ones, and Task 7 step 4 says to verify `MapPlace.province` exists rather than assuming. Both are deliberate: they are the points where the spec's own numbers were unmeasured.

**Type consistency.** `CityShardRow` gains exactly `a1c: string | null` and `elev: number | null` in Task 3, and Tasks 2, 4 and 5 use those names. `MapCity` is not widened, consistent with the spec. `groupPlacesByAdmin1` / `filterPlaces` / `UNGROUPED_KEY` / `PlaceGroup` are defined in Task 6 and consumed under those exact names in Task 7. `PLACES_PER_GROUP` replaces `MAX_LIST_PLACES` and the old constant is deleted, not shadowed.
