import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Guards the wiring, not the rule: lib/authSecret.test.ts covers which values
// count as unusable, this covers that getAuth() actually acts on the verdict.
// The failure it prevents is a deploy with no secret booting fine and serving
// every page publicly (see lib/wall.ts — no secret turns the wall off).
const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  delete globalThis.__cipAuth;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  delete globalThis.__cipAuth;
});

test("deployment without a secret refuses to boot", async () => {
  process.env.VERCEL = "1";
  delete process.env.BETTER_AUTH_SECRET;
  const { getAuth } = await import("./auth");
  expect(() => getAuth()).toThrow(/every page is public/);
});

test("deployment with a placeholder secret refuses to boot", async () => {
  process.env.VERCEL = "1";
  process.env.BETTER_AUTH_SECRET = "dev-secret-0123456789";
  const { getAuth } = await import("./auth");
  expect(() => getAuth()).toThrow(/example value/);
});

test("local without a secret still boots (no-accounts mode)", async () => {
  delete process.env.VERCEL;
  delete process.env.BETTER_AUTH_SECRET;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { getAuth } = await import("./auth");
  expect(() => getAuth()).not.toThrow();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("every page is public"));
  warn.mockRestore();
});

// The startup hook is the one that catches an absent secret: the auth route
// 503s on accountsEnabled() before getAuth() runs, so the checks above never
// see that case on a real request path.
test("startup hook refuses to start a deployment with no secret", async () => {
  process.env.VERCEL = "1";
  delete process.env.BETTER_AUTH_SECRET;
  const { register } = await import("../../instrumentation");
  expect(() => register()).toThrow(/every page is public/);
});

test("startup hook only warns locally", async () => {
  delete process.env.VERCEL;
  delete process.env.BETTER_AUTH_SECRET;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { register } = await import("../../instrumentation");
  expect(() => register()).not.toThrow();
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

test("startup hook passes a real secret through", async () => {
  process.env.VERCEL = "1";
  process.env.BETTER_AUTH_SECRET = "k3Nv8xQ2mR7pL0wZaB6tY4hJ1cF9sD5gE2uI8oP3nA0";
  const { register } = await import("../../instrumentation");
  expect(() => register()).not.toThrow();
});
