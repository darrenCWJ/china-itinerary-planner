# Backlog Clearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every non-roadmap item left open after Phase 4 — trusted origins, two unguarded whole-object writes, the server-only guard, a measured-and-closed cold-start question, a per-hover recompute, a fixed accessible name, the oversized `MapExplorer`, and a stale handover document — behind the repo's existing gates.

**Architecture:** Each item is its own task with its own tests; none adds a feature or changes what the app draws. Tasks 1–8 are independent of one another and run in one wave; Task 9 (the `MapExplorer` split) runs after them because Task 7 touches the same two files. The controller commits after each task's review.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, Vitest 4 (node + jsdom projects), Playwright, Better Auth 1.7.1, better-sqlite3 and `postgres` behind one store facade.

Spec: `docs/superpowers/specs/2026-09-06-backlog-clearance-design.md`.

## Global Constraints

- **Do not run `git commit`, `git add`, `git checkout` or `git stash`.** The controller commits after review. `git diff` and `git status` are fine.
- **Touch only the files your task lists.** Other tasks run in the same checkout at the same time.
- **Every test you add must go red before the change and green after**, and the report must say which command showed each.
- `npm install` on this machine MUST use `--ignore-scripts` (no C++ toolchain; every native dependency ships prebuilt).
- Line endings: the checkout is CRLF. Match the file you are editing; never reformat a file.
- File size guidance: 800 lines maximum for any file this plan creates or splits.
- Copy: apostrophes in JSX go through `&apos;` where the file already does that; comments are prose, not labels.
- Nothing in this plan changes what the map draws, what a route returns for a valid request, or any string a screen reader announces except the one Task 7 names.
- Report format at the end of every task: files changed, every command run with its result (counts, not "passed"), anything you deviated from and why, anything you noticed and left alone.

---

### Task 1: Trusted origins derived from the deployment's own URLs

**Files:**
- Create: `lib/server/trustedOrigins.ts`
- Create: `lib/server/trustedOrigins.test.ts`
- Modify: `lib/server/auth.ts:57-64` (the `trustedOrigins:` option)
- Modify: `.env.example` (the `TRUSTED_ORIGINS` comment block)
- Modify: `README.md:159` (the `TRUSTED_ORIGINS` row)

**Interfaces:**
- Produces: `trustedOriginsFrom(env: Readonly<Record<string, string | undefined>>): string[]`

**Background the implementer needs.** Better Auth accepts a browser request only when its `Origin` is the configured `baseURL` or one of `trustedOrigins`. `BETTER_AUTH_URL` is one value shared by Vercel's Preview and Production environments and names the production alias, so on every preview deployment sign-in answers 403 "Invalid origin". Vercel sets three system variables on every deployment, without a scheme: `VERCEL_URL` (the unique deployment host), `VERCEL_BRANCH_URL` (the git-branch alias), `VERCEL_PROJECT_PRODUCTION_URL` (the production domain). Better Auth's own wildcard syntax (`https://*.example.com`) is allowed in `trustedOrigins` entries and must pass through untouched.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/server/trustedOrigins.test.ts
import { describe, expect, test } from "vitest";
import { trustedOriginsFrom } from "./trustedOrigins";

describe("trustedOriginsFrom", () => {
  test("nothing configured trusts nothing beyond the base URL", () => {
    expect(trustedOriginsFrom({})).toEqual([]);
    expect(trustedOriginsFrom({ TRUSTED_ORIGINS: "", VERCEL_URL: "  " })).toEqual([]);
  });

  test("the manual list is split, trimmed and kept verbatim — wildcards included", () => {
    expect(
      trustedOriginsFrom({ TRUSTED_ORIGINS: " https://a.example, ,https://*.preview.example " })
    ).toEqual(["https://a.example", "https://*.preview.example"]);
  });

  test("each Vercel host becomes an https origin", () => {
    expect(
      trustedOriginsFrom({
        VERCEL_URL: "cip-abc123-team.vercel.app",
        VERCEL_BRANCH_URL: "cip-git-main-team.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "cip.vercel.app",
      })
    ).toEqual([
      "https://cip-abc123-team.vercel.app",
      "https://cip-git-main-team.vercel.app",
      "https://cip.vercel.app",
    ]);
  });

  test("a host given with a scheme or a path is reduced to its origin", () => {
    expect(trustedOriginsFrom({ VERCEL_URL: "https://cip.vercel.app/" })).toEqual([
      "https://cip.vercel.app",
    ]);
    expect(trustedOriginsFrom({ VERCEL_BRANCH_URL: "http://cip.vercel.app/login?x=1" })).toEqual([
      "https://cip.vercel.app",
    ]);
  });

  test("duplicates collapse, the manual list first", () => {
    expect(
      trustedOriginsFrom({
        TRUSTED_ORIGINS: "https://cip.vercel.app",
        VERCEL_URL: "cip.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "cip.vercel.app",
      })
    ).toEqual(["https://cip.vercel.app"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/server/trustedOrigins.test.ts`
Expected: FAIL — cannot resolve `./trustedOrigins`.

- [ ] **Step 3: Write the module**

```ts
// lib/server/trustedOrigins.ts
/**
 * The origins Better Auth accepts a browser request from, beyond its base URL.
 *
 * `BETTER_AUTH_URL` is one value shared by Vercel's Preview and Production
 * environments and names the production alias, and Better Auth trusts only
 * that origin by default — so every preview deployment, and the two
 * secondary production aliases, answered 403 "Invalid origin" on sign-in.
 *
 * Two sources, in this order:
 *
 *   1. `TRUSTED_ORIGINS`, the comma-separated manual list the README has
 *      always documented. Entries pass through verbatim: Better Auth's own
 *      wildcard syntax (`https://*.example.com`) is theirs to interpret.
 *   2. The hosts Vercel sets on every deployment — `VERCEL_URL` (this
 *      deployment's unique host), `VERCEL_BRANCH_URL` (its git-branch alias)
 *      and `VERCEL_PROJECT_PRODUCTION_URL` (the production domain) — each
 *      made an https origin. They are absent locally and on any other host,
 *      where this adds nothing.
 *
 * Derived per deployment rather than a team-wide wildcard on purpose: a
 * wildcard over `*-<team>.vercel.app` would trust every project the team ever
 * deploys, where this trusts exactly the aliases of the deployment answering
 * the request. The bare `<project>-<team>.vercel.app` alias is in no system
 * variable and stays untrusted unless someone lists it.
 */
const VERCEL_HOST_VARS = [
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

/** `host`, `https://host/`, `http://host/path?q` → `https://host`. */
function asHttpsOrigin(value: string): string {
  const host = value.replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "");
  return `https://${host}`;
}

export function trustedOriginsFrom(
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const listed = (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const derived = VERCEL_HOST_VARS.map((name) => env[name]?.trim() ?? "")
    .filter(Boolean)
    .map(asHttpsOrigin);
  return Array.from(new Set([...listed, ...derived]));
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run lib/server/trustedOrigins.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Wire it into `auth.ts`**

Replace the inline split in `lib/server/auth.ts`:

```ts
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
```

with

```ts
    // The manual list plus this deployment's own Vercel aliases — see
    // lib/server/trustedOrigins.ts for why previews needed this.
    trustedOrigins: trustedOriginsFrom(process.env),
```

and add `import { trustedOriginsFrom } from "./trustedOrigins";` beside the other relative imports.

- [ ] **Step 6: Update the two documents**

In `.env.example`, replace the `TRUSTED_ORIGINS` comment block with:

```
# Comma-separated extra origins allowed to call the auth API. On Vercel the
# deployment's own URL, its git-branch alias and the production domain are
# trusted automatically (lib/server/trustedOrigins.ts), so a preview can sign
# in without a value here. Only needed for a host Vercel does not name — a
# custom domain that is not the production one, or a cross-origin caller.
# Better Auth's wildcard syntax works: https://*.example.com
#TRUSTED_ORIGINS=
```

In `README.md`, change the row's description to: `Comma-separated extra origins allowed to call the auth API; on Vercel the deployment's own aliases are trusted without it`.

- [ ] **Step 7: Run the auth suites and tsc**

Run: `npx vitest run lib/server/authBoot.test.ts lib/server/authAccounts.test.ts lib/server/trustedOrigins.test.ts && npx tsc --noEmit`
Expected: all green, tsc silent.

- [ ] **Step 8: Report** (no commit — see Global Constraints).

---

### Task 2: `setCurrencySettingsIf` — the version-guarded settings write

**Files:**
- Modify: `lib/server/tripStore.ts` (after `setCurrencySettings`, ~line 305)
- Modify: `lib/server/pgStore.ts` (after `setCurrencySettings`, ~line 627)
- Modify: `lib/server/store.ts` (after `setCurrencySettings`, ~line 254)
- Modify: `lib/server/tripStore.test.ts` (the currency-settings test, ~line 270-284; add to its import list)
- Modify: `lib/server/pgStore.test.ts` (new `describe`; add to its import)

**Interfaces:**
- Produces (sqlite): `setCurrencySettingsIf(tripId: string, settings: CurrencySettings, expectedVersion: number): boolean`
- Produces (pg + facade): the same signature returning `Promise<boolean>`
- Consumed by Task 3.

**Background.** `trips.version` is bumped by `touch()` on every write and read back by `getTrip` as `payload.version`. `updateTripDataIf` is the existing compare-and-set on `trips.data`; `pgStore.test.ts` pins that it is ONE statement, because a guard and a bump split across two autocommit statements is not a guard. `trip_settings` is a separate table keyed by `trip_id`, written by an upsert.

- [ ] **Step 1: Write the failing sqlite test**

Extend the existing currency test in `lib/server/tripStore.test.ts` (add `setCurrencySettingsIf` to the import list) with a second test in the same `describe`:

```ts
  test("setCurrencySettingsIf writes only against the version it was given", () => {
    const { id } = createTrip(tripData(), "Ada");
    const version = getTrip(id)!.version;
    const settings: CurrencySettings = { home: "PEN", rates: { PEN: 3.7 } };

    // A stale expectation writes nothing and bumps nothing.
    expect(setCurrencySettingsIf(id, settings, version + 1)).toBe(false);
    expect(getTrip(id)!.currencySettings).not.toEqual(settings);
    expect(getTrip(id)!.version).toBe(version);

    // The current one writes, and the version moves — so a second writer
    // holding the old number is refused, exactly as updateTripDataIf does.
    expect(setCurrencySettingsIf(id, settings, version)).toBe(true);
    expect(getTrip(id)!.currencySettings).toEqual(settings);
    expect(getTrip(id)!.version).toBe(version + 1);
    expect(setCurrencySettingsIf(id, settings, version)).toBe(false);

    expect(setCurrencySettingsIf("nope", settings, 1)).toBe(false);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/server/tripStore.test.ts`
Expected: FAIL — `setCurrencySettingsIf` is not exported.

- [ ] **Step 3: Implement in sqlite**

Add to `lib/server/tripStore.ts` directly after `setCurrencySettings`:

```ts
/**
 * `setCurrencySettings` under the trip's version guard: the upsert lands only
 * if nobody has bumped the trip since it was read. False = conflict or
 * unknown trip; the caller re-reads and re-applies.
 *
 * One transaction, so the version check and the write cannot interleave with
 * another writer's `touch` — better-sqlite3 runs it synchronously on the one
 * connection, which is what makes the read-then-write atomic here.
 */
export function setCurrencySettingsIf(
  tripId: string,
  settings: CurrencySettings,
  expectedVersion: number
): boolean {
  const db = getDb();
  const write = db.transaction((): boolean => {
    const row = db.prepare("SELECT version FROM trips WHERE id = ?").get(tripId) as
      | { version: number }
      | undefined;
    if (row === undefined || Number(row.version) !== expectedVersion) return false;
    db.prepare(
      "INSERT INTO trip_settings (trip_id, currency_settings) VALUES (?, ?) " +
        "ON CONFLICT(trip_id) DO UPDATE SET currency_settings = excluded.currency_settings"
    ).run(tripId, JSON.stringify(settings));
    touch(tripId);
    return true;
  });
  return write();
}
```

- [ ] **Step 4: Run the sqlite test to see it pass**

Run: `npx vitest run lib/server/tripStore.test.ts`
Expected: green, one more test than before.

- [ ] **Step 5: Write the failing postgres test**

Add `setCurrencySettingsIf` to the import from `./pgStore` in `lib/server/pgStore.test.ts` and a new `describe` after the `updateTripDataIf` one:

```ts
describe("setCurrencySettingsIf — the same guard for the settings blob", () => {
  const SETTINGS = { home: "PEN", rates: { PEN: 3.7 } };

  it("guards, bumps and upserts in ONE statement", async () => {
    const statements = installRecorder(1);

    expect(await setCurrencySettingsIf("trip-1", SETTINGS, 7)).toBe(true);

    // A guard in one autocommit statement and the write in another is not a
    // guard: the other writer can land between them. The CTE keeps them in one.
    expect(statements).toHaveLength(1);
    const [only] = statements;
    expect(only.text).toContain("version = version + 1");
    expect(only.text).toContain("AND version = $");
    expect(only.text).toContain("INSERT INTO trip_settings");
    expect(only.text).toContain("ON CONFLICT (trip_id) DO UPDATE");
    expect(only.params).toContain("trip-1");
    expect(only.params).toContain(7);
    expect(only.params).toContainEqual(SETTINGS);
  });

  it("reports a lost race as false", async () => {
    installRecorder(0);
    expect(await setCurrencySettingsIf("trip-1", SETTINGS, 7)).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run lib/server/pgStore.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 7: Implement in postgres**

Add to `lib/server/pgStore.ts` directly after `setCurrencySettings`:

```ts
/**
 * `setCurrencySettings` under the trip's version guard — see the sqlite twin
 * for the contract. ONE statement: the CTE bumps `trips.version` only where
 * it still equals the expected value, and the upsert is fed from its
 * `RETURNING`, so a stale expectation inserts nothing and the guard and the
 * write cannot be split across autocommit statements (the property
 * pgStore.test.ts pins for `updateTripDataIf`, for the same reason).
 */
export async function setCurrencySettingsIf(
  tripId: string,
  settings: CurrencySettings,
  expectedVersion: number
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`WITH bumped AS (
      UPDATE trips SET version = version + 1, updated_at = ${Date.now()}
      WHERE id = ${tripId} AND version = ${expectedVersion}
      RETURNING id
    )
    INSERT INTO trip_settings (trip_id, currency_settings)
    SELECT id, ${s.json(JSON.parse(JSON.stringify(settings)))} FROM bumped
    ON CONFLICT (trip_id) DO UPDATE SET currency_settings = EXCLUDED.currency_settings`;
  return result.count > 0;
}
```

- [ ] **Step 8: Run the postgres test to see it pass**

Run: `npx vitest run lib/server/pgStore.test.ts`
Expected: green, two more tests.

- [ ] **Step 9: Add the facade**

In `lib/server/store.ts` after `setCurrencySettings`:

```ts
export async function setCurrencySettingsIf(
  tripId: string,
  settings: CurrencySettings,
  expectedVersion: number
): Promise<boolean> {
  if (storeMode() === "postgres") {
    return (await pg()).setCurrencySettingsIf(tripId, settings, expectedVersion);
  }
  return sqlite.setCurrencySettingsIf(tripId, settings, expectedVersion);
}
```

- [ ] **Step 10: Run the whole server suite and tsc**

Run: `npx vitest run lib/server && npx tsc --noEmit`
Expected: green; if a parity test enumerates the facade's exports, it must still pass — read its failure rather than editing it.

- [ ] **Step 11: Report.**

---

### Task 3: `PUT /api/trips/[id]/currency` under the guard

**Files:**
- Modify: `app/api/trips/[id]/currency/route.ts`
- Create: `lib/server/currencyRoute.test.ts`

**Interfaces:**
- Consumes: `setCurrencySettingsIf(tripId, settings, expectedVersion): Promise<boolean>` from `@/lib/server/store` (Task 2). Until Task 2 lands in the same checkout, `tsc` will complain about the import — that is expected; the test mocks the store so it runs regardless.

**Background.** The route reads `currencySettings`, merges the body through `applyCurrencySettingsUpdate` (which carries the stored `pivot` forward because the client never sends one), and writes the whole blob. Two members saving at once lose one save silently. `app/api/trips/[id]/gateways/route.ts` shows the loop this route adopts.

- [ ] **Step 1: Write the failing test file**

```ts
// lib/server/currencyRoute.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fullPayload } from "@/lib/tripFixtures";

/**
 * Drives the real PUT handler with its seams mocked the way
 * gatewaysRoute.test.ts mocks them: membership and the store. The merge
 * (`applyCurrencySettingsUpdate`) is real.
 */
vi.mock("@/lib/server/authz", () => ({ requireMember: vi.fn() }));
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  getTrip: vi.fn(),
  setCurrencySettingsIf: vi.fn(),
  // Present so "never called" is about a real export, not a typo.
  setCurrencySettings: vi.fn(),
}));

const { PUT } = await import("@/app/api/trips/[id]/currency/route");
const { requireMember } = await import("@/lib/server/authz");
const { getTrip, setCurrencySettingsIf, setCurrencySettings } = await import("@/lib/server/store");
const { NextRequest } = await import("next/server");

function request(body: unknown) {
  return new NextRequest("http://localhost/api/trips/trip-1/currency", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "trip-1" }) };
const BODY = { home: "SGD", rates: { SGD: 5.2 } };

/** A stored blob with a pivot the client never sends and must not lose. */
function storedPayload() {
  const payload = fullPayload();
  return { ...payload, currencySettings: { home: "CNY", rates: {}, pivot: "CNY" } };
}

beforeEach(() => {
  vi.mocked(requireMember).mockReset();
  vi.mocked(requireMember).mockResolvedValue({ memberName: "Ada" });
  vi.mocked(getTrip).mockReset();
  vi.mocked(getTrip).mockResolvedValue(storedPayload());
  vi.mocked(setCurrencySettingsIf).mockReset();
  vi.mocked(setCurrencySettingsIf).mockResolvedValue(true);
  vi.mocked(setCurrencySettings).mockClear();
});

describe("PUT /api/trips/:id/currency", () => {
  test("writes the merged settings under the version it read, carrying the pivot", async () => {
    const res = await PUT(request(BODY), params);
    expect(res.status).toBe(200);
    const [id, settings, version] = vi.mocked(setCurrencySettingsIf).mock.calls[0];
    expect(id).toBe("trip-1");
    expect(version).toBe(storedPayload().version);
    expect(settings).toEqual({ home: "SGD", rates: { SGD: 5.2 }, pivot: "CNY" });
    expect(setCurrencySettings).not.toHaveBeenCalled();
  });

  test("returns the member payload, like the other sub-routes", async () => {
    const res = await PUT(request(BODY), params);
    expect(await res.json()).toMatchObject({ id: "trip-1", myMemberName: "Ada" });
  });

  test("rejects a malformed body before any write", async () => {
    expect((await PUT(request({ home: 5, rates: [] }), params)).status).toBe(400);
    expect(setCurrencySettingsIf).not.toHaveBeenCalled();
  });

  test("404s an unknown trip", async () => {
    vi.mocked(getTrip).mockResolvedValue(null);
    expect((await PUT(request(BODY), params)).status).toBe(404);
    expect(setCurrencySettingsIf).not.toHaveBeenCalled();
  });

  test("re-reads and retries when another member's write lands first", async () => {
    vi.mocked(setCurrencySettingsIf).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await PUT(request(BODY), params);
    expect(res.status).toBe(200);
    expect(setCurrencySettingsIf).toHaveBeenCalledTimes(2);
    // Re-READ, not merely re-written: the second attempt merges into the
    // trip as it is now, which is the whole point of retrying.
    expect(getTrip.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("gives up with a 409 after three lost races", async () => {
    vi.mocked(setCurrencySettingsIf).mockResolvedValue(false);
    const res = await PUT(request(BODY), params);
    expect(res.status).toBe(409);
    expect(setCurrencySettingsIf).toHaveBeenCalledTimes(3);
  });

  test("is closed to non-members", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireMember).mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    expect((await PUT(request(BODY), params)).status).toBe(403);
    expect(setCurrencySettingsIf).not.toHaveBeenCalled();
  });
});
```

If `CurrencySettingsSchema` (in `lib/server/schemas.ts`) rejects something in `BODY`, read the schema and adjust `BODY` to a valid shape — do not weaken the assertions.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run lib/server/currencyRoute.test.ts`
Expected: FAIL — the route still calls `setCurrencySettings`; the guard is never called.

- [ ] **Step 3: Rewrite the handler's write**

Replace everything from the `// Read-modify-write:` comment to the end of `PUT` with:

```ts
  // Read-modify-write under the version guard the plan and gateways routes
  // use. The client never sends a pivot (it isn't editable — see
  // CurrencySettingsEditor), so the stored one is read and carried forward
  // by applyCurrencySettingsUpdate; and because two members can do that at
  // once, the write lands only if the trip's version is still the one that
  // was read. A lost race re-reads and re-applies rather than reverting the
  // other member's save.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const before = await getTrip(id, gate.memberName);
    if (!before) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    const written = await setCurrencySettingsIf(
      id,
      applyCurrencySettingsUpdate(before.currencySettings, parsed.data),
      before.version
    );
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

Add above `type Params`:

```ts
/** Re-read/re-apply attempts when another member writes concurrently. */
const MAX_WRITE_ATTEMPTS = 3;
```

and change the store import to `import { DB_UNAVAILABLE, getTrip, setCurrencySettingsIf, storeMode } from "@/lib/server/store";`.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run lib/server/currencyRoute.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Report.** (`tsc` may show one error on the new import until Task 2 lands; say so.)

---

### Task 4: `PATCH /api/trips/[id]` (the rebuild) under the guard

**Files:**
- Modify: `app/api/trips/[id]/route.ts` (the `PATCH` handler, from `await ensureCatalogLoaded()` down)
- Modify: `lib/server/updateTripRoute.test.ts`

**Interfaces:**
- Consumes: `updateTripDataIf(tripId, data, expectedVersion): Promise<boolean>` from `@/lib/server/store` (exists today).

**Background.** The rebuild replaces `data` wholesale on purpose — a member asked for a new plan — but a gateway another member saved between this handler's read and its write is reverted too. `PUT /gateways` and `POST /plan` already write through `updateTripDataIf` in a three-attempt loop. Nothing on the client calls PATCH today (verified by grep), so no client change is needed.

- [ ] **Step 1: Change the test's seams and add the failing tests**

In `lib/server/updateTripRoute.test.ts`, the store mock becomes:

```ts
vi.mock("@/lib/server/store", () => ({
  storeMode: () => "sqlite",
  DB_UNAVAILABLE: "unavailable",
  getTrip: vi.fn(),
  updateTripDataIf: vi.fn(async () => true),
  // Present so "never called" is about a real export, not a typo.
  updateTripData: vi.fn(async () => undefined),
  clearScheduleChecks: vi.fn(async () => undefined),
}));
```

the destructured import adds `updateTripDataIf`, `storedInput()` reads `vi.mocked(updateTripDataIf).mock.calls[0]`, and `beforeEach` resets `updateTripDataIf` to `mockResolvedValue(true)` (use `mockReset` then `mockResolvedValue`) and clears `updateTripData`. Add these tests to the `describe`:

```ts
  test("writes under the version it read, never through the unguarded write", async () => {
    const res = await PATCH(request({ input }), params);
    expect(res.status).toBe(200);
    const [id, , version] = vi.mocked(updateTripDataIf).mock.calls[0];
    expect(id).toBe("trip-1");
    expect(version).toBe(fullPayload().version);
    expect(updateTripData).not.toHaveBeenCalled();
    expect(clearScheduleChecks).toHaveBeenCalledTimes(1);
  });

  test("re-reads and rebuilds when another member's write lands first", async () => {
    vi.mocked(updateTripDataIf).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await PATCH(request({ input }), params);
    expect(res.status).toBe(200);
    expect(updateTripDataIf).toHaveBeenCalledTimes(2);
    // The second attempt rebuilds against a fresh read.
    expect(vi.mocked(getTrip).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(clearScheduleChecks).toHaveBeenCalledTimes(1);
  });

  test("gives up with a 409 after three lost races, clearing no ticks", async () => {
    vi.mocked(updateTripDataIf).mockResolvedValue(false);
    const res = await PATCH(request({ input }), params);
    expect(res.status).toBe(409);
    expect(updateTripDataIf).toHaveBeenCalledTimes(3);
    expect(clearScheduleChecks).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to see the new tests fail**

Run: `npx vitest run lib/server/updateTripRoute.test.ts`
Expected: the three new tests FAIL (the handler still calls `updateTripData`); the three existing ones may fail too until Step 3, since `storedInput` now reads the guarded write.

- [ ] **Step 3: Rewrite the handler's tail**

In `app/api/trips/[id]/route.ts`, replace everything in `PATCH` from `const existing = await getTrip(id);` to the end of the function with:

```ts
  await ensureCatalogLoaded();
  // The rebuild replaces the plan on purpose — a member asked for it — but
  // it must not also replace what another member wrote between this read
  // and this write: the gateways they just saved, say. So it lands under the
  // same version guard the plan and gateways routes use, and a lost race
  // re-reads and rebuilds against the newer trip rather than reverting it.
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await getTrip(id);
    if (!existing) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }
    const data = buildTripData({
      tripName: parsed.data.tripName ?? existing.data.tripName,
      startDate:
        parsed.data.startDate !== undefined ? parsed.data.startDate : existing.data.startDate,
      // A rebuild sends a whole TripInput; one written before the gateway
      // fields existed omits them, and absent means "unchanged", never
      // "cleared".
      input: parsed.data.input
        ? carryGateways(parsed.data.input, existing.data.input)
        : existing.data.input,
    });
    if (data.plan.days.length === 0) {
      return NextResponse.json(
        { error: "No plannable destinations in the selection" },
        { status: 400 }
      );
    }
    const written = await updateTripDataIf(id, data, existing.version);
    if (!written) continue;
    // The rebuilt plan has fresh item ids, so old schedule ticks are orphans.
    await clearScheduleChecks(id);
    const payload = await getTrip(id, gate.memberName);
    return NextResponse.json({ ...payload, myMemberName: gate.memberName });
  }

  return NextResponse.json(
    { error: "The trip is being edited by someone else right now — try again." },
    { status: 409 }
  );
}
```

Add `const MAX_WRITE_ATTEMPTS = 3;` with the same one-line docblock the gateways route has, above `type Params`; replace `updateTripData` with `updateTripDataIf` in the store import (remove `updateTripData` if nothing else in the file uses it).

- [ ] **Step 4: Run the test file to see it pass**

Run: `npx vitest run lib/server/updateTripRoute.test.ts && npx tsc --noEmit`
Expected: 6 passed; tsc silent.

- [ ] **Step 5: Report.**

---

### Task 5: A real `server-only` guard, and the cold-start number written down

**Files:**
- Modify: `package.json` + `package-lock.json` (via `npm install`)
- Modify: `vitest.config.mts` (the `alias` object)
- Create: `vitest.server-only.ts`
- Modify: `lib/server/airports.ts:1` and its docblock (`Server-only by convention…`)
- Modify: `lib/server/cityIndex.ts:1` and its docblock (two paragraphs)
- Modify: `lib/server/catalog.ts:1` and its `BUNDLED_CATALOG` docblock

**Background.** The `server-only` package throws on import unless the bundler resolves it under React's `react-server` condition, which is what `next build` does for server graphs and never does for client ones — so a client import becomes a build error instead of a silent 3.6 MB in the browser bundle. Vitest is not a bundler and imports `lib/server/*` from node and jsdom tests alike, so it gets an alias to an empty module. No script under `scripts/` imports `lib/server/*` (verified), and `lib/countryFacts.test.ts`'s import walker ignores bare specifiers by design.

- [ ] **Step 1: Install the package**

Run: `npm install server-only@0.0.1 --save --ignore-scripts`
Expected: `package.json` gains `"server-only": "0.0.1"` under `dependencies`; `ls node_modules/server-only` lists `index.js`, `empty.js`, `package.json`. Then `git diff --stat package.json package-lock.json` shows only those two files changed.

- [ ] **Step 2: Add the guard to the three modules and watch the suite go red**

Put `import "server-only";` as the first line of `lib/server/airports.ts`, `lib/server/cityIndex.ts` and `lib/server/catalog.ts`.

Run: `npx vitest run lib/server/airports.test.ts`
Expected: FAIL — `This module cannot be imported from a Client Component module…` (the package's own throw), which proves the guard is live before the alias hides it from Vitest.

- [ ] **Step 3: Alias it for Vitest**

Create `vitest.server-only.ts`:

```ts
/**
 * What Vitest resolves `import "server-only"` to.
 *
 * The real package throws on import anywhere but a React Server Components
 * build — that is its whole job in `next build`, where it turns a client
 * import of lib/server/* into a build error instead of a silent multi-megabyte
 * artifact in the browser bundle. Vitest is not a bundler and imports those
 * modules from node and jsdom tests alike, so here the guard is inert. See
 * vitest.config.mts.
 */
export {};
```

In `vitest.config.mts`, the alias becomes:

```ts
const alias = {
  "@": path.resolve(import.meta.dirname, "."),
  // `server-only` throws on import outside a React Server Components build,
  // which is the point of it in `next build` and noise here — see
  // vitest.server-only.ts.
  "server-only": path.resolve(import.meta.dirname, "vitest.server-only.ts"),
};
```

Run: `npx vitest run lib/server/airports.test.ts`
Expected: green.

- [ ] **Step 4: Update the three docblocks**

`lib/server/airports.ts` — replace the paragraph beginning `Server-only by convention` with:

```
 * Server-only, and enforced: `server-only` above makes a client import a
 * `next build` error rather than a silent 816 KB in the browser bundle.
 * Vitest aliases the package to an empty module (vitest.server-only.ts).
```

`lib/server/cityIndex.ts` — replace the paragraph beginning `Server-only by convention` the same way (with `3.65 MB` in place of `816 KB`), and append to the paragraph ending `…is paid per instance, not once.`:

```
 * Measured 2026-09-06, JSON.parse of the committed files, median of five: this
 * one 22.6 ms, airports.json 2.5 ms, catalog.json 1.1 ms — about 27 ms per
 * cold instance for the three. That is why they stay static imports rather
 * than runtime reads: a file the function bundle does not carry answers 500,
 * and 27 ms is not worth that risk.
```

`lib/server/catalog.ts` — append to the `BUNDLED_CATALOG` docblock:

```
 * Server-only, and enforced by the `server-only` import above; Vitest
 * aliases the package to an empty module (vitest.server-only.ts).
```

- [ ] **Step 5: Run the full suite, tsc, and a production build**

Run: `npm test` then `npx tsc --noEmit` then `npx next build`
Expected: 133 files green plus your changes (no test count drops); tsc silent; the build completes — that build is the guard's proof, since a client import of any of the three would fail it. Note the build's wall time in the report.

- [ ] **Step 6: Report.** Include `git status --short` — `next build` must not have left anything but `.next/` (which is ignored).

---

### Task 6: One verdict per marker per month, not per hover

**Files:**
- Modify: `components/map/CountryLevel.tsx` (a `useMemo` beside `marks`, ~line 1060; the `fill=` at ~line 1466)
- Modify: `components/map/CountryLevel.test.tsx` (a partial `vi.mock` of `./mapTypes` at the top; one new test)

**Background.** `CountryLevel` re-renders on every hover — `MapExplorer` holds the hover card as state above it — and every render calls `fitForPlace(place, month, climate)` once per drawn marker inside the JSX. `marks` and `caps` are already memoised "once per country and never on a hover" (see the docblock at ~line 1040); the fill is the one per-marker value that was not.

- [ ] **Step 1: Write the failing test**

At the top of `components/map/CountryLevel.test.tsx`, after the existing `vi.mock("@/lib/dragLayer", …)`:

```ts
// Wraps the real resolver in a spy so a test can count how often a render
// consults it. Behaviour is unchanged: every call goes through to the original.
vi.mock("./mapTypes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mapTypes")>();
  return { ...actual, fitForPlace: vi.fn(actual.fitForPlace) };
});
```

Add `fitForPlace` to the import from `./mapTypes`, `useState` to the React import if absent, and this test in the `describe` that covers marker colours (the one whose tests assert `FIT_COLORS[...]` on `data-dot`):

```ts
  test("resolves each marker's verdict once per month, not once per hover", () => {
    /**
     * A host that re-renders the level on hover, as MapExplorer does — the
     * hover card is state above the level. Without it the level would not
     * re-render and the assertion would be vacuous.
     */
    function HoverHost(props: Parameters<typeof CountryLevel>[0]) {
      const [hovered, setHovered] = useState<string>("");
      return (
        <>
          <CountryLevel {...props} onHoverPlace={(place) => setHovered(place?.id ?? "")} />
          <output data-testid="hovered">{hovered}</output>
        </>
      );
    }
    const spy = vi.mocked(fitForPlace);
    const base = levelProps();
    const { container, rerender } = render(<HoverHost {...base} />);
    const settled = spy.mock.calls.length;
    expect(settled).toBeGreaterThan(0);

    const cusco = container.querySelector('[data-place="cusco"]')!;
    fireEvent.mouseEnter(cusco, { clientX: 40, clientY: 50 });
    fireEvent.mouseMove(cusco, { clientX: 41, clientY: 51 });
    fireEvent.mouseMove(cusco, { clientX: 42, clientY: 52 });
    // The host re-rendered (the hover reached it)…
    expect(screen.getByTestId("hovered").textContent).toBe("cusco");
    // …and no marker asked for its verdict again.
    expect(spy.mock.calls.length).toBe(settled);

    // A month change is a real reason to ask.
    rerender(<HoverHost {...base} month={base.month === 6 ? 7 : 6} />);
    expect(spy.mock.calls.length).toBeGreaterThan(settled);
  });
```

`levelProps()` stands for however the file's `renderLevel` builds its props — read `renderLevel` (~line 195) and either reuse its props builder or lift one out (a pure function returning the default props object). Do not duplicate the fixture.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run components/map/CountryLevel.test.tsx -t "once per month"`
Expected: FAIL on `expect(spy.mock.calls.length).toBe(settled)` — the count grew with the hover.

- [ ] **Step 3: Memoise the fills**

In `components/map/CountryLevel.tsx`, after the `marks` memo:

```ts
  /**
   * Each marker's fill, resolved once per (places, month, climate) rather than
   * once per render: this level re-renders on every hover — the hover card is
   * state above it — and a verdict depends on nothing the pointer changes.
   * Indexed like `marks`, by the place's position in the country, so a zoom
   * re-uses it untouched.
   */
  const fills = useMemo(
    () => places.map((place) => FIT_COLORS[fitForPlace(place, month, climate)]),
    [places, month, climate]
  );
```

and in the marker JSX replace `fill={FIT_COLORS[fitForPlace(place, month, climate)]}` with `fill={fills[index]}`.

- [ ] **Step 4: Run the file to see everything pass**

Run: `npx vitest run components/map/CountryLevel.test.tsx && npx tsc --noEmit`
Expected: green, one more test than before; tsc silent.

- [ ] **Step 5: Report.**

---

### Task 7: The note's accessible name says what it is about

**Files:**
- Modify: `components/plan/GapNote.tsx`
- Create: `components/plan/GapNote.test.tsx`
- Modify: `components/map/MapExplorer.tsx` (~line 972, the `<GapNote …/>` in `belowMap`)
- Modify: `components/map/MapExplorer.test.tsx` (~lines 2052, 2073, 2087 — the three `"About these notes"`)
- Modify: `e2e/climate.spec.ts:17` (`const NOTE`)

**Background.** `GapNote` renders `role="note"` with a fixed `aria-label="About these notes"`. On the three tip surfaces the paragraph sits under a list of notes and the name fits; under the map it explains the marker colours, and a screen reader is told about notes that are not there.

- [ ] **Step 1: Write the failing test**

```tsx
// components/plan/GapNote.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { GapNote } from "./GapNote";

describe("GapNote", () => {
  test("renders nothing for no lines", () => {
    const { container } = render(<GapNote lines={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("is a note named for the tip surfaces by default", () => {
    render(<GapNote lines={["Source: Wikidata.", "Missing: currency."]} />);
    const note = screen.getByRole("note", { name: "About these notes" });
    expect(note.textContent).toContain("Missing: currency.");
  });

  test("takes the name a surface gives it", () => {
    render(<GapNote label="About the climate colours" lines={["Derived from grid normals."]} />);
    expect(screen.getByRole("note", { name: "About the climate colours" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "About these notes" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see the third case fail**

Run: `npx vitest run components/plan/GapNote.test.tsx`
Expected: 2 passed, 1 failed (`label` is not a prop; tsc would also refuse it).

- [ ] **Step 3: Add the prop**

In `components/plan/GapNote.tsx`:

```tsx
export function GapNote({
  lines,
  label = "About these notes",
}: {
  lines: readonly string[];
  /**
   * The accessible name. The default fits the three tip surfaces, where the
   * paragraph sits under a list of notes; the map passes its own, because
   * under a map the thing being explained is the colours, not any notes.
   */
  label?: string;
}): ReactElement | null {
```

and `aria-label={label}` in place of the literal.

- [ ] **Step 4: Rename it under the map**

In `components/map/MapExplorer.tsx`: `<GapNote label="About the climate colours" lines={climateGapNote(countryCode, climate.size)} />`.
In `components/map/MapExplorer.test.tsx`: the three `"About these notes"` become `"About the climate colours"`.
In `e2e/climate.spec.ts`: `const NOTE = { name: "About the climate colours" };`.

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run components/plan/GapNote.test.tsx components/map/MapExplorer.test.tsx components/PlanStep.test.tsx components/trip && npx tsc --noEmit`
Expected: green (the PlanStep and briefing tests still find the default name); tsc silent. The e2e spec is run by the controller.

- [ ] **Step 6: Report.**

---

### Task 8: The handover document says what is closed

**Files:**
- Modify: `docs/superpowers/handoffs/2026-08-18-agent-review-findings.md` (top of file)

The controller does this one. Insert, directly after the `**Fixed already** (commit 59c88bf)…` paragraph, replacing the line `**Everything below is still open.**`:

```markdown
**Status 2026-09-06 — every finding below is closed.** Verified against
`main` at 3ddf4dc; the findings are left as written because they are the
record of what was found.

| Finding | Closed by |
|---|---|
| HIGH `app/plan/page.tsx:158` (country never reaches the write boundary; listed twice) | `tripInput` carries `country: tripCountry` (`app/plan/page.tsx` ~305-317) and `addOffMap` stamps the open country (~209) |
| HIGH `components/plan/PlaceSearch.tsx:70` (catalog search unscoped; listed twice) | `app/api/destinations/route.ts` requires `country` and answers nothing without it; `PlaceSearch` sends the open country on every request |
| MEDIUM `components/map/WorldMap.tsx:66` (small-country pointer target) | Closed the way the finding proposed — a different interaction: the world level's A–Z `<select>` ("Or pick from the list", `components/map/worldLevelShared.tsx`) reaches every country, and the globe is the default picker (PR #17, PR #29) |
| MEDIUM `components/shell/CountryHero.tsx:72` (accent override bypasses prefs) | `CountryHero` resolves through `resolveAccentOverride(prefs, country.code)` from `lib/prefs` |
| LOW `data/country-images.json:56` (984-character credit) | At the boundary: `lib/countryImagery.ts`'s `creditText` refuses a credit over `MAX_CREDIT_TEXT_LENGTH`, so the record yields no image and Indonesia renders the accent gradient; the data row is unchanged on purpose (its docblock says why) |
| MEDIUM `components/trip/BalancesCard.tsx:89` (positive balance in the seal family) | A positive balance is `var(--ink-0)` (`BalancesCard.tsx` ~126) |
| MEDIUM `components/plan/useDayBuilder.ts:62` (activities frozen at mount) | `useDayBuilder` dispatches `setActivities` whenever `activitiesByDestination` changes (~79-80) |
```

- [ ] **Step 1: Apply the edit and read the result back once.**

---

### Task 9: Split `MapExplorer.tsx` and its test along their seams

**Files:**
- Create: `components/map/explorerPlaces.ts`
- Create: `components/map/explorerPlaces.test.ts`
- Create: `components/map/useCountryAssets.ts`
- Create: `components/map/WorldPane.tsx`
- Create: `components/map/RoutePanel.tsx`
- Create: `components/map/stepUpButton.ts`
- Create: `components/map/mapExplorerHarness.tsx`
- Create: `components/map/MapExplorer.provinces.test.tsx`, `components/map/MapExplorer.airports.test.tsx`, `components/map/MapExplorer.climate.test.tsx`
- Modify: `components/map/MapExplorer.tsx`, `components/map/MapExplorer.test.tsx`
- Modify: `lib/countryFacts.test.ts` (~line 917-927 `MUST_STAY_CHEAP`, and the `toHaveLength(9)` at ~957)

**Interfaces:**
- Produces: `dropCatalogTwins(rows: CityShardRow[], catalog: MapCity[]): CityShardRow[]`; `mergeCountryCities(countryCode: string, catalogCities: MapCity[], shardRows: CityShardRow[], enrichment: CityEnrichmentIndex): MapCity[]`; `buildExplorerPlaces(cities: MapCity[], visited: readonly string[], countryCode: string): MapPlace[]`
- Produces: `useCountryAssets(countryCode: string, hasDetail: boolean): CountryAssets` where `CountryAssets = { provinces: ProvinceFile | null; projection: ProjectionEntry | null; cities: MapCity[]; citiesUnavailable: boolean; airports: Airport[]; climate: DerivedClimateIndex; loadError: boolean; retry: () => void }`
- Produces: `WorldPane({ countryCode, countryLabel, openedCountry, onPickCountry, onLevelChange })` and `RoutePanel({ route, arrival, onArrivalChange, onApplyOrder, countryLabel, unresolvedCount })`; `STEP_UP_BUTTON` from `stepUpButton.ts`
- `MapLevel` stays exported from `MapExplorer.tsx` (its importers are untouched); `WorldPane` imports it with `import type`.

**The rule for this task: behaviour-preserving, proven by the existing tests passing without their bodies changing.** Code and docblocks move verbatim; the only new prose is where a moved block needs a new home named. Run the whole `components/map` suite after each move, not at the end.

- [ ] **Step 1: Baseline**

Run: `npx vitest run components/map && wc -l components/map/MapExplorer.tsx components/map/MapExplorer.test.tsx`
Record both numbers (expect 1114 / 2215 lines, or 1115 / 2215 after Task 7).

- [ ] **Step 2: `stepUpButton.ts`**

Move `STEP_UP_BUTTON` (and its docblock, ~line 160-173 of `MapExplorer.tsx`) to `components/map/stepUpButton.ts` as a named export; import it in `MapExplorer.tsx`. Suite green.

- [ ] **Step 3: `explorerPlaces.ts` — three pure functions**

Move `SAME_CITY_KM` and `dropCatalogTwins` (with docblocks, ~lines 75-131) verbatim. Add:

```ts
/**
 * The open country's cities for the map: the Wikidata catalog's rows first,
 * then the GeoNames shard's, minus the ones that would draw twice.
 *
 * A GeoNames row for a place a curated card already covers is a second marker
 * for the same place. `dropCatalogDuplicates` in the ingest only removes rows
 * that duplicate a data/catalog.json QID city, and Yangshuo — a curated
 * destination — has no catalog.json row, so its row survives and would draw
 * beside "Guilin & Yangshuo".
 *
 * China is the one country that gets both halves, and they are not disjoint.
 * Measured on the committed data: /api/map/cities answers CN with 676
 * Wikidata cities, and of the shard's 413 rows 3 fold to a curated name and
 * 19 more are `dropCatalogTwins` duplicates, so 391 join them — 1,067
 * catalog markers rather than the 1,086 a plain concatenation draws.
 */
export function mergeCountryCities(
  countryCode: string,
  catalogCities: MapCity[],
  shardRows: CityShardRow[],
  enrichment: CityEnrichmentIndex
): MapCity[] {
  const suppressed = curatedPlaceNames(countryCode);
  const shardCities = dropCatalogTwins(
    shardRows.filter((row) => !suppressed.has(foldPlaceName(row.n))),
    catalogCities
  ).map((row) => shardRowToMapCity(row, enrichment));
  return [...catalogCities, ...shardCities];
}
```

and `buildExplorerPlaces(cities, visited, countryCode)` whose body is the `places` `useMemo` callback (~lines 594-663) verbatim, docblocks included. In `MapExplorer.tsx` the effect's `.then` calls `setCities(mergeCountryCities(countryCode, catalogRes.cities, shardRes?.cities ?? [], enrichment))` (delete the comment paragraphs that moved), and `const places = useMemo(() => buildExplorerPlaces(cities, visited, countryCode), [cities, visited, countryCode]);`. Move the imports that only those bodies used. Suite green.

Then `components/map/explorerPlaces.test.ts` (node project — no DOM):

```ts
import { describe, expect, test } from "vitest";
import type { CityShardRow } from "@/lib/cityShard";
import type { MapCity } from "@/lib/tripShared";
import { buildExplorerPlaces, dropCatalogTwins, mergeCountryCities } from "./explorerPlaces";

// Build the two fixtures from the real types: one catalog city, one shard row
// within 25 km of it under a folding-equal name, one shard row far away.
// Read lib/cityShard.ts for CityShardRow's tuple/field names and
// lib/tripShared.ts for MapCity before writing them — do not guess.

describe("dropCatalogTwins", () => {
  test("drops a shard row that names the catalog city within the same-city radius", () => { /* … */ });
  test("keeps a same-named row that is far away — a different place", () => { /* … */ });
});

describe("mergeCountryCities", () => {
  test("catalog first, then the shard minus curated names and twins", () => { /* … */ });
});

describe("buildExplorerPlaces", () => {
  test("a Chinese catalog city gets one of the seven regions; any other country's gets its admin-1 label", () => { /* … */ });
  test("a visited curated destination is left out", () => { /* … */ });
});
```

Fill each body with real assertions (the comment placeholders above are the list of cases, not the code). Run: `npx vitest run components/map/explorerPlaces.test.ts` — green.

- [ ] **Step 4: `useCountryAssets.ts`**

Move the seven `useState`s (`provinces`, `projection`, `cities`, `citiesUnavailable`, `loadError`, `retryKey`, `airports`, `climate` — with their docblocks) and BOTH effects (~lines 454-592) verbatim into:

```ts
export interface CountryAssets { /* as in Interfaces */ }

export function useCountryAssets(countryCode: string, hasDetail: boolean): CountryAssets {
  // …states and the two effects, verbatim, minus the one line `setHover(null)`…
  return { provinces, projection, cities, citiesUnavailable, airports, climate, loadError,
           retry: () => setRetryKey((k) => k + 1) };
}
```

The hover reset that was inside the country effect becomes, in `MapExplorer.tsx`:

```ts
  // `hover` holds a `MapPlace` derived from the previous country's cities, so
  // it is dropped the moment the country changes — `useCountryAssets` empties
  // those cities in the same commit, and nothing else re-creates a place.
  useEffect(() => setHover(null), [countryCode]);
```

`MapExplorer` destructures the hook's result; `showAirports` stays in `MapExplorer` (it is UI state, not an asset). The retry button calls `retry()`. Keep the country-effect docblock (the one beginning `Everything the open country's map needs`) with the hook. Suite green.

- [ ] **Step 5: `WorldPane.tsx`**

Move the `WorldMap`/`GlobeLevel` `dynamic()` imports, `usePrefs`, `useReducedMotion`, the `WorldLevel` resolution and its docblock, and the whole `if (level === "world") return (…)` JSX into `WorldPane` with props `{ countryCode: string; countryLabel: string; openedCountry: boolean; onPickCountry: (code: string) => void; onLevelChange: (level: MapLevel) => void }`. `MapExplorer` renders `<WorldPane … />` in that branch. If `MapExplorer.tsx` begins with `"use client"`, so does `WorldPane.tsx`. Suite green — including every test that asserts the globe/flat toggle, which now lives in `WorldPane`.

- [ ] **Step 6: `RoutePanel.tsx`**

Move the `{route && (<div className="mt-4 rounded-lg …">…</div>)}` block (~lines 1000-1113) into `RoutePanel` with props `{ route: NonNullable<ReturnType<typeof suggestRoute>>; arrival: AirportPick | null; onArrivalChange?: MapExplorer's onArrivalChange type; onApplyOrder: () => void; countryLabel: string; unresolvedCount: number }` — read `lib/route.ts` for the route type's name and import it rather than deriving it. Suite green.

- [ ] **Step 7: Sizes**

Run: `wc -l components/map/MapExplorer.tsx components/map/useCountryAssets.ts components/map/WorldPane.tsx components/map/RoutePanel.tsx components/map/explorerPlaces.ts`
Expected: every file under 800; `MapExplorer.tsx` well under (aim ~650).

- [ ] **Step 8: The test harness**

Move lines 1 to the end of `renderExplorer` (~773) of `MapExplorer.test.tsx` into `components/map/mapExplorerHarness.tsx`, exporting every fixture, helper, `Harness` and `renderExplorer`, and `fetchMock` if tests read it. If the file registers `beforeEach`/`afterEach` at top level, wrap them in an exported `installMapExplorerHarness()` that each test file calls once at its top; if `vi.mock("next/dynamic", …)` lives there, keep it there and verify a test that depends on it (`WorldPane`'s dynamic imports) still passes — if it does not apply from the helper, copy that one `vi.mock` block into each test file and say so in the report. Test bodies do not change.

- [ ] **Step 9: Split the tests by `describe`**

- `MapExplorer.test.tsx`: `describe("MapExplorer")` and `describe("the arrival gateway anchors the suggested route …")`
- `MapExplorer.provinces.test.tsx`: `"the open country's province file"`, `"the province level's chrome"`
- `MapExplorer.airports.test.tsx`: `"the open country's airports on its map"`, `"the airport layer's toggle"`
- `MapExplorer.climate.test.tsx`: `"fit lookups degrade …"`, `"the legend"`, `"derived climate"`

Run: `npx vitest run components/map` — the same number of tests as Step 1 plus `explorerPlaces.test.ts`'s. `wc -l` on the five test-side files: all under 800.

- [ ] **Step 10: The cheap-import contract**

In `lib/countryFacts.test.ts`, add `"components/map/WorldPane.tsx"`, `"components/map/RoutePanel.tsx"`, `"components/map/useCountryAssets.ts"`, `"components/map/explorerPlaces.ts"` to `MUST_STAY_CHEAP` and change `toHaveLength(9)` to `toHaveLength(13)`.

Run: `npx vitest run lib/countryFacts.test.ts` — green.

- [ ] **Step 11: Everything**

Run: `npm test && npx tsc --noEmit`
Expected: the baseline count plus the tests Tasks 1–7 added plus `explorerPlaces.test.ts`; tsc silent.

- [ ] **Step 12: Report**, with the before/after `wc -l` table and the test counts.

---

### Task 10 (controller): gates, glance, PR, ops

- [ ] Commit each reviewed task on `chore/clear-deferred-items`; ledger in `.superpowers/sdd/backlog-ledger.md`.
- [ ] `npx tsc --noEmit`; `npm test`; `npx playwright test` (expect 20); `npx next build`.
- [ ] Browser glance of Peru's map through `.superpowers/sdd/glance/glance.config.ts` (legend → note → list → timeline; the note's name).
- [ ] `git checkout -- next-env.d.ts` if Playwright rewrote it.
- [ ] Push, open the PR (merge left to the owner), watch CI.
- [ ] On the PR's preview deployment: `POST /api/auth/sign-in/email` with a bogus email from the preview origin → expect 401, not 403.
- [ ] After 09:30 UTC: `gh workflow run "Refresh climate" --ref main`, then watch the run to completion.
- [ ] Update the memory notes: the cities-refresh 429 item and Plan 8's four deferred items were already closed; what this branch closed; what the owner still has to verify.
