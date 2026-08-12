# Trip Briefing — Shareable Trip Document — Design

**Date:** 2026-08-12
**Status:** Approved by user (chat), implementing

## Goal

Turn any generated trip into a **briefing**: a presentation-style document of
the whole trip — overview, day-by-day explorer, at-a-glance charts, logistics —
readable as a fifth tab by members, and sendable as a read-only link to people
who will never join the trip (grandparents, a group chat).

Prompted by `interactive_trip_planner.html`, a one-off research artifact for a
Fujian–Kinmen trip. What we take from it is the **structure** (overview card →
day explorer → analytics → logistics tiles), not its sand/amber palette and not
its data model.

## Decisions (from brainstorm)

1. **Derive-then-render.** A pure `lib/briefing.ts` maps `TripPayload` → a
   `Briefing` view-model. One presentational component renders it; the members'
   tab and the public page are two callers of the same pair. Rejected:
   components reading `TripPayload` directly with redaction passed as props —
   that is how a forgotten check leaks a booking reference to a public URL.
2. **Keep the app's aesthetic.** Rail / ink / seal, not the source doc's warm
   sand. Structure is borrowed; visual language is not.
3. **Only honest charts.** The source doc's climate bars and "cultural depth vs
   physical effort" bubbles have no data behind them in this app. We do not
   invent numbers for a document people are asked to trust. The three charts we
   ship derive entirely from the stored plan.
4. **No NYE-style A/B comparison.** The app has no concept of alternative trip
   options. Out of scope; revisit only if that concept is ever added.
5. **Opt-in link, redacted by default, one toggle** for booking details.
6. **No frozen snapshot** (considered and deferred): the public link renders
   live trip data. A stored snapshot would make redaction bulletproof by
   construction and stop a shared document shifting mid-trip, but costs a
   refresh action and the confusion of staleness. Revisit if drift bites.

## The derived model

`buildBriefing(payload, opts)` in `lib/briefing.ts`, pure and React-free:

```ts
interface Briefing {
  title: string;                    // tripName
  subtitle: string;                 // "11 days · 3 cities · winter"
  dateRange: { start: string; end: string } | null;   // null when no startDate
  party: { adults: number; kids: number };
  cities: BriefingCity[];           // visit order, with chineseName + day numbers
  days: BriefingDay[];              // destination, slots, items, travel legs
  charts: {
    daysPerCity: { label: string; value: number }[];
    interestMix: { label: string; value: number }[];   // see note below
    pace: { day: number; items: number }[];
  };
  logistics: { tips: string[]; bookings: BriefingBooking[] };
  redacted: boolean;
}

interface BriefingOptions { redacted: boolean; includeBookings: boolean }
```

Every field traces to data already stored: `TripData.tripName`, `startDate`,
`input` (days, season, adults, kids, interests), `plan.days[]` (destination,
`ScheduledItem` slot/kind/title/note/interests), `plan.tips[]`, the curated
`Destination` metadata (chineseName, knownFor, foods), and `Ticket[]`.

Two derivations worth pinning down, because both could reasonably be read the
other way:

- **`interestMix`** counts each interest tag on each scheduled item once, so an
  item tagged `["food", "history"]` adds one to both. The total therefore
  exceeds the item count, and the chart is labelled as a tag count, not a share
  of the itinerary.
- **`pace`** counts scheduled items per day including travel, arrival and
  departure blocks — it describes how full a day feels, not how many activities
  it contains.

The public page calls `getTrip(id)` with **no** requesting member, so the
payload comes back without `joinCode`. Passing a member there would leak the
join code into a public render.

### Redaction table

Redaction is a property of the derived object, applied server-side before data
crosses the wire — never a rendering concern.

| Data | Members' tab | Public link | Public + bookings toggle |
|---|---|---|---|
| Itinerary, tips, charts, city metadata | shown | shown | shown |
| Member names, tick attribution, progress counts | shown | **dropped** | **dropped** |
| Ticket kind, title, date, time, from, to | shown | shown | shown |
| Ticket confirmation, price, notes | shown | **dropped** | shown |
| `Ticket.addedBy` | shown | **dropped** | **dropped** |

Booking *shape* survives redaction because "Flight, Dec 24, 11:45, SIN→FOC" is
what makes the document useful; the confirmation reference is what makes it
sensitive. `Ticket.notes` is free text a member typed and could contain
anything, so it travels with confirmations rather than with times.

Member identity is dropped under `redacted` regardless of the bookings toggle —
the toggle governs booking detail only, never who is on the trip.

## Storage

New table in both stores, created by the existing idempotent schema blocks
(`db.ts` `SCHEMA`, `pgStore.ts` bootstrap) exactly as `wallets` was:

```sql
CREATE TABLE IF NOT EXISTS briefings (
  code TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  include_bookings INTEGER NOT NULL DEFAULT 0,   -- boolean in Postgres
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS briefings_trip ON briefings(trip_id);
```

A separate table rather than columns on `trips`: `CREATE TABLE IF NOT EXISTS`
runs safely against the existing SQLite file and against Supabase, whereas new
columns would need a real `ALTER` migration on both backends.

One live code per trip (enforced by the unique index). Revoke is `DELETE`, so
previously shared links go dead. Re-enabling mints a fresh code — a revoked
link is never resurrected. `ON DELETE CASCADE` retires the link with the trip.

`lib/server/ids.ts` gains `newBriefingCode()` — `randomCode(12)` over the
existing ambiguity-free alphabet (~60 bits). Longer than the 10-char wallet code
because it is the sole secret guarding a public URL. Allocation retries on
primary-key collision up to 3 times, matching `createWallet`.

Store functions, added to `tripStore.ts` (SQLite), `pgStore.ts` (Postgres) and
the `store.ts` facade:

- `enableBriefing(tripId, includeBookings)` → `{ code }` — upserts, reusing the
  existing code when one is live so the toggle does not invalidate shared links.
- `setBriefingBookings(tripId, includeBookings)` → `boolean`
- `revokeBriefing(tripId)` → `boolean`
- `getBriefingByCode(code)` → `{ tripId, includeBookings } | null`
- `getBriefingForTrip(tripId)` → `{ code, includeBookings } | null`

## Routes

**`POST /api/trips/[id]/briefing`** — members only, Zod-validated body
`{ memberName, enabled, includeBookings }`, guarded by the existing `isMember`
check like every other mutation. Returns `{ code, includeBookings }` or
`{ code: null }` after a revoke. The code travels in the response body, never in
a URL.

**`GET /b/[code]`** — a server component. It resolves code → trip in the store,
calls `getTrip`, derives with `{ redacted: true }`, and renders `BriefingView`.

The trip id never appears in the public URL, and there is no public JSON
endpoint. This matters: `GET /api/trips/:id` returns the full payload — tickets,
members, checks — to anyone holding the id, so the trip id is itself a bearer
secret. A public URL containing it would hand over the whole trip.

### Access gate

`proxy.ts` currently redirects every path to `/unlock` when `ACCESS_CODE` is
set, which would block the exact person a briefing is sent to. `/b/` is exempted
from the matcher: the 12-char briefing code is a stronger secret than a shared
access code, and requiring both defeats the feature. Approved in chat.

## Rendering

`components/trip/BriefingView.tsx` is presentational and takes only a
`Briefing` — no fetching, no redaction logic, no knowledge of which caller
mounted it.

- **Overview**: title, date range, party, cities in order with Chinese names,
  season.
- **Day explorer**: day list plus detail pane at `lg:`, accordion below. Under
  `@media print` every day expands, so the briefing survives being printed —
  something the source artifact cannot do.
- **Charts** (`components/briefing/charts/`): three hand-rolled SVG components
  in the rail/ink/sky/seal palette, drawn the way `ChinaMap.tsx` already draws.
  Days-per-city as a segmented rail line, interest mix as a bar, daily pace as
  columns. No chart library enters the bundle. Each carries an accessible name
  and a visually-hidden data table so it degrades to readable text.
- **Logistics**: generated tips plus bookings grouped by kind, in the source
  doc's three-tile treatment.

`TripView` gains a `Briefing` tab beside Itinerary / Tickets / Packing / Crew,
holding the share controls: enable, copy link, the bookings toggle, revoke.

## Errors and edge cases

- Unknown or revoked code → plain 404, never a redirect that would confirm the
  trip exists.
- No `DATABASE_URL` on Vercel → the tab shows the same 503 guidance as the other
  shared-trip features.
- No `startDate` → days label as "Day 3" with no calendar date; `dateRange` is
  null and the overview omits the date row.
- Empty tickets, single-city trip, or a plan with no tips → those sections are
  omitted rather than rendered as empty chrome.
- Charts guard against a single category and a zero total (no divide-by-zero,
  no NaN width).

## Testing

`lib/briefing.test.ts` carries the weight, and the redaction tests are the
point: build a payload stuffed with confirmations, prices, notes, `addedBy`
values, member names and checks, serialize the redacted output, and assert none
of those strings appear anywhere in it. That single test fails loudly when a
future field is added and forgotten.

Also covered:

- Derivation — days-per-city sums to trip length; interest mix counts scheduled
  items; pace has one point per day; date range with and without `startDate`;
  cities in visit order, not alphabetical.
- Bookings toggle — confirmations present with the toggle on, absent with it
  off, member identity absent either way.
- Store (mirroring the wallet tests, run against SQLite) — mint, code lookup,
  toggle preserves the code, revoke makes the code unresolvable, re-enable
  yields a different code, trip delete cascades.

No new end-to-end tests; the existing suite covers the trip page shell.

## Out of scope

Frozen snapshots, A/B option comparison, climate or effort data, PDF export
beyond `@media print`, and importing the Fujian–Kinmen itinerary itself.
