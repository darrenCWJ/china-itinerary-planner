# App Shell & Compulsory Login — Design

**Goal:** Make signing in the front door of the app, give every page one consistent shell, and land signed-in users on their trips — while the two link-view surfaces (join-code guest view, `/b/*` briefings) keep working without an account.

**Confirmed decisions (2026-08-16):**

1. **Login is compulsory for the app.** Signed-out visitors are redirected to `/login`. Link-views survive account-less: `/b/<code>` briefing pages and `/trip/<id>?code=<joinCode>` guest views.
2. **`ACCESS_CODE` is repurposed** from site gate to **signup invite code**. The `/unlock` wall is retired.
3. **Homepage shows the account's trips only.** The per-device localStorage trips list leaves the UI. Wizard drafts stay local until a trip is created.
4. **Scope split:** this spec covers the shell, wall, invite, and homepage. The trip-page interior redesign (7-tab overload) is a follow-up spec that applies the visual direction set here.

**Skills adopted:** `frontend-design` drives the visual direction (token commitments + signature, anti-generic critique pass); `make-interfaces-feel-better` is a named polish gate; `frontend-patterns` is the implementation reference for components/hooks/a11y.

---

## 1. Access model

| Visitor | Sees |
|---|---|
| Signed out, any app page | Redirect to `/login?next=<original path+query>` |
| Signed out, `/login` `/signup` | The auth pages (signup requires invite code) |
| Signed out, `/b/<code>` | Briefing page, unchanged |
| Signed out, `/trip/<id>?code=…` | Guest view, unchanged (sign-in CTAs intact) |
| Signed out, `/trip/<id>` bare | Redirect to `/login?next=/trip/<id>` (was: private screen) |
| Signed in | The app exactly as today, inside the new shell |
| `BETTER_AUTH_SECRET` unset | Wall off — site open, same "open when unconfigured" convention the ACCESS_CODE gate used. Local no-accounts planning keeps working. |

The signed-in **private screen** (`PrivateGate`) still exists inside TripView for signed-in non-members opening a bare trip link (code entry + join flow unchanged).

## 2. Middleware (the wall)

`proxy.ts` replaces its ACCESS_CODE logic with an **optimistic session check**:

- Uses Better Auth's middleware cookie helper (`getSessionCookie(req)` from `better-auth/cookies`, pinned against installed 1.6.29 — if the export differs at type level, STOP and report; fall back guidance: presence check on the session-token cookie name Better Auth sets). Cookie presence ≠ validity — real enforcement remains the per-route `requireMember`/session gates from the accounts project. This is the canonical Better Auth + Next.js pattern.
- The redirect decision is extracted as a **pure function** in `lib/wall.ts`:
  `wallDecision(pathname: string, hasCode: boolean, hasSessionCookie: boolean, accountsConfigured: boolean): "pass" | "redirect"`
  — unit-testable without HTTP. `proxy.ts` maps the request onto it.
- **Exempt:** `/login`, `/signup`, `/b/*`, `/trip/*` when `?code=` is present, `/api/*` (routes self-enforce 401/403/503), `_next/*` static assets, `favicon.ico`.
- **Deleted:** `app/unlock/` page, `/api/unlock` route, the unlock-cookie check. `ACCESS_CODE` is no longer read by middleware.
- Redirect target always carries `?next=` (the existing `safeNext` resolve-and-compare-origin guard on the login side already validates it).

## 3. Signup invite code

- `AuthForm` signup mode gains a **"Family invite code"** field, always shown (hint: "Ask the family for the code"), sent as `inviteCode` alongside the `signUp.email` call. The client never validates it — the server decides (unset `ACCESS_CODE` = anything passes, including empty).
- Server-side: a Better Auth **before-hook** in `lib/server/auth.ts` (`hooks.before`, matched on the sign-up path) compares `body.inviteCode` (trimmed, case-insensitive) against `process.env.ACCESS_CODE` and rejects with a clear 403 message ("Ask the family for the invite code") on mismatch. `ACCESS_CODE` unset → signups open (dev-friendly, mirrors the wall's open mode).
- The hook API is pinned against installed better-auth 1.6.29 types — type-level mismatch = STOP and report, never improvise.
- Login flow is unchanged; error messages still never reveal whether an email is registered.

## 4. App shell

- New `components/shell/AppHeader.tsx` (client): brand wordmark → `/`, nav links **Trips** (`/`) and **Plan a trip** (`/plan`), and the existing `AccountChip` on the right. Rendered from the root layout; returns `null` on `/login`, `/signup`, and `/b/*` (pathname check) so auth pages stay quiet and briefings stay standalone.
- `TripView`'s ad-hoc `Shell` header slims down to trip-specific chrome (trip name, tabs); the account chip moves up into `AppHeader` — one chip, everywhere.
- Active nav state reflects the current route; hit areas ≥ 40px; keyboard focus visible.

## 5. Homepage restructure

- `app/page.tsx` becomes **trips-first**: the account's trips as cards (name, dates, phase chip, destinations) with a prominent **"Plan a new trip"** CTA. The planning wizard moves wholesale to **`app/plan/page.tsx`** — the wizard component tree (map picker, details, plan step) moves unmodified; only its mount point changes. Deep links to `/` that expected the wizard don't exist outside the app, so no redirects needed.
- `TripsDashboard` simplifies: localStorage list, `SignInCta`, and the background wallet-sync call are removed (the wall guarantees a session; `isPending` still renders the quiet gate during hydration). States: pending → skeleton/null; error → friendly retry line; empty → invitation ("No trips yet — plan your first one" + CTA); list → cards.
- `TripView` stops calling `saveMyTrip` (the device list is dead). `lib/myTrips.ts`, `lib/walletSync.ts`, and `/api/wallet*` remain on disk/server untouched — UI call sites only.

## 6. Visual direction

The app's existing **train-ticket identity** (paper/mist/ink/sky/rail/seal palette, `font-display` headings, mono uppercase eyebrows) is the committed direction — this project sharpens it instead of inventing a new one:

- **Tokens:** existing Tailwind palette is the single source; no new colors. Type roles: display for page titles, mono-uppercase eyebrows for section labels ("YOUR TRIPS", "NEW JOURNEY"), body for everything else.
- **Signature element:** the shell header reads as a **boarding-pass strip** — thin perforated-edge divider beneath it, route-code style eyebrow (the mono tracking-widest treatment already in the app) for the active section. One signature; everything else stays quiet.
- **Polish gate** (`make-interfaces-feel-better` checklist, applied to every new/touched surface): concentric radii on nested cards, `tabular-nums` on dates/counts/prices, `text-wrap: balance` on headings, scoped transitions (no `transition: all`), enter/exit motion split, 40px+ hit areas, optically centered icons.
- Copy rules (`frontend-design`): plain verbs, sentence case, empty states invite action, one job per element.

## 7. What does not change

Every API gate, the guest redaction whitelist, the join/claim flow, admin password reset, `/b/*` pages, `/api/wallet*`, the wizard's internals, and the trip page's tab content (that's the follow-up spec). Legacy `cip-member-*` claim preselect logic stays.

## 8. Testing

- **Unit:** `wallDecision` matrix — every row of the access-model table above, plus accounts-unconfigured open mode and the `?code=` exemption. Suite stays green (currently 199) and `tsc` clean at every task boundary.
- **Manual matrix (final task):** wall redirects with `next` round-trip; all four exemptions; signup with wrong/right/absent invite code (and with `ACCESS_CODE` unset); header nav + chip on every page class; homepage pending/empty/error/list states; guest and briefing links from a private window; existing trip flows unaffected (tick, expense, journal smoke).
- **Polish review:** the make-interfaces-feel-better checklist runs as a named review step over the new shell/homepage surfaces with before/after notes.

## 9. Environment & docs

- `ACCESS_CODE` meaning change documented in README (site gate → signup invite); `/unlock` removed from any docs; deployment note: existing unlock cookies become irrelevant, nothing to migrate.
- No new env vars. `BETTER_AUTH_SECRET` continues to control whether accounts (and now the wall) are active.

## 10. Out of scope (queued)

- Trip-page interior redesign (tab hierarchy, density) — next spec, applying this visual direction.
- Making trips always server-backed / retiring localStorage wizard drafts.
- Wallet endpoint removal and `lib/myTrips.ts`/`walletSync.ts` deletion.
- The Vercel deploy fix (PR #4) and Postgres live verification — tracked separately.
