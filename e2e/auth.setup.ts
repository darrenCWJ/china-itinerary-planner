import { test as setup, expect } from "@playwright/test";

/**
 * Signs up once and saves the session for every authenticated spec.
 *
 * Through the real form rather than by seeding the database or forging a
 * cookie, because the signup path is itself something no test has ever
 * exercised end to end: `lib/server/auth.ts` runs a `before` hook on
 * `/sign-up/email`, `lib/wall.ts` decides the redirect, and the cookie Better
 * Auth sets is the thing the wall reads back. Seeding would skip all three and
 * still produce a green suite.
 *
 * The database is a throwaway file (see `playwright.config.ts`), so a fixed
 * address is safe and makes a failed run inspectable. `ACCESS_CODE` is unset
 * for the run, which is what leaves the invite field optional.
 */
const EMAIL = "e2e@example.test";
const PASSWORD = "e2e-fixture-password-9042";

setup("sign up and save the session", async ({ page }) => {
  await page.goto("/signup");

  await page.getByLabel("Your name (shown to trip members)").fill("E2E Runner");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // Idempotent, because the throwaway database OUTLIVES a single run: it sits
  // under the OS temp directory and `reuseExistingServer` keeps the same dev
  // server between local runs, so the second `npx playwright test` of the day
  // meets "User already exists. Use another email." and a signup-only setup
  // fails for a reason that has nothing to do with the app.
  //
  // A random address per run would also work and is worse: it fills the
  // database with junk users and makes a failed run harder to inspect. Signing
  // in on the second pass exercises a real path either way.
  //
  // So the click has two good outcomes, and this waits for whichever happens:
  // the form leaves /signup (a fresh database, the account was just created),
  // or it says the address is taken (an earlier run's account). Both are
  // final, so which one it was can be read after the wait. It used to be
  // `waitForURL(/\/signup/)`, which cannot tell them apart: `AuthForm` awaits
  // the signup request BEFORE it navigates, the page is still on /signup while
  // that runs, and `waitForURL` returns at once for a URL the page is already
  // on. Every successful signup took the "already exists" branch and timed
  // out in it, which CI's retries reported as "1 flaky" on every run.
  //
  // By text, not by `getByRole("alert")`: Next.js renders its own route
  // announcer as `<div role="alert" id="__next-route-announcer__">` on every
  // page, so the role alone is ambiguous in any Next app and resolves to two
  // elements under strict mode.
  const alreadyExists = page.getByText(/already exists/i);
  const onSignup = () => new URL(page.url()).pathname === "/signup";
  await expect
    .poll(async () => !onSignup() || (await alreadyExists.isVisible()), {
      message: "signup neither left /signup nor said the account already exists",
      timeout: 30_000,
    })
    .toBe(true);
  if (onSignup()) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  // The wall passes once the session cookie exists, so landing anywhere that
  // is not an auth page is the signal. Asserted on the URL rather than on a
  // spinner, which is the kind of thing a redesign moves.
  await expect(page).not.toHaveURL(/\/(signup|login)/, { timeout: 30_000 });

  // The half that matters, and it is the cookie rather than the absence of an
  // error banner: this file's whole job is to hand the other specs a session,
  // and a run that saved an anonymous state would fail them all somewhere far
  // from the cause.
  //
  // Not `getByRole("alert")`, which was the first attempt and was wrong — the
  // page signup lands on carries a live region of its own ("Where are we
  // going?"), so the check failed against a working signup.
  const state = await page.context().storageState();
  const session = state.cookies.find((c) => c.name.endsWith("session_token"));
  expect(session, "signup set no session cookie").toBeTruthy();

  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
