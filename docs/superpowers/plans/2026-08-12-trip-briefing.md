# Trip Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render any trip as a shareable briefing document — a members-only tab plus an opt-in read-only public link guarded by its own bearer code.

**Architecture:** A pure `lib/briefing.ts` maps `TripPayload` → a `Briefing` view-model, applying redaction at derive time so sensitive fields never reach a public render. One presentational `BriefingView` renders that model for both the members' tab and the public `/b/[code]` page. Share links live in a new `briefings` table keyed by a 12-char bearer code.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Zod v4, vitest, better-sqlite3 + postgres.js.

**Spec:** `docs/superpowers/specs/2026-08-12-trip-briefing-design.md`

## Global Constraints

- **Immutable derivation.** `buildBriefing` never mutates its input payload. Build new objects.
- **Redaction by shape, not by branch.** `BriefingBooking` has no `addedBy` field at all, and `Briefing.crew` is `null` when redacted. A field that cannot be represented cannot leak.
- **No new runtime dependencies.** Charts are hand-drawn. Do not add Chart.js, Plotly, Recharts, or d3-scale.
- **Test config reality:** `vitest.config.ts` includes only `lib/**/*.test.ts` with `environment: "node"`. There is no React testing library in this project. Tasks 1–6 are TDD with real unit tests; tasks 7–10 are UI and are verified in the browser via the dev server. Do not add a React test harness — that is out of scope.
- **Existing code style:** named exports, `type Props = {...}` destructured in the parameter list, Tailwind classes using the project tokens (`ink`, `ink-soft`, `rail`, `rail-deep`, `sky`, `mist`, `paper`, `seal`).
- **Commit format:** conventional commits (`feat:`, `test:`, `fix:`), ending with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.
- Run tests with `npm test` (single run) — `npm run test:watch` for iteration.

## Deviations from the spec (deliberate, flag if you disagree)

1. **`setBriefingBookings` is folded into `enableBriefing`.** The spec listed both. `enableBriefing` is idempotent — it reuses a live code and just updates the flag — so a second function would be a duplicate path. Fewer functions, same behaviour.
2. **Bar charts are CSS, not SVG.** The spec said all three charts are SVG. Horizontal bars with text labels are simpler and more responsive as flex + a width percentage; the daily-pace columns stay SVG where the geometry actually earns it. No dependency either way, which was the point of the constraint.
3. **`export const metadata` sets `robots: noindex, nofollow` on `/b/[code]`.** Not in the spec, but a bearer-token URL that Google can index is a hole. Added in Task 10.

## File Structure

| File | Responsibility |
|---|---|
| `lib/briefing.ts` (create) | Types + `buildBriefing`. Pure, no React, no I/O. |
| `lib/briefing.test.ts` (create) | Derivation and redaction tests. |
| `lib/server/ids.ts` (modify) | Add `newBriefingCode()`. |
| `lib/server/db.ts` (modify) | Add `briefings` table to `SCHEMA`. |
| `lib/server/tripStore.ts` (modify) | SQLite briefing functions. |
| `lib/server/tripStore.test.ts` (modify) | Briefing store tests. |
| `lib/server/pgStore.ts` (modify) | Postgres briefing functions + table bootstrap. |
| `lib/server/store.ts` (modify) | Facade routing to the right backend. |
| `lib/server/schemas.ts` (modify) | `BriefingShareSchema`. |
| `app/api/trips/[id]/briefing/route.ts` (create) | GET current state, POST enable/toggle/revoke. Members only. |
| `components/briefing/charts/BarChart.tsx` (create) | Horizontal labelled bars (days-per-city, interest mix). |
| `components/briefing/charts/ColumnChart.tsx` (create) | SVG columns (daily pace). |
| `components/trip/BriefingView.tsx` (create) | The document. Presentational, takes only a `Briefing`. |
| `components/trip/BriefingShare.tsx` (create) | Share controls: enable, copy, bookings toggle, revoke. |
| `components/TripView.tsx` (modify) | Fifth tab wiring. |
| `app/b/[code]/page.tsx` (create) | Public read-only page. |
| `proxy.ts` (modify) | Exempt `/b/` from the `ACCESS_CODE` gate. |

---

### Task 1: Briefing model — overview, cities, days

**Files:**
- Create: `lib/briefing.ts`
- Test: `lib/briefing.test.ts`

**Interfaces:**
- Consumes: `TripPayload`, `TripData`, `Ticket`, `TicketKind` from `lib/tripShared.ts`; `ItemKind`, `TimeSlot` from `lib/itinerary.ts` and `lib/types.ts`; `dayDate` from `lib/tickets.ts`; `DESTINATIONS` from `lib/data`.
- Produces: every type below, plus `buildBriefing(payload: TripPayload, opts: BriefingOptions): Briefing`. Tasks 2, 3, 7, 8, 9, 10 all depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `lib/briefing.test.ts`. This file's `payload()` helper is used by Tasks 2 and 3 as well — write it exactly as shown.

```ts
import { describe, expect, test } from "vitest";
import { buildBriefing } from "./briefing";
import type { TripPayload } from "./tripShared";

function payload(overrides: Partial<TripPayload> = {}): TripPayload {
  return {
    id: "abc123",
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "Fujian run",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["beijing", "chengdu"],
        days: 3,
        season: "winter",
        adults: 4,
        kids: 3,
        interests: ["food", "history"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              { id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK" },
              {
                id: "i2",
                slot: "afternoon",
                kind: "activity",
                title: "Forbidden City",
                interests: ["history"],
                note: "Book ahead",
              },
            ],
          },
          {
            day: 2,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              {
                id: "i3",
                slot: "morning",
                kind: "activity",
                title: "Hutong food walk",
                interests: ["food", "history"],
              },
            ],
          },
          {
            day: 3,
            destinationId: "chengdu",
            destinationName: "Chengdu",
            items: [{ id: "i4", slot: "morning", kind: "travel", title: "Rail to Chengdu" }],
          },
        ],
        tips: ["Set up Alipay before flying."],
      },
      packing: [],
      foods: [],
      destinationNames: ["Beijing", "Chengdu"],
    },
    members: [{ name: "Ada", joinedAt: 1 }],
    checks: [{ key: "item:i1", by: "Ada" }],
    tickets: [],
    ...overrides,
  };
}

const FULL = { redacted: false, includeBookings: true } as const;

describe("buildBriefing — overview", () => {
  test("titles the briefing and summarises days, cities and season", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.title).toBe("Fujian run");
    expect(b.subtitle).toBe("3 days · 2 cities · winter");
  });

  test("counts days from the plan, not the original input", () => {
    const p = payload();
    p.data.input.days = 99;
    expect(buildBriefing(p, FULL).subtitle).toBe("3 days · 2 cities · winter");
  });

  test("derives a date range from the start date", () => {
    expect(buildBriefing(payload(), FULL).dateRange).toEqual({
      start: "2026-12-24",
      end: "2026-12-26",
    });
  });

  test("has no date range when the trip has no start date", () => {
    const p = payload();
    p.data.startDate = null;
    const b = buildBriefing(p, FULL);
    expect(b.dateRange).toBeNull();
    expect(b.days.every((d) => d.date === null)).toBe(true);
  });

  test("groups cities in visit order with their day numbers", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.cities).toEqual([
      { id: "beijing", name: "Beijing", chineseName: "北京", days: [1, 2] },
      { id: "chengdu", name: "Chengdu", chineseName: "成都", days: [3] },
    ]);
  });

  test("leaves chineseName null for cities outside the curated set", () => {
    const p = payload();
    p.data.plan.days[2].destinationId = "Q1234";
    p.data.plan.days[2].destinationName = "Quanzhou";
    expect(buildBriefing(p, FULL).cities[1]).toEqual({
      id: "Q1234",
      name: "Quanzhou",
      chineseName: null,
      days: [3],
    });
  });

  test("carries the party and each day's items", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.party).toEqual({ adults: 4, kids: 3 });
    expect(b.days[0]).toEqual({
      day: 1,
      date: "2026-12-24",
      destinationName: "Beijing",
      items: [
        { id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK", time: null, note: null },
        {
          id: "i2",
          slot: "afternoon",
          kind: "activity",
          title: "Forbidden City",
          time: null,
          note: "Book ahead",
        },
      ],
    });
  });

  test("does not mutate the payload it is given", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    buildBriefing(p, FULL);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/briefing.test.ts`
Expected: FAIL — `Failed to resolve import "./briefing"`.

- [ ] **Step 3: Write the implementation**

Create `lib/briefing.ts`:

```ts
import { DESTINATIONS } from "./data";
import type { ItemKind } from "./itinerary";
import { dayDate } from "./tickets";
import type { TicketKind, TripPayload } from "./tripShared";
import type { TimeSlot } from "./types";

export interface BriefingCity {
  id: string;
  name: string;
  /** Curated destinations carry one; catalog cities do not. */
  chineseName: string | null;
  days: number[];
}

export interface BriefingItem {
  id: string;
  slot: TimeSlot;
  kind: ItemKind;
  title: string;
  time: string | null;
  note: string | null;
}

export interface BriefingDay {
  day: number;
  /** ISO date, or null when the trip has no start date. */
  date: string | null;
  destinationName: string;
  items: BriefingItem[];
}

/**
 * A ticket flattened for display. Deliberately has no `addedBy` field: the
 * shape itself is the guarantee that a public briefing cannot name a member.
 */
export interface BriefingBooking {
  kind: TicketKind;
  title: string;
  date: string | null;
  endDate: string | null;
  time: string | null;
  from: string | null;
  to: string | null;
  confirmation: string | null;
  price: string | null;
  notes: string | null;
}

export interface ChartSlice {
  label: string;
  value: number;
}

export interface PacePoint {
  day: number;
  items: number;
}

export interface Briefing {
  title: string;
  subtitle: string;
  dateRange: { start: string; end: string } | null;
  party: { adults: number; kids: number };
  cities: BriefingCity[];
  days: BriefingDay[];
  charts: {
    daysPerCity: ChartSlice[];
    interestMix: ChartSlice[];
    pace: PacePoint[];
  };
  logistics: { tips: string[]; bookings: BriefingBooking[] };
  /** Members and progress — null on a redacted (public) briefing. */
  crew: { members: string[]; checkedCount: number } | null;
  redacted: boolean;
}

export interface BriefingOptions {
  /** True for the public link: drops member identity and (by default) booking secrets. */
  redacted: boolean;
  /** Public links may opt back into confirmation refs, prices and notes. */
  includeBookings: boolean;
}

function chineseNameFor(destinationId: string): string | null {
  return DESTINATIONS.find((d) => d.id === destinationId)?.chineseName ?? null;
}

function citiesOf(payload: TripPayload): BriefingCity[] {
  const cities: BriefingCity[] = [];
  for (const day of payload.data.plan.days) {
    const seen = cities.find((c) => c.id === day.destinationId);
    if (seen) {
      seen.days.push(day.day);
      continue;
    }
    cities.push({
      id: day.destinationId,
      name: day.destinationName,
      chineseName: chineseNameFor(day.destinationId),
      days: [day.day],
    });
  }
  return cities;
}

function daysOf(payload: TripPayload): BriefingDay[] {
  const { startDate } = payload.data;
  return payload.data.plan.days.map((day) => ({
    day: day.day,
    date: dayDate(startDate, day.day),
    destinationName: day.destinationName,
    items: day.items.map((i) => ({
      id: i.id,
      slot: i.slot,
      kind: i.kind,
      title: i.title,
      time: i.time ?? null,
      note: i.note ?? null,
    })),
  }));
}

export function buildBriefing(payload: TripPayload, opts: BriefingOptions): Briefing {
  const { data } = payload;
  const cities = citiesOf(payload);
  const days = daysOf(payload);
  const dayCount = days.length;
  const range = dayCount > 0 ? dayDate(data.startDate, dayCount) : null;
  const start = dayDate(data.startDate, 1);

  return {
    title: data.tripName,
    subtitle: `${dayCount} days · ${cities.length} ${
      cities.length === 1 ? "city" : "cities"
    } · ${data.input.season}`,
    dateRange: start && range ? { start, end: range } : null,
    party: { adults: data.input.adults, kids: data.input.kids },
    cities,
    days,
    charts: { daysPerCity: [], interestMix: [], pace: [] },
    logistics: { tips: [], bookings: [] },
    crew: null,
    redacted: opts.redacted,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/briefing.test.ts`
Expected: PASS — 8 tests in `buildBriefing — overview`.

- [ ] **Step 5: Commit**

```bash
git add lib/briefing.ts lib/briefing.test.ts
git commit -m "feat: briefing model with overview, cities and day derivation"
```

---

### Task 2: Chart derivation

**Files:**
- Modify: `lib/briefing.ts` (replace the `charts: { daysPerCity: [], interestMix: [], pace: [] }` placeholder)
- Test: `lib/briefing.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `buildBriefing`, `ChartSlice`, `PacePoint` from Task 1; `interestMeta` from `lib/meta.ts`.
- Produces: populated `Briefing["charts"]`. Task 7 renders these; Task 8 passes them through.

Two counting rules, chosen deliberately — do not "fix" them:
- `interestMix` counts **each tag on each item**, so an item tagged `["food","history"]` adds one to both. Totals exceed the item count; the chart is labelled a tag count, not a share of the trip.
- `pace` counts **all** items including travel, arrival and departure — it measures how full a day feels.

- [ ] **Step 1: Write the failing test**

Append to `lib/briefing.test.ts`:

```ts
describe("buildBriefing — charts", () => {
  test("counts days per city in visit order", () => {
    expect(buildBriefing(payload(), FULL).charts.daysPerCity).toEqual([
      { label: "Beijing", value: 2 },
      { label: "Chengdu", value: 1 },
    ]);
  });

  test("counts every interest tag on every item, busiest first", () => {
    expect(buildBriefing(payload(), FULL).charts.interestMix).toEqual([
      { label: "History & Culture", value: 2 },
      { label: "Food & Street Eats", value: 1 },
    ]);
  });

  test("omits interests that no scheduled item carries", () => {
    const labels = buildBriefing(payload(), FULL).charts.interestMix.map((s) => s.label);
    expect(labels).not.toContain("Beach & Islands");
  });

  test("reports pace as items per day, counting travel and arrival blocks", () => {
    expect(buildBriefing(payload(), FULL).charts.pace).toEqual([
      { day: 1, items: 2 },
      { day: 2, items: 1 },
      { day: 3, items: 1 },
    ]);
  });

  test("survives a plan with no days", () => {
    const p = payload();
    p.data.plan.days = [];
    const b = buildBriefing(p, FULL);
    expect(b.charts).toEqual({ daysPerCity: [], interestMix: [], pace: [] });
    expect(b.subtitle).toBe("0 days · 0 cities · winter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/briefing.test.ts`
Expected: FAIL — the four populated-chart tests get `[]`.

- [ ] **Step 3: Write the implementation**

In `lib/briefing.ts`, add the `interestMeta` import and two helpers, then use them in `buildBriefing`:

```ts
import { interestMeta } from "./meta";
import type { Interest, TimeSlot } from "./types";
```

```ts
function interestMix(payload: TripPayload): ChartSlice[] {
  const counts = new Map<Interest, number>();
  for (const day of payload.data.plan.days) {
    for (const item of day.items) {
      for (const tag of item.interests ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ label: interestMeta(id)?.label ?? id, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
```

Replace the placeholder in the returned object:

```ts
    charts: {
      daysPerCity: cities.map((c) => ({ label: c.name, value: c.days.length })),
      interestMix: interestMix(payload),
      pace: days.map((d) => ({ day: d.day, items: d.items.length })),
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/briefing.test.ts`
Expected: PASS — 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add lib/briefing.ts lib/briefing.test.ts
git commit -m "feat: briefing chart derivation from plan data"
```

---

### Task 3: Logistics and redaction

**Files:**
- Modify: `lib/briefing.ts` (replace the `logistics` and `crew` placeholders)
- Test: `lib/briefing.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `buildBriefing`, `BriefingBooking` from Task 1; `sortTickets` from `lib/tickets.ts`.
- Produces: populated `Briefing["logistics"]` and `Briefing["crew"]`. Tasks 8 and 10 depend on `crew === null` meaning "public".

This is the security-critical task. The last test is the backstop: it serialises the whole redacted briefing and asserts no sensitive string survives anywhere in it. If a future field is added and forgotten, that test fails.

- [ ] **Step 1: Write the failing test**

Append to `lib/briefing.test.ts`:

```ts
const PUBLIC_PLAIN = { redacted: true, includeBookings: false } as const;
const PUBLIC_BOOKINGS = { redacted: true, includeBookings: true } as const;

function withTickets(): TripPayload {
  return payload({
    tickets: [
      {
        id: "t2",
        kind: "hotel",
        title: "Ritz Beijing",
        date: "2026-12-25",
        endDate: "2026-12-26",
        time: null,
        from: null,
        to: null,
        confirmation: "HTL-SECRET-99",
        price: "¥1400",
        notes: "Ask for a high floor",
        addedBy: "Ada",
      },
      {
        id: "t1",
        kind: "flight",
        title: "SQ 806",
        date: "2026-12-24",
        endDate: null,
        time: "11:45",
        from: "SIN",
        to: "PEK",
        confirmation: "PNR-SECRET-42",
        price: "$310",
        notes: "Window seats",
        addedBy: "Ada",
      },
    ],
  });
}

describe("buildBriefing — logistics", () => {
  test("carries plan tips through", () => {
    expect(buildBriefing(payload(), FULL).logistics.tips).toEqual([
      "Set up Alipay before flying.",
    ]);
  });

  test("sorts bookings by date and keeps the travel details", () => {
    const bookings = buildBriefing(withTickets(), FULL).logistics.bookings;
    expect(bookings.map((b) => b.title)).toEqual(["SQ 806", "Ritz Beijing"]);
    expect(bookings[0]).toEqual({
      kind: "flight",
      title: "SQ 806",
      date: "2026-12-24",
      endDate: null,
      time: "11:45",
      from: "SIN",
      to: "PEK",
      confirmation: "PNR-SECRET-42",
      price: "$310",
      notes: "Window seats",
    });
  });
});

describe("buildBriefing — redaction", () => {
  test("members' view keeps crew and progress", () => {
    expect(buildBriefing(payload(), FULL).crew).toEqual({
      members: ["Ada"],
      checkedCount: 1,
    });
  });

  test("public view has no crew at all", () => {
    expect(buildBriefing(payload(), PUBLIC_PLAIN).crew).toBeNull();
    expect(buildBriefing(payload(), PUBLIC_BOOKINGS).crew).toBeNull();
  });

  test("public view drops confirmation, price and notes by default", () => {
    const b = buildBriefing(withTickets(), PUBLIC_PLAIN).logistics.bookings[0];
    expect(b.confirmation).toBeNull();
    expect(b.price).toBeNull();
    expect(b.notes).toBeNull();
  });

  test("public view keeps the shape of the journey", () => {
    const b = buildBriefing(withTickets(), PUBLIC_PLAIN).logistics.bookings[0];
    expect(b).toMatchObject({ kind: "flight", title: "SQ 806", time: "11:45", from: "SIN", to: "PEK" });
  });

  test("the bookings toggle restores confirmation, price and notes", () => {
    const b = buildBriefing(withTickets(), PUBLIC_BOOKINGS).logistics.bookings[0];
    expect(b.confirmation).toBe("PNR-SECRET-42");
    expect(b.price).toBe("$310");
    expect(b.notes).toBe("Window seats");
  });

  test("the bookings toggle never restores member identity", () => {
    const serialized = JSON.stringify(buildBriefing(withTickets(), PUBLIC_BOOKINGS));
    expect(serialized).not.toContain("Ada");
  });

  test("no sensitive value survives anywhere in a redacted briefing", () => {
    const serialized = JSON.stringify(buildBriefing(withTickets(), PUBLIC_PLAIN));
    for (const secret of [
      "PNR-SECRET-42",
      "HTL-SECRET-99",
      "$310",
      "¥1400",
      "Window seats",
      "Ask for a high floor",
      "Ada",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("SQ 806");
  });

  test("records which mode produced it", () => {
    expect(buildBriefing(payload(), FULL).redacted).toBe(false);
    expect(buildBriefing(payload(), PUBLIC_PLAIN).redacted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/briefing.test.ts`
Expected: FAIL — `logistics.tips` is `[]`, `bookings` is `[]`, `crew` is `null` even for the members' view.

- [ ] **Step 3: Write the implementation**

In `lib/briefing.ts`, extend the imports and add a booking mapper:

```ts
import { dayDate, sortTickets } from "./tickets";
import type { Ticket, TicketKind, TripPayload } from "./tripShared";
```

```ts
/**
 * `showSecrets` gates confirmation refs, prices and free-text notes. Route,
 * time and title always survive — they are what make the document useful,
 * while the reference number is what makes it sensitive.
 */
function toBooking(t: Ticket, showSecrets: boolean): BriefingBooking {
  return {
    kind: t.kind,
    title: t.title,
    date: t.date,
    endDate: t.endDate,
    time: t.time,
    from: t.from,
    to: t.to,
    confirmation: showSecrets ? t.confirmation : null,
    price: showSecrets ? t.price : null,
    notes: showSecrets ? t.notes : null,
  };
}
```

Replace the `logistics` and `crew` placeholders in the returned object:

```ts
    logistics: {
      tips: [...data.plan.tips],
      bookings: sortTickets(payload.tickets).map((t) =>
        toBooking(t, !opts.redacted || opts.includeBookings)
      ),
    },
    crew: opts.redacted
      ? null
      : { members: payload.members.map((m) => m.name), checkedCount: payload.checks.length },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/briefing.test.ts`
Expected: PASS — 24 tests total.

- [ ] **Step 5: Commit**

```bash
git add lib/briefing.ts lib/briefing.test.ts
git commit -m "feat: briefing logistics and server-side redaction"
```

---

### Task 4: SQLite briefing store

**Files:**
- Modify: `lib/server/ids.ts`
- Modify: `lib/server/db.ts` (the `SCHEMA` template literal)
- Modify: `lib/server/tripStore.ts`
- Test: `lib/server/tripStore.test.ts`

**Interfaces:**
- Consumes: `getDb` from `lib/server/db.ts`.
- Produces: `newBriefingCode(): string`; `BriefingRecord`; `enableBriefing(tripId, includeBookings): { code: string } | null`; `revokeBriefing(tripId): boolean`; `getBriefingByCode(code): { tripId: string; includeBookings: boolean } | null`; `getBriefingForTrip(tripId): BriefingRecord | null`. Task 5 mirrors these signatures for Postgres.

- [ ] **Step 1: Write the failing test**

Append to `lib/server/tripStore.test.ts` — and extend the import on line 12 to include the new functions:

```ts
import {
  createTrip,
  enableBriefing,
  getBriefingByCode,
  getBriefingForTrip,
  getTrip,
  isMember,
  joinTrip,
  revokeBriefing,
  setCheck,
  updateTripData,
} from "./tripStore";
```

```ts
describe("briefing links", () => {
  test("mints a 12-character code resolvable back to the trip", () => {
    const { id } = createTrip(tripData(), "Ada");
    const enabled = enableBriefing(id, false);
    expect(enabled).not.toBeNull();
    expect(enabled!.code).toHaveLength(12);
    expect(getBriefingByCode(enabled!.code)).toEqual({ tripId: id, includeBookings: false });
  });

  test("returns null for a trip that does not exist", () => {
    expect(enableBriefing("nope", false)).toBeNull();
  });

  test("toggling bookings keeps the same code so shared links stay alive", () => {
    const { id } = createTrip(tripData(), "Ada");
    const first = enableBriefing(id, false)!;
    const second = enableBriefing(id, true)!;
    expect(second.code).toBe(first.code);
    expect(getBriefingByCode(first.code)).toEqual({ tripId: id, includeBookings: true });
  });

  test("reads back the live link for a trip", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(getBriefingForTrip(id)).toBeNull();
    const { code } = enableBriefing(id, true)!;
    expect(getBriefingForTrip(id)).toEqual({ code, includeBookings: true });
  });

  test("revoking kills the shared link", () => {
    const { id } = createTrip(tripData(), "Ada");
    const { code } = enableBriefing(id, false)!;
    expect(revokeBriefing(id)).toBe(true);
    expect(getBriefingByCode(code)).toBeNull();
    expect(getBriefingForTrip(id)).toBeNull();
    expect(revokeBriefing(id)).toBe(false);
  });

  test("re-enabling after a revoke mints a different code", () => {
    const { id } = createTrip(tripData(), "Ada");
    const first = enableBriefing(id, false)!;
    revokeBriefing(id);
    const second = enableBriefing(id, false)!;
    expect(second.code).not.toBe(first.code);
    expect(getBriefingByCode(first.code)).toBeNull();
  });

  test("codes use the unambiguous alphabet", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(enableBriefing(id, false)!.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/server/tripStore.test.ts`
Expected: FAIL — `"./tripStore" has no exported member 'enableBriefing'`.

- [ ] **Step 3: Write the implementation**

In `lib/server/ids.ts`, append:

```ts
/**
 * Briefing codes are the sole secret guarding a public URL, so they get more
 * entropy than a wallet code: 12 chars over a 32-symbol alphabet (~60 bits).
 */
export function newBriefingCode(): string {
  return randomCode(12);
}
```

In `lib/server/db.ts`, add to the end of the `SCHEMA` template literal (before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS briefings (
  code TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  include_bookings INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS briefings_trip ON briefings(trip_id);
```

In `lib/server/tripStore.ts`, extend the ids import and append the functions:

```ts
import { newBriefingCode, newJoinCode, newTripId, newWalletCode } from "./ids";
```

```ts
export interface BriefingRecord {
  code: string;
  includeBookings: boolean;
}

/**
 * Idempotent: an existing link keeps its code so already-shared URLs survive a
 * bookings toggle. Only a revoke retires a code.
 */
export function enableBriefing(
  tripId: string,
  includeBookings: boolean
): { code: string } | null {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId) === undefined) return null;

  const existing = db.prepare("SELECT code FROM briefings WHERE trip_id = ?").get(tripId) as
    | { code: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE briefings SET include_bookings = ? WHERE trip_id = ?").run(
      includeBookings ? 1 : 0,
      tripId
    );
    return { code: existing.code };
  }

  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newBriefingCode();
    try {
      db.prepare(
        "INSERT INTO briefings (code, trip_id, include_bookings, created_at) VALUES (?, ?, ?, ?)"
      ).run(code, tripId, includeBookings ? 1 : 0, now);
      return { code };
    } catch (error) {
      // Only a primary-key collision is worth retrying with a fresh code.
      const sqliteCode = (error as { code?: string }).code ?? "";
      if (!sqliteCode.startsWith("SQLITE_CONSTRAINT")) throw error;
    }
  }
  throw new Error("Could not allocate a briefing code");
}

export function revokeBriefing(tripId: string): boolean {
  return getDb().prepare("DELETE FROM briefings WHERE trip_id = ?").run(tripId).changes > 0;
}

export function getBriefingByCode(
  code: string
): { tripId: string; includeBookings: boolean } | null {
  const row = getDb()
    .prepare("SELECT trip_id, include_bookings FROM briefings WHERE code = ?")
    .get(code) as { trip_id: string; include_bookings: number } | undefined;
  if (!row) return null;
  return { tripId: row.trip_id, includeBookings: row.include_bookings === 1 };
}

export function getBriefingForTrip(tripId: string): BriefingRecord | null {
  const row = getDb()
    .prepare("SELECT code, include_bookings FROM briefings WHERE trip_id = ?")
    .get(tripId) as { code: string; include_bookings: number } | undefined;
  if (!row) return null;
  return { code: row.code, includeBookings: row.include_bookings === 1 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the whole suite, including 7 new `briefing links` tests.

Note: an existing `data/app.db` picks up the new table automatically, because `getDb()` runs the full `CREATE TABLE IF NOT EXISTS` schema on every connection.

- [ ] **Step 5: Commit**

```bash
git add lib/server/ids.ts lib/server/db.ts lib/server/tripStore.ts lib/server/tripStore.test.ts
git commit -m "feat: briefing link storage for SQLite"
```

---

### Task 5: Postgres briefing store and facade

**Files:**
- Modify: `lib/server/pgStore.ts`
- Modify: `lib/server/store.ts`

**Interfaces:**
- Consumes: `BriefingRecord` from Task 4.
- Produces: the same four functions as async Postgres versions, plus facade exports `enableBriefing`, `revokeBriefing`, `getBriefingByCode`, `getBriefingForTrip` from `lib/server/store.ts`. Tasks 6 and 10 import from the facade, never from a backend directly.

There is no Postgres test harness in this project (the existing `pgStore` has none either) — correctness here rests on mirroring the SQLite behaviour exactly. Read the SQLite implementation from Task 4 side by side while writing this.

- [ ] **Step 1: Add the table to the Postgres bootstrap**

In `lib/server/pgStore.ts`, inside the `ensureSchema` IIFE, after the `wallets` table:

```ts
      await s`CREATE TABLE IF NOT EXISTS briefings (
        code text PRIMARY KEY,
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        include_bookings boolean NOT NULL DEFAULT false,
        created_at bigint NOT NULL
      )`;
      await s`CREATE UNIQUE INDEX IF NOT EXISTS briefings_trip ON briefings(trip_id)`;
```

- [ ] **Step 2: Write the Postgres functions**

Extend the ids import in `lib/server/pgStore.ts` to include `newBriefingCode`, then append:

```ts
export async function enableBriefing(
  tripId: string,
  includeBookings: boolean
): Promise<{ code: string } | null> {
  await ensureSchema();
  const s = sql();
  const trip = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (trip.length === 0) return null;

  const existing = await s`SELECT code FROM briefings WHERE trip_id = ${tripId}`;
  if (existing.length > 0) {
    await s`UPDATE briefings SET include_bookings = ${includeBookings} WHERE trip_id = ${tripId}`;
    return { code: existing[0].code as string };
  }

  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newBriefingCode();
    try {
      await s`INSERT INTO briefings (code, trip_id, include_bookings, created_at)
        VALUES (${code}, ${tripId}, ${includeBookings}, ${now})`;
      return { code };
    } catch (error) {
      // 23505 = unique_violation; anything else must surface.
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Could not allocate a briefing code");
}

export async function revokeBriefing(tripId: string): Promise<boolean> {
  await ensureSchema();
  const result = await sql()`DELETE FROM briefings WHERE trip_id = ${tripId}`;
  return result.count > 0;
}

export async function getBriefingByCode(
  code: string
): Promise<{ tripId: string; includeBookings: boolean } | null> {
  await ensureSchema();
  const rows = await sql()`SELECT trip_id, include_bookings FROM briefings WHERE code = ${code}`;
  if (rows.length === 0) return null;
  return { tripId: rows[0].trip_id as string, includeBookings: rows[0].include_bookings === true };
}

export async function getBriefingForTrip(tripId: string): Promise<BriefingRecord | null> {
  await ensureSchema();
  const rows = await sql()`SELECT code, include_bookings FROM briefings WHERE trip_id = ${tripId}`;
  if (rows.length === 0) return null;
  return { code: rows[0].code as string, includeBookings: rows[0].include_bookings === true };
}
```

Add `BriefingRecord` to the type import from `./tripStore` at the top of `pgStore.ts` (it already imports `WalletPutResult`-style types there, or add a new `import type { BriefingRecord } from "./tripStore";`).

- [ ] **Step 3: Write the facade**

Append to `lib/server/store.ts`, and add `BriefingRecord` to the existing `import type { JoinResult, WalletPutResult } from "./tripStore";` line:

```ts
export async function enableBriefing(
  tripId: string,
  includeBookings: boolean
): Promise<{ code: string } | null> {
  if (storeMode() === "postgres") return (await pg()).enableBriefing(tripId, includeBookings);
  return sqlite.enableBriefing(tripId, includeBookings);
}

export async function revokeBriefing(tripId: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).revokeBriefing(tripId);
  return sqlite.revokeBriefing(tripId);
}

export async function getBriefingByCode(
  code: string
): Promise<{ tripId: string; includeBookings: boolean } | null> {
  if (storeMode() === "postgres") return (await pg()).getBriefingByCode(code);
  return sqlite.getBriefingByCode(code);
}

export async function getBriefingForTrip(tripId: string): Promise<BriefingRecord | null> {
  if (storeMode() === "postgres") return (await pg()).getBriefingForTrip(tripId);
  return sqlite.getBriefingForTrip(tripId);
}
```

- [ ] **Step 4: Verify types and tests**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: PASS — full suite unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/server/pgStore.ts lib/server/store.ts
git commit -m "feat: briefing link storage for Postgres and store facade"
```

---

### Task 6: Briefing share API

**Files:**
- Modify: `lib/server/schemas.ts`
- Create: `app/api/trips/[id]/briefing/route.ts`

**Interfaces:**
- Consumes: `enableBriefing`, `revokeBriefing`, `getBriefingForTrip`, `isMember`, `storeMode`, `DB_UNAVAILABLE` from `lib/server/store.ts`.
- Produces: `GET /api/trips/:id/briefing?member=Name` → `{ code: string | null; includeBookings: boolean }`; `POST /api/trips/:id/briefing` → same shape. Task 9's `BriefingShare` component calls both.

- [ ] **Step 1: Add the Zod schema**

Append to `lib/server/schemas.ts` (`MemberNameSchema` is already declared in this file at line 28):

```ts
export const BriefingShareSchema = z.object({
  memberName: MemberNameSchema,
  enabled: z.boolean(),
  includeBookings: z.boolean(),
});
```

- [ ] **Step 2: Write the route**

Create `app/api/trips/[id]/briefing/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { BriefingShareSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  enableBriefing,
  getBriefingForTrip,
  isMember,
  revokeBriefing,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

const NO_LINK = { code: null, includeBookings: false };

/** Current share state. Members only — the code is a bearer secret. */
export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? "";
  if (!member || !(await isMember(id, member))) {
    return NextResponse.json({ error: "Only trip members can see the briefing link" }, { status: 403 });
  }
  const record = await getBriefingForTrip(id);
  return NextResponse.json(record ?? NO_LINK);
}

export async function POST(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BriefingShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid briefing settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json(
      { error: "Only trip members can share the briefing" },
      { status: 403 }
    );
  }

  if (!parsed.data.enabled) {
    await revokeBriefing(id);
    return NextResponse.json(NO_LINK);
  }

  const result = await enableBriefing(id, parsed.data.includeBookings);
  if (!result) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json({
    code: result.code,
    includeBookings: parsed.data.includeBookings,
  });
}
```

- [ ] **Step 3: Verify by hand against the dev server**

Start the dev server with the preview tooling (not `npm run dev` in a shell), then create a trip through the UI and note its id and your member name. Check each case:

```bash
curl -s "http://localhost:3000/api/trips/<ID>/briefing?member=<NAME>"
```
Expected: `{"code":null,"includeBookings":false}`

```bash
curl -s -X POST "http://localhost:3000/api/trips/<ID>/briefing" -H "content-type: application/json" -d '{"memberName":"<NAME>","enabled":true,"includeBookings":false}'
```
Expected: `{"code":"<12 CHARS>","includeBookings":false}`

```bash
curl -s -X POST "http://localhost:3000/api/trips/<ID>/briefing" -H "content-type: application/json" -d '{"memberName":"Stranger","enabled":true,"includeBookings":false}'
```
Expected: HTTP 403, `{"error":"Only trip members can share the briefing"}`

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/server/schemas.ts app/api/trips/\[id\]/briefing/route.ts
git commit -m "feat: briefing share API with member-only access"
```

---

### Task 7: Chart components

**Files:**
- Create: `components/briefing/charts/BarChart.tsx`
- Create: `components/briefing/charts/ColumnChart.tsx`

**Interfaces:**
- Consumes: `ChartSlice`, `PacePoint` from `lib/briefing.ts`.
- Produces: `<BarChart title unit slices />` and `<ColumnChart title points />`. Task 8 mounts both.

Both are pure presentational and carry no `"use client"` — they render fine inside a client parent and inside a server page.

- [ ] **Step 1: Write BarChart**

Create `components/briefing/charts/BarChart.tsx`:

```tsx
import type { ChartSlice } from "@/lib/briefing";

type Props = {
  title: string;
  slices: ChartSlice[];
  /** Plural noun for the screen-reader summary, e.g. "days". */
  unit: string;
};

export function BarChart({ title, slices, unit }: Props) {
  if (slices.length === 0) return null;
  const max = Math.max(...slices.map((s) => s.value), 1);

  return (
    <figure className="rounded-xl border border-sky bg-paper p-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {title}
      </figcaption>
      <ul className="mt-3 space-y-2">
        {slices.map((s) => (
          <li
            key={s.label}
            className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-sm sm:grid-cols-[9rem_1fr_2rem]"
          >
            <span className="truncate text-ink-soft" title={s.label}>
              {s.label}
            </span>
            <span className="h-2.5 rounded-full bg-sky" aria-hidden="true">
              <span
                className="block h-full rounded-full bg-rail"
                style={{ width: `${(s.value / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums font-medium text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
      <p className="sr-only">
        {slices.map((s) => `${s.label}: ${s.value} ${unit}`).join(", ")}
      </p>
    </figure>
  );
}
```

- [ ] **Step 2: Write ColumnChart**

Create `components/briefing/charts/ColumnChart.tsx`:

```tsx
import type { PacePoint } from "@/lib/briefing";

type Props = {
  title: string;
  points: PacePoint[];
};

const VIEW_W = 100;
const VIEW_H = 30;
const GAP = 1.2;

export function ColumnChart({ title, points }: Props) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.items), 1);
  const barW = (VIEW_W - GAP * (points.length - 1)) / points.length;

  return (
    <figure className="rounded-xl border border-sky bg-paper p-4">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="mt-3 h-20 w-full"
        role="img"
        aria-label={`Items per day: ${points.map((p) => `day ${p.day}, ${p.items}`).join("; ")}`}
      >
        {points.map((p, i) => {
          const h = (p.items / max) * VIEW_H;
          return (
            <rect
              key={p.day}
              x={i * (barW + GAP)}
              y={VIEW_H - h}
              width={barW}
              height={h}
              className="fill-rail"
            />
          );
        })}
      </svg>
      <p className="mt-1 flex justify-between text-[0.65rem] text-ink-soft">
        <span>Day {points[0].day}</span>
        <span>Day {points[points.length - 1].day}</span>
      </p>
    </figure>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/briefing/charts
git commit -m "feat: briefing bar and column charts without a chart library"
```

---

### Task 8: BriefingView

**Files:**
- Create: `components/trip/BriefingView.tsx`

**Interfaces:**
- Consumes: `Briefing` from `lib/briefing.ts`; `BarChart`, `ColumnChart` from Task 7; `SLOT_META`, `KIND_EMOJI`, `ticketKindMeta` from `lib/meta.ts`.
- Produces: `<BriefingView briefing={...} />`. Mounted by Task 9 (tab) and Task 10 (public page).

The day explorer trick: **every day is always in the DOM**. On `lg` only the selected day is visible; below `lg` and in print, all of them are. That gives a master-detail feel on desktop with zero JS needed for mobile or paper.

- [ ] **Step 1: Write the component**

Create `components/trip/BriefingView.tsx`:

```tsx
"use client";

import { useState } from "react";
import { BarChart } from "@/components/briefing/charts/BarChart";
import { ColumnChart } from "@/components/briefing/charts/ColumnChart";
import type { Briefing, BriefingDay } from "@/lib/briefing";
import { KIND_EMOJI, SLOT_META, ticketKindMeta } from "@/lib/meta";

function DayPanel({ day }: { day: BriefingDay }) {
  return (
    <article className="rounded-2xl border border-sky bg-paper p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sky pb-3">
        <div>
          <span className="rounded-full bg-sky px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-rail-deep">
            {day.destinationName}
          </span>
          <h4 className="mt-2 font-display text-xl text-ink">Day {day.day}</h4>
        </div>
        {day.date && <time className="text-sm text-ink-soft">{day.date}</time>}
      </header>
      {day.items.length === 0 ? (
        <p className="mt-4 text-sm italic text-ink-soft">Nothing scheduled — a free day.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {day.items.map((item) => (
            <li key={item.id} className="flex gap-3 text-sm">
              <span className="w-20 shrink-0 pt-0.5 text-xs uppercase tracking-wide text-ink-soft">
                {item.time ?? SLOT_META[item.slot].label}
              </span>
              <span>
                <span className="font-medium text-ink">
                  {KIND_EMOJI[item.kind] ? `${KIND_EMOJI[item.kind]} ` : ""}
                  {item.title}
                </span>
                {item.note && <span className="block text-xs text-ink-soft">{item.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function BriefingView({ briefing }: { briefing: Briefing }) {
  const [selected, setSelected] = useState(briefing.days[0]?.day ?? 1);

  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-sky bg-mist p-6">
        <h2 className="font-display text-3xl text-ink">{briefing.title}</h2>
        <p className="mt-1 text-ink-soft">{briefing.subtitle}</p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          {briefing.dateRange && (
            <div className="rounded-xl bg-paper p-4">
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Dates</dt>
              <dd className="mt-1 font-medium text-ink">
                {briefing.dateRange.start} → {briefing.dateRange.end}
              </dd>
            </div>
          )}
          <div className="rounded-xl bg-paper p-4">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Party</dt>
            <dd className="mt-1 font-medium text-ink">
              {briefing.party.adults} adults
              {briefing.party.kids > 0 && `, ${briefing.party.kids} kids`}
            </dd>
          </div>
          <div className="rounded-xl bg-paper p-4">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Route</dt>
            <dd className="mt-1 font-medium text-ink">
              {briefing.cities.map((c) => c.name).join(" → ")}
            </dd>
          </div>
        </dl>
        {briefing.crew && (
          <p className="mt-4 text-xs text-ink-soft">
            {briefing.crew.members.join(", ")} · {briefing.crew.checkedCount} items ticked off
          </p>
        )}
      </section>

      <section>
        <h3 className="font-display text-2xl text-ink">The journey</h3>
        <div className="mt-4 grid gap-6 lg:grid-cols-12">
          <nav className="flex gap-2 overflow-x-auto lg:col-span-4 lg:flex-col lg:overflow-visible print:hidden">
            {briefing.days.map((d) => (
              <button
                key={d.day}
                type="button"
                onClick={() => setSelected(d.day)}
                aria-pressed={selected === d.day}
                className={`shrink-0 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  selected === d.day
                    ? "border-rail bg-paper text-ink"
                    : "border-transparent bg-mist text-ink-soft hover:bg-sky"
                }`}
              >
                <span className="block text-xs text-ink-soft">{d.date ?? `Day ${d.day}`}</span>
                <span className="font-medium">{d.destinationName}</span>
              </button>
            ))}
          </nav>
          <div className="space-y-5 lg:col-span-8">
            {briefing.days.map((d) => (
              <div
                key={d.day}
                className={d.day === selected ? "lg:block" : "lg:hidden print:block"}
              >
                <DayPanel day={d} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-display text-2xl text-ink">At a glance</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <BarChart title="Days per city" slices={briefing.charts.daysPerCity} unit="days" />
          <BarChart title="Interest mix" slices={briefing.charts.interestMix} unit="tagged items" />
          <ColumnChart title="Daily pace" points={briefing.charts.pace} />
        </div>
      </section>

      {(briefing.logistics.bookings.length > 0 || briefing.logistics.tips.length > 0) && (
        <section>
          <h3 className="font-display text-2xl text-ink">Logistics</h3>
          {briefing.logistics.bookings.length > 0 && (
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {briefing.logistics.bookings.map((b, i) => (
                <li
                  key={`${b.kind}-${b.title}-${i}`}
                  className="rounded-xl border-l-4 border-rail bg-paper p-4 shadow-sm"
                >
                  <div className="text-xs font-bold uppercase tracking-wide text-rail">
                    {ticketKindMeta(b.kind).emoji} {ticketKindMeta(b.kind).label}
                  </div>
                  <div className="mt-1 font-medium text-ink">{b.title}</div>
                  <div className="text-sm text-ink-soft">
                    {[b.date, b.time, b.from && b.to ? `${b.from} → ${b.to}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {b.confirmation && (
                    <div className="mt-2 font-mono text-xs text-ink">{b.confirmation}</div>
                  )}
                  {b.price && <div className="text-xs text-ink-soft">{b.price}</div>}
                  {b.notes && <div className="mt-1 text-xs italic text-ink-soft">{b.notes}</div>}
                </li>
              ))}
            </ul>
          )}
          {briefing.logistics.tips.length > 0 && (
            <ul className="mt-4 space-y-2">
              {briefing.logistics.tips.map((tip) => (
                <li key={tip} className="flex gap-2 text-sm text-ink-soft">
                  <span aria-hidden="true">·</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/trip/BriefingView.tsx
git commit -m "feat: briefing document view with print-friendly day explorer"
```

---

### Task 9: Briefing tab and share controls

**Files:**
- Create: `components/trip/BriefingShare.tsx`
- Modify: `components/TripView.tsx` (line 14 `TABS`; the tab render block after the `Crew` section around line 461)

**Interfaces:**
- Consumes: the API from Task 6; `BriefingView` from Task 8; `buildBriefing` from `lib/briefing.ts`.
- Produces: a `Briefing` tab in the trip page. Nothing downstream depends on it.

`BriefingShare` is its own file so `TripView.tsx` (already 546 lines against an 800 ceiling) does not absorb another block of fetch-and-form state.

- [ ] **Step 1: Write the share controls**

Create `components/trip/BriefingShare.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

type Props = {
  tripId: string;
  memberName: string;
};

type ShareState = { code: string | null; includeBookings: boolean };

export function BriefingShare({ tripId, memberName }: Props) {
  const [state, setState] = useState<ShareState>({ code: null, includeBookings: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!memberName) return;
    let live = true;
    fetch(`/api/trips/${tripId}/briefing?member=${encodeURIComponent(memberName)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ShareState | null) => {
        if (live && data) setState(data);
      })
      .catch(() => {
        // A failed read just leaves the controls in the "not shared" state.
      });
    return () => {
      live = false;
    };
  }, [tripId, memberName]);

  const send = useCallback(
    async (enabled: boolean, includeBookings: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/trips/${tripId}/briefing`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberName, enabled, includeBookings }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(body?.error ?? "Could not update the briefing link");
          return;
        }
        setState((await res.json()) as ShareState);
      } catch {
        setError("Could not reach the server");
      } finally {
        setBusy(false);
      }
    },
    [tripId, memberName]
  );

  if (!memberName) {
    return (
      <p className="rounded-xl border border-dashed border-rail/40 bg-paper px-4 py-3 text-sm text-ink-soft">
        Join the trip to share this briefing.
      </p>
    );
  }

  const url = state.code ? `${window.location.origin}/b/${state.code}` : null;

  return (
    <div className="rounded-xl border border-sky bg-mist p-4 print:hidden">
      {!state.code ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-soft">
            Share a read-only copy with people who are not joining the trip.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(true, false)}
            className="rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create share link"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="flex-1 truncate rounded-lg bg-paper px-3 py-2 font-mono text-xs text-ink">
              {url}
            </code>
            <button
              type="button"
              onClick={() => {
                if (!url) return;
                navigator.clipboard.writeText(url).then(
                  () => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  },
                  () => setError("Copy failed — select the link and copy it manually")
                );
              }}
              className="rounded-lg bg-rail px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-rail-deep"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={state.includeBookings}
              disabled={busy}
              onChange={(e) => send(true, e.target.checked)}
            />
            Include confirmation numbers, prices and ticket notes
          </label>
          <p className="text-xs text-ink-soft">
            Names and tick-offs are never shown on the shared link.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => send(false, false)}
            className="text-sm font-medium text-seal underline disabled:opacity-50"
          >
            Revoke link
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into TripView**

In `components/TripView.tsx`, change line 14:

```tsx
const TABS = ["Itinerary", "Tickets", "Packing", "Crew", "Briefing"] as const;
```

Add these imports alongside the existing ones:

```tsx
import { BriefingShare } from "@/components/trip/BriefingShare";
import { BriefingView } from "@/components/trip/BriefingView";
import { buildBriefing } from "@/lib/briefing";
```

After the closing brace of the `{tab === "Crew" && ( ... )}` block, add:

```tsx
      {tab === "Briefing" && (
        <div className="mt-5 space-y-6">
          <BriefingShare tripId={tripId} memberName={myName} />
          <BriefingView
            briefing={buildBriefing(payload, { redacted: false, includeBookings: true })}
          />
        </div>
      )}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

Start the dev server via `preview_start` (never `npm run dev` in a shell). Then:

1. Create a trip, add a flight ticket with a confirmation number, and open the trip page.
2. Click **Briefing**. Expect the overview card, a day list with the first day selected, three charts, and the ticket under Logistics with its confirmation shown.
3. Click a different day in the list — the detail panel swaps.
4. Narrow the window below 1024px — every day renders stacked, and the day-picker becomes a horizontal scroller.
5. Click **Create share link** — a `/b/<12 chars>` URL appears.
6. Check the console via `read_console_messages` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add components/trip/BriefingShare.tsx components/TripView.tsx
git commit -m "feat: briefing tab with share link controls"
```

---

### Task 10: Public briefing page

**Files:**
- Create: `app/b/[code]/page.tsx`
- Modify: `proxy.ts` (line 32 matcher)

**Interfaces:**
- Consumes: `getBriefingByCode`, `getTrip`, `storeMode` from `lib/server/store.ts`; `buildBriefing` from `lib/briefing.ts`; `BriefingView` from Task 8.
- Produces: the public route. Nothing depends on it.

Two things here are load-bearing and easy to get wrong:
- `getTrip(record.tripId)` is called with **no** second argument. Passing a member name makes `getTrip` attach `joinCode` to the payload, which would render the join code into a page anyone with the link can read.
- The trip id never reaches the client. `buildBriefing` output carries no id, and `BriefingView` never receives the payload.

- [ ] **Step 1: Write the page**

Create `app/b/[code]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefingView } from "@/components/trip/BriefingView";
import { buildBriefing } from "@/lib/briefing";
import { getBriefingByCode, getTrip, storeMode } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** A bearer-token URL must never end up in a search index. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ code: string }> };

export default async function BriefingPage({ params }: Props) {
  const { code } = await params;
  if (storeMode() === "unavailable") notFound();

  const record = await getBriefingByCode(code);
  if (!record) notFound();

  // No requesting member: getTrip attaches the join code for members, and this
  // page is readable by anyone holding the link.
  const payload = await getTrip(record.tripId);
  if (!payload) notFound();

  const briefing = buildBriefing(payload, {
    redacted: true,
    includeBookings: record.includeBookings,
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <BriefingView briefing={briefing} />
      <footer className="mt-12 border-t border-sky pt-4 text-xs text-ink-soft">
        A read-only trip briefing. Ask whoever shared this link if you need the booking details.
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Exempt the route from the access gate**

In `proxy.ts`, replace the matcher on line 32:

```ts
export const config = {
  // `b/` is exempt: a briefing code is itself a 60-bit bearer secret, and the
  // recipient of a shared link will not have the site's access code.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|unlock|api/unlock|b/).*)"],
};
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

With the dev server running:

1. Open the share link created in Task 9 in a new tab. Expect the same document — and **no** "Create share link" controls, no member names, no tick counts.
2. Confirm the flight's confirmation number is **absent** (the toggle defaults off).
3. Back in the trip tab, tick **Include confirmation numbers…**, reload the public tab — the confirmation now appears.
4. Revoke the link, reload the public tab — expect a 404 page.
5. Visit `/b/AAAAAAAAAAAA` — expect a 404 page, not an error.
6. Print-preview the public page (Ctrl+P): every day appears, the day-picker and share controls do not.
7. `read_console_messages` — expect no errors.

- [ ] **Step 5: Run the full suite and commit**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

```bash
git add app/b proxy.ts
git commit -m "feat: public read-only briefing page at /b/[code]"
```

---

## Self-review notes

Spec coverage checked section by section: derived model (Tasks 1–3), redaction table (Task 3), storage incl. the unique index and cascade (Tasks 4–5), routes and the member guard (Task 6), the access-gate exemption (Task 10), rendering incl. print behaviour and accessible chart fallbacks (Tasks 7–8), error cases — unknown code, DB unavailable, no start date, empty sections, single-category charts (Tasks 1, 2, 6, 8, 10), and the test list (Tasks 1–4).

Two spec items are intentionally not implemented and are recorded under "Deviations" above: `setBriefingBookings` as a standalone function, and SVG rendering for the two bar charts.

Type consistency verified across tasks: `buildBriefing(payload, opts)`, `BriefingOptions { redacted, includeBookings }`, `enableBriefing(tripId, includeBookings)`, and the `{ code, includeBookings }` API response shape are used identically wherever they appear.
