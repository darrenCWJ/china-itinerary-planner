# Global expansion — roadmap design

**Date:** 2026-08-23
**Status:** design, awaiting review
**Scope:** taking the planner from China-only content to every country, adding
worldwide airports, a globe world level, and flight data.

---

## 1. Why this document exists

The request was: *"make this app global, Jinan is missing, add all the
international airports in the world, ideally from a daily-refreshable source,
with flights data."*

Surveying the code first changed the shape of that request three times, so the
survey comes before the design.

### 1.1 Global plumbing already exists; global *content* does not

`lib/countries.ts` accepts any ISO alpha-2 and synthesises a name, hemisphere
and accent for codes it does not curate. `public/world-countries.json` carries
235 country shapes. `Destination.country` is already a field. Season inversion,
country profiles, accent hues and imagery are all country-generic.

What is China-only is the *data*: 16 curated destinations in `lib/data/*.ts`
and 695 catalog cities in `data/catalog.json`.

### 1.2 Jinan is not missing

`data/catalog.json` contains Jinan (`Q170247`, Shandong, pop 9.2M), and
`searchCities` returns it. What Jinan lacks is depth — it has a name, a blurb
and coordinates, while the 16 curated destinations have activities, seasons,
foods and suggested day counts. The felt gap is curation depth, not coverage.

### 1.3 The globe drill-down already exists, and is China-gated on purpose

| Level | Component | State |
|---|---|---|
| L1 world | `components/map/WorldMap.tsx` | Complete — 235 clickable countries, accent-tinted, roving tabindex, small-country point layer, A–Z fallback |
| L2 country | `components/map/CountryMap.tsx` | China renders a real map; **the other 233 render `CountryPlaceList`, a flat list of buttons with no geometry** |
| L3 region | `zoomRegion` + `transformForFeatures` | Works — dims, rescales, animates over 650 ms. **China only** |

L3's China-gating is a recorded decision, `CountryMap.tsx:66`:

> *"Judgement call J14: other countries have no regions to zoom into, so a
> wider type here would be a promise this level can't keep. Zooming into a
> region stays a China-only feature by design."*

**The request is therefore: reverse J14, and turn L1 into a globe.** Not build
a drill-down — generalise one that exists.

---

## 2. The finding that sets the order

A three-approach design panel with nine independent adversarial judges scored
every globe approach **4–5/10 on data reality**, unanimously, for one reason:
outside China the drill-down navigates into an empty room. The gates, all
verified present:

- `components/plan/PlaceSearch.tsx:44` — `CATALOG_COUNTRIES = {"CN"}`.
- No curated destination carries a `country` field, so
  `DESTINATIONS.filter(d => (d.country ?? "CN") === code)` returns `[]` for
  all 234 other countries.
- `MapExplorer.togglePlace` resolves taps via
  `cities.find(c => c.qid === place.id)`, and `cities` comes from
  `/api/map/cities`, which is China-only and takes no parameters. A tapped
  non-China marker silently does nothing.
- `onAddCatalog` expects a Wikidata-qid-shaped `CatalogHit`; `mapTypes.level`
  has no airport member.

### 2.1 The trap this creates

The tempting shortcut is to fill L2 with airports so it looks populated. Both
outcomes are worse than the status quo:

- **Inert pins** — accessible controls announced to screen readers as
  pressable that do nothing.
- **Airports as trip stops** — every non-China itinerary becomes an ordered
  list of airports, with "Narita International Airport" as a destination
  carrying day plans, route legs and a night count.

Today's fallback at `CountryMap.tsx:129` — *"No map for {label} yet — search
above to add places"* — is honest. **A furnished-looking empty room is worse
than an admittedly empty one.** Airports are a real feature; they are not
destinations, and nothing in this roadmap may treat them as such.

### 2.2 Consequence for ordering

The worldwide city catalog is the blocker for everything that makes the app
feel global. But two pieces pay off with no new data and are therefore built
first, both because they ship value early and because they de-risk the harder
work behind them.

**Phase order: airports → globe L1 → city catalog → L2/L3 generalisation →
flights.**

---

## 3. Phase 1 — Worldwide airports

Self-contained. No dependency on any other phase.

### 3.1 Source

`https://davidmegginson.github.io/ourairports-data/airports.csv` — the daily
mirror of the OurAirports database.

- **Licence: public domain.** The publisher states *"All data is released to
  the Public Domain"* and that the CSVs are regenerated *"every night."*
  Verified `Last-Modified: Sat, 22 Aug 2026`.
- 85,938 rows total, 12.7 MB.

**Filter: `scheduled_service = "yes" AND iata_code ≠ ""`** → **4,134 airports
across 234 countries** (China: 261).

The request said "international airports," but OurAirports has no such flag and
every substitute is worse. `large_airport` alone gives 1,174 and discards
regional airports people fly to. Matching "International" in the name is
language-dependent. *Scheduled service + IATA* means "an airport you can buy a
ticket to," which is the operative meaning — and it is the filter that keeps
Jinan's TNA, rather than reproducing the gap that prompted this work.

Verified: **IATA is unique across the filtered set** — 4,134 codes, 4,134 rows,
zero collisions. Safe as a primary key.

### 3.2 Artifact

`scripts/ingest-airports.mjs` → `data/airports.json`, following
`ingest-destinations.mjs`'s conventions: atomic temp-then-rename write, retry
with backoff, and a companion `data/airports-report.md`.

```ts
export interface Airport {
  iata: string;                 // "TNA" — primary key
  icao: string | null;          // "ZSJN"
  name: string;                 // "Jinan Yaoqiang International Airport"
  municipality: string | null;  // "Jinan"
  country: CountryCode;         // "CN" — iso_country is already ISO alpha-2
  lat: number;
  lon: number;
  size: "large" | "medium" | "small";  // from `type`
}
```

Envelope `{ generatedAt, source, airports }`, mirroring `catalog.json`.
**816 KB raw / 167 KB gzipped** as actually built, against `catalog.json`'s
569 KB / 120 KB — the same order of magnitude, so it bundles the same way with
no new size concern. (An earlier estimate here said 557 KB; that measured
short keys like `ia`/`la`. Readable keys and `catalog.json`'s 1-space
indentation cost more raw bytes and almost nothing gzipped — 158 KB compact
against 167 KB as written — which is why the readable form was kept.)

**Abort gate.** The script refuses to write if the CSV header loses a required
column, or if the row count drops more than 10% against the existing artifact.
`ingest-destinations.mjs` already does this via `verifyClassLabels()`. The
failure being prevented is a silently reshaped upstream shipping an empty
airport list.

### 3.3 Daily refresh

`.github/workflows/refresh-airports.yml` — the repo's first workflow. Daily
cron plus `workflow_dispatch`, `permissions: contents: write`. Runs the ingest,
commits `data/airports.json` only if it changed, which triggers a Vercel
deploy. Most days it is a no-op.

**The `generatedAt` subtlety:** a fresh timestamp every run would commit noise
daily forever. The script preserves the previous `generatedAt` when the airport
array is byte-identical, so the script owns idempotency and the workflow simply
commits whatever differs.

### 3.4 `lib/airports.ts` — pure query layer

```ts
nearestAirports(at: LatLon, opts?): RankedAirport[]
findAirport(iata: string): Airport | null
searchAirports(query: string, limit: number): Airport[]
```

Ranked, not single-winner: London genuinely is several airports. Verified
output within 150 km — LCY 13 km, LHR 23, LGW 40, LTN 44, STN 49. Score is
distance with a size preference that only breaks near-ties, so a large airport
60 km out never beats a medium one 15 km away. The radius cap makes a city with
nothing nearby return `[]` rather than a nonsense 600 km "nearest."

`searchAirports` scores IATA-exact 3, name/municipality prefix 2, substring 1,
folding through the existing `foldPlaceName` — the same scoring shape
`searchCities` uses, so both search surfaces behave alike.

**No precomputed city→airport table.** A 4,134-element linear scan is
microseconds, works for any coordinate including hand-typed off-map places, and
avoids a second artifact that could drift out of sync with the first.

### 3.5 Route estimator upgrade — `lib/route.ts`

Today: `km > 1200 → flight`, then `km / 700 + 2.5h`. Two lies live in that — it
flies between *city centres*, and it assumes every city has an airport.

- **Both endpoints have an airport in range, pair distance over threshold** →
  `mode: "flight"`; hours = airport-pair great-circle / 700 + 2.5 h buffer +
  **ground transfer at both ends** (city→airport at ~60 km/h). A 1,300 km hop
  between cities each 80 km from their airport is not the same trip as one
  between two downtown airports, and today the app cannot tell them apart.
- **Either endpoint has no airport in range** → forced `rail`, with a note.
  Rare — only 4 of the 695 catalog cities have no scheduled airport within
  150 km — but today the app will cheerfully route a flight to a city with no
  airport.
- **Unlocated endpoint** → `kind: "unknown"`, unchanged.

The flight variant of `RouteLeg` carries its resolved airports, so the UI can
render "PEK → TNA" rather than a bare ✈️. `TRANSPORT` gains
`groundTransferKmh` and `airportSearchRadiusKm`, keeping `countryProfile`'s
report of its own assumptions complete — there is already a test pinning
`cn.transport.flightThresholdKm`.

**Highest-risk item in Phase 1.** `route.test.ts`, `lib/feasibility.ts`,
`RouteMap.tsx` and `MapExplorer.tsx` all consume legs, and changing hours
changes plan feasibility outcomes. Tests first, own PR.

### 3.6 Flight ticket autocomplete

Autocomplete on `from`/`to` for `kind: "flight"` tickets, reusing the
debounce-and-abort pattern in `components/plan/PlaceSearch.tsx`. Writes a
display string — "Jinan Yaoqiang (TNA)" — into the existing free-text field.
**No schema change**; old tickets keep working and free typing still works. The
list suggests, it does not gate.

Served by `/api/airports/search`, mirroring how `/api/destinations` serves
catalog search — shipping 140 KB to every browser for a page most users never
open is a real cost, and this keeps the artifact server-only.

### 3.7 Phase 1 PRs

| PR | Contents | Risk |
|---|---|---|
| 1.1 | Ingest script, artifact, GitHub Action, `lib/airports.ts` | Low — no UI |
| 1.2 | Route estimator upgrade | **High** — changes feasibility |
| 1.3 | Ticket autocomplete + `/api/airports/search` | Low |

The airport *map layer* and *wizard gateways*, considered here originally, move
to Phase 4 — both are country-map features and belong with that work.

---

## 4. Phase 2 — The globe (L1)

Independently valuable: choosing one country out of 235 is a real task, a globe
improves it, and it needs no new content data.

### 4.1 The performance ceiling, measured

The map is fast today because the projection is computed **once** in a
`useMemo` and zoom is a CSS `transform` on a `<g>` — never a re-projection.
Globe rotation cannot use that trick: rotation is not an affine 2D transform,
so every frame re-projects everything.

Measured locally, fitting once and rotating per frame, 860×620 viewBox:

| Topology | SVG path strings | Canvas |
|---|---|---|
| **50m — current asset, 747 KB** | 179 ms/frame → **6 fps** | 124 ms/frame → 8 fps |
| **110m — coarse, 108 KB** | 22 ms/frame → **45 fps** | 16 ms/frame → 64 fps |

**Resolution is the binding constraint, not render target** — canvas buys
~1.4×, dropping to 110m buys ~8×. So the globe stays **SVG**, preserving the
accessibility tree `WorldMap`'s docblock argues for (235 real `role="button"`
nodes, roving tabindex) and keeping tests in jsdom.

`build-world-topology.mjs` rejected 110m because *"Singapore, Malta, Maldives
and Bahrain are absent or sub-pixel."* That objection is resolved: **the 61
features 110m drops are all already in the existing 76-entry `smallCountries`
point layer**, so a 110m globe reaches exactly the same 235 country codes as
today — zero gaps.

`d3-geo@3.1.1` already exports `geoOrthographic`, `geoDistance`,
`geoGraticule10`, `geoContains`, `geoCircle`, `geoBounds`. **Zero new
dependencies.**

### 4.2 Shape of the change

`scripts/build-globe-topology.mjs` → `public/world-globe.json` (~110 KB), built
from `world-atlas@2/countries-110m.json` through the same re-key path the
existing script uses, with a **coverage invariant test** asserting the globe
asset reaches the same country set as the 50m asset. That test is the thing
that keeps a country from silently vanishing from the picker.

`mapShared.ts` gains a sibling to `buildFitProjection`:

```ts
export function buildGlobeProjection(rotate: [number, number]) {
  const projection = geoOrthographic()
    .rotate(rotate)
    .fitExtent(
      [[MAP_VIEW_PAD, MAP_VIEW_PAD], [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD]],
      { type: "Sphere" }
    );
  return { projection, pathGen: geoPath(projection) };
}
```

Fitting to `{type: "Sphere"}` rather than to the features is what keeps the disc
from resizing as countries rotate through view. The fit is then a constant —
scale 300, translate [430, 310] — so `MAP_VIEW_W/H` and `lib/mapTransform.ts`
are untouched and its hand-computed fixtures still pass.

**The existing flat `WorldMap` is kept**, behind a shared `WorldLevelProps`
interface, as the `worldView: "flat"` renderer. It serves
`prefers-reduced-motion`, low-end devices, and users who prefer a flat map. Two
renderers, one interface, one selection contract.

### 4.3 Six verified traps this phase must handle

Each was reproduced against the real asset during design, not theorised.

1. **Orthographic clips polygons but NOT points.** Centred on China, Buenos
   Aires projects to `[359, 314]` — visibly on the disc, on top of Asia, and
   clickable. Guard every point with
   `geoDistance([lon, lat], [-rot[0], -rot[1]]) < Math.PI / 2`.
2. **`projection.invert()` returns plausible values outside the disc.** Pixel
   `[5, 5]` returns `[-7.37, 28.53]`, so clicking an empty corner selects
   Morocco. An explicit disc-radius guard must precede every invert.
3. **Back-face countries are a keyboard trap.** They render no DOM node, so
   `focusEntry`'s `nodeRefs.current.get(code)?.focus()` no-ops, leaving *no*
   element with `tabIndex 0` — Shift+Tab cannot re-enter the map. Fix: keep
   back-face entries mounted (`opacity: 0`, `pointer-events: none`) so the
   roving list stays the stable full 235, and let focus drive rotation rather
   than rotation pruning focus. **A 4-country test fixture keeps all four
   front-facing, so this passes tests while trapping real users** — it needs a
   fixture that spans hemispheres.
4. **The A–Z `<select>` silently loses the far hemisphere.** `entries` derives
   from `shapes.filter(s => s.interactive)`, and `shapes` only holds features
   whose `pathGen(f)` was non-null. Same fix as (3); this is the WCAG 2.5.8
   equivalent-control path, so it is not optional.
5. **Re-keying the existing `view` useMemo on rotation re-runs everything** —
   `feature()` decoding the whole topology, `nonOverlappingRadii` at O(n²) over
   76 points, and a 235-entry `localeCompare` sort, every pointermove. The memo
   must split into topology-derived and rotation-derived halves before any of
   the performance reasoning holds.
6. **`pointercancel` must be handled.** The browser fires it the moment it
   claims a vertical scroll; without a handler the drag origin and the
   click-suppression flag are left stale. Do **not** set `touch-action: none` —
   `components/plan/DayBuilder.tsx:215` already establishes the pattern of
   gating on `pointerType` precisely so page scrolling survives.

### 4.4 Phase 2 PRs

| PR | Contents | Risk |
|---|---|---|
| 2.1 | Build script, `public/world-globe.json`, `lib/globeTopology.ts`, coverage invariant test | Low — no UI |
| 2.2 | `lib/globeRotation.ts` — pure rotation, drag and hit-test maths, node-tested | Low |
| 2.3 | `GlobeLevel` + flat fallback behind the shared interface | **High** |

PR 2.3 is the riskiest work in the roadmap. Budget roughly double what the diff
suggests: it rewrites assertions in a 13-test file whose central claim ("makes
every country a control") changes form, in the component that already caused
the suite's known flakes.

---

## 5. Phase 3 — Worldwide city catalog

The blocker. This is what makes the app global; everything after it depends on
it, and Phase 4 is worthless without it.

### 5.1 Source

**GeoNames `cities15000`** — every city with population ≥ 15,000.

- **34,099 cities across 244 countries.** China alone: 2,107, against the 695
  the current Wikidata catalog holds.
- Daily dumps, verified `Last-Modified: Sat, 22 Aug 2026` — same freshness as
  OurAirports.
- Carries name, coordinates, population, admin-1 code and **timezone**.
- **Licence: CC BY 4.0 — attribution required.** This differs from OurAirports
  and Natural Earth, which are public domain. The app must carry a visible
  GeoNames credit, and `data/*-report.md` must record it.

Sizes measured, trimmed to the fields the app would use: **3.6 MB raw /
0.8 MB gzipped**. `cities5000` would give 69,632 cities at 7.3 MB / 1.7 MB.
Start at `cities15000`; the threshold is a one-line change if it proves too
coarse.

### 5.2 This forces the storage change

`data/catalog.json` is 582 KB and `import`ed directly into the server bundle.
At 3.6 MB the same approach means a multi-megabyte serverless bundle and a
JSON parse on every cold start. Production already runs Postgres.

**Cities move to Postgres**, with a migration in the existing `lib/server/migrate.ts`
pattern, a `pgStore`-style accessor, and a trigram or prefix index for search.
`lib/server/catalog.ts` keeps its current interface — `searchCities`,
`mapCities`, `resolveDestinations` — so callers do not change; only the
implementation behind it does. The China attractions artifact stays as a
bundled JSON for now, since it is small and unchanged.

Local development keeps working through the existing SQLite path, seeded from
the same ingest.

### 5.3 The depth problem, stated honestly

GeoNames gives name, coordinates, population and timezone. It gives **no
descriptions, no images, no interest tags** — all of which the current 695
China cities have, from Wikipedia summaries and Wikimedia images.

So a naive port trades 695 rich cities for 34,099 thin ones. That is a
regression in feel even as it is a 50× gain in coverage.

**Resolution:** treat enrichment as a separate, incremental layer keyed by
GeoNames id. Enrich on a priority order — the largest cities per country first,
then anything a user actually selects — reusing the existing Wikidata/Wikipedia
fetch machinery from `ingest-destinations.mjs`. The China catalog's existing
enrichment is preserved by matching on coordinates and name, not discarded.
A city with no enrichment renders exactly as a catalog city does today, which
is already an acceptable state.

### 5.4 Opening the gates

Phase 3 is not done until the three gates from §2 are open:

- `CATALOG_COUNTRIES` is removed, and `PlaceSearch` scopes by the active
  country rather than by a China allowlist.
- The 16 curated destinations each gain an explicit `country: "CN"`, so
  `(d.country ?? "CN")` stops being a defaulting hack that silently claims
  every future destination for China.
- `/api/map/cities` takes a country parameter, and `MapExplorer.togglePlace`
  resolves against the cities actually loaded for that country.

**Acceptance test for the whole phase:** a user can pick Peru on the map,
see Peruvian cities, tap one, and have it appear in their plan with day counts
and a route leg. Until that passes, Phase 3 is not finished and Phase 4 must
not start.

---

## 6. Phase 4 — Country and region levels for every country

This is the phase that reverses judgement call J14. It depends on Phase 3 for
content, Phase 2 for the L1→L2 transition, and Phase 1 for the airport layer.

### 6.1 L2 — a real country map for all 234

`CountryMap`'s hard-coded `hasDetailLevel(country) === "CN"` becomes a
`COUNTRY_DETAIL` registry. Each country resolves to:

- a **country outline**, sliced per-country from the 50m topology,
- its **cities** from the Phase 3 catalog,
- its **airports** from Phase 1, as a distinct, toggleable, visually subordinate
  layer — never as selectable trip stops.

`public/world-countries.json` (50m, 747 KB) stops being a *client* asset once
Phase 2 ships the 110 KB globe — but it remains the **build-time source** these
per-country outlines are sliced from, so the file and its build script stay.

**Two verified traps:**

- **`geoMercator().fitExtent` is broken across the antimeridian.** FJ, RU, US,
  NZ and KI all fit at world scale (~134), rendering as slivers at both edges
  with ocean between. Needs a per-country projection rotation, chosen at build
  time from each country's `geoBounds`.
- **Server modules cannot read `public/`.** A `lib/server/outline.ts` doing a
  disk read of `public/world-countries.json` works locally and 500s on Vercel.
  `lib/server/catalog.ts` already works around exactly this with a bundle
  import plus an fs override plus a remote fallback. Per-country slices should
  be **static files under `public/`, fetched by the client**, not read by a
  route handler — which also avoids the `force-static` route-handler
  configuration trap entirely.

### 6.2 L3 — province and state boundaries

Natural Earth's coarse admin-1 files are nearly empty: 110m has 51 features
covering **1 country**, 50m has 294 covering **9**. Only the 41 MB 10m file is
global — 4,596 provinces across 241 countries.

Sliced per country into quantised, simplified TopoJSON, it is cheap. Measured:

| | Size |
|---|---|
| Median | **21 KB** |
| p90 | 88 KB |
| Japan / France / Peru / Morocco | 114 / 151 / 65 / 23 KB |
| Worst — Russia / Canada / USA / China | 821 / 719 / 447 / 331 KB |
| All 241 together | 10.1 MB (3.4 MB gzipped) — never shipped together |

**241 per-country files under `public/`, fetched on drill-down** — the same
pattern `public/china-provinces.json` (58 KB) already uses, generalised. Drill
into Peru, fetch 65 KB. The four heavy countries get an extra simplification
pass.

**Degenerate-bounds guard.** `transformForBounds` deliberately does not guard
zero-extent input (`mapTransform.ts:39-47`), so a single-province or
single-point region yields `860/0 = Infinity`, pinning `k` to `MAX_ZOOM_K` and
showing one dot centred over blank magnified coastline. Phase 4 must guard at
the call site, where the caller knows whether the region is real.

### 6.3 China's regions become a grouping layer

China's L3 zooms into one of 7 curated regions — groupings of provinces with
month-by-month climate data. No other country has those. Rather than giving
China a fourth level, **L3 becomes uniformly admin-1**, and China's 7 regions
become an optional grouping *above* it, preserved verbatim so nothing
regresses. `zoomRegion: ChinaRegion | null` widens to a region identifier that
resolves through a per-country provider.

### 6.4 Also in this phase

- **Airport map layer** — toggle in `MapExplorer`, off by default, `large` and
  `medium` only below a zoom threshold. Plus "Nearest airport: TNA · 30 km" on
  a selected city's card.
- **Wizard gateways** — trip gains nullable `arrivalAirport` /
  `departureAirport` (IATA), defaulting to the best airport near the first and
  last cities, with `suggestRoute` anchoring at the arrival gateway. Touches
  the trip schema, zod, a migration, `useTripPayload` and `PlanTab`; ships last.

---

## 7. Phase 5 — Flight data

**Deliberately not specified here.** This phase gets its own brainstorm when
Phases 1–4 have landed, because the right answer depends on what the app looks
like by then. Recording the constraints so the decision starts informed:

- There is **no free, daily-refreshable flight schedule or price feed.**
  Schedules and fares are commercial APIs — Amadeus Self-Service, Duffel, Kiwi.
  Free tiers generally return test data, not bookable fares.
- OpenFlights publishes a free routes dataset, but it has not been maintained
  since ~2014 — usable for "does anyone fly A→B" as a weak prior, not for
  schedules.
- Phase 1 already delivers most of the practical value: real airport pairs,
  real ground-transfer time, and honest rail-vs-fly decisions. Phase 5's
  marginal gain over that should be measured before paying for it.

The decision to make first is scope — schedules, routes, or live prices — since
that determines whether this is a week or a quarter.

---

## 8. Cross-cutting engineering constraints

These apply to every phase and each was verified against this repo.

- **`.test.ts` under `components/` runs in no vitest project.** The node
  project is `lib/**/*.test.ts`; the jsdom project is `components/**/*.test.tsx`
  plus `lib/**/*.test.tsx`. Such a file is silently never executed — no error,
  no skip, a green suite with zero coverage. Pure logic goes in `lib/`.
- **Do not put wizard state in the URL without a Suspense boundary.**
  `app/plan/page.tsx` is a prerendered `"use client"` page and there is no
  `Suspense` anywhere in the repo. Adding `useSearchParams` there triggers
  Next's missing-suspense-with-csr-bailout **build** error. The existing
  `useSearchParams` callers live under `app/trip/[id]`, a dynamic route where
  this does not bite.
- **`vi.mock("next/dynamic")` returns `WorldMap` unconditionally.** Its
  docblock notes this is safe only because `MapExplorer` has exactly one
  `dynamic()` call. Phase 2 adds a second and must make the mock dispatch on
  the loader.
- **No naive `requestAnimationFrame` loop.** The suite's `settle()` helper
  drains `act()` to a fixed point; a loop that never idles means `settle()`
  spins or hangs, and the timeout lever was already used and is closed. Any
  render loop must be dirty-flag-gated and self-stopping.
- **`public/` is not readable from a Vercel function.** Client-fetched static
  assets or bundled imports only.
- **No hex literals in map components.** Colour comes from `lib/accent` and the
  token set; `FIT_COLORS` is the deliberate categorical exception.

---

## 9. Testing strategy

Following the repo's existing split — pure logic in `lib/` under the fast node
project, components under jsdom.

- **Ingest scripts:** fixture input → expected artifact; the abort gate fires
  on a truncated source and on a missing column.
- **`lib/airports.ts`:** multi-airport cities (London → 5+), no-airport-in-range
  → `[]`, IATA-exact beats name-prefix, `foldPlaceName` handles "Zürich"/"Zurich".
- **`lib/route.ts`:** written TDD-first, covering forced-rail-when-no-airport
  and ground-transfer arithmetic.
- **`lib/globeRotation.ts`:** the far-hemisphere point guard, the disc guard
  before invert, and round-tripping `project`/`invert` — all pure, all node.
- **Globe component:** a fixture spanning **both hemispheres**, so the
  back-face keyboard trap is reachable by a test. This is the single most
  important test in Phase 2, because the natural fixture hides the bug.
- **Coverage invariants:** the globe asset reaches the same country set as the
  50m asset; a handful of stable IATA codes (TNA, PEK, LHR, JFK) still resolve
  after a refresh, so a bad daily ingest fails CI rather than shipping.

---

## 10. Open questions

1. **GeoNames threshold.** `cities15000` (34,099) or `cities5000` (69,632)?
   Recommendation: start at 15000, revisit once real usage shows what is
   missing. One-line change.
2. **Enrichment priority.** Which cities get descriptions and images first?
   Default unless overridden: the top 25 by population per country, then
   on-demand for anything a user selects. That bounds the first enrichment run
   at roughly 6,000 cities while guaranteeing every country has *something*.
   Affects Phase 3's tail length, not its architecture.
3. **Whether Phase 5 is worth doing at all** once Phase 1's real airport-pair
   estimates are in place. Deliberately left open.

---

## 11. What to plan next

This is a roadmap, not an implementation plan. **Only Phase 1 should go to
`writing-plans` now** — it is fully specified, self-contained, and depends on
nothing else here.

Phases 2–4 are specified to the depth needed to commit to the *order* and to
avoid painting into a corner; each gets its own plan when the phase before it
lands, because the code will have changed by then. Phase 5 gets a fresh
brainstorm, not a plan.
