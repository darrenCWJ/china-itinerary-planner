import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MAX_CACHE_ENTRIES,
  MAX_IDS_PER_REQUEST,
  clearEnrichmentCache,
  enrichCities,
  enrichmentQuery,
  readEnrichmentRows,
} from "./cityEnrichment";

/**
 * The runtime half of enrichment: what a city gets when nobody pre-fetched it.
 *
 * `scripts/enrich-cities.mjs` covers the top 30 per country at build time.
 * This covers the other 52,498, once each per server instance, on first
 * selection.
 */

const CUSCO_ROWS = [
  { gid: { value: "3941584" }, title: { value: "Cusco" }, desc: { value: "historic city of Peru" } },
  { gid: { value: "3941584" }, img: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg" } },
];

const CUSCO_RECORD = {
  description: "historic city of Peru",
  image: "https://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg?width=640",
};

/**
 * `(...args: unknown[])` rather than a bare `()`: several tests below read the
 * URL the module actually sent, and a zero-parameter `vi.fn` types its
 * `mock.calls` entries as `[]`, so indexing one is a type error rather than a
 * lookup.
 */
function stubSparql(rows: unknown[]) {
  const mock = vi.fn(async (..._args: unknown[]) => ({
    ok: true,
    status: 200,
    json: async () => ({ results: { bindings: rows } }),
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The SPARQL body of whatever URL the module sent on a given call. */
function sentQuery(mock: ReturnType<typeof stubSparql>, call = 0): string {
  const url = String(mock.mock.calls[call]?.[0] ?? "");
  return decodeURIComponent(url.split("query=")[1]?.split("&format")[0] ?? "");
}

beforeEach(() => clearEnrichmentCache());
afterEach(() => vi.unstubAllGlobals());

describe("enrichmentQuery", () => {
  test("sends the bare geonameid, because that is what P1566 stores", () => {
    const query = enrichmentQuery(["G3941584"]);
    expect(query).toContain('"3941584"');
    expect(query).not.toContain("G3941584");
    expect(query).toContain("wdt:P1566");
  });

  test("refuses an id that is not a GeoNames id rather than interpolating it", () => {
    // These arrive from `/api/cities/enrich?ids=`, which is a query string a
    // caller controls, and the value is interpolated into a query body.
    expect(() => enrichmentQuery(['G1" } UNION { ?a ?b ?c'])).toThrow(/not a GeoNames id/);
    expect(() => enrichmentQuery(["Q170247"])).toThrow(/not a GeoNames id/);
  });
});

describe("readEnrichmentRows", () => {
  test("collapses one entity's several rows into one record", () => {
    expect(readEnrichmentRows(CUSCO_ROWS).get("G3941584")).toEqual(CUSCO_RECORD);
  });

  test("drops an entity that yielded neither a description nor an image", () => {
    expect(readEnrichmentRows([{ gid: { value: "1" } }]).size).toBe(0);
  });

  test("ignores a row with no id", () => {
    expect(readEnrichmentRows([{ desc: { value: "orphan" } }]).size).toBe(0);
  });

  test("keeps the first binding when an entity carries two of the same field", () => {
    // SPARQL returns a row per statement combination, so an entity with two P18
    // values arrives twice with two different images. `??=` means first wins;
    // plain assignment would mean last wins, and every test above would still
    // pass because none of their fixtures offers a second value to overwrite
    // the first with.
    const twoOfEach = [
      { gid: { value: "1" }, desc: { value: "first" }, img: { value: "https://x/a.jpg" } },
      { gid: { value: "1" }, desc: { value: "second" }, img: { value: "https://x/b.jpg" } },
    ];
    expect(readEnrichmentRows(twoOfEach).get("G1")).toEqual({
      description: "first",
      image: "https://x/a.jpg?width=640",
    });
  });
});

describe("enrichCities", () => {
  test("returns a record keyed by the G-prefixed id", async () => {
    stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584"])).resolves.toEqual({ G3941584: CUSCO_RECORD });
  });

  test("asks upstream once per id, however many times it is requested", async () => {
    // "cached by id" (spec §4). Without it, re-opening the wizard on the same
    // trip refetches every city in it.
    const mock = stubSparql(CUSCO_ROWS);
    const first = await enrichCities(["G3941584"]);
    const second = await enrichCities(["G3941584"]);
    expect(mock).toHaveBeenCalledTimes(1);
    // The second call must still answer from the cache, not merely skip the
    // network: an `enrichCities` that returned `{}` once an id was cached
    // would satisfy the call count on its own.
    expect(second).toEqual(first);
    expect(second).toEqual({ G3941584: CUSCO_RECORD });
  });

  test("caches a miss too, so an unknown city is not retried forever", async () => {
    // A well-formed id Wikidata has never heard of — a different path from a
    // malformed one, which never reaches the network at all.
    const mock = stubSparql([]);
    await expect(enrichCities(["G999999999"])).resolves.toEqual({});
    await expect(enrichCities(["G999999999"])).resolves.toEqual({});
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("caches the ids a batch answered nothing for, and returns only the ones it did", async () => {
    // The answer covers the whole batch, not only the rows that came back: the
    // second id was asked about and Wikidata had nothing, which is an answer.
    const mock = stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584", "G999999999"])).resolves.toEqual({
      G3941584: CUSCO_RECORD,
    });
    await enrichCities(["G999999999"]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("silently skips ids that are not GeoNames ids", async () => {
    // Curated ids and Wikidata qids reach this route too — the client does not
    // know which of its picks are enriched — and they are not an error.
    const mock = stubSparql([]);
    await expect(enrichCities(["beijing", "Q170247"])).resolves.toEqual({});
    expect(mock).not.toHaveBeenCalled();
  });

  test("one unusable id in a request does not cost the usable ones their enrichment", async () => {
    // Skipped, not merely refused. `enrichmentQuery` throws on an id it cannot
    // interpolate, and that throw is inside the same try that swallows a
    // network failure — so filtering only at the query builder would turn one
    // curated id in the list into an empty answer for every city beside it.
    // The test above cannot see that: with nothing valid in the request the
    // two behaviours are the same empty object.
    stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["beijing", "G3941584"])).resolves.toEqual({
      G3941584: CUSCO_RECORD,
    });
  });

  test("asks for at most MAX_IDS_PER_REQUEST ids, and never for the same id twice", async () => {
    // A user is waiting on this. The route takes whatever `?ids=` carries, so
    // without the cap one request is one unbounded SPARQL body.
    const mock = stubSparql([]);
    const ids = Array.from({ length: MAX_IDS_PER_REQUEST + 3 }, (_, i) => `G${9000 + i}`);
    // The repeats lead, so a missing dedupe spends budget on them rather than
    // being harmlessly truncated away by the cap behind them.
    await enrichCities([ids[0], ids[1], ...ids]);
    expect(mock).toHaveBeenCalledTimes(1);
    const quoted = sentQuery(mock).match(/"\d+"/g) ?? [];
    expect(quoted).toHaveLength(MAX_IDS_PER_REQUEST);
    expect(new Set(quoted).size).toBe(MAX_IDS_PER_REQUEST);
    expect(quoted).not.toContain(`"${ids[MAX_IDS_PER_REQUEST].slice(1)}"`);
  });

  test("returns what it has when upstream fails, rather than rejecting", async () => {
    // Enrichment is additive: a city with none renders exactly as a thin
    // catalog city does today, which is an accepted state in the UI.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("wikidata down"); }));
    await expect(enrichCities(["G3941584"])).resolves.toEqual({});
  });

  test("does not cache a failure, so the next request may still succeed", async () => {
    const failing = vi.fn(async () => { throw new Error("wikidata down"); });
    vi.stubGlobal("fetch", failing);
    await enrichCities(["G3941584"]);

    const working = stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584"])).resolves.toHaveProperty("G3941584");
    expect(working).toHaveBeenCalledTimes(1);
  });

  test("treats an HTTP error as a failure, not as an answer of nothing", async () => {
    // The distinction the `{ results: { bindings: [] } }` test above is the
    // other half of. Both return `{}` to the caller, so the caller cannot tell
    // them apart — only the cache can, and recording a 503 as "Wikidata has
    // nothing for this city" would blank it for the life of the instance.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ results: { bindings: [] } }) }))
    );
    await expect(enrichCities(["G3941584"])).resolves.toEqual({});

    const working = stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584"])).resolves.toEqual({ G3941584: CUSCO_RECORD });
    expect(working).toHaveBeenCalledTimes(1);
  });

  test("treats a 200 that carries no bindings array as a failure, not as an answer of nothing", async () => {
    // Task 7's data wipe was exactly this: an HTTP 200 with a short body,
    // recorded as a full answer. A WDQS error envelope is a 200 with no
    // `results`, and `json.results?.bindings ?? []` reads it as an empty
    // answer — indistinguishable, one line later, from a genuine one.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ error: "query timed out" }) }))
    );
    await expect(enrichCities(["G3941584"])).resolves.toEqual({});

    const working = stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584"])).resolves.toEqual({ G3941584: CUSCO_RECORD });
    expect(working).toHaveBeenCalledTimes(1);
  });

  test("is a no-op for an empty request", async () => {
    const mock = stubSparql([]);
    await expect(enrichCities([])).resolves.toEqual({});
    expect(mock).not.toHaveBeenCalled();
  });

  test("bounds the cache, because a miss is cached and the ids are caller-chosen", async () => {
    // `wallDecision` passes everything under /api/ (lib/wall.ts:38, "routes
    // self-enforce"), so the route's own session check is the only thing
    // limiting who may walk G1…G99999999 twelve at a time — and a signed-in
    // caller may still do it. Ids are validated, so there is no injection —
    // but an unbounded map would grow one entry per distinct id, forever, in a
    // lambda's memory.
    const mock = stubSparql([]);
    const id = (i: number) => `G${1_000_000 + i}`;
    const fill = async (from: number, count: number) => {
      for (let i = from; i < from + count; i += MAX_IDS_PER_REQUEST) {
        const size = Math.min(MAX_IDS_PER_REQUEST, from + count - i);
        await enrichCities(Array.from({ length: size }, (_, k) => id(i + k)));
      }
    };

    await fill(0, MAX_CACHE_ENTRIES);
    const filled = mock.mock.calls.length;
    // Exactly at the cap nothing has been evicted, so the first id ever seen
    // is still answered from memory. Without this half, an eviction policy
    // that dropped every entry immediately would pass the half below.
    await enrichCities([id(0)]);
    expect(mock).toHaveBeenCalledTimes(filled);

    // One batch past the cap, the oldest entries go.
    await fill(MAX_CACHE_ENTRIES, MAX_IDS_PER_REQUEST);
    await enrichCities([id(0)]);
    expect(mock).toHaveBeenCalledTimes(filled + 2);
  });

  test("two concurrent calls for the same id ask upstream once", async () => {
    // `missing` is computed from a synchronous `cache.has` that runs before
    // the await, so without an in-flight map both callers saw the id as
    // uncached and both queried. `app/plan/page.tsx` makes that easy to hit:
    // `addCatalog` reads `extras` from the render closure rather than through
    // a state updater, so two picks in one tick both decide to fetch.
    const mock = stubSparql(CUSCO_ROWS);

    const [first, second] = await Promise.all([
      enrichCities(["G3941584"]),
      enrichCities(["G3941584"]),
    ]);

    expect(mock).toHaveBeenCalledTimes(1);
    // Not merely "one query": the second caller must be answered, and with the
    // same record. A dedupe that dropped the second caller's answer would
    // satisfy the call count alone.
    expect(first).toEqual({ G3941584: CUSCO_RECORD });
    expect(second).toEqual({ G3941584: CUSCO_RECORD });
  });

  test("a second caller adds only the ids the first is not already asking about", async () => {
    // The overlap case, which a whole-batch dedupe would get wrong in the
    // other direction: sharing the first caller's promise must not cost the
    // second caller the id that promise was never going to answer.
    const mock = stubSparql(CUSCO_ROWS);

    const [, second] = await Promise.all([
      enrichCities(["G3941584"]),
      enrichCities(["G3941584", "G3936456"]),
    ]);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(sentQuery(mock, 0)).toContain('"3941584"');
    const overlap = sentQuery(mock, 1);
    expect(overlap).toContain('"3936456"');
    expect(overlap).not.toContain('"3941584"');
    expect(second).toEqual({ G3941584: CUSCO_RECORD });
  });

  test("a failed batch does not leave its ids permanently in flight", async () => {
    // The in-flight entry is dropped on settle, not on success. If it were
    // dropped only on success, one network failure would wedge that id: every
    // later call would await a promise that had already rejected-and-resolved
    // and never re-ask.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await Promise.all([enrichCities(["G3941584"]), enrichCities(["G3941584"])]);

    const mock = stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584"])).resolves.toEqual({ G3941584: CUSCO_RECORD });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
