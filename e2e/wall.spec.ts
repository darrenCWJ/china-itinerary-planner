import { test, expect } from "@playwright/test";

/**
 * The login wall, signed out.
 *
 * `lib/wall.ts` has thorough unit coverage of the DECISION — given a pathname
 * and a cookie, pass or redirect. What no unit test can reach is whether the
 * decision is actually wired into a request: `proxy.ts` is a Next.js
 * convention file (renamed from `middleware.ts` in Next 16), and a rename, a
 * bad `matcher`, or an export under the wrong name breaks the wall without
 * breaking a single assertion in the suite.
 *
 * This project takes no `storageState`, so it really is signed out.
 */

test("an anonymous visitor is sent to the login page, with a way back", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the wall is not cached, so signing in does not serve a stale redirect", async ({ page }) => {
  // `proxy.ts` sets `Cache-Control: no-store` on the redirect deliberately. A
  // cached 307 would send an authenticated user back to /login from the disk
  // cache, which is exactly the kind of bug that only appears after deploy.
  const response = await page.request.get("/", { maxRedirects: 0 });

  expect(response.status()).toBe(307);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("the login page itself is reachable and is not a redirect loop", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});
