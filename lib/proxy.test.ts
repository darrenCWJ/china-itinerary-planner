import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { config, proxy } from "@/proxy";

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

  test("a signed-out city-shard request redirects, uncached", async () => {
    // The cached-redirect interaction above, now extended to 248 more URLs.
    // next.config.ts gives /cities/* a six-hour `public` cache; without
    // no-store on this redirect, a signed-out hit parks a redirect-to-/login
    // under a shard URL for hours — and unlike the topology assets,
    // fetchCityShard keeps no module-level cache to fall back on (it relies on
    // that very header). Same bug as /world-globe.json, larger blast radius.
    const req = new NextRequest("https://example.com/cities/PE.json");
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://example.com/login?next=%2Fcities%2FPE.json"
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

/**
 * The other half of the wall, and the half nothing asserted before this.
 *
 * `wallDecision` is never consulted for a path the matcher excludes, so every
 * `/cities/` assertion in lib/wall.test.ts — and the proxy() round trip above,
 * which calls the handler directly — stays green if someone adds `/cities/` to
 * the negative lookahead in proxy.ts's `config.matcher`, right beside
 * `_next/static`, `_next/image` and `favicon.ico`: the first place a future dev
 * would look, and the change that would publish 6.5 MB outside the wall.
 *
 * Compiled with the same vendored matcher Next itself uses on this field, so
 * these are the real semantics, not a regex re-implementation.
 */
describe("proxy matcher — which paths the wall is even asked about", () => {
  const matcher = getPathMatch(config.matcher[0], {});
  const seen = (pathname: string) => matcher(pathname) !== false;

  test("the city shards reach the wall", () => {
    for (const pathname of [
      "/cities/PE.json",
      "/cities/index.json",
      "/cities/enrich/PE.json",
    ]) {
      expect(seen(pathname), pathname).toBe(true);
    }
  });

  test("the topology assets and app pages reach it too", () => {
    for (const pathname of ["/world-globe.json", "/", "/plan", "/trip/abc123"]) {
      expect(seen(pathname), pathname).toBe(true);
    }
  });

  test("only the three build-output exemptions are excluded", () => {
    // Documented in proxy.ts: this matcher exempts framework output and
    // favicon.ico by name, nothing else. Anything added here is a hole.
    for (const pathname of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico"]) {
      expect(seen(pathname), pathname).toBe(false);
    }
  });
});
