import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * The repo's first end-to-end tests, and the reason they exist.
 *
 * Every test in this project before now ran in jsdom, which parses HTML and
 * computes NO layout: `getBoundingClientRect` is all zeroes there, and CSS
 * variables like `--tap-min` are strings nothing resolves. So the phase's
 * accessibility criterion — WCAG 2.2 AA 2.5.8, a 44x44 CSS px target — was
 * asserted as viewBox arithmetic against a number the test itself computed.
 * That arithmetic was right, and it was never once checked against a browser.
 *
 * These specs measure the rendered box instead. They are deliberately few:
 * the value is in the things jsdom structurally cannot answer — real layout,
 * real CSS, a real navigation through the login wall — and not in restating
 * what 2,368 unit tests already hold.
 *
 * Port 3100 rather than 3000, and pinned rather than `autoPort`: `baseURL` has
 * to be known before the server starts, and 3000 is the port a developer is
 * most likely to already be using.
 */

/**
 * A throwaway SQLite file, so a run never touches `data/app.db`.
 *
 * `lib/server/db.ts` reads `CIP_DB_PATH` and creates its schema on open, so
 * pointing it at an empty directory is the whole of the setup — trips and
 * Better Auth's own `user`/`session`/`account` tables all follow it.
 */
const dbDir = join(tmpdir(), "cip-e2e");
mkdirSync(dbDir, { recursive: true });

/**
 * Long enough for `lib/authSecret.ts` (24 char minimum) and not one of the
 * placeholders it rejects — the blocklist there includes the literal
 * "test-secret", which is exactly what one reaches for first.
 *
 * It signs sessions in a throwaway database on a developer's own machine, so
 * it is a fixture rather than a credential. CI passes the same value as a
 * plain `env:` entry for the same reason.
 */
const E2E_SECRET = "e2e-fixture-k3Nv8xQ2mR7pL0wZaB6tY4hJ";

export default defineConfig({
  testDir: "./e2e",
  // `.claude/worktrees/` holds a second full checkout of this repo. Without
  // this, a spec glob would collect every spec twice once one lands there.
  testIgnore: ["**/.claude/**", "**/node_modules/**"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker, everywhere. The shared resource is a single `next dev`, which
  // compiles a route on first request: running specs in parallel does not make
  // them faster, it makes several of them wait on the same compile at once and
  // then time out together. Measured — eleven parallel specs all hit the 60s
  // ceiling on a server that answers one of them in about two seconds.
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  // `next dev` compiles a route on first request, so the first navigation in a
  // cold run is seconds rather than milliseconds.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    // Signs up once and saves the session; every authenticated spec reuses it
    // rather than driving the form again.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // Signed IN. Scoped with `testMatch` rather than left to collect every
      // spec: without it this project also picks up `wall.spec.ts`, which
      // exists to test the signed-out redirect and cannot pass while holding a
      // session — it fails as a timeout, which reads like a broken app.
      name: "chromium",
      testMatch: /map\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
    {
      // The wall's own spec runs signed OUT, so it takes no storage state and
      // no dependency on the setup above.
      name: "signed-out",
      testMatch: /wall\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // §5.3's tap targets are a claim about phones, so the spec that measures
      // them runs at a phone width. 390px is the iPhone 12/13/14 CSS width and
      // the figure the unit tests quote.
      name: "mobile",
      testMatch: /tap-targets\.spec\.ts/,
      use: { ...devices["Pixel 5"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],

  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      BETTER_AUTH_SECRET: E2E_SECRET,
      BETTER_AUTH_URL: "http://localhost:3100",
      CIP_DB_PATH: join(dbDir, "e2e.db"),
      // Unset deliberately. `lib/authSecret.ts` only treats a bad secret as
      // fatal when VERCEL is truthy, and `lib/wall.ts` turns the wall OFF
      // entirely when the secret is absent — so leaving either to chance would
      // silently test a different app than the one that deploys.
      NODE_ENV: "development",
    },
  },
});
