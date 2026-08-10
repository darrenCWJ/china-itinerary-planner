# Trip Wallet — Cross-Device Sync — Design

**Date:** 2026-08-11
**Status:** Approved by user (chat), implementing

## Goal

Make the homepage "Your trips" list follow the user across devices without
accounts: an opt-in secret **sync code** (a "trip wallet"), in the same spirit
as trip join codes.

## Decisions (from brainstorm)

1. **Sync code, not accounts** — no email, no OAuth. The code is the identity;
   same trust model as sharing a join code.
2. **Opt-in** — nothing is created until the user clicks "Sync devices".

## What syncs

The full `MyTrip` list (id, name, startDate, days, destinations, role,
savedAt) **plus a per-trip `memberName`** so a linked device is recognized as
the same member and can edit trips immediately.

## Server

New `wallets` table in both stores (auto-created like `tickets`):
`code` PK · `data` JSON (the trips list) · `version` int · timestamps.
Wallet codes use the join-code alphabet at 10 chars (~50 bits).

Endpoints (Zod-validated; the code travels in the request **body**, keeping
secrets out of URL/server logs):

- `POST /api/wallet` `{trips}` → `201 {code, version}` — create.
- `POST /api/wallet/fetch` `{code}` → `{trips, version}` or 404.
- `POST /api/wallet/put` `{code, trips, baseVersion}` → `{version}`,
  409 on version conflict (client re-fetches, re-merges, retries), 404 unknown.

Trips arrays are capped at 20 entries with per-field length limits.

## Client

- localStorage stays the local cache (existing `cip-my-trips-v1`); a linked
  device additionally stores the wallet code (`cip-wallet-code`).
- `MyTrip` gains optional `memberName`; trip creation and trip visits record it.
- **Sync** (`lib/walletSync.ts`), run on dashboard load and after local
  changes on a linked device:
  1. fetch wallet → 2. `mergeTripLists(local, remote)` → 3. install missing
  per-trip member identities (`cip-member-<id>`) → 4. save merged locally →
  5. if merged ≠ remote, push with baseVersion (retry ×2 on 409).
- **Merge** (pure, unit-tested): union by trip id; newer `savedAt` wins a
  conflict; `creator` role is sticky; a missing `memberName` is filled from
  the losing side; newest-first, capped at 20.
- **Forget while linked** also removes the trip from the wallet. Known
  limitation: another device that still holds the trip locally re-adds it on
  its next sync — forget it there too.

## UX (dashboard)

- Unlinked: "🔗 Sync devices" reveals two paths — **Create code** (shows the
  new code + copy) and **I have a code** (paste → link + merge now).
- Linked: quiet row "Synced · CODE [copy] [unlink]". Unlink only forgets the
  code on this device; the wallet itself remains.

## Error handling

Network/server failures leave the local list untouched and show a small
inline message; sync retries next dashboard load. Unknown code on link shows
"code not found". Version conflicts resolve by re-merge; sustained conflict
(>2 retries) keeps local state and reports the error.

## Testing

- Unit: `mergeTripLists` (union, newest-wins, creator-sticky, memberName
  fill, cap), `parseMyTrips` with `memberName`, wallet store round-trip +
  version conflict in the SQLite store test suite.
- Manual: two-device flow simulated by clearing localStorage in the browser.
