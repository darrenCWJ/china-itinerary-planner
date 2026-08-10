"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { provinceByAdcode, REGION_META } from "@/lib/provinces";
import type { Region } from "@/lib/types";
import {
  FIT_COLORS,
  FIT_FILL_OPACITY,
  fitForPlace,
  fitForRegion,
  type MapPlace,
} from "./mapTypes";

const VIEW_W = 860;
const VIEW_H = 620;
const ZOOM_MS = 650;

interface ProvinceProps {
  adcode: number;
  name: string;
}

type ProvinceFeature = GeoJSON.Feature<GeoJSON.Geometry, ProvinceProps>;

interface Props {
  topology: Topology;
  places: MapPlace[];
  selected: string[];
  month: number;
  zoomRegion: Region | null;
  routeIds: string[];
  onZoomRegion: (region: Region | null) => void;
  onTogglePlace: (place: MapPlace) => void;
  onHoverPlace: (place: MapPlace | null, pos: { x: number; y: number } | null) => void;
}

export function ChinaMap({
  topology,
  places,
  selected,
  month,
  zoomRegion,
  routeIds,
  onZoomRegion,
  onTogglePlace,
  onHoverPlace,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Markers hide during the zoom transition and fade back in at the target
  // scale, so they never render mid-transition at the wrong size.
  const [markersVisible, setMarkersVisible] = useState(true);

  const { provinces, ninedash, projection, pathGen } = useMemo(() => {
    const objectName = Object.keys(topology.objects)[0];
    const collection = feature(
      topology,
      topology.objects[objectName] as GeometryCollection<ProvinceProps>
    );
    const all = collection.features as ProvinceFeature[];
    const provinceFeatures = all.filter((f) => provinceByAdcode(f.properties.adcode));
    const ninedashFeature = all.find((f) => !provinceByAdcode(f.properties.adcode)) ?? null;
    const proj = geoMercator().fitExtent(
      [
        [10, 10],
        [VIEW_W - 10, VIEW_H - 10],
      ],
      { type: "FeatureCollection", features: provinceFeatures }
    );
    return {
      provinces: provinceFeatures,
      ninedash: ninedashFeature,
      projection: proj,
      pathGen: geoPath(proj),
    };
  }, [topology]);

  // Zoom transform for the active region (identity at country level).
  const transform = useMemo(() => {
    if (!zoomRegion) return { k: 1, tx: 0, ty: 0 };
    const regionFeatures = provinces.filter(
      (f) => provinceByAdcode(f.properties.adcode)?.region === zoomRegion
    );
    const bounds = pathGen.bounds({
      type: "FeatureCollection",
      features: regionFeatures,
    });
    const [[x0, y0], [x1, y1]] = bounds;
    const k = Math.min(
      5,
      0.88 * Math.min(VIEW_W / (x1 - x0), VIEW_H / (y1 - y0))
    );
    return {
      k,
      tx: VIEW_W / 2 - (k * (x0 + x1)) / 2,
      ty: VIEW_H / 2 - (k * (y0 + y1)) / 2,
    };
  }, [zoomRegion, provinces, pathGen]);

  useEffect(() => {
    setMarkersVisible(false);
    const id = setTimeout(() => setMarkersVisible(true), ZOOM_MS);
    return () => clearTimeout(id);
  }, [zoomRegion]);

  const { k, tx, ty } = transform;

  const visiblePlaces = useMemo(() => {
    if (!zoomRegion) return places.filter((p) => p.kind === "curated");
    return places.filter((p) => p.region === zoomRegion);
  }, [places, zoomRegion]);

  const project = (lon: number, lat: number): [number, number] =>
    projection([lon, lat]) ?? [0, 0];

  const routePoints = useMemo(
    () =>
      routeIds
        .map((id) => places.find((p) => p.id === id))
        .filter((p): p is MapPlace => Boolean(p))
        .map((p) => project(p.lon, p.lat)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeIds, places, projection]
  );

  const reportHover = (place: MapPlace | null, evt?: React.MouseEvent) => {
    if (!place || !evt) {
      onHoverPlace(null, null);
      return;
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onHoverPlace(place, { x: evt.clientX - rect.left, y: evt.clientY - rect.top });
  };

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
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full select-none"
        role="img"
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
                stroke={dimmed ? "#d9e7f4" : "#ffffff"}
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
              stroke="#c93b2e"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          )}

          {/* Region labels at country level */}
          {!zoomRegion &&
            (Object.keys(REGION_META) as Region[]).map((region) => {
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
                  fill="#4a5b72"
                  opacity={0.85}
                >
                  {REGION_META[region].label}
                </text>
              );
            })}

          {/* Suggested route */}
          {routePoints.length >= 2 && (
            <polyline
              points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="#1d5c9e"
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
                      stroke="#c93b2e"
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
                    stroke="#ffffff"
                    strokeWidth={1.2 / k}
                  />
                  {isSelected && stopIndex >= 0 && (
                    <text
                      x={x}
                      y={y + (r > 5 / k ? 3.2 / k : 2.8 / k)}
                      textAnchor="middle"
                      fontSize={Math.max(8 / k, r * 1.1)}
                      fontWeight={700}
                      fill="#ffffff"
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
                      fill="#17263b"
                      stroke="#ffffff"
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
