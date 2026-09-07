/**
 * enrich-cities — the one thing about the network edge that a unit test can
 * pin without a network: which HTTP status is an answer and which is an
 * outage.
 *
 * Moved out of scripts/enrich-cities.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/enrich-cities.mjs was split
 * along its section banners. The describe below is that file's, unchanged;
 * only the import path moved with it.
 *
 * The writers in the same module — `writeFileAtomic` and `readJson` — are
 * covered where their failure actually bites, driven end to end through `run`
 * in scripts/enrich-cities.test.ts.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchSparqlBindings } from "./io.mjs";

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
