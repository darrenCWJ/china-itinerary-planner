"use client";

import { useMemo, useRef } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { ProjectionEntry } from "@/lib/countryProjection";
import { IDENTITY_TRANSFORM } from "@/lib/mapTransform";
import { provinceByAdcode, REGION_META } from "@/lib/provinces";
import type { ProvinceFile } from "@/lib/provinceTopology";
import type { ChinaRegion } from "@/lib/types";
import { CountryLevel } from "./CountryLevel";
import { CountryPlaceList } from "./CountryPlaceList";
import {
  buildFitProjection,
  createHoverReporter,
  makeProjector,
  transformForFeatures,
  useMarkersVisible,
  MAP_VIEW_H,
  MAP_VIEW_W,
  ZOOM_MS,
  type HoverPos,
} from "./mapShared";
import {
  FIT_COLORS,
  FIT_FILL_OPACITY,
  fitForPlace,
  fitForRegion,
  type MapPlace,
} from "./mapTypes";

/**
 * Country level of the two-level picker (spec §6), and now only the dispatcher
 * for it: China renders the province/region/city map it always has, every
 * other country renders `CountryLevel` over its own admin-1 file, and a
 * country whose geometry has not arrived renders the list alone.
 *
 * That split is about the RENDERER, not about the data. `lib/countryDetail.ts`
 * says all 246 countries have admin-1 geometry to draw; what stays China-only
 * is the curated asset and the region grouping on top of it, so the question
 * asked here is the narrow one — does this country have that asset — and a
 * registry answering "yes, Peru has a detail level" cannot route Peru into
 * `ChinaLevel`.
 *
 * The China branch is still the former `ChinaMap`, untouched: §9.5 requires
 * China's rendered output to be byte-identical across this phase, and nothing
 * below reaches it.
 */

/**
 * The one country with a CURATED level — `public/china-provinces.json`, the
 * hand-built asset that carries China's regions, and the only country whose
 * geometry ships bundled rather than under `public/provinces/`.
 *
 * No longer the one country with a detail level: since PR4 every country has
 * one, and `lib/countryDetail.ts` answers that question from the index. What
 * stays China-only is this asset and the region grouping on top of it, which
 * is L3's problem and Plan 4's.
 */
export const CURATED_COUNTRY = "CN";

/**
 * Whether a country renders through `ChinaLevel` and its curated asset.
 *
 * Deliberately NOT `hasDetailLevel`, which now answers "did the build write
 * this country a province file" and is true for all 246. The two questions
 * were the same string comparison until PR4 and are not the same question:
 * this one decides which RENDERER a country gets, and answering it from the
 * registry would draw Peru's markers over China's provinces.
 *
 * The caller needs it too — it is what decides whether the curated asset is
 * worth fetching — so it lives here rather than being re-derived from a string
 * comparison at each site.
 */
export function hasCuratedTopology(country: string): boolean {
  return (typeof country === "string" ? country.trim().toUpperCase() : "") === CURATED_COUNTRY;
}

interface ProvinceProps {
  adcode: number;
  name: string;
}

type ProvinceFeature = GeoJSON.Feature<GeoJSON.Geometry, ProvinceProps>;

interface LevelProps {
  places: MapPlace[];
  selected: string[];
  month: number;
  /**
   * `ChinaRegion`, permanently — not a type PR3 widens. Judgement call J14:
   * other countries have no regions to zoom into, so a wider type here would
   * be a promise this level can't keep. Zooming into a region stays a
   * China-only feature by design.
   */
  zoomRegion: ChinaRegion | null;
  routeIds: string[];
  onZoomRegion: (region: ChinaRegion | null) => void;
  onTogglePlace: (place: MapPlace) => void;
  onHoverPlace: (place: MapPlace | null, pos: HoverPos | null) => void;
}

export interface CountryMapProps extends LevelProps {
  /** ISO alpha-2 of the country being planned. */
  country: string;
  /** China's curated province topology. Nothing else uses it. */
  topology: Topology | null;
  /**
   * Every other country's admin-1 file, or null while it is in flight or after
   * it failed — the two are the same thing here, and deliberately: §5.2 makes
   * the map an enhancement, so both render the list on its own rather than a
   * spinner or an error.
   *
   * Required rather than optional even though it is nullable. A caller that
   * simply forgot it would otherwise get the list-only fallback in silence,
   * which is exactly the bug this PR exists to fix and is invisible on screen.
   */
  provinces: ProvinceFile | null;
  /** Its §5.4 manifest entry, or null to fall back to a fit over the units. */
  projection: ProjectionEntry | null;
  /**
   * The map is a VIEW of a plan rather than a picker for one — `RouteMap`
   * (§2.1) — so `CountryLevel` draws its markers without offering to toggle
   * anything.
   *
   * Deliberately not spread into the other two branches. `ChinaLevel` is
   * frozen by §9.5 and has no card to suppress; `CountryPlaceList` is §5.2's
   * spine and is the one control per place a read-only surface keeps, so
   * silencing it would leave a trip's stops announced by nothing at all.
   */
  readOnly?: boolean;
}

export function CountryMap({
  country,
  topology,
  provinces,
  projection,
  readOnly = false,
  ...level
}: CountryMapProps) {
  if (hasCuratedTopology(country)) {
    // The caller owns the topology fetch and its loading state, so a level
    // waiting on the asset draws nothing rather than flashing a fallback that
    // claims the country has no map.
    return topology ? <ChinaLevel topology={topology} {...level} /> : null;
  }
  if (provinces) {
    return (
      <CountryLevel
        country={country}
        provinces={provinces}
        projection={projection}
        places={level.places}
        selected={level.selected}
        month={level.month}
        routeIds={level.routeIds}
        readOnly={readOnly}
        onTogglePlace={level.onTogglePlace}
        onHoverPlace={level.onHoverPlace}
      />
    );
  }
  // No geometry: the list is the whole level, and reaches every place in it.
  return (
    <CountryPlaceList
      country={country}
      places={level.places}
      selected={level.selected}
      onTogglePlace={level.onTogglePlace}
    />
  );
}

function ChinaLevel({
  topology,
  places,
  selected,
  month,
  zoomRegion,
  routeIds,
  onZoomRegion,
  onTogglePlace,
  onHoverPlace,
}: LevelProps & { topology: Topology }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const markersVisible = useMarkersVisible(zoomRegion);

  const { provinces, ninedash, projection, pathGen } = useMemo(() => {
    const objectName = Object.keys(topology.objects)[0];
    const collection = feature(
      topology,
      topology.objects[objectName] as GeometryCollection<ProvinceProps>
    );
    const all = collection.features as ProvinceFeature[];
    const provinceFeatures = all.filter((f) => provinceByAdcode(f.properties.adcode));
    const ninedashFeature = all.find((f) => !provinceByAdcode(f.properties.adcode)) ?? null;
    // Fitted to the provinces only — the nine-dash line would otherwise drag
    // the extent south and shrink the mainland.
    const { projection: proj, pathGen: path } = buildFitProjection(provinceFeatures);
    return {
      provinces: provinceFeatures,
      ninedash: ninedashFeature,
      projection: proj,
      pathGen: path,
    };
  }, [topology]);

  // Zoom transform for the active region (identity at country level).
  const transform = useMemo(() => {
    if (!zoomRegion) return IDENTITY_TRANSFORM;
    const regionFeatures = provinces.filter(
      (f) => provinceByAdcode(f.properties.adcode)?.region === zoomRegion
    );
    return transformForFeatures(pathGen, regionFeatures);
  }, [zoomRegion, provinces, pathGen]);

  const { k, tx, ty } = transform;

  const visiblePlaces = useMemo(() => {
    if (!zoomRegion) return places.filter((p) => p.kind === "curated");
    return places.filter((p) => p.region === zoomRegion);
  }, [places, zoomRegion]);

  const project = makeProjector(projection);

  const routePoints = useMemo(
    () =>
      routeIds
        .map((id) => places.find((p) => p.id === id))
        .filter((p): p is MapPlace => Boolean(p))
        .map((p) => project(p.lon, p.lat)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, places, projection]
  );

  const reportHover = createHoverReporter<MapPlace>(containerRef, onHoverPlace);

  const labelFor = (p: MapPlace): boolean =>
    p.kind === "curated" ||
    p.level === "municipality" ||
    (p.level === "prefecture" && (p.population ?? 0) > 3_000_000);

  const radiusFor = (p: MapPlace): number => {
    if (p.kind === "curated") return zoomRegion ? 9 / k : 7;
    if (p.level === "municipality") return 8 / k;
    if (p.level === "prefecture") return 6.5 / k;
    return 4.5 / k;
  };

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
        className="h-auto w-full select-none"
        // A group, not an image. `role="img"` makes the whole subtree
        // presentational, which drops every province zoom control and every
        // place toggle out of the accessibility tree while `tabIndex={0}` keeps
        // them focusable — a keyboard user lands on controls a screen reader
        // announces as nothing. WorldMap reached the same conclusion first and
        // says so in its own docblock; this is that decision, applied here.
        role="group"
        aria-label={
          zoomRegion
            ? `Map of ${zoomRegion} China with selectable places`
            : "Map of China segmented by region"
        }
      >
        <g
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${k})`,
            transformOrigin: "0 0",
            transition: `transform ${ZOOM_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`,
          }}
        >
          {provinces.map((f) => {
            const meta = provinceByAdcode(f.properties.adcode);
            if (!meta) return null;
            const regionFit = fitForRegion(meta.region, month);
            const isInZoomedRegion = zoomRegion === meta.region;
            const dimmed = zoomRegion !== null && !isInZoomedRegion;
            return (
              <path
                key={f.properties.adcode}
                d={pathGen(f) ?? undefined}
                fill={REGION_META[meta.region].color}
                fillOpacity={dimmed ? 0.05 : FIT_FILL_OPACITY[regionFit]}
                stroke={dimmed ? "var(--line-1)" : "var(--paper)"}
                strokeWidth={(zoomRegion ? 0.7 : 1) / k}
                className={zoomRegion ? undefined : "cursor-pointer"}
                onClick={() => {
                  if (!zoomRegion) onZoomRegion(meta.region);
                }}
                role={zoomRegion ? undefined : "button"}
                aria-label={
                  zoomRegion
                    ? undefined
                    : `Zoom into ${meta.region} China (${meta.nameEn})`
                }
              >
                <title>
                  {meta.nameEn} · {meta.region} China
                </title>
              </path>
            );
          })}

          {/* Nine-dash line (南海诸岛) — part of the official map extent. */}
          {ninedash && !zoomRegion && (
            <path
              d={pathGen(ninedash) ?? undefined}
              fill="none"
              stroke="var(--seal)"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          )}

          {/* Region labels at country level */}
          {!zoomRegion &&
            (Object.keys(REGION_META) as ChinaRegion[]).map((region) => {
              const [x, y] = project(...REGION_META[region].anchor);
              return (
                <text
                  key={region}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  className="pointer-events-none font-mono uppercase"
                  fontSize={13}
                  letterSpacing="0.18em"
                  fill="var(--ink-2)"
                  opacity={0.85}
                >
                  {REGION_META[region].label}
                </text>
              );
            })}

          {/*
            Suggested route. Neutral ink rather than the blue literal it used to
            be: at strokeOpacity 0.75 no single fixed colour clears 3:1 against
            both papers (over white it would have to be darker than L 0.07, over
            dark paper lighter than L 0.15), so the line has to follow the ramp.
            `--ink-1` and not an accent token because the selection ring beside
            it is `--seal` — an accent-coloured route would read as the same
            mark. The stop numbers carry the meaning; the line only connects.
          */}
          {routePoints.length >= 2 && (
            <polyline
              points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="var(--ink-1)"
              strokeWidth={2 / k}
              strokeDasharray={`${7 / k} ${5 / k}`}
              strokeLinecap="round"
              opacity={markersVisible ? 0.75 : 0}
              style={{ transition: "opacity 250ms" }}
            />
          )}

          {/* Markers */}
          <g
            opacity={markersVisible ? 1 : 0}
            style={{ transition: "opacity 250ms" }}
          >
            {visiblePlaces.map((p) => {
              const [x, y] = project(p.lon, p.lat);
              const isSelected = selected.includes(p.id);
              const fit = fitForPlace(p, month);
              const r = radiusFor(p);
              const stopIndex = routeIds.indexOf(p.id);
              return (
                <g
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => onTogglePlace(p)}
                  onMouseEnter={(e) => reportHover(p, e)}
                  onMouseMove={(e) => reportHover(p, e)}
                  onMouseLeave={() => reportHover(null)}
                  role="button"
                  tabIndex={p.kind === "curated" ? 0 : -1}
                  aria-pressed={isSelected}
                  aria-label={`${p.name}${isSelected ? " (selected)" : ""}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onTogglePlace(p);
                    }
                  }}
                >
                  {isSelected && (
                    <circle
                      cx={x}
                      cy={y}
                      r={r + 3.5 / k}
                      fill="none"
                      stroke="var(--seal)"
                      strokeWidth={2 / k}
                      opacity={0.9}
                    />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={FIT_COLORS[fit]}
                    fillOpacity={p.kind === "curated" ? 0.95 : 0.8}
                    stroke="var(--paper)"
                    strokeWidth={1.2 / k}
                  />
                  {isSelected && stopIndex >= 0 && (
                    <text
                      x={x}
                      y={y + (r > 5 / k ? 3.2 / k : 2.8 / k)}
                      textAnchor="middle"
                      fontSize={Math.max(8 / k, r * 1.1)}
                      fontWeight={700}
                      fill="var(--paper)"
                      className="pointer-events-none"
                    >
                      {stopIndex + 1}
                    </text>
                  )}
                  {labelFor(p) && (
                    <text
                      x={x}
                      y={y - r - 3 / k}
                      textAnchor="middle"
                      fontSize={zoomRegion ? 11 / k : 11}
                      fontWeight={600}
                      fill="var(--ink-0)"
                      stroke="var(--paper)"
                      strokeWidth={3 / k}
                      paintOrder="stroke"
                      className="pointer-events-none"
                    >
                      {p.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </div>
  );
}
