# Backlog clearance — design

**Date:** 2026-09-06
**Status:** approved by the owner's instruction ("fix all this first before looking at the roadmap"); the decisions below are the ones a reviewer may overrule.
**Scope:** every item that was still open after Phase 4 merged and was not a roadmap feature: three ops items, six deferred code items, and one stale handover document. Nothing here adds a feature.

## 0. What was found to be already done

Verified against `main` at 3ddf4dc before anything was written, because the backlog was carried in memory notes rather than in the tree:

- **Refresh cities' rate-limit risk** ("enrich and country-facts run back to back in one job") was fixed on 2026-08-28: `refresh-cities.yml` is three jobs on three runners, and `ingest-country-facts.mjs` honours `Retry-After` up to 300 s. Nothing to do.
- **Three of Plan 8's four deferred items** were fixed inside Plan 8's own fix wave: the rebuild refuses unknown airport codes (`lib/server/gatewayGuard.ts`, pinned by `updateTripRoute.test.ts`), the gateways editor returns focus to the button that opened it, and the disabled Save carries `aria-describedby`. `PUT /gateways` already writes under the version guard. What remains of the fourth item is below (§2).
- **All nine findings in `docs/superpowers/handoffs/2026-08-18-agent-review-findings.md`** are closed in the tree, although the document still says "Everything below is still open" (§8).

## 1. Trusted origins (ops)

**Problem.** `BETTER_AUTH_URL` is one value shared by Preview and Production and names the production alias; `TRUSTED_ORIGINS` is unset; Better Auth trusts only the base URL's origin. So no preview deployment and neither secondary production alias can sign in — every attempt is a 403 "Invalid origin". The preview environment does carry its own `BETTER_AUTH_SECRET` (verified with `vercel env ls preview`), so origin is the only thing in the way.

**Decision.** Derive the deployment's own origins in code from the system variables Vercel sets on every deployment — `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` — and keep `TRUSTED_ORIGINS` as the manual list it already is (Better Auth's own wildcard syntax passes straight through). A pure `trustedOriginsFrom(env)` in `lib/server/trustedOrigins.ts`, unit-tested, feeds `betterAuth({ trustedOrigins })`.

**Rejected.** A team-wide wildcard (`https://*-darren-chuas-projects.vercel.app`) in code or in the Vercel dashboard: it would trust every project the team ever deploys. The derived list trusts exactly this deployment's aliases. The bare `<project>-<team>.vercel.app` alias is in no system variable and stays untrusted unless someone lists it; the canonical URL is the one to use.

**Verification.** On the PR's preview deployment, `POST /api/auth/sign-in/email` from the preview origin with a bogus email must answer 401 (credentials rejected) rather than 403 (origin rejected). No real credential is entered anywhere.

## 2. Version-guarded whole-object writes (code)

**Problem.** Two routes still read-modify-write a whole object without the version guard the plan and gateways routes use, so a member's concurrent edit can be silently reverted: `PUT /api/trips/[id]/currency` (reads `currencySettings`, merges, writes with `setCurrencySettings`) and `PATCH /api/trips/[id]` (the rebuild: reads the trip, rebuilds, writes with `updateTripData`).

**Decision.** Both adopt the gateways route's loop verbatim: read, apply, write-if-version-unchanged, retry up to three times, then 409 with the same sentence. The rebuild uses the existing `updateTripDataIf`. Currency gains `setCurrencySettingsIf(tripId, settings, expectedVersion)` in both stores and the facade:

- SQLite: one `db.transaction` — read the version, refuse on mismatch or missing trip, upsert `trip_settings`, `touch`.
- Postgres: one statement — a CTE that bumps `trips.version` where it still equals the expected value and feeds the upsert from its `RETURNING`, so the guard and the write cannot be split across autocommit statements (the property `pgStore.test.ts` already pins for `updateTripDataIf`).

`setCurrencySettings` (unguarded) stays for the create route, which writes a trip nobody else can hold yet.

## 3. A real server-only guard (code)

**Problem.** `lib/server/airports.ts`, `cityIndex.ts` and `catalog.ts` bundle 0.8 MB, 3.6 MB and 0.6 MB artifacts and are server-only "by convention". A client import would ship the artifact silently.

**Decision.** `import "server-only"` at the top of all three; the `server-only` package added as a dependency; Vitest aliases the package to an empty local module in both projects, because Vitest is not a bundler and the guard's job is done by `next build`. The final gate runs a production build, which is where a client import would now fail loudly.

## 4. The bundled-JSON cold-start cost (code, measured and closed)

**Problem as recorded.** "The server parses `cities-index.json` (3.65 MB), `airports.json`, `catalog.json` and `country-facts.json` on every cold instance — not yet acted on."

**Measurement (2026-09-06, five runs each, median).** cities-index 22.6 ms, airports 2.5 ms, catalog 1.1 ms, country-facts 0.4 ms: about 27 ms per cold instance.

**Decision.** Keep the static imports. Moving to runtime file reads would trade 27 ms for a real production risk (a file the function bundle does not carry answers 500), and dynamic `import()` would make three synchronous APIs asynchronous for the same 27 ms. The number is written into `cityIndex.ts`'s docblock so the next reader does not re-open the question without a new measurement.

## 5. Fit colours recomputed on every hover (code)

**Problem.** `CountryLevel` re-renders on every hover (the hover card is state above it), and each render calls `fitForPlace` once per drawn marker inside the JSX. Unmeasured, but it is work per mouse move that depends on nothing the mouse changes.

**Decision.** One `useMemo` over `places` keyed on `[places, month, climate]` produces each marker's fill; the JSX indexes it. Pinned by a test that wraps `fitForPlace` in a spy: hovering markers does not add calls, changing the month does.

## 6. The note's fixed accessible name (code)

**Problem.** `GapNote` announces itself as "About these notes" everywhere, including under the map where there are no notes — the paragraph there is about the climate colours.

**Decision.** `GapNote` takes an optional `label`, default unchanged; `MapExplorer` passes "About the climate colours". The three unit assertions and the e2e spec that named the old label under the map follow it.

## 7. `MapExplorer.tsx` over the file-size guidance (code)

**Problem.** 1,114 lines in the component and 2,215 in its test, against the 800-line guidance; recorded as pre-existing pressure by two plans.

**Decision.** A behaviour-preserving split, verified by the existing tests passing without their bodies changing:

| New file | Takes |
|---|---|
| `components/map/explorerPlaces.ts` | `dropCatalogTwins`, the shard-and-catalog merge that runs when a country's files land, and the `places` derivation — all pure functions, all directly testable |
| `components/map/useCountryAssets.ts` | the six-leg country load effect and the airports effect, with their state, returned as one object plus `retry()`; the hover reset that lived in the effect becomes a one-line effect in `MapExplorer` keyed on the country |
| `components/map/WorldPane.tsx` | the world-level branch, owning the dynamic `WorldMap`/`GlobeLevel` imports, the reduced-motion resolution and the globe toggle |
| `components/map/RoutePanel.tsx` | the suggested-route block |
| `components/map/stepUpButton.ts` | the `STEP_UP_BUTTON` class, shared by `MapExplorer` and `WorldPane` |
| `test/mapExplorerHarness.tsx` | the test file's fixtures, fetch mock, `Harness` and `renderExplorer` — under a root-level `test/`, outside the roots `lib/contracts.test.ts` scans, because inside `components/` a module that value-imports `MapExplorer` reads as a second, uncredited mount of it (found in review; the first cut named it out of the contract instead) |

The test file splits along its existing `describe` blocks into `MapExplorer.test.tsx`, `MapExplorer.provinces.test.tsx`, `MapExplorer.airports.test.tsx` and `MapExplorer.climate.test.tsx`. `explorerPlaces.test.tsx` is a `.tsx` in the jsdom project, not the `.test.ts` first planned: Vitest collects only `lib/**/*.test.ts` and `components/**/*.test.tsx`, so a `.test.ts` under `components/` would never run. Every file lands under 800 lines. The four new source files join `lib/countryFacts.test.ts`'s `MUST_STAY_CHEAP` list, since they are map surfaces and the contract is about map surfaces; and because `MapCity` left the only `.tsx` the CC BY 4.0 contract could see while `RoutePanel.tsx` prints place names, `RouteSuggestion` joins that contract's tokens and `RoutePanel` its allowlist, exactly mounted by `MapExplorer`.

**Not in scope.** The prefetch of China's assets at the world level (left alone on purpose in PR #29), and any change to what the map draws.

## 8. The stale handover document (docs)

`docs/superpowers/handoffs/2026-08-18-agent-review-findings.md` gains a dated status section at the top listing where each of its nine findings was closed, and the sentence "Everything below is still open" is corrected to point at that section. The findings themselves are left as written — they are the record.

## 9. Ops actions outside the tree

- **`Refresh climate`** has never been dispatched. It is dispatched once, on `main`, outside the 08:00–09:00 UTC window the workflow header asks for, and watched to completion. A data commit from it is expected (the catalog has moved since the shards were built) and deploys itself.
- **Stale remote-tracking refs** for two deleted branches: `git fetch --prune` (done).
- **What only the owner can verify:** anything behind the login on the live deployment. Nothing in this work changes that.

## 10. Verification

`npx tsc --noEmit`; `npm test` (baseline 133 files, 2,640 passed, 1 expected fail); `npx playwright test` (baseline 20); `npx next build` (for §3); a browser glance of Peru's map through the e2e harness's saved session (for §5–7); the preview probe in §1.
