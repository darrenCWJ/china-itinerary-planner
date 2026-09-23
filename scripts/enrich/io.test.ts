/**
 * enrich-cities — the two things about the network edge that a unit test can
 * pin without a network: which HTTP status is an answer and which is an
 * outage, and who the requests say they are from.
 *
 * Moved out of scripts/enrich-cities.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/enrich-cities.mjs was split
 * along its section banners. The first describe below is that file's,
 * unchanged; only the import path moved with it. The second, the User-Agent
 * both upstreams are sent, was added on 2026-09-23 — scripts/user-agent.test.ts
 * explains why.
 *
 * The writers in the same module — `writeFileAtomic` and `readJson` — are
 * covered where their failure actually bites, driven end to end through `run`
 * in scripts/enrich-cities.test.ts.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchExtracts, fetchSparqlBindings } from "./io.mjs";

describe("a SPARQL 404", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("is an outage, not an answer of zero bindings", () => {
    // For a per-title REST lookup a 404 means "no such page". For the SPARQL
    // endpoint it means the endpoint moved, and reading that as "Wikidata
    // knows nothing about these 150 cities" feeds a destructive merge.
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    return expect(fetchSparqlBindings("SELECT ?x WHERE {}", "1/1")).rejects.toThrow(/404/);
  });
});

describe("the User-Agent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const EXPECTED = "china-itinerary-planner/enrich-cities (+https://github.com/darrenCWJ/china-itinerary-planner)";

  /** A stand-in `fetch` that answers every request with `body`, and remembers what it was sent. */
  const answering = (body: unknown) => {
    const spy = vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    return spy;
  };

  /** Through `Headers`, because header names are case-insensitive on the wire. */
  const sentUserAgent = (spy: ReturnType<typeof answering>) =>
    new Headers((spy.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).get("user-agent");

  test("carries a contact URL to Wikidata's query service, as Wikimedia's User-Agent policy requires", async () => {
    // This is the nightly job's heaviest Wikimedia workload — ~30 unbroken
    // minutes of SPARQL — sent until 2026-09-23 under a bare
    // `ChinaItineraryPlanner/1.0 (personal project)` that drew HTTP 403 from
    // query.wikidata.org that day. scripts/user-agent.test.ts has the rest.
    const spy = answering({ results: { bindings: [] } });
    await fetchSparqlBindings("SELECT ?x WHERE {}", "1/1");
    expect(sentUserAgent(spy)).toBe(EXPECTED);
  });

  test("carries the same one to the Wikipedia Action API, a second Wikimedia host under the same policy", async () => {
    const spy = answering({ query: { pages: [] } });
    await fetchExtracts(["Cusco"]);
    expect(sentUserAgent(spy)).toBe(EXPECTED);
  });
});
