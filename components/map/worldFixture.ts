/**
 * The hand-built world both world-level renderers are tested against.
 *
 * Not test-only by accident of naming: nothing under `app/` or `components/`
 * imports it, so it never reaches a bundle. It lives in its own module rather
 * than in `WorldMap.test.tsx` because importing one `.test.tsx` from another
 * makes vitest collect the imported file's `describe` blocks a second time —
 * every WorldMap test would run again, inside `GlobeLevel.test.tsx`, under
 * whichever `beforeEach` happened to register first. Shared *data* needs a
 * module; a shared *suite* is a duplicate.
 *
 */

/**
 * Absolute (untransformed) TopoJSON arcs, one closed ring per country, wound so
 * that d3 reads the *rectangle* as the interior — south-west, north-west,
 * north-east, south-east, close.
 *
 * The winding is load-bearing and was wrong until Task 8. Reversed, d3 reads
 * each ring as the whole sphere minus the rectangle (`geoArea` 4π), which
 * Mercator renders indistinguishably from the correct shape and which makes
 * every country permanently front-facing on a globe. `WorldMap.test.tsx`
 * carries the guard test that pins it, for both renderers.
 *
 * Six countries, deliberately spanning both hemispheres: at any rotation some
 * are on the far side of the globe, which is the only way a test can reach the
 * back-face behaviour at all. At d3's default rotation FR/MT/PE face the viewer
 * and JP/SG/NZ do not.
 *
 * Name order is France, Japan, Malta, New Zealand, Peru, Singapore — Singapore
 * stays last, so the End-key and arrow-order tests are untouched by the two
 * additions.
 */
export const WORLD_FIXTURE = {
  topology: {
    type: "Topology",
    arcs: [
      [
        [0, 44],
        [0, 48],
        [4, 48],
        [4, 44],
        [0, 44],
      ],
      [
        [136, 34],
        [136, 38],
        [140, 38],
        [140, 34],
        [136, 34],
      ],
      [
        [103.6, 1.2],
        [103.6, 1.4],
        [103.9, 1.4],
        [103.9, 1.2],
        [103.6, 1.2],
      ],
      [
        [14.4, 35.8],
        [14.4, 36.0],
        [14.6, 36.0],
        [14.6, 35.8],
        [14.4, 35.8],
      ],
      [
        [172, -42],
        [172, -40],
        [176, -40],
        [176, -42],
        [172, -42],
      ],
      [
        [-77, -12],
        [-77, -8],
        [-73, -8],
        [-73, -12],
        [-77, -12],
      ],
    ],
    objects: {
      countries: {
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", id: "FR", arcs: [[0]], properties: { name: "France" } },
          { type: "Polygon", id: "JP", arcs: [[1]], properties: { name: "Japan" } },
          { type: "Polygon", id: "SG", arcs: [[2]], properties: { name: "Singapore" } },
          { type: "Polygon", id: "MT", arcs: [[3]], properties: { name: "Malta" } },
          { type: "Polygon", id: "NZ", arcs: [[4]], properties: { name: "New Zealand" } },
          { type: "Polygon", id: "PE", arcs: [[5]], properties: { name: "Peru" } },
        ],
      },
    },
  },
  smallCountries: [
    { code: "SG", name: "Singapore", lon: 103.75, lat: 1.3 },
    { code: "MT", name: "Malta", lon: 14.5, lat: 35.9 },
  ],
};
