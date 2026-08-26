import { describe, expect, test } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "@/next.config";

/**
 * next.config.ts lives at the repo root, not under lib/ — this file sits here
 * anyway because lib/ is the only place vitest.config.mts's node project globs
 * for `.test.ts` files, and `nextConfig.headers()` is a plain async function
 * returning a plain array, so it needs no Next server to call. `lib/proxy.test.ts`
 * already imports a repo-root module (`@/proxy`) for exactly this reason.
 *
 * Why this file exists at all: before it, NOTHING in the repo imported
 * next.config.ts and CI runs no `next build`, so every plausible mutation of
 * the `/cities/` cache rule — deleting it, misspelling the header key, zeroing
 * max-age, narrowing `:path+` to `:path`, reverting to the old single-segment
 * inline regex — passed `tsc --noEmit && npm test` untouched. That silence
 * matters more than a cache header usually would: `lib/cityShard.ts`'s
 * `fetchCityShard` deliberately keeps NO module-level cache because it relies
 * on this header, so a regression here has no in-memory fallback — it quietly
 * reinstates a full refetch on every country switch.
 *
 * Two halves, and both are needed. The literal assertions pin the source string
 * and the exact header pair. The compiled-matcher assertions pin what that
 * source actually MEANS, using Next's own vendored path matcher — the same
 * `getPathMatch` its custom-route layer compiles `headers()` sources with — so
 * a syntactically valid but semantically wrong pattern cannot slip through.
 */

const CITIES_SOURCE = "/cities/:path+";
const TOPOLOGY_SOURCE =
  "/:asset(world-countries\\.json|world-globe\\.json|china-provinces\\.json)";

/** Every /cities/ URL the app actually requests. */
const SHARD_PATHS = ["/cities/PE.json", "/cities/index.json", "/cities/enrich/PE.json"];

async function headerRules() {
  // `headers` is optional on NextConfig; its absence is itself a regression.
  expect(nextConfig.headers).toBeTypeOf("function");
  return await nextConfig.headers!();
}

function matches(source: string, pathname: string): boolean {
  return getPathMatch(source, {})(pathname) !== false;
}

describe("next.config.ts headers — the /cities/ shard subtree", () => {
  test("the rule exists, with exactly the source and header pair Task 17 shipped", async () => {
    const rules = await headerRules();
    const rule = rules.find((r) => r.source === CITIES_SOURCE);

    // Fails on: the rule being deleted, the source being edited (including
    // `:path+` narrowed to `:path` or reverted to a single-segment regex).
    expect(rule).toBeDefined();
    // Fails on: a misspelled key, a changed max-age, a dropped
    // stale-while-revalidate, `public` becoming `private`.
    expect(rule!.headers).toEqual([
      { key: "Cache-Control", value: "public, max-age=21600, stale-while-revalidate=86400" },
    ]);
  });

  test("compiled with Next's own matcher, it matches every shard URL the app fetches", async () => {
    const rules = await headerRules();
    const rule = rules.find((r) => r.source === CITIES_SOURCE);
    expect(rule).toBeDefined();

    for (const pathname of SHARD_PATHS) {
      expect(matches(rule!.source, pathname), pathname).toBe(true);
    }
  });

  test("it stops at the subtree boundary — /api/cities/enrich is not a static shard", async () => {
    const rules = await headerRules();
    const rule = rules.find((r) => r.source === CITIES_SOURCE);
    expect(rule).toBeDefined();

    // The enrichment API route. A rule broad enough to catch it would put a
    // six-hour public cache on a dynamic, session-scoped response.
    expect(matches(rule!.source, "/api/cities/enrich")).toBe(false);
  });

  test("bare /cities and /cities/ are excluded — `:path+`, not `:path*`", async () => {
    const rules = await headerRules();
    const rule = rules.find((r) => r.source === CITIES_SOURCE);
    expect(rule).toBeDefined();

    // Neither is a file. Under `:path*` (zero-or-more) both matched, so a 404
    // served at those URLs would have carried the six-hour public cache.
    expect(matches(rule!.source, "/cities")).toBe(false);
    expect(matches(rule!.source, "/cities/")).toBe(false);
    // Regression guard on the guard: `:path*` really is the looser pattern, so
    // this test would be vacuous if the two forms behaved identically here.
    expect(matches("/cities/:path*", "/cities")).toBe(true);
  });
});

describe("next.config.ts headers — the topology rule, and the two staying disjoint", () => {
  test("the topology rule still matches /world-globe.json at its own 24h/7d window", async () => {
    const rules = await headerRules();
    const rule = rules.find((r) => r.source === TOPOLOGY_SOURCE);

    expect(rule).toBeDefined();
    expect(rule!.headers).toEqual([
      { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
    ]);
    expect(matches(rule!.source, "/world-globe.json")).toBe(true);
    expect(matches(rule!.source, "/world-countries.json")).toBe(true);
    expect(matches(rule!.source, "/china-provinces.json")).toBe(true);
  });

  test("exactly one rule claims each URL — later rules win on the same key", async () => {
    // headers.md:47 — when two rules set the same header key for one path, the
    // LATER one wins. So a future broad `/:path*` rule carrying Cache-Control
    // would silently override the shard window from below without changing a
    // line of the /cities/ rule. This asserts no such overlap exists today.
    const rules = await headerRules();

    for (const pathname of [...SHARD_PATHS, "/world-globe.json"]) {
      const claiming = rules.filter((r) => matches(r.source, pathname));
      expect(claiming.map((r) => r.source), pathname).toHaveLength(1);
    }

    // And in the other direction: the topology rule is single-segment, so it
    // cannot reach into the shard subtree.
    for (const pathname of SHARD_PATHS) {
      expect(matches(TOPOLOGY_SOURCE, pathname), pathname).toBe(false);
    }
  });
});
