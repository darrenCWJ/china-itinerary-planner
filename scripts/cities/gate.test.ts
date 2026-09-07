/**
 * ingest-cities — the gate that runs before the first write.
 *
 * Moved out of scripts/ingest-cities.test.ts on 2026-09-07 (spec
 * 2026-09-07-unscheduled-items §2.1) when scripts/ingest-cities.mjs was split
 * along its section banners. Every describe below is that file's, unchanged;
 * only the import paths moved with them.
 */

import { describe, expect, test } from "vitest";

/**
 * The nine-field shard record, copied from `scripts/cities/build.test.ts` where
 * it used to sit further up the same file. `shardRow` below fills all nine
 * fields, so the second, seven-field declaration that came with it still needs
 * this one to merge with — which is what its own docblock says.
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
} from "./gate.mjs";

interface ShardRow {
  id: string;
  n: string;
  lat: number;
  lon: number;
  a1: string | null;
  p: number;
  tz: string;
}

/**
 * A shard row that passes every per-record check, so a test can break one.
 *
 * `ShardRow` is declared twice in this file and TypeScript merges the two, so
 * the two new Phase 4 fields are declared once, above, and are in scope here.
 *
 * `a1` defaults to a resolved name rather than null: the real admin-1
 * resolution rate is 99.26%, and a fixture that left every row unresolved
 * would fail Finding A's floor by default, in every test in this file that
 * doesn't care about admin-1 at all.
 */
function shardRow(over: Partial<ShardRow> & Pick<ShardRow, "id">): ShardRow {
  return {
    n: `City ${over.id}`, lat: 10, lon: 20, a1: "Region", a1c: "XX.01",
    p: 1_000, elev: 100, tz: "UTC", ...over,
  };
}

/** Synthetic two-letter codes, AA, AB, AC … — a deterministic filler alphabet. */
function syntheticCountryCode(i: number): string {
  const a = "A".charCodeAt(0);
  return String.fromCharCode(a + (Math.floor(i / 26) % 26), a + (i % 26));
}

/** Every row across every shard, as live references — mutate in place to corrupt a fixture. */
function flattenCities(shards: Map<string, ShardRow[]>): ShardRow[] {
  return [...shards.values()].flat();
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
 *
 * The default `perCountry` (240) is close to the real per-country average
 * (59,073 / 246 ≈ 240.1), not the old arbitrary 300: Finding C turns the city
 * total into an exact expectation with a +/-25% band, and 246 countries at
 * 300 apiece sits close enough to that ceiling that a single extra territory
 * (the 247-country case below) would tip over it on an unrelated test.
 */
function saneShards(options: { countries?: number; perCountry?: number } = {}) {
  const countries = options.countries ?? EXPECTED_COUNTRIES;
  const perCountry = options.perCountry ?? 240;
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

  // ---------------------------------------------------------------------------
  // Finding A: an admin1 reshape must not pass undetected
  // ---------------------------------------------------------------------------

  test("aborts when admin1 has reshaped and every a1 comes out null", () => {
    // `assertAdmin1Sane` only checks the SIZE of the admin1 Map, so a
    // reshaped key column (GeoNames renaming or reordering it) still yields a
    // full 3,865-entry Map that matches NOTHING in `buildCities`'s lookup —
    // every province label goes null and that check passes regardless.
    // `assertSane` must be the one that notices, because it is the one
    // holding the actual joined output.
    const shards = saneShards();
    for (const city of flattenCities(shards)) city.a1 = null;
    expect(() => assertSane(shards, null)).toThrow(/admin-1/);
  });

  test("accepts the real 99.26% admin-1 resolution rate, and a rate just above the 90% floor", () => {
    // The default fixture already resolves ~100% of rows via shardRow's
    // default; this pins the measured real-world rate as a control before
    // testing the floor's edge.
    expect(() => assertSane(saneShards(), null)).not.toThrow();

    // Blank ~9% of rows -> ~91% resolved, just above the 90% floor.
    const shards = saneShards();
    const cities = flattenCities(shards);
    const toBlank = Math.floor(cities.length * 0.09);
    for (let i = 0; i < toBlank; i++) cities[i].a1 = null;
    expect(() => assertSane(shards, null)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Finding B: an all-zero-population feed must not pass
  // ---------------------------------------------------------------------------

  test("aborts when population has gone blank feed-wide", () => {
    // `parseGeoNamesRows` deliberately maps a blank population cell to 0. If
    // the population column goes blank across the whole feed, every row
    // scores on `altNameCount` alone — which `cityScore`'s own doc calls an
    // inadequate separator — and the descending-population-order check is
    // vacuous for a constant column, so nothing currently catches this.
    const shards = saneShards();
    for (const city of flattenCities(shards)) city.p = 0; // all equal: still "descending"
    expect(() => assertSane(shards, null)).toThrow(/population/i);
  });

  test("accepts the real global zero-population rate, and Mongolia's real 84% within a healthy global mix", () => {
    // Global rate: measured real is 7.99%; 8% here must stay under the 25%
    // ceiling.
    const shards = saneShards();
    const cities = flattenCities(shards);
    const toZero = Math.floor(cities.length * 0.08);
    for (let i = 0; i < toZero; i++) cities[i].p = 0;
    for (const [country, list] of shards) {
      shards.set(country, [...list].sort((a, b) => b.p - a.p || a.id.localeCompare(b.id)));
    }
    expect(() => assertSane(shards, null)).not.toThrow();

    // Per-country rate: Mongolia's real rate is 84% (279/332) and MUST pass,
    // because the ceiling is global. A per-country ceiling would wrongly
    // abort on this healthy country while the feed as a whole is fine.
    const shards2 = saneShards();
    const mongolia = shards2.get("AA")!; // first synthetic filler country
    const zeroCount = Math.floor(mongolia.length * 0.84);
    for (let i = 0; i < zeroCount; i++) mongolia[mongolia.length - 1 - i].p = 0;
    shards2.set("AA", [...mongolia].sort((a, b) => b.p - a.p || a.id.localeCompare(b.id)));
    expect(() => assertSane(shards2, null)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Finding C: the city total is a floor with no ceiling
  // ---------------------------------------------------------------------------

  test("aborts when the city total blows past the ceiling (an un-cut cities500/cities1000 ingest)", () => {
    // 246 countries at 749 apiece (just under the CITIES_PER_COUNTRY cap of
    // 750, so this isn't rejected for a different reason first) totals
    // ~184,500 — 3.1x real. On a FIRST run (`previous === null`) the total
    // floor/ceiling is the ONLY bound in play, exactly as in production.
    const shards = saneShards({ perCountry: 749 });
    let total = 0;
    for (const cities of shards.values()) total += cities.length;
    expect(total).toBeGreaterThan(180_000);
    expect(() => assertSane(shards, null)).toThrow(/ceiling/);
  });

  test("accepts a total close to the real 59,073 count, comfortably inside the +/-25% band", () => {
    const shards = saneShards(); // ~59,043 by default — matches the measured 59,073 closely
    let total = 0;
    for (const cities of shards.values()) total += cities.length;
    expect(total).toBeGreaterThan(44_305);
    expect(total).toBeLessThan(73_841);
    expect(() => assertSane(shards, null)).not.toThrow();
  });
});

describe("assertSane — the a1c gate", () => {
  test("throws when the admin-1 code has gone all-null", () => {
    const shards = saneShards();
    for (const row of flattenCities(shards)) row.a1c = null;
    // The existing admin1Resolved gate counts `a1`, which these rows still
    // carry, so it stays green here — which is exactly how this field could
    // vanish unnoticed from an artifact that auto-deploys.
    expect(() => assertSane(shards, null)).toThrow(/a1c/i);
  });

  test("throws when the field is dropped from the record entirely", () => {
    // The failure this gate exists for is `buildCities` losing the field, and
    // then every row reads `undefined` rather than null. A check written as
    // `row.a1c !== null` would count all of them as present and sail through.
    const shards = saneShards();
    for (const row of flattenCities(shards)) delete (row as Partial<ShardRow>).a1c;
    expect(() => assertSane(shards, null)).toThrow(/a1c/i);
  });

  test("does not throw when a realistic minority lack a code", () => {
    // Measured: 0.75% of committed rows have no admin-1 at all, and 19
    // countries genuinely have no subdivision to record. The floor sits well
    // under that because it is a collapse detector, not a quality bar.
    const shards = saneShards();
    const rows = flattenCities(shards);
    for (let i = 0; i < Math.floor(rows.length * 0.1); i++) rows[i].a1c = null;
    expect(() => assertSane(shards, null)).not.toThrow();
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
