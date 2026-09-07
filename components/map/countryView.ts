import { geoPath, type GeoPath } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, MultiPolygon, Polygon } from "topojson-specification";
import { projectionFor, type ProjectionEntry, type ViewBox } from "@/lib/countryProjection";
import { MAP_VIEW_PAD } from "@/lib/mapView";
import { PROVINCE_OBJECT, type ProvinceFile, type ProvinceUnit } from "@/lib/provinceTopology";
import { unitLabel } from "@/lib/regionScheme";
import { buildFitProjection, makeProjector, MAP_VIEW_H, MAP_VIEW_W, type FittedProjection } from "./mapShared";

/**
 * The country level's view: TopoJSON units and the national outline, fitted
 * to the frame, as `CountryLevel` draws them (spec 2026-08-29 §4.1, §5.4).
 *
 * Pure — one function over a province file and a manifest entry — and moved
 * verbatim out of CountryLevel.tsx on 2026-09-07 so that file stays under the
 * 800-line guidance. Every docblock below is that file's.
 */

/** What this level reads off a unit's TopoJSON geometry. */
interface UnitProps {
  sel: 0 | 1;
}

/**
 * The extent the country is fitted into, inset so coastlines are not flush
 * against the frame.
 *
 * The same box `buildFitProjection` uses, on purpose: the manifest path and
 * the fallback then frame a country identically, and the only difference
 * between them is WHICH geometry decides the bounds. The committed `scale` is
 * measured against the flush 860 x 620 box, so it is not the number this
 * produces — `projectionFor` refits to whatever box it is handed, and §5.4's
 * own test recomputes the committed value from the committed bounds.
 */
const VIEW_BOX: ViewBox = [
  [MAP_VIEW_PAD, MAP_VIEW_PAD],
  [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD],
];

/** The manifest's projection, plus the path generator that draws through it. */
function fromManifest(entry: ProjectionEntry): FittedProjection {
  const projection = projectionFor(entry, VIEW_BOX);
  return { projection, pathGen: geoPath(projection) };
}

interface UnitShape {
  id: string;
  d: string;
  /** §7.2: false for geometry that shapes the outline without being a choice. */
  selectable: boolean;
  label: string | null;
}

/** One unit as geometry rather than as a path string — what a zoom measures. */
type UnitFeature = GeoJSON.Feature<GeoJSON.Geometry, UnitProps>;

/**
 * Everything one country's topology is drawn from, and everything a zoom into
 * one of its units needs to frame it.
 *
 * The first three are what the JSX consumes. The last two used to be computed
 * here and thrown away, and the province zoom is what wants them back: they
 * are the pair `transformForFeatures` takes — a generator, and the features to
 * frame — and they fall out of the same pass that produced the `d` strings.
 * `pathGen` turns a unit into the path beside it; `pathGen.bounds(feature)`
 * turns the same unit into the extent the zoom is fitted to. Rebuilding a
 * projection at zoom time would be that arithmetic twice over and, worse, a
 * SECOND answer to "where is this province" — the kind of drift that leaves a
 * marker outside the frame that was supposed to hold it.
 */
export interface CountryView {
  units: UnitShape[];
  /** The merged national border, or null when the merge drew nothing. */
  outline: string | null;
  project: (lon: number, lat: number) => [number, number];
  /**
   * The generator the shapes above were drawn through.
   *
   * Exposed to be MEASURED with, not to re-draw with: every `d` a unit needs
   * is already in `units`, and a second `pathGen(feature)` per frame is
   * precisely the cost the memo around this exists to pay once.
   */
  pathGen: GeoPath;
  /**
   * The units a region group can name, by id.
   *
   * Selectable ones, and drawn ones. `regionSchemeFor` drops `sel: 0` for
   * §7.2's reason — ISO 3166-1 governs territorial EXTENT while 3166-2 governs
   * SUBDIVISION identity — and this map drops them for the same one, so the set
   * that can be zoomed to is exactly the set `data-unit` marks. That matters
   * because 43 committed `cityProvince` values name a unit this omits: a
   * lookup that ought to miss must not be made to hit by a second, laxer index
   * of the same geometry.
   *
   * A miss therefore resolves to no feature, an empty list, and
   * `IDENTITY_TRANSFORM` from the guard in `transformForFeatures` — an
   * unzoomed map rather than a vanished one.
   */
  selectableFeatures: ReadonlyMap<string, UnitFeature>;
}

/**
 * Decodes one country's province file into everything drawn from it.
 *
 * A module-level function rather than an inline `useMemo` body, because it is
 * the expensive half of this file — a TopoJSON decode, a `merge()` over every
 * unit, and one path render each — and out here a test can hold its product in
 * a hand instead of inferring it from the DOM. The memo is then one line, and
 * its dependency array is the whole of its policy: this runs once per
 * topology, and a zoom must never be one of its inputs.
 */
export function buildCountryView(
  provinces: ProvinceFile,
  projection: ProjectionEntry | null
): CountryView {
  const topology = provinces.topology;
  const collection = topology.objects[PROVINCE_OBJECT] as GeometryCollection<UnitProps>;
  const features = feature(topology, collection).features;

  /**
   * `collection.geometries`, not `collection`.
   *
   * `@types/topojson-client` declares `merge(topology, GeometryCollection |
   * Array<Polygon | MultiPolygon>)`, and the runtime accepts only the array:
   * `mergeArcs` calls `objects.forEach`, so a GeometryCollection throws
   * "objects.forEach is not a function". The types are wrong, not the docs.
   */
  const outline = merge(
    topology,
    collection.geometries as Array<Polygon<UnitProps> | MultiPolygon<UnitProps>>
  );

  // A manifest entry beats a fit; the fit is what a country without one gets.
  const { projection: proj, pathGen } = projection
    ? fromManifest(projection)
    : buildFitProjection(features);

  const byId = new Map<string, ProvinceUnit>(provinces.units.map((unit) => [unit.id, unit]));
  const units: UnitShape[] = [];
  const selectableFeatures = new Map<string, UnitFeature>();
  for (const shape of features) {
    const d = pathGen(shape);
    if (!d) continue;
    const id = typeof shape.id === "string" ? shape.id : "";
    const unit = typeof shape.id === "string" ? (byId.get(shape.id) ?? null) : null;
    const selectable = unit?.selectable ?? false;
    units.push({
      id,
      d,
      selectable,
      // `unitLabel` and not the precedence inlined, which is what this was:
      // `unit.nameEn ?? unit.name ?? unit.id`. That is the same order for 245
      // countries and wrong for the 246th — every CN unit has `nameEn: null`,
      // so it fell straight to the endonym and put 北京市 in the tooltip while
      // the picker beside it, which does call `unitLabel`, said "Beijing".
      //
      // Invisible until China started rendering here: it had a renderer of its
      // own, and this branch never saw a file whose English names live in a
      // separate table. One function, so the two controls cannot disagree.
      label: unit ? unitLabel(provinces.country, unit) : null,
    });
    // Indexed off the same `selectable` the path above was drawn with, inside
    // the same `if (!d) continue`, so the zoomable set cannot drift from the
    // drawn one.
    if (selectable) selectableFeatures.set(id, shape);
  }

  return {
    units,
    outline: pathGen(outline),
    project: makeProjector(proj),
    pathGen,
    selectableFeatures,
  };
}
