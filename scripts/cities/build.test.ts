/**
 * ingest-cities — the ranking, the dedup against the catalog, and the shards.
 *
 * Moved out of scripts/ingest-cities.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-cities.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import paths moved with them — including the three mid-file `import`
 * lines, which stay where the sections that use them are.
 */

import { describe, expect, test } from "vitest";
import { parseAdmin1Codes } from "./geonames.mjs";

// ---------------------------------------------------------------------------
// cityScore / topPerCountry
// ---------------------------------------------------------------------------

import { CITIES_PER_COUNTRY, cityScore, topPerCountry } from "./build.mjs";

interface ScorableRow {
  id: string;
  name: string;
  altNameCount: number;
  lat: number;
  lon: number;
  country: string;
  admin1Code: string;
  population: number;
  /** Metres. Surveyed where GeoNames has it, modelled from `dem` otherwise. */
  elevation: number | null;
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
    elevation: 100,
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
    expect(kept.get("FR")!.map((r: ScorableRow) => r.id)).toEqual(["G1"]);
    expect(kept.get("PE")!.map((r: ScorableRow) => r.id)).toEqual(["G3"]);
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
    expect(kept.get("XX")!.map((r: ScorableRow) => r.id)).toEqual(["G2", "G3", "G1"]);
  });

  test("breaks a score tie by id so a rebuild is byte-stable", () => {
    // Two rows with identical score are otherwise ordered by whatever order
    // the dump happened to list them in, and GeoNames does reorder rows —
    // which would rewrite a shard nightly with no data change.
    const kept = topPerCountry(
      [scorable({ id: "G9" }), scorable({ id: "G2" }), scorable({ id: "G5" })],
      3
    );
    expect(kept.get("XX")!.map((r: ScorableRow) => r.id)).toEqual(["G2", "G5", "G9"]);
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

// ---------------------------------------------------------------------------
// dropCatalogDuplicates
// ---------------------------------------------------------------------------

import { DEDUP_RADIUS_KM, dropCatalogDuplicates } from "./build.mjs";
import { haversineKm } from "@/lib/geo";

/** Jinan as data/catalog.json really holds it (Q170247). */
const JINAN_QID = { name: "Jinan", lat: 36.666666666, lon: 116.983333333 };

/**
 * The smallest double strictly greater than a positive `x` — one bit up in
 * the IEEE 754 representation, i.e. the very next representable number.
 */
function nextDoubleUp(x: number): number {
  const buf = new ArrayBuffer(8);
  const asFloat = new Float64Array(buf);
  const asBits = new BigUint64Array(buf);
  asFloat[0] = x;
  asBits[0] = asBits[0] + BigInt(1);
  return asFloat[0];
}

/**
 * Derives the tightest possible pair of fixtures for pinning `<=` in
 * `dropCatalogDuplicates`: a latitude whose real haversine distance from the
 * origin is bit-exact `DEDUP_RADIUS_KM`, and the very next representable
 * latitude past it.
 *
 * Exact 5.000000...km is NOT reachable near real coordinates — bisecting
 * near Jinan's actual ~36.7N lands on 4.999999999999912, and the next
 * representable latitude there jumps straight past to 5.0000000000007025,
 * skipping over the tie entirely (floating-point ULPs at that magnitude are
 * coarser than the distance function's own precision). Bisecting from the
 * equator/prime-meridian instead works: latitude doubles are far smaller in
 * magnitude there, so adjacent representable values sit close enough
 * together that the computed distance actually lands exactly on the double
 * `5`, with the next representable latitude landing a few femtometres past
 * it — nowhere near the 1 km slack the old fixture used.
 *
 * Bisecting with the real `haversineKm` (the same function
 * `dropCatalogDuplicates` calls internally) rather than hand-deriving trig
 * keeps this self-consistent with whatever a given JS engine's
 * Math.sin/cos/asin actually return, on whatever machine runs this suite.
 */
function findBoundaryLatitudes(): { atLimitLat: number; justPastLimitLat: number } {
  const origin = { lat: 0, lon: 0 };
  let lo = 0; // distance 0 km — certainly within the radius
  let hi = DEDUP_RADIUS_KM; // degrees: ~555 km, certainly past the radius
  // Bisection over representable doubles terminates once lo and hi are
  // adjacent — (lo + hi) / 2 then rounds back to whichever endpoint it's
  // closer to, and the loop stops.
  while (true) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (haversineKm(origin, { lat: mid, lon: 0 }) <= DEDUP_RADIUS_KM) lo = mid;
    else hi = mid;
  }
  return { atLimitLat: lo, justPastLimitLat: nextDoubleUp(lo) };
}

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
    expect(dropCatalogDuplicates(rows, [JINAN_QID]).map((r: ScorableRow) => r.id)).toEqual(["G1"]);
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
    expect(dropCatalogDuplicates(rows, [JINAN_QID]).map((r: ScorableRow) => r.id)).toEqual(["G1"]);
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
    // A prior version of this test placed `atLimit` at a computed offset from
    // JINAN_QID that *looked* boundary-exact but whose true haversine
    // distance was 4.999999999999912 km — strictly inside the radius under
    // both `<=` and `<`. It could not fail even with the implementation's
    // `<=` mutated to `<`; it asserted nothing about the boundary at all.
    //
    // This version fixes that by deriving fixtures whose distance from a
    // synthetic catalog city at the origin (0, 0) is bit-exact
    // `DEDUP_RADIUS_KM`, via `findBoundaryLatitudes` above — using (0, 0)
    // rather than JINAN_QID's real coordinates is what makes hitting that
    // exact tie possible at all (see that function's comment). Asserting the
    // computed distances explicitly documents exactly what is pinned, rather
    // than leaving the reader to assume a bit-exact 5.000000 km that ordinary
    // lat/lon arithmetic cannot generally produce.
    const { atLimitLat, justPastLimitLat } = findBoundaryLatitudes();
    const origin = { name: "Jinan", lat: 0, lon: 0 };

    expect(haversineKm(origin, { lat: atLimitLat, lon: 0 })).toBe(DEDUP_RADIUS_KM);
    expect(haversineKm(origin, { lat: justPastLimitLat, lon: 0 })).toBeGreaterThan(DEDUP_RADIUS_KM);

    const atLimit = scorable({ id: "G1", name: "Jinan", country: "CN", lat: atLimitLat, lon: 0 });
    const pastLimit = scorable({ id: "G2", name: "Jinan", country: "CN", lat: justPastLimitLat, lon: 0 });

    // At the tie, `<=` must drop the row as a duplicate. This is the
    // assertion an implementation using `<` instead of `<=` fails.
    expect(dropCatalogDuplicates([atLimit], [origin])).toEqual([]);
    // One representable double past the tie, the row must survive.
    expect(dropCatalogDuplicates([pastLimit], [origin]).map((r: ScorableRow) => r.id)).toEqual(["G2"]);
  });

  test("is a no-op when there is nothing to dedup against", () => {
    // Every country but China: the QID catalog is all-China, so 245 of the 246
    // shards take this path.
    const rows = [scorable({ id: "G1", country: "PE" }), scorable({ id: "G2", country: "PE" })];
    expect(dropCatalogDuplicates(rows, []).map((r: ScorableRow) => r.id)).toEqual(["G1", "G2"]);
  });

  test("preserves the input order of what it keeps", () => {
    // The caller hands it ranking order and expects ranking order back —
    // reordering here would silently change which 30 cities get enriched.
    const rows = [
      scorable({ id: "G3", name: "Gamma", country: "CN" }),
      scorable({ id: "G1", name: "Alpha", country: "CN" }),
      scorable({ id: "G2", name: "Beta", country: "CN" }),
    ];
    expect(dropCatalogDuplicates(rows, []).map((r: ScorableRow) => r.id)).toEqual(["G3", "G1", "G2"]);
  });

  test("the radius is 5 km", () => {
    expect(DEDUP_RADIUS_KM).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// buildCities
// ---------------------------------------------------------------------------

import { ENRICH_PER_COUNTRY, buildCities } from "./build.mjs";

/**
 * Mirrors spec §2.2's shard record, nine fields since Phase 4. `buildCities`
 * returns a bare
 * `Map` from a `.mjs` module with no type info, so a callback consuming a
 * shard row needs this annotation to avoid TS7006 implicit-any — the same
 * pattern `ScorableRow` already establishes above for `topPerCountry`.
 */
interface ShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  a1: string | null;
  /** The GeoNames admin-1 code `a1` was resolved from, `"<CC>.<CODE>"`. */
  a1c: string | null;
  p: number;
  /** Metres. Surveyed where GeoNames has it, modelled otherwise. */
  elev: number | null;
  tz: string;
}

const ADMIN1 = parseAdmin1Codes(
  ["CH.VS\tValais\tValais\t2658205", "PE.08\tCusco\tCusco\t3937483"].join("\n")
);

describe("buildCities", () => {
  test("emits the nine-field record with the admin-1 code resolved to a name", () => {
    const { shards } = buildCities(
      [scorable({ id: "G2657928", name: "Zermatt", country: "CH", admin1Code: "VS", lat: 46.01998, lon: 7.74863, population: 6_629, elevation: 1_608, timezone: "Europe/Zurich" })],
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
        a1c: "CH.VS",
        p: 6_629,
        elev: 1_608,
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
    expect(shards.get("CH")!.map((r: ShardRow) => r.a1)).toEqual([null, null]);
  });

  test("sorts each shard by population descending, not by score", () => {
    // §3.2: ranking decides inclusion only. Dunkirk outranks Lyon on score
    // because wartime fame inflates alternate names; the user must never see
    // that.
    const dunkirk = scorable({ id: "G1", name: "Dunkirk", country: "FR", altNameCount: 40, population: 87_000 });
    const lyon = scorable({ id: "G2", name: "Lyon", country: "FR", altNameCount: 20, population: 522_000 });
    const { shards } = buildCities([dunkirk, lyon], ADMIN1, []);
    expect(shards.get("FR")!.map((r: ShardRow) => r.n)).toEqual(["Lyon", "Dunkirk"]);
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
    expect(shards.get("FR")!.map((r: ShardRow) => r.id)).toEqual(["G2", "G9"]);
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
    expect(shards.get("CH")!.map((r: ShardRow) => r.n)).toEqual(["Bulle", "Zermatt"]);
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

describe("buildCities — the nine-field record", () => {
  const rows = [
    scorable({ id: "G1", name: "Cusco", country: "PE", admin1Code: "08", population: 100_168, elevation: 3_399 }),
    scorable({ id: "G2", name: "Lima", country: "PE", admin1Code: "08", population: 8_472_935, elevation: 154 }),
  ];

  test("keeps the admin-1 code alongside the resolved name", () => {
    const { shards } = buildCities(rows, ADMIN1, []);
    const lima = shards.get("PE")!.find((r: ShardRow) => r.n === "Lima")!;
    // The name is what the user reads; the code is what joins to a polygon.
    // Both, because the name join to Natural Earth admin-1 measured 63.4%
    // with 35 countries at zero, and the code matches gn_a1_code on 83%.
    expect(lima.a1).toBe("Cusco");
    expect(lima.a1c).toBe("PE.08");
  });

  test("carries elevation through to the shard", () => {
    const { shards } = buildCities(rows, ADMIN1, []);
    const cusco = shards.get("PE")!.find((r: ShardRow) => r.n === "Cusco")!;
    expect(cusco.elev).toBe(3_399);
    expect(shards.get("PE")!.find((r: ShardRow) => r.n === "Lima")!.elev).toBe(154);
  });

  test("carries a null elevation rather than inventing a sea-level one", () => {
    const { shards } = buildCities([scorable({ id: "G1", country: "PE", elevation: null })], ADMIN1, []);
    expect(shards.get("PE")![0].elev).toBeNull();
  });

  test("nulls the code when GeoNames gives the row no admin-1", () => {
    const { shards } = buildCities([scorable({ id: "G1", country: "PE", admin1Code: "" })], ADMIN1, []);
    const [city] = shards.get("PE")!;
    // Not "PE." — a dangling prefix would look like a real key and would
    // match nothing, which is worse than an honest null.
    expect(city.a1c).toBeNull();
    expect(city.a1).toBeNull();
  });

  test("does not resolve an admin-1 code named like an Object member", () => {
    // `admin1Codes` is a Map for this reason; the code is a data-file value
    // and a plain object would answer "constructor" with a function.
    const { shards } = buildCities(
      [scorable({ id: "G1", country: "PE", admin1Code: "constructor" })], ADMIN1, []
    );
    expect(shards.get("PE")![0].a1).toBeNull();
    expect(shards.get("PE")![0].a1c).toBe("PE.constructor");
  });
});
