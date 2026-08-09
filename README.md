# China Itinerary Planner 游

Plan a trip to China in three steps — then take everyone along: shared trips
with join codes, a live-syncing itinerary you can tick off mid-trip, and a
searchable catalog of **every city in China**, not just the highlights.

## Features

### Planning
- **16 curated featured destinations** (Beijing, Shanghai, Chengdu, Sanya,
  Harbin, Zhangjiajie…) with what each is **known for**, seasonal notes,
  signature foods and interest-tagged activities.
- **All-China catalog** — search any city in the country (ingested from
  Wikidata + Wikipedia, with notable attractions mapped to each city) and add
  it to your trip alongside the curated picks.
- **"Already been" tracking** — visited places drop out of selection
  (localStorage) and can be restored any time.
- **Smart itinerary generator** — allocates days across cities, fills
  morning/afternoon/evening slots, respects seasons, boosts must-sees and your
  interests, inserts arrival/rail-transfer/departure blocks.
- **Packing list builder** — season-, interest- and destination-aware.

### Travelling together (shared trips)
- Turn any plan into a **shared trip**: you get a short link and a 6-letter
  join code; everyone who joins sees the same live itinerary.
- **Shared ticking** — packing items and activities can be checked off by any
  member, with attribution ("done by Bob"), synced to all members within
  seconds (polling).
- **Trip-app mode** — set a start date and the current day is badged **TODAY**;
  keep the page open on your phone during the trip.

### API-first
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/trips` | POST | Create a shared trip (returns id + join code) |
| `/api/trips/:id` | GET | Fetch live trip state (`?member=` for member view) |
| `/api/trips/:id` | PATCH | Update trip input — plan regenerates server-side |
| `/api/trips/:id/join` | POST | Join with `{ name, code }` |
| `/api/trips/:id/checks` | POST | Tick/untick an item `{ memberName, key, checked }` |
| `/api/destinations` | GET | Search the all-China catalog (`?q=`) |
| `/api/destinations/resolve` | GET | Full plannable data for catalog ids (`?ids=`) |
| `/api/destinations/refresh` | POST | **Self-update**: re-run the Wikidata/Wikipedia ingestion |
| `/api/destinations/refresh` | GET | Catalog status (age, counts, refresh running?) |

All inputs are validated with Zod; trip state lives in SQLite (`data/app.db`).

## Getting started

```bash
npm install
node scripts/ingest-destinations.mjs   # build the all-China catalog (once; ~5-10 min)
npm run dev                            # start the app
npm test                               # unit tests
```

The app works without the catalog too — you just get the 16 curated
destinations until it's generated.

## Project layout

```
app/                Wizard page, /trip/[id] shared trip page, /api routes
components/         Wizard steps, CatalogSearch, TripView (live trip UI)
lib/
  data/             Curated destination dataset
  itinerary.ts      Scheduling engine (+ tests)
  packing.ts        Packing list builder (+ tests)
  tripShared.ts     Types shared between client, server and API payloads
  server/
    db.ts           SQLite connection + schema
    tripStore.ts    Trip/member/check repository (+ tests)
    catalog.ts      All-China catalog loading, search, plan conversion (+ tests)
    planService.ts  Server-side plan snapshot builder
    schemas.ts      Zod validation for every API input
scripts/
  ingest-destinations.mjs   Wikidata/Wikipedia → data/catalog.json
docs/
  RESEARCH.md       Data-source research (APIs, open data, scraping legality)
  PLAN.md           Architecture and roadmap
```

## How "many people can join" works

No accounts: a trip is an unguessable id + a join code. Members are just
names. Anyone with the invite link (or the code) can join; only members can
tick items or edit the trip. This is deliberately lightweight for
friends-and-family use — see docs/PLAN.md for the auth upgrade path.

## Deploying

Runs anywhere Node runs. For Vercel, swap SQLite for a hosted database
(Neon/Turso via the Vercel Marketplace) — the storage layer is isolated in
`lib/server/tripStore.ts` + `lib/server/db.ts` precisely so this is a
one-file change. `data/catalog.json` deploys as a static file; the refresh
endpoint should then be wired to a cron instead of spawning a local process.
