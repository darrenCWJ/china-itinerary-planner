import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GLOBE_TOPOLOGY_PATH,
  globePointCodes,
  globePolygonCodes,
  globeReachableCodes,
  parseGlobeTopology,
} from "./globeTopology";
import { parseWorldTopology, worldCountryCodes } from "./isoTopology";

/**
 * A two-polygon, two-point fixture. `MT` is the case the whole module exists
 * for: a country with a point and NO polygon, which cannot happen in the 50m
 * asset and is the normal case for 61 countries in the globe asset.
 */
const FIXTURE = {
  topology: {
    type: "Topology",
    arcs: [],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "FR", arcs: [], properties: { name: "France" } },
          { type: "Polygon", id: "JP", arcs: [], properties: { name: "Japan" } },
        ],
      },
    },
  },
  points: [
    { code: "MT", name: "Malta", lon: 14.5, lat: 35.9 },
    { code: "JP", name: "Japan", lon: 138, lat: 36 },
  ],
};

describe("parseGlobeTopology", () => {
  it("reads polygons and points as separate reachability layers", () => {
    const globe = parseGlobeTopology(FIXTURE);

    expect([...globePolygonCodes(globe)].sort()).toEqual(["FR", "JP"]);
    expect([...globePointCodes(globe)].sort()).toEqual(["JP", "MT"]);
    // The union is what "reachable" means: MT arrives only through its point.
    expect([...globeReachableCodes(globe)].sort()).toEqual(["FR", "JP", "MT"]);
  });

  it("accepts a point whose code has no polygon", () => {
    // The inverse of lib/isoTopology.test.ts:163. On the 50m asset a
    // point-layer country always has a polygon underneath it; on the globe,
    // 61 of them never do, and treating that as corruption would reject the
    // only asset shape that reaches every country.
    const globe = parseGlobeTopology(FIXTURE);
    expect(globePolygonCodes(globe).has("MT")).toBe(false);
    expect(globeReachableCodes(globe).has("MT")).toBe(true);
  });

  it("throws on a topology that skipped the re-key", () => {
    const numeric = structuredClone(FIXTURE);
    // A raw world-atlas download: ids are still ISO numeric, so nothing has a
    // code to select and the picker would render 174 unselectable shapes.
    numeric.topology.objects.countries.geometries[0].id = 250 as never;
    expect(() => parseGlobeTopology(numeric)).toThrow(/re-key/);
  });

  it("throws on a missing points array", () => {
    const { points: _points, ...rest } = FIXTURE;
    expect(() => parseGlobeTopology(rest)).toThrow(/points/);
  });

  it("throws on a malformed point", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[0] = { code: "MT", name: "Malta", lon: "14.5" as never, lat: 35.9 };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[0\]/);
  });

  it("publishes the path the client fetches", () => {
    expect(GLOBE_TOPOLOGY_PATH).toBe("/world-globe.json");
  });

  it("throws on a point with non-finite lon", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[0] = { code: "MT", name: "Malta", lon: NaN, lat: 35.9 };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[0\].*lon.*finite/);
  });

  it("throws on a point with non-finite lat", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[1] = { code: "JP", name: "Japan", lon: 138, lat: Infinity };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[1\].*lat.*finite/);
  });

  it("throws on a point with empty code", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[0] = { code: "", name: "Malta", lon: 14.5, lat: 35.9 };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[0\].*code.*empty/);
  });

  it("throws on a null entry in geometries", () => {
    const bad = structuredClone(FIXTURE);
    bad.topology.objects.countries.geometries[0] = null as never;
    expect(() => parseGlobeTopology(bad)).toThrow(/corrupt/);
  });

  it("throws on a point with whitespace-only code", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[0] = { code: "   ", name: "Malta", lon: 14.5, lat: 35.9 };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[0\].*code.*invalid/);
  });

  it("throws on a polygon with empty-string id", () => {
    const bad = structuredClone(FIXTURE);
    bad.topology.objects.countries.geometries[0].id = "";
    expect(() => parseGlobeTopology(bad)).toThrow(/topology.*invalid.*country.*code/);
  });

  it("throws on a point with lowercase code", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[0] = { code: "mt", name: "Malta", lon: 14.5, lat: 35.9 };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[0\].*code.*invalid.*alpha-2/);
  });

  it("throws on a point with numeric code", () => {
    const bad = structuredClone(FIXTURE);
    bad.points[1] = { code: "1", name: "Japan", lon: 138, lat: 36 };
    expect(() => parseGlobeTopology(bad)).toThrow(/points\[1\].*code.*invalid.*alpha-2/);
  });

  it("throws on a polygon with non-alpha-2 id", () => {
    const bad = structuredClone(FIXTURE);
    bad.topology.objects.countries.geometries[1].id = "france";
    expect(() => parseGlobeTopology(bad)).toThrow(/topology.*invalid.*country.*code/);
  });
});

const GLOBE_ASSET = join(process.cwd(), "public", "world-globe.json");
const WORLD_ASSET = join(process.cwd(), "public", "world-countries.json");

/**
 * Both assets are committed build artefacts, not source: `npm ci` does not
 * produce them and their build scripts need network egress. Skip rather than
 * fail when they are absent, exactly as lib/isoTopology.test.ts does, so a
 * checkout without them is honest about what went unchecked rather than red
 * for the wrong reason.
 */
const hasAssets = existsSync(GLOBE_ASSET) && existsSync(WORLD_ASSET);
const globe = hasAssets ? parseGlobeTopology(JSON.parse(readFileSync(GLOBE_ASSET, "utf8"))) : null;
const world = hasAssets ? parseWorldTopology(JSON.parse(readFileSync(WORLD_ASSET, "utf8"))) : null;

describe.skipIf(!hasAssets)("the committed globe asset", () => {
  /**
   * THE test of this phase.
   *
   * The failure it exists for is not loud. A globe built by recomputing its
   * point layer from the 110m topology parses cleanly, renders 174 real
   * `role="button"` controls, and looks entirely correct — while Singapore,
   * Malta, Hong Kong, Macau and 57 other countries have silently stopped
   * existing in the picker. Nothing else in the suite notices.
   */
  it("reaches every country the flat map draws", () => {
    const reachable = globeReachableCodes(globe!);
    const reference = worldCountryCodes(world!);
    const missing = [...reference].filter((code) => !reachable.has(code)).sort();

    expect(missing, `unreachable on the globe: ${missing.join(", ")}`).toEqual([]);
    expect(reachable.size).toBe(reference.size);
  });

  it("carries a point for every code 110m has no polygon for", () => {
    // The inverse of lib/isoTopology.test.ts:163, which asserts the opposite
    // direction and must stay pointed at the 50m asset only.
    const polygons = globePolygonCodes(globe!);
    const points = globePointCodes(globe!);
    const orphans = [...worldCountryCodes(world!)]
      .filter((code) => !polygons.has(code) && !points.has(code))
      .sort();

    expect(orphans, `neither polygon nor point: ${orphans.join(", ")}`).toEqual([]);
  });

  it("is coarse enough to rotate at 60fps", () => {
    // 110m is not an optimisation, it is the shippable resolution: measured in
    // production with every node mounted, 110m is p95 13.1ms and 50m is 60.6ms.
    // A 50m-sized asset committed here would be a 21fps globe.
    expect(readFileSync(GLOBE_ASSET).byteLength).toBeLessThan(200_000);
  });
});
