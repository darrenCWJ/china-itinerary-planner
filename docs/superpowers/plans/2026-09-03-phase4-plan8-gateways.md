# Phase 4 — Plan 8: trip gateways

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not tick them in the committed file — this repo leaves plan files untouched during execution.

**Goal:** Give every trip two gateways — the airport it flies into and the one it flies out of — stamped by the server when the trip is created, shown and editable on the trip page without rebuilding the plan, and offered in the wizard so the suggested route can start where the traveller actually lands.

**Architecture:** Two IATA codes on `TripInput`, optional *and* nullable, read only through a leaf accessor and never migrated. Defaults come from the plan's first and last stops through the existing `mainAirportFor` ranking. Edits go through a new `PUT /api/trips/:id/gateways` that writes `input` alone under the plan route's version guard, because `PATCH /api/trips/:id` rebuilds the plan and wipes every schedule tick. `suggestRoute` gains an optional `start` that anchors the tour; without it, the search is byte-for-byte what ships today.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Zod 4, Vitest 4 (node + jsdom projects), Playwright. **No new dependency, no new artifact, no migration.**

**Spec:** [2026-08-29-phase4-country-region-levels-design.md](../specs/2026-08-29-phase4-country-region-levels-design.md) §10.3 and decision D3. Plan 7 (§10.1–10.2) shipped; this is the last plan of the series.

---

## What the research established

### The plan's order is the itinerary's order

`buildItinerary` (`lib/itinerary.ts:165-181`) walks `input.destinationIds` in the order given and truncates to `input.days` (`active = chosen.slice(0, min(chosen.length, days))`). The wizard's "Apply this order" (`MapExplorer.tsx:640-645`) writes the suggested route straight into `destinationIds`. So **the arrival city is `plan.days[0].destinationId` and the departure city is `plan.days.at(-1).destinationId`** — the plan's, not the selection's, because a selection longer than the trip loses its tail. Stamp from the plan.

### `suggestRoute` has exactly one caller and no anchor today

`components/map/MapExplorer.tsx:612` is the only call. The function (`lib/route.ts:301-323`) runs nearest-neighbour from *every* located start and keeps the shortest, ties to the lower id. Two tests pin that it is order-independent: `lib/route.test.ts:85-90` ("is deterministic for the same input in any order") and `lib/route.country.test.ts:56-60` (the three-argument form equals the four-argument form). §10.3 says both survive untouched — a fourth, optional parameter is what makes that true.

**Worked example the tests use.** Lima (-12.046, -77.043), Cusco (-13.532, -71.968), Arequipa (-16.409, -71.538). Unanchored, the two shortest tours tie at ~910 km (Lima→Cusco→Arequipa and Arequipa→Cusco→Lima) and the tie goes to `arequipa` by id sort. Anchored at Jorge Chávez (LIM, -12.022, -77.114) the tour starts at Lima. **The anchor visibly changes the answer**, which is what makes the test meaningful.

### Three states, and `755c8dd` is the reason

`app/api/trips/route.ts:60-70` stamps `initialCurrencySettings` at create, and commit `755c8dd` records why the stamp always writes a key: when absent could mean either "legacy row" or "never set", a brand-new trip inherited the legacy meaning and priced Panama in yuan. Gateways have the same three states — **absent** (a trip saved before this plan, or a client that never sent one), **`null`** (the traveller said "none": overland, or no airport worth naming), **a code**. The create route fills *absent only*; `null` and codes survive. Readers collapse absent and null to null, because to a reader they mean the same thing.

### Zod strips what it is not told about

`lib/server/schemas.ts:330-332` and `:312-315` are the two scars: `z.object()` drops unlisted keys, and the route's own 200 response then overwrites the client's correct value. `TripInputSchema` (`:25-36`) must list both fields or the create route accepts a gateway, drops it, and stamps its own guess in its place.

### `PATCH /api/trips/[id]` is a rebuild, not an update

`app/api/trips/[id]/route.ts:66-85`: `buildTripData` from scratch, `updateTripData`, then **`clearScheduleChecks`**. Saving a gateway through it would wipe every tick the members made. Hence the sub-route. `app/api/trips/[id]/plan/route.ts:44-73` is the pattern for a version-guarded `input`/`plan` write: re-read, `updateTripDataIf(id, data, trip.version)`, retry up to `MAX_WRITE_ATTEMPTS = 3`, then 409 *"The trip is being edited by someone else right now — try again."* Copy it exactly.

Nothing in `components/` or `app/` sends `PATCH` to the trip root today (`grep -rn PATCH` finds only the `useTripPayload` docblock and the ticket/expense/journal sub-routes), so the carry-forward in Task 5 defends an API path, not a UI one.

### The airport picker yields text, not a code

`components/trip/AirportInput.tsx` deliberately stays a text field — tickets store free text — and `pick()` writes `"Name (IATA)"`. A gateway is a *code*, so Task 7 adds an `onPick(airport)` callback and a thin `AirportPicker` that holds the text and emits `{ iata, airport }`. `lib/server/airports.ts` has no `server-only` guard (Plan 7's trap 1): browser code takes airports as data (the search route, or a picked `Airport`) and never imports it.

### Fixture facts, verified against the committed artifacts on 2026-09-03

- Peru shard: Lima `G3936456` (-12.04318, -77.02824), Cusco `G3941584` (-13.53188, -71.96701), Arequipa `G3947322`.
- Airports artifact: `LIM` large (-12.0219, -77.1143), `CUZ` large (-13.5357, -71.9388), `AQP` large (-16.3408, -71.5695); `PEK` large (40.0773, 116.5967) 25 km from Beijing's curated point, `PKX` large 45 km; `SHA` large (31.1981, 121.3343) 14 km from Shanghai's, `PVG` large 33 km. So the main airports are **LIM, CUZ, PEK, SHA**. Unit tests use hand-written airport fixtures at these coordinates so a nightly artifact refresh cannot move them; the e2e reads the real artifact and asserts LIM/CUZ.
- `toTripTabId(null)` is `"plan"` (`lib/nav.ts:41-43`), so `/trip/:id` opens on the Plan tab.

---

## Global Constraints

- `arrivalAirport?: string | null` and `departureAirport?: string | null` on `TripInput` — **optional and nullable** (spec §10.3). Absent, null and a code are three states; readers collapse the first two, writers never write `undefined`.
- **No migration** (spec §10.3, commit `0cfd0a9`). Trips are a whole-blob `jsonb`; nothing rewrites stored rows.
- **Both fields are listed in `TripInputSchema`** (spec §10.3: "Zod is the load-bearing risk").
- **The server stamps the defaults at create** (spec §10.3), from the plan's first and last stops, filling absent only.
- **Saved through `PUT /api/trips/:id/gateways`, never `PATCH /api/trips/:id`** (spec §10.3). The sub-route writes `input` alone, never rebuilds, never calls `clearScheduleChecks`.
- **`suggestRoute` gains an optional `start`** (spec §10.3, D3). With it absent the function is unchanged: `route.test.ts` "is deterministic for the same input in any order" and `route.country.test.ts` "the estimator's default parameter" are not edited and stay green.
- **Anchoring only when the traveller chose a gateway** (D3): a bare typed code with no list pick does not anchor.
- Every new control is a real 44 CSS px target: `inline-flex min-h-[var(--tap-min)] items-center` (bare `min-h` strands the label — see PR #22's six fixes).
- **Vitest projects split by extension:** `.test.ts` under `lib/` and `scripts/` runs in node; `.test.tsx` under `components/` and `lib/` runs in jsdom. A `.test.ts` under `components/` runs **nowhere**.
- `lib/server/airports.ts` is server-only by convention. Nothing under `components/` or `lib/` (non-server) imports it.
- Commit messages: conventional commits, body explaining why, ending `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run `npx tsc --noEmit -p tsconfig.json` before every commit; it must be clean.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/itinerary.ts` | `TripInput` gains the two fields (types only) | Modify |
| `lib/tripGateways.ts` | **new leaf** — `TripGateways`, `tripGateways`, `withGateways`, `carryGateways`, `IATA_CODE` | Create |
| `lib/tripGateways.test.ts` | node | Create |
| `lib/server/schemas.ts` | `IataSchema`; `TripInputSchema` fields; `GatewaysSchema` | Modify |
| `lib/server/schemas.test.ts` | node | Modify |
| `lib/route.ts` | `RouteOptions`, `suggestRoute(..., options)` | Modify |
| `lib/route.test.ts` | node | Modify |
| `lib/gatewayDefaults.ts` | **new** — `defaultGateways`, `applyDefaultGateways` | Create |
| `lib/gatewayDefaults.test.ts` | node | Create |
| `app/api/trips/route.ts` | stamp defaults after the build | Modify |
| `app/api/trips/[id]/route.ts` | PATCH carries gateways forward | Modify |
| `lib/server/createTripRoute.test.ts` | node, mocked seams | Create |
| `app/api/trips/[id]/gateways/route.ts` | **new** — `PUT` | Create |
| `lib/server/gatewaysRoute.test.ts` | node, mocked seams | Create |
| `components/trip/AirportInput.tsx` | `onPick` prop | Modify |
| `components/trip/AirportInput.test.tsx` | jsdom | Modify |
| `components/trip/AirportPicker.tsx` | **new** — code-valued wrapper | Create |
| `components/trip/AirportPicker.test.tsx` | jsdom | Create |
| `components/trip/GatewaysStrip.tsx` | **new** — the strip and its editor | Create |
| `components/trip/GatewaysStrip.test.tsx` | jsdom | Create |
| `components/trip/PlanTab.tsx` | renders the strip | Modify |
| `components/trip/PlanTab.test.tsx` | jsdom | Modify |
| `components/TripView.tsx` | `saveGateways`, passes `gateways` | Modify |
| `components/map/MapExplorer.tsx` | "Flying into" picker; anchored `suggestRoute` | Modify |
| `components/map/MapExplorer.test.tsx` | jsdom | Modify |
| `components/DestinationStep.tsx` | threads two props | Modify |
| `app/plan/page.tsx` | wizard state; create payload | Modify |
| `e2e/gateways.spec.ts` | browser proof, signed-in | Create |
| `playwright.config.ts` | `chromium` project also matches the new spec | Modify |
| `README.md` | API table row | Modify |

---

### Task 1: The fields and their reader

**Files:**
- Modify: `lib/itinerary.ts:6-18` (`TripInput`)
- Create: `lib/tripGateways.ts`
- Test: `lib/tripGateways.test.ts`

**Interfaces:**
- Produces: `IATA_CODE: RegExp`; `interface TripGateways { arrival: string | null; departure: string | null }`; `tripGateways(data: TripData): TripGateways`; `withGateways(data: TripData, gateways: TripGateways): TripData`; `carryGateways(next: TripInput, previous: TripInput): TripInput`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/tripGateways.test.ts
import { describe, expect, test } from "vitest";
import type { TripInput } from "./itinerary";
import type { TripData } from "./tripShared";
import { carryGateways, IATA_CODE, tripGateways, withGateways } from "./tripGateways";

function tripData(input: Partial<TripInput>): TripData {
  return {
    tripName: "Family Trip",
    startDate: null,
    input: {
      destinationIds: ["beijing"],
      days: 3,
      season: "spring",
      adults: 2,
      kids: 0,
      interests: [],
      country: "CN",
      ...input,
    },
    plan: { days: [], tips: [] },
    packing: [],
    foods: [],
    destinationNames: [],
  };
}

describe("IATA_CODE", () => {
  test("accepts exactly three uppercase letters", () => {
    expect(IATA_CODE.test("LIM")).toBe(true);
    expect(IATA_CODE.test("lim")).toBe(false);
    expect(IATA_CODE.test("LIMA")).toBe(false);
    expect(IATA_CODE.test("")).toBe(false);
  });
});

describe("tripGateways", () => {
  test("reads a trip saved before the fields existed as having no gateways", () => {
    // Absent and null mean the same thing to a reader. They differ only at
    // the write end, where applyDefaultGateways fills absent and leaves null.
    expect(tripGateways(tripData({}))).toEqual({ arrival: null, departure: null });
  });

  test("reads an explicit none as none", () => {
    expect(tripGateways(tripData({ arrivalAirport: null, departureAirport: null }))).toEqual({
      arrival: null,
      departure: null,
    });
  });

  test("reads the stored codes once a trip carries them", () => {
    expect(tripGateways(tripData({ arrivalAirport: "LIM", departureAirport: "CUZ" }))).toEqual({
      arrival: "LIM",
      departure: "CUZ",
    });
  });
});

describe("withGateways", () => {
  test("replaces both gateways and nothing else", () => {
    const before = tripData({ arrivalAirport: "LIM" });
    const after = withGateways(before, { arrival: "AQP", departure: null });
    expect(after.input.arrivalAirport).toBe("AQP");
    expect(after.input.departureAirport).toBeNull();
    // The plan is the members' draft; a gateway edit never touches it.
    expect(after.plan).toBe(before.plan);
    expect(after.input.destinationIds).toBe(before.input.destinationIds);
    // And the input it was given is not mutated.
    expect(before.input.arrivalAirport).toBe("LIM");
    expect("departureAirport" in before.input).toBe(false);
  });
});

describe("carryGateways", () => {
  const stored = tripData({ arrivalAirport: "LIM", departureAirport: null }).input;

  test("an input that omits its gateways inherits the stored ones", () => {
    const next = tripData({}).input;
    const carried = carryGateways(next, stored);
    expect(carried.arrivalAirport).toBe("LIM");
    expect(carried.departureAirport).toBeNull();
  });

  test("null is a clear, not an omission", () => {
    const next = tripData({ arrivalAirport: null }).input;
    expect(carryGateways(next, stored).arrivalAirport).toBeNull();
  });

  test("a code sent wins over the stored one", () => {
    const next = tripData({ arrivalAirport: "AQP" }).input;
    expect(carryGateways(next, stored).arrivalAirport).toBe("AQP");
  });

  test("absent on both sides stays absent, so a legacy row stays legacy", () => {
    const carried = carryGateways(tripData({}).input, tripData({}).input);
    expect("arrivalAirport" in carried).toBe(false);
    expect("departureAirport" in carried).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tripGateways.test.ts`
Expected: FAIL — `Cannot find module './tripGateways'`.

- [ ] **Step 3: Add the fields to `TripInput`**

In `lib/itinerary.ts`, after the `country?: CountryCode;` member:

```ts
  /**
   * The airports the trip flies into and out of, as IATA codes (spec §10.3).
   * Three states, all real: absent (a trip saved before the field existed, or
   * a client that never sent one), `null` (explicitly none — overland, or no
   * airport worth naming), and a code. The create route fills absent only.
   * Read through `tripGateways`, never directly; never write `undefined`.
   */
  arrivalAirport?: string | null;
  departureAirport?: string | null;
```

- [ ] **Step 4: Write the reader module**

```ts
// lib/tripGateways.ts
import type { TripInput } from "./itinerary";
import type { TripData } from "./tripShared";

/**
 * A leaf, like lib/tripCountry.ts: this module value-imports NOTHING, so the
 * shell and the wizard can read a trip's gateways without paying for the
 * airports artifact or the country facts. The two imports above are types.
 */

/** A three-letter IATA code, uppercase. The same shape `IataSchema` enforces. */
export const IATA_CODE = /^[A-Z]{3}$/;

export interface TripGateways {
  arrival: string | null;
  departure: string | null;
}

/**
 * The airports a trip flies into and out of — the only way callers read them.
 *
 * Absent and null both read as null. A trip saved before the field existed has
 * no gateway, and "none" is exactly what that means to a reader; the two
 * states differ only at the WRITE end, where `applyDefaultGateways` fills an
 * absent field and leaves a null one alone (the `755c8dd` rule: absent must
 * mean one thing). No caller should ever see `undefined` here.
 */
export function tripGateways(data: TripData): TripGateways {
  return {
    arrival: data.input.arrivalAirport ?? null,
    departure: data.input.departureAirport ?? null,
  };
}

/**
 * The same trip with its gateways replaced. Touches `input` and nothing else:
 * the plan is the members' draft, and a gateway is a fact about the trip, not
 * a reason to regenerate it.
 */
export function withGateways(data: TripData, gateways: TripGateways): TripData {
  return {
    ...data,
    input: {
      ...data.input,
      arrivalAirport: gateways.arrival,
      departureAirport: gateways.departure,
    },
  };
}

/**
 * An input that omits its gateways inherits the stored trip's.
 *
 * PATCH /api/trips/[id] rebuilds from a whole `TripInput`, and a client written
 * before these fields existed sends one without them. Absent there means
 * "unchanged", never "cleared" — `null` is how a client clears — so a rebuild
 * cannot silently drop the airports a member set. Absent on both sides stays
 * absent: a legacy row is not reclassified by being rebuilt.
 */
export function carryGateways(next: TripInput, previous: TripInput): TripInput {
  const carried: TripInput = { ...next };
  if (next.arrivalAirport === undefined && previous.arrivalAirport !== undefined) {
    carried.arrivalAirport = previous.arrivalAirport;
  }
  if (next.departureAirport === undefined && previous.departureAirport !== undefined) {
    carried.departureAirport = previous.departureAirport;
  }
  return carried;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/tripGateways.test.ts lib/tripShared.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (9 new tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/itinerary.ts lib/tripGateways.ts lib/tripGateways.test.ts
git commit -m "feat: give trips two gateway fields and a leaf reader for them" -m "Optional and nullable on purpose (spec §10.3): absent, null and a code are three states, and 755c8dd is the bug report for conflating two of them. Read through tripGateways, which collapses the first two; the create route will fill absent only. No migration — a legacy trip reads as having no gateways, which is true." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Zod knows the fields

**Files:**
- Modify: `lib/server/schemas.ts:18-36` (after `CountryCodeSchema`, inside `TripInputSchema`) and after `CurrencySettingsSchema` (`:306-316`)
- Test: `lib/server/schemas.test.ts`

**Interfaces:**
- Produces: `GatewaysSchema` (exported) — `{ arrivalAirport: string | null; departureAirport: string | null }`, both keys required, codes trimmed and uppercased. `TripInputSchema`'s output type gains `arrivalAirport?: string | null; departureAirport?: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/server/schemas.test.ts` (it already imports `describe`, `expect`, `test` and the schemas it tests; add `GatewaysSchema` and `TripInputSchema` to the import from `./schemas` if they are not there):

```ts
describe("TripInputSchema gateways", () => {
  const base = {
    destinationIds: ["beijing"],
    days: 3,
    season: "spring",
    adults: 2,
    kids: 0,
    interests: [],
  };

  test("carries a gateway through, uppercased, instead of stripping it", () => {
    // The schemas.ts:330-332 scar: an unlisted key is dropped and the route's
    // own 200 then overwrites the client's value with the server's guess.
    const ok = TripInputSchema.safeParse({ ...base, arrivalAirport: " lim ", departureAirport: "CUZ" });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.arrivalAirport).toBe("LIM");
    expect(ok.success && ok.data.departureAirport).toBe("CUZ");
  });

  test("keeps absent absent and null null — they are different states", () => {
    const absent = TripInputSchema.safeParse(base);
    expect(absent.success && "arrivalAirport" in absent.data).toBe(false);
    const cleared = TripInputSchema.safeParse({ ...base, arrivalAirport: null });
    expect(cleared.success && cleared.data.arrivalAirport).toBeNull();
  });

  test("rejects anything that is not a three-letter code", () => {
    expect(TripInputSchema.safeParse({ ...base, arrivalAirport: "LIMA" }).success).toBe(false);
    expect(TripInputSchema.safeParse({ ...base, departureAirport: "L1M" }).success).toBe(false);
    expect(TripInputSchema.safeParse({ ...base, arrivalAirport: "" }).success).toBe(false);
  });
});

describe("GatewaysSchema", () => {
  test("requires both keys, so a save can never half-apply", () => {
    expect(GatewaysSchema.safeParse({ arrivalAirport: "LIM" }).success).toBe(false);
    expect(GatewaysSchema.safeParse({}).success).toBe(false);
  });

  test("accepts null as a clear and normalises codes", () => {
    const ok = GatewaysSchema.safeParse({ arrivalAirport: "lim", departureAirport: null });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data).toEqual({ arrivalAirport: "LIM", departureAirport: null });
  });

  test("rejects a malformed code", () => {
    expect(GatewaysSchema.safeParse({ arrivalAirport: "LIMA", departureAirport: null }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/server/schemas.test.ts`
Expected: FAIL — `GatewaysSchema` is not exported; the carry-through test sees `arrivalAirport` stripped.

- [ ] **Step 3: Add the schemas**

In `lib/server/schemas.ts`, directly after `CountryCodeSchema`:

```ts
/** A gateway airport, as the IATA code data/airports.json keys on. */
const IataSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "3-letter IATA airport code");
```

Inside `TripInputSchema`, after the `country:` line:

```ts
  // Listed explicitly because unknown keys are stripped: without these two the
  // create route would accept a gateway, drop it, and stamp its own guess in
  // its place. Optional AND nullable — absent, null and a code are three
  // states (spec §10.3), and the create route fills only the first.
  arrivalAirport: IataSchema.nullable().optional(),
  departureAirport: IataSchema.nullable().optional(),
```

Directly after `CurrencySettingsSchema`:

```ts
/**
 * PUT /api/trips/:id/gateways. Both keys required — null clears, a code sets —
 * so a save can never half-apply and leave one side stale.
 */
export const GatewaysSchema = z.object({
  arrivalAirport: IataSchema.nullable(),
  departureAirport: IataSchema.nullable(),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/server/schemas.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/server/schemas.ts lib/server/schemas.test.ts
git commit -m "feat: teach the trip schemas the two gateway codes" -m "Zod strips what it is not told about (schemas.ts:312-315, :330-332), so TripInputSchema lists both fields, nullable and optional. GatewaysSchema is the sub-route's body: both keys required so a save cannot half-apply." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `suggestRoute` can start where the traveller lands

**Files:**
- Modify: `lib/route.ts:296-323` (`suggestRoute` signature and tour selection)
- Test: `lib/route.test.ts`

**Interfaces:**
- Produces: `export interface RouteOptions { start?: LatLon }`; `suggestRoute(places, airports?, transport?, options?: RouteOptions)`.
- Consumes: `haversineKm`, `LatLon` from `./geo` (already imported).

- [ ] **Step 1: Write the failing tests**

Append to `lib/route.test.ts`:

```ts
describe("suggestRoute anchored at a gateway (spec §10.3, D3)", () => {
  const lima: RoutePlace = { id: "lima", name: "Lima", lat: -12.0464, lon: -77.0428 };
  const cusco: RoutePlace = { id: "cusco", name: "Cusco", lat: -13.5319, lon: -71.9675 };
  const arequipa: RoutePlace = { id: "arequipa", name: "Arequipa", lat: -16.409, lon: -71.5375 };
  /** Jorge Chávez (LIM) and Alejandro Velasco Astete (CUZ). */
  const LIM = { lat: -12.0219, lon: -77.1143 };
  const CUZ = { lat: -13.5357, lon: -71.9388 };

  test("unanchored, the tie between the two shortest tours goes to the lower id", () => {
    // The control: Lima→Cusco→Arequipa and its reverse are both ~910 km, and
    // the search keeps the first it meets in id order. The anchor below has to
    // CHANGE this answer to be worth anything.
    expect(suggestRoute([lima, cusco, arequipa]).order[0].id).toBe("arequipa");
  });

  test("starts at the place nearest the start point", () => {
    expect(suggestRoute([arequipa, cusco, lima], [], TRANSPORT, { start: LIM }).order[0].id).toBe("lima");
    expect(suggestRoute([arequipa, cusco, lima], [], TRANSPORT, { start: CUZ }).order[0].id).toBe("cusco");
  });

  test("the rest of the tour is nearest-neighbour from that start", () => {
    const { order, legs, totalKm } = suggestRoute([arequipa, cusco, lima], [], TRANSPORT, { start: LIM });
    expect(order.map((p) => p.id)).toEqual(["lima", "cusco", "arequipa"]);
    expect(legs).toHaveLength(2);
    expect(totalKm).toBeGreaterThan(850);
    expect(totalKm).toBeLessThan(1000);
  });

  test("an empty options object is the unanchored search, exactly", () => {
    expect(suggestRoute([arequipa, cusco, lima], [], TRANSPORT, {})).toEqual(
      suggestRoute([arequipa, cusco, lima])
    );
  });

  test("off-map places still go last, in id order, under an anchor", () => {
    const { order } = suggestRoute([village, lima, cusco], [], TRANSPORT, { start: CUZ });
    expect(order.map((p) => p.id)).toEqual(["cusco", "lima", "village"]);
  });

  test("an anchor with nothing located leaves the id order alone", () => {
    const other: RoutePlace = { id: "aunt", name: "Aunt's place", lat: null, lon: null };
    const { order, legs } = suggestRoute([village, other], [], TRANSPORT, { start: LIM });
    expect(order.map((p) => p.id)).toEqual(["aunt", "village"]);
    expect(legs.every((l) => l.kind === "unknown")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/route.test.ts`
Expected: FAIL — the fourth argument is ignored, so the anchored tests get `arequipa` first (a type error under tsc as well).

- [ ] **Step 3: Implement the option**

In `lib/route.ts`, above `suggestRoute`:

```ts
export interface RouteOptions {
  /**
   * Anchor the tour here: the first stop is the located place nearest this
   * point and the rest is nearest-neighbour from it. Meant for the arrival
   * gateway (spec §10.3, D3), and set only when the traveller has chosen one —
   * absent, the order-independent search below runs unchanged, which is what
   * keeps every pre-existing route test green without an edit.
   */
  start?: LatLon;
}
```

Change the signature and the tour selection:

```ts
export function suggestRoute(
  places: RoutePlace[],
  airports: readonly Airport[] = [],
  transport: TransportProfile = TRANSPORT,
  options: RouteOptions = {}
): RouteSuggestion {
  if (places.length < 2) {
    return { order: [...places], legs: [], totalKm: 0, notes: [] };
  }

  const sorted = [...places].sort((a, b) => a.id.localeCompare(b.id));
  // Coordinate-less places cannot join a nearest-neighbour tour — there is no
  // distance to be nearest by. They go last, which is the only position that
  // does not distort the legs around them, and keeps the id sort's determinism.
  const located = sorted.filter(isLocated);
  const unlocated = sorted.filter((p) => !isLocated(p));

  let best: LocatedPlace[] | null = null;
  if (options.start && located.length > 0) {
    // Anchored: one tour, from the place nearest the gateway. `located` is
    // id-sorted, so a tie on distance resolves to the lower id, exactly as the
    // unanchored search below resolves its ties.
    let first = located[0];
    let firstDist = haversineKm(options.start, first);
    for (const candidate of located) {
      const d = haversineKm(options.start, candidate);
      if (d < firstDist - 1e-9) {
        first = candidate;
        firstDist = d;
      }
    }
    best = nearestNeighbourFrom(first, located);
  } else {
    let bestDist = Infinity;
    for (const start of located) {
      const tour = nearestNeighbourFrom(start, located);
      const dist = tourDistance(tour);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        best = tour;
      }
    }
  }

  const order: RoutePlace[] = [...(best ?? located), ...unlocated];
```

Everything from `const legs = ...` down is unchanged. Update the docblock above the function: after "so results are deterministic)" add "— or, when `options.start` is given, one tour anchored at the place nearest it."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/route.test.ts lib/route.country.test.ts components/map/MapExplorer.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. The two pinned order-independence tests are untouched and green.

- [ ] **Step 5: Commit**

```bash
git add lib/route.ts lib/route.test.ts
git commit -m "feat: let suggestRoute start at the arrival gateway" -m "A fourth, optional parameter (spec §10.3, D3). With start absent the search is byte-for-byte what shipped, which is why route.test.ts's order-independence pin and route.country.test.ts's default-parameter pin needed no edit. Anchored, the tour begins at the located place nearest the point — the Peru fixture shows the anchor changing an answer the unanchored search decided by id order." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The default gateways

**Files:**
- Create: `lib/gatewayDefaults.ts`
- Test: `lib/gatewayDefaults.test.ts`

**Interfaces:**
- Consumes: `mainAirportFor(airports, at)` from `./mainAirport` (returns `{ iata, km } | null`, already filters to `ARRIVABLE_AIRPORT_SIZES` and `DEFAULT_AIRPORT_RADIUS_KM`); `Airport` from `./airports`; `TripInput` from `./itinerary`.
- Produces: `interface GatewayDefaults { arrivalAirport: string | null; departureAirport: string | null }`; `defaultGateways(stops: readonly { lat: number | null; lon: number | null }[], airports: readonly Airport[]): GatewayDefaults`; `applyDefaultGateways(input: TripInput, defaults: GatewayDefaults): TripInput`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/gatewayDefaults.test.ts
import { describe, expect, test } from "vitest";
import type { Airport } from "./airports";
import type { TripInput } from "./itinerary";
import { applyDefaultGateways, defaultGateways } from "./gatewayDefaults";

/** Hand-written at the artifact's coordinates, so a nightly refresh cannot move them. */
const airport = (over: Partial<Airport> & Pick<Airport, "iata" | "lat" | "lon">): Airport => ({
  icao: null,
  name: `${over.iata} airport`,
  municipality: null,
  country: "PE",
  size: "large",
  ...over,
});
const LIM = airport({ iata: "LIM", lat: -12.0219, lon: -77.1143 });
const CUZ = airport({ iata: "CUZ", lat: -13.5357, lon: -71.9388 });
/** An aeroclub nearer Lima's centre than LIM — must never be a gateway. */
const CLUB = airport({ iata: "ZZC", lat: -12.05, lon: -77.03, size: "small" });
const AIRPORTS = [CLUB, CUZ, LIM];

const lima = { lat: -12.04318, lon: -77.02824 };
const cusco = { lat: -13.53188, lon: -71.96701 };
const offMap = { lat: null, lon: null };

describe("defaultGateways", () => {
  test("names the main airport of the first stop and of the last", () => {
    expect(defaultGateways([lima, cusco], AIRPORTS)).toEqual({ arrivalAirport: "LIM", departureAirport: "CUZ" });
  });

  test("never names a small airport, however close", () => {
    // mainAirportFor's rule, inherited rather than restated: the club is 1 km
    // from Lima's centre and LIM is 9 km, and the club is still not an answer.
    expect(defaultGateways([lima], AIRPORTS).arrivalAirport).toBe("LIM");
  });

  test("a single stop is both the arrival and the departure", () => {
    expect(defaultGateways([cusco], AIRPORTS)).toEqual({ arrivalAirport: "CUZ", departureAirport: "CUZ" });
  });

  test("skips off-map stops, which have nothing to measure from", () => {
    expect(defaultGateways([offMap, lima, cusco, offMap], AIRPORTS)).toEqual({
      arrivalAirport: "LIM",
      departureAirport: "CUZ",
    });
  });

  test("a trip with no located stop, or no airport in range, gets none", () => {
    expect(defaultGateways([offMap], AIRPORTS)).toEqual({ arrivalAirport: null, departureAirport: null });
    expect(defaultGateways([lima, cusco], [])).toEqual({ arrivalAirport: null, departureAirport: null });
    // Ushuaia is ~3,000 km from every fixture airport, past DEFAULT_AIRPORT_RADIUS_KM.
    expect(defaultGateways([{ lat: -54.8, lon: -68.3 }], AIRPORTS).arrivalAirport).toBeNull();
  });
});

describe("applyDefaultGateways", () => {
  const input: TripInput = {
    destinationIds: ["G3936456", "G3941584"],
    days: 5,
    season: "winter",
    adults: 2,
    kids: 0,
    interests: [],
    country: "PE",
  };
  const defaults = { arrivalAirport: "LIM", departureAirport: "CUZ" };

  test("fills what is absent, and always writes both keys", () => {
    const stamped = applyDefaultGateways(input, defaults);
    expect(stamped.arrivalAirport).toBe("LIM");
    expect(stamped.departureAirport).toBe("CUZ");
    expect("arrivalAirport" in stamped && "departureAirport" in stamped).toBe(true);
  });

  test("leaves the traveller's null alone — none is an answer", () => {
    const stamped = applyDefaultGateways({ ...input, arrivalAirport: null }, defaults);
    expect(stamped.arrivalAirport).toBeNull();
    expect(stamped.departureAirport).toBe("CUZ");
  });

  test("leaves the traveller's code alone", () => {
    expect(applyDefaultGateways({ ...input, departureAirport: "AQP" }, defaults).departureAirport).toBe("AQP");
  });

  test("writes a null default as null, so a stamped trip can never read as legacy", () => {
    const stamped = applyDefaultGateways(input, { arrivalAirport: null, departureAirport: null });
    expect(stamped.arrivalAirport).toBeNull();
    expect("arrivalAirport" in stamped).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/gatewayDefaults.test.ts`
Expected: FAIL — `Cannot find module './gatewayDefaults'`.

- [ ] **Step 3: Write the module**

```ts
// lib/gatewayDefaults.ts
import type { Airport } from "./airports";
import type { TripInput } from "./itinerary";
import { mainAirportFor } from "./mainAirport";

export interface GatewayDefaults {
  arrivalAirport: string | null;
  departureAirport: string | null;
}

/** A stop as the plan knows it: a located place, or an off-map one with no coordinates. */
interface Stop {
  lat: number | null;
  lon: number | null;
}

function isLocated(stop: Stop): stop is { lat: number; lon: number } {
  return stop.lat !== null && stop.lon !== null;
}

/**
 * The gateways a trip gets when the traveller named none: the main airport of
 * the first stop and of the last (spec §10.3).
 *
 * By `mainAirportFor`'s rule rather than a second one, so the code stamped
 * here is the code the place card names — never a closer aeroclub, never one
 * beyond `DEFAULT_AIRPORT_RADIUS_KM`. Takes the airport array as a parameter
 * for the same reason lib/mainAirport.ts does: it is browser-safe, and the
 * server hands it `allAirports()` so a border city gets its real gateway
 * rather than the one inside its own country.
 *
 * Off-map stops have no coordinates and are skipped; a trip with no located
 * stop, or none within range of an airport, gets null on both sides — "none",
 * which is honest, rather than a guess.
 */
export function defaultGateways(stops: readonly Stop[], airports: readonly Airport[]): GatewayDefaults {
  const located = stops.filter(isLocated);
  if (located.length === 0) return { arrivalAirport: null, departureAirport: null };
  const first = located[0];
  const last = located[located.length - 1];
  return {
    arrivalAirport: mainAirportFor(airports, first)?.iata ?? null,
    departureAirport: mainAirportFor(airports, last)?.iata ?? null,
  };
}

/**
 * Fill only what is ABSENT. Null is the traveller saying "none" and a code is
 * the traveller's choice; both survive. This is the write end of the three
 * states `tripGateways` documents, and it always writes both keys — so a trip
 * that has been through here can never again be mistaken for a legacy one
 * (the `755c8dd` rule: absent must mean exactly one thing).
 */
export function applyDefaultGateways(input: TripInput, defaults: GatewayDefaults): TripInput {
  return {
    ...input,
    arrivalAirport: input.arrivalAirport === undefined ? defaults.arrivalAirport : input.arrivalAirport,
    departureAirport:
      input.departureAirport === undefined ? defaults.departureAirport : input.departureAirport,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/gatewayDefaults.test.ts lib/mainAirport.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/gatewayDefaults.ts lib/gatewayDefaults.test.ts
git commit -m "feat: derive a trip's default gateways from its first and last stop" -m "mainAirportFor's rule, inherited: the stamped code is the one the place card names. Fills absent only, and always writes both keys, so a stamped trip cannot read as a legacy one." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The server stamps at create, and a rebuild carries forward

**Files:**
- Modify: `app/api/trips/route.ts:1-14` (imports) and `:42-56` (the build)
- Modify: `app/api/trips/[id]/route.ts:66-75` (the PATCH build)
- Test: `lib/server/createTripRoute.test.ts`

**Interfaces:**
- Consumes: `defaultGateways`, `applyDefaultGateways` (Task 4); `carryGateways` (Task 1); `allAirports()` from `@/lib/server/airports`; `resolveDestinations(ids)` from `@/lib/server/catalog` (returns `Destination[]` in the order asked, dropping unknown ids).

- [ ] **Step 1: Write the failing test**

Mirror `lib/server/cityEnrichRoute.test.ts`'s shape: mock the seams with `vi.mock`, then `await import` the handler.

```ts
// lib/server/createTripRoute.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Airport } from "@/lib/airports";
import { DESTINATIONS } from "@/lib/data";

/**
 * Drives the real POST handler with every network and storage seam mocked:
 * the session, the store, the catalog and the airports artifact. What is
 * NOT mocked is buildTripData, so the stamp is computed from a real plan.
 */
vi.mock("@/lib/server/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  createTrip: vi.fn(async () => ({ id: "trip-1", joinCode: "ABCDEF" })),
  setCurrencySettings: vi.fn(async () => true),
  linkMemberAccount: vi.fn(async () => "linked"),
}));
vi.mock("@/lib/server/catalog", () => ({
  ensureCatalogLoaded: vi.fn(async () => undefined),
  resolveDestinations: (ids: string[]) =>
    ids.map((id) => DESTINATIONS.find((d) => d.id === id)).filter((d) => d !== undefined),
}));
vi.mock("@/lib/server/airports", () => ({ allAirports: () => AIRPORTS }));

const airport = (over: Partial<Airport> & Pick<Airport, "iata" | "lat" | "lon">): Airport => ({
  icao: null,
  name: `${over.iata} airport`,
  municipality: null,
  country: "CN",
  size: "large",
  ...over,
});
/** At the artifact's coordinates: PEK is Beijing's main airport (25 km), SHA is Shanghai's (14 km). */
const AIRPORTS = [
  airport({ iata: "PEK", lat: 40.077349, lon: 116.596702 }),
  airport({ iata: "PKX", lat: 39.501289, lon: 116.413967 }),
  airport({ iata: "SHA", lat: 31.198104, lon: 121.33426 }),
  airport({ iata: "PVG", lat: 31.1434, lon: 121.805 }),
];

const { POST } = await import("@/app/api/trips/route");
const { getSessionUser } = await import("@/lib/server/session");
const { createTrip } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const input = {
  destinationIds: ["beijing", "shanghai"],
  days: 4,
  season: "autumn",
  adults: 2,
  kids: 0,
  interests: ["history"],
  country: "CN",
};

function storedInput() {
  const [data] = vi.mocked(createTrip).mock.calls[0];
  return data.input;
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "u1", name: "Ada", email: "ada@example.test" });
  vi.mocked(createTrip).mockClear();
});

describe("POST /api/trips stamps the gateways (spec §10.3)", () => {
  test("a trip that names no gateways gets the main airports of its first and last stop", async () => {
    const res = await POST(request({ tripName: "Autumn", input }));
    expect(res.status).toBe(201);
    expect(storedInput().arrivalAirport).toBe("PEK");
    expect(storedInput().departureAirport).toBe("SHA");
  });

  test("the traveller's own choice survives the stamp", async () => {
    await POST(request({ tripName: "Autumn", input: { ...input, arrivalAirport: "PKX" } }));
    expect(storedInput().arrivalAirport).toBe("PKX");
    expect(storedInput().departureAirport).toBe("SHA");
  });

  test("an explicit none survives the stamp too", async () => {
    await POST(request({ tripName: "Autumn", input: { ...input, departureAirport: null } }));
    expect(storedInput().arrivalAirport).toBe("PEK");
    expect(storedInput().departureAirport).toBeNull();
  });

  test("the departure is the plan's last stop, not the selection's", async () => {
    // Two days, two cities: buildItinerary keeps one city per day at most, so
    // with days: 1 only Beijing is planned and both gateways are Beijing's.
    await POST(request({ tripName: "Day trip", input: { ...input, days: 1 } }));
    expect(storedInput().arrivalAirport).toBe("PEK");
    expect(storedInput().departureAirport).toBe("PEK");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/server/createTripRoute.test.ts`
Expected: FAIL — `arrivalAirport` is `undefined` on the stored input (the first test) and the `days: 1` case too.

- [ ] **Step 3: Stamp in the create route**

In `app/api/trips/route.ts`, add the imports:

```ts
import { applyDefaultGateways, defaultGateways } from "@/lib/gatewayDefaults";
import { allAirports } from "@/lib/server/airports";
import { ensureCatalogLoaded, resolveDestinations } from "@/lib/server/catalog";
```

Replace the block from `const data = buildTripData({` through the `days.length === 0` early return with:

```ts
  const built = buildTripData({
    tripName,
    startDate: startDate ?? null,
    input: { ...input, season },
  });
  if (built.plan.days.length === 0) {
    return NextResponse.json(
      { error: "No plannable destinations in the selection" },
      { status: 400 }
    );
  }
  // Spec §10.3: stamp the gateways the traveller did not name, from the
  // PLAN's first and last stops — the plan's, not the selection's, because
  // buildItinerary drops destinations beyond the day count. Stamped after the
  // build and never read by it: the plan is a draft the members own, and a
  // gateway edited later (through /gateways) must not leave a stale code baked
  // into day one's copy. allAirports(), not the country's rows, so a border
  // city gets its real gateway.
  const days = built.plan.days;
  const stops = [days[0], days[days.length - 1]].map(
    (day) => resolveDestinations([day.destinationId])[0] ?? { lat: null, lon: null }
  );
  const data = {
    ...built,
    input: applyDefaultGateways(built.input, defaultGateways(stops, allAirports())),
  };
```

Every later reference to `data` (`createTrip(data, creatorName)`) is unchanged.

- [ ] **Step 4: Carry forward on PATCH**

In `app/api/trips/[id]/route.ts`, add `import { carryGateways } from "@/lib/tripGateways";` and change the `input:` line of the PATCH build to:

```ts
    // A rebuild sends a whole TripInput; one written before the gateway fields
    // existed omits them, and absent means "unchanged", never "cleared".
    input: parsed.data.input
      ? carryGateways(parsed.data.input, existing.data.input)
      : existing.data.input,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/server/createTripRoute.test.ts lib/tripGateways.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/trips/route.ts "app/api/trips/[id]/route.ts" lib/server/createTripRoute.test.ts
git commit -m "feat: stamp a new trip's gateways from its plan, and keep them through a rebuild" -m "The plan's first and last stop, not the selection's — buildItinerary drops destinations beyond the day count. Stamped after the build and never read by it, so an edited gateway can never leave a stale code in day one's copy. PATCH carries omitted gateways forward: absent is unchanged, null is a clear." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `PUT /api/trips/:id/gateways`

**Files:**
- Create: `app/api/trips/[id]/gateways/route.ts`
- Test: `lib/server/gatewaysRoute.test.ts`

**Interfaces:**
- Consumes: `GatewaysSchema` (Task 2); `withGateways` (Task 1); `requireMember` from `@/lib/server/authz`; `findAirport(iata)` from `@/lib/server/airports`; `getTrip`, `updateTripDataIf`, `storeMode`, `DB_UNAVAILABLE` from `@/lib/server/store`; `fullPayload()` from `@/lib/tripFixtures` (a `TripPayload` with `version: 7`).
- Produces: the route. Body `{ arrivalAirport: string | null; departureAirport: string | null }`; 200 with the full member payload; 400 `Invalid gateways` / `Unknown airport code XXX`; 404; 409 after three lost races.

- [ ] **Step 1: Write the failing test**

```ts
// lib/server/gatewaysRoute.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fullPayload } from "@/lib/tripFixtures";

vi.mock("@/lib/server/authz", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/server/airports", () => ({
  findAirport: (iata: string) => (["LIM", "CUZ", "AQP"].includes(iata) ? { iata } : null),
}));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  getTrip: vi.fn(),
  updateTripDataIf: vi.fn(),
  // Present so the assertion that they are never called is about real
  // exports, not about a typo.
  updateTripData: vi.fn(),
  clearScheduleChecks: vi.fn(),
}));

const { PUT } = await import("@/app/api/trips/[id]/gateways/route");
const { requireMember } = await import("@/lib/server/authz");
const { getTrip, updateTripDataIf, updateTripData, clearScheduleChecks } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown) {
  return new NextRequest("http://localhost/api/trips/trip-1/gateways", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "trip-1" }) };

beforeEach(() => {
  vi.mocked(requireMember).mockReset();
  vi.mocked(requireMember).mockResolvedValue({ memberName: "Ada" });
  vi.mocked(getTrip).mockReset();
  vi.mocked(getTrip).mockResolvedValue(fullPayload());
  vi.mocked(updateTripDataIf).mockReset();
  vi.mocked(updateTripDataIf).mockResolvedValue(true);
  vi.mocked(updateTripData).mockClear();
  vi.mocked(clearScheduleChecks).mockClear();
});

describe("PUT /api/trips/:id/gateways", () => {
  test("writes both gateways into input under the version guard, and nothing else", async () => {
    const res = await PUT(request({ arrivalAirport: "lim", departureAirport: null }), params);
    expect(res.status).toBe(200);
    const [id, data, version] = vi.mocked(updateTripDataIf).mock.calls[0];
    expect(id).toBe("trip-1");
    expect(version).toBe(7);
    expect(data.input.arrivalAirport).toBe("LIM");
    expect(data.input.departureAirport).toBeNull();
    // The whole point of a sub-route (spec §10.3): the plan is untouched and
    // no tick is cleared. PATCH /api/trips/[id] does both.
    expect(data.plan).toEqual(fullPayload().data.plan);
    expect(updateTripData).not.toHaveBeenCalled();
    expect(clearScheduleChecks).not.toHaveBeenCalled();
  });

  test("returns the member payload, like the other sub-routes", async () => {
    const res = await PUT(request({ arrivalAirport: "LIM", departureAirport: "CUZ" }), params);
    expect(await res.json()).toMatchObject({ id: "trip-1", myMemberName: "Ada" });
  });

  test("rejects a body missing a key or carrying a malformed code", async () => {
    expect((await PUT(request({ arrivalAirport: "LIM" }), params)).status).toBe(400);
    expect((await PUT(request({ arrivalAirport: "LIMA", departureAirport: null }), params)).status).toBe(400);
    expect(updateTripDataIf).not.toHaveBeenCalled();
  });

  test("rejects a code the airports artifact does not carry", async () => {
    const res = await PUT(request({ arrivalAirport: "ZZZ", departureAirport: null }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown airport code ZZZ" });
    expect(updateTripDataIf).not.toHaveBeenCalled();
  });

  test("404s an unknown trip", async () => {
    vi.mocked(getTrip).mockResolvedValue(null);
    expect((await PUT(request({ arrivalAirport: null, departureAirport: null }), params)).status).toBe(404);
  });

  test("re-reads and retries when another member's write lands first", async () => {
    vi.mocked(updateTripDataIf).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await PUT(request({ arrivalAirport: "AQP", departureAirport: "AQP" }), params);
    expect(res.status).toBe(200);
    expect(updateTripDataIf).toHaveBeenCalledTimes(2);
  });

  test("gives up with a 409 after three lost races", async () => {
    vi.mocked(updateTripDataIf).mockResolvedValue(false);
    const res = await PUT(request({ arrivalAirport: "AQP", departureAirport: "AQP" }), params);
    expect(res.status).toBe(409);
    expect(updateTripDataIf).toHaveBeenCalledTimes(3);
  });

  test("is closed to non-members", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireMember).mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    expect((await PUT(request({ arrivalAirport: null, departureAirport: null }), params)).status).toBe(403);
    expect(updateTripDataIf).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/server/gatewaysRoute.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/trips/[id]/gateways/route'`.

- [ ] **Step 3: Write the route**

```ts
// app/api/trips/[id]/gateways/route.ts
import { NextRequest, NextResponse } from "next/server";
import { findAirport } from "@/lib/server/airports";
import { requireMember } from "@/lib/server/authz";
import { GatewaysSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, getTrip, storeMode, updateTripDataIf } from "@/lib/server/store";
import { withGateways } from "@/lib/tripGateways";

/** Re-read/re-apply attempts when another member writes concurrently. */
const MAX_WRITE_ATTEMPTS = 3;

type Params = { params: Promise<{ id: string }> };

/**
 * Set the airports a trip flies into and out of (spec §10.3).
 *
 * Its own route, never PATCH /api/trips/[id]: PATCH rebuilds the plan and
 * clears every schedule tick, and a gateway is a fact about the trip, not a
 * reason to throw the members' draft away. This writes `input` alone, under
 * the same version guard the plan route uses, and touches nothing else.
 *
 * A code has to exist in the airports artifact. The editor suggests real
 * airports but stays a text field, so a typo arrives here as a well-formed
 * unknown code — and a gateway nothing can draw or name is not worth storing.
 */
export async function PUT(req: NextRequest, { params }: Params) {
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

  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;

  const parsed = GatewaysSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid gateways", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  for (const code of [parsed.data.arrivalAirport, parsed.data.departureAirport]) {
    if (code !== null && findAirport(code) === null) {
      return NextResponse.json({ error: `Unknown airport code ${code}` }, { status: 400 });
    }
  }

  // Optimistic concurrency, exactly as the plan route does it: re-read and
  // re-apply if another member's write lands between our read and our
  // version-guarded write, so nobody's edit is silently overwritten.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const trip = await getTrip(id);
    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    const next = withGateways(trip.data, {
      arrival: parsed.data.arrivalAirport,
      departure: parsed.data.departureAirport,
    });
    const written = await updateTripDataIf(id, next, trip.version);
    if (!written) continue;
    const payload = await getTrip(id, gate.memberName);
    return NextResponse.json({ ...payload, myMemberName: gate.memberName });
  }

  return NextResponse.json(
    { error: "The trip is being edited by someone else right now — try again." },
    { status: 409 }
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/server/gatewaysRoute.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (8 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "app/api/trips/[id]/gateways/route.ts" lib/server/gatewaysRoute.test.ts
git commit -m "feat: a sub-route that sets a trip's gateways without rebuilding its plan" -m "PATCH /api/trips/[id] regenerates the plan and calls clearScheduleChecks (spec §10.3), so gateways get their own PUT: input alone, under the plan route's version guard, with its retry loop and 409 copied verbatim. Unknown codes are refused — a gateway nothing can name is not worth storing. The test pins that updateTripData and clearScheduleChecks are never called." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: A picker that yields a code

**Files:**
- Modify: `components/trip/AirportInput.tsx:25-32` (`Props`) and `:139-146` (`pick`)
- Modify: `components/trip/AirportInput.test.tsx`
- Create: `components/trip/AirportPicker.tsx`
- Test: `components/trip/AirportPicker.test.tsx`

**Interfaces:**
- Consumes: `AirportInput` (existing), `IATA_CODE` (Task 1), `Airport` type.
- Produces: `AirportInput` gains `onPick?: (airport: Airport) => void`, called after `onChange` when a suggestion is chosen. `export interface AirportPick { iata: string; airport: Airport | null }`; `<AirportPicker label value onChange allowBareCode? placeholder? />` where `value: string | null` is the current code and `onChange(pick: AirportPick | null)` fires on every change — `null` while the text names no airport, `{ iata, airport }` after a list pick, and `{ iata, airport: null }` for a bare typed code when `allowBareCode` is set.

- [ ] **Step 1: Write the failing tests**

Append to `components/trip/AirportInput.test.tsx`, inside the existing `describe` that owns the "picking an option writes name and code into the field" test (reuse its fetch stub and its `type`/flush helpers exactly as that test does):

```ts
  test("reports the picked airport itself, for callers that want the code", async () => {
    const onPick = vi.fn();
    render(<AirportInput label="From" value="" onChange={() => {}} onPick={onPick} />);
    // Same typing-and-flush sequence as "picking an option writes name and
    // code into the field" — copy its lines here verbatim.
    // ...type "jin", flush past the debounce and the fetch...
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jinan Yaoqiang/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ iata: "TNA" });
  });
```

(The fixture airport in that file is Jinan Yaoqiang, `TNA`. Read the existing pick test first and reproduce its setup line for line; the only new lines are the `onPick` prop and the two assertions.)

Create `components/trip/AirportPicker.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AirportPicker } from "./AirportPicker";

/**
 * AirportInput's suggestions come from /api/airports/search; here the fetch
 * is a stub, and the pick is driven the way AirportInput.test.tsx drives it.
 */
const LIM = {
  iata: "LIM",
  icao: "SPJC",
  name: "Jorge Chávez International Airport",
  municipality: "Lima",
  country: "PE",
  lat: -12.0219,
  lon: -77.1143,
  size: "large",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AirportPicker", () => {
  test("shows the current code as its text", () => {
    render(<AirportPicker label="Arrive at" value="CUZ" onChange={() => {}} />);
    expect(screen.getByLabelText("Arrive at")).toHaveValue("CUZ");
  });

  test("a bare three-letter code is a pick only when allowed", () => {
    const strict = vi.fn();
    const { unmount } = render(<AirportPicker label="Arrive at" value={null} onChange={strict} />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "aqp" } });
    expect(strict).toHaveBeenLastCalledWith(null);
    unmount();

    const lenient = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={lenient} allowBareCode />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "aqp" } });
    expect(lenient).toHaveBeenLastCalledWith({ iata: "AQP", airport: null });
  });

  test("clearing the text is none", () => {
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value="LIM" onChange={onChange} allowBareCode />);
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  test("a list pick carries the whole airport, and editing the text afterwards drops it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ results: [LIM] }) }))
    );
    const onChange = vi.fn();
    render(<AirportPicker label="Arrive at" value={null} onChange={onChange} />);
    const field = screen.getByLabelText("Arrive at");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "lima" } });
    // Past the 300 ms debounce and the stubbed fetch, as AirportInput.test.tsx
    // does — use its exact flush helper if it exports one; otherwise:
    await vi.advanceTimersByTimeAsync(350);
    fireEvent.mouseDown(screen.getByRole("option", { name: /Jorge Chávez/ }));
    expect(onChange).toHaveBeenLastCalledWith({ iata: "LIM", airport: LIM });
    expect(field).toHaveValue("Jorge Chávez International Airport (LIM)");

    fireEvent.change(field, { target: { value: "Jorge" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/trip/AirportInput.test.tsx components/trip/AirportPicker.test.tsx`
Expected: FAIL — `onPick` never called; `AirportPicker` module missing.

- [ ] **Step 3: Add `onPick` to `AirportInput`**

In `components/trip/AirportInput.tsx`, add to `Props`:

```ts
  /**
   * The airport behind a pick, for callers that want a CODE rather than the
   * display string `onChange` receives. Fired after `onChange`, only on a
   * list pick — free typing never reaches it.
   */
  onPick?: (airport: Airport) => void;
```

Destructure `onPick` in the component signature, and in `pick(hit)` add `onPick?.(hit);` as the last line, after `onChange(next);`.

- [ ] **Step 4: Write `AirportPicker`**

```tsx
// components/trip/AirportPicker.tsx
"use client";

import { useState } from "react";
import type { Airport } from "@/lib/airports";
import { IATA_CODE } from "@/lib/tripGateways";
import { AirportInput } from "./AirportInput";

/** What the picker reports: a code, and the airport behind it when one was chosen from the list. */
export interface AirportPick {
  iata: string;
  /** Null for a bare typed code — known by code only, with no coordinates to anchor on. */
  airport: Airport | null;
}

interface Props {
  label: string;
  /** The current code, or null for none. Shown as the field's text until the user types. */
  value: string | null;
  /** Fires on every change: null while the text names no airport. */
  onChange: (pick: AirportPick | null) => void;
  /**
   * Accept a bare three-letter code typed without a list pick. The trip page
   * allows it (the server refuses a code the artifact lacks); the wizard does
   * not, because a bare code has no coordinates to anchor the route on (D3).
   */
  allowBareCode?: boolean;
  placeholder?: string;
}

/**
 * `AirportInput` yields display text — "Name (LIM)" — because tickets store
 * free text. A gateway is a CODE, so this wrapper owns the text and reports
 * the code behind it: the picked airport's, or, when allowed, a bare typed
 * one. Editing the text after a pick drops the pick, because the text no
 * longer says what was picked.
 */
export function AirportPicker({ label, value, onChange, allowBareCode = false, placeholder }: Props) {
  const [text, setText] = useState(value ?? "");
  const [pickedText, setPickedText] = useState<string | null>(null);

  const onText = (next: string) => {
    setText(next);
    if (pickedText !== null && next !== pickedText) setPickedText(null);
    const code = next.trim().toUpperCase();
    if (code === "") {
      onChange(null);
      return;
    }
    if (allowBareCode && IATA_CODE.test(code)) {
      onChange({ iata: code, airport: null });
      return;
    }
    onChange(null);
  };

  const onPick = (airport: Airport) => {
    setPickedText(`${airport.name} (${airport.iata})`);
    onChange({ iata: airport.iata, airport });
  };

  return (
    <AirportInput label={label} value={text} onChange={onText} onPick={onPick} placeholder={placeholder} />
  );
}
```

Note `AirportInput.pick` calls `onChange(displayValue)` **before** `onPick`, so `onText` runs first and reports `null`, then `onPick` reports the pick; `pickedText` is set from the airport rather than read back from `text`, which is what keeps the "editing afterwards drops it" rule exact. `displayValue` may shorten a long name to its municipality; if the fourth test's `toHaveValue` fails on that, assert `toHaveValue(expect.stringContaining("(LIM)"))` instead and set `pickedText` from the value `onChange` last delivered — hold it in a ref updated inside `onText`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run components/trip/AirportInput.test.tsx components/trip/AirportPicker.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add components/trip/AirportInput.tsx components/trip/AirportInput.test.tsx components/trip/AirportPicker.tsx components/trip/AirportPicker.test.tsx
git commit -m "feat: an airport picker that reports a code, on top of the text field tickets use" -m "AirportInput stays a text field (tickets store free text) and gains onPick. AirportPicker wraps it and reports { iata, airport }: the picked airport, or a bare typed code where allowed. Editing after a pick drops the pick, because the text no longer says what was picked." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The strip on the trip page

**Files:**
- Create: `components/trip/GatewaysStrip.tsx`
- Test: `components/trip/GatewaysStrip.test.tsx`
- Modify: `components/trip/PlanTab.tsx:27-48` (`Props`) and the JSX above the view switch (`:151`)
- Modify: `components/trip/PlanTab.test.tsx`
- Modify: `components/TripView.tsx:108` (beside `saveCurrency`) and `:276-292` (the `<PlanTab>` render)

**Interfaces:**
- Consumes: `TripGateways`, `tripGateways` (Task 1); `AirportPicker`, `AirportPick` (Task 7); `mutate(url, init): Promise<string | null>` (TripView's existing accessor — an error string for forms, null on success).
- Produces: `<GatewaysStrip gateways onSave? />` with `onSave?: (gateways: TripGateways) => Promise<string | null>`; `PlanTab` gains `gateways?: TripGateways` and `onSaveGateways?: (gateways: TripGateways) => Promise<string | null>`; `TripView` defines `saveGateways`.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/trip/GatewaysStrip.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GatewaysStrip } from "./GatewaysStrip";

afterEach(() => cleanup());

describe("GatewaysStrip", () => {
  test("names both gateways", () => {
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} />);
    const strip = screen.getByTestId("gateways");
    expect(strip).toHaveTextContent("Fly in via LIM");
    expect(strip).toHaveTextContent("out via CUZ");
  });

  test("says when a side has none, rather than leaving a blank", () => {
    render(<GatewaysStrip gateways={{ arrival: null, departure: null }} />);
    expect(screen.getByTestId("gateways")).toHaveTextContent(/no arrival airport/i);
    expect(screen.getByTestId("gateways")).toHaveTextContent(/no departure airport/i);
  });

  test("offers no editing without a save handler — guests read, members write", () => {
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} />);
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  test("edit, change one side, save: the handler gets both codes", async () => {
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Depart from"), { target: { value: "aqp" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ arrival: "LIM", departure: "AQP" }));
    // Back to the summary once the save resolves.
    expect(screen.queryByLabelText("Depart from")).not.toBeInTheDocument();
  });

  test("clearing a field saves null", async () => {
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ arrival: null, departure: "CUZ" }));
  });

  test("shows the server's refusal and stays open", async () => {
    const onSave = vi.fn(async () => "Unknown airport code ZZZ");
    render(<GatewaysStrip gateways={{ arrival: null, departure: null }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "ZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText("Unknown airport code ZZZ")).toBeInTheDocument();
    expect(screen.getByLabelText("Arrive at")).toBeInTheDocument();
  });

  test("cancel discards the draft", () => {
    const onSave = vi.fn(async () => null);
    render(<GatewaysStrip gateways={{ arrival: "LIM", departure: "CUZ" }} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Arrive at"), { target: { value: "AQP" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId("gateways")).toHaveTextContent("Fly in via LIM");
  });
});
```

And in `components/trip/PlanTab.test.tsx`, one test inside the existing top-level `describe`, using its `renderTab` helper (pass the two new props through it — add them to the helper's `over` parameter the way its other optional props are passed):

```tsx
  test("shows the gateways strip above the view switch when the trip has them", () => {
    renderTab({ gateways: { arrival: "LIM", departure: "CUZ" } });
    expect(screen.getByTestId("gateways")).toHaveTextContent("Fly in via LIM");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/trip/GatewaysStrip.test.tsx components/trip/PlanTab.test.tsx`
Expected: FAIL — module missing; `gateways` is not a `PlanTab` prop.

- [ ] **Step 3: Write the strip**

```tsx
// components/trip/GatewaysStrip.tsx
"use client";

import { useState } from "react";
import type { TripGateways } from "@/lib/tripGateways";
import { AirportPicker } from "./AirportPicker";

interface Props {
  gateways: TripGateways;
  /** Members only. Absent for guests, who read the strip and cannot edit it. */
  onSave?: (gateways: TripGateways) => Promise<string | null>;
}

const BUTTON =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--line-1)] px-3 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]";
const PRIMARY =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--accent-ink)] px-3 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] disabled:opacity-40";

/**
 * The airports the trip flies into and out of (spec §10.3), above the plan.
 *
 * A strip rather than a card: it is one line of fact, and it sits above the
 * day list because the day list is what it frames. Editing never touches the
 * plan — the save goes to /gateways, which writes `input` alone — so the
 * strip can be corrected mid-trip without a tick being lost.
 *
 * Codes, not names, on purpose: the strip is browser-side and has no airport
 * array to resolve a name from, and a code is what a boarding pass says.
 */
export function GatewaysStrip({ gateways, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TripGateways>(gateways);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft(gateways);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!onSave || saving) return;
    setSaving(true);
    setError(null);
    const err = await onSave(draft);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
  };

  return (
    <section
      data-testid="gateways"
      aria-label="Gateway airports"
      className="rounded-lg border border-dashed border-[var(--line-1)] bg-[var(--paper)] px-4 py-2 text-sm text-[var(--ink-2)] print:hidden"
    >
      {editing && onSave ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-40 flex-1">
            <AirportPicker
              label="Arrive at"
              value={draft.arrival}
              onChange={(pick) => setDraft((d) => ({ ...d, arrival: pick?.iata ?? null }))}
              allowBareCode
              placeholder="Lima or LIM"
            />
          </div>
          <div className="min-w-40 flex-1">
            <AirportPicker
              label="Depart from"
              value={draft.departure}
              onChange={(pick) => setDraft((d) => ({ ...d, departure: pick?.iata ?? null }))}
              allowBareCode
              placeholder="Cusco or CUZ"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className={PRIMARY}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
              Cancel
            </button>
          </div>
          {error && (
            <p role="status" className="w-full text-xs text-[var(--seal)]">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            <span aria-hidden>✈️ </span>
            {gateways.arrival ? (
              <>
                Fly in via <span className="font-mono font-semibold text-[var(--ink-0)]">{gateways.arrival}</span>
              </>
            ) : (
              "No arrival airport"
            )}
            {" · "}
            {gateways.departure ? (
              <>
                out via <span className="font-mono font-semibold text-[var(--ink-0)]">{gateways.departure}</span>
              </>
            ) : (
              "no departure airport"
            )}
          </p>
          {onSave && (
            <button type="button" onClick={open} className={BUTTON}>
              Edit gateways
            </button>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Render it from `PlanTab` and wire `TripView`**

In `components/trip/PlanTab.tsx`, add to `Props`:

```ts
  /** The trip's gateway airports (spec §10.3). Absent only in tests that predate them. */
  gateways?: TripGateways;
  /** Members only; guests get the strip read-only. */
  onSaveGateways?: (gateways: TripGateways) => Promise<string | null>;
```

with `import type { TripGateways } from "@/lib/tripGateways";` and `import { GatewaysStrip } from "./GatewaysStrip";`. Destructure both, and render as the first child of the root `<div className="mt-5 space-y-5">`:

```tsx
      {gateways && <GatewaysStrip gateways={gateways} onSave={onSaveGateways} />}
```

In `components/TripView.tsx`, add `import { tripGateways, type TripGateways } from "@/lib/tripGateways";`, define beside `saveCurrency`:

```ts
  const saveGateways = (gateways: TripGateways) =>
    mutate(
      `/api/trips/${tripId}/gateways`,
      jsonInit("PUT", { arrivalAirport: gateways.arrival, departureAirport: gateways.departure })
    );
```

and pass to `<PlanTab>`: `gateways={tripGateways(data)}` and `onSaveGateways={isMember ? saveGateways : undefined}`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run components/trip/GatewaysStrip.test.tsx components/trip/PlanTab.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean. If a `TripView` test exists under `components/` and renders the plan tab, run it too.

- [ ] **Step 6: Commit**

```bash
git add components/trip/GatewaysStrip.tsx components/trip/GatewaysStrip.test.tsx components/trip/PlanTab.tsx components/trip/PlanTab.test.tsx components/TripView.tsx
git commit -m "feat: show a trip's gateways above its plan, editable without a rebuild" -m "One line of fact above the day list, with an editor that saves through /gateways so a correction mid-trip loses no tick. Guests read it; members edit it. Codes rather than names: the strip has no airport array, and a code is what a boarding pass says." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The wizard asks where you land, and the route starts there

**Files:**
- Modify: `components/map/MapExplorer.tsx:129-142` (`Props`), `:601-615` (the `suggestRoute` call), `:904-916` (the route panel header)
- Modify: `components/map/MapExplorer.test.tsx`
- Modify: `components/DestinationStep.tsx:20-50` (`Props` and destructuring), `:348-360` (the `<MapExplorer>` render)
- Modify: `app/plan/page.tsx` — state beside `selected`, the `tripInput` memo (`:297-308`), the reset function (`:315-324`), the `<DestinationStep>` render (`:395-405`)

**Interfaces:**
- Consumes: `AirportPicker`, `AirportPick` (Task 7); `suggestRoute(..., { start })` (Task 3).
- Produces: `MapExplorer` gains `arrival?: AirportPick | null` and `onArrivalChange?: (pick: AirportPick | null) => void`; `DestinationStep` gains the same two, threaded through; the page holds `arrival` and sends `arrivalAirport: arrival.iata` in `tripInput` only when set.

- [ ] **Step 1: Write the failing tests**

In `components/map/MapExplorer.test.tsx`, add a `describe` using the file's own `Harness` and flush helpers (read the file's top 200 lines first; render with `selected` naming two curated China cities and `country="CN"`, exactly as its existing multi-select tests do):

```tsx
describe("the arrival gateway anchors the suggested route (spec §10.3, D3)", () => {
  /** Shanghai Hongqiao, at the artifact's coordinates. */
  const SHA = {
    iata: "SHA",
    icao: "ZSSS",
    name: "Shanghai Hongqiao International Airport",
    municipality: "Shanghai",
    country: "CN",
    lat: 31.198104,
    lon: 121.33426,
    size: "large" as const,
  };

  test("without an arrival, Beijing leads; anchored at Hongqiao, Shanghai does", async () => {
    // Beijing and Shanghai alone have exactly two tours, and the unanchored
    // search picks the lower id: "beijing". The anchor has to flip it.
    const unanchored = await renderExplorer({ selected: ["beijing", "shanghai"], country: "CN" });
    const first = () => within(screen.getByRole("list", { name: /suggested route/i })).getAllByRole("listitem")[0];
    expect(first()).toHaveTextContent("1. Beijing");
    unanchored.unmount();

    await renderExplorer({
      selected: ["beijing", "shanghai"],
      country: "CN",
      arrival: { iata: "SHA", airport: SHA },
    });
    expect(first()).toHaveTextContent("1. Shanghai");
    expect(screen.getByText(/starts near SHA/i)).toBeInTheDocument();
  });

  test("a bare code with no airport behind it does not anchor", async () => {
    await renderExplorer({
      selected: ["beijing", "shanghai"],
      country: "CN",
      arrival: { iata: "SHA", airport: null },
    });
    const first = within(screen.getByRole("list", { name: /suggested route/i })).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("1. Beijing");
  });

  test("the picker in the route panel reports the traveller's choice upward", async () => {
    const onArrivalChange = vi.fn();
    await renderExplorer({ selected: ["beijing", "shanghai"], country: "CN", onArrivalChange });
    fireEvent.change(screen.getByLabelText("Flying into"), { target: { value: "" } });
    expect(onArrivalChange).toHaveBeenLastCalledWith(null);
  });
});
```

`renderExplorer` is whatever the file already calls its mount-and-flush helper; if it takes props as a single object, extend that object with `arrival` and `onArrivalChange` (both optional). Give the route `<ol>` an `aria-label="Suggested route"` in Step 3 so `getByRole("list", { name })` can find it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/map/MapExplorer.test.tsx`
Expected: FAIL — the panel has no picker, the `<ol>` has no accessible name, and the order does not flip.

- [ ] **Step 3: Anchor and render in `MapExplorer`**

Add to `Props`:

```ts
  /**
   * The arrival gateway the traveller chose in the wizard (spec §10.3, D3).
   * Anchors the suggested route only when it carries an airport — a bare
   * typed code has no coordinates to anchor on. Optional: RouteMap and the
   * tests that predate gateways render without it.
   */
  arrival?: AirportPick | null;
  onArrivalChange?: (pick: AirportPick | null) => void;
```

with `import { AirportPicker, type AirportPick } from "@/components/trip/AirportPicker";`. Destructure both (`arrival = null`). Change the `suggestRoute` call and its `useMemo` deps:

```ts
    const start = arrival?.airport ? { lat: arrival.airport.lat, lon: arrival.airport.lon } : undefined;
    return {
      route:
        routePlaces.length >= 2
          ? suggestRoute(routePlaces, airports, transport, start ? { start } : {})
          : null,
      unresolvedCount: missing,
    };
  }, [selected, placeById, airports, transport, arrival]);
```

In the route panel, replace the header `<div className="flex flex-wrap items-center justify-between gap-2">` block's contents with the heading, the picker and the button:

```tsx
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h4 className="text-sm font-bold">
              Suggested route · {route.totalKm.toLocaleString()} km
              {arrival?.airport && (
                <span className="ml-2 font-normal text-[var(--ink-2)]">starts near {arrival.iata}</span>
              )}
            </h4>
            {onArrivalChange && (
              <div className="w-48">
                <AirportPicker
                  label="Flying into"
                  value={arrival?.iata ?? null}
                  onChange={onArrivalChange}
                  placeholder="Lima or LIM"
                />
              </div>
            )}
            <button
              type="button"
              onClick={applyRouteOrder}
              className="inline-flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--accent-ink)] px-3 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
            >
              Apply this order
            </button>
          </div>
```

(The button was `px-3 py-1` with no height class — a target under 44 px, the exact shape PR #22 fixed six times. `e2e/tap-targets.spec.ts` sweeps every visible button on `/plan`, so it would have caught it the first time this panel appeared in a run.) Give the `<ol>` `aria-label="Suggested route"`.

- [ ] **Step 4: Thread through `DestinationStep` and the page**

`components/DestinationStep.tsx`: add `arrival?: AirportPick | null; onArrivalChange?: (pick: AirportPick | null) => void;` to `Props` (import the type from `@/components/trip/AirportPicker`), destructure, and pass both to `<MapExplorer>`.

`app/plan/page.tsx`: import `type AirportPick`; add `const [arrival, setArrival] = useState<AirportPick | null>(null);` beside the other wizard state; in the `tripInput` memo add `...(arrival ? { arrivalAirport: arrival.iata } : {})` and `arrival` to its deps — absent when not chosen, so the server stamps its default (Task 5); in the reset-everything function add `setArrival(null)`; pass `arrival={arrival}` and `onArrivalChange={setArrival}` to `<DestinationStep>`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run components/map/MapExplorer.test.tsx components/DestinationStepPicked.test.tsx components/map/chinaBaseline.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: PASS. `chinaBaseline.test.tsx` byte-pins China's default render; the picker only appears when two places are selected, so the baseline must not move.

- [ ] **Step 6: Commit**

```bash
git add components/map/MapExplorer.tsx components/map/MapExplorer.test.tsx components/DestinationStep.tsx app/plan/page.tsx
git commit -m "feat: ask where the trip lands, and start the suggested route there" -m "A 'Flying into' picker in the route panel, anchoring suggestRoute only when the traveller picked an airport from the list (D3): a bare code has no coordinates. The code travels with the trip input so the create route keeps it instead of stamping its own. Also gives the panel's 'Apply this order' button the 44px it never had." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The browser proof and the docs

**Files:**
- Create: `e2e/gateways.spec.ts`
- Modify: `playwright.config.ts:83-84` (the `chromium` project's `testMatch`)
- Modify: `README.md` API table (after the `/api/trips/:id/currency` row)

**Interfaces:**
- Consumes: the signed-in `storageState` from `e2e/auth.setup.ts`; `POST /api/trips` (Task 5); the strip's `data-testid="gateways"` and its "Edit gateways" / "Depart from" / "Save" controls (Task 8).

- [ ] **Step 1: Write the spec**

```ts
// e2e/gateways.spec.ts
import { expect, test } from "@playwright/test";

/**
 * The whole gateway path in one browser: the server stamps a new trip from
 * the real airports artifact, the strip shows it, a member changes one side,
 * the change survives a reload, and the plan it sits above is untouched.
 *
 * Peru rather than China because Peru's answer is unambiguous: Lima's main
 * airport is LIM and Cusco's is CUZ, both `large`, nothing else within reach.
 * The ids are GeoNames ids from public/cities/PE.json.
 */
test("a new trip is stamped with its gateways, and a member can change one without losing the plan", async ({
  page,
}) => {
  const created = await page.request.post("/api/trips", {
    data: {
      tripName: "Peru gateways",
      month: 7,
      input: {
        destinationIds: ["G3936456", "G3941584"],
        days: 5,
        season: "winter",
        adults: 2,
        kids: 0,
        interests: ["history"],
        country: "PE",
      },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/trip/${id}?tab=plan`);
  const strip = page.getByTestId("gateways");
  await expect(strip).toContainText("Fly in via LIM");
  await expect(strip).toContainText("out via CUZ");
  const daysBefore = await page.getByText(/^Day 1/).count();
  expect(daysBefore).toBeGreaterThan(0);

  await strip.getByRole("button", { name: "Edit gateways" }).click();
  await strip.getByLabel("Depart from").fill("AQP");
  await strip.getByRole("button", { name: "Save" }).click();
  await expect(strip).toContainText("out via AQP");

  await page.reload();
  await expect(page.getByTestId("gateways")).toContainText("out via AQP");
  await expect(page.getByTestId("gateways")).toContainText("Fly in via LIM");
  // The plan survived the edit: this route never rebuilds it.
  expect(await page.getByText(/^Day 1/).count()).toBe(daysBefore);
});

test("an unknown code is refused, with the reason on screen", async ({ page }) => {
  const created = await page.request.post("/api/trips", {
    data: {
      tripName: "Peru typo",
      month: 7,
      input: {
        destinationIds: ["G3936456"],
        days: 2,
        season: "winter",
        adults: 1,
        kids: 0,
        interests: [],
        country: "PE",
      },
    },
  });
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/trip/${id}?tab=plan`);
  const strip = page.getByTestId("gateways");
  await strip.getByRole("button", { name: "Edit gateways" }).click();
  await strip.getByLabel("Arrive at").fill("ZZZ");
  await strip.getByRole("button", { name: "Save" }).click();
  await expect(strip).toContainText("Unknown airport code ZZZ");
});
```

In `playwright.config.ts`, the `chromium` project's `testMatch: /map\.spec\.ts/` becomes `testMatch: /(map|gateways)\.spec\.ts/`, with the comment above it extended: "gateways.spec.ts creates trips through the API with the saved session, so it belongs to the signed-in project too."

If "Day 1" is not the day card's heading text, read `components/trip/DayCard.tsx` for what it renders and match that instead — the assertion's job is only that the same number of day cards exist before and after.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/gateways.spec.ts --project=chromium` (this starts the dev server on port 3100 itself; the throwaway SQLite database lives under the OS temp directory).
Expected: 2 passed. If the strip shows codes other than LIM/CUZ, the airports artifact has changed since 2026-09-03 — check `data/airports.json` for the nearest `large`/`medium` airport to Lima and Cusco and update the expectations with a comment naming the date.

- [ ] **Step 3: Document the route**

In `README.md`'s API table, after the `/api/trips/:id/currency` row:

```markdown
| `/api/trips/:id/gateways` | PUT | Arrival and departure airports, IATA or null (members only; never rebuilds the plan) |
```

- [ ] **Step 4: Run everything**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npx playwright test`
Expected: tsc clean; every unit test green (2,372 before this plan plus the new ones); 14 e2e passed (12 before this plan plus 2).

- [ ] **Step 5: Commit**

```bash
git add e2e/gateways.spec.ts playwright.config.ts README.md
git commit -m "test: prove the gateway path in a browser, and document the route" -m "Create through the API with the saved session, read the stamped LIM/CUZ off the strip, change one side, reload, and count the day cards before and after: the edit never rebuilt the plan." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Deliberately out of scope

- **Drawing the gateways on `RouteMap`.** §10.3 asks for the fields, the stamp, the sub-route and the anchor; airport endpoints on the trip map are a Plan 7-style layer and a separate decision.
- **A departure anchor.** §10.3 gives `suggestRoute` a `start` only. Ending near the departure gateway is a fixed-endpoint tour, a different search; the traveller reorders by hand today.
- **Gateways in the guest view and the briefing.** `guestTripView` exposes `input.season` alone; widening it is a redaction decision, not a plumbing one.
- **Cross-border main airports on the place card.** `mainAirportFor`'s docblock records the border limit and its fix (a wider array); the server-side stamp already uses `allAirports()`, the card still gets the open country's rows.
- **Baking the code into day one's arrival item.** Considered and rejected in Task 5: a gateway edited later would leave stale copy in a plan the sub-route deliberately does not rebuild.

---

## Self-review

**Spec coverage.** §10.3 bullet by bullet: optional and nullable → Task 1; no migration → Tasks 1 and 4 (reader default + fill-absent-only); Zod listed explicitly plus a named reader → Tasks 2 and 1; server stamps at create from resolved coordinates → Task 5; saved through `/gateways`, never PATCH → Task 6 (and Task 5's carry-forward keeps PATCH from dropping them); `suggestRoute` gains an optional `start`, both pinned tests untouched → Task 3; D3 "anchor only when user-set" → Task 9 (list pick only). Roadmap §6.4's "touches `PlanTab`" → Task 8. `useTripPayload` needs no change: the sub-route returns the full payload like `/currency`, and the accessor applies it.

**Placeholder scan.** Every code step shows its code. Two places tell the implementer to read a neighbouring test for a setup sequence (Task 7 Step 1, Task 9 Step 1's `renderExplorer`) — they name the exact test and the exact lines to copy, and the assertions that are new are written out.

**Type consistency.** `TripGateways { arrival, departure }` (Task 1) is what `withGateways`, `GatewaysStrip`, `PlanTab.gateways` and `TripView.saveGateways` all use; the wire shape `{ arrivalAirport, departureAirport }` (`GatewaysSchema`, Task 2) appears only at the two ends — `saveGateways` maps to it, the route maps back with `withGateways`. `AirportPick { iata, airport }` (Task 7) is what `MapExplorer.arrival` and the page state hold. `suggestRoute`'s fourth parameter is `RouteOptions` with `start?: LatLon` (Task 3) and is passed `{ start }` or `{}` in Task 9. `defaultGateways` returns `GatewayDefaults { arrivalAirport, departureAirport }` — the input's field names, because `applyDefaultGateways` spreads it onto `TripInput`.
