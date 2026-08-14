# Accounts & Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email+password accounts (Better Auth) with server-resolved member identity: accounts edit, join codes only view a redacted Itinerary+Packing payload, bare links see a private screen, and every trip mutation stops trusting a client-supplied `memberName`.

**Architecture:** Better Auth owns users/sessions in the same SQLite/Postgres database (schema embedded into the existing boot-time `CREATE TABLE IF NOT EXISTS` paths). A new `member_accounts` link table maps `(trip_id, member_name) → user_id`, preserving legacy plain-name members until claimed. One authz choke point (`resolveTripAccess`) classifies every request as member / guest / none; one pure redaction function builds the guest payload by construction. UI gains login/signup/account pages, a session-driven TripView, and a server-derived trip dashboard.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod v4, better-sqlite3, postgres.js (existing) + `pg` (new, Better Auth's Postgres driver), `better-auth` (new), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-accounts-auth-design.md`

## Global Constraints

- **Branch from `main` only after PR #2 (feature/trip-tracker-money) is merged** — the authz sweep rewrites routes that PR introduces. Verify with `git log --oneline -5 | grep "tracker and money tabs"` before starting.
- Exactly two new npm dependencies: `better-auth` (pinned **exact** version — no `^`) and `pg` (+ `@types/pg` dev). Nothing else. On this machine `npm install` MUST use `--ignore-scripts` (no VS C++ toolchain; all native deps ship prebuilds).
- `BETTER_AUTH_SECRET` absent → account-dependent endpoints return 503 with `ACCOUNTS_UNAVAILABLE` hint text (mirror of the existing `DB_UNAVAILABLE` pattern). The wizard/local planner must keep working without it.
- Guest payload whitelist (exhaustive — anything else is a leak): trip name, startDate, trip input summary (days/season), destination names, plan days, packing groups, member **count**. Never: tickets, expenses, settlements, journal, checks (not even anonymized), join code, member names, currency settings, features.
- Every mutating trip route requires a session AND membership; `memberName` disappears from every request schema. `paidBy`/`splitAmong`/`from`/`to` fields inside expense/settlement bodies remain (they name *other* members) and stay validated against the member list.
- One membership per user per trip (`UNIQUE (trip_id, user_id)`); claiming a claimed name → 409.
- `/b/*` public briefing pages and the `ACCESS_CODE` site gate are byte-for-byte untouched.
- Wallet: UI removed; `/api/wallet*` endpoints untouched this project.
- Auth error responses never reveal whether an email is registered (Better Auth defaults — do not customize its messages).
- Better Auth usage in this plan was pinned against current docs (Context7, 2026-08-15): `betterAuth({ database: new Database(...) | new Pool(...) })`, `emailAndPassword: { enabled: true }`, `admin()` plugin with `adminUserIds`, `toNextJsHandler(auth)` in `app/api/auth/[...all]/route.ts`, client from `better-auth/react`, schema via `npx @better-auth/cli generate`. If the installed version's API differs, STOP and report — do not improvise.
- All tests green (`npm test`) and `npx tsc --noEmit` clean at every task boundary from Task 2 onward.

---

### Task 1: Dependencies + Better Auth core

**Files:**
- Modify: `package.json` (via npm commands)
- Create: `lib/server/auth.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Modify: `next.config.ts` (add `serverExternalPackages`)
- Modify: `README.md` (env var table rows)

**Interfaces:**
- Consumes: `getDb()` from `lib/server/db.ts`, `storeMode()` from `lib/server/store.ts`.
- Produces (later tasks rely on):
  - `auth` — the Better Auth instance (lazy singleton), from `lib/server/auth.ts`
  - `accountsEnabled(): boolean` — true when `BETTER_AUTH_SECRET` is set
  - `ACCOUNTS_UNAVAILABLE: string` — 503 hint text
  - Better Auth HTTP endpoints under `/api/auth/*`

- [ ] **Step 1: Install pinned dependencies**

```bash
npm view better-auth version
```

Note the exact version it prints (call it `X.Y.Z`), then:

```bash
npm install --save-exact --ignore-scripts better-auth@X.Y.Z pg
npm install --save-dev --ignore-scripts @types/pg
```

Verify `package.json` shows `"better-auth": "X.Y.Z"` (no caret) and `pg` present.

- [ ] **Step 2: Create the auth instance**

Create `lib/server/auth.ts`:

```ts
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { getDb } from "./db";
import { storeMode } from "./store";

export const ACCOUNTS_UNAVAILABLE =
  "Accounts need a BETTER_AUTH_SECRET in the deployment's environment variables. Set one (any long random string) and restart.";

export function accountsEnabled(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

/** Comma-separated user ids granted admin (password resets). */
function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function database() {
  if (storeMode() === "postgres") {
    // Better Auth drives Postgres through pg; reuse the same DATABASE_URL
    // (Supabase transaction pooler) as the trip store.
    // Lazy import keeps pg out of the sqlite path entirely.
    const { Pool } = require("pg") as typeof import("pg");
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return getDb();
}

declare global {
  // Cached across Next.js dev hot reloads, like the sqlite handle.
  var __cipAuth: ReturnType<typeof betterAuth> | undefined;
}

export function getAuth() {
  if (!globalThis.__cipAuth) {
    globalThis.__cipAuth = betterAuth({
      baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      secret: process.env.BETTER_AUTH_SECRET,
      trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      database: database(),
      emailAndPassword: { enabled: true },
      plugins: [admin({ adminUserIds: adminUserIds() })],
    });
  }
  return globalThis.__cipAuth;
}
```

Note for the implementer: if the installed better-auth version rejects any
of these option names at type level, STOP and report the exact type error —
the controller re-pins the plan against that version's docs.

- [ ] **Step 3: Mount the handler**

Create `app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { accountsEnabled, ACCOUNTS_UNAVAILABLE, getAuth } from "@/lib/server/auth";

function guard() {
  return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
}

const handler = () => toNextJsHandler(getAuth());

export async function GET(req: Request) {
  if (!accountsEnabled()) return guard();
  return handler().GET(req);
}

export async function POST(req: Request) {
  if (!accountsEnabled()) return guard();
  return handler().POST(req);
}
```

- [ ] **Step 4: Externalize better-auth for the bundler**

In `next.config.ts`, add `serverExternalPackages: ["better-auth"]` to the
exported config object (alongside existing keys — do not remove anything).

- [ ] **Step 5: Env docs**

Add rows to the README env table:

```markdown
| `BETTER_AUTH_SECRET` | Enables accounts (any long random string). Unset = account features 503 |
| `BETTER_AUTH_URL` | Base URL of this deployment (e.g. `http://192.168.1.20:3000` on a Pi) |
| `TRUSTED_ORIGINS` | Comma-separated extra origins allowed to call the auth API |
| `ADMIN_USER_IDS` | Comma-separated account ids that may reset other members' passwords |
```

- [ ] **Step 6: Smoke-verify locally**

```bash
setx CIP_SMOKE 1 >nul 2>&1 || true   # no-op; just ensure shell is fine
```

Run the dev server with a secret (PowerShell: `$env:BETTER_AUTH_SECRET = "dev-secret-0123456789"; npm run dev`) and:

```bash
curl -s -X POST http://localhost:3000/api/auth/sign-up/email -H "Content-Type: application/json" -d '{"email":"smoke@example.com","password":"password123","name":"Smoke"}'
```

Expected: 200 with a user object (and a `set-cookie` header). Then without the env var (restart plainly), the same call returns 503 with the `ACCOUNTS_UNAVAILABLE` text. Note: Task 2 embeds the schema — if this step fails with "table ... does not exist", run Task 2 first, then return here; record which order worked in your report.

- [ ] **Step 7: Full suite + typecheck + commit**

Run: `npm test` (expected: all green — nothing existing touched) and `npx tsc --noEmit` (clean).

```bash
git add package.json package-lock.json lib/server/auth.ts "app/api/auth/[...all]" next.config.ts README.md
git commit -m "feat: better-auth core with email+password and admin plugin"
```

---

### Task 2: Embedded auth schema (both backends)

**Files:**
- Modify: `lib/server/db.ts` (extend `SCHEMA`)
- Modify: `lib/server/pgStore.ts` (extend `ensureSchema`)
- Test: `lib/server/authSchema.test.ts` (new)

**Interfaces:**
- Consumes: the installed better-auth version from Task 1.
- Produces: `user`, `session`, `account`, `verification` tables (with admin-plugin columns) self-provisioning on boot in both backends — Better Auth never needs its migration CLI at runtime.

- [ ] **Step 1: Generate the canonical schema**

```bash
npx @better-auth/cli@latest generate --config lib/server/auth.ts --output .superpowers/auth-schema-generated.sql
```

(If the CLI's flags differ in the installed version, run `npx @better-auth/cli@latest generate --help` and use the equivalent config/output options; the deliverable is the generated SQL file.) The output must define exactly four tables — `user`, `session`, `account`, `verification` — where `user` additionally carries the admin plugin's columns (`role`, `banned`, `banReason`, `banExpires`) and `session` carries `impersonatedBy`. If the generated file contains anything else (extra tables/plugins), STOP and report.

- [ ] **Step 2: Write the failing boot test**

Create `lib/server/authSchema.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-auth-schema-"));
process.env.CIP_DB_PATH = path.join(dbDir, "test.db");

import { closeDb, getDb } from "./db";

describe("embedded better-auth schema", () => {
  beforeAll(() => closeDb());
  afterAll(() => {
    closeDb();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  test("auth tables exist after boot", () => {
    const names = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["user", "session", "account", "verification"]) {
      expect(names).toContain(t);
    }
  });

  test("admin plugin columns are present", () => {
    const cols = getDb()
      .prepare("PRAGMA table_info(user)")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(cols).toContain("role");
    expect(cols).toContain("banned");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- authSchema`
Expected: FAIL — the auth tables are not in `SCHEMA` yet.

- [ ] **Step 4: Embed the generated SQL**

Convert every statement in `.superpowers/auth-schema-generated.sql` to `CREATE TABLE IF NOT EXISTS` form and append to the `SCHEMA` string in `lib/server/db.ts` (SQLite dialect) and, translated to the Postgres dialect the file already uses (`text`/`boolean`/`timestamp`), as `await s\`CREATE TABLE IF NOT EXISTS ...\`` statements at the end of `ensureSchema` in `lib/server/pgStore.ts`. Keep column names and types exactly as generated — Better Auth reads these tables directly; a drifted column name breaks login. Quote the `"user"` table name in Postgres (reserved word). Add a comment above both blocks:

```
-- better-auth vX.Y.Z schema (generated 2026-08-15 via @better-auth/cli).
-- Regenerate when bumping the pinned better-auth version.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- authSchema` → PASS. Then `npm test` (all green) and `npx tsc --noEmit` (clean). Re-run Task 1 Step 6's signup curl against the dev server — expected 200 and a row in `user` (`sqlite3`-free check: `node -e "const d=require('better-sqlite3')('data/app.db');console.log(d.prepare('select email from user').all())"`).

- [ ] **Step 6: Commit**

```bash
git add lib/server/db.ts lib/server/pgStore.ts lib/server/authSchema.test.ts
git commit -m "feat: embed better-auth schema in both backends"
```

---

### Task 3: member_accounts store

**Files:**
- Modify: `lib/server/db.ts` (one more table in `SCHEMA`)
- Modify: `lib/server/tripStore.ts` (CRUD + queries)
- Modify: `lib/server/pgStore.ts` (parity)
- Modify: `lib/server/store.ts` (facade)
- Test: `lib/server/tripStore.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `touch()`, `getDb()`, trips/members tables.
- Produces (exact facade signatures later tasks use):
  - `linkMemberAccount(tripId: string, memberName: string, userId: string): Promise<"linked" | "name-claimed" | "user-already-member" | "not-found">`
  - `memberNameForUser(tripId: string, userId: string): Promise<string | null>`
  - `isNameClaimed(tripId: string, memberName: string): Promise<boolean>`
  - `tripsForUser(userId: string): Promise<{ id: string; name: string; startDate: string | null; days: number; destinationNames: string[]; memberName: string }[]>`
  - (SQLite versions synchronous with identical names in `tripStore.ts`; pg async in `pgStore.ts`.)

- [ ] **Step 1: Add the table**

Append to `SCHEMA` in `lib/server/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS member_accounts (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, member_name),
  UNIQUE (trip_id, user_id)
);
```

and the Postgres equivalent (bigint `linked_at`) to `ensureSchema` in `pgStore.ts`.

- [ ] **Step 2: Append failing store tests**

Append to `lib/server/tripStore.test.ts` (extend the `./tripStore` import with the four new functions):

```ts
describe("member accounts", () => {
  test("link, lookup and claim rules", () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    joinTrip(id, joinCode, "Bob");

    expect(linkMemberAccount(id, "Ada", "user-1")).toBe("linked");
    expect(memberNameForUser(id, "user-1")).toBe("Ada");
    expect(isNameClaimed(id, "Ada")).toBe(true);
    expect(isNameClaimed(id, "Bob")).toBe(false);

    // A claimed name cannot be re-claimed; a linked user cannot link twice.
    expect(linkMemberAccount(id, "Ada", "user-2")).toBe("name-claimed");
    expect(linkMemberAccount(id, "Bob", "user-1")).toBe("user-already-member");

    // Unknown trip or member name.
    expect(linkMemberAccount("nope", "Ada", "user-9")).toBe("not-found");
    expect(linkMemberAccount(id, "Ghost", "user-9")).toBe("not-found");
    expect(memberNameForUser(id, "user-9")).toBeNull();
  });

  test("tripsForUser lists linked trips newest-first", () => {
    const a = createTrip(tripData({ tripName: "Trip A" }), "Ada");
    const b = createTrip(tripData({ tripName: "Trip B" }), "Ada");
    linkMemberAccount(a.id, "Ada", "user-list");
    linkMemberAccount(b.id, "Ada", "user-list");
    const list = tripsForUser("user-list");
    expect(list.map((t) => t.name)).toEqual(["Trip B", "Trip A"]);
    expect(list[0].memberName).toBe("Ada");
    expect(list[0].destinationNames).toEqual(["Beijing"]);
  });
});
```

- [ ] **Step 3: Run to verify FAIL**, then implement in `tripStore.ts`:

```ts
export type LinkResult = "linked" | "name-claimed" | "user-already-member" | "not-found";

export function linkMemberAccount(
  tripId: string,
  memberName: string,
  userId: string
): LinkResult {
  const db = getDb();
  const member = db
    .prepare("SELECT 1 FROM members WHERE trip_id = ? AND name = ?")
    .get(tripId, memberName);
  if (!member) return "not-found";
  const nameTaken = db
    .prepare("SELECT user_id FROM member_accounts WHERE trip_id = ? AND member_name = ?")
    .get(tripId, memberName) as { user_id: string } | undefined;
  if (nameTaken) return nameTaken.user_id === userId ? "linked" : "name-claimed";
  const userLinked = db
    .prepare("SELECT 1 FROM member_accounts WHERE trip_id = ? AND user_id = ?")
    .get(tripId, userId);
  if (userLinked) return "user-already-member";
  db.prepare(
    "INSERT INTO member_accounts (trip_id, member_name, user_id, linked_at) VALUES (?, ?, ?, ?)"
  ).run(tripId, memberName, userId, Date.now());
  touch(tripId);
  return "linked";
}

export function memberNameForUser(tripId: string, userId: string): string | null {
  const row = getDb()
    .prepare("SELECT member_name FROM member_accounts WHERE trip_id = ? AND user_id = ?")
    .get(tripId, userId) as { member_name: string } | undefined;
  return row?.member_name ?? null;
}

export function isNameClaimed(tripId: string, memberName: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM member_accounts WHERE trip_id = ? AND member_name = ?")
      .get(tripId, memberName) !== undefined
  );
}

export interface UserTrip {
  id: string;
  name: string;
  startDate: string | null;
  days: number;
  destinationNames: string[];
  memberName: string;
}

export function tripsForUser(userId: string): UserTrip[] {
  const rows = getDb()
    .prepare(
      "SELECT t.id, t.data, ma.member_name, ma.linked_at FROM member_accounts ma " +
        "JOIN trips t ON t.id = ma.trip_id WHERE ma.user_id = ? ORDER BY ma.linked_at DESC"
    )
    .all(userId) as { id: string; data: string; member_name: string }[];
  const out: UserTrip[] = [];
  for (const r of rows) {
    try {
      const data = JSON.parse(r.data) as TripData;
      out.push({
        id: r.id,
        name: data.tripName,
        startDate: data.startDate,
        days: data.plan.days.length,
        destinationNames: data.destinationNames,
        memberName: r.member_name,
      });
    } catch {
      // Skip a corrupted trip rather than failing the whole list.
    }
  }
  return out;
}
```

pg parity in `pgStore.ts` (same names, async, `await touch(tripId)`, jsonb `data` needs no JSON.parse) and facade delegations in `store.ts` following the exact `addExpense` switch shape, exporting the same four names plus `type LinkResult` and `type UserTrip` re-exports.

- [ ] **Step 4: Run tests** (`npm test -- tripStore` → PASS; `npm test` green; `tsc` clean).

- [ ] **Step 5: Commit**

```bash
git add lib/server/db.ts lib/server/tripStore.ts lib/server/pgStore.ts lib/server/store.ts lib/server/tripStore.test.ts
git commit -m "feat: member_accounts link table with claim rules"
```

---

### Task 4: Session helper + trip access resolution

**Files:**
- Create: `lib/server/session.ts`
- Create: `lib/server/authz.ts`
- Test: `lib/server/authz.test.ts` (new)

**Interfaces:**
- Consumes: `getAuth`, `accountsEnabled` (Task 1); `memberNameForUser` (Task 3); `getTrip` facade.
- Produces:
  - `getSessionUser(req: Request): Promise<{ id: string; name: string; email: string } | null>` — null when logged out or accounts disabled.
  - `type TripAccess = { kind: "member"; memberName: string } | { kind: "guest" } | { kind: "none" }`
  - `resolveTripAccess(tripId: string, userId: string | null, code: string | null): Promise<TripAccess>` — pure over store reads, unit-testable without HTTP.
  - `tripAccessFromRequest(req: NextRequest, tripId: string): Promise<TripAccess>` — composes the two; reads `?code=` from the URL.

- [ ] **Step 1: Write failing authz tests**

Create `lib/server/authz.test.ts` (same temp-DB bootstrap as `tripStore.test.ts` — copy its `mkdtemp`/`CIP_DB_PATH`/`closeDb` header exactly, importing `createTrip`, `joinTrip`, `linkMemberAccount` from `./tripStore` and `resolveTripAccess` from `./authz`):

```ts
describe("resolveTripAccess", () => {
  test("linked user is a member with their claimed name", async () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    linkMemberAccount(id, "Ada", "user-1");
    expect(await resolveTripAccess(id, "user-1", null)).toEqual({
      kind: "member",
      memberName: "Ada",
    });
    // A valid code adds nothing for a member.
    expect(await resolveTripAccess(id, "user-1", joinCode)).toEqual({
      kind: "member",
      memberName: "Ada",
    });
  });

  test("valid code without membership is a guest, case-insensitively", async () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    expect(await resolveTripAccess(id, null, joinCode)).toEqual({ kind: "guest" });
    expect(await resolveTripAccess(id, null, joinCode.toLowerCase())).toEqual({ kind: "guest" });
    expect(await resolveTripAccess(id, "unlinked-user", joinCode)).toEqual({ kind: "guest" });
  });

  test("no session, no code, wrong code, unknown trip → none", async () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(await resolveTripAccess(id, null, null)).toEqual({ kind: "none" });
    expect(await resolveTripAccess(id, null, "WRONG1")).toEqual({ kind: "none" });
    expect(await resolveTripAccess("missing", "user-1", "ABCDEF")).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (`npm test -- authz` — module missing).

- [ ] **Step 3: Implement**

Create `lib/server/session.ts`:

```ts
import { accountsEnabled, getAuth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Null when logged out, session expired, or accounts are not configured. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  if (!accountsEnabled()) return null;
  try {
    const session = await getAuth().api.getSession({ headers: req.headers });
    if (!session?.user) return null;
    return { id: session.user.id, name: session.user.name, email: session.user.email };
  } catch {
    // A malformed cookie must read as logged-out, never as a 500.
    return null;
  }
}
```

Create `lib/server/authz.ts`:

```ts
import type { NextRequest } from "next/server";
import { getSessionUser } from "./session";
import { joinCodeMatches, memberNameForUser } from "./store";

export type TripAccess =
  | { kind: "member"; memberName: string }
  | { kind: "guest" }
  | { kind: "none" };

/**
 * The single classification every trip route uses:
 * member (linked account) > guest (valid join code) > none.
 * Legacy plain-name members are NOT members here — editing requires an
 * account; unclaimed names are claimed via the join flow.
 */
export async function resolveTripAccess(
  tripId: string,
  userId: string | null,
  code: string | null
): Promise<TripAccess> {
  if (userId) {
    const memberName = await memberNameForUser(tripId, userId);
    if (memberName) return { kind: "member", memberName };
  }
  // joinCodeMatches returns false for unknown trips, so this also covers
  // the missing-trip case without a second store read.
  if (code && (await joinCodeMatches(tripId, code))) return { kind: "guest" };
  return { kind: "none" };
}

export async function tripAccessFromRequest(
  req: NextRequest,
  tripId: string
): Promise<TripAccess> {
  const user = await getSessionUser(req);
  const code = req.nextUrl.searchParams.get("code");
  return resolveTripAccess(tripId, user?.id ?? null, code);
}
```

`joinCodeMatches(tripId, code)` is a new store facade function this task also adds (both backends + facade): SQLite —

```ts
export function joinCodeMatches(tripId: string, code: string): boolean {
  const row = getDb()
    .prepare("SELECT join_code FROM trips WHERE id = ?")
    .get(tripId) as { join_code: string } | undefined;
  return row !== undefined && row.join_code.toUpperCase() === code.trim().toUpperCase();
}
```

pg parity + facade delegation in the established switch shape. Import it in `authz.ts` from `./store`.

- [ ] **Step 4: Run tests** (`npm test -- authz` → PASS; full suite green; `tsc` clean).

- [ ] **Step 5: Commit**

```bash
git add lib/server/session.ts lib/server/authz.ts lib/server/authz.test.ts lib/server/tripStore.ts lib/server/pgStore.ts lib/server/store.ts
git commit -m "feat: session helper and member/guest/none trip access resolution"
```

---

### Task 5: Guest redaction

**Files:**
- Create: `lib/redactTrip.ts`
- Test: `lib/redactTrip.test.ts` (new)
- Modify: `lib/tripShared.ts` (add `GuestTripPayload`)

**Interfaces:**
- Consumes: `TripPayload`, `TripData` from `lib/tripShared.ts`.
- Produces:
  - `interface GuestTripPayload { id: string; version: number; guest: true; tripName: string; startDate: string | null; days: number; season: Season; destinationNames: string[]; planDays: DayPlan[]; packing: PackingGroup[]; memberCount: number }` (exported from `lib/tripShared.ts`; `DayPlan` from `lib/itinerary`, `PackingGroup` from `lib/packing`, `Season` from `lib/types`)
  - `guestTripView(payload: TripPayload): GuestTripPayload` — pure, built by construction.

- [ ] **Step 1: Write failing tests**

Create `lib/redactTrip.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { TripPayload } from "./tripShared";
import { guestTripView } from "./redactTrip";

function fullPayload(): TripPayload {
  return {
    id: "trip-1",
    version: 7,
    updatedAt: 123,
    data: {
      tripName: "Family Trip",
      startDate: "2026-12-20",
      input: {
        destinationIds: ["beijing"],
        days: 3,
        season: "winter",
        adults: 2,
        kids: 1,
        interests: ["food"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [{ id: "i1", slot: "morning", kind: "activity", title: "Great Wall" }],
          },
        ],
        tips: ["secret member tip"],
      },
      packing: [{ title: "Documents", emoji: "🛂", items: ["Passports"] }],
      foods: [{ destination: "Beijing", emoji: "🥟", dishes: ["Duck"] }],
      destinationNames: ["Beijing"],
    },
    members: [{ name: "Ada", joinedAt: 1 }, { name: "Bob", joinedAt: 2 }],
    checks: [{ key: "item:i1", by: "Ada" }],
    tickets: [{ id: "t1", kind: "flight", title: "SQ 800", date: null, endDate: null, time: null, from: null, to: null, confirmation: "PNR-XYZ", price: null, notes: null, addedBy: "Ada" }],
    expenses: [{ id: "e1", date: "2026-12-20", title: "Hotpot", category: "food", amount: 100, currency: "CNY", paidBy: "Ada", splitAmong: [], notes: null, addedBy: "Ada", createdAt: 1 }],
    settlements: [{ id: "s1", date: "2026-12-21", from: "Bob", to: "Ada", amount: 50, currency: "CNY", recordedBy: "Bob", createdAt: 2 }],
    journal: [{ id: "j1", date: "2026-12-20", text: "diary", photos: [], by: "Ada", createdAt: 1, updatedAt: 1 }],
    currencySettings: { home: "SGD", rates: { SGD: 5.2 } },
    features: { photoUploads: true },
    joinCode: "SECRET",
  };
}

describe("guestTripView", () => {
  test("contains exactly the whitelisted fields", () => {
    const view = guestTripView(fullPayload());
    expect(Object.keys(view).sort()).toEqual(
      [
        "days",
        "destinationNames",
        "guest",
        "id",
        "memberCount",
        "packing",
        "planDays",
        "season",
        "startDate",
        "tripName",
        "version",
      ].sort()
    );
    expect(view.guest).toBe(true);
    expect(view.memberCount).toBe(2);
    expect(view.planDays[0].items[0].title).toBe("Great Wall");
  });

  test("leaks nothing sensitive anywhere in the serialized view", () => {
    const json = JSON.stringify(guestTripView(fullPayload()));
    for (const secret of [
      "SECRET",      // join code
      "PNR-XYZ",     // ticket confirmation
      "Hotpot",      // expense
      "diary",       // journal
      "Ada",         // member names / attribution
      "item:i1",     // check keys
      "SGD",         // currency settings
      "secret member tip", // tips are member-facing
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});
```

- [ ] **Step 2: Run to verify FAIL**, then implement.

Add to `lib/tripShared.ts` (after `TripPayload`), importing `DayPlan` from `./itinerary` (already imported types there) and `PackingGroup`/`Season` as needed:

```ts
/** What a join-code guest may see: the plan basics, nothing personal. */
export interface GuestTripPayload {
  id: string;
  version: number;
  guest: true;
  tripName: string;
  startDate: string | null;
  days: number;
  season: Season;
  destinationNames: string[];
  planDays: TripPlan["days"];
  packing: PackingGroup[];
  memberCount: number;
}
```

(`Season` via `import type { Season } from "./types";`, `TripPlan` and `PackingGroup` are already imported in this file.)

Create `lib/redactTrip.ts`:

```ts
import type { GuestTripPayload, TripPayload } from "./tripShared";

/**
 * Built by construction, never by deletion: every field is explicitly
 * copied from the whitelist. Adding a field to TripPayload cannot leak it
 * here, and the field-list test pins the exact shape.
 */
export function guestTripView(payload: TripPayload): GuestTripPayload {
  return {
    id: payload.id,
    version: payload.version,
    guest: true,
    tripName: payload.data.tripName,
    startDate: payload.data.startDate,
    days: payload.data.input.days,
    season: payload.data.input.season,
    destinationNames: [...payload.data.destinationNames],
    planDays: payload.data.plan.days,
    packing: payload.data.packing,
    memberCount: payload.members.length,
  };
}
```

Note the leak test's constraint: `plan.tips` are NOT included (the test asserts the tip string is absent) — guests get `planDays`, not the whole plan object.

Additionally append to `lib/redactTrip.ts` the spec's canary — a type-level classification that breaks the build when `TripPayload` grows a field nobody classified:

```ts
/**
 * Canary: every top-level TripPayload field must be explicitly classified.
 * Adding a field to TripPayload without deciding its guest visibility is a
 * compile error here — classify it below (and extend guestTripView + its
 * tests if it becomes visible).
 */
const FIELD_CLASSIFICATION: Record<keyof TripPayload, "guest-visible" | "members-only"> = {
  id: "guest-visible",
  version: "guest-visible",
  updatedAt: "members-only",
  data: "guest-visible", // partially — via the explicit copies above
  members: "members-only", // count only, via memberCount
  checks: "members-only",
  tickets: "members-only",
  expenses: "members-only",
  settlements: "members-only",
  journal: "members-only",
  currencySettings: "members-only",
  features: "members-only",
  joinCode: "members-only",
  myMemberName: "members-only",
};
void FIELD_CLASSIFICATION;
```

(`myMemberName` lands on `TripPayload` in Task 6 — when executing this task before Task 6, omit that line and let Task 6 add it; the canary then enforces exactly that.)

- [ ] **Step 3: Run tests** (money/tracker suites unaffected; full green; `tsc` clean).

- [ ] **Step 4: Commit**

```bash
git add lib/redactTrip.ts lib/redactTrip.test.ts lib/tripShared.ts
git commit -m "feat: guest trip view built by construction"
```

---

### Task 6: Trip GET + join/claim rework

**Files:**
- Modify: `app/api/trips/[id]/route.ts` (GET only — PATCH is Task 7)
- Modify: `app/api/trips/[id]/join/route.ts` (full rewrite)
- Modify: `lib/server/schemas.ts` (`JoinTripSchema` rework)
- Modify: `lib/tripShared.ts` (`TripPayload` gains `myMemberName?: string`)

**Interfaces:**
- Consumes: `tripAccessFromRequest` (Task 4), `guestTripView` (Task 5), `linkMemberAccount`/`isNameClaimed` (Task 3), `getSessionUser` (Task 4), `joinTrip` (existing store).
- Produces:
  - `GET /api/trips/:id` → member: full `TripPayload` + `myMemberName`; guest (`?code=`): `GuestTripPayload`; else `403 { error, private: true }`.
  - `POST /api/trips/:id/join` (session required) body `{ code: string, claimName?: string }` → claims or creates a membership, returns the full member payload. 401 no session, 403 bad code, 409 claimed name, 400 invalid.
  - New schema: `JoinTripSchema = z.object({ code: z.string().trim().min(1).max(12), claimName: z.string().trim().min(1).max(30).optional() })`.

- [ ] **Step 1: Rework GET**

In `app/api/trips/[id]/route.ts`, replace the current GET body (which passes `?member=` through to `getTrip`) with:

```ts
export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const { id } = await params;
  const access = await tripAccessFromRequest(req, id);
  if (access.kind === "none") {
    return NextResponse.json(
      { error: "This trip is private — enter its join code to view it.", private: true },
      { status: 403 }
    );
  }
  const payload = await getTrip(id, access.kind === "member" ? access.memberName : undefined);
  if (!payload) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  if (access.kind === "guest") {
    return NextResponse.json(guestTripView(payload));
  }
  return NextResponse.json({ ...payload, myMemberName: access.memberName });
}
```

Add `myMemberName?: string;` to `TripPayload` in `lib/tripShared.ts` (after `joinCode?`) — the client uses it instead of localStorage identity. Existing imports to extend: `tripAccessFromRequest` from `@/lib/server/authz`, `guestTripView` from `@/lib/redactTrip`. The unguessable-id-alone read access is deliberately GONE (spec decision 3): a 404 for missing trips is only distinguishable to callers who already passed the access check.

- [ ] **Step 2: Rework join**

Replace `app/api/trips/[id]/join/route.ts` wholesale:

```ts
import { NextRequest, NextResponse } from "next/server";
import { JoinTripSchema } from "@/lib/server/schemas";
import { getSessionUser } from "@/lib/server/session";
import { accountsEnabled, ACCOUNTS_UNAVAILABLE } from "@/lib/server/auth";
import {
  DB_UNAVAILABLE,
  getTrip,
  joinCodeMatches,
  joinTrip,
  linkMemberAccount,
  storeMode,
} from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (!accountsEnabled()) {
    return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to join a trip" }, { status: 401 });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = JoinTripSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid join request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  if (!(await joinCodeMatches(id, parsed.data.code))) {
    return NextResponse.json({ error: "Wrong join code" }, { status: 403 });
  }

  // Claiming an existing (legacy) member name inherits its history.
  if (parsed.data.claimName) {
    const result = await linkMemberAccount(id, parsed.data.claimName, user.id);
    if (result === "name-claimed") {
      return NextResponse.json(
        { error: `"${parsed.data.claimName}" is already claimed by another account` },
        { status: 409 }
      );
    }
    if (result === "not-found") {
      return NextResponse.json({ error: "No such member name on this trip" }, { status: 404 });
    }
    // "linked" and "user-already-member" both land on the member payload.
    const payload = await getTrip(id, parsed.data.claimName);
    return NextResponse.json({ ...payload, myMemberName: parsed.data.claimName });
  }

  // New membership under the account's display name (deduplicated).
  const trip = await getTrip(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  let name = user.name.trim().slice(0, 30) || user.email.split("@")[0].slice(0, 30);
  // A name is unavailable only when it exists AND is claimed by another
  // account; an unclaimed legacy name of the same spelling is also skipped
  // (joining under it would silently merge histories — claiming is explicit).
  const taken = async (n: string): Promise<boolean> => {
    if (!trip.members.some((m) => m.name === n)) return false;
    return true; // existing name, claimed or not — pick a fresh one
  };
  let suffix = 2;
  while (await taken(name)) {
    name = `${name.slice(0, 27)} ${suffix}`;
    suffix += 1;
  }
  const joined = await joinTrip(id, parsed.data.code, name);
  if (joined === "not-found") {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const linked = await linkMemberAccount(id, name, user.id);
  if (linked === "user-already-member") {
    // Already a member under some name — resolve and return it.
    const payload = await getTrip(id);
    return NextResponse.json(payload);
  }
  const payload = await getTrip(id, name);
  return NextResponse.json({ ...payload, myMemberName: name });
}
```

Replace `JoinTripSchema` in `lib/server/schemas.ts`:

```ts
export const JoinTripSchema = z.object({
  code: z.string().trim().min(1).max(12),
  claimName: z.string().trim().min(1).max(30).optional(),
});
```

(The old `{ code, name }` shape is gone; anonymous joining no longer exists.)

- [ ] **Step 3: Verify** — `npm test` (green; no route tests by convention), `npx tsc --noEmit` clean. Manual curl matrix (dev server + `BETTER_AUTH_SECRET` set): signup → cookie jar → GET without anything (403 private), GET with `?code=` (guest shape: exactly the 11 whitelist keys), POST join with code (member payload with `myMemberName`), claim of a legacy name, claim conflict (second account claiming the same name → 409).

- [ ] **Step 4: Commit**

```bash
git add "app/api/trips/[id]/route.ts" "app/api/trips/[id]/join/route.ts" lib/server/schemas.ts lib/tripShared.ts
git commit -m "feat: private-by-default trip reads and account join/claim"
```

---

### Task 7: Authz sweep A — checks, plan, tickets, trip PATCH

**Files:**
- Modify: `lib/server/authz.ts` (add `requireMember`)
- Modify: `lib/server/schemas.ts` (drop `memberName` from four schemas)
- Modify: `app/api/trips/[id]/checks/route.ts`
- Modify: `app/api/trips/[id]/plan/route.ts`
- Modify: `app/api/trips/[id]/route.ts` (PATCH)
- Modify: `app/api/trips/[id]/tickets/route.ts`
- Modify: `app/api/trips/[id]/tickets/[ticketId]/route.ts`

**Interfaces:**
- Consumes: `tripAccessFromRequest` (Task 4).
- Produces: `requireMember(req: NextRequest, tripId: string): Promise<{ memberName: string } | NextResponse>` — routes call it first; if the result is a `NextResponse`, return it as-is (it is the 401/403). Every schema in this task loses `memberName`.

- [ ] **Step 1: Add the route helper**

Append to `lib/server/authz.ts`:

```ts
import { NextResponse } from "next/server";
import { accountsEnabled, ACCOUNTS_UNAVAILABLE } from "./auth";

/**
 * The mutating-route gate: resolves the caller to a member name or returns
 * the error response the route should send verbatim.
 */
export async function requireMember(
  req: NextRequest,
  tripId: string
): Promise<{ memberName: string } | NextResponse> {
  if (!accountsEnabled()) {
    return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
  }
  const access = await tripAccessFromRequest(req, tripId);
  if (access.kind === "member") return { memberName: access.memberName };
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to make changes" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Only trip members can make changes — join the trip first" },
    { status: 403 }
  );
}
```

(Merge the `NextResponse` import with the existing type-only `NextRequest` import; `getSessionUser` is already imported.)

- [ ] **Step 2: Shrink the schemas**

In `lib/server/schemas.ts` replace these four schemas (delete the `memberName` line from each; everything else identical):

```ts
export const UpdateTripSchema = z.object({
  tripName: z.string().trim().min(1).max(60).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  input: TripInputSchema.optional(),
});

export const ToggleCheckSchema = z.object({
  key: z.string().min(1).max(200),
  checked: z.boolean(),
});

export const PlanEditSchema = z.object({
  op: PlanOpSchema,
});

export const AddTicketSchema = z.object({
  ticket: TicketFieldsSchema,
});

export const UpdateTicketSchema = z.object({
  ticket: TicketFieldsSchema.partial(),
});
```

- [ ] **Step 3: Rework each route's auth section**

The transformation is identical everywhere; apply it to all five files. Exact before → after for each occurrence:

**`checks/route.ts` POST** — before:
```ts
  const parsed = ToggleCheckSchema.safeParse(body);
  if (!parsed.success) { ... }
  if (!(await isMember(id, parsed.data.memberName))) {
    return NextResponse.json({ error: "Only trip members can tick items" }, { status: 403 });
  }
  await setCheck(id, parsed.data.key, parsed.data.memberName, parsed.data.checked);
  return NextResponse.json(await getTrip(id, parsed.data.memberName));
```
after:
```ts
  const gate = await requireMember(req, id);
  if (gate instanceof NextResponse) return gate;
  const parsed = ToggleCheckSchema.safeParse(body);
  if (!parsed.success) { /* unchanged 400 */ }
  await setCheck(id, parsed.data.key, gate.memberName, parsed.data.checked);
  const payload = await getTrip(id, gate.memberName);
  return NextResponse.json({ ...payload, myMemberName: gate.memberName });
```

**`plan/route.ts` POST**: same shape — gate first, `PlanEditSchema` parse (no memberName), pass `gate.memberName` wherever `parsed.data.memberName` appeared, and return `{ ...payload, myMemberName: gate.memberName }`.

**`[id]/route.ts` PATCH**: replace its `isMember(id, parsed.data.memberName)` check with the gate; `UpdateTripSchema` no longer carries memberName; the final `getTrip(id, parsed.data.memberName)` becomes `getTrip(id, gate.memberName)` + `myMemberName` spread.

**`tickets/route.ts` POST**: gate first; `AddTicketSchema` parse; `addedBy: gate.memberName` replaces `addedBy: parsed.data.memberName`; response spread as above.

**`tickets/[ticketId]/route.ts` PATCH**: gate first; parse; unchanged merge logic; response spread. **DELETE**: replace the `?member=` query check
```ts
  const member = req.nextUrl.searchParams.get("member") ?? "";
  if (!member || !(await isMember(id, member))) { ...403... }
```
with the gate, and `getTrip(id, member)` → `getTrip(id, gate.memberName)` + spread. Remove the now-unused `isMember` imports from all five files; import `requireMember` from `@/lib/server/authz` and `NextResponse` is already imported everywhere.

- [ ] **Step 4: Verify** — `npm test` green, `npx tsc --noEmit` clean (the compiler is the sweep's safety net: any missed `parsed.data.memberName` fails the build). Manual: with a member session cookie, tick an item (200, attribution = account's member name); with no cookie, 401; with a non-member account, 403.

- [ ] **Step 5: Commit**

```bash
git add lib/server/authz.ts lib/server/schemas.ts "app/api/trips/[id]/checks" "app/api/trips/[id]/plan" "app/api/trips/[id]/route.ts" "app/api/trips/[id]/tickets"
git commit -m "feat: session-derived identity for checks, plan, tickets and trip edits"
```

---

### Task 8: Authz sweep B — money, journal, photos, briefing

**Files:**
- Modify: `lib/server/schemas.ts` (drop `memberName` from six more schemas)
- Modify: `app/api/trips/[id]/expenses/route.ts` and `[expenseId]/route.ts`
- Modify: `app/api/trips/[id]/settlements/route.ts` and `[settlementId]/route.ts`
- Modify: `app/api/trips/[id]/currency/route.ts`
- Modify: `app/api/trips/[id]/journal/route.ts` and `[entryId]/route.ts`
- Modify: `app/api/trips/[id]/photos/route.ts`
- Modify: `app/api/trips/[id]/briefing/route.ts`

**Interfaces:**
- Consumes: `requireMember` (Task 7).
- Produces: every remaining mutating route is session-gated; expense/settlement member-name cross-checks (`paidBy`/`splitAmong`/`from`/`to`) remain and still validate against `trip.members`.

- [ ] **Step 1: Shrink the remaining schemas**

Remove the `memberName: MemberNameSchema,` line from: `AddExpenseSchema`, `UpdateExpenseSchema`, `AddSettlementSchema`, `AddJournalSchema`, `UpdateJournalSchema`, `CurrencySettingsSchema`, `BriefingShareSchema`. (Their other fields are unchanged.)

- [ ] **Step 2: Apply the gate per route**

Same mechanical shape as Task 7 — gate first, schema parse without memberName, `gate.memberName` replaces every `parsed.data.memberName`, member-view responses spread `myMemberName`. Route-specific notes (apply exactly):

- **expenses POST / PATCH**: keep the `named = [f.paidBy, ...f.splitAmong]` member-list validation verbatim — those name *other* members and still need checking against `trip.members`. The `memberNames.includes(parsed.data.memberName)` membership check is replaced by the gate (the trip fetch stays, it feeds the member-list check). `addedBy: gate.memberName`.
- **expenses DELETE / settlements DELETE**: replace the `?member=` query gate with `requireMember`, exactly as tickets DELETE in Task 7.
- **settlements POST**: gate; keep `from === to` 400 and unknown-member 400; `recordedBy: gate.memberName`.
- **currency PUT**: gate replaces `isMember`; body is now `{ home, rates }`.
- **journal POST**: gate; `by: gate.memberName`.
- **journal PATCH / DELETE**: gate FIRST, then the author check compares `existing.by !== gate.memberName` → 403 "Only the author can …". DELETE loses its `?member=` query entirely.
- **photos POST**: gate BEFORE `req.formData()` (after the Content-Length check) — the multipart form no longer carries a `memberName` field; delete that field read and its 403 branch.
- **briefing GET/POST**: replace each `isMember(id, …)` / body-`memberName` occurrence with the gate. `BriefingShareSchema` is now `{ enabled, includeBookings }`.

Remove every now-unused `isMember` import; the compiler confirms completeness.

- [ ] **Step 3: Verify** — `npm test` green, `npx tsc --noEmit` clean, plus this grep MUST return nothing:

```bash
grep -rn "memberName" app/api --include=*.ts | grep -v myMemberName
```

(Client-asserted memberName is extinct on the API surface.) Manual matrix as Task 7's, one route per group.

- [ ] **Step 4: Commit**

```bash
git add lib/server/schemas.ts "app/api/trips/[id]/expenses" "app/api/trips/[id]/settlements" "app/api/trips/[id]/currency" "app/api/trips/[id]/journal" "app/api/trips/[id]/photos" "app/api/trips/[id]/briefing"
git commit -m "feat: session-derived identity for money, journal, photos and briefing"
```

---

### Task 9: Trip dashboard API + wallet UI retirement

**Files:**
- Create: `app/api/me/trips/route.ts`
- Create: `lib/authClient.ts`
- Modify: `components/home/TripsDashboard.tsx` (server-list mode)
- Modify: `app/page.tsx` (remove the SyncDevices card)
- Delete (UI only): `components/home/SyncDevices.tsx`

**Interfaces:**
- Consumes: `getSessionUser` (Task 4), `tripsForUser` (Task 3), `tripPhase`/`pickNextTrip` from `lib/myTrips.ts` (unchanged, they operate on the same shape).
- Produces: `GET /api/me/trips` → 401 without session, else `{ trips: UserTrip[] }` (shape from Task 3). `components/home/TripsDashboard.tsx` renders the server list when a session exists, else its current localStorage list with a sign-in CTA.

- [ ] **Step 1: The API route**

Create `app/api/me/trips/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { DB_UNAVAILABLE, storeMode, tripsForUser } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to see your trips" }, { status: 401 });
  }
  return NextResponse.json({ trips: await tripsForUser(user.id) });
}
```

- [ ] **Step 2: Create the auth client, then rework the dashboard**

Create `lib/authClient.ts` (Task 10's pages reuse this exact module):

```ts
import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [adminClient()],
});
```

Then in `components/home/TripsDashboard.tsx`: `import { authClient } from "@/lib/authClient";` and use `const { data: session } = authClient.useSession()`; when a session exists, fetch `/api/me/trips` once on mount (plus on session change) and map `UserTrip` into the existing card rendering (`tripPhase`, date ranges — the fields line up with `MyTrip` minus `role`/`savedAt`; render role-independent copy). When logged out, keep the current localStorage behavior and add a link-button "Sign in to see your trips on every device" → `/login`.

- [ ] **Step 3: Remove wallet UI**

In `app/page.tsx` delete the `SyncDevices` import and its JSX usage; delete `components/home/SyncDevices.tsx`. Leave `lib/walletSync.ts`, `lib/myTrips.ts`, and `/api/wallet*` untouched (Global Constraints).

- [ ] **Step 4: Verify + commit** — `npm test` green, `tsc` clean, homepage renders logged-out (no wallet card, CTA present).

```bash
git add app/api/me lib/authClient.ts app/page.tsx components/home
git commit -m "feat: server-side trip dashboard, retire wallet sync UI"
```

---

### Task 10: Auth pages + account chrome

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/signup/page.tsx`
- Create: `app/account/page.tsx`
- Create: `components/auth/AuthForm.tsx`
- Create: `components/auth/AccountChip.tsx`

**Interfaces:**
- Consumes: `authClient` (Task 9) — `signIn.email({ email, password })`, `signUp.email({ email, password, name })`, `signOut()`, `useSession()`, `changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`, admin: `admin.listUsers({ query: { limit: 100 } })`, `admin.setUserPassword({ userId, newPassword })`.
- Produces: `/login`, `/signup`, `/account` pages; `AccountChip` — drop this component into any header (Task 11/12 use it).

- [ ] **Step 1: Shared credential form**

Create `components/auth/AuthForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/authClient";

type Props = { mode: "login" | "signup" };

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (mode === "signup" && !name.trim()) return setError("Enter your name.");
    if (!email.trim() || !password) return setError("Enter your email and password.");
    if (mode === "signup" && password.length < 8) {
      return setError("Password needs at least 8 characters.");
    }
    setBusy(true);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email: email.trim(), password, name: name.trim() })
        : await authClient.signIn.email({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That didn't work — try again.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next && next.startsWith("/") ? next : "/");
    router.refresh();
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail";

  return (
    <div className="mx-auto mt-12 w-full max-w-sm rounded-2xl border border-sky bg-paper p-6">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-rail">
        {mode === "signup" ? "New traveller" : "Welcome back"}
      </p>
      <h1 className="mt-1 font-display text-2xl font-bold">
        {mode === "signup" ? "Create your account" : "Sign in"}
      </h1>
      {mode === "signup" && (
        <label className="mt-4 block text-xs font-medium text-ink-soft">
          Your name (shown to trip members)
          <input type="text" value={name} maxLength={30} className={inputCls}
            onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Email
        <input type="email" value={email} autoComplete="email" className={inputCls}
          onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Password
        <input type="password" value={password}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputCls} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
      </label>
      <button type="button" onClick={() => void submit()} disabled={busy}
        className="mt-5 w-full rounded-lg bg-rail px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-50">
        {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
      <p className="mt-4 text-center text-xs text-ink-soft">
        {mode === "signup" ? (
          <>Already have an account? <Link href="/login" className="text-rail hover:underline">Sign in</Link></>
        ) : (
          <>New here? <Link href="/signup" className="text-rail hover:underline">Create an account</Link></>
        )}
      </p>
      {mode === "login" && (
        <p className="mt-1 text-center text-[11px] text-ink-soft">
          Forgot your password? Ask the trip admin to reset it.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pages**

Create `app/login/page.tsx`:

```tsx
import { AuthForm } from "@/components/auth/AuthForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen px-4">
      <AuthForm mode="login" />
    </main>
  );
}
```

Create `app/signup/page.tsx` identically with `mode="signup"` and default export `SignupPage`.

- [ ] **Step 3: Account chip**

Create `components/auth/AccountChip.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/authClient";

/** Header chip: initial avatar → menu. Renders a sign-in link when logged out. */
export function AccountChip() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);

  if (isPending) return null;
  if (!session) {
    return (
      <Link href="/login"
        className="rounded-lg border border-sky bg-paper px-3 py-1.5 text-sm font-medium text-rail hover:bg-sky">
        Sign in
      </Link>
    );
  }

  const initial = (session.user.name || session.user.email)[0]?.toUpperCase() ?? "?";
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={`Account menu for ${session.user.name}`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-rail font-semibold text-white">
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-sky bg-paper p-1.5 text-sm shadow-lg">
          <p className="truncate px-2.5 py-1.5 text-xs text-ink-soft">{session.user.email}</p>
          <Link href="/" className="block rounded-lg px-2.5 py-1.5 hover:bg-mist"
            onClick={() => setOpen(false)}>
            My trips
          </Link>
          <Link href="/account" className="block rounded-lg px-2.5 py-1.5 hover:bg-mist"
            onClick={() => setOpen(false)}>
            Account
          </Link>
          <button type="button"
            className="block w-full rounded-lg px-2.5 py-1.5 text-left text-seal hover:bg-mist"
            onClick={() => {
              void authClient.signOut().then(() => {
                setOpen(false);
                router.push("/");
                router.refresh();
              });
            }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Account page (self-service + admin reset)**

Create `app/account/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { authClient } from "@/lib/authClient";

export default function AccountPage() {
  const { data: session, isPending } = authClient.useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Admin reset state
  const [users, setUsers] = useState<{ id: string; email: string; name: string }[] | null>(null);
  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({});
  const [adminMessage, setAdminMessage] = useState<string | null>(null);

  if (isPending) return <main className="p-8 text-sm text-ink-soft">Loading…</main>;
  if (!session) {
    return (
      <main className="p-8">
        <Link href="/login" className="text-rail hover:underline">Sign in</Link> to manage your account.
      </main>
    );
  }

  const changePassword = async () => {
    if (newPassword.length < 8) return setMessage("New password needs at least 8 characters.");
    setBusy(true);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setBusy(false);
    setMessage(result.error ? result.error.message ?? "Couldn't change the password." : "Password changed ✓");
    if (!result.error) {
      setCurrentPassword("");
      setNewPassword("");
    }
  };

  const loadUsers = async () => {
    const result = await authClient.admin.listUsers({ query: { limit: 100 } });
    if (result.error) {
      setAdminMessage("You're not an admin on this deployment.");
      return;
    }
    setUsers(result.data.users.map((u) => ({ id: u.id, email: u.email, name: u.name })));
  };

  const resetFor = async (userId: string) => {
    const pw = resetPasswords[userId] ?? "";
    if (pw.length < 8) return setAdminMessage("Reset password needs at least 8 characters.");
    const result = await authClient.admin.setUserPassword({ userId, newPassword: pw });
    setAdminMessage(result.error ? result.error.message ?? "Reset failed." : "Password reset ✓");
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink";

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="font-display text-2xl font-bold">Account</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {session.user.name} · {session.user.email}
      </p>
      <p className="mt-1 font-mono text-[11px] text-ink-soft">id: {session.user.id}</p>

      <section className="mt-6 rounded-xl border border-sky bg-paper p-5">
        <h2 className="font-display text-lg font-semibold">Change password</h2>
        <label className="mt-3 block text-xs font-medium text-ink-soft">
          Current password
          <input type="password" value={currentPassword} className={inputCls}
            autoComplete="current-password"
            onChange={(e) => setCurrentPassword(e.target.value)} />
        </label>
        <label className="mt-3 block text-xs font-medium text-ink-soft">
          New password
          <input type="password" value={newPassword} className={inputCls}
            autoComplete="new-password"
            onChange={(e) => setNewPassword(e.target.value)} />
        </label>
        <button type="button" onClick={() => void changePassword()} disabled={busy}
          className="mt-4 rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : "Change password"}
        </button>
        {message && <p className="mt-2 text-xs text-seal">{message}</p>}
      </section>

      <section className="mt-4 rounded-xl border border-sky bg-paper p-5">
        <h2 className="font-display text-lg font-semibold">Admin · reset a member&apos;s password</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Only works when your account id is listed in ADMIN_USER_IDS.
        </p>
        {users === null ? (
          <button type="button" onClick={() => void loadUsers()}
            className="mt-3 rounded-lg border border-sky px-3 py-1.5 text-sm text-rail hover:bg-sky">
            Load members
          </button>
        ) : (
          <ul className="mt-3 space-y-2">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-32 truncate">{u.name} <span className="text-xs text-ink-soft">{u.email}</span></span>
                <input type="password" placeholder="new password" aria-label={`New password for ${u.email}`}
                  value={resetPasswords[u.id] ?? ""}
                  className="w-36 rounded-lg border border-sky bg-mist px-2 py-1 text-xs"
                  onChange={(e) =>
                    setResetPasswords((prev) => ({ ...prev, [u.id]: e.target.value }))
                  } />
                <button type="button" onClick={() => void resetFor(u.id)}
                  className="rounded-lg bg-rail px-2.5 py-1 text-xs font-semibold text-white">
                  Reset
                </button>
              </li>
            ))}
          </ul>
        )}
        {adminMessage && <p className="mt-2 text-xs text-seal">{adminMessage}</p>}
      </section>
    </main>
  );
}
```

Note: if the installed better-auth's client API names differ (`changePassword`, `admin.listUsers`, `admin.setUserPassword`), STOP and report the type errors — do not guess replacements.

- [ ] **Step 5: Verify + commit** — `npm test` green, `tsc` clean; manual: signup → chip appears with initial; change password round-trip; admin section shows "not an admin" for a non-admin, lists + resets after adding your id to `ADMIN_USER_IDS` and restarting.

```bash
git add app/login app/signup app/account components/auth
git commit -m "feat: login, signup and account pages with admin password reset"
```

---

### Task 11: Create-trip gating + TripView access states

**Files:**
- Modify: `app/api/trips/route.ts` (POST requires session; creator auto-linked)
- Modify: `lib/server/schemas.ts` (`CreateTripSchema` drops `creatorName`)
- Modify: `app/api/trips/[id]/join/route.ts` (add GET: claimable names)
- Modify: `components/PlanStep.tsx` (share button: 401 → sign-in prompt)
- Create: `components/trip/GuestTripView.tsx`
- Create: `components/trip/PrivateGate.tsx`
- Create: `components/trip/JoinClaimDialog.tsx`
- Modify: `components/TripView.tsx` (session identity + access-state machine)

**Interfaces:**
- Consumes: `requireMember` is NOT used here (these are join-lifecycle routes); `getSessionUser`, `linkMemberAccount`, `isNameClaimed`, `joinCodeMatches` (Tasks 3–4), `GuestTripPayload` (Task 5), `authClient` (Task 9), `AccountChip` (Task 10).
- Produces:
  - `POST /api/trips` — 401 without session; `creatorName` comes from the session user; the creator's membership is linked to their account before the response returns.
  - `GET /api/trips/:id/join?code=XXX` — session required; `{ claimable: string[] }` (member names with no account link). 403 wrong code.
  - `GuestTripView({ view }: { view: GuestTripPayload })`, `PrivateGate({ onSubmitCode })`, `JoinClaimDialog({ tripId, code, claimable, legacyName, onJoined })`.

- [ ] **Step 1: Gate trip creation**

`CreateTripSchema` in `lib/server/schemas.ts` — delete the `creatorName: MemberNameSchema,` line only. In `app/api/trips/route.ts` POST: after the storeMode 503 and before parsing, add

```ts
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to share a trip" }, { status: 401 });
  }
```

then where the route called `createTrip(data, parsed.data.creatorName)`:

```ts
  const creatorName = user.name.trim().slice(0, 30) || user.email.split("@")[0].slice(0, 30);
  const { id, joinCode } = await createTrip(data, creatorName);
  await linkMemberAccount(id, creatorName, user.id);
  return NextResponse.json({ id, joinCode }, { status: 201 });
```

(Keep the existing plan-snapshot building unchanged; imports: `getSessionUser` from `@/lib/server/session`, `linkMemberAccount` from `@/lib/server/store`.)

In `components/PlanStep.tsx`, the share/create call site: remove `creatorName` from the POST body (and any name input field feeding it); on a 401 response render, in place of the existing error span, a sign-in prompt: `Sign in to share this trip — <Link href={`/login?next=${encodeURIComponent(window.location.pathname)}`}>sign in</Link>`. The local-only planner flow stays untouched.

- [ ] **Step 2: Claimable-names endpoint**

Append to `app/api/trips/[id]/join/route.ts`:

```ts
export async function GET(req: NextRequest, { params }: Params) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to join a trip" }, { status: 401 });
  }
  const { id } = await params;
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!(await joinCodeMatches(id, code))) {
    return NextResponse.json({ error: "Wrong join code" }, { status: 403 });
  }
  const trip = await getTrip(id);
  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  const claimable: string[] = [];
  for (const m of trip.members) {
    if (!(await isNameClaimed(id, m.name))) claimable.push(m.name);
  }
  return NextResponse.json({ claimable });
}
```

(Add `isNameClaimed` to this file's store import.) Exposing unclaimed member names here is deliberate and safe: the caller holds both a session and the join code — strictly more credentials than the guest view requires.

- [ ] **Step 3: Guest + gate + claim components**

Create `components/trip/GuestTripView.tsx`:

```tsx
import type { GuestTripPayload } from "@/lib/tripShared";

/** Read-only itinerary + packing for join-code guests. No checks, no chrome. */
export function GuestTripView({ view }: { view: GuestTripPayload }) {
  return (
    <div className="mt-5 space-y-5">
      <p className="rounded-lg border border-dashed border-rail/40 bg-paper px-4 py-2 text-xs text-ink-soft">
        You&apos;re viewing as a guest — sign in and join to tick things off and see the rest.
      </p>
      {view.planDays.map((day) => (
        <div key={day.day} className="rounded-xl border border-sky bg-paper p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">
            Day {String(day.day).padStart(2, "0")} · {day.destinationName}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {day.items.map((item) => (
              <li key={item.id} className="flex gap-2">
                <span className="font-mono text-[10px] uppercase text-ink-soft">{item.slot}</span>
                <span>{item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        {view.packing.map((group) => (
          <div key={group.title} className="rounded-xl border border-sky bg-paper p-4">
            <p className="font-semibold">
              <span aria-hidden>{group.emoji}</span> {group.title}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
```

Create `components/trip/PrivateGate.tsx`:

```tsx
"use client";

import { useState } from "react";

type Props = { onSubmitCode: (code: string) => Promise<string | null> };

export function PrivateGate({ onSubmitCode }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim()) return setError("Enter the join code.");
    setBusy(true);
    setError(null);
    const err = await onSubmitCode(code.trim());
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-sky bg-paper p-8 text-center">
      <p className="font-display text-xl font-bold">This trip is private</p>
      <p className="mt-2 text-sm text-ink-soft">
        Enter its join code to view the plan. Members sign in to edit.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <input type="text" value={code} maxLength={12} aria-label="Join code"
          className="w-40 rounded-lg border border-sky bg-mist px-3 py-2 text-center font-mono text-sm tracking-widest uppercase"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
        <button type="button" onClick={() => void submit()} disabled={busy}
          className="rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "…" : "View trip"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-seal">{error}</p>}
    </div>
  );
}
```

Create `components/trip/JoinClaimDialog.tsx`:

```tsx
"use client";

import { useState } from "react";

type Props = {
  claimable: string[];
  /** Legacy name this device used pre-accounts, if any — preselected. */
  legacyName: string | null;
  onJoin: (claimName: string | null) => Promise<string | null>;
};

/** "NEW" sentinel = join as a fresh member under the account's name. */
export function JoinClaimDialog({ claimable, legacyName, onJoin }: Props) {
  const initial = legacyName && claimable.includes(legacyName) ? legacyName : "NEW";
  const [choice, setChoice] = useState<string>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    setError(null);
    const err = await onJoin(choice === "NEW" ? null : choice);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="mt-6 rounded-xl border-2 border-dashed border-seal/50 bg-paper p-5">
      <h2 className="font-display text-lg font-semibold">Join this trip</h2>
      {claimable.length > 0 && (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            Were you already on this trip before accounts? Claim your old name to keep
            everything you ticked, spent and wrote.
          </p>
          <div className="mt-3 space-y-1.5">
            {claimable.map((name) => (
              <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="radio" name="claim" checked={choice === name}
                  onChange={() => setChoice(name)} className="accent-rail" />
                I am <span className="font-semibold">{name}</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="claim" checked={choice === "NEW"}
                onChange={() => setChoice("NEW")} className="accent-rail" />
              I&apos;m new — join under my account name
            </label>
          </div>
        </>
      )}
      <button type="button" onClick={() => void join()} disabled={busy}
        className="mt-4 rounded-lg bg-seal px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Joining…" : "Join trip"}
      </button>
      {error && <span className="ml-3 text-xs text-seal">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Rewire TripView**

In `components/TripView.tsx`, these exact changes:

1. **State & identity.** Replace `const [myName, setMyName] = useState<string>("");` and the localStorage effect with:

```tsx
  const [payload, setPayload] = useState<TripPayload | null>(null);
  const [guestView, setGuestView] = useState<GuestTripPayload | null>(null);
  const [claimable, setClaimable] = useState<string[] | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "member" | "guest" | "private" | "not-found"
  >("loading");
  const { data: session } = authClient.useSession();
  const myName = payload?.myMemberName ?? "";
  /** Pre-accounts identity on this device — powers the claim preselect + banner. */
  const legacyName =
    typeof window !== "undefined" ? localStorage.getItem(`cip-member-${tripId}`) : null;
  const [guestCode, setGuestCode] = useState<string>(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem(`cip-guest-code-${tripId}`) ??
          new URLSearchParams(window.location.search).get("code") ??
          "")
      : ""
  );
```

(Imports to add: `authClient` from `@/lib/authClient`, `GuestTripPayload` from `@/lib/tripShared`, the three new components.)

2. **Fetch.** Replace `fetchTrip` with:

```tsx
  const fetchTrip = useCallback(
    async (force = false) => {
      const query = guestCode ? `?code=${encodeURIComponent(guestCode)}` : "";
      const res = await fetch(`/api/trips/${tripId}${query}`, { cache: "no-store" });
      if (res.status === 404) return setLoadState("not-found");
      if (res.status === 403) {
        setLoadState("private");
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      if (json.guest === true) {
        setGuestView(json as GuestTripPayload);
        setLoadState("guest");
        localStorage.setItem(`cip-guest-code-${tripId}`, guestCode);
        return;
      }
      const fresh = json as TripPayload;
      applyPayload(fresh, force);
      setLoadState("member");
    },
    [tripId, guestCode, applyPayload]
  );
```

The polling effect and `applyPayload` stay; every `fetchTrip(myName)` / `fetchTrip(myName, true)` call site becomes `fetchTrip()` / `fetchTrip(true)`, and the effect deps drop `myName` for `guestCode` + `session?.user.id` (a login/logout or code entry refetches).

3. **Delete the old join form** (the `joinName`/`joinCode` state, the `join()` function, and the "Join this trip" JSX block) and the `localStorage.setItem("cip-member-…")` write. Keep `saveMyTrip` for logged-out continuity but only in the member branch.

4. **Access-state rendering.** After the existing `loading` / `not-found` returns add:

```tsx
  if (loadState === "private") {
    return (
      <Shell>
        <PrivateGate
          onSubmitCode={async (code) => {
            setGuestCode(code);
            return null; // fetch effect re-runs on guestCode change; errors surface as staying private
          }}
        />
      </Shell>
    );
  }

  if (loadState === "guest" && guestView) {
    return (
      <Shell>
        <GuestHeader view={guestView} />
        {session && claimable !== null && (
          <JoinClaimDialog claimable={claimable} legacyName={legacyName} onJoin={joinTrip} />
        )}
        {session && claimable === null && (
          <button type="button" onClick={() => void loadClaimable()}
            className="mt-6 rounded-lg bg-seal px-5 py-2 text-sm font-semibold text-white">
            Join this trip
          </button>
        )}
        {!session && (
          <p className="mt-6 text-sm text-ink-soft">
            <Link href={`/login?next=/trip/${tripId}`} className="text-rail hover:underline">
              Sign in
            </Link>{" "}
            to join and edit this trip.
          </p>
        )}
        {legacyName && (
          <p className="mt-2 rounded-lg border border-dashed border-seal/50 bg-paper px-4 py-2 text-xs text-ink-soft">
            This device used to edit as <b>{legacyName}</b> — create an account and claim
            that name to keep editing.
          </p>
        )}
        <GuestTripView view={guestView} />
      </Shell>
    );
  }
```

with the two small helpers inside the component:

```tsx
  const loadClaimable = async () => {
    const res = await fetch(
      `/api/trips/${tripId}/join?code=${encodeURIComponent(guestCode)}`
    );
    if (res.ok) setClaimable(((await res.json()) as { claimable: string[] }).claimable);
    else setClaimable([]);
  };

  const joinTrip = async (claimName: string | null): Promise<string | null> => {
    const res = await fetch(`/api/trips/${tripId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: guestCode, ...(claimName ? { claimName } : {}) }),
    });
    const json = await res.json();
    if (!res.ok) return typeof json.error === "string" ? json.error : "Couldn't join.";
    applyPayload(json as TripPayload, true);
    setLoadState("member");
    return null;
  };
```

and `GuestHeader` — a trimmed copy of the member header card (trip name, destination line, day/season chips from `view`, no code, no member count beyond `view.memberCount` chip) — implement as a small function component in the same file, mirroring the existing header's classes.

5. **Member branch mutations.** Every mutation body loses `memberName:`/`member=` (the API ignores/rejects them now): `jsonInit("POST", { key, checked })` for checks, `{ op }` for plan, `{ ticket }`, `{ expense }`, `{ settlement }`, `{ entry }`, `{ home, rates }`, and the DELETE URLs drop `?member=…`. The photo upload FormData in `components/trip/JournalSection.tsx` drops its `memberName` append (modify that file too; its `myName` prop stays for authorship display).

6. **Header chip.** In `Shell`, add `<AccountChip />` to the right side of the header row (import from `@/components/auth/AccountChip`).

- [ ] **Step 5: Verify + commit** — `npm test` green; `tsc` clean (it catches every missed call-site body); manual walkthrough deferred to Task 12's matrix.

```bash
git add "app/api/trips/route.ts" "app/api/trips/[id]/join/route.ts" lib/server/schemas.ts components/PlanStep.tsx components/trip/GuestTripView.tsx components/trip/PrivateGate.tsx components/trip/JoinClaimDialog.tsx components/TripView.tsx components/trip/JournalSection.tsx
git commit -m "feat: account-gated trip creation and member/guest/private trip page"
```

---

### Task 12: Docs + full manual verification

**Files:**
- Modify: `README.md` (trust-model section rewrite, API table, env table already done in Task 1)
- Modify: `docs/PLAN.md` (trust-model paragraph: mark the upgrade done)

**Interfaces:** none new — end-to-end confirmation of the access matrix.

- [ ] **Step 1: README trust-model rewrite**

Replace the "How \"many people can join\" works" section body with:

```markdown
Accounts (email + password) own editing: members sign in once and their
trips follow them to any device. A trip's join code is now a **view key** —
anyone holding it can see the itinerary and packing lists (read-only,
nothing personal), while joining as an editing member requires an account
plus the code. Pre-account members are preserved: sign up and claim your
old member name to inherit everything you ticked, spent and wrote. The
bare trip link without the code shows only a private screen. Password
resets are admin-assisted (`ADMIN_USER_IDS`) — no email service needed.
```

In the API table: change the `/api/trips/:id` GET row purpose to "Fetch trip state (member session = full; `?code=` = guest view; else 403)", the join row to `POST · GET | Join/claim with account + code · list claimable names`, and add a row `| /api/me/trips | GET | Signed-in user's trips |` and `| /api/auth/* | * | Better Auth (signup, login, sessions, admin) |`.

- [ ] **Step 2: docs/PLAN.md**

In the "Trust model (deliberate MVP)" section, append: `Update 2026-08: done — Better Auth email+password accounts with per-member sessions; join codes demoted to view-only keys (spec: docs/superpowers/specs/2026-08-15-accounts-auth-design.md).`

- [ ] **Step 3: Manual verification matrix**

Dev server with `BETTER_AUTH_SECRET` + your `ADMIN_USER_IDS`. Fix anything that fails before proceeding:

1. **Signup/login**: create two accounts (A, B); chip shows initials; sign out/in round-trips; wrong password fails without revealing whether the email exists.
2. **Create**: logged out, the wizard's share step prompts sign-in (401 path); as A, creating returns a trip where A is already the linked creator (Crew shows A's name, editing works with no join form).
3. **Access matrix** on that trip: bare link in a private window → private screen; entering the code → guest view showing ONLY itinerary + packing (verify the fetched JSON has exactly the whitelist keys and none of: members, tickets, expenses, journal, checks, joinCode); signed in as B + code → join dialog; B joins new → can tick/edit; B's edits attribute as B's account name.
4. **Claiming**: on a pre-accounts trip (create one via SQL or reuse a dev trip with legacy members), A claims a legacy name → history intact (ticks/expenses/journal show under that name, and A now edits as it); B attempting to claim the same name → 409 surfaced in the dialog.
5. **Sweep regression**: as a member, one mutation from each group works (tick, plan edit, ticket add, expense add, settlement add, currency save, journal add + photo upload, briefing toggle); logged out, each returns 401; as a non-member account without joining, 403.
6. **Dashboard**: A's homepage lists A's trips on a second browser with zero setup (the actual "trips follow me" acceptance test); wallet card gone.
7. **Admin reset**: as admin, reset B's password; B logs in with the new one.
8. **Public briefing**: `/b/<code>` still renders for a logged-out private window (unchanged).
9. `npm test` green, `npx tsc --noEmit` clean, `npm run build` green.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/PLAN.md
git commit -m "docs: accounts trust model and API surface"
```

---

## Execution notes

- Strict order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → (9 ∥ 10 after 8) → 11 → 12. Tasks 9 and 10 are mutually independent once 8 is done (9 creates `lib/authClient.ts`, which 10 consumes — run 9 first or accept the file's creation in either).
- Tasks 7–8 are compiler-verified sweeps: `npx tsc --noEmit` failing = a missed call site; the Task 8 grep is the final proof.
- The client keeps polling `GET /api/trips/:id`; a guest polls with its cached code, a member with cookies — no polling changes needed.
- Legacy `cip-member-*` localStorage is read-only after Task 11 (claim preselect + banner); never written again.
- If any Better Auth API name fails at type level (config options, client methods, admin calls), STOP per the Global Constraints — the plan gets re-pinned against the installed version's docs rather than improvised around.
- The spec's "authz matrix" testing item is satisfied in two layers: automated unit tests on `resolveTripAccess` (Task 4 — the single classification every route consumes) plus Task 12's exhaustive manual matrix. Full route-level automated authz tests would require forging Better Auth sessions in vitest; if a session-stub seam emerges during implementation, add them — otherwise this is a known, deliberate gap carried from the Tracker & Money review's recommendation, and belongs in a future testing task alongside the Postgres harness.




