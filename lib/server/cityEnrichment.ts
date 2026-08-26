import { isGeoNamesId } from "../geoNamesId";

/**
 * Enrichment for a city nobody pre-fetched.
 *
 * `scripts/enrich-cities.mjs` gives the top 30 per country a description and
 * an image at build time — 6,244 of 58,742, of which 5,118 came back with
 * something. This is what the rest get, on first selection, cached by id for
 * the life of the server instance (spec §4).
 *
 * The predicate comes from `lib/geoNamesId.ts` and NOT from
 * `lib/server/cityIndex.ts`, which re-exports the same function: that file
 * static-imports the 3,653,616-byte `data/cities-index.json`, and nothing here
 * ever resolves a city, so importing the predicate from there would drag the
 * whole artifact into a bundle that wants a regex.
 *
 * The query is a re-implementation of the build script's rather than an import
 * of it: pulling a `scripts/*.mjs` into the Next server bundle would ship a
 * build tool to production. The two are small, and the pair of tests that pin
 * "bare id, P1566" sit on both sides.
 *
 * The record this returns is a BARE `Record<string, CityEnrichmentRecord>`,
 * deliberately not the `{ country, generatedAt, source, cities: {…} }`
 * envelope that `scripts/enrich-cities.mjs` writes to
 * `public/cities/enrich/<CC>.json`. `parseCityEnrichment` in lib/cityShard.ts
 * reads that envelope and returns `{}` for anything else without complaining,
 * so nothing here may be routed through it.
 *
 * Additive by design. Every failure path here resolves to whatever it has
 * rather than rejecting, because a city with no enrichment renders exactly as
 * a thin catalog city does today.
 */

export interface CityEnrichmentRecord {
  description: string | null;
  image: string | null;
}

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "ChinaItineraryPlanner/1.0 (personal project)";
const TIMEOUT_MS = 15_000;
/**
 * A user is waiting on this, so it is one round trip and no retries.
 *
 * Exported for the test that pins it: the route hands over whatever `?ids=`
 * carried, so without the cap one request is one unbounded SPARQL body.
 *
 * It bounds ONE request and nothing more. Aggregate outbound volume is bounded
 * by who may reach the route at all, which is the session check in
 * `app/api/cities/enrich/route.ts`.
 */
export const MAX_IDS_PER_REQUEST = 12;

/**
 * Ids are validated, not escaped: they arrive from `/api/cities/enrich?ids=`,
 * a caller-controlled query string, and are interpolated into a query body.
 * Validation also catches the subtler mistake — sending the app's `G`-prefixed
 * id matches nothing, and an empty result is indistinguishable from a
 * genuinely unknown city.
 */
export function enrichmentQuery(geonameIds: readonly string[]): string {
  const values = geonameIds
    .map((id) => {
      if (!isGeoNamesId(id)) throw new Error(`"${id}" is not a GeoNames id`);
      return `"${id.slice(1)}"`;
    })
    .join(" ");
  return `
SELECT ?gid ?img ?desc WHERE {
  VALUES ?gid { ${values} }
  ?x wdt:P1566 ?gid.
  OPTIONAL { ?x wdt:P18 ?img. }
  OPTIONAL { ?x schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

function bindingValue(row: unknown, key: string): string | null {
  const record = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;
  const cell = record?.[key];
  const value = typeof cell === "object" && cell !== null ? (cell as Record<string, unknown>).value : null;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * SPARQL returns one row per statement combination, so an entity with two P18
 * values arrives twice. First non-null binding wins per field — the `??=`
 * merge `scripts/ingest-destinations.mjs` uses.
 */
export function readEnrichmentRows(bindings: readonly unknown[]): Map<string, CityEnrichmentRecord> {
  const merged = new Map<string, CityEnrichmentRecord>();
  for (const row of bindings) {
    const gid = bindingValue(row, "gid");
    if (!gid) continue;
    const id = `G${gid}`;
    const entity = merged.get(id) ?? { description: null, image: null };
    entity.description ??= bindingValue(row, "desc");
    const image = bindingValue(row, "img");
    // No image bytes are ever downloaded: P18 arrives as a Commons
    // Special:FilePath URL and Commons resizes server-side.
    entity.image ??= image ? `${image.replace(/^http:/, "https:")}?width=640` : null;
    merged.set(id, entity);
  }
  for (const [id, entity] of merged) {
    if (entity.description === null && entity.image === null) merged.delete(id);
  }
  return merged;
}

/**
 * Answered ids, including the ones that came back with nothing.
 *
 * A miss is cached too. Without that, a city Wikidata has never heard of is
 * re-queried on every selection for as long as the instance lives.
 *
 * Bounded, because these keys are caller-chosen. `wallDecision` passes
 * everything under `/api/` unconditionally (`lib/wall.ts:38`, "routes
 * self-enforce"), so the only thing standing between this map and an arbitrary
 * walk of `G1…G99999999` is the session gate the route itself applies — this
 * cap does not substitute for it, and neither does `MAX_IDS_PER_REQUEST`:
 * both bound a single request, not how many requests one caller may make.
 * Ids are validated, so there is no injection — but caching a miss by design
 * means an unbounded map would grow one entry per distinct id, forever, in a
 * lambda's memory. FIFO eviction: the working set is the cities in one trip,
 * orders of magnitude under the cap.
 *
 * Exported for the test that pins the eviction. 20,000 records of two short
 * strings is well under a lambda's headroom and 340x the 58 cities the largest
 * plausible trip could hold.
 */
export const MAX_CACHE_ENTRIES = 20_000;
const cache = new Map<string, CityEnrichmentRecord | null>();

function remember(id: string, record: CityEnrichmentRecord | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(id, record);
}

/** Test-only: both maps are module singletons and would leak between tests. */
export function clearEnrichmentCache(): void {
  cache.clear();
  inFlight.clear();
}

/**
 * The batches this instance is already waiting on, one entry per id in each.
 *
 * `missing` is computed from a synchronous `cache.has`, which runs before the
 * await — so two overlapping calls naming the same id both saw it uncached and
 * both issued the query. The client makes that easy to hit: `addCatalog` in
 * `app/plan/page.tsx` reads `extras` from the render closure, so two picks in
 * one tick both decide to fetch. A second caller now awaits the first caller's
 * request instead of opening its own.
 *
 * Entries live only for the duration of a request, so this needs no cap: the
 * cache below is what persists, and it has one.
 */
const inFlight = new Map<string, Promise<void>>();

/**
 * One outbound query for one batch of ids, resolving to nothing either way.
 *
 * Never rejects. Every failure path resolves so the shared promise other
 * callers are awaiting settles for them too, and so an id whose request failed
 * stays uncached and free to be tried again.
 */
async function fetchBatch(missing: readonly string[]): Promise<void> {
  try {
    const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(enrichmentQuery(missing))}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = readEnrichmentRows(bindingsOf(await res.json()));
    // Every id in this batch is now answered — the found ones with a record,
    // the rest with a cached null.
    for (const id of missing) remember(id, found.get(id) ?? null);
  } catch {
    // Not cached: a network failure, an HTTP error and a body that is not a
    // SPARQL result all say nothing about the city, and the next request
    // should be free to try again.
  }
}

/**
 * The rows of a SPARQL answer, or a throw for anything that is not one.
 *
 * The `?? []` this replaces read a body with no `results` as an answer of
 * nothing, and an answer of nothing is cached — so one WDQS error envelope,
 * which is served as an HTTP 200, would blank a city for the life of the
 * instance. Task 7 shipped a data wipe on exactly that distinction. An empty
 * `bindings` array stays a real answer: that is Wikidata saying it has nothing
 * for these ids, which is precisely what a cached miss is for.
 */
function bindingsOf(json: unknown): unknown[] {
  const root = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : null;
  const results = typeof root?.results === "object" && root.results !== null
    ? (root.results as Record<string, unknown>)
    : null;
  if (!Array.isArray(results?.bindings)) throw new Error("not a SPARQL result");
  return results.bindings;
}

export async function enrichCities(
  ids: readonly string[]
): Promise<Record<string, CityEnrichmentRecord>> {
  const wanted = [...new Set(ids.filter(isGeoNamesId))].slice(0, MAX_IDS_PER_REQUEST);
  const missing = wanted.filter((id) => !cache.has(id));

  // An id another call is already asking about is awaited, not re-asked.
  const waits = new Set<Promise<void>>();
  const fresh: string[] = [];
  for (const id of missing) {
    const pending = inFlight.get(id);
    if (pending) waits.add(pending);
    else fresh.push(id);
  }

  if (fresh.length > 0) {
    // Registered before the first await, so a caller arriving in the same tick
    // sees it. Deregistered on settle, and only if it is still this batch — a
    // later batch may have claimed the id after this one finished.
    const batch: Promise<void> = fetchBatch(fresh).finally(() => {
      for (const id of fresh) if (inFlight.get(id) === batch) inFlight.delete(id);
    });
    for (const id of fresh) inFlight.set(id, batch);
    waits.add(batch);
  }

  if (waits.size > 0) await Promise.all(waits);

  const out: Record<string, CityEnrichmentRecord> = {};
  for (const id of wanted) {
    const record = cache.get(id);
    if (record) out[id] = record;
  }
  return out;
}
