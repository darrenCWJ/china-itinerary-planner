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
