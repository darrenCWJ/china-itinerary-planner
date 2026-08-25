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

  test("throws when the central directory overstates a stored member's compressedSize", () => {
    // A lying central directory, not a lying local header: the local header
    // and the real payload bytes agree with each other (24 bytes, genuinely
    // present), only the central directory's compressedSize claim is wrong —
    // exactly what a truncated-in-transit or tampered archive looks like.
    // `Buffer.subarray` silently CLAMPS an out-of-range end instead of
    // throwing, so an unvalidated slice would splice the archive's own
    // central-directory and EOCD bytes onto the genuine 24 bytes and hand the
    // caller a wrong-but-plausible-looking payload with no error at all.
    const name = "cities500.txt";
    const nameBuf = Buffer.from(name, "utf8");
    const body = Buffer.from("twenty-four byte body!!!", "utf8"); // 24 bytes
    expect(body.length).toBe(24);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8); // method 0 (stored)
    local.writeUInt32LE(body.length, 18); // local header tells the truth
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 10); // method 0 (stored)
    central.writeUInt32LE(100_000, 20); // the lie: claims 100,000 bytes
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 42); // local header offset
    nameBuf.copy(central, 46);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length + body.length, 16);

    const zip = Buffer.concat([local, body, central, eocd]);
    expect(() => readZipMember(zip, name)).toThrow(/corrupt zip/);
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

import { DEDUP_RADIUS_KM, dropCatalogDuplicates } from "./ingest-cities.mjs";
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

import { ENRICH_PER_COUNTRY, buildCities } from "./ingest-cities.mjs";

/**
 * Mirrors spec §2.2's seven-field shard record. `buildCities` returns a bare
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
  p: number;
  tz: string;
}

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
