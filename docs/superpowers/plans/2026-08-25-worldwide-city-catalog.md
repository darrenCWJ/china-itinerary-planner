# Worldwide City Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 695-city China-only catalog with a worldwide one — 59,073 GeoNames cities across 246 countries, ranked for tourism rather than raw population — and open the three gates that keep the app China-bound, so a user can pick Peru on the globe, see Peruvian cities, tap one, and have it land in their plan with day counts and a route leg.

**Architecture:** A nightly `scripts/ingest-cities.mjs` fetches GeoNames' `cities500.zip`, unzips it with a hand-rolled `node:zlib` reader (no new dependency), scores every row `altNameCount + 2·log10(population)`, keeps the top 750 **within each country**, drops rows that duplicate an existing Wikidata-QID city, and emits 246 per-country shards under `public/cities/` plus a bundled `data/cities-index.json`. The client fetches one 18–22 KB gzipped shard when a country is picked; the server never reads `public/` — it resolves picked ids out of the bundled index. A second build script enriches the top 30 per country with Wikipedia summaries and Wikimedia images via Wikidata's GeoNames-ID property (P1566), and a runtime route enriches anything else on first selection.

**Tech Stack:** Node 24 ESM `.mjs` build scripts (native TypeScript type-stripping for zero-dependency `lib/*.ts` leaf imports), `node:zlib` `inflateRawSync`, Next 16.3.2 App Router, React 19.2.8, TypeScript 7.0.2 (`strict`), Vitest 4.1.11 (two projects: `node` for `lib/**/*.test.ts` + `scripts/**/*.test.ts`, `jsdom` for `components/**/*.test.tsx` + `lib/**/*.test.tsx`), GitHub Actions.

## Global Constraints

- **GeoNames is CC BY 4.0 — attribution required.** The app must carry a **visible** GeoNames credit in the UI, not only a line in `data/cities-report.md`. This is a licence obligation, not a nicety, and is the one item in this design with legal weight. (spec §7)
- **`public/` is NOT readable from a Vercel lambda.** Nothing server-side may `fs.read` a shard — it works locally and 500s in production. `data/cities-index.json` is bundled precisely so server routes (`resolveDestinations`) never need one. (spec §3.2, §8.5)
- **No test file may live under `app/`.** `vitest.config.mts` includes only `lib/**/*.test.ts`, `scripts/**/*.test.ts`, `components/**/*.test.tsx`, `lib/**/*.test.tsx`. A test under `app/` sits on disk and never runs. Country-parameter parsing and validation therefore live in `lib/`, and `route.ts` stays a thin wrapper with nothing worth testing in it. (spec §6)
- **`G`-prefixed ids must not collide with Wikidata QIDs.** GeoNames cities get **`G` + geonameid** (`G3936456`); the 695 existing China cities **keep their Wikidata QIDs** (`Q170247`), so their enrichment survives and no trip data migrates. (spec §3.3)
- **Ranking decides inclusion only; display sorts by population.** Shards sort by population so the score's quirks never surface in the UI. (Dunkirk outranks Lyon in France — wartime fame inflates alternate names.) (spec §3.2)
- **Pool = `cities500`, keep top 750 per country.** 59,073 cities, 246 countries/shards. (spec §2.1, §2.2)
- **Enrichment: top 30 per country at build time, on-demand after.** Measured 6,244 build-time rows (many countries have fewer than 30 cities). (spec §4, §9)
- **`score = altNameCount + 2 * log10(population)`**, with population clamped to a minimum of 1 — 30,648 of the 235,483 rows carry population `0` and `log10(0)` is `-Infinity`. (spec §2.1)
- **246 countries, not 244.** `cities500` adds **IO** (British Indian Ocean Territory, 2 cities) and **TK** (Tokelau, 3) over `cities15000`. Any count assertion in the ingest gate must use **246 exactly** — `assertSane` compares `shards.size` against `EXPECTED_COUNTRIES = 246` with a tolerance of 2, not against a floor, and additionally requires `IO` and `TK` by name. A floor cannot catch a first run, and a bare ±2 tolerance would accept `cities15000`'s 244; the two named codes are what tell the two dumps apart. (spec §2.2)
- **The ingest gate ABORTS BEFORE WRITING**, like `scripts/ingest-airports.mjs` and unlike `scripts/ingest-destinations.mjs`. The job runs unattended and auto-deploys; a corrupt artifact must never reach disk. (spec §6)
- **Fixture invariant:** every fixture city in every test must have a country present in the shard index. PR #17's globe fixture was wound inside-out and made a whole class of back-face tests green and hollow. (spec §6)
- **`CatalogHit`'s shape does not change.** `searchCities`, `mapCities` and `resolveDestinations` keep their names and return types. **Two** signatures change — `mapCities(country)` (spec §5, gate 3) and `searchCities(query, country, limit)`. The spec anticipated one; the second is deliberate, because gate 1 also removes `CATALOG_COUNTRIES`, and a `searchCities` that did not take a country would have to fail *open* — serving every Chinese city to a Japan-scoped request, which is the exact bug the allowlist existed to hide. Both changed callers (`app/api/destinations/route.ts`, `app/api/map/cities/route.ts`) are gate call sites, so no caller outside the three gates moves. (spec §3.3, §5)
- **One spec deviation, taken deliberately: `lib/tripShared.ts:24`'s `?? "CN"` stays.** Spec §5 lists it among gate 2's call sites, but it is a *persistence* backfill for `TripInput.country`, which is optional because trips saved before the field existed have none — not a country *scope*. Removing it would reclassify every legacy trip as country-less rather than as Chinese, which is a data bug, not a gate. `lib/tripShared.test.ts` already pins it and Task 10 extends its docblock to say why. **The spec's §5 gate-2 row should be amended to name only the four UI sites; a human should sign this off before Task 10 is executed.**
- **Acceptance test for the phase:** a user picks Peru on the globe, sees Peruvian cities, taps one, and it appears in their plan with day counts and a route leg. Until that passes, Phase 3 is not finished and Phase 4 must not start. (spec §5)
- **Pre-merge gate is exactly `npx tsc --noEmit` then `npm test`.** There is no lint, no formatter, and no `next build` in CI.
- **No new npm dependency.** Every ingest script in this repo uses only Node built-ins plus zero-import `lib/*.ts` leaves imported with an explicit `.ts` extension. Verified in this repo on Node v24.14.1: extensionless `.ts` to `.ts` imports fail under Node's type-stripping (`ERR_MODULE_NOT_FOUND`), and `.ts`-extension imports inside `lib/` fail `tsc` (`TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled`). **Therefore build-time logic lives in the `.mjs` script, not in `lib/`**, and the script may import only `lib/geo.ts` and `lib/foldPlaceName.ts`, which have no imports of their own.

---

## File Structure

| File | Created / Modified | Single responsibility |
|---|---|---|
| `scripts/ingest-cities.mjs` | Create | Fetch and unzip `cities500.zip`, score, rank, cut to 750/country, dedup against QID cities, resolve admin1 names, gate, emit shards + indexes + report. Exports every pure function. |
| `scripts/ingest-cities.test.ts` | Create | Node-project tests for `readZipMember`, `parseGeoNamesRows`, `parseAdmin1Codes`, `cityScore`, `topPerCountry`, `dropCatalogDuplicates`, `buildCities`, `assertSane`. |
| `scripts/enrich-cities.mjs` | Create | Build-time enrichment: Wikidata P1566 to enwiki title, intro extract and P18 image, top 30 per country, merged into per-country enrichment files. Exports its pure functions. |
| `scripts/enrich-cities.test.ts` | Create | Node-project tests for `buildEnrichmentQuery`, `readEnrichmentBindings`, `toThumbnailUrl`, `firstSentences`, `mergeEnrichment`, `assertEnrichmentSane`. |
| `lib/cityShard.ts` | Create | Client-safe shard contract: path constants, `parseCityShard`, `parseCityEnrichment`, `cityLevel`, `shardRowToMapCity`, `fetchCityShard`, `fetchCityEnrichment`. |
| `lib/cityShard.test.ts` | Create | Node-project tests for the parsers, `cityLevel`, `shardRowToMapCity`, the path constants, and the committed shards' integrity (skipped when absent). |
| `lib/geoNamesId.ts` | Create | The single `isGeoNamesId` predicate, in its own leaf so importing it never drags the 3.5 MB index into a bundle. No test file of its own — `lib/server/cityIndex.test.ts` exercises it through the re-export. |
| `lib/curatedNames.ts` | Create | The one per-country set of place names a curated destination already covers, read by `lib/server/catalog.ts`, `PlaceSearch` and `MapExplorer`. |
| `lib/curatedNames.test.ts` | Create | Node-project tests that the set is keyed by country and that the six activity-covered CN names are in it. |
| `lib/server/cityIndex.ts` | Create | Binds the bundled `data/cities-index.json` to a lazy id-to-entry `Map`; re-exports `isGeoNamesId`, and adds `readCityIndex`, `cityIndexEntry`, `cityIndexStatus`. Server-only. |
| `lib/server/cityIndex.test.ts` | Create | Node-project tests for `isGeoNamesId`, `readCityIndex`, and the committed index (skipped when absent). |
| `lib/server/cityEnrichment.ts` | Create | Runtime lazy enrichment: SPARQL query build, binding merge, in-process cache, `enrichCities(ids)`. |
| `lib/server/cityEnrichment.test.ts` | Create | Node-project tests for the query builder, binding reader, id validation and the cache. |
| `components/plan/GeoNamesCredit.tsx` | Create | The visible CC BY 4.0 credit, plus Wikipedia's CC BY-SA 4.0 credit for the descriptions shipped beside it. |
| `components/plan/GeoNamesCredit.test.tsx` | Create | jsdom test that the credit names both sources and links both licences. |
| `app/api/cities/enrich/route.ts` | Create | Thin wrapper over `enrichCities`. No logic, no test (nothing under `app/` runs). |
| `.github/workflows/refresh-cities.yml` | Create | Daily unattended re-ingest, enrich, and commit-on-change. |
| `public/cities/*.json` | Generated | 246 per-country shards plus `index.json`. |
| `public/cities/enrich/*.json` | Generated | Per-country build-time enrichment. |
| `data/cities-index.json` | Generated | Bundled `[id, name, country, lat, lon, admin1]` tuples for server-side resolution. |
| `data/cities-enrich-targets.json` | Generated | Each country's top-30 ids in **ranking** order, which display order throws away. Read only by `scripts/enrich-cities.mjs`; never served. |
| `data/cities-report.md` | Generated | Human-readable ingest report. |
| `lib/server/catalog.ts` | Modify | `CatalogCity.country`; country-scoped `searchCities`/`mapCities`; `resolveDestinations` over `G` ids. |
| `lib/server/catalogSearch.test.ts` | Modify | New `searchCities` signature; a country-scoping case. |
| `lib/server/catalog.test.ts` | Modify | `country` on the fixture city; a GeoNames-resolution case. |
| `lib/types.ts` | Modify | `Destination.country` becomes required. |
| `lib/data/north.ts`, `lib/data/east.ts`, `lib/data/west.ts`, `lib/data/south.ts` | Modify | Explicit `country: "CN"` on all 16 destinations. |
| `lib/data/destinations.test.ts` | Create | Node-project tests that all sixteen curated destinations name a country and that it is `CN`. |
| `lib/tripShared.ts` | Modify | Comment only — `tripCountry`'s `?? "CN"` is a persistence backfill and stays. |
| `lib/tripShared.test.ts` | **Modify** | Already exists with 13 tests, including the currency-pivot regressions (`Critical 1`, `J-C1`). Task 10 **appends to its `tripCountry` docblock only** — it must not be recreated. |
| `lib/wall.test.ts` | Modify | Pin the wall's behaviour for `/cities/*.json`. |
| `components/plan/PlaceSearch.tsx` | Modify | Delete `CATALOG_COUNTRIES`; search the active country's shard. |
| `components/plan/PlaceSearch.test.tsx` | Modify | Invert the "does not offer Chinese cities" assertion into shard scoping. |
| `components/DestinationStep.tsx` | Modify | Remove every `?? "CN"`; render the credit. |
| `components/DestinationStep.test.tsx` | Create | The acceptance test's browser half: planning Peru offers Peruvian cities and a tap commits one. |
| `lib/server/worldwideAcceptance.test.ts` | Create | The acceptance test's server half, run against the real committed artifacts. |
| `components/TripView.tsx` | Modify | Render the attribution credit — the shared trip page shows GeoNames city names to members who never open `/plan`. |
| `app/b/[code]/page.tsx` | Modify | Render the attribution credit in the briefing footer, for the same reason. |
| `components/map/MapExplorer.tsx` | Modify | Country-keyed cities effect; shard and enrichment load; region label; notice wording. |
| `components/map/MapExplorer.test.tsx` | Modify | Shard fixtures in the fetch mock; the Peru drill-down test. |
| `components/map/CountryMap.tsx` | Modify | Cap `CountryPlaceList` so a 750-city shard is not 750 chips. |
| `components/map/CountryMap.test.tsx` | Modify | A cap test. |
| `app/api/map/cities/route.ts` | Modify | `?country=` param. |
| `app/api/destinations/route.ts` | Modify | `?country=` param. |
| `app/plan/page.tsx` | Modify | Off-map places take the active country; first selection triggers lazy enrichment. |
| `next.config.ts` | Modify | Cache headers for `/cities/*`. |

### Measured facts this plan is built on (re-verified against the live dumps and this repo, 2026-08-25)

| fact | value | how it was checked |
|---|---|---|
| `cities500.zip` size | 13,533,683 bytes | `HEAD https://download.geonames.org/export/dump/cities500.zip` |
| archive members | exactly 1: `cities500.txt`, method 8 (deflate), 40,739,362 bytes inflated | central-directory walk |
| TSV rows | 235,483 (19 tab-separated columns, no header) | inflate + split |
| countries | 246 | group by column 8 |
| kept after top-750 cut | 59,073 | `cityScore` + slice |
| Cusco PE | geonameid **3941584**, rank 2/2296, pop 428,450, 44 alt names | rank probe |
| Zermatt CH | geonameid **2657928**, rank 36/1897, pop 6,629, 22 alt names | rank probe |
| Kyoto JP | geonameid **1857910**, rank 1/2189, pop 1,463,723 | rank probe |
| Jinan | **is deduped out of the CN shard** — it matches catalog `Q170247` within 5 km | dedup probe |
| CN shard after dedup | 413 GeoNames rows (337 of the top 750 collide with QID cities) | dedup probe |
| shard bytes (admin1 resolved to names) | AR 97,008 raw / 21,647 gz (largest); PE 84,701 raw / 19,406 gz; median ~12.3 KB; NU 211 B | JSON + gzip |
| total shard bytes | 6.48 MB raw / 1.47 MB gzipped | sum |
| `data/cities-index.json` | 3,672,345 bytes, `JSON.parse` 22 ms | 6-tuple encoding |
| `npx tsc --noEmit` over that 3.5 MB `resolveJsonModule` import | +0.7–0.9 s, no errors | a synthetic 59,073-tuple index compiled under this repo's exact `tsconfig.json` with TypeScript 7.0.2 |
| `public/cities/index.json` | **6,296 bytes measured COMPACT and without the per-country `generatedAt`.** Task 6 emits it with `JSON.stringify(…, null, 1)` and that extra field, which is roughly 3x larger (~21 KB). Re-measure at Task 6 Step 5 and correct this row. | 246 entries |
| build-time enrichment rows (top 30/country) | 6,244 | `min(30, shard size)` sum |
| ingest peak RSS | 261 MB against a 4,288 MB default heap limit | `process.memoryUsage()` |
| `admin1CodesASCII.txt` | 151,536 bytes, 3,866 lines including the trailing newline's empty last line — so `parseAdmin1Codes` yields **3,865** entries, which is the number `main()` prints. Format `CC.A1 \t name \t asciiname \t geonameid`. | fetch |
| Wikidata P1566 lookup | resolves Cusco/Zermatt/Kyoto/Fira/Wadi Musa to QID + enwiki title + description + P18 | live SPARQL |

> **Deviation from the spec's measured sizes, recorded deliberately.** Spec §2.2's shard figures (5.95 MB raw / 1.41 MB gz, AR 89.4 KB, PE 76.6 KB, median 10.9 KB) were measured with the **raw** GeoNames admin1 codes in the `a1` field. This plan resolves those codes to names via `admin1CodesASCII.txt`, because `a1` becomes `CatalogHit.province` / `MapCity.province` and is rendered directly to the user — `PlaceSearch.tsx:220-222` prints it, and "22" is not a province of Japan. Re-measured with names: 6.48 MB raw / 1.47 MB gz, AR 97,008 B, PE 84,701 B. The 7-field record shape the spec pins is unchanged; only the contents of one field become human-readable. Cost: +0.6 KB on the largest gzipped fetch.

---

## Task 1: The ZIP member reader and the GeoNames TSV parser

**Files:**
- Create: `scripts/ingest-cities.mjs`
- Test: `scripts/ingest-cities.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `export function readZipMember(buffer: Buffer, memberName: string): Buffer` — throws on a non-archive, a missing member, or an unsupported compression method.
  - `export function parseGeoNamesRows(text: string): GeoNamesRow[]` where `GeoNamesRow = { id: string; name: string; altNameCount: number; lat: number; lon: number; country: string; admin1Code: string; population: number; timezone: string }`. `id` is `"G" + geonameid`.
  - `export function parseAdmin1Codes(text: string): Map<string, string>` keyed `"CC.CODE"`.

Background facts these implement, all verified against the live archive:
`cities500.zip` holds exactly one member, `cities500.txt`, compression method 8 (deflate), 40,739,362 bytes inflated, 235,483 data lines of 19 tab-separated columns with no header. The columns used are `0 geonameid`, `1 name`, `3 alternatenames` (comma-separated), `4 latitude`, `5 longitude`, `8 country code`, `10 admin1 code`, `14 population`, `17 timezone`.

- [ ] **Step 1: Write the failing test**

  Create `scripts/ingest-cities.test.ts` with exactly this content:

```typescript
import { deflateRawSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { parseAdmin1Codes, parseGeoNamesRows, readZipMember } from "./ingest-cities.mjs";

/**
 * Covers every pure function standing between GeoNames' nightly dump and a
 * committed, auto-deployed artifact. The module's entry-point guard means
 * importing it here does not also run `main()` and refetch 13 MB.
 *
 * Import note: the script is `.mjs` and reads `../lib/geo.ts` and
 * `../lib/foldPlaceName.ts` via Node's native type-stripping at runtime, but
 * under Vitest the whole module graph goes through Vite's transform pipeline,
 * which resolves an explicit `.ts` extension same as any other module — the
 * idiom `scripts/ingest-airports.test.ts` already relies on.
 */

// ---------------------------------------------------------------------------
// readZipMember
// ---------------------------------------------------------------------------

/**
 * A real ZIP built byte by byte, rather than a checked-in binary fixture: the
 * point of these tests is which *headers* the reader trusts, and a hand-built
 * archive is the only way to state that in the test. Field offsets are the
 * PKZIP APPNOTE ones the reader itself uses.
 */
function zipWith(entries: { name: string; contents: string; method: 0 | 8 | 12 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, contents, method } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const body = Buffer.from(contents, "utf8");
    const payload = method === 8 ? deflateRawSync(body) : body;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, payload);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("readZipMember", () => {
  test("inflates a deflated member", () => {
    const zip = zipWith([{ name: "cities500.txt", contents: "a\tb\tc\n".repeat(200), method: 8 }]);
    expect(readZipMember(zip, "cities500.txt").toString("utf8")).toBe("a\tb\tc\n".repeat(200));
  });

  test("returns a stored member unchanged", () => {
    const zip = zipWith([{ name: "readme.txt", contents: "no compression", method: 0 }]);
    expect(readZipMember(zip, "readme.txt").toString("utf8")).toBe("no compression");
  });

  test("finds the wanted member when the archive holds others", () => {
    // GeoNames ships a single member today. If it ever adds a readme, picking
    // the first entry would hand the TSV parser prose and it would abort on a
    // ragged row rather than saying the archive changed shape.
    const zip = zipWith([
      { name: "readme.txt", contents: "ignore me", method: 0 },
      { name: "cities500.txt", contents: "wanted", method: 8 },
    ]);
    expect(readZipMember(zip, "cities500.txt").toString("utf8")).toBe("wanted");
  });

  test("throws when the member is absent rather than returning empty", () => {
    const zip = zipWith([{ name: "readme.txt", contents: "x", method: 0 }]);
    expect(() => readZipMember(zip, "cities500.txt")).toThrow(/is not in the archive/);
  });

  test("throws when the buffer is not a zip at all", () => {
    // What an HTML error page served with a 200 looks like to this function.
    expect(() => readZipMember(Buffer.from("<html>rate limited</html>"), "cities500.txt")).toThrow(
      /no end-of-central-directory record/
    );
  });

  test("throws on a compression method it cannot decode", () => {
    // Method 12 is bzip2. Silently returning the raw deflate bytes would hand
    // the TSV parser binary and produce a confusing ragged-row abort instead.
    const zip = zipWith([{ name: "cities500.txt", contents: "x", method: 12 }]);
    expect(() => readZipMember(zip, "cities500.txt")).toThrow(/unsupported zip compression method 12/);
  });
});

// ---------------------------------------------------------------------------
// parseGeoNamesRows
// ---------------------------------------------------------------------------

const COLUMNS = 19;

/** One syntactically valid `cities500.txt` line. Indices are GeoNames' own. */
function tsvRow(overrides: Record<number, string> = {}): string {
  const base = Array.from({ length: COLUMNS }, () => "");
  base[0] = "2657928";
  base[1] = "Zermatt";
  base[2] = "Zermatt";
  base[3] = "Cermat,Zermat,Zermatt,ツェルマット";
  base[4] = "46.01998";
  base[5] = "7.74863";
  base[6] = "P";
  base[7] = "PPL";
  base[8] = "CH";
  base[10] = "VS";
  base[14] = "6629";
  base[17] = "Europe/Zurich";
  base[18] = "2024-11-04";
  for (const [index, value] of Object.entries(overrides)) base[Number(index)] = value;
  return base.join("\t");
}

describe("parseGeoNamesRows", () => {
  test("maps a clean line onto the record the rest of the build uses", () => {
    expect(parseGeoNamesRows(`${tsvRow()}\n`)).toEqual([
      {
        id: "G2657928",
        name: "Zermatt",
        altNameCount: 4,
        lat: 46.01998,
        lon: 7.74863,
        country: "CH",
        admin1Code: "VS",
        population: 6629,
        timezone: "Europe/Zurich",
      },
    ]);
  });

  test("counts an empty alternate-names column as zero, not one", () => {
    // `''.split(',')` is `['']`, length 1 — which would hand every unnamed
    // hamlet a free point of notability and shift the whole ranking.
    expect(parseGeoNamesRows(`${tsvRow({ 3: "" })}\n`)[0].altNameCount).toBe(0);
  });

  test("aborts on a ragged line rather than reading undefined out of it", () => {
    // The thrown message is `row has 2 column(s), expected 19 — aborting …`,
    // so the count follows "expected" and the word "column" precedes it.
    expect(() => parseGeoNamesRows("only\ttwo\n")).toThrow(/has 2 column\(s\), expected 19/);
  });

  test("skips a trailing blank line without treating it as ragged", () => {
    expect(parseGeoNamesRows(`${tsvRow()}\n\n`)).toHaveLength(1);
  });

  test("drops a row with a blank coordinate instead of planting it at Null Island", () => {
    // `Number('')` is 0, which `Number.isFinite` accepts — so a wiped-out
    // coordinate has to be rejected before it ever reaches `Number()`.
    expect(parseGeoNamesRows(`${tsvRow({ 4: "" })}\n`)).toEqual([]);
    expect(parseGeoNamesRows(`${tsvRow({ 5: "  " })}\n`)).toEqual([]);
    expect(parseGeoNamesRows(`${tsvRow({ 4: "not-a-number" })}\n`)).toEqual([]);
  });

  test("drops a row whose country code is not two uppercase letters", () => {
    // GeoNames leaves the column blank for a handful of disputed places, and a
    // blank country would become a shard file named `.json`.
    expect(parseGeoNamesRows(`${tsvRow({ 8: "" })}\n`)).toEqual([]);
    expect(parseGeoNamesRows(`${tsvRow({ 8: "CHE" })}\n`)).toEqual([]);
  });

  test("treats a blank population as zero rather than NaN", () => {
    // 30,648 of the 235,483 real rows carry an explicit "0"; a blank must land
    // in the same place, not poison the score with NaN.
    expect(parseGeoNamesRows(`${tsvRow({ 14: "" })}\n`)[0].population).toBe(0);
  });

  test("drops a row whose geonameid is not a positive integer", () => {
    // The id becomes the shard's primary key and the `G` prefix that keeps it
    // out of Wikidata's namespace; anything else is not an id.
    expect(parseGeoNamesRows(`${tsvRow({ 0: "" })}\n`)).toEqual([]);
    expect(parseGeoNamesRows(`${tsvRow({ 0: "Q170247" })}\n`)).toEqual([]);
  });

  test("tolerates CRLF line endings", () => {
    expect(parseGeoNamesRows(`${tsvRow()}\r\n`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseAdmin1Codes
// ---------------------------------------------------------------------------

describe("parseAdmin1Codes", () => {
  test("keys the UTF-8 name by CC.CODE", () => {
    const codes = parseAdmin1Codes(
      ["CH.VS\tValais\tValais\t2658205", "JP.22\tKyōto\tKyoto\t1857907"].join("\n")
    );
    expect(codes.get("CH.VS")).toBe("Valais");
    // The second column, not the third: the ASCII fold is a search aid, and
    // `foldPlaceName` already does that job at the point search needs it.
    expect(codes.get("JP.22")).toBe("Kyōto");
  });

  test("returns a Map, so a code named like an Object member cannot resolve through the prototype", () => {
    // Same class of bug as `sizeForType` in ingest-airports.mjs: a plain
    // object would answer `codes['constructor']` with a function, which is not
    // nullish, so `?? null` would never catch it and JSON.stringify would
    // silently drop the key from the committed record.
    const codes = parseAdmin1Codes("XX.constructor\tReal Name\tReal Name\t1");
    expect(codes.get("XX.toString")).toBeUndefined();
    expect(codes.get("XX.constructor")).toBe("Real Name");
  });

  test("ignores blank and short lines instead of storing undefined", () => {
    expect(parseAdmin1Codes("\nCH.VS\tValais\tValais\t1\n\ngarbage\n").size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected — measured against this repo's Vitest 4.1.11, not paraphrased: the run fails at collection with

  ```
  Error: Cannot find module './ingest-cities.mjs' imported from …/scripts/ingest-cities.test.ts
   Test Files  1 failed (1)
        Tests  no tests
  ```

  because `scripts/ingest-cities.mjs` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

  Create `scripts/ingest-cities.mjs` with exactly this content:

```javascript
#!/usr/bin/env node
/**
 * ingest-cities.mjs
 *
 * Builds the worldwide city catalog from GeoNames' cities500 dump: 246
 * per-country shards under public/cities/, a bundled id index under data/, and
 * data/cities-report.md.
 *
 * Population is the wrong axis. At population >= 15,000 every one of Zermatt,
 * Banff, Interlaken, Positano, Queenstown, Hallstatt, Oia, Chamonix, Hakone,
 * Sa Pa, Petra, Kotor and Giverny is absent from the app; the threshold that
 * contains Zermatt (6,629) also contains all 15,363 French communes. So the
 * cut is a composite score — alternate-name count plus twice the log of
 * population — ranked *within each country*, which compares a town against its
 * own national baseline rather than a global threshold. Cusco ranks 2/2,296 in
 * Peru; Kenya's top eight surface Malindi and Naivasha above larger
 * administrative cities.
 *
 * Ranking decides inclusion ONLY. Shards sort by population for display, so
 * the score's quirks never reach the UI. (Dunkirk outranks Lyon in France —
 * wartime fame inflates alternate names.)
 *
 * Rerunnable and idempotent per shard: a country whose 750 rows are unchanged
 * keeps its previous `generatedAt`, so its file is byte-identical and the
 * daily workflow commits only the countries that actually moved. That matters
 * more here than it did for airports: the full artifact set is ~6.5 MB across
 * 246 files, and rewriting all of them nightly would bloat the repo.
 *
 * Like ingest-airports.mjs and unlike ingest-destinations.mjs, this script
 * ABORTS BEFORE WRITING when a sanity check fails. The workflow commits what
 * this writes and Vercel deploys it unattended; a corrupt city catalog is not
 * useful for inspection.
 *
 * Licence: GeoNames is CC BY 4.0 — attribution required, and unlike
 * OurAirports and Natural Earth it is not public domain. The credit has to be
 * visible in the UI (components/plan/GeoNamesCredit.tsx), not just here.
 *
 * Usage: node scripts/ingest-cities.mjs
 *
 * It reads lib/geo.ts and lib/foldPlaceName.ts straight out of lib/, relying
 * on Node's native type stripping (stable since Node 22.18 / 24) so the
 * haversine and the name fold have exactly one definition each rather than a
 * copy here that could drift. Both are leaf modules with no imports of their
 * own, which is required: an extensionless `.ts` -> `.ts` import fails under
 * type stripping with ERR_MODULE_NOT_FOUND, and adding the extension inside
 * lib/ fails `tsc` with TS5097. Node prints a MODULE_TYPELESS_PACKAGE_JSON
 * warning for these imports because package.json has no `"type": "module"`;
 * the imports still work and the warning is not worth changing the package's
 * module type for.
 */

import { inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_LOCAL_SIG = 0x04034b50;
/** A ZIP comment is a 16-bit length, so the EOCD is never further back than this. */
const ZIP_MAX_COMMENT = 65_535;
/** cities500.txt inflates to 40.7 MB; this is headroom, not a target. */
const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

/**
 * The one member of a ZIP archive we want, inflated.
 *
 * Written by hand rather than adding a dependency, because every other ingest
 * script in this repo runs on Node built-ins alone and the nightly workflow
 * has no `npm ci` step as a result. `node:zlib` and `DecompressionStream`
 * handle raw deflate/gzip streams but neither can open a ZIP *container*:
 * the local file headers and the central directory have to be walked first,
 * and only then are the member's bytes a raw deflate stream `inflateRawSync`
 * understands.
 *
 * The central directory is walked rather than the local headers, because only
 * the central directory is authoritative about which members exist. But the
 * *local* header's extra-field length is what locates the payload — the two
 * lengths legitimately differ, and using the central one lands the read a few
 * bytes into the compressed data, which inflates to garbage rather than
 * erroring.
 */
export function readZipMember(buffer, memberName) {
  let eocd = -1;
  const floor = Math.max(0, buffer.length - ZIP_MAX_COMMENT - 22);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === ZIP_EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new Error('not a zip archive: no end-of-central-directory record found');
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (buffer.readUInt32LE(p) !== ZIP_CENTRAL_SIG) {
      throw new Error(`corrupt zip: central directory entry ${i} has no signature`);
    }
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    if (name === memberName) {
      if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_SIG) {
        throw new Error(`corrupt zip: ${name} has no local file header`);
      }
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const payload = buffer.subarray(start, start + compressedSize);
      if (method === 0) return payload;
      if (method === 8) return inflateRawSync(payload, { maxOutputLength: MAX_INFLATED_BYTES });
      throw new Error(
        `${name} uses unsupported zip compression method ${method} — expected 0 (stored) or 8 (deflate)`
      );
    }
    p += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${memberName} is not in the archive`);
}

// ---------------------------------------------------------------------------
// GeoNames TSV
// ---------------------------------------------------------------------------

/** cities500.txt has no header row, so the column map is a constant, not a lookup. */
const GEONAMES_COLUMNS = 19;
const COL = {
  geonameId: 0,
  name: 1,
  altNames: 3,
  lat: 4,
  lon: 5,
  country: 8,
  admin1: 10,
  population: 14,
  timezone: 17,
};

/**
 * Every usable row of cities500.txt, as the record the rest of the build uses.
 *
 * A ragged line aborts — the dump has a fixed 19-column shape and a line that
 * does not is upstream changing format, which must be looked at rather than
 * read past. Everything else that merely fails a filter is dropped in silence,
 * the same split ingest-airports.mjs draws.
 */
export function parseGeoNamesRows(text) {
  const rows = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') continue;
    const f = line.split('\t');
    if (f.length !== GEONAMES_COLUMNS) {
      throw new Error(
        `row has ${f.length} column(s), expected ${GEONAMES_COLUMNS} — aborting rather than ` +
        `reading undefined out of a ragged row (upstream may have changed the dump's shape)`
      );
    }
    const geonameId = f[COL.geonameId].trim();
    if (!/^[1-9][0-9]*$/.test(geonameId)) continue;
    const country = f[COL.country].trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) continue;
    const latStr = f[COL.lat].trim();
    const lonStr = f[COL.lon].trim();
    // A blank cell must be rejected before it ever reaches `Number()`:
    // `Number('')` is `0`, which `Number.isFinite` happily accepts, so a row
    // with a wiped-out coordinate would be planted at Null Island (0, 0) and
    // committed rather than dropped.
    if (latStr === '' || lonStr === '') continue;
    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const populationStr = f[COL.population].trim();
    const population = populationStr === '' ? 0 : Number(populationStr);
    if (!Number.isFinite(population) || population < 0) continue;
    const altNames = f[COL.altNames];
    rows.push({
      id: `G${geonameId}`,
      name: f[COL.name].trim(),
      // `''.split(',')` is `['']` — length 1 — which would hand every unnamed
      // hamlet a free point of notability and shift the whole ranking.
      altNameCount: altNames === '' ? 0 : altNames.split(',').filter(Boolean).length,
      lat,
      lon,
      country,
      admin1Code: f[COL.admin1].trim(),
      population,
      timezone: f[COL.timezone].trim(),
    });
  }
  return rows;
}

/**
 * `CC.CODE` -> admin-1 name, from GeoNames' admin1CodesASCII.txt.
 *
 * A Map rather than an object literal, so a code spelled like an Object member
 * ("constructor", "toString") cannot resolve through the prototype chain to a
 * function — the exact bug `sizeForType` in ingest-airports.mjs documents,
 * where a non-nullish inherited value slips past `?? null` and JSON.stringify
 * then silently drops the key from the committed record.
 *
 * Column 1 (the UTF-8 name) is taken rather than column 2 (the ASCII fold):
 * this value becomes `CatalogHit.province` and is rendered to the user, and
 * `foldPlaceName` already folds it at the one point search needs it folded.
 */
export function parseAdmin1Codes(text) {
  const codes = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') continue;
    const f = line.split('\t');
    if (f.length < 2) continue;
    const key = f[0].trim();
    const name = f[1].trim();
    if (key === '' || name === '') continue;
    codes.set(key, name);
  }
  return codes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  18 passed (18)`.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
  git commit -m "feat: read GeoNames' zipped cities500 dump with no new dependency"
  ```

---

## Task 2: The composite score, per-country ranking, and the top-750 cut

**Files:**
- Modify: `scripts/ingest-cities.mjs` (append after `parseAdmin1Codes`)
- Test: `scripts/ingest-cities.test.ts` (append)

**Interfaces:**
- Consumes: `GeoNamesRow` from Task 1 (`{ id, name, altNameCount, lat, lon, country, admin1Code, population, timezone }`).
- Produces:
  - `export const CITIES_PER_COUNTRY = 750`
  - `export function cityScore(row: { population: number; altNameCount: number }): number`
  - `export function topPerCountry(rows: readonly GeoNamesRow[], perCountry?: number): Map<string, GeoNamesRow[]>` — keys are ISO alpha-2, values are that country's kept rows in **score order** (ranking order, not display order).

- [ ] **Step 1: Write the failing test**

  Append to `scripts/ingest-cities.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// cityScore / topPerCountry
// ---------------------------------------------------------------------------

import { CITIES_PER_COUNTRY, cityScore, topPerCountry } from "./ingest-cities.mjs";

interface ScorableRow {
  id: string;
  name: string;
  altNameCount: number;
  lat: number;
  lon: number;
  country: string;
  admin1Code: string;
  population: number;
  timezone: string;
}

function scorable(over: Partial<ScorableRow> & Pick<ScorableRow, "id">): ScorableRow {
  return {
    name: `City ${over.id}`,
    altNameCount: 0,
    lat: 10,
    lon: 20,
    country: "XX",
    admin1Code: "01",
    population: 1_000,
    timezone: "UTC",
    ...over,
  };
}

describe("cityScore", () => {
  test("is alternate-name count plus twice the log of population", () => {
    // 22 + 2 * log10(6629) = 22 + 7.6417... — Zermatt's real numbers.
    expect(cityScore({ altNameCount: 22, population: 6_629 })).toBeCloseTo(
      22 + 2 * Math.log10(6_629),
      10
    );
  });

  test("clamps population to 1 so an unpopulated row scores its alternate names, not -Infinity", () => {
    // 30,648 of the 235,483 real rows carry population 0. log10(0) is
    // -Infinity, and -Infinity + n is -Infinity for every n — so without the
    // clamp every unpopulated row ties at the bottom and the id tiebreak, not
    // notability, decides which ones make the cut.
    expect(cityScore({ altNameCount: 12, population: 0 })).toBe(12);
    expect(Number.isFinite(cityScore({ altNameCount: 0, population: 0 }))).toBe(true);
  });

  test("separates a tourist town from a same-size commune", () => {
    // The finding the whole design rests on: Zermatt (6,629 people, 22
    // alternate names) must outrank a French commune of comparable size with
    // the handful of alternate names such a place actually carries.
    const zermatt = cityScore({ altNameCount: 22, population: 6_629 });
    const commune = cityScore({ altNameCount: 3, population: 6_800 });
    expect(zermatt).toBeGreaterThan(commune);
  });

  test("still lets a large city win on population alone", () => {
    // Lima ranks 1 in Peru; the score must not become a pure notability metric
    // that buries capitals under photogenic villages.
    expect(cityScore({ altNameCount: 4, population: 7_737_002 })).toBeGreaterThan(
      cityScore({ altNameCount: 12, population: 600 })
    );
  });
});

describe("topPerCountry", () => {
  test("ranks within each country, never globally", () => {
    // The entire point of §2.1: a French commune scoring higher than a Peruvian
    // town must not push that town out of Peru's shard.
    const kept = topPerCountry(
      [
        scorable({ id: "G1", country: "FR", altNameCount: 40, population: 100_000 }),
        scorable({ id: "G2", country: "FR", altNameCount: 30, population: 100_000 }),
        scorable({ id: "G3", country: "PE", altNameCount: 1, population: 900 }),
      ],
      1
    );
    expect(kept.get("FR")!.map((r) => r.id)).toEqual(["G1"]);
    expect(kept.get("PE")!.map((r) => r.id)).toEqual(["G3"]);
  });

  test("cuts each country at the limit independently", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) =>
        scorable({ id: `GA${i}`, country: "AA", population: 1_000 * (i + 1) })
      ),
      scorable({ id: "GB0", country: "BB" }),
    ];
    const kept = topPerCountry(rows, 3);
    expect(kept.get("AA")).toHaveLength(3);
    expect(kept.get("BB")).toHaveLength(1);
  });

  test("returns rows in descending score order", () => {
    const kept = topPerCountry(
      [
        scorable({ id: "G1", altNameCount: 1 }),
        scorable({ id: "G2", altNameCount: 9 }),
        scorable({ id: "G3", altNameCount: 5 }),
      ],
      3
    );
    expect(kept.get("XX")!.map((r) => r.id)).toEqual(["G2", "G3", "G1"]);
  });

  test("breaks a score tie by id so a rebuild is byte-stable", () => {
    // Two rows with identical score are otherwise ordered by whatever order
    // the dump happened to list them in, and GeoNames does reorder rows —
    // which would rewrite a shard nightly with no data change.
    const kept = topPerCountry(
      [scorable({ id: "G9" }), scorable({ id: "G2" }), scorable({ id: "G5" })],
      3
    );
    expect(kept.get("XX")!.map((r) => r.id)).toEqual(["G2", "G5", "G9"]);
  });

  test("defaults to 750 per country", () => {
    expect(CITIES_PER_COUNTRY).toBe(750);
    const rows = Array.from({ length: 800 }, (_, i) =>
      scorable({ id: `G${1000 + i}`, population: i + 1 })
    );
    expect(topPerCountry(rows).get("XX")).toHaveLength(750);
  });

  test("a country code spelled like an Object member is a real key, not a prototype hit", () => {
    // Not hypothetical for a keyed group: a plain object would answer
    // `groups['constructor']` with `Object.prototype.constructor`, and
    // `groups[cc] ?? []` would never catch it because a function is not
    // nullish — the same class of bug `sizeForType` documents in
    // ingest-airports.mjs. A Map has no prototype chain to fall through.
    const kept = topPerCountry([scorable({ id: "G1", country: "CO" })], 750);
    expect(kept.get("constructor")).toBeUndefined();
    expect(kept.get("toString")).toBeUndefined();
    expect(kept.get("CO")).toHaveLength(1);
  });

  test("an empty pool is an empty map, not a throw", () => {
    expect(topPerCountry([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected — measured, not paraphrased: the module **loads**, and the new tests fail on first use with `TypeError: cityScore is not a function`. Vite's SSR transform rewrites imports to property lookups, so a missing export is `undefined` at call time rather than a collection-time `SyntaxError`, and the earlier tests keep passing. The summary line therefore reads `Tests  11 failed | 18 passed (29)`, **not** a collection error.

- [ ] **Step 3: Write the minimal implementation**

  Append to `scripts/ingest-cities.mjs`, after `parseAdmin1Codes`:

```javascript
// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Cities kept per country. Measured: 750 from cities500 captures 13 of the 14
 * destinations a population >= 15,000 filter excluded entirely (all but
 * Giverny, which is a place you visit from Vernon rather than sleep in, and so
 * belongs in the attractions layer). Total across 246 countries: 59,073.
 */
export const CITIES_PER_COUNTRY = 750;

/**
 * The composite notability score, §2.1: `altNameCount + 2 * log10(population)`.
 *
 * `altNameCount` is the size of the alternate-names column already in the
 * dump — no second source and no extra fetch. Alone it is not a clean
 * separator (tourist towns run 9-26, communes 0-12, and they overlap); ranked
 * within a country it separates well, because it is compared against a local
 * baseline rather than a global threshold.
 *
 * Population is clamped to 1. `Math.log10(0)` is `-Infinity`, and adding any
 * finite alternate-name count to `-Infinity` is still `-Infinity`, so without
 * the clamp all 30,648 unpopulated rows tie at the bottom and the id tiebreak
 * — not notability — decides which of them make a small country's cut.
 */
export function cityScore(row) {
  return row.altNameCount + 2 * Math.log10(Math.max(1, row.population));
}

/**
 * Every country's kept rows, in ranking order.
 *
 * A Map, not an object: "CO" is a real country code and "constructor" is a
 * real string, and a plain object cannot tell an inherited member from a
 * missing key — see `parseAdmin1Codes` for the same reasoning.
 *
 * The id tiebreak is not cosmetic. GeoNames reorders rows between nightly
 * rebuilds, so two rows with an identical score would otherwise swap places
 * and rewrite a shard that carries no new data — which the daily workflow
 * would then commit.
 */
export function topPerCountry(rows, perCountry = CITIES_PER_COUNTRY) {
  const byCountry = new Map();
  for (const row of rows) {
    const list = byCountry.get(row.country);
    if (list) list.push(row);
    else byCountry.set(row.country, [row]);
  }
  const kept = new Map();
  for (const [country, list] of byCountry) {
    list.sort((a, b) => cityScore(b) - cityScore(a) || a.id.localeCompare(b.id));
    kept.set(country, list.slice(0, perCountry));
  }
  return kept;
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  29 passed (29)`.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
  git commit -m "feat: rank cities by notability within each country, not by population globally"
  ```

---

## Task 3: Dedup against the 695 existing Wikidata QID cities

**Files:**
- Modify: `scripts/ingest-cities.mjs` (append after `topPerCountry`)
- Test: `scripts/ingest-cities.test.ts` (append)

**Interfaces:**
- Consumes: `GeoNamesRow` (Task 1); `haversineKm` from `../lib/geo.ts` (`export function haversineKm(a: LatLon, b: LatLon): number`, `LatLon = { lat: number; lon: number }`); `foldPlaceName` from `../lib/foldPlaceName.ts` (`export function foldPlaceName(value: string): string`).
- Produces:
  - `export const DEDUP_RADIUS_KM = 5`
  - `export function dropCatalogDuplicates(rows: readonly GeoNamesRow[], catalogCities: readonly { name: string; lat: number; lon: number }[]): GeoNamesRow[]`

Measured behaviour this must reproduce: against the real `data/catalog.json` (695 cities) and the real CN top-750, **337 rows are dropped and 413 kept**. Jinan is one of the 337 — it matches catalog `Q170247` at 36.67/117.0 within 5 km — which is exactly why the ingest gate's Jinan fixture (Task 5) asserts Jinan survives *as a QID city*, not as a GeoNames one.

- [ ] **Step 1: Write the failing test**

  Append to `scripts/ingest-cities.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// dropCatalogDuplicates
// ---------------------------------------------------------------------------

import { DEDUP_RADIUS_KM, dropCatalogDuplicates } from "./ingest-cities.mjs";

/** Jinan as data/catalog.json really holds it (Q170247). */
const JINAN_QID = { name: "Jinan", lat: 36.666666666, lon: 116.983333333 };

describe("dropCatalogDuplicates", () => {
  test("drops a GeoNames row that is the same city as an existing QID record", () => {
    // GeoNames' Jinan is G1805753 at 36.66833/116.99722 — 1.2 km from the
    // catalog's Q170247. Keeping both would put two Jinans on the map, and the
    // QID one is the record with a description, an image and interest tags.
    const rows = [
      scorable({ id: "G1805753", name: "Jinan", country: "CN", lat: 36.66833, lon: 116.99722 }),
    ];
    expect(dropCatalogDuplicates(rows, [JINAN_QID])).toEqual([]);
  });

  test("keeps a row that shares a name with a QID city far away", () => {
    // Name-only matching collapses genuinely distinct places that share a
    // name — GeoNames has two Peruvian cities called Cusco, 1,400 km apart.
    // Stated here with a second "Jinan" placed in Shenzhen, ~1,500 km south,
    // because the catalog this dedups against is all-China.
    const rows = [scorable({ id: "G1", name: "Jinan", country: "CN", lat: 22.5, lon: 114.0 })];
    expect(dropCatalogDuplicates(rows, [JINAN_QID]).map((r) => r.id)).toEqual(["G1"]);
  });

  test("keeps a row that is nearby but a different place", () => {
    // Deliberately placed ~5 METRES from Jinan, not 40 km: distance alone
    // would collapse the two, so what keeps this row is the name — and stating
    // that at zero distance is the only way the test says so. Do NOT "fix"
    // these coordinates to a realistic separation between a city and its
    // neighbouring district: that makes the test pass against a distance-only
    // implementation too, and it stops proving the name check exists.
    const rows = [
      scorable({ id: "G1", name: "Zhangqiu", country: "CN", lat: 36.6667, lon: 116.9833 }),
    ];
    expect(dropCatalogDuplicates(rows, [JINAN_QID]).map((r) => r.id)).toEqual(["G1"]);
  });

  test("folds the name before comparing, so punctuation and accents cannot hide a duplicate", () => {
    // 23 of the 695 catalog cities carry an apostrophe and 2 carry diacritics.
    // GeoNames spells them differently, and an unfolded compare would let both
    // spellings through as separate cities.
    const rows = [
      scorable({ id: "G1", name: "Xi'an", country: "CN", lat: 34.26, lon: 108.93 }),
      scorable({ id: "G2", name: "Ürümqi", country: "CN", lat: 43.8, lon: 87.6 }),
    ];
    const catalog = [
      { name: "Xian", lat: 34.26, lon: 108.93 },
      { name: "Urumqi", lat: 43.8, lon: 87.6 },
    ];
    expect(dropCatalogDuplicates(rows, catalog)).toEqual([]);
  });

  test("treats the radius as inclusive at its boundary and exclusive past it", () => {
    // One degree of latitude is 111.195 km, so 5/111.195 degrees is exactly
    // the radius. Stated as a computed offset rather than a magic literal so
    // the test says what it is testing.
    const degreesPerKm = 1 / 111.19492664455873;
    const atLimit = scorable({
      id: "G1",
      name: "Jinan",
      country: "CN",
      lat: JINAN_QID.lat + DEDUP_RADIUS_KM * degreesPerKm,
      lon: JINAN_QID.lon,
    });
    const pastLimit = scorable({
      id: "G2",
      name: "Jinan",
      country: "CN",
      lat: JINAN_QID.lat + DEDUP_RADIUS_KM * 1.2 * degreesPerKm,
      lon: JINAN_QID.lon,
    });
    expect(dropCatalogDuplicates([atLimit], [JINAN_QID])).toEqual([]);
    expect(dropCatalogDuplicates([pastLimit], [JINAN_QID]).map((r) => r.id)).toEqual(["G2"]);
  });

  test("is a no-op when there is nothing to dedup against", () => {
    // Every country but China: the QID catalog is all-China, so 245 of the 246
    // shards take this path.
    const rows = [scorable({ id: "G1", country: "PE" }), scorable({ id: "G2", country: "PE" })];
    expect(dropCatalogDuplicates(rows, []).map((r) => r.id)).toEqual(["G1", "G2"]);
  });

  test("preserves the input order of what it keeps", () => {
    // The caller hands it ranking order and expects ranking order back —
    // reordering here would silently change which 30 cities get enriched.
    const rows = [
      scorable({ id: "G3", name: "Gamma", country: "CN" }),
      scorable({ id: "G1", name: "Alpha", country: "CN" }),
      scorable({ id: "G2", name: "Beta", country: "CN" }),
    ];
    expect(dropCatalogDuplicates(rows, []).map((r) => r.id)).toEqual(["G3", "G1", "G2"]);
  });

  test("the radius is 5 km", () => {
    expect(DEDUP_RADIUS_KM).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: the module loads and the new tests fail on first use with `TypeError: dropCatalogDuplicates is not a function` — see Task 2 Step 2 for why this is a `TypeError` and not a collection-time `SyntaxError`. Summary: `Tests  8 failed | 29 passed (37)`.

- [ ] **Step 3: Write the minimal implementation**

  Add these two imports to the top of `scripts/ingest-cities.mjs`, directly under `import { inflateRawSync } from 'node:zlib';`:

```javascript
import { foldPlaceName } from '../lib/foldPlaceName.ts';
import { haversineKm } from '../lib/geo.ts';
```

  Then append, after `topPerCountry`:

```javascript
// ---------------------------------------------------------------------------
// Deduplication against the existing Wikidata catalog
// ---------------------------------------------------------------------------

/**
 * How close two records have to be to be the same city, given their names
 * already match. Cities are a few kilometres across and the two sources place
 * their centres differently — GeoNames puts Jinan at 36.66833/116.99722 and
 * Wikidata at 36.6667/116.9833, 1.2 km apart. 5 km covers that disagreement
 * without reaching the next town.
 */
export const DEDUP_RADIUS_KM = 5;

/**
 * The GeoNames rows that are NOT already in the Wikidata catalog.
 *
 * The 695 existing China cities keep their Wikidata QIDs so their descriptions,
 * images and interest tags survive and no trip data migrates — which means a
 * GeoNames row for the same place is a duplicate, and the QID record is the
 * richer one. Both halves of the test are needed: name alone collapses the two
 * distinct Peruvian Cuscos 1,400 km apart, and distance alone collapses a city
 * with its neighbouring district.
 *
 * Names fold through `foldPlaceName`, the same fold search uses, because the
 * two sources disagree about apostrophes and diacritics: 23 of the 695 catalog
 * names carry an apostrophe and 2 carry diacritics.
 *
 * Indexed by folded name so this is one pass rather than 695 x 750 haversines
 * per country, and stable: the kept rows come back in the order they arrived,
 * which is ranking order and is what decides who gets enriched.
 */
export function dropCatalogDuplicates(rows, catalogCities) {
  if (catalogCities.length === 0) return [...rows];
  const byName = new Map();
  for (const city of catalogCities) {
    const key = foldPlaceName(city.name);
    const list = byName.get(key);
    if (list) list.push(city);
    else byName.set(key, [city]);
  }
  return rows.filter((row) => {
    const twins = byName.get(foldPlaceName(row.name));
    if (!twins) return true;
    return !twins.some((twin) => haversineKm(row, twin) <= DEDUP_RADIUS_KM);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  37 passed (37)`.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
  git commit -m "feat: drop GeoNames rows that duplicate an existing Wikidata city"
  ```

---

## Task 4: `buildCities` — admin-1 names, display order, and the enrichment target list

**Files:**
- Modify: `scripts/ingest-cities.mjs` (append after `dropCatalogDuplicates`)
- Test: `scripts/ingest-cities.test.ts` (append)

**Interfaces:**
- Consumes: `parseGeoNamesRows`, `parseAdmin1Codes`, `topPerCountry`, `dropCatalogDuplicates`, `CITIES_PER_COUNTRY` (Tasks 1-3).
- Produces:
  - `export const ENRICH_PER_COUNTRY = 30`
  - `export function buildCities(rows, admin1Codes, catalogCities, perCountry = CITIES_PER_COUNTRY): { shards: Map<string, ShardRow[]>; targets: Map<string, string[]>; total: number }` — the fourth parameter exists only so a test can state the cut-before-dedup ordering with two rows instead of 751.
  - `ShardRow = { id: string; n: string; lat: number; lon: number; a1: string | null; p: number; tz: string }` — the exact 7-field record spec §2.2 measured, in **display order** (population descending, id ascending).
  - `targets` holds each country's top `ENRICH_PER_COUNTRY` ids in **ranking order**, which display order has thrown away.

Why `targets` exists: display order is population and ranking order is notability, and the two disagree — that disagreement is the whole design. Enrichment must follow notability (Zermatt earns a description; the 30th-largest Swiss town does not), so the ranking order has to survive into `scripts/enrich-cities.mjs` somehow. Re-deriving it there would mean a second 13 MB download in the same workflow, and carrying a `rank` field in the shard would break the 7-field record spec §2.2 sized. A 70 KB `data/cities-enrich-targets.json` — never served to a client — is the cheapest carrier.

- [ ] **Step 1: Write the failing test**

  Append to `scripts/ingest-cities.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// buildCities
// ---------------------------------------------------------------------------

import { ENRICH_PER_COUNTRY, buildCities } from "./ingest-cities.mjs";

const ADMIN1 = parseAdmin1Codes(
  ["CH.VS\tValais\tValais\t2658205", "PE.08\tCusco\tCusco\t3937483"].join("\n")
);

describe("buildCities", () => {
  test("emits the seven-field record with the admin-1 code resolved to a name", () => {
    const { shards } = buildCities(
      [scorable({ id: "G2657928", name: "Zermatt", country: "CH", admin1Code: "VS", lat: 46.01998, lon: 7.74863, population: 6_629, timezone: "Europe/Zurich" })],
      ADMIN1,
      []
    );
    expect(shards.get("CH")).toEqual([
      {
        id: "G2657928",
        n: "Zermatt",
        lat: 46.01998,
        lon: 7.74863,
        a1: "Valais",
        p: 6_629,
        tz: "Europe/Zurich",
      },
    ]);
  });

  test("leaves a1 null when the admin-1 code has no entry rather than shipping the raw code", () => {
    // 117 real rows have a blank admin1 column, and some codes have no row in
    // admin1CodesASCII.txt. `a1` becomes CatalogHit.province and is rendered to
    // the user — "22" is not a province of Japan, and null renders as nothing.
    const { shards } = buildCities(
      [scorable({ id: "G1", country: "CH", admin1Code: "ZZ" }), scorable({ id: "G2", country: "CH", admin1Code: "" })],
      ADMIN1,
      []
    );
    expect(shards.get("CH")!.map((r) => r.a1)).toEqual([null, null]);
  });

  test("sorts each shard by population descending, not by score", () => {
    // §3.2: ranking decides inclusion only. Dunkirk outranks Lyon on score
    // because wartime fame inflates alternate names; the user must never see
    // that.
    const dunkirk = scorable({ id: "G1", name: "Dunkirk", country: "FR", altNameCount: 40, population: 87_000 });
    const lyon = scorable({ id: "G2", name: "Lyon", country: "FR", altNameCount: 20, population: 522_000 });
    const { shards } = buildCities([dunkirk, lyon], ADMIN1, []);
    expect(shards.get("FR")!.map((r) => r.n)).toEqual(["Lyon", "Dunkirk"]);
  });

  test("breaks an equal-population display tie by id so a rebuild is byte-stable", () => {
    const { shards } = buildCities(
      [
        scorable({ id: "G9", country: "FR", population: 500 }),
        scorable({ id: "G2", country: "FR", population: 500 }),
      ],
      ADMIN1,
      []
    );
    expect(shards.get("FR")!.map((r) => r.id)).toEqual(["G2", "G9"]);
  });

  test("applies the per-country cut before deduplication, not after", () => {
    // Order matters: cutting after dedup would let a China shard backfill the
    // 337 slots the QID cities occupy with rank-751-and-below rows, quietly
    // handing China 750 GeoNames cities *plus* 695 QID ones.
    const rows = [
      scorable({ id: "G1", name: "Jinan", country: "CN", lat: 36.66833, lon: 116.99722, population: 4_335_989, altNameCount: 70 }),
      scorable({ id: "G2", name: "Elsewhere", country: "CN", population: 10 }),
    ];
    const { shards } = buildCities(rows, ADMIN1, [{ name: "Jinan", lat: 36.6667, lon: 116.9833 }], 1);
    // Rank 1 was Jinan and dedup removed it; rank 2 does not move up, so the
    // country produces no shard at all rather than a one-city one.
    expect(shards.has("CN")).toBe(false);
  });

  test("names the top thirty by RANK, not by population, as enrichment targets", () => {
    // The disagreement is the point: a photogenic village outranks a bigger
    // dull town on score, and it is the village whose description a traveller
    // wants at build time rather than after a lazy fetch.
    const village = scorable({ id: "G1", name: "Zermatt", country: "CH", altNameCount: 22, population: 6_629 });
    const town = scorable({ id: "G2", name: "Bulle", country: "CH", altNameCount: 3, population: 23_000 });
    const { shards, targets } = buildCities([village, town], ADMIN1, []);
    expect(shards.get("CH")!.map((r) => r.n)).toEqual(["Bulle", "Zermatt"]);
    expect(targets.get("CH")).toEqual(["G1", "G2"]);
  });

  test("caps the enrichment target list at thirty per country", () => {
    expect(ENRICH_PER_COUNTRY).toBe(30);
    const rows = Array.from({ length: 40 }, (_, i) =>
      scorable({ id: `G${100 + i}`, country: "CH", altNameCount: 40 - i })
    );
    expect(buildCities(rows, ADMIN1, []).targets.get("CH")).toHaveLength(30);
  });

  test("reports the total across every country", () => {
    const rows = [
      scorable({ id: "G1", country: "CH" }),
      scorable({ id: "G2", country: "PE" }),
      scorable({ id: "G3", country: "PE" }),
    ];
    const { total, shards } = buildCities(rows, ADMIN1, []);
    expect(total).toBe(3);
    expect([...shards.keys()].sort()).toEqual(["CH", "PE"]);
  });

  test("drops a country whose every row was deduplicated rather than emitting an empty shard", () => {
    // An empty shard is a file the client fetches, parses and learns nothing
    // from; absent from the index it is never requested.
    const { shards } = buildCities(
      [scorable({ id: "G1", name: "Jinan", country: "CN", lat: 36.6667, lon: 116.9833 })],
      ADMIN1,
      [{ name: "Jinan", lat: 36.6667, lon: 116.9833 }]
    );
    expect(shards.has("CN")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: the module loads and the new tests fail on first use with `TypeError: buildCities is not a function` — see Task 2 Step 2. Summary: `Tests  9 failed | 37 passed (46)`.

- [ ] **Step 3: Write the minimal implementation**

  Append to `scripts/ingest-cities.mjs`, after `dropCatalogDuplicates`:

```javascript
// ---------------------------------------------------------------------------
// Shard construction
// ---------------------------------------------------------------------------

/**
 * Cities per country that get a Wikipedia summary and image at build time.
 * Measured total across 246 countries: 6,244 — fewer than 246 x 30 because
 * most countries have fewer than 30 cities in cities500. Everything else is
 * enriched lazily on first selection.
 */
export const ENRICH_PER_COUNTRY = 30;

/**
 * The per-country shards, plus the enrichment target list ranking order would
 * otherwise throw away.
 *
 * Order of operations is load-bearing: cut to `perCountry` FIRST, dedup
 * SECOND. Reversing them lets China backfill the 337 slots its QID cities
 * occupy with rank-751-and-below rows — 750 GeoNames cities on top of 695
 * Wikidata ones, which is not what "top 750 per country" means.
 *
 * `shards` are in display order (population descending) because §3.2 says the
 * score decides inclusion only and must never surface in the UI. `targets` are
 * in ranking order because notability, not size, is what makes a description
 * worth fetching ahead of time.
 */
export function buildCities(rows, admin1Codes, catalogCities, perCountry = CITIES_PER_COUNTRY) {
  const ranked = topPerCountry(rows, perCountry);
  const shards = new Map();
  const targets = new Map();
  let total = 0;
  for (const country of [...ranked.keys()].sort()) {
    const kept = dropCatalogDuplicates(ranked.get(country), catalogCities);
    // An empty shard is a file the client would fetch and learn nothing from.
    if (kept.length === 0) continue;
    targets.set(country, kept.slice(0, ENRICH_PER_COUNTRY).map((row) => row.id));
    const display = [...kept].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id));
    shards.set(
      country,
      display.map((row) => ({
        id: row.id,
        n: row.name,
        lat: row.lat,
        lon: row.lon,
        // `?? null`, not `?? row.admin1Code`: this value is rendered to the
        // user as a province, and "22" is not a province of Japan. A Map
        // lookup, so a code spelled "constructor" cannot resolve to a function.
        a1: admin1Codes.get(`${country}.${row.admin1Code}`) ?? null,
        p: row.population,
        tz: row.timezone,
      }))
    );
    total += display.length;
  }
  return { shards, targets, total };
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  46 passed (46)`.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
  git commit -m "feat: build per-country city shards with resolved admin-1 names"
  ```

---

## Task 5: `assertSane` — the gate between a corrupt feed and an unattended deploy

**Files:**
- Modify: `scripts/ingest-cities.mjs` (append after `buildCities`)
- Test: `scripts/ingest-cities.test.ts` (append)

**Interfaces:**
- Consumes: `buildCities`'s `shards` map (Task 4); `parseAdmin1Codes`'s map (Task 1).
- Produces:
  - `export const EXPECTED_COUNTRIES = 246`
  - `export const REQUIRED_COUNTRY_CODES: readonly string[]` — `['IO', 'TK']`
  - `export const REQUIRED_CITIES: { country: string; id: string; name: string }[]`
  - `export const REQUIRED_DEDUPED: { country: string; id: string; name: string; qid: string }[]`
  - `export function assertSane(shards: Map<string, ShardRow[]>, previous: { countries: { code: string; count: number }[] } | null): void` — throws, never returns a value.
  - `export function assertAdmin1Sane(admin1Codes: Map<string, string>): void` — throws, never returns a value. A separate function rather than a third parameter on `assertSane`, so `assertSane` keeps one signature everywhere and `main()` can gate the second network source **before** `buildCities` consumes it.

This is the only gate that stands between GeoNames' nightly rebuild and a Vercel deploy nobody looked at. The workflow commits whatever this lets through.

- [ ] **Step 1: Write the failing test**

  Append to `scripts/ingest-cities.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// assertSane
// ---------------------------------------------------------------------------

import {
  EXPECTED_COUNTRIES,
  REQUIRED_CITIES,
  REQUIRED_COUNTRY_CODES,
  REQUIRED_DEDUPED,
  assertAdmin1Sane,
  assertSane,
} from "./ingest-cities.mjs";

interface ShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  a1: string | null;
  p: number;
  tz: string;
}

/** A shard row that passes every per-record check, so a test can break one. */
function shardRow(over: Partial<ShardRow> & Pick<ShardRow, "id">): ShardRow {
  return { n: `City ${over.id}`, lat: 10, lon: 20, a1: null, p: 1_000, tz: "UTC", ...over };
}

/** Synthetic two-letter codes, AA, AB, AC … — a deterministic filler alphabet. */
function syntheticCountryCode(i: number): string {
  const a = "A".charCodeAt(0);
  return String.fromCharCode(a + (Math.floor(i / 26) % 26), a + (i % 26));
}

/**
 * A shard set shaped like the real one, so each test below reaches the gate it
 * is actually aiming at.
 *
 * The countries `assertSane` names — the three destination fixtures' countries
 * and the two territories that only `cities500` has — are seeded FIRST, and the
 * synthetic alphabet then fills up to exactly `countries` shards. Seeding them
 * afterwards instead would return `countries` plus however many of them the
 * synthetic range happened to miss (PE, JP and TK all fall outside AA..JL), and
 * `assertSane` compares `shards.size` against 246 exactly rather than against a
 * floor — so an off-by-two fixture would make every test here read the wrong
 * gate.
 *
 * Fixture invariant (spec §6): every required city is in the shard its country
 * names, or these tests are green and hollow.
 */
function saneShards(options: { countries?: number; perCountry?: number } = {}) {
  const countries = options.countries ?? EXPECTED_COUNTRIES;
  const perCountry = options.perCountry ?? 300;
  const shards = new Map<string, ShardRow[]>();
  let seed = 1;
  const filler = () => {
    const base = seed++ * 100_000;
    return Array.from({ length: perCountry }, (_, i) =>
      shardRow({ id: `G${base + i + 1}`, p: perCountry - i })
    );
  };

  for (const code of REQUIRED_COUNTRY_CODES) shards.set(code, filler());
  for (const required of REQUIRED_CITIES) {
    shards.set(required.country, [
      shardRow({ id: required.id, n: required.name, p: 10_000_000 }),
      ...filler(),
    ]);
  }
  for (let c = 0; shards.size < countries; c++) {
    const code = syntheticCountryCode(c);
    if (!shards.has(code)) shards.set(code, filler());
  }
  return shards;
}

/** admin1CodesASCII.txt yields 3,865 entries; anything near that passes. */
function saneAdmin1(size = 3_865): Map<string, string> {
  const codes = new Map<string, string>();
  for (let i = 0; i < size; i++) codes.set(`XX.${i}`, `Region ${i}`);
  return codes;
}

function previousIndex(shards: Map<string, ShardRow[]>) {
  return { countries: [...shards].map(([code, list]) => ({ code, count: list.length })) };
}

describe("assertSane", () => {
  test("passes a shard set shaped like the real one", () => {
    expect(() => assertSane(saneShards(), null)).not.toThrow();
  });

  test("names the four known destinations the design was validated against", () => {
    // Cusco, Zermatt and Kyoto must be IN a shard; Jinan must be OUT of one,
    // because it is deduped in favour of Wikidata's Q170247. Both directions
    // are fixtures, and stating them here is what stops the list drifting.
    expect(REQUIRED_CITIES.map((c) => c.name).sort()).toEqual(["Cusco", "Kyoto", "Zermatt"]);
    expect(REQUIRED_DEDUPED).toEqual([
      { country: "CN", id: "G1805753", name: "Jinan", qid: "Q170247" },
    ]);
  });

  test("aborts when a known destination drops out of its shard", () => {
    const shards = saneShards();
    shards.set(
      "PE",
      shards.get("PE")!.filter((r) => r.id !== "G3941584")
    );
    expect(() => assertSane(shards, null)).toThrow(/Cusco \(G3941584\) is missing from the PE shard/);
  });

  test("aborts when a deduplicated city reappears", () => {
    // If dedup silently stops working, Jinan comes back as G1805753 alongside
    // Q170247 and the map draws two Jinans a kilometre apart.
    const shards = saneShards();
    shards.set("CN", [shardRow({ id: "G1805753", n: "Jinan" }), ...shards.get("CN")!]);
    expect(() => assertSane(shards, null)).toThrow(/Jinan \(G1805753\) is in the CN shard/);
  });

  test("aborts when the country count moves off 246", () => {
    // Spec §2.2: the gate's count assertion is 246 exactly, with a tolerance of
    // 2 for a territory GeoNames adds or retires — not a floor. A floor cannot
    // catch a FIRST run, and `previous` is null exactly then.
    expect(() => assertSane(saneShards({ countries: 200 }), null)).toThrow(
      /200 countries produced a shard, expected 246/
    );
    expect(() => assertSane(saneShards({ countries: 300 }), null)).toThrow(
      /300 countries produced a shard, expected 246/
    );
  });

  test("accepts one territory appearing or disappearing, but not three", () => {
    expect(() => assertSane(saneShards({ countries: 247 }), null)).not.toThrow();
    expect(() => assertSane(saneShards({ countries: 244 }), null)).not.toThrow();
    expect(() => assertSane(saneShards({ countries: 243 }), null)).toThrow(/expected 246/);
  });

  test("aborts when a country only cities500 has is missing, whatever the total", () => {
    // The check that actually tells the two dumps apart. cities15000 has 244
    // countries, which is INSIDE the +/-2 tolerance above — so a run that
    // fetched the wrong dump would pass the count and fail here instead. IO
    // (2 cities) and TK (3) are the two cities500 adds.
    expect(REQUIRED_COUNTRY_CODES).toEqual(["IO", "TK"]);
    for (const code of REQUIRED_COUNTRY_CODES) {
      const shards = saneShards();
      shards.delete(code);
      shards.set("ZZ", [shardRow({ id: "G424242" })]); // keep the total on 246
      expect(() => assertSane(shards, null)).toThrow(
        new RegExp(`${code} has no shard`)
      );
    }
  });

  test("aborts when the total city count falls below the floor", () => {
    expect(() => assertSane(saneShards({ perCountry: 10 }), null)).toThrow(
      /passed the filter, expected at least/
    );
  });

  test("aborts when a country present in the previous run has disappeared", () => {
    // §6 names this explicitly. A country that vanishes takes its whole
    // drill-down with it, and the total can stay inside the 10% band while it
    // happens — so the count checks cannot catch this on their own.
    const before = saneShards();
    const after = saneShards();
    after.delete("AB");
    expect(() => assertSane(after, previousIndex(before))).toThrow(
      /1 country present last run is gone: AB/
    );
  });

  test("accepts a country that is newly present", () => {
    // Coverage may only grow: cities500 added IO and TK over cities15000.
    const before = saneShards();
    const after = saneShards();
    after.set("ZZ", [shardRow({ id: "G999999" })]);
    expect(() => assertSane(after, previousIndex(before))).not.toThrow();
  });

  test("aborts when the total shrinks more than the limit", () => {
    const before = saneShards({ perCountry: 300 });
    const after = saneShards({ perCountry: 260 });
    expect(() => assertSane(after, previousIndex(before))).toThrow(/city count fell/);
  });

  test("aborts when the total grows more than the limit", () => {
    const before = saneShards({ perCountry: 260 });
    const after = saneShards({ perCountry: 300 });
    expect(() => assertSane(after, previousIndex(before))).toThrow(/city count rose/);
  });

  test("accepts drift inside the limit", () => {
    const before = saneShards({ perCountry: 300 });
    const after = saneShards({ perCountry: 290 });
    expect(() => assertSane(after, previousIndex(before))).not.toThrow();
  });

  test("aborts on a duplicate id inside one shard", () => {
    const shards = saneShards();
    shards.get("PE")!.push(shardRow({ id: "G3941584" }));
    expect(() => assertSane(shards, null)).toThrow(/duplicate city id G3941584 in PE/);
  });

  test("aborts on an id that is not a GeoNames id", () => {
    // A bare integer or a Q-id here would merge two namespaces silently, which
    // §3.3 calls out as a real bug: MapExplorer.togglePlace resolves taps by
    // matching this field against the catalog's Wikidata QIDs.
    const shards = saneShards();
    shards.get("PE")![0] = shardRow({ id: "Q170247" });
    expect(() => assertSane(shards, null)).toThrow(/malformed city id "Q170247"/);
    const numeric = saneShards();
    numeric.get("PE")![0] = shardRow({ id: "3941584" });
    expect(() => assertSane(numeric, null)).toThrow(/malformed city id "3941584"/);
  });

  test("aborts on an out-of-range coordinate", () => {
    // Finite is not plausible: lat 394.5 is finite, and haversine's trig is
    // periodic, so it silently behaves as 34.5 — the city relocates to a
    // believable wrong place rather than erroring.
    const lat = saneShards();
    lat.get("PE")![0] = shardRow({ id: "G3941584", lat: 394.5 });
    expect(() => assertSane(lat, null)).toThrow(/out-of-range latitude/);
    const lon = saneShards();
    lon.get("PE")![0] = shardRow({ id: "G3941584", lon: -200 });
    expect(() => assertSane(lon, null)).toThrow(/out-of-range longitude/);
  });

  test("accepts the coordinate extremes", () => {
    const shards = saneShards();
    shards.get("PE")![1] = shardRow({ id: "G777", lat: -90, lon: 180 });
    expect(() => assertSane(shards, null)).not.toThrow();
  });

  test("aborts on an empty name", () => {
    const shards = saneShards();
    shards.get("PE")![1] = shardRow({ id: "G777", n: "  " });
    expect(() => assertSane(shards, null)).toThrow(/G777 has an empty name/);
  });

  test("aborts on a negative or non-finite population", () => {
    const shards = saneShards();
    shards.get("PE")![1] = shardRow({ id: "G777", p: Number.NaN });
    expect(() => assertSane(shards, null)).toThrow(/G777 has a non-finite or negative population/);
  });

  test("aborts on a malformed country code", () => {
    const shards = saneShards();
    shards.set("PER", [shardRow({ id: "G777" })]);
    expect(() => assertSane(shards, null)).toThrow(/malformed country code "PER"/);
  });

  test("aborts when a shard exceeds the per-country cut", () => {
    const shards = saneShards();
    shards.set(
      "PE",
      Array.from({ length: 800 }, (_, i) => shardRow({ id: `G${900_000 + i}`, p: 800 - i }))
    );
    expect(() => assertSane(shards, null)).toThrow(/PE has 800 cities, over the 750 limit/);
  });

  test("aborts when a shard is not in descending population order", () => {
    // Display order is a promise the UI relies on rather than re-sorting, and
    // a shard that quietly stops honouring it looks like a ranking bug in the
    // browser instead of a build bug here.
    const shards = saneShards();
    shards.set("PE", [
      shardRow({ id: "G3941584", n: "Cusco", p: 5 }),
      shardRow({ id: "G777", p: 900 }),
    ]);
    expect(() => assertSane(shards, null)).toThrow(/PE is not in descending population order/);
  });
});

describe("assertAdmin1Sane", () => {
  test("accepts the real file's shape", () => {
    expect(() => assertAdmin1Sane(saneAdmin1())).not.toThrow();
  });

  test("aborts when admin1CodesASCII.txt reshapes into almost nothing", () => {
    // The second network source this ingest grew, and the only one no other
    // check covers. A reshaped file parses to a near-empty Map, every `a1`
    // silently becomes null, and 59,073 cities lose their province label —
    // which no count, coordinate or fixture check would notice, because the
    // shards are otherwise perfect. The daily job then commits and deploys it.
    expect(() => assertAdmin1Sane(saneAdmin1(0))).toThrow(/only 0 admin-1 names/);
    expect(() => assertAdmin1Sane(saneAdmin1(1_200))).toThrow(/expected about 3,865/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: the module loads and the new tests fail on first use with `TypeError: assertSane is not a function` (and `REQUIRED_COUNTRY_CODES` / `REQUIRED_CITIES` read as `undefined`, so `saneShards`'s loops throw too) — see Task 2 Step 2. Summary: `Tests  24 failed | 46 passed (70)`.

- [ ] **Step 3: Write the minimal implementation**

  Append to `scripts/ingest-cities.mjs`, after `buildCities`:

```javascript
// ---------------------------------------------------------------------------
// The build gate
// ---------------------------------------------------------------------------

/**
 * Measured 2026-08-25: 246 countries, 59,073 cities.
 *
 * The country count is an EXACT expectation with a small tolerance, not a
 * floor. Spec §2.2 requires it: cities500 has 246 countries — the 244 in
 * cities15000 plus IO (British Indian Ocean Territory, 2 cities) and TK
 * (Tokelau, 3). A floor of 240 would let a first run write 241 countries and
 * then baseline every later run against 241, and `previous` is null exactly on
 * that first run, so the "a country is gone" check below cannot cover for it.
 *
 * The tolerance is for a territory GeoNames genuinely adds or retires, and
 * moving it means re-measuring. Note that 244 — cities15000's count — sits
 * INSIDE the tolerance, which is why `REQUIRED_COUNTRY_CODES` exists.
 */
export const EXPECTED_COUNTRIES = 246;
const COUNTRY_TOLERANCE = 2;
/**
 * The two countries cities500 has and cities15000 does not. Their absence
 * means the wrong dump was fetched — a failure the count check cannot see,
 * because 244 is within tolerance of 246.
 */
export const REQUIRED_COUNTRY_CODES = ['IO', 'TK'];
const MIN_EXPECTED_CITIES = 50_000;
const MAX_SHRINK_RATIO = 0.10;
const MAX_GROWTH_RATIO = 0.10;
/** Measured: admin1CodesASCII.txt parses to 3,865 entries. */
const EXPECTED_ADMIN1_NAMES = 3_865;
const MIN_ADMIN1_NAMES = 3_000;

/**
 * Cities the design was validated against, by geonameid rather than by name.
 *
 * By id because names are not unique: Peru has two cities called Cusco —
 * G3941584 (population 428,450, rank 2) and G3697554 (population 0, 1,400 km
 * north) — and a name-keyed fixture would pass on the wrong one.
 */
export const REQUIRED_CITIES = [
  { country: 'PE', id: 'G3941584', name: 'Cusco' },
  { country: 'CH', id: 'G2657928', name: 'Zermatt' },
  { country: 'JP', id: 'G1857910', name: 'Kyoto' },
];

/**
 * The other direction of the same fixture: cities that must NOT be in a shard
 * because an existing Wikidata record already covers them.
 *
 * Jinan is the case. GeoNames' G1805753 sits 1.2 km from the catalog's
 * Q170247, so dedup drops it and the app keeps the record with a description,
 * an image and interest tags. If dedup silently stops working, Jinan does not
 * disappear — it doubles, and the map draws two of it a kilometre apart, which
 * no count check would ever notice.
 */
export const REQUIRED_DEDUPED = [
  { country: 'CN', id: 'G1805753', name: 'Jinan', qid: 'Q170247' },
];

/**
 * Everything a corrupt or reshaped upstream feed could slip through
 * unattended, checked BEFORE anything is written.
 *
 * `scripts/ingest-destinations.mjs` writes its outputs even when checks fail,
 * so they can be inspected. That is the wrong choice here for the same reason
 * it is wrong in ingest-airports.mjs: a workflow commits what this writes and
 * Vercel deploys the commit. A corrupt city catalog is not useful for
 * inspection, it is a production incident.
 */
export function assertSane(shards, previous) {
  if (Math.abs(shards.size - EXPECTED_COUNTRIES) > COUNTRY_TOLERANCE) {
    throw new Error(
      `${shards.size} countries produced a shard, expected ${EXPECTED_COUNTRIES} ` +
      `(+/-${COUNTRY_TOLERANCE}) — the dump's country set has reshaped`
    );
  }
  for (const code of REQUIRED_COUNTRY_CODES) {
    if (!shards.has(code)) {
      throw new Error(
        `${code} has no shard — it is one of the two countries cities500 has and ` +
        `cities15000 does not, so its absence means the wrong dump was fetched. ` +
        `The count check cannot catch this: 244 is inside the tolerance around ${EXPECTED_COUNTRIES}.`
      );
    }
  }

  let total = 0;
  for (const [country, cities] of shards) {
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new Error(
        `malformed country code "${country}" — expected two uppercase letters ` +
        `(the dump's iso_country may have switched to alpha-3)`
      );
    }
    if (cities.length > CITIES_PER_COUNTRY) {
      throw new Error(
        `${country} has ${cities.length} cities, over the ${CITIES_PER_COUNTRY} limit — ` +
        `the per-country cut did not run`
      );
    }
    const seen = new Set();
    let previousPopulation = Infinity;
    for (const city of cities) {
      if (!/^G[1-9][0-9]*$/.test(city.id)) {
        throw new Error(
          `${country} has a malformed city id "${city.id}" — expected "G" + geonameid. ` +
          `A bare integer or a Q-id here merges the GeoNames and Wikidata namespaces, ` +
          `which is how a tap resolves to the wrong city.`
        );
      }
      if (seen.has(city.id)) throw new Error(`duplicate city id ${city.id} in ${country}`);
      seen.add(city.id);
      if (city.n.trim() === '') throw new Error(`${country} city ${city.id} has an empty name`);
      if (!Number.isFinite(city.lat) || city.lat < -90 || city.lat > 90) {
        throw new Error(
          `${country} city ${city.id} has an out-of-range latitude ${city.lat} — expected -90..90`
        );
      }
      if (!Number.isFinite(city.lon) || city.lon < -180 || city.lon > 180) {
        throw new Error(
          `${country} city ${city.id} has an out-of-range longitude ${city.lon} — expected -180..180`
        );
      }
      if (!Number.isFinite(city.p) || city.p < 0) {
        throw new Error(`${country} city ${city.id} has a non-finite or negative population ${city.p}`);
      }
      if (city.p > previousPopulation) {
        throw new Error(
          `${country} is not in descending population order — display order is what the UI ` +
          `renders without re-sorting, so a shard that loses it looks like a browser bug`
        );
      }
      previousPopulation = city.p;
    }
    total += cities.length;
  }

  if (total < MIN_EXPECTED_CITIES) {
    throw new Error(
      `only ${total} cities passed the filter, expected at least ${MIN_EXPECTED_CITIES}`
    );
  }

  for (const required of REQUIRED_CITIES) {
    const cities = shards.get(required.country) ?? [];
    if (!cities.some((city) => city.id === required.id)) {
      throw new Error(
        `${required.name} (${required.id}) is missing from the ${required.country} shard — ` +
        `the ranking no longer reaches the destinations this design was validated against`
      );
    }
  }
  for (const required of REQUIRED_DEDUPED) {
    const cities = shards.get(required.country) ?? [];
    if (cities.some((city) => city.id === required.id)) {
      throw new Error(
        `${required.name} (${required.id}) is in the ${required.country} shard but ${required.qid} ` +
        `already covers it — deduplication did not run, and the map will draw it twice`
      );
    }
  }

  if (!previous) return;

  const gone = previous.countries
    .map((entry) => entry.code)
    .filter((code) => !shards.has(code))
    .sort();
  if (gone.length > 0) {
    throw new Error(
      `${gone.length} country present last run is gone: ${gone.join(', ')} — ` +
      `a country that disappears takes its whole drill-down with it, and the total ` +
      `can stay inside the drift band while it happens`
    );
  }

  const before = previous.countries.reduce((sum, entry) => sum + entry.count, 0);
  if (before > 0) {
    const shrink = (before - total) / before;
    if (shrink > MAX_SHRINK_RATIO) {
      throw new Error(
        `city count fell ${(shrink * 100).toFixed(1)}% (${before} -> ${total}), ` +
        `over the ${MAX_SHRINK_RATIO * 100}% limit — upstream may be mid-rebuild`
      );
    }
    const growth = (total - before) / before;
    if (growth > MAX_GROWTH_RATIO) {
      throw new Error(
        `city count rose ${(growth * 100).toFixed(1)}% (${before} -> ${total}), ` +
        `over the ${MAX_GROWTH_RATIO * 100}% limit — upstream may have changed its filter`
      );
    }
  }
}

/**
 * The gate for the SECOND network source, checked before `buildCities` reads it.
 *
 * `admin1CodesASCII.txt` is not one of spec §3.1's six ingest steps — this plan
 * added it so `a1` reaches the user as "Valais" rather than "VS" — and nothing
 * else here would notice it going wrong. If the fetch succeeds but the file has
 * reshaped, `parseAdmin1Codes` returns a near-empty Map, every `a1` becomes
 * null, and all 59,073 cities quietly lose their province label while every
 * count, coordinate and fixture check still passes. The daily job then commits
 * that and Vercel deploys it.
 *
 * Separate from `assertSane` rather than a third parameter on it, so
 * `assertSane` keeps one signature everywhere and this can run earlier, before
 * `buildCities` has consumed the map.
 */
export function assertAdmin1Sane(admin1Codes) {
  if (admin1Codes.size < MIN_ADMIN1_NAMES) {
    throw new Error(
      `only ${admin1Codes.size} admin-1 names parsed, expected about ` +
      `${EXPECTED_ADMIN1_NAMES.toLocaleString('en-US')} — admin1CodesASCII.txt has reshaped, ` +
      `and every province label on every city would be null`
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  70 passed (70)`.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts
  git commit -m "feat: abort the city ingest before writing when the feed reshapes"
  ```

---

## Task 6: Emission — shards, indexes, report, `main()`, and the first real run

**Files:**
- Modify: `scripts/ingest-cities.mjs` (append after `assertSane`)
- Generated: `public/cities/*.json` (246 shards + `index.json`), `data/cities-index.json`, `data/cities-enrich-targets.json`, `data/cities-report.md`
- Test: `scripts/ingest-cities.test.ts` (append — `shardPayload` only; `main()` is never invoked by a test)

**Interfaces:**
- Consumes: `buildCities`, `assertSane`, `assertAdmin1Sane`, `CITIES_PER_COUNTRY`, `ENRICH_PER_COUNTRY`.
- Produces:
  - `export function shardPayload(country, cities, previous, now): { country: string; generatedAt: string; source: string; cities: ShardRow[] }` — pure, so the per-shard idempotency rule is testable without touching disk.
  - `export function stampedPayload(previous, body, now): object` — the same preserve-when-unchanged rule applied to the three run-level index files, which is what makes the workflow's commit guard able to fire at all.
  - `main()` behind the entry-point guard. Not exported.

Artifact shapes this task fixes for every later task:

```jsonc
// public/cities/PE.json   (compact, ~84.7 KB raw / 19.4 KB gzipped, 750 rows)
{"country":"PE","generatedAt":"2026-08-25T…","source":"GeoNames cities500 (CC BY 4.0)",
 "cities":[{"id":"G3936456","n":"Lima","lat":-12.04318,"lon":-77.02824,"a1":"Lima region","p":7737002,"tz":"America/Lima"}, …]}

// public/cities/index.json   (indent 1, ~25 KB — the only file whose diff is read by a human)
{"generatedAt":"…","source":"GeoNames cities500 (CC BY 4.0)",
 "countries":[{"code":"AD","count":24,"generatedAt":"…"}, …]}

// data/cities-index.json   (compact, 3,672,345 bytes, JSON.parse 22 ms — bundled, never fetched)
{"generatedAt":"…","source":"…","cities":[["G3936456","Lima","PE",-12.04318,-77.02824,"Lima region"], …]}

// data/cities-enrich-targets.json   (compact, ~70 KB — read by scripts/enrich-cities.mjs, never shipped)
{"generatedAt":"…","targets":{"PE":["G3936456", …30 ids in RANKING order], …}}
```

- [ ] **Step 1: Write the failing test**

  Append to `scripts/ingest-cities.test.ts`:

```typescript
// ---------------------------------------------------------------------------
// shardPayload
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { shardPayload, stampedPayload } from "./ingest-cities.mjs";

describe("shardPayload", () => {
  const cities = [shardRow({ id: "G1", p: 900 }), shardRow({ id: "G2", p: 100 })];

  test("stamps a fresh timestamp when there is no previous shard", () => {
    const payload = shardPayload("PE", cities, null, "2026-08-25T00:00:00.000Z");
    expect(payload).toEqual({
      country: "PE",
      generatedAt: "2026-08-25T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities,
    });
  });

  test("preserves the previous timestamp when the rows are identical", () => {
    // Idempotency lives here rather than in the workflow: 246 shards totalling
    // 6.5 MB are committed, and rewriting all of them nightly for a timestamp
    // would bloat the repo. Only the countries that actually moved appear as
    // changed, so the workflow's `git status --porcelain` guard sees a clean
    // tree on a quiet day.
    const previous = {
      country: "PE",
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities,
    };
    expect(shardPayload("PE", cities, previous, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });

  test("takes the fresh timestamp when a single field moved", () => {
    const previous = {
      country: "PE",
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "GeoNames cities500 (CC BY 4.0)",
      cities: [shardRow({ id: "G1", p: 901 }), shardRow({ id: "G2", p: 100 })],
    };
    expect(shardPayload("PE", cities, previous, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-25T00:00:00.000Z"
    );
  });

  test("compares only the rows, never the envelope", () => {
    // Comparing the whole previous object would make the timestamp compare
    // against itself and never match.
    const previous = {
      country: "PE",
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: "something else entirely",
      cities,
    };
    expect(shardPayload("PE", cities, previous, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-01T00:00:00.000Z"
    );
  });
});

// ---------------------------------------------------------------------------
// stampedPayload — the same rule for the three run-level index files
// ---------------------------------------------------------------------------

describe("stampedPayload", () => {
  const body = { source: "GeoNames cities500 (CC BY 4.0)", countries: [{ code: "PE", count: 2 }] };

  test("preserves the previous timestamp when the payload is identical", () => {
    // This is what makes `refresh-cities.yml`'s commit guard able to fire at
    // all. public/cities/index.json, data/cities-index.json and
    // data/cities-enrich-targets.json are all inside the guard's paths; if any
    // of them carries `new Date()` unconditionally, `git status` is never
    // clean, the guard's short-circuit is dead code, and 3.7 MB is committed
    // and auto-deployed to production every night for no data change.
    const previous = { generatedAt: "2026-08-01T00:00:00.000Z", ...body };
    const stamped = stampedPayload(previous, body, "2026-08-25T00:00:00.000Z");
    expect(stamped.generatedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(JSON.stringify(stamped)).toBe(JSON.stringify(previous));
  });

  test("takes the fresh timestamp when any part of the payload moved", () => {
    const previous = {
      generatedAt: "2026-08-01T00:00:00.000Z",
      source: body.source,
      countries: [{ code: "PE", count: 3 }],
    };
    expect(stampedPayload(previous, body, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-25T00:00:00.000Z"
    );
  });

  test("stamps fresh when there is no previous file, or it was unreadable", () => {
    // `readJson` answers null for both a missing file and a parse failure.
    expect(stampedPayload(null, body, "2026-08-25T00:00:00.000Z").generatedAt).toBe(
      "2026-08-25T00:00:00.000Z"
    );
  });

  test("puts generatedAt first, so a human diff of index.json reads the same way", () => {
    expect(Object.keys(stampedPayload(null, body, "x"))).toEqual([
      "generatedAt",
      "source",
      "countries",
    ]);
  });
});

// ---------------------------------------------------------------------------
// main()'s ordering
// ---------------------------------------------------------------------------

describe("main()'s ordering", () => {
  const source = readFileSync(new URL("./ingest-cities.mjs", import.meta.url), "utf8");

  test("calls assertSane before it writes anything", () => {
    // `main()` is not invoked here — importing this module must never refetch
    // 13.5 MB — so the ordering is read out of the source. Crude, and the only
    // thing standing between "assertSane throws" (proved twenty-four times
    // above) and "assertSane gates the deploy", which is the property that
    // matters: the workflow commits whatever reaches disk and Vercel deploys
    // the commit.
    const gate = source.indexOf("assertSane(shards, previousIndex)");
    const firstWrite = source.indexOf("writeFileAtomic(path,");
    expect(gate).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(firstWrite);
  });

  test("gates the admin-1 names before buildCities consumes them", () => {
    const gate = source.indexOf("assertAdmin1Sane(admin1Codes)");
    const use = source.indexOf("buildCities(rows, admin1Codes, catalogCities)");
    expect(gate).toBeGreaterThan(-1);
    expect(use).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(use);
  });

  test("exits non-zero when main() rejects, so the workflow does not commit", () => {
    expect(source).toMatch(/main\(\)\.catch\([\s\S]*process\.exit\(1\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: the module loads and the new tests fail on first use with `TypeError: shardPayload is not a function` (and `stampedPayload is not a function`) — see Task 2 Step 2. The three `main()`-ordering tests fail on `expect(gate).toBeGreaterThan(-1)`, because none of those strings is in the file yet. Summary: `Tests  11 failed | 70 passed (81)`.

- [ ] **Step 3: Write the minimal implementation**

  First, extend the import block at the top of `scripts/ingest-cities.mjs` so it reads exactly:

```javascript
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { foldPlaceName } from '../lib/foldPlaceName.ts';
import { haversineKm } from '../lib/geo.ts';
```

  Then append the rest of the file, after `assertSane`:

```javascript
// ---------------------------------------------------------------------------
// Paths, sources, network
// ---------------------------------------------------------------------------

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT_DIR, 'data');
const SHARD_DIR = join(ROOT_DIR, 'public', 'cities');
const CATALOG_PATH = join(DATA_DIR, 'catalog.json');
const SHARD_INDEX_PATH = join(SHARD_DIR, 'index.json');
const CITY_INDEX_PATH = join(DATA_DIR, 'cities-index.json');
const ENRICH_TARGETS_PATH = join(DATA_DIR, 'cities-enrich-targets.json');
const REPORT_PATH = join(DATA_DIR, 'cities-report.md');

const CITIES_URL = 'https://download.geonames.org/export/dump/cities500.zip';
const CITIES_MEMBER = 'cities500.txt';
const ADMIN1_URL = 'https://download.geonames.org/export/dump/admin1CodesASCII.txt';
/**
 * CC BY 4.0, not public domain — unlike OurAirports and Natural Earth. The
 * credit has to be visible in the UI as well as here; see
 * components/plan/GeoNamesCredit.tsx.
 */
const SOURCE_LICENSE = 'GeoNames cities500 (CC BY 4.0)';
const SOURCE_ATTRIBUTION = 'https://www.geonames.org/ — CC BY 4.0';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';

/** 13.5 MB over a CI network. Airports' 120s is not enough headroom for it. */
const FETCH_TIMEOUT_MS = 300_000;
const RETRY_DELAYS_MS = [2_000, 8_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One retrying fetch for both sources, returning bytes or text.
 *
 * Global `fetch` plus `AbortSignal.timeout`, the same shape as
 * ingest-airports.mjs — no node-fetch, no undici import, nothing from
 * node_modules at all, which is what lets the workflow skip `npm ci`.
 */
async function fetchSource(url, { binary }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delay}ms (${error.message})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    rmSync(path, { force: true }); // Windows rename does not overwrite reliably
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null; // an unreadable previous artifact is the same as none
  }
}

/**
 * One shard's file contents, with its timestamp preserved when nothing moved.
 *
 * Per shard rather than per run, because the run writes 246 files totalling
 * 6.5 MB and the workflow commits them. Stamping a fresh timestamp on all of
 * them every night would put 6.5 MB of pure noise into the repository daily;
 * this way only the countries whose 750 rows actually changed appear in
 * `git diff`.
 *
 * Only the rows are compared, never the envelope — comparing the whole object
 * would compare the timestamp against itself and never match.
 */
export function shardPayload(country, cities, previous, now) {
  const unchanged = previous !== null && JSON.stringify(previous.cities) === JSON.stringify(cities);
  return {
    country,
    generatedAt: unchanged ? previous.generatedAt : now,
    source: SOURCE_LICENSE,
    cities,
  };
}

/**
 * The same preserve-when-unchanged rule for the three run-level index files.
 *
 * `shardPayload` covers the 246 shards and nothing else, and all three of
 * `public/cities/index.json`, `data/cities-index.json` and
 * `data/cities-enrich-targets.json` sit inside `refresh-cities.yml`'s
 * commit-guard paths. Stamping `new Date()` on them unconditionally makes that
 * guard impossible to satisfy: it turns a commit-on-change job into a
 * commit-every-day job, and every commit is a production deploy plus a CI run.
 *
 * Compared on the PAYLOAD, never on the envelope — comparing the whole previous
 * object would compare the timestamp against itself and never match.
 *
 * `generatedAt` is spread first so the emitted key order matches what the
 * previous file had, which is what keeps the byte comparison above meaningful
 * and keeps index.json's diff readable.
 */
export function stampedPayload(previous, body, now) {
  const unchanged =
    previous !== null &&
    JSON.stringify({ ...previous, generatedAt: undefined }) ===
      JSON.stringify({ ...body, generatedAt: undefined });
  return { generatedAt: unchanged ? previous.generatedAt : now, ...body };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * The report describes the CATALOG, never the run.
 *
 * No "N shards changed this run" line, deliberately: that number is 246 on a
 * first run and 0 on a quiet one, which would make this file differ every time
 * the previous run's numbers differed — and this file is committed. It is
 * logged to the console instead, where per-run facts belong. Everything below
 * is a function of the shards alone, so a rebuild with no data change produces
 * a byte-identical report and `git status` stays clean.
 */
function buildReport({ shards, total, generatedAt, largest }) {
  const bySize = [...shards.entries()]
    .map(([code, cities]) => [code, cities.length])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15);
  return [
    '# Worldwide city catalog report',
    '',
    `- Generated: ${generatedAt}`,
    `- Source: ${CITIES_URL}`,
    `- Licence: ${SOURCE_LICENSE} — ${SOURCE_ATTRIBUTION}`,
    `- Filter: composite score (alternate names + 2 x log10 population), top ${CITIES_PER_COUNTRY} per country`,
    `- Deduplicated against data/catalog.json within ${DEDUP_RADIUS_KM} km on a folded name match`,
    '',
    `**${total} cities across ${shards.size} countries.**`,
    '',
    `Largest shard: ${largest.code} at ${(largest.bytes / 1024).toFixed(1)} KB raw.`,
    '',
    '## Attribution',
    '',
    'GeoNames data is licensed CC BY 4.0. The application carries a visible',
    'credit in `components/plan/GeoNamesCredit.tsx`; this file is not a',
    'substitute for it.',
    '',
    '## Most cities by country',
    '',
    '| Country | Cities |',
    '| --- | --- |',
    ...bySize.map(([code, n]) => `| ${code} | ${n} |`),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHARD_DIR, { recursive: true });

  console.log(`Fetching ${CITIES_URL} …`);
  const archive = await fetchSource(CITIES_URL, { binary: true });
  console.log(`  ${archive.length} bytes; inflating ${CITIES_MEMBER}`);
  const tsv = readZipMember(archive, CITIES_MEMBER).toString('utf8');

  console.log(`Fetching ${ADMIN1_URL} …`);
  const admin1Codes = parseAdmin1Codes(await fetchSource(ADMIN1_URL, { binary: false }));
  // Gated before anything reads it: a reshaped file parses to a near-empty Map
  // and every `a1` becomes null, which no later check would notice.
  assertAdmin1Sane(admin1Codes);
  console.log(`  ${admin1Codes.size} admin-1 names`);

  const rows = parseGeoNamesRows(tsv);
  console.log(`  parsed ${rows.length} usable rows`);

  // The existing catalog is read here rather than imported, so no import
  // attribute is needed and the pure functions stay testable without it.
  const catalog = readJson(CATALOG_PATH);
  const catalogCities = catalog?.cities ?? [];
  console.log(`  deduplicating against ${catalogCities.length} Wikidata cities`);

  const { shards, targets, total } = buildCities(rows, admin1Codes, catalogCities);
  const previousIndex = readJson(SHARD_INDEX_PATH);
  assertSane(shards, previousIndex);

  const now = new Date().toISOString();
  const countries = [];
  const indexRows = [];
  let changed = 0;
  let largest = { code: '', bytes: 0 };

  for (const country of [...shards.keys()].sort()) {
    const cities = shards.get(country);
    const path = join(SHARD_DIR, `${country}.json`);
    const payload = shardPayload(country, cities, readJson(path), now);
    if (payload.generatedAt === now) changed++;
    const json = JSON.stringify(payload);
    if (json.length > largest.bytes) largest = { code: country, bytes: json.length };
    writeFileAtomic(path, json);
    countries.push({ code: country, count: cities.length, generatedAt: payload.generatedAt });
    for (const city of cities) {
      indexRows.push([city.id, city.n, country, city.lat, city.lon, city.a1]);
    }
  }

  // Stale shards from a country that vanished. `assertSane` refuses to let a
  // country disappear, so this only ever cleans up after an aborted run — but
  // an orphan file under public/ is a URL the client can still fetch.
  const wanted = new Set([...shards.keys()].map((code) => `${code}.json`));
  for (const entry of readdirSync(SHARD_DIR)) {
    if (entry === 'index.json' || entry === 'enrich') continue;
    if (!wanted.has(entry)) {
      rmSync(join(SHARD_DIR, entry), { force: true });
      console.log(`  removed stale shard ${entry}`);
    }
  }

  // All three index files go through `stampedPayload`, exactly as the 246
  // shards go through `shardPayload`. They are inside refresh-cities.yml's
  // commit-guard paths — public/cities/index.json is under public/cities, and
  // the other two are named outright — so stamping `now` on them
  // unconditionally would make that guard impossible to satisfy: a
  // commit-on-change job would commit 3.7 MB and redeploy production every
  // night for no data change.
  //
  // index.json is indented: it is the one generated file whose diff a human
  // reads. Everything else here is compact, because megabytes of it are
  // committed and indentation would be pure overhead.
  const shardIndex = stampedPayload(readJson(SHARD_INDEX_PATH), {
    source: SOURCE_LICENSE,
    countries,
  }, now);
  writeFileAtomic(SHARD_INDEX_PATH, JSON.stringify(shardIndex, null, 1));

  // Bundled, never fetched: public/ is unreadable from a Vercel lambda, so
  // this is the only thing resolveDestinations can read a picked city out of.
  // Tuples rather than objects — 3.5 MB instead of 4.35 MB for the same data,
  // and it is parsed once per cold start.
  writeFileAtomic(
    CITY_INDEX_PATH,
    JSON.stringify(
      stampedPayload(readJson(CITY_INDEX_PATH), { source: SOURCE_LICENSE, cities: indexRows }, now)
    )
  );

  writeFileAtomic(
    ENRICH_TARGETS_PATH,
    JSON.stringify(
      stampedPayload(
        readJson(ENRICH_TARGETS_PATH),
        { targets: Object.fromEntries([...targets.keys()].sort().map((c) => [c, targets.get(c)])) },
        now
      )
    )
  );

  // The report carries the run's own timestamp and is deliberately OUTSIDE the
  // workflow's change test: it is prose about the run, not an artifact the app
  // reads. It is still committed alongside a real change. `shardIndex`'s
  // timestamp, not `now`, so a quiet day does not rewrite this either.
  writeFileAtomic(
    REPORT_PATH,
    buildReport({ shards, total, generatedAt: shardIndex.generatedAt, largest })
  );

  console.log(`Wrote ${shards.size} shards to ${SHARD_DIR} (${changed} changed)`);
  console.log(`Wrote ${CITY_INDEX_PATH} (${indexRows.length} cities)`);
  console.log(`Wrote ${ENRICH_TARGETS_PATH}, ${SHARD_INDEX_PATH}, ${REPORT_PATH}`);
}

/**
 * Only runs when this file is invoked directly.
 *
 * Without this guard, importing the module to test one of its rules re-runs
 * the whole ingest and rewrites 246 files as an import side effect — not
 * hypothetical; it happened during review of ingest-airports.mjs.
 *
 * Compared as file URLs rather than as paths because on Windows
 * `process.argv[1]` is a drive path while `import.meta.url` is a `file://`
 * URL, so comparing them directly would never match and running the script
 * would silently do nothing. `process.argv[1]` is checked for existence first
 * because it is undefined under `node --eval`, where `pathToFileURL(undefined)`
 * throws.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nCity ingestion failed: ${error.message}`);
    console.error('Nothing was written — the previous artifacts are untouched.');
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/ingest-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  81 passed (81)`.

- [ ] **Step 5: Run the ingest for real and check the artifacts**

  ```bash
  node scripts/ingest-cities.mjs
  ```

  Expected terminal output (a `MODULE_TYPELESS_PACKAGE_JSON` warning for the two `lib/*.ts` imports is normal and is documented in the file header):

  ```
  Fetching https://download.geonames.org/export/dump/cities500.zip …
    13533683 bytes; inflating cities500.txt
  Fetching https://download.geonames.org/export/dump/admin1CodesASCII.txt …
    3865 admin-1 names       # 3,866 lines in the file; the last is the trailing newline's empty one
    parsed 235483 usable rows
    deduplicating against 695 Wikidata cities
  Wrote 246 shards to …/public/cities (246 changed)
  Wrote …/data/cities-index.json (59073 cities)
  ```

  Then verify the measured numbers hold:

  ```bash
  node -e "const f=require('fs');const i=JSON.parse(f.readFileSync('public/cities/index.json','utf8'));console.log('countries',i.countries.length);console.log('total',i.countries.reduce((s,c)=>s+c.count,0));const pe=JSON.parse(f.readFileSync('public/cities/PE.json','utf8'));console.log('PE rows',pe.cities.length,'bytes',f.statSync('public/cities/PE.json').size);console.log('PE top3',pe.cities.slice(0,3).map(c=>c.n).join(', '));console.log('Cusco',pe.cities.some(c=>c.id==='G3941584'));const cn=JSON.parse(f.readFileSync('public/cities/CN.json','utf8'));console.log('CN rows',cn.cities.length,'Jinan absent',!cn.cities.some(c=>c.id==='G1805753'));console.log('index bytes',f.statSync('data/cities-index.json').size);"
  ```

  Expected:
  ```
  countries 246
  total 59073
  PE rows 750 bytes 84701
  PE top3 Lima, Callao, Arequipa
  Cusco true
  CN rows 413 Jinan absent true
  index bytes 3672345
  ```

  (Exact byte counts may drift by a few hundred as GeoNames updates. `countries 246`, `PE rows 750`, `Cusco true` and `Jinan absent true` must hold exactly.)

- [ ] **Step 6: Run the ingest a second time and confirm it is byte-stable**

  Commit the first run's artifacts before running this, so `git status` has a baseline to compare against — otherwise everything shows as untracked and the check says nothing.

  ```bash
  node scripts/ingest-cities.mjs
  git status --porcelain -- public/cities data/cities-index.json data/cities-enrich-targets.json data/cities-report.md
  ```

  Expected: the second run prints `(0 changed)`, and **`git status --porcelain` prints nothing at all** — not one line, including for `data/cities-report.md`.

  This is the single most important verification in the plan, and it is not cosmetic. `refresh-cities.yml`'s commit guard is a `git status --porcelain` over the first three of those paths. Every artifact this task writes goes through a preserve-when-unchanged rule — the 246 shards through `shardPayload`, the three index files through `stampedPayload`, and the report through `shardIndex.generatedAt` — precisely so that a quiet day produces a byte-identical tree. If any line appears here, the guard can never fire, and the daily job commits ~10 MB and redeploys production every night for no data change. Find which file moved and why before continuing.

- [ ] **Step 7: Commit**

  ```bash
  git add scripts/ingest-cities.mjs scripts/ingest-cities.test.ts public/cities data/cities-index.json data/cities-enrich-targets.json data/cities-report.md
  git commit -m "feat: emit 246 worldwide city shards and a bundled resolution index"
  ```

---

## Task 7: Build-time enrichment for the top 30 per country

**Files:**
- Create: `scripts/enrich-cities.mjs`
- Create: `scripts/enrich-cities.test.ts`
- Generated: `public/cities/enrich/*.json`

**Interfaces:**
- Consumes: `data/cities-enrich-targets.json` (Task 6), `public/cities/{CC}.json` (Task 6).
- Produces:
  - `export function buildEnrichmentQuery(geonameIds: readonly string[]): string` — a Wikidata SPARQL query keyed on **P1566 (GeoNames ID)**.
  - `export function readEnrichmentBindings(bindings: readonly unknown[]): Map<string, { title: string | null; description: string | null; image: string | null }>`
  - `export function mergeEnrichment(previous, fresh, scope: readonly string[]): Record<string, { description: string | null; image: string | null }>`
  - `export function toThumbnailUrl(commonsFilePathUrl: string | null): string | null`
  - `export function firstSentences(text: string | null, maxSentences?: number): string | null`
  - `export function assertEnrichmentSane(previousTotal: number, nextTotal: number): void` — throws, never returns a value.

**Deviation from spec §4, recorded deliberately.** §4 says build-time enrichment reuses "the fetch machinery in `ingest-destinations.mjs`". This writes a new script instead, because the two have opposite failure policies: `ingest-destinations.mjs` writes on failure so its output can be inspected; this must not abort on a single batch at all (enrichment is additive), while `ingest-cities.mjs` must abort before writing anything. Sharing one fetch layer across three scripts with three failure policies is a change that would need its own task. The SPARQL binding-merge idiom (`??=`) is deliberately copied rather than shared.

**`mergeEnrichment` is destructive within its scope, not additive.** It deletes every id in `scope` and re-adds only what came back. That is correct for a batch that *answered* and found nothing, and catastrophic for a batch that never *ran* — and the function cannot tell those apart. Two things keep them apart, and both are load-bearing: `main()` narrows the scope to ids whose SPARQL batch actually returned, and `assertEnrichmentSane` refuses to write when total coverage collapses anyway. Without them, one Wikidata outage rewrites all 246 files as `{"cities":{}}`, exits 0, and the daily workflow commits and deploys the wipe.

Why P1566 and not a name search: GeoNames rows carry no Wikipedia title, and the Action API's `titles=Cusco` is ambiguous — GeoNames has two Peruvian Cuscos and 139,183 rows named `PPL`. Wikidata's P1566 is an exact key back from a geonameid to a QID, and the same query then yields the enwiki sitelink, the P18 image and the English description in one round trip. Verified live: `G2657928 → Q27494 (Zermatt)`, `G3941584 → Q5582862 (Cusco)`, `G1857910 → Q34600 (Kyoto)`, `G246008 → Q2739446 (Wadi Musa)`, `G252920 → Q617169 (Fira)` — all five with a title, a description and an image.

- [ ] **Step 1: Write the failing test**

  Create `scripts/enrich-cities.test.ts` with exactly this content:

```typescript
import { describe, expect, test } from "vitest";
import {
  assertEnrichmentSane,
  buildEnrichmentQuery,
  firstSentences,
  mergeEnrichment,
  readEnrichmentBindings,
  toThumbnailUrl,
} from "./enrich-cities.mjs";

/**
 * The pure half of the enrichment build. The network half — SPARQL, the
 * Action API and the file writes — runs only from `main()`, which the
 * module's entry-point guard keeps out of this import.
 */

describe("buildEnrichmentQuery", () => {
  test("keys on P1566 with the bare geonameid, not the G-prefixed app id", () => {
    // The G prefix exists so a GeoNames id can never be mistaken for a
    // Wikidata QID inside this app. Wikidata stores the bare integer as a
    // string, so sending "G3941584" matches nothing and every city comes back
    // unenriched — silently, because an empty result is also what a genuinely
    // unknown city returns.
    const query = buildEnrichmentQuery(["G3941584", "G2657928"]);
    expect(query).toContain('"3941584"');
    expect(query).toContain('"2657928"');
    expect(query).not.toContain("G3941584");
    expect(query).toContain("wdt:P1566");
  });

  test("asks for the enwiki title, the description and the image", () => {
    const query = buildEnrichmentQuery(["G1"]);
    expect(query).toContain("wdt:P18");
    expect(query).toContain("https://en.wikipedia.org/");
    expect(query).toContain("schema:description");
  });

  test("refuses an id that is not a GeoNames id rather than injecting it", () => {
    // The ids arrive from a generated file, but this string is interpolated
    // straight into a query — a value with a quote in it would rewrite the
    // WHERE clause.
    expect(() => buildEnrichmentQuery(['G1" } UNION { ?x ?y ?z'])).toThrow(/not a GeoNames id/);
    expect(() => buildEnrichmentQuery(["Q170247"])).toThrow(/not a GeoNames id/);
  });
});

describe("readEnrichmentBindings", () => {
  test("collapses SPARQL's row-per-combination output into one entity per id", () => {
    // Wikidata returns one row per statement combination — the live query
    // returns Cusco three times. First non-null binding wins per field, the
    // same `??=` merge ingest-destinations.mjs uses.
    const merged = readEnrichmentBindings([
      { gid: { value: "3941584" }, title: { value: "Cusco" }, desc: { value: "historic city of Peru" } },
      { gid: { value: "3941584" }, img: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg" } },
      { gid: { value: "3941584" }, title: { value: "Cusco (disambiguation)" } },
    ]);
    expect(merged.get("G3941584")).toEqual({
      title: "Cusco",
      description: "historic city of Peru",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg?width=640",
    });
  });

  test("re-prefixes the id so it matches the shard", () => {
    const merged = readEnrichmentBindings([{ gid: { value: "2657928" } }]);
    expect([...merged.keys()]).toEqual(["G2657928"]);
  });

  test("nulls every field a binding did not carry", () => {
    expect(readEnrichmentBindings([{ gid: { value: "1" } }]).get("G1")).toEqual({
      title: null,
      description: null,
      image: null,
    });
  });

  test("ignores a row with no id rather than keying on undefined", () => {
    expect(readEnrichmentBindings([{ title: { value: "orphan" } }]).size).toBe(0);
  });
});

describe("toThumbnailUrl", () => {
  test("forces https and asks Commons to resize server-side", () => {
    // No image bytes are ever downloaded — P18 arrives as a Special:FilePath
    // URL and Commons does the resizing, the same trick
    // ingest-country-images.mjs uses at width 1280.
    expect(toThumbnailUrl("http://commons.wikimedia.org/wiki/Special:FilePath/A.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/A.jpg?width=640"
    );
  });

  test("passes null through", () => {
    expect(toThumbnailUrl(null)).toBeNull();
  });
});

describe("mergeEnrichment", () => {
  const previous = {
    G1: { description: "old one", image: null },
    G2: { description: "kept", image: "https://x/2.jpg?width=640" },
  };

  test("keeps entries outside this run's scope", () => {
    // §4: enrichment is stored apart from the base shard so a re-ingest never
    // discards it. A lazily-enriched city that has since fallen out of the top
    // 30 must survive a build that no longer asks about it.
    const merged = mergeEnrichment(previous, new Map(), ["G1"]);
    expect(merged.G2).toEqual({ description: "kept", image: "https://x/2.jpg?width=640" });
  });

  test("recomputes every id inside this run's scope, including deletion", () => {
    // A city that now fails the gate loses its stale entry rather than keeping
    // it forever — the same rule ingest-country-images.mjs applies to a
    // partial run. Correct for a batch that ANSWERED and found nothing; see
    // the next two tests for what stops it being catastrophic otherwise.
    const merged = mergeEnrichment(previous, new Map(), ["G1"]);
    expect(merged).not.toHaveProperty("G1");
  });

  test("does not delete an entry whose batch never ran", () => {
    // The narrowing `main()` applies: an id whose SPARQL batch timed out is
    // not in scope at all, so a Wikidata blip costs nothing. Deleting on an
    // unasked id turns a transient outage into a committed, deployed data
    // regression, because the workflow commits whatever this writes.
    expect(mergeEnrichment(previous, new Map(), []).G1).toEqual({
      description: "old one",
      image: null,
    });
  });

  test("an empty fresh map erases the whole scope, which is why the gate exists", () => {
    // Stated rather than left implicit: this is correct for a successful run
    // that legitimately found nothing, and a disaster for a failed one.
    // `assertEnrichmentSane` is the only thing separating the two.
    expect(mergeEnrichment(previous, new Map(), ["G1", "G2"])).toEqual({});
  });

  test("writes a fresh entry from a summary and an image", () => {
    const fresh = new Map([
      ["G1", { title: "Zermatt", description: "Zermatt is a municipality in Valais.", image: "https://x/z.jpg?width=640" }],
    ]);
    expect(mergeEnrichment(previous, fresh, ["G1"]).G1).toEqual({
      description: "Zermatt is a municipality in Valais.",
      image: "https://x/z.jpg?width=640",
    });
  });

  test("drops an entry that has neither a description nor an image", () => {
    // An empty record is a byte cost with nothing in it, and its presence
    // would tell the lazy runtime path the city was already tried.
    const fresh = new Map([["G1", { title: "Nowhere", description: null, image: null }]]);
    expect(mergeEnrichment(previous, fresh, ["G1"])).not.toHaveProperty("G1");
  });

  test("returns keys in sorted order so a rebuild is byte-stable", () => {
    const fresh = new Map([
      ["G9", { title: null, description: "nine", image: null }],
      ["G3", { title: null, description: "three", image: null }],
    ]);
    expect(Object.keys(mergeEnrichment({}, fresh, ["G9", "G3"]))).toEqual(["G3", "G9"]);
  });
});

describe("assertEnrichmentSane", () => {
  test("aborts when a run would erase most of the previous coverage", () => {
    // The failure this exists for: SPARQL answered every batch but returned
    // nothing — a renamed property, a schema change, a rate-limit page that
    // parsed as valid JSON — so scope narrowing does not help and
    // mergeEnrichment would delete all 6,244 records. The workflow commits
    // that and Vercel deploys it, unattended.
    expect(() => assertEnrichmentSane(6_244, 0)).toThrow(/coverage fell to 0\/6244/);
    expect(() => assertEnrichmentSane(6_244, 2_000)).toThrow(/under the 50% floor/);
  });

  test("accepts normal drift, and a first run with nothing to lose", () => {
    expect(() => assertEnrichmentSane(6_244, 6_100)).not.toThrow();
    expect(() => assertEnrichmentSane(6_244, 6_400)).not.toThrow();
    expect(() => assertEnrichmentSane(0, 0)).not.toThrow();
  });
});

describe("firstSentences", () => {
  // The function every build-time description a traveller reads passes
  // through — three branches, a lookbehind/lookahead split and a 420-character
  // truncation, none of it otherwise exercised.

  test("keeps two sentences and drops the rest", () => {
    expect(
      firstSentences("Cusco is a city in Peru. It was the Inca capital. It sits at 3,400 m.")
    ).toBe("Cusco is a city in Peru. It was the Inca capital.");
  });

  test("survives an abbreviation the splitter mistakes for a sentence end", () => {
    // Verified behaviour, not the behaviour one might assume: the lookahead
    // only requires an uppercase letter or digit after the space, so "Mt. |
    // Everest…" DOES split. What saves it is the two-sentence budget rejoining
    // the halves. A one-sentence cap would truncate this to "Mt." — which is
    // why `maxSentences` must not be lowered without revisiting this.
    expect(firstSentences("Mt. Everest is 8,848 m tall.")).toBe("Mt. Everest is 8,848 m tall.");
  });

  test("drops a pinyin parenthetical rather than shipping it to a traveller", () => {
    expect(
      firstSentences("Jinan (simplified Chinese: 济南; pinyin: Jǐnán) is a city in Shandong.")
    ).toBe("Jinan is a city in Shandong.");
  });

  test("falls back to one sentence when two would exceed the cap", () => {
    const long = `${"A".repeat(300)}. ${"B".repeat(300)}.`;
    expect(firstSentences(long)).toBe(`${"A".repeat(300)}.`);
  });

  test("truncates with an ellipsis when even one sentence exceeds the cap", () => {
    const result = firstSentences(`${"A".repeat(600)}.`);
    expect(result).toHaveLength(420);
    expect(result!.endsWith("…")).toBe(true);
  });

  test("is null for nothing, rather than an empty string", () => {
    expect(firstSentences(null)).toBeNull();
    expect(firstSentences("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node scripts/enrich-cities.test.ts
  ```

  Expected — measured, not paraphrased: the run fails at collection with

  ```
  Error: Cannot find module './enrich-cities.mjs' imported from …/scripts/enrich-cities.test.ts
   Test Files  1 failed (1)
        Tests  no tests
  ```

- [ ] **Step 3: Write the minimal implementation**

  Create `scripts/enrich-cities.mjs` with exactly this content:

```javascript
#!/usr/bin/env node
/**
 * enrich-cities.mjs
 *
 * Gives the top 30 cities per country (6,244 in total) a one-or-two sentence
 * description and a Wikimedia image, written to public/cities/enrich/<CC>.json
 * — a file per country, mirroring the shards.
 *
 * GeoNames carries name, coordinates, population, admin-1 and timezone. It
 * carries no descriptions, no images and no interest tags, so a naive port
 * would trade 695 rich cities for 59,073 thin ones — a coverage win that is a
 * regression in feel. This closes most of that gap at build time; anything
 * else is enriched on first selection by lib/server/cityEnrichment.ts.
 *
 * Keyed on Wikidata's P1566 (GeoNames ID) rather than on a name search,
 * because a name search is ambiguous — Peru has two cities called Cusco and
 * 139,183 of the dump's rows are plain `PPL`. P1566 is an exact key back to a
 * QID, and the same query yields the enwiki sitelink, the P18 image and the
 * English description in one round trip.
 *
 * Stored apart from the shard, and merged rather than replaced: §4 requires
 * that a re-ingest never discards enrichment. Every id in THIS run's scope is
 * recomputed, including deletion, so a city that now fails a gate loses its
 * stale entry instead of keeping it forever — the rule
 * ingest-country-images.mjs already applies to a partial run.
 *
 * Unlike scripts/ingest-cities.mjs this script does NOT abort on a failed
 * batch. A city with no enrichment renders exactly as a thin catalog city does
 * today, which is already an accepted state in the UI, so a failed batch is
 * counted, reported, and the run continues.
 *
 * That tolerance is only safe because of two rules below, and both are
 * load-bearing. `mergeEnrichment` is additive for entries OUTSIDE its scope and
 * DESTRUCTIVE inside it — it deletes every id in scope before re-adding what
 * came back — and it cannot tell "Wikidata has nothing for this city" from "we
 * never got to ask". So:
 *
 *   1. `main()` narrows each country's scope to the ids whose SPARQL batch
 *      actually returned. A timed-out batch costs nothing at all.
 *   2. `assertEnrichmentSane` refuses to write when total coverage collapses
 *      anyway — the case narrowing cannot catch, where every batch answers and
 *      returns nothing because the query or the endpoint changed shape.
 *
 * Without both, one outage rewrites all 246 files as `{"cities":{}}`, exits 0,
 * and `refresh-cities.yml` commits the wipe and Vercel deploys it.
 *
 * Usage:
 *   node scripts/enrich-cities.mjs             # every country in the target file
 *   node scripts/enrich-cities.mjs PE CH JP    # merge just these
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS_PATH = join(ROOT_DIR, 'data', 'cities-enrich-targets.json');
const ENRICH_DIR = join(ROOT_DIR, 'public', 'cities', 'enrich');

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const ENWIKI_ACTION_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'ChinaItineraryPlanner/1.0 (personal project)';
const SOURCE = 'Wikidata (CC0) + Wikipedia (CC BY-SA) summaries';

const SPARQL_TIMEOUT_MS = 90_000;
const REST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [2_000, 8_000];
const MAX_RETRY_AFTER_MS = 30_000;
const SPARQL_POLITENESS_DELAY_MS = 400;
/**
 * How much of the previous run's coverage may vanish before this is an outage
 * rather than a data change. See the header: enrichment is destructive within
 * scope, and the workflow commits and deploys whatever is written.
 */
const MIN_COVERAGE_RATIO = 0.5;
const SUMMARY_POLITENESS_DELAY_MS = 250;
/** Wikidata's optimiser copes with this many VALUES per query; more times out. */
const IDS_PER_SPARQL_BATCH = 150;
/** The Action API's `exlimit` maximum for anonymous callers. */
const TITLES_PER_REQUEST = 20;
const MAX_DESCRIPTION_CHARS = 420;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------

/** `G` + digits, the id shape scripts/ingest-cities.mjs emits. */
const GEONAMES_ID = /^G[1-9][0-9]*$/;

/**
 * A VALUES query over Wikidata's P1566 (GeoNames ID).
 *
 * Ids are validated rather than escaped. They come from a generated file, but
 * this string is interpolated straight into a query, and a value carrying a
 * quote would rewrite the WHERE clause. Validation is also what catches the
 * subtler mistake: sending the app's `G`-prefixed id matches nothing, and an
 * empty result is indistinguishable from a genuinely unknown city.
 */
export function buildEnrichmentQuery(geonameIds) {
  const values = geonameIds
    .map((id) => {
      if (!GEONAMES_ID.test(id)) throw new Error(`"${id}" is not a GeoNames id — expected "G" + digits`);
      return `"${id.slice(1)}"`;
    })
    .join(' ');
  return `
SELECT ?gid ?x ?img ?title ?desc WHERE {
  VALUES ?gid { ${values} }
  ?x wdt:P1566 ?gid.
  OPTIONAL { ?x wdt:P18 ?img. }
  OPTIONAL { ?article schema:about ?x; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title. }
  OPTIONAL { ?x schema:description ?desc. FILTER(LANG(?desc) = "en") }
}`;
}

/** P18 arrives as a Commons Special:FilePath URL; Commons resizes server-side. */
export function toThumbnailUrl(commonsFilePathUrl) {
  if (!commonsFilePathUrl) return null;
  return `${commonsFilePathUrl.replace(/^http:/, 'https:')}?width=640`;
}

/**
 * SPARQL's row-per-statement-combination output, collapsed to one entity per
 * id. First non-null binding wins per field — the `??=` idiom
 * ingest-destinations.mjs uses, and the reason the live query returning Cusco
 * three times does not produce three records.
 */
export function readEnrichmentBindings(bindings) {
  const merged = new Map();
  for (const row of bindings) {
    const gid = row?.gid?.value;
    if (!gid) continue;
    const id = `G${gid}`;
    const entity = merged.get(id) ?? { title: null, description: null, image: null };
    entity.title ??= row.title?.value ?? null;
    entity.description ??= row.desc?.value ?? null;
    entity.image ??= toThumbnailUrl(row.img?.value ?? null);
    merged.set(id, entity);
  }
  return merged;
}

/**
 * The previous enrichment file, updated for the ids this run covered.
 *
 * Merged so a lazily-enriched city that has since fallen out of the top 30
 * survives a build that no longer asks about it. Recomputed inside the scope,
 * including deletion, so a city that now yields nothing loses its stale entry.
 * Keys are sorted so a rebuild with no data change is byte-identical and the
 * daily workflow has nothing to commit.
 */
export function mergeEnrichment(previous, fresh, scope) {
  const out = { ...previous };
  for (const id of scope) delete out[id];
  for (const id of scope) {
    const entity = fresh.get(id);
    if (!entity) continue;
    const description = entity.description ?? null;
    const image = entity.image ?? null;
    if (description === null && image === null) continue;
    out[id] = { description, image };
  }
  /**
   * Annotated, not inferred. `allowJs` with `checkJs` off still lets
   * TypeScript infer this module's exported types, and an object literal
   * populated only through a computed key infers as `{}` — which makes
   * `merged.G2` in scripts/enrich-cities.test.ts a hard `tsc --noEmit` error
   * (`TS2339: Property 'G2' does not exist on type '{}'`), and the pre-merge
   * gate is exactly `npx tsc --noEmit` then `npm test`. Reproduced and the fix
   * verified against this repo's own TypeScript 7.0.2.
   *
   * @type {Record<string, { description: string | null; image: string | null }>}
   */
  const ordered = {};
  for (const key of Object.keys(out).sort()) ordered[key] = out[key];
  return ordered;
}

/**
 * The gate between a Wikidata outage and a committed, deployed data wipe.
 *
 * `mergeEnrichment` deletes every id in its scope before re-adding what came
 * back, and `main()` already narrows the scope to batches that answered — but
 * narrowing cannot catch the case where every batch answers and returns
 * nothing, which is what a renamed property, a schema change or a rate-limit
 * page parsed as JSON looks like. Then the merge is legitimately empty and
 * all 6,244 records would be deleted, written, committed and deployed with
 * `main()` still exiting 0.
 *
 * Throwing here fails the workflow's enrich step, which skips the commit step
 * entirely: the cost of a bad upstream day is one skipped refresh, not the
 * catalog's whole descriptive layer.
 */
export function assertEnrichmentSane(previousTotal, nextTotal) {
  if (previousTotal === 0) return; // a first run has nothing to lose
  const ratio = nextTotal / previousTotal;
  if (ratio < MIN_COVERAGE_RATIO) {
    throw new Error(
      `enrichment coverage fell to ${nextTotal}/${previousTotal} ` +
      `(${(ratio * 100).toFixed(1)}%), under the ${MIN_COVERAGE_RATIO * 100}% floor — ` +
      `writing now would delete the enrichment this run failed to refetch`
    );
  }
}

/** Drop "(simplified Chinese: …; pinyin: …)" style parentheticals from extracts. */
function stripLanguageParentheticals(text) {
  if (!text) return text;
  return text.replace(/\s*\((?=[^)]*(?:pinyin|romanized|Chinese))[^()]*\)/g, '');
}

export function firstSentences(text, maxSentences = 2) {
  if (!text) return null;
  const clean = stripLanguageParentheticals(text).replace(/\s+/g, ' ').trim();
  // The optional opener before a capital is a straight quote, an apostrophe or
  // a bracket. (An earlier draft listed `"` twice, which was a no-op.)
  const sentences = clean.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
  let result = sentences.slice(0, maxSentences).join(' ');
  if (result.length > MAX_DESCRIPTION_CHARS && sentences.length > 1) result = sentences[0];
  if (result.length > MAX_DESCRIPTION_CHARS) {
    result = `${result.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
  }
  return result || null;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchWithRetry(url, { headers, timeoutMs, label }) {
  let lastError = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (res.status === 404) return null;
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status} for ${label}: ${(await res.text()).slice(0, 200)}`);
        const retryAfterSeconds = Number(res.headers.get('retry-after'));
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          error.retryAfterMs = Math.min(retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
        }
        throw error;
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = Math.max(RETRY_DELAYS_MS[attempt], error.retryAfterMs ?? 0);
        console.warn(`  retry ${attempt + 1}/${RETRY_DELAYS_MS.length} for ${label} in ${delay}ms (${error.message.slice(0, 120)})`);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Failed after retries: ${label}: ${lastError?.message}`);
}

async function sparql(query, label) {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  const json = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    timeoutMs: SPARQL_TIMEOUT_MS,
    label: `SPARQL ${label}`,
  });
  await sleep(SPARQL_POLITENESS_DELAY_MS);
  return json?.results?.bindings ?? [];
}

/** Intro extracts, 20 titles per request. Failures degrade, they do not abort. */
async function fetchExtracts(titles) {
  const extracts = new Map();
  const batches = chunk([...new Set(titles)], TITLES_PER_REQUEST);
  let failures = 0;
  for (const [index, batch] of batches.entries()) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2',
      prop: 'extracts', exintro: '1', explaintext: '1', exlimit: 'max',
      redirects: '1', titles: batch.join('|'),
    });
    try {
      const json = await fetchWithRetry(`${ENWIKI_ACTION_API}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeoutMs: REST_TIMEOUT_MS,
        label: `extracts ${index + 1}/${batches.length}`,
      });
      // The Action API answers under the canonical title, not the requested
      // one, so the two remappings have to be walked in order.
      const normalized = new Map((json?.query?.normalized ?? []).map((n) => [n.from, n.to]));
      const redirected = new Map((json?.query?.redirects ?? []).map((r) => [r.from, r.to]));
      const byTitle = new Map((json?.query?.pages ?? []).map((p) => [p.title, p.extract ?? null]));
      for (const requested of batch) {
        const normal = normalized.get(requested) ?? requested;
        const final = redirected.get(normal) ?? normal;
        extracts.set(requested, byTitle.get(final) ?? null);
      }
    } catch (error) {
      failures += batch.length;
      console.warn(`  extract batch ${index + 1} failed (${error.message.slice(0, 120)})`);
    }
    await sleep(SUMMARY_POLITENESS_DELAY_MS);
  }
  if (failures > 0) console.warn(`  ${failures} titles fell back to Wikidata descriptions`);
  return extracts;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}`;
  writeFileSync(tempPath, content, 'utf8');
  try {
    rmSync(path, { force: true });
    renameSync(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const targetsFile = readJson(TARGETS_PATH);
  if (!targetsFile?.targets) {
    throw new Error(`${TARGETS_PATH} is missing — run \`node scripts/ingest-cities.mjs\` first`);
  }
  const requested = process.argv
    .slice(2)
    .map((arg) => arg.trim().toUpperCase())
    .filter((arg) => /^[A-Z]{2}$/.test(arg));
  const countries = requested.length > 0 ? requested : Object.keys(targetsFile.targets).sort();

  const scopeByCountry = new Map();
  const allIds = [];
  for (const country of countries) {
    const ids = targetsFile.targets[country];
    if (!Array.isArray(ids)) {
      console.warn(`  ${country} has no targets — skipping`);
      continue;
    }
    scopeByCountry.set(country, ids);
    allIds.push(...ids);
  }
  if (allIds.length === 0) {
    throw new Error(`${TARGETS_PATH} names no cities — rerun \`node scripts/ingest-cities.mjs\``);
  }
  console.log(`Enriching ${allIds.length} cities across ${scopeByCountry.size} countries…`);

  const entities = new Map();
  /**
   * Ids whose batch actually came back. Only these may be deleted below.
   *
   * `mergeEnrichment` cannot tell "Wikidata has nothing for this city" from
   * "we never got to ask", and a timed-out batch must cost nothing — otherwise
   * a transient blip becomes a committed, auto-deployed data regression.
   */
  const answered = new Set();
  const batches = chunk(allIds, IDS_PER_SPARQL_BATCH);
  for (const [index, batch] of batches.entries()) {
    try {
      const bindings = await sparql(buildEnrichmentQuery(batch), `${index + 1}/${batches.length}`);
      for (const [id, entity] of readEnrichmentBindings(bindings)) entities.set(id, entity);
      for (const id of batch) answered.add(id);
    } catch (error) {
      console.warn(
        `  SPARQL batch ${index + 1} failed (${error.message.slice(0, 120)}) — ` +
        `${batch.length} cities keep their previous enrichment`
      );
    }
    if ((index + 1) % 5 === 0 || index === batches.length - 1) {
      console.log(`  wikidata ${index + 1}/${batches.length} (${entities.size} entities)`);
    }
  }

  const titles = [...entities.values()].map((e) => e.title).filter(Boolean);
  const extracts = await fetchExtracts(titles);
  for (const entity of entities.values()) {
    const extract = entity.title ? extracts.get(entity.title) : null;
    entity.description = firstSentences(extract) ?? entity.description;
  }

  // Merged in full BEFORE anything is written, so the coverage gate below can
  // see what the whole run would do. Writing per country as we go would leave
  // half the catalog wiped and half intact when the gate fires.
  const planned = new Map();
  let previousTotal = 0;
  let nextTotal = 0;
  for (const [country, scope] of scopeByCountry) {
    const path = join(ENRICH_DIR, `${country}.json`);
    const previous = readJson(path);
    previousTotal += Object.keys(previous?.cities ?? {}).length;
    // Only ids whose batch returned. An unasked id is not recomputed, so it
    // keeps whatever the last successful run gave it.
    const scoped = scope.filter((id) => answered.has(id));
    const cities = mergeEnrichment(previous?.cities ?? {}, entities, scoped);
    nextTotal += Object.keys(cities).length;
    planned.set(country, { path, previous, cities });
  }

  assertEnrichmentSane(previousTotal, nextTotal);

  const now = new Date().toISOString();
  let written = 0;
  for (const [country, { path, previous, cities }] of planned) {
    const unchanged = previous !== null && JSON.stringify(previous.cities) === JSON.stringify(cities);
    writeFileAtomic(
      path,
      JSON.stringify({
        country,
        generatedAt: unchanged ? previous.generatedAt : now,
        source: SOURCE,
        cities,
      })
    );
    if (!unchanged) written++;
  }
  console.log(
    `Wrote ${planned.size} enrichment files to ${ENRICH_DIR} ` +
    `(${written} changed, ${nextTotal} cities enriched, ${allIds.length - answered.size} unasked)`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nCity enrichment failed: ${error.message}`);
    console.error('If this is a network error, Wikidata/Wikipedia may be unreachable — rerun later.');
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node scripts/enrich-cities.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  24 passed (24)`.

- [ ] **Step 5: Run the enrichment for three countries and check one entry**

  ```bash
  node scripts/enrich-cities.mjs PE CH JP
  node -e "const f=require('fs');for(const c of ['PE','CH','JP']){const j=JSON.parse(f.readFileSync('public/cities/enrich/'+c+'.json','utf8'));console.log(c,Object.keys(j.cities).length,'entries');}const ch=JSON.parse(f.readFileSync('public/cities/enrich/CH.json','utf8'));console.log('Zermatt:',JSON.stringify(ch.cities.G2657928));"
  ```

  Expected: each country reports between 20 and 30 entries, and `Zermatt:` prints an object with a non-null `description` mentioning Zermatt and an `image` URL ending `?width=640`.

- [ ] **Step 6: Run the enrichment for every country**

  ```bash
  node scripts/enrich-cities.mjs
  ```

  Expected: `Enriching 6244 cities across 246 countries…` then a final line of the form `Wrote 246 enrichment files to …/public/cities/enrich (246 changed, N cities enriched, 0 unasked)`. Runtime is roughly 5–10 minutes, dominated by the 42 SPARQL batches and ~310 Action API batches with their politeness delays.

  `0 unasked` is the number to read: anything else means a SPARQL batch failed, and those cities kept their previous enrichment rather than losing it. A run that aborts with `enrichment coverage fell to …` is `assertEnrichmentSane` doing its job — rerun later rather than working around it.

- [ ] **Step 7: Commit**

  ```bash
  git add scripts/enrich-cities.mjs scripts/enrich-cities.test.ts public/cities/enrich
  git commit -m "feat: enrich the top 30 cities per country from Wikidata P1566"
  ```

---

## Task 8: `lib/cityShard.ts` — the client-side shard contract

**Files:**
- Create: `lib/cityShard.ts`
- Test: `lib/cityShard.test.ts`

**Interfaces:**
- Consumes: `MapCity` from `lib/tripShared.ts` (existing, unchanged: `{ qid, name, localName, province, lat, lon, population, level, attractionCount, blurb }`); `isCountryCode` from `lib/countries.ts` (`export function isCountryCode(s: string): boolean`).
- Produces:
  - `export const CITY_SHARD_INDEX_PATH = "/cities/index.json"`
  - `export function cityShardPath(country: string): string`
  - `export function cityEnrichmentPath(country: string): string`
  - `export interface CityShardRow { id: string; n: string; lat: number; lon: number; a1: string | null; p: number; tz: string }`
  - `export interface CityShard { country: string; generatedAt: string; source: string; cities: CityShardRow[] }`
  - `export interface CityEnrichment { description: string | null; image: string | null }`
  - `export type CityEnrichmentIndex = Readonly<Record<string, CityEnrichment>>`
  - `export function parseCityShard(raw: unknown, expectedCountry?: string): CityShard` — throws. The second parameter is spec §6's fixture invariant made executable: a shard is identified by its URL *and* by its envelope, and the two must agree.
  - `export function parseCityEnrichment(raw: unknown): CityEnrichmentIndex` — drops, never throws
  - `export function cityLevel(population: number): "municipality" | "prefecture" | "county"`
  - `export function shardRowToMapCity(row: CityShardRow, enrichment: CityEnrichmentIndex): MapCity`
  - `export async function fetchCityShard(country: string, signal?: AbortSignal): Promise<CityShard>`
  - `export async function fetchCityEnrichment(country: string, signal?: AbortSignal): Promise<CityEnrichmentIndex>`

Two deliberate asymmetries, both matching existing precedent in this repo:
- `parseCityShard` **throws** (like `parseWorldTopology` in `lib/isoTopology.ts:114-116` and `parseGlobeTopology`), because a silently partial parse renders a picker that is quietly missing cities.
- `parseCityEnrichment` **drops bad entries and never throws** (like `readCountryImageIndex` in `lib/countryImagery.ts:153-174`), because a city with no description is already an accepted state and losing the whole file over one malformed entry is worse.

- [ ] **Step 1: Write the failing test**

  Create `lib/cityShard.test.ts` with exactly this content:

```typescript
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import {
  CITY_SHARD_INDEX_PATH,
  cityEnrichmentPath,
  cityLevel,
  cityShardPath,
  fetchCityEnrichment,
  fetchCityShard,
  parseCityEnrichment,
  parseCityShard,
  shardRowToMapCity,
  type CityShardRow,
} from "./cityShard";

const row = (over: Partial<CityShardRow> & Pick<CityShardRow, "id">): CityShardRow => ({
  n: "Cusco",
  lat: -13.52264,
  lon: -71.96734,
  a1: "Cusco",
  p: 428_450,
  tz: "America/Lima",
  ...over,
});

describe("shard paths", () => {
  test("are root-relative so a fetch resolves the same from every route", () => {
    // The same rule lib/isoTopology.ts and lib/globeTopology.ts pin for their
    // own assets: /plan and /trip/:id are at different depths.
    expect(cityShardPath("PE")).toBe("/cities/PE.json");
    expect(cityEnrichmentPath("PE")).toBe("/cities/enrich/PE.json");
    expect(CITY_SHARD_INDEX_PATH).toBe("/cities/index.json");
  });

  test("normalise the code the way getCountry does", () => {
    expect(cityShardPath(" pe ")).toBe("/cities/PE.json");
  });

  test("refuse anything that is not a two-letter code", () => {
    // The value reaches a URL. A country of "../../world-globe" would resolve
    // out of /cities/ entirely.
    expect(() => cityShardPath("../world-globe")).toThrow(/not a country code/);
    expect(() => cityShardPath("")).toThrow(/not a country code/);
    expect(() => cityEnrichmentPath("PER")).toThrow(/not a country code/);
  });
});

describe("parseCityShard", () => {
  const shard = { country: "PE", generatedAt: "2026-08-25", source: "GeoNames", cities: [row({ id: "G1" })] };

  test("accepts a well-formed shard", () => {
    expect(parseCityShard(shard).cities).toHaveLength(1);
  });

  test("throws rather than returning a half-parsed shard", () => {
    // A silently partial parse renders a picker quietly missing cities, which
    // is the failure lib/globeTopology.ts documents for its own asset.
    expect(() => parseCityShard(null)).toThrow(/city shard: root is not an object/);
    expect(() => parseCityShard({ ...shard, country: 7 })).toThrow(/country is not a country code/);
    expect(() => parseCityShard({ ...shard, cities: {} })).toThrow(/cities is not an array/);
  });

  test("throws when a row is missing a field the map needs", () => {
    expect(() => parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), lat: "-13" }] })).toThrow(
      /row 0 has a non-finite lat/
    );
    expect(() => parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), id: 1 }] })).toThrow(
      /row 0 has a malformed id/
    );
    expect(() => parseCityShard({ ...shard, cities: [{ ...row({ id: "Q170247" }) }] })).toThrow(
      /row 0 has a malformed id/
    );
  });

  test("throws on an out-of-range coordinate rather than trusting finiteness", () => {
    expect(() => parseCityShard({ ...shard, cities: [row({ id: "G1", lat: 394.5 })] })).toThrow(
      /row 0 has a non-finite lat/
    );
  });

  test("accepts a null a1, and coerces a missing or empty one to null", () => {
    const parse = (a1: unknown) =>
      parseCityShard({ ...shard, cities: [{ ...row({ id: "G1" }), a1 }] }).cities[0].a1;
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
    // Empty string too: `a1` renders as MapCity.province, and "" would draw an
    // empty separator where a province name belongs.
    expect(parse("")).toBeNull();
    expect(parse("Cusco")).toBe("Cusco");
  });

  test("rejects a shard whose envelope names a different country than was asked for", () => {
    // Spec §6's fixture invariant, with teeth. Nothing downstream reads
    // `country` — fetchCityShard hands only `cities` to its callers — so a
    // CDN rewrite, a stale cache entry or a mis-copied fixture that serves
    // Peru's rows under /cities/JP.json would draw Peruvian cities on Japan's
    // map with every test still green. That is precisely the shape of PR #17's
    // inside-out globe fixture, and the only defence is a field that is
    // actually read.
    expect(() => parseCityShard(shard, "JP")).toThrow(/is PE's shard, but JP was requested/);
    expect(() => parseCityShard(shard, "pe")).not.toThrow();
    expect(() => parseCityShard(shard)).not.toThrow();
  });

  test("names the file in every message, so a browser error says which asset", () => {
    expect(() => parseCityShard(undefined)).toThrow(/^city shard:/);
  });
});

describe("fetchCityShard / fetchCityEnrichment", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("a missing enrichment file is an empty index; a missing shard is an error", async () => {
    // The asymmetry the module's docblock claims, exercised rather than
    // asserted in prose: the shard is required and the enrichment is not.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchCityEnrichment("PE")).resolves.toEqual({});
    await expect(fetchCityShard("PE")).rejects.toThrow(/city shard \/cities\/PE\.json: 404/);
  });

  test("passes the requested country through to the parser", async () => {
    // What makes the invariant above reach production rather than only the
    // fixtures: the URL and the envelope are checked against each other on
    // every real fetch.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ country: "PE", generatedAt: "x", source: "y", cities: [] }),
      }))
    );
    await expect(fetchCityShard("JP")).rejects.toThrow(/is PE's shard, but JP was requested/);
  });
});

describe("parseCityEnrichment", () => {
  test("reads the wrapped file", () => {
    const parsed = parseCityEnrichment({
      country: "CH",
      generatedAt: "x",
      source: "y",
      cities: { G2657928: { description: "Zermatt is a municipality.", image: "https://x/z.jpg" } },
    });
    expect(parsed.G2657928).toEqual({
      description: "Zermatt is a municipality.",
      image: "https://x/z.jpg",
    });
  });

  test("drops instead of throwing, so one bad entry does not cost the file", () => {
    // The opposite policy from parseCityShard, and for the same reason
    // lib/countryImagery.ts gives: a city with no description already renders,
    // so degrading beats failing.
    const parsed = parseCityEnrichment({
      cities: {
        G1: { description: "kept", image: null },
        G2: { description: 7, image: null },
        "not-an-id": { description: "dropped", image: null },
        G3: "not an object",
      },
    });
    expect(Object.keys(parsed)).toEqual(["G1"]);
  });

  test("is an empty index for anything unreadable, never a throw", () => {
    expect(parseCityEnrichment(null)).toEqual({});
    expect(parseCityEnrichment({ cities: [] })).toEqual({});
    expect(parseCityEnrichment("<html>login</html>")).toEqual({});
  });
});

describe("cityLevel", () => {
  test("maps population onto the three levels the map already draws", () => {
    // MapCity.level is a closed union that drives marker radius and labelling
    // in CountryMap.tsx:227-233. GeoNames has no equivalent field, and
    // population is the only signal in the seven-field record that carries the
    // same meaning — how prominent a marker should be.
    expect(cityLevel(7_737_002)).toBe("municipality");
    expect(cityLevel(1_000_000)).toBe("municipality");
    expect(cityLevel(999_999)).toBe("prefecture");
    expect(cityLevel(200_000)).toBe("prefecture");
    expect(cityLevel(199_999)).toBe("county");
    expect(cityLevel(0)).toBe("county");
  });
});

describe("shardRowToMapCity", () => {
  test("carries the enrichment blurb when there is one", () => {
    const city = shardRowToMapCity(row({ id: "G3941584" }), {
      G3941584: { description: "Cusco is a city in southeastern Peru.", image: null },
    });
    expect(city).toEqual({
      // `qid` is the field name MapCity has always used; §3.3 keeps
      // CatalogHit's shape unchanged, so a GeoNames id rides in it. The
      // G prefix is what keeps the two namespaces apart.
      qid: "G3941584",
      name: "Cusco",
      localName: null,
      province: "Cusco",
      lat: -13.52264,
      lon: -71.96734,
      population: 428_450,
      level: "prefecture",
      attractionCount: 0,
      blurb: "Cusco is a city in southeastern Peru.",
    });
  });

  test("leaves the blurb null for an unenriched city", () => {
    // Which renders exactly as a thin catalog city does today — an accepted
    // state in the current UI, not a hole.
    expect(shardRowToMapCity(row({ id: "G1" }), {}).blurb).toBeNull();
  });

  test("reports population zero as zero, not as null", () => {
    // 30,648 of the real rows carry an explicit 0. `population: null` means
    // "unknown" to lib/feasibility and the marker sizing; 0 means "nobody
    // lives here", and the two must not be confused.
    expect(shardRowToMapCity(row({ id: "G1", p: 0 }), {}).population).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The committed shards
// ---------------------------------------------------------------------------

const SHARD_DIR = join(process.cwd(), "public", "cities");
const INDEX_ASSET = join(SHARD_DIR, "index.json");

/**
 * The shards are committed build artefacts, not source — `npm ci` does not
 * produce them and `scripts/ingest-cities.mjs` needs network egress. Tests
 * that need them skip when they are missing rather than failing, exactly as
 * lib/isoTopology.test.ts and lib/globeTopology.test.ts do, so a checkout
 * without them is honest about what went unchecked instead of red for the
 * wrong reason.
 */
const hasAssets = existsSync(INDEX_ASSET);
const index = hasAssets
  ? (JSON.parse(readFileSync(INDEX_ASSET, "utf8")) as {
      countries: { code: string; count: number; generatedAt: string }[];
    })
  : null;

describe.skipIf(!hasAssets)("the committed city shards", () => {
  it("covers 246 countries", () => {
    // cities500 has 246, not cities15000's 244 — it adds IO (2 cities) and TK
    // (3). A count assertion written against the old dump would pass here and
    // hide two missing shards.
    expect(index!.countries).toHaveLength(246);
    expect(index!.countries.map((c) => c.code)).toContain("IO");
    expect(index!.countries.map((c) => c.code)).toContain("TK");
  });

  it("has a file for every country the index names, and no orphans", () => {
    // The fixture invariant §6 states: every city must have a country present
    // in the shard index. Enforced here at the file level, so an index entry
    // pointing at a 404 cannot pass.
    const named = new Set(index!.countries.map((c) => `${c.code}.json`));
    const onDisk = new Set(readdirSync(SHARD_DIR).filter((f) => f.endsWith(".json") && f !== "index.json"));
    expect([...named].filter((f) => !onDisk.has(f)).sort()).toEqual([]);
    expect([...onDisk].filter((f) => !named.has(f)).sort()).toEqual([]);
  });

  it("parses every shard, with the counts the index promises", () => {
    const mismatched: string[] = [];
    for (const entry of index!.countries) {
      const shard = parseCityShard(
        JSON.parse(readFileSync(join(SHARD_DIR, `${entry.code}.json`), "utf8"))
      );
      if (shard.cities.length !== entry.count || shard.country !== entry.code) {
        mismatched.push(entry.code);
      }
    }
    expect(mismatched, `index disagrees with the shard for: ${mismatched.join(", ")}`).toEqual([]);
  });

  it("keeps every shard inside a single fetch a user will not notice", () => {
    // Measured: AR is the largest at 97,008 bytes raw / 21,647 gzipped. The
    // budget is what makes §3.2's "no loading state beyond what the map
    // already has" a checked claim rather than an aspiration.
    const oversized = index!.countries
      .map((c) => [c.code, statSync(join(SHARD_DIR, `${c.code}.json`)).size] as const)
      .filter(([, bytes]) => bytes > 150_000);
    expect(oversized, `oversized shards: ${JSON.stringify(oversized)}`).toEqual([]);
  });

  it("reaches the destinations population alone excluded", () => {
    // The 14 towns §2 names are the reason this design exists. Asserted by
    // geonameid, because Peru has two cities called Cusco.
    const has = (country: string, id: string) =>
      parseCityShard(
        JSON.parse(readFileSync(join(SHARD_DIR, `${country}.json`), "utf8"))
      ).cities.some((c) => c.id === id);
    expect(has("PE", "G3941584"), "Cusco").toBe(true);
    expect(has("CH", "G2657928"), "Zermatt").toBe(true);
    expect(has("JP", "G1857910"), "Kyoto").toBe(true);
    expect(has("JO", "G246008"), "Wadi Musa (Petra)").toBe(true);
    expect(has("GR", "G252920"), "Fira (Santorini)").toBe(true);
  });

  it("gives every shard file an envelope that names its own filename", () => {
    // The other half of the invariant above, at the file level: a shard whose
    // `country` disagrees with its path would be rejected at run time by
    // fetchCityShard, so it must never be committed in the first place.
    const wrong = index!.countries
      .map((c) => c.code)
      .filter((code) => {
        const raw = JSON.parse(readFileSync(join(SHARD_DIR, `${code}.json`), "utf8")) as {
          country?: string;
        };
        return raw.country !== code;
      });
    expect(wrong, `shards whose envelope disagrees with their filename: ${wrong.join(", ")}`).toEqual(
      []
    );
  });

  it("keeps GeoNames out of Wikidata's namespace everywhere", () => {
    // §3.3: merging the two id namespaces silently would be a real bug, since
    // MapExplorer.togglePlace resolves a tap by matching this field.
    const offenders: string[] = [];
    for (const entry of index!.countries) {
      const shard = JSON.parse(readFileSync(join(SHARD_DIR, `${entry.code}.json`), "utf8")) as {
        cities: { id: string }[];
      };
      for (const city of shard.cities) {
        if (!/^G[1-9][0-9]*$/.test(city.id)) offenders.push(`${entry.code}:${city.id}`);
      }
    }
    expect(offenders.slice(0, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node lib/cityShard.test.ts
  ```

  Expected — measured, not paraphrased: the run fails at collection with

  ```
  Error: Cannot find module './cityShard' imported from …/lib/cityShard.test.ts
   Test Files  1 failed (1)
        Tests  no tests
  ```

- [ ] **Step 3: Write the minimal implementation**

  Create `lib/cityShard.ts` with exactly this content:

```typescript
import { isCountryCode } from "./countries";
import type { MapCity } from "./tripShared";

/**
 * The client's side of the worldwide city catalog.
 *
 * Cities are per-country static files under `public/`, fetched by the browser
 * when a country is picked — not read by a route handler. `public/` is not
 * readable from a Vercel lambda, so a server-side `fs` read of a shard works
 * locally and 500s in production (spec §3.2). The server's copy of the data is
 * the bundled `data/cities-index.json`, bound in `lib/server/cityIndex.ts`.
 *
 * Measured: the largest shard (AR) is 21.6 KB gzipped and the median is under
 * 12 KB, which is what makes on-demand fetching need no loading state beyond
 * what the map already has.
 */

/** Root-relative so the fetch resolves the same from every route. */
export const CITY_SHARD_INDEX_PATH = "/cities/index.json";

function normaliseCountry(country: string, what: string): string {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!isCountryCode(code)) {
    throw new Error(`${what}: "${country}" is not a country code — expected two letters`);
  }
  return code;
}

/**
 * Validated rather than interpolated, because this value reaches a URL: a
 * country of "../world-globe" would resolve out of /cities/ entirely and hand
 * the shard parser a topology.
 */
export function cityShardPath(country: string): string {
  return `/cities/${normaliseCountry(country, "cityShardPath")}.json`;
}

export function cityEnrichmentPath(country: string): string {
  return `/cities/enrich/${normaliseCountry(country, "cityEnrichmentPath")}.json`;
}

/** The seven-field record `scripts/ingest-cities.mjs` emits. */
export interface CityShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  /** Admin-1 name, already resolved from GeoNames' code. Null when it has none. */
  a1: string | null;
  p: number;
  tz: string;
}

export interface CityShard {
  country: string;
  generatedAt: string;
  source: string;
  /** Population descending — display order, never score order (spec §3.2). */
  cities: CityShardRow[];
}

export interface CityEnrichment {
  description: string | null;
  image: string | null;
}

/** Keyed by the `G`-prefixed GeoNames id. */
export type CityEnrichmentIndex = Readonly<Record<string, CityEnrichment>>;

const GEONAMES_ID = /^G[1-9][0-9]*$/;

function fail(detail: string): never {
  throw new Error(`city shard: ${detail}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function degrees(value: unknown, limit: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= -limit && value <= limit
    ? value
    : null;
}

/**
 * Throws rather than degrading, the same policy `parseWorldTopology` and
 * `parseGlobeTopology` take: a silently partial parse renders a picker that is
 * quietly missing cities, and nothing downstream can tell that from a country
 * that genuinely has few.
 */
export function parseCityShard(raw: unknown, expectedCountry?: string): CityShard {
  const root = asRecord(raw);
  if (!root) fail("root is not an object");
  const country = typeof root.country === "string" ? root.country.trim().toUpperCase() : "";
  if (!isCountryCode(country)) fail(`country is not a country code (${JSON.stringify(root.country)})`);
  // A shard is identified by its URL AND by its envelope, and the two must
  // agree. Nothing downstream reads this field — callers take `cities` and
  // nothing else — so a cache entry, a CDN rewrite or a mis-copied fixture
  // that served one country's rows under another country's path would be
  // completely invisible: Peru's cities would draw on Japan's map and every
  // test would stay green. That is spec §6's fixture invariant, and it is the
  // shape of PR #17's inside-out globe fixture. `isCountryCode` is only
  // `/^[A-Za-z]{2}$/`, so it would happily accept "JP" on Peru's file.
  if (expectedCountry !== undefined) {
    const wanted = expectedCountry.trim().toUpperCase();
    if (country !== wanted) fail(`is ${country}'s shard, but ${wanted} was requested`);
  }
  if (!Array.isArray(root.cities)) fail("cities is not an array");

  const cities: CityShardRow[] = root.cities.map((entry, i) => {
    const city = asRecord(entry);
    if (!city) fail(`row ${i} is not an object`);
    if (typeof city.id !== "string" || !GEONAMES_ID.test(city.id)) {
      fail(`row ${i} has a malformed id (${JSON.stringify(city.id)}) — expected "G" + digits`);
    }
    if (typeof city.n !== "string" || city.n.trim() === "") fail(`row ${i} has an empty name`);
    // Range-checked, not merely finite: haversine's trig is periodic, so a
    // latitude of 394.5 silently behaves as 34.5 and the city relocates to a
    // believable wrong place rather than erroring.
    const lat = degrees(city.lat, 90);
    if (lat === null) fail(`row ${i} has a non-finite lat (${JSON.stringify(city.lat)})`);
    const lon = degrees(city.lon, 180);
    if (lon === null) fail(`row ${i} has a non-finite lon (${JSON.stringify(city.lon)})`);
    if (typeof city.p !== "number" || !Number.isFinite(city.p) || city.p < 0) {
      fail(`row ${i} has a non-finite population (${JSON.stringify(city.p)})`);
    }
    return {
      id: city.id,
      n: city.n,
      lat,
      lon,
      a1: typeof city.a1 === "string" && city.a1 !== "" ? city.a1 : null,
      p: city.p,
      tz: typeof city.tz === "string" ? city.tz : "",
    };
  });

  return {
    country,
    generatedAt: typeof root.generatedAt === "string" ? root.generatedAt : "",
    source: typeof root.source === "string" ? root.source : "",
    cities,
  };
}

/**
 * Drops bad entries and never throws — the opposite of `parseCityShard`, and
 * for the reason `readCountryImageIndex` gives for the same split: a city with
 * no description already renders exactly as a thin catalog city does, so
 * degrading costs a blurb while failing costs the whole country.
 */
export function parseCityEnrichment(raw: unknown): CityEnrichmentIndex {
  const root = asRecord(raw);
  const entries = asRecord(root?.cities);
  if (!entries) return {};
  const index: Record<string, CityEnrichment> = {};
  for (const [id, value] of Object.entries(entries)) {
    if (!GEONAMES_ID.test(id)) continue;
    const entry = asRecord(value);
    if (!entry) continue;
    const description = typeof entry.description === "string" ? entry.description : null;
    const image = typeof entry.image === "string" ? entry.image : null;
    if (description === null && image === null) continue;
    index[id] = { description, image };
  }
  return index;
}

/** A million people is a municipality; 200,000 is a prefecture. */
const MUNICIPALITY_POPULATION = 1_000_000;
const PREFECTURE_POPULATION = 200_000;

/**
 * `MapCity.level` for a GeoNames city.
 *
 * The union is China's administrative vocabulary and it stays, because it is
 * what `CountryMap.tsx`'s `radiusFor` and `labelFor` already switch on — the
 * levels are marker prominence, not governance. Population is the only field
 * in the seven-field record that carries that meaning, and the thresholds are
 * chosen so a GeoNames city draws at the same size as a Chinese one of the
 * same weight.
 */
export function cityLevel(population: number): MapCity["level"] {
  if (population >= MUNICIPALITY_POPULATION) return "municipality";
  if (population >= PREFECTURE_POPULATION) return "prefecture";
  return "county";
}

export function shardRowToMapCity(row: CityShardRow, enrichment: CityEnrichmentIndex): MapCity {
  return {
    // `qid` is MapCity's existing field name and §3.3 keeps the shape
    // unchanged, so the `G`-prefixed GeoNames id rides in it. The prefix is
    // the whole of what keeps the two namespaces apart.
    qid: row.id,
    name: row.n,
    // GeoNames' `name` column is already the local endonym for most places and
    // the dump carries no separate romanisation worth showing beside it.
    localName: null,
    province: row.a1,
    lat: row.lat,
    lon: row.lon,
    // 0 is a real population for 30,648 rows and must not become `null`, which
    // means "unknown" to marker sizing and to lib/feasibility.
    population: row.p,
    level: cityLevel(row.p),
    // GeoNames has no attractions layer; the QID catalog is the only source of
    // those, and it is China-only.
    attractionCount: 0,
    blurb: enrichment[row.id]?.description ?? null,
  };
}

/**
 * Fetches and validates one country's shard.
 *
 * No module-level cache: the response carries a 6h `Cache-Control` plus a day
 * of `stale-while-revalidate` from `next.config.ts` (Task 17), so the browser's
 * own cache serves the second caller, and a cache here would need a test-only
 * reset hook and would leak between tests.
 *
 * A signed-out request is redirected to /login by `proxy.ts` and `fetch`
 * follows it, so `res.ok` is true and `res.json()` rejects on the login page's
 * `<`. That rejection is the correct outcome — the picker only renders on
 * `/plan`, which is behind the wall anyway — and callers already treat any
 * rejection as "no shard".
 */
export async function fetchCityShard(country: string, signal?: AbortSignal): Promise<CityShard> {
  const path = cityShardPath(country);
  const response = await fetch(path, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`city shard ${path}: ${response.status}`);
  // The country is passed through, so the URL and the envelope are checked
  // against each other on every real fetch — not only in fixtures.
  return parseCityShard(await response.json(), country);
}

/** Never rejects for a country that simply has no enrichment file. */
export async function fetchCityEnrichment(
  country: string,
  signal?: AbortSignal
): Promise<CityEnrichmentIndex> {
  const path = cityEnrichmentPath(country);
  const response = await fetch(path, signal ? { signal } : undefined);
  if (!response.ok) return {};
  return parseCityEnrichment(await response.json());
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node lib/cityShard.test.ts && npx tsc --noEmit
  ```

  Expected: `Test Files  1 passed (1)`, `Tests  26 passed (26)`, and `tsc` prints nothing. (22 as originally scoped, plus the shard-envelope check, the two `fetchCity*` cases and the committed-shards envelope scan.)

- [ ] **Step 5: Commit**

  ```bash
  git add lib/cityShard.ts lib/cityShard.test.ts
  git commit -m "feat: add the client-side city shard contract and its parsers"
  ```

---

## Task 9: `lib/server/cityIndex.ts` — the bundled index the lambda can read

**Files:**
- Create: `lib/geoNamesId.ts`
- Create: `lib/server/cityIndex.ts`
- Test: `lib/server/cityIndex.test.ts`

**Interfaces:**
- Consumes: `data/cities-index.json` (Task 6), `CountryCode` from `lib/types.ts` (`export type CountryCode = string`).
- Produces:
  - `lib/geoNamesId.ts`: `export function isGeoNamesId(id: string): boolean`
  - `lib/server/cityIndex.ts`: `export { isGeoNamesId } from "../geoNamesId";` — one definition, two import paths, so `lib/server/catalog.ts` and this file's own test keep importing it from `./cityIndex` unchanged.
  - `export interface CityIndexEntry { id: string; name: string; country: CountryCode; lat: number; lon: number; region: string | null }`
  - `export function readCityIndex(raw: unknown): Map<string, CityIndexEntry>`
  - `export function cityIndexEntry(id: string): CityIndexEntry | null`
  - `export function cityIndexStatus(): { cities: number; generatedAt: string }`

Why this exists rather than a shard read: `public/` is unreadable from a Vercel lambda, and `/api/destinations/resolve?ids=G3941584` has to turn a picked id into a full `Destination` server-side. The bundled file is 3,672,345 bytes and parses in 22 ms — the same mechanism `lib/server/airports.ts:11-24` documents for its 877 KB artifact, one order of magnitude up. Tuples rather than objects: the same data as an object map is 4.35 MB.

- [ ] **Step 1: Write the failing test**

  Create `lib/server/cityIndex.test.ts` with exactly this content:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, test } from "vitest";
import { cityIndexEntry, cityIndexStatus, isGeoNamesId, readCityIndex } from "./cityIndex";

describe("isGeoNamesId", () => {
  test("accepts a G-prefixed geonameid and nothing else", () => {
    // The one discriminator between the two id namespaces §3.3 keeps apart.
    // `resolveDestinations` branches on it, so a false positive resolves a
    // Wikidata city out of the GeoNames index and finds nothing.
    expect(isGeoNamesId("G3941584")).toBe(true);
    expect(isGeoNamesId("Q170247")).toBe(false);
    expect(isGeoNamesId("3941584")).toBe(false);
    expect(isGeoNamesId("beijing")).toBe(false);
    expect(isGeoNamesId("offmap:grandmas-village")).toBe(false);
    expect(isGeoNamesId("G0")).toBe(false);
    expect(isGeoNamesId("G")).toBe(false);
    expect(isGeoNamesId("g3941584")).toBe(false);
  });
});

describe("readCityIndex", () => {
  const raw = {
    generatedAt: "2026-08-25T00:00:00.000Z",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      ["G3941584", "Cusco", "PE", -13.52264, -71.96734, "Cusco"],
      ["G2657928", "Zermatt", "CH", 46.01998, 7.74863, "Valais"],
    ],
  };

  test("keys the tuples by id", () => {
    const index = readCityIndex(raw);
    expect(index.get("G3941584")).toEqual({
      id: "G3941584",
      name: "Cusco",
      country: "PE",
      lat: -13.52264,
      lon: -71.96734,
      region: "Cusco",
    });
    expect(index.size).toBe(2);
  });

  test("returns a Map, so an id spelled like an Object member cannot resolve through the prototype", () => {
    // The ids here come off the wire — `/api/destinations/resolve?ids=` is a
    // query string. A plain object would answer `index['constructor']` with a
    // function, and `?? null` would never catch it.
    const index = readCityIndex(raw);
    expect(index.get("constructor")).toBeUndefined();
    expect(index.get("__proto__")).toBeUndefined();
  });

  test("drops a malformed tuple rather than emitting a half-city", () => {
    // Degrades rather than throws: this parses at module load, and a throw
    // here takes down every route that imports the catalog, including the ones
    // that never touch a GeoNames city.
    const index = readCityIndex({
      cities: [
        ["G1", "Fine", "PE", 1, 2, null],
        ["Q2", "Wrong namespace", "PE", 1, 2, null],
        ["G3", "", "PE", 1, 2, null],
        ["G4", "No country", "PER", 1, 2, null],
        ["G5", "Bad coords", "PE", "1", 2, null],
        ["G6"],
        "not a tuple",
      ],
    });
    expect([...index.keys()]).toEqual(["G1"]);
  });

  test("is an empty map for anything unreadable", () => {
    expect(readCityIndex(null).size).toBe(0);
    expect(readCityIndex({ cities: {} }).size).toBe(0);
    expect(readCityIndex("<html>login</html>").size).toBe(0);
  });

  test("keeps a null region as null, and does not invent one from an empty string", () => {
    // `region` becomes `Destination.region`, which the plan card renders. The
    // guard is `typeof region === "string" && region !== ""`, so all three of
    // these have to collapse to the same honest null.
    const index = readCityIndex({
      cities: [
        ["G1", "Nowhere", "PE", 1, 2, null],
        ["G2", "Blank", "PE", 1, 2, ""],
        ["G3", "Not a region at all", "PE", 1, 2, 7],
      ],
    });
    expect(index.get("G1")!.region).toBeNull();
    expect(index.get("G2")!.region).toBeNull();
    expect(index.get("G3")!.region).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The committed index
// ---------------------------------------------------------------------------

const INDEX_ASSET = join(process.cwd(), "data", "cities-index.json");
const hasAsset = existsSync(INDEX_ASSET);

describe.skipIf(!hasAsset)("the bundled city index", () => {
  it("holds every city the shards do", () => {
    // Banded rather than exact, the same reasoning lib/server/airports.test.ts
    // gives: GeoNames moves nightly, and an exact count would go red for a
    // data refresh rather than for a defect.
    const status = cityIndexStatus();
    expect(status.cities).toBeGreaterThan(55_000);
    expect(status.cities).toBeLessThan(63_000);
    expect(status.generatedAt).not.toBe("");
  });

  it("resolves the destinations the design was validated against", () => {
    // Fixture invariant §6: every fixture city must have a country present in
    // the shard index, which for the server side means resolvable here.
    expect(cityIndexEntry("G3941584")).toMatchObject({ name: "Cusco", country: "PE" });
    expect(cityIndexEntry("G2657928")).toMatchObject({ name: "Zermatt", country: "CH" });
    expect(cityIndexEntry("G1857910")).toMatchObject({ name: "Kyoto", country: "JP" });
  });

  it("does not resolve a Wikidata id, an unknown id, or an Object member", () => {
    expect(cityIndexEntry("Q170247")).toBeNull();
    expect(cityIndexEntry("G999999999")).toBeNull();
    expect(cityIndexEntry("constructor")).toBeNull();
  });

  it("does not carry the city that was deduplicated in favour of a QID record", () => {
    // Jinan's GeoNames row never reaches a shard, so it must never reach the
    // index either — otherwise a stale id would resolve to a thin Jinan while
    // Q170247's rich one sat unused.
    expect(cityIndexEntry("G1805753")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node lib/server/cityIndex.test.ts
  ```

  Expected — measured, not paraphrased: the run fails at collection with

  ```
  Error: Cannot find module './cityIndex' imported from …/lib/server/cityIndex.test.ts
   Test Files  1 failed (1)
        Tests  no tests
  ```

- [ ] **Step 3: Write the minimal implementation**

  First create `lib/geoNamesId.ts` with exactly this content:

```typescript
/**
 * The one discriminator between the GeoNames and Wikidata id namespaces.
 *
 * Its own leaf module rather than a member of lib/server/cityIndex.ts: that
 * file static-imports the 3.5 MB data/cities-index.json, so importing the
 * predicate from it drags the whole artifact into every bundle that wants
 * nothing but a regex. `app/api/cities/enrich/route.ts` (Task 15) is exactly
 * that case — it validates ids and never resolves a city.
 *
 * `resolveDestinations` branches on this, and spec §3.3 calls merging the two
 * namespaces a real bug, so it is anchored at both ends and rejects a bare
 * integer — which is what a GeoNames id looks like before the prefix.
 */
const GEONAMES_ID = /^G[1-9][0-9]*$/;

export function isGeoNamesId(id: string): boolean {
  return typeof id === "string" && GEONAMES_ID.test(id);
}
```

  Then create `lib/server/cityIndex.ts` with exactly this content:

```typescript
import bundledCityIndexJson from "../../data/cities-index.json";
import { isGeoNamesId } from "../geoNamesId";
import type { CountryCode } from "../types";

/**
 * Re-exported so `lib/server/catalog.ts` and this file's own test import it
 * from here unchanged, while modules that want only the predicate can reach
 * `lib/geoNamesId` directly and skip the 3.5 MB import below.
 */
export { isGeoNamesId };

/**
 * Binds the bundled worldwide city index to a lookup the server can use.
 *
 * A static `import` rather than an `fs` read, for the reason
 * lib/server/catalog.ts and lib/server/airports.ts both document: serverless
 * deployments have a read-only filesystem and no data/ directory, so a path
 * read works locally and fails in production. `public/cities/*.json` is
 * emphatically NOT an option here — spec §3.2 makes that a hard constraint,
 * and this file is the reason it can be one.
 *
 * At 3.5 MB the artifact is four times data/airports.json, which is the same
 * mechanism one order of magnitude up rather than a new one. It is stored as
 * tuples rather than objects because the same data as an object map is 4.35 MB
 * and this is parsed once per cold start (measured: 22 ms).
 *
 * Server-only by convention, like lib/server/catalog.ts — importing it from a
 * client component would pull 3.5 MB into the browser bundle. The client's
 * side of the same data is one 20 KB shard, in lib/cityShard.ts.
 */

export interface CityIndexEntry {
  id: string;
  name: string;
  country: CountryCode;
  lat: number;
  lon: number;
  /**
   * Admin-1 name — the region label meaningful inside this city's own country,
   * which is exactly what `Destination.region` is (`lib/types.ts:57-63`).
   */
  region: string | null;
}

interface CityIndexArtifact {
  generatedAt: string;
  source: string;
  cities: unknown[];
}

const GEONAMES_ID = /^G[1-9][0-9]*$/;

/**
 * Degrades rather than throws, unlike `parseCityShard`.
 *
 * This runs at module load inside every API route that imports the catalog.
 * A throw here takes down `/api/trips` and `/api/trips/[id]` — routes that
 * never touch a GeoNames city — over one bad tuple.
 */
export function readCityIndex(raw: unknown): Map<string, CityIndexEntry> {
  const index = new Map<string, CityIndexEntry>();
  const root = typeof raw === "object" && raw !== null ? (raw as CityIndexArtifact) : null;
  if (!root || !Array.isArray(root.cities)) return index;
  for (const tuple of root.cities) {
    if (!Array.isArray(tuple) || tuple.length < 6) continue;
    const [id, name, country, lat, lon, region] = tuple as unknown[];
    if (typeof id !== "string" || !GEONAMES_ID.test(id)) continue;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof country !== "string" || !/^[A-Z]{2}$/.test(country)) continue;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) continue;
    index.set(id, {
      id,
      name,
      country,
      lat,
      lon,
      region: typeof region === "string" && region !== "" ? region : null,
    });
  }
  return index;
}

const artifact = bundledCityIndexJson as unknown as CityIndexArtifact;

/**
 * Built on first use rather than at import: the 59,073 Map inserts cost about
 * 15 ms, and a route that never resolves a GeoNames city should not pay them.
 */
let index: Map<string, CityIndexEntry> | null = null;

function loadIndex(): Map<string, CityIndexEntry> {
  if (!index) index = readCityIndex(artifact);
  return index;
}

/**
 * A Map lookup, not an object index: these ids arrive off the wire through
 * `/api/destinations/resolve?ids=`, and a plain object would answer
 * `index["constructor"]` with a function that `?? null` cannot catch.
 */
export function cityIndexEntry(id: string): CityIndexEntry | null {
  return loadIndex().get(id) ?? null;
}

export function cityIndexStatus(): { cities: number; generatedAt: string } {
  return { cities: loadIndex().size, generatedAt: artifact.generatedAt ?? "" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node lib/server/cityIndex.test.ts && npx tsc --noEmit
  ```

  Expected: `Test Files  1 passed (1)`, `Tests  10 passed (10)`, and `tsc` prints nothing.

  Also record the typecheck cost, because six later steps gate on `tsc`: `data/cities-index.json` is 3.67 MB and `resolveJsonModule` infers a literal type per tuple. Measured on a synthetic index of the same shape under this repo's exact `tsconfig.json` and TypeScript 7.0.2: **+0.7–0.9 s, no errors**. If the real delta is materially worse, widen the import at its one site with `as unknown as CityIndexArtifact` (it is already cast that way below) or move the artifact behind a `.d.ts` declaring `cities: unknown[]`.

- [ ] **Step 5: Commit**

  ```bash
  git add lib/geoNamesId.ts lib/server/cityIndex.ts lib/server/cityIndex.test.ts
  git commit -m "feat: bind the bundled city index so a lambda can resolve a picked city"
  ```

---

## Task 10: Gate 2 — every destination states its country, and no `?? "CN"` survives

**Files:**
- Modify: `lib/types.ts:64-65`
- Modify: `lib/data/north.ts:6`, `lib/data/east.ts:6`, `lib/data/west.ts:6`, `lib/data/south.ts:6` (one line per destination object, 16 in total)
- Modify: `components/DestinationStep.tsx:62-71`, `:115-131`
- Modify: `components/map/MapExplorer.tsx:174-179`
- Modify: `app/plan/page.tsx:108-133`
- Modify: `lib/tripShared.ts:17-25` (comment only)
- Modify: `lib/server/catalog.ts:8` (import), `:19` (`CatalogCity.country`), `:68-82` (`normaliseCatalog`), `:292` (`catalogCityToDestination`'s returned object)
- Test: `lib/data/destinations.test.ts` (create)
- Test: `lib/tripShared.test.ts` — **already exists with 13 tests; append to one docblock only. Do NOT create or overwrite it.**

**Interfaces:**
- Consumes: `CountryCode` (`lib/countries.ts:2`, `export type CountryCode = string`).
- Produces:
  - `Destination.country: CountryCode` — **required**, no longer optional.
  - `CatalogCity.country: CountryCode` — required, defaulted to `"CN"` at the one read boundary.

**Why `lib/server/catalog.ts` is touched here and not left to Task 11.** `catalogCityToDestination` (`lib/server/catalog.ts:261`) returns a `Destination` literal with **no `country` property**. The instant `Destination.country` becomes required, that is `TS2741: Property 'country' is missing in type … but required in type 'Destination'` — a real error, not a missed data file, and no amount of re-running the bulk edit below fixes it. So the field, its read-boundary default and its one use land together here; Task 11 then only changes `regionFor`'s signature at that same line.

Making the field required is the whole mechanism. Spec §5 asks that "a future destination cannot silently claim China"; a `?? "CN"` scattered across four files cannot enforce that, but a required field makes the compiler do it — every one of the five `?? "CN"` sites the recon found becomes a type error until it is given a real answer, and there is nowhere left for a new destination to omit one.

The five sites, and what each becomes:

| site | today | after |
|---|---|---|
| `components/DestinationStep.tsx:69` | `(d.country ?? "CN") === activeCountry.code` | `d.country === activeCountry.code` |
| `components/DestinationStep.tsx:121` | `country: curatedHit.country ?? "CN"` | `country: curatedHit.country` |
| `components/DestinationStep.tsx:126` | `country: off.country ?? "CN"` | `country: off.country` |
| `components/DestinationStep.tsx:130` | `country: "CN"` (hard-coded, no `??`) | `country` — the active country prop |
| `components/map/MapExplorer.tsx:178` | `(d.country ?? "CN") === countryCode` | `d.country === countryCode` |
| `app/plan/page.tsx:119` | `country: "CN"` on a new off-map place | `country` — the active country state |

`lib/tripShared.ts:24`'s `?? "CN"` is **deliberately kept**, and this task pins it with a test. It is not one of the UI gates: `TripInput.country` is optional because trips saved before the field existed have none, and its own docblock says the `?? "CN"` "is what removes the need for a backfill". Removing it would reclassify every legacy trip as country-less rather than as Chinese, which is a data bug, not a gate.

- [ ] **Step 1: Write the failing tests**

  Create `lib/data/destinations.test.ts` with exactly this content:

```typescript
import { describe, expect, test } from "vitest";
import { DESTINATIONS, getDestination } from "./index";

/**
 * The curated set's country claim, made explicit.
 *
 * Until the worldwide catalog, `Destination.country` was optional and four
 * separate call sites read an absent one as `"CN"` — which meant a Japanese
 * destination added later would have been offered while browsing China, and no
 * type error would have said so. The field is required now; this file states
 * what the sixteen entries actually answer, so the answer is data rather than
 * a default.
 */

describe("DESTINATIONS", () => {
  test("has sixteen entries with unique ids", () => {
    expect(DESTINATIONS).toHaveLength(16);
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(16);
  });

  test("every destination names its country explicitly", () => {
    const missing = DESTINATIONS.filter((d) => !/^[A-Z]{2}$/.test(d.country)).map((d) => d.id);
    expect(missing, `destinations with no ISO alpha-2 country: ${missing.join(", ")}`).toEqual([]);
  });

  test("all sixteen are in China, which is what the region labels assume", () => {
    // `regionForProvinceText` and REGION_MONTHS are China-only tables, and
    // `region: "North"` means nothing anywhere else. The day this stops being
    // true, this test is the thing that says so.
    expect([...new Set(DESTINATIONS.map((d) => d.country))]).toEqual(["CN"]);
  });

  test("getDestination still resolves by id", () => {
    expect(getDestination("suzhou")?.country).toBe("CN");
    expect(getDestination("definitely-not-real")).toBeUndefined();
  });
});
```

  **`lib/tripShared.test.ts` already exists** — 127 lines, 13 tests, including the currency-pivot regressions this project's memory records as `Critical 1` and `J-C1`. Do **not** create it, and do not overwrite it: the two `tripCountry` cases this task would have added are already there verbatim —

  ```typescript
  test("reads a trip saved before the field existed as China", () => {
  test("reads the stored country once a trip carries one", () => {
  ```

  Instead, append one paragraph to its existing `describe("tripCountry")` docblock, so the reason it survives the `?? "CN"` sweep is written where a future reader will look:

```typescript
  // Deliberately NOT one of the defaults the worldwide catalog removed. Those
  // were country *scopes* — "which places may we offer" — and a wrong default
  // there silently offered Chinese cities for a Japanese trip. This one is a
  // *persistence* backfill for a field that did not exist when some rows were
  // written; deleting it would reclassify every legacy trip as country-less
  // rather than as Chinese. See lib/tripShared.ts's docblock.
```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npx vitest run --project node lib/data/destinations.test.ts lib/tripShared.test.ts
  ```

  Expected: `lib/tripShared.test.ts` passes all 13 of its existing tests (the comment added above changes no behaviour; if the count is not 13, the file was overwritten — restore it from git before going on). `lib/data/destinations.test.ts` fails on **two** of its four tests: `every destination names its country explicitly` with `destinations with no ISO alpha-2 country: beijing, xian, qingdao, harbin, shanghai, hangzhou, suzhou, xiamen, chengdu, chongqing, guilin, zhangjiajie, yunnan, sanya, guangzhou, shenzhen`, and `all sixteen are in China` with `expected [ undefined ] to equal [ 'CN' ]`.

- [ ] **Step 3: Make `country` required and answer it everywhere**

  In `lib/types.ts`, replace lines 64-65:

```typescript
  /** ISO alpha-2. Absent on the curated data, which is all China. */
  country?: CountryCode;
```

  with:

```typescript
  /**
   * ISO alpha-2, required.
   *
   * It was optional while the app was China-only, and four separate call sites
   * read an absent one as `"CN"`. Required is what makes the compiler enforce
   * spec §5's rule that "a future destination cannot silently claim China":
   * there is no longer anywhere to omit it, so no default can be wrong.
   */
  country: CountryCode;
```

  In each of the four data files, add `country: "CN",` immediately after the `region:` line of every destination object. There are 16, at `lib/data/north.ts` (beijing, xian, qingdao, harbin), `lib/data/east.ts` (shanghai, hangzhou, suzhou, xiamen), `lib/data/west.ts` (chengdu, chongqing, guilin, zhangjiajie, yunnan), `lib/data/south.ts` (sanya, guangzhou, shenzhen). This one command does all sixteen at once and is exact, because `region: "…",` appears exactly once per destination object and nowhere else in those files:

  **Run this from Git Bash, not PowerShell** — the `\$` and `\"` escapes are bash's — and **run it exactly once**: it is not idempotent, and a second run inserts a duplicate `country: "CN",` after every `region:`.

  ```bash
  node -e "const f=require('fs');for(const p of ['lib/data/north.ts','lib/data/east.ts','lib/data/west.ts','lib/data/south.ts']){const s=f.readFileSync(p,'utf8');const out=s.replace(/^([ \t]*)region: (\"[A-Za-z]+\"),\r?\$/gm,(m,i,r)=>i+'region: '+r+',\r\n'+i+'country: \"CN\",\r');f.writeFileSync(p,out);console.log(p,(out.match(/country: \"CN\",/g)||[]).length);}"
  ```

  Expected output:
  ```
  lib/data/north.ts 4
  lib/data/east.ts 4
  lib/data/west.ts 5
  lib/data/south.ts 3
  ```

  The indentation class is `[ \t]`, not `\s`, and the line terminator is written back explicitly as `\r\n`. All four files are CRLF (`core.autocrlf=true` in this repo), and under `/m` JavaScript's `^` matches after a bare `\r` as well as after `\n` while `\s` swallows the `\n` — so the obvious `/^(\s*)region: …$/gm` form does match four times per file but emits a stray blank line and a lone LF inside a CRLF file at every one of the sixteen sites. Verified against `lib/data/north.ts`: the version above leaves the file at 332 CRLF / 332 LF, the `\s` version at 328 CRLF / 336 LF.

  Then confirm, before the typechecker sees it:

  ```bash
  grep -c 'country: "CN",' lib/data/north.ts lib/data/east.ts lib/data/west.ts lib/data/south.ts
  ```

  must print `4`, `4`, `5`, `3`. Anything doubled means the command ran twice — `git checkout -- lib/data` and run it once.

  In `components/DestinationStep.tsx`, replace lines 62-71:

```tsx
  /**
   * Curated data carries no country until PR4's pivot, so an absent one means
   * China. Offers are scoped: browsing Japan must not offer Chinese cities.
   * Resolution of *already picked* ids still reads the whole set below, so
   * switching country never orphans a chip.
   */
  const countryDestinations = useMemo(
    () => DESTINATIONS.filter((d) => (d.country ?? "CN") === activeCountry.code),
    [activeCountry.code]
  );
```

  with:

```tsx
  /**
   * Offers are scoped: browsing Japan must not offer Chinese cities. Every
   * destination states its own country now, so there is no default to get
   * wrong. Resolution of *already picked* ids still reads the whole set below,
   * so switching country never orphans a chip.
   */
  const countryDestinations = useMemo(
    () => DESTINATIONS.filter((d) => d.country === activeCountry.code),
    [activeCountry.code]
  );
```

  and replace lines 115-131:

```tsx
          return [{
            id,
            name: curatedHit.name,
            kind: "curated" as const,
            lat: curatedHit.lat,
            lon: curatedHit.lon,
            country: curatedHit.country ?? "CN",
          }];
        }
        const off = offMap.find((d) => d.id === id);
        if (off) {
          return [{ id, name: off.name, kind: "off-map" as const, lat: null, lon: null, country: off.country ?? "CN" }];
        }
        const hit = extras[id];
        if (hit) {
          return [{ id, name: hit.name, kind: "catalog" as const, lat: null, lon: null, country: "CN" }];
        }
```

  with:

```tsx
          return [{
            id,
            name: curatedHit.name,
            kind: "curated" as const,
            lat: curatedHit.lat,
            lon: curatedHit.lon,
            country: curatedHit.country,
          }];
        }
        const off = offMap.find((d) => d.id === id);
        if (off) {
          return [{ id, name: off.name, kind: "off-map" as const, lat: null, lon: null, country: off.country }];
        }
        const hit = extras[id];
        if (hit) {
          // The catalog is worldwide now, so a hit belongs to whichever country
          // was open when it was picked — not, as this line used to say, China.
          return [{ id, name: hit.name, kind: "catalog" as const, lat: null, lon: null, country }];
        }
```

  and change the `picked` memo's dependency array on line 134 from `[selected, extras, offMap]` to `[selected, extras, offMap, country]`.

  In `components/map/MapExplorer.tsx`, replace lines 174-179:

```tsx
  const places = useMemo<MapPlace[]>(() => {
    const curated = DESTINATIONS.filter(
      // Curated data carries no country until PR4's pivot, so an absent one
      // means China — the country every existing destination is in.
      (d) => !visited.includes(d.id) && (d.country ?? "CN") === countryCode
    ).flatMap(
```

  with:

```tsx
  const places = useMemo<MapPlace[]>(() => {
    const curated = DESTINATIONS.filter(
      // Every destination states its own country, so there is no default here
      // that a non-Chinese destination could fall through.
      (d) => !visited.includes(d.id) && d.country === countryCode
    ).flatMap(
```

  In `app/plan/page.tsx`, inside `addOffMap`, replace lines 116-120:

```tsx
      // Region is required — a plain string now that PR3 retired the Region
      // union. Nothing reads it for a place with no coordinates, so this is a
      // placeholder, not a claim.
      region: "Central",
      country: "CN",
```

  with:

```tsx
      // Region is required — a plain string now that PR3 retired the Region
      // union. Nothing reads it for a place with no coordinates, so this is a
      // placeholder, not a claim.
      region: "",
      // The country that is actually open. Hard-coding "CN" here put every
      // hand-typed place in China regardless of the trip it was typed into.
      country,
```

  In `lib/server/catalog.ts`, make the three edits that keep the tree compiling. First, add `CountryCode` to the type import on line 8:

```typescript
import type { Activity, ChinaRegion, CountryCode, Destination, Interest } from "../types";
```

  Then add `country` to `CatalogCity`, immediately after the `province` line (currently `lib/server/catalog.ts:19`):

```typescript
  province: string | null;
  /**
   * ISO alpha-2. The on-disk artifact predates this field and every one of its
   * 695 cities is Chinese; `normaliseCatalog` fills `"CN"` at the read
   * boundary, so an artifact generated before the worldwide catalog keeps
   * working without a re-ingest — the same accommodation `chineseName` gets.
   *
   * The default lives here and only here. This task removes the same default
   * from four UI call sites for the reason spec §5 gives: a value that is
   * inferred in five places cannot be trusted in any of them.
   */
  country: CountryCode;
```

  Then replace the normalisation block at lines 68-82:

```typescript
type LegacyNamed = { localName?: string | null; chineseName?: string | null };

/** The artifact's field was renamed in PR3; read both spellings, emit one. */
function withLocalName<T extends LegacyNamed>(row: T): T {
  const { chineseName, ...rest } = row;
  return { ...rest, localName: row.localName ?? chineseName ?? null } as T;
}

function normaliseCatalog(raw: Catalog): Catalog {
  return {
    ...raw,
    cities: raw.cities.map(withLocalName),
    attractions: raw.attractions.map(withLocalName),
  };
}
```

  with:

```typescript
type LegacyNamed = { localName?: string | null; chineseName?: string | null };

/** The artifact's field was renamed in PR3; read both spellings, emit one. */
function withLocalName<T extends LegacyNamed>(row: T): T {
  const { chineseName, ...rest } = row;
  return { ...rest, localName: row.localName ?? chineseName ?? null } as T;
}

/**
 * Every city in the Wikidata catalog is Chinese and always will be: the 695
 * keep their QIDs so their enrichment survives a worldwide re-ingest, and
 * every other country is served from a GeoNames shard instead. The artifact
 * predates the field, so it is filled here — the one read boundary — rather
 * than defaulted at each of the places that reads it.
 */
const LEGACY_CATALOG_COUNTRY: CountryCode = "CN";

function withCityDefaults(row: CatalogCity): CatalogCity {
  const legacy = row as CatalogCity & { country?: CountryCode };
  return { ...withLocalName(row), country: legacy.country ?? LEGACY_CATALOG_COUNTRY };
}

function normaliseCatalog(raw: Catalog): Catalog {
  return {
    ...raw,
    cities: raw.cities.map(withCityDefaults),
    attractions: raw.attractions.map(withLocalName),
  };
}
```

  Finally, in `catalogCityToDestination`'s returned object, add one line under `region:` (currently `lib/server/catalog.ts:292`):

```typescript
    region: regionFor(city.province, city.name),
    country: city.country,
```

  (`regionFor` keeps its two-parameter signature until Task 11; only the new `country:` line lands here, and it is what stops `Destination.country` becoming required from breaking the build.)

  In `lib/tripShared.ts`, replace lines 17-22:

```typescript
/**
 * The country a trip is in. The only way callers should read it: every trip
 * saved before the field existed is a China trip, so an absent country is an
 * explicit "CN" rather than an unknown — which is what removes the need for a
 * backfill. No caller should ever see `undefined` here.
 */
```

  with:

```typescript
/**
 * The country a trip is in. The only way callers should read it: every trip
 * saved before the field existed is a China trip, so an absent country is an
 * explicit "CN" rather than an unknown — which is what removes the need for a
 * backfill. No caller should ever see `undefined` here.
 *
 * This `?? "CN"` is deliberately NOT one of the defaults the worldwide catalog
 * removed. Those were country *scopes* — "which places may we offer" — and a
 * wrong default there silently offered Chinese cities for a Japanese trip.
 * This one is a *persistence* backfill for a field that did not exist when
 * some rows were written, and deleting it would reclassify every legacy trip
 * as country-less rather than as Chinese. lib/tripShared.test.ts pins it.
 */
```

- [ ] **Step 4: Run the tests and the typechecker to verify they pass**

  ```bash
  npx vitest run --project node lib/data/destinations.test.ts lib/tripShared.test.ts && npx tsc --noEmit
  ```

  Expected: `Test Files  2 passed (2)`, `Tests  17 passed (17)` — `lib/data/destinations.test.ts`'s 4 plus `lib/tripShared.test.ts`'s existing 13 — and `tsc` prints nothing. If `tsc` reports `Property 'country' is missing in type … but required in type 'Destination'`, read which file it names: a curated data file means the bulk edit missed one; `lib/server/catalog.ts` means the `country: city.country,` line above was not added.

- [ ] **Step 5: Run the whole suite to confirm nothing else read the default**

  ```bash
  npm test
  ```

  Expected: every test still passes. The count rises by exactly 4 over the pre-task baseline — `lib/data/destinations.test.ts` is the only new file, and `lib/tripShared.test.ts` was already in the count.

- [ ] **Step 6: Commit**

  ```bash
  git add lib/types.ts lib/data lib/tripShared.ts lib/tripShared.test.ts lib/server/catalog.ts components/DestinationStep.tsx components/map/MapExplorer.tsx app/plan/page.tsx
  git commit -m "feat: require an explicit country on every destination"
  ```

---

## Task 11: `lib/server/catalog.ts` — country-scoped search and map, and GeoNames resolution

**Files:**
- Create: `lib/curatedNames.ts`
- Test: `lib/curatedNames.test.ts` (create)
- Modify: `lib/server/catalog.ts:153-202` (`searchCities`), `:204-206` (`regionFor`), `:237-258` (`mapCities`), `:260-319` (`catalogCityToDestination`, `resolveDestinations`)
- Modify: `lib/server/catalogSearch.test.ts`
- Modify: `lib/server/catalog.test.ts`

(`CatalogCity.country` and `normaliseCatalog`'s read-boundary default landed in Task 10, because `Destination.country` becoming required breaks `catalogCityToDestination` before this task runs.)

**Interfaces:**
- Consumes: `cityIndexEntry`, `isGeoNamesId`, `CityIndexEntry` (Task 9); `curatedPlaceNames` (`lib/curatedNames.ts`, created below); `cityLevel` is **not** used here (the server has no population for a GeoNames city).
- Produces (signatures later tasks rely on):
  - `export function curatedPlaceNames(country: string): ReadonlySet<string>` in `lib/curatedNames.ts` — folded names a curated destination already covers, keyed by country.
  - `export function searchCities(query: string, country: string, limit?: number): CatalogHit[]` — **signature change**, country is now the second parameter
  - `export function mapCities(country: string): MapCity[]` — **signature change**
  - `export function resolveDestinations(ids: string[]): Destination[]` — unchanged signature, three-way body
  - `export function geoNamesCityToDestination(entry: CityIndexEntry): Destination` — new
  - `export function catalogCityToDestination(city: CatalogCity): Destination` — unchanged signature

- [ ] **Step 1: Write the failing tests**

  Replace `lib/server/catalogSearch.test.ts` entirely with:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { Catalog, CatalogCity } from "./catalog";

/**
 * The server leg of place search, which `searchCities` owns.
 *
 * A fixture rather than the real catalog: the point is which *spellings* match
 * and which *countries* are in scope, and stating the corpus in the test is
 * what makes an empty result mean something. Pointed at through
 * `CIP_CATALOG_PATH`, the same override `CIP_DB_PATH` gives the store.
 *
 * Fixture invariant (spec §6): the corpus contains cities in MORE THAN ONE
 * country. Stating `country` on every row is not enough on its own — the read
 * boundary fills `"CN"` anyway, so an all-China fixture is satisfied by an
 * implementation that answers `[]` for every country but CN, which is not
 * scoping at all. The two Peruvian rows are what make the scoping assertions
 * mean something.
 */

const city = (over: Partial<CatalogCity> & Pick<CatalogCity, "qid" | "name">): CatalogCity => ({
  localName: null,
  province: "Shandong",
  country: "CN",
  lat: 36.6,
  lon: 117.0,
  population: 7_000_000,
  description: null,
  interests: [],
  image: null,
  level: "prefecture",
  ...over,
});

const FIXTURE: Catalog = {
  generatedAt: "2026-08-25",
  source: "fixture",
  cities: [
    // Real spellings from data/catalog.json, where 23 of 695 city names carry an
    // apostrophe and 2 carry diacritics. The person searching types neither.
    city({ qid: "Q1", name: "Tai'an" }),
    city({ qid: "Q2", name: "Ma'anshan", province: "Anhui" }),
    city({ qid: "Q3", name: "Ürümqi", province: "Xinjiang" }),
    // Synthetic: the curly apostrophe a paste from Wikipedia carries.
    city({ qid: "Q4", name: "Huai’an", province: "Jiangsu" }),
    // A control that must never match the queries below.
    city({ qid: "Q5", name: "Luoyang", province: "Henan" }),
    // Not China. Without it, every scoping assertion below is equally
    // satisfied by an implementation that hardcodes `country !== "CN" -> []`,
    // which is exactly the shape of bug the country parameter exists to
    // prevent: the fixture could not tell "scoped to what was asked for" from
    // "only CN ever answers".
    city({ qid: "Q6", name: "Trujillo", province: "La Libertad", country: "PE", lat: -8.11, lon: -79.03 }),
    // Shares a folded name with the curated Chinese destination "Dali", but is
    // in another country: the curated blocklist must be keyed by country, or
    // this place is unreachable and nothing says so.
    city({ qid: "Q7", name: "Dali", province: "Ica", country: "PE", lat: -14.0, lon: -75.7 }),
  ],
  attractions: [],
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-catalog-"));
const fixturePath = path.join(dir, "catalog.json");
fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE), "utf8");
process.env.CIP_CATALOG_PATH = fixturePath;

// Imported after the override so the loader reads the fixture, not data/.
const { searchCities } = await import("./catalog");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const names = (q: string, country = "CN") => searchCities(q, country).map((h) => h.name);

describe("searchCities — folding", () => {
  test("finds an apostrophe name from a query without one", () => {
    expect(names("taian")).toContain("Tai'an");
    expect(names("maanshan")).toContain("Ma'anshan");
  });

  test("treats a curly apostrophe as the same character", () => {
    expect(names("huaian")).toContain("Huai’an");
  });

  test("finds a diacritic name from an unaccented query", () => {
    expect(names("urumqi")).toContain("Ürümqi");
  });

  test("still matches what it always matched, and nothing more", () => {
    expect(names("luoyang")).toEqual(["Luoyang"]);
    expect(names("taian")).not.toContain("Luoyang");
    expect(names("zzzz")).toEqual([]);
  });
});

describe("searchCities — country scoping", () => {
  test("offers a Chinese city only while China is the country in scope", () => {
    // The Wikidata half of the catalog is all-China and always will be: the
    // 695 keep their QIDs so their enrichment survives, and everywhere else is
    // served from a GeoNames shard the client fetches. Returning them for a
    // Peru trip is the bug PlaceSearch's CATALOG_COUNTRIES allowlist used to
    // paper over.
    expect(names("luoyang", "CN")).toEqual(["Luoyang"]);
    expect(names("luoyang", "PE")).toEqual([]);
  });

  test("offers a Peruvian city only while Peru is the country in scope", () => {
    // The half a China-only fixture cannot state: this proves the filter reads
    // the country it was handed, rather than proving that CN is the only
    // country that ever answers.
    expect(names("trujillo", "PE")).toEqual(["Trujillo"]);
    expect(names("trujillo", "CN")).toEqual([]);
  });

  test("the curated blocklist is scoped to the country that curated the name", () => {
    // "Dali" is covered by the curated Yunnan destination in China and must
    // stay hidden there — and must stay REACHABLE in Peru. A global name
    // blocklist hides both, and nothing in the UI would ever say so. This is
    // the only test of `curatedPlaceNames`'s country keying.
    expect(names("dali", "CN")).toEqual([]);
    expect(names("dali", "PE")).toEqual(["Dali"]);
  });

  test("normalises the country the way getCountry does", () => {
    expect(names("luoyang", " cn ")).toEqual(["Luoyang"]);
  });

  test("an absent or malformed country is empty, not everything", () => {
    // Failing open here would serve the whole China catalog to a request that
    // named no country at all — the exact thing the route must not do.
    expect(names("luoyang", "")).toEqual([]);
    expect(names("luoyang", "CHN")).toEqual([]);
  });
});

describe("searchCities — legacy catalog read boundary", () => {
  const originalCatalogPath = process.env.CIP_CATALOG_PATH;

  afterAll(() => {
    process.env.CIP_CATALOG_PATH = originalCatalogPath;
  });

  test("reads a legacy artifact that spells the field chineseName and states no country", () => {
    // data/catalog.json on disk today predates BOTH the localName rename and
    // the country field. Both defaults live at this one boundary rather than
    // as `??` at every call site — which is exactly the distinction Task 10
    // drew for Destination.country.
    const legacy = {
      generatedAt: "2026-01-01",
      source: "test",
      cities: [
        {
          qid: "Q1",
          name: "Nanjing",
          chineseName: "南京",
          province: "Jiangsu",
          lat: 32.06,
          lon: 118.8,
          population: 8000000,
          description: null,
          interests: [],
          image: null,
          level: "prefecture",
        },
      ],
      attractions: [],
    };
    const file = path.join(os.tmpdir(), `cip-legacy-catalog-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(legacy));
    process.env.CIP_CATALOG_PATH = file;

    try {
      const hits = searchCities("Nanjing", "CN", 5);

      expect(hits[0].localName).toBe("南京");
      expect(hits[0]).not.toHaveProperty("chineseName");
      // And it is reachable at all, which is the country default working.
      expect(hits).toHaveLength(1);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
```

  Create `lib/curatedNames.test.ts` with exactly this content:

```typescript
import { describe, expect, test } from "vitest";
import { DESTINATIONS } from "./data";
import { foldPlaceName } from "./foldPlaceName";
import { curatedPlaceNames } from "./curatedNames";

/**
 * One list, three readers. `lib/server/catalog.ts` filters the Wikidata
 * catalog with it, `PlaceSearch` filters the GeoNames shard with it, and
 * `MapExplorer` filters the map's markers with it — and before this module
 * existed only the first of those did, so a curated card and a bare shard row
 * for the same place could both be offered at once.
 */

describe("curatedPlaceNames", () => {
  test("covers every curated destination's own name, folded", () => {
    const cn = curatedPlaceNames("CN");
    for (const destination of DESTINATIONS) {
      expect(cn.has(foldPlaceName(destination.name))).toBe(true);
    }
  });

  test("covers the places a curated destination plans but does not name", () => {
    // "Guilin & Yangshuo" is one card. Yangshuo has no catalog.json row of its
    // own, so it survives the ingest's dedup and lands in the CN shard — and
    // without this list the picker offers a bare "Yangshuo" chip beside the
    // curated card that already plans three days there.
    for (const name of ["Guilin", "Yangshuo", "Kunming", "Dali", "Lijiang", "Zhangjiajie"]) {
      expect(curatedPlaceNames("CN").has(foldPlaceName(name))).toBe(true);
    }
  });

  test("is keyed by country, so another country's Dali is still reachable", () => {
    expect(curatedPlaceNames("PE").has(foldPlaceName("Dali"))).toBe(false);
    expect(curatedPlaceNames("PE").size).toBe(0);
  });

  test("normalises the country and answers an empty set for a malformed one", () => {
    expect(curatedPlaceNames(" cn ").size).toBeGreaterThan(0);
    expect(curatedPlaceNames("").size).toBe(0);
    expect(curatedPlaceNames("CHN").size).toBe(0);
  });
});
```

  Replace `lib/server/catalog.test.ts` entirely with:

```typescript
import { describe, expect, test } from "vitest";
import { buildItinerary } from "../itinerary";
import type { Destination } from "../types";
import {
  catalogCityToDestination,
  geoNamesCityToDestination,
  resolveDestinations,
  type CatalogCity,
} from "./catalog";

function city(overrides: Partial<CatalogCity> = {}): CatalogCity {
  return {
    qid: "Q123456",
    name: "Luoyang",
    localName: "洛阳",
    province: "Henan",
    country: "CN",
    lat: 34.6,
    lon: 112.4,
    population: 7000000,
    description: "Luoyang is a city in Henan known for the Longmen Grottoes. It was an ancient capital.",
    interests: ["history"],
    image: null,
    level: "prefecture",
    ...overrides,
  };
}

describe("catalogCityToDestination", () => {
  test("builds a plannable destination with generic activities when no attractions exist", () => {
    const dest = catalogCityToDestination(city());
    expect(dest.id).toBe("Q123456");
    expect(dest.region).toBe("Central");
    expect(dest.country).toBe("CN");
    expect(dest.activities.length).toBeGreaterThanOrEqual(3);
    expect(dest.tagline).toContain("Luoyang");
    expect(dest.suggestedDays[0]).toBeGreaterThanOrEqual(1);
  });

  test("maps provinces to app regions", () => {
    expect(catalogCityToDestination(city({ province: "Gansu" })).region).toBe("Northwest");
    expect(catalogCityToDestination(city({ province: "Zhejiang" })).region).toBe("East");
    expect(catalogCityToDestination(city({ province: null, name: "Lhasa", description: null })).region).toBe(
      "Central"
    );
  });

  test("uses the province verbatim outside China rather than a China region", () => {
    // `regionForProvinceText` is a China-only keyword table and `?? "Central"`
    // is one of China's own seven — which `mapTypes.isChinaRegion` then treats
    // as real, giving a Swiss town a Chinese month-fit. Outside China the
    // admin-1 name IS the region label (lib/types.ts:57-63).
    const zermatt = catalogCityToDestination(
      city({ qid: "Q27494", name: "Zermatt", province: "Valais", country: "CH" })
    );
    expect(zermatt.region).toBe("Valais");
    expect(zermatt.country).toBe("CH");
  });

  test("a destination with no foods and no evening activities still gets a dinner suggestion", () => {
    const dest: Destination = {
      ...catalogCityToDestination(city()),
      foods: [],
      activities: [
        { name: "Day sight", interests: ["history"], slots: 1, timeOfDay: "day" },
        { name: "Another day sight", interests: ["nature"], slots: 1, timeOfDay: "day" },
      ],
    };
    const plan = buildItinerary(
      {
        destinationIds: [dest.id],
        days: 2,
        season: "autumn",
        adults: 2,
        kids: 0,
        interests: [],
      },
      [dest]
    );
    const evening = plan.days[0].items.find((i) => i.slot === "evening");
    expect(evening).toBeDefined();
    expect(evening!.title.toLowerCase()).toContain("local speciality");
  });
});

describe("geoNamesCityToDestination", () => {
  const cusco = {
    id: "G3941584",
    name: "Cusco",
    country: "PE",
    lat: -13.52264,
    lon: -71.96734,
    region: "Cusco",
  };

  test("builds a plannable destination from an index entry alone", () => {
    // The server has no shard and no attractions for a GeoNames city — it has
    // exactly the six fields the bundled index carries. What it produces has
    // to be plannable anyway, because this is what `/api/destinations/resolve`
    // hands the itinerary generator.
    const dest = geoNamesCityToDestination(cusco);
    expect(dest.id).toBe("G3941584");
    expect(dest.name).toBe("Cusco");
    expect(dest.country).toBe("PE");
    expect(dest.lat).toBe(-13.52264);
    expect(dest.lon).toBe(-71.96734);
    expect(dest.region).toBe("Cusco");
    expect(dest.activities.length).toBeGreaterThanOrEqual(3);
    expect(dest.suggestedDays[0]).toBeGreaterThanOrEqual(1);
    expect(dest.suggestedDays[1]).toBeGreaterThanOrEqual(dest.suggestedDays[0]);
  });

  test("names the city in its tagline, so a plan card is not blank", () => {
    expect(geoNamesCityToDestination(cusco).tagline).toContain("Cusco");
  });

  test("falls back to an empty region rather than inventing a Chinese one", () => {
    // "Central" is one of China's seven, and `mapTypes.isChinaRegion` would
    // accept it — handing a Peruvian city a Chinese month-fit.
    expect(geoNamesCityToDestination({ ...cusco, region: null }).region).toBe("");
  });

  test("produces an itinerary the generator can actually schedule", () => {
    const dest = geoNamesCityToDestination(cusco);
    const plan = buildItinerary(
      { destinationIds: [dest.id], days: 2, season: "autumn", adults: 2, kids: 0, interests: [] },
      [dest]
    );
    expect(plan.days).toHaveLength(2);
    expect(plan.days[0].items.length).toBeGreaterThan(0);
  });
});

describe("resolveDestinations", () => {
  test("resolves curated ids and drops unknown ids", () => {
    const resolved: Destination[] = resolveDestinations(["beijing", "definitely-not-real"]);
    expect(resolved.map((d) => d.id)).toEqual(["beijing"]);
  });

  test("resolves a GeoNames id out of the bundled index", () => {
    // This is the server half of the acceptance test: a tap on Cusco reaches
    // `/api/destinations/resolve?ids=G3941584`, and `public/` is unreadable
    // from the lambda, so the bundled index is the only thing that can answer.
    const resolved = resolveDestinations(["G3941584"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ id: "G3941584", name: "Cusco", country: "PE" });
  });

  test("mixes curated, catalog and GeoNames ids in one call", () => {
    const resolved = resolveDestinations(["beijing", "G2657928", "nope"]);
    expect(resolved.map((d) => d.id)).toEqual(["beijing", "G2657928"]);
    expect(resolved.map((d) => d.country)).toEqual(["CN", "CH"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npx vitest run --project node lib/curatedNames.test.ts lib/server/catalog.test.ts lib/server/catalogSearch.test.ts
  ```

  Expected: `lib/curatedNames.test.ts` fails at collection with `Error: Cannot find module './curatedNames' imported from …/lib/curatedNames.test.ts`; `lib/server/catalog.test.ts` fails on first use with `TypeError: geoNamesCityToDestination is not a function`; `lib/server/catalogSearch.test.ts` fails on the country-scoping tests, because today's `searchCities(query, limit)` reads `"PE"` as a limit and still returns Luoyang.

- [ ] **Step 3: Write the implementation**

  First create `lib/curatedNames.ts` with exactly this content:

```typescript
import { DESTINATIONS } from "./data";
import { foldPlaceName } from "./foldPlaceName";

/**
 * Place names a curated destination already covers, keyed by country.
 *
 * One list with three readers — `lib/server/catalog.ts` filters the Wikidata
 * catalog, `PlaceSearch` filters the GeoNames shard, and `MapExplorer` filters
 * the map's markers. It lives in a client-safe leaf rather than in
 * lib/server/catalog.ts precisely so all three can reach it: two of them run in
 * the browser, and a second copy of the list is how they drift apart.
 *
 * Keyed by country now that the catalog is worldwide. "Dali" is a Chinese city
 * the curated set covers and could plausibly name a place somewhere else; a
 * global name blocklist would hide that other place with no way to notice.
 */
const ACTIVITY_COVERED: Readonly<Record<string, readonly string[]>> = {
  // Covered by a curated destination's activities rather than by a card of
  // their own — Guilin's entry plans Yangshuo, Yunnan's plans Dali and
  // Lijiang. Yangshuo in particular has no data/catalog.json row, so it
  // survives the ingest's dedup and reaches the CN shard; without this list
  // the picker offers a bare "Yangshuo" chip beside "Guilin & Yangshuo".
  CN: ["Guilin", "Yangshuo", "Kunming", "Dali", "Lijiang", "Zhangjiajie"],
};

const BY_COUNTRY: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const byCountry = new Map<string, Set<string>>();
  const add = (country: string, name: string) => {
    const set = byCountry.get(country) ?? new Set<string>();
    set.add(foldPlaceName(name));
    byCountry.set(country, set);
  };
  for (const destination of DESTINATIONS) add(destination.country, destination.name);
  for (const [country, names] of Object.entries(ACTIVITY_COVERED)) {
    for (const name of names) add(country, name);
  }
  return byCountry;
})();

const NONE: ReadonlySet<string> = new Set();

/** Normalised the way `getCountry` normalises, so " cn " and "CN" agree. */
export function curatedPlaceNames(country: string): ReadonlySet<string> {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code)) return NONE;
  return BY_COUNTRY.get(code) ?? NONE;
}
```

  Then in `lib/server/catalog.ts`, make these **three** edits, lettered (a), (d) and (e) — (b) and (c) already landed in Task 10 (`CatalogCity.country` and `normaliseCatalog`'s default), and the lettering is kept so the two tasks line up.

  **(a)** Replace the import block at lines 1-8 with:

```typescript
import fs from "node:fs";
import path from "node:path";
import bundledCatalogJson from "../../data/catalog.json";
import { curatedPlaceNames } from "../curatedNames";
import { DESTINATIONS } from "../data";
import { foldPlaceName } from "../foldPlaceName";
import { regionForProvinceText } from "../provinces";
import type { CatalogHit, MapCity } from "../tripShared";
import type { Activity, CountryCode, Destination, Interest } from "../types";
import { cityIndexEntry, isGeoNamesId, type CityIndexEntry } from "./cityIndex";
```

  (`ChinaRegion` is no longer imported: `regionFor` returns a plain `string` now, because a region label outside China is the admin-1 name. `CountryCode` was added in Task 10 and stays.)

  **(d)** Replace `CURATED_NAMES`, `searchCities`, `regionFor` and `mapCities` (lines 153-206 and 237-258) with:

```typescript
/** Normalised the way `getCountry` normalises, so " cn " and "CN" agree. */
function normaliseCountryCode(country: string): string {
  const code = typeof country === "string" ? country.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

/**
 * Ranked search over the Wikidata catalog, scoped to one country.
 *
 * The country is required and unrecognised values return nothing rather than
 * everything: failing open would serve the whole China catalog to a request
 * that named no country, which is the bug `PlaceSearch`'s CATALOG_COUNTRIES
 * allowlist existed to paper over.
 *
 * The GeoNames half of the catalog is not searched here. It lives in
 * per-country files under `public/`, which a lambda cannot read (spec §3.2),
 * so the client searches the shard it already fetched and merges the two
 * result sets in `rankPlaces`.
 */
export function searchCities(query: string, country: string, limit = 25): CatalogHit[] {
  const catalog = loadCatalog();
  if (!catalog) return [];
  const wanted = normaliseCountryCode(country);
  if (wanted === "") return [];
  const q = foldPlaceName(query);
  if (q.length < 1) return [];
  const curated = curatedPlaceNames(wanted);

  const scored = catalog.cities
    .filter((c) => c.country === wanted && !curated.has(foldPlaceName(c.name)))
    .map((c) => {
      const name = foldPlaceName(c.name);
      const zh = c.localName ?? "";
      const province = foldPlaceName(c.province ?? "");
      let score = -1;
      if (name.startsWith(q) || zh.startsWith(query.trim())) score = 3;
      else if (name.includes(q) || zh.includes(query.trim())) score = 2;
      else if (province.startsWith(q)) score = 1;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) => b.score - a.score || (b.c.population ?? 0) - (a.c.population ?? 0)
    )
    .slice(0, limit);

  return scored.map(({ c }): CatalogHit => {
    const attractions = cache?.byCity.get(c.qid) ?? [];
    return {
      qid: c.qid,
      name: c.name,
      localName: c.localName,
      province: c.province,
      description: c.description,
      population: c.population,
      attractionCount: attractions.length,
    };
  });
}

/**
 * A region label meaningful inside this city's own country.
 *
 * `regionForProvinceText` is a China-only keyword table and its `?? "Central"`
 * fallback is one of China's own seven regions — which `mapTypes.isChinaRegion`
 * then accepts, giving a Swiss town a Chinese month-fit rather than the
 * neutral one the guard exists to produce. Outside China the admin-1 name IS
 * the region label (see `Destination.region`, lib/types.ts:57-63).
 */
function regionFor(country: string, province: string | null, cityName: string): string {
  if (country !== "CN") return province ?? "";
  return regionForProvinceText(`${province ?? ""} ${cityName}`) ?? "Central";
}
```

  and, in place of the old `mapCities`:

```typescript
/**
 * The Wikidata catalog's cities for one country, in map-marker form.
 *
 * Curated destinations are filtered out — the map renders those from the
 * richer curated data instead. Every city in this catalog is Chinese, so this
 * is empty for every country but CN; the map merges in the GeoNames shard it
 * fetched for whichever country is open (spec §5, gate 3).
 */
export function mapCities(country: string): MapCity[] {
  const catalog = loadCatalog();
  if (!catalog) return [];
  const wanted = normaliseCountryCode(country);
  if (wanted === "") return [];
  const curated = curatedPlaceNames(wanted);
  return catalog.cities
    .filter((c) => c.country === wanted && !curated.has(foldPlaceName(c.name)))
    .map((c): MapCity => ({
      qid: c.qid,
      name: c.name,
      localName: c.localName,
      province: c.province,
      lat: c.lat,
      lon: c.lon,
      population: c.population,
      level: c.level,
      attractionCount: cache?.byCity.get(c.qid)?.length ?? 0,
      blurb: firstSentence(c.description),
    }));
}
```

  **(e)** Point `catalogCityToDestination` at the new three-parameter `regionFor`, then replace `resolveDestinations`. In `catalogCityToDestination`, change the returned object's `region:` line from:

```typescript
    region: regionFor(city.province, city.name),
    country: city.country,
```

  to:

```typescript
    region: regionFor(city.country, city.province, city.name),
    country: city.country,
```

  (The `country:` line itself landed in Task 10; only the `regionFor` call moves here.)

  Then replace `resolveDestinations` (currently lines 308-319) with:

```typescript
/**
 * A plannable Destination from nothing but a bundled index entry.
 *
 * GeoNames carries no descriptions, no images and no attractions, and the
 * shard that would carry enrichment is under `public/`, which a lambda cannot
 * read. So this builds from the six fields the index has — which is enough,
 * because a city with no catalogued attractions already takes this path today
 * through `GENERIC_ACTIVITIES`, and the wizard's enrichment call fills the
 * description in on the client.
 */
export function geoNamesCityToDestination(entry: CityIndexEntry): Destination {
  const activities = GENERIC_ACTIVITIES(entry.name);
  return {
    id: entry.id,
    name: entry.name,
    localName: null,
    // The admin-1 name, or nothing. Never "Central": that is one of China's
    // seven, and `mapTypes.isChinaRegion` would accept it.
    region: entry.region ?? "",
    country: entry.country,
    lat: entry.lat,
    lon: entry.lon,
    emoji: "📍",
    tagline: entry.region ? `${entry.name}, ${entry.region}` : entry.name,
    knownFor: [],
    bestSeasons: ["spring", "autumn"],
    seasonNotes: {},
    foods: [],
    suggestedDays: [1, 2],
    activities,
  };
}

/**
 * Resolve any mix of curated ids, Wikidata qids and GeoNames ids into
 * Destination objects.
 *
 * Three namespaces, checked in order of specificity. The GeoNames branch is
 * keyed on the `G` prefix rather than on a failed catalog lookup, because
 * §3.3's whole point is that the namespaces stay distinguishable: a bare
 * integer or an unprefixed id must resolve to nothing rather than to whichever
 * source happens to hold that string.
 */
export function resolveDestinations(ids: string[]): Destination[] {
  const catalog = loadCatalog();
  return ids
    .map((id) => {
      const curated = DESTINATIONS.find((d) => d.id === id);
      if (curated) return curated;
      if (isGeoNamesId(id)) {
        const entry = cityIndexEntry(id);
        return entry ? geoNamesCityToDestination(entry) : undefined;
      }
      const city = catalog?.cities.find((c) => c.qid === id);
      return city ? catalogCityToDestination(city) : undefined;
    })
    .filter((d): d is Destination => Boolean(d));
}
```

  Finally, update the two callers whose signatures moved, so the tree compiles:
  - `app/api/destinations/route.ts:15` — `searchCities(q)` becomes `searchCities(q, country)` (Task 12 adds the `country` parse; passing `""` is **not** acceptable as a placeholder — it would make the route answer nothing).
  - `app/api/map/cities/route.ts:11` — `mapCities()` becomes `mapCities(country)`, likewise.

  Both are done in Task 12; run `npx tsc --noEmit` only after that task's Step 3.

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  npx vitest run --project node lib/curatedNames.test.ts lib/server/catalog.test.ts lib/server/catalogSearch.test.ts
  ```

  Expected: `Test Files  3 passed (3)` and `Tests  25 passed (25)` — `lib/curatedNames.test.ts`'s 4, plus the 21 across the two catalog files (19 as originally scoped plus the two new scoping cases). (`tsc` will still report two errors in `app/api/`, fixed in Task 12.)

- [ ] **Step 5: Commit**

  ```bash
  git add lib/curatedNames.ts lib/curatedNames.test.ts lib/server/catalog.ts lib/server/catalog.test.ts lib/server/catalogSearch.test.ts
  git commit -m "feat: scope the catalog by country and resolve GeoNames ids"
  ```

  **Do not push the branch yet.** The tree does not typecheck until Task 12 Step 3, and `ci.yml` runs on `push: branches: ["**"]` — pushing here puts a red run on the branch. The plan's pre-merge gate is `npx tsc --noEmit` then `npm test`, and the first point at which both are green again is Task 14 Step 5.

---

## Task 12: Gate 3, server half — `?country=` on both catalog routes

**Files:**
- Modify: `app/api/map/cities/route.ts` (whole file, 18 lines)
- Modify: `app/api/destinations/route.ts` (whole file, 17 lines)
- Test: none, deliberately

**Interfaces:**
- Consumes: `searchCities(query, country, limit?)`, `mapCities(country)`, `catalogStatus()`, `ensureCatalogLoaded()` (Task 11).
- Produces: no new exports. `/api/map/cities?country=PE` and `/api/destinations?q=…&country=PE`.

**Why there is no test file here, and what stands in for one.** `vitest.config.mts` includes `lib/**`, `scripts/**` and `components/**` and nothing else; a test placed beside a route handler sits on disk and never runs — the trap the config's own comment records for `scripts/`. So these routes hold no logic worth testing: they parse a query param with `?? ""` and delegate, and every decision about what an absent, lowercase or malformed country means was made and tested inside `searchCities`/`mapCities` in Task 11. This is the same split `app/api/map/airports/route.ts:10` and `lib/server/airports.ts:52-56` already use — the route parses, the `lib/server` function validates. The verification step for this task is therefore `npx tsc --noEmit` plus the full suite, not a new test.

- [ ] **Step 1: Run the typechecker to see the failing state**

  ```bash
  npx tsc --noEmit
  ```

  Expected: exactly two errors, both caused by Task 11's signature changes:
  ```
  app/api/destinations/route.ts(15,32): error TS2554: Expected 2-3 arguments, but got 1.
  app/api/map/cities/route.ts(11,32): error TS2554: Expected 1 arguments, but got 0.
  ```

- [ ] **Step 2: Rewrite `app/api/map/cities/route.ts`**

  Replace the whole file with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, ensureCatalogLoaded, mapCities } from "@/lib/server/catalog";

/**
 * The Wikidata catalog's cities for one country.
 *
 * Country-scoped, mirroring /api/map/airports — and, since every city in this
 * catalog is Chinese, empty for every country but CN. The GeoNames cities for
 * whichever country is open are NOT served here: they live in per-country
 * files under public/, which a Vercel lambda cannot read (spec §3.2), so the
 * client fetches `/cities/<CC>.json` itself and merges the two.
 *
 * Validation lives in `mapCities`, not here — nothing under app/ is covered by
 * either vitest project, so a route that decided anything would decide it
 * untested. Same split as app/api/map/airports/route.ts.
 *
 * The cache window matches /api/map/airports': the response is keyed by
 * country rather than by free text, so entries are shared across users and the
 * artifact only changes when the daily workflow commits.
 */
export async function GET(req: NextRequest) {
  await ensureCatalogLoaded();
  const country = req.nextUrl.searchParams.get("country") ?? "";
  const status = catalogStatus();
  if (!status.available) {
    return NextResponse.json({ available: false, cities: [] });
  }
  return NextResponse.json(
    { available: true, cities: mapCities(country) },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
```

- [ ] **Step 3: Rewrite `app/api/destinations/route.ts`**

  Replace the whole file with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, ensureCatalogLoaded, searchCities } from "@/lib/server/catalog";

/**
 * Ranked search over the Wikidata catalog, scoped to one country.
 *
 * An absent or malformed `country` yields no results rather than the whole
 * catalog: `searchCities` decides that, and it is tested there. Failing open
 * would serve every Chinese city to a request that named no country, which is
 * precisely what PlaceSearch's CATALOG_COUNTRIES allowlist used to hide.
 *
 * The GeoNames half of the catalog is searched in the browser, against the
 * shard the picker already fetched — public/ is unreadable from a lambda.
 *
 * No Cache-Control: the response is keyed by free text, so entries are not
 * shared between users and a cache window buys little. Same reasoning
 * app/api/airports/search/route.ts records for its own short window.
 */
export async function GET(req: NextRequest) {
  await ensureCatalogLoaded();
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const country = req.nextUrl.searchParams.get("country") ?? "";
  const status = catalogStatus();
  if (!status.available) {
    return NextResponse.json({ available: false, results: [] });
  }
  return NextResponse.json({
    available: true,
    generatedAt: status.generatedAt,
    total: status.cities,
    results: q.trim().length >= 2 ? searchCities(q, country) : [],
  });
}
```

- [ ] **Step 4: Run the typechecker and the full suite to verify they pass**

  ```bash
  npx tsc --noEmit && npm test
  ```

  Expected: `tsc` prints nothing. The suite fails on exactly one file at this point — `components/map/MapExplorer.test.tsx`, whose fetch mock answers `/api/map/cities` without a country and whose `buys no China assets` test still assumes the old effect. That is fixed in Task 14; if any *other* file fails, stop and read it.

- [ ] **Step 5: Commit**

  ```bash
  git add app/api/map/cities/route.ts app/api/destinations/route.ts
  git commit -m "feat: scope both catalog routes by country"
  ```

  **Still do not push.** `components/map/MapExplorer.test.tsx` stays red until Task 14, and `ci.yml` runs on every push to every branch. Push once Task 14 Step 5 reports a green suite.

---

## Task 13: Gate 1 — `CATALOG_COUNTRIES` deleted, search scoped to the active country's shard

**Files:**
- Modify: `components/plan/PlaceSearch.tsx:1-6` (imports), `:41-45` (constants), `:55-120` (state, effects, merge)
- Modify: `components/plan/PlaceSearch.test.tsx:88-91` (the keyboard block's fetch stub) and `:229-284` (the scoping describe block)
- Test: `components/plan/PlaceSearch.test.tsx`

**Interfaces:**
- Consumes: `fetchCityShard`, `type CityShardRow` (Task 8); `curatedPlaceNames` (`lib/curatedNames.ts`, Task 11); `foldPlaceName` (`lib/foldPlaceName.ts`); `rankPlaces`, `type SearchableHit` (`lib/placeSearch.ts:88`, `:21-26`).
- Produces: no new exports. `PlaceSearch`'s props are unchanged.

The gate today is `components/plan/PlaceSearch.tsx:44`, `const CATALOG_COUNTRIES = new Set(["CN"]);`, referenced at exactly one place, `:77`. It exists because "the catalog is China-only… and its rows carry no country", which is no longer true. It is deleted outright; in its place the component fetches the open country's shard once per country change and searches it in the browser, which is what spec §5 means by "scope search to the active country's shard".

Both result sets feed the one existing `rankPlaces` call, API hits first. Order matters: `rankPlaces` breaks a score tie by input index, so a Wikidata hit — the one with a researched description and an attraction count — outranks a GeoNames row that scored the same.

- [ ] **Step 1: Write the failing test**

  First, in `components/plan/PlaceSearch.test.tsx`, replace the keyboard block's fetch stub (lines 88-91):

```tsx
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ available: true, results: [] }) })
    );
```

  with one that answers the shard request too:

```tsx
    // `PlaceSearch` now fetches /cities/<CC>.json on mount, and this stub had
    // no `ok` — so `fetchCityShard` would read `undefined`, throw, and land a
    // `setShard` in a microtask outside `act`: exactly the warning the block
    // above says this file is otherwise clean of. A 404 is also the honest
    // answer for a test that wants no network.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).startsWith("/cities/")
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ available: true, results: [] }),
            })
      )
    );
```

  (The implementation below also makes the failure path a no-op re-render, via a functional `setShard` that returns the previous array when it is already empty. Both halves matter: this stub keeps the *reason* honest, the bail-out keeps the *warning* away even if a future stub regresses.)

  Then replace the entire final `describe("PlaceSearch country scoping", …)` block (lines 229-284) with:

```tsx
describe("PlaceSearch country scoping", () => {
  const NANJING = { qid: "Q16666", name: "Nanjing", localName: "南京", province: "Jiangsu" };

  const PE_SHARD = {
    country: "PE",
    generatedAt: "2026-08-25",
    source: "GeoNames cities500 (CC BY 4.0)",
    cities: [
      { id: "G3936456", n: "Lima", lat: -12.04318, lon: -77.02824, a1: "Lima region", p: 7_737_002, tz: "America/Lima" },
      { id: "G3941584", n: "Cusco", lat: -13.52264, lon: -71.96734, a1: "Cusco", p: 428_450, tz: "America/Lima" },
    ],
  };

  /**
   * Dispatches on the URL, because the component now has two legs — the
   * country-scoped API call and the static shard — and a single-answer mock
   * would let either one masquerade as the other.
   *
   * Fixture invariant (spec §6), and it is enforced rather than asserted in
   * prose: the shard states `country: "PE"` and `fetchCityShard` passes the
   * requested country into `parseCityShard`, so a fixture whose envelope
   * disagreed with its URL would throw here rather than quietly draw the wrong
   * country's cities.
   */
  function stubFetch(shard: unknown, results: unknown[] = [NANJING]) {
    const mock = vi.fn((url: string) =>
      String(url).startsWith("/cities/")
        ? Promise.resolve({ ok: true, status: 200, json: async () => shard })
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true, results }) })
    );
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("asks the catalog route for whichever country is open", async () => {
    const mock = stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    const urls = mock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u === "/api/destinations?q=cusc&country=PE")).toBe(true);
  });

  test("fetches the open country's shard once, not per keystroke", async () => {
    // Keyed on the country, not the query: 750 rows arrive once and every
    // keystroke searches them in memory.
    const mock = stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cu" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cus" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    const shardCalls = mock.mock.calls.filter((c) => String(c[0]) === "/cities/PE.json");
    expect(shardCalls).toHaveLength(1);
  });

  test("offers a Peruvian city while planning Peru", async () => {
    // The gate this task deletes: with CATALOG_COUNTRIES in place, planning
    // anywhere but China offered nothing but the off-map row.
    stubFetch(PE_SHARD, []);
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cusco");
  });

  test("adds a shard city under its GeoNames id", async () => {
    // The id is what `/api/destinations/resolve` receives, and the G prefix is
    // the whole of what keeps it out of Wikidata's namespace (§3.3).
    stubFetch(PE_SHARD, []);
    const onAdd = vi.fn();
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={onAdd} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      id: "G3941584",
      name: "Cusco",
      kind: "catalog",
      country: "PE",
    });
  });

  test("ranks a Wikidata hit above a shard row that scored the same", async () => {
    // Both match "nanj" by prefix, so the tie is broken by input order, and
    // the API hit is the one with a description and an attraction count.
    stubFetch(
      {
        country: "CN",
        generatedAt: "x",
        source: "y",
        cities: [{ id: "G1799962", n: "Nanjing", lat: 32.06167, lon: 118.77778, a1: "Jiangsu", p: 7_165_292, tz: "Asia/Shanghai" }],
      },
      [NANJING]
    );
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="CN" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nanj" } });
    await pastDebounce();

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("南京");
  });

  test("drops the previous country's cities the moment the country changes", async () => {
    // Cleared up front rather than on arrival, the same reason MapExplorer's
    // airports effect clears first: for the interim between a country switch
    // and the new shard landing, the old country's cities are wrong answers,
    // not stale ones.
    stubFetch(PE_SHARD, []);
    const { rerender } = render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="PE" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cusco");

    stubFetch({ country: "JP", generatedAt: "x", source: "y", cities: [] }, []);
    rerender(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="JP" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    // Only the off-map row survives.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("as its own place");
  });

  test("does not re-offer a place a curated card already covers", async () => {
    // Yangshuo has no data/catalog.json row, so the ingest's dedup keeps it and
    // it reaches the CN shard — while "Guilin & Yangshuo" is a curated card
    // that already plans three days there. Without `curatedPlaceNames` the
    // picker offers both, which is the duplication §3.3's dedup exists to
    // remove. `rankPlaces` does not dedupe by name across kinds, so this is
    // the only thing that catches it.
    stubFetch(
      {
        country: "CN",
        generatedAt: "x",
        source: "y",
        cities: [
          { id: "G1787746", n: "Yangshuo", lat: 24.77, lon: 110.49, a1: "Guangxi", p: 30_000, tz: "Asia/Shanghai" },
        ],
      },
      []
    );
    render(
      <PlaceSearch
        curated={[{ id: "guilin", name: "Guilin & Yangshuo", localName: "桂林", knownFor: [] }]}
        coordsFor={() => null}
        selected={[]}
        country="CN"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "yangshuo" } });
    await pastDebounce();

    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.filter((t) => t.includes("Yangshuo"))).toHaveLength(1);
    expect(options[0]).toContain("Guilin & Yangshuo");
  });

  test("keeps working when a country has no shard at all", async () => {
    // 246 of ~250 codes have one; the rest 404, and a 404 behind the login
    // wall arrives as login HTML that `res.json()` rejects on. Either way the
    // off-map row is still the guaranteed path to a place.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).startsWith("/cities/")
          ? Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ available: true, results: [] }) })
      )
    );
    render(
      <PlaceSearch curated={[]} coordsFor={() => null} selected={[]} country="AQ" onAdd={vi.fn()} onRemove={vi.fn()} />
    );
    await pastDebounce();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "somewhere" } });
    await pastDebounce();

    expect(screen.getByRole("option")).toHaveTextContent("as its own place");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run components/plan/PlaceSearch.test.tsx
  ```

  Expected: the first six of the eight new tests fail, and `does not re-offer a place a curated card already covers` fails too (nothing filters the shard yet). The clearest failure is `asks the catalog route for whichever country is open`, which reports `expected false to be true` because `CATALOG_COUNTRIES` short-circuits before any fetch for `"PE"`.

- [ ] **Step 3: Write the implementation**

  In `components/plan/PlaceSearch.tsx`, replace the import block (lines 1-5) with:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCityShard, type CityShardRow } from "@/lib/cityShard";
import { curatedPlaceNames } from "@/lib/curatedNames";
import { foldPlaceName } from "@/lib/foldPlaceName";
import { rankPlaces, type RankedPlace, type SearchableCurated, type SearchableHit } from "@/lib/placeSearch";
import type { CatalogHit } from "@/lib/tripShared";
```

  Replace the constants at lines 41-45:

```tsx
/** Below this the catalog is not worth a request; one letter matches everything. */
const MIN_QUERY = 2;
/** Countries the catalog actually covers. One, for now. */
const CATALOG_COUNTRIES = new Set(["CN"]);
const DEBOUNCE_MS = 300;
```

  with:

```tsx
/** Below this the catalog is not worth a request; one letter matches everything. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;
/**
 * Shard rows handed to the ranker per keystroke. A shard holds at most 750
 * cities and the ranker slices to ten, so this only bounds the work, never the
 * answer: it is applied after the substring filter, in population order, so
 * what it drops is always smaller than what it keeps.
 */
const SHARD_CANDIDATES = 60;
```

  Replace the state declarations and the catalog effect (lines 55-97) with:

```tsx
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [shard, setShard] = useState<CityShardRow[]>([]);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The open country's GeoNames cities, fetched once per country.
   *
   * Keyed on the country rather than the query: a shard is at most 22 KB
   * gzipped and holds every city the country has, so one fetch answers every
   * keystroke from memory. `public/` is unreadable from a lambda, which is why
   * this is a static asset the browser fetches rather than a second API leg.
   *
   * Cleared up front, not just on failure — the same reason MapExplorer's
   * airports effect clears first. Between a country switch and the new shard
   * landing, the previous country's cities are wrong answers, not stale ones.
   */
  useEffect(() => {
    const controller = new AbortController();
    // Functional, not `setShard([])`: a fresh `[]` is a new reference and
    // re-renders even when the shard was already empty. React bails out when
    // the updater returns the previous value, which keeps the failure path a
    // true no-op — including in tests, where that stray render lands in a
    // microtask outside `act` and prints a warning about nothing happening.
    const clear = () => setShard((previous) => (previous.length === 0 ? previous : []));
    clear();
    fetchCityShard(country, controller.signal)
      .then((loaded) => setShard(loaded.cities))
      // A country with no shard, an offline fetch, a login-wall redirect whose
      // HTML fails to parse, or a shard whose envelope names a different
      // country than the URL asked for: the off-map row is still the
      // guaranteed path to any place, so this failure is silent by design.
      .catch(() => {
        if (!controller.signal.aborted) clear();
      });
    return () => controller.abort();
  }, [country]);

  /**
   * The Wikidata half, which only China has. Debounced, then aborted in flight
   * so a slow older response cannot overwrite a newer one after further typing.
   *
   * There is no allowlist in front of this any more. `CATALOG_COUNTRIES` lived
   * here because the catalog was China-only and its rows carried no country,
   * so querying it under a Japan scope offered Chinese cities for a Japan trip.
   * `searchCities` takes the country now and answers with that country's cities
   * or with nothing, so the request is correct for every country and the
   * allowlist has nothing left to protect.
   */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/destinations?q=${encodeURIComponent(query.trim())}&country=${encodeURIComponent(country)}`,
          { signal: controller.signal }
        );
        const json: { available: boolean; results: CatalogHit[] } = await res.json();
        setHits(json.results);
      } catch {
        if (!controller.signal.aborted) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [query, country]);
```

  Replace the `results` memo (lines 99-120) with:

```tsx
  const selectedIds = useMemo(() => selected.map((p) => p.id), [selected]);
  // Off-map rows are matched by name, not id — see RankOptions.
  const selectedOffMapNames = useMemo(
    () => selected.filter((p) => p.kind === "off-map").map((p) => p.name),
    [selected]
  );

  /**
   * The shard rows worth ranking. Filtered here rather than inside `rankPlaces`
   * so the fold runs once per row per query instead of once per render, and
   * so the ranker never sees more than `SHARD_CANDIDATES` rows.
   */
  /**
   * Names a curated card already covers, so a shard row cannot re-offer them.
   *
   * The ingest's `dropCatalogDuplicates` only removes rows that duplicate a
   * `data/catalog.json` QID city — and Yangshuo is a curated destination with
   * no catalog.json row at all, so its GeoNames row survives the ingest and
   * has to be suppressed here instead. `rankPlaces` does not dedupe by name
   * across kinds either (`lib/placeSearch.ts:86-120` concatenates with no
   * cross-kind check), so without this the picker offers a bare "Yangshuo"
   * chip beside the curated "Guilin & Yangshuo" card.
   *
   * `curatedPlaceNames` rather than the `curated` prop, because the prop
   * already excludes visited destinations — and a place the traveller has been
   * to should still not appear twice.
   */
  const suppressed = useMemo(() => curatedPlaceNames(country), [country]);

  const shardHits = useMemo<SearchableHit[]>(() => {
    if (query.trim().length < MIN_QUERY) return [];
    const q = foldPlaceName(query);
    const matched: SearchableHit[] = [];
    for (const row of shard) {
      const folded = foldPlaceName(row.n);
      if (!folded.includes(q)) continue;
      if (suppressed.has(folded)) continue;
      // GeoNames' `name` column is already the local endonym, so there is no
      // second spelling to show beside it.
      matched.push({ qid: row.id, name: row.n, localName: null, province: row.a1 });
      if (matched.length >= SHARD_CANDIDATES) break;
    }
    return matched;
  }, [shard, query, suppressed]);

  /**
   * Wikidata hits first, GeoNames rows second. `rankPlaces` breaks a score tie
   * by input index, so a city that has a researched description and an
   * attraction count outranks a bare shard row that matched just as well.
   */
  const catalogHits = useMemo<SearchableHit[]>(
    () => [
      ...hits.map((h) => ({
        qid: h.qid,
        name: h.name,
        localName: h.localName,
        province: h.province,
      })),
      ...shardHits,
    ],
    [hits, shardHits]
  );

  const results = useMemo(
    () => rankPlaces(query, curated, catalogHits, { selectedIds, selectedOffMapNames }),
    [query, curated, catalogHits, selectedIds, selectedOffMapNames]
  );
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run components/plan/PlaceSearch.test.tsx && npx tsc --noEmit
  ```

  Expected: `Test Files  1 passed (1)`, `Tests  19 passed (19)` (11 keyboard-path tests plus the 8 scoping ones), and `tsc` prints nothing. If the run is green but prints `An update to PlaceSearch inside a test was not wrapped in act(...)`, the keyboard block's fetch stub was not replaced in Step 1.

- [ ] **Step 5: Confirm the gate is gone**

  ```bash
  grep -rn "CATALOG_COUNTRIES" components lib app --include=*.ts --include=*.tsx
  ```

  Expected: no output. (Two stale git worktrees under `.claude/worktrees/` hold their own copies of the tree; they are detached checkouts, are matched by no vitest include glob, and must not be edited. Restricting the grep to `components lib app` as written keeps them out of the result.)

- [ ] **Step 6: Commit**

  ```bash
  git add components/plan/PlaceSearch.tsx components/plan/PlaceSearch.test.tsx
  git commit -m "feat: search the open country's city shard instead of an allowlist"
  ```

---

## Task 14: Gate 3, client half — the map loads the open country's shard, and a tap resolves

**Files:**
- Modify: `components/map/MapExplorer.tsx:1-20` (imports), `:118-151` (the load effect), `:174-224` (`places`), `:402-408` (the unavailable notice)
- Modify: `components/map/CountryMap.tsx:100-159` (`CountryPlaceList`)
- Modify: `components/map/MapExplorer.test.tsx:161-176` (the `beforeEach` fetch mock; 178-184 is the `afterEach`, which this task does not touch), and its `buys no China assets` test
- Modify: `components/map/CountryMap.test.tsx` (append one describe)
- Test: `components/map/MapExplorer.test.tsx`, `components/map/CountryMap.test.tsx`

**Interfaces:**
- Consumes: `fetchCityShard`, `fetchCityEnrichment`, `shardRowToMapCity`, `type CityEnrichmentIndex` (Task 8); `curatedPlaceNames` (`lib/curatedNames.ts`, Task 11); `foldPlaceName` (`lib/foldPlaceName.ts`); `DETAILED_COUNTRY` (`components/map/CountryMap.tsx:41`).
- Produces: no new exports.

Two structural facts from the recon that this task turns on:

1. **The cities effect's dependency array is `[retryKey, hasDetail]` today, not `[country]`.** `hasDetail` is a boolean, so switching CN→JP→CN refires it but JP→DE does **not**. The moment `/api/map/cities` takes a `?country=`, that array must include `countryCode` or the fetch never re-runs on a foreign-to-foreign switch. This is the single most important line in the task.
2. **`togglePlace` (`MapExplorer.tsx:242-263`) re-looks the tapped place up in the `cities` state array and silently drops the add when the lookup misses.** Nothing in it needs changing — but only because the shard cities are merged into that same array. Populating `places` from anywhere else would make a tap a no-op for those places.

- [ ] **Step 1: Write the failing tests**

  In `components/map/MapExplorer.test.tsx`, replace the `beforeEach` fetch mock (lines 161-176) with:

```tsx
/** Two Peruvian cities, in the shape scripts/ingest-cities.mjs emits. */
const PE_SHARD = {
  country: "PE",
  generatedAt: "2026-08-25",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    { id: "G3936456", n: "Lima", lat: -12.04318, lon: -77.02824, a1: "Lima region", p: 7_737_002, tz: "America/Lima" },
    { id: "G3941584", n: "Cusco", lat: -13.52264, lon: -71.96734, a1: "Cusco", p: 428_450, tz: "America/Lima" },
  ],
};

const PE_ENRICHMENT = {
  country: "PE",
  generatedAt: "2026-08-25",
  source: "Wikidata (CC0) + Wikipedia (CC BY-SA) summaries",
  cities: { G3941584: { description: "Cusco is a city in southeastern Peru.", image: null } },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const href = String(url);
    const body =
      href === CHINA_TOPOLOGY_PATH
        ? CHINA_FIXTURE
        : href.startsWith("/api/map/cities")
          ? { available: true, cities: [] }
          : href.startsWith("/api/map/airports")
            ? { airports: [] }
            : href === "/cities/PE.json"
              ? PE_SHARD
              : href === "/cities/enrich/PE.json"
                ? PE_ENRICHMENT
                // Every other country's shard and enrichment file: a 404 is the
                // honest answer, and the map has to keep working through it.
                : href.startsWith("/cities/")
                  ? null
                  : WORLD_FIXTURE;
    return Promise.resolve({
      ok: body !== null,
      status: body === null ? 404 : 200,
      json: async () => body ?? {},
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
```

  Then replace the `buys no China assets for a country that cannot use them` test — **lines 295-304**, verified against the file: the `test(` opens at 295 and its `});` closes at 304. (Lines 315-325 are a different test, `gives its back-out control the C5 tap target`; replacing those would destroy the wrong test and leave the stale `/catalog is unavailable/` assertion in place, where it would then pass vacuously because the notice's wording changes to "The city list is unavailable right now".) Then append the new Peru tests, inside the existing `describe("MapExplorer", …)`:

```tsx
  test("buys no China assets for a country that cannot use them", async () => {
    render(<Harness country="JP" />);

    await settle();
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
    expect(requested(CHINA_TOPOLOGY_PATH)).toBe(false);
    // The city catalog is still asked about — every country has one now — but
    // it is asked about for Japan, not for China.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain(
      "/api/map/cities?country=JP"
    );
    expect(screen.queryByText(/city list is unavailable/)).not.toBeInTheDocument();
  });

  test("loads the open country's shard, not China's", async () => {
    render(<Harness country="PE" />);

    await settle();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/cities/PE.json");
    expect(urls).toContain("/api/map/cities?country=PE");
    expect(urls).not.toContain(CHINA_TOPOLOGY_PATH);
  });

  test("draws Peruvian cities in the country level's place list", async () => {
    // Peru has no detail level, so the same shell shows CountryPlaceList —
    // which, before this task, was always empty outside China.
    render(<Harness country="PE" />);

    await settle();
    expect(screen.getByRole("button", { name: /Lima/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
  });

  test("a tap on a shard city resolves and is added under its GeoNames id", async () => {
    // The half of the acceptance test the client owns. `togglePlace` re-looks
    // the tapped place up in the `cities` state array and silently drops the
    // add on a miss, so this fails the moment shard cities stop being merged
    // into that array.
    const onAddCatalog = vi.fn();
    render(<Harness country="PE" onAddCatalog={onAddCatalog} />);

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Cusco/ }));

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toEqual({
      qid: "G3941584",
      name: "Cusco",
      localName: null,
      province: "Cusco",
      description: "Cusco is a city in southeastern Peru.",
      population: 428_450,
      attractionCount: 0,
    });
  });

  test("refetches when the country changes between two foreign countries", async () => {
    // The trap: the cities effect was keyed on `hasDetail`, a boolean, so
    // PE -> JP would not have refired it and Peru's cities would have stayed
    // on a Japanese map.
    const { rerender } = render(<Harness country="PE" />);
    await settle();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();

    rerender(<Harness country="JP" />);
    await settle();

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain("/cities/JP.json");
    expect(screen.queryByRole("button", { name: /Cusco/ })).not.toBeInTheDocument();
  });

  test("keeps working for a country whose shard 404s", async () => {
    render(<Harness country="JP" />);

    await settle();
    // The fallback names the country and points at search, exactly as before.
    expect(screen.getByText(/No map for Japan yet/)).toBeInTheDocument();
  });
```

  The `Harness` needs one new prop for the tap test. Replace its signature and body — **lines 228-265**, verified against the file: `function Harness({` opens at 228 and its closing `}` is at 265. (Line 266 is blank and line 267 is `describe("MapExplorer", () => {`; taking the range to 267 deletes the `describe` opener and leaves the file's final `});` unmatched — a parse error, not a test failure.)

```tsx
function Harness({
  country = "CN",
  level = "country",
  prefs,
  onAddCatalog = () => {},
}: {
  country?: string;
  level?: MapLevel;
  /**
   * Seeds `PrefsProvider` with a specific `UserPrefs`, via the same cookie it
   * reads on mount — written here, synchronously, before the provider below
   * renders and its lazy `useState` initialiser reads it back. Omitted, the
   * provider reads no cookie and falls back to `DEFAULT_PREFS` itself, which
   * is the "no explicit choice" case these tests need too.
   */
  prefs?: UserPrefs;
  onAddCatalog?: (hit: unknown) => void;
}) {
  const [activeCountry, setCountry] = useState(country);
  const [activeLevel, setLevel] = useState<MapLevel>(level);
  if (prefs) {
    document.cookie = `${PREFS_COOKIE}=${serializePrefsCookie(prefs)}; Path=/`;
  }
  // Re-render with a new `country` prop must actually move the map, or the
  // foreign-to-foreign refetch test would be asserting against frozen state.
  useEffect(() => setCountry(country), [country]);
  return (
    <PrefsProvider>
      <MapExplorer
        selected={[]}
        visited={[]}
        country={activeCountry}
        level={activeLevel}
        onCountryChange={setCountry}
        onLevelChange={setLevel}
        onToggleSelect={() => {}}
        onAddCatalog={onAddCatalog}
        onRemoveCatalog={() => {}}
        onReorder={() => {}}
      />
    </PrefsProvider>
  );
}
```

  and add `useEffect` to that file's React import on line 2, so it reads:

```tsx
import { useEffect, useState, type ComponentType } from "react";
```

  Append to `components/map/CountryMap.test.tsx`:

```tsx
describe("CountryPlaceList — a country with a full shard", () => {
  test("caps the chip list and says how many more there are", () => {
    // Before the worldwide catalog this list held at most a handful of curated
    // places and, outside China, always zero. A Peruvian shard hands it 750,
    // and nothing here bounded the render.
    const many = Array.from({ length: 200 }, (_, i) =>
      place({ id: `G${1000 + i}`, name: `City ${i}`, kind: "catalog" })
    );
    renderMap({ country: "PE", topology: null, places: many });

    expect(screen.getAllByRole("button")).toHaveLength(60);
    expect(screen.getByText(/140 more/)).toBeInTheDocument();
  });

  test("says nothing about a remainder when everything fits", () => {
    renderMap({
      country: "PE",
      topology: null,
      places: [place({ id: "G1", name: "Lima", kind: "catalog" })],
    });

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npx vitest run components/map/MapExplorer.test.tsx components/map/CountryMap.test.tsx
  ```

  Expected: `loads the open country's shard`, `draws Peruvian cities`, `a tap on a shard city resolves`, `refetches when the country changes` and both `CountryPlaceList` tests fail. `loads the open country's shard` reports `expected [ … ] to contain '/cities/PE.json'`.

- [ ] **Step 3: Write the implementation**

  In `components/map/MapExplorer.tsx`, add to the import block (after line 15's `import { CountryMap, hasDetailLevel } from "./CountryMap";`):

```tsx
import { DETAILED_COUNTRY } from "./CountryMap";
import {
  fetchCityEnrichment,
  fetchCityShard,
  shardRowToMapCity,
  type CityEnrichmentIndex,
} from "@/lib/cityShard";
import { curatedPlaceNames } from "@/lib/curatedNames";
import { foldPlaceName } from "@/lib/foldPlaceName";
```

  (or fold `DETAILED_COUNTRY` into the existing `./CountryMap` import.)

  Replace the load effect (lines 118-151) with:

```tsx
  /**
   * Everything the open country's map needs: China's province topology when
   * there is one, the Wikidata catalog's cities for that country, and the
   * GeoNames shard plus its enrichment.
   *
   * Keyed on `countryCode`, which it was not before. The old array was
   * `[retryKey, hasDetail]` — a boolean — so CN→JP→CN refired it but JP→DE did
   * not. That was harmless while /api/map/cities took no country; the moment it
   * does, a foreign-to-foreign switch would leave the previous country's cities
   * on the map.
   *
   * The shard is a static asset the browser fetches, not a second API leg:
   * `public/` is unreadable from a Vercel lambda (spec §3.2), and at 22 KB
   * gzipped for the largest country it needs no loading state of its own.
   *
   * Cleared up front, not just on failure — the same reason the airports effect
   * below clears first. Between a country switch and the new data landing, the
   * previous country's cities are wrong answers, not stale ones.
   */
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    setCities([]);
    Promise.all([
      // The province topology describes China and nothing else, so a country
      // with no detail level has nothing to draw it into.
      hasDetail
        ? fetch("/china-provinces.json", { signal: controller.signal }).then((r) => {
            if (!r.ok) throw new Error(`topology ${r.status}`);
            return r.json() as Promise<Topology>;
          })
        : Promise.resolve(null),
      fetch(`/api/map/cities?country=${encodeURIComponent(countryCode)}`, {
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`cities ${r.status}`);
          return r.json() as Promise<{ available: boolean; cities: MapCity[] }>;
        })
        .catch(() => ({ available: false, cities: [] as MapCity[] })),
      // 246 of ~250 codes have a shard; the rest 404. A country with none is a
      // country with no cities to offer, not an outage.
      fetchCityShard(countryCode, controller.signal).catch(() => null),
      fetchCityEnrichment(countryCode, controller.signal).catch(
        () => ({}) as CityEnrichmentIndex
      ),
    ])
      .then(([topo, catalogRes, shardRes, enrichment]) => {
        setTopology(topo);
        // A GeoNames row for a place a curated card already covers is a second
        // marker for the same place. `dropCatalogDuplicates` in the ingest only
        // removes rows that duplicate a data/catalog.json QID city, and
        // Yangshuo — a curated destination — has no catalog.json row, so its
        // row survives and would draw beside "Guilin & Yangshuo".
        const suppressed = curatedPlaceNames(countryCode);
        const shardCities = (shardRes?.cities ?? [])
          .filter((row) => !suppressed.has(foldPlaceName(row.n)))
          .map((row) => shardRowToMapCity(row, enrichment));
        // China is the one country that gets both halves: ~680 Wikidata cities
        // plus the 413 GeoNames rows its shard keeps after dedup, so its map
        // goes from ~680 markers to ~1,090. That is deliberate — those 413 are
        // Chinese cities the QID catalog never covered, and coverage is the
        // point of the phase. `MAX_LIST_PLACES` does not apply: China has a
        // detail level, so it renders ChinaLevel rather than CountryPlaceList.
        setCities([...catalogRes.cities, ...shardCities]);
        // Unavailable only when BOTH sources failed. A country the Wikidata
        // catalog has never covered is the normal case for 245 of them, and
        // showing an outage notice for it would be a lie.
        setCitiesUnavailable(!catalogRes.available && shardRes === null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retryKey, hasDetail, countryCode]);
```

  Replace the `catalog` half of the `places` memo (lines 207-222) with:

```tsx
    const catalog = cities.map(
      (c): MapPlace => ({
        id: c.qid,
        kind: "catalog",
        name: c.name,
        localName: c.localName,
        province: c.province,
        // `regionForProvinceText` is a China-only keyword table and its
        // `?? "Central"` fallback is one of China's own seven — which
        // `isChinaRegion` then accepts, handing a Peruvian city a Chinese
        // month-fit rather than the neutral one that guard exists to give.
        // Outside China the admin-1 name IS the region label.
        region:
          countryCode === DETAILED_COUNTRY
            ? (regionForProvinceText(`${c.province ?? ""} ${c.name}`) ?? "Central")
            : (c.province ?? ""),
        lat: c.lat,
        lon: c.lon,
        population: c.population,
        level: c.level,
        attractionCount: c.attractionCount,
        blurb: c.blurb,
      })
    );
```

  Replace the unavailable notice (lines 402-408) with:

```tsx
      {citiesUnavailable && (
        <p className="mt-2 rounded-lg bg-[var(--surf-1)] px-3 py-2 text-xs text-[var(--ink-2)]">
          The city list is unavailable right now — showing curated destinations
          only. Search still reaches every place.
        </p>
      )}
```

  In `components/map/CountryMap.tsx`, replace `CountryPlaceList` (lines 100-159) with:

```tsx
/**
 * The fallback level: no geometry, so the places themselves are the map.
 *
 * Search — the input the destination step keeps above this pane, scoped to the
 * same country — is the guaranteed path to every place (spec §6), so this panel
 * says so rather than growing a second search box that could disagree with it.
 */
function CountryPlaceList({
  country,
  places,
  selected,
  onTogglePlace,
}: {
  country: string;
  places: MapPlace[];
  selected: string[];
  onTogglePlace: (place: MapPlace) => void;
}) {
  const { name, code } = getCountry(country);
  // `getCountry` is total and never throws. For a country outside its curated
  // 24-entry table `name` is the uppercased code itself (lib/countries.ts:150,
  // `curated?.name ?? known`), so this reads "PE" rather than "Peru" — see
  // "What this phase deliberately leaves undone" #1. The `||` chain is the
  // guard for the genuinely unrecognisable case, where both are "".
  const label = name || code || "this country";
  // A country's shard holds up to 750 cities and this list is a flat row of
  // chips with no virtualisation — which was fine when it held a handful of
  // curated places and, outside China, always zero. `places` arrives in
  // population order, so the cap keeps the largest and search reaches the rest.
  const shown = places.slice(0, MAX_LIST_PLACES);
  const remainder = places.length - shown.length;

  return (
    <div className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--surf-1)]/50 p-5">
      <h4 className="font-display text-base font-bold">{label}</h4>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        {places.length > 0
          ? `Tap a place to add it, or search above for anywhere else in ${label}.`
          : `No map for ${label} yet — search above to add places, and they'll show up in your plan the same way.`}
      </p>
      {shown.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {shown.map((place) => {
            const isSelected = selected.includes(place.id);
            return (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => onTogglePlace(place)}
                  aria-pressed={isSelected}
                  className={`min-h-[var(--tap-min)] rounded-full border px-3.5 text-sm transition-colors ${
                    isSelected
                      ? "border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--paper)]"
                      : "border-[var(--line-1)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
                  }`}
                >
                  {place.name}
                  {place.localName && (
                    <span className="ml-1.5 font-kai opacity-80">{place.localName}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {remainder > 0 && (
        <p className="mt-2 text-xs text-[var(--ink-2)]">
          {remainder} more in {label} — search above to find them by name.
        </p>
      )}
    </div>
  );
}
```

  and add the constant next to `DETAILED_COUNTRY` (after `components/map/CountryMap.tsx:41`):

```tsx
/**
 * Chips the country-level fallback renders before it stops and defers to
 * search. A worldwide shard holds up to 750 cities and this list has no
 * virtualisation, no scroll cap and no filter.
 */
const MAX_LIST_PLACES = 60;
```

- [ ] **Step 4: Run the tests to verify they pass**

  ```bash
  npx vitest run components/map/MapExplorer.test.tsx components/map/CountryMap.test.tsx && npx tsc --noEmit
  ```

  Expected: `Test Files  2 passed (2)`, `Tests  31 passed (31)` (MapExplorer's 14 tests, one of them rewritten in place, plus 5 new; CountryMap's 10 plus 2 new), and `tsc` prints nothing.

- [ ] **Step 5: Run the whole suite**

  ```bash
  npx tsc --noEmit && npm test
  ```

  Expected: `tsc` prints nothing and every file passes. **This is the first point since Task 10 at which both halves of the pre-merge gate are green, so it is the first point at which the branch may be pushed.**

- [ ] **Step 6: Commit**

  ```bash
  git add components/map/MapExplorer.tsx components/map/MapExplorer.test.tsx components/map/CountryMap.tsx components/map/CountryMap.test.tsx
  git commit -m "feat: draw the open country's city shard on the map"
  ```

---

## Task 15: Lazy enrichment on first selection

**Files:**
- Create: `lib/server/cityEnrichment.ts`
- Create: `lib/server/cityEnrichment.test.ts`
- Create: `app/api/cities/enrich/route.ts`
- Modify: `app/plan/page.tsx:91-94` (`addCatalog`)

**Interfaces:**
- Consumes: `isGeoNamesId` from **`lib/geoNamesId.ts`**, not from `lib/server/cityIndex.ts` — that file static-imports the 3,672,345-byte `data/cities-index.json`, and this route never resolves a city, so importing the predicate from there would drag the whole artifact into a bundle that wants a regex. `buildEnrichmentQuery`-shaped logic is **re-implemented here in TypeScript** rather than imported from `scripts/enrich-cities.mjs`, because a Next server bundle must not pull a build script into the deploy.
- Produces:
  - `export interface CityEnrichmentRecord { description: string | null; image: string | null }`
  - `export function enrichmentQuery(geonameIds: readonly string[]): string`
  - `export function readEnrichmentRows(bindings: readonly unknown[]): Map<string, CityEnrichmentRecord>`
  - `export async function enrichCities(ids: readonly string[]): Promise<Record<string, CityEnrichmentRecord>>`
  - `export function clearEnrichmentCache(): void` — used only by the tests

Spec §4: "the first selection of an unenriched city triggers a lazy fetch, cached by id." Build-time enrichment covers 6,244 of the 59,073 cities; this covers the rest, once each, per server instance.

- [ ] **Step 1: Write the failing test**

  Create `lib/server/cityEnrichment.test.ts` with exactly this content:

```typescript
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearEnrichmentCache, enrichCities, enrichmentQuery, readEnrichmentRows } from "./cityEnrichment";

/**
 * The runtime half of enrichment: what a city gets when nobody pre-fetched it.
 *
 * `scripts/enrich-cities.mjs` covers the top 30 per country at build time.
 * This covers the other 52,829, once each per server instance, on first
 * selection.
 */

const CUSCO_ROWS = [
  { gid: { value: "3941584" }, title: { value: "Cusco" }, desc: { value: "historic city of Peru" } },
  { gid: { value: "3941584" }, img: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg" } },
];

function stubSparql(rows: unknown[]) {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results: { bindings: rows } }),
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
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
    expect(readEnrichmentRows(CUSCO_ROWS).get("G3941584")).toEqual({
      description: "historic city of Peru",
      image: "https://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg?width=640",
    });
  });

  test("drops an entity that yielded neither a description nor an image", () => {
    expect(readEnrichmentRows([{ gid: { value: "1" } }]).size).toBe(0);
  });

  test("ignores a row with no id", () => {
    expect(readEnrichmentRows([{ desc: { value: "orphan" } }]).size).toBe(0);
  });
});

describe("enrichCities", () => {
  test("returns a record keyed by the G-prefixed id", async () => {
    stubSparql(CUSCO_ROWS);
    await expect(enrichCities(["G3941584"])).resolves.toEqual({
      G3941584: {
        description: "historic city of Peru",
        image: "https://commons.wikimedia.org/wiki/Special:FilePath/Cusco.jpg?width=640",
      },
    });
  });

  test("asks upstream once per id, however many times it is requested", async () => {
    // "cached by id" (spec §4). Without it, re-opening the wizard on the same
    // trip refetches every city in it.
    const mock = stubSparql(CUSCO_ROWS);
    await enrichCities(["G3941584"]);
    await enrichCities(["G3941584"]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test("caches a miss too, so an unknown city is not retried forever", async () => {
    const mock = stubSparql([]);
    await enrichCities(["G999999999"]);
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

  test("is a no-op for an empty request", async () => {
    const mock = stubSparql([]);
    await expect(enrichCities([])).resolves.toEqual({});
    expect(mock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run --project node lib/server/cityEnrichment.test.ts
  ```

  Expected — measured, not paraphrased: the run fails at collection with

  ```
  Error: Cannot find module './cityEnrichment' imported from …/lib/server/cityEnrichment.test.ts
   Test Files  1 failed (1)
        Tests  no tests
  ```

- [ ] **Step 3: Write the implementation**

  Create `lib/server/cityEnrichment.ts` with exactly this content:

```typescript
import { isGeoNamesId } from "../geoNamesId";

/**
 * Enrichment for a city nobody pre-fetched.
 *
 * `scripts/enrich-cities.mjs` gives the top 30 per country a description and
 * an image at build time — 6,244 of 59,073. This is what the other 52,829 get,
 * on first selection, cached by id for the life of the server instance
 * (spec §4).
 *
 * The query is a re-implementation of the build script's rather than an import
 * of it: pulling a `scripts/*.mjs` into the Next server bundle would ship a
 * build tool to production. The two are small, and the pair of tests that pin
 * "bare id, P1566" sit on both sides.
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
/** A user is waiting on this, so it is one round trip and no retries. */
const MAX_IDS_PER_REQUEST = 12;

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
 * Bounded, because these keys are attacker-chosen: `wallDecision` passes
 * everything under `/api/` unconditionally (`lib/wall.ts:38`, "routes
 * self-enforce") and this route does no session check, so an anonymous caller
 * can walk `G1…G99999999` twelve at a time. Ids are validated, so there is no
 * injection — but caching a miss by design means an unbounded map would grow
 * one entry per distinct id, forever, in a lambda's memory. FIFO eviction: the
 * working set is the cities in one trip, orders of magnitude under the cap.
 */
const MAX_CACHE_ENTRIES = 20_000;
const cache = new Map<string, CityEnrichmentRecord | null>();

function remember(id: string, record: CityEnrichmentRecord | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(id, record);
}

/** Test-only: the cache is a module singleton and would leak between tests. */
export function clearEnrichmentCache(): void {
  cache.clear();
}

export async function enrichCities(
  ids: readonly string[]
): Promise<Record<string, CityEnrichmentRecord>> {
  const wanted = [...new Set(ids.filter(isGeoNamesId))].slice(0, MAX_IDS_PER_REQUEST);
  const missing = wanted.filter((id) => !cache.has(id));

  if (missing.length > 0) {
    try {
      const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(enrichmentQuery(missing))}&format=json`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { results?: { bindings?: unknown[] } };
      const found = readEnrichmentRows(json.results?.bindings ?? []);
      // Every id in this batch is now answered — the found ones with a record,
      // the rest with a cached null.
      for (const id of missing) remember(id, found.get(id) ?? null);
    } catch {
      // Not cached: a network failure says nothing about the city, and the
      // next request should be free to try again.
    }
  }

  const out: Record<string, CityEnrichmentRecord> = {};
  for (const id of wanted) {
    const record = cache.get(id);
    if (record) out[id] = record;
  }
  return out;
}
```

  Create `app/api/cities/enrich/route.ts` with exactly this content:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { enrichCities } from "@/lib/server/cityEnrichment";

/**
 * Enrichment for cities the build did not pre-fetch (spec §4).
 *
 * A thin wrapper on purpose: nothing under app/ is covered by either vitest
 * project, so every decision — which ids are valid, how many, what a failure
 * returns — lives in `enrichCities` and is tested there. Same split as
 * app/api/map/airports/route.ts.
 *
 * No Cache-Control: the response is keyed by whichever ids one user happened
 * to pick, so entries would not be shared. The in-process cache in
 * `enrichCities` is what stops the repeat work.
 *
 * Anonymous, like /api/map/cities and /api/destinations — `wallDecision` passes
 * everything under /api/ and these routes self-enforce. Unlike those two, this
 * one makes an OUTBOUND call and remembers what it learns, so `enrichCities`
 * validates every id, caps a request at twelve, and bounds its cache.
 */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return NextResponse.json({ enrichment: await enrichCities(ids) });
}
```

  In `app/plan/page.tsx`, replace `addCatalog` (lines 91-94):

```tsx
  const addCatalog = (hit: CatalogHit) => {
    setExtras((prev) => ({ ...prev, [hit.qid]: hit }));
    setSelected((prev) => (prev.includes(hit.qid) ? prev : [...prev, hit.qid]));
  };
```

  with:

```tsx
  const addCatalog = (hit: CatalogHit) => {
    setExtras((prev) => ({ ...prev, [hit.qid]: hit }));
    setSelected((prev) => (prev.includes(hit.qid) ? prev : [...prev, hit.qid]));
    // A city outside the build-time top 30 arrives with no description; the
    // first time anyone selects it, fetch one (spec §4). Fire-and-forget: the
    // pick is already committed above and a missing blurb is an accepted
    // state, so nothing here is allowed to block or to fail loudly.
    if (hit.description !== null) return;
    void fetch(`/api/cities/enrich?ids=${encodeURIComponent(hit.qid)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { enrichment?: Record<string, { description: string | null }> } | null) => {
        const description = json?.enrichment?.[hit.qid]?.description ?? null;
        if (description === null) return;
        setExtras((prev) =>
          prev[hit.qid] ? { ...prev, [hit.qid]: { ...prev[hit.qid], description } } : prev
        );
      })
      .catch(() => {});
  };
```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run --project node lib/server/cityEnrichment.test.ts && npx tsc --noEmit
  ```

  Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)`, and `tsc` prints nothing.

- [ ] **Step 5: Commit**

  ```bash
  git add lib/server/cityEnrichment.ts lib/server/cityEnrichment.test.ts app/api/cities/enrich/route.ts app/plan/page.tsx
  git commit -m "feat: enrich a city on first selection when the build did not"
  ```

---

## Task 16: The visible GeoNames CC BY 4.0 credit

**Files:**
- Create: `components/plan/GeoNamesCredit.tsx`
- Create: `components/plan/GeoNamesCredit.test.tsx`
- Modify: `components/DestinationStep.tsx:1-12` (imports), `:251-269` (the search block)
- Modify: `app/plan/page.tsx` (the wizard footer at `:277`)
- Modify: `components/TripView.tsx` (the end of `PageMain`'s children)
- Modify: `app/b/[code]/page.tsx:35-37` (the briefing footer)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function GeoNamesCredit(): React.JSX.Element`

Spec §7, in full: GeoNames is **CC BY 4.0** — attribution required. This differs from OurAirports and Natural Earth, both public domain, and it is the app's first attribution-required source. The app must carry a **visible** GeoNames credit in the UI, not only a line in `data/cities-report.md`. This is a licence obligation, not a nicety, and is the one item in this design with legal weight.

**Four surfaces, not one.** Rendering it only inside `DestinationStep` puts it on exactly one wizard step — `app/plan/page.tsx:238` mounts that component under `{step === 1 && (`, so step 0 and the generated plan on step 2 carry nothing. Worse, `components/TripView.tsx:230` renders `data.destinationNames` on the **shared trip page**, which a view-only member reaches by join code and may never leave: for a Peru trip every city name on it is GeoNames data, and that member never opens `/plan` at all. `app/b/[code]/page.tsx` is the same again for a bearer-link briefing. So the credit goes in four places:

| surface | where | why |
|---|---|---|
| `components/DestinationStep.tsx` | under the feasibility counter | where the data is being browsed |
| `app/plan/page.tsx` | the wizard footer, which every step renders | survives step 0 and step 2 |
| `components/TripView.tsx` | end of `PageMain` | the view-only shared surface; `components/trip/Rates.tsx:162,230` already establishes this page as the app's credit line, for a weaker obligation |
| `app/b/[code]/page.tsx` | the existing `<footer>` | a bearer link a non-member holds |

The repo already prefers this enforced structurally: `components/shell/CountryHero.tsx:29-33` records that `ImageCredit` "cannot be minted outside `lib/countryImagery`, so an image hero always carries one". A JSX line one has to remember is the weaker form; four of them plus a test on the trip view is the practical version here.

**Two sources, not one.** The build-time enrichment ships Wikipedia intro extracts as `blurb` (`scripts/enrich-cities.mjs`'s `firstSentences(extract)`, surfaced by `shardRowToMapCity`). Wikipedia text is **CC BY-SA 4.0** — attribution *and* share-alike, a stronger condition than CC BY. This component is the moment the app grows an attribution surface at all, so it names both rather than being built to name one and quietly needing the other.

- [ ] **Step 1: Write the failing test**

  Create `components/plan/GeoNamesCredit.test.tsx` with exactly this content:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { GeoNamesCredit } from "./GeoNamesCredit";

/**
 * GeoNames is CC BY 4.0 — the app's first attribution-required source, and the
 * one item in spec §7 with legal weight. A credit that only exists in
 * data/cities-report.md does not discharge the obligation, so this file tests
 * that it is rendered, that it names the source, and that it links the licence.
 *
 * vitest runs without globals, so testing-library registers no afterEach
 * cleanup of its own — without this every render stacks up in one document.
 */
afterEach(cleanup);

describe("GeoNamesCredit", () => {
  test("names GeoNames and links it", () => {
    render(<GeoNamesCredit />);

    const source = screen.getByRole("link", { name: /GeoNames/ });
    expect(source).toHaveAttribute("href", "https://www.geonames.org/");
  });

  test("names the licence and links its text", () => {
    // "CC BY 4.0" alone is not attribution; the licence has to be reachable.
    render(<GeoNamesCredit />);

    const licence = screen.getByRole("link", { name: "CC BY 4.0" });
    expect(licence).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  });

  test("names Wikipedia and its share-alike licence too", () => {
    // The build-time descriptions are Wikipedia intro extracts, which are
    // CC BY-SA 4.0 — attribution AND share-alike, a stronger condition than
    // GeoNames'. This component is the app's only attribution surface, so it
    // has to carry both rather than being built for one.
    render(<GeoNamesCredit />);

    expect(screen.getByRole("link", { name: /Wikipedia/ })).toHaveAttribute(
      "href",
      "https://en.wikipedia.org/"
    );
    expect(screen.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/4.0/"
    );
  });

  test("opens every link safely in a new tab", () => {
    render(<GeoNamesCredit />);

    const links = screen.getAllByRole("link");
    // Iterated rather than counted: the licence list may grow, and a count
    // here would be a second place to remember to update.
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  test("is readable text, not an aria-hidden decoration", () => {
    // A credit hidden from the accessibility tree is not a visible credit.
    const { container } = render(<GeoNamesCredit />);
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(container.textContent).toContain("GeoNames");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run components/plan/GeoNamesCredit.test.tsx
  ```

  Expected: the run fails at collection with `Failed to resolve import "./GeoNamesCredit"`.

- [ ] **Step 3: Write the implementation**

  Create `components/plan/GeoNamesCredit.tsx` with exactly this content:

```tsx
/**
 * Attribution for the worldwide city catalog.
 *
 * GeoNames is CC BY 4.0 — attribution required. Every other data source this
 * app carries (OurAirports, Natural Earth) is public domain, so this is the
 * first one with a condition attached, and spec §7 calls it the one item in
 * the design with legal weight: the credit has to be **visible in the UI**, not
 * only a line in `data/cities-report.md`.
 *
 * It names TWO sources. The city names, coordinates and provinces are
 * GeoNames' (CC BY 4.0); the descriptions are Wikipedia intro extracts
 * (CC BY-SA 4.0 — attribution and share-alike, a stronger condition), pulled
 * by scripts/enrich-cities.mjs and rendered as `MapCity.blurb`. This component
 * is the app's only attribution surface, so both belong here.
 *
 * It carries no `"use client"` of its own because it needs none: no state, no
 * effects, no handlers. That does not make it server-only — three of its four
 * call sites are inside client components, and a component imported by one is
 * compiled into the client bundle regardless of what directive it carries. It
 * is a handful of static elements either way.
 */
export function GeoNamesCredit() {
  return (
    <p className="text-[10px] leading-relaxed text-[var(--ink-2)]">
      City data from{" "}
      <a
        href="https://www.geonames.org/"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        GeoNames
      </a>
      , used under{" "}
      <a
        href="https://creativecommons.org/licenses/by/4.0/"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        CC BY 4.0
      </a>
      . Descriptions from{" "}
      <a
        href="https://en.wikipedia.org/"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        Wikipedia
      </a>
      , used under{" "}
      <a
        href="https://creativecommons.org/licenses/by-sa/4.0/"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        CC BY-SA 4.0
      </a>
      .
    </p>
  );
}
```

  In `components/DestinationStep.tsx`, add to the import block after line 5 (`import { FeasibilityCounter } …`):

```tsx
import { GeoNamesCredit } from "@/components/plan/GeoNamesCredit";
```

  and add the credit inside the search block, immediately after `<FeasibilityCounter … />` (currently line 268):

```tsx
        <FeasibilityCounter places={feasibilityPlaces} daysSet={days} />
        <GeoNamesCredit />
```

  In `app/plan/page.tsx`, import it the same way and render it in the wizard footer (`app/plan/page.tsx:277`), immediately after the `</div>` that closes the footer's flex row and before `</footer>`:

```tsx
        </div>
        {/*
          In the footer, not only inside DestinationStep: that component is
          mounted under `{step === 1 && (` at line 238, so step 0 and the
          generated plan on step 2 would carry no credit at all — and step 2 is
          full of GeoNames city names, day counts and route legs.
        */}
        <GeoNamesCredit />
      </footer>
```

  In `components/TripView.tsx`, import it and render it as the last child of `PageMain`, immediately before the closing `</PageMain>`:

```tsx
      {/*
        The shared trip page is reachable by a view-only member holding a join
        code, who may never open /plan — and for a non-Chinese trip every name
        in `data.destinationNames` above is GeoNames data. components/trip/
        Rates.tsx already renders its own `<Attribution />` on this page for a
        weaker obligation; this is the stronger one.
      */}
      <GeoNamesCredit />
    </PageMain>
```

  In `app/b/[code]/page.tsx`, add it to the existing footer:

```tsx
      <footer className="mt-12 border-t border-[var(--line-1)] pt-4 text-xs text-[var(--ink-2)]">
        A read-only trip briefing. Ask whoever shared this link if you need the booking details.
        <GeoNamesCredit />
      </footer>
```

  Finally, append a contract scan to `lib/contracts.test.ts`, so a surface cannot silently lose the credit. That file already reads the whole tree as text for exactly this class of rule, and it is the right shape here: `components/TripView.test.tsx` does not exist, and standing one up would mean mocking the whole trip payload fetch to assert one link.

```typescript
describe("C7 — every surface that renders GeoNames data credits it", () => {
  /**
   * Spec §7 is a licence obligation with legal weight, and it is the kind that
   * is discharged by a JSX line somebody has to remember. These four files
   * render city names that come from GeoNames for any non-Chinese trip:
   * the wizard footer (every step), the destination step, the shared trip page
   * a view-only member reaches by join code, and the bearer-link briefing.
   *
   * A blunt source scan on purpose, like C1 and C2 above: a component-level
   * test can only see the component it renders, and what this guards against
   * is a surface quietly dropping the import during an unrelated refactor.
   */
  const MUST_CREDIT = [
    "app/plan/page.tsx",
    "components/DestinationStep.tsx",
    "components/TripView.tsx",
    "app/b/[code]/page.tsx",
  ] as const;

  test.each(MUST_CREDIT)("%s renders GeoNamesCredit", (path) => {
    const file = FILES.find((f) => f.path === path);
    expect(file, `${path} is not in the scanned tree`).toBeDefined();
    expect(file!.code).toContain("<GeoNamesCredit");
  });

  test("the credit names both licences", () => {
    const credit = FILES.find((f) => f.path === "components/plan/GeoNamesCredit.tsx");
    expect(credit, "components/plan/GeoNamesCredit.tsx is missing").toBeDefined();
    // GeoNames is CC BY 4.0; the descriptions are Wikipedia extracts, which are
    // CC BY-SA 4.0 — attribution and share-alike.
    expect(credit!.text).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(credit!.text).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
  });
});
```

  (`FILES` is the scanned-tree constant `lib/contracts.test.ts` already builds at module scope, and `app/` is already one of its `ROOTS`.)

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run components/plan/GeoNamesCredit.test.tsx && npx vitest run --project node lib/contracts.test.ts && npx tsc --noEmit
  ```

  Expected: `components/plan/GeoNamesCredit.test.tsx` reports `Tests  5 passed (5)`; `lib/contracts.test.ts` passes with five more tests than before; and `tsc` prints nothing.

- [ ] **Step 5: Commit**

  ```bash
  git add components/plan/GeoNamesCredit.tsx components/plan/GeoNamesCredit.test.tsx components/DestinationStep.tsx components/TripView.tsx lib/contracts.test.ts app/plan/page.tsx "app/b/[code]/page.tsx"
  git commit -m "feat: carry the required GeoNames and Wikipedia credits in the UI"
  ```

---

## Task 17: Cache headers for `/cities/*`, and the login wall's behaviour pinned

**Files:**
- Modify: `next.config.ts:5-40`
- Modify: `lib/wall.test.ts` (append one describe)
- Test: `lib/wall.test.ts`

**Interfaces:**
- Consumes: `wallDecision` (`lib/wall.ts:24`, `export function wallDecision(input: WallInput): WallDecision`).
- Produces: no new exports.

Two facts from the recon that decide this task:

1. **The existing header rule cannot match a nested path.** `next.config.ts`'s `source` is `"/:asset(world-countries\\.json|world-globe\\.json|china-provinces\\.json)"` — a **single** path segment with an inline regex. `/cities/PE.json` has two segments and matches nothing, so without a new rule every shard is served with Next's default `public, max-age=0` for `public/` files, and a country switch refetches 22 KB every time.
2. **The wall already covers `public/` and is deliberately left alone.** `proxy.ts`'s matcher exempts only `_next/static`, `_next/image` and `favicon.ico`, so `/cities/PE.json` is behind the login wall exactly as `/world-globe.json` and `/china-provinces.json` already are. That is correct and needs no change: the picker only renders on `/plan`, which requires a session anyway, and `RouteMap` — the one map on a guest-reachable surface — fetches no cities at all (`components/trip/RouteMap.tsx:44-82` records that decision). Adding a `/cities/` exemption would publish 6.5 MB of data outside the wall for no user-visible gain. The test below states that so a future guest-surface picker finds the reasoning instead of a mystery.

- [ ] **Step 1: Write the failing test**

  Append to `lib/wall.test.ts`:

```typescript
describe("wallDecision — the city shards", () => {
  const signedOut = {
    hasCode: false,
    hasSessionCookie: false,
    accountsConfigured: true,
  };

  test("a city shard sits behind the wall, exactly like the topology assets", () => {
    // Deliberate, not an oversight. The picker only renders on /plan, which
    // needs a session anyway, and RouteMap — the one map a guest can reach —
    // fetches no cities at all. Exempting /cities/ would publish 6.5 MB of
    // data outside the wall for no user-visible gain.
    expect(wallDecision({ ...signedOut, pathname: "/cities/PE.json" })).toBe("redirect");
    expect(wallDecision({ ...signedOut, pathname: "/cities/index.json" })).toBe("redirect");
    expect(wallDecision({ ...signedOut, pathname: "/cities/enrich/PE.json" })).toBe("redirect");
    // The same answer the assets that already work give.
    expect(wallDecision({ ...signedOut, pathname: "/world-globe.json" })).toBe("redirect");
  });

  test("a signed-in visitor gets the shard", () => {
    expect(
      wallDecision({ ...signedOut, hasSessionCookie: true, pathname: "/cities/PE.json" })
    ).toBe("pass");
  });

  test("the enrichment route self-enforces like every other api route", () => {
    expect(wallDecision({ ...signedOut, pathname: "/api/cities/enrich" })).toBe("pass");
  });
});
```

- [ ] **Step 2: Run the test to verify it passes already**

  ```bash
  npx vitest run --project node lib/wall.test.ts
  ```

  Expected: every test passes on the first run. This is the one place in the plan where a test is written to *pin* existing behaviour rather than to drive new behaviour, because the correct change to `proxy.ts` is no change — and an unwritten decision is the kind that gets reversed by accident. If any of these fail, `proxy.ts`'s matcher or `wallDecision` has been edited and the reasoning above no longer holds.

- [ ] **Step 3: Add the cache rule to `next.config.ts`**

  Replace the `headers()` block — **lines 26-38**, verified against the file: `async headers() {` is line 26 and its `},` is line 38. (Line 24 is the last line of the docblock above it and line 25 is the closing `*/`; starting the range at 24 leaves an unterminated block comment.)

```typescript
  async headers() {
    return [
      {
        source: "/:asset(world-countries\\.json|world-globe\\.json|china-provinces\\.json)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        /**
         * The 246 city shards, their index and their enrichment files.
         *
         * A separate rule because the one above matches a SINGLE path segment
         * with an inline regex — `/cities/PE.json` has two, so it would fall
         * through to Next's `public, max-age=0` for public/ files and a country
         * switch would refetch 22 KB every time. `:path*` matches the whole
         * subtree, which is right: everything under /cities/ is the same kind
         * of generated artifact with the same lifecycle.
         *
         * A shorter window than the topology assets deliberately. These change
         * whenever the daily workflow finds movement upstream, where a topology
         * changes only when someone re-runs a build script by hand. Six hours
         * plus a day of stale-while-revalidate means a refresh reaches a
         * returning user the same day without any picker open paying for a
         * revalidation.
         *
         * BEFORE ANY SCHEMA-BREAKING REBUILD OF THESE FILES, ship a cache bust
         * first — a hashed filename or a query string. These URLs carry no
         * content hash, so a client can hold this morning's bytes while newly
         * deployed code expects a new shape. A pure data refresh is fine:
         * `parseCityShard` throws loudly rather than degrading. A shape change
         * is not.
         */
        source: "/cities/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=21600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
```

- [ ] **Step 4: Verify the rule matches**

  ```bash
  npx tsc --noEmit
  npm run dev
  ```

  `npm run dev` holds the terminal, so open a second one for the check below. Note that `next dev` rewrites `AGENTS.md` and `CLAUDE.md` as a side effect; both are gitignored (`.gitignore:8-11`), so this is expected and leaves nothing to commit.

  In that second terminal, with a signed-in session cookie or with `BETTER_AUTH_SECRET` unset locally:

  ```bash
  curl -sI http://localhost:3000/cities/PE.json | grep -i "cache-control\|content-length\|HTTP"
  ```

  Expected: `HTTP/1.1 200 OK` and `cache-control: public, max-age=21600, stale-while-revalidate=86400`. Stop the dev server afterwards. If the status is `307`, the login wall is active locally — that is correct behaviour, and it confirms the wall test above; unset `BETTER_AUTH_SECRET` for the check.

- [ ] **Step 5: Commit**

  ```bash
  git add next.config.ts lib/wall.test.ts
  git commit -m "feat: cache the city shards, and pin that they stay behind the wall"
  ```

---

## Task 18: `refresh-cities.yml` — the daily unattended rebuild

**Files:**
- Create: `.github/workflows/refresh-cities.yml`
- Test: none (a workflow file; verified by `workflow_dispatch`)

**Interfaces:**
- Consumes: `node scripts/ingest-cities.mjs`, `node scripts/enrich-cities.mjs` (Tasks 6, 7).
- Produces: nothing importable.

Modelled on `.github/workflows/refresh-airports.yml`, with three differences the recon and the spec force:

- **No `npm ci`.** Both scripts use Node built-ins plus `lib/geo.ts` and `lib/foldPlaceName.ts` via type-stripping, so there is nothing to install — the same reason `refresh-airports.yml` has no install step. `node-version: 24` is required for stable type stripping.
- **The commit covers many files, and the change test is `git status --porcelain`, not `git diff --quiet`.** Two reasons, and both matter. First, `git diff` is blind to untracked files, so a country GeoNames newly covers — which `assertSane` explicitly accepts — would arrive as an untracked shard the guard could not see. (`refresh-airports.yml` gets away with `git diff --quiet` only because it watches one always-tracked file.) Second, the guard is only meaningful at all because **every** artifact under those paths is byte-stable on a quiet day: the 246 shards through `shardPayload`, the three index files through `stampedPayload`, and `data/cities-report.md` through the shard index's timestamp. Task 6 Step 6 is the verification of exactly that, and if it does not pass this job commits ~10 MB and redeploys production nightly for nothing.
- **`cities500.zip` is 13,533,683 bytes, downloaded unconditionally, daily** (spec §8.1). That is the accepted cost; the commit-on-change guard limits deploys, not the download. The cron is offset from `refresh-airports.yml`'s `10 4 * * *` so the two jobs never contend.

- [ ] **Step 1: Write the workflow**

  Create `.github/workflows/refresh-cities.yml` with exactly this content:

```yaml
# Refreshes the worldwide city catalog from GeoNames' cities500 dump.
#
# Commits only when the catalog actually changed. `scripts/ingest-cities.mjs`
# preserves the previous `generatedAt` on every artifact whose payload is
# unchanged — each of the 246 shards via `shardPayload`, and public/cities/
# index.json, data/cities-index.json and data/cities-enrich-targets.json via
# `stampedPayload` — so a quiet day produces a byte-identical tree. That is
# what keeps this from committing 246 shards and a 3.7 MB index every night,
# and it is verified by Task 6 Step 6 rather than assumed here.
#
# A commit here triggers a Vercel deploy, so the artifacts reach production
# without anyone doing anything. That is also why the ingest script aborts
# BEFORE writing when a sanity check fails: nothing looks at this run.
#
# GeoNames is CC BY 4.0 — attribution required. The credit lives in
# components/plan/GeoNamesCredit.tsx, not here.
name: Refresh cities

on:
  schedule:
    # 04:40 UTC — after GeoNames' nightly rebuild, and half an hour after
    # refresh-airports so the two jobs never contend for a runner.
    - cron: "40 4 * * *"
  workflow_dispatch:

# Least privilege: the job writes data files and nothing else.
permissions:
  contents: write

concurrency:
  group: refresh-cities
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          # 24 for stable TypeScript type stripping: both scripts import
          # lib/*.ts leaves directly rather than keeping a copy that could drift.
          node-version: 24

      # No `npm ci`: both scripts run on Node built-ins alone.
      - name: Ingest cities
        run: node scripts/ingest-cities.mjs

      # A single failed SPARQL batch costs nothing: those ids are left out of
      # this run's scope, so they keep the enrichment they already had. What
      # DOES abort the run is `assertEnrichmentSane` — a run that would erase
      # more than half the previous coverage. That failure skips the commit
      # step below, which is the intent: a bad Wikidata day costs one skipped
      # refresh, not the catalog's whole descriptive layer. Reads
      # data/cities-enrich-targets.json, which the step above just wrote.
      - name: Enrich the top cities per country
        run: node scripts/enrich-cities.mjs

      - name: Commit if the catalog changed
        run: |
          # `git status --porcelain`, not `git diff --quiet`: `git diff` is
          # blind to untracked files, and `assertSane` explicitly accepts a
          # country GeoNames newly covers — whose shard arrives untracked.
          # refresh-airports.yml can use `git diff` only because it watches one
          # always-tracked file.
          #
          # This short-circuit is only reachable because every artifact under
          # these paths is byte-stable on a quiet day (see the header). If this
          # job commits every night, that is what broke — check Task 6 Step 6.
          CHANGED="$(git status --porcelain -- public/cities data/cities-index.json data/cities-enrich-targets.json)"
          if [ -z "$CHANGED" ]; then
            echo "No change in the city catalog — nothing to commit."
            exit 0
          fi
          echo "$CHANGED" | head -20
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          # data/cities-report.md is staged but deliberately NOT part of the
          # change test above: it is prose about the catalog, not something the
          # app reads, so it rides along with a real change instead of being
          # able to cause one.
          git add public/cities data/cities-index.json data/cities-enrich-targets.json data/cities-report.md
          git commit -m "chore: refresh cities from GeoNames"
          git push
```

- [ ] **Step 2: Verify the YAML parses and the scripts it names exist**

  ```bash
  node -e "const f=require('fs');const s=f.readFileSync('.github/workflows/refresh-cities.yml','utf8');for(const m of s.matchAll(/node (scripts\/[a-z-]+\.mjs)/g)){console.log(m[1], f.existsSync(m[1])?'OK':'MISSING');}"
  ```

  Expected:
  ```
  scripts/ingest-cities.mjs OK
  scripts/enrich-cities.mjs OK
  ```

- [ ] **Step 3: Verify the commit guard's paths are the ones the scripts write, and that the guard can actually fire**

  ```bash
  git status --porcelain -- public/cities data/cities-index.json data/cities-enrich-targets.json data/cities-report.md
  ```

  Expected: no output — those paths were all committed in Tasks 6 and 7, so a clean tree here proves the guard is watching the right files rather than a path that never changes.

  Then prove the two halves separately, because a guard that cannot fire and a guard that fires always look identical from the outside:

  ```bash
  node scripts/ingest-cities.mjs >/dev/null
  git status --porcelain -- public/cities data/cities-index.json data/cities-enrich-targets.json
  ```

  Expected: still no output. This is the short-circuit path — if anything prints, the job would commit and deploy every night.

  ```bash
  printf '\n' >> public/cities/PE.json
  git status --porcelain -- public/cities data/cities-index.json data/cities-enrich-targets.json
  git checkout -- public/cities/PE.json
  ```

  Expected: ` M public/cities/PE.json`, then a clean tree again. This is the commit path.

- [ ] **Step 4: Commit**

  ```bash
  git add .github/workflows/refresh-cities.yml
  git commit -m "ci: refresh the worldwide city catalog daily"
  ```

- [ ] **Step 5: Run it once by hand after the branch merges**

  ```bash
  gh workflow run "Refresh cities"
  gh run watch
  ```

  Expected: the run succeeds and reports `No change in the city catalog — nothing to commit.` if the artifacts committed in Tasks 6 and 7 are less than a day old, or opens exactly one commit naming only the countries that moved. This expectation is only reachable because Step 3 proved the short-circuit path locally — a run that rewrites all 246 shards, or that commits `data/cities-index.json` on a day no city moved, means a `generatedAt` somewhere is unconditional. Re-check `shardPayload` and `stampedPayload`.

---

## Task 19: The acceptance test — pick Peru, see Peruvian cities, tap one, get a plan and a route leg

**Files:**
- Create: `components/DestinationStep.test.tsx`
- Create: `lib/server/worldwideAcceptance.test.ts`
- Test: both of the above

**Interfaces:**
- Consumes: everything from Tasks 6-16.
- Produces: no exports.

Spec §5's acceptance criterion, verbatim: *a user picks Peru on the globe, sees Peruvian cities, taps one, and it appears in their plan with day counts and a route leg. Until that passes, Phase 3 is not finished and Phase 4 must not start.*

It is split across two files because the flow is split across two runtimes. The browser half — search offers Peruvian cities and a tap commits one under its GeoNames id — is jsdom. The server half — that id resolves to a plannable `Destination`, `buildItinerary` schedules it, and `suggestRoute` measures a leg between two Peruvian cities — is node, and it runs against the **real committed artifacts**, which is what makes it an acceptance test rather than a fourth restatement of the unit tests.

`components/DestinationStep.test.tsx` does not exist today; this creates it.

- [ ] **Step 1: Write the failing server-half test**

  Create `lib/server/worldwideAcceptance.test.ts` with exactly this content:

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assessFeasibility } from "../feasibility";
import { buildItinerary } from "../itinerary";
import { suggestRoute, type RoutePlace } from "../route";
import { resolveDestinations } from "./catalog";

/**
 * Spec §5's acceptance criterion, server half: a picked Peruvian city resolves
 * to a plannable destination with day counts and a measurable route leg.
 *
 * Run against the real committed artifacts, not a fixture. Every other test in
 * this repo states its own corpus so an empty result means something; this one
 * deliberately does the opposite, because the thing being checked is that the
 * artifacts that actually ship carry what the app needs.
 *
 * Skipped rather than failed when the artifacts are absent, the same rule
 * lib/isoTopology.test.ts sets: `npm ci` does not produce them and
 * scripts/ingest-cities.mjs needs network egress, so a checkout without them
 * should be honest about what went unchecked instead of red for the wrong
 * reason.
 */
const hasIndex = existsSync(join(process.cwd(), "data", "cities-index.json"));

/** Cusco and Lima, by geonameid — Peru has two cities called Cusco. */
const CUSCO = "G3941584";
const LIMA = "G3936456";

describe.skipIf(!hasIndex)("acceptance — a Peruvian city becomes a plan", () => {
  it("resolves a tapped Peruvian city into a plannable destination", () => {
    const [cusco] = resolveDestinations([CUSCO]);

    expect(cusco).toBeDefined();
    expect(cusco.name).toBe("Cusco");
    expect(cusco.country).toBe("PE");
    expect(cusco.lat).toBeCloseTo(-13.52, 1);
    expect(cusco.lon).toBeCloseTo(-71.97, 1);
    // Not a Chinese region label: "Central" is one of China's seven and
    // mapTypes.isChinaRegion would accept it, giving Cusco a Chinese month-fit.
    expect(cusco.region).not.toBe("Central");
  });

  it("gives it day counts the feasibility counter can render", () => {
    const [cusco] = resolveDestinations([CUSCO]);
    const feasibility = assessFeasibility(
      [{ id: cusco.id, fromCatalog: true, suggestedDays: [1, 3] }],
      7
    );

    expect(feasibility.cities).toBe(1);
    // CATALOG_MIN_NIGHTS raises a catalog city's floor to 2.
    expect(feasibility.nightsNeededMin).toBe(2);
    expect(feasibility.verdict).toBe("fits");
    expect(feasibility.delta).toBe(5);
  });

  it("schedules it into an itinerary with something to do each day", () => {
    const destinations = resolveDestinations([CUSCO, LIMA]);
    expect(destinations).toHaveLength(2);

    const plan = buildItinerary(
      {
        destinationIds: destinations.map((d) => d.id),
        days: 5,
        season: "autumn",
        adults: 2,
        kids: 0,
        interests: [],
      },
      destinations
    );

    expect(plan.days).toHaveLength(5);
    for (const day of plan.days) expect(day.items.length).toBeGreaterThan(0);
  });

  it("measures a route leg between them", () => {
    const places: RoutePlace[] = resolveDestinations([CUSCO, LIMA]).map((d) => ({
      id: d.id,
      name: d.name,
      lat: d.lat,
      lon: d.lon,
    }));

    const route = suggestRoute(places);

    expect(route.order).toHaveLength(2);
    expect(route.legs).toHaveLength(1);
    const leg = route.legs[0];
    expect(leg.kind).toBe("estimated");
    if (leg.kind !== "estimated") throw new Error("unreachable");
    // Lima to Cusco is 573 km great-circle. A tolerance rather than an exact
    // figure because GeoNames nudges a city centre between rebuilds; a leg that
    // drifts by more than a few kilometres is a wrong pair of cities, not noise.
    expect(leg.km).toBeGreaterThan(560);
    expect(leg.km).toBeLessThan(590);
    // Under the 1,200 km flight threshold, so it is a rail leg.
    expect(leg.mode).toBe("rail");
    expect(route.totalKm).toBe(leg.km);
  });

  it("does not resolve a Chinese city under a Peruvian id, or vice versa", () => {
    // The namespace guarantee §3.3 rests on, checked end to end: the shard's
    // ids and the Wikidata catalog's ids never answer for each other.
    expect(resolveDestinations(["Q170247"]).map((d) => d.country)).toEqual(["CN"]);
    // NOT `G170247` — that is Jinan's QID digits with the letter swapped, and
    // 170247 is an ordinary geonameid in a band GeoNames really uses. Most
    // countries have fewer than 750 cities500 rows, so every one of theirs
    // survives the cut, and this would resolve against the REAL committed
    // index. The same id lib/server/cityIndex.test.ts uses, chosen because it
    // is far outside the id space.
    expect(resolveDestinations(["G999999999"])).toEqual([]);
    expect(resolveDestinations(["3941584"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the server-half test to verify it passes**

  ```bash
  npx vitest run --project node lib/server/worldwideAcceptance.test.ts
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  5 passed (5)`. This one passes on its first run if Tasks 6-11 are correct; if any test fails, the failure names which link in the chain broke — resolution, day counts, scheduling, or the leg.

- [ ] **Step 3: Write the failing browser-half test**

  Create `components/DestinationStep.test.tsx` with exactly this content:

```tsx
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PrefsProvider } from "@/components/shell/PrefsProvider";
import { PREFS_COOKIE } from "@/lib/prefs";
import type { CatalogHit } from "@/lib/tripShared";
import type { Destination } from "@/lib/types";
import { DestinationStep } from "./DestinationStep";

/**
 * Spec §5's acceptance criterion, browser half: planning Peru offers Peruvian
 * cities, and tapping one commits it under its GeoNames id.
 *
 * The whole step is rendered rather than PlaceSearch alone, because the thing
 * under test is that search, the map pane and the feasibility counter all agree
 * about which country is open — which is exactly what the three gates broke
 * when they disagreed.
 *
 * Fixture invariant (spec §6), enforced rather than asserted in prose: the
 * shard below states `country: "PE"` and `fetchCityShard` passes the requested
 * country into `parseCityShard`, so a fixture whose envelope disagreed with the
 * URL it is served under would throw here instead of quietly drawing the wrong
 * country's cities — the failure mode PR #17's inside-out globe fixture had.
 */

/**
 * MapExplorer pulls its world-level renderers in through `next/dynamic`, which
 * is real code-splitting in production and a wall-clock dependency in tests.
 * Both are resolved up front here and handed back SYNCHRONOUSLY — a mock that
 * defers is the whole reason these tests ever needed a timeout budget. Kept
 * identical to the mock in components/map/MapExplorer.test.tsx so the two read
 * as one pattern; it throws rather than guessing when a loader matches neither
 * name or both.
 */
vi.mock("next/dynamic", async () => {
  const { WorldMap } = await import("@/components/map/WorldMap");
  const { GlobeLevel } = await import("@/components/map/GlobeLevel");
  const byName: Record<string, ComponentType<Record<string, unknown>>> = {
    WorldMap: WorldMap as unknown as ComponentType<Record<string, unknown>>,
    GlobeLevel: GlobeLevel as unknown as ComponentType<Record<string, unknown>>,
  };
  return {
    default: (loader: () => Promise<unknown>) => {
      const source = loader.toString();
      const matched = Object.keys(byName).filter((name) => source.includes(name));
      if (matched.length !== 1) {
        throw new Error(
          `next/dynamic mock matched ${matched.length} components for this loader, expected 1: ${source}`
        );
      }
      return byName[matched[0]];
    },
  };
});

const WORLD_FIXTURE = {
  topology: {
    type: "Topology",
    arcs: [
      [
        [-77, -12],
        [-71, -12],
        [-71, -13],
        [-77, -13],
        [-77, -12],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [{ type: "Polygon", id: "PE", arcs: [[0]], properties: { name: "Peru" } }],
      },
    },
  },
  smallCountries: [],
  points: [],
};

const PE_SHARD = {
  country: "PE",
  generatedAt: "2026-08-25",
  source: "GeoNames cities500 (CC BY 4.0)",
  cities: [
    { id: "G3936456", n: "Lima", lat: -12.04318, lon: -77.02824, a1: "Lima region", p: 7_737_002, tz: "America/Lima" },
    { id: "G3941584", n: "Cusco", lat: -13.52264, lon: -71.96734, a1: "Cusco", p: 428_450, tz: "America/Lima" },
  ],
};

const PE_ENRICHMENT = {
  country: "PE",
  generatedAt: "2026-08-25",
  source: "Wikidata (CC0) + Wikipedia (CC BY-SA) summaries",
  cities: { G3941584: { description: "Cusco is a city in southeastern Peru.", image: null } },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    const href = String(url);
    const body =
      href === "/cities/PE.json"
        ? PE_SHARD
        : href === "/cities/enrich/PE.json"
          ? PE_ENRICHMENT
          : href.startsWith("/api/map/cities")
            ? // Peru has no Wikidata cities: the catalog is all-China, and
              // "available" is still true because the route answered.
              { available: true, cities: [] }
            : href.startsWith("/api/map/airports")
              ? { airports: [] }
              : href.startsWith("/api/destinations")
                ? { available: true, results: [] }
                : WORLD_FIXTURE;
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = `${PREFS_COOKIE}=; Path=/; Max-Age=0`;
});

/**
 * Flush mount effects, the promises they start, and the renders those cause —
 * then let the test query synchronously. Used instead of `findBy*` for the
 * reason components/map/MapExplorer.test.tsx records: mounting this tree is
 * real CPU work rather than anything that waits, and a poll timeout cannot tell
 * "slow to compute" from "missing".
 */
async function settle(): Promise<void> {
  let previous = "";
  for (let i = 0; i < 10 && document.body.innerHTML !== previous; i++) {
    previous = document.body.innerHTML;
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/**
 * Past PlaceSearch's 300ms debounce, then drain to a fixed point.
 *
 * The wait is INSIDE `act`, not before it. components/plan/PlaceSearch.test.tsx
 * records why at lines 42-49: the debounced callback awaits the response before
 * calling `setHits`, so a bare `await new Promise(setTimeout)` leaves React no
 * act scope to attribute that update to, and the hits it writes land after the
 * assertion has already run. `vitest.setup.ts` sets `IS_REACT_ACT_ENVIRONMENT`,
 * so it also prints a warning. Copying the idiom rather than reinventing it is
 * the point — the two files should read as one pattern.
 */
async function pastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await settle();
}

/**
 * Note the deliberate absence of a `props` return. Spreading a
 * `Partial<Props>` over the literal below widens `onAddCatalog` to
 * `Mock | ((hit: CatalogHit) => void)`, and `.mock` does not exist on that
 * union — `props.onAddCatalog.mock` is a hard `tsc --noEmit` error
 * (`TS2339: Property 'mock' does not exist on type …`), reproduced against
 * this repo's own TypeScript. Tests that need to inspect a call hoist their
 * own spy and pass it in, the way components/map/MapExplorer.test.tsx already
 * does.
 */
function setup(over: Partial<Parameters<typeof DestinationStep>[0]> = {}) {
  const props = {
    selected: [] as string[],
    visited: [] as string[],
    extras: {} as Record<string, CatalogHit>,
    days: 7,
    onToggleSelect: vi.fn(),
    onToggleVisited: vi.fn(),
    onAddCatalog: vi.fn(),
    onRemoveCatalog: vi.fn(),
    onReorder: vi.fn(),
    onMonthPicked: vi.fn(),
    country: "PE",
    onCountryChange: vi.fn(),
    onAddOffMap: vi.fn(),
    offMap: [] as Destination[],
    ...over,
  };
  return render(
    <PrefsProvider>
      <DestinationStep {...props} />
    </PrefsProvider>
  );
}

describe("acceptance — planning Peru", () => {
  test("does not fall back to the curated Chinese set while Peru is open", async () => {
    // NOT a gate-2 regression test, despite reading like one: all sixteen
    // curated destinations are Chinese, so `d.country` and `(d.country ?? "CN")`
    // return the identical set for every country and this passes before Task 10,
    // after it, and if it is reverted. Gate 2 is enforced by the compiler
    // (`Destination.country` is required) and by lib/data/destinations.test.ts.
    //
    // What this does assert is narrower and still worth stating: with no
    // curated entries for the open country, the step falls through to the
    // shard rather than to the curated set.
    setup();
    await settle();

    expect(screen.queryByText(/Beijing/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cusco/ })).toBeInTheDocument();
  });

  test("offers a Peruvian city from the country's own shard", async () => {
    // Gate 1. With CATALOG_COUNTRIES in place this returned nothing but the
    // off-map row for every country except China.
    setup();
    await settle();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();

    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Cusco");
  });

  test("commits a tapped city under its GeoNames id", async () => {
    // Gate 3, and the pivot of the whole acceptance criterion: this id is what
    // /api/destinations/resolve receives, and lib/server/worldwideAcceptance
    // proves it resolves.
    const onAddCatalog = vi.fn();
    setup({ onAddCatalog });
    await settle();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cusc" } });
    await pastDebounce();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toMatchObject({
      qid: "G3941584",
      name: "Cusco",
    });
  });

  test("shows day counts once a Peruvian city is picked", async () => {
    // "with day counts" — the counter reads the same picks search wrote.
    setup({
      selected: ["G3941584"],
      extras: {
        G3941584: {
          qid: "G3941584",
          name: "Cusco",
          localName: null,
          province: "Cusco",
          description: null,
          population: 428_450,
          attractionCount: 0,
        },
      },
    });
    await settle();

    const counter = screen.getByText(/nights needed/);
    expect(counter.parentElement).toHaveTextContent("1 city");
    expect(counter.parentElement).toHaveTextContent("2 nights needed");
    expect(counter.parentElement).toHaveTextContent("7 days set");
  });

  test("draws Peru's cities in the map pane and lets one be tapped there too", async () => {
    // The two ways in agree. Before this phase the map pane was empty for
    // every country but China, so search and map disagreed about what existed.
    const onAddCatalog = vi.fn();
    setup({ onAddCatalog });
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /Lima/ }));

    expect(onAddCatalog).toHaveBeenCalledTimes(1);
    expect(onAddCatalog.mock.calls[0][0]).toMatchObject({ qid: "G3936456", name: "Lima" });
  });

  test("carries the GeoNames credit on the same screen", async () => {
    // Spec §7 is a licence obligation, and this is the screen the data is on.
    setup();
    await settle();

    expect(screen.getByRole("link", { name: /GeoNames/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /CC BY 4\.0/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the browser-half test to verify it passes**

  ```bash
  npx vitest run components/DestinationStep.test.tsx
  ```

  Expected: `Test Files  1 passed (1)` and `Tests  6 passed (6)`. If `commits a tapped city under its GeoNames id` fails with `onAddCatalog` never called, gate 1 is not wired; if `draws Peru's cities in the map pane` fails, gate 3 is not.

- [ ] **Step 5: Run the full gate**

  ```bash
  npx tsc --noEmit && npm test
  ```

  Expected: `tsc` prints nothing, and the suite is green. Test-file count rises from **77 to 87** — ten new files and none removed:

  1. `scripts/ingest-cities.test.ts`
  2. `scripts/enrich-cities.test.ts`
  3. `lib/cityShard.test.ts`
  4. `lib/curatedNames.test.ts`
  5. `lib/server/cityIndex.test.ts`
  6. `lib/server/cityEnrichment.test.ts`
  7. `lib/data/destinations.test.ts`
  8. `lib/server/worldwideAcceptance.test.ts`
  9. `components/plan/GeoNamesCredit.test.tsx`
  10. `components/DestinationStep.test.tsx`

  `lib/tripShared.test.ts` is **not** on that list: it already exists and is already in the 77. If the count lands on 86, or if `lib/tripShared.test.ts` reports 2 tests instead of 13, Task 10 overwrote it — restore it from git.

- [ ] **Step 6: Commit**

  ```bash
  git add lib/server/worldwideAcceptance.test.ts components/DestinationStep.test.tsx
  git commit -m "test: pin spec §5's acceptance criterion end to end"
  ```

- [ ] **Step 7: Verify in a real browser**

  ```bash
  npm run dev
  ```

  Then, signed in, at `http://localhost:3000/plan`:
  1. Advance to the destination step and click the 🌍 country chip.
  2. Pick **Peru** on the globe. The world level closes and the country level opens.
  3. The place list shows Lima, Cusco, Arequipa and the rest, capped at 60 with a "N more" line. Its heading reads **`PE`, not `Peru`** — that is expected, and is item 1 under "What this phase deliberately leaves undone". Do not stop for it.
  4. Type `cusc` in the search box. Cusco appears in the listbox.
  5. Press Enter. A "Cusco" chip appears, and the counter reads `1 city · 2 nights needed · 7 days set`.
  6. The GeoNames CC BY 4.0 credit is visible under the counter.
  7. Add Lima too, then advance. The generated plan carries both cities and the route panel shows a ~573 km rail leg between them.

  Anything that does not match, stop: this is the criterion spec §5 says Phase 4 must not start without.

---

## Verification checklist for the whole phase

Run at the end, before opening the PR:

```bash
npx tsc --noEmit
npm test
node -e "const f=require('fs');const i=JSON.parse(f.readFileSync('public/cities/index.json','utf8'));console.log('countries',i.countries.length,'cities',i.countries.reduce((s,c)=>s+c.count,0));"
grep -rn 'CATALOG_COUNTRIES' components lib app --include=*.ts --include=*.tsx || echo 'gate 1 removed'
grep -rn '?? "CN"' components app --include=*.ts --include=*.tsx || echo 'gate 2 removed from the UI'
grep -rn 'mapCities()' app lib --include=*.ts || echo 'gate 3 removed'
```

Expected:
```
(tsc prints nothing)
(suite green)
countries 246 cities 59073
gate 1 removed
gate 2 removed from the UI
gate 3 removed
```

Note that `grep -rn '?? "CN"' lib` **will** still match `lib/tripShared.ts:24`, which is deliberate — Task 10 explains why, and `lib/tripShared.test.ts` pins it. That is why the grep above covers `components app` and not `lib`.

## What this phase deliberately leaves undone

Recorded so the next reader does not mistake any of it for an oversight.

1. **`getCountry("PE").name` is `"PE"`, so `DestinationStep`'s country chip reads "PE" rather than "Peru".** `lib/countries.ts:153` is `name: curated?.name ?? known`, and `known` is the uppercased code itself for anything that passes `isCountryCode` (`/^[A-Za-z]{2}$/`) — so an uncurated country's "name" is its two-letter code, not an empty string. The `CURATED` table holds real names for only 24 countries; the world map does not care because `WorldMap.tsx:173` labels via `countryLabel(f.id, f.properties.name)` and so falls back to the topology's own name, but the destination step has no topology in hand. This is a pre-existing gap that the worldwide catalog makes visible rather than one it creates, and closing it means shipping a 246-entry name table to the client — a separate, self-contained change. The acceptance test above therefore asserts on the flow, not on the label.
2. **Zoom-into-a-region stays China-only.** `CountryMap.tsx:59-74` records judgement call J14: `zoomRegion` is typed `ChinaRegion | null` permanently, because other countries have no curated regions to zoom into. A worldwide catalog does not change that; admin-1 boundaries for every country are spec §6.2's problem, not this phase's.
3. **`data/catalog.json` is not regenerated.** Its 695 cities keep their Wikidata QIDs and their `chineseName` spelling; `normaliseCatalog` reads both legacy fields at the one boundary. Spec §3.3 requires exactly this so no trip data migrates.
4. **Giverny stays out** (rank 1,503/15,363 in France). Spec §2.2 accepts it: Giverny is a place you visit from Vernon rather than sleep in, so it belongs in the attractions layer, not the city catalog.
5. **The attractions layer is still China-only.** `CatalogAttraction` rows all hang off Wikidata city QIDs, and `shardRowToMapCity` reports `attractionCount: 0` for every GeoNames city. Enrichment gives those cities a description and an image; it does not give them things to do, which is why `geoNamesCityToDestination` falls back to `GENERIC_ACTIVITIES`.
6. **GitHub Actions are still pinned at `@v4`.** `refresh-cities.yml` matches `refresh-airports.yml` and `ci.yml` rather than diverging; bumping all three to `@v5` is its own change.

## Additions beyond spec §§1-9

Recorded so a reviewer does not go looking for a spec line that is not there. None is new scope; each is a consequence of the phase, and each is justified where it lands.

1. **Task 17 in its entirety** — cache headers for `/cities/*` and pinning the login wall's behaviour. Nowhere in spec §§1-9. Justified by measurement: `next.config.ts`'s existing `source` is a single-segment inline regex and cannot match `/cities/PE.json`, so without it every country switch refetches 22 KB uncached.
2. **`MAX_LIST_PLACES = 60`** (`components/map/CountryMap.tsx`, Task 14) and **`SHARD_CANDIDATES = 60`** (`components/plan/PlaceSearch.tsx`, Task 13). Necessary consequences of 750-row shards meeting an unvirtualised chip list and a per-keystroke ranker; the spec sets the shard size and is silent on both.
3. **`data/cities-enrich-targets.json`** (Tasks 4, 6, 7). Not one of spec §3.2's three storage artifacts. It exists because display order (population) throws away ranking order, and build-time enrichment needs the ranking.
4. **`regionFor` gains a `country` parameter and `Destination.region` becomes the admin-1 name outside China** (Task 11). The spec never discusses `region`, so this is a semantic change to a field it froze by omission — and a necessary one: `regionForProvinceText`'s `?? "Central"` would otherwise hand a Peruvian city a Chinese month-fit.
5. **`app/plan/page.tsx`'s off-map placeholder `region: "Central"` → `region: ""`** (Task 10). Bundled into the country change, but it is an independent behaviour change to hand-typed places.

## Risks carried into production

| risk | mitigation in this plan |
|---|---|
| `cities500.zip` is a 13.5 MB unconditional daily download in CI (spec §8.1) | Accepted. The commit-on-change guard limits deploys, not the download. Two retries with backoff and a 300 s timeout cover a slow runner. |
| ~10 MB of committed artifacts churning daily | Per-shard `generatedAt` preservation (`shardPayload`): only countries whose 750 rows actually moved appear in the diff. Verified by Task 6 Step 6, which reruns the ingest and expects `(0 changed)`. |
| `data/cities-index.json` is 3.5 MB bundled into every route that imports the catalog | Measured: 22 ms `JSON.parse` at cold start, and the `Map` build is deferred to first use. It is the mechanism `lib/server/airports.ts` already documents, one order of magnitude up. |
| A schema-breaking shard rebuild against a 6-hour cache with no content hash | Called out in `next.config.ts`'s new docblock: ship a cache bust first. `parseCityShard` throws loudly on a shape it does not know, so the failure is visible rather than silent. |
| The composite score is a heuristic validated by spot-check, not a proof (spec §8.4) | `REQUIRED_CITIES` / `REQUIRED_DEDUPED` in `assertSane` turn four of those spot-checks into a build gate, and `lib/cityShard.test.ts` checks five against the committed artifacts. |
| A country silently disappearing from the catalog | `assertSane` compares against the previous `public/cities/index.json` and aborts naming the missing codes — the count checks cannot catch this, because a country can vanish while the total stays inside the 10% band. |
| The two id namespaces merging | The `G` prefix, checked in five independent places: `parseGeoNamesRows`, `assertSane`, `parseCityShard`, `isGeoNamesId`, and `lib/cityShard.test.ts`'s scan of every committed shard. |
