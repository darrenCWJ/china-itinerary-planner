# Trip Tracker & Money Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new trip-page tabs — **Money** (multi-currency group expenses, balances, settle-up, repayments) and **Tracker** (today dashboard, shared journal with photos, stats, recap) — synced to all members through the existing version/poll mechanism.

**Architecture:** New trip-scoped records (`Expense`, `Settlement`, `JournalEntry`, per-trip `CurrencySettings`) stored like tickets (JSON `data` column keyed by `trip_id, id`) in both SQLite and Postgres, surfaced on `TripPayload`, mutated through Zod-validated member-checked API routes, and rendered by pure derivation modules `lib/money.ts` and `lib/tracker.ts`. Photos upload to local disk where the filesystem is writable (Raspberry Pi / local dev) and fall back to https links elsewhere.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod **v4**, better-sqlite3, postgres.js, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-trip-tracker-money-design.md`

## Global Constraints

- Amounts are **integers in minor units** (fen/cents); no float arithmetic in money code. Valid range `1..100_000_000`.
- Currency codes are 3-letter uppercase (`/^[A-Z]{3}$/`). Rates are **CNY per 1 unit** of the foreign currency, finite and `> 0`.
- Every store mutation must bump the trip `version` (the existing `touch()` pattern) so polling members sync.
- Journal entries are editable/deletable **by their author only**; expenses/settlements by **any member** (tickets trust model).
- Journal text ≤ 5000 chars; ≤ 12 photos per entry; link photos must be `https://`; upload refs match `/^[a-z0-9-]{8,60}\.(jpg|png|webp)$/`.
- Photo uploads: JPEG/PNG/WebP only, ≤ 8 MB, stored under `data/uploads/trips/<tripId>/`; 503 with a hint on hosts without a writable fs (`process.env.VERCEL`).
- Zod is **v4**: `z.record(keySchema, valueSchema)` takes two schemas; avoid `z.string().url()` (use a regex).
- The public briefing page derives `Briefing` via `buildBriefing()` and never forwards the raw payload — do NOT add the new fields to `lib/briefing.ts`.
- Repo conventions: kebab-free PascalCase components in `components/trip/`, tests colocated as `lib/*.test.ts`, run with `npm test` (vitest). No new dependencies.
- Windows dev machine: run commands from the repo root `C:\Users\msn-f\OneDrive\Desktop\China Itenary Planner`.

---

### Task 1: Shared types + Zod schemas

**Files:**
- Modify: `lib/tripShared.ts` (append after the `Ticket` interface, extend `TripPayload`)
- Modify: `lib/server/schemas.ts` (append at end)
- Test: `lib/server/schemas.test.ts` (new)

**Interfaces:**
- Consumes: existing `MemberNameSchema`, `IsoDateSchema` (already in `schemas.ts`), `TripPayload`.
- Produces: types `ExpenseCategory`, `Expense`, `Settlement`, `JournalPhoto`, `JournalEntry`, `CurrencySettings`, const `DEFAULT_CURRENCY_SETTINGS`; `TripPayload` fields `expenses`, `settlements`, `journal`, `currencySettings` (required) and `features?: { photoUploads: boolean }` (optional, facade-injected); schemas `ExpenseCategorySchema`, `ExpenseFieldsSchema`, `AddExpenseSchema`, `UpdateExpenseSchema`, `SettlementFieldsSchema`, `AddSettlementSchema`, `JournalPhotoSchema`, `JournalFieldsSchema`, `AddJournalSchema`, `UpdateJournalSchema`, `CurrencySettingsSchema`, `PHOTO_REF_RE`.

- [ ] **Step 1: Add the shared types**

Append to `lib/tripShared.ts` after the `Ticket` interface:

```ts
export type ExpenseCategory =
  | "food"
  | "transport"
  | "lodging"
  | "tickets"
  | "shopping"
  | "other";

/** A group expense. Amount is in minor units (fen/cents) — always integer. */
export interface Expense {
  id: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  /** 3-letter uppercase code, e.g. "CNY". */
  currency: string;
  paidBy: string;
  /** Member names to split among (equal split). [] = all members at computation time. */
  splitAmong: string[];
  notes: string | null;
  addedBy: string;
  createdAt: number;
}

/** A recorded repayment: `from` paid `to` back. Nets against expense debts. */
export interface Settlement {
  id: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  recordedBy: string;
  createdAt: number;
}

export interface JournalPhoto {
  /** "upload" ref = stored filename, "link" ref = https URL. */
  kind: "upload" | "link";
  ref: string;
}

export interface JournalEntry {
  id: string;
  /** ISO yyyy-mm-dd — the trip day this entry belongs to. */
  date: string;
  text: string;
  photos: JournalPhoto[];
  by: string;
  createdAt: number;
  updatedAt: number;
}

/** Optional per-trip conversion: rates are CNY per 1 unit of the currency. */
export interface CurrencySettings {
  home: string | null;
  rates: Record<string, number>;
}

export const DEFAULT_CURRENCY_SETTINGS: CurrencySettings = { home: null, rates: {} };
```

- [ ] **Step 2: Extend TripPayload**

In `lib/tripShared.ts`, add to the `TripPayload` interface after `tickets: Ticket[];`:

```ts
  expenses: Expense[];
  settlements: Settlement[];
  journal: JournalEntry[];
  currencySettings: CurrencySettings;
  /** Injected by the store facade — whether this host accepts photo uploads. */
  features?: { photoUploads: boolean };
```

- [ ] **Step 3: Write failing schema tests**

Create `lib/server/schemas.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  AddExpenseSchema,
  AddJournalSchema,
  AddSettlementSchema,
  CurrencySettingsSchema,
  UpdateJournalSchema,
} from "./schemas";

const expense = {
  memberName: "Ada",
  expense: {
    date: "2026-11-02",
    title: "Hotpot dinner",
    category: "food",
    amount: 12450,
    currency: "CNY",
    paidBy: "Ada",
    splitAmong: ["Ada", "Bob"],
  },
};

describe("expense schema", () => {
  test("accepts a valid expense", () => {
    expect(AddExpenseSchema.safeParse(expense).success).toBe(true);
  });

  test("normalizes lowercase currency to uppercase", () => {
    const parsed = AddExpenseSchema.parse({
      ...expense,
      expense: { ...expense.expense, currency: "sgd" },
    });
    expect(parsed.expense.currency).toBe("SGD");
  });

  test("rejects non-integer, zero and oversized amounts", () => {
    for (const amount of [0, -5, 12.5, 100_000_001]) {
      const bad = { ...expense, expense: { ...expense.expense, amount } };
      expect(AddExpenseSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("rejects bad currency codes", () => {
    for (const currency of ["", "C", "CNYY", "12A"]) {
      const bad = { ...expense, expense: { ...expense.expense, currency } };
      expect(AddExpenseSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("settlement schema", () => {
  test("accepts a valid settlement", () => {
    const ok = AddSettlementSchema.safeParse({
      memberName: "Bob",
      settlement: { date: "2026-11-03", from: "Bob", to: "Ada", amount: 6225, currency: "CNY" },
    });
    expect(ok.success).toBe(true);
  });
});

describe("journal schema", () => {
  test("accepts text with upload and link photos", () => {
    const ok = AddJournalSchema.safeParse({
      memberName: "Ada",
      entry: {
        date: "2026-11-02",
        text: "Great Wall day — knees destroyed, worth it.",
        photos: [
          { kind: "upload", ref: "0f3c2a1b-aaaa-bbbb-cccc-121212121212.jpg" },
          { kind: "link", ref: "https://photos.example.com/share/abc" },
        ],
      },
    });
    expect(ok.success).toBe(true);
  });

  test("rejects http links, traversal refs and >12 photos", () => {
    const base = { date: "2026-11-02", text: "x", photos: [] as unknown[] };
    const cases = [
      [{ kind: "link", ref: "http://insecure.example.com/a" }],
      [{ kind: "upload", ref: "../../etc/passwd" }],
      [{ kind: "upload", ref: "a.exe" }],
      Array.from({ length: 13 }, () => ({ kind: "link", ref: "https://e.com/p" })),
    ];
    for (const photos of cases) {
      const bad = { memberName: "Ada", entry: { ...base, photos } };
      expect(AddJournalSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("update allows partial fields", () => {
    const ok = UpdateJournalSchema.safeParse({
      memberName: "Ada",
      entry: { text: "edited" },
    });
    expect(ok.success).toBe(true);
  });
});

describe("currency settings schema", () => {
  test("accepts home + rates and null home", () => {
    expect(
      CurrencySettingsSchema.safeParse({
        memberName: "Ada",
        home: "SGD",
        rates: { SGD: 5.2, USD: 7.1 },
      }).success
    ).toBe(true);
    expect(
      CurrencySettingsSchema.safeParse({ memberName: "Ada", home: null, rates: {} }).success
    ).toBe(true);
  });

  test("rejects non-positive or non-finite rates", () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        CurrencySettingsSchema.safeParse({
          memberName: "Ada",
          home: "SGD",
          rates: { SGD: rate },
        }).success
      ).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- schemas`
Expected: FAIL — the new schema exports do not exist yet.

- [ ] **Step 5: Add the schemas**

Append to `lib/server/schemas.ts`:

```ts
const CurrencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "3-letter currency code");
const MinorAmountSchema = z.number().int().min(1).max(100_000_000);

export const ExpenseCategorySchema = z.enum([
  "food",
  "transport",
  "lodging",
  "tickets",
  "shopping",
  "other",
]);

export const ExpenseFieldsSchema = z.object({
  date: IsoDateSchema,
  title: z.string().trim().min(1).max(80),
  category: ExpenseCategorySchema,
  amount: MinorAmountSchema,
  currency: CurrencyCodeSchema,
  paidBy: MemberNameSchema,
  splitAmong: z.array(MemberNameSchema).max(20),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const AddExpenseSchema = z.object({
  memberName: MemberNameSchema,
  expense: ExpenseFieldsSchema,
});

export const UpdateExpenseSchema = z.object({
  memberName: MemberNameSchema,
  expense: ExpenseFieldsSchema.partial(),
});

export const SettlementFieldsSchema = z.object({
  date: IsoDateSchema,
  from: MemberNameSchema,
  to: MemberNameSchema,
  amount: MinorAmountSchema,
  currency: CurrencyCodeSchema,
});

export const AddSettlementSchema = z.object({
  memberName: MemberNameSchema,
  settlement: SettlementFieldsSchema,
});

/** Upload refs are exact stored filenames — no dots or slashes beyond one extension. */
export const PHOTO_REF_RE = /^[a-z0-9-]{8,60}\.(jpg|png|webp)$/;

export const JournalPhotoSchema = z.union([
  z.object({ kind: z.literal("upload"), ref: z.string().regex(PHOTO_REF_RE) }),
  z.object({
    kind: z.literal("link"),
    ref: z.string().max(500).regex(/^https:\/\/\S+$/, "https URL"),
  }),
]);

export const JournalFieldsSchema = z.object({
  date: IsoDateSchema,
  text: z.string().trim().min(1).max(5000),
  photos: z.array(JournalPhotoSchema).max(12),
});

export const AddJournalSchema = z.object({
  memberName: MemberNameSchema,
  entry: JournalFieldsSchema,
});

export const UpdateJournalSchema = z.object({
  memberName: MemberNameSchema,
  entry: JournalFieldsSchema.partial(),
});

export const CurrencySettingsSchema = z.object({
  memberName: MemberNameSchema,
  home: CurrencyCodeSchema.nullable(),
  // Key schema is deliberately transform-free: record keys must stay plain
  // strings, so validate the shape and let the client send uppercase.
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive().finite()),
});
```

Note: `MemberNameSchema` and `IsoDateSchema` already exist near the top of the file — do not redeclare them.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- schemas`
Expected: PASS (all new tests green; no other suite touched).

- [ ] **Step 7: Commit**

```bash
git add lib/tripShared.ts lib/server/schemas.ts lib/server/schemas.test.ts
git commit -m "feat: money and journal shared types with zod schemas"
```

Note: `npm test` will show failures in `lib/server/tripStore.test.ts` ONLY IF the stores don't compile against the extended required `TripPayload` fields — TypeScript in vitest is transpile-only, so the suite still runs. The store payload fields are wired in Tasks 5–6; until then `tsc` strictness is deferred (do not run `tsc --noEmit` between Tasks 1 and 6 and expect green).

---

### Task 2: lib/money.ts — totals, conversion, formatting

**Files:**
- Create: `lib/money.ts`
- Test: `lib/money.test.ts` (new)

**Interfaces:**
- Consumes: `Expense`, `CurrencySettings` from `lib/tripShared.ts` (Task 1).
- Produces (exact signatures later tasks use):
  - `interface CurrencyAmount { currency: string; amount: number }`
  - `totalsByCurrency(expenses: Expense[]): CurrencyAmount[]` — sorted by currency code, minor units.
  - `expensesOnDate(expenses: Expense[], isoDate: string): Expense[]`
  - `interface ConvertedTotals { cny: number; home: CurrencyAmount | null; unconverted: CurrencyAmount[] }`
  - `convertedTotals(totals: CurrencyAmount[], settings: CurrencySettings): ConvertedTotals | null` — null when `settings.home === null`.
  - `formatMinor(amount: number, currency: string): string` — e.g. `¥1,240.50`, `S$85.00`, `USD 12.00`, sign-aware.
  - `majorToMinor(input: string): number | null` — `"124.5"` → `12450`, null when invalid.

- [ ] **Step 1: Write failing tests**

Create `lib/money.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { Expense, Settlement } from "./tripShared";
import {
  balancesByCurrency,
  convertedTotals,
  expensesOnDate,
  formatMinor,
  majorToMinor,
  settleUp,
  splitMinorUnits,
  totalsByCurrency,
} from "./money";

let seq = 0;
function expense(overrides: Partial<Expense> = {}): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    date: "2026-11-02",
    title: "Test",
    category: "food",
    amount: 1000,
    currency: "CNY",
    paidBy: "Ada",
    splitAmong: ["Ada", "Bob"],
    notes: null,
    addedBy: "Ada",
    createdAt: 1,
    ...overrides,
  };
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  seq += 1;
  return {
    id: `s${seq}`,
    date: "2026-11-03",
    from: "Bob",
    to: "Ada",
    amount: 500,
    currency: "CNY",
    recordedBy: "Bob",
    createdAt: 2,
    ...overrides,
  };
}

describe("totalsByCurrency", () => {
  test("sums per currency, sorted by code", () => {
    const totals = totalsByCurrency([
      expense({ amount: 1000, currency: "CNY" }),
      expense({ amount: 2500, currency: "SGD" }),
      expense({ amount: 500, currency: "CNY" }),
    ]);
    expect(totals).toEqual([
      { currency: "CNY", amount: 1500 },
      { currency: "SGD", amount: 2500 },
    ]);
  });

  test("empty list gives no totals", () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe("expensesOnDate", () => {
  test("filters by exact date", () => {
    const a = expense({ date: "2026-11-02" });
    const b = expense({ date: "2026-11-03" });
    expect(expensesOnDate([a, b], "2026-11-03")).toEqual([b]);
  });
});

describe("convertedTotals", () => {
  const totals = [
    { currency: "CNY", amount: 100_000 },
    { currency: "SGD", amount: 10_000 },
  ];

  test("null without a home currency", () => {
    expect(convertedTotals(totals, { home: null, rates: {} })).toBeNull();
  });

  test("converts everything to CNY then to home", () => {
    const c = convertedTotals(totals, { home: "SGD", rates: { SGD: 5.2 } });
    // 100_000 + 10_000×5.2 = 152_000 fen; home = 152_000 / 5.2 ≈ 29_231 cents
    expect(c).toEqual({
      cny: 152_000,
      home: { currency: "SGD", amount: 29_231 },
      unconverted: [],
    });
  });

  test("collects currencies without a rate instead of dropping them", () => {
    const c = convertedTotals(
      [...totals, { currency: "USD", amount: 3_000 }],
      { home: "SGD", rates: { SGD: 5.2 } }
    );
    expect(c!.unconverted).toEqual([{ currency: "USD", amount: 3_000 }]);
    expect(c!.cny).toBe(152_000);
  });

  test("home CNY needs no rate", () => {
    const c = convertedTotals(totals, { home: "CNY", rates: { SGD: 5.2 } });
    expect(c!.home).toEqual({ currency: "CNY", amount: 152_000 });
  });

  test("home without a rate yields null home but still a CNY total", () => {
    const c = convertedTotals(totals, { home: "SGD", rates: {} });
    expect(c!.home).toBeNull();
    expect(c!.cny).toBe(100_000);
    expect(c!.unconverted).toEqual([{ currency: "SGD", amount: 10_000 }]);
  });
});

describe("formatMinor", () => {
  test("known symbols and grouping", () => {
    expect(formatMinor(124_050, "CNY")).toBe("¥1,240.50");
    expect(formatMinor(8_500, "SGD")).toBe("S$85.00");
    expect(formatMinor(1_200, "USD")).toBe("US$12.00");
  });

  test("unknown codes fall back to code prefix", () => {
    expect(formatMinor(1_200, "THB")).toBe("THB 12.00");
  });

  test("negative amounts carry the sign before the symbol", () => {
    expect(formatMinor(-50, "CNY")).toBe("-¥0.50");
  });
});

describe("majorToMinor", () => {
  test("parses major-unit strings", () => {
    expect(majorToMinor("124.5")).toBe(12_450);
    expect(majorToMinor("124.50")).toBe(12_450);
    expect(majorToMinor("0.01")).toBe(1);
    expect(majorToMinor("1000")).toBe(100_000);
  });

  test("rejects junk", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1,000", "1e3"]) {
      expect(majorToMinor(bad)).toBeNull();
    }
  });
});
```

(The `balancesByCurrency`, `settleUp`, `splitMinorUnits` imports fail to resolve until Task 3 — that is fine; vitest reports them as errors which Task 3 fixes. To keep this task green on its own, Task 3's functions are declared in Step 3 as working implementations too — see note there.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- money`
Expected: FAIL — `lib/money.ts` does not exist.

- [ ] **Step 3: Implement**

Create `lib/money.ts`:

```ts
import type { CurrencySettings, Expense, Settlement } from "./tripShared";

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

/** Plain per-currency sums in minor units, sorted by currency code. */
export function totalsByCurrency(expenses: Expense[]): CurrencyAmount[] {
  const sums = new Map<string, number>();
  for (const e of expenses) {
    sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  }
  return [...sums.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function expensesOnDate(expenses: Expense[], isoDate: string): Expense[] {
  return expenses.filter((e) => e.date === isoDate);
}

export interface ConvertedTotals {
  /** Grand total expressed in CNY minor units (fen). */
  cny: number;
  /** Grand total expressed in the home currency, when its rate is known. */
  home: CurrencyAmount | null;
  /** Currencies that had no rate — shown unconverted, never silently dropped. */
  unconverted: CurrencyAmount[];
}

/** Rates are CNY per 1 unit of foreign currency. Null when no home currency set. */
export function convertedTotals(
  totals: CurrencyAmount[],
  settings: CurrencySettings
): ConvertedTotals | null {
  if (settings.home === null) return null;
  let cny = 0;
  const unconverted: CurrencyAmount[] = [];
  for (const t of totals) {
    const rate = t.currency === "CNY" ? 1 : settings.rates[t.currency];
    if (rate === undefined) {
      unconverted.push(t);
      continue;
    }
    cny += Math.round(t.amount * rate);
  }
  const homeRate = settings.home === "CNY" ? 1 : settings.rates[settings.home];
  const home =
    homeRate === undefined
      ? null
      : { currency: settings.home, amount: Math.round(cny / homeRate) };
  return { cny, home, unconverted };
}

const SYMBOLS: Record<string, string> = {
  CNY: "¥",
  SGD: "S$",
  USD: "US$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
  TWD: "NT$",
  MYR: "RM",
};

/** Minor units → display string, e.g. 124050 CNY → "¥1,240.50". */
export function formatMinor(amount: number, currency: string): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const major = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  const symbol = SYMBOLS[currency];
  return symbol !== undefined
    ? `${sign}${symbol}${major}.${cents}`
    : `${sign}${currency} ${major}.${cents}`;
}

/** "124.5" → 12450 minor units. Null when not a plain positive decimal. */
export function majorToMinor(input: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const cents = (m[2] ?? "").padEnd(2, "0");
  const value = Number(m[1]) * 100 + Number(cents);
  return value >= 1 && value <= 100_000_000 ? value : null;
}
```

- [ ] **Step 4: Run tests to verify these describe-blocks pass**

Run: `npm test -- money`
Expected: the `totalsByCurrency`, `expensesOnDate`, `convertedTotals`, `formatMinor`, `majorToMinor` blocks PASS. The file still fails to import `balancesByCurrency`/`settleUp`/`splitMinorUnits` — Task 3 completes them. If you prefer a green commit, temporarily comment the three imports and the `describe` blocks that use them, and restore them in Task 3 Step 1.

- [ ] **Step 5: Commit**

```bash
git add lib/money.ts lib/money.test.ts
git commit -m "feat: money totals, conversion and formatting helpers"
```

---

### Task 3: lib/money.ts — splits, balances, settle-up

**Files:**
- Modify: `lib/money.ts` (append)
- Test: `lib/money.test.ts` (append)

**Interfaces:**
- Consumes: `Expense`, `Settlement` (Task 1); `CurrencyAmount` (Task 2).
- Produces:
  - `splitMinorUnits(amount: number, parts: number): number[]` — largest-remainder, first `amount % parts` entries get the extra unit.
  - `interface MemberBalance { member: string; net: number }` — positive = is owed.
  - `interface CurrencyBalances { currency: string; balances: MemberBalance[] }`
  - `balancesByCurrency(expenses: Expense[], settlements: Settlement[], members: string[]): CurrencyBalances[]` — zero-net members omitted; sorted by currency then member.
  - `interface Transfer { from: string; to: string; amount: number }`
  - `settleUp(balances: MemberBalance[]): Transfer[]` — greedy minimal transfers.

- [ ] **Step 1: Append failing tests**

Append to `lib/money.test.ts` (and restore any imports commented out in Task 2 Step 4):

```ts
describe("splitMinorUnits", () => {
  test("splits evenly", () => {
    expect(splitMinorUnits(1000, 2)).toEqual([500, 500]);
  });

  test("distributes the remainder to the first entries", () => {
    expect(splitMinorUnits(1000, 3)).toEqual([334, 333, 333]);
    expect(splitMinorUnits(101, 2)).toEqual([51, 50]);
  });

  test("total always equals the input", () => {
    for (const [amount, parts] of [[997, 3], [1, 4], [12345, 7]] as const) {
      const shares = splitMinorUnits(amount, parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(shares).toHaveLength(parts);
    }
  });
});

describe("balancesByCurrency", () => {
  const members = ["Ada", "Bob", "Cyn"];

  test("payer is owed, participants owe their share", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [],
      members
    );
    expect(out).toEqual([
      {
        currency: "CNY",
        balances: [
          { member: "Ada", net: 500 },
          { member: "Bob", net: -500 },
        ],
      },
    ]);
  });

  test("empty splitAmong means all current members", () => {
    const out = balancesByCurrency(
      [expense({ amount: 900, paidBy: "Ada", splitAmong: [] })],
      [],
      members
    );
    const cny = out[0].balances;
    expect(cny).toContainEqual({ member: "Ada", net: 600 });
    expect(cny).toContainEqual({ member: "Bob", net: -300 });
    expect(cny).toContainEqual({ member: "Cyn", net: -300 });
  });

  test("currencies are tracked independently", () => {
    const out = balancesByCurrency(
      [
        expense({ amount: 1000, currency: "CNY", paidBy: "Ada", splitAmong: ["Ada", "Bob"] }),
        expense({ amount: 400, currency: "SGD", paidBy: "Bob", splitAmong: ["Ada", "Bob"] }),
      ],
      [],
      members
    );
    expect(out.map((c) => c.currency)).toEqual(["CNY", "SGD"]);
  });

  test("a full settlement clears both nets", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [settlement({ from: "Bob", to: "Ada", amount: 500 })],
      members
    );
    expect(out).toEqual([]);
  });

  test("a partial settlement shrinks the debt", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [settlement({ from: "Bob", to: "Ada", amount: 200 })],
      members
    );
    expect(out[0].balances).toEqual([
      { member: "Ada", net: 300 },
      { member: "Bob", net: -300 },
    ]);
  });

  test("an over-payment flips the direction", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [settlement({ from: "Bob", to: "Ada", amount: 800 })],
      members
    );
    expect(out[0].balances).toEqual([
      { member: "Ada", net: -300 },
      { member: "Bob", net: 300 },
    ]);
  });

  test("unknown member names in old expenses do not crash", () => {
    const out = balancesByCurrency(
      [expense({ amount: 600, paidBy: "Ghost", splitAmong: ["Ghost", "Ada"] })],
      [],
      members
    );
    expect(out[0].balances).toContainEqual({ member: "Ghost", net: 300 });
    expect(out[0].balances).toContainEqual({ member: "Ada", net: -300 });
  });
});

describe("settleUp", () => {
  test("single debt yields one transfer", () => {
    expect(
      settleUp([
        { member: "Ada", net: 500 },
        { member: "Bob", net: -500 },
      ])
    ).toEqual([{ from: "Bob", to: "Ada", amount: 500 }]);
  });

  test("chain nets to minimal transfers", () => {
    const transfers = settleUp([
      { member: "Ada", net: 700 },
      { member: "Bob", net: -300 },
      { member: "Cyn", net: -400 },
    ]);
    expect(transfers).toEqual([
      { from: "Cyn", to: "Ada", amount: 400 },
      { from: "Bob", to: "Ada", amount: 300 },
    ]);
    const paid = transfers.reduce((a, t) => a + t.amount, 0);
    expect(paid).toBe(700);
  });

  test("balanced books need no transfers", () => {
    expect(settleUp([])).toEqual([]);
    expect(settleUp([{ member: "Ada", net: 0 }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new blocks fail**

Run: `npm test -- money`
Expected: FAIL — `splitMinorUnits`, `balancesByCurrency`, `settleUp` are not exported.

- [ ] **Step 3: Implement**

Append to `lib/money.ts`:

```ts
/** Equal split with largest-remainder: the first (amount % parts) shares get +1. */
export function splitMinorUnits(amount: number, parts: number): number[] {
  const base = Math.floor(amount / parts);
  const extras = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => (i < extras ? base + 1 : base));
}

export interface MemberBalance {
  member: string;
  /** Positive = is owed money; negative = owes. Minor units. */
  net: number;
}

export interface CurrencyBalances {
  currency: string;
  balances: MemberBalance[];
}

/**
 * net = expenses paid − share owed + repayments sent − repayments received.
 * Members netting to zero are omitted. Unknown names (departed members,
 * typos in old data) are kept as-is — never crash, never drop an expense.
 */
export function balancesByCurrency(
  expenses: Expense[],
  settlements: Settlement[],
  members: string[]
): CurrencyBalances[] {
  const byCurrency = new Map<string, Map<string, number>>();
  const bump = (currency: string, member: string, delta: number) => {
    let m = byCurrency.get(currency);
    if (!m) {
      m = new Map();
      byCurrency.set(currency, m);
    }
    m.set(member, (m.get(member) ?? 0) + delta);
  };

  for (const e of expenses) {
    const participants = e.splitAmong.length > 0 ? e.splitAmong : members;
    if (participants.length === 0) continue;
    bump(e.currency, e.paidBy, e.amount);
    const shares = splitMinorUnits(e.amount, participants.length);
    participants.forEach((member, i) => bump(e.currency, member, -shares[i]));
  }
  for (const s of settlements) {
    bump(s.currency, s.from, s.amount);
    bump(s.currency, s.to, -s.amount);
  }

  return [...byCurrency.entries()]
    .map(([currency, nets]) => ({
      currency,
      balances: [...nets.entries()]
        .filter(([, net]) => net !== 0)
        .map(([member, net]) => ({ member, net }))
        .sort((a, b) => a.member.localeCompare(b.member)),
    }))
    .filter((c) => c.balances.length > 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** Greedy minimal transfers: biggest debtor pays biggest creditor first. */
export function settleUp(balances: MemberBalance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.net > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net || a.member.localeCompare(b.member));
  const debtors = balances
    .filter((b) => b.net < 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => a.net - b.net || a.member.localeCompare(b.member));

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci].net;
    const debt = -debtors[di].net;
    const amount = Math.min(credit, debt);
    transfers.push({ from: debtors[di].member, to: creditors[ci].member, amount });
    creditors[ci].net -= amount;
    debtors[di].net += amount;
    if (creditors[ci].net === 0) ci += 1;
    if (debtors[di].net === 0) di += 1;
  }
  return transfers;
}
```

- [ ] **Step 4: Run the full money suite**

Run: `npm test -- money`
Expected: PASS — every describe block green.

- [ ] **Step 5: Commit**

```bash
git add lib/money.ts lib/money.test.ts
git commit -m "feat: expense splitting, per-currency balances and settle-up"
```

---

### Task 4: lib/tracker.ts — trip phase, now/next, progress, stats

**Files:**
- Create: `lib/tracker.ts`
- Test: `lib/tracker.test.ts` (new)

**Interfaces:**
- Consumes: `DayPlan`, `ScheduledItem` from `lib/itinerary.ts`; `TimeSlot` from `lib/types.ts`; `LatLon`, `haversineKm` from `lib/geo.ts`; `itemCheckKey` from `lib/tripShared.ts`.
- Produces:
  - `type TripPhase = "no-date" | "before" | "during" | "after"`
  - `interface TrackerState { phase: TripPhase; dayIndex: number | null; daysToGo: number | null; totalDays: number }`
  - `trackerState(startDate: string | null, totalDays: number, todayIsoDate: string): TrackerState`
  - `todayIso(now?: Date): string` — device-local calendar date.
  - `slotForHour(hour: number): TimeSlot` — `<12` morning, `<18` afternoon, else evening.
  - `interface NowNext { current: ScheduledItem | null; next: ScheduledItem | null }`
  - `nowNext(day: DayPlan, checkedKeys: ReadonlySet<string>, slot: TimeSlot): NowNext`
  - `progress(days: DayPlan[], checkedKeys: ReadonlySet<string>): { done: number; total: number }`
  - `citiesSoFar(days: DayPlan[], dayIndex: number): string[]` — unique destination names, visit order.
  - `railKmSoFar(days: DayPlan[], dayIndex: number, coords: (destinationId: string) => LatLon | null): number`

- [ ] **Step 1: Write failing tests**

Create `lib/tracker.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { DayPlan } from "./itinerary";
import { itemCheckKey } from "./tripShared";
import {
  citiesSoFar,
  nowNext,
  progress,
  railKmSoFar,
  slotForHour,
  trackerState,
} from "./tracker";

function day(n: number, destinationId: string, itemIds: string[]): DayPlan {
  return {
    day: n,
    destinationId,
    destinationName: destinationId.toUpperCase(),
    items: itemIds.map((id, i) => ({
      id,
      slot: (["morning", "afternoon", "evening"] as const)[i % 3],
      kind: "activity",
      title: `Item ${id}`,
    })),
  };
}

describe("trackerState", () => {
  test("no start date", () => {
    expect(trackerState(null, 5, "2026-11-02")).toEqual({
      phase: "no-date",
      dayIndex: null,
      daysToGo: null,
      totalDays: 5,
    });
  });

  test("before the trip counts days to go", () => {
    expect(trackerState("2026-11-05", 5, "2026-11-02")).toEqual({
      phase: "before",
      dayIndex: null,
      daysToGo: 3,
      totalDays: 5,
    });
  });

  test("day 1 on the start date, last day inclusive", () => {
    expect(trackerState("2026-11-02", 5, "2026-11-02").dayIndex).toBe(1);
    expect(trackerState("2026-11-02", 5, "2026-11-02").phase).toBe("during");
    expect(trackerState("2026-11-02", 5, "2026-11-06").dayIndex).toBe(5);
  });

  test("after the trip", () => {
    expect(trackerState("2026-11-02", 5, "2026-11-07").phase).toBe("after");
  });

  test("month boundary arithmetic", () => {
    expect(trackerState("2026-10-30", 5, "2026-11-01").dayIndex).toBe(3);
  });

  test("garbage start date degrades to no-date", () => {
    expect(trackerState("soon", 5, "2026-11-02").phase).toBe("no-date");
  });
});

describe("slotForHour", () => {
  test("cutoffs at 12:00 and 18:00", () => {
    expect(slotForHour(0)).toBe("morning");
    expect(slotForHour(11)).toBe("morning");
    expect(slotForHour(12)).toBe("afternoon");
    expect(slotForHour(17)).toBe("afternoon");
    expect(slotForHour(18)).toBe("evening");
    expect(slotForHour(23)).toBe("evening");
  });
});

describe("nowNext", () => {
  const d = day(1, "beijing", ["a", "b", "c"]); // slots: morning, afternoon, evening
  const checked = (...ids: string[]) => new Set(ids.map((id) => itemCheckKey(id)));

  test("first unchecked item at or before the current slot is current", () => {
    const r = nowNext(d, checked(), "afternoon");
    expect(r.current?.id).toBe("a");
    expect(r.next?.id).toBe("b");
  });

  test("checked items are skipped", () => {
    const r = nowNext(d, checked("a"), "afternoon");
    expect(r.current?.id).toBe("b");
    expect(r.next?.id).toBe("c");
  });

  test("morning slot leaves later items as next only", () => {
    const r = nowNext(d, checked("a"), "morning");
    expect(r.current).toBeNull();
    expect(r.next?.id).toBe("b");
  });

  test("everything done", () => {
    const r = nowNext(d, checked("a", "b", "c"), "evening");
    expect(r.current).toBeNull();
    expect(r.next).toBeNull();
  });
});

describe("progress", () => {
  test("counts checked items across days", () => {
    const days = [day(1, "beijing", ["a", "b"]), day(2, "xian", ["c"])];
    const keys = new Set([itemCheckKey("a"), itemCheckKey("c")]);
    expect(progress(days, keys)).toEqual({ done: 2, total: 3 });
  });
});

describe("citiesSoFar", () => {
  test("unique names in visit order up to the day index", () => {
    const days = [
      day(1, "beijing", []),
      day(2, "beijing", []),
      day(3, "xian", []),
      day(4, "chengdu", []),
    ];
    expect(citiesSoFar(days, 3)).toEqual(["BEIJING", "XIAN"]);
  });
});

describe("railKmSoFar", () => {
  const coords = (id: string) =>
    id === "beijing"
      ? { lat: 39.9, lon: 116.4 }
      : id === "xian"
        ? { lat: 34.26, lon: 108.94 }
        : null;

  test("sums transfers between distinct consecutive cities already reached", () => {
    const days = [day(1, "beijing", []), day(2, "xian", []), day(3, "unknown-city", [])];
    const km = railKmSoFar(days, 2, coords);
    expect(km).toBeGreaterThan(800);
    expect(km).toBeLessThan(1100);
  });

  test("unknown coordinates and unreached days contribute nothing", () => {
    const days = [day(1, "beijing", []), day(2, "xian", [])];
    expect(railKmSoFar(days, 1, coords)).toBe(0);
    expect(railKmSoFar(days, 2, () => null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tracker`
Expected: FAIL — `lib/tracker.ts` does not exist.

- [ ] **Step 3: Implement**

Create `lib/tracker.ts`:

```ts
import type { LatLon } from "./geo";
import { haversineKm } from "./geo";
import type { DayPlan, ScheduledItem } from "./itinerary";
import { itemCheckKey } from "./tripShared";
import type { TimeSlot } from "./types";

export type TripPhase = "no-date" | "before" | "during" | "after";

export interface TrackerState {
  phase: TripPhase;
  /** 1-based trip day, only set during the trip. */
  dayIndex: number | null;
  /** Whole days until departure, only set before the trip. */
  daysToGo: number | null;
  totalDays: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since epoch for an ISO date, UTC-anchored so no timezone drift. */
function epochDay(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

export function trackerState(
  startDate: string | null,
  totalDays: number,
  todayIsoDate: string
): TrackerState {
  const start = startDate ? epochDay(startDate) : null;
  const today = epochDay(todayIsoDate);
  if (start === null || today === null) {
    return { phase: "no-date", dayIndex: null, daysToGo: null, totalDays };
  }
  const dayIndex = today - start + 1;
  if (dayIndex < 1) {
    return { phase: "before", dayIndex: null, daysToGo: 1 - dayIndex, totalDays };
  }
  if (dayIndex <= totalDays) {
    return { phase: "during", dayIndex, daysToGo: null, totalDays };
  }
  return { phase: "after", dayIndex: null, daysToGo: null, totalDays };
}

/** Device-local calendar date — the whole party lives in UTC+8 either way. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function slotForHour(hour: number): TimeSlot {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const SLOT_RANK: Record<TimeSlot, number> = { morning: 0, afternoon: 1, evening: 2 };

export interface NowNext {
  current: ScheduledItem | null;
  next: ScheduledItem | null;
}

/**
 * current = first unchecked item in a slot that has already begun;
 * next = the unchecked item after it (or the first upcoming one when
 * nothing is currently due).
 */
export function nowNext(
  day: DayPlan,
  checkedKeys: ReadonlySet<string>,
  slot: TimeSlot
): NowNext {
  const pending = day.items.filter((i) => !checkedKeys.has(itemCheckKey(i.id)));
  const rank = SLOT_RANK[slot];
  const current = pending.find((i) => SLOT_RANK[i.slot] <= rank) ?? null;
  if (current) {
    const idx = pending.indexOf(current);
    return { current, next: pending[idx + 1] ?? null };
  }
  return { current: null, next: pending[0] ?? null };
}

export function progress(
  days: DayPlan[],
  checkedKeys: ReadonlySet<string>
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const d of days) {
    for (const item of d.items) {
      total += 1;
      if (checkedKeys.has(itemCheckKey(item.id))) done += 1;
    }
  }
  return { done, total };
}

/** Unique destination names through the given trip day, in visit order. */
export function citiesSoFar(days: DayPlan[], dayIndex: number): string[] {
  const seen: string[] = [];
  for (const d of days) {
    if (d.day > dayIndex) break;
    if (!seen.includes(d.destinationName)) seen.push(d.destinationName);
  }
  return seen;
}

/**
 * Rail km covered so far: haversine over consecutive-day city changes already
 * reached. Days whose coordinates can't be resolved contribute nothing.
 */
export function railKmSoFar(
  days: DayPlan[],
  dayIndex: number,
  coords: (destinationId: string) => LatLon | null
): number {
  let km = 0;
  for (let i = 1; i < days.length; i += 1) {
    if (days[i].day > dayIndex) break;
    if (days[i].destinationId === days[i - 1].destinationId) continue;
    const a = coords(days[i - 1].destinationId);
    const b = coords(days[i].destinationId);
    if (a && b) km += haversineKm(a, b);
  }
  return Math.round(km);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tracker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tracker.ts lib/tracker.test.ts
git commit -m "feat: tracker phase, now/next and stats derivation"
```

---

### Task 5: SQLite storage — tables, CRUD, payload extension

**Files:**
- Modify: `lib/server/db.ts` (extend `SCHEMA`)
- Modify: `lib/server/tripStore.ts` (extend `getTrip`, append CRUD)
- Test: `lib/server/tripStore.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `Expense`, `Settlement`, `JournalEntry`, `CurrencySettings`, `DEFAULT_CURRENCY_SETTINGS` (Task 1); existing `getDb`, `touch`.
- Produces (sync functions, mirrored async by Task 6):
  - `addExpense(tripId: string, expense: Expense): boolean`
  - `updateExpense(tripId: string, expense: Expense): boolean`
  - `deleteExpense(tripId: string, expenseId: string): boolean`
  - `addSettlement(tripId: string, settlement: Settlement): boolean`
  - `deleteSettlement(tripId: string, settlementId: string): boolean`
  - `addJournalEntry(tripId: string, entry: JournalEntry): boolean`
  - `updateJournalEntry(tripId: string, entry: JournalEntry): boolean`
  - `deleteJournalEntry(tripId: string, entryId: string): boolean`
  - `setCurrencySettings(tripId: string, settings: CurrencySettings): boolean`
  - `getTrip` now fills `expenses`, `settlements`, `journal`, `currencySettings` on the payload.

- [ ] **Step 1: Extend the SQLite schema**

In `lib/server/db.ts`, add to the `SCHEMA` template string before the closing backtick (after the `briefings_trip` index line). New tables copy the tickets shape; `trip_settings` avoids an `ALTER TABLE` on the existing `trips` table:

```sql
CREATE TABLE IF NOT EXISTS expenses (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS settlements (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS journal_entries (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS trip_settings (
  trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  currency_settings TEXT
);
```

- [ ] **Step 2: Append failing store tests**

Append to `lib/server/tripStore.test.ts` (extend the existing import from `./tripStore` with the new function names, and add `Expense`, `JournalEntry`, `Settlement`, plus `CurrencySettings` to the type import from `../tripShared`):

```ts
function expenseFixture(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-1",
    date: "2026-11-02",
    title: "Hotpot",
    category: "food",
    amount: 12450,
    currency: "CNY",
    paidBy: "Ada",
    splitAmong: ["Ada"],
    notes: null,
    addedBy: "Ada",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("money & journal storage", () => {
  test("expense CRUD round-trips and bumps the version", () => {
    const { id } = createTrip(tripData(), "Ada");
    const before = getTrip(id)!.version;

    expect(addExpense(id, expenseFixture())).toBe(true);
    let trip = getTrip(id)!;
    expect(trip.expenses).toHaveLength(1);
    expect(trip.expenses[0].title).toBe("Hotpot");
    expect(trip.version).toBe(before + 1);

    expect(updateExpense(id, expenseFixture({ title: "Hotpot deluxe" }))).toBe(true);
    trip = getTrip(id)!;
    expect(trip.expenses[0].title).toBe("Hotpot deluxe");
    expect(trip.version).toBe(before + 2);

    expect(deleteExpense(id, "exp-1")).toBe(true);
    trip = getTrip(id)!;
    expect(trip.expenses).toHaveLength(0);
    expect(trip.version).toBe(before + 3);
  });

  test("mutations against a missing trip or record return false", () => {
    expect(addExpense("nope", expenseFixture())).toBe(false);
    const { id } = createTrip(tripData(), "Ada");
    expect(updateExpense(id, expenseFixture({ id: "ghost" }))).toBe(false);
    expect(deleteExpense(id, "ghost")).toBe(false);
    expect(deleteSettlement(id, "ghost")).toBe(false);
    expect(deleteJournalEntry(id, "ghost")).toBe(false);
  });

  test("settlements round-trip", () => {
    const { id } = createTrip(tripData(), "Ada");
    const s: Settlement = {
      id: "set-1",
      date: "2026-11-03",
      from: "Bob",
      to: "Ada",
      amount: 6225,
      currency: "CNY",
      recordedBy: "Bob",
      createdAt: Date.now(),
    };
    expect(addSettlement(id, s)).toBe(true);
    expect(getTrip(id)!.settlements).toEqual([s]);
    expect(deleteSettlement(id, "set-1")).toBe(true);
    expect(getTrip(id)!.settlements).toEqual([]);
  });

  test("journal entries round-trip with photos", () => {
    const { id } = createTrip(tripData(), "Ada");
    const entry: JournalEntry = {
      id: "j-1",
      date: "2026-11-02",
      text: "Great Wall!",
      photos: [{ kind: "link", ref: "https://photos.example.com/a" }],
      by: "Ada",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(addJournalEntry(id, entry)).toBe(true);
    expect(getTrip(id)!.journal).toEqual([entry]);

    const edited = { ...entry, text: "Great Wall — 10/10", updatedAt: Date.now() + 1 };
    expect(updateJournalEntry(id, edited)).toBe(true);
    expect(getTrip(id)!.journal[0].text).toBe("Great Wall — 10/10");

    expect(deleteJournalEntry(id, "j-1")).toBe(true);
    expect(getTrip(id)!.journal).toEqual([]);
  });

  test("currency settings default and persist", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(getTrip(id)!.currencySettings).toEqual({ home: null, rates: {} });

    const settings: CurrencySettings = { home: "SGD", rates: { SGD: 5.2 } };
    expect(setCurrencySettings(id, settings)).toBe(true);
    const trip = getTrip(id)!;
    expect(trip.currencySettings).toEqual(settings);
    expect(setCurrencySettings("nope", settings)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tripStore`
Expected: FAIL — new functions not exported.

- [ ] **Step 4: Implement the store extension**

In `lib/server/tripStore.ts`:

1. Extend the type import: `import type { CurrencySettings, Expense, JournalEntry, Settlement, Ticket, TripCheck, TripData, TripMember, TripPayload } from "../tripShared";` and add `import { DEFAULT_CURRENCY_SETTINGS } from "../tripShared";`.

2. Add a generic JSON-row helper near `touch()` (all three new tables share the tickets shape):

```ts
type JsonRowTable = "expenses" | "settlements" | "journal_entries";

function insertJsonRow(table: JsonRowTable, tripId: string, id: string, data: unknown): boolean {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId) === undefined) return false;
  db.prepare(
    `INSERT INTO ${table} (trip_id, id, data, created_at) VALUES (?, ?, ?, ?)`
  ).run(tripId, id, JSON.stringify(data), Date.now());
  touch(tripId);
  return true;
}

function updateJsonRow(table: JsonRowTable, tripId: string, id: string, data: unknown): boolean {
  const result = getDb()
    .prepare(`UPDATE ${table} SET data = ? WHERE trip_id = ? AND id = ?`)
    .run(JSON.stringify(data), tripId, id);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

function deleteJsonRow(table: JsonRowTable, tripId: string, id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM ${table} WHERE trip_id = ? AND id = ?`)
    .run(tripId, id);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

function readJsonRows<T>(table: JsonRowTable, tripId: string): T[] {
  const rows = getDb()
    .prepare(`SELECT data FROM ${table} WHERE trip_id = ? ORDER BY created_at`)
    .all(tripId) as { data: string }[];
  const out: T[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.data) as T);
    } catch {
      // Skip a corrupted row rather than failing the whole trip.
    }
  }
  return out;
}
```

3. Export the public CRUD:

```ts
export function addExpense(tripId: string, expense: Expense): boolean {
  return insertJsonRow("expenses", tripId, expense.id, expense);
}

export function updateExpense(tripId: string, expense: Expense): boolean {
  return updateJsonRow("expenses", tripId, expense.id, expense);
}

export function deleteExpense(tripId: string, expenseId: string): boolean {
  return deleteJsonRow("expenses", tripId, expenseId);
}

export function addSettlement(tripId: string, settlement: Settlement): boolean {
  return insertJsonRow("settlements", tripId, settlement.id, settlement);
}

export function deleteSettlement(tripId: string, settlementId: string): boolean {
  return deleteJsonRow("settlements", tripId, settlementId);
}

export function addJournalEntry(tripId: string, entry: JournalEntry): boolean {
  return insertJsonRow("journal_entries", tripId, entry.id, entry);
}

export function updateJournalEntry(tripId: string, entry: JournalEntry): boolean {
  return updateJsonRow("journal_entries", tripId, entry.id, entry);
}

export function deleteJournalEntry(tripId: string, entryId: string): boolean {
  return deleteJsonRow("journal_entries", tripId, entryId);
}

export function setCurrencySettings(tripId: string, settings: CurrencySettings): boolean {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId) === undefined) return false;
  db.prepare(
    "INSERT INTO trip_settings (trip_id, currency_settings) VALUES (?, ?) " +
      "ON CONFLICT(trip_id) DO UPDATE SET currency_settings = excluded.currency_settings"
  ).run(tripId, JSON.stringify(settings));
  touch(tripId);
  return true;
}
```

4. In the existing `getTrip`, after the `tickets` loop and before `const payload: TripPayload = {`, add:

```ts
  const expenses = readJsonRows<Expense>("expenses", id);
  const settlements = readJsonRows<Settlement>("settlements", id);
  const journal = readJsonRows<JournalEntry>("journal_entries", id);

  let currencySettings: CurrencySettings = DEFAULT_CURRENCY_SETTINGS;
  const settingsRow = db
    .prepare("SELECT currency_settings FROM trip_settings WHERE trip_id = ?")
    .get(id) as { currency_settings: string | null } | undefined;
  if (settingsRow?.currency_settings) {
    try {
      currencySettings = JSON.parse(settingsRow.currency_settings) as CurrencySettings;
    } catch {
      // Corrupted settings degrade to the default rather than 500ing.
    }
  }
```

and extend the payload literal with `expenses, settlements, journal, currencySettings,` after `tickets,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tripStore`
Expected: PASS — new block green, all pre-existing tripStore tests still green.

- [ ] **Step 6: Commit**

```bash
git add lib/server/db.ts lib/server/tripStore.ts lib/server/tripStore.test.ts
git commit -m "feat: sqlite storage for expenses, settlements, journal and currency settings"
```

---

### Task 6: Postgres parity + store facade

**Files:**
- Modify: `lib/server/pgStore.ts` (extend `ensureSchema`, `getTrip`, append CRUD)
- Modify: `lib/server/store.ts` (append facade delegations)

**Interfaces:**
- Consumes: Task 5's function names (identical, but `async` and `Promise`-returning in pg).
- Produces: `lib/server/store.ts` exports awaited versions of every Task 5 function with the same names/signatures (`Promise<boolean>` returns), switching on `storeMode()` exactly like `addTicket` does.

There is no Postgres instance in CI or local tests — parity is verified by code review against the SQLite tests plus the existing pattern (tickets). Keep the pg SQL byte-for-byte parallel to the SQLite semantics.

- [ ] **Step 1: Extend the pg schema**

In `lib/server/pgStore.ts` inside `ensureSchema`, after the `briefings` table creation, add:

```ts
      await s`CREATE TABLE IF NOT EXISTS expenses (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS settlements (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS journal_entries (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS trip_settings (
        trip_id text PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
        currency_settings jsonb
      )`;
```

Match the surrounding indentation and the exact `await s\`` call style already used for the other tables.

- [ ] **Step 2: Extend pg getTrip**

In `pgStore.ts` `getTrip`, alongside the existing members/checks/tickets queries, add (mirroring how tickets rows are fetched — jsonb columns come back as parsed objects with the `postgres` driver, no `JSON.parse` needed):

```ts
  const expenseRows = await s`SELECT data FROM expenses WHERE trip_id = ${id} ORDER BY created_at`;
  const settlementRows = await s`SELECT data FROM settlements WHERE trip_id = ${id} ORDER BY created_at`;
  const journalRows = await s`SELECT data FROM journal_entries WHERE trip_id = ${id} ORDER BY created_at`;
  const settingsRows = await s`SELECT currency_settings FROM trip_settings WHERE trip_id = ${id}`;
```

and extend the returned payload with:

```ts
    expenses: expenseRows.map((r) => r.data as Expense),
    settlements: settlementRows.map((r) => r.data as Settlement),
    journal: journalRows.map((r) => r.data as JournalEntry),
    currencySettings:
      (settingsRows[0]?.currency_settings as CurrencySettings | null | undefined) ??
      DEFAULT_CURRENCY_SETTINGS,
```

Add `CurrencySettings`, `Expense`, `JournalEntry`, `Settlement` to the type import from `../tripShared`, and `DEFAULT_CURRENCY_SETTINGS` to the value import.

- [ ] **Step 3: Append pg CRUD**

Append to `pgStore.ts` (same shape as `addTicket`/`updateTicket`/`deleteTicket`; the version-bump helper in this file is `touch(tripId)`, and jsonb writes go through `s.json(JSON.parse(JSON.stringify(value)))` — copy that exact idiom):

```ts
async function insertJsonRow(
  table: "expenses" | "settlements" | "journal_entries",
  tripId: string,
  id: string,
  data: unknown
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const exists = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (exists.length === 0) return false;
  await s`INSERT INTO ${s(table)} (trip_id, id, data, created_at)
    VALUES (${tripId}, ${id}, ${s.json(JSON.parse(JSON.stringify(data)))}, ${Date.now()})`;
  await touch(tripId);
  return true;
}

async function updateJsonRow(
  table: "expenses" | "settlements" | "journal_entries",
  tripId: string,
  id: string,
  data: unknown
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`UPDATE ${s(table)} SET data = ${s.json(JSON.parse(JSON.stringify(data)))}
    WHERE trip_id = ${tripId} AND id = ${id}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

async function deleteJsonRow(
  table: "expenses" | "settlements" | "journal_entries",
  tripId: string,
  id: string
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`DELETE FROM ${s(table)}
    WHERE trip_id = ${tripId} AND id = ${id}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

export async function addExpense(tripId: string, expense: Expense): Promise<boolean> {
  return insertJsonRow("expenses", tripId, expense.id, expense);
}

export async function updateExpense(tripId: string, expense: Expense): Promise<boolean> {
  return updateJsonRow("expenses", tripId, expense.id, expense);
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<boolean> {
  return deleteJsonRow("expenses", tripId, expenseId);
}

export async function addSettlement(tripId: string, settlement: Settlement): Promise<boolean> {
  return insertJsonRow("settlements", tripId, settlement.id, settlement);
}

export async function deleteSettlement(tripId: string, settlementId: string): Promise<boolean> {
  return deleteJsonRow("settlements", tripId, settlementId);
}

export async function addJournalEntry(tripId: string, entry: JournalEntry): Promise<boolean> {
  return insertJsonRow("journal_entries", tripId, entry.id, entry);
}

export async function updateJournalEntry(tripId: string, entry: JournalEntry): Promise<boolean> {
  return updateJsonRow("journal_entries", tripId, entry.id, entry);
}

export async function deleteJournalEntry(tripId: string, entryId: string): Promise<boolean> {
  return deleteJsonRow("journal_entries", tripId, entryId);
}

export async function setCurrencySettings(
  tripId: string,
  settings: CurrencySettings
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const exists = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (exists.length === 0) return false;
  await s`INSERT INTO trip_settings (trip_id, currency_settings)
    VALUES (${tripId}, ${s.json(JSON.parse(JSON.stringify(settings)))})
    ON CONFLICT (trip_id) DO UPDATE SET currency_settings = EXCLUDED.currency_settings`;
  await touch(tripId);
  return true;
}
```

Caveat for the implementer: `s(table)` is postgres.js dynamic-identifier interpolation — safe here because the table name is a closed union type, and it avoids nine near-identical function bodies. `touch(tripId)` and the `s.json(JSON.parse(JSON.stringify(...)))` idiom match this file's existing helpers exactly (see `addTicket`/`updateTicket`).

- [ ] **Step 4: Extend the store facade**

Append to `lib/server/store.ts` (imports of the new types at the top: `Expense`, `Settlement`, `JournalEntry`, `CurrencySettings` from `../tripShared`):

```ts
export async function addExpense(tripId: string, expense: Expense): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).addExpense(tripId, expense);
  return sqlite.addExpense(tripId, expense);
}

export async function updateExpense(tripId: string, expense: Expense): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).updateExpense(tripId, expense);
  return sqlite.updateExpense(tripId, expense);
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).deleteExpense(tripId, expenseId);
  return sqlite.deleteExpense(tripId, expenseId);
}

export async function addSettlement(tripId: string, settlement: Settlement): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).addSettlement(tripId, settlement);
  return sqlite.addSettlement(tripId, settlement);
}

export async function deleteSettlement(tripId: string, settlementId: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).deleteSettlement(tripId, settlementId);
  return sqlite.deleteSettlement(tripId, settlementId);
}

export async function addJournalEntry(tripId: string, entry: JournalEntry): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).addJournalEntry(tripId, entry);
  return sqlite.addJournalEntry(tripId, entry);
}

export async function updateJournalEntry(tripId: string, entry: JournalEntry): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).updateJournalEntry(tripId, entry);
  return sqlite.updateJournalEntry(tripId, entry);
}

export async function deleteJournalEntry(tripId: string, entryId: string): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).deleteJournalEntry(tripId, entryId);
  return sqlite.deleteJournalEntry(tripId, entryId);
}

export async function setCurrencySettings(
  tripId: string,
  settings: CurrencySettings
): Promise<boolean> {
  if (storeMode() === "postgres") return (await pg()).setCurrencySettings(tripId, settings);
  return sqlite.setCurrencySettings(tripId, settings);
}
```

- [ ] **Step 5: Full test run + typecheck**

Run: `npm test`
Expected: PASS — every suite green.

Run: `npx tsc --noEmit`
Expected: clean. From this task on, both backends satisfy the extended required `TripPayload` fields; `tsc` must stay clean for the rest of the plan.

- [ ] **Step 6: Commit**

```bash
git add lib/server/pgStore.ts lib/server/store.ts
git commit -m "feat: postgres parity and store facade for money and journal records"
```

---

### Task 7: Photo store + capability flag

**Files:**
- Create: `lib/server/photoStore.ts`
- Modify: `lib/server/store.ts` (inject `features` into `getTrip` results)
- Test: `lib/server/photoStore.test.ts` (new)

**Interfaces:**
- Consumes: `newId` from `@/lib/id`; `PHOTO_REF_RE` from `./schemas` (Task 1).
- Produces:
  - `PHOTOS_UNSUPPORTED: string` (user-facing 503 hint)
  - `MAX_PHOTO_BYTES = 8 * 1024 * 1024`
  - `PHOTO_CONTENT_TYPES: Record<string, string>` — `image/jpeg → jpg`, `image/png → png`, `image/webp → webp`
  - `photoUploadsSupported(): boolean` — cached probe; always false on Vercel
  - `resetPhotoProbeForTests(): void`
  - `savePhoto(tripId: string, bytes: Buffer, contentType: string): string | null` — returns the stored ref (`<uuid>.<ext>`)
  - `readPhoto(tripId: string, ref: string): { bytes: Buffer; contentType: string } | null`
  - `deletePhoto(tripId: string, ref: string): void` — best-effort
  - `store.getTrip` results now carry `features: { photoUploads: boolean }`

- [ ] **Step 1: Write failing tests**

Create `lib/server/photoStore.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-photos-"));
process.env.CIP_UPLOADS_DIR = uploadsDir;

// Imported after the env override so the store uses the temp directory.
import {
  deletePhoto,
  photoUploadsSupported,
  readPhoto,
  resetPhotoProbeForTests,
  savePhoto,
} from "./photoStore";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("photoStore", () => {
  beforeAll(() => resetPhotoProbeForTests());
  afterAll(() => fs.rmSync(uploadsDir, { recursive: true, force: true }));

  test("uploads are supported on a writable filesystem", () => {
    expect(photoUploadsSupported()).toBe(true);
  });

  test("save → read round-trip preserves bytes and content type", () => {
    const ref = savePhoto("abc123def0", JPEG, "image/jpeg");
    expect(ref).toMatch(/^[a-z0-9-]+\.jpg$/);
    const photo = readPhoto("abc123def0", ref!);
    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe("image/jpeg");
    expect(Buffer.compare(photo!.bytes, JPEG)).toBe(0);
  });

  test("unknown content types are rejected", () => {
    expect(savePhoto("abc123def0", JPEG, "image/gif")).toBeNull();
    expect(savePhoto("abc123def0", JPEG, "text/html")).toBeNull();
  });

  test("hostile refs and trip ids never resolve", () => {
    for (const ref of ["../../../etc/passwd", "a/b.jpg", "x.exe", "..\\..\\x.jpg"]) {
      expect(readPhoto("abc123def0", ref)).toBeNull();
    }
    const ref = savePhoto("abc123def0", JPEG, "image/jpeg")!;
    expect(readPhoto("../abc123def0", ref)).toBeNull();
  });

  test("delete removes the file, deleting twice is harmless", () => {
    const ref = savePhoto("abc123def0", JPEG, "image/jpeg")!;
    deletePhoto("abc123def0", ref);
    expect(readPhoto("abc123def0", ref)).toBeNull();
    deletePhoto("abc123def0", ref); // no throw
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- photoStore`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `lib/server/photoStore.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { newId } from "@/lib/id";
import { PHOTO_REF_RE } from "./schemas";

export const PHOTOS_UNSUPPORTED =
  "Photo uploads need a writable disk (e.g. self-hosted). On this host, attach photos as https links instead.";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const PHOTO_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const TRIP_ID_RE = /^[a-z0-9-]{4,60}$/i;

/** Overridable for tests via CIP_UPLOADS_DIR. */
function uploadsRoot(): string {
  return process.env.CIP_UPLOADS_DIR ?? path.join(process.cwd(), "data", "uploads", "trips");
}

let probed: boolean | null = null;

/** Cached probe: can this host persist files? Serverless hosts cannot. */
export function photoUploadsSupported(): boolean {
  if (probed !== null) return probed;
  if (process.env.VERCEL) {
    probed = false;
    return false;
  }
  try {
    fs.mkdirSync(uploadsRoot(), { recursive: true });
    const probe = path.join(uploadsRoot(), ".probe");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    probed = true;
  } catch {
    probed = false;
  }
  return probed;
}

export function resetPhotoProbeForTests(): void {
  probed = null;
}

/** Both segments are validated before any path join — no user input in paths. */
function photoPath(tripId: string, ref: string): string | null {
  if (!TRIP_ID_RE.test(tripId) || !PHOTO_REF_RE.test(ref)) return null;
  return path.join(uploadsRoot(), tripId, ref);
}

/** Returns the stored ref ("<uuid>.<ext>") or null when unsupported/invalid. */
export function savePhoto(tripId: string, bytes: Buffer, contentType: string): string | null {
  const ext = PHOTO_CONTENT_TYPES[contentType];
  if (!ext || !photoUploadsSupported() || bytes.length > MAX_PHOTO_BYTES) return null;
  const ref = `${newId().toLowerCase()}.${ext}`;
  const target = photoPath(tripId, ref);
  if (!target) return null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return ref;
  } catch {
    return null;
  }
}

export function readPhoto(
  tripId: string,
  ref: string
): { bytes: Buffer; contentType: string } | null {
  const target = photoPath(tripId, ref);
  if (!target) return null;
  const ext = ref.slice(ref.lastIndexOf(".") + 1);
  const contentType = EXT_CONTENT_TYPES[ext];
  if (!contentType) return null;
  try {
    return { bytes: fs.readFileSync(target), contentType };
  } catch {
    return null;
  }
}

/** Best-effort: orphaned files are acceptable, crashes are not. */
export function deletePhoto(tripId: string, ref: string): void {
  const target = photoPath(tripId, ref);
  if (!target) return;
  try {
    fs.rmSync(target, { force: true });
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- photoStore`
Expected: PASS.

- [ ] **Step 5: Inject the capability flag into the facade**

In `lib/server/store.ts`, add `import { photoUploadsSupported } from "./photoStore";` and inside the existing `getTrip`, decorate every payload that leaves the function. The current function has three exit points; wrap them with a small helper placed just above `getTrip`:

```ts
function withFeatures(payload: TripPayload): TripPayload {
  return { ...payload, features: { photoUploads: photoUploadsSupported() } };
}
```

Then change the three returns inside `getTrip`:
- `if (!migration) return payload;` → `if (!migration) return withFeatures(payload);`
- `return p.getTrip(id, requestingMember);` (postgres migration branch) → `const fresh = await p.getTrip(id, requestingMember); return fresh ? withFeatures(fresh) : fresh;`
- `return sqlite.getTrip(id, requestingMember);` (sqlite migration branch) → `const fresh = sqlite.getTrip(id, requestingMember); return fresh ? withFeatures(fresh) : fresh;`

- [ ] **Step 6: Full test run + typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add lib/server/photoStore.ts lib/server/photoStore.test.ts lib/server/store.ts
git commit -m "feat: disk photo store with host capability probe"
```

---

### Task 8: Expense, settlement and currency API routes

**Files:**
- Create: `app/api/trips/[id]/expenses/route.ts`
- Create: `app/api/trips/[id]/expenses/[expenseId]/route.ts`
- Create: `app/api/trips/[id]/settlements/route.ts`
- Create: `app/api/trips/[id]/settlements/[settlementId]/route.ts`
- Create: `app/api/trips/[id]/currency/route.ts`

**Interfaces:**
- Consumes: schemas (Task 1), store facade (Task 6), `newId` from `@/lib/id`.
- Produces HTTP endpoints the UI (Tasks 10–12) calls. Every success response body is the fresh `TripPayload` (member view), exactly like the tickets routes. Every route: 503 when `storeMode() === "unavailable"`, 400 invalid JSON/schema, 403 non-member, 404 missing trip/record. Additionally 400 when `paidBy`/`splitAmong`/`from`/`to` name someone who is not currently a member.

There are no route-level unit tests in this repo (routes are thin adapters over tested stores/schemas); follow that convention. Verification is manual in Task 13.

- [ ] **Step 1: Create the expenses collection route**

Create `app/api/trips/[id]/expenses/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { Expense } from "@/lib/tripShared";
import { AddExpenseSchema } from "@/lib/server/schemas";
import { addExpense, DB_UNAVAILABLE, getTrip, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = AddExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid expense", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const memberNames = trip.members.map((m) => m.name);
  if (!memberNames.includes(parsed.data.memberName)) {
    return NextResponse.json({ error: "Only trip members can add expenses" }, { status: 403 });
  }
  const f = parsed.data.expense;
  const named = [f.paidBy, ...f.splitAmong];
  const unknown = named.find((n) => !memberNames.includes(n));
  if (unknown) {
    return NextResponse.json({ error: `"${unknown}" is not a trip member` }, { status: 400 });
  }

  const expense: Expense = {
    id: newId(),
    date: f.date,
    title: f.title,
    category: f.category,
    amount: f.amount,
    currency: f.currency,
    paidBy: f.paidBy,
    splitAmong: f.splitAmong,
    notes: f.notes ? f.notes : null,
    addedBy: parsed.data.memberName,
    createdAt: Date.now(),
  };
  await addExpense(id, expense);
  return NextResponse.json(await getTrip(id, parsed.data.memberName), { status: 201 });
}
```

- [ ] **Step 2: Create the single-expense route**

Create `app/api/trips/[id]/expenses/[expenseId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import type { Expense } from "@/lib/tripShared";
import { UpdateExpenseSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  deleteExpense,
  getTrip,
  isMember,
  storeMode,
  updateExpense,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string; expenseId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, expenseId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid expense", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  const existing = trip?.expenses.find((e) => e.id === expenseId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  const memberNames = trip.members.map((m) => m.name);
  if (!memberNames.includes(parsed.data.memberName)) {
    return NextResponse.json({ error: "Only trip members can edit expenses" }, { status: 403 });
  }

  const f = parsed.data.expense;
  const merged: Expense = {
    ...existing,
    date: f.date ?? existing.date,
    title: f.title ?? existing.title,
    category: f.category ?? existing.category,
    amount: f.amount ?? existing.amount,
    currency: f.currency ?? existing.currency,
    paidBy: f.paidBy ?? existing.paidBy,
    splitAmong: f.splitAmong ?? existing.splitAmong,
    notes: f.notes === undefined ? existing.notes : f.notes ? f.notes : null,
  };
  const named = [merged.paidBy, ...merged.splitAmong];
  const unknown = named.find((n) => !memberNames.includes(n));
  if (unknown) {
    return NextResponse.json({ error: `"${unknown}" is not a trip member` }, { status: 400 });
  }

  await updateExpense(id, merged);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, expenseId } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? "";
  if (!member || !(await isMember(id, member))) {
    return NextResponse.json({ error: "Only trip members can delete expenses" }, { status: 403 });
  }
  const deleted = await deleteExpense(id, expenseId);
  if (!deleted) {
    return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, member));
}
```

- [ ] **Step 3: Create the settlements routes**

Create `app/api/trips/[id]/settlements/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { Settlement } from "@/lib/tripShared";
import { AddSettlementSchema } from "@/lib/server/schemas";
import { addSettlement, DB_UNAVAILABLE, getTrip, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = AddSettlementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid settlement", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const memberNames = trip.members.map((m) => m.name);
  if (!memberNames.includes(parsed.data.memberName)) {
    return NextResponse.json(
      { error: "Only trip members can record repayments" },
      { status: 403 }
    );
  }
  const f = parsed.data.settlement;
  if (f.from === f.to) {
    return NextResponse.json({ error: "Payer and receiver must differ" }, { status: 400 });
  }
  const unknown = [f.from, f.to].find((n) => !memberNames.includes(n));
  if (unknown) {
    return NextResponse.json({ error: `"${unknown}" is not a trip member` }, { status: 400 });
  }

  const settlement: Settlement = {
    id: newId(),
    date: f.date,
    from: f.from,
    to: f.to,
    amount: f.amount,
    currency: f.currency,
    recordedBy: parsed.data.memberName,
    createdAt: Date.now(),
  };
  await addSettlement(id, settlement);
  return NextResponse.json(await getTrip(id, parsed.data.memberName), { status: 201 });
}
```

Create `app/api/trips/[id]/settlements/[settlementId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  DB_UNAVAILABLE,
  deleteSettlement,
  getTrip,
  isMember,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string; settlementId: string }> };

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, settlementId } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? "";
  if (!member || !(await isMember(id, member))) {
    return NextResponse.json(
      { error: "Only trip members can delete repayments" },
      { status: 403 }
    );
  }
  const deleted = await deleteSettlement(id, settlementId);
  if (!deleted) {
    return NextResponse.json({ error: "Repayment not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, member));
}
```

- [ ] **Step 4: Create the currency settings route**

Create `app/api/trips/[id]/currency/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { CurrencySettingsSchema } from "@/lib/server/schemas";
import {
  DB_UNAVAILABLE,
  getTrip,
  isMember,
  setCurrencySettings,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = CurrencySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid currency settings", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json(
      { error: "Only trip members can change currency settings" },
      { status: 403 }
    );
  }

  const saved = await setCurrencySettings(id, {
    home: parsed.data.home,
    rates: parsed.data.rates,
  });
  if (!saved) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected clean. Then:

```bash
git add "app/api/trips/[id]/expenses" "app/api/trips/[id]/settlements" "app/api/trips/[id]/currency"
git commit -m "feat: expense, settlement and currency API routes"
```

---

### Task 9: Journal and photo API routes

**Files:**
- Create: `app/api/trips/[id]/journal/route.ts`
- Create: `app/api/trips/[id]/journal/[entryId]/route.ts`
- Create: `app/api/trips/[id]/photos/route.ts`
- Create: `app/api/trips/[id]/photos/[photoId]/route.ts`

**Interfaces:**
- Consumes: schemas (Task 1), store facade (Task 6), photo store (Task 7).
- Produces: journal CRUD (author-only edits/deletes, upload cleanup on delete/edit) and photo upload/serve endpoints. Upload success body: `{ ref: string }` (201). Journal mutations return the fresh `TripPayload`.

- [ ] **Step 1: Create the journal collection route**

Create `app/api/trips/[id]/journal/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/id";
import type { JournalEntry } from "@/lib/tripShared";
import { AddJournalSchema } from "@/lib/server/schemas";
import { addJournalEntry, DB_UNAVAILABLE, getTrip, isMember, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = AddJournalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid journal entry", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json(
      { error: "Only trip members can write journal entries" },
      { status: 403 }
    );
  }

  const now = Date.now();
  const entry: JournalEntry = {
    id: newId(),
    date: parsed.data.entry.date,
    text: parsed.data.entry.text,
    photos: parsed.data.entry.photos,
    by: parsed.data.memberName,
    createdAt: now,
    updatedAt: now,
  };
  const added = await addJournalEntry(id, entry);
  if (!added) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(await getTrip(id, parsed.data.memberName), { status: 201 });
}
```

- [ ] **Step 2: Create the single-entry route (author-only, cleans up uploads)**

Create `app/api/trips/[id]/journal/[entryId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import type { JournalEntry } from "@/lib/tripShared";
import { UpdateJournalSchema } from "@/lib/server/schemas";
import { deletePhoto } from "@/lib/server/photoStore";
import {
  DB_UNAVAILABLE,
  deleteJournalEntry,
  getTrip,
  storeMode,
  updateJournalEntry,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string; entryId: string }> };

/** Best-effort removal of uploaded files no longer referenced by the entry. */
function cleanupUploads(tripId: string, before: JournalEntry, after: JournalEntry | null): void {
  const kept = new Set(
    (after?.photos ?? []).filter((p) => p.kind === "upload").map((p) => p.ref)
  );
  for (const photo of before.photos) {
    if (photo.kind === "upload" && !kept.has(photo.ref)) deletePhoto(tripId, photo.ref);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, entryId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateJournalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid journal entry", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const trip = await getTrip(id);
  const existing = trip?.journal.find((e) => e.id === entryId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  }
  if (existing.by !== parsed.data.memberName) {
    return NextResponse.json(
      { error: "Only the author can edit a journal entry" },
      { status: 403 }
    );
  }

  const f = parsed.data.entry;
  const merged: JournalEntry = {
    ...existing,
    date: f.date ?? existing.date,
    text: f.text ?? existing.text,
    photos: f.photos ?? existing.photos,
    updatedAt: Date.now(),
  };
  await updateJournalEntry(id, merged);
  cleanupUploads(id, existing, merged);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id, entryId } = await params;
  const member = req.nextUrl.searchParams.get("member") ?? "";

  const trip = await getTrip(id);
  const existing = trip?.journal.find((e) => e.id === entryId);
  if (!trip || !existing) {
    return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  }
  if (!member || existing.by !== member) {
    return NextResponse.json(
      { error: "Only the author can delete a journal entry" },
      { status: 403 }
    );
  }

  await deleteJournalEntry(id, entryId);
  cleanupUploads(id, existing, null);
  return NextResponse.json(await getTrip(id, member));
}
```

- [ ] **Step 3: Create the photo upload route**

Create `app/api/trips/[id]/photos/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import {
  MAX_PHOTO_BYTES,
  PHOTO_CONTENT_TYPES,
  PHOTOS_UNSUPPORTED,
  photoUploadsSupported,
  savePhoto,
} from "@/lib/server/photoStore";
import { DB_UNAVAILABLE, isMember, storeMode } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (!photoUploadsSupported()) {
    return NextResponse.json({ error: PHOTOS_UNSUPPORTED }, { status: 503 });
  }
  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const memberName = String(form.get("memberName") ?? "");
  const file = form.get("photo");
  if (!memberName || !(await isMember(id, memberName))) {
    return NextResponse.json({ error: "Only trip members can upload photos" }, { status: 403 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing photo file" }, { status: 400 });
  }
  if (!PHOTO_CONTENT_TYPES[file.type]) {
    return NextResponse.json({ error: "Only JPEG, PNG or WebP photos" }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo is larger than 8 MB" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ref = savePhoto(id, bytes, file.type);
  if (!ref) {
    return NextResponse.json({ error: "Could not store the photo" }, { status: 500 });
  }
  return NextResponse.json({ ref }, { status: 201 });
}
```

- [ ] **Step 4: Create the photo serve route**

Create `app/api/trips/[id]/photos/[photoId]/route.ts`. Access rule: knowing the unguessable trip id grants viewing, same as the rest of the trip payload:

```ts
import { NextRequest, NextResponse } from "next/server";
import { readPhoto } from "@/lib/server/photoStore";

type Params = { params: Promise<{ id: string; photoId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, photoId } = await params;
  const photo = readPhoto(id, photoId);
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected clean. Then:

```bash
git add "app/api/trips/[id]/journal" "app/api/trips/[id]/photos"
git commit -m "feat: journal and photo API routes with author-only edits"
```

---

### Task 10: Money tab UI

**Files:**
- Create: `components/trip/ExpenseForm.tsx`
- Create: `components/trip/BalancesCard.tsx`
- Create: `components/trip/MoneyTab.tsx`

**Interfaces:**
- Consumes: `lib/money.ts` (Tasks 2–3), `todayIso` from `lib/tracker.ts` (Task 4), `BarChart` from `components/briefing/charts/BarChart.tsx`, types from Task 1.
- Produces (Task 12 wires these):
  - `ExpenseForm` exports `interface ExpenseDraft { date: string; title: string; category: ExpenseCategory; amount: number; currency: string; paidBy: string; splitAmong: string[]; notes: string | null }`
  - `BalancesCard` exports `interface SettlementDraft { date: string; from: string; to: string; amount: number; currency: string }`
  - `MoneyTab` props: `{ expenses: Expense[]; settlements: Settlement[]; currencySettings: CurrencySettings; members: string[]; myName: string; isMember: boolean; onAddExpense(d: ExpenseDraft): Promise<string | null>; onUpdateExpense(id: string, d: ExpenseDraft): Promise<string | null>; onDeleteExpense(id: string): Promise<string | null>; onAddSettlement(d: SettlementDraft): Promise<string | null>; onDeleteSettlement(id: string): Promise<string | null>; onSaveCurrency(home: string | null, rates: Record<string, number>): Promise<string | null> }`

No component unit tests — the repo tests pure logic only; the money math these components render is covered by `lib/money.test.ts`. Styling follows the app's existing Tailwind vocabulary (`rounded-xl border border-sky bg-paper`, `text-ink-soft`, `bg-rail`, `text-seal`).

- [ ] **Step 1: Create ExpenseForm**

Create `components/trip/ExpenseForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { majorToMinor } from "@/lib/money";
import { todayIso } from "@/lib/tracker";
import type { Expense, ExpenseCategory } from "@/lib/tripShared";

export interface ExpenseDraft {
  date: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  paidBy: string;
  splitAmong: string[];
  notes: string | null;
}

export const CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: "food", label: "Food", emoji: "🍜" },
  { id: "transport", label: "Transport", emoji: "🚄" },
  { id: "lodging", label: "Lodging", emoji: "🏨" },
  { id: "tickets", label: "Tickets", emoji: "🎫" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "other", label: "Other", emoji: "💳" },
];

const QUICK_CURRENCIES = ["CNY", "SGD"];

type Props = {
  members: string[];
  myName: string;
  initial?: Expense;
  submitLabel: string;
  onSubmit: (draft: ExpenseDraft) => Promise<string | null>;
  onCancel?: () => void;
};

export function ExpenseForm({ members, myName, initial, submitLabel, onSubmit, onCancel }: Props) {
  const initialQuick = !initial || QUICK_CURRENCIES.includes(initial.currency);
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? "food");
  const [amount, setAmount] = useState(initial ? (initial.amount / 100).toFixed(2) : "");
  const [currencyPick, setCurrencyPick] = useState(
    initialQuick ? (initial?.currency ?? "CNY") : "other"
  );
  const [customCurrency, setCustomCurrency] = useState(initialQuick ? "" : initial!.currency);
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? myName);
  const [splitAmong, setSplitAmong] = useState<string[]>(
    initial && initial.splitAmong.length > 0 ? initial.splitAmong : members
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleSplit = (name: string) => {
    setSplitAmong((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const submit = async () => {
    const minor = majorToMinor(amount);
    const currency = (currencyPick === "other" ? customCurrency : currencyPick)
      .trim()
      .toUpperCase();
    if (!title.trim()) return setError("Give the expense a name.");
    if (minor === null) return setError("Enter an amount like 128 or 128.50.");
    if (!/^[A-Z]{3}$/.test(currency)) return setError("Currency must be a 3-letter code.");
    if (splitAmong.length === 0) return setError("Pick at least one person to split among.");
    setSaving(true);
    setError(null);
    const err = await onSubmit({
      date,
      title: title.trim(),
      category,
      amount: minor,
      currency,
      paidBy,
      splitAmong,
      notes: notes.trim() ? notes.trim() : null,
    });
    setSaving(false);
    if (err) return setError(err);
    if (!initial) {
      setTitle("");
      setAmount("");
      setNotes("");
    }
    onCancel?.();
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail";

  return (
    <div className="rounded-xl border border-sky bg-paper p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-ink-soft">
          What was it?
          <input type="text" value={title} maxLength={80} className={inputCls}
            onChange={(e) => setTitle(e.target.value)} placeholder="Hotpot dinner" />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Date
          <input type="date" value={date} className={inputCls}
            onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Amount
          <div className="mt-1 flex gap-2">
            <input type="text" inputMode="decimal" value={amount} placeholder="128.50"
              className="block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
              onChange={(e) => setAmount(e.target.value)} />
            <select value={currencyPick} aria-label="Currency"
              className="rounded-lg border border-sky bg-paper px-2 py-1.5 text-sm text-ink"
              onChange={(e) => setCurrencyPick(e.target.value)}>
              {QUICK_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="other">Other…</option>
            </select>
            {currencyPick === "other" && (
              <input type="text" value={customCurrency} maxLength={3} placeholder="USD"
                aria-label="Custom currency code"
                className="w-20 rounded-lg border border-sky bg-mist px-2 py-2 font-mono text-sm uppercase text-ink"
                onChange={(e) => setCustomCurrency(e.target.value.toUpperCase())} />
            )}
          </div>
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Paid by
          <select value={paidBy} className={inputCls} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-ink-soft">Category</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                category === c.id ? "bg-rail text-white" : "bg-mist text-ink-soft hover:bg-sky"
              }`}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-ink-soft">Split among</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button key={m} type="button" onClick={() => toggleSplit(m)}
              aria-pressed={splitAmong.includes(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                splitAmong.includes(m) ? "bg-rail text-white" : "bg-mist text-ink-soft hover:bg-sky"
              }`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Notes (optional)
        <input type="text" value={notes} maxLength={300} className={inputCls}
          onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => void submit()} disabled={saving}
          className="rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-50">
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="text-sm text-ink-soft hover:text-ink">
            Cancel
          </button>
        )}
        {error && <span className="text-xs text-seal">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create BalancesCard**

Create `components/trip/BalancesCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  formatMinor,
  majorToMinor,
  settleUp,
  type CurrencyBalances,
} from "@/lib/money";
import { todayIso } from "@/lib/tracker";
import type { Settlement } from "@/lib/tripShared";

export interface SettlementDraft {
  date: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
}

type Props = {
  currencies: CurrencyBalances[];
  settlements: Settlement[];
  isMember: boolean;
  onAddSettlement: (draft: SettlementDraft) => Promise<string | null>;
  onDeleteSettlement: (id: string) => Promise<string | null>;
};

export function BalancesCard({
  currencies,
  settlements,
  isMember,
  onAddSettlement,
  onDeleteSettlement,
}: Props) {
  // Key of the transfer currently being confirmed: "CNY:Bob:Ada".
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startConfirm = (key: string, amountMinor: number) => {
    setConfirming(key);
    setConfirmAmount((amountMinor / 100).toFixed(2));
    setError(null);
  };

  const recordRepayment = async (from: string, to: string, currency: string) => {
    const minor = majorToMinor(confirmAmount);
    if (minor === null) return setError("Enter an amount like 62.25.");
    setBusy(true);
    const err = await onAddSettlement({ date: todayIso(), from, to, amount: minor, currency });
    setBusy(false);
    if (err) return setError(err);
    setConfirming(null);
  };

  if (currencies.length === 0 && settlements.length === 0) {
    return (
      <div className="rounded-xl border border-sky bg-paper p-5 text-sm text-ink-soft">
        All square — no outstanding balances.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky bg-paper p-5">
      <h3 className="font-display text-lg font-semibold">Who owes whom</h3>

      {currencies.length === 0 && (
        <p className="mt-2 text-sm text-ink-soft">All square — no outstanding balances.</p>
      )}

      {currencies.map(({ currency, balances }) => (
        <div key={currency} className="mt-3">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">{currency}</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {balances.map((b) => (
              <li key={b.member} className="flex justify-between">
                <span>{b.member}</span>
                <span className={b.net > 0 ? "font-medium text-rail" : "font-medium text-seal"}>
                  {b.net > 0 ? "is owed " : "owes "}
                  {formatMinor(Math.abs(b.net), currency)}
                </span>
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-1.5">
            {settleUp(balances).map((t) => {
              const key = `${currency}:${t.from}:${t.to}`;
              return (
                <li key={key}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-mist px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{t.from}</span> →{" "}
                    <span className="font-medium">{t.to}</span>:{" "}
                    {formatMinor(t.amount, currency)}
                  </span>
                  {isMember && confirming !== key && (
                    <button type="button" onClick={() => startConfirm(key, t.amount)}
                      className="ml-auto rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white hover:bg-rail-deep">
                      Mark repaid
                    </button>
                  )}
                  {isMember && confirming === key && (
                    <span className="ml-auto flex items-center gap-2">
                      <input type="text" inputMode="decimal" value={confirmAmount}
                        aria-label="Repaid amount"
                        className="w-24 rounded-lg border border-sky bg-paper px-2 py-1 text-xs text-ink"
                        onChange={(e) => setConfirmAmount(e.target.value)} />
                      <button type="button" disabled={busy}
                        onClick={() => void recordRepayment(t.from, t.to, currency)}
                        className="rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                        {busy ? "…" : "Confirm"}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}
                        className="text-xs text-ink-soft hover:text-ink">
                        Cancel
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {error && <p className="mt-2 text-xs text-seal">{error}</p>}

      {settlements.length > 0 && (
        <div className="mt-4 border-t border-sky pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Repayments</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="text-ink-soft">{s.date}</span>
                <span>
                  {s.from} → {s.to}: {formatMinor(s.amount, s.currency)}
                </span>
                {isMember && (
                  <button type="button" onClick={() => void onDeleteSettlement(s.id)}
                    aria-label={`Delete repayment ${s.from} to ${s.to}`}
                    className="ml-auto text-xs text-ink-soft hover:text-seal">
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create MoneyTab**

Create `components/trip/MoneyTab.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/briefing/charts/BarChart";
import {
  balancesByCurrency,
  convertedTotals,
  formatMinor,
  totalsByCurrency,
} from "@/lib/money";
import type { CurrencySettings, Expense, ExpenseCategory, Settlement } from "@/lib/tripShared";
import { BalancesCard, type SettlementDraft } from "./BalancesCard";
import { CATEGORIES, ExpenseForm, type ExpenseDraft } from "./ExpenseForm";

type Props = {
  expenses: Expense[];
  settlements: Settlement[];
  currencySettings: CurrencySettings;
  members: string[];
  myName: string;
  isMember: boolean;
  onAddExpense: (d: ExpenseDraft) => Promise<string | null>;
  onUpdateExpense: (id: string, d: ExpenseDraft) => Promise<string | null>;
  onDeleteExpense: (id: string) => Promise<string | null>;
  onAddSettlement: (d: SettlementDraft) => Promise<string | null>;
  onDeleteSettlement: (id: string) => Promise<string | null>;
  onSaveCurrency: (home: string | null, rates: Record<string, number>) => Promise<string | null>;
};

const categoryMeta = (id: ExpenseCategory) => CATEGORIES.find((c) => c.id === id)!;

export function MoneyTab({
  expenses,
  settlements,
  currencySettings,
  members,
  myName,
  isMember,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  onAddSettlement,
  onDeleteSettlement,
  onSaveCurrency,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const totals = useMemo(() => totalsByCurrency(expenses), [expenses]);
  const converted = useMemo(
    () => convertedTotals(totals, currencySettings),
    [totals, currencySettings]
  );
  const balances = useMemo(
    () => balancesByCurrency(expenses, settlements, members),
    [expenses, settlements, members]
  );

  // Expenses grouped by date, newest day first, insertion order within a day.
  const byDate = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const e of [...expenses].sort((a, b) => b.date.localeCompare(a.date))) {
      const list = groups.get(e.date) ?? [];
      list.push(e);
      groups.set(e.date, list);
    }
    return [...groups.entries()];
  }, [expenses]);

  const categorySlices = useMemo(() => {
    return totals.map(({ currency }) => ({
      currency,
      slices: CATEGORIES.map((c) => ({
        label: `${c.emoji} ${c.label}`,
        value: Math.round(
          expenses
            .filter((e) => e.currency === currency && e.category === c.id)
            .reduce((a, e) => a + e.amount, 0) / 100
        ),
      })).filter((s) => s.value > 0),
    })).filter((c) => c.slices.length > 0);
  }, [expenses, totals]);

  const removeExpense = async (id: string) => {
    setListError(null);
    const err = await onDeleteExpense(id);
    if (err) setListError(err);
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-sky bg-paper p-5">
        <h3 className="font-display text-lg font-semibold">Spend so far</h3>
        {totals.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            Nothing logged yet — add the first expense below.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {totals.map((t) => (
              <li key={t.currency} className="flex justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                  {t.currency}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {converted && (
          <div className="mt-3 border-t border-sky pt-2 text-sm">
            <p className="flex justify-between">
              <span className="text-ink-soft">Total CNY</span>
              <span className="font-semibold tabular-nums">{formatMinor(converted.cny, "CNY")}</span>
            </p>
            {converted.home && converted.home.currency !== "CNY" && (
              <p className="flex justify-between">
                <span className="text-ink-soft">Total {converted.home.currency}</span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(converted.home.amount, converted.home.currency)}
                </span>
              </p>
            )}
            {converted.unconverted.length > 0 && (
              <p className="mt-1 text-xs text-ink-soft">
                No rate set for{" "}
                {converted.unconverted.map((u) => u.currency).join(", ")} — shown in the sums
                above but left out of the converted totals.
              </p>
            )}
          </div>
        )}
        {isMember && (
          <CurrencySettingsEditor
            currencySettings={currencySettings}
            usedCurrencies={totals.map((t) => t.currency)}
            onSave={onSaveCurrency}
          />
        )}
      </div>

      <BalancesCard
        currencies={balances}
        settlements={settlements}
        isMember={isMember}
        onAddSettlement={onAddSettlement}
        onDeleteSettlement={onDeleteSettlement}
      />

      {categorySlices.map((c) => (
        <BarChart
          key={c.currency}
          title={`By category · ${c.currency}`}
          slices={c.slices}
          unit={c.currency}
        />
      ))}

      {isMember && !adding && !editingId && (
        <button type="button" onClick={() => setAdding(true)}
          className="rounded-lg border border-dashed border-rail/50 px-4 py-2 text-sm font-semibold text-rail transition-colors hover:bg-sky">
          + Add expense
        </button>
      )}
      {adding && (
        <ExpenseForm
          members={members}
          myName={myName}
          submitLabel="Add expense"
          onSubmit={onAddExpense}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="space-y-3">
        {byDate.map(([date, list]) => (
          <div key={date}>
            <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">{date}</p>
            <ul className="mt-1.5 space-y-1.5">
              {list.map((e) =>
                editingId === e.id ? (
                  <li key={e.id}>
                    <ExpenseForm
                      members={members}
                      myName={myName}
                      initial={e}
                      submitLabel="Save changes"
                      onSubmit={(d) => onUpdateExpense(e.id, d)}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <li key={e.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-sky bg-paper px-4 py-2.5 text-sm">
                    <span aria-hidden>{categoryMeta(e.category).emoji}</span>
                    <span className="font-medium">{e.title}</span>
                    <span className="text-xs text-ink-soft">
                      {e.paidBy} paid
                      {e.splitAmong.length > 0 && e.splitAmong.length < members.length
                        ? ` · split ${e.splitAmong.length}-way`
                        : " · split all"}
                    </span>
                    <span className="ml-auto font-semibold tabular-nums">
                      {formatMinor(e.amount, e.currency)}
                    </span>
                    {isMember && (
                      <span className="flex gap-2">
                        <button type="button" onClick={() => setEditingId(e.id)}
                          className="text-xs text-ink-soft hover:text-ink">
                          Edit
                        </button>
                        <button type="button" onClick={() => void removeExpense(e.id)}
                          className="text-xs text-ink-soft hover:text-seal">
                          Delete
                        </button>
                      </span>
                    )}
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
        {listError && <p className="text-xs text-seal">{listError}</p>}
      </div>
    </div>
  );
}

function CurrencySettingsEditor({
  currencySettings,
  usedCurrencies,
  onSave,
}: {
  currencySettings: CurrencySettings;
  usedCurrencies: string[];
  onSave: (home: string | null, rates: Record<string, number>) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(currencySettings.home ?? "");
  const [rateInputs, setRateInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(currencySettings.rates).map(([c, r]) => [c, String(r)])
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Every currency worth rating: seen in expenses or already rated, CNY excluded.
  const rateCurrencies = [
    ...new Set([...usedCurrencies, ...Object.keys(currencySettings.rates), home].filter(Boolean)),
  ]
    .filter((c) => c !== "CNY")
    .sort();

  const save = async () => {
    const rates: Record<string, number> = {};
    for (const [c, v] of Object.entries(rateInputs)) {
      if (!v.trim()) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return setError(`Rate for ${c} must be a positive number.`);
      rates[c] = n;
    }
    const homeCode = home.trim().toUpperCase();
    if (homeCode && !/^[A-Z]{3}$/.test(homeCode)) {
      return setError("Home currency must be a 3-letter code.");
    }
    setSaving(true);
    setError(null);
    const err = await onSave(homeCode || null, rates);
    setSaving(false);
    if (err) return setError(err);
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 text-xs font-medium text-rail hover:underline">
        {currencySettings.home ? "Edit conversion rates" : "Set up converted totals"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-mist p-3 text-sm">
      <label className="text-xs font-medium text-ink-soft">
        Home currency (blank = no conversion)
        <input type="text" value={home} maxLength={3} placeholder="SGD"
          className="mt-1 block w-24 rounded-lg border border-sky bg-paper px-2 py-1.5 font-mono text-sm uppercase text-ink"
          onChange={(e) => setHome(e.target.value.toUpperCase())} />
      </label>
      {rateCurrencies.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {rateCurrencies.map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-ink-soft">
              <span className="w-16 font-mono uppercase">1 {c} =</span>
              <input type="text" inputMode="decimal" value={rateInputs[c] ?? ""}
                placeholder="5.20"
                className="w-24 rounded-lg border border-sky bg-paper px-2 py-1 text-sm text-ink"
                onChange={(e) =>
                  setRateInputs((prev) => ({ ...prev, [c]: e.target.value }))
                } />
              <span>CNY</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-rail px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save rates"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="text-xs text-ink-soft hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-xs text-seal">{error}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit` — expected clean (components compile standalone; wiring comes in Task 12).

```bash
git add components/trip/ExpenseForm.tsx components/trip/BalancesCard.tsx components/trip/MoneyTab.tsx
git commit -m "feat: money tab with expense form, balances and converted totals"
```

---

### Task 11: Tracker tab UI

**Files:**
- Create: `components/trip/JournalSection.tsx`
- Create: `components/trip/TrackerTab.tsx`

**Interfaces:**
- Consumes: `lib/tracker.ts` (Task 4), `lib/money.ts` (Tasks 2–3), `getDestination` from `@/lib/data`, `itemCheckKey`/`packingCheckKey` and types from Task 1, photo routes (Task 9).
- Produces (Task 12 wires these):
  - `JournalSection` exports `interface JournalDraft { date: string; text: string; photos: JournalPhoto[] }`; props `{ tripId: string; journal: JournalEntry[]; myName: string; isMember: boolean; photoUploads: boolean; defaultDate: string; onAdd(d: JournalDraft): Promise<string | null>; onUpdate(id: string, d: Partial<JournalDraft>): Promise<string | null>; onDelete(id: string): Promise<string | null> }`
  - `TrackerTab` props `{ payload: TripPayload; myName: string; isMember: boolean; onToggle(key: string, checked: boolean): void; onAddJournal(d: JournalDraft): Promise<string | null>; onUpdateJournal(id: string, d: Partial<JournalDraft>): Promise<string | null>; onDeleteJournal(id: string): Promise<string | null>; onOpenMoney(): void }`

- [ ] **Step 1: Create JournalSection**

Create `components/trip/JournalSection.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { JournalEntry, JournalPhoto } from "@/lib/tripShared";

export interface JournalDraft {
  date: string;
  text: string;
  photos: JournalPhoto[];
}

type Props = {
  tripId: string;
  journal: JournalEntry[];
  myName: string;
  isMember: boolean;
  photoUploads: boolean;
  defaultDate: string;
  onAdd: (d: JournalDraft) => Promise<string | null>;
  onUpdate: (id: string, d: Partial<JournalDraft>) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
};

function photoUrl(tripId: string, photo: JournalPhoto): string {
  return photo.kind === "upload" ? `/api/trips/${tripId}/photos/${photo.ref}` : photo.ref;
}

export function JournalSection({
  tripId,
  journal,
  myName,
  isMember,
  photoUploads,
  defaultDate,
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [date, setDate] = useState(defaultDate);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<JournalPhoto[]>([]);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const byDate = useMemo(() => {
    const groups = new Map<string, JournalEntry[]>();
    for (const e of [...journal].sort(
      (a, b) => b.date.localeCompare(a.date) || a.createdAt - b.createdAt
    )) {
      const list = groups.get(e.date) ?? [];
      list.push(e);
      groups.set(e.date, list);
    }
    return [...groups.entries()];
  }, [journal]);

  const uploadPhoto = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("memberName", myName);
      form.append("photo", file);
      const res = await fetch(`/api/trips/${tripId}/photos`, { method: "POST", body: form });
      const json: unknown = await res.json();
      if (!res.ok) {
        const message = (json as { error?: unknown }).error;
        setError(typeof message === "string" ? message : "Couldn't upload the photo.");
        return;
      }
      const ref = (json as { ref: string }).ref;
      setPhotos((prev) => [...prev, { kind: "upload", ref }]);
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  const addLink = () => {
    const url = link.trim();
    if (!/^https:\/\/\S+$/.test(url)) return setError("Photo links must start with https://");
    setPhotos((prev) => [...prev, { kind: "link", ref: url }]);
    setLink("");
    setError(null);
  };

  const submit = async () => {
    if (!text.trim()) return setError("Write something first.");
    setBusy(true);
    setError(null);
    const err = await onAdd({ date, text: text.trim(), photos });
    setBusy(false);
    if (err) return setError(err);
    setText("");
    setPhotos([]);
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return setError("An entry can't be empty — delete it instead.");
    setBusy(true);
    const err = await onUpdate(id, { text: editText.trim() });
    setBusy(false);
    if (err) return setError(err);
    setEditingId(null);
  };

  return (
    <div className="rounded-xl border border-sky bg-paper p-5">
      <h3 className="font-display text-lg font-semibold">Trip journal</h3>

      {isMember && (
        <div className="mt-3 rounded-lg bg-mist p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-ink-soft">
              Day
              <input type="date" value={date}
                className="ml-2 rounded-lg border border-sky bg-paper px-2 py-1 text-sm text-ink"
                onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <textarea value={text} rows={3} maxLength={5000}
            placeholder="What happened today?"
            className="mt-2 block w-full rounded-lg border border-sky bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
            onChange={(e) => setText(e.target.value)} />
          {photos.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <li key={`${p.ref}-${i}`} className="relative">
                  {p.kind === "upload" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(tripId, p)} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  ) : (
                    <span className="inline-block max-w-40 truncate rounded-lg bg-paper px-2 py-1 text-xs">
                      🔗 {p.ref}
                    </span>
                  )}
                  <button type="button" aria-label="Remove photo"
                    onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-seal text-[10px] text-white">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {photoUploads && (
              <label className="cursor-pointer rounded-lg border border-sky bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sky">
                📷 Add photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadPhoto(file);
                    e.target.value = "";
                  }} />
              </label>
            )}
            <input type="url" value={link} placeholder="https:// photo link"
              className="w-48 rounded-lg border border-sky bg-paper px-2 py-1.5 text-xs text-ink"
              onChange={(e) => setLink(e.target.value)} />
            <button type="button" onClick={addLink}
              className="rounded-lg border border-sky bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sky">
              Attach link
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy}
              className="ml-auto rounded-lg bg-rail px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Add entry"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-seal">{error}</p>}
        </div>
      )}

      {byDate.length === 0 && (
        <p className="mt-3 text-sm text-ink-soft">No entries yet — the diary starts with you.</p>
      )}

      <div className="mt-4 space-y-4">
        {byDate.map(([day, entries]) => (
          <div key={day}>
            <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">{day}</p>
            <ul className="mt-1.5 space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="rounded-lg border border-sky bg-mist/40 p-3 text-sm">
                  <p className="text-xs font-medium text-rail">{e.by}</p>
                  {editingId === e.id ? (
                    <div className="mt-1">
                      <textarea value={editText} rows={3} maxLength={5000}
                        className="block w-full rounded-lg border border-sky bg-paper px-3 py-2 text-sm text-ink"
                        onChange={(ev) => setEditText(ev.target.value)} />
                      <div className="mt-1.5 flex gap-2">
                        <button type="button" disabled={busy} onClick={() => void saveEdit(e.id)}
                          className="rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}
                          className="text-xs text-ink-soft hover:text-ink">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap">{e.text}</p>
                  )}
                  {e.photos.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {e.photos.map((p, i) => (
                        <li key={`${p.ref}-${i}`}>
                          {p.kind === "upload" ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={photoUrl(tripId, p)} alt={`Photo by ${e.by}`}
                              className="h-24 w-24 rounded-lg object-cover" />
                          ) : (
                            <a href={p.ref} target="_blank" rel="noopener noreferrer"
                              className="inline-block max-w-48 truncate rounded-lg bg-paper px-2 py-1 text-xs text-rail hover:underline">
                              🔗 photo link
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isMember && e.by === myName && editingId !== e.id && (
                    <div className="mt-2 flex gap-3">
                      <button type="button"
                        onClick={() => {
                          setEditingId(e.id);
                          setEditText(e.text);
                        }}
                        className="text-xs text-ink-soft hover:text-ink">
                        Edit
                      </button>
                      <button type="button" onClick={() => void onDelete(e.id)}
                        className="text-xs text-ink-soft hover:text-seal">
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TrackerTab**

Create `components/trip/TrackerTab.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { getDestination } from "@/lib/data";
import { expensesOnDate, formatMinor, totalsByCurrency } from "@/lib/money";
import { dayDate } from "@/lib/tickets";
import {
  citiesSoFar,
  nowNext,
  progress,
  railKmSoFar,
  slotForHour,
  todayIso,
  trackerState,
} from "@/lib/tracker";
import { itemCheckKey, packingCheckKey, type TripPayload } from "@/lib/tripShared";
import { JournalSection, type JournalDraft } from "./JournalSection";

type Props = {
  payload: TripPayload;
  myName: string;
  isMember: boolean;
  onToggle: (key: string, checked: boolean) => void;
  onAddJournal: (d: JournalDraft) => Promise<string | null>;
  onUpdateJournal: (id: string, d: Partial<JournalDraft>) => Promise<string | null>;
  onDeleteJournal: (id: string) => Promise<string | null>;
  onOpenMoney: () => void;
};

const MINUTE_MS = 60_000;

export function TrackerTab({
  payload,
  myName,
  isMember,
  onToggle,
  onAddJournal,
  onUpdateJournal,
  onDeleteJournal,
  onOpenMoney,
}: Props) {
  // Re-render every minute so "now / next" tracks the clock, not just polls.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  const { data, checks, expenses, journal } = payload;
  const days = data.plan.days;
  const today = todayIso(now);
  const state = trackerState(data.startDate, days.length, today);
  const checkedKeys = useMemo(() => new Set(checks.map((c) => c.key)), [checks]);

  const overall = progress(days, checkedKeys);
  const photoUploads = payload.features?.photoUploads ?? false;

  const journalSection = (
    <JournalSection
      tripId={payload.id}
      journal={journal}
      myName={myName}
      isMember={isMember}
      photoUploads={photoUploads}
      defaultDate={today}
      onAdd={onAddJournal}
      onUpdate={onUpdateJournal}
      onDelete={onDeleteJournal}
    />
  );

  if (state.phase === "no-date" || state.phase === "before") {
    const packingTotal = data.packing.reduce((a, g) => a + g.items.length, 0);
    const packingDone = data.packing.reduce(
      (a, g) => a + g.items.filter((i) => checkedKeys.has(packingCheckKey(g.title, i))).length,
      0
    );
    return (
      <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-sky bg-paper p-5 text-center">
          {state.phase === "before" ? (
            <>
              <p className="font-display text-3xl font-bold text-rail">
                {state.daysToGo} day{state.daysToGo === 1 ? "" : "s"} to go
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {data.tripName} departs {data.startDate}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-xl font-semibold">No start date yet</p>
              <p className="mt-1 text-sm text-ink-soft">
                Set one when creating or editing the trip and this tab becomes a live countdown,
                then a day-by-day tracker.
              </p>
            </>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-mist p-3">
              <p className="font-semibold tabular-nums">
                {packingDone}/{packingTotal}
              </p>
              <p className="text-xs text-ink-soft">packing ticked</p>
            </div>
            <div className="rounded-lg bg-mist p-3">
              <p className="font-semibold tabular-nums">{payload.tickets.length}</p>
              <p className="text-xs text-ink-soft">tickets on file</p>
            </div>
          </div>
        </div>
        {journalSection}
      </div>
    );
  }

  const doneIndex = state.phase === "after" ? days.length : state.dayIndex!;
  const cities = citiesSoFar(days, doneIndex);
  const km = railKmSoFar(days, doneIndex, (id) => {
    const d = getDestination(id);
    return d ? { lat: d.lat, lon: d.lon } : null;
  });
  const tripTotals = totalsByCurrency(expenses);

  const statsStrip = (
    <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
      <div className="rounded-xl border border-sky bg-paper p-3">
        <p className="font-display text-xl font-bold text-rail">{cities.length}</p>
        <p className="text-xs text-ink-soft">cities reached</p>
      </div>
      <div className="rounded-xl border border-sky bg-paper p-3">
        <p className="font-display text-xl font-bold text-rail">{km > 0 ? `${km} km` : "—"}</p>
        <p className="text-xs text-ink-soft">by rail so far</p>
      </div>
      <div className="rounded-xl border border-sky bg-paper p-3">
        <p className="font-display text-xl font-bold text-rail">
          {overall.done}/{overall.total}
        </p>
        <p className="text-xs text-ink-soft">activities done</p>
      </div>
      <div className="rounded-xl border border-sky bg-paper p-3">
        <p className="font-display text-xl font-bold text-rail">{journal.length}</p>
        <p className="text-xs text-ink-soft">journal entries</p>
      </div>
    </div>
  );

  if (state.phase === "after") {
    return (
      <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-sky bg-paper p-5 text-center">
          <p className="font-display text-2xl font-bold">That&apos;s a wrap 🏮</p>
          <p className="mt-1 text-sm text-ink-soft">
            {days.length} days · {cities.join(" → ")}
          </p>
          {tripTotals.length > 0 && (
            <p className="mt-2 text-sm">
              Total spend:{" "}
              {tripTotals.map((t) => formatMinor(t.amount, t.currency)).join(" + ")}
            </p>
          )}
        </div>
        {statsStrip}
        {journalSection}
      </div>
    );
  }

  // During the trip.
  const dayIndex = state.dayIndex!;
  const todayPlan = days.find((d) => d.day === dayIndex) ?? null;
  const slot = slotForHour(now.getHours());
  const guide = todayPlan ? nowNext(todayPlan, checkedKeys, slot) : { current: null, next: null };
  const todaySpend = totalsByCurrency(expensesOnDate(expenses, today));
  const pct = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl bg-rail-deep p-5 text-white">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-sky">
          Day {dayIndex} of {days.length}
        </p>
        <p className="mt-1 font-display text-2xl font-bold">
          {todayPlan ? todayPlan.destinationName : data.tripName}
        </p>
        <div className="mt-3 h-2 rounded-full bg-white/20" aria-hidden>
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-sky">
          {overall.done} of {overall.total} activities ticked · {pct}%
        </p>
      </div>

      <div className="rounded-xl border border-sky bg-paper p-5">
        <h3 className="font-display text-lg font-semibold">Now &amp; next</h3>
        {guide.current ? (
          <p className="mt-2 text-sm">
            <span className="rounded bg-seal px-1.5 py-0.5 text-[10px] font-mono text-white">
              NOW
            </span>{" "}
            {guide.current.title}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Nothing due right now.</p>
        )}
        {guide.next && (
          <p className="mt-1.5 text-sm">
            <span className="rounded bg-rail px-1.5 py-0.5 text-[10px] font-mono text-white">
              NEXT
            </span>{" "}
            {guide.next.title}
          </p>
        )}
        {!guide.current && !guide.next && todayPlan && (
          <p className="mt-1 text-sm">All of today&apos;s plan is ticked off — enjoy! 🎉</p>
        )}
      </div>

      {todayPlan && (
        <div className="rounded-xl border border-sky bg-paper p-5">
          <h3 className="font-display text-lg font-semibold">Today&apos;s plan</h3>
          <ul className="mt-2 space-y-1.5">
            {todayPlan.items.map((item) => {
              const key = itemCheckKey(item.id);
              const by = checks.find((c) => c.key === key)?.by;
              return (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" checked={by !== undefined} disabled={!isMember}
                      onChange={(e) => onToggle(key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-rail" />
                    <span className={by ? "text-ink-soft line-through" : ""}>
                      <span className="mr-1 font-mono text-[10px] uppercase text-ink-soft">
                        {item.slot}
                      </span>
                      {item.title}
                      {by && <span className="ml-1 text-[11px] text-rail"> · {by}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-sky bg-paper p-5">
        <h3 className="font-display text-lg font-semibold">Spend</h3>
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-ink-soft">Today</p>
            {todaySpend.length === 0 ? (
              <p className="text-ink-soft">Nothing yet</p>
            ) : (
              todaySpend.map((t) => (
                <p key={t.currency} className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency)}
                </p>
              ))
            )}
          </div>
          <div>
            <p className="text-xs text-ink-soft">Whole trip</p>
            {tripTotals.length === 0 ? (
              <p className="text-ink-soft">Nothing yet</p>
            ) : (
              tripTotals.map((t) => (
                <p key={t.currency} className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency)}
                </p>
              ))
            )}
          </div>
        </div>
        <button type="button" onClick={onOpenMoney}
          className="mt-3 text-xs font-medium text-rail hover:underline">
          Open the Money tab →
        </button>
      </div>

      {statsStrip}
      {journalSection}
    </div>
  );
}
```

Note for the implementer: `dayDate` is imported but only needed if you choose to label the "Today's plan" card with its calendar date — `dayDate(data.startDate, dayIndex)` returns it. Either use it in the heading (nice touch) or drop the import; do not leave an unused import.

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add components/trip/JournalSection.tsx components/trip/TrackerTab.tsx
git commit -m "feat: tracker tab with today dashboard, journal and stats"
```

---

### Task 12: Wire the tabs into TripView

**Files:**
- Modify: `components/TripView.tsx`

**Interfaces:**
- Consumes: `MoneyTab` + `ExpenseDraft` + `SettlementDraft` (Task 10), `TrackerTab` + `JournalDraft` (Task 11), the existing `mutate`/`jsonInit` helpers already in `TripView.tsx`.
- Produces: the user-visible tabs. Tab order: `Itinerary, Tracker, Money, Tickets, Packing, Crew, Briefing`.

- [ ] **Step 1: Extend imports and the tab list**

In `components/TripView.tsx`:

```tsx
import { MoneyTab } from "@/components/trip/MoneyTab";
import type { ExpenseDraft } from "@/components/trip/ExpenseForm";
import type { SettlementDraft } from "@/components/trip/BalancesCard";
import { TrackerTab } from "@/components/trip/TrackerTab";
import type { JournalDraft } from "@/components/trip/JournalSection";
```

Change the tab constant:

```tsx
const TABS = ["Itinerary", "Tracker", "Money", "Tickets", "Packing", "Crew", "Briefing"] as const;
```

Seven pills can wrap on a phone — change the nav container class from `mt-6 flex gap-2 print:hidden` to `mt-6 flex flex-wrap gap-2 print:hidden`.

- [ ] **Step 2: Add mutation handlers**

Below the existing `deleteTicket` handler add:

```tsx
  const addExpense = (expense: ExpenseDraft) =>
    mutate(`/api/trips/${tripId}/expenses`, jsonInit("POST", { memberName: myName, expense }));
  const updateExpense = (expenseId: string, expense: ExpenseDraft) =>
    mutate(
      `/api/trips/${tripId}/expenses/${expenseId}`,
      jsonInit("PATCH", { memberName: myName, expense })
    );
  const deleteExpense = (expenseId: string) =>
    mutate(`/api/trips/${tripId}/expenses/${expenseId}?member=${encodeURIComponent(myName)}`, {
      method: "DELETE",
    });
  const addSettlement = (settlement: SettlementDraft) =>
    mutate(`/api/trips/${tripId}/settlements`, jsonInit("POST", { memberName: myName, settlement }));
  const deleteSettlement = (settlementId: string) =>
    mutate(
      `/api/trips/${tripId}/settlements/${settlementId}?member=${encodeURIComponent(myName)}`,
      { method: "DELETE" }
    );
  const saveCurrency = (home: string | null, rates: Record<string, number>) =>
    mutate(`/api/trips/${tripId}/currency`, jsonInit("PUT", { memberName: myName, home, rates }));
  const addJournal = (entry: JournalDraft) =>
    mutate(`/api/trips/${tripId}/journal`, jsonInit("POST", { memberName: myName, entry }));
  const updateJournal = (entryId: string, entry: Partial<JournalDraft>) =>
    mutate(
      `/api/trips/${tripId}/journal/${entryId}`,
      jsonInit("PATCH", { memberName: myName, entry })
    );
  const deleteJournal = (entryId: string) =>
    mutate(`/api/trips/${tripId}/journal/${entryId}?member=${encodeURIComponent(myName)}`, {
      method: "DELETE",
    });
```

- [ ] **Step 3: Render the tabs**

After the `{tab === "Itinerary" && (...)}` block add:

```tsx
      {tab === "Tracker" && (
        <TrackerTab
          payload={payload}
          myName={myName}
          isMember={isMember}
          onToggle={(key, checked) => void toggleCheck(key, checked)}
          onAddJournal={addJournal}
          onUpdateJournal={updateJournal}
          onDeleteJournal={deleteJournal}
          onOpenMoney={() => setTab("Money")}
        />
      )}

      {tab === "Money" && (
        <MoneyTab
          expenses={payload.expenses}
          settlements={payload.settlements}
          currencySettings={payload.currencySettings}
          members={payload.members.map((m) => m.name)}
          myName={myName}
          isMember={isMember}
          onAddExpense={addExpense}
          onUpdateExpense={updateExpense}
          onDeleteExpense={deleteExpense}
          onAddSettlement={addSettlement}
          onDeleteSettlement={deleteSettlement}
          onSaveCurrency={saveCurrency}
        />
      )}
```

- [ ] **Step 4: Full test run + typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add components/TripView.tsx
git commit -m "feat: tracker and money tabs on the trip page"
```

---

### Task 13: Manual verification, README, wrap-up

**Files:**
- Modify: `README.md` (Features + API table)

**Interfaces:** none new — this is the end-to-end check of everything above.

- [ ] **Step 1: Manual browser verification**

Start the dev server (the repo's `.claude/launch.json` has a `dev` config; Docker owns port 3000, so Next may pick 3001 — use whatever port it prints). Then walk through, fixing anything that fails before moving on:

1. Create a trip (any wizard flow), note the trip URL, join as "Ada".
2. **Money**: add a CNY expense split between two members (join as "Bob" from a second browser/incognito window first); add an SGD expense. Confirm: per-currency sums show both lines; balances show who owes whom; "mark repaid" records a repayment and shrinks the balance; deleting the repayment restores it; "Set up converted totals" with home SGD and a rate shows `Total CNY` and `Total SGD`.
3. **Cross-member sync**: with both browser windows open, add an expense as Bob — Ada's Money tab reflects it within ~4s (polling).
4. **Tracker (before)**: with a future start date, the tab shows the countdown and readiness tiles.
5. **Tracker (during)**: set the trip's start date to today (create a fresh trip whose start date is today). Confirm: Day 1 header, now/next reflects the current time slot, ticking an item in the Tracker also ticks it in the Itinerary tab, spend snapshot matches the Money tab.
6. **Journal**: write an entry with an uploaded photo (local dev = writable disk, the upload button must be visible) and a https link photo; confirm the upload renders inline and the link renders as a chip; edit the entry text; delete the entry and confirm the uploaded file disappears from `data/uploads/trips/<tripId>/`.
7. **Public briefing**: enable the share link on the Briefing tab, open `/b/<code>` in a private window — confirm no journal or expense content appears anywhere on the page.
8. **Guest view**: open the trip URL in a window that never joined — Money and Tracker render read-only (no forms, no buttons), nothing crashes.

- [ ] **Step 2: Update the README**

In `README.md`: add to the Features section (after the "Travelling together" block):

```markdown
### During the trip
- **Tracker tab** — countdown before departure; during the trip a live
  dashboard: day X of Y, now/next by time of day, tick-off synced with the
  itinerary, spend snapshot and stats (cities reached, rail km); a recap
  once you're home.
- **Trip journal** — day-by-day entries from any member, with photo uploads
  on self-hosted installs (writable disk) and photo links everywhere.
- **Money tab** — multi-currency group expenses with equal splits,
  per-currency totals, optional converted totals via manual rates,
  who-owes-whom balances, settle-up suggestions and repayment tracking.
```

and add to the API table:

```markdown
| `/api/trips/:id/expenses` (+`/:expenseId`) | POST · PATCH/DELETE | Group expenses (members only) |
| `/api/trips/:id/settlements` (+`/:settlementId`) | POST · DELETE | Repayments (members only) |
| `/api/trips/:id/journal` (+`/:entryId`) | POST · PATCH/DELETE | Journal (edits author-only) |
| `/api/trips/:id/currency` | PUT | Home currency + conversion rates |
| `/api/trips/:id/photos` (+`/:photoId`) | POST · GET | Photo upload/serve (writable hosts) |
```

- [ ] **Step 3: Final full check**

Run: `npm test` then `npx tsc --noEmit` then `npm run build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: tracker, journal and money features in README"
```

---

## Execution notes

- Tasks 1→7 are strictly ordered (each consumes the previous). Tasks 8 and 9 are independent of each other (both need 1–7). Tasks 10 and 11 are independent of each other (both need 1–4; 11's photo flow needs 9 at runtime, not compile time). Task 12 needs 10+11; Task 13 needs everything.
- `tsc --noEmit` is only expected clean from Task 6 onward (the payload fields are declared in Task 1 but filled by the backends in Tasks 5–6).
- No new npm dependencies anywhere in this plan.










