# Worldwide city catalog — Phase 3 design

**Date:** 2026-08-25
**Status:** design, awaiting review
**Supersedes:** §5 of `2026-08-23-global-expansion-design.md`
**Scope:** replacing the 695-city China-only catalog with a worldwide one, and
opening the three gates that keep the app China-bound.

---

## 1. Why this document supersedes spec §5

Phase 3 is "the blocker" — Phase 4 is worthless without it, and the globe
shipped in PR #17 now drops users into an empty room for 234 countries.

Two claims in the parent spec's §5 did not survive checking, and both change the
design:

**§5.2 justified moving cities to Postgres via "a migration in the existing
`lib/server/migrate.ts` pattern."** `lib/server/migrate.ts` is 42 lines that
rewrite trip-plan day-item ids. There is no SQL migration runner. The real
schema mechanism is `ensureSchema()` in `lib/server/pgStore.ts:47`, which runs
idempotent `CREATE TABLE IF NOT EXISTS` on *every request* and has no home for
seeding tens of thousands of rows.

**§5.1 chose GeoNames `cities15000` and called the threshold "a one-line change
if it proves too coarse."** It proves too coarse — see §2.

The parent spec's *sizing* for `cities15000` was exactly right (3.6 MB trimmed /
0.81 MB gzipped, confirmed by measurement). Its threshold choice was not.

---

## 2. The finding that sets the design: population is the wrong axis

Measured against the live GeoNames dumps (`Last-Modified: Mon, 24 Aug 2026`):

| dump | rows | trimmed | gzip | Peru | France | Japan | China |
|---|---|---|---|---|---|---|---|
| cities15000 | 34,107 | 3.6 MB | 0.81 MB | 140 | 692 | 1,300 | 2,113 |
| cities5000 | 69,641 | 7.4 MB | 1.61 MB | 305 | 2,075 | 1,799 | 2,886 |
| cities1000 | 170,809 | 18.1 MB | 3.72 MB | 1,773 | 8,940 | 2,159 | 4,964 |
| cities500 | 235,483 | 24.8 MB | 4.96 MB | 2,296 | 15,363 | 2,189 | 16,049 |

At population ≥ 15,000, **every one** of these is absent from the app:

> Zermatt (6,629) · Banff (8,305) · Interlaken (5,067) · Positano (2,334) ·
> Queenstown NZ (10,442) · Hallstatt (779) · Oia (1,087) · Chamonix (10,614) ·
> Hakone (11,293) · Sa Pa (10,554) · Petra/Wādī Mūsá (14,000) · Kotor (5,345) ·
> Giverny (564) · Santorini

`cities1000` recovers 11 of 14 — and hands France 8,940 cities and China 4,964.
**The threshold that contains Zermatt also contains every French commune.** No
population cutoff resolves this, because population does not measure whether
anyone travels somewhere.

### 2.1 The signal that does work

Composite score, ranked **within each country**:

```
score = altNameCount + 2 · log₁₀(population)
```

`altNameCount` is the size of the alternate-names column already present in the
dump — no second source, no extra fetch. It is a notability proxy: Zermatt
carries 22 alternate names, a French commune of comparable size carries 0–6.

Alone it is not a clean separator (tourist towns run 9–26, communes 0–12, and
they overlap). Ranked *within country* it separates well, because it is compared
against local baselines rather than a global threshold:

| town | rank / country pool |
|---|---|
| Cusco PE | 2 / 2,296 |
| Wadi Musa (Petra) JO | 18 / 148 |
| Queenstown NZ | 23 / 732 |
| Hallstatt AT | 27 / 3,045 |
| Kotor ME | 30 / 66 |
| Zermatt CH | 36 / 1,897 |
| Interlaken CH | 38 / 1,897 |
| Positano IT | 74 / 11,855 |
| Banff CA | 87 / 3,295 |
| Fira (Santorini) GR | 167 / 1,986 |
| Sa Pa VN | 328 / 913 |
| Hakone JP | 453 / 2,189 |
| Chamonix FR | 606 / 15,363 |
| Oia GR | 717 / 1,986 |
| Giverny FR | 1,503 / 15,363 |

Validation beyond the target list — the ranking is genuinely tourism-weighted,
and works where alternate-name data is sparse:

- **Peru top 8:** Lima, Cusco, Callao, Trujillo, Arequipa, Pucallpa, Huancayo,
  Puerto Maldonado.
- **Kenya top 8:** Nairobi, **Malindi** (beach), Mombasa, Garissa, Eldoret,
  **Naivasha** (safari), Wajir, Kisumu — resort towns surfacing above larger
  administrative cities.

**Chosen cutoff: pool = `cities500`, keep top 750 per country** → ~59,000
cities, 244 countries, ~4.5 MB raw / ~1.15 MB gzipped. That captures **13 of
the 14 destinations** the ≥15,000 filter excluded entirely — every one but
Giverny. (Santorini is an island, not a GeoNames city; it is represented by its
main towns Fira and Oia, both of which make the cut.)

> These MB figures are estimates, scaled from a measured 3-field record to the
> full 8-field shape. Measure exactly during implementation and record the real
> numbers in `data/cities-report.md`.

**Known limitation:** ranking is a heuristic validated by spot-check (11 towns,
4 countries), not a proof. Giverny (1,503/15,363) stays out. That is acceptable:
Giverny is a place you visit from Vernon, not a place you sleep — it belongs in
the attractions layer, not the city catalog.

---

## 3. Architecture

### 3.1 Ingest

New `scripts/ingest-cities.mjs`, modelled on `scripts/ingest-airports.mjs`:

1. Fetch and unzip `cities500.zip` from GeoNames (12.9 MB zipped, 38 MB TSV).
2. Score every row (§2.1).
3. Rank within country; keep top 750.
4. Deduplicate against the existing 695 Wikidata cities (§3.3).
5. Enrich the top 30 per country (§4).
6. Emit shards, index, and `data/cities-report.md`.

Daily `.github/workflows/refresh-cities.yml`, mirroring `refresh-airports.yml`:
scheduled cron, `contents: write` least privilege, a concurrency group, and a
`git diff --quiet` guard so an unchanged day produces no commit. A commit
triggers a Vercel deploy, so the artifact reaches production unattended.

### 3.2 Storage

```
public/cities/PE.json        ~750 rows, ~60 KB   fetched on drill-down
public/cities/index.json     244 × { code, count, generatedAt }
data/cities-index.json       bundled: id → { name, country, lat, lon }
```

Per-country static shards, the pattern `public/china-provinces.json` already
uses and the one `map-subsystem-constraints` recommends for per-country data.
Picking Peru fetches `PE.json`. CDN-cached, no cold-start parse, no database.

**Hard constraint:** `public/` is not readable from a Vercel lambda. Nothing
server-side may `fs.read` a shard — it works locally and 500s in production.
`data/cities-index.json` is bundled precisely so server routes
(`resolveDestinations`) never need one.

Ranking decides **inclusion only**. Shards sort by population for display, so
the score's quirks never surface in the UI. (Dunkirk outranks Lyon in France —
wartime fame inflates alternate names.)

### 3.3 Identity and deduplication

`CatalogCity.qid` holds a Wikidata QID (`Q170247`), and
`MapExplorer.togglePlace` resolves taps via `cities.find(c => c.qid === place.id)`.
GeoNames ids are bare integers. Merging those namespaces silently would be a
real bug.

- GeoNames cities get **`G` + geonameid** (`G3936456`).
- The 695 existing China cities **keep their Wikidata QIDs**, so their existing
  enrichment survives and no trip data migrates.
- Per-country dedup: a GeoNames row within ~5 km of an existing QID city whose
  folded name matches (`lib/foldPlaceName.ts`) is dropped in favour of the
  richer QID record.

`CatalogHit`'s shape does not change.

---

## 4. Enrichment

GeoNames carries name, coordinates, population, admin-1 and timezone. It carries
no descriptions, no images, no interest tags. A naive port would trade 695 rich
cities for 59,000 thin ones — a regression in feel even as it is a coverage win.

Enrichment is a separate layer keyed by GeoNames id, stored apart from the base
shard so a re-ingest never discards it:

- **Build time:** top 30 per country (~7,300 cities) get a Wikipedia summary and
  Wikimedia image, reusing the fetch machinery in `ingest-destinations.mjs`.
  This fits a GitHub Action comfortably.
- **Run time:** the first selection of an unenriched city triggers a lazy fetch,
  cached by id.
- **Preserved:** the 695 existing China cities are matched by coordinate and
  name, not re-fetched.

A city with no enrichment renders exactly as a thin catalog city does today,
which is already an accepted state in the current UI.

---

## 5. Opening the three gates

Phase 3 is not done until all three are open.

| gate | location | change |
|---|---|---|
| catalog allowlist | `components/plan/PlaceSearch.tsx:44` | delete `CATALOG_COUNTRIES`; scope search to the active country's shard |
| defaulting hack | `components/DestinationStep.tsx:69,121,126`, `components/map/MapExplorer.tsx:178`, `lib/tripShared.ts:24` | all 16 curated destinations gain explicit `country: "CN"`; remove the `?? "CN"` fallback so a future destination cannot silently claim China |
| China-only route | `lib/server/catalog.ts:241`, `app/api/map/cities/route.ts` | `mapCities(country)` and `?country=PE`; `MapExplorer.togglePlace` resolves against the cities loaded for that country |

`searchCities`, `mapCities` and `resolveDestinations` keep their names and return
types. Only their bodies and one signature change, so callers outside these
gates do not move.

**Acceptance test for the phase:** a user picks Peru on the globe, sees Peruvian
cities, taps one, and it appears in their plan with day counts and a route leg.
Until that passes, Phase 3 is not finished and Phase 4 must not start.

---

## 6. Testing

`scripts/**/*.test.ts` runs in the node project; `components/**/*.test.tsx` runs
in jsdom. **There are 0 tests under `app/`, and neither project includes that
path** — a test file placed there sits on disk and never runs, the same trap
`vitest.config.mts` documents for `scripts/`. Therefore country-parameter
parsing and validation live in `lib/`, and `route.ts` stays a thin wrapper with
nothing worth testing in it.

- **`scripts/ingest-cities.test.ts`** — scoring, per-country ranking, dedup
  against QID cities, and an `assertSane` that **aborts the build** when any
  country disappears, the row count moves more than ~10%, or a known-destination
  fixture (Cusco, Zermatt, Kyoto, Jinan) drops out. The job runs unattended and
  auto-deploys; this is the gate between a corrupt upstream feed and production.
- **`lib/server/catalog.test.ts`** — extended for country scoping.
- **`components/map/*.test.tsx`** — the Peru drill-down renders real cities and a
  tap resolves.

**Fixture invariant.** PR #17's globe fixture was wound inside-out and made a
whole class of back-face tests green and hollow. City fixtures carry an explicit
invariant: every fixture city must have a country present in the shard index.

---

## 7. Licence and attribution

GeoNames is **CC BY 4.0** — attribution required. This differs from
OurAirports and Natural Earth, both public domain, and it is the app's first
attribution-required source.

The app must carry a **visible** GeoNames credit in the UI, not only a line in
`data/cities-report.md`. This is a licence obligation, not a nicety, and is the
one item in this design with legal weight.

---

## 8. Risks

1. **`cities500` is a 12.9 MB unconditional download in CI, daily** (13,533,683
   bytes zipped; 38 MB unzipped TSV). Airports is far smaller. The
   commit-on-change guard limits deploys, not the download.
2. **Attribution is a licence obligation** (§7).
3. **~59,000 cities across 244 shards is a large new surface**, and Phase 4
   depends on all of it.
4. **The composite score is a heuristic** validated by spot-check, not proof
   (§2.1).
5. **`public/` is unreadable from a lambda.** Any server module that reads a
   shard works locally and 500s in production (§3.2).

---

## 9. Decisions taken

| decision | choice | rationale |
|---|---|---|
| scope | all of §5 in one branch | user's call; enrichment ships with coverage |
| city selection | population **or** notability, top 750/country from `cities500` | population alone excludes 14 of 14 sampled destinations (§2) |
| storage | per-country static shards | avoids Postgres seeding, matches an existing pattern (§3.2) |
| enrichment | top 30/country at build, on-demand after | fits a GitHub Action; matches §5.3's priority order |
