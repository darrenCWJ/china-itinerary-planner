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
  // Column 15 (surveyed elevation) is blank for most of the real dump; column 16
  // (dem, modelled) is populated nearly everywhere. Zermatt sits at 1,608 m.
  base[16] = "1608";
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
        elevation: 1608,
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

  test("reads elevation, falling back to dem when the elevation column is blank", () => {
    // Column 15 (elevation) is blank for most of the dump; column 16 (dem) is
    // the modelled fallback and is populated nearly everywhere.
    expect(parseGeoNamesRows(`${tsvRow()}\n`)[0].elevation).toBe(1608);
  });

  test("prefers the surveyed elevation over dem when both are present", () => {
    expect(parseGeoNamesRows(`${tsvRow({ 15: "1620", 16: "1608" })}\n`)[0].elevation).toBe(1620);
  });

  test("carries a null elevation when neither column has a value", () => {
    // Null, not 0: sea level is a real elevation and 0 would place a Himalayan
    // town at the coast for the climate bias correction that reads this.
    expect(parseGeoNamesRows(`${tsvRow({ 15: "", 16: "" })}\n`)[0].elevation).toBeNull();
    expect(parseGeoNamesRows(`${tsvRow({ 15: "", 16: "high" })}\n`)[0].elevation).toBeNull();
  });

  test("reads GeoNames' -9999 no-data elevation as null, in either column", () => {
    // SRTM has no coverage above 60° or over water, and GeoNames writes -9999
    // there rather than leaving `dem` blank. 300 committed rows carried it
    // (HK 48, NO 41, FI 17, IS 10, GL 9 ...) as if those towns sat ten
    // kilometres below sea level — a value a lapse-rate correction would have
    // read as an elevation. Blank-equivalent, so the fallback still applies.
    expect(parseGeoNamesRows(`${tsvRow({ 15: "", 16: "-9999" })}\n`)[0].elevation).toBeNull();
    expect(parseGeoNamesRows(`${tsvRow({ 15: "-9999", 16: "1608" })}\n`)[0].elevation).toBe(1608);
  });

  test("keeps the raw admin-1 code beside the row", () => {
    // Pinned here because the next task joins a city to a polygon on this
    // code, and the resolved NAME is what the build currently keeps.
    expect(parseGeoNamesRows(`${tsvRow({ 10: "VS" })}\n`)[0].admin1Code).toBe("VS");
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
    // Not "writeFileAtomic(path," alone — that substring also matches the
    // function's own declaration ("function writeFileAtomic(path, content)"),
    // which sits above main() and would make this pass unconditionally.
    const firstWrite = source.indexOf("writeFileAtomic(path, json)");
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

  test("exits non-zero when run() rejects, so the workflow does not commit", () => {
    expect(source).toMatch(/run\(\)\.catch\([\s\S]*process\.exit\(1\)/);
  });
});

// ---------------------------------------------------------------------------
// run() — proving the gate by behavior, not by source position
//
// The describe block above only proves that the SUBSTRING "assertSane(...)"
// sits earlier in the file than the SUBSTRING "writeFileAtomic(path, json)".
// A reviewer mutation-tested that claim and found four changes that leave it
// green while a corrupt feed still reaches disk: a gate hidden behind a
// never-set env flag, a write hoisted above the gate, an early-return branch
// that writes before returning, and a try/catch that swallows the gate's
// exception. It also only pins one of `writeFileAtomic`'s five call sites.
//
// This block instead drives the real, exported `run()` with fake network
// loaders and a small (5-row) corrupt-shaped fixture — few enough countries
// that `assertSane`'s own country-count check rejects it for a genuine
// reason — and asserts by BEHAVIOR: no write primitive ever fires. That is
// what actually matters, because the nightly workflow commits whatever
// reaches disk and Vercel deploys the commit.
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, renameSync, rmSync as rmSyncReal, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { afterEach, vi } from "vitest";
import { run, staleShardFiles } from "./ingest-cities.mjs";

/**
 * `vi.spyOn` cannot touch `node:fs` directly here — Vitest's ESM module
 * namespace for a Node builtin is non-configurable, so `vi.spyOn(fs,
 * "writeFileSync")` throws "Cannot redefine property" before the test body
 * even runs. `vi.mock` with `importOriginal` is Vitest's own prescribed
 * workaround: every other primitive (`readFileSync`, `existsSync`,
 * `mkdirSync`, `readdirSync`, `rmSync`) stays real, and only the two
 * primitives that actually commit bytes to disk — `writeFileSync` and
 * `renameSync` — become no-op spies. That keeps this test file hermetic (no
 * mutation of the gate can make it write a real file, whatever else it does)
 * while still letting `expect(...).toHaveBeenCalled()` prove whether the
 * write path ran.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(), renameSync: vi.fn() };
});

describe("run() aborts before any write primitive fires when assertSane rejects the feed", () => {
  // 3,001 synthetic admin-1 names — over MIN_ADMIN1_NAMES (3,000) — so
  // `assertAdmin1Sane` passes and control actually reaches `assertSane`,
  // rather than the fixture being rejected one gate earlier for an unrelated
  // reason.
  const admin1Text = Array.from({ length: 3_001 }, (_, i) => `XX.${i}\tRegion ${i}`).join("\n");

  // Five well-formed rows across five distinct (fake) countries. `assertSane`
  // requires 246 +/-2 countries, so this is rejected for a real reason: the
  // feed looks nothing like a real GeoNames dump, the same way a truncated or
  // reshaped upstream download would.
  const citiesTsv = [
    tsvRow({ 0: "1001", 1: "Fixture City One", 3: "", 4: "10.0", 5: "10.0", 8: "ZZ", 10: "01", 14: "50000" }),
    tsvRow({ 0: "1002", 1: "Fixture City Two", 3: "", 4: "11.0", 5: "11.0", 8: "YY", 10: "01", 14: "20000" }),
    tsvRow({ 0: "1003", 1: "Fixture City Three", 3: "", 4: "-5.0", 5: "20.0", 8: "XA", 10: "01", 14: "15000" }),
    tsvRow({ 0: "1004", 1: "Fixture City Four", 3: "", 4: "40.0", 5: "-70.0", 8: "WW", 10: "01", 14: "5000" }),
    tsvRow({ 0: "1005", 1: "Fixture City Five", 3: "", 4: "-33.0", 5: "150.0", 8: "VV", 10: "01", 14: "1000" }),
  ].join("\n");

  const scratchDirs: string[] = [];

  afterEach(() => {
    // Cleanup only — created by the real, un-mocked `mkdirSync` the gate runs
    // before either check (a separate, already-tracked Minor finding). Not
    // part of what this test asserts.
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir) rmSyncReal(dir, { recursive: true, force: true });
    }
  });

  function fixtureDirs(): { dataDir: string; shardDir: string } {
    const root = mkdtempSync(pathJoin(tmpdir(), "ingest-cities-gate-test-"));
    scratchDirs.push(root);
    return { dataDir: pathJoin(root, "data"), shardDir: pathJoin(root, "cities") };
  }

  test("never calls writeFileSync or renameSync before assertSane throws", async () => {
    const { dataDir, shardDir } = fixtureDirs();
    const writeMock = vi.mocked(writeFileSync);
    const renameMock = vi.mocked(renameSync);
    writeMock.mockClear();
    renameMock.mockClear();
    await expect(
      run({
        loadCitiesTsv: async () => citiesTsv,
        loadAdmin1Text: async () => admin1Text,
        dataDir,
        shardDir,
      })
    ).rejects.toThrow(/countries produced a shard, expected 246/);
    expect(writeMock).not.toHaveBeenCalled();
    expect(renameMock).not.toHaveBeenCalled();
  });
});

describe("staleShardFiles — the sweep that runs after every shard has been written", () => {
  test("names stale shard files and never a directory, whatever it is called", async () => {
    // `rmSync(dir, { force: true })` throws ERR_FS_EISDIR — `force` forgives a
    // missing path, not a directory — so a directory reaching the sweep ended
    // the nightly refresh at its final step, after every shard was on disk.
    // `enrich/` was safe only by NAME; `climate/` here stands for the first
    // directory nobody thought to name.
    const dir = mkdtempSync(pathJoin(tmpdir(), "ingest-cities-sweep-test-"));
    try {
      // `writeFileSync` is a no-op spy in this file (see the mock above), so
      // the fixture files go through fs/promises, which the mock does not touch.
      await writeFile(pathJoin(dir, "PE.json"), "{}");
      await writeFile(pathJoin(dir, "ZZ.json"), "{}");
      await writeFile(pathJoin(dir, "index.json"), "{}");
      mkdirSync(pathJoin(dir, "enrich"));
      mkdirSync(pathJoin(dir, "climate"));
      expect(staleShardFiles(dir, ["PE"])).toEqual(["ZZ.json"]);
      // And the positive control: with nothing written, both files are stale
      // and both directories still are not.
      expect(staleShardFiles(dir, [])).toEqual(["PE.json", "ZZ.json"]);
    } finally {
      rmSyncReal(dir, { recursive: true, force: true });
    }
  });
});
