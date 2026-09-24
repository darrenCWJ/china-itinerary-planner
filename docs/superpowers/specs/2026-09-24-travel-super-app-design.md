# Travel super app: architecture and product design

**Status:** Design APPROVED by the owner on 2026-09-24 (option A, the layers, the Claude-file layout, the move to Singapore). This spec is awaiting the owner's review before planning starts. Fable reviewed it on 2026-09-25: no critical findings; 7 important and 11 minor findings, which were checked against the evidence and applied. Two of its minor points were withdrawn with citations. **Revised on 2026-09-25 (§0)** for a native mobile app plus a website, invite-only first, and costs pushed to a final release-readiness phase.
**Supersedes:** the "trip planner" framing of every earlier spec. Earlier specs remain the record of how today's code works.
**Companion:** [`2026-09-24-travel-super-app-catalogue.md`](2026-09-24-travel-super-app-catalogue.md), which lists all 419 functions (today's, kept, changed or dropped, plus new ones) and the 181-entry decision register. Both are generated from the same data as the private pages *Travel Super App Blueprint* and *Travel Super App Catalogue*.

---

## 0. Revision 2026-09-25: a native mobile app and a website

**This section takes precedence.** Where it conflicts with a later section, this one wins; those sections are updated to match where it matters most.

**Owner decisions (2026-09-25):**
- **Two client types.** A fully native mobile app (React Native / Expo, iOS + Android, store-distributed), and a website that is both the signed-in app with desktop layouts and a public site (landing page, shared places and guides that search engines can find, share links).
- **Same features in both.** Only the layout adapts: phones put on-trip apps first, desktops put planning apps first.
- **Invite-only first, open later.** Sign-up needs `ACCESS_CODE` or a group invite during the beta.
- **Costs are pushed to the end.** Get it running and bug-free before anything is deployed to the website or the stores.
- **The repo moves** to a short path outside OneDrive at the start of phase 0.

**Monorepo (reverses option C's earlier rejection).** pnpm 10.34.5 workspaces with a `catalog:`. Vercel supports pnpm up to 10 only, and dependency build scripts are allow-listed with `allowBuilds`.
```
<repo>/  package.json (pnpm@10.34.5) · pnpm-workspace.yaml · biome.json
├─ apps/web/      Next 16: src/app/{(public), (unlisted), (signed-in)/app/<name>, admin, api, .well-known}, proxy.ts, vercel.json, CLAUDE.md
├─ apps/mobile/   Expo Router: src/app/{+native-intent, (auth), (signed-in)/<name>}, app.config.js, eas.json, CLAUDE.md
├─ platform/      one package: registry sync db identity groups access places safety notify links files shell ui
├─ reference/     one package: countries cities climate catalogue maps
├─ features/      one package: _template/ _registry/ (generated) <name>/{CLAUDE.md manifest.ts core client server db web mobile tests e2e docs}
└─ db/migrations/ · tools/{registry-gen, boundaries}/
```

**Feature zones.** The two apps share logic but never screens: no react-native-web.

| Zone | May import | Never |
|---|---|---|
| `manifest.ts` | registry types | anything else |
| `core/` (domain, commands, zod) | core, `platform/*/core`, `reference/*/core` | React, Next, Expo, React Native, DOM/Node globals, drizzle |
| `client/` (headless hooks, optimistic apply) | core, `platform/*/client`, react | react-dom, react-native, next, expo, server, db |
| `server/` | core, own db, `platform/*/server` | client, web, mobile, React |
| `web/` | core, client, `platform/*/web`, `next/*` | react-native, expo, mobile, server, db |
| `mobile/` | core, client, `platform/*/mobile`, `expo-*` | react-dom, next, web, server, db |

Features never import each other; the platform never imports features; each app imports only its own zone and the registry. Enforcement: pnpm isolation, `exports` maps, a TypeScript config per zone, Biome `noRestrictedImports` set to **error**, and the Vitest scan as the deciding check. The scan uses oxc-parser + oxc-resolver plus its own walk for `require()` / `require.context`, which oxc leaves out.

**Registry.** A code generator writes typed imports into gitignored files (`features/_registry/`, `platform/_registry/`), because Metro can't run `import.meta.glob`. The apps are the composition roots, so this replaces §2's glob mechanism. Routes stay one-line re-exports in both apps, and the `new-mini-app` skill creates them.

**Mobile stack.**
- Expo SDK 58 once it's stable (expected mid-to-late October 2026); otherwise SDK 57 with React 19.2.3, upgraded within phase 0. Expo Router and development builds.
- `expo-sqlite`: `outbox.db` with `synchronous=FULL`, plus a disposable `replica-<userId>.db` holding one generic `row` table, so a new feature needs no migration on the phone. Writes go through `withExclusiveTransactionAsync`.
- `@better-auth/expo`, which needs better-auth ≥ 1.7.6 on the server with the `expo()` plugin. The session lives in SecureStore `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.
- MapLibre React Native 11.4. It can't build offline packs from `pmtiles://`, so a Z/X/Y tile Worker serves both clients. Patch MLRN #1624 (an iOS crash) and always pass the style as a URL.
- `expo-notifications` for pushes via a `notification_outbox`, and `expo-image-picker` with presigned R2 uploads (`blob.reserve@1` / `blob.finalize@1`).
- Expo doesn't support TypeScript 7: the mobile app uses `app.config.js` and excludes `typescript` from `expo install --check`.

**Sync.** The protocol is unchanged. `platform/sync/core` is plain TypeScript behind storage, transport and platform ports, with Dexie on the web and SQLite on the phone.
- Sending happens 300 ms after each command, on resume, on reconnect and every 30 s. Sending is never gated on `isInternetReachable`, which reads false in mainland China.
- `/api/sync/*` requires an `x-sync-client` header instead of an Origin check. One pull may cover several spaces.

**Website.**
- `/` is the landing page. Public place and guide pages read only through `platform/places/public` as a read-only `web_public` role, guarded by a canary test. A place is indexed only when it has a tip, a photo or at least 3 ratings. Contributors appear by public name, and dates show the month only.
- The signed-in launcher lives at `/app`. `proxy.ts` runs only on `/app` and `/admin`.
- `cacheComponents` is on.
- Universal links and app links are served from `.well-known`, and Expo's `+native-intent` maps web URLs to app screens. Narrow windows get the phone order and a "Get the app" banner.
- **Web offline scope is reduced.** The outbox and replica stay; the service worker, install flow, `storage.persist()` and web trip packs are dropped. Offline map packs are native-only, declared as a per-client exception in the manifest (`order: {phone, desktop}` plus exceptions).

**Store rules become platform functions.** They're required before any store submission:
- **Account deletion in the app.** `account.delete@1` runs online only and asks the user to sign in again first. It anonymises member rows, deletes contribution content and its R2 files, keeps CC0 place facts but unlinks them, deletes sessions, signals and the personal group, and transfers group ownership. On the web there's `/account/delete`, plus `POST /api/account/deletion-request` for people who can't sign in.
- **A pre-publish content filter** inside `place.contribute@1`, `place.share@1` and `contribution.add@1`, plus a check in the app. Photos from new accounts are held for review. Apple 1.2 requires filtering before posting, so this **amends the owner's publish-then-report choice to filter, then publish, then report**.
- **Reports** (`platform/safety`): `content.report@1` can also target users and group items, carries reasons, and works signed out through `POST /api/report`.
- **Blocking:** `user.block@1` / `user.unblock@1`, stored in the user space. Blocked authors are hidden when rendering, and notifications skip them.
- **Consent:** `terms.accept@1` and `consent.set@1`.
- **Pages:** `/support`, `/legal/privacy` (naming the processors) and `/legal/terms`, each with an in-app equivalent.
- **Sign-up** is native in the app, because Apple rejects linking out to register.
- **Also:** a demo account for reviewers; photos only through the system picker; coarse location only; over-the-air updates for fixes only (new mini-apps ship through the stores); an age rating of 13+; the mainland China App Store is excluded, since it needs an ICP filing.

**Windows workflow.**
- Android: `expo run:android` on the emulator, with Hypervisor Platform, JDK 17 and Android Studio installed; `android.cmakeVersion` ≥ 3.31.6; Windows long paths enabled.
- Tests: Vitest for shared code, jest-expo for the app, Maestro on the Android emulator.
- iPhone builds (EAS cloud, or `eas build --local` on a free GitHub macOS runner, since the repo is public) start only in the release-readiness phase, because every iPhone build needs the $99/year Apple account.
- CI: one always-running workflow, gated with `dorny/paths-filter` and `if:`. EAS never runs on pull requests.

**Cost timing: $0 a month during development.**
- Neon Free (0.5 GB) during development.
- OpenFreeMap's public tiles online for web and phone during development.
- Android emulator and free builds; Vercel Hobby, with production showing the "being rebuilt" page and all testing on preview links.
- The paid items (Apple $99/yr, Google $25, a domain at about $10/yr, the R2 map file at about $1.80/mo, Cloudflare Workers at $5/mo, Neon Launch at $3–6/mo, and Vercel Pro at $20/mo only if the launch is public or commercial) all move to the release-readiness phase (§12, phase 6).

## 1. What we are building

The trip planner becomes a **global travel super app**. A launcher home page opens small mini-apps. They all run on one shared platform and one Postgres database, and every one of them works offline.

| Owner decision (2026-09-24) | Answer |
|---|---|
| Domain | A travel super app: planners plus group organisers. Toolbox-style tools come later. |
| Groups | Persistent groups (a family, a friend circle) that go on many trips. Group polls, finding dates, and money balances that carry across trips. |
| Data | Clean slate: production has no data to keep. **Postgres only**; SQLite is retired. Integrity is enforced by the database. |
| Offline | **Full offline edits.** The server still decides what is valid. |
| Home page | Hybrid: a "Now" strip, an app grid, and a group / trip switcher. |
| Permissions | Group roles, which can be overridden per trip and include trip-only guests. Each app has its own switches, which owners and organisers can toggle per trip. |
| Rollout | Rebuild in place in the same repo and Vercel project, one feature per PR. |
| Scope | **Global only.** Every country goes through the same pipeline, and China-only code is retired. |
| Identity | Keep the boarding-pass look and the vermilion ink. English passport stamps replace the Chinese characters. The app's display name is decided in phase 3. |
| Names | The GitHub repo is renamed to `darrenCWJ/travel-super-app` (done 2026-09-24; the old URL redirects). The Vercel project is renamed in phase 1. The local folder is renamed later, moving the Claude memory directory with it. |
| Exchange rates | Fetched automatically when online, stored on each expense, editable. This retires the earlier rule that fetched rates are display-only. |
| Hosting | Raspberry Pi self-hosting is no longer a goal. Vercel + Neon + Cloudflare R2; the code stays host-agnostic. |
| Solo trips | Every user gets an automatic personal group. |
| Places | Attractions come from a combination of open sources plus community contributions (places, tips and notes, photos, ratings). Contributions are private to the group first, and sharing is opt-in. Moderation is publish-then-report. People geotag on a real street map, and the same place from any source is merged into one. Data for future ML recommendations is captured now; no ML is built now. |

The 26 smaller questions raised by the catalogue are in §15. Each takes its recommended answer unless the owner overrides it.

## 2. Architecture: one app, four layers

> **Revised in §0:** there are now two apps (`apps/web`, `apps/mobile`) in a pnpm monorepo. Features gain `core`, `client`, `server`, `db`, `web` and `mobile` parts, and the registry is generated rather than globbed. The layer rules below still hold.

We chose option A: one Next.js app with our own offline sync layer. The alternatives were B (the PowerSync engine, about $68/month, one blocking upload queue shared by every app) and C (npm-workspace packages: heavy tooling, no gain for integrity).

```
app/                      routes only: (shell)/page (launcher), (apps)/<name>/… and api/<name>/… as one-line re-exports,
                          api/sync/push|pull, api/auth/*, api/geo/*, admin/places, b/<code>
features/<name>/          one folder per mini-app (Planner, Explore, Money, Polls, Dates, Journal, Tickets, Packing, Briefing, Today)
platform/                 identity · groups & trips · access · places · registry · sync · db · shell · ui kit · files
reference/                read-only world data + widgets: countries · cities & airports · climate · place catalogue · map widgets
```

**Rules.** Each rule is enforced by a test (§11).
1. Dependencies point downward. A feature may import `platform/*` public APIs and `reference/*`, nothing else.
2. Features never import each other and never hold a foreign key into each other's tables.
3. The platform never imports a feature. It discovers features through the registry.
4. Briefing, Today and the launcher show other apps' content through registry contributions, not imports.
5. Country data lives only in `reference/` tables. Nothing above that layer has a per-country branch, list or default.

**Feature anatomy.** A new feature starts as a copy of `features/_template`:
```
features/money/
  CLAUDE.md          rules an agent reads when it works here
  manifest.ts        plain data: id, name, 3-letter code, scope, permission switches + defaults, public routes
  server.ts          import "server-only": commands + pull queries
  client.tsx         Now cards, Briefing / Today sections (each section declares public: true|false)
  db/schema.ts       money_* tables; FKs into platform tables only
  commands/          money.addExpense@1 …
  domain/            pure logic shared by phone and server (splits, balances)
  ui/  tests/  e2e/  docs/
app/(apps)/money/page.tsx     export { default } from "@/features/money/ui/Home"
app/api/money/**/route.ts     only for real HTTP needs (e.g. an FX fetch)
db/migrations/<ts>_money_…/   the one shared path: new folders only, never edits
```

**Registry.** `platform/registry` finds `features/*/manifest.ts`, `server.ts` and `client.tsx` with three `import.meta.glob` calls. Platform modules register their own commands (`group.*`, `trip.*`, `place.*`) the same way, through `platform/*/server.ts` (Turbopack and Vitest; this ties the build to Turbopack, which is already the Next 16 default). Its consumers are the login wall (public routes), the launcher (app grid), the permission editor, sync (commands and pulls), the Now strip and the Briefing / Today hosts. No central list is ever edited. Drizzle finds schemas the same way (`features/*/db/schema.ts`).

## 3. Data

- **Host:** Neon Launch (usage-billed, no minimum, never deleted for inactivity) in `aws-ap-southeast-1`, installed through the Vercel Marketplace. Vercel functions move from `bom1` to `sin1`, because Neon has no Mumbai region. Estimated cost is $3–6/month with scale-to-zero (an estimate, not a measurement). Each preview deployment gets its own Neon branch.
- **Tooling:** Drizzle ORM + drizzle-kit v1, pinned to an exact release candidate (Kysely 0.29 is the fallback). There is one append-only migration history with a folder per migration. Triggers and deferrable constraints go in `--custom` SQL. Migrations run once per production deploy from a CI job under `pg_advisory_lock`, over the unpooled URL, and never at cold start. The app connects as a non-owner role. Enums are `text` plus `CHECK`.
- **Extensions:** postgis, pg_trgm, unaccent and h3, all available on Neon.
- **Tests:** PGlite for fast constraint tests, plus a real-Postgres (Testcontainers) CI job for concurrency, locking and randomised replay. PGlite serialises connections, so it can't test those.

**Platform tables** (the FK targets features may use; platform-internal tables such as `place_match_suggestion`, `place_merge_event`, `rec_dismissal` and `geocode_cache` are not listed): `user`, `session`, `account`, `verification` (Better Auth, on the same pool and in the same migration history); `group`; `member` (a group member with a role, or a trip-only guest; an account is optional; never deleted, marked left); `trip` (group, dates, countries); `trip_member` (a trip role override or guest access); `capability_grant` (per-group and per-trip switches); `invite`; `share_link`; `blob` (files on R2); `place` + `place_record` + `place_contribution` (§6); `sync_space`; `sync_command`; `content_report`; `signal_event`.

| Rule | Enforced by |
|---|---|
| People are referenced by member id, never by name | FK to `member` |
| A row can't point into another group | `group_id → group` on every row in a group or trip space, plus `(group_id, trip_id) → trip(group_id, id)` when a trip is set (MATCH SIMPLE skips a composite check when `trip_id` is NULL, which is why the separate key exists). Community and user rows carry `space_id` only, never a group id. |
| A trip-only guest appears only on that trip's money | constraint trigger |
| Money is integer minor units + ISO currency + the FX rate stored on the expense | `bigint CHECK > 0`, `char(3) CHECK` |
| Split shares sum to the amount, counting non-deleted rows only | deferred constraint trigger |
| Balances are computed, never stored | one shared TypeScript function, run on the phone and the server |
| Synced rows are never hard-deleted | `deleted_at` tombstones; the command cascades deletes; partial unique indexes `WHERE deleted_at IS NULL`; garbage collection only past a horizon |
| Every synced row has `id` (UUIDv7, client-generated), `space_id`, `version`, `deleted_at` | platform column helper + schema test |

## 4. Offline and sync

The design follows Replicache's published push/pull protocol as a **specification, not a dependency**. Replicache itself is in maintenance mode. Zero rejects writes when offline, Electric's managed cloud is winding down, and the CRDT frameworks replace Postgres. All were ruled out.

- **Phone:** Dexie 4.4 keeps two IndexedDB databases: an `outbox` that is never dropped, and a disposable `replica`. A command is written with `durability: 'strict'` before the UI says "saved". A Web Locks leader is the only sender. Sending happens on app open, the `online` event, `visibilitychange` and a timer (iOS has no background sync).
- **Push:** `POST /api/sync/push` (a fixed route, never a Server Action, because action ids rotate with deploys). Each command runs in its own transaction:
  1. If this command id has been seen, return the stored result.
  2. The command's user must equal the session user. Membership and the permission switch are checked **now**, not as they were when the command was queued.
  3. Lock every space the command declares it writes, in space-id order (`UPDATE sync_space … version+1 RETURNING`), which makes version order equal commit order. The result carries each space's new version. A command may not write a space it didn't declare. Several first-release commands write two spaces: `place.share@1` (group + community), `dates.decide@1` (group + trip) and `money.retagExpense@1` (between two spaces).
  4. Validate with zod, then run the feature handler.
  5. Postgres checks FKs, CHECKs and triggers.
  6. COMMIT and record `applied`, or ROLLBACK and record `rejected` in a **separate** transaction.
- **Error classes:** SQLSTATE class 23 and business rules are `rejected` and never retried. 40001, 40P01 and 08xxx get a 5xx and are retried with the same id. 401 is `paused`: the outbox waits for the same user to sign in again.
- **Pull:** `GET /api/sync/pull?space&cursor` runs a REPEATABLE READ read-only snapshot and returns live rows plus tombstones since the cursor. A 403 `{revoked}` purges the space from the phone and rejects its pending commands. A cursor older than the garbage-collection horizon gets `reset`.
- **Results** per command: `applied`, `duplicate`, `rejected` (goes to the **Needs attention** list in the user space), `retry`, `paused`.
- **Commands are forever:** a shipped `name@version` keeps a working handler, and a snapshot test blocks edits. A new shape gets a new version.

**Spaces.** Rows are never filtered per viewer inside a space.

| Space | Holds | Synced by |
|---|---|---|
| group | the group, members, roles and default switches, the group's private places and their tips, photos and ratings, polls, availability, expenses without a trip | group members |
| trip (one per trip) | the trip, trip roles and switches, itinerary, tickets, packing, journal, share links, the trip's expenses and settlements | group members + that trip's guests |
| user | preferences, devices, Needs attention | that person |
| community (one per H3 res-3 cell, about 120 km across) | shared places and their public tips, photos and ratings | everyone signed in; a phone syncs the cells, plus their neighbours, of every place referenced by rows in its trip spaces and every place the user pinned, and browses the rest online |

**Projections into a trip space.** A trip pull also returns a read-only projection of every `member` row and every group-private `place` row that a live row in that trip space refers to (id, name, location, `left_at`). Trip-only guests can therefore render "You owe Mei" or a stop at the group's private place without syncing the group space. The projection is defined by the trip's rows, not by the viewer, so the no-per-viewer-filtering rule still holds.

**PWA and hard constraints** (for the web client only; §0 drops the service worker and install flow, so the bullets on those are superseded):
- Offline screens are static page shells (context lives in the page, not in `/trip/[id]` segments) of client components that read the replica. The shell never reads the session on the server.
- `/b/<code>` share pages stay online-only and are never cached by the service worker.
- A hand-written service worker is built with esbuild to a fixed `/sw.js`, served `no-cache`. It never calls `skipWaiting` by default, applies updates only after the outbox drains, and has a kill switch. Serwist's Turbopack route is not used (open install-hang issue).
- `proxy.ts` exempts `/sw.js`, the web manifest (fetched without cookies), icons and the offline page.
- *(Superseded by §0: phones use the native app, and the web drops the service worker, install flow and `persist()`.)* On iOS, a Safari tab can be wiped after 7 days of Safari use without a visit, which is one reason the phone experience is native.
- Better Auth sessions last 90 days, with a device list. The outbox is keyed by user and survives a 401. Sign-out never wipes unsent commands.
- **Mainland China:** `vercel.app` has been blocked since 2021-05-14 (GreatFire), and a custom domain is not guaranteed to work. Travellers install the app and download the trip's data and map pack before they go.

## 5. Identity, groups, trips, permissions

- **Instance admin:** a database role seeded from `ADMIN_USER_IDS`. It is not a group role. It unlocks `places.moderate`, `app/admin/places` and the admin-assisted password reset.
- **Identity:** Better Auth 1.7 email + password on the platform's single database pool. Signup accepts **either** `ACCESS_CODE` **or** a valid group invite. Password reset stays admin-assisted in the first release. The wall stays fail-closed on a missing secret. Every user gets a personal group.
- **Groups:** create, rename, add a person without an account, invite links (create, revoke, redeem), set role (owner only), rename a person, remove (owner only), leave, transfer ownership, delete. Invites replace today's join codes.
- **Trips:** create (in a group), rename, dates, countries (derived from Planner's places, with a manual override), travellers, trip-only guests and guest invite links, per-trip role override, archive (hidden, still editable), delete (refused while the trip has expenses). The maximum length rises from 21 to 60 days. When dates shrink, days past the new end become "unscheduled".
- **Roles:** owner, organiser, member, viewer. Organisers invite; only the owner removes people, changes roles and changes group defaults.
- **Switches:** each app declares switches in its manifest, with default roles (e.g. `planner.edit`, `money.add`, `money.editAny`, `polls.create`, `polls.vote`). Owners and organisers toggle them per trip in one generic editor built from the manifests.
- **Resolution:** use the trip role if the trip overrides it, otherwise the group role. Then use the trip switch if one is set, otherwise the app's default. The server checks again when each command arrives. Outsiders get read-only share links.

## 6. Places and community

- **Where it lives:** a new platform module, `platform/places`, because Planner, Journal, Polls, Today and Explore all refer to places. Explore owns browsing, the detail sheet, contributing, sharing, rating and reporting. Moderation lives at `app/admin/places`. Features store `place_id … REFERENCES place(id) ON DELETE RESTRICT` and display it through `resolve(ids, viewer)`, which follows merges and applies visibility.
- **Street map:** MapLibre GL 6.11 (pinned) with a Protomaps world file (about 138 GB, an ODbL Produced Work) copied into R2 each quarter, costing about $1.80/month. Tiles are served from a custom domain on Cloudflare DNS (free-plan requirement). A cache worker is added if cold reads from Singapore stay near 1 s. **Trip packs** cover the world overview, the trip's countries, then its cities at street detail (Tokyo + Kyoto ≈ 28 MB at zoom 14), stored in IndexedDB. Pinning works by long-press or crosshair, and typed decimal/DMS coordinates or "use my location" are the accessible, no-WebGL alternatives. The d3-geo globe stays for choosing a country.
- **Search:** the app's own city and place files first (works offline, including reverse lookup to "near Kyoto, Japan"). After that, a server route `/api/geo/*` with a cache, using Photon and falling back to Geoapify's free tier; the provider is set in config. Nominatim is not used (its policy bans app autocomplete).
- **Open sources:**
  - Wikidata tourist attractions (CC0, ranked by sitelinks) enter in the first release.
  - Overture Places (CDLA-Permissive-2.0; Foursquare-sourced rows carry Apache-2.0 plus a NOTICE) join after a trial run that checks tourism quality, China included. Confidence 0 means "does not exist". Closures come from `operating_status`. Releases expire after about 60 days.
  - Both are combined in DuckDB on GitHub Actions and shipped as catalogue files on R2 (top places per country, plus more per map cell for trip cities). They are **never** bulk-loaded into Neon.
  - A place becomes a database row only on first use (saved, planned or pinned), keyed by a UUIDv5 of its catalogue key. The catalogue files carry that id, so the phone can resolve a place that exists only in a trip pack.
- **The licence line:** OpenStreetMap data draws the background map only, and its point-of-interest layers are removed from the style. The geocoder (Photon, or Geoapify; both OSM-derived) is called only:
  - for a search the user typed, or a "what's here?" at a pin the user dropped;
  - one result per action;
  - never in batch, from `after()` or a cron job, and never to list nearby places.

  A chosen result may set the pin and prefill an editable name. The row records `coord_source='geocoder'` and the provider, so attribution ("© OpenStreetMap contributors", "Powered by Geoapify") can be shown with it. No OSM ids are stored and nothing is deduplicated against OSM. This follows the OSMF Geocoding Guideline, which allows individual results to be stored alongside other data as long as they are never systematically aggregated. Anything more would put the whole catalogue, community contributions included, under ODbL's share-alike terms. Where this spec and the research file `places/geocoding.md` disagree (it proposed an `after()` step storing OSM references and nearby places), this spec wins. A `CHECK` limits stored place data to CC0, CDLA-P-2.0, Apache-2.0, CC BY 4.0 and our contributor terms. A Licences page ships with the app.
- **Visibility:** a contribution is a private place in the group's space. Sharing creates a public place in the community space and links the private one to it, so nothing about the group leaks. Shared content publishes immediately. Anyone can report; content is hidden automatically after reports from 2 different groups, pending an admin, who can hide, remove or restore it. **Public `place` rows are never tombstoned.** They carry `status IN ('live','hidden','removed')`: browsing and search show only `live`, while `resolve()` still returns the name and location to anyone holding a reference (an itinerary item, a journal entry) and withholds community tips and photos for places that aren't live. Only contributions (tips, photos, ratings) are tombstoned.
- **Contributor terms:** facts as CC0; tips and photos as CC BY 4.0. The accepted terms version is recorded. Photos go to R2 via `blob`, with EXIF stripped.
- **Merging:** one TypeScript log-odds scorer runs on phone and server. It uses distance by category (food 75 m … nature 3 km), name keys (NFKC, fold, transliterate), category compatibility, and matching Wikidata ids. When a person adds a place, the app asks "Is this the same as…?". The only automatic link is private-to-private within a group (same name, within 25 m, same category, undoable). A nightly batch auto-merges open-data pairs at 0.95 or above and sends 0.6–0.95 to an admin. Community places never auto-merge. Merges only move pointers (`merged_into`, `resolved_id`), are logged and can be undone exactly. Chains are compressed when a merge happens: A→B→C rewrites A→C, logged so an unmerge restores A→B. `resolve()` therefore needs a single hop. Because the repo is public, the nightly job reads public rows only and uploads no artifacts.
- **Commands:** `place.contribute@1`, `place.tag@1`, `place.edit@1`, `place.link@1`, `place.share@1` / `place.unshare@1`, `contribution.add@1` / `contribution.withdraw@1`, `place.rate@1`, `content.report@1`, `moderation.hide|remove|restore@1` (online only), `place.merge@1` / `place.unmerge@1`, and later `rec.dismiss@1`. Switches: `places.contribute`, `places.share`, `places.moderate`.
- **ML capture (no ML yet):** `signal_event` rows are written in the same transaction as the action: saved to a plan (with origin), visited, rated, voted, dismissed, plus the travel month. Views have no command of their own, so they're batched on the phone and sent as `signal.view@1` with the next push. Merge decisions are kept as labels. Any use across groups is opt-in, starts only once recommendations exist, and publishes counts only when they cover at least 5 groups.

## 7. Launcher and shell

- The home page at `/` has a group / trip switcher (device-local context), a **Now** strip, and an app grid filtered by the viewer's switches.
- Each app contributes Now cards from `client.tsx`, computed from the local replica so they work offline. Examples: "Day 3 · Kyoto", "Dinner vote closes 18:00", "You owe Mei ¥2,000".
- The platform adds its own cards for unsent changes, Needs attention, signing in again to send, installing the app, and welcome after an invite.
- Each tile has a 3-letter code in the boarding-pass style (PLN, MNY, VOT, DTS, JNL, TIX, PAK, MAP, BRF, TDY).
- The brand's Chinese chops become English passport stamps. The display name is chosen in phase 3.

## 8. The mini-apps

Full function lists, marked first release or later, are in the companion catalogue.

- **Planner:** wizard (details, destinations, plan), the generated itinerary as a draft that members then own, the day builder, and gateways. Rebuilding is explicit and destructive; tickets survive. Destinations come from the place catalogue. There is no hand-written China list.
- **Explore:** the street map and country globe, clustered places, the place sheet, trip-pack download, and contributing, sharing, rating and reporting.
- **Money:** a group ledger with expenses tagged by trip. Split modes are equal, shares, percent and exact. It is multi-currency. The exchange rate is fetched automatically when online, stored on each expense and editable; an offline expense stays unconverted until a rate is filled in. Totals are shown in the ledger currency using each expense's frozen rate, while balances and settle-up stay per currency and are never converted. Settle-up suggestions, full or partial settlements, categories, one ledger currency per group, and CSV export are included. A payment between two other people may be recorded by the payer, the payee or an organiser.
- **Polls:** single or multiple choice, text or place options, deadline, close, decide and reopen, results with who voted, and offline votes (server time decides the deadline). Polls live in the group space, so trip-only guests can't vote in the first release.
- **Dates:** each person paints days free, if need be, or no. The app finds the best window (if-need-be counts, but ranks below yes) and shows who hasn't answered. Deciding sets the trip's dates through the platform trip API. Whole days only.
- **Journal:** entries with photos on R2; authors edit their own entries.
- **Tickets:** structured bookings shown on the matching days.
- **Packing:** checklists with shared ticking, in Packing's own tables (the shared `checks` table is split).
- **Briefing:** a read-only share link that renders only sections marked `public`.
- **Today:** countdown, now and next in the trip's local time zone (not UTC+8), and the recap afterwards.

## 9. Global only: what is retired

- `lib/data/{east,north,south,west}.ts`: 1,239 lines of hand-written China destinations (1,255 with `index.ts`).
- `data/catalog.json` and `scripts/ingest-destinations.mjs`: 695 Chinese cities from PRC-specific Wikidata classes.
- `ChinaRegion`, `REGION_MONTHS`, and `public/china-provinces.json` as a separate source. China's regions are rebuilt from Natural Earth.
- The `"CN"` / `CNY` defaults (28 and 17 files), the China-only holiday and crowd bands, rail speed, packing rows, and the `cn.ts` tips (Alipay, VPN, 12306, Amap).
- The Chinese-character stamps (游, 同行, 已选 / 去过 / 启程, `.font-kai`).
- **Accepted cost:**
  - The worldwide climate model agrees with the curated China table only 72.9% of the time; it misses, for example, Harbin's ice-festival months and Wuhan's summers.
  - Plans everywhere depend on the new place catalogue (§6). Today, outside China, a plan gets about 3 generic activities per city.

## 10. Claude and agent files

> **Revised in §0:** each app (`apps/web`, `apps/mobile`) gets its own `CLAUDE.md`. Each feature's `CLAUDE.md` covers all its parts (core, client, server, db, web, mobile) and the parity rule, and `new-mini-app` adds routes to both apps.

```
CLAUDE.md                        tracked: @AGENTS.md + a 10-line repo map
AGENTS.md                        Next.js-managed block only (next dev rewrites it)
.claude/settings.json            shared permissions + hooks
.claude/rules/platform/*.md      no paths: → always loaded, ≤ 200 lines total (architecture, data integrity, sync contract, workflow)
.claude/rules/platform-internals.md   paths: platform/** → loaded only when touching the platform
.claude/skills/new-mini-app/     copies features/_template → features/<name>
.claude/agents/boundary-reviewer.md, integrity-reviewer.md
features/<name>/CLAUDE.md        loaded the first time an agent reads a file in the folder
features/<name>/.claude/skills/  feature-only procedures, loaded when used
features/<name>/docs/            specs, plans, STATUS.md
docs/platform/                   platform specs and plans
```

- Feature files are named `CLAUDE.md`, never `AGENTS.md`: Claude Code 2.1.215 on this machine doesn't read subfolder `AGENTS.md`.
- `CLAUDE.md` and `AGENTS.md` are gitignored today and must be tracked.
- Don't use braces in `paths:` on 2.1.215.
- Start sessions at the repo root and name the feature in the task.
- Add `.claude` to `.vercelignore`.
- Split the 1,832-line project memory into per-feature notes.

## 11. Guardrails (each fails CI)

> **Added in §0:**
> - the zone boundary scan (oxc, with a `require()` walk);
> - a **parity test**: every `name@version` command is reachable from both apps' screens, or is declared an exception;
> - a web route-placement test;
> - the public-data canary;
> - a mobile job: `expo install --check` with `typescript` excluded, jest-expo and `expo export`.
>
> The diff scope also allows `apps/mobile/src/app/**/<name>/**`.

- **Boundary test:** feature → feature imports, and platform → feature imports that bypass the registry.
- **Schema reference test:** no FK from one feature's table into another's.
- **Pull conformance** (real Postgres): no app's pull returns rows to someone outside the space.
- **Command snapshot:** shipped command shapes are frozen.
- **Share-page canary:** every Briefing / Today section declares `public`.
- **Global-only scan:** no country special cases outside `reference/` tables. It allows the named data tables (`CURATED_FACTS`, `REFUSED_LANGUAGE_ITEMS`, the KE equator exception, the Natural Earth overrides).
- **Migration rules:** append-only; regenerate on rebase; `drizzle-kit check`; hash verification before the production migrate; `db/migrations/** eol=lf`.
- **Diff scope** (warning): a feature PR touches only `features/<name>/`, `app/(apps)/<name>/`, `app/api/<name>/` and new `db/migrations/` folders.
- **Scan roots:** the design-token and GeoNames-credit scans cover `features/`, `platform/` and `reference/`.
- **Path-filtered CI:** worked out from the diff. The nightly data refresh verifies with reference and platform tests only.

## 12. Build order

Each sub-project gets its own spec, then a plan, then small PRs. Nothing moves on until its gate passes.

0. **Monorepo conversion.** Move the repo to a short path outside OneDrive, copying the Claude memory directory to the new path's key. Switch to pnpm and `git mv` today's app into `apps/web`. Add the registry generator, the boundary scan, CI jobs and an Expo skeleton in `apps/mobile`. Upgrade better-auth to ≥ 1.7.6 for `@better-auth/expo`. **Gate:** all checks green, a Vercel preview builds, and a development build runs on the Android emulator. iPhone builds wait for phase 6.
1. **Platform foundations.**
   - Retire the old data layer **first**: the SQLite backend, `store.ts` / `tripStore.ts` / `pgStore.ts`, and the DDL run at cold start. Otherwise `ensureSchema` would create its own auth tables in the new database. Trip pages show "being rebuilt" until their app lands.
   - Replace the old repo name in the 23 files that still carry it, including every User-Agent contact URL pinned by `scripts/user-agent.test.ts`.
   - Set up Neon in Singapore and move the functions to `sin1`; rename the Vercel project to `travel-super-app` in the same environment change (`BETTER_AUTH_URL` moves then); buy a domain with Cloudflare DNS.
   - Drizzle migrations from CI; PGlite plus the real-Postgres job.
   - Identity (including the instance-admin role), members, groups (including personal groups), trips (countries set by hand; deriving them from places arrives with Planner), roles and switches.
   - **Every write is a command handler `(tx, cmd, ctx) => result` from day one**, registered through the same glob as features. Phase 1 exposes the handlers through a thin, online-only `/api/sync/push` with no outbox, idempotency or pull. Phase 2 adds those without touching the handlers. Nothing is written as a one-off API route or Server Action.
   - The registry, every guardrail that doesn't depend on sync, the re-rooted scans, the Playwright file-name conventions, the wall exemptions, the Claude file layout, and `features/_template`. The CI migrate job also migrates each PR's Neon preview branch.
   - **Gate:** an empty app scaffolded from the template passes every guard built so far, and the nightly encrypted backup runs with one tested restore. Pull conformance and the command snapshot join phase 2's gate.
2. **Offline sync on both clients:** the outbox, push and pull across all four space kinds, with the Dexie (web) and SQLite (phone) storage adapters, optimistic updates, Needs attention and 90-day sessions. The web has no service worker (§0). **Gate:** offline end-to-end tests on the web and on the Android emulator (Maestro), plus randomised replay tests against real Postgres showing the clients and server agree.
3. **Shell and launcher on both clients:** the switcher, the Now strip, the app grid (phone and desktop orders), the permission editor, the passport-stamp identity, the name, native sign-up, the landing page at `/`, and the store-required platform functions from §0 (account deletion, block, report, pre-publish filter, terms and consent, support and legal pages). **Gate:** a placeholder app appears in both clients, respects its switches and shows a Now card offline.
4. **Move today's features**, one PR each, shipping the web and mobile parts together (the parity test gates it) and deleting old code in the same PR:
   1. `reference/` (the largest move, about 16,000 lines: the coupling map counts 9,158 in map code plus 6,801 in reference data; China is rebuilt from Natural Earth).
   2. `platform/places` (tables, `resolve()`, the pin picker, the street map and trip packs, the Wikidata attractions ingest). The Overture trial runs here.
   3. Then Explore, Planner, Money, Tickets, Packing, Journal, Briefing and Today, in that order.

   **Gate:** each PR stays within diff scope with its tests green.
5. **New apps:** Polls, then Dates, built only from the template. **Gate:** no platform edit is needed.
6. **Release readiness.** Nothing is deployed to the public website or the stores before this phase ends.
   - **Pay for:** Apple (9/yr), Google Play (5), a domain on Cloudflare DNS, the R2 map file and tile Worker (/mo, enabling offline map packs on the phone), and Neon Launch. Add Vercel Pro only if the launch is public or commercial.
   - **iPhone:** development builds, fixes for iOS-specific issues (MLRN #1624, SecureStore, SQLite), then TestFlight.
   - **Android:** Play closed testing with at least 12 testers for 14 days; register the package and signing key for Android developer verification.
   - **Stores:** a compliance pass (privacy labels, Data safety, age rating 13+, the demo account).
   - **Quality:** a full bug hunt across web, Android and iPhone, the browser glance, and a Fable final review.
   - **Gate:** zero known defects of Important or higher, all suites green on every client, and the owner's go-ahead. Then the public website launches and the apps are submitted, invite-only first.

## 13. Hosting, operations and cost

- Vercel (`sin1`), Neon Launch (Singapore) and Cloudflare R2 (photos, catalogue files, the map file, backups).
- A nightly `pg_dump`, encrypted with age, goes to R2 under a separate account and doubles as the liveness alarm. A monthly restore test runs in CI. Dumps are never Actions artifacts, because the repo is public.
- Account hygiene: 2FA, a password manager, a second admin, and provider email going to an inbox someone reads.
- **Cost timing (§0):** $0 a month during development: Neon Free, OpenFreeMap public tiles, the Android emulator and free builds, Vercel Hobby. From release readiness: database $3–6/mo, map file about $1.80/mo, Cloudflare Workers $5/mo, domain about $10/yr, Apple $99/yr, Google $25 once, and Vercel Pro $20/mo only if public or commercial.

## 14. Risks

- **The sync core is owner-maintained** (about 2.5k lines plus tests). Mitigated by the Replicache-shaped protocol, randomised replay tests against real Postgres, and one platform interface that PowerSync could later sit behind.
- **iPhone storage and no background sync.** Handled by the install prompt, flushing in the foreground, and visible unsent counts.
- **Long offline trips versus sessions and deploys.** Handled by 90-day sessions and permanent command handlers.
- **Drizzle v1 is a release candidate.** Pin the exact version; Kysely is the fallback.
- **Mainland China reachability.** Install and download everything before entering.
- **Open place data quality.** Overture enters only after the trial run.
- **Neon's terms allow closing an account with 30 days' notice.** Hence the off-provider backups.

## 15. Open calls and their default answers

The owner may override any of these. Until then, the default applies.

| # | Call | Default |
|---|---|---|
| 1 | A domain for the map and app | Buy one (about $10/yr) with Cloudflare DNS in phase 6, release readiness |
| 2 | Contributor licence | Facts CC0; tips and photos CC BY 4.0; record the accepted version |
| 3 | Auto-hide threshold | After reports from 2 different groups |
| 4 | Overture Places | Trial first, China included; if weak, Wikidata + community only |
| 5 | OSM places for thin countries | Not in the first release; decide country by country later |
| 6 | Usage data across groups | Opt-in, only once recommendations exist, counts only when they cover at least 5 groups |
| 7 | Public holidays and crowd bands | Drop the China-only bands; add Nager.Date (MIT) holidays for every country later |
| 8 | Signup | `ACCESS_CODE` or a valid group invite |
| 9 | Password reset | Admin-assisted in the first release |
| 10 | Organisers | Invite; only the owner removes people, changes roles and changes group defaults |
| 11 | Display names | Unique within a group (database-enforced) |
| 12 | Maximum trip length | 60 days |
| 13 | Deleting a trip with expenses | Refused until its expenses are moved or deleted |
| 14 | Trip countries | Derived from Planner's places, with a manual override |
| 15 | Dates getting shorter | Extra days become "unscheduled", never deleted |
| 16 | Archive | Hidden, still editable |
| 17 | Ledger currency | One per group |
| 18 | Recording a payment between others | The payer, the payee or an organiser |
| 19 | Guests in Polls and Dates | Not in the first release |
| 20 | Dates granularity | Whole days; if-need-be ranks below yes |
| 21 | Late offline votes | Server time decides; late votes go to Needs attention |
| 22 | iPhone Safari tab | Retired on 2026-09-25: phones use the native app, and narrow web windows show a "Get the app" banner |
| 23 | Session length | 90 days, with a device list |
| 24 | Preview deployments | Their own Neon branch |
| 25 | Nightly data refresh tests | Reference + platform only |
| 26 | Undo | An "Undo" toast after every delete |

Still open from before (unchanged): a PNG named `.jpg` (refuse, or store as the sniffed type); `CIP_ACCEPT_LANGUAGE_CHANGES` as an env var or a flag; `images.unoptimized`; the `nosniff` header; the review of the baseline official-language lists.

**Found in today's code, fixed as each feature moves:**
- Hand-typed places are missing from the saved trip.
- 9 or more picks fail at create (the server caps at 8).
- A PATCH rename regenerates the plan and clears ticks.
- Preferences are never loaded on a new device.
- Today assumes UTC+8.
- An empty split list re-splits whenever membership changes.
- Wizard state is lost on refresh.

## 16. Evidence

This design came out of four research workflows run on 2026-09-24:
1. A 10-agent codebase map with adversarial verification.
2. A 19-agent study of sync, ORM, hosting and PWA options, with fact-checks and a 3-judge panel.
3. An 11-agent function and decision inventory with completeness critics.
4. A 9-agent places study (basemap, geocoding, open POI sources and licensing, conflation, ML capture) with fact-checks.

Primary sources include:
- https://doc.replicache.dev/strategies/per-space-version
- https://zero.rocicorp.dev/docs/offline
- https://docs.powersync.com
- https://neon.com/pricing and https://neon.com/docs/introduction/regions
- https://orm.drizzle.team/docs/v0-v1-changes
- https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- https://vercel.com/docs/skew-protection
- https://docs.protomaps.com/basemaps/downloads
- https://docs.overturemaps.org/guides/places
- https://osmfoundation.org/wiki/Licence/Community_Guidelines
- https://developers.cloudflare.com/r2/pricing
- the local Next.js 16.3.6 docs under `node_modules/next/dist/docs/`

The raw research reports stay outside the repo in the session's working files. Numbers without a measurement behind them are marked as estimates.
