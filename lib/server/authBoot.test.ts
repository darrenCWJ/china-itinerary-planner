import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { register } from "../../instrumentation";
import { getAuth } from "./auth";

// Guards the wiring, not the rule: lib/authSecret.test.ts covers which values
// count as unusable, this covers that getAuth() actually acts on the verdict.
// The failure it prevents is a deploy with no secret booting fine and serving
// every page publicly (see lib/wall.ts — no secret turns the wall off).
const ORIGINAL = { ...process.env };

/**
 * Both entry points read the environment when they are **called**, not when
 * their module is loaded: `getAuth()` -> `buildAuth()` -> `assertSecret()`
 * reads `BETTER_AUTH_SECRET` and `VERCEL` at call time, and `register()` reads
 * the same pair inline. One import therefore answers every case below.
 *
 * This file used to call `vi.resetModules()` in `beforeEach` and re-`import()`
 * the auth chain inside each test, on the stated grounds that "the boot rules
 * under test are read at module load from the environment". That was not true
 * of the code, and it cost real money. `resetModules` could not clear the one
 * piece of state that genuinely does persist — `globalThis.__cipAuth`, which
 * is why the hooks below still delete it by hand — and it moved the whole
 * better-auth + better-sqlite3 + db-layer graph *inside the first test's
 * body*, where vitest's wall-clock `testTimeout` bills it to that test.
 * Measured: 1146ms with this file running alone, 5002ms in a full parallel run
 * — the slowest test in the suite by more than 3x, and the only one needing a
 * `testTimeout` override to survive. Under the 3x-concurrent-suite repro it
 * blew even that 30s override in 5 of 6 runs. A static import is evaluated
 * during collection, which carries no per-test budget, so the same work now
 * costs the tests nothing: the first test drops to ~1ms and the default 5000ms
 * is ample.
 *
 * Sharing one instance across all six tests also makes them stricter than the
 * re-importing version was: they now only pass if the verdict is recomputed on
 * every call rather than frozen at import time, which is exactly the property
 * production depends on.
 */

beforeEach(() => {
  delete globalThis.__cipAuth;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  delete globalThis.__cipAuth;
});

test("deployment without a secret refuses to boot", () => {
  process.env.VERCEL = "1";
  delete process.env.BETTER_AUTH_SECRET;
  expect(() => getAuth()).toThrow(/every page is public/);
});

test("deployment with a placeholder secret refuses to boot", () => {
  process.env.VERCEL = "1";
  process.env.BETTER_AUTH_SECRET = "dev-secret-0123456789";
  expect(() => getAuth()).toThrow(/example value/);
});

test("local without a secret still boots (no-accounts mode)", () => {
  delete process.env.VERCEL;
  delete process.env.BETTER_AUTH_SECRET;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() => getAuth()).not.toThrow();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("every page is public"));
  warn.mockRestore();
});

// The startup hook is the one that catches an absent secret: the auth route
// 503s on accountsEnabled() before getAuth() runs, so the checks above never
// see that case on a real request path.
test("startup hook refuses to start a deployment with no secret", () => {
  process.env.VERCEL = "1";
  delete process.env.BETTER_AUTH_SECRET;
  expect(() => register()).toThrow(/every page is public/);
});

test("startup hook only warns locally", () => {
  delete process.env.VERCEL;
  delete process.env.BETTER_AUTH_SECRET;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(() => register()).not.toThrow();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

test("startup hook passes a real secret through", () => {
  process.env.VERCEL = "1";
  process.env.BETTER_AUTH_SECRET = "k3Nv8xQ2mR7pL0wZaB6tY4hJ1cF9sD5gE2uI8oP3nA0";
  expect(() => register()).not.toThrow();
});
