import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCountry, ISO_NUMERIC_TO_ALPHA2 } from "./countries";
import {
  SEARCH_ONLY,
  SEARCH_ONLY_REASONS,
  WORLD_TOPOLOGY_PATH,
  hasPoint,
  hasPolygon,
  isSearchOnly,
  parseWorldTopology,
  smallCountryCodes,
  worldCountryCodes,
} from "./isoTopology";

const ASSET_PATH = join(process.cwd(), "public", "world-countries.json");

/**
 * The asset is a committed build artefact, not source — `npm ci` does not
 * produce it and the build script needs network egress. Tests that need it skip
 * when it is missing rather than failing, so a checkout without it is honest
 * about what went unchecked instead of red for the wrong reason.
 */
const hasAsset = existsSync(ASSET_PATH);
const world = hasAsset
  ? parseWorldTopology(JSON.parse(readFileSync(ASSET_PATH, "utf8")))
  : null;

/**
 * The codes `lib/countries` actually knows about, read out of its source.
 *
 * `CURATED` and `SOUTHERN` are private and should stay private — neither is a
 * registry of supported countries, so exporting them to satisfy a test would
 * misrepresent them. Scanning the source is the same trick `lib/contracts.test`
 * uses, and it has the same virtue here: adding a country to either table
 * without reconciling it against the map fails on the commit that does it.
 */
function countryCodesInSource(): { curated: string[]; southern: string[] } {
  const src = readFileSync(join(process.cwd(), "lib", "countries.ts"), "utf8");
  const block = (start: RegExp, end: string): string => {
    const from = src.search(start);
    if (from < 0) return "";
    const to = src.indexOf(end, from);
    return to < 0 ? "" : src.slice(from, to);
  };

  const curatedBlock = block(/^const CURATED\b/m, "\n};");
  const southernBlock = block(/^const SOUTHERN\b/m, "]);");

  return {
    // Object keys, one per line: `  VN: { … }`.
    curated: [...curatedBlock.matchAll(/^\s{2}([A-Z]{2}):/gm)].map((m) => m[1]),
    // String literals in a Set: `"AO", "AR", …`.
    southern: [...southernBlock.matchAll(/"([A-Z]{2})"/g)].map((m) => m[1]),
  };
}

describe("ISO_NUMERIC_TO_ALPHA2", () => {
  it("maps every numeric code to a distinct alpha-2 code", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [numeric, alpha2] of Object.entries(ISO_NUMERIC_TO_ALPHA2)) {
      const previous = seen.get(alpha2);
      if (previous) collisions.push(`${alpha2}: ${previous} and ${numeric}`);
      seen.set(alpha2, numeric);
    }
    expect(collisions).toEqual([]);
  });

  it("uses zero-padded three-digit keys and uppercase alpha-2 values", () => {
    for (const [numeric, alpha2] of Object.entries(ISO_NUMERIC_TO_ALPHA2)) {
      expect(numeric).toMatch(/^\d{3}$/);
      expect(alpha2).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("covers the whole ISO 3166-1 list, not just the countries in the catalog", () => {
    // 249 official entries plus the user-assigned XK. A table that shrank below
    // this dropped codes the topology still carries, which silently drops
    // countries from the map.
    expect(Object.keys(ISO_NUMERIC_TO_ALPHA2).length).toBe(250);
  });
});

describe("SEARCH_ONLY", () => {
  it("documents a reason for every code it contains", () => {
    expect(SEARCH_ONLY.size).toBeGreaterThan(0);
    for (const code of SEARCH_ONLY) {
      expect(SEARCH_ONLY_REASONS[code]).toBeTruthy();
    }
  });

  it("names only codes the numeric table knows", () => {
    const known = new Set(Object.values(ISO_NUMERIC_TO_ALPHA2));
    for (const code of SEARCH_ONLY) expect(known.has(code)).toBe(true);
  });

  it("normalises the code it is asked about", () => {
    const [first] = [...SEARCH_ONLY];
    expect(isSearchOnly(first.toLowerCase())).toBe(true);
    expect(isSearchOnly(` ${first} `)).toBe(true);
    expect(isSearchOnly("CN")).toBe(false);
    expect(isSearchOnly("")).toBe(false);
  });

  it.skipIf(!hasAsset)("is exactly the set of ISO codes the topology cannot draw", () => {
    const drawable = worldCountryCodes(world!);
    const undrawable = Object.values(ISO_NUMERIC_TO_ALPHA2)
      .filter((code) => !drawable.has(code))
      .sort();
    // Both directions: an unlisted gap is a country that silently vanishes from
    // the picker, and a stale listing is a country needlessly pushed to search.
    expect(undrawable).toEqual([...SEARCH_ONLY].sort());
  });
});

describe("world topology reconciliation", () => {
  it("finds the country tables it is reconciling against", () => {
    // A source scan that quietly matches nothing reads as a pass. These floors
    // are the guard: they are well below the real counts and well above zero.
    const { curated, southern } = countryCodesInSource();
    expect(curated.length).toBeGreaterThanOrEqual(20);
    expect(southern.length).toBeGreaterThanOrEqual(30);
  });

  it.skipIf(!hasAsset)("resolves every code in lib/countries to a feature or to SEARCH_ONLY", () => {
    const { curated, southern } = countryCodesInSource();
    const codes = [...new Set([...curated, ...southern])].sort();
    const unreconciled = codes.filter(
      (code) => !hasPolygon(world!, code) && !isSearchOnly(code),
    );
    expect(unreconciled).toEqual([]);
  });

  it.skipIf(!hasAsset)("names every country it draws, in this app's own words", () => {
    // THE CHECK THAT WAS MISSING. `countryLabel` in
    // components/map/worldLevelShared.tsx renders `getCountry(code).name` and
    // falls back to the topology's name when that comes back as the bare code —
    // so a drawable country no table named looked FINE on the map and rendered
    // as two letters the moment it was opened, in `MapExplorer`'s heading, its
    // "← Back to …" control and `DestinationStep`'s country chip. Nothing
    // failed, because the only resolver that could see the gap was the one
    // papering over it.
    //
    // AQ and HM are what it cost: both are drawn, neither is in SEARCH_ONLY,
    // and the facts artifact has no record of either because both are
    // uninhabited. `UNINGESTED_NAMES` in lib/countries.ts names them now.
    //
    // Derived from the asset rather than from a list, so it covers a rebuild
    // that introduces a feature no table has heard of — which is the only way
    // this can come back.
    const unnamed = [...worldCountryCodes(world!)]
      .filter((code) => getCountry(code).name === code)
      .sort();
    expect(
      unnamed,
      `drawn on the world map but rendered as its own ISO code once opened: ${unnamed.join(", ")}`
    ).toEqual([]);
    // Armed: the filter walked the real 235, not an empty set.
    expect(worldCountryCodes(world!).size).toBeGreaterThan(200);
    expect(getCountry("AQ").name).toBe("Antarctica");
  });

  it.skipIf(!hasAsset)("keeps the spec's named small countries selectable", () => {
    // Spec §6: these are why the asset is 50m rather than 110m. Each must be
    // drawable *and* carry a point, because at world zoom the polygon alone is
    // sub-pixel.
    for (const code of ["SG", "MT", "MV", "BH"]) {
      expect(hasPolygon(world!, code), `${code} polygon`).toBe(true);
      expect(hasPoint(world!, code), `${code} point`).toBe(true);
    }
  });

  it.skipIf(!hasAsset)("carries Hong Kong and Macau as real features", () => {
    // The spec expected these to be missing; that is true of 110m, not 50m,
    // which is a further reason the coarser file was rejected.
    expect(hasPolygon(world!, "HK")).toBe(true);
    expect(hasPolygon(world!, "MO")).toBe(true);
  });

  it.skipIf(!hasAsset)("re-keys every feature to a distinct alpha-2 code", () => {
    const geometries = (world!.topology.objects.countries as { geometries: unknown[] })
      .geometries as { id?: unknown }[];
    const ids = geometries.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]{2}$/);
  });

  it.skipIf(!hasAsset)("gives every point in the layer a code that is also drawable", () => {
    for (const code of smallCountryCodes(world!)) {
      expect(hasPolygon(world!, code), `${code} polygon`).toBe(true);
    }
  });

  it.skipIf(!hasAsset)("puts a finite coordinate on every point", () => {
    expect(world!.smallCountries.length).toBeGreaterThan(0);
    for (const small of world!.smallCountries) {
      expect(Number.isFinite(small.lon) && Math.abs(small.lon) <= 180).toBe(true);
      expect(Number.isFinite(small.lat) && Math.abs(small.lat) <= 90).toBe(true);
      expect(small.name.length).toBeGreaterThan(0);
    }
  });
});

describe("parseWorldTopology", () => {
  const minimal = {
    topology: {
      type: "Topology",
      arcs: [],
      objects: { countries: { type: "GeometryCollection", geometries: [] } },
    },
    smallCountries: [],
  };

  it("accepts a well-formed asset", () => {
    expect(parseWorldTopology(minimal).smallCountries).toEqual([]);
  });

  it("rejects a bare TopoJSON file that was not run through the build script", () => {
    expect(() => parseWorldTopology(minimal.topology)).toThrow(/topology/i);
  });

  it("rejects an asset whose countries object is missing", () => {
    const noCountries = {
      ...minimal,
      topology: { ...minimal.topology, objects: { land: {} } },
    };
    expect(() => parseWorldTopology(noCountries)).toThrow(/countries/i);
  });

  it("rejects a point with a non-numeric coordinate", () => {
    const badPoint = {
      ...minimal,
      smallCountries: [{ code: "SG", name: "Singapore", lon: "103.8", lat: 1.3 }],
    };
    expect(() => parseWorldTopology(badPoint)).toThrow(/smallCountries/i);
  });

  it("rejects null and non-objects rather than returning something empty", () => {
    for (const raw of [null, undefined, 7, "{}", []]) {
      expect(() => parseWorldTopology(raw)).toThrow();
    }
  });
});

describe("WORLD_TOPOLOGY_PATH", () => {
  it("is a root-relative public path so the fetch works from any route", () => {
    expect(WORLD_TOPOLOGY_PATH).toBe("/world-countries.json");
  });
});
