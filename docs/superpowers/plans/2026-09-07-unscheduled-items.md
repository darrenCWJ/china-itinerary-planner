# Unscheduled Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four items left open after PR #30 — trip-derived ticket examples, a world level that fetches nothing until a country is opened, documentation that describes the app as it is, and every source file under the 800-line guidance — behind the repo's existing gates, as two pull requests.

**Architecture:** PR 1 (`chore/unscheduled-items`, Tasks 0–9) carries the behaviour changes and the docs: a pure `ticketExamples` helper in `lib/tickets.ts` threaded from `TripView` as one prop, an `enabled` latch on `useCountryAssets` fed by `MapExplorer`'s existing `openedCountry` flag, and the README, `docs/PLAN.md` and spec status lines rewritten from the tree. PR 2 (`chore/split-oversized-files`, Tasks 10–19, branched from `main` after PR 1 merges) is pure moves: the four ingest scripts split into `scripts/<topic>/` modules along their section banners, `CountryLevel.tsx` into eight files along its seams, and each test file split along its `describe` blocks. Spec: `docs/superpowers/specs/2026-09-07-unscheduled-items-design.md`.

**Tech Stack:** Next.js 16, React, TypeScript; Vitest 4 with two projects (`node`: `lib/**/*.test.ts` + `scripts/**/*.test.ts`; `jsdom`: `components/**/*.test.tsx` + `lib/**/*.test.tsx`); Playwright (workers: 1, one project per spec pattern); Node ESM scripts under `scripts/`.

## Execution record — PR 1 (2026-09-07, PR #31)

Tasks 0–9 were executed on 2026-09-07 (working ledger: `.superpowers/sdd/unscheduled-ledger.md`, gitignored). Where the branch differs from what this plan predicts, the branch is right, and this section is the in-repo record of it:

- **Task 1:** `lib/tickets.test.ts` holds 17 tests after the task (9 pre-existing + 8 new), not 11 — Step 4 counted `describe` blocks. The arithmetic for Task 9 (+8) was unaffected.
- **Task 2:** Step 7's "`lib/contracts.test.ts` green" was wrong: C7's "TripView credits the guest surface as well as the member one" counted every comment-stripped `destinationNames` token (pinned 2) and Step 5's reads made it 5. The test now counts render sites (`destinationNames.map(`); the pin stays 2; `lib/contracts.test.ts` is therefore in PR 1's diff. Step 8's grep also hits the new test's own absence regex and Task 1's docblocks — both quote the retired strings on purpose.
- **Task 4:** the prefetch was six requests / 94.7 KB gzipped, not five / 90.8 — `/cities/enrich/CN.json` (3.9 KB) was missed. The docblocks in `useCountryAssets.ts` and `MapExplorer.tsx` and the test's comment carry the corrected figure.
- **Task 5 → 5b:** the e2e failed on the real bundle: `components/plan/PlaceSearch.tsx` fetched the default country's shard on mount (it is live on the globe step, scoped to `"CN"`) — a second requester spec §4 did not know about. Task 5b (not in this plan; commit 9a2be0a) gates that effect behind a one-way `wanted` latch set on the box's first focus or first keystroke, with a test in `PlaceSearch.test.tsx`. Playwright is 22 with Task 5's test passing.
- **Task 7:** two figures corrected from the tree — climate rows are 58,759 (`data/climate-report.md`), and the wizard's Step 1 is Trip details, Step 2 Destinations (`lib/wizard.ts`).
- **Task 8:** the table has twelve rows (the prose said eleven) and the grep prints 14 (not 13). The final review found three more specs the census missed (backlog-clearance, map-timeline-explorer, app-shell-login); done in the fix wave.
- **Task 9:** the final whole-branch review returned 0 Critical, 0 Important and nine Minor, closed in two commits — among them a `MapExplorer.test.tsx` assertion that a round trip to the globe re-fetches nothing, and `TripView` resolving `tripCurrency` once. Final gates on 94784ac: tsc clean; **141 files, 2,680 passed, 1 expected fail** (the plan said 2,679 — Task 5b's test is the +1); Playwright 22; `next build` green; glance 8/8 at desktop and Pixel 5.
- **Consequence for PR 2:** Task 10's expected baseline is **141 files / 2,680 passed / 1 expected fail**, not 2,679.

## Execution record — PR 2 (2026-09-08)

Tasks 10–19 were executed on 2026-09-07/08 (working ledger: `.superpowers/sdd/unscheduled-ledger.md`, gitignored). Where the branch differs from what this plan predicts, the branch is right, and this section is the in-repo record of it:

- **The cut sequences (Tasks 11–14 Step 1; Task 15 Steps 1 and 3) cannot run as written.** Each cut deletes the banner or declaration the next cut uses as its end anchor (`section … "Report"` after the Report section is gone returns `e = -2`; Task 15's `VIEW_BOX` cut deletes the `UnitProps` cut's anchor). Every task recorded all bounds on the pristine file first and cut bottom-up with literal numbers — a bottom-up cut never shifts the lines above it. A module assembled from two non-adjacent sections (`cities/io.mjs`, `country-facts/io.mjs`, `country-facts/facts.mjs` around the removed `CURATED_FACTS`) was cut into separate `.body` files and assembled in file order. Bodies are byte-identical either way; every per-task review re-ran the identity diffs.
- **The checkJs derivation** needs `--ignoreConfig` on this repo (TS5112 otherwise) and reports `TS2459` as well as `TS2304` once imports are seeded.
- **Task 13:** "passed as parameters where `io.mjs` needs them" would have changed signatures — all 21 header constants are read inside function bodies. Each moved to the one module that reads it, none exported; the entry exports only `run` and is 372 lines, not ~460.
- **Task 14:** the kept `run()` test came out at 960 lines. The fixtures its describes share with the split files moved byte-identically to `scripts/country-facts/fixtures.ts` and the harness helpers to `scripts/country-facts/runHarness.ts` (non-test modules; vitest collects only `*.test.ts`), duplicates were removed, and `the four withhold rules…` joined `gate.test.ts` as the table said; the entry test is 578. The file had 30 describes, not 29 (a `describe.skipIf` the brief's grep missed). `report.mjs` imports `io.mjs` for the attribution constants; the entry imports the four modules `run` reads directly. The entry's dead typedef chain (`EmergencyNumber`, `CountryFacts`, `Diagnostics`, `BuiltFacts`) was deleted; `refresh-cities.yml`'s "34 throw sites" was already stale (36) and is corrected; `lib/countryFacts.test.ts`'s import block and two `lib/countryFacts.ts` comments followed the code.
- **Task 15:** Step 6's import list omits `paintedAt` (still used by the card anchor); Step 3's fourth cut carries `ARRIVABLE_AIRPORT_SIZES`'s docblock into `markerGeometry.ts` — Task 16 moved it beside the filter in `AirportLayer.tsx`.
- **Task 16:** `AirportLayer`'s leading JSX comment is a `/* */` comment, the only valid form between `return (` and the element; `CountryLevel.tsx` is 711 lines (the estimate was 745).
- **Task 17:** vitest 4 rejects `export const { capCall } = vi.hoisted(…)`, so the harness exports `capCall` on the next line; the harness's import block is trimmed to what it uses; the whole jsdom project went from 49 to 53 files at the same 608 tests.
- **The self-review below says "the spec said 21"; the committed spec says 22**, and 22 is in the tree (the eight files plus `CountryLevel.tsx` itself).
- **Measured:** entries 339 / 242 / 372 / 273 lines; `CountryLevel.tsx` 711; per-file test counts unchanged (62 / 104 / 47 / 251 / 61); the full suite 164 files — 141 plus 23 new test files, not the 165 Task 19 expected: Task 12 has no `report.test.ts` because the original had no `buildReport` describe (C7 covers it) — 2,680 passed, 1 expected fail; Playwright 22; `next build` green; glance 8/8 at desktop and Pixel 5.
- **After the whole-branch review**, one comment-and-import-only commit corrected the prose that still pointed at the old homes (module headers, test preambles, cross-references in `lib/`, `components/`, `test/` and the workflows) and removed two imports the split left behind (`dotR` in `CountryLevel.zoom.test.tsx`, `readFileSync` in the country-facts entry test).

## Global Constraints

- **Do not run `git commit`, `git add`, `git checkout`, `git stash` or `git mv`.** The controller commits after review, with the message each task ends with. `git diff` and `git status` are fine. (`git mv` is replaced by a plain file move plus `git status` showing the rename after the controller stages it.)
- **Report format at the end of every task:** files changed, every command run with its result (counts, not "passed"), anything you deviated from and why, anything you noticed and left alone.
- **Commit trailer on every commit:** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit format `<type>: <description>` (feat, fix, refactor, docs, test, chore).
- **Baseline (main 434220a, PR #30's gates):** `npx tsc --noEmit` clean; `npm test` 140 files, 2,667 passed, 1 expected fail (`lib/climateModel.test.ts` "fix 1 — Lima is not great in all twelve months", `test.fails` by decision P6-3 — it stays); `npx playwright test` 20 passed; `npx next build` green. Task 0 and Task 10 re-measure and record.
- **Copy rule (spec §1):** no placeholder names a carrier, venue, station or city from any one country. The trip's own stops and codes are the only proper nouns a placeholder may carry.
- **Edge rule (spec §1):** `lib/tickets.ts` imports `lib/tripShared` as types only and may import `lib/money.ts` (which also imports `tripShared` as types only). `lib/countryFacts.test.ts` pins the client entry points that reach `lib/countryFacts.ts`; that list must not change in PR 1.
- **Move rule (spec §2, PR 2):** no function body changes; adding `export` to a declaration is allowed; every resulting file is under 800 lines (`wc -l`); the number of tests before and after each split is identical; the entry scripts re-export nothing; importers follow the code.
- **Line numbers in this plan were measured on 2026-09-07 at 434220a.** Every cut step anchors on content (a banner title or a declaration) rather than on a number; the numbers are there so a reader can check the anchor found the right place.
- **Windows checkout:** files are CRLF in the working tree (core.autocrlf). The cut helpers strip `\r` before matching. New files may be written LF; git normalises on commit. Write patch scripts with the Write/Edit tools, never through a Bash heredoc (the harness mangles backslashes in heredoc-fed scripts).
- **Docker owns port 3000** on this machine; Playwright starts its own dev server on 3100; `.claude/launch.json` uses autoPort for a preview.
- **Ledger:** `.superpowers/sdd/unscheduled-ledger.md` (gitignored), one line per task outcome, kept by the controller.

---

## PR 1 — `chore/unscheduled-items`

### Task 0 (controller): branch, ledger, baseline

**Files:**
- Create: `.superpowers/sdd/unscheduled-ledger.md`

- [ ] **Step 1: Branch from a fresh main**

```bash
git fetch origin --prune
git switch main && git merge --ff-only origin/main
git switch -c chore/unscheduled-items
```

Expected: `Switched to a new branch 'chore/unscheduled-items'`; `git log --oneline -1` shows `434220a` or a later nightly-refresh commit (the refresh jobs commit to `main` at ~12:10 and ~12:20 UTC — a data-only commit on top is fine).

- [ ] **Step 2: Baseline gates, recorded**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npm test 2>&1 | tail -8
npx playwright test 2>&1 | tail -4
```

Expected: `TSC-CLEAN`; `Test Files 140 passed (140)`, `Tests 2667 passed | 1 failed (2668)` where the 1 is the Lima `test.fails` (vitest reports an expected failure as a pass — if the summary shows `2667 passed | 1 failed`, the failing one must be that tripwire and nothing else); Playwright `20 passed`. Write the three lines into the ledger with the date and the HEAD sha.

- [ ] **Step 3: Commit the spec and this plan**

```bash
git add docs/superpowers/specs/2026-09-07-unscheduled-items-design.md docs/superpowers/plans/2026-09-07-unscheduled-items.md
git commit -m "docs: design and plan for the four items left after PR #30

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `ticketExamples` and `TICKET_TITLE_EXAMPLES` in `lib/tickets.ts`

**Files:**
- Modify: `lib/tickets.ts` (24 lines today: `dayDate`, `ticketOnDate`, `sortTickets`; imports `type { Ticket }` from `./tripShared`)
- Test: `lib/tickets.test.ts` (node project; imports `dayDate, sortTickets, ticketOnDate` from `./tickets`)

**Interfaces:**
- Consumes: `formatMinor(amountMinor: number, currency: string): string` and `minorUnitDigits(currency: string): number` from `lib/money.ts`; `TicketKind = "flight" | "train" | "hotel" | "attraction" | "other"` from `lib/tripShared.ts`.
- Produces: `interface TicketExamples { from: string; to: string; flightFrom: string; flightTo: string; price: string }`; `interface TicketExampleInput { firstStop: string | null; lastStop: string | null; arrival: string | null; departure: string | null; currency: string | null }`; `function ticketExamples(input: TicketExampleInput): TicketExamples`; `const TICKET_TITLE_EXAMPLES: Record<TicketKind, string>`. Task 2 threads these through `TripView` → `KitTab` → `TicketsTab`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/tickets.test.ts` (add `ticketExamples, TICKET_TITLE_EXAMPLES` to the existing `./tickets` import and `import { TICKET_KINDS } from "./meta";`):

```ts
describe("ticketExamples", () => {
  const PERU = {
    firstStop: "Lima",
    lastStop: "Cusco",
    arrival: "LIM",
    departure: "CUZ",
    currency: "PEN",
  };

  it("uses the first and last stops and both gateways", () => {
    expect(ticketExamples(PERU)).toEqual({
      from: "Lima",
      to: "Cusco",
      flightFrom: "Lima or LIM",
      flightTo: "Cusco or CUZ",
      price: "PEN 553.00",
    });
  });

  it("falls back half by half when a gateway is missing", () => {
    const examples = ticketExamples({ ...PERU, arrival: null, departure: null });
    expect(examples.flightFrom).toBe("Lima or airport code");
    expect(examples.flightTo).toBe("Cusco or airport code");
    // The train and other endpoints never carried a code, so they are unchanged.
    expect(examples.from).toBe("Lima");
    expect(examples.to).toBe("Cusco");
  });

  it("falls back to City when the trip has no stops", () => {
    const examples = ticketExamples({ ...PERU, firstStop: null, lastStop: null });
    expect(examples.from).toBe("City");
    expect(examples.to).toBe("City");
    expect(examples.flightFrom).toBe("City or LIM");
    expect(examples.flightTo).toBe("City or CUZ");
  });

  it("does not offer the only stop as both ends of a one-city trip", () => {
    const examples = ticketExamples({ ...PERU, lastStop: "Lima" });
    expect(examples.from).toBe("Lima");
    expect(examples.to).toBe("City");
    expect(examples.flightFrom).toBe("Lima or LIM");
    expect(examples.flightTo).toBe("City or CUZ");
  });

  it("renders the price through the app's own money formatter", () => {
    // The same 553 the old placeholder used, in the trip's currency and in the
    // notation the Money tab uses for it: a symbol where one is known, the
    // code otherwise, and the currency's own number of decimals.
    expect(ticketExamples({ ...PERU, currency: "CNY" }).price).toBe("¥553.00");
    expect(ticketExamples({ ...PERU, currency: "JPY" }).price).toBe("JPY 553");
    expect(ticketExamples({ ...PERU, currency: "KWD" }).price).toBe("KWD 553.000");
  });

  it("says Amount when the trip has no currency", () => {
    expect(ticketExamples({ ...PERU, currency: null }).price).toBe("Amount");
  });
});

describe("TICKET_TITLE_EXAMPLES", () => {
  it("covers every ticket kind", () => {
    for (const kind of TICKET_KINDS) {
      expect(TICKET_TITLE_EXAMPLES[kind.id]).toMatch(/\S/);
    }
  });

  it("names no carrier, station, venue or city from any one country", () => {
    // The strings the old placeholders carried. A new example that quotes a
    // real train, flight or attraction fails here, whichever country it is from.
    const banned = /G2|CA1858|Disneyland|Beijing|Shanghai|PEK|SHA|¥/;
    for (const text of Object.values(TICKET_TITLE_EXAMPLES)) {
      expect(text).not.toMatch(banned);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --project node lib/tickets.test.ts`
Expected: FAIL — `ticketExamples` and `TICKET_TITLE_EXAMPLES` are not exported (`SyntaxError`/`TypeError: ticketExamples is not a function`); the three existing tests still pass.

- [ ] **Step 3: Implement**

Replace the import at the top of `lib/tickets.ts` and append the helper. The file becomes:

```ts
import { formatMinor, minorUnitDigits } from "./money";
import type { Ticket, TicketKind } from "./tripShared";

// … dayDate, ticketOnDate, sortTickets unchanged …

/** The placeholder text the ticket form shows, built from the trip it is on. */
export interface TicketExamples {
  /** Train and other endpoints: a stop's name. */
  from: string;
  to: string;
  /** Flight endpoints: a stop's name or its gateway's IATA code. */
  flightFrom: string;
  flightTo: string;
  /** A price in the trip's currency, in the Money tab's notation. */
  price: string;
}

export interface TicketExampleInput {
  firstStop: string | null;
  lastStop: string | null;
  /** The trip's fly-in and fly-out gateways, IATA or null (`tripGateways`). */
  arrival: string | null;
  departure: string | null;
  /** The trip's currency, or the member's home currency, or null. */
  currency: string | null;
}

/**
 * The amount the placeholder has always shown — "¥553" since the Kit tab was
 * built. Kept as a number so it renders in every currency's own decimals.
 */
const EXAMPLE_PRICE_MAJOR = 553;

/**
 * The ticket form's placeholders are format hints, never stored, and until
 * 2026-09-07 every one of them was Chinese — "Beijing or PEK", "¥553" — on
 * every trip. These are the same hints in the trip's own terms: its first and
 * last stops, the gateways the server stamped on it, and its currency.
 *
 * Takes primitives rather than the trip, on purpose: `lib/countryFacts.test.ts`
 * pins the client entry points that reach the 70 KB facts artifact, and
 * `tripCurrency` reaches it. `TripView` already pays and computes all five
 * inputs; this module must stay a leaf that does not.
 *
 * Each half of a flight hint falls back on its own, so a trip with stops but
 * no gateway still reads "Lima or airport code". The destination half of both
 * `to` and `flightTo` refuses to repeat the origin: a one-city trip's only
 * stop is where you fly TO, and offering it as the "from" of the same flight
 * would be a hint that teaches the wrong thing.
 */
export function ticketExamples(input: TicketExampleInput): TicketExamples {
  const first = input.firstStop;
  const last = input.lastStop !== null && input.lastStop !== input.firstStop ? input.lastStop : null;
  return {
    from: first ?? "City",
    to: last ?? "City",
    flightFrom: `${first ?? "City"} or ${input.arrival ?? "airport code"}`,
    flightTo: `${last ?? "City"} or ${input.departure ?? "airport code"}`,
    price:
      input.currency === null
        ? "Amount"
        : formatMinor(EXAMPLE_PRICE_MAJOR * 10 ** minorUnitDigits(input.currency), input.currency),
  };
}

/**
 * The title hint per ticket kind. No trip can supply a flight number, so
 * these are neutral and kind-aware rather than trip-derived — and none of
 * them may name a carrier, station or venue (pinned in lib/tickets.test.ts).
 */
export const TICKET_TITLE_EXAMPLES: Record<TicketKind, string> = {
  flight: "Flight number",
  train: "Train number or route",
  hotel: "Hotel name",
  attraction: "Venue or event",
  other: "What it's for",
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project node lib/tickets.test.ts`
Expected: `Tests 11 passed (11)` (3 existing + 6 + 2).

- [ ] **Step 5: The edge rule holds**

Run: `npx vitest run --project node lib/countryFacts.test.ts`
Expected: the `"the client entry points that pay for it are exactly these"` test passes unchanged — `lib/tickets.ts` now imports `lib/money.ts`, which imports `tripShared` as types only, so no new edge reaches the artifact.

- [ ] **Step 6: Commit (controller)**

```
feat: ticket placeholder examples derived from the trip's stops, gateways and currency
```

---

### Task 2: Thread the examples through `TripView`, `KitTab`, `TicketsTab`; retire "Hotpot dinner"

**Files:**
- Modify: `components/TripView.tsx` (imports at lines 1–32; `const { data } = payload;` at line 199; `<PlanTab … gateways={tripGateways(data)} …>` at line 298; `<KitTab …>` at lines 335–345)
- Modify: `components/trip/KitTab.tsx` (props interface lines 20–33, destructure 35–45, `<TicketsTab>` at 56–63, docblock line 18 "Not wired into TripView until Task 12.")
- Modify: `components/trip/TicketsTab.tsx` (`TicketsTabProps` lines 23–30; the two `<TicketForm>` mounts at lines 76–83 and 119–125; `TicketForm` signature lines 249–261; placeholders at 293, 327, 333, 340, 344, 350)
- Modify: `components/trip/ExpenseForm.tsx:139` (`placeholder="Hotpot dinner"`)
- Modify: `components/trip/ExpenseForm.test.tsx:79` (`getByPlaceholderText("Hotpot dinner")`)
- Create: `components/trip/TicketsTab.test.tsx` (jsdom project; none exists today)

**Interfaces:**
- Consumes: `ticketExamples`, `TICKET_TITLE_EXAMPLES`, `type TicketExamples` from `@/lib/tickets` (Task 1); `tripGateways(data): { arrival: string | null; departure: string | null }` from `@/lib/tripGateways`; `tripCurrency(data): string | null` from `@/lib/tripShared`; `payload.currencySettings.home: string | null`.
- Produces: `KitTab` prop `ticketExamples: TicketExamples`; `TicketsTab` prop `examples: TicketExamples`; `TicketForm` prop `examples: TicketExamples`.

- [ ] **Step 1: Write the failing component test**

Create `components/trip/TicketsTab.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { TicketExamples } from "@/lib/tickets";
import { TicketsTab } from "./TicketsTab";

afterEach(cleanup);

/** What `TripView` derives for a Lima → Cusco trip: real names, real codes. */
const PERU: TicketExamples = {
  from: "Lima",
  to: "Cusco",
  flightFrom: "Lima or LIM",
  flightTo: "Cusco or CUZ",
  price: "PEN 553.00",
};

function openTheForm() {
  render(
    <TicketsTab
      tickets={[]}
      isMember
      hasStartDate={false}
      examples={PERU}
      onAdd={async () => null}
      onUpdate={async () => null}
      onDelete={async () => null}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "+ Add ticket" }));
}

describe("the ticket form's placeholders are the trip's own", () => {
  test("a train's endpoints and price", () => {
    openTheForm();
    // The form opens on `train` (`toFields` defaults the kind).
    expect(screen.getByPlaceholderText("Train number or route")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Lima")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cusco")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("PEN 553.00")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Beijing|Shanghai|¥553|CA1858/)).toBeNull();
  });

  test("a flight's endpoints carry the gateway codes", () => {
    openTheForm();
    fireEvent.click(screen.getByRole("button", { name: /Flight/ }));
    expect(screen.getByPlaceholderText("Flight number")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Lima or LIM")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Cusco or CUZ")).toBeInTheDocument();
  });

  test("a hotel asks for its name, as before", () => {
    openTheForm();
    fireEvent.click(screen.getByRole("button", { name: /Hotel/ }));
    expect(screen.getByPlaceholderText("Hotel name")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project jsdom components/trip/TicketsTab.test.tsx`
Expected: FAIL — TypeScript/vitest reports `examples` is not a prop, and the placeholders `Lima`, `PEN 553.00` are not found.

- [ ] **Step 3: `TicketsTab.tsx` — take `examples`, use it in `TicketForm`**

Add to the import block: `import { TICKET_TITLE_EXAMPLES, type TicketExamples } from "@/lib/tickets";` (keep the existing `import { sortTickets } from "@/lib/tickets";` merged into it: `import { sortTickets, TICKET_TITLE_EXAMPLES, type TicketExamples } from "@/lib/tickets";`).

In `TicketsTabProps` add, with a docblock:

```ts
  /**
   * The form's placeholder text, derived by `TripView` from the trip's stops,
   * gateways and currency (`ticketExamples` in lib/tickets.ts). A prop rather
   * than a computation here because the inputs — the currency especially —
   * are `TripView`'s to resolve, and this component must not reach the facts
   * artifact for a hint.
   */
  examples: TicketExamples;
```

Destructure `examples` in `TicketsTab({ … })` and pass `examples={examples}` to both `<TicketForm>` mounts (the edit at line 76 and the add at line 119).

In `TicketForm`'s props add `examples: TicketExamples;` and destructure it. Replace the six placeholders:

```tsx
placeholder={TICKET_TITLE_EXAMPLES[fields.kind]}          // line 293, was the hotel ternary
…
<AirportInput label="From" … placeholder={examples.flightFrom} />   // 327, was "Beijing or PEK"
<AirportInput label="To"   … placeholder={examples.flightTo} />     // 333, was "Shanghai or SHA"
…
<input … placeholder={examples.from} … />                  // 340, was "Beijing"
<input … placeholder={examples.to} … />                    // 344, was "Shanghai"
…
<input … placeholder={examples.price} … />                 // 350, was "¥553"
```

`"Seat 05A, carriage 3…"` (line 354) and `"08:05"` (line 309) stay.

- [ ] **Step 4: `KitTab.tsx` — one more prop through the union**

In `Props`, under `// Bookings`, add `ticketExamples: TicketExamples;` with `import type { TicketExamples } from "@/lib/tickets";`. Destructure it and pass `examples={ticketExamples}` to `<TicketsTab>`. Replace the docblock's last sentence "Not wired into TripView until Task 12." with "Mounted by `TripView` on the Kit tab." — it has been false since PR #6.

- [ ] **Step 5: `TripView.tsx` — compute once, after `const { data } = payload;`**

Add `import { ticketExamples } from "@/lib/tickets";` to the imports. Immediately after `const { data } = payload;` (line 199):

```ts
  const gateways = tripGateways(data);
  /**
   * The Kit tab's placeholder hints, from the trip's own stops, gateways and
   * currency (spec 2026-09-07 §1). Computed here rather than in the tab because
   * `tripCurrency` reads the facts artifact, and this component already pays
   * for it; the tab takes strings. A plain computation, not a memo: this sits
   * below the early returns, and it is five string operations per render.
   */
  const examples = ticketExamples({
    firstStop: data.destinationNames[0] ?? null,
    lastStop: data.destinationNames[data.destinationNames.length - 1] ?? null,
    arrival: gateways.arrival,
    departure: gateways.departure,
    currency: tripCurrency(data) ?? payload.currencySettings.home,
  });
```

Change line 298's `gateways={tripGateways(data)}` to `gateways={gateways}`, and add `ticketExamples={examples}` to the `<KitTab>` mount (lines 335–345).

- [ ] **Step 6: `ExpenseForm` — "Group dinner"**

`components/trip/ExpenseForm.tsx:139`: `placeholder="Hotpot dinner"` → `placeholder="Group dinner"`.
`components/trip/ExpenseForm.test.tsx:79`: `screen.getByPlaceholderText("Hotpot dinner")` → `screen.getByPlaceholderText("Group dinner")`. (`lib/server/schemas.test.ts:28` uses the phrase as a value: untouched.)

- [ ] **Step 7: Run the tests and the type check**

Run: `npx vitest run --project jsdom components/trip/TicketsTab.test.tsx components/trip/ExpenseForm.test.tsx components/trip/MoneyTab.test.tsx && npx tsc --noEmit && echo TSC-CLEAN`
Expected: TicketsTab 3 passed; ExpenseForm and MoneyTab unchanged counts; `TSC-CLEAN` (a missed `examples`/`ticketExamples` prop anywhere fails here).

Run: `npx vitest run --project node lib/countryFacts.test.ts lib/contracts.test.ts`
Expected: green; the pinned client list is unchanged (`KitTab` already paid, through `PackingSection`; `TicketsTab` still does not).

- [ ] **Step 8: Grep the tree for the retired strings**

Run: `grep -rn -E "Beijing or PEK|Shanghai or SHA|G2 · CA1858|¥553|Hotpot dinner" app components lib e2e --include=*.ts --include=*.tsx`
Expected: only `lib/server/schemas.test.ts:28` (the value) and `lib/tickets.test.ts` (the banned-string test). Anything else is a miss.

- [ ] **Step 9: Commit (controller)**

```
feat: the ticket form's examples are the trip's own stops, gateways and currency
```

---

### Task 3: e2e — the examples come from the gateways the server really stamped

**Files:**
- Create: `e2e/tickets.spec.ts`
- Modify: `playwright.config.ts` (the `chromium` project's `testMatch: /(map|gateways|climate)\.spec\.ts/` — every project lists its specs explicitly; a spec not named here never runs)

**Interfaces:**
- Consumes: the Peru trip shape `e2e/gateways.spec.ts` posts (`destinationIds: ["G3936456", "G3941584"]` = Lima, Cusco; `country: "PE"`; the server stamps `LIM`/`CUZ`); the Kit tab at `?tab=kit` (`lib/nav.ts` `TripTabId`); the button "+ Add ticket".

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";

/**
 * The ticket form's placeholders, end to end: the server stamps a Peru trip
 * with its gateways from the real airports artifact, and the form's hints
 * read them back — the stops by name, the gateways by code, the price in
 * soles. Peru for the reason gateways.spec.ts gives: LIM and CUZ are
 * unambiguous, and PEN has no symbol in lib/money.ts, so the price hint is
 * the code-first fallback that most of the world's currencies take.
 */
test("the ticket form's examples are the trip's own stops, gateways and currency", async ({
  page,
}) => {
  const created = await page.request.post("/api/trips", {
    data: {
      tripName: "Peru tickets",
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

  await page.goto(`/trip/${id}?tab=kit`);
  await page.getByRole("button", { name: "+ Add ticket" }).click();

  // Train is the form's opening kind: names, no codes.
  await expect(page.getByPlaceholder("Lima")).toBeVisible();
  await expect(page.getByPlaceholder("Cusco")).toBeVisible();
  await expect(page.getByPlaceholder("PEN 553.00")).toBeVisible();

  await page.getByRole("button", { name: /Flight/ }).click();
  await expect(page.getByPlaceholder("Lima or LIM")).toBeVisible();
  await expect(page.getByPlaceholder("Cusco or CUZ")).toBeVisible();
  await expect(page.getByPlaceholder("Flight number")).toBeVisible();

  // Nothing Chinese survives on a Peruvian form.
  await expect(page.getByPlaceholder(/Beijing|Shanghai|¥/)).toHaveCount(0);
});
```

- [ ] **Step 2: Register it**

`playwright.config.ts`: `testMatch: /(map|gateways|climate)\.spec\.ts/` → `testMatch: /(map|gateways|climate|tickets)\.spec\.ts/`.

- [ ] **Step 3: Run it**

Run: `npx playwright test e2e/tickets.spec.ts`
Expected: `1 passed`. Then the whole suite: `npx playwright test` → `21 passed`.

Note: Playwright rewrites `next-env.d.ts`; run `git checkout -- next-env.d.ts` is the controller's job before committing (report it if `git status` shows the file).

- [ ] **Step 4: Commit (controller)**

```
test: e2e — the ticket form reads its examples off the stamped gateways
```

---

### Task 4: `useCountryAssets` fetches nothing until a country has been opened

**Files:**
- Modify: `components/map/useCountryAssets.ts` (signature line 44: `export function useCountryAssets(countryCode: string, hasDetail: boolean): CountryAssets`; the country effect lines 142–199 with deps `[retryKey, hasDetail, countryCode]`; the airports effect lines 245–264 with deps `[countryCode]`; the effect's docblock lines 113–141)
- Modify: `components/map/MapExplorer.tsx` (`openedCountry` docblock + state lines 119–130; the hook call lines 136–145)
- Test: `components/map/MapExplorer.test.tsx` (harness: `render(<Harness level="world" />)`, `settle()`, `fetchMock`, `PROJECTION_PATH` already imported)

**Interfaces:**
- Consumes: `openedCountry: boolean` in `MapExplorer` (`useState(level === "country")`, set true during render once `level === "country"`, never reset).
- Produces: `useCountryAssets(countryCode: string, hasDetail: boolean, enabled: boolean): CountryAssets`.

- [ ] **Step 1: Write the failing test**

Add to `describe("MapExplorer", …)` in `components/map/MapExplorer.test.tsx`, after the cold-start test:

```tsx
  test("fetches nothing for any country until one is opened", async () => {
    // Until PR #29 the step opened on China's map, and the hook's fetches were
    // that map's. It opens on the globe now, and 90.8 KB gzipped of China's
    // assets (spec 2026-09-07 §4, measured) went out with every first paint,
    // for a visitor who may never open China. `openedCountry` — the same latch
    // that hides "← Back to" on a cold start — now gates the hook too.
    const countryScoped = (url: string) =>
      /^\/(provinces|cities|climate)\//.test(url) || url.startsWith("/api/map/") || url === PROJECTION_PATH;
    const scopedRequests = () => fetchMock.mock.calls.map(([url]) => String(url)).filter(countryScoped);

    render(<Harness level="world" />);
    await settle();
    expect(scopedRequests()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /Japan/ }));
    await settle();
    const afterPick = scopedRequests();
    expect(afterPick).toContain("/provinces/JP.json");
    expect(afterPick).toContain("/api/map/cities?country=JP");
    expect(afterPick).toContain("/api/map/airports?country=JP");
    // And the pick fetched the country picked — never the default the pane
    // happened to be holding.
    expect(afterPick.some((url) => url.includes("CN"))).toBe(false);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run --project jsdom components/map/MapExplorer.test.tsx -t "fetches nothing for any country"`
Expected: FAIL on the first `toEqual([])` — the list holds `/provinces/CN.json`, `/country-projections.json`, `/api/map/cities?country=CN`, `/cities/CN.json`, `/api/map/airports?country=CN`.

- [ ] **Step 3: The hook takes `enabled`**

`components/map/useCountryAssets.ts`:

```ts
export function useCountryAssets(
  countryCode: string,
  hasDetail: boolean,
  /**
   * Whether to fetch at all. `MapExplorer` passes its `openedCountry` latch:
   * false on the world level until a country has been shown, true from then
   * on and never back. While false both effects do nothing — no request, no
   * state change — so a visitor looking at the globe pays for the globe alone.
   * Measured 2026-09-07 before this existed: the default country's five
   * requests (provinces 23.1 KB, manifest 6.9, catalog cities 38.7, shard
   * 12.6, airports 9.5 — 90.8 KB gzipped) went out on every mount, alongside
   * the globe's own 40 KB topology, for a visitor who may never open China.
   * A one-way latch rather than `level !== "world"` so that going back to
   * the globe and returning re-runs nothing.
   */
  enabled: boolean
): CountryAssets {
```

In the country effect (line 142), first statement: `if (!enabled) return;` and its dependency array becomes `[retryKey, hasDetail, countryCode, enabled]`. In the airports effect (line 245), first statement: `if (!enabled) return;` and its array becomes `[countryCode, enabled]`.

Append one sentence to the country effect's docblock (lines 113–141), after "the same reason the airports effect below clears first.": "Neither effect runs at all while `enabled` is false — see the parameter — so the initial empties are what the world level renders against."

- [ ] **Step 4: `MapExplorer` passes the latch**

Line 145: `} = useCountryAssets(countryCode, hasDetail);` → `} = useCountryAssets(countryCode, hasDetail, openedCountry);`. The `openedCountry` state is declared above the hook call (lines 129–130), so no reordering.

Extend the `openedCountry` docblock (lines 119–128) with a final paragraph:

```
   * It is also what gates `useCountryAssets`: nothing country-scoped is
   * fetched until this is true. The prefetch of the default country's assets
   * that the world level used to make — 90.8 KB gzipped over five requests,
   * measured 2026-09-07 — was written when the map opened on China; on the
   * globe it was paid by everyone and used by whoever then opened China.
```

- [ ] **Step 5: Run the map suites and the type check**

Run: `npx vitest run --project jsdom components/map/ && npx tsc --noEmit && echo TSC-CLEAN`
Expected: every existing MapExplorer test still passes (the harness's default `level` is `"country"`, so `openedCountry` starts true there); the new test passes; `TSC-CLEAN`. The count for `components/map/` is 289 + 1 = 290 map tests (PR #30 measured 289).

- [ ] **Step 6: Commit (controller)**

```
perf: fetch a country's map assets only once a country has been opened
```

---

### Task 5: e2e — the real bundle fetches no country asset before the pick

**Files:**
- Modify: `e2e/map.spec.ts` (helpers `openTheWorld(page)` and the A–Z pick `page.getByRole("combobox", { name: "Or pick from the list" }).selectOption({ label: "China" })`)

- [ ] **Step 1: Add the test**

After `test("the destinations step opens on the globe, not on a country", …)`:

```ts
test("nothing country-scoped is fetched until a country is opened", async ({ page }) => {
  // What jsdom cannot prove about the real bundle: that the request never
  // leaves the browser. Recorded from before navigation, so a request fired
  // during hydration is caught too.
  const countryScoped: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      /^\/(provinces|cities|climate)\//.test(path) ||
      path.startsWith("/api/map/") ||
      path === "/country-projections.json"
    ) {
      countryScoped.push(path);
    }
  });

  await openTheWorld(page);
  expect(countryScoped).toEqual([]);

  await page.getByRole("combobox", { name: "Or pick from the list" }).selectOption({ label: "China" });
  await expect(page.getByRole("group", { name: "Map of China" })).toBeVisible({ timeout: 30_000 });
  expect(countryScoped).toContain("/provinces/CN.json");
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/map.spec.ts`
Expected: all map tests pass, one more than before. Whole suite: `npx playwright test` → `22 passed`.

- [ ] **Step 3: Commit (controller)**

```
test: e2e — no country asset leaves the browser before a country is picked
```

---

### Task 6: `README.md` from the tree

**Files:**
- Modify: `README.md` — everything above `## How "many people can join" works` is replaced by the text below; that section and everything after it (`## Deploying`, `### Environment variables`, the rotation note) stay byte-for-byte.

**Derivation (run these; they are the source of every number and row):**

```bash
find app/api -name route.ts | sed 's|app/api||; s|/route.ts||' | sort          # 32 routes
node -e 'console.log(JSON.parse(require("fs").readFileSync("data/catalog.json","utf8")).cities.length)'   # 695
grep -m1 "cities across" data/cities-report.md                                 # 58759 cities across 246 countries
node -e 'console.log(JSON.parse(require("fs").readFileSync("data/airports.json","utf8")).length ?? "see report")'
ls public/provinces | wc -l; ls public/climate | wc -l; ls public/cities | wc -l   # 247, 247, 248 (each = shards + index.json; cities also has enrich/)
ls scripts/*.mjs | wc -l                                                       # 12
grep -n -E "^name:|cron:" .github/workflows/*.yml
```

- [ ] **Step 1: Replace the top of the README with this**

````markdown
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
Four workflows keep them fresh; each commits only when its artifact changed,
and a commit deploys itself.

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
  map/                the globe, the country map, the province level, layers, hooks (see components/map/MapExplorer.tsx)
lib/                  pure planning logic, shared types, clients (+ tests beside each module)
  data/               the 16 curated destinations
  server/             airports, catalog, cityIndex (server-only artifacts); auth, session, stores (sqlite + postgres), schemas
  contracts.test.ts   whole-tree contracts: one nav, one credit per surface, no second fetch of trip data
scripts/              ingest-*.mjs (data), enrich-cities.mjs, build-*.mjs (geometry), sample-climate-anchors.mjs
data/                 committed artifacts and their reports (airports, catalog, cities-index, country-facts, climate anchors)
public/               cities/<CC>.json, provinces/<CC>.json, climate/<CC>.json (246 each), country-projections.json, world-globe.json
e2e/                  Playwright specs and the saved session (auth.setup.ts)
test/                 shared test harnesses that must live outside the contract-scanned roots
docs/
  PLAN.md             Where things stand and what is open
  RESEARCH.md         Data-source research (APIs, open data, scraping legality), August 2026
  superpowers/        specs (the design record), plans, handoffs
```
````

- [ ] **Step 2: Check the table against the tree**

Run:

```bash
find app/api -name route.ts | sed 's|app/api||; s|/route.ts||; s|\[id\]|:id|; s|\[expenseId\]|:expenseId|; s|\[settlementId\]|:settlementId|; s|\[entryId\]|:entryId|; s|\[photoId\]|:photoId|; s|\[ticketId\]|:ticketId|; s|\[\.\.\.all\]|*|' | sort > /tmp/routes.txt
grep -oE '`/api/[^`]+`' README.md | tr -d '`' | sed 's|(+||; s|)||' | sort -u > /tmp/readme.txt
wc -l /tmp/routes.txt
```

Expected: 32 routes in the tree; every one of them appears in the README's table, by path or as the `(+/:x)` suffix or the `/api/wallet · …` row. Paste the two lists' diff into the report (the only acceptable differences are the `(+/:x)` and `·` groupings).

- [ ] **Step 3: Commit (controller)**

```
docs: README describes the app as it is — worldwide, four workflows, every route
```

---

### Task 7: `docs/PLAN.md` — where things stand and what is open

**Files:**
- Modify: `docs/PLAN.md` (replace the whole file)

**Derivation:** `gh pr list --state merged --limit 40 --json number,title,mergedAt --jq '.[] | "\(.number)\t\(.mergedAt[:10])\t\(.title)"'`; licences from `data/*-report.md` lines 3–5; the Wikivoyage figures from `docs/superpowers/specs/2026-08-27-wikivoyage-extraction-design.md` §9.

- [ ] **Step 1: Write the new file**

````markdown
# Architecture & Roadmap

*Status page, rewritten 2026-09-07. The design record is
`docs/superpowers/specs/` — one dated design per piece of work, each with a
status line; this page says where things stand and what is open.*

## Where things stand

Thirty pull requests, all rebase-merged, `main` linear. The ones that changed
what the app is:

| Merged | PR | What landed |
|---|---|---|
| 2026-08-12 | #1 | Trip briefing — a shareable read-only trip document |
| 2026-08-15 | #2 | Today & Money tabs — expenses, balances, journal, live trip dashboard |
| 2026-08-15 | #3 | Accounts — email+password auth, server-resolved trip identity |
| 2026-08-15 | #5 | Compulsory login, app shell, trips-first homepage |
| 2026-08-20 | #6 | The planner redesign — seven trip tabs to four, groundwork for all countries |
| 2026-08-21 | #7, #11 | Cleanup; currency — zero-decimal support, live rates, per-trip pivot |
| 2026-08-22 | #16 | Worldwide airports — daily-refreshed dataset, airport-pair routing, flight autocomplete |
| 2026-08-23 | #17 | An orthographic globe as the world-level country picker |
| 2026-08-27 | #21 | The planner works outside China — worldwide city catalog and country guidance |
| 2026-09-02 | #22 | Country and province maps for every country; China standardised; first e2e tests |
| 2026-09-02 | #23 | A trip loads in one round-trip instead of eight |
| 2026-09-03 | #24, #25 | Nightly refresh unbroken (Bosnia's second dinar); functions run in bom1 beside the database |
| 2026-09-03 | #26 | Trip gateways — fly-in and fly-out airports on every trip |
| 2026-09-04 | #27 | Worldwide climate normals (CHELSA) as per-country shards |
| 2026-09-05 | #28 | Climate in the UI — fit colours worldwide, legend, honesty note |
| 2026-09-05 | #29 | The destinations step opens on the globe; drag direction fixed |
| 2026-09-06 | #30 | Backlog clearance — trusted origins, version-guarded writes, server-only guard, splits |

Phases 1–4 of the global-expansion roadmap
(`docs/superpowers/specs/2026-08-23-global-expansion-design.md`) are complete.

## How the planner core works

```
┌──────────────────────────────────────────────────────────────┐
│  app/plan/page.tsx — 3-step wizard (client state)             │
│                                                              │
│  Step 1 DestinationStep      Step 2 DetailsStep              │
│  · globe → country → province · month, days, travellers       │
│  · curated cards, catalog and   · interests                   │
│    GeoNames search                                            │
│  · mark "already been"                                        │
│              │                        │                       │
│              └──────────┬─────────────┘                       │
│                         ▼                                     │
│  Step 3 PlanStep                                              │
│  · buildItinerary(input, destinations)                        │
│  · buildPackingList(input, destinations)                      │
│  · create a shared trip → /trip/[id]                          │
└──────────────────────────────────────────────────────────────┘
   lib/data (16 curated)  ·  data/catalog.json (695 Chinese cities)
   public/cities/<CC>.json (GeoNames, 246 countries)  ·  lib/countryFacts (Wikidata)
```

### The itinerary engine (`lib/itinerary.ts`)

1. **Cap & allocate** — never more cities than days; days split proportionally
   to each destination's suggested stay (min 1 day each).
2. **Score activities** — interest overlap ×3, must-see +2.5, in-season +1,
   wrong season = excluded, kid-friendly boost when kids travel. Seasons are
   the country's own — southern hemisphere included.
3. **Fill slots** — each day has morning/afternoon/evening; full-day activities
   consume both day slots; day 1 starts with arrival, city changes start with a
   transfer block estimated from real airport pairs (and rail where the
   country has it), the last day ends with departure; unused slots become
   labelled free time.
4. **Tips** — the country's facts rendered as sentences (currency, plugs,
   emergency numbers, …), a gap note for what no source supplies, and China's
   hand-written tips for China.

### Shared trips

Trips live in Postgres on Vercel (Supabase, functions pinned to the same
region) and SQLite locally; `/trip/[id]` polls every 4 s while visible. Every
whole-object write is version-guarded (read, apply, write-if-unchanged, retry
three times, then 409). Accounts are Better Auth email+password; a join code is
a view-only key. Details and history: `README.md` and
`docs/superpowers/specs/2026-08-15-accounts-auth-design.md`.

## The data pipeline

| Artifact | Source | Licence | Refreshed by |
|---|---|---|---|
| `data/airports.json` (4,133 airports) | OurAirports | public domain | `Refresh airports`, daily |
| `public/cities/<CC>.json` (58,759 cities, 246 countries) + `data/cities-index.json` | GeoNames cities500 | CC BY 4.0 — credit rendered, contract-tested | `Refresh cities`, daily |
| `public/cities/enrich/<CC>.json` | Wikidata + Wikipedia summaries | CC0 + CC BY-SA | `Refresh cities`, daily |
| `data/country-facts.json` | Wikidata | CC0 | `Refresh cities`, daily |
| `public/climate/<CC>.json` (58,757 rows × 60 ints) | CHELSA V2.1 1981–2010 | CC0 | `Refresh climate`, by hand |
| `public/provinces/<CC>.json`, `country-projections.json`, `world-globe.json`, `world-countries.json` | Natural Earth via `scripts/build-*.mjs` | public domain | when the geometry changes |
| `data/catalog.json` (695 Chinese cities + attractions) | Wikidata + Wikipedia | CC0 + CC BY-SA | `node scripts/ingest-destinations.mjs`, by hand |

Each workflow's header comment records its own gates and why it commits only
on change; each artifact has a `data/*-report.md` beside it.

**Never**: scrape Dianping/Mafengwo/Xiaohongshu (robots.txt-blocked, hostile
anti-bot tech, and litigated under China's Anti-Unfair Competition Law), or
build on unofficial 12306 endpoints. See `RESEARCH.md`.

## What is open

Nothing is scheduled. Two things are designed or named, and both are the
owner's call:

- **Content parity with China.** Outside China a country has facts, tips and a
  climate verdict but no curated cards, foods or hero image. The one designed
  step is the Wikivoyage extraction
  (`docs/superpowers/specs/2026-08-27-wikivoyage-extraction-design.md`,
  2026-08-27, tasks 33–44, not built). Its own conclusion: of 17,093 candidate
  sentences 7.7% pass a structural gate and 28% of those are still defective,
  so it ships nothing without a one-time hand review of ~1,321 sentences
  (about an hour), yields three or four extra sentences for a typical country,
  and leaves the CC BY-SA share-alike question open.
- **Phase 5, flight data.** Deliberately unspecified: there is no free,
  daily-refreshable schedule or fare feed, and Phase 1's real airport-pair
  estimates already deliver most of the practical value. It gets a brainstorm
  before a plan, and the first decision is scope — routes, schedules or live
  prices.

Everything smaller that was left after Phase 4 was closed by PR #30
(2026-09-06) and the two PRs of
`docs/superpowers/specs/2026-09-07-unscheduled-items-design.md`.
````

- [ ] **Step 2: Check the numbers**

Run: `node -e 'console.log(JSON.parse(require("fs").readFileSync("data/airports.json","utf8")).length)'` (4133), `grep -m1 "cities across" data/cities-report.md` (58759 / 246), `grep -m1 -E "^\*\*[0-9,]+ rows" data/climate-report.md || grep -m2 -i "rows" data/climate-report.md` (58,757 rows). Correct any figure the report disagrees with, and say so in the report.

- [ ] **Step 3: Commit (controller)**

```
docs: PLAN.md is a status page — what shipped, the pipeline, what is open
```

---

### Task 8: Spec status lines

**Files:**
- Modify: eleven files under `docs/superpowers/specs/` — line 4 of each unless noted. Use the Edit tool with the exact old text.

- [ ] **Step 1: Apply these replacements**

| File | Old (line 4) | New |
|---|---|---|
| `2026-08-10-itinerary-editing-tickets-design.md` | `**Status:** Approved by user (chat), implementing` | `**Status:** shipped 2026-08-10, before the repository had pull requests` |
| `2026-08-11-trip-wallet-sync-design.md` | `**Status:** Approved by user (chat), implementing` | `**Status:** shipped 2026-08-11, before the repository had pull requests` |
| `2026-08-12-trip-briefing-design.md` | `**Status:** Approved by user (chat), implementing` | `**Status:** shipped — PR #1, merged 2026-08-12` |
| `2026-08-15-accounts-auth-design.md` | `**Status:** Approved by user (chat), spec under review` | `**Status:** shipped — PR #3, merged 2026-08-15` |
| `2026-08-15-trip-tracker-money-design.md` | `**Status:** Approved by user (chat), spec under review` | `**Status:** shipped — PR #2, merged 2026-08-15` |
| `2026-08-17-planner-redesign-design.md` | `**Status:** Approved for planning` | `**Status:** shipped — PRs #6, #7 and #11, merged 2026-08-20 and 2026-08-21` |
| `2026-08-18-day-builder-invariants.md` | `**Status:** input to PR2 Tasks 22-25. Produced by a five-lens analysis (reflow` | `**Status:** consumed — input to PR #6 Tasks 22–25, merged 2026-08-20. Produced by a five-lens analysis (reflow` (the line continues unchanged) |
| `2026-08-23-global-expansion-design.md` | `**Status:** design, awaiting review` | `**Status:** Phases 1–4 shipped — PRs #16, #17, #21, #22, #26, #27, #28, merged 2026-08-22 to 2026-09-05; Phase 5 unspecified by design` |
| `2026-08-25-worldwide-city-catalog-design.md` | `**Status:** design, awaiting review` | `**Status:** shipped — PR #21, merged 2026-08-27` |
| `2026-08-29-phase4-country-region-levels-design.md` | `**Status:** design, awaiting review` | `**Status:** shipped — PRs #22, #26, #27, #28, merged 2026-09-02 to 2026-09-05` |
| `2026-08-27-country-guidance-design.md` | (no status line; line 3 is the italic *Branch `feat/worldwide-cities`…* line) | insert after line 3: `**Status:** shipped — PR #21, merged 2026-08-27` |
| `2026-08-27-wikivoyage-extraction-design.md` | (no status line; line 3 is the italic *Branch…* line) | insert after line 3: `**Status:** designed, not built — the owner's call; see docs/PLAN.md` |

- [ ] **Step 2: Verify**

Run: `grep -n "^\*\*Status" docs/superpowers/specs/*.md`
Expected: 13 lines (the eleven above, `2026-09-06-backlog-clearance-design.md`'s "approved by the owner's instruction…" unchanged, and `2026-09-07-unscheduled-items-design.md`'s), none saying "awaiting review", "implementing" or "under review".

- [ ] **Step 3: Commit (controller)**

```
docs: every spec's status line says what shipped it
```

---

### Task 9 (controller): gates, glance, PR, memory

- [ ] **Step 1: Full gates on the branch**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npm test 2>&1 | tail -8
npx playwright test 2>&1 | tail -4
npx next build 2>&1 | tail -5
git checkout -- next-env.d.ts 2>/dev/null; git status --short
```

Expected: `TSC-CLEAN`; unit `141 files`, `2,667 + 6 + 2 + 3 + 1 = 2,679 passed`, 1 expected fail; Playwright `22 passed`; build green; `git status` clean except intended files.

- [ ] **Step 2: Browser glance (map surfaces changed in Task 4)**

```bash
npx playwright test -c .superpowers/sdd/glance/glance.config.ts
```

Look at the screenshots it writes to the scratchpad at desktop and Pixel 5 widths: the globe opens with no country map; China's map opens from the A–Z list and draws its units and markers; the legend and note sit under the map. Record "glance N/N" in the ledger.

- [ ] **Step 3: Push, open the PR, watch CI**

```bash
git push -u origin chore/unscheduled-items
gh pr create --title "chore: the four items left after PR #30 — trip-derived ticket examples, no prefetch on the globe, current docs" --body-file <the PR body: spec sections 1, 3, 4, what was verified, the two owner-only checks below, ending with the generated-with line>
gh run watch
```

The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and names the two things only the owner can verify: the Kit tab's placeholders on a live trip of their own, and that the globe now loads with no country requests in the browser's network tab.

- [ ] **Step 4: Memory**

Update `china-itinerary-planner-project.md` (v31): PR 1 of the 2026-09-07 spec, what it changed, what PR 2 will do, the 90.8 KB figure, and that the README/PLAN.md are now the current docs. Merge is the owner's call.

---

## PR 2 — `chore/split-oversized-files`

Starts from `main` **after PR 1 merges** (the repository rebase-merges; a stacked branch would be a rebase waiting to happen).

### Task 10 (controller): branch and baseline

- [ ] **Step 1: Branch**

```bash
git fetch origin --prune && git switch main && git merge --ff-only origin/main
git switch -c chore/split-oversized-files
npx tsc --noEmit && echo TSC-CLEAN && npm test 2>&1 | tail -8
```

Record the unit count (expected 141 files / 2,679 passed / 1 expected fail after PR 1) in the ledger under a "PR 2 baseline" line; the move rule is that this count does not change through Tasks 11–17.

- [ ] **Step 2: Per-file test counts, for the move rule**

```bash
for f in scripts/ingest-climate.test.ts scripts/ingest-cities.test.ts scripts/enrich-cities.test.ts scripts/ingest-country-facts.test.ts; do echo "$f: $(npx vitest run --project node "$f" 2>&1 | grep -E '^\s+Tests' )"; done
npx vitest run --project jsdom components/map/CountryLevel.test.tsx 2>&1 | grep -E '^\s+Tests'
```

Write the five numbers into the ledger. Each split task ends by matching its number.

---

### The cut helpers (used by Tasks 11–17)

Every extraction below uses these two shell functions, pasted at the start of each Bash session that cuts. They anchor on content; `tr -d '\r'` makes them work on the CRLF checkout without changing the file.

```bash
# Line number of the banner line `// <title>` (the middle line of a three-line section banner).
title() { tr -d '\r' < "$2" | grep -n -x -F -- "// $1" | head -1 | cut -d: -f1; }
# Line number of the last blank line above the first line matching the anchored regex $1
# (a declaration such as '^export function paintedAt'); that blank line precedes the declaration's docblock.
above() { tr -d '\r' < "$2" | awk -v pat="$1" '$0 ~ pat && !done { print last; done = 1 } /^$/ { last = NR }'; }
# A banner section runs from the dash line above its title to the line before the blank line above the next banner.
# section FILE FROM_TITLE TO_TITLE  -> prints "start end"
section() { local s e; s=$(( $(title "$2" "$1") - 1 )); e=$(( $(title "$3" "$1") - 2 )); echo "$s $e"; }
# cut FILE START END OUT  -> appends lines START..END of FILE to OUT, then deletes them from FILE
cut_lines() { sed -n "$2,$3p" "$1" >> "$4"; sed -i "$2,$3d" "$1"; }
```

Check an anchor before every cut: `sed -n "$(title 'Report' scripts/ingest-climate.mjs)p" scripts/ingest-climate.mjs` must print `// Report`. If a helper prints nothing, stop and report — the anchor moved.

After the moves in each task, derive the imports mechanically rather than by reading:

```bash
# Names used but not defined in a module: TS2304 "Cannot find name", TS2552 "Did you mean".
npx tsc --noEmit --allowJs --checkJs --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --types node <files…> 2>&1 | grep -E "TS2304|TS2552"
```

On 434220a this prints nothing for the four scripts as they are (measured); after a cut it prints one line per missing import. For each name: `export` it from the module that now defines it (adding `export` is allowed by the move rule), and import it where it is used. Circular imports between two modules' top-level `const`s throw `ReferenceError` on import — the dry-import step catches that.

---

### Task 11: Split `scripts/ingest-climate.mjs` (1,630 lines) and its test

**Files:**
- Create: `scripts/climate/sample.mjs`, `scripts/climate/acquire.mjs`, `scripts/climate/raster.mjs`, `scripts/climate/gate.mjs`, `scripts/climate/payload.mjs`, `scripts/climate/report.mjs`
- Create: `scripts/climate/sample.test.ts`, `scripts/climate/acquire.test.ts`, `scripts/climate/raster.test.ts`, `scripts/climate/gate.test.ts`, `scripts/climate/payload.test.ts`, `scripts/climate/report.test.ts`
- Modify: `scripts/ingest-climate.mjs` (keeps lines 1–76 header + imports, and the `// Entry point` section: `sampleAll`, `assertSampleHealth`, `buildShards`, `main`, the guard)
- Modify: `scripts/ingest-climate.test.ts` (keeps the `assertSampleHealth` describe and the file's own preamble)
- Modify: `scripts/sample-climate-anchors.mjs:34` (`import { decodeSample, pixelFor, tupleFor } from './ingest-climate.mjs';` → `'./climate/sample.mjs'`)
- Modify: `.github/workflows/refresh-climate.yml:33` (prose: "scripts/ingest-climate.mjs's assertCityParity" → "scripts/climate/gate.mjs's assertCityParity")

**Interfaces:**
- Produces (module → exports the tests and the entry import): `sample.mjs`: `pixelFor`, `decodeSample`, `tupleFor` + the constants the others need (`MONTHS_PER_YEAR`, `SAMPLE_FIELDS`, `BLOCKS`, `TUPLE_LENGTH`, `BLOCK_META`, exported as tsc demands); `acquire.mjs`: `ensureRaster`, `readScaling`, `readGeometry`, `readCatalog`, the paths and `SOURCE` constants (exported as demanded); `raster.mjs`: `bucketByRow`, `sampleRaster`, `assembleRows`; `gate.mjs`: `assertShardCoverage`, `assertCityParity`, `assertRowShape`, `assertBudget`; `payload.mjs`: `climatePayload`, `indexPayload`, `writeFileAtomic`, `readPrevious`; `report.mjs`: `measuredRanges`, `buildReport` (exported now — the entry calls it).

Section map (title → module), today's title lines: Constants 78, pixelFor 136, decodeSample 217, tupleFor 266 → `sample.mjs`; Paths, and the source 382, The catalog 435, Acquisition 473, Tags 592 → `acquire.mjs`; Sampling 698, Assembly 823 → `raster.mjs`; Gates 854 → `gate.mjs`; Payloads 990, Writing 1051 → `payload.mjs`; Report 1092 → `report.mjs`; Entry point 1364 → stays.

- [ ] **Step 1: Create the directory and cut the six modules, last section first**

```bash
mkdir -p scripts/climate
f=scripts/ingest-climate.mjs
sed -n "$(title 'Report' $f)p" $f                     # must print: // Report
read s e < <(section $f "Report" "Entry point");        cut_lines $f $s $e scripts/climate/report.body
read s e < <(section $f "Payloads" "Report");           cut_lines $f $s $e scripts/climate/payload.body
read s e < <(section $f "Gates" "Payloads");            cut_lines $f $s $e scripts/climate/gate.body
read s e < <(section $f "Sampling" "Gates");            cut_lines $f $s $e scripts/climate/raster.body
read s e < <(section $f "Paths, and the source" "Sampling"); cut_lines $f $s $e scripts/climate/acquire.body
read s e < <(section $f "Constants" "Paths, and the source"); cut_lines $f $s $e scripts/climate/sample.body
wc -l $f scripts/climate/*.body
```

Expected: the entry is now the header (lines 1–76 today: the docblock and the `import` lines) followed directly by the `// Entry point` banner — about 345 lines; the six bodies are about 305, 315, 155, 135, 100 and 270 lines. (Each `section` call recomputes its anchors after the previous cut, which is why the order is bottom-up but any order would work.)

- [ ] **Step 2: Give each module its header and turn the bodies into modules**

For each `X.body`, create `scripts/climate/X.mjs` with the Write tool: a header docblock, the imports, then the body verbatim (read `X.body` and paste; delete the `.body` file). The header for every module is the same shape:

```js
/**
 * ingest-climate — <section names>.
 *
 * Moved verbatim out of scripts/ingest-climate.mjs on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) so that file stays under the 800-line
 * guidance; every docblock below is that file's, and the build it describes
 * is unchanged. The entry point — `main`, the run guard — is still
 * scripts/ingest-climate.mjs.
 */
```

Move the `import` lines of the entry's header (lines 1–76 today) to the modules that use them: `geotiff`'s `fromFile` and `node:fs`/`node:path`/`node:os`/`node:stream` helpers go where they are called; `import { GZIP_BUDGET, RAW_TRIPWIRE } from './build-provinces.mjs';` becomes `'../build-provinces.mjs'` in `gate.mjs`; the entry keeps only what `main` uses. `import.meta.url`-relative paths (`REPO_ROOT`, `CITY_DIR`, `OUT_DIR`, `REPORT_PATH`, `CACHE_DIR`) live in `acquire.mjs` — the "Paths, and the source" section — and are computed as `join(dirname(fileURLToPath(import.meta.url)), '..', '..')` there (one level deeper than before: this is the one line whose text changes, and it is a path, not a body). `main` imports them from `acquire.mjs`.

- [ ] **Step 3: Derive the imports**

```bash
npx tsc --noEmit --allowJs --checkJs --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck --types node scripts/ingest-climate.mjs scripts/climate/*.mjs 2>&1 | grep -E "TS2304|TS2552"
```

For every `Cannot find name 'X'`: add `export` to X's declaration in the module that holds it, and an `import { X } from './<module>.mjs'` (or `'./climate/<module>.mjs'` in the entry) where it is used. Repeat until the command prints nothing. Then:

```bash
for m in scripts/ingest-climate.mjs scripts/climate/*.mjs; do node --check "$m" && echo "syntax ok $m"; done
for m in scripts/climate/*.mjs; do node -e "import('./$m').then(() => console.log('imports ok $m'))"; done
node -e "import('./scripts/ingest-climate.mjs').then(() => console.log('entry imports ok (the guard kept main() from running)'))"
```

Expected: every line `ok`; no `ReferenceError` (a top-level cycle). `buildReport` must now be `export`ed from `report.mjs` — the entry calls it.

- [ ] **Step 4: Split the test along its describes**

`scripts/ingest-climate.test.ts` (1,064 lines, 16 describes). Move each `describe` block, with the fixtures and helper functions it uses (the file declares some of its imports and fixtures mid-file — at lines 351–365, 696 and 918–921 today — take them with the describes that need them), into the file named for the module whose export the describe calls, importing from that module:

| Describes | New file |
|---|---|
| `pixelFor`, `decodeSample`, `tupleFor` | `scripts/climate/sample.test.ts` |
| `bucketByRow`, `assembleRows` | `scripts/climate/raster.test.ts` |
| `climatePayload`, `indexPayload` | `scripts/climate/payload.test.ts` |
| `assertShardCoverage`, `assertCityParity`, `assertRowShape`, `assertRowShape vs parseClimateShard`, `assertBudget` | `scripts/climate/gate.test.ts` |
| `measuredRanges` | `scripts/climate/report.test.ts` |
| `readScaling`, `ensureRaster` | `scripts/climate/acquire.test.ts` |
| `assertSampleHealth` | stays in `scripts/ingest-climate.test.ts`, importing from `./ingest-climate.mjs` |

Test bodies are byte-identical; only the `import … from` lines change. `import { parseClimateShard } from "../lib/climateShard"` becomes `"../../lib/climateShard"` one directory down; `"./build-provinces.mjs"` becomes `"../build-provinces.mjs"`.

- [ ] **Step 5: Run and count**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project node scripts/ingest-climate.test.ts scripts/climate/ 2>&1 | grep -E "Test Files|Tests"
wc -l scripts/ingest-climate.mjs scripts/climate/*.mjs scripts/ingest-climate.test.ts scripts/climate/*.test.ts
```

Expected: `TSC-CLEAN` (a describe that lost a fixture fails here); the `Tests` total equals the Task 10 number for this file; every `wc -l` line under 800.

- [ ] **Step 6: The two importers and the workflow sentence**

`scripts/sample-climate-anchors.mjs:34` → `from './climate/sample.mjs'`; run `node --check scripts/sample-climate-anchors.mjs`. `.github/workflows/refresh-climate.yml:33`: `scripts/ingest-climate.mjs's assertCityParity` → `scripts/climate/gate.mjs's assertCityParity`. Lines 84 and 145 of that workflow ("scripts/ingest-climate.mjs imports `geotiff`", "Read by scripts/ingest-climate.mjs itself") stay true — the entry still runs the build that imports geotiff through `acquire.mjs`, and `CIP_CHELSA_CACHE` is still read by the build; rewrite line 84 to "scripts/ingest-climate.mjs (through scripts/climate/acquire.mjs) imports `geotiff`" only if you judge the reader would otherwise grep the wrong file.

- [ ] **Step 7: Commit (controller)**

```
refactor: split ingest-climate.mjs into scripts/climate/ along its section banners
```

---

### Task 12: Split `scripts/ingest-cities.mjs` (1,185 lines), its test, and move the report contract's path

**Files:**
- Create: `scripts/cities/geonames.mjs`, `scripts/cities/build.mjs`, `scripts/cities/gate.mjs`, `scripts/cities/io.mjs`, `scripts/cities/report.mjs` and their `.test.ts` files
- Modify: `scripts/ingest-cities.mjs` (keeps the header, lines 1–71 today, and the `run — the seam…` section: `run`, `main`, the guard)
- Modify: `scripts/ingest-cities.test.ts` (keeps `main()'s ordering` and `run() aborts before any write primitive fires when assertSane rejects the feed`)
- Modify: `lib/contracts.test.ts:7` (`import { buildReport } from "../scripts/ingest-cities.mjs";` → `"../scripts/cities/report.mjs"`) and lines 1145 and 1165 (`"scripts/ingest-cities.mjs"` → `"scripts/cities/report.mjs"` in both path arrays)
- Modify: `.github/workflows/refresh-cities.yml` lines 33–40 (prose naming `shardPayload`/`stampedPayload` in `scripts/ingest-cities.mjs` → `scripts/cities/io.mjs`)

Section map (title lines today): ZIP 73, GeoNames TSV 157 → `geonames.mjs`; Ranking 291, Deduplication against the existing Wikidata catalog 348, Shard construction 395 → `build.mjs`; The build gate 459 → `gate.mjs`; Paths, sources, network 767, Writing 832, Fetching the two network sources 1011 → `io.mjs`; Report 933 → `report.mjs`; `run — the seam between the pure build and its network/filesystem edges` 1029 → stays.

- [ ] **Step 1: Cut**

```bash
mkdir -p scripts/cities
f=scripts/ingest-cities.mjs
RUN='run — the seam between the pure build and its network/filesystem edges'
sed -n "$(title "$RUN" $f)p" $f                                  # must print the run banner
read s e < <(section $f "Fetching the two network sources" "$RUN"); cut_lines $f $s $e scripts/cities/io.body
read s e < <(section $f "Report" "Fetching the two network sources"); cut_lines $f $s $e scripts/cities/report.body
read s e < <(section $f "Paths, sources, network" "Report");       cut_lines $f $s $e scripts/cities/io.body
read s e < <(section $f "The build gate" "Paths, sources, network"); cut_lines $f $s $e scripts/cities/gate.body
read s e < <(section $f "Ranking" "The build gate");               cut_lines $f $s $e scripts/cities/build.body
read s e < <(section $f "ZIP" "Ranking");                          cut_lines $f $s $e scripts/cities/geonames.body
wc -l $f scripts/cities/*.body
```

Note `io.body` receives two cuts (Paths+Writing, then Fetching) — the second append lands below the first, which is the order they had.

- [ ] **Step 2: Modules, headers, imports** — as Task 11 Step 2–3, with the header naming `ingest-cities` and the sections; `ROOT_DIR` in `io.mjs` computed with `'..', '..'`; the checkJs loop over `scripts/ingest-cities.mjs scripts/cities/*.mjs` until silent; `node --check` and the dry `import()` of every module and the entry.

- [ ] **Step 3: The report contract follows the code**

`lib/contracts.test.ts`: line 7's import, and the two `for (const path of ["data/cities-report.md", "scripts/ingest-cities.mjs"])` arrays (lines 1145, 1165) → `"scripts/cities/report.mjs"`. The contract asserts the generator's source names `GeoNamesCredit` and does not say "NOT YET RENDERED IN THE UI"; both sentences are in `buildReport`, which now lives there. Run `npx vitest run --project node lib/contracts.test.ts` — green.

- [ ] **Step 4: Split the test**

| Describes | New file |
|---|---|
| `readZipMember`, `parseGeoNamesRows`, `parseAdmin1Codes` | `scripts/cities/geonames.test.ts` |
| `cityScore`, `topPerCountry`, `dropCatalogDuplicates`, `buildCities`, `buildCities — the nine-field record` | `scripts/cities/build.test.ts` |
| `assertSane`, `assertSane — the a1c gate`, `assertAdmin1Sane` | `scripts/cities/gate.test.ts` |
| `shardPayload`, `stampedPayload`, `staleShardFiles — the sweep that runs after every shard has been written` | `scripts/cities/io.test.ts` |
| `main()'s ordering`, `run() aborts before any write primitive fires when assertSane rejects the feed` | stay in `scripts/ingest-cities.test.ts` |

- [ ] **Step 5: Run and count**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project node scripts/ingest-cities.test.ts scripts/cities/ lib/contracts.test.ts 2>&1 | grep -E "Test Files|Tests"
wc -l scripts/ingest-cities.mjs scripts/cities/*.mjs scripts/ingest-cities.test.ts scripts/cities/*.test.ts
```

Expected: the cities `Tests` total equals Task 10's; contracts green; every file under 800.

- [ ] **Step 6: Workflow prose** — `refresh-cities.yml` lines 33–40: "`scripts/ingest-cities.mjs` preserves the previous `generatedAt` … via `shardPayload` … via `stampedPayload`" — change the file named to `scripts/cities/io.mjs` where the sentence names the function's home; leave "`scripts/ingest-country-facts.mjs` uses the same `stampedPayload` idiom" for Task 14.

- [ ] **Step 7: Commit (controller)**

```
refactor: split ingest-cities.mjs into scripts/cities/, and point the report contract at its new home
```

---

### Task 13: Split `scripts/enrich-cities.mjs` (866 lines) and its test

**Files:**
- Create: `scripts/enrich/plan.mjs`, `scripts/enrich/io.mjs`, `scripts/enrich/plan.test.ts`, `scripts/enrich/io.test.ts`
- Modify: `scripts/enrich-cities.mjs` (keeps lines 1–227 — the header essay "WHY THERE ARE FIVE GATES AND NOT TWO" — and the `run — the seam between the pure plan and its network/filesystem edges` section)
- Modify: `scripts/enrich-cities.test.ts` (keeps `run() — the wipe path the guards must close`)

Section map: Pure 228 → `plan.mjs`; Network 491, Writing 592 → `io.mjs`; run 634 → stays. The path constants (`ROOT_DIR`, `TARGETS_PATH`, `ENRICH_DIR`, lines 78–80) and the rate/endpoint constants (82–225) sit in the header section today, above the `Pure` banner; they stay in the entry and are passed as parameters where `io.mjs` needs them (`fetchWithRetry`, `fetchExtracts`, `writeFileAtomic`, `readJson` already take what they read as arguments — check with the checkJs step; a constant only `io.mjs` reads may move there, exported).

- [ ] **Step 1: Cut**

```bash
mkdir -p scripts/enrich
f=scripts/enrich-cities.mjs
RUN='run — the seam between the pure plan and its network/filesystem edges'
read s e < <(section $f "Network" "$RUN");  cut_lines $f $s $e scripts/enrich/io.body
read s e < <(section $f "Pure" "Network");  cut_lines $f $s $e scripts/enrich/plan.body
wc -l $f scripts/enrich/*.body
```

- [ ] **Step 2: Modules, headers, imports** — as Task 11 Steps 2–3 over `scripts/enrich-cities.mjs scripts/enrich/*.mjs`.

- [ ] **Step 3: Split the test**

| Describes | New file |
|---|---|
| `buildEnrichmentQuery`, `readEnrichmentBindings`, `toThumbnailUrl`, `mergeEnrichment`, `assertEnrichmentSane`, `firstSentences`, `planCountry — the scope-narrowing guard`, `isBatchAnswerPlausible`, `assertEnrichmentSane's floor`, `assertCountryCoverageSane`, `assertExtractQualitySane` | `scripts/enrich/plan.test.ts` |
| `a SPARQL 404` (drives `fetchSparqlBindings`) | `scripts/enrich/io.test.ts` |
| `run() — the wipe path the guards must close` | stays in `scripts/enrich-cities.test.ts` |

- [ ] **Step 4: Run and count**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project node scripts/enrich-cities.test.ts scripts/enrich/ 2>&1 | grep -E "Test Files|Tests"
wc -l scripts/enrich-cities.mjs scripts/enrich/*.mjs scripts/enrich-cities.test.ts scripts/enrich/*.test.ts
```

Expected: the enrich `Tests` total equals Task 10's; every file under 800 (the entry keeps its 227-line essay and ends near 460).

- [ ] **Step 5: Commit (controller)**

```
refactor: split enrich-cities.mjs into scripts/enrich/ along its pure/network seam
```

---

### Task 14: Split `scripts/ingest-country-facts.mjs` (2,804 lines) and its test (2,973 lines)

**Files:**
- Create: `scripts/country-facts/parse.mjs`, `picks.mjs`, `curated.mjs`, `facts.mjs`, `gate.mjs`, `io.mjs`, `report.mjs` and their `.test.ts` files (seven modules; `curated.test.ts` holds the `CURATED_FACTS` describe)
- Modify: `scripts/ingest-country-facts.mjs` (keeps lines 1–133 header and the `run — the seam…` section)
- Modify: `scripts/ingest-country-facts.test.ts` (keeps the three `run()` describes)
- Modify: `.github/workflows/refresh-cities.yml:29,40` (prose naming `MAX_RETRY_AFTER_MS` and `stampedPayload` in the script → `scripts/country-facts/io.mjs`)

Section map (title lines today): Pure parse 135 → `parse.mjs`; Pure build 244 → `picks.mjs` (244 to just above `FACT_FIELDS`), `curated.mjs` (`CURATED_FACTS`, 957–1101), `facts.mjs` (the rest of Pure build); The build gate 1211 → `gate.mjs`; Paths, sources, network 1848 + Writing 2077 + Fetching the property queries 2378 → `io.mjs`; Report 2148 → `report.mjs`; run 2653 → stays.

- [ ] **Step 1: Cut — the inner blocks of Pure build first, then the banner sections**

```bash
mkdir -p scripts/country-facts
f=scripts/ingest-country-facts.mjs
RUN='run — the seam between the pure build and its network/filesystem edges'
# 1. CURATED_FACTS: from the blank line above its docblock to the blank line above applyCurated's docblock.
s=$(( $(above '^export const CURATED_FACTS' $f) + 1 )); e=$(above '^export function applyCurated' $f)
sed -n "${s}p" $f | head -c 3                                    # must print "/**" — the start of CURATED_FACTS's docblock
cut_lines $f $s $e scripts/country-facts/curated.body
# 2. The rest of Pure build from FACT_FIELDS's docblock to the build gate -> facts.
s=$(( $(above '^export const FACT_FIELDS' $f) + 1 )); e=$(( $(title 'The build gate' $f) - 2 ))
cut_lines $f $s $e scripts/country-facts/facts.body
# 3. What remains of Pure build is the tables and the pick* functions -> picks.
read s e < <(section $f "Pure build" "The build gate");           cut_lines $f $s $e scripts/country-facts/picks.body
# 4. The banner sections.
read s e < <(section $f "Fetching the property queries" "$RUN");  cut_lines $f $s $e scripts/country-facts/io.body
read s e < <(section $f "Report" "Fetching the property queries"); cut_lines $f $s $e scripts/country-facts/report.body
read s e < <(section $f "Paths, sources, network" "Report");       cut_lines $f $s $e scripts/country-facts/io.body
read s e < <(section $f "The build gate" "Paths, sources, network"); cut_lines $f $s $e scripts/country-facts/gate.body
read s e < <(section $f "Pure parse" "Pure build");                cut_lines $f $s $e scripts/country-facts/parse.body
wc -l $f scripts/country-facts/*.body
```

Expected sizes: curated ≈ 150, facts ≈ 330, picks ≈ 485, io ≈ 575 (Paths+Writing above, Fetching below — the order of the two appends puts Fetching first; reorder the two halves in the module so Paths comes first, which is a move of a block inside a new file and touches no body), report ≈ 230, gate ≈ 635, parse ≈ 110; the entry ≈ 290.

- [ ] **Step 2: Modules, headers, imports** — as Task 11 Steps 2–3 over `scripts/ingest-country-facts.mjs scripts/country-facts/*.mjs`. Expect these edges and no others: `facts` imports from `picks` and `curated`; `gate`, `report` and `io` import from `facts` (`PROPERTIES`, `RECORD_FIELDS`, `RENDERED_FIELDS`, …) and `parse`; the entry imports from all seven. A `ReferenceError` on the dry import means a cycle — report it rather than reordering declarations.

- [ ] **Step 3: Split the test (29 describes)**

| Describes | New file |
|---|---|
| `parseCsv`, `parseBindings`, `entityId` | `scripts/country-facts/parse.test.ts` |
| `pickVoltage — landmine 1…`, `pickCurrency — landmine 2…`, `pickPlugs — landmine 3…`, `pickEmergency — landmine 4…`, `pickDrivingSide`, `pickCallingCode`, `pickLanguages`, `pickName`, `pickLatitude` | `scripts/country-facts/picks.test.ts` |
| `buildFacts`, `factCount`, `per-property demotion`, `carryForwardFields` | `scripts/country-facts/facts.test.ts` |
| `CURATED_FACTS` | `scripts/country-facts/curated.test.ts` |
| `parseRetryAfter`, `fetchWithRetry`, `batchCodes`, `buildQuery`, `COUNTRY_CODES`, `stampedPayload` | `scripts/country-facts/io.test.ts` |
| `buildReport` | `scripts/country-facts/report.test.ts` |
| `assertFactsSane`, `the four withhold rules are observably live on a whole feed` | `scripts/country-facts/gate.test.ts` |
| `run() — the positive control`, `run() aborts before any write primitive fires`, `run() aborts when carry-forward would restore a value the rules now refuse` | stay in `scripts/ingest-country-facts.test.ts` |

If a describe in the gate or facts group turns out to call `run`, it stays with the entry's test; say so in the report.

- [ ] **Step 4: Run and count**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project node scripts/ingest-country-facts.test.ts scripts/country-facts/ 2>&1 | grep -E "Test Files|Tests"
wc -l scripts/ingest-country-facts.mjs scripts/country-facts/*.mjs scripts/ingest-country-facts.test.ts scripts/country-facts/*.test.ts
```

Expected: the country-facts `Tests` total equals Task 10's; every file under 800 — `gate.test.ts` is the tight one (≈ 720); if it lands over, move `the four withhold rules…` to `facts.test.ts` (it exercises `buildFacts` with the gate) and say so.

- [ ] **Step 5: Workflow prose** — `refresh-cities.yml:29` "`scripts/ingest-country-facts.mjs` ALSO now waits up to 300s when WDQS asks (`MAX_RETRY_AFTER_MS`)" → name `scripts/country-facts/io.mjs`; line 40's `stampedPayload` sentence likewise.

- [ ] **Step 6: The nightly job's own check, offline**

The `Refresh cities` workflow runs `node scripts/ingest-country-facts.mjs` against Wikidata; do not run it here (429 budget). Instead run the three `run()` describes that stay in the entry's test — they drive `run({ fetchBindings, dataDir })` with an injected fetcher through every module — and confirm they are in the count above.

- [ ] **Step 7: Commit (controller)**

```
refactor: split ingest-country-facts.mjs into scripts/country-facts/ along its section banners
```

---

### Task 15: `CountryLevel.tsx` — the five pure modules

**Files:**
- Create: `components/map/countryView.ts`, `components/map/markerGeometry.ts`, `components/map/useRenderedWidth.ts`, `components/map/useMarkerSelection.ts`, `components/map/markerLayout.ts`
- Modify: `components/map/CountryLevel.tsx` (1,610 lines)
- Modify: `components/map/CountryMap.test.tsx:10` (`import { TAP_MIN_R_FALLBACK } from "./CountryLevel";` → `"./markerGeometry"`)
- Modify: `components/map/CountryLevel.test.tsx` (its import block from `./CountryLevel`: `ADMIN1_MAX_ZOOM_K, buildCountryView, CountryLevel, MAP_MAX_RENDER_W, MIN_FRAMED_EXTENT, paintedAt, TAP_MIN_PX, TAP_MIN_R_FALLBACK, tapTargetRadius` — the names split across the new modules; Task 17 moves the file, so here only the import lines change)
- Modify: `lib/countryFacts.test.ts` lines 917–931 (`MUST_STAY_CHEAP`) and 961 (`toHaveLength(13)`)

**Interfaces (Produces):**
- `countryView.ts`: `interface UnitProps`, `const VIEW_BOX`, `function fromManifest`, `interface UnitShape`, `type UnitFeature`, `export interface CountryView`, `export function buildCountryView(provinces: ProvinceFile, projection: ProjectionEntry | null): CountryView`.
- `markerGeometry.ts`: `export const UNIT_STROKE, OUTLINE_STROKE, MARKER_STROKE, SELECTION_RING, FOCUS_RING, ROUTE_STROKE, AIRPORT_MARK, AIRPORT_STROKE, MIN_FRAMED_EXTENT, ADMIN1_MAX_ZOOM_K, TAP_MIN_PX, MAP_MAX_RENDER_W, TAP_MIN_R_FALLBACK`; `export function tapTargetRadius(renderedWidth: number): number`; `export function paintedAt(point, transform)`; `export function labelFor(place: MapPlace): boolean`; `export function radiusFor(place: MapPlace): number`.
- `useRenderedWidth.ts`: `export function useRenderedWidth(ref: RefObject<HTMLElement | null>): number | null`.
- `useMarkerSelection.ts`: `export interface MarkerInteractionProps`, `export type ReadOnlyMarkerProps`, `export function useMarkerSelection(places, selected, onActivate, interactive): { markerProps; focusedId; refocus }`.
- `markerLayout.ts`: `export type Project = (lon: number, lat: number) => [number, number]`; `export interface Point { x: number; y: number }`; `export interface Mark extends Point { r: number; hitR: number }`; `export interface VisibleEntry { place: MapPlace; index: number }`; `routePath`, `projectPlaces`, `markerMarks`, `markerFills`, `visibleEntries` (signatures in Step 5).

- [ ] **Step 1: `countryView.ts` — cut three blocks**

Blocks today: `UnitProps` (docblock + interface, lines 95–98), `VIEW_BOX` (docblock 100–110 + const 111–114), the view (`fromManifest`'s docblock at 412 through `buildCountryView`'s closing brace at 549, ending before `MarkerInteractionProps`'s docblock).

```bash
f=components/map/CountryLevel.tsx
s=$(( $(above '^function fromManifest' $f) + 1 )); e=$(above '^interface MarkerInteractionProps' $f)
sed -n "${s}p" $f | head -c 3            # "/**"
cut_lines $f $s $e components/map/countryView.body
s=$(( $(above '^const VIEW_BOX' $f) + 1 )); e=$(above '^const UNIT_STROKE' $f)
cut_lines $f $s $e components/map/countryView.body   # appended below the view — reorder in Step 2
s=$(( $(above '^interface UnitProps' $f) + 1 )); e=$(above '^const VIEW_BOX' $f)
cut_lines $f $s $e components/map/countryView.body
```

Note: `above '^const UNIT_STROKE'` finds the blank line above the "Marker geometry" docblock (line 115 today), so the `VIEW_BOX` block ends at 114 as intended.

- [ ] **Step 2: Write `countryView.ts`**

With the Write tool, in this order: header, imports, `UnitProps`, `VIEW_BOX`, then the view block — the three bodies verbatim from `countryView.body` (then delete it). Header and imports:

```ts
import { geoPath, type GeoPath } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, MultiPolygon, Polygon } from "topojson-specification";
import { projectionFor, type ProjectionEntry, type ViewBox } from "@/lib/countryProjection";
import { MAP_VIEW_PAD } from "@/lib/mapView";
import { PROVINCE_OBJECT, type ProvinceFile, type ProvinceUnit } from "@/lib/provinceTopology";
import { unitLabel } from "@/lib/regionScheme";
import { buildFitProjection, makeProjector, MAP_VIEW_H, MAP_VIEW_W, type FittedProjection } from "./mapShared";

/**
 * The country level's view: TopoJSON units and the national outline, fitted
 * to the frame, as `CountryLevel` draws them (spec 2026-08-29 §4.1, §5.4).
 *
 * Pure — one function over a province file and a manifest entry — and moved
 * verbatim out of CountryLevel.tsx on 2026-09-07 so that file stays under the
 * 800-line guidance. Every docblock below is that file's.
 */
```

(No `"use client"`: pure, like `explorerPlaces.ts`.)

- [ ] **Step 3: `markerGeometry.ts` and `useRenderedWidth.ts`**

Four cuts, bottom-up. After Step 1 the view block is gone, so everything between `useRenderedWidth`'s docblock and `MarkerInteractionProps`'s docblock is, in order: the hook, then `paintedAt`, `labelFor` and `radiusFor`. Each cut below ends at the blank line above `MarkerInteractionProps`, because the block that used to follow it has just been cut away.

```bash
f=components/map/CountryLevel.tsx
# paintedAt + labelFor + radiusFor: from paintedAt's docblock to the blank line above MarkerInteractionProps
s=$(( $(above '^export function paintedAt' $f) + 1 )); e=$(above '^interface MarkerInteractionProps' $f)
sed -n "${s}p" $f | head -c 3            # "/**"
cut_lines $f $s $e components/map/markerGeometry.body
# the hook, docblock included — now the last block before MarkerInteractionProps
s=$(( $(above '^function useRenderedWidth' $f) + 1 )); e=$(above '^interface MarkerInteractionProps' $f)
cut_lines $f $s $e components/map/useRenderedWidth.body
# the framing/tap constants: MIN_FRAMED_EXTENT's docblock through TAP_MIN_R_FALLBACK
s=$(( $(above '^export const MIN_FRAMED_EXTENT' $f) + 1 )); e=$(above '^interface MarkerInteractionProps' $f)
cut_lines $f $s $e components/map/markerGeometry.body
# the stroke/ring/airport constants with the "Marker geometry" docblock, up to NO_AIRPORTS's docblock — which stays
s=$(( $(above '^const UNIT_STROKE' $f) + 1 )); e=$(above '^const NO_AIRPORTS' $f)
cut_lines $f $s $e components/map/markerGeometry.body
```

`NO_AIRPORTS` (docblock + `const NO_AIRPORTS: Airport[] = [];`, lines 176–189 today) stays in `CountryLevel.tsx`; after these cuts it sits directly above `MarkerInteractionProps`'s old position, which is fine.

Write `components/map/markerGeometry.ts` (order: header, imports, the strokes block, the framing block, the `paintedAt` block; export every constant and the two helpers — `export` is the one word added):

```ts
import { ZOOM_FILL, type MapTransform } from "@/lib/mapTransform";
import { MAP_VIEW_H, MAP_VIEW_W } from "./mapShared";
import type { MapPlace } from "./mapTypes";

/**
 * The country level's numbers: stroke widths and ring radii in viewBox units
 * at k = 1, the §5.3.2 tap-target radius and its fallback, the framing floor,
 * and the two per-place helpers that size and label a marker. Moved verbatim
 * out of CountryLevel.tsx on 2026-09-07; every docblock below is that file's,
 * and "every stroke, radius and font divides by k" is still pinned by
 * CountryLevel.markers.test.tsx.
 */
```

Write `components/map/useRenderedWidth.ts`:

```ts
"use client";

import { useEffect, useState, type RefObject } from "react";

// (the hook and its docblock, verbatim)
```

with `export` added to `function useRenderedWidth`.

- [ ] **Step 4: `useMarkerSelection.ts`**

```bash
f=components/map/CountryLevel.tsx
s=$(( $(above '^interface MarkerInteractionProps' $f) + 1 )); e=$(above '^export interface CountryLevelProps' $f)
cut_lines $f $s $e components/map/useMarkerSelection.body
```

Write `components/map/useMarkerSelection.ts`: `"use client";`, `import { useRef, useState } from "react";`, `import type { MapPlace } from "./mapTypes";`, a header in the same shape as above, then the body verbatim with `export` added to `interface MarkerInteractionProps`, `type ReadOnlyMarkerProps` and `function useMarkerSelection`.

- [ ] **Step 5: `markerLayout.ts` — the memo bodies as pure functions**

This one is not a cut: the five memo bodies (today lines 995–1131) become functions, and the memos call them. Write `components/map/markerLayout.ts`:

```ts
import type { ProvinceFile } from "@/lib/provinceTopology";
import { FIT_COLORS, fitForPlace, type DerivedClimateIndex, type MapPlace } from "./mapTypes";
import { radiusFor } from "./markerGeometry";

/**
 * The marker layer's arithmetic, as pure functions over the country's places:
 * where each is projected, how large its target may be, what colour it is
 * this month, and which of them a framed map draws. `CountryLevel` memoises
 * each on exactly the inputs named here. Moved out of its `useMemo` bodies on
 * 2026-09-07 with no change to any line of arithmetic; the docblock each
 * memo carried is on its function below.
 */

export type Project = (lon: number, lat: number) => [number, number];
export interface Point { x: number; y: number }
export interface Mark extends Point { r: number; hitR: number }
export interface VisibleEntry { place: MapPlace; index: number }

/** The suggested route's stops, projected, in route order (`routePoints`). */
export function routePath(routeIds: string[], places: MapPlace[], project: Project): [number, number][] {
  return routeIds
    .map((id) => places.find((p) => p.id === id))
    .filter((p): p is MapPlace => Boolean(p))
    .map((p) => project(p.lon, p.lat));
}

/** Every place's projected point, indexed like `places` (`points`). */
export function projectPlaces(places: MapPlace[], project: Project): Point[] {
  return places.map((place) => {
    const [x, y] = project(place.lon, place.lat);
    return { x, y };
  });
}

// (paste the `marks` memo's docblock here, verbatim)
export function markerMarks(points: Point[], caps: number[], places: MapPlace[], tapMinR: number, k: number): Mark[] {
  return points.map((point, index) => {
    const r = radiusFor(places[index]) / k;
    return { ...point, r, hitR: Math.max(r, Math.min(caps[index], tapMinR)) };
  });
}

// (paste the `fills` memo's docblock here, verbatim)
export function markerFills(places: MapPlace[], month: number, climate: DerivedClimateIndex): string[] {
  return places.map((place) => FIT_COLORS[fitForPlace(place, month, climate)]);
}

// (paste the `visible` memo's docblock here, verbatim)
export function visibleEntries(
  places: MapPlace[],
  group: { unitIds: readonly string[] } | null,
  provinces: ProvinceFile
): VisibleEntry[] {
  const all = places.map((place, index) => ({ place, index }));
  if (!group) return all;
  const units = new Set(group.unitIds);
  return all.filter(({ place }) => {
    const unit = provinces.cityProvince.get(place.id);
    return unit !== undefined && units.has(unit);
  });
}
```

In `CountryLevel.tsx` the five memos become (the `caps` memo and its docblock stay as they are):

```ts
  const routePoints = useMemo(() => routePath(routeIds, places, project), [routeIds, places, project]);
  const points = useMemo(() => projectPlaces(places, project), [places, project]);
  // (caps unchanged)
  const marks = useMemo(() => markerMarks(points, caps, places, tapMinR, k), [points, caps, places, tapMinR, k]);
  const fills = useMemo(() => markerFills(places, month, climate), [places, month, climate]);
  const visible = useMemo(() => visibleEntries(places, group, provinces), [group, places, provinces]);
```

Each keeps a one-line comment: `// Policy and arithmetic: markerLayout.ts.` `markerFills` calls `fitForPlace` from `./mapTypes` — the module the fills spy test mocks — so PR #30's "hovering markers does not add calls" test keeps its grip.

- [ ] **Step 6: Imports in `CountryLevel.tsx`, and the two importers**

Add to `CountryLevel.tsx`: `import { buildCountryView } from "./countryView";`, `import { ADMIN1_MAX_ZOOM_K, AIRPORT_MARK, AIRPORT_STROKE, FOCUS_RING, MARKER_STROKE, OUTLINE_STROKE, ROUTE_STROKE, SELECTION_RING, TAP_MIN_R_FALLBACK, tapTargetRadius, labelFor, UNIT_STROKE } from "./markerGeometry";`, `import { useRenderedWidth } from "./useRenderedWidth";`, `import { useMarkerSelection } from "./useMarkerSelection";`, `import { markerFills, markerMarks, projectPlaces, routePath, visibleEntries } from "./markerLayout";`. Remove the imports the moved code took with it (`geoPath`, `feature`/`merge`, the topojson types, `projectionFor`, `MAP_VIEW_PAD`, `PROVINCE_OBJECT`/`ProvinceUnit`, `unitLabel`, `buildFitProjection`/`makeProjector`/`FittedProjection`, `ZOOM_FILL`, `FIT_COLORS`/`fitForPlace`). `npx tsc --noEmit` names every one that is missing or unused-and-flagged.

`components/map/CountryMap.test.tsx:10` → `import { TAP_MIN_R_FALLBACK } from "./markerGeometry";`. In `CountryLevel.test.tsx`'s import block: `CountryLevel` stays from `./CountryLevel`; `buildCountryView` from `./countryView`; `ADMIN1_MAX_ZOOM_K, MAP_MAX_RENDER_W, MIN_FRAMED_EXTENT, paintedAt, TAP_MIN_PX, TAP_MIN_R_FALLBACK, tapTargetRadius` from `./markerGeometry`.

- [ ] **Step 7: The cheapness contract**

`lib/countryFacts.test.ts` `MUST_STAY_CHEAP` (line 917): add, after `"components/map/explorerPlaces.ts"`:

```ts
    "components/map/CountryLevel.tsx",
    "components/map/countryView.ts",
    "components/map/markerGeometry.ts",
    "components/map/useRenderedWidth.ts",
    "components/map/useMarkerSelection.ts",
    "components/map/markerLayout.ts",
```

and `expect(MUST_STAY_CHEAP).toHaveLength(13)` → `toHaveLength(19)` (Task 16 adds the three layers and takes it to 22). `CountryLevel.tsx` itself joins the list now — it was always covered transitively through `MapExplorer.tsx`, and naming it makes the pin explicit for the files split out of it.

- [ ] **Step 8: Run**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project jsdom components/map/ 2>&1 | grep -E "Test Files|Tests"
npx vitest run --project node lib/countryFacts.test.ts lib/contracts.test.ts 2>&1 | grep -E "Test Files|Tests"
wc -l components/map/CountryLevel.tsx components/map/countryView.ts components/map/markerGeometry.ts components/map/useRenderedWidth.ts components/map/useMarkerSelection.ts components/map/markerLayout.ts
```

Expected: `TSC-CLEAN`; the map count equals Task 10's plus nothing (this task adds no tests); both contracts green; `CountryLevel.tsx` about 900 lines (Task 16 finishes it), the five modules about 150, 260, 45, 190 and 90.

- [ ] **Step 9: Commit (controller)**

```
refactor: move CountryLevel's view builder, geometry, selection hook and layout arithmetic into their own modules
```

---

### Task 16: `CountryLevel.tsx` — the three layers

**Files:**
- Create: `components/map/UnitsLayer.tsx`, `components/map/AirportLayer.tsx`, `components/map/MarkerLayer.tsx`
- Modify: `components/map/CountryLevel.tsx` (the `<g data-units>` block and the outline, the `airportMarks` memo and `<g data-airports>`, the `<g data-markers>` block)
- Modify: `lib/countryFacts.test.ts` (`MUST_STAY_CHEAP` + 3, `toHaveLength(22)`)

**Interfaces (Produces):**
- `UnitsLayer({ units, outline, offersRegions, k })` — `units: CountryView["units"]`, `outline: string | null`.
- `AirportLayer({ airports, showAirports, project, k })` — owns the `airportMarks` memo; renders nothing when the list is empty.
- `MarkerLayer({ visible, marks, fills, selected, routeIds, focusedId, k, markerProps, reportHover })`.

- [ ] **Step 1: `UnitsLayer.tsx`**

```tsx
"use client";

import type { CountryView } from "./countryView";
import { OUTLINE_STROKE, UNIT_STROKE } from "./markerGeometry";

/**
 * The admin-1 units and the national border over their seams — the first
 * layer inside `CountryLevel`'s zoom group. Moved verbatim out of
 * CountryLevel.tsx on 2026-09-07; the comments inside are that file's.
 */
export function UnitsLayer({
  units,
  outline,
  offersRegions,
  k,
}: {
  units: CountryView["units"];
  outline: string | null;
  offersRegions: boolean;
  k: number;
}) {
  return (
    <>
      <g data-units="">
        {units.map((unit) => (
          <path
            key={unit.id}
            // (the four comment paragraphs from CountryLevel.tsx, verbatim)
            data-unit={unit.selectable ? unit.id : undefined}
            d={unit.d}
            fill="var(--surf-2)"
            stroke="var(--paper)"
            strokeWidth={UNIT_STROKE / k}
          >
            {offersRegions && unit.selectable && unit.label && <title>{unit.label}</title>}
          </path>
        ))}
      </g>

      {/* The national border, over the seams the units drew. */}
      {outline && (
        <path
          data-outline=""
          d={outline}
          fill="none"
          stroke="var(--ink-2)"
          strokeOpacity={0.55}
          strokeWidth={OUTLINE_STROKE / k}
          className="pointer-events-none"
          aria-hidden
        />
      )}
    </>
  );
}
```

In `CountryLevel.tsx` the two blocks (from `<g data-units="">` through the outline's closing `)}`) become `<UnitsLayer units={units} outline={outline} offersRegions={offersRegions} k={k} />`.

- [ ] **Step 2: `AirportLayer.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { ARRIVABLE_AIRPORT_SIZES, type Airport } from "@/lib/airports";
import { AIRPORT_MARK, AIRPORT_STROKE } from "./markerGeometry";
import type { Project } from "./markerLayout";

/**
 * §10.1's airport layer: decorative diamonds, `aria-hidden` and
 * `pointer-events-none`, beneath the markers. Owns the projection memo that
 * lived in CountryLevel.tsx so the JSX's 700-word rationale lives with the
 * `<g>` it explains. Moved verbatim on 2026-09-07.
 */
export function AirportLayer({
  airports,
  showAirports,
  project,
  k,
}: {
  airports: Airport[];
  showAirports: boolean;
  project: Project;
  k: number;
}) {
  // (the `airportMarks` docblock, verbatim)
  const airportMarks = useMemo(
    () =>
      showAirports
        ? airports
            .filter((airport) => ARRIVABLE_AIRPORT_SIZES.has(airport.size))
            .map((airport) => {
              const [x, y] = project(airport.lon, airport.lat);
              return { iata: airport.iata, x, y };
            })
        : [],
    [showAirports, airports, project]
  );
  if (airportMarks.length === 0) return null;
  return (
    // (the JSX comment block, verbatim)
    <g data-airports="" className="pointer-events-none" aria-hidden>
      {airportMarks.map(({ iata, x, y }) => (
        <rect
          key={iata}
          data-airport={iata}
          x={x - AIRPORT_MARK / k}
          y={y - AIRPORT_MARK / k}
          width={(2 * AIRPORT_MARK) / k}
          height={(2 * AIRPORT_MARK) / k}
          transform={`rotate(45 ${x} ${y})`}
          fill="var(--paper)"
          stroke="var(--ink-2)"
          strokeWidth={AIRPORT_STROKE / k}
        />
      ))}
    </g>
  );
}
```

In `CountryLevel.tsx`: delete the `airportMarks` memo and its docblock; replace `{airportMarks.length > 0 && (<g data-airports …>…</g>)}` with `<AirportLayer airports={airports} showAirports={showAirports} project={project} k={k} />`. `ARRIVABLE_AIRPORT_SIZES` leaves the component's imports.

- [ ] **Step 3: `MarkerLayer.tsx`**

```tsx
"use client";

import { FOCUS_RING, labelFor, MARKER_STROKE, SELECTION_RING } from "./markerGeometry";
import type { Mark, VisibleEntry } from "./markerLayout";
import type { createHoverReporter } from "./mapShared";
import type { MapPlace } from "./mapTypes";
import type { MarkerInteractionProps, ReadOnlyMarkerProps } from "./useMarkerSelection";

/**
 * The markers (§5.3.1): a hit circle first, then the focus and selection
 * rings, the dot, the stop number and the label, per place the framed map
 * draws. Every attribute that made a marker a control comes in through
 * `markerProps`, so `readOnly` is decided in one place. Moved verbatim out of
 * CountryLevel.tsx on 2026-09-07; the comments inside are that file's.
 */
export function MarkerLayer({
  visible,
  marks,
  fills,
  selected,
  routeIds,
  focusedId,
  k,
  markerProps,
  reportHover,
}: {
  visible: VisibleEntry[];
  marks: Mark[];
  fills: string[];
  selected: string[];
  routeIds: string[];
  focusedId: string | null;
  k: number;
  markerProps: (place: MapPlace, order: number) => MarkerInteractionProps | ReadOnlyMarkerProps;
  reportHover: ReturnType<typeof createHoverReporter<MapPlace>>;
}) {
  return (
    <g data-markers="">
      {/* (the `visible` / `index` / `order` comment, verbatim) */}
      {visible.map(({ place, index }, order) => {
        const { x, y, r, hitR } = marks[index];
        const isSelected = selected.includes(place.id);
        const stopIndex = routeIds.indexOf(place.id);
        return (
          <g
            key={place.id}
            data-place={place.id}
            {...markerProps(place, order)}
            onMouseEnter={(e) => reportHover(place, e)}
            onMouseMove={(e) => reportHover(place, e)}
            onMouseLeave={() => reportHover(null)}
          >
            {/* … the hit circle, focus ring, selection ring, dot, stop number and label, verbatim from CountryLevel.tsx … */}
          </g>
        );
      })}
    </g>
  );
}
```

The inner JSX (from `<circle data-hit="" …/>` through the label's `</text>`) is pasted verbatim. In `CountryLevel.tsx` the whole `<g data-markers="">…</g>` becomes:

```tsx
            <MarkerLayer
              visible={visible}
              marks={marks}
              fills={fills}
              selected={selected}
              routeIds={routeIds}
              focusedId={focusedId}
              k={k}
              markerProps={markerProps}
              reportHover={reportHover}
            />
```

`FOCUS_RING`, `SELECTION_RING`, `MARKER_STROKE` and `labelFor` leave the component's imports.

- [ ] **Step 4: Contract, type check, run, measure**

`lib/countryFacts.test.ts`: add `"components/map/UnitsLayer.tsx"`, `"components/map/AirportLayer.tsx"`, `"components/map/MarkerLayer.tsx"` to `MUST_STAY_CHEAP`; `toHaveLength(19)` → `toHaveLength(22)`.

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project jsdom components/map/ 2>&1 | grep -E "Test Files|Tests"
npx vitest run --project node lib/countryFacts.test.ts lib/contracts.test.ts 2>&1 | grep -E "Test Files|Tests"
wc -l components/map/CountryLevel.tsx components/map/UnitsLayer.tsx components/map/AirportLayer.tsx components/map/MarkerLayer.tsx
```

Expected: `TSC-CLEAN`; the map count unchanged from Task 10; contracts green (the layers name no C7 token — `MapPlace` is not one); `CountryLevel.tsx` under 800 (estimated 745). If it is over, report the number and stop: the spec's eight extractions are the design, and the next cut is a design decision, not the implementer's.

- [ ] **Step 5: Commit (controller)**

```
refactor: draw CountryLevel's units, airports and markers from three layer components
```

---

### Task 17: `CountryLevel.test.tsx` — the harness and the five files

**Files:**
- Create: `test/countryLevelHarness.tsx` (from lines 1–328 of the test today: imports, `capCall`, the two `vi.mock`s, `place`, `LIMA`, `CUSCO`, `ISLA`, `KM_PER_DEGREE`, `airportNear`, `BO_FILE`, `PE_ONE_UNIT`, `levelProps`, `renderLevel`, `rings`, `markerX`, `markerY`, `circleFor`, `hitR`, `dotR`, `unitTitles`, `markers`, `airportMarks`, `airportCodes`, `stubRenderedWidth`, and the two top-level `afterEach` calls at lines 233–234+)
- Create: `components/map/CountryLevel.markers.test.tsx`, `components/map/CountryLevel.zoom.test.tsx`, `components/map/CountryLevel.airports.test.tsx`, `components/map/countryView.test.tsx`
- Modify: `components/map/CountryLevel.test.tsx` (keeps `CountryLevel`, `read-only`, `where L3 would be L2`, `derived climate`, `belowMap slot`)

- [ ] **Step 1: The harness**

Create `test/countryLevelHarness.tsx` with the preamble verbatim, with these changes and no others:
- Every relative import becomes an `@/` import (`"./mapShared"` → `"@/components/map/mapShared"`, `"./CountryLevel"` → `"@/components/map/CountryLevel"`, and so on), including the paths **inside the `vi.mock` factories**: `vi.mock("./mapTypes", …)` → `vi.mock("@/components/map/mapTypes", …)`; `vi.mock("@/lib/dragLayer", …)` is already absolute.
- Every fixture, helper and `capCall` gains `export`.
- The top-level `afterEach(cleanup)` and `afterEach(() => { … })` move into `export function installCountryLevelHarness(): void { afterEach(cleanup); afterEach(() => { … }); }`, for the reason `test/mapExplorerHarness.tsx:632` gives: a top-level `afterEach` in an imported module registers against whichever file imported it first.
- A header docblock: what the harness holds, and the import-order rule below.

- [ ] **Step 2: The five test files**

Each begins with exactly this, before any other import:

```tsx
// First, before any import that could reach `./mapTypes` or `@/lib/dragLayer`:
// the harness registers those mocks, and vitest hoists a mock only above the
// imports of the file that declares it.
import { installCountryLevelHarness, /* …the fixtures and helpers this file uses… */ } from "@/test/countryLevelHarness";
```

followed by the `@testing-library/react` and `vitest` imports it needs, the module-under-test imports, then `installCountryLevelHarness();`, then its `describe` blocks verbatim:

| File | describes (today's lines) |
|---|---|
| `CountryLevel.test.tsx` | `CountryLevel` (329), `CountryLevel read-only` (1658), `CountryLevel where L3 would be L2` (1382), `CountryLevel derived climate` (2077), `CountryLevel belowMap slot` (2169) |
| `CountryLevel.markers.test.tsx` | `CountryLevel markers` (432), `CountryLevel zoomed markers` (1465) |
| `CountryLevel.zoom.test.tsx` | `CountryLevel province zoom` (830), `CountryLevel province zoom — the fraction of the frame the unit fills` (1177) |
| `CountryLevel.airports.test.tsx` | `CountryLevel main airport` (1741), `CountryLevel airport layer` (1820), `CountryLevel airport agreement` (2001) |
| `countryView.test.tsx` | `CountryLevel view` (711) — `.test.tsx` because the jsdom project collects only that extension under `components/`; imports `buildCountryView` from `./countryView` |

`npx tsc --noEmit` reports every helper a file uses but did not import from the harness.

- [ ] **Step 3: Run, count, measure**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npx vitest run --project jsdom components/map/CountryLevel components/map/countryView.test.tsx 2>&1 | grep -E "Test Files|Tests"
npx vitest run --project node lib/contracts.test.ts 2>&1 | grep -E "Tests"
wc -l test/countryLevelHarness.tsx components/map/CountryLevel*.test.tsx components/map/countryView.test.tsx
```

Expected: `TSC-CLEAN`; `Test Files 5`, `Tests` equal to Task 10's CountryLevel number; `lib/contracts.test.ts` green — the harness lives under `test/`, outside the roots C7 scans, so its value-import of `CountryLevel` is not a second mount; every file under 800 (the zoom file is the largest, ≈ 560). Then the whole jsdom project once: `npx vitest run --project jsdom 2>&1 | grep -E "Tests"` — the mocks must not leak between files (each file installs the same two, so a leak is invisible; what this catches is a file that forgot the harness and now runs against the real `nonOverlappingRadii`).

- [ ] **Step 4: Commit (controller)**

```
test: split CountryLevel's tests along their describes, with a shared harness under test/
```

---

### Task 18: README layout for the split tree, and the workflow sentences

**Files:**
- Modify: `README.md` (the `## Project layout` block from Task 6)
- Modify: `.github/workflows/refresh-cities.yml`, `.github/workflows/refresh-climate.yml` (the sentences Tasks 11, 12 and 14 named, if any were deferred to here)

- [ ] **Step 1: The layout block**

In `## Project layout`, replace the `components/map/` line and the `scripts/` line:

```
  map/                the globe, the country map (CountryLevel + UnitsLayer/AirportLayer/MarkerLayer, countryView, markerGeometry, markerLayout, useMarkerSelection), the province level, hooks
scripts/              ingest-*.mjs and enrich-cities.mjs (entries) with their modules under scripts/{climate,cities,enrich,country-facts}/; build-*.mjs (geometry); sample-climate-anchors.mjs
```

- [ ] **Step 2: Nothing over 800**

```bash
find app components lib scripts test -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.mjs" \) ! -name "*.test.*" -exec wc -l {} + | sort -rn | awk '$1>800 && $2!="total"'
```

Expected: no output. (Test files: `find … -name "*.test.*"` still lists `contracts`, `countryFacts`, `GlobeLevel`, `countryTips`, `climateShard` over 800 — the five the owner chose to leave; paste the list into the report so the PR body can name them.)

- [ ] **Step 3: Commit (controller)**

```
docs: the README's layout names the split modules
```

---

### Task 19 (controller): gates, glance, PR

- [ ] **Step 1: Full gates**

```bash
npx tsc --noEmit && echo TSC-CLEAN
npm test 2>&1 | tail -8
npx playwright test 2>&1 | tail -4
npx next build 2>&1 | tail -5
for m in scripts/climate scripts/cities scripts/enrich scripts/country-facts; do for f in $m/*.mjs; do node --check "$f" || echo "SYNTAX $f"; done; done
git checkout -- next-env.d.ts 2>/dev/null; git status --short
```

Expected: `TSC-CLEAN`; the unit total equals Task 10's baseline exactly (the file count rises by the number of new test files: +6 climate, +5 cities, +2 enrich, +7 country-facts, +4 CountryLevel = 165 files); Playwright 22; build green; no `SYNTAX` lines.

- [ ] **Step 2: Glance** — `npx playwright test -c .superpowers/sdd/glance/glance.config.ts`; China's and Peru's maps draw units, the airport toggle draws diamonds, markers open the card; desktop and Pixel 5.

- [ ] **Step 3: The nightly jobs still run their entries** — `grep -n "run: node scripts/" .github/workflows/*.yml` shows the four unchanged commands; `node -e "import('./scripts/ingest-cities.mjs')"` and the other three entries import clean (their guards keep `main` from running).

- [ ] **Step 4: Push, PR, CI**

```bash
git push -u origin chore/split-oversized-files
gh pr create --title "refactor: every source file under the 800-line guidance — four ingest scripts and CountryLevel split along their seams" --body-file <PR body: spec §2, the per-file before/after table from wc -l, the test counts before/after (identical), the five test files left over 800 by decision, the contract edits (C7 path, MUST_STAY_CHEAP 13 → 22), ending with the generated-with line>
gh run watch
```

- [ ] **Step 5: Memory** — v32: PR 2 opened, the module map, the cut-helper lesson (anchors on content; `tr -d '\r'` on this checkout), the count of files still over 800 and why. Merge is the owner's call.

---

## Self-review against the spec

- **§1 placeholders** → Tasks 1–3 (helper, threading, `Group dinner`, `KitTab` docblock, unit + component + e2e tests). Left as-is by decision: notes, `游`, `.font-kai`, `{dest.region} China` — no task touches them, as specified.
- **§2.1 scripts** → Tasks 11–14 (modules per the spec's tables, no re-exports, importers follow, contract path moves, paths computed once per script, cycles caught by dry import). **§2.2 CountryLevel** → Tasks 15–17 (eight files, `MUST_STAY_CHEAP` 13 → 22 — the spec said 21 counting the eight new files; this plan also names `CountryLevel.tsx` itself, which the spec's transitive argument already covered, so 22; the PR body says so), the test split and harness.
- **§3 docs** → Tasks 6–8 and 18.
- **§4 prefetch** → Tasks 4–5 (`enabled` latch, unit + e2e proof, the 90.8 KB figure in both docblocks).
- **§5 two PRs** → Tasks 0–9 and 10–19, PR 2 from `main` after PR 1 merges.
- **§6 verification** → Tasks 9 and 19; per-task counts throughout.
- **Placeholder scan:** none of "TBD", "TODO", "similar to Task N", "add error handling". Every code step shows the code or the exact cut that produces it.
- **Type consistency:** `ticketExamples`/`TicketExamples`/`TICKET_TITLE_EXAMPLES` (Tasks 1–3); `examples` on `TicketsTab`/`TicketForm` and `ticketExamples` on `KitTab` (Task 2, e2e independent of prop names); `useCountryAssets(countryCode, hasDetail, enabled)` (Task 4); `Project`, `Mark`, `VisibleEntry` from `markerLayout.ts` used by `AirportLayer`/`MarkerLayer` (Tasks 15–16); `installCountryLevelHarness` (Task 17); `title`/`above`/`section`/`cut_lines` helpers (Tasks 11–15).
