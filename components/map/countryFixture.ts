import type { ProjectionEntry } from "@/lib/countryProjection";
import { parseProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";

/**
 * The hand-built admin-1 country both country-level test files are held to.
 *
 * Its own module for the reason `worldFixture.ts` gives and spec §12.1
 * restates: a fixture shared between two test files lives in a plain non-test
 * module, because importing one `.test.tsx` from another makes vitest collect
 * the imported file's `describe` blocks a second time. Nothing under `app/` or
 * `components/` imports it, so it never reaches a bundle.
 *
 * It is shared rather than duplicated because §12.2's acceptance criterion is
 * asserted against BOTH renderers — `CountryLevel` directly, and `CountryMap`
 * once per dispatcher branch — and a second copy of this topology would let
 * the two drift into testing different countries under the same name.
 *
 * The fixture is four admin-1 units rather than a real file, and its shape is
 * the specification of what the country level has to get right:
 *
 * - **three units tile the mainland and share their arcs**, so `merge()` has a
 *   seam to dissolve and the outline is one ring rather than three;
 * - **one of those three is `sel: 0`** — the Northern-Cyprus case of §7.2, drawn
 *   because it shapes the country's extent, never offered as a choice;
 * - **the fourth is an island 32° west of the mainland**, which is what makes
 *   the manifest observable: framed by the manifest entry the mainland fills
 *   the viewport, and framed by a fit over the features it is a sixth of it.
 *
 * Rings are wound clockwise in (lon, lat). d3-geo reads them spherically, and
 * the anticlockwise version of this same fixture measures 25.1 steradians —
 * twice the whole sphere — because each ring reads as the globe minus itself.
 * `geoBounds` then answers ±180/±90 and every fit collapses.
 */

const A = [-78, -14];
const B = [-76, -14];
const C = [-74, -14];
const G = [-72, -14];
const F = [-78, -10];
const E = [-76, -10];
const D = [-74, -10];
const H = [-72, -10];

/**
 * Absolute (untransformed) TopoJSON, as `CountryMap.test.tsx`'s China fixture
 * is. Arcs 0 and 2 are the seams: each is referenced forward by one unit and
 * reversed (`~i`) by its neighbour, which is the only thing that lets `merge()`
 * dissolve them.
 */
export const PE_TOPOLOGY = {
  type: "Topology",
  arcs: [
    [B, E],
    [E, F, A, B],
    [C, D],
    [B, C],
    [D, E],
    [C, G, H, D],
    [
      [-110, -28],
      [-110, -27],
      [-109, -27],
      [-109, -28],
      [-110, -28],
    ],
  ],
  objects: {
    provinces: {
      type: "GeometryCollection",
      geometries: [
        {
          type: "Polygon",
          id: "PE-LIM",
          arcs: [[~0, ~1]],
          properties: {
            name: "Lima",
            name_en: "Lima",
            iso_3166_2: "PE-LIM",
            gn_a1_code: "PE.15",
            sel: 1,
          },
        },
        {
          type: "Polygon",
          id: "PE-CUS",
          arcs: [[0, ~4, ~2, ~3]],
          properties: {
            name: "Cuzco",
            name_en: "Cuzco",
            iso_3166_2: "PE-CUS",
            gn_a1_code: "PE.08",
            sel: 1,
          },
        },
        {
          // §7.2: geometry that shapes the outline without being a subdivision.
          type: "Polygon",
          id: "PE-XXX",
          arcs: [[2, ~5]],
          properties: { name: "Disputed Zone", name_en: "Disputed Zone", sel: 0 },
        },
        {
          type: "Polygon",
          id: "PE-ISL",
          arcs: [[6]],
          properties: { name: "Isla Lejana", name_en: "Isla Lejana", sel: 1 },
        },
      ],
    },
  },
};

/**
 * Where each city both test files draw is committed to live.
 *
 * A real province file assigns every city in the country's shard to one of its
 * units, and this fixture said `{}` — "no city is anywhere" — for as long as
 * nothing read the field. `CountryLevel`'s province zoom is its first reader
 * (§6.5), and under a zoom an unassigned city is drawn nowhere at all, so an
 * empty map here is not a neutral default: it is the state in which the zoomed
 * map is blank.
 *
 * The assignments are the ones this fixture's own geometry implies, so a
 * reader can check them against the arcs above rather than take them on trust.
 * The units span PE-LIM over lon -78..-76, PE-CUS over -76..-74, PE-XXX over
 * -74..-72, and PE-ISL out at -110..-109:
 *
 * - `lima` (-78) and `cur` (-77.5) fall in **PE-LIM**;
 * - `b` (-75.95) falls in **PE-CUS**, and `a` (-76) sits on its seam with
 *   PE-LIM, so it is assigned east to keep the crowded pair in one unit;
 * - `cty` (-73) and `cusco` (-72) fall in **PE-XXX**, which is `sel: 0` — so
 *   they are this fixture's copy of the 43 committed `cityProvince` values
 *   that name a unit no user can zoom to. Both cities exist and the list
 *   reaches them; no region ever draws them;
 * - `isla` (-109.5) falls in **PE-ISL**.
 *
 * Deliberately partial in two places. `CountryLevel.test.tsx` draws an
 * `unplaced` city that appears nowhere here, because "assigned to no unit" is
 * the state 478 real cities are in and the level has to answer for it. And
 * `CountryMap.test.tsx`'s own cast is absent because that renderer does not
 * zoom yet; when it does, `peFileWith` is what places its cities without
 * putting a second copy of this topology in a second file.
 */
export const PE_CITY_PROVINCE: Readonly<Record<string, string>> = {
  lima: "PE-LIM",
  cur: "PE-LIM",
  a: "PE-CUS",
  b: "PE-CUS",
  cty: "PE-XXX",
  cusco: "PE-XXX",
  isla: "PE-ISL",
};

/**
 * The fixture as the level receives it — through the real parser, not around
 * it — with the city assignments a test wants to vary.
 *
 * A factory beside the constant because the zoom tests need a country whose
 * cities sit in the unit under test, and rebuilding the topology inline in
 * each of them would put a second copy of it in a second file, which is the
 * drift this module exists to prevent.
 */
export function peFileWith(cityProvince: Readonly<Record<string, string>>): ProvinceFile {
  return parseProvinceTopology({
    country: "PE",
    generatedAt: "2026-08-30T00:00:00.000Z",
    idKey: "adm1_code",
    topology: PE_TOPOLOGY,
    cityProvince,
  });
}

export const PE_FILE: ProvinceFile = peFileWith(PE_CITY_PROVINCE);

/**
 * The mainland and nothing else, in the frame `rotate: 0` leaves it in — the
 * nine-country trim of §5.4 in miniature, and the only reason the island can be
 * out of frame while still being drawn.
 */
export const PE_ENTRY: ProjectionEntry = {
  rotate: 0,
  bounds: [
    [-78, -14],
    [-72, -10],
  ],
  hiddenAreaPct: 0.3,
  // Recomputed from `bounds` by `projectionFor`; carried because the manifest
  // carries it, and never read by the renderer.
  scale: 8021.4062,
};

/**
 * China in the envelope the build writes it — `idKey: "adcode"`, GB/T 2260 ids,
 * Chinese `name` and no `name_en`, and the nine-dash line as a `sel: 0` unit.
 *
 * China used to need no fixture like this, because it did not go through
 * `parseProvinceTopology` at all: it was fetched as a bare TopoJSON and drawn
 * by a renderer of its own. It takes the same path as Peru now, and the two
 * things that differ about its file are exactly the two this pins — the id
 * scheme, which `cityProvince` joins on, and the missing English name, which
 * `unitLabel` resolves from `lib/provinces.ts` instead.
 *
 * The geometry is Peru's, deliberately: nothing that reads this fixture asserts
 * a shape, and a second hand-wound ring is a second chance to wind it inside
 * out (see `PE_TOPOLOGY`'s note).
 */
export const CN_FILE: ProvinceFile = parseProvinceTopology({
  country: "CN",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adcode",
  topology: {
    ...PE_TOPOLOGY,
    objects: {
      provinces: {
        type: "GeometryCollection",
        geometries: (
          PE_TOPOLOGY.objects.provinces as { geometries: Record<string, unknown>[] }
        ).geometries.map((geometry, i) => ({
          ...geometry,
          id: ["110000", "310000", "510000", "100000_JD"][i] ?? `9${i}0000`,
          properties: {
            name: ["北京市", "上海市", "四川省", "南海诸岛"][i] ?? `unit ${i}`,
            // No `name_en`: the curated table is what supplies it for China.
            sel: i === 3 ? 0 : 1,
          },
        })),
      },
    },
  },
  cityProvince: { cusco: "110000", G1: "110000" },
});
