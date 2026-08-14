# Trip Tracker & Money — Design

**Date:** 2026-08-15
**Status:** Approved by user (chat), spec under review

## Goal

Close the two biggest gaps between this app and Wanderlog, chosen by the user
from a feature gap analysis:

1. **Money** — a group expense log with multi-currency spends, per-currency
   totals, optional converted grand totals, per-member balances, settle-up
   suggestions and repayment tracking.
2. **Trip Tracker** — a live during-the-trip experience: today dashboard
   (now/next, progress), a shared journal with photos, trip stats, and a
   post-trip recap.

Both ship as **two new tabs** on the trip page (`Money`, `Tracker`) alongside
Itinerary / Tickets / Packing / Crew / Briefing.

A second project — planning enrichments (notes on days/activities, pre-trip
to-do list, distances/travel times in the itinerary) — was scoped in the same
brainstorm and **deliberately deferred to its own spec**.

## Decisions (from brainstorm)

1. **Approach A — extend the trip snapshot.** Expenses, settlements, journal
   entries and currency settings are trip-scoped records in the existing
   store (SQLite locally / on the user's Raspberry Pi, Postgres on Vercel).
   Every write bumps the trip `version`, so the existing polling sync
   distributes changes to all members. Rejected: morphing the Itinerary tab
   into a tracker during the trip (complicates the largest component, hides
   the planning view mid-trip); outsourcing money to Splitwise (requires
   accounts, breaking the app's deliberate accountless model).
2. **Multi-currency by storage, not by conversion.** Each expense records its
   own currency. Totals are always shown as plain per-currency sums
   (`CNY: ¥1,240` / `SGD: S$85`) with no rates required. Conversion is an
   optional extra: manual per-trip rates (CNY per 1 unit of foreign
   currency) unlock converted grand totals (`Total CNY:` / `Total SGD:`).
   No live FX API — rates are entered by hand and clearly informational.
3. **Balances stay per-currency.** Debts are computed and settled in the
   currency they were incurred in. Converting debts with a hand-entered rate
   invites arguments; the converted view is for totals only.
4. **Repayments are records, not flags.** A `Settlement` (`from`, `to`,
   `amount`, `currency`, `date`) nets against expense debts. This supports
   partial repayments and aggregated repayment of many expenses at once.
   "Mark repaid" on a suggested transfer pre-fills a settlement.
5. **Equal splits only (v1).** An expense is split equally among a chosen
   subset of members (default: everyone). Custom per-member amounts are
   deferred until real trips need them.
6. **Hybrid photo storage.** Uploads go to local disk where the filesystem
   is writable (Raspberry Pi, local dev) — the user plans to self-host on a
   Pi. On Vercel (read-only fs) the upload button hides itself via a
   `features.photoUploads` capability flag and the journal composer offers
   paste-a-URL photo links (Google Drive / Photos / anything) instead. Link
   photos work on every host.
7. **Members-only data.** Expenses, settlements and journal never appear on
   the public briefing page (`/b/[code]`). The briefing derivation already
   redacts server-side; the new records are simply never included in it.
8. **Amounts are integers in minor units** (fen / cents). The UI accepts
   major units with decimals and converts; no float arithmetic anywhere in
   money code.

## Data model

New shared types in `lib/tripShared.ts`:

```ts
export type ExpenseCategory =
  | "food" | "transport" | "lodging" | "tickets" | "shopping" | "other";

export interface Expense {
  id: string;
  date: string;              // ISO yyyy-mm-dd
  title: string;
  category: ExpenseCategory;
  amount: number;            // minor units (fen/cents), integer > 0
  currency: string;          // 3-letter uppercase ISO-style code, e.g. "CNY"
  paidBy: string;            // member name
  splitAmong: string[];      // member names; the form always saves an
                             // explicit list. [] is tolerated defensively
                             // and resolved as "all members at computation
                             // time".
  notes: string | null;
  addedBy: string;
  createdAt: number;
}

export interface Settlement {
  id: string;
  date: string;              // ISO yyyy-mm-dd
  from: string;              // member who repaid
  to: string;                // member who was repaid
  amount: number;            // minor units, integer > 0
  currency: string;
  recordedBy: string;
  createdAt: number;
}

export interface JournalPhoto {
  kind: "upload" | "link";
  ref: string;               // photoId for uploads, absolute URL for links
}

export interface JournalEntry {
  id: string;
  date: string;              // ISO yyyy-mm-dd — the trip day it belongs to
  text: string;
  photos: JournalPhoto[];
  by: string;                // author member name
  createdAt: number;
  updatedAt: number;
}

export interface CurrencySettings {
  home: string | null;                 // e.g. "SGD"; null = no conversion
  rates: Record<string, number>;       // currency code -> CNY per 1 unit
}
```

`TripPayload` grows: `expenses: Expense[]`, `settlements: Settlement[]`,
`journal: JournalEntry[]`, `currencySettings: CurrencySettings`, and
`features: { photoUploads: boolean }`.

Member renames/removals are not a concern: members are append-only names in
this app. If a member named in `paidBy`/`splitAmong` is unknown at render
time, show the name as-is (do not crash, do not drop the expense).

## Money tab

- **Add/edit expense form**: date (default today), title, amount + currency
  picker (CNY and SGD as quick picks, free-typed code allowed), category
  chips, paid-by (default: the current member), split-among toggles
  (default: all). Any member can edit or delete any expense — the same trust
  model as tickets.
- **Totals card** — exactly the user's requested format:
  - Always: one line per currency, plain sums (`CNY: ¥1,240.50`,
    `SGD: S$85.00`).
  - When `currencySettings.home` and the needed rates exist: converted grand
    totals (`Total CNY: ¥1,682.50`, `Total SGD: S$323.55`). Expenses in a
    currency with no rate are listed as unconverted remainder, never
    silently dropped.
  - A small settings popover edits home currency and rates.
- **Balances card**: per currency, each member's net position, where
  positive means "is owed money":
  `net = expenses paid − share owed + repayments sent − repayments received`.
  Below it, minimal-transfer suggestions computed
  greedily (largest debtor pays largest creditor). Each suggestion has
  **"mark repaid"**, which records a pre-filled, editable `Settlement`
  (partial amounts allowed).
- **Repayments list**: recorded settlements with date/from/to/amount, each
  deletable (mistakes happen).
- **Category breakdown**: per-currency bars reusing
  `components/briefing/charts/BarChart.tsx`.

## Tracker tab

State is chosen by comparing today (device-local date; the whole party is in
UTC+8 whether home in Singapore or on the ground in China) with `startDate`
and the plan's day count.

- **No start date**: prompt to set one (link to trip settings), plus the
  pre-trip readiness glance below.
- **Before the trip**: countdown ("12 days to go") + readiness: packing
  progress %, tickets on file count.
- **During the trip**:
  - **Header**: Day X of Y, today's city, overall activity progress
    (checked / total).
  - **Now & next**: the current time slot (before 12:00 = morning, before
    18:00 = afternoon, else evening) selects from today's plan the current
    and next unchecked items.
  - **Today's schedule**: today's items with tick-off using the existing
    check keys — ticks made here appear in the Itinerary tab and for all
    members, and vice versa.
  - **Journal**: composer for a text entry + photos (upload where supported,
    link otherwise) attached to any trip day (default today). Entries are
    grouped under their day, attributed, editable/deletable by their author
    only.
  - **Spend snapshot**: today's and whole-trip spend per currency; links to
    the Money tab.
  - **Stats strip**: cities reached so far (from day index vs plan), rail km
    covered so far (haversine over `lib/geo.ts` between consecutive plan
    cities already passed), activities completed, journal entry count.
- **After the trip**: recap — full stats, total spend per currency, and the
  journal rendered as a scrollable trip diary.

## Photo storage

- `POST /api/trips/:id/photos` (multipart, members only): accepts
  JPEG/PNG/WebP up to 8 MB, stores as
  `data/uploads/trips/<tripId>/<photoId>.<ext>`, returns `{ photoId }`.
  On hosts without a writable filesystem the route returns 503 with a hint
  (same pattern as shared-trips-without-DB).
- `GET /api/trips/:id/photos/:photoId`: streams the file with the right
  content type. Access requires knowing the unguessable trip id — the same
  visibility rule as the rest of the trip data.
- Capability detection at startup sets `features.photoUploads` in
  `TripPayload` (attempt/verify writability of the uploads dir, cached).
- Deleting a journal entry (or removing a photo from it) deletes the
  referenced uploaded files best-effort; orphaned files are acceptable, leaks
  of entries referencing missing files are not (render a placeholder).
- Photo ids come from the existing id helper (`lib/server/ids.ts`) —
  unguessable, no user input in file paths. Extension is derived from the
  validated content type, never from the uploaded filename.

## API routes

All Zod-validated in `lib/server/schemas.ts`, member-checked like
checks/tickets, mirroring the tickets route layout:

| Route | Methods | Notes |
|---|---|---|
| `/api/trips/:id/expenses` | POST | create |
| `/api/trips/:id/expenses/:expenseId` | PATCH, DELETE | any member |
| `/api/trips/:id/settlements` | POST | create |
| `/api/trips/:id/settlements/:settlementId` | DELETE | any member |
| `/api/trips/:id/journal` | POST | create |
| `/api/trips/:id/journal/:entryId` | PATCH, DELETE | author only |
| `/api/trips/:id/currency` | PUT | home + rates |
| `/api/trips/:id/photos` | POST | 503 when unsupported |
| `/api/trips/:id/photos/:photoId` | GET | streams file |

Validation: `amount` integer, `> 0`, `<= 100_000_000` minor units;
`currency` normalized to `/^[A-Z]{3}$/`; dates valid ISO `yyyy-mm-dd`;
`splitAmong`/`paidBy`/`from`/`to` must be current members; rates finite,
`> 0`; journal text non-empty up to 5,000 chars; ≤ 12 photos per entry;
link photos must be `https://` URLs.

## Storage

- New tables `expenses`, `settlements`, `journal_entries` in both backends
  (`lib/server/db.ts` for SQLite, `lib/server/pgStore.ts` for Postgres),
  keyed by `trip_id`, created via the existing migration path
  (`lib/server/migrate.ts`). `splitAmong` and `photos` stored as JSON
  columns. Currency settings as a JSON column on `trips` (nullable —
  absent means defaults).
- Store facade (`lib/server/store.ts` / `tripStore.ts`) gains CRUD methods;
  **every mutation bumps `version` and `updatedAt`** so polling members see
  changes within the existing sync window.

## Pure logic modules

- `lib/money.ts` — per-currency totals, converted totals (with unconverted
  remainder), per-currency net balances from expenses minus settlements,
  greedy minimal-transfer settle-up, minor-unit formatting. Pure,
  React-free, densely tested.
- `lib/tracker.ts` — day-index math (start date + plan length, date-string
  comparison, no Date-object timezone traps), before/during/after state,
  now/next slot selection, cities-so-far and rail-km-so-far stats. Pure,
  React-free, tested.

## Error handling

Same conventions as the rest of the API: 400 with Zod issues, 403 for
non-members (or non-authors on journal edits), 404 unknown trip/record,
503 for photo upload on unsupported hosts with an explanatory hint. The UI
surfaces failures inline (form-level message) and never silently drops a
write; polling refetch reconciles state after every successful mutation.

## Testing

Vitest, following the existing `lib/*.test.ts` and
`lib/server/tripStore.test.ts` patterns:

- `lib/money.test.ts` — totals per currency; converted totals incl. missing
  -rate remainder; balance netting with settlements (full, partial,
  over-payment); settle-up minimality on known fixtures; rounding: equal
  splits distribute remainder fen deterministically (largest-remainder,
  stable by member order).
- `lib/tracker.test.ts` — day boundaries (day 1 on start date, last day,
  day after end), no-start-date state, slot cutoffs at 12:00/18:00,
  stats on partial progress.
- Store tests — CRUD for the three record types bumps version; journal
  author-only rules enforced at the API layer (schema tests).
- Schema tests for every new input shape (valid + representative invalids).

## Out of scope (this spec)

- Planning enrichments: notes on days/activities, pre-trip to-do list,
  distances/travel times in the itinerary — **next spec**.
- Custom (non-equal) expense splits; live FX rates; receipts OCR.
- Email forwarding/import, AI recommendations, flight status (need external
  services or accounts).
- Photo uploads on Vercel via blob storage — revisit if the app stays on
  Vercel long-term instead of the Pi.
- Journal/photos on the public briefing page.
