import { describe, expect, test } from "vitest";
import { assertSane, buildAirports } from "./ingest-airports.mjs";

/**
 * Covers `buildAirports` and `assertSane` — the only gate that runs
 * unattended on the nightly refresh workflow (there is no CI). The module's
 * own entry-point guard (`if (process.argv[1] && ...)`) means importing it
 * here does not also run `main()` and refetch/rewrite the artifact as a side
 * effect.
 *
 * Import note: the script is `.mjs` and reads `../lib/csv.ts` via Node's
 * native type-stripping at runtime, but under Vitest the whole module graph
 * goes through Vite's transform pipeline instead, which resolves an explicit
 * `.ts` extension same as any other module — no adjustment was needed to get
 * `import { assertSane, buildAirports } from "./ingest-airports.mjs"` to
 * resolve here.
 */

const HEADER = [
  "type",
  "name",
  "latitude_deg",
  "longitude_deg",
  "iso_country",
  "municipality",
  "scheduled_service",
  "icao_code",
  "iata_code",
];

/** A syntactically valid, scheduled-service row. Column order matches HEADER. */
function row(overrides: Partial<Record<(typeof HEADER)[number], string>> = {}): string[] {
  const base: Record<string, string> = {
    type: "large_airport",
    name: "Test International Airport",
    latitude_deg: "40.08",
    longitude_deg: "116.58",
    iso_country: "CN",
    municipality: "Testville",
    scheduled_service: "yes",
    icao_code: "ZZZZ",
    iata_code: "AAA",
    ...overrides,
  };
  return HEADER.map((col) => base[col]);
}

describe("buildAirports", () => {
  test("aborts when a required column is missing from the header", () => {
    const header = HEADER.filter((c) => c !== "latitude_deg");
    expect(() => buildAirports([header, row()])).toThrow(/missing column/);
  });

  test("aborts on a ragged row rather than reading undefined out of it", () => {
    const ragged = row().slice(0, -1); // one column short
    expect(() => buildAirports([HEADER, ragged])).toThrow(/ragged row/);
  });

  test("skips a trailing blank line without treating it as ragged", () => {
    const airports = buildAirports([HEADER, row({ iata_code: "AAA" }), []]);
    expect(airports).toHaveLength(1);
  });

  test("drops rows with no scheduled service", () => {
    const airports = buildAirports([HEADER, row({ scheduled_service: "no" })]);
    expect(airports).toHaveLength(0);
  });

  test("drops rows with no 3-letter IATA code", () => {
    const airports = buildAirports([HEADER, row({ iata_code: "" })]);
    expect(airports).toHaveLength(0);
  });

  describe("blank coordinates (Finding 2a)", () => {
    test("a blank latitude is dropped, not planted at Null Island", () => {
      const airports = buildAirports([HEADER, row({ latitude_deg: "" })]);
      expect(airports).toHaveLength(0);
    });

    test("a whitespace-only longitude is dropped the same way", () => {
      const airports = buildAirports([HEADER, row({ longitude_deg: "   " })]);
      expect(airports).toHaveLength(0);
    });

    test("a genuinely non-finite coordinate is still dropped", () => {
      const airports = buildAirports([HEADER, row({ latitude_deg: "not-a-number" })]);
      expect(airports).toHaveLength(0);
    });
  });

  describe("prototype-safe size lookup (Finding 2c)", () => {
    test("a recognised type maps to its size", () => {
      const airports = buildAirports([
        HEADER,
        row({ iata_code: "AAA", type: "large_airport" }),
        row({ iata_code: "BBB", type: "medium_airport" }),
        row({ iata_code: "CCC", type: "small_airport" }),
      ]);
      expect(airports.find((a) => a.iata === "AAA")?.size).toBe("large");
      expect(airports.find((a) => a.iata === "BBB")?.size).toBe("medium");
      expect(airports.find((a) => a.iata === "CCC")?.size).toBe("small");
    });

    test("an unrecognised type falls back to 'small'", () => {
      const airports = buildAirports([HEADER, row({ type: "seaplane_base" })]);
      expect(airports[0].size).toBe("small");
    });

    test("a type of 'constructor' does not resolve to Object.prototype.constructor", () => {
      // The exact reviewer repro: a plain `{}[type] ?? 'small'` lookup would
      // return a function here (Object.prototype.constructor), which is not
      // nullish, so `?? 'small'` would never catch it — and JSON.stringify
      // would then silently drop `size` from the committed record entirely.
      const airports = buildAirports([HEADER, row({ type: "constructor" })]);
      expect(airports).toHaveLength(1);
      expect(typeof airports[0].size).toBe("string");
      expect(airports[0].size).toBe("small");
      // Confirms the record actually survives a JSON round-trip with `size`
      // intact — the concrete failure mode the reviewer found.
      expect(JSON.parse(JSON.stringify(airports[0]))).toHaveProperty("size", "small");
    });

    test("other inherited Object.prototype names are equally safe", () => {
      for (const type of ["toString", "hasOwnProperty", "__proto__", "valueOf"]) {
        const airports = buildAirports([HEADER, row({ type })]);
        expect(airports[0].size).toBe("small");
      }
    });
  });

  test("a clean pass returns a fully populated record", () => {
    const airports = buildAirports([
      HEADER,
      row({
        iata_code: "pek",
        icao_code: "zbaa",
        name: "Beijing Capital International Airport",
        municipality: "Beijing",
        iso_country: "cn",
        latitude_deg: "40.08",
        longitude_deg: "116.58",
        type: "large_airport",
      }),
    ]);
    expect(airports).toEqual([
      {
        iata: "PEK",
        icao: "ZBAA",
        name: "Beijing Capital International Airport",
        municipality: "Beijing",
        country: "CN",
        lat: 40.08,
        lon: 116.58,
        size: "large",
      },
    ]);
  });

  test("sorts the result by IATA code", () => {
    const airports = buildAirports([
      HEADER,
      row({ iata_code: "ZZZ" }),
      row({ iata_code: "AAA" }),
      row({ iata_code: "MMM" }),
    ]);
    expect(airports.map((a) => a.iata)).toEqual(["AAA", "MMM", "ZZZ"]);
  });
});

describe("assertSane", () => {
  /**
   * `assertSane` checks the count floor unconditionally, before it ever looks
   * at `previous` — so every test below needs at least MIN_EXPECTED_AIRPORTS
   * (3,500) valid, unique-IATA records just to get past that gate and reach
   * the one it's actually targeting. Codes are generated from the 26^3
   * three-letter space, which comfortably covers a few thousand.
   */
  const FLOOR = 3_500;

  function iataAt(i: number): string {
    const a = "A".charCodeAt(0);
    const c0 = Math.floor(i / (26 * 26)) % 26;
    const c1 = Math.floor(i / 26) % 26;
    const c2 = i % 26;
    return String.fromCharCode(a + c0, a + c1, a + c2);
  }

  /**
   * `size` is typed as plain `string`, not the `"large" | "medium" | "small"`
   * union: `assertSane` is a `.mjs` function with no compile-time contract at
   * all, and its whole job here is validating that exact boundary at
   * runtime — a couple of tests below deliberately hand it an invalid size,
   * which a narrower type would refuse to compile.
   */
  interface TestAirport {
    iata: string;
    icao: string | null;
    name: string;
    municipality: string | null;
    country: string;
    lat: number;
    lon: number;
    size: string;
  }

  function makeAirports(n: number): TestAirport[] {
    const sizes = ["large", "medium", "small"];
    return Array.from({ length: n }, (_, i) => ({
      iata: iataAt(i),
      icao: null,
      name: `Airport ${i}`,
      municipality: null,
      country: "US",
      lat: 10,
      lon: 20,
      size: sizes[i % sizes.length],
    }));
  }

  test("a clean, floor-sized set with no previous artifact passes", () => {
    expect(() => assertSane(makeAirports(FLOOR), null)).not.toThrow();
  });

  test("rejects a count below the floor", () => {
    expect(() => assertSane(makeAirports(FLOOR - 1), null)).toThrow(/only \d+ airports passed the filter/);
  });

  test("rejects a duplicate IATA code", () => {
    const airports = makeAirports(FLOOR);
    airports[1] = { ...airports[1], iata: airports[0].iata };
    expect(() => assertSane(airports, null)).toThrow(/duplicate IATA code/);
  });

  test("rejects a shrink over the limit relative to the previous artifact", () => {
    const before = 4_000;
    const after = 3_500; // (4000 - 3500) / 4000 = 12.5% > 10% limit, still clears the floor
    expect(() =>
      assertSane(makeAirports(after), { airports: makeAirports(before) })
    ).toThrow(/airport count fell/);
  });

  test("rejects growth over the limit relative to the previous artifact", () => {
    const before = 3_500;
    const after = 4_000; // (4000 - 3500) / 3500 ≈ 14.3% > 10% limit
    expect(() =>
      assertSane(makeAirports(after), { airports: makeAirports(before) })
    ).toThrow(/airport count rose/);
  });

  test("a shrink within the limit passes", () => {
    const before = 3_800;
    const after = 3_500; // ≈7.9% shrink, under the 10% limit
    expect(() =>
      assertSane(makeAirports(after), { airports: makeAirports(before) })
    ).not.toThrow();
  });

  describe("coordinate range (Finding 2b)", () => {
    test("rejects a latitude outside [-90, 90]", () => {
      const airports = makeAirports(FLOOR);
      airports[0] = { ...airports[0], lat: 394.5 };
      expect(() => assertSane(airports, null)).toThrow(/out-of-range latitude/);
    });

    test("rejects a longitude outside [-180, 180]", () => {
      const airports = makeAirports(FLOOR);
      airports[0] = { ...airports[0], lon: -200 };
      expect(() => assertSane(airports, null)).toThrow(/out-of-range longitude/);
    });

    test("boundary values -90/-180 and 90/180 are accepted", () => {
      const airports = makeAirports(FLOOR);
      airports[0] = { ...airports[0], lat: -90, lon: -180 };
      airports[1] = { ...airports[1], lat: 90, lon: 180 };
      expect(() => assertSane(airports, null)).not.toThrow();
    });
  });

  describe("size enum (Finding 2c)", () => {
    test("rejects a size outside large/medium/small", () => {
      const airports = makeAirports(FLOOR);
      airports[0] = { ...airports[0], size: "giant" };
      expect(() => assertSane(airports, null)).toThrow(/invalid size/);
    });

    test("rejects a size that is not even a string (the prototype-pollution shape)", () => {
      const airports = makeAirports(FLOOR);
      // What `SIZE_BY_TYPE[type] ?? 'small'` would have produced for
      // type: "constructor" before the fix in buildAirports.
      airports[0] = { ...airports[0], size: Object.prototype.constructor as unknown as string };
      expect(() => assertSane(airports, null)).toThrow(/invalid size/);
    });
  });

  test("rejects a malformed IATA code", () => {
    const airports = makeAirports(FLOOR);
    airports[0] = { ...airports[0], iata: "AB1" };
    expect(() => assertSane(airports, null)).toThrow(/malformed IATA code/);
  });

  test("rejects a malformed country code", () => {
    const airports = makeAirports(FLOOR);
    airports[0] = { ...airports[0], country: "USA" };
    expect(() => assertSane(airports, null)).toThrow(/malformed country code/);
  });
});
