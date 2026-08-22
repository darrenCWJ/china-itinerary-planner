import { describe, expect, test } from "vitest";
import {
  airportStatus,
  airportsForCountry,
  allAirports,
  findAirport,
  nearestAirports,
  searchAirports,
} from "./airports";

describe("the bundled airport artifact", () => {
  test("carries a plausible number of airports and countries", () => {
    const status = airportStatus();
    // Bands, not floors: current real values are 4,134 airports and 234
    // countries. A floor alone leaves headroom for a refresh that silently
    // drops hundreds of records to still pass. An unexplained jump is just as
    // suspicious as a drop — both mean something upstream changed in a way
    // nobody reviewed — so this pins both edges. If upstream genuinely moves
    // outside the band, a human should widen it deliberately, not have the
    // test go quiet forever.
    expect(status.airports).toBeGreaterThan(3_900);
    expect(status.airports).toBeLessThan(4_400);
    expect(status.countries).toBeGreaterThan(225);
    expect(status.countries).toBeLessThan(245);
    expect(status.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Recency is deliberately NOT asserted here. The ingest script preserves
    // the previous generatedAt when the airport data is unchanged, so the
    // file stays byte-identical and the nightly workflow has nothing to
    // commit. An old timestamp is the designed behaviour on a quiet day — a
    // freshness assertion would fail this suite every day the world's
    // airports didn't change. Instead, assert only what's true regardless:
    // the timestamp parses and isn't in the future.
    const generatedAt = new Date(status.generatedAt);
    expect(Number.isNaN(generatedAt.getTime())).toBe(false);
    expect(generatedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(status.source).toBe("Public domain (OurAirports, regenerated nightly)");
  });

  /**
   * The drift guard. A bad daily refresh should fail CI rather than ship: these
   * four are among the busiest airports on Earth and will not lose scheduled
   * service or change code. TNA is here because it is the airport whose absence
   * prompted this work.
   */
  test.each(["TNA", "PEK", "LHR", "JFK"])("still resolves %s", (code) => {
    expect(findAirport(code)).not.toBeNull();
  });

  test("TNA is Jinan's airport, in China", () => {
    const tna = findAirport("TNA");
    // OurAirports qualifies municipalities with a district — the real value is
    // "Jinan (Licheng)", not "Jinan". Asserting the exact string would pin a
    // formatting detail of the upstream source that has nothing to do with what
    // this test is about.
    expect(tna?.municipality).toContain("Jinan");
    expect(tna?.country).toBe("CN");
  });

  test("every IATA code is unique", () => {
    const all = allAirports();
    expect(new Set(all.map((a) => a.iata)).size).toBe(all.length);
  });

  test("every airport has finite coordinates, a three-letter IATA code, and a two-letter country", () => {
    for (const a of allAirports()) {
      expect(Number.isFinite(a.lat) && Number.isFinite(a.lon)).toBe(true);
      // IATA is the primary key later tasks look records up by; a malformed
      // code here would silently break every downstream lookup.
      expect(a.iata).toMatch(/^[A-Z]{3}$/);
      expect(a.country).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("airportsForCountry", () => {
  test("scopes to one country", () => {
    const cn = airportsForCountry("cn");
    expect(cn.length).toBeGreaterThan(100);
    expect(cn.every((a) => a.country === "CN")).toBe(true);
    expect(cn.some((a) => a.iata === "TNA")).toBe(true);
  });

  test("an unknown country is empty, not an error", () => {
    expect(airportsForCountry("ZZ")).toEqual([]);
  });
});

describe("bound helpers reach the real data", () => {
  test("search finds Jinan by city name", () => {
    expect(searchAirports("Jinan").map((a) => a.iata)).toContain("TNA");
  });

  test("nearest finds TNA from Jinan's city centre", () => {
    const near = nearestAirports({ lat: 36.667, lon: 116.983 });
    expect(near[0].airport.iata).toBe("TNA");
    expect(near[0].km).toBeLessThan(60);
  });
});
