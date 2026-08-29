"use client";

import { useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { getCountry } from "@/lib/countries";
import { IDENTITY_TRANSFORM } from "@/lib/mapTransform";
import { filterPlaces, groupPlacesByAdmin1 } from "@/lib/placeGrouping";
import { provinceByAdcode, REGION_META } from "@/lib/provinces";
import type { ChinaRegion } from "@/lib/types";
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
 * Country level of the two-level picker (spec §6). China renders the
 * province/region/city map it always has; every other country renders the
 * list fallback in the same shell.
 *
 * That split is now about the RENDERER, not about the data. `lib/countryDetail.ts`
 * says all 246 countries have admin-1 geometry to draw, and the generic level
 * that draws it is Task 6 of this plan; until it exists, this dispatcher asks
 * the narrower question — does this country have the curated asset — so a
 * registry that answers "yes" for Peru cannot route Peru into `ChinaLevel`.
 *
 * This is the former `ChinaMap` with a `country` prop in front of it. The China
 * branch is a verbatim move — the world level is an addition *in front of* that
 * flow, not a change to it.
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
  /** China's province topology. Nothing else uses it. */
  topology: Topology | null;
}

export function CountryMap({ country, topology, ...level }: CountryMapProps) {
  if (hasCuratedTopology(country)) {
    // The caller owns the topology fetch and its loading state, so a level
    // waiting on the asset draws nothing rather than flashing a fallback that
    // claims the country has no map.
    return topology ? <ChinaLevel topology={topology} {...level} /> : null;
  }
  return (
    <CountryPlaceList
      country={country}
      places={level.places}
      selected={level.selected}
      onTogglePlace={level.onTogglePlace}
    />
  );
}

/** Chips shown per province before the group offers to expand. */
const PLACES_PER_GROUP = 12;

/**
 * The fallback level: no geometry, so the places themselves are the map.
 *
 * This panel used to defer to the destination step's own search rather than
 * grow a second input, on the grounds that two boxes could disagree. It has
 * one now, and they do different jobs: that search reaches the whole catalog
 * and adds places; this filter narrows the shard already on screen and never
 * fetches. Spec 5.2 makes the list the accessibility spine of the country
 * level, and a spine that renders 60 of 750 rows is not one — for 150 of 246
 * countries the old cap hid most of the shard.
 */

function CountryPlaceList({
  country,
  places,
  selected,
  onTogglePlace,
}: {
  country: string;
  places: MapPlace[];
  selected: string[];
  onTogglePlace: (place: MapPlace) => void;
}) {
  const { name, code } = getCountry(country);
  // `getCountry` is total and never throws, and since `INGESTED_NAMES` landed
  // in lib/countries.ts it names all 246 countries rather than the curated 24 —
  // so this reads "Peru", not "PE". The `||` chain is the guard for the case
  // that is left: a code that is not a country at all, where both are "".
  const label = name || code || "this country";
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const matched = useMemo(() => filterPlaces(places, query), [places, query]);
  const groups = useMemo(() => groupPlacesByAdmin1(matched), [matched]);
  // A filter is a deliberate narrowing, so it expands everything it matched —
  // asking a user to expand a group they just searched into is a second step
  // for a decision they already made.
  const filtering = query.trim() !== "";

  return (
    <div className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--surf-1)]/50 p-5">
      <h4 className="font-display text-base font-bold">{label}</h4>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        {places.length > 0
          ? `Tap a place to add it, or filter to find one by name.`
          : `No map for ${label} yet — search above to add places, and they'll show up in your plan the same way.`}
      </p>

      {places.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={`Filter places in ${label}`}
          placeholder={`Filter ${places.length} places`}
          className="mt-3 min-h-[var(--tap-min)] w-full rounded-full border border-[var(--line-1)] bg-[var(--paper)] px-4 text-sm text-[var(--ink-1)] placeholder:text-[var(--ink-2)]"
        />
      )}

      {groups.map((group) => {
        const open = filtering || expanded.has(group.key);
        const shown = open ? group.places : group.places.slice(0, PLACES_PER_GROUP);
        const hidden = group.places.length - shown.length;
        const groupLabel = group.label ?? `Elsewhere in ${label}`;
        return (
          <section key={group.key} aria-label={groupLabel} role="group" className="mt-4">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-2)]">
              {groupLabel}
            </h5>
            <ul className="mt-2 flex flex-wrap gap-2">
              {shown.map((place) => {
                const isSelected = selected.includes(place.id);
                return (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => onTogglePlace(place)}
                      aria-pressed={isSelected}
                      className={`min-h-[var(--tap-min)] rounded-full border px-3.5 text-sm transition-colors ${
                        isSelected
                          ? "border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--paper)]"
                          : "border-[var(--line-1)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
                      }`}
                    >
                      {place.name}
                      {place.localName && (
                        <span className="ml-1.5 font-kai opacity-80">{place.localName}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => new Set(prev).add(group.key))}
                className="mt-2 min-h-[var(--tap-min)] text-xs font-semibold text-[var(--accent-ink)] underline"
              >
                {`Show all ${group.places.length} in ${groupLabel}`}
              </button>
            )}
          </section>
        );
      })}

      {places.length > 0 && groups.length === 0 && (
        <p className="mt-3 text-sm text-[var(--ink-2)]">
          {`No places in ${label} match "${query.trim()}".`}
        </p>
      )}
    </div>
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
