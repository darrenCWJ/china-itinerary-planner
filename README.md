# China Itinerary Planner 游

**Live**: <https://china-itinerary-planner.vercel.app> · **Source**: <https://github.com/darrenCWJ/china-itinerary-planner>

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

### During the trip
- **Tracker tab** — countdown before departure; during the trip a live
  dashboard: day X of Y, now/next by time of day, tick-off synced with the
  itinerary, spend snapshot and stats (cities reached, rail km); a recap
  once you're home.
- **Trip journal** — day-by-day entries from any member, with photo uploads
  on self-hosted installs (writable disk) and photo links everywhere.
- **Money tab** — multi-currency group expenses with equal splits,
  per-currency totals, optional converted totals via manual rates,
  who-owes-whom balances, settle-up suggestions and repayment tracking.

### API-first
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/trips` | POST | Create a shared trip (returns id + join code) |
| `/api/trips/:id` | GET | Fetch trip state (member session = full; `?code=` = guest view; else 403) |
| `/api/trips/:id` | PATCH | Update trip input — plan regenerates server-side |
| `/api/trips/:id/join` | POST · GET | Join/claim with account + code · list claimable names |
| `/api/trips/:id/checks` | POST | Tick/untick an item `{ key, checked }` (attributed to the signed-in member) |
| `/api/me/trips` | GET | Signed-in user's trips |
| `/api/auth/*` | * | Better Auth (signup, login, sessions, admin) |
| `/api/destinations` | GET | Search the all-China catalog (`?q=`) |
| `/api/destinations/resolve` | GET | Full plannable data for catalog ids (`?ids=`) |
| `/api/destinations/refresh` | POST | **Self-update**: re-run the Wikidata/Wikipedia ingestion |
| `/api/destinations/refresh` | GET | Catalog status (age, counts, refresh running?) |
| `/api/trips/:id/briefing` | GET | Read the current share-link state (members only) |
| `/api/trips/:id/briefing` | POST | Create, toggle or revoke the share link (members only) |
| `/api/trips/:id/expenses` (+`/:expenseId`) | POST · PATCH/DELETE | Group expenses (members only) |
| `/api/trips/:id/settlements` (+`/:settlementId`) | POST · DELETE | Repayments (members only) |
| `/api/trips/:id/journal` (+`/:entryId`) | POST · PATCH/DELETE | Journal (edits author-only) |
| `/api/trips/:id/currency` | PUT | Home currency + conversion rates |
| `/api/trips/:id/photos` (+`/:photoId`) | POST · GET | Photo upload/serve (writable hosts) |

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

The app is login-first: every member signs in before doing anything, and
creating an account requires the family invite code. Accounts (email +
password) own editing: members sign in once and their trips follow them
to any device. A trip's join code is now a **view key** —
anyone holding it can see the itinerary and packing lists (read-only,
nothing personal), while joining as an editing member requires an account
plus the code. Pre-account members are preserved: sign up and claim your
old member name to inherit everything you ticked, spent and wrote. The
bare trip link without the code shows only a private screen. Password
resets are admin-assisted (`ADMIN_USER_IDS`) — no email service needed.

## Deploying

Deployed on Vercel at <https://china-itinerary-planner.vercel.app>. The
Vercel project's install command pulls the latest `main` tarball from GitHub,
so **any redeploy ships the newest committed code**.

Storage picks its backend from the environment (`lib/server/store.ts`):

- `DATABASE_URL` set → **Postgres** (e.g. Supabase — use the *transaction
  pooler* connection string, port 6543)
- no `DATABASE_URL`, local machine → SQLite in `data/app.db`
- no `DATABASE_URL` on Vercel → shared-trip endpoints return 503 with
  instructions (the planner and catalog still work fully)

To enable shared trips in production: Supabase → create a free project →
copy the pooled connection string → Vercel project → Settings →
Environment Variables → add `DATABASE_URL` → redeploy. Tables are created
automatically on first use.

### Environment variables

| Variable | Effect |
|---|---|
| `DATABASE_URL` | Postgres (Supabase) connection string — enables shared trips |
| `ACCESS_CODE` | Family invite code required to create an account. Unset = open signups. (No longer a site-wide gate — signed-out visitors land on /login instead.) |
| `CATALOG_URL` | Optional: override the remote catalog fallback URL |
| `BETTER_AUTH_SECRET` | Enables accounts (any long random string). Unset = account features 503 |
| `BETTER_AUTH_URL` | Base URL of this deployment (e.g. `http://192.168.1.20:3000` on a Pi) |
| `TRUSTED_ORIGINS` | Comma-separated extra origins allowed to call the auth API |
| `ADMIN_USER_IDS` | Comma-separated account ids that may reset other members' passwords |

> Upgrading note: ACCESS_CODE alone no longer locks the site. If you
> previously relied on it without accounts, set BETTER_AUTH_SECRET before
> upgrading — otherwise the site is open.
>
> Old `/unlock` bookmarks now 404 — harmless, that page was retired along
> with the unlock gate.

The catalog refresh endpoint is local-only (serverless filesystems are
read-only): rerun `node scripts/ingest-destinations.mjs`, commit, redeploy.
