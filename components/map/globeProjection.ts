import { geoOrthographic, geoPath, type GeoPath, type GeoProjection } from "d3-geo";
import { MAP_VIEW_H, MAP_VIEW_PAD, MAP_VIEW_W } from "@/lib/mapView";
import type { Rotation } from "@/lib/globeRotation";

/**
 * The globe's projection, deliberately NOT in `mapShared.ts`.
 *
 * `mapShared` is imported by `CountryMap`, which `MapExplorer` imports
 * statically — so anything living there ships to every `/plan` visitor whether
 * or not they ever open the picker. That is the exact cost `MapExplorer`'s
 * `next/dynamic` import of the world level exists to avoid. This module is
 * reached only through `GlobeLevel`, which is dynamically imported, so
 * `geoOrthographic` stays in the lazy chunk. `MAP_VIEW_*` therefore comes from
 * `@/lib/mapView` and not from `mapShared`, which re-exports it: importing it
 * through `mapShared` would drag `geoMercator` back in behind it.
 */

/**
 * Fitted to `{type: "Sphere"}` rather than to the features currently in view.
 * That is what keeps the disc from resizing as countries rotate past the limb:
 * the fit becomes a constant — scale 300, translate [430, 310] — so
 * `MAP_VIEW_W/H` and `lib/mapTransform.ts` are untouched and its hand-computed
 * fixtures still hold. `lib/globeRotation.ts` pins those three numbers as
 * `GLOBE_R`/`GLOBE_CX`/`GLOBE_CY` and asserts them against d3 itself.
 */
export function buildGlobeProjection(rotate: Rotation): {
  projection: GeoProjection;
  pathGen: GeoPath;
} {
  const projection = geoOrthographic()
    .rotate(rotate)
    .fitExtent(
      [
        [MAP_VIEW_PAD, MAP_VIEW_PAD],
        [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD],
      ],
      { type: "Sphere" }
    );
  return { projection, pathGen: geoPath(projection) };
}
