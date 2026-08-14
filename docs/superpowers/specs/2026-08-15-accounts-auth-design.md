# Accounts & Login — Design

**Date:** 2026-08-15
**Status:** Approved by user (chat), spec under review

## Goal

Replace the scattered bearer-code identity (join codes to edit, typed names
per trip, wallet sync codes across devices) with **email + password
accounts**, because the user finds the code model not user friendly. All
four pains are in scope:

1. Trips don't follow you across devices → an account's trip list is
   server-derived from its memberships.
2. Too many codes → login once; codes remain only as trip invites.
3. Typing a name per trip (typos → duplicate members) → one identity,
   auto-used everywhere.
4. Anyone with the link can edit → **editing now requires an account**;
   the join code alone grants read-only access to a reduced view; the bare
   link grants nothing.

`docs/PLAN.md` anticipated this: *"before public hosting add real identity
… and per-member sessions."* This spec is that step.

## Decisions (from brainstorm)

1. **Auth method: email + password** — self-contained across all three
   hosts (Vercel, Raspberry Pi on a LAN address, localhost). Google/OAuth
   deferred.
2. **Library: Better Auth** (user's choice over a self-contained
   implementation and Auth.js). Email+password enabled; its React client
   drives the UI. Its API surface moves quickly — the implementation plan
   must pin exact usage against current docs (Context7), not memory.
3. **Hybrid access model, view-only codes** (user-specified):
   - Member (account, joined) → sees and edits everything. The
     any-member-can-edit trust model *within* a trip is preserved.
   - Guest with join code, no account → **Itinerary + Packing tabs only,
     read-only**, server-redacted payload.
   - Bare link, no code, no membership → a "this trip is private — enter
     the code" screen. Stricter than today (link alone currently reveals
     everything).
   - Public briefing links `/b/*` are unchanged — still the intentional
     share surface, still exempt from the site gate.
4. **Password reset without email infrastructure**: Better Auth's admin
   plugin; the deploying user's account is the admin and can reset family
   members' passwords from an admin section on `/account`. Email-based
   reset is a future addition, not v1.
5. **Legacy members migrate by claiming.** Existing trips have plain-name
   members with history (ticks, expenses, journal attribution). A
   logged-in user joining with the code may claim an unclaimed existing
   member name ("I am Ada") and inherits that attribution, or join as a
   new member under their account's display name. No data surgery on
   existing trips.
6. **Server-resolved identity.** Mutating routes stop accepting a
   client-asserted `memberName`. The session resolves to the caller's
   member name per trip, server-side. This closes today's
   impersonation-by-request-body hole for every route (checks, plan,
   tickets, expenses, settlements, journal, photos, briefing, currency).
7. **Wallet sync is retired from the UI.** Server-side trip lists replace
   it for account holders; guests can't edit and don't need synced
   dashboards. The wallet API endpoints remain temporarily for old
   clients; removal is a later cleanup.
8. **Site access gate (`ACCESS_CODE`) is unchanged** and orthogonal:
   it gates who can reach the site at all; accounts gate who can edit a
   trip. Login/signup pages sit inside the gate; `/b/*` stays exempt.

## Architecture

### Better Auth integration

- Server config in `lib/server/auth.ts`: `betterAuth({...})` with
  `emailAndPassword: { enabled: true }` and the `admin` plugin. Database:
  the existing better-sqlite3 handle locally / the Postgres pool on
  Supabase — same database as trips, no second store.
- Route handler `app/api/auth/[...all]/route.ts` via the Next.js adapter.
- Client `lib/authClient.ts` from `better-auth/react`: `useSession`,
  `signIn.email`, `signUp.email`, `signOut`, admin calls.
- **Schema strategy**: generate Better Auth's schema once per backend and
  embed the resulting `CREATE TABLE IF NOT EXISTS` statements in the
  existing boot-time schema paths (`lib/server/db.ts` SCHEMA,
  `pgStore.ensureSchema`) so every host self-provisions on first run,
  matching the repo's zero-migration convention. Version-pin
  `better-auth` (exact version) so the embedded schema cannot drift under
  a silent upgrade; upgrading the pin is a deliberate task that re-runs
  schema generation.
- Env: `BETTER_AUTH_SECRET` (required for accounts; absent →
  account-dependent endpoints 503 with a hint, mirroring the
  DB_UNAVAILABLE pattern), base-URL/`trustedOrigins` fed from env to
  cover Vercel + Pi LAN + localhost.
- Rate limiting: Better Auth's built-in limiter on auth endpoints.

### Membership link

- New table `member_accounts (trip_id, member_name, user_id)` — PK
  `(trip_id, member_name)`, `UNIQUE (trip_id, user_id)` (one membership
  per user per trip), `ON DELETE CASCADE` from trips. No ALTER on the
  existing `members` table; legacy rows stay valid and unclaimed until
  claimed.
- Store facade gains: `linkMemberAccount`, `memberNameForUser(tripId,
  userId)`, `tripsForUser(userId)` (joined against `trips` for the
  dashboard), `isNameClaimed(tripId, name)` — both backends.

### Authorization & redaction

- `lib/server/authz.ts` — one choke point used by every trip route:
  `resolveTripAccess(tripId, request)` → `{ kind: "member", memberName }`
  | `{ kind: "guest" }` (valid code presented) | `{ kind: "none" }`.
  Mutating routes require `kind === "member"` (403 otherwise) and use the
  resolved `memberName`; `memberName` disappears from every request
  schema.
- `lib/redactTrip.ts` — pure function `guestTripView(payload)` returning
  a `GuestTripPayload` **built by construction** (like the briefing): trip
  name, dates, destination names, plan days, packing groups, member
  count only. It never copies tickets, expenses, settlements, journal,
  checks (guests see the plan, not who ticked what — or that anything was
  ticked), join code, or member names — asserted field-by-field in tests.
  `GET /api/trips/:id` returns the full payload to members; with a valid
  `?code=` query it returns the guest view (the client caches the entered
  code in localStorage and re-sends it); otherwise 403 `{ private: true }`.
- Join/claim: `POST /api/trips/:id/join` (session required) with
  `{ code, claimName? }` — claims an unclaimed legacy name or creates a
  new membership under the account's display name. Claiming a claimed
  name → 409. Guests never call join — their code is validated by the
  `GET ?code=` path above, which creates nothing.

### UI

- `/login`, `/signup` pages (ticket aesthetic); header account chip
  (initial avatar → My trips / Account / Sign out); `/account` page
  (display name, change password; admin: list users + reset password).
- Homepage: logged-in → server trip list via `GET /api/me/trips`;
  logged-out → sign-in CTA. Wallet sync card removed.
- Trip page: session replaces `cip-member-*` localStorage. Non-member
  states: private screen → code entry → guest view (Itinerary + Packing
  tabs only) with a "sign in to join & edit" CTA; logged-in + code →
  join/claim dialog listing unclaimed legacy names. Legacy-editor banner:
  a device holding an old `cip-member-<id>` name sees "create an account
  to keep editing as <name>" leading into signup + claim.
- Creating a shared trip requires login; the wizard's local-only planning
  remains usable logged-out.

## Error handling

Same conventions: Zod 400s, 401 unauthenticated where a session is
required, 403 non-member / claimed-name conflicts as 409, 404 unknown
trip, 503 when accounts are unconfigured (`BETTER_AUTH_SECRET` absent)
with an explanatory hint. Auth failures never reveal whether an email is
registered (Better Auth default messaging).

## Testing

- `lib/redactTrip.test.ts` — the leak surface: field-by-field assertions
  that the guest view contains only the allowed fields; a canary test
  that fails when `TripPayload` gains a field not explicitly classified.
- Authz matrix tests: member / code-guest / anonymous × every trip route
  (store-backed, SQLite) asserting 200/403/401 per the access table.
- Claim rules: claim unclaimed ✓, claim claimed → 409, one membership
  per user per trip, attribution inheritance (ticks/expenses by the
  claimed name resolve to the account afterwards).
- `member_accounts` CRUD + `tripsForUser` on SQLite (pg by parity
  inspection, as established).
- Better Auth signup/login smoke against its route handler in a test
  server where feasible; otherwise manual browser verification per the
  repo's convention for route-level flows.

## Out of scope (this spec)

- Google/OAuth sign-in; email-based password reset; email verification.
- Removing the wallet API (UI only retires now).
- Per-member roles beyond member/guest (no owner/editor tiers — the
  any-member-edits trust model stays).
- Project B planning enrichments (notes, to-dos, distances) — still
  queued separately.
- Data export/deletion tooling (family-scale; revisit if ever public).

## Sequencing note

Implementation must branch from `main` **after PR #2
(feature/trip-tracker-money) merges** — the authz rewrite touches the
money/journal/photo routes that PR introduces.
