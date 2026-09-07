/**
 * ingest-country-facts — the network layer's pure parts and the payload
 * stamper.
 *
 * Moved out of scripts/ingest-country-facts.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-country-facts.mjs was
 * split along its section banners. Every describe below is that file's,
 * unchanged; only the import paths moved with them.
 *
 * No network call is made anywhere in this file: `fetchWithRetry`'s describe
 * stubs the global `fetch`, which is why the `vi`/`afterEach` aliases the
 * describes were written against are imported here under the same names.
 */

import { afterEach as afterEachTop, describe, expect, test, vi as viTop } from "vitest";
import { PROPERTIES } from "./facts.mjs";
import { EXPECTED_COUNTRIES } from "./gate.mjs";
import {
  COUNTRY_CODES,
  batchCodes,
  buildQuery,
  fetchWithRetry,
  parseRetryAfter,
  stampedPayload,
} from "./io.mjs";

// ---------------------------------------------------------------------------
// The network layer's pure parts
// ---------------------------------------------------------------------------

describe("parseRetryAfter", () => {
  test("reads delta-seconds", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter(" 5 ")).toBe(5_000);
  });

  test("reads an HTTP-date, relative to now", () => {
    const now = Date.parse("2026-08-28T00:00:00Z");
    expect(parseRetryAfter("Fri, 28 Aug 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  test("never returns a negative wait for a date already past", () => {
    const now = Date.parse("2026-08-28T00:01:00Z");
    expect(parseRetryAfter("Fri, 28 Aug 2026 00:00:00 GMT", now)).toBe(0);
  });

  test("returns null for absent or unparseable headers, so the backoff decides instead", () => {
    // null, not 0: a 0 would read as "retry immediately", which is the one
    // answer a rate-limited endpoint definitely did not give.
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("12.5")).toBeNull();
  });
});

describe("fetchWithRetry", () => {
  afterEachTop(() => viTop.unstubAllGlobals());

  /** One canned Response-alike, enough for the three branches that matter. */
  const respond = (status: number, body: string, retryAfter?: string) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? (retryAfter ?? null) : null) },
    text: async () => body,
  });

  test("returns the body on the first success, with no retry", async () => {
    // The positive control. Without it, every not.toThrow below could be
    // passing because nothing ever reaches the network at all.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(200, "code\nPE\n"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" }))
      .resolves.toBe("code\nPE\n");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("gives up immediately when Retry-After asks for longer than the ceiling", async () => {
    // Honouring the header is what keeps this a polite client; capping it is
    // what stops a misconfigured or hostile `Retry-After: 86400` from holding
    // a CI runner open for a day. The property is demoted and its previous
    // values carried forward instead — one night's freshness, not a field.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(429, "slow down", "86400"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" })
    ).rejects.toThrow(/Retry-After asked for 86400s, over the 300s ceiling/);
    // Once, not three times: the ceiling is a decision to stop, not a backoff.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("the ceiling sits at 300s exactly: 301s still gives up", async () => {
    // Pins WHERE the ceiling is, not merely that one exists. Without this, the
    // constant could drift to any value >= 86401 and the test above would
    // still pass, since it only proves a hostile number is refused.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(429, "slow down", "301"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" })
    ).rejects.toThrow(/Retry-After asked for 301s, over the 300s ceiling/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("the 120s WDQS actually asks for now PARKS and retries, instead of losing the run", async () => {
    // THE REGRESSION. Twice on 2026-08-28 WDQS answered 429 with
    // `Retry-After: 120`, and the old 60s ceiling threw the work away rather
    // than wait two minutes — once costing `drivingSide`, once costing the
    // entire run, because that 429 landed on the fatal `codes` query.
    // Fake timers so the park is asserted rather than actually slept through.
    viTop.useFakeTimers();
    try {
      const fetchSpy = viTop
        .fn()
        .mockResolvedValueOnce(respond(429, "slow down", "120"))
        .mockResolvedValueOnce(respond(200, "code\nNL\n"));
      viTop.stubGlobal("fetch", fetchSpy);
      const pending = fetchWithRetry("https://example.invalid/sparql", {
        body: "query=x",
        accept: "text/csv",
      });
      // Nothing has retried yet — the run is parked, which is the point.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await viTop.advanceTimersByTimeAsync(120_000);
      await expect(pending).resolves.toBe("code\nNL\n");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      viTop.useRealTimers();
    }
  });

  test("a 404 is an outage, never an empty result", async () => {
    // `notFoundIsEmpty: false`, stated as behaviour. Reading a moved endpoint
    // as "Wikidata knows nothing about 246 countries" is the Task 7 shape, and
    // it is not worth retrying either — a moved endpoint stays moved.
    const fetchSpy = viTop.fn().mockResolvedValue(respond(404, "not found"));
    viTop.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchWithRetry("https://example.invalid/sparql", { body: "query=x", accept: "text/csv" })
    ).rejects.toThrow(/that is an outage,\s+not an empty result/);
  });
});

describe("batchCodes", () => {
  test("splits in order and loses nothing", () => {
    const codes = COUNTRY_CODES.slice(0, 25);
    const batches = batchCodes(codes, 10);
    expect(batches.map((batch: string[]) => batch.length)).toEqual([10, 10, 5]);
    expect(batches.flat()).toEqual(codes);
  });

  test("a size at or over the input is one batch, and an empty input is no batches", () => {
    expect(batchCodes(["AA", "BB"], 500)).toEqual([["AA", "BB"]]);
    expect(batchCodes([], 50)).toEqual([]);
  });

  test("a nonsense size still terminates rather than looping forever", () => {
    // A zero or negative batch size would make the loop never advance, which
    // fails as a hung nightly runner rather than as a red build.
    expect(batchCodes(["AA", "BB"], 0)).toEqual([["AA"], ["BB"]]);
  });
});

describe("buildQuery", () => {
  test("every property carries a query, bounded to the codes it was handed", () => {
    // A tenth property added to PROPERTIES with no case in the switch would
    // throw at 3am inside the nightly job. This fails at build time instead.
    for (const property of PROPERTIES) {
      const query = buildQuery(property, ["PE", "CN"]);
      expect(query, property.name).toMatch(/^SELECT DISTINCT/);
      expect(query, property.name).toContain('"PE"');
      expect(query, property.name).toContain('"CN"');
      for (const column of property.columns) {
        expect(query, `${property.name} selects ${column}`).toContain("?" + column);
      }
    }
  });

  test("the country-code query keeps the FILTER that makes it answer at all", () => {
    // Measured against the live endpoint on 2026-08-27: the direct form
    // `?item wdt:P297 ?code` with a VALUES-bound ?code returns HTTP 200, a CSV
    // header and ZERO rows, while this form returns all 246. Simplifying it
    // back would wipe the country universe, and the only thing standing
    // between that and a committed artifact is the two-sided count band.
    const query = buildQuery(PROPERTIES[0], COUNTRY_CODES);
    expect(query).toContain("FILTER(?isoCode = ?code)");
    expect(query).not.toMatch(/wdt:P297 \?code/);
  });

  test("an unknown property is refused rather than silently queried for nothing", () => {
    expect(() =>
      buildQuery({ name: "holidays", property: "P832", fields: [], columns: [], batch: 50 }, ["PE"])
    ).toThrow(/no SPARQL query is defined/);
  });

  test("the language query asks about STATEMENTS, because the scope lives in a qualifier", () => {
    // The mutation this exists to catch: reverting to `?c wdt:P37 ?item`.
    // `wdt:` throws qualifiers away, and `P518 applies to part` is the only
    // thing that distinguishes "official in the United States" from "official
    // in Puerto Rico" — so the truthy form published "Carolinian, Chamorro,
    // Hawaiian, Samoan and Spanish are official languages" about the US.
    const languages = PROPERTIES.find((property) => property.name === "languages")!;
    const query = buildQuery(languages, ["US", "NO"]);
    expect(query).toContain("?c p:P37 ?st");
    expect(query).toContain("?st a wikibase:BestRank");
    expect(query).toContain("BIND(EXISTS { ?st pq:P518 ?part } AS ?scoped)");
    expect(query).not.toMatch(/wdt:P37/);
    // And the column has to be SELECTed, not merely bound: `parseBindings`
    // refuses a response missing a declared column, so a query that stopped
    // returning it demotes the property and carries yesterday's values
    // forward rather than silently publishing every scoped statement.
    expect(languages.columns).toContain("scoped");
    expect(query).toContain("?scoped");
  });
});

describe("COUNTRY_CODES", () => {
  test("is the app's shard universe: 246 sorted, unique, alpha-2 codes", () => {
    expect(COUNTRY_CODES).toHaveLength(EXPECTED_COUNTRIES);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect([...COUNTRY_CODES].sort()).toEqual(COUNTRY_CODES);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
    for (const code of ["CN", "PE", "JP", "CH", "SH"]) expect(COUNTRY_CODES).toContain(code);
  });

  test("excludes the codes Wikidata carries that the app ships no shard for", () => {
    // Measured 2026-08-27: an unbounded P297 query answers with 259 codes, and
    // these thirteen are the difference — exceptionally reserved codes,
    // uninhabited territories, and the historical Netherlands Antilles, East
    // Germany and Yugoslavia. Facts about East Germany would pass every gate in
    // this file and answer a question no user can ask.
    for (const code of ["AC", "AN", "AQ", "BV", "CP", "CQ", "DD", "DG", "HM", "PC", "TA", "UM", "YU"]) {
      expect(COUNTRY_CODES, code).not.toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// stampedPayload
// ---------------------------------------------------------------------------

describe("stampedPayload", () => {
  test("keeps the previous timestamp when the payload is unchanged", () => {
    const body = { source: "Wikidata (CC0)", license: "CC0-1.0", countries: { PE: { lat: -9 } } };
    const previous = { generatedAt: "2026-08-01T00:00:00.000Z", ...body };
    expect(stampedPayload(previous, body, "2026-08-27T00:00:00.000Z").generatedAt).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });

  test("takes the new timestamp when anything moved", () => {
    const previous = {
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "Wikidata (CC0)",
      license: "CC0-1.0",
      countries: { PE: { lat: -9 } },
    };
    const body = { source: "Wikidata (CC0)", license: "CC0-1.0", countries: { PE: { lat: -10 } } };
    expect(stampedPayload(previous, body, "2026-08-27T00:00:00.000Z").generatedAt).toBe(
      "2026-08-27T00:00:00.000Z"
    );
  });
});

