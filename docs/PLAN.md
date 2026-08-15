# Architecture & Roadmap

## Shipped in v2 (2026-08-10)

- **Shared trips**: SQLite-backed trips with join codes, members, and shared
  checklists; `/trip/[id]` polls every 4 s (visible tabs only) so all members
  stay in sync. Server rebuilds the plan on PATCH so every client renders the
  same snapshot.
- **All-China catalog**: `scripts/ingest-destinations.mjs` pulls every Chinese
  city + notable attractions from Wikidata/Wikipedia into
  `data/catalog.json`; `lib/server/catalog.ts` converts any catalog city into
  a plannable destination (attractions become activities). Search UI on the
  destinations step.
- **Self-update API**: `POST /api/destinations/refresh` re-runs the ingestion
  in a detached process with a lock file; `GET` reports catalog age/counts.

### Trust model (deliberate MVP)
Members are plain names gated by a join code — no accounts, no passwords.
Fine for friends+family; before public hosting add real identity (e.g.
Auth.js) and per-member sessions. Checks are keyed `day:N:idx` /
`pack:group:item`, so regenerating a plan can orphan old schedule ticks —
accepted for now.

Update 2026-08: done — Better Auth email+password accounts with per-member
sessions; join codes demoted to view-only keys (spec:
docs/superpowers/specs/2026-08-15-accounts-auth-design.md).

Update 2026-08 (2): login-first shell — signed-out visitors land on /login;
ACCESS_CODE now gates signup instead of the whole site (spec:
docs/superpowers/specs/2026-08-16-app-shell-login-design.md).

## How the planner core works (Phase 1 — shipped)

```
┌────────────────────────────────────────────────────────┐
│  app/page.tsx — 3-step wizard (client state)           │
│                                                        │
│  Step 1 DestinationStep   Step 2 DetailsStep           │
│  · region filter          · season                     │
│  · select destinations    · days / travellers          │
│  · mark "already been"    · interests                  │
│         │                        │                     │
│         └──────────┬─────────────┘                     │
│                    ▼                                   │
│  Step 3 PlanStep                                       │
│  · buildItinerary(input, DESTINATIONS)                 │
│  · buildPackingList(input, destinations)               │
│  · print / save as PDF                                 │
└────────────────────────────────────────────────────────┘
        lib/data (curated TS dataset, 16 destinations)
        localStorage: visited destinations
```

### The itinerary engine (`lib/itinerary.ts`)

1. **Cap & allocate** — never more cities than days; days split proportionally
   to each destination's suggested stay (min 1 day each).
2. **Score activities** — interest overlap ×3, must-see +2.5, in-season +1,
   wrong season = excluded, kid-friendly boost when kids travel.
3. **Fill slots** — each day has morning/afternoon/evening; full-day activities
   consume both day slots; day 1 starts with arrival, city changes start with a
   high-speed-rail block, the last day ends with departure; unused slots become
   labelled free time.
4. **Tips** — general China travel tips + per-destination seasonal notes.

## Phase 2 — Enrich with open data (no scraping needed)

Per [RESEARCH.md](RESEARCH.md), Tier 1 sources:

- **Wikidata (CC0)**: attraction entities, Chinese names, coordinates, images →
  build-time script that augments `lib/data` (keep the curated voice, add
  facts/photos).
- **Wikivoyage (CC BY-SA)**: See/Do/Eat listings via the `wikivoyage-listings`
  extractor → candidate activities per city with attribution.
- **Open-Meteo (CC BY)**: precompute monthly climate normals per city →
  replace hand-written season notes with real averages ("Beijing in Oct:
  8–19°C, 20mm rain").
- **Static HSR matrix**: durations for the top ~50 city pairs → smarter
  multi-city routing (order cities to minimise travel, warn on long hops).

## Phase 3 — Live integrations (official channels only)

- **Klook affiliate**: deep-link "Book this" buttons on activities
  (Disneyland, Ice Festival tickets…), which also monetises the app.
- **Trip.com affiliate**: hotel and train-ticket handoff links per city/date.
- **AMap via Alibaba Cloud Marketplace** (10k free calls/mo): POI search and
  maps if/when we add an interactive map view. Convert GCJ-02 → WGS-84
  (`eviltransform`) before plotting on OSM tiles.

**Never**: scrape Dianping/Mafengwo/Xiaohongshu (robots.txt-blocked, hostile
anti-bot tech, and litigated under China's Anti-Unfair Competition Law), or
build on unofficial 12306 endpoints.

## Phase 4 — Product ideas

- Shareable plan URLs (encode trip input in the URL, no backend needed).
- Multi-city route optimiser using the HSR matrix.
- Budget estimator (per-city daily cost bands × travellers × days).
- i18n: Chinese/English toggle.
- PWA/offline mode — the plan is most useful mid-trip, behind the Great
  Firewall, on a train.
- Deploy to Vercel (static output, zero config).
