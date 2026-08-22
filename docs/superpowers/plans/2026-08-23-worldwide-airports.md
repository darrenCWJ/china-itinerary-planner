# Worldwide Airports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the planner every scheduled-service airport on Earth, refreshed daily, and use them to replace the route estimator's haversine guesses with real airport-pair estimates.

**Architecture:** A committed JSON artifact (`data/airports.json`) built by a rerunnable ingest script from OurAirports' nightly public-domain CSV, refreshed by a daily GitHub Action that commits only on change. Pure query functions live in `lib/airports.ts` and take an airport array as a parameter, so they are client-safe and node-testable; `lib/server/airports.ts` binds them to the bundled artifact. The route estimator gains an optional airports parameter — omitted, it behaves exactly as today.

**Tech Stack:** TypeScript 7, Next.js 16 App Router, React 19, Vitest 4, plain Node scripts (no new dependencies).

## Global Constraints

- **No new npm dependencies.** Everything here uses Node built-ins and what is already installed.
- **Source:** `https://davidmegginson.github.io/ourairports-data/airports.csv` — public domain, regenerated nightly. Record the licence in the artifact and report.
- **Filter:** `scheduled_service === "yes" && iata_code !== ""` → expect ~4,134 airports across ~234 countries.
- **`data/airports.json` is committed**, exactly like `data/catalog.json` and `public/china-provinces.json`.
- **Test file placement is load-bearing.** The node project includes `lib/**/*.test.ts`; the jsdom project includes `components/**/*.test.tsx` and `lib/**/*.test.tsx`. **A `.test.ts` under `components/` matches neither and silently never runs.** Pure logic tests go in `lib/`.
- **No hex colour literals in components.** Use the CSS custom properties (`var(--ink-2)`, `var(--line-1)`, …) as surrounding code does.
- **Existing behaviour must not change** where airports are not supplied. Every current test in `lib/route.test.ts` must pass unmodified.
- Run the full suite with `npm test` before every commit.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `scripts/ingest-airports.mjs` | Fetch, parse, filter, sanity-check, write the artifact + report |
| `data/airports.json` | The committed artifact — `{ generatedAt, source, airports }` |
| `data/airports-report.md` | Human-readable ingest summary |
| `.github/workflows/refresh-airports.yml` | Daily cron; commits only on change |
| `lib/airports.ts` | Pure query layer — takes an airport array, returns answers. No I/O. |
| `lib/airports.test.ts` | Node-project tests for the above |
| `lib/server/airports.ts` | Binds the pure layer to the bundled artifact. Server-only. |
| `lib/server/airports.test.ts` | Drift guards against the real artifact |
| `app/api/airports/search/route.ts` | Autocomplete endpoint |
| `app/api/map/airports/route.ts` | Country-scoped airports for the map/route estimator |
| `components/trip/AirportInput.tsx` | Debounced airport autocomplete input |
| `components/trip/AirportInput.test.tsx` | jsdom-project tests |

**Modified:**

| File | Change |
|---|---|
| `lib/route.ts` | Optional `airports` parameter on `estimateLeg`/`suggestRoute`; new `TRANSPORT` fields |
| `lib/route.test.ts` | New tests appended; existing tests untouched |
| `components/trip/TicketsTab.tsx` | From/To become `AirportInput` for flight tickets |
| `components/map/MapExplorer.tsx` | Fetch country airports; pass to `suggestRoute`; render the airport pair |

**Deviation from the spec:** §3.7 listed three PRs. This plan uses four — the route-estimator *maths* (PR 1.2) is separated from *wiring it into the map* (PR 1.4), because a reviewer can meaningfully accept the arithmetic while rejecting the UI, and PR 1.2 is the highest-risk change in the phase.

---

## Task 1: Ingest script and artifact

**Files:**
- Create: `scripts/ingest-airports.mjs`
- Create (generated): `data/airports.json`, `data/airports-report.md`

**Interfaces:**
- Consumes: nothing
- Produces: `data/airports.json` shaped `{ generatedAt: string, source: string, airports: Airport[] }` where each airport is `{ iata, icao, name, municipality, country, lat, lon, size }` and `size` is `"large" | "medium" | "small"`.

- [ ] **Step 1: Write the script**

Create `scripts/ingest-airports.mjs`:

```js
#!/usr/bin/env node
/**
 * ingest-airports.mjs
 *
 * Builds data/airports.json (+ data/airports-report.md) from the OurAirports
 * nightly CSV: every airport with scheduled service and an IATA code.
 *
 * "International airport" is not a field OurAirports carries, and every
 * substitute is worse — `large_airport` alone drops regional airports people
 * genuinely fly to, and matching "International" in the name is
 * language-dependent. Scheduled service plus an IATA code means "an airport you
 * can buy a ticket to", which is the operative meaning for a trip planner.
 *
 * Rerunnable and idempotent: when the airport set is unchanged the previous
 * `generatedAt` is preserved, so the file is byte-identical and the daily
 * workflow has nothing to commit.
 *
 * Unlike ingest-destinations.mjs, which writes its outputs even when sanity
 * checks fail so they can be inspected, this script ABORTS before writing. A
 * corrupt airport list is not useful for inspection and would be committed and
 * deployed automatically by the workflow.
 *
 * Usage: node scripts/ingest-airports.mjs
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const AIRPORTS_PATH = join(DATA_DIR, 'airports.json');
const REPORT_PATH = join(DATA_DIR, 'airports-report.md');

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const SOURCE_LICENSE = 'Public domain (OurAirports, regenerated nightly)';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

const FETCH_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

/** Columns the build reads. A missing one aborts rather than yielding nulls. */
const REQUIRED_COLUMNS = [
  'type', 'name', 'latitude_deg', 'longitude_deg', 'iso_country',
  'municipality', 'scheduled_service', 'icao_code', 'iata_code',
];

/** Floor and shrink limit. Measured 2026-08-23: 4,134 passed the filter. */
const MIN_EXPECTED_AIRPORTS = 3_500;
const MAX_SHRINK_RATIO = 0.10;

const SIZE_BY_TYPE = {
  large_airport: 'large',
  medium_airport: 'medium',
  small_airport: 'small',
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Character-scanning CSV parser. Splitting on newlines first would be wrong:
 * OurAirports quotes free-text columns that can contain both commas and
 * newlines, and doubles embedded quotes ("" for a literal ").
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { cell += ch; continue; }
      if (text[i + 1] === '"') { cell += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  // A file with no trailing newline still has one row left in hand.
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCsv() {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(SOURCE_URL, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms (${error.message})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to fetch ${SOURCE_URL}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildAirports(rows) {
  const header = rows[0];
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(`upstream CSV is missing column(s): ${missing.join(', ')} — aborting rather than writing nulls`);
  }
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const airports = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length <= 1) continue; // trailing blank line
    const get = (name) => (row[index[name]] ?? '').trim();
    if (get('scheduled_service') !== 'yes') continue;
    const iata = get('iata_code').toUpperCase();
    if (iata.length !== 3) continue;
    const lat = Number(get('latitude_deg'));
    const lon = Number(get('longitude_deg'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    airports.push({
      iata,
      icao: get('icao_code').toUpperCase() || null,
      name: get('name'),
      municipality: get('municipality') || null,
      country: get('iso_country').toUpperCase(),
      lat,
      lon,
      size: SIZE_BY_TYPE[get('type')] ?? 'small',
    });
  }
  // Sorted by IATA so the artifact is stable across runs and a diff is readable.
  airports.sort((a, b) => a.iata.localeCompare(b.iata));
  return airports;
}

export function assertSane(airports, previous) {
  if (airports.length < MIN_EXPECTED_AIRPORTS) {
    throw new Error(`only ${airports.length} airports passed the filter, expected at least ${MIN_EXPECTED_AIRPORTS}`);
  }
  const seen = new Set();
  for (const a of airports) {
    if (seen.has(a.iata)) throw new Error(`duplicate IATA code ${a.iata}`);
    seen.add(a.iata);
  }
  const before = previous?.airports?.length ?? 0;
  if (before > 0) {
    const shrink = (before - airports.length) / before;
    if (shrink > MAX_SHRINK_RATIO) {
      throw new Error(
        `airport count fell ${(shrink * 100).toFixed(1)}% (${before} → ${airports.length}), ` +
        `over the ${MAX_SHRINK_RATIO * 100}% limit — upstream may be mid-rebuild`
      );
    }
  }
}

function writeFileAtomic(path, content) {
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    rmSync(path, { force: true }); // Windows rename does not overwrite reliably
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function readPrevious() {
  if (!existsSync(AIRPORTS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(AIRPORTS_PATH, 'utf8'));
  } catch {
    return null; // unreadable previous artifact is the same as none
  }
}

function buildReport(airports, generatedAt, unchanged) {
  const byCountry = new Map();
  const bySize = { large: 0, medium: 0, small: 0 };
  for (const a of airports) {
    byCountry.set(a.country, (byCountry.get(a.country) ?? 0) + 1);
    bySize[a.size]++;
  }
  const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  return [
    '# Airports catalog report',
    '',
    `- Generated: ${generatedAt}${unchanged ? ' (unchanged — preserved from the previous run)' : ''}`,
    `- Source: ${SOURCE_URL}`,
    `- Licence: ${SOURCE_LICENSE}`,
    `- Filter: scheduled_service = yes AND iata_code present`,
    '',
    `**${airports.length} airports across ${byCountry.size} countries.**`,
    '',
    `By size: ${bySize.large} large, ${bySize.medium} medium, ${bySize.small} small.`,
    '',
    '## Most airports by country',
    '',
    '| Country | Airports |',
    '| --- | --- |',
    ...top.map(([code, n]) => `| ${code} | ${n} |`),
    '',
  ].join('\n');
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`Fetching ${SOURCE_URL} …`);
  const csv = await fetchCsv();
  const rows = parseCsv(csv);
  console.log(`  parsed ${rows.length - 1} rows`);

  const airports = buildAirports(rows);
  const previous = readPrevious();
  assertSane(airports, previous);

  // Idempotency lives here, not in the workflow: preserving the timestamp when
  // nothing changed makes the file byte-identical, so `git diff` is empty and
  // the daily job commits nothing.
  const unchanged =
    previous !== null && JSON.stringify(previous.airports) === JSON.stringify(airports);
  const generatedAt = unchanged ? previous.generatedAt : new Date().toISOString();

  writeFileAtomic(
    AIRPORTS_PATH,
    JSON.stringify({ generatedAt, source: SOURCE_LICENSE, airports }, null, 1)
  );
  writeFileAtomic(REPORT_PATH, buildReport(airports, generatedAt, unchanged));

  console.log(`Wrote ${AIRPORTS_PATH} (${airports.length} airports)${unchanged ? ' — unchanged' : ''}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(`\nAirport ingestion failed: ${error.message}`);
  console.error('Nothing was written — the previous artifact is untouched.');
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

```bash
node scripts/ingest-airports.mjs
```

Expected: `parsed 85###` rows, then `Wrote …/data/airports.json (4134 airports)`. The exact count may drift by a few either way as upstream changes; anything near 4,100 is correct. A count under 3,500 aborts by design.

- [ ] **Step 3: Verify the artifact by hand**

```bash
node -e "const a=require('./data/airports.json');const m=new Map(a.airports.map(x=>[x.iata,x]));console.log('count',a.airports.length,'| countries',new Set(a.airports.map(x=>x.country)).size);console.log(JSON.stringify(m.get('TNA')));['PEK','LHR','JFK','SIN'].forEach(c=>console.log(c,!!m.get(c)))"
```

Expected: count ~4134, countries ~234, TNA prints as Jinan Yaoqiang International Airport in CN, and all four spot-check codes print `true`.

- [ ] **Step 4: Verify idempotency**

```bash
node scripts/ingest-airports.mjs && git diff --stat data/airports.json
```

Expected: the second run prints `— unchanged` and `git diff --stat` outputs **nothing**. This is the property the daily workflow depends on; if the diff is non-empty, the `generatedAt` preservation is broken and must be fixed before continuing.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingest-airports.mjs data/airports.json data/airports-report.md
git commit -m "feat: ingest worldwide scheduled-service airports from OurAirports"
```

---

## Task 2: Pure query layer — lookup and search

**Files:**
- Create: `lib/airports.ts`
- Test: `lib/airports.test.ts`

**Interfaces:**
- Consumes: `foldPlaceName` from `lib/foldPlaceName`, `haversineKm`/`LatLon` from `lib/geo`, `CountryCode` from `lib/countries`
- Produces: `Airport`, `AirportSize`, `findAirport(airports, iata)`, `searchAirports(airports, query, limit?)`

- [ ] **Step 1: Write the failing test**

Create `lib/airports.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { findAirport, searchAirports, type Airport } from "./airports";

/** A small hand-built set — real coordinates, so distance tests stay honest. */
export const FIXTURE: Airport[] = [
  { iata: "TNA", icao: "ZSJN", name: "Jinan Yaoqiang International Airport", municipality: "Jinan", country: "CN", lat: 36.857, lon: 117.216, size: "large" },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
  { iata: "LHR", icao: "EGLL", name: "London Heathrow Airport", municipality: "London", country: "GB", lat: 51.4706, lon: -0.461941, size: "large" },
  { iata: "LCY", icao: "EGLC", name: "London City Airport", municipality: "London", country: "GB", lat: 51.5053, lon: 0.055278, size: "medium" },
  { iata: "LGW", icao: "EGKK", name: "London Gatwick Airport", municipality: "London", country: "GB", lat: 51.1481, lon: -0.190278, size: "large" },
  { iata: "ZRH", icao: "LSZH", name: "Zürich Airport", municipality: "Zurich", country: "CH", lat: 47.4647, lon: 8.54917, size: "large" },
];

describe("findAirport", () => {
  test("finds an airport by its IATA code, case-insensitively", () => {
    expect(findAirport(FIXTURE, "tna")?.name).toBe("Jinan Yaoqiang International Airport");
  });

  test("returns null for a code that is not three letters", () => {
    expect(findAirport(FIXTURE, "TN")).toBeNull();
    expect(findAirport(FIXTURE, "")).toBeNull();
  });

  test("returns null for an unknown code", () => {
    expect(findAirport(FIXTURE, "XXX")).toBeNull();
  });
});

describe("searchAirports", () => {
  test("an exact IATA match outranks any name match", () => {
    // "LGW" is also a substring of nothing else, but the point is the ordering
    // rule: a code typed in full is the most specific thing a user can say.
    expect(searchAirports(FIXTURE, "LGW")[0].iata).toBe("LGW");
  });

  test("matches on municipality and returns every airport serving it", () => {
    const codes = searchAirports(FIXTURE, "London").map((a) => a.iata);
    expect(codes).toContain("LHR");
    expect(codes).toContain("LCY");
    expect(codes).toContain("LGW");
  });

  test("folds diacritics so 'zurich' finds 'Zürich'", () => {
    expect(searchAirports(FIXTURE, "zurich")[0].iata).toBe("ZRH");
  });

  test("prefixes outrank substrings", () => {
    // "Capital" is a substring of Beijing's name; "Jinan" is a prefix of
    // Jinan's. The prefix match must come first.
    const codes = searchAirports(FIXTURE, "Jinan").map((a) => a.iata);
    expect(codes[0]).toBe("TNA");
  });

  test("larger airports come first within the same score", () => {
    const codes = searchAirports(FIXTURE, "London").map((a) => a.iata);
    // LCY is the only medium among the three, so it must not lead.
    expect(codes[0]).not.toBe("LCY");
  });

  test("an empty query returns nothing", () => {
    expect(searchAirports(FIXTURE, "   ")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(searchAirports(FIXTURE, "London", 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/airports.test.ts
```

Expected: FAIL — `Failed to resolve import "./airports"`.

- [ ] **Step 3: Write the implementation**

Create `lib/airports.ts`:

```ts
import type { CountryCode } from "./countries";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Query layer over the worldwide airport set (spec §3).
 *
 * Every function takes the airport array as a parameter rather than importing
 * the artifact. That is what keeps this module client-safe: `lib/route.ts`
 * imports it and `lib/route.ts` runs in the browser inside `MapExplorer`, so a
 * bundled 557KB JSON here would ship to every visitor. `lib/server/airports.ts`
 * binds these to the real artifact on the server.
 *
 * A linear scan over ~4,100 entries is microseconds, so there is no index and
 * no precomputed city-to-airport table — which also means these work for any
 * coordinate, including a hand-typed place that is in no dataset.
 */

export type AirportSize = "large" | "medium" | "small";

export interface Airport {
  /** Three-letter IATA code. Unique across the filtered set — the primary key. */
  iata: string;
  icao: string | null;
  name: string;
  /** The city the airport serves, as the source names it. */
  municipality: string | null;
  country: CountryCode;
  lat: number;
  lon: number;
  size: AirportSize;
}

/** Sort weight for search results at equal score — bigger airports first. */
const SIZE_RANK: Record<AirportSize, number> = { large: 0, medium: 1, small: 2 };

export function findAirport(airports: readonly Airport[], iata: string): Airport | null {
  const code = iata.trim().toUpperCase();
  if (code.length !== 3) return null;
  return airports.find((a) => a.iata === code) ?? null;
}

/**
 * Ranked search over IATA code, airport name and municipality.
 *
 * Scores mirror `searchCities` in lib/server/catalog.ts — exact 3, prefix 2,
 * substring 1 — so the two search surfaces in the app behave alike. Names fold
 * through `foldPlaceName`, so "zurich" finds "Zürich" and "xian" finds "Xi'an".
 */
export function searchAirports(
  airports: readonly Airport[],
  query: string,
  limit = 12
): Airport[] {
  const raw = query.trim();
  if (raw.length < 1) return [];
  const code = raw.toUpperCase();
  const q = foldPlaceName(raw);

  const scored: Array<{ airport: Airport; score: number }> = [];
  for (const airport of airports) {
    let score = -1;
    if (airport.iata === code) {
      score = 3;
    } else {
      const name = foldPlaceName(airport.name);
      const city = foldPlaceName(airport.municipality ?? "");
      if (name.startsWith(q) || city.startsWith(q)) score = 2;
      else if (name.includes(q) || city.includes(q)) score = 1;
    }
    if (score > 0) scored.push({ airport, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      SIZE_RANK[a.airport.size] - SIZE_RANK[b.airport.size] ||
      a.airport.iata.localeCompare(b.airport.iata)
  );
  return scored.slice(0, limit).map((s) => s.airport);
}
```

`nearestAirports` is deliberately **not** in this task — it lands in Task 3, so
that its tests get a real red phase. The `LatLon` import is unused until then;
add it in Task 3 rather than here, or the linter will flag it.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run lib/airports.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/airports.ts lib/airports.test.ts
git commit -m "feat: add pure airport lookup and search"
```

---

## Task 3: Nearest-airport ranking

**Files:**
- Modify: `lib/airports.ts` (add `nearestAirports` and its constants)
- Modify: `lib/airports.test.ts` (append)

The ranking rule here is the subtle part of this layer, so it gets its own red-green cycle and its own review gate rather than riding along with lookup and search.

**Interfaces:**
- Consumes: `Airport`, `AirportSize` from Task 2; `haversineKm`, `LatLon` from `lib/geo`
- Produces: `RankedAirport`, `DEFAULT_AIRPORT_RADIUS_KM`, `nearestAirports(airports, at, { radiusKm?, limit? })`

- [ ] **Step 1: Write the failing test**

Append to `lib/airports.test.ts`:

```ts
import { nearestAirports, DEFAULT_AIRPORT_RADIUS_KM } from "./airports";

describe("nearestAirports", () => {
  const london = { lat: 51.507, lon: -0.128 };
  const jinan = { lat: 36.667, lon: 116.983 };

  test("returns every airport serving a multi-airport city, nearest-ish first", () => {
    const codes = nearestAirports(FIXTURE, london).map((r) => r.airport.iata);
    expect(codes).toEqual(expect.arrayContaining(["LHR", "LCY", "LGW"]));
  });

  test("prefers a large airport over a marginally closer medium one", () => {
    // LCY is ~13km from central London and LHR ~23km. Straight distance would
    // make London City "the" London airport, which is wrong for a trip planner.
    const codes = nearestAirports(FIXTURE, london).map((r) => r.airport.iata);
    expect(codes[0]).toBe("LHR");
  });

  test("reports true distance, not the size-adjusted ranking score", () => {
    const lhr = nearestAirports(FIXTURE, london).find((r) => r.airport.iata === "LHR");
    // ~23km from central London; the 15km size bonus must not leak into `km`.
    expect(lhr?.km).toBeGreaterThan(18);
    expect(lhr?.km).toBeLessThan(30);
  });

  test("returns an empty list when nothing is in range", () => {
    // Point Nemo — the most remote place in the ocean.
    expect(nearestAirports(FIXTURE, { lat: -48.876, lon: -123.393 })).toEqual([]);
  });

  test("honours a tightened radius", () => {
    // Jinan's own airport is ~30km out, so a 10km radius must find nothing.
    expect(nearestAirports(FIXTURE, jinan, { radiusKm: 10 })).toEqual([]);
    expect(nearestAirports(FIXTURE, jinan, { radiusKm: 60 })[0].airport.iata).toBe("TNA");
  });

  test("honours the limit", () => {
    expect(nearestAirports(FIXTURE, london, { limit: 1 })).toHaveLength(1);
  });

  test("the default radius is the documented one", () => {
    expect(DEFAULT_AIRPORT_RADIUS_KM).toBe(150);
  });

  test("is deterministic when two airports rank identically", () => {
    const a = nearestAirports(FIXTURE, london).map((r) => r.airport.iata);
    const b = nearestAirports([...FIXTURE].reverse(), london).map((r) => r.airport.iata);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/airports.test.ts
```

Expected: FAIL — `nearestAirports is not a function` / no export named `nearestAirports`.

- [ ] **Step 3: Write the implementation**

Add the `LatLon` import to `lib/airports.ts`:

```ts
import { haversineKm, type LatLon } from "./geo";
```

Add these below the `Airport` interface:

```ts
export interface RankedAirport {
  airport: Airport;
  /** True great-circle distance in km, rounded — never the ranking score. */
  km: number;
}

/**
 * How far from a place an airport can be and still count as serving it.
 *
 * Matches `NEAREST_CITY_MAX_KM` in scripts/ingest-destinations.mjs. Beyond
 * this, returning "nearest" is worse than returning nothing: a 600km airport
 * is not this city's airport, and a caller told there is none can say so.
 */
export const DEFAULT_AIRPORT_RADIUS_KM = 150;

const DEFAULT_NEAREST_LIMIT = 5;

/**
 * Distance discount by size, in km. A judgement call, not a fact.
 *
 * Straight distance makes London City the airport for London at 13km, ahead of
 * Heathrow at 23km — technically true and wrong for a trip planner. A flat km
 * discount rather than a multiplier is what keeps this a tie-breaker: it can
 * reorder airports within 15km of each other and cannot promote a large
 * airport 100km away over a medium one next door.
 */
const SIZE_BONUS_KM: Record<AirportSize, number> = {
  large: 15,
  medium: 0,
  small: -15,
};
```

And this at the end of the file:

```ts
/**
 * Airports within range of a point, best first.
 *
 * Ranked rather than single-winner because London genuinely is five airports,
 * and a caller choosing a departure point needs to see them. Ordering uses the
 * size-discounted distance; the reported `km` is always the true one.
 */
export function nearestAirports(
  airports: readonly Airport[],
  at: LatLon,
  options: { radiusKm?: number; limit?: number } = {}
): RankedAirport[] {
  const radiusKm = options.radiusKm ?? DEFAULT_AIRPORT_RADIUS_KM;
  const limit = options.limit ?? DEFAULT_NEAREST_LIMIT;

  const within: Array<RankedAirport & { rank: number }> = [];
  for (const airport of airports) {
    const km = haversineKm(at, airport);
    if (km > radiusKm) continue;
    within.push({ airport, km: Math.round(km), rank: km - SIZE_BONUS_KM[airport.size] });
  }
  // IATA breaks a rank tie so the order is deterministic across runs.
  within.sort((a, b) => a.rank - b.rank || a.airport.iata.localeCompare(b.airport.iata));
  return within.slice(0, limit).map(({ airport, km }) => ({ airport, km }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run lib/airports.test.ts
```

Expected: PASS, 15 tests total. If "prefers a large airport" fails, the `SIZE_BONUS_KM.large` value is too small for the real LHR/LCY coordinates — verify with the fixture's actual distances before changing it, and change the constant rather than the test.

- [ ] **Step 5: Commit**

```bash
git add lib/airports.ts lib/airports.test.ts
git commit -m "feat: rank the airports serving a place by distance and size"
```

---

## Task 4: Server binding and drift guard

**Files:**
- Create: `lib/server/airports.ts`
- Test: `lib/server/airports.test.ts`

**Interfaces:**
- Consumes: `data/airports.json`, everything from `lib/airports`
- Produces: `allAirports()`, `airportsForCountry(code)`, `airportStatus()`, and re-bound `searchAirports(query, limit?)` / `nearestAirports(at, options?)` / `findAirport(iata)`

- [ ] **Step 1: Write the failing test**

Create `lib/server/airports.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  airportStatus,
  airportsForCountry,
  allAirports,
  findAirport,
  nearestAirports,
  searchAirports,
} from "./airports";

describe("the bundled airport artifact", () => {
  test("carries a plausible number of airports and countries", () => {
    const status = airportStatus();
    expect(status.airports).toBeGreaterThan(3_500);
    expect(status.countries).toBeGreaterThan(200);
    expect(status.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  /**
   * The drift guard. A bad daily refresh should fail CI rather than ship: these
   * four are among the busiest airports on Earth and will not lose scheduled
   * service or change code. TNA is here because it is the airport whose absence
   * prompted this work.
   */
  test.each(["TNA", "PEK", "LHR", "JFK"])("still resolves %s", (code) => {
    expect(findAirport(code)).not.toBeNull();
  });

  test("TNA is Jinan's airport, in China", () => {
    const tna = findAirport("TNA");
    // OurAirports qualifies municipalities with a district — the real value is
    // "Jinan (Licheng)", not "Jinan". Asserting the exact string would pin a
    // formatting detail of the upstream source that has nothing to do with what
    // this test is about.
    expect(tna?.municipality).toContain("Jinan");
    expect(tna?.country).toBe("CN");
  });

  test("every IATA code is unique", () => {
    const all = allAirports();
    expect(new Set(all.map((a) => a.iata)).size).toBe(all.length);
  });

  test("every airport has finite coordinates and a two-letter country", () => {
    for (const a of allAirports()) {
      expect(Number.isFinite(a.lat) && Number.isFinite(a.lon)).toBe(true);
      expect(a.country).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("airportsForCountry", () => {
  test("scopes to one country", () => {
    const cn = airportsForCountry("cn");
    expect(cn.length).toBeGreaterThan(100);
    expect(cn.every((a) => a.country === "CN")).toBe(true);
    expect(cn.some((a) => a.iata === "TNA")).toBe(true);
  });

  test("an unknown country is empty, not an error", () => {
    expect(airportsForCountry("ZZ")).toEqual([]);
  });
});

describe("bound helpers reach the real data", () => {
  test("search finds Jinan by city name", () => {
    expect(searchAirports("Jinan").map((a) => a.iata)).toContain("TNA");
  });

  test("nearest finds TNA from Jinan's city centre", () => {
    const near = nearestAirports({ lat: 36.667, lon: 116.983 });
    expect(near[0].airport.iata).toBe("TNA");
    expect(near[0].km).toBeLessThan(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/server/airports.test.ts
```

Expected: FAIL — `Failed to resolve import "./airports"`.

- [ ] **Step 3: Write the implementation**

Create `lib/server/airports.ts`:

```ts
import bundledAirportsJson from "../../data/airports.json";
import {
  findAirport as findIn,
  nearestAirports as nearestIn,
  searchAirports as searchIn,
  type Airport,
  type RankedAirport,
} from "../airports";
import type { LatLon } from "../geo";

/**
 * Binds the pure query layer in lib/airports to the committed artifact.
 *
 * The artifact is a static `import` rather than an `fs` read, for the reason
 * lib/server/catalog.ts documents: serverless deployments have a read-only
 * filesystem and no data/ directory, so a path read works locally and fails in
 * production. At ~557KB the file is smaller than data/catalog.json, which is
 * already bundled this way, so this adds no new size concern.
 *
 * Server-only by convention, like lib/server/catalog.ts — importing it from a
 * client component would pull the artifact into the browser bundle.
 */

interface AirportArtifact {
  generatedAt: string;
  source: string;
  airports: Airport[];
}

const artifact = bundledAirportsJson as unknown as AirportArtifact;

export function allAirports(): readonly Airport[] {
  return artifact.airports;
}

export function airportStatus(): {
  generatedAt: string;
  source: string;
  airports: number;
  countries: number;
} {
  return {
    generatedAt: artifact.generatedAt,
    source: artifact.source,
    airports: artifact.airports.length,
    countries: new Set(artifact.airports.map((a) => a.country)).size,
  };
}

export function airportsForCountry(code: string): Airport[] {
  const wanted = code.trim().toUpperCase();
  if (wanted.length !== 2) return [];
  return artifact.airports.filter((a) => a.country === wanted);
}

export function findAirport(iata: string): Airport | null {
  return findIn(allAirports(), iata);
}

export function searchAirports(query: string, limit?: number): Airport[] {
  return searchIn(allAirports(), query, limit);
}

export function nearestAirports(
  at: LatLon,
  options?: { radiusKm?: number; limit?: number }
): RankedAirport[] {
  return nearestIn(allAirports(), at, options);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run lib/server/airports.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all pass. Nothing existing has been touched yet, so a failure here is a real regression.

- [ ] **Step 6: Commit**

```bash
git add lib/server/airports.ts lib/server/airports.test.ts
git commit -m "feat: bind airport queries to the bundled artifact with drift guards"
```

---

## Task 5: Daily refresh workflow

**Files:**
- Create: `.github/workflows/refresh-airports.yml`

**Interfaces:**
- Consumes: `scripts/ingest-airports.mjs`
- Produces: a committed `data/airports.json` update on days the upstream data changes

This is the repo's first GitHub Actions workflow.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/refresh-airports.yml`:

```yaml
# Refreshes data/airports.json from the OurAirports nightly CSV.
#
# Commits only when the airport set actually changed. The ingest script
# preserves the previous `generatedAt` when the data is identical, so an
# unchanged day produces a byte-identical file and `git diff --quiet` passes —
# which is what keeps this from opening a commit every morning forever.
#
# A commit here triggers a Vercel deploy, so the artifact reaches production
# without anyone doing anything.
name: Refresh airports

on:
  schedule:
    # 04:10 UTC — after OurAirports' nightly rebuild, off the top of the hour
    # where GitHub's scheduler is most congested.
    - cron: "10 4 * * *"
  workflow_dispatch:

# Least privilege: the job writes one data file and nothing else.
permissions:
  contents: write

concurrency:
  group: refresh-airports
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Ingest airports
        run: node scripts/ingest-airports.mjs

      - name: Commit if the data changed
        run: |
          if git diff --quiet -- data/airports.json; then
            echo "No change in the airport set — nothing to commit."
            exit 0
          fi
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/airports.json data/airports-report.md
          git commit -m "chore: refresh airports from OurAirports"
          git push
```

- [ ] **Step 2: Verify the ingest step works on a clean checkout**

The workflow runs the script with no `npm install`, because the script uses only Node built-ins. Confirm that is true:

```bash
grep -n "^import" scripts/ingest-airports.mjs
```

Expected: only `node:fs`, `node:path` and `node:url` imports. Any bare package import means the workflow needs an install step.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/refresh-airports.yml
git commit -m "ci: refresh airports daily from OurAirports"
```

- [ ] **Step 4: Note the post-merge verification (do NOT attempt it now)**

`workflow_dispatch` and `schedule` only fire for workflows present on the
repository's **default branch**, so neither `gh workflow run` nor the cron can
reach this file while it lives on a feature branch. There is nothing to verify
here yet, and trying will fail with "workflow does not exist".

Once this branch merges to `main`, someone must run:

```bash
gh workflow run refresh-airports.yml
```

and confirm it succeeded and committed nothing (the data is already current):

```bash
gh run list --workflow=refresh-airports.yml --limit 1
```

Expected: `completed  success`. **This manual run is required before the phase
is done** — a scheduled workflow that has never run is one whose
`contents: write` permission has never been tested. Carry it to the
finishing-the-branch step as a merge gate.

---

## Task 6: Airport-aware route estimator

**Files:**
- Modify: `lib/route.ts`
- Modify: `lib/route.test.ts` (append only — do not edit existing tests)

**Interfaces:**
- Consumes: `Airport`, `nearestAirports`, `DEFAULT_AIRPORT_RADIUS_KM` from `lib/airports`
- Produces: `estimateLeg(from, to, airports?)`, `suggestRoute(places, airports?)`, `RouteAirport`, and `TRANSPORT.groundTransferKmh` / `TRANSPORT.airportSearchRadiusKm`

**This is the highest-risk task in the phase.** The `airports` parameter defaults to an empty array, and with an empty array every code path must produce exactly today's output — that is what lets all existing tests pass unmodified.

- [ ] **Step 1: Write the failing test**

Append to `lib/route.test.ts`:

```ts
import type { Airport } from "./airports";

/**
 * Two Chinese cities and their airports, plus a city with no airport at all.
 * Real coordinates, so the arithmetic below is checkable by hand.
 */
const AIRPORTS: Airport[] = [
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
  { iata: "URC", icao: "ZWWW", name: "Ürümqi Diwopu International Airport", municipality: "Ürümqi", country: "CN", lat: 43.907, lon: 87.474, size: "large" },
  { iata: "SHA", icao: "ZSSS", name: "Shanghai Hongqiao International Airport", municipality: "Shanghai", country: "CN", lat: 31.198, lon: 121.336, size: "large" },
];

/** Far from every airport in the fixture — the forced-rail case. */
const remote: RoutePlace = { id: "remote", name: "Remote valley", lat: 30.0, lon: 95.0 };

describe("estimateLeg with airports", () => {
  test("without airports it behaves exactly as before", () => {
    const without = estimateLeg(beijing, urumqi);
    const empty = estimateLeg(beijing, urumqi, []);
    expect(empty).toEqual(without);
  });

  test("a long leg between two served cities resolves the airport pair", () => {
    const leg = estimateLeg(beijing, urumqi, AIRPORTS);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.mode).toBe("flight");
    expect(leg.airports?.from.iata).toBe("PEK");
    expect(leg.airports?.to.iata).toBe("URC");
  });

  test("a flight's hours include ground transfer at both ends", () => {
    const bare = estimateLeg(beijing, urumqi);
    const aware = estimateLeg(beijing, urumqi, AIRPORTS);
    if (bare.kind !== "estimated" || aware.kind !== "estimated") throw new Error("expected estimates");
    // Both airports are well outside their city centres, so the airport-aware
    // estimate must be longer than the one that pretends you board downtown.
    expect(aware.hours).toBeGreaterThan(bare.hours);
  });

  test("km stays city-to-city even when the flight is airport-to-airport", () => {
    const bare = estimateLeg(beijing, urumqi);
    const aware = estimateLeg(beijing, urumqi, AIRPORTS);
    if (bare.kind !== "estimated" || aware.kind !== "estimated") throw new Error("expected estimates");
    // The distance the user travels between cities has not changed; only the
    // duration has. Swapping km to the airport pair would silently restate the
    // trip's total distance.
    expect(aware.km).toBe(bare.km);
  });

  test("a leg into a city with no airport in range is forced to rail", () => {
    const leg = estimateLeg(beijing, remote, AIRPORTS);
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") return;
    expect(leg.mode).toBe("rail");
    expect(leg.airports).toBeUndefined();
    // It is far enough that distance alone would have said "fly".
    expect(leg.km).toBeGreaterThan(TRANSPORT.flightThresholdKm);
    expect(leg.groundedForLackOfAirport).toBe(true);
  });

  test("a short leg between two served cities is still rail", () => {
    const leg = estimateLeg(beijing, { id: "tianjin", name: "Tianjin", lat: 39.084, lon: 117.201 }, AIRPORTS);
    if (leg.kind !== "estimated") throw new Error("expected an estimate");
    expect(leg.mode).toBe("rail");
    expect(leg.groundedForLackOfAirport).toBeUndefined();
  });

  test("an unlocated place is still unknown, airports or not", () => {
    expect(estimateLeg(beijing, village, AIRPORTS).kind).toBe("unknown");
  });
});

describe("TRANSPORT gains the airport constants", () => {
  test("reports what the airport-aware estimates assume", () => {
    expect(TRANSPORT.groundTransferKmh).toBe(60);
    expect(TRANSPORT.airportSearchRadiusKm).toBe(150);
  });
});

describe("suggestRoute with airports", () => {
  test("notes a leg that had to stay on the ground", () => {
    const { notes } = suggestRoute([beijing, remote], AIRPORTS);
    expect(notes.join(" ")).toMatch(/no airport/i);
  });

  test("without airports the notes are unchanged", () => {
    expect(suggestRoute([beijing, urumqi], []).notes).toEqual(suggestRoute([beijing, urumqi]).notes);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/route.test.ts
```

Expected: FAIL — `Failed to resolve import "./airports"` is already resolvable, so the real failures are `estimateLeg` ignoring its third argument and `TRANSPORT.groundTransferKmh` being `undefined`.

- [ ] **Step 3: Update the imports and constants in `lib/route.ts`**

Replace the import line at the top of `lib/route.ts`:

```ts
import { nearestAirports, DEFAULT_AIRPORT_RADIUS_KM, type Airport } from "./airports";
import { haversineKm, type LatLon } from "./geo";
```

Add after the existing `FLIGHT_BUFFER_H` constant:

```ts
/**
 * Average door-to-door speed between a city centre and its airport. Deliberately
 * slow: it stands for a taxi or airport train plus the walk at either end, not
 * a motorway cruise.
 */
const GROUND_TRANSFER_KMH = 60;
```

Replace the `TRANSPORT` object with:

```ts
export const TRANSPORT = {
  railKmh: RAIL_KMH,
  flightThresholdKm: FLIGHT_THRESHOLD_KM,
  flightKmh: FLIGHT_KMH,
  railBufferH: RAIL_BUFFER_H,
  flightBufferH: FLIGHT_BUFFER_H,
  groundTransferKmh: GROUND_TRANSFER_KMH,
  airportSearchRadiusKm: DEFAULT_AIRPORT_RADIUS_KM,
} as const;
```

- [ ] **Step 4: Widen the `RouteLeg` type**

Replace the `RouteLeg` type in `lib/route.ts`:

```ts
/** An airport as a leg reports it — enough to label "PEK → URC" and no more. */
export interface RouteAirport {
  iata: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * Discriminated rather than optional-numbered on purpose: a leg into a place
 * with no coordinates has no distance and no duration, and `km: 0` would render
 * as a real zero-kilometre hop. Callers have to decide what an unmeasurable leg
 * looks like, which is the point.
 *
 * `airports` and `groundedForLackOfAirport` are optional rather than a fourth
 * variant so that every existing consumer — which reads `kind`, `mode`, `km`
 * and `hours` — keeps compiling and behaving unchanged.
 */
export type RouteLeg =
  | {
      kind: "estimated";
      from: RoutePlace;
      to: RoutePlace;
      /** City-to-city distance. Unchanged by airport awareness. */
      km: number;
      /** Estimated door-to-door hours, rounded to the nearest half hour. */
      hours: number;
      mode: LegMode;
      /** The resolved pair. Present only on an airport-aware flight leg. */
      airports?: { from: RouteAirport; to: RouteAirport };
      /** Distance called for a flight, but an end had no airport in range. */
      groundedForLackOfAirport?: true;
    }
  | { kind: "unknown"; from: RoutePlace; to: RoutePlace };
```

- [ ] **Step 5: Rewrite `estimateLeg`**

Replace `estimateLeg` in `lib/route.ts`:

```ts
const railHours = (km: number) => roundHalf(km / RAIL_KMH + RAIL_BUFFER_H);

function toRouteAirport(airport: Airport): RouteAirport {
  return { iata: airport.iata, name: airport.name, lat: airport.lat, lon: airport.lon };
}

/**
 * Estimate one leg, optionally using real airports.
 *
 * With no airports supplied this is the original distance heuristic, unchanged
 * — which is what keeps every caller that has no airport data working, and what
 * the "behaves exactly as before" test pins.
 *
 * With airports it fixes two lies in that heuristic: it no longer flies between
 * city centres, and it no longer routes a flight to a city that has no airport.
 */
export function estimateLeg(
  from: RoutePlace,
  to: RoutePlace,
  airports: readonly Airport[] = []
): RouteLeg {
  if (!isLocated(from) || !isLocated(to)) return { kind: "unknown", from, to };
  const km = Math.round(haversineKm(from, to));

  if (airports.length === 0) {
    const mode: LegMode = km > FLIGHT_THRESHOLD_KM ? "flight" : "rail";
    const hours =
      mode === "flight" ? roundHalf(km / FLIGHT_KMH + FLIGHT_BUFFER_H) : railHours(km);
    return { kind: "estimated", from, to, km, hours, mode };
  }

  const fromNear = nearestAirports(airports, from, { limit: 1 })[0];
  const toNear = nearestAirports(airports, to, { limit: 1 })[0];

  // No airport at one end means this leg cannot be flown, however long it is.
  if (!fromNear || !toNear) {
    const leg: RouteLeg = { kind: "estimated", from, to, km, hours: railHours(km), mode: "rail" };
    return km > FLIGHT_THRESHOLD_KM ? { ...leg, groundedForLackOfAirport: true } : leg;
  }

  // The threshold applies to the flight actually available, not to the distance
  // between the city centres — those differ by up to 300km for a served pair.
  const airportKm = Math.round(haversineKm(fromNear.airport, toNear.airport));
  if (airportKm <= FLIGHT_THRESHOLD_KM) {
    return { kind: "estimated", from, to, km, hours: railHours(km), mode: "rail" };
  }

  const transferH = (fromNear.km + toNear.km) / GROUND_TRANSFER_KMH;
  return {
    kind: "estimated",
    from,
    to,
    km,
    hours: roundHalf(airportKm / FLIGHT_KMH + FLIGHT_BUFFER_H + transferH),
    mode: "flight",
    airports: { from: toRouteAirport(fromNear.airport), to: toRouteAirport(toNear.airport) },
  };
}
```

- [ ] **Step 6: Thread airports through `suggestRoute`**

In `lib/route.ts`, change the signature and the leg-building line:

```ts
export function suggestRoute(
  places: RoutePlace[],
  airports: readonly Airport[] = []
): RouteSuggestion {
```

Then replace the `legs` assignment:

```ts
  const legs = order.slice(0, -1).map((p, i) => estimateLeg(p, order[i + 1], airports));
```

And add the grounded note, after the existing flight note block:

```ts
  const grounded = measured.filter((l) => l.groundedForLackOfAirport);
  if (grounded.length > 0) {
    notes.push(
      `${grounded.length} long leg${grounded.length > 1 ? "s have" : " has"} no airport within ` +
        `${DEFAULT_AIRPORT_RADIUS_KM} km at one end — plan those overland (${grounded
          .map((l) => `${l.from.name} → ${l.to.name}`)
          .join(", ")}).`
    );
  }
```

Finally, exclude grounded legs from the all-rail note. Its existing condition is
`measured.every((l) => l.mode === "rail")`, and a grounded leg *is* rail — so a
route with a 3,000 km overland hop would currently be told every leg is
"high-speed-rail friendly, book seats ~15 days ahead". Change that condition to:

```ts
  if (
    legs.length > 0 &&
    measured.length === legs.length &&
    measured.every((l) => l.mode === "rail" && !l.groundedForLackOfAirport)
  ) {
```

- [ ] **Step 7: Run the route tests**

```bash
npx vitest run lib/route.test.ts
```

Expected: PASS — the 15 pre-existing tests **and** the 10 new ones. If any pre-existing test fails, the empty-airports path has diverged from the original behaviour; fix the implementation, never the old test.

- [ ] **Step 8: Run the full suite**

```bash
npm test
```

Expected: all pass, including `lib/countryProfile.test.ts`, which reads `TRANSPORT`.

- [ ] **Step 9: Commit**

```bash
git add lib/route.ts lib/route.test.ts
git commit -m "feat: estimate flights between real airports with ground transfer"
```

---

## Task 7: Airport search API and autocomplete input

**Files:**
- Create: `app/api/airports/search/route.ts`
- Create: `components/trip/AirportInput.tsx`
- Test: `components/trip/AirportInput.test.tsx`

**Interfaces:**
- Consumes: `searchAirports` from `lib/server/airports`, `Airport` from `lib/airports`
- Produces: `GET /api/airports/search?q=` → `{ results: Airport[] }`; and `<AirportInput label value onChange placeholder? maxLength? className? />`

The endpoint returns `Airport` objects as-is rather than a trimmed row type.
A dedicated hit type would duplicate seven of eight fields to save a few hundred
bytes across at most twelve results, and it would have to live somewhere both
the route and the client component can import — which, if that were the route
file, means a client component importing from a server module.

- [ ] **Step 1: Write the API route**

Create `app/api/airports/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import type { Airport } from "@/lib/airports";
import { searchAirports } from "@/lib/server/airports";

/** Below this every query matches thousands of rows. Mirrors /api/destinations. */
const MIN_QUERY = 2;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results: Airport[] = q.trim().length >= MIN_QUERY ? searchAirports(q) : [];
  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Write the failing component test**

Create `components/trip/AirportInput.test.tsx`:

```tsx
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Airport } from "@/lib/airports";
import { AirportInput } from "./AirportInput";

/**
 * `fireEvent`, not `@testing-library/user-event` — the latter is not a
 * dependency of this repo and every existing component test uses `fireEvent`.
 */

/** What /api/airports/search returns — full Airport rows. */
const HITS: Airport[] = [
  { iata: "TNA", icao: "ZSJN", name: "Jinan Yaoqiang International Airport", municipality: "Jinan", country: "CN", lat: 36.857, lon: 117.216, size: "large" },
  { iata: "PEK", icao: "ZBAA", name: "Beijing Capital International Airport", municipality: "Beijing", country: "CN", lat: 40.080, lon: 116.585, size: "large" },
];

/**
 * The component is controlled, so a bare render would never show typed text.
 * This holds the value the way TicketForm does.
 */
function Harness({ onValue }: { onValue?: (v: string) => void } = {}) {
  const [value, setValue] = useState("");
  return (
    <AirportInput
      label="From"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
    />
  );
}

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText("From"), { target: { value: text } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ results: HITS }) }) as unknown as Response)
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AirportInput", () => {
  test("renders its label and current value", () => {
    render(<AirportInput label="From" value="Beijing" onChange={() => {}} />);
    expect(screen.getByLabelText("From")).toHaveValue("Beijing");
  });

  test("reports every keystroke, so free typing still works", () => {
    const onChange = vi.fn();
    render(<AirportInput label="From" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Grandma's airstrip" } });
    expect(onChange).toHaveBeenCalledWith("Grandma's airstrip");
  });

  test("offers matching airports once the query is long enough", async () => {
    render(<Harness />);
    type("Jinan");
    // Appears only after the 300ms debounce and the fetch resolve; findBy*
    // polls for up to the 5s asyncUtilTimeout set in vitest.setup.ts.
    expect(await screen.findByRole("option", { name: /Jinan Yaoqiang/ })).toBeInTheDocument();
  });

  test("picking an option writes name and code into the field", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    type("Jinan");
    // mouseDown, not click: the component commits on mouseDown so that blur
    // cannot close the list first.
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(onValue).toHaveBeenLastCalledWith("Jinan Yaoqiang International Airport (TNA)");
  });

  test("closes the list after a pick rather than re-querying the new value", async () => {
    render(<Harness />);
    type("Jinan");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  test("does not query for a one-character value", async () => {
    render(<Harness />);
    type("J");
    // Comfortably past the 300ms debounce: if a request were coming, it has had
    // its chance.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run components/trip/AirportInput.test.tsx
```

Expected: FAIL — `Failed to resolve import "./AirportInput"`.

- [ ] **Step 4: Write the component**

Create `components/trip/AirportInput.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Airport } from "@/lib/airports";

/**
 * A text field that suggests real airports (spec §3.6).
 *
 * It stays a *text field*. The ticket's `from`/`to` are free-text strings in
 * the schema, old tickets hold whatever someone typed, and plenty of real
 * journeys start somewhere with no IATA code — so this suggests and never
 * gates. Picking a suggestion writes a display string; typing something else
 * is equally valid and is passed straight through.
 *
 * Debounce-then-abort is the same shape as components/plan/PlaceSearch.tsx, so
 * a slow older response cannot overwrite a newer one after further typing.
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}

/** What a picked suggestion writes: readable, and carrying the code. */
function displayValue(hit: Airport): string {
  return `${hit.name} (${hit.iata})`;
}

export function AirportInput({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 60,
  className,
}: Props) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [hits, setHits] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppresses the lookup that the pick itself would otherwise trigger. */
  const justPickedRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    if (value.trim().length < MIN_QUERY) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/airports/search?q=${encodeURIComponent(value.trim())}`, {
          signal: controller.signal,
        });
        const json: { results: Airport[] } = await res.json();
        setHits(json.results);
        setOpen(json.results.length > 0);
      } catch {
        if (!controller.signal.aborted) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [value]);

  const pick = (hit: Airport) => {
    justPickedRef.current = true;
    setOpen(false);
    setHits([]);
    onChange(displayValue(hit));
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--ink-0)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ink)]";

  return (
    <div className="relative">
      <label className={className ?? "text-xs font-medium text-[var(--ink-2)]"} htmlFor={inputId}>
        {label}
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setOpen(false)}
          className={inputClass}
        />
      </label>
      {open && hits.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} airport suggestions`}
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--line-1)] bg-[var(--paper)] shadow-lg"
        >
          {hits.map((hit) => (
            <li
              key={hit.iata}
              role="option"
              aria-selected={false}
              // onMouseDown, not onClick: blur fires first and would close the
              // list before a click could land.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
              className="flex min-h-[var(--tap-min)] cursor-pointer items-center gap-2 px-3 text-sm hover:bg-[var(--line-1)]"
            >
              <span className="font-mono text-xs font-semibold text-[var(--accent-ink)]">
                {hit.iata}
              </span>
              <span className="truncate">{hit.name}</span>
              {hit.municipality && (
                <span className="ml-auto shrink-0 text-xs text-[var(--ink-2)]">
                  {hit.municipality}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run components/trip/AirportInput.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/airports/search/route.ts components/trip/AirportInput.tsx components/trip/AirportInput.test.tsx
git commit -m "feat: add airport search endpoint and autocomplete input"
```

---

## Task 8: Wire the autocomplete into flight tickets

**Files:**
- Modify: `components/trip/TicketsTab.tsx`

**Interfaces:**
- Consumes: `AirportInput` from Task 7
- Produces: no new exports — `TicketDraft` and the API contract are unchanged

- [ ] **Step 1: Import the component**

Add to the imports at the top of `components/trip/TicketsTab.tsx`:

```tsx
import { AirportInput } from "./AirportInput";
```

- [ ] **Step 2: Swap the From/To fields inside `TicketForm`**

Replace the two `<label>` blocks for From and To with:

```tsx
        {/*
          Airports for flights, plain text for everything else. A train's "from"
          is a station and a hotel's is nothing at all, so offering airport
          suggestions there would be noise. The field is the same free-text
          string in both cases — only the affordance differs.
        */}
        {fields.kind === "flight" ? (
          <>
            <AirportInput
              label="From"
              value={fields.from}
              onChange={(from) => set({ from })}
              placeholder="Beijing or PEK"
            />
            <AirportInput
              label="To"
              value={fields.to}
              onChange={(to) => set({ to })}
              placeholder="Shanghai or SHA"
            />
          </>
        ) : (
          <>
            <label className={label}>
              From
              <input type="text" value={fields.from} onChange={(e) => set({ from: e.target.value })} placeholder="Beijing" maxLength={60} className={input} />
            </label>
            <label className={label}>
              To
              <input type="text" value={fields.to} onChange={(e) => set({ to: e.target.value })} placeholder="Shanghai" maxLength={60} className={input} />
            </label>
          </>
        )}
```

- [ ] **Step 3: Verify in the running app**

```bash
npm run dev
```

Open a trip's Tickets tab, click **+ Add ticket**, choose **Flight**, and type `Jinan` into From. Expected: a suggestion list appears with `TNA · Jinan Yaoqiang International Airport · Jinan`; clicking it fills the field with `Jinan Yaoqiang International Airport (TNA)`. Switch the kind to **Train** and confirm From/To become plain inputs with no suggestions.

- [ ] **Step 4: Run the full suite**

```bash
npm test
```

Expected: all pass. `TicketsTab` has no test file of its own, so the gate here is the manual check in Step 3 plus `AirportInput`'s tests.

- [ ] **Step 5: Commit**

```bash
git add components/trip/TicketsTab.tsx
git commit -m "feat: suggest airports on flight tickets"
```

---

## Task 9: Feed real airports to the map's route panel

**Files:**
- Create: `app/api/map/airports/route.ts`
- Modify: `components/map/MapExplorer.tsx`

This is what makes Task 6 visible. Until now the estimator *can* use airports but nothing supplies them.

**Interfaces:**
- Consumes: `airportsForCountry` from `lib/server/airports`; `suggestRoute` from `lib/route`
- Produces: `GET /api/map/airports?country=XX` → `{ airports: Airport[] }`

- [ ] **Step 1: Write the API route**

Create `app/api/map/airports/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { airportsForCountry } from "@/lib/server/airports";

/**
 * Country-scoped so the client downloads ~260 airports for a China trip rather
 * than all 4,134. Mirrors /api/map/cities, including its cache window — the
 * artifact only changes when the daily workflow commits.
 */
export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") ?? "";
  return NextResponse.json(
    { airports: airportsForCountry(country) },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
```

- [ ] **Step 2: Fetch the airports in `MapExplorer`**

Add to the imports in `components/map/MapExplorer.tsx`:

```tsx
import type { Airport } from "@/lib/airports";
```

Add alongside the other state declarations:

```tsx
  /**
   * The country's airports, for the route estimator. Empty until they load,
   * and empty is exactly the "no airport data" path `estimateLeg` already
   * handles — so the panel renders correct-but-coarser estimates first and
   * sharpens when they arrive, rather than waiting.
   */
  const [airports, setAirports] = useState<Airport[]>([]);
```

Add this effect next to the existing topology/cities effect:

```tsx
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/map/airports?country=${encodeURIComponent(countryCode)}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((json: { airports: Airport[] }) => setAirports(json.airports))
      // Airports only sharpen the estimate — losing them costs precision, not
      // function, so this failure is silent by design.
      .catch(() => {
        if (!controller.signal.aborted) setAirports([]);
      });
    return () => controller.abort();
  }, [countryCode]);
```

- [ ] **Step 3: Pass them to `suggestRoute`**

In the `route` memo, change the `suggestRoute` call and its dependency array:

```tsx
      route: routePlaces.length >= 2 ? suggestRoute(routePlaces, airports) : null,
      unresolvedCount: missing,
    };
  }, [selected, placeById, airports]);
```

- [ ] **Step 4: Show the airport pair in the leg tooltip**

In the route panel, replace the `title` attribute on the estimated-leg span:

```tsx
                      title={
                        leg.airports
                          ? `${leg.airports.from.iata} → ${leg.airports.to.iata} · ${leg.km.toLocaleString()} km · ~${leg.hours}h`
                          : `${leg.km.toLocaleString()} km · ~${leg.hours}h`
                      }
```

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: all pass. `MapExplorer.test.tsx` mocks `fetch` and dispatches on URL; the new `/api/map/airports` request falls through to its default branch. **If that default returns something without an `airports` array, the `.then` will set `undefined` and the memo will throw** — in that case add an explicit branch to the test's fetch mock returning `{ airports: [] }`.

- [ ] **Step 6: Verify in the running app**

```bash
npm run dev
```

Open `/plan`, pick China, select Beijing and Ürümqi. Expected: the route panel shows ✈️ with an hour count, and hovering the ✈️ shows a tooltip reading `PEK → URC · 2,417 km · ~7h` (or similar). The hours should be roughly half an hour longer than before this change, because ground transfer at both ends is now counted.

- [ ] **Step 7: Commit**

```bash
git add app/api/map/airports/route.ts components/map/MapExplorer.tsx
git commit -m "feat: route with the country's real airports on the map"
```

---

## Self-Review

**Spec coverage** — every requirement in §3 of the design maps to a task:

| Spec §3 requirement | Task |
|---|---|
| 3.1 Source, filter, licence, IATA uniqueness | 1 |
| 3.2 Artifact shape, envelope, abort gate | 1 |
| 3.3 Daily refresh, `generatedAt` idempotency | 1 (idempotency), 5 (workflow) |
| 3.4 `nearestAirports` / `findAirport` / `searchAirports` | 2, 3 |
| 3.5 Route estimator, ground transfer, forced rail, `TRANSPORT` fields | 6 |
| 3.6 Ticket autocomplete, no schema change, `/api/airports/search` | 7, 8 |
| §9 drift guard on stable IATA codes | 4 |

**Deliberate additions beyond the spec:** `lib/server/airports.ts` (Task 4) and `/api/map/airports` + the MapExplorer wiring (Task 9). The spec implied both without naming them — §3.5's estimator is dead code without a supplier, and §3.4's "server-only" note requires a binding module.

**Known gaps, both intentional:**
- No test for either API route. The repo has no API-route tests at all; the logic behind both is covered in `lib/server/airports.test.ts`.
- `TicketsTab.tsx` has no test file, so Task 8's gate is manual verification plus `AirportInput`'s own tests. Adding a first test file for `TicketsTab` is out of scope here.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-23-worldwide-airports.md`.
