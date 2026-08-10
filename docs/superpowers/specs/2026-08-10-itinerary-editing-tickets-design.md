# Itinerary Editing + Tickets — Design

**Date:** 2026-08-10
**Status:** Approved by user (chat), implementing

## Goal

Let trip members edit the day-by-day plan by hand (add / edit / remove / reorder items,
append days) and attach structured booking "tickets" (flights, trains, hotels,
attractions) to the trip, Wanderlog-style — shown both in a dedicated Tickets tab and
inline on their matching itinerary days.

## Decisions (from brainstorm)

1. **Tickets are structured entries only** — no file uploads, no blob storage.
2. **Full itinerary editing**: add custom items to a day, edit/remove generated items,
   reorder within a day (up/down arrows), append extra days.
3. **Tickets tab + inline chips on matching days** (date-based matching).
4. **The plan becomes yours after creation**: the generator writes the plan once at
   trip creation. After that, members edit it directly. Changing trip settings is an
   explicit **Rebuild plan** action with a warning that manual itinerary edits are
   discarded (tickets and packing checks always survive).

## Data model

### `ScheduledItem` (lib/itinerary.ts)

- Gains `id: string` — stable identity, generated when the item is created (by the
  generator or by a member). Needed for editing, reordering, and durable check keys.
- `ItemKind` gains `"custom"` for member-added items.
- Gains optional `time?: string` (free text like "19:00") shown on the item.

### `Ticket` (lib/tripShared.ts)

```ts
type TicketKind = "flight" | "train" | "hotel" | "attraction" | "other";

interface Ticket {
  id: string;
  kind: TicketKind;
  title: string;              // "CA1858 PEK → SHA", "Marriott Bund"
  date: string | null;        // ISO yyyy-mm-dd
  endDate: string | null;     // hotels: checkout date
  time: string | null;        // free text
  from: string | null;        // flights/trains
  to: string | null;
  confirmation: string | null;
  price: string | null;       // free text
  notes: string | null;
  addedBy: string;            // member name
}
```

### Storage

- Tickets are stored **outside `TripData`** (a sibling of members/checks in both the
  SQLite and Postgres stores), so plan rebuilds can never touch them.
- `TripPayload` gains `tickets: Ticket[]`.

### Check keys + migration

- Schedule checks move from index-based `day:{day}:{index}` to id-based `item:{id}`.
- Lazy migration on trip read: if plan items lack ids, assign them and rewrite
  existing schedule checks from index keys to id keys, then persist. Packing keys are
  unchanged.

## API (all member-gated, Zod-validated)

- `POST /api/trips/:id/plan` — body is one operation (discriminated union):
  - `addItem { day, item: { name, slot, time?, note? } }`
  - `updateItem { day, itemId, patch: { name?, slot?, time?, note? } }`
  - `removeItem { day, itemId }`
  - `moveItem { day, itemId, direction: "up" | "down" }`
  - `addDay { destinationId? }` (defaults to the last day's destination)
  - Applied server-side to the stored plan via pure functions in `lib/planOps.ts`;
    bumps trip version; returns the fresh `TripPayload`.
- `POST /api/trips/:id/tickets` — add a ticket.
- `PATCH /api/trips/:id/tickets/:ticketId` — edit.
- `DELETE /api/trips/:id/tickets/:ticketId` — remove.
- Existing `PATCH /api/trips/:id` (settings) = **Rebuild plan**: regenerates the plan,
  keeps tickets and packing checks, deletes now-orphaned schedule checks. The client
  shows a confirmation warning first.

## UI

### Itinerary tab (members only see edit affordances)

- Per day: **+ Add item** (name, slot, optional time/note), ✎ edit, ✕ remove,
  ↑↓ reorder within the day.
- Custom items render with their own emoji in the existing ticket aesthetic.
- **+ Add day** at the bottom of the itinerary.
- Ticket chips render on their matching day (hotel tickets span date → endDate).
  Day dates derive from the trip `startDate`; without one, a hint says "set a start
  date to pin tickets to days".

### Tickets tab (new, 4th tab)

- All tickets as boarding-pass-styled cards, sorted by date (undated last).
- Add / edit / delete inline forms. Kind picker: ✈️ 🚄 🏨 🎟️ 📌.

## Sync & conflicts

- Existing 4s polling + version guard handle propagation.
- Edits are optimistic client-side; the server response is authoritative.
- Ops are single-item and applied atomically server-side, so concurrent member edits
  don't clobber whole plans.

## Testing

- Unit tests (vitest, existing setup): `lib/planOps.test.ts` for every op incl. edge
  cases (unknown day/item id, move at boundary), `lib/tickets.test.ts` for
  date-matching and sort order.
- Manual browser verification of the trip page flows.
