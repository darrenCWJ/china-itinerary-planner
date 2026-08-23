import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * proxy.ts itself lives at the repo root, not under lib/ — this file sits
 * here anyway because it's the only `.test.ts` location vitest.config.mts's
 * node project already picks up, and proxy.ts is plain Node-runnable logic
 * (NextRequest/NextResponse work outside an actual Next server).
 *
 * wallDecision's branching is already exhaustively covered by
 * lib/wall.test.ts. This file covers what that pure function can't: the
 * headers proxy.ts itself attaches to the NextResponse it builds around that
 * decision — specifically the no-store on the /login redirect, regression
 * coverage for the bug where next.config.ts's 24h public cache on the
 * topology assets rode along on this same redirect for signed-out visitors.
 */

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("proxy redirect response headers", () => {
  beforeEach(() => {
    resetEnv();
    process.env.BETTER_AUTH_SECRET = "a".repeat(32);
    delete process.env.VERCEL;
    delete process.env.ACCESS_CODE;
  });

  afterEach(resetEnv);

  test("a signed-out redirect carries Cache-Control: no-store", async () => {
    // Regression coverage: without no-store, this redirect (307, same
    // target and query as always) was cacheable by any downstream cache —
    // browser or shared proxy — for the topology assets' 24h window, so a
    // signed-out hit could park a redirect-to-/login that outlives the
    // sign-in that was supposed to fix it.
    const req = new NextRequest("https://example.com/world-globe.json");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.com/login?next=%2Fworld-globe.json"
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  test("the redirect target, status, and next= param are unchanged by the header fix", async () => {
    const req = new NextRequest("https://example.com/trip/abc123?foo=bar");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.com/login?next=%2Ftrip%2Fabc123%3Ffoo%3Dbar"
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
