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

/** The fixture as the level receives it — through the real parser, not around it. */
export const PE_FILE: ProvinceFile = parseProvinceTopology({
  country: "PE",
  generatedAt: "2026-08-30T00:00:00.000Z",
  idKey: "adm1_code",
  topology: PE_TOPOLOGY,
  cityProvince: {},
});

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
