"use client";

import { useMemo, useRef } from "react";
import { geoPath } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, MultiPolygon, Polygon } from "topojson-specification";
import { getCountry } from "@/lib/countries";
import { projectionFor, type ProjectionEntry, type ViewBox } from "@/lib/countryProjection";
import { MAP_VIEW_PAD } from "@/lib/mapView";
import { PROVINCE_OBJECT, type ProvinceFile, type ProvinceUnit } from "@/lib/provinceTopology";
import { CountryPlaceList } from "./CountryPlaceList";
import {
  buildFitProjection,
  createHoverReporter,
  makeProjector,
  MAP_VIEW_H,
  MAP_VIEW_W,
  type FittedProjection,
  type HoverPos,
} from "./mapShared";
import { FIT_COLORS, fitForPlace, type MapPlace } from "./mapTypes";

/**
 * The country level every country that is not China renders (spec §5).
 *
 * A separate file from `ChinaLevel` rather than a generalisation of it, and
 * deliberately: `ChinaLevel` carries the seven curated regions, the nine-dash
 * line and the region zoom, all of which are L3's problem (PR5) and none of
 * which any other country has. §9.5 requires China's rendered output to be
 * byte-identical across this phase, and the cheapest way to guarantee that is
 * for this work to never touch the code path that draws it.
 *
 * Three things here are load-bearing.
 *
 * **The outline is `merge()` over the very units the picker lists**, not a
 * second asset (§4.1). One fetch feeds both, and the seams between units
 * dissolve because they share arcs — a country whose units were separate
 * polygons would draw its internal borders twice, once as a unit edge and once
 * as coastline.
 *
 * **The frame comes from the manifest, not from a fit over what happened to
 * load.** `public/country-projections.json` is where the §5.4 trim decisions
 * live — the nine countries whose outlying polygons are deliberately out of
 * frame — and a per-render `fitExtent` would silently overrule every one of
 * them, putting Clipperton back in France's viewport and shrinking the country
 * anyone actually plans in by a factor of six. The fit remains as the fallback
 * for a country with no entry, because the manifest and the code deploy
 * independently.
 *
 * **The list beside the map is not decoration.** §5.2 makes it the source of
 * truth for the accessibility tree and §12.2 gates the phase on it: the map
 * must never become the only way to select a place. Until PR4's roving
 * tabindex gives the markers a keyboard model of their own, they are a mouse
 * and touch affordance and the list is the whole of the keyboard one — which
 * is why the marker layer is `aria-hidden` rather than 750 tab stops.
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

/**
 * Marker geometry, in viewBox units at country level.
 *
 * Plain numbers rather than `x / k` because this level has no zoom transform:
 * `k` is 1 everywhere here, exactly as it is for `ChinaLevel`'s unzoomed
 * curated radius of 7. PR5 adds the province zoom, and every one of these
 * becomes a division the moment it does — that is the discipline that keeps
 * visual weight scale-invariant, and the reason they are named constants
 * rather than literals scattered through the JSX.
 */
const UNIT_STROKE = 0.7;
const OUTLINE_STROKE = 1.2;
const MARKER_STROKE = 1.2;
const SELECTION_RING = 3.5;
const ROUTE_STROKE = 2;

/** A place big enough to be worth a name on a country-wide map. */
const LABELLED_PREFECTURE_POPULATION = 3_000_000;

function labelFor(place: MapPlace): boolean {
  return (
    place.kind === "curated" ||
    place.level === "municipality" ||
    (place.level === "prefecture" && (place.population ?? 0) > LABELLED_PREFECTURE_POPULATION)
  );
}

function radiusFor(place: MapPlace): number {
  if (place.kind === "curated") return 7;
  if (place.level === "municipality") return 8;
  if (place.level === "prefecture") return 6.5;
  return 4.5;
}

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

export interface CountryLevelProps {
  /** ISO alpha-2 of the country being planned. */
  country: string;
  /** Its admin-1 geometry, already validated by `parseProvinceTopology`. */
  provinces: ProvinceFile;
  /** Its §5.4 manifest entry, or null to fall back to a fit over the units. */
  projection: ProjectionEntry | null;
  places: MapPlace[];
  selected: string[];
  month: number;
  routeIds: string[];
  onTogglePlace: (place: MapPlace) => void;
  onHoverPlace: (place: MapPlace | null, pos: HoverPos | null) => void;
}

export function CountryLevel({
  country,
  provinces,
  projection,
  places,
  selected,
  month,
  routeIds,
  onTogglePlace,
  onHoverPlace,
}: CountryLevelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { name, code } = getCountry(country);
  const label = name || code || "this country";

  const view = useMemo(() => {
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
    for (const shape of features) {
      const d = pathGen(shape);
      if (!d) continue;
      const unit = typeof shape.id === "string" ? (byId.get(shape.id) ?? null) : null;
      units.push({
        id: typeof shape.id === "string" ? shape.id : "",
        d,
        selectable: unit?.selectable ?? false,
        // Endonym first, English second, and the id only when a source carries
        // neither — `KI-X02~` has a null name and would otherwise render a
        // `<title>` with nothing in it.
        label: unit ? (unit.nameEn ?? unit.name ?? unit.id) : null,
      });
    }

    return { units, outline: pathGen(outline), project: makeProjector(proj) };
  }, [provinces, projection]);

  const { units, outline, project } = view;

  const routePoints = useMemo(
    () =>
      routeIds
        .map((id) => places.find((p) => p.id === id))
        .filter((p): p is MapPlace => Boolean(p))
        .map((p) => project(p.lon, p.lat)),
    [routeIds, places, project]
  );

  const reportHover = createHoverReporter<MapPlace>(containerRef, onHoverPlace);

  return (
    <div>
      <div ref={containerRef} className="relative">
        <svg
          viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
          className="h-auto w-full select-none"
          // A group, not an image: `role="img"` makes the whole subtree
          // presentational, which is the mistake `WorldMap` and `ChinaLevel`
          // both call out in their own docblocks.
          role="group"
          aria-label={`Map of ${label}`}
        >
          <g data-units="">
            {units.map((unit) => (
              <path
                key={unit.id}
                // Only the selectable ones are marked, because this is the
                // attribute PR5 hangs the province zoom on: a unit that is not
                // a subdivision must not become one by being drawn.
                data-unit={unit.selectable ? unit.id : undefined}
                d={unit.d}
                fill="var(--surf-2)"
                stroke="var(--paper)"
                strokeWidth={UNIT_STROKE}
              >
                {unit.selectable && unit.label && <title>{unit.label}</title>}
              </path>
            ))}
          </g>

          {/* The national border, over the seams the units drew. */}
          {outline && (
            <path
              data-outline=""
              d={outline}
              fill="none"
              stroke="var(--ink-2)"
              strokeOpacity={0.55}
              strokeWidth={OUTLINE_STROKE}
              className="pointer-events-none"
              aria-hidden
            />
          )}

          {/*
            Suggested route, in neutral ink for the reason `ChinaLevel` gives:
            at strokeOpacity 0.75 no fixed colour clears 3:1 against both
            papers, and an accent-coloured line would read as the same mark as
            the `--seal` selection ring beside it.
          */}
          {routePoints.length >= 2 && (
            <polyline
              points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="var(--ink-1)"
              strokeWidth={ROUTE_STROKE}
              strokeDasharray="7 5"
              strokeLinecap="round"
              opacity={0.75}
              className="pointer-events-none"
            />
          )}

          {/*
            Markers. Out of the accessibility tree until PR4 gives them the
            roving tabindex of §5.3.1: the list below announces and reaches
            every one of these places already, and a second copy of 750 cities
            in the tree — with no keyboard model behind it — is worse for a
            screen reader than none.
          */}
          <g data-markers="" aria-hidden>
            {places.map((place) => {
              const [x, y] = project(place.lon, place.lat);
              const isSelected = selected.includes(place.id);
              const r = radiusFor(place);
              const stopIndex = routeIds.indexOf(place.id);
              return (
                <g
                  key={place.id}
                  data-place={place.id}
                  className="cursor-pointer"
                  onClick={() => onTogglePlace(place)}
                  onMouseEnter={(e) => reportHover(place, e)}
                  onMouseMove={(e) => reportHover(place, e)}
                  onMouseLeave={() => reportHover(null)}
                >
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r={r + SELECTION_RING}
                      fill="none"
                      stroke="var(--seal)"
                      strokeWidth={2}
                      opacity={0.9}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={FIT_COLORS[fitForPlace(place, month)]}
                    fillOpacity={place.kind === "curated" ? 0.95 : 0.8}
                    stroke="var(--paper)"
                    strokeWidth={MARKER_STROKE}
                  />
                  {isSelected && stopIndex >= 0 && (
                    <text
                      x={x}
                      y={y + (r > 5 ? 3.2 : 2.8)}
                      textAnchor="middle"
                      fontSize={Math.max(8, r * 1.1)}
                      fontWeight={700}
                      fill="var(--paper)"
                      className="pointer-events-none"
                    >
                      {stopIndex + 1}
                    </text>
                  )}
                  {labelFor(place) && (
                    <text
                      x={x}
                      y={y - r - 3}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--ink-0)"
                      stroke="var(--paper)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="pointer-events-none"
                    >
                      {place.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="mt-4">
        <CountryPlaceList
          country={country}
          places={places}
          selected={selected}
          onTogglePlace={onTogglePlace}
          hasMap
        />
      </div>
    </div>
  );
}
