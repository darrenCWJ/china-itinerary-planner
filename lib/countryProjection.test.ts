import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { geoMercator } from "d3-geo";
import { describe, expect, it, test } from "vitest";
import { MAP_VIEW_H, MAP_VIEW_PAD, MAP_VIEW_W } from "./mapView";
import {
  MANIFEST_VIEW_BOX,
  PROJECTION_PATH,
  parseProjectionManifest,
  projectionFor,
  type ProjectionEntry,
} from "./countryProjection";

/**
 * South Africa's entry, the one worked example both the spec and this plan
 * publish, at the viewport the app actually renders into.
 *
 * 2462.6921 is `scripts/build-projections.mjs`'s own answer for these bounds
 * at 860 x 620 — `scripts/build-projections.test.ts` pins the same number from
 * the producing side, so the two halves of §5.4 meet on a value neither of
 * them invented. (The spec's published 2383.2504 is the same fit at 860 x 600,
 * a viewport this app has never had.)
 */
const za = (over: Partial<ProjectionEntry> = {}): ProjectionEntry => ({
  rotate: 0,
  bounds: [
    [16.4468, -34.7854],
    [32.8845, -22.1456],
  ],
  scale: 2462.6921,
  ...over,
});

describe("parseProjectionManifest", () => {
  it("reads an entry under its country code", () => {
    const manifest = parseProjectionManifest({
      ZA: za(),
      FJ: za({ rotate: -178.1874, hiddenAreaPct: 0.89 }),
    });
    expect(manifest.size).toBe(2);
    expect(manifest.get("ZA")).toEqual(za());
    expect(manifest.get("FJ")?.rotate).toBe(-178.1874);
    // A percent, not a fraction: a reader comparing this against Gate A's 0.01
    // would reject all nine countries that passed the gate.
    expect(manifest.get("FJ")?.hiddenAreaPct).toBe(0.89);
  });

  it("returns a Map, so a code that is also an Object property name misses", () => {
    // The keys come from a data file. On a plain object `manifest.constructor`
    // resolves to a function and a lookup that should miss reads as a hit —
    // the same reason `parseProvinceTopology` hands back `cityProvince` as a
    // Map rather than the record it was parsed from.
    const manifest = parseProjectionManifest({ ZA: za() });
    expect(manifest.get("constructor")).toBeUndefined();
    expect(manifest.get("toString")).toBeUndefined();
  });

  it("throws when the root is not an object at all", () => {
    // Structural, so it throws: a manifest that is a 404 page or an array is
    // not a manifest missing some countries, it is the wrong file entirely,
    // and every country would silently take the world fallback.
    expect(() => parseProjectionManifest(null)).toThrow(/country-projections/);
    expect(() => parseProjectionManifest("{}")).toThrow(/country-projections/);
    expect(() => parseProjectionManifest([za()])).toThrow(/country-projections/);
  });

  it("drops an entry whose bounds are inverted, and keeps every other country", () => {
    // `fitExtent` accepts an inverted box in SILENCE and mirrors the country,
    // so this cannot be left to the renderer to notice.
    //
    // Dropped rather than thrown, which is the split `parseProvinceTopology`
    // makes for `cityProvince`: a bad entry costs that one country its fit and
    // it falls back to the world projection, while throwing would cost all 246
    // theirs. `assertManifest` already refuses to write such an entry, so
    // reaching this branch means the committed file disagrees with its builder.
    const manifest = parseProjectionManifest({
      ZA: za(),
      XX: za({
        bounds: [
          [32.8845, -22.1456],
          [16.4468, -34.7854],
        ],
      }),
    });
    expect(manifest.get("XX")).toBeUndefined();
    expect(manifest.get("ZA")).toBeDefined();
  });

  it("drops an entry whose numbers are missing or non-finite", () => {
    // Any one of these reaches `fitExtent` as a NaN and draws a blank map with
    // no error anywhere — the failure mode `assertManifest` gates at build time
    // and this gates at read time.
    const manifest = parseProjectionManifest({
      XA: za({ scale: Number.NaN }),
      XB: za({ scale: 0 }),
      XC: za({ rotate: Number.POSITIVE_INFINITY }),
      XD: { bounds: za().bounds, scale: 100 },
      XE: za({ bounds: [[16.4468, -34.7854], [32.8845, "-22.1456"]] } as unknown as Partial<ProjectionEntry>),
      XF: za({ bounds: [[16.4468, -34.7854]] } as unknown as Partial<ProjectionEntry>),
      ZA: za(),
    });
    expect([...manifest.keys()]).toEqual(["ZA"]);
  });

  it("ignores a key that is not a country code", () => {
    const manifest = parseProjectionManifest({ ZAF: za(), "": za(), "1A": za(), ZA: za() });
    expect([...manifest.keys()]).toEqual(["ZA"]);
  });
});

describe("projectionFor", () => {
  test("never builds a Polygon rectangle", () => {
    // §5.5. d3-geo reads a ring spherically, so a clockwise rectangle is THE
    // GLOBE MINUS THE RECTANGLE. The collapse is not loud: it is *exactly* the
    // whole-world fit, asserted below against d3 itself, so a collapsed
    // country renders as a perfectly legible world map with a speck on it and
    // nothing but a number can tell the difference.
    const collapsed = geoMercator()
      .fitExtent(MANIFEST_VIEW_BOX, {
        type: "Polygon",
        coordinates: [
          [
            [16.4468, -34.7854],
            [32.8845, -34.7854],
            [32.8845, -22.1456],
            [16.4468, -22.1456],
            [16.4468, -34.7854],
          ],
        ],
      })
      .scale();
    expect(collapsed).toBeCloseTo(MAP_VIEW_H / (2 * Math.PI), 6);
    expect(projectionFor(za()).scale()).toBeCloseTo(2462.6921, 3);
    expect(projectionFor(za()).scale()).toBeGreaterThan(collapsed * 10);
  });

  test("falls back to a whole-world projection for a country with no entry", () => {
    // The manifest and the code deploy independently, and the province files
    // refresh on their own schedule: a country whose entry has not been built
    // yet, or was dropped above, gets a small map rather than a blank one or a
    // NaN. Every continent has to be on it, which is the one thing that makes
    // it a usable fallback rather than a different bug.
    const world = projectionFor(undefined);
    const cities: Record<string, [number, number]> = {
      Suva: [178.4419, -18.1416],
      Reykjavik: [-21.9426, 64.1466],
      Santiago: [-70.6483, -33.4489],
      Tokyo: [139.6917, 35.6895],
      "Cape Town": [18.4241, -33.9249],
      Anchorage: [-149.9003, 61.2181],
    };
    for (const [name, lonLat] of Object.entries(cities)) {
      const point = world(lonLat);
      expect(point, name).not.toBeNull();
      expect(point![0], name).toBeGreaterThanOrEqual(0);
      expect(point![0], name).toBeLessThanOrEqual(MAP_VIEW_W);
      expect(point![1], name).toBeGreaterThanOrEqual(0);
      expect(point![1], name).toBeLessThanOrEqual(MAP_VIEW_H);
    }
    // Null takes the same road as undefined: `manifest.get(code)` gives one and
    // a caller with no manifest at all gives the other.
    expect(projectionFor(null).scale()).toBe(world.scale());
  });

  test("fits into the viewBox the caller asks for, not a fixed one", () => {
    // The manifest's scales are fitted flush to the viewBox. A caller wanting
    // `MAP_VIEW_PAD`'s inset — so a coastline is not flush against the edge —
    // passes the inset box and gets a smaller scale, and the committed number
    // stays the one measured against the full box.
    const inset = projectionFor(za(), [
      [MAP_VIEW_PAD, MAP_VIEW_PAD],
      [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD],
    ]);
    expect(inset.scale()).toBeLessThan(projectionFor(za()).scale());
    expect(inset.scale()).toBeGreaterThan(projectionFor(za()).scale() * 0.9);
  });

  test("un-rotates the bounds, so a rotated country lands on its own map", () => {
    // `bounds` is in the ROTATED frame and a projection re-applies `rotate`, so
    // the fit's points must be un-rotated first. Feed the rotated numbers
    // straight in and FJ, KI, NZ, RU and US are each fitted 178 degrees away
    // from themselves — with a perfectly plausible scale, because a
    // double-rotation moves the frame and never its width.
    //
    // Suva is an independent datum: a real city, from no part of the manifest.
    const fiji = projectionFor(za({ rotate: -178.1874, bounds: [[-1.3856, -21.0273], [1.6144, -12.4644]] }));
    const suva = fiji([178.4419, -18.1416])!;
    expect(suva).not.toBeNull();
    expect(suva[0]).toBeGreaterThan(0);
    expect(suva[0]).toBeLessThan(MAP_VIEW_W);
    expect(suva[1]).toBeGreaterThan(0);
    expect(suva[1]).toBeLessThan(MAP_VIEW_H);
  });
});

// ---------------------------------------------------------------------------
// The committed manifest
// ---------------------------------------------------------------------------

/**
 * Joined from `PROJECTION_PATH` rather than a second literal, so the constant
 * the client fetches and the file the build writes are checked against each
 * other by every test below: a rename that touched one and not the other would
 * skip this whole block instead of failing it.
 *
 * Skipped when absent, as lib/provinceTopology.test.ts and lib/cityShard.test.ts
 * skip for their own committed artifacts: a checkout without them is honest
 * about what went unchecked rather than red for the wrong reason.
 */
const MANIFEST_ASSET = join(process.cwd(), "public", PROJECTION_PATH);
const hasAsset = existsSync(MANIFEST_ASSET);
const rawManifest: Record<string, unknown> = hasAsset
  ? (JSON.parse(readFileSync(MANIFEST_ASSET, "utf8")) as Record<string, unknown>)
  : {};
const committed = hasAsset ? parseProjectionManifest(rawManifest) : null;

/**
 * The province directory, read as a directory listing rather than through
 * `lib/countryDetail.ts`'s index.
 *
 * The manifest is built by walking these files, so checking it against the
 * index would compare two artifacts of the same walk and pass even if the walk
 * itself missed a country. The listing is the only input to that build that is
 * not itself generated.
 */
const PROVINCES_DIR = join(process.cwd(), "public", "provinces");
const hasProvinces = existsSync(PROVINCES_DIR);
const shipped = hasProvinces
  ? readdirSync(PROVINCES_DIR)
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .map((name) => name.slice(0, -".json".length))
      .sort()
  : [];

describe.skipIf(!hasAsset)("the committed manifest", () => {
  it("names exactly 246 countries", () => {
    // A literal, and never `toBeGreaterThan`: 246 is the whole point of the
    // phase, and a floor would go green on a build that wrote three entries
    // and one that wrote 900. The number is the province-file population — see
    // data/provinces-report.md — and it moves only when the territory policy
    // does, which is a decision, not a drift.
    expect(Object.keys(rawManifest)).toHaveLength(246);
  });

  it("parses every entry it ships", () => {
    // The parser drops what it cannot use, so a size that disagrees with the
    // file is the only way a dropped country ever announces itself.
    expect(committed!.size).toBe(Object.keys(rawManifest).length);
  });

  it.skipIf(!hasProvinces)("has an entry for every province file, and no orphans", () => {
    // Both directions, because the two failures are different bugs and only
    // one of them is visible on screen.
    //
    // A province file with no entry is the silent one: `projectionFor` hands
    // that country the whole-world fallback, so it renders a legible map of
    // the planet with a speck on it — §5.5's collapse, arrived at from the
    // other end — and nothing throws.
    //
    // An entry with no province file is the reverse: a country the build has
    // stopped shipping geometry for, still carrying a fit for geometry that no
    // longer exists. Harmless today and wrong the moment someone reads the
    // manifest as the list of countries with maps.
    const codes = [...committed!.keys()].sort();
    const unframed = shipped.filter((code) => !committed!.has(code));
    const orphans = codes.filter((code) => !shipped.includes(code));
    expect(unframed, `province files with no projection: ${unframed.join(", ")}`).toEqual([]);
    expect(orphans, `projections with no province file: ${orphans.join(", ")}`).toEqual([]);
    expect(codes).toEqual(shipped);
  });

  it("rebuilds the committed scale from the committed bounds, for every country", () => {
    // §5.4's own test, and the reason `scale` is in the file at all: it is
    // redundant by construction, so recomputing it from `rotate` and `bounds`
    // is what stops a hand-edited manifest from quietly mis-fitting a country.
    //
    // The tolerance is the field's own 4 dp plus float wobble and nothing
    // more. Anything looser and the test stops being able to tell a rounded
    // number from a wrong one.
    const off = [...committed!]
      .filter(([, entry]) => {
        const rebuilt = projectionFor(entry).scale();
        return Math.abs(rebuilt - entry.scale) > 5e-5 + entry.scale * 1e-9;
      })
      .map(([code, entry]) => `${code} ${projectionFor(entry).scale()} vs ${entry.scale}`);
    expect(off, `scales that do not follow from their own bounds: ${off.join(", ")}`).toEqual([]);
  });

  it("puts every corner of every country inside the viewport, and fills it", () => {
    // The renderer's contract in one line: real lon/lat in, viewBox pixels out.
    // Corners are un-rotated back to true coordinates, because that is what a
    // map hands a projection — a renderer feeding the rotated-frame numbers
    // straight in would push FJ, KI, NZ, RU and US off the edge.
    //
    // "Fills it" is what separates a working fit from the §5.5 collapse: the
    // fit must be tight against one axis, not merely inside the frame.
    const escaped: string[] = [];
    const slack: string[] = [];
    for (const [code, entry] of committed!) {
      const projection = projectionFor(entry);
      const [[x0, y0], [x1, y1]] = entry.bounds;
      const points = [x0, (x0 + x1) / 2, x1].flatMap((x) =>
        [y0, y1].map((y) => projection([x - entry.rotate, y]))
      );
      if (points.some((point) => point === null)) {
        escaped.push(`${code} unprojectable`);
        continue;
      }
      const xs = points.map((point) => point![0]);
      const ys = points.map((point) => point![1]);
      const outside = Math.max(
        -Math.min(...xs),
        Math.max(...xs) - MAP_VIEW_W,
        -Math.min(...ys),
        Math.max(...ys) - MAP_VIEW_H
      );
      if (outside > 1e-6) escaped.push(`${code} by ${outside.toFixed(3)}px`);
      const fill = Math.max(
        (Math.max(...xs) - Math.min(...xs)) / MAP_VIEW_W,
        (Math.max(...ys) - Math.min(...ys)) / MAP_VIEW_H
      );
      if (Math.abs(1 - fill) > 1e-6) slack.push(`${code} fills ${(fill * 100).toFixed(1)}%`);
    }
    expect(escaped, `countries drawn outside the viewport: ${escaped.join(", ")}`).toEqual([]);
    expect(slack, `countries not fitted tight to the viewport: ${slack.join(", ")}`).toEqual([]);
  });

  it("rotates exactly the five countries that cross the antimeridian", () => {
    // §5.4's rule 1: everyone else takes `rotate: 0`, and the five that do not
    // are named rather than counted, because which five is the assertion. A
    // sixth would mean the largest-gap arc found a crossing that is not there,
    // and the country it found it for would be framed 178 degrees from itself
    // at a perfectly plausible scale — the failure `projectionFor`'s
    // un-rotation test pins from the renderer's side, caught here at the
    // artifact's.
    //
    // Values from data/projections-report.md, to 4 dp as the manifest carries
    // them. `toBeCloseTo` would let a rebuild round differently and still pass,
    // and a manifest whose numbers are approximately right is one nobody can
    // diff.
    const rotated = Object.fromEntries(
      [...committed!].filter(([, entry]) => entry.rotate !== 0).map(([code, e]) => [code, e.rotate])
    );
    expect(rotated).toEqual({
      FJ: -178.1874,
      KI: 171.1295,
      NZ: -174.8857,
      RU: -105.3083,
      US: 130.1797,
    });
  });

  it("carries hiddenAreaPct on exactly nine countries, none over Gate A's 1%", () => {
    // Gate A caps the hidden land at 1% of the country, and the nine that
    // passed it are the whole accepted set — every other multi-polygon country
    // is drawn entire. Named, not counted, for the reason the spec gives when
    // it says both gates are load-bearing: the failure this guards against is
    // not "too many trims", it is a rule change that quietly swaps one country
    // for another and hides an island somebody lives on.
    //
    // The list is this plan's own measurement, and it is deliberately NOT the
    // spec's five. NL and NZ are absent because Bonaire and Tokelau became
    // BQ.json and TK.json — there is no longer a Dutch or a New Zealand polygon
    // for a projection to hide, so the trim was retired by the territory policy
    // rather than by the rule.
    const trimmed = [...committed!]
      .filter(([, entry]) => entry.hiddenAreaPct !== undefined)
      .map(([code]) => code)
      .sort();
    expect(trimmed).toEqual(["AI", "CR", "FJ", "FR", "GQ", "MU", "PN", "TF", "ZA"]);

    const overBudget = [...committed!]
      .filter(([, entry]) => (entry.hiddenAreaPct ?? 0) > 1)
      .map(([code, entry]) => `${code} ${entry.hiddenAreaPct}%`);
    expect(overBudget, `countries over Gate A's 1%: ${overBudget.join(", ")}`).toEqual([]);

    // A percent, not a fraction. Read as a fraction, FJ's 0.890 is 89% of the
    // country and every one of the nine reads as a catastrophe; read the other
    // way round, a real 1.5% trim would sail through the gate above. The
    // largest is FJ, and it is well clear of 0.01.
    const largest = Math.max(...[...committed!].map(([, e]) => e.hiddenAreaPct ?? 0));
    expect(largest).toBeCloseTo(0.89, 6);
  });
});
