# Architecture & Roadmap

*Status page, rewritten 2026-09-07. The design record is
`docs/superpowers/specs/` — one dated design per piece of work, each with a
status line; this page says where things stand and what is open.*

## Where things stand

Thirty pull requests, all rebase-merged, `main` linear. The ones that changed
what the app is:

| Merged | PR | What landed |
|---|---|---|
| 2026-08-12 | #1 | Trip briefing — a shareable read-only trip document |
| 2026-08-15 | #2 | Today & Money tabs — expenses, balances, journal, live trip dashboard |
| 2026-08-15 | #3 | Accounts — email+password auth, server-resolved trip identity |
| 2026-08-15 | #5 | Compulsory login, app shell, trips-first homepage |
| 2026-08-20 | #6 | The planner redesign — seven trip tabs to four, groundwork for all countries |
| 2026-08-21 | #7, #11 | Cleanup; currency — zero-decimal support, live rates, per-trip pivot |
| 2026-08-22 | #16 | Worldwide airports — daily-refreshed dataset, airport-pair routing, flight autocomplete |
| 2026-08-23 | #17 | An orthographic globe as the world-level country picker |
| 2026-08-27 | #21 | The planner works outside China — worldwide city catalog and country guidance |
| 2026-09-02 | #22 | Country and province maps for every country; China standardised; first e2e tests |
| 2026-09-02 | #23 | A trip loads in one round-trip instead of eight |
| 2026-09-03 | #24, #25 | Nightly refresh unbroken (Bosnia's second dinar); functions run in bom1 beside the database |
| 2026-09-03 | #26 | Trip gateways — fly-in and fly-out airports on every trip |
| 2026-09-04 | #27 | Worldwide climate normals (CHELSA) as per-country shards |
| 2026-09-05 | #28 | Climate in the UI — fit colours worldwide, legend, honesty note |
| 2026-09-05 | #29 | The destinations step opens on the globe; drag direction fixed |
| 2026-09-06 | #30 | Backlog clearance — trusted origins, version-guarded writes, server-only guard, splits |

Phases 1–4 of the global-expansion roadmap
(`docs/superpowers/specs/2026-08-23-global-expansion-design.md`) are complete.

## How the planner core works

```
┌──────────────────────────────────────────────────────────────┐
│  app/plan/page.tsx — 3-step wizard (client state)            │
│                                                              │
│  Step 1 DetailsStep           Step 2 DestinationStep         │
│  · month, days, travellers    · globe → country → province   │
│  · interests                  · curated cards, catalog and   │
│                                 GeoNames search              │
│                               · mark "already been"          │
│              │                        │                      │
│              └──────────┬─────────────┘                      │
│                         ▼                                    │
│  Step 3 PlanStep                                             │
│  · buildItinerary(input, destinations)                       │
│  · buildPackingList(input, destinations)                     │
│  · create a shared trip → /trip/[id]                         │
└──────────────────────────────────────────────────────────────┘
   lib/data (16 curated)  ·  data/catalog.json (695 Chinese cities)
   public/cities/<CC>.json (GeoNames, 246 countries)  ·  lib/countryFacts (Wikidata)
```

### The itinerary engine (`lib/itinerary.ts`)

1. **Cap & allocate** — never more cities than days; days split proportionally
   to each destination's suggested stay (min 1 day each).
2. **Score activities** — interest overlap ×3, must-see +2.5, in-season +1,
   wrong season = excluded, kid-friendly boost when kids travel. Seasons are
   the country's own — southern hemisphere included.
3. **Fill slots** — each day has morning/afternoon/evening; full-day activities
   consume both day slots; day 1 starts with arrival, city changes start with a
   transfer block estimated from real airport pairs (and rail where the
   country has it), the last day ends with departure; unused slots become
   labelled free time.
4. **Tips** — the country's facts rendered as sentences (currency, plugs,
   emergency numbers, …), a gap note for what no source supplies, and China's
   hand-written tips for China.

### Shared trips

Trips live in Postgres on Vercel (Supabase, functions pinned to the same
region) and SQLite locally; `/trip/[id]` polls every 4 s while visible. Every
whole-object write is version-guarded (read, apply, write-if-unchanged, retry
three times, then 409). Accounts are Better Auth email+password; a join code is
a view-only key. Details and history: `README.md` and
`docs/superpowers/specs/2026-08-15-accounts-auth-design.md`.

## The data pipeline

| Artifact | Source | Licence | Refreshed by |
|---|---|---|---|
| `data/airports.json` (4,133 airports) | OurAirports | public domain | `Refresh airports`, daily |
| `public/cities/<CC>.json` (58,759 cities, 246 countries) + `data/cities-index.json` | GeoNames cities500 | CC BY 4.0 — credit rendered, contract-tested | `Refresh cities`, daily |
| `public/cities/enrich/<CC>.json` | Wikidata + Wikipedia summaries | CC0 + CC BY-SA | `Refresh cities`, daily |
| `data/country-facts.json` | Wikidata | CC0 | `Refresh cities`, daily |
| `public/climate/<CC>.json` (58,759 rows × 60 ints) | CHELSA V2.1 1981–2010 | CC0 | `Refresh climate`, by hand |
| `public/provinces/<CC>.json`, `country-projections.json`, `world-globe.json`, `world-countries.json` | Natural Earth via `scripts/build-*.mjs` | public domain | when the geometry changes |
| `data/catalog.json` (695 Chinese cities + attractions) | Wikidata + Wikipedia | CC0 + CC BY-SA | `node scripts/ingest-destinations.mjs`, by hand |

Each workflow's header comment records its own gates and why it commits only
on change; each artifact has a `data/*-report.md` beside it.

**Never**: scrape Dianping/Mafengwo/Xiaohongshu (robots.txt-blocked, hostile
anti-bot tech, and litigated under China's Anti-Unfair Competition Law), or
build on unofficial 12306 endpoints. See `RESEARCH.md`.

## What is open

Nothing is scheduled. Two things are designed or named, and both are the
owner's call:

- **Content parity with China.** Outside China a country has facts, tips and a
  climate verdict but no curated cards, foods or hero image. The one designed
  step is the Wikivoyage extraction
  (`docs/superpowers/specs/2026-08-27-wikivoyage-extraction-design.md`,
  2026-08-27, tasks 33–44, not built). Its own conclusion: of 17,093 candidate
  sentences 7.7% pass a structural gate and 28% of those are still defective,
  so it ships nothing without a one-time hand review of ~1,321 sentences
  (about an hour), yields three or four extra sentences for a typical country,
  and leaves the CC BY-SA share-alike question open.
- **Phase 5, flight data.** Deliberately unspecified: there is no free,
  daily-refreshable schedule or fare feed, and Phase 1's real airport-pair
  estimates already deliver most of the practical value. It gets a brainstorm
  before a plan, and the first decision is scope — routes, schedules or live
  prices.

Everything smaller that was left after Phase 4 was closed by PR #30
(2026-09-06) and the two PRs of
`docs/superpowers/specs/2026-09-07-unscheduled-items-design.md`.
