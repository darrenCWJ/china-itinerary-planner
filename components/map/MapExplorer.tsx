"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Topology } from "topojson-specification";
import { DESTINATIONS } from "@/lib/data";
import { suggestRoute, type RoutePlace } from "@/lib/route";
import type { CatalogHit, MapCity } from "@/lib/tripShared";
import type { Region } from "@/lib/types";
import { ChinaMap } from "./ChinaMap";
import { MonthTimeline } from "./MonthTimeline";
import { PlacePopup } from "./PlacePopup";
import { FIT_COLORS, FIT_LABELS, type MapPlace } from "./mapTypes";
import { regionForProvinceText } from "@/lib/provinces";

interface Props {
  selected: string[];
  visited: string[];
  onToggleSelect: (id: string) => void;
  onAddCatalog: (hit: CatalogHit) => void;
  onRemoveCatalog: (qid: string) => void;
  onReorder: (ids: string[]) => void;
  onMonthPicked?: (month: number) => void;
}

const DEFAULT_MONTH = 10;

export function MapExplorer({
  selected,
  visited,
  onToggleSelect,
  onAddCatalog,
  onRemoveCatalog,
  onReorder,
  onMonthPicked,
}: Props) {
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [zoomRegion, setZoomRegion] = useState<Region | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [cities, setCities] = useState<MapCity[]>([]);
  const [citiesUnavailable, setCitiesUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [hover, setHover] = useState<{
    place: MapPlace;
    pos: { x: number; y: number };
  } | null>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    Promise.all([
      fetch("/china-provinces.json", { signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error(`topology ${r.status}`);
        return r.json() as Promise<Topology>;
      }),
      fetch("/api/map/cities", { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`cities ${r.status}`);
          return r.json() as Promise<{ available: boolean; cities: MapCity[] }>;
        })
        .catch(() => ({ available: false, cities: [] as MapCity[] })),
    ])
      .then(([topo, cityRes]) => {
        setTopology(topo);
        setCities(cityRes.cities);
        setCitiesUnavailable(!cityRes.available);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retryKey]);

  const places = useMemo<MapPlace[]>(() => {
    const curated = DESTINATIONS.filter((d) => !visited.includes(d.id)).map(
      (d): MapPlace => ({
        id: d.id,
        kind: "curated",
        name: d.name,
        chineseName: d.chineseName,
        province: null,
        region: d.region,
        lat: d.lat,
        lon: d.lon,
        population: null,
        level: "curated",
        attractionCount: d.activities.length,
        blurb: d.tagline,
        emoji: d.emoji,
        bestSeasons: d.bestSeasons,
        seasonNotes: d.seasonNotes,
      })
    );
    const catalog = cities.map(
      (c): MapPlace => ({
        id: c.qid,
        kind: "catalog",
        name: c.name,
        chineseName: c.chineseName,
        province: c.province,
        region: regionForProvinceText(`${c.province ?? ""} ${c.name}`) ?? "Central",
        lat: c.lat,
        lon: c.lon,
        population: c.population,
        level: c.level,
        attractionCount: c.attractionCount,
        blurb: c.blurb,
      })
    );
    return [...curated, ...catalog];
  }, [cities, visited]);

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const { route, unresolvedCount } = useMemo(() => {
    const routePlaces: RoutePlace[] = [];
    let missing = 0;
    for (const id of selected) {
      const p = placeById.get(id);
      if (p) routePlaces.push({ id: p.id, name: p.name, lat: p.lat, lon: p.lon });
      else missing++;
    }
    return {
      route: routePlaces.length >= 2 ? suggestRoute(routePlaces) : null,
      unresolvedCount: missing,
    };
  }, [selected, placeById]);

  const togglePlace = (place: MapPlace) => {
    setHover(null);
    if (place.kind === "curated") {
      onToggleSelect(place.id);
      return;
    }
    if (selected.includes(place.id)) {
      onRemoveCatalog(place.id);
      return;
    }
    const city = cities.find((c) => c.qid === place.id);
    if (!city) return;
    onAddCatalog({
      qid: city.qid,
      name: city.name,
      chineseName: city.chineseName,
      province: city.province,
      description: city.blurb,
      population: city.population,
      attractionCount: city.attractionCount,
    });
  };

  const applyRouteOrder = () => {
    if (!route) return;
    const ordered = route.order.map((p) => p.id);
    const rest = selected.filter((id) => !ordered.includes(id));
    onReorder([...ordered, ...rest]);
  };

  const handleMonth = (m: number) => {
    setMonth(m);
    onMonthPicked?.(m);
  };

  if (loadError) {
    return (
      <div className="mt-5 rounded-xl border border-sky bg-paper p-6 text-center">
        <p className="text-sm text-ink-soft">Couldn&apos;t load the map data.</p>
        <button
          type="button"
          onClick={() => setRetryKey((k) => k + 1)}
          className="mt-3 rounded-lg border border-rail px-4 py-1.5 text-sm font-medium text-rail hover:bg-sky/50"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!topology) {
    return (
      <div className="mt-5 animate-pulse rounded-xl border border-sky bg-mist p-6">
        <div className="h-[420px] rounded-lg bg-sky/40" />
        <p className="mt-3 text-center text-sm text-ink-soft">Unfolding the map…</p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-sky bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {zoomRegion ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setZoomRegion(null);
                  setHover(null);
                }}
                className="rounded-lg border border-sky px-3 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-rail hover:text-rail"
              >
                ← All China
              </button>
              <h3 className="font-display text-lg font-bold">{zoomRegion} China</h3>
            </>
          ) : (
            <h3 className="font-display text-lg font-bold">
              Click a region to zoom in
            </h3>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Map legend">
          {(Object.keys(FIT_COLORS) as (keyof typeof FIT_COLORS)[]).map((fit) => (
            <span key={fit} className="flex items-center gap-1 text-[11px] text-ink-soft">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: FIT_COLORS[fit] }}
              />
              {FIT_LABELS[fit]}
            </span>
          ))}
        </div>
      </div>

      {citiesUnavailable && (
        <p className="mt-2 rounded-lg bg-mist px-3 py-2 text-xs text-ink-soft">
          The all-China catalog is unavailable right now — showing curated
          destinations only.
        </p>
      )}

      <div ref={mapWrapRef} className="relative mt-3">
        <ChinaMap
          topology={topology}
          places={places}
          selected={selected}
          month={month}
          zoomRegion={zoomRegion}
          routeIds={route?.order.map((p) => p.id) ?? []}
          onZoomRegion={(r) => {
            setZoomRegion(r);
            setHover(null);
          }}
          onTogglePlace={togglePlace}
          onHoverPlace={(place, pos) =>
            setHover(place && pos ? { place, pos } : null)
          }
        />
        {hover && (
          <PlacePopup
            place={hover.place}
            month={month}
            position={hover.pos}
            containerWidth={mapWrapRef.current?.clientWidth ?? 640}
          />
        )}
      </div>

      <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-ink-soft">
        {zoomRegion
          ? "Click any marker to add it to your trip"
          : "Markers show curated picks — zoom into a region for every city"}
      </p>

      <div className="mt-4 border-t border-dashed border-sky pt-4">
        <MonthTimeline month={month} onMonth={handleMonth} />
      </div>

      {route && (
        <div className="mt-4 rounded-lg border border-sky bg-mist/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold">
              Suggested route · {route.totalKm.toLocaleString()} km
            </h4>
            <button
              type="button"
              onClick={applyRouteOrder}
              className="rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-rail-deep"
            >
              Apply this order
            </button>
          </div>
          <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
            {route.order.map((p, i) => (
              <li key={p.id} className="flex items-center gap-1">
                {i > 0 && (
                  <span
                    className="mx-0.5 text-xs text-ink-soft"
                    title={`${route.legs[i - 1].km.toLocaleString()} km · ~${route.legs[i - 1].hours}h`}
                  >
                    {route.legs[i - 1].mode === "flight" ? "✈️" : "🚄"}
                    <span className="ml-0.5 font-mono text-[10px]">
                      {route.legs[i - 1].hours}h
                    </span>
                  </span>
                )}
                <span className="rounded-full bg-paper px-2.5 py-0.5 font-medium">
                  {i + 1}. {p.name}
                </span>
              </li>
            ))}
          </ol>
          {route.notes.map((note) => (
            <p key={note} className="mt-2 text-xs text-ink-soft">
              {note}
            </p>
          ))}
          {unresolvedCount > 0 && (
            <p className="mt-2 text-xs text-ink-soft">
              {unresolvedCount} selected place{unresolvedCount > 1 ? "s" : ""}{" "}
              couldn&apos;t be placed on the map and stay at the end of the order.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
