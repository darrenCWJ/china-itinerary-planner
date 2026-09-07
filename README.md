# China Itinerary Planner 游

**Live**: <https://china-itinerary-planner.vercel.app> · **Source**: <https://github.com/darrenCWJ/china-itinerary-planner>

Plan a trip to any country in three steps — pick places on a globe and a
country map, say when and who is going, get a day-by-day plan — then take
everyone along: shared trips with accounts, a live-syncing itinerary you can
tick off mid-trip, tickets, packing, money and a journal. It began as a China
planner and China is still the deepest country, with 16 curated destinations
and a catalog of every Chinese city; beside them sits a worldwide catalog of
58,759 GeoNames cities across 246 countries.

## Features

### Planning
- **A globe, then a country, then its provinces** — the destinations step
  opens on an orthographic globe; every one of 246 countries opens to a map
  drawn from Natural Earth admin-1 units, with a province picker for the 212
  that have more than one. Search reaches every place the map cannot.
- **Places to pick** — 16 curated Chinese destinations with what each is
  **known for**, seasonal notes, signature foods and interest-tagged
  activities; a Wikidata catalog of 695 Chinese cities with their attractions;
  and a GeoNames shard for every country — cities ranked for notability rather
  than size, the top 30 per country carrying a Wikipedia summary.
- **When to go** — every city is coloured by how good the chosen month is:
  China from its curated climate tables, everywhere else from CHELSA 1981–2010
  normals with an elevation correction, under a legend and a note that says
  what the model does not know.
- **Airports and gateways** — an airport layer on every country map, a
  suggested route with real airport-pair estimates, and fly-in/fly-out
  gateways stamped on every trip.
- **Country facts as tips** — currency, voltage and plugs, emergency numbers,
  driving side, calling code and languages from Wikidata; a gap note names
  what no source supplies rather than guessing.
- **Smart itinerary generator** — allocates days across cities, fills
  morning/afternoon/evening slots, respects seasons in both hemispheres,
  boosts must-sees and your interests, inserts arrival, transfer and departure
  blocks.
- **Packing list builder** — season-, interest- and destination-aware.
- **"Already been" tracking** — visited places drop out of selection and can
  be restored any time.

### Travelling together (shared trips)
- Turn any plan into a **shared trip**: members sign in, and a 6-letter join
  code gives anyone a read-only view of the same live itinerary.
- **Shared ticking** — packing items and activities can be checked off by any
  member, with attribution ("done by Bob"), synced to all members within
  seconds (polling).
- **Trip-app mode** — set a start date and the current day is badged **TODAY**;
  keep the page open on your phone during the trip.

### During the trip
- **Plan tab** — the day-by-day plan, editable by any member, with the route
  map and the gateways strip.
- **Today tab** — countdown before departure; during the trip a live
  dashboard: day X of Y, now/next by time of day, tick-off synced with the
  itinerary, spend snapshot and stats; a recap once you're home.
- **Kit tab** — tickets, trains and stays with airport autocomplete for
  flights, and the packing list.
- **Money tab** — multi-currency group expenses with equal splits,
  per-currency totals, optional converted totals via manual rates,
  who-owes-whom balances, settle-up suggestions and repayment tracking.
- **Trip journal** — day-by-day entries from any member, with photo uploads
  on self-hosted installs (writable disk) and photo links everywhere.

### API-first
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/trips` | POST | Create a shared trip (returns id + join code) |
| `/api/trips/:id` | GET · PATCH | Trip state (member session = full; `?code=` = guest view; else 403) · update the input, plan regenerates (version-guarded) |
| `/api/trips/:id/plan` | POST | One member edit to the plan — add, update, remove or move an item, add a day (version-guarded) |
| `/api/trips/:id/join` | POST · GET | Join/claim with account + code · list claimable names |
| `/api/trips/:id/checks` | POST | Tick/untick an item `{ key, checked }` (attributed to the signed-in member) |
| `/api/trips/:id/tickets` (+`/:ticketId`) | POST · PATCH/DELETE | Tickets and bookings (members only) |
| `/api/trips/:id/expenses` (+`/:expenseId`) | POST · PATCH/DELETE | Group expenses (members only) |
| `/api/trips/:id/settlements` (+`/:settlementId`) | POST · DELETE | Repayments (members only) |
| `/api/trips/:id/journal` (+`/:entryId`) | POST · PATCH/DELETE | Journal (edits author-only) |
| `/api/trips/:id/currency` | PUT | Home currency + conversion rates (version-guarded) |
| `/api/trips/:id/gateways` | PUT | Arrival and departure airports, IATA or null (members only; never rebuilds the plan) |
| `/api/trips/:id/briefing` | GET · POST | Read the share-link state · create, toggle or revoke the share link (members only) |
| `/api/trips/:id/photos` (+`/:photoId`) | POST · GET | Photo upload/serve (writable hosts) |
| `/api/me/trips` | GET | Signed-in user's trips |
| `/api/me/prefs` | GET · PUT | The signed-in user's preferences (accent, globe or flat world) |
| `/api/auth/*` | * | Better Auth (signup, login, sessions, admin) |
| `/api/destinations` | GET | Search the Wikidata catalog of Chinese cities (`?q=&country=`) |
| `/api/destinations/resolve` | GET | Full plannable data for catalog and GeoNames ids (`?ids=`) |
| `/api/destinations/refresh` | POST · GET | **Self-update**: re-run the Wikidata/Wikipedia ingestion (local only) · catalog status (age, counts, refresh running?) |
| `/api/map/cities` | GET | The Wikidata catalog's cities for one country (`?country=`) |
| `/api/map/airports` | GET | One country's airports, for the map layer and the route estimator (`?country=`) |
| `/api/airports/search` | GET | Airport autocomplete for flight tickets and gateways (`?q=`) |
| `/api/cities/enrich` | GET | Wikipedia enrichment for cities the build did not pre-fetch (signed in) |
| `/api/rates` | GET | A cached exchange-rate table, for display only (`?base=`, signed in) |
| `/api/wallet` · `/api/wallet/fetch` · `/api/wallet/put` | POST | This device's trip list, synced by a secret code: create · fetch · version-guarded replace |

All inputs are validated with Zod. Trip state lives in Postgres on Vercel and
in SQLite locally — see Deploying.

## Getting started

```bash
npm install
cp .env.example .env.local     # optional; see Environment variables
npm run dev                    # every data artifact is committed — this is a working app
npm test                       # unit tests (Vitest: a node project and a jsdom project)
npm run test:e2e               # Playwright, against a dev server it starts on :3100
npx next build                 # what CI runs after the tests
```

`.env.local` is optional locally: with no `BETTER_AUTH_SECRET` the app runs in
no-accounts mode, with the login wall off and everything open. Fill the secret
in to exercise accounts and the wall.

### Data, and how it refreshes

Every artifact the app reads is committed, so a clone runs without any ingest.
Three workflows keep them fresh — each commits only when its artifact changed,
and a commit deploys itself; the fourth, CI, runs on every push and pull
request.

| Workflow | When | Runs | Source (licence) |
|---|---|---|---|
| Refresh airports | daily, 08:23 UTC | `scripts/ingest-airports.mjs` | OurAirports (public domain) |
| Refresh cities | daily, 08:53 UTC, three jobs | `ingest-cities.mjs` → `enrich-cities.mjs` → `ingest-country-facts.mjs` | GeoNames cities500 (CC BY 4.0) · Wikidata (CC0) + Wikipedia summaries (CC BY-SA) |
| Refresh climate | by hand (`workflow_dispatch`) | `scripts/ingest-climate.mjs` | CHELSA V2.1 1981–2010 (CC0), ~10.7 GB of rasters |
| CI | every push and PR | `npm test`, `next build`, Playwright | — |

The province, projection, globe and world topologies are built from Natural
Earth (public domain) by `scripts/build-*.mjs` when the geometry changes, and
the China catalog (`data/catalog.json`) by hand:
`node scripts/ingest-destinations.mjs` (~5–10 min), commit, redeploy. GeoNames
data is CC BY 4.0 — the credit renders on every surface that shows a city name,
and `lib/contracts.test.ts` fails the build if it ever does not.

## Project layout

```
app/                  /plan wizard, / trips home, /trip/[id], /b/[code] briefing, /login + /signup, /account, /api routes
components/
  auth/  briefing/  home/  plan/  shell/  trip/
  map/                the globe, the country map (CountryLevel + UnitsLayer/AirportLayer/MarkerLayer, countryView, markerGeometry, markerLayout, useMarkerSelection), the province level, hooks
lib/                  pure planning logic, shared types, clients (+ tests beside each module)
  data/               the 16 curated destinations
  server/             airports, catalog, cityIndex (server-only artifacts); auth, session, stores (sqlite + postgres), schemas
  contracts.test.ts   whole-tree contracts: one nav, one credit per surface, no second fetch of trip data
scripts/              ingest-*.mjs and enrich-cities.mjs (entries) with their modules under scripts/{climate,cities,enrich,country-facts}/; build-*.mjs (geometry); sample-climate-anchors.mjs
data/                 committed artifacts and their reports (airports, catalog, cities-index, country-facts, climate anchors)
public/               cities/<CC>.json, provinces/<CC>.json, climate/<CC>.json (246 each), country-projections.json, world-globe.json
e2e/                  Playwright specs and the saved session (auth.setup.ts)
test/                 shared test harnesses that must live outside the contract-scanned roots
docs/
  PLAN.md             Where things stand and what is open
  RESEARCH.md         Data-source research (APIs, open data, scraping legality), August 2026
  superpowers/        specs (the design record), plans, handoffs
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

**Keep the functions next to the database.** `vercel.json` pins the
serverless functions to `bom1` (Mumbai), the same AWS region as the Supabase
project (`ap-south-1`). Left at Vercel's default they ran in `iad1`
(Washington DC), so every database round trip crossed the planet: a cold
instance runs 22 schema statements before its first query, and the first
`/api/auth/get-session` after idle measured 6–7 s against 0.35 s warm. If
the database ever moves, move the region with it.

### Environment variables

| Variable | Effect |
|---|---|
| `DATABASE_URL` | Postgres (Supabase) connection string — enables shared trips |
| `ACCESS_CODE` | Family invite code required to create an account. Unset = open signups. (No longer a site-wide gate — signed-out visitors land on /login instead.) |
| `CATALOG_URL` | Optional: override the remote catalog fallback URL |
| `BETTER_AUTH_SECRET` | Enables accounts. 32 random bytes — `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Unset locally = accounts off; unset (or an example value) on a deployment = boot refused |
| `BETTER_AUTH_URL` | Base URL of this deployment (e.g. `http://192.168.1.20:3000` on a Pi) |
| `TRUSTED_ORIGINS` | Comma-separated extra origins allowed to call the auth API. On Vercel (with system environment variables exposed, the default) the deployment URL, its git-branch alias and the production domain are trusted without it; the bare `<project>-<team>.vercel.app` alias is not |
| `ADMIN_USER_IDS` | Comma-separated account ids that may reset other members' passwords |

> Upgrading note: ACCESS_CODE alone no longer locks the site. If you
> previously relied on it without accounts, set BETTER_AUTH_SECRET before
> upgrading — otherwise the site is open.
>
> Old `/unlock` bookmarks now 404 — harmless, that page was retired along
> with the unlock gate.

**Rotating `BETTER_AUTH_SECRET`.** Safe to do any time. Set a new value and
redeploy: everyone is signed out (the secret signs session cookies) but
passwords survive — Better Auth salts each one separately, the secret is not
part of the hash. Nothing else needs migrating; old rows in `session` become
dead weight and can be deleted. On Vercel the change needs a redeploy to take
effect, since the auth instance is cached per process. A blank value makes the
deployment fail to start (see `instrumentation.ts`) rather than quietly
reopening the site.

The catalog refresh endpoint is local-only (serverless filesystems are
read-only): rerun `node scripts/ingest-destinations.mjs`, commit, redeploy.
