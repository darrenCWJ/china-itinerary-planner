# App Shell & Compulsory Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-out visitors land on `/login` (link-views excepted), signup requires the family invite code, every page shares one boarding-pass shell header, and the homepage becomes trips-first with the wizard moving to `/plan`.

**Architecture:** The existing `proxy.ts` middleware swaps its ACCESS_CODE unlock for an optimistic session-cookie wall whose decision logic is a pure, unit-tested function (`lib/wall.ts`); real enforcement stays in the per-route gates from the accounts project. A Better Auth before-hook validates the signup invite against `ACCESS_CODE`. A pathname-aware `AppHeader` in the root layout carries brand/nav/account-chip everywhere; `app/page.tsx` becomes the trips dashboard and the wizard component moves wholesale to `app/plan/page.tsx`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, better-auth 1.6.29 (pinned exact, already installed), Vitest, Tailwind (existing token palette).

**Spec:** `docs/superpowers/specs/2026-08-16-app-shell-login-design.md`

## Global Constraints

- **Zero new npm dependencies.** Everything uses what is installed.
- Better Auth API pins (verified against installed 1.6.29 `.d.mts` on 2026-08-16): `getSessionCookie(req)` from `better-auth/cookies`; `createAuthMiddleware` and `APIError` from `better-auth/api`; the config accepts `hooks: { before: createAuthMiddleware(async (ctx) => {...}) }` with `ctx.path` and `ctx.body`. If any of these differ **at type level**, STOP and report the exact error — do not improvise.
- `BETTER_AUTH_SECRET` unset → the wall is OFF (site open, local no-accounts planning works). `ACCESS_CODE` unset → signups open. Both mirror the existing "open when unconfigured" convention.
- `/api/*` is NEVER walled — routes self-enforce 401/403/503 (accounts project). `/b/*` pages stay byte-for-byte untouched.
- The invite comparison is trimmed and case-insensitive. Auth error responses still never reveal whether an email is registered.
- Every mutation of `components/auth/AuthForm.tsx` preserves its existing hardening: `safeNext` resolve-and-compare-origin redirect, `role="alert"` on errors, Enter-to-submit on every field, autoComplete attributes.
- All tests green (`npm test`, currently 199) and `npx tsc --noEmit` clean at every task boundary.
- Copy rules: sentence case, plain verbs, empty states invite action. Polish gate (Task 6) applies the make-interfaces-feel-better checklist: no `transition: all`, `tabular-nums` on dates/counts, `text-wrap: balance` on headings, hit areas ≥ 40px.

---

### Task 1: The wall decision function

**Files:**
- Create: `lib/wall.ts`
- Test: `lib/wall.test.ts` (new)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `wallDecision(opts: WallInput): "pass" | "redirect"` with `interface WallInput { pathname: string; hasCode: boolean; hasSessionCookie: boolean; accountsConfigured: boolean }` — Task 2's middleware maps requests onto it.

- [ ] **Step 1: Write the failing test**

Create `lib/wall.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { wallDecision } from "./wall";

const base = { hasCode: false, hasSessionCookie: false, accountsConfigured: true };

describe("wallDecision", () => {
  test("signed-out app pages redirect", () => {
    expect(wallDecision({ ...base, pathname: "/" })).toBe("redirect");
    expect(wallDecision({ ...base, pathname: "/plan" })).toBe("redirect");
    expect(wallDecision({ ...base, pathname: "/account" })).toBe("redirect");
    expect(wallDecision({ ...base, pathname: "/trip/abc123" })).toBe("redirect");
  });

  test("auth pages are exempt", () => {
    expect(wallDecision({ ...base, pathname: "/login" })).toBe("pass");
    expect(wallDecision({ ...base, pathname: "/signup" })).toBe("pass");
  });

  test("briefing pages are exempt", () => {
    expect(wallDecision({ ...base, pathname: "/b/somecode" })).toBe("pass");
  });

  test("trip links with a code pass (guest view)", () => {
    expect(wallDecision({ ...base, pathname: "/trip/abc123", hasCode: true })).toBe("pass");
    // A code on a non-trip path does not open other pages.
    expect(wallDecision({ ...base, pathname: "/account", hasCode: true })).toBe("redirect");
  });

  test("api routes are never walled (defense in depth vs matcher)", () => {
    expect(wallDecision({ ...base, pathname: "/api/trips/abc" })).toBe("pass");
  });

  test("a session cookie passes everything", () => {
    expect(wallDecision({ ...base, pathname: "/", hasSessionCookie: true })).toBe("pass");
    expect(wallDecision({ ...base, pathname: "/trip/abc123", hasSessionCookie: true })).toBe("pass");
  });

  test("accounts unconfigured turns the wall off", () => {
    expect(wallDecision({ ...base, pathname: "/", accountsConfigured: false })).toBe("pass");
    expect(wallDecision({ ...base, pathname: "/trip/abc123", accountsConfigured: false })).toBe("pass");
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npm test -- wall`
Expected: FAIL — `lib/wall.ts` does not exist.

- [ ] **Step 3: Implement**

Create `lib/wall.ts`:

```ts
export interface WallInput {
  pathname: string;
  /** True when the request URL carries a ?code= param (guest link). */
  hasCode: boolean;
  hasSessionCookie: boolean;
  /** False when BETTER_AUTH_SECRET is unset — the wall turns off entirely. */
  accountsConfigured: boolean;
}

/**
 * The compulsory-login wall, as a pure decision. Optimistic only: a cookie's
 * presence is enough to pass — real enforcement lives in the per-route
 * session gates. "redirect" means send the visitor to /login.
 */
export function wallDecision(input: WallInput): "pass" | "redirect" {
  if (!input.accountsConfigured) return "pass";
  if (input.hasSessionCookie) return "pass";
  const p = input.pathname;
  if (p === "/login" || p === "/signup") return "pass";
  if (p.startsWith("/b/")) return "pass";
  if (p.startsWith("/api/")) return "pass"; // routes self-enforce
  if (p.startsWith("/trip/") && input.hasCode) return "pass"; // guest link view
  return "redirect";
}
```

- [ ] **Step 4: Run tests** — `npm test -- wall` → PASS (7 tests); full `npm test` all green (record the new total; baseline was 199); `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/wall.ts lib/wall.test.ts
git commit -m "feat: pure wall decision for the compulsory-login redirect"
```

---

### Task 2: Middleware wall + unlock retirement

**Files:**
- Modify: `proxy.ts` (full replacement of the handler body)
- Delete: `app/unlock/` (page), `app/api/unlock/` (route), and `lib/access.ts` IF nothing else imports it (grep first)
- Modify: `README.md` (ACCESS_CODE row — see Step 4)

**Interfaces:**
- Consumes: `wallDecision` (Task 1), `getSessionCookie` from `better-auth/cookies` (pinned).
- Produces: signed-out page requests redirect to `/login?next=…`; `/unlock` no longer exists.

- [ ] **Step 1: Replace `proxy.ts`**

The current file gates on `ACCESS_CODE` with an unlock cookie. Replace wholesale with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { wallDecision } from "@/lib/wall";

/**
 * Compulsory-login wall. Optimistic: checks only that a Better Auth session
 * cookie exists — validity is enforced by the per-route session gates. With
 * no BETTER_AUTH_SECRET configured the site is open (local planning mode).
 */
export async function proxy(req: NextRequest) {
  const decision = wallDecision({
    pathname: req.nextUrl.pathname,
    hasCode: req.nextUrl.searchParams.has("code"),
    hasSessionCookie: getSessionCookie(req) !== null,
    accountsConfigured: Boolean(process.env.BETTER_AUTH_SECRET),
  });
  if (decision === "pass") return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // b/ stays exempt (briefing links are their own bearer secret); api/ routes
  // self-enforce auth; login/signup are the wall's own destination.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|b/|login|signup).*)"],
};
```

Note: `getSessionCookie` returns the cookie string or null — if the installed 1.6.29 signature differs at type level (e.g. needs an options arg), STOP and report.

- [ ] **Step 2: Delete the unlock flow**

```bash
grep -rn "lib/access\|ACCESS_COOKIE\|accessToken" app lib components --include=*.ts --include=*.tsx | grep -v "lib/access.ts"
```

Expected: hits only in `app/unlock/` and `app/api/unlock/`. Then delete `app/unlock/`, `app/api/unlock/`, and `lib/access.ts`. If the grep shows OTHER consumers, delete only the unlock page/route and report the remaining consumers in your report instead of deleting `lib/access.ts`.

- [ ] **Step 3: Verify**

`npm test` green, `npx tsc --noEmit` clean. Manual (dev server, PowerShell `$env:BETTER_AUTH_SECRET = "dev-secret-0123456789"; npm run dev`, port may auto-increment, kill it when done):

- `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:PORT/` → `307 …/login?next=%2F`
- Same for `/account` and `/trip/xyz` → 307 to login. `/trip/xyz?code=ABC` → 200 (page loads; TripView handles access).
- `/login`, `/signup` → 200. `/b/anything` → 200 (not a redirect; the page itself may say the briefing is unknown).
- With a signed-in cookie jar (signup curl first, note Better Auth needs an `Origin: http://localhost:PORT` header) → `/` returns 200.
- Restart WITHOUT the secret → `/` returns 200 (wall off).
- `/unlock` → 404.

- [ ] **Step 4: README row**

In the README env table, change the `ACCESS_CODE` row description to: `Family invite code required to create an account. Unset = open signups. (No longer a site-wide gate — signed-out visitors land on /login instead.)`

- [ ] **Step 5: Commit**

```bash
git add proxy.ts README.md
git rm -r app/unlock app/api/unlock
git rm lib/access.ts
git commit -m "feat: compulsory-login wall replaces the unlock gate"
```

(Adjust the `git rm lib/access.ts` line if Step 2 found other consumers.)

---

### Task 3: Signup invite code

**Files:**
- Modify: `lib/server/auth.ts` (add `hooks` to the betterAuth config)
- Modify: `components/auth/AuthForm.tsx` (invite field in signup mode)

**Interfaces:**
- Consumes: the betterAuth config built in `buildAuth()` (Task 1 of the accounts project); `authClient.signUp.email` call in AuthForm.
- Produces: `POST /api/auth/sign-up/email` rejects with 403 unless `body.inviteCode` matches `ACCESS_CODE` (trimmed, case-insensitive) or `ACCESS_CODE` is unset.

- [ ] **Step 1: Server hook**

In `lib/server/auth.ts`, extend the imports and the betterAuth options (inside `buildAuth()`; keep every existing option untouched):

```ts
import { createAuthMiddleware, APIError } from "better-auth/api";
```

and add to the options object:

```ts
      hooks: {
        before: createAuthMiddleware(async (ctx) => {
          if (ctx.path !== "/sign-up/email") return;
          const required = (process.env.ACCESS_CODE ?? "").trim();
          if (!required) return; // no invite configured — signups open
          const given = String(
            (ctx.body as { inviteCode?: unknown })?.inviteCode ?? ""
          ).trim();
          if (given.toUpperCase() !== required.toUpperCase()) {
            throw new APIError("FORBIDDEN", {
              message: "Wrong invite code — ask the family for it.",
            });
          }
        }),
      },
```

If `hooks.before` or the `createAuthMiddleware` signature is rejected at type level, STOP and report the exact error.

- [ ] **Step 2: Client field**

In `components/auth/AuthForm.tsx`:

1. Add state: `const [inviteCode, setInviteCode] = useState("");`
2. In signup mode only, render below the name field (same label/input classes as the existing fields, keyboard-submit handler like the others):

```tsx
      {mode === "signup" && (
        <label className="mt-3 block text-xs font-medium text-ink-soft">
          Family invite code
          <input type="text" value={inviteCode} maxLength={64} className={inputCls}
            autoComplete="off"
            onChange={(e) => setInviteCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
          <span className="mt-1 block text-[11px] font-normal text-ink-soft">
            Ask the family for the code.
          </span>
        </label>
      )}
```

3. Send it with signup. Preferred: add the property to the existing call — `authClient.signUp.email({ email: email.trim(), password, name: name.trim(), inviteCode: inviteCode.trim() } as Parameters<typeof authClient.signUp.email>[0])` is NOT acceptable if it needs that cast; first try the plain property. If the client types reject an extra key, use the client's raw fetch instead:

```ts
const result = await authClient.$fetch("/sign-up/email", {
  method: "POST",
  body: { email: email.trim(), password, name: name.trim(), inviteCode: inviteCode.trim() },
});
```

(`$fetch` returns the same `{ data, error }` shape; verify against installed types and keep the surrounding error handling identical.) If neither typechecks, STOP and report.

4. Do NOT client-validate the invite (server decides); the server's 403 message surfaces through the existing `result.error.message` path.

- [ ] **Step 3: Verify**

`npm test` green, `tsc` clean. Curl matrix (dev server + `$env:BETTER_AUTH_SECRET`, and `$env:ACCESS_CODE = "FAMILY1"`; every POST needs `-H "Origin: http://localhost:PORT"` and `-H "Content-Type: application/json"`):

- signup body WITHOUT `inviteCode` → 403 with the wrong-invite message.
- `"inviteCode": "wrong"` → 403. `"inviteCode": " family1 "` → 200 (trim + case-insensitive).
- Sign-IN of that user with no invite code → 200 (hook only guards signup).
- Restart with `ACCESS_CODE` removed → signup without code → 200.
- Browser check: `/signup` shows the invite field; `/login` does not.

- [ ] **Step 4: Commit**

```bash
git add lib/server/auth.ts components/auth/AuthForm.tsx
git commit -m "feat: signup requires the family invite code"
```

---

### Task 4: App shell header

**Files:**
- Create: `components/shell/AppHeader.tsx`
- Modify: `app/layout.tsx` (mount it)
- Modify: `components/TripView.tsx` (remove `AccountChip` from its `Shell` header — the global header owns it now)

**Interfaces:**
- Consumes: `AccountChip` (`@/components/auth/AccountChip`), `authClient` indirectly through it.
- Produces: `<AppHeader />` rendered on every page except `/login`, `/signup`, `/b/*`. Tasks 5–6 rely on it so `/plan` and `/` need no page-level header.

- [ ] **Step 1: Create the header**

Create `components/shell/AppHeader.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountChip } from "@/components/auth/AccountChip";

const NAV = [
  { href: "/", label: "Trips" },
  { href: "/plan", label: "Plan a trip" },
] as const;

/**
 * The boarding-pass strip: brand, section nav, account chip. Hidden on auth
 * pages and public briefings, which stay chrome-free.
 */
export function AppHeader() {
  const pathname = usePathname();
  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/b/")
  ) {
    return null;
  }

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="bg-paper print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex min-h-10 items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-seal font-kai text-xl text-white">
            游
          </span>
          <span className="font-display text-lg font-bold leading-tight">
            China Itinerary Planner
          </span>
        </Link>
        <nav aria-label="Sections" className="flex items-center gap-1 sm:gap-2">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`flex min-h-10 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-sky text-rail-deep"
                  : "text-ink-soft hover:bg-mist hover:text-rail"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <div className="ml-1 sm:ml-2">
            <AccountChip />
          </div>
        </nav>
      </div>
      <div aria-hidden className="border-b-2 border-dashed border-sky" />
    </header>
  );
}
```

(The dashed border is the perforated ticket edge — the shell's signature. Transition scope is `transition-colors` only, never `all`.)

- [ ] **Step 2: Mount in the root layout**

In `app/layout.tsx`, import and render it above `{children}`:

```tsx
import { AppHeader } from "@/components/shell/AppHeader";
```

```tsx
      <body className="bg-mist font-sans text-ink antialiased">
        <AppHeader />
        {children}
      </body>
```

- [ ] **Step 3: One chip everywhere**

In `components/TripView.tsx`, find the `Shell` component's header row where `<AccountChip />` was mounted (accounts project Task 11) and remove that usage plus the now-unused import. The trip page keeps its trip-name chrome; the global header supplies nav + chip above it.

- [ ] **Step 4: Verify** — `npm test` green, `tsc` clean. Manual: signed-in dev server — header on `/`, `/plan` (exists after Task 5; before that the route 404s under the header — fine), `/account`, `/trip/<id>`; hidden on `/login`, `/signup`; exactly ONE account chip on the trip page.

- [ ] **Step 5: Commit**

```bash
git add components/shell/AppHeader.tsx app/layout.tsx components/TripView.tsx
git commit -m "feat: boarding-pass app header with nav and account chip"
```

---

### Task 5: Trips-first homepage, wizard to /plan

**Files:**
- Create: `app/plan/page.tsx` (the current wizard, moved)
- Modify: `app/page.tsx` (becomes the trips dashboard page)
- Modify: `components/home/TripsDashboard.tsx` (account-list only)
- Modify: `components/TripView.tsx` (drop `saveMyTrip` call + import)

**Interfaces:**
- Consumes: `AppHeader` exists globally (Task 4); `TripsDashboard`'s server-list mode (`/api/me/trips`), `tripPhase` from `lib/myTrips.ts` (file stays).
- Produces: `/` = trips dashboard + "Plan a new trip" CTA; `/plan` = the wizard, byte-equal logic to today's `app/page.tsx` minus its header block and minus the `TripsDashboard` mount.

- [ ] **Step 1: Move the wizard**

Create `app/plan/page.tsx` as a copy of the CURRENT `app/page.tsx` with exactly these changes:

1. Rename the component `export default function Home()` → `export default function PlanPage()`.
2. Delete the entire `<header>…</header>` block (the global `AppHeader` replaces it).
3. Delete the `{step === 0 && <TripsDashboard />}` line and the `TripsDashboard` import.
4. Everything else — state, steps nav, `DestinationStep`/`DetailsStep`/`PlanStep`, footer — stays identical.

- [ ] **Step 2: Rewrite the homepage**

Replace `app/page.tsx` wholesale:

```tsx
import Link from "next/link";
import { TripsDashboard } from "@/components/home/TripsDashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-rail">
            Your trips
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold [text-wrap:balance]">
            Where are we going?
          </h1>
        </div>
        <Link
          href="/plan"
          className="flex min-h-11 items-center rounded-lg bg-rail px-5 text-sm font-semibold text-white transition-colors hover:bg-rail-deep"
        >
          Plan a new trip →
        </Link>
      </div>
      <TripsDashboard />
    </main>
  );
}
```

- [ ] **Step 3: Simplify TripsDashboard**

In `components/home/TripsDashboard.tsx` (account-list only — the wall guarantees a session when accounts are on):

1. Remove: the localStorage `MyTrip` list state/effect, the `SignInCta` component and its render sites, the wallet background-sync effect and its `walletSync` import, the `onForget` per-device control and its plumbing.
2. Keep: `authClient.useSession()` with the `isPending` quiet gate, the `/api/me/trips` fetch keyed on the session user id with the `cancelled` cleanup, `TripCards` rendering (now always without `onForget`), `tripPhase`/date formatting.
3. States: `isPending` or fetch in flight → `null`; fetch error → `<p role="status">Couldn't load your trips — <button>` retry `</button></p>` styled like existing soft-text lines; success + zero trips → the empty invitation:

```tsx
      <div className="mt-8 rounded-2xl border-2 border-dashed border-sky bg-paper px-6 py-10 text-center">
        <p className="font-display text-xl font-bold">No trips yet</p>
        <p className="mt-1 text-sm text-ink-soft">
          Plan your first one — pick places, tune the details, get a day-by-day plan.
        </p>
        <Link href="/plan"
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-rail px-5 text-sm font-semibold text-white transition-colors hover:bg-rail-deep">
          Plan a trip →
        </Link>
      </div>
```

4. When accounts are DISABLED (session fetch fails because `/api/auth/*` 503s): render the same empty-state card but with copy `Accounts are not set up on this deployment — plan a trip locally.` and the same `/plan` CTA (the wall is off in that mode, so `/` is reachable).
5. The section keeps its heading structure minimal — the page now owns the "Your trips" heading, so drop the component's own `<h2>`/eyebrow if it would duplicate it (read the file; the region wrapper + list stays).

- [ ] **Step 4: Drop saveMyTrip**

In `components/TripView.tsx`, remove the `saveMyTrip(...)` call (member branch) and its import from `@/lib/myTrips`. `lib/myTrips.ts` itself stays (dashboard still imports `tripPhase` etc.).

- [ ] **Step 5: Verify** — `npm test` green, `tsc` clean. Manual (signed-in): `/` shows the trips cards + CTA and no wizard; `/plan` runs the whole wizard flow INCLUDING creating/sharing a trip (PlanStep still works — this proves the move); a fresh account sees the empty invitation; header nav highlights the right section on both pages.

- [ ] **Step 6: Commit**

```bash
git add app/plan/page.tsx app/page.tsx components/home/TripsDashboard.tsx components/TripView.tsx
git commit -m "feat: trips-first homepage with the wizard moved to /plan"
```

---

### Task 6: Polish gate, docs and the full matrix

**Files:**
- Modify: any files the polish findings touch (expected: `components/shell/AppHeader.tsx`, `app/page.tsx`, `components/home/TripsDashboard.tsx`, `components/auth/AuthForm.tsx`)
- Modify: `README.md` (trust-model paragraph)
- Modify: `docs/PLAN.md` (one-line update)

**Interfaces:** none new — quality pass + end-to-end confirmation.

- [ ] **Step 1: Polish pass (make-interfaces-feel-better checklist)**

Over the surfaces this project created/touched (`AppHeader`, homepage, dashboard states, auth forms), check and fix, reporting each as a before/after row:

- Dynamic numbers (trip dates, day counts, member counts on cards) get `tabular-nums` (Tailwind: `tabular-nums` class) so they don't shift as values change.
- Headings introduced here keep `[text-wrap:balance]`; card body copy that wraps gets `[text-wrap:pretty]`.
- Every transition names its properties (`transition-colors` etc.) — grep the touched files for `transition-all`; must be zero.
- Interactive targets in the header/nav/chip ≥ 40px tall (`min-h-10` and up — verify computed).
- Nested card radii: outer card `rounded-2xl` with inner elements `rounded-lg` + padding — spot-check the trip cards and empty state for optical coherence.
- The 游 brand block and any icons are optically centered (adjust with padding if visibly off).

- [ ] **Step 2: Docs**

README "How it works"/trust-model section: update the first line to say members **sign in first** (the app is login-first; join codes are view keys; signup needs the family invite code). Keep the rest of the accounts paragraph intact. `docs/PLAN.md` trust-model section: append `Update 2026-08 (2): login-first shell — signed-out visitors land on /login; ACCESS_CODE now gates signup instead of the whole site (spec: docs/superpowers/specs/2026-08-16-app-shell-login-design.md).`

- [ ] **Step 3: Full manual matrix** (dev server with `BETTER_AUTH_SECRET` + `ACCESS_CODE`; fix anything that fails before proceeding):

1. Signed-out: `/`, `/plan`, `/account`, bare `/trip/<id>` all land on `/login` with a working `next` round-trip after signing in.
2. `/login` ↔ `/signup` cross-links preserve `?next=`; signup with wrong invite → clear 403 message; right invite → account created and landed on `next`.
3. Guest link `/trip/<id>?code=` in a private window: guest view renders, no header account leak (chip shows Sign in), joining works after signup.
4. `/b/<code>` private window: renders, no app header.
5. Signed-in: header on every app page, active nav state correct, ONE chip; homepage lists trips, empty account sees invitation; `/plan` full wizard → create trip → lands in the trip page.
6. Wall-off mode (no `BETTER_AUTH_SECRET`): `/` reachable, dashboard shows the local-planning copy, `/plan` works.
7. `npm test` green (record count), `npx tsc --noEmit` clean, `npm run build` green.

- [ ] **Step 4: Commit**

```bash
git add -A README.md docs/PLAN.md components app
git commit -m "polish: shell surfaces pass the interface checklist; login-first docs"
```

(Stage exactly what changed — list the files in your report.)

---

## Execution notes

- Strict order 1 → 2 → 3 → 4 → 5 → 6. Task 2's manual smoke needs Task 1; Tasks 4–5 are UI layers over the wall; the matrix in Task 6 exercises everything.
- Task 2 changes what `/` does for signed-out visitors — from that commit until Task 5 lands, the signed-out homepage redirects to login while the signed-in homepage still shows the wizard. That mid-branch state is expected.
- The dev server on this machine may auto-increment ports (Docker can own 3000) — read the port from output; Better Auth curl calls to state-changing endpoints need an `Origin` header; revert `next dev` artifacts (`next-env.d.ts`, generated `AGENTS.md`/`CLAUDE.md`) before every commit; never commit the stray root HTMLs or `.superpowers/`.
- The route-test harness gap is known and deliberate (accounts project). The wall's automated coverage is `lib/wall.test.ts`; everything else is the Task 6 matrix.
