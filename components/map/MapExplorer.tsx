"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Topology } from "topojson-specification";
import { getCountry } from "@/lib/countries";
import { DESTINATIONS } from "@/lib/data";
import { latLonOf } from "@/lib/geo";
import { suggestRoute, type RoutePlace } from "@/lib/route";
import type { CatalogHit, MapCity } from "@/lib/tripShared";
import type { Region } from "@/lib/types";
import { CountryMap, hasDetailLevel } from "./CountryMap";
import { MonthTimeline } from "./MonthTimeline";
import { PlacePopup } from "./PlacePopup";
import { FIT_COLORS, FIT_LABELS, type MapPlace } from "./mapTypes";
import { regionForProvinceText } from "@/lib/provinces";

/**
 * The level coordinator (spec §6): world ⇄ country, sharing one shell, one
 * month timeline and one route panel between them.
 *
 * The world topology is 730KB, so `WorldMap` is a dynamic import as well as a
 * conditional render — the asset *and* the code that parses it stay off any
 * page where the picker is never opened.
 */
const WorldMap = dynamic(() => import("./WorldMap").then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-[var(--line-1)]/40" />,
});

export type MapLevel = "world" | "country";

interface Props {
  selected: string[];
  visited: string[];
  /** ISO alpha-2 being planned. Only China has a detail level today. */
  country: string;
  level: MapLevel;
  onCountryChange: (code: string) => void;
  onLevelChange: (level: MapLevel) => void;
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
  country,
  level,
  onCountryChange,
  onLevelChange,
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

  const { code: countryCode, name: countryName } = getCountry(country);
  const countryLabel = countryName || countryCode || "this country";
  const hasDetail = hasDetailLevel(country);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    Promise.all([
      // Both assets describe China: the province topology and the Chinese city
      // catalog. A country with no detail level has nothing to draw them into,
      // so neither is requested for it.
      hasDetail
        ? fetch("/china-provinces.json", { signal: controller.signal }).then((r) => {
            if (!r.ok) throw new Error(`topology ${r.status}`);
            return r.json() as Promise<Topology>;
          })
        : Promise.resolve(null),
      hasDetail
        ? fetch("/api/map/cities", { signal: controller.signal })
            .then((r) => {
              if (!r.ok) throw new Error(`cities ${r.status}`);
              return r.json() as Promise<{ available: boolean; cities: MapCity[] }>;
            })
            .catch(() => ({ available: false, cities: [] as MapCity[] }))
        // `available: true` for a country never asked about: the "catalog is
        // down" notice would otherwise appear for a request nobody made.
        : Promise.resolve({ available: true, cities: [] as MapCity[] }),
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
  }, [retryKey, hasDetail]);

  const places = useMemo<MapPlace[]>(() => {
    const curated = DESTINATIONS.filter(
      // Curated data carries no country until PR4's pivot, so an absent one
      // means China — the country every existing destination is in.
      (d) => !visited.includes(d.id) && (d.country ?? "CN") === countryCode
    ).flatMap(
      (d): MapPlace[] => {
        // A place with no coordinates cannot be drawn on a map or routed
        // through, so it is dropped here rather than given a fake pin. Every
        // curated destination has real coordinates, so nothing is lost today.
        const at = latLonOf(d);
        if (!at) return [];
        return [
          {
            id: d.id,
            kind: "curated",
            name: d.name,
            localName: d.localName ?? d.chineseName,
            province: null,
            region: d.region,
            lat: at.lat,
            lon: at.lon,
            population: null,
            level: "curated",
            attractionCount: d.activities.length,
            blurb: d.tagline,
            emoji: d.emoji,
            bestSeasons: d.bestSeasons,
            seasonNotes: d.seasonNotes,
          },
        ];
      }
    );
    const catalog = cities.map(
      (c): MapPlace => ({
        id: c.qid,
        kind: "catalog",
        name: c.name,
        // The catalog payload still carries `chineseName` — that is a server
        // contract, unchanged here. Only the client-side MapPlace is renamed.
        localName: c.chineseName,
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
  }, [cities, visited, countryCode]);

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

  const pickCountry = (code: string) => {
    onCountryChange(code);
    // A region and a hover belong to the country they were taken in, so both
    // are dropped on the way down into a new one.
    setZoomRegion(null);
    setHover(null);
    onLevelChange("country");
  };

  // Returned before the China fetches are consulted: the world level draws from
  // its own asset, so a failed province topology must not blank it out.
  if (level === "world") {
    return (
      <div className="mt-5 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-bold">Where in the world?</h3>
            <p className="mt-0.5 text-xs text-[var(--ink-2)]">
              Pick a country to plan in it — or search above, which reaches every
              country whether the map draws it or not.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onLevelChange("country")}
            className="rounded-lg border border-[var(--line-1)] px-3 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
          >
            ← Back to {countryLabel}
          </button>
        </div>
        <div className="mt-3">
          <WorldMap selectedCountry={countryCode} onSelectCountry={pickCountry} />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-5 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-6 text-center">
        <p className="text-sm text-[var(--ink-2)]">Couldn&apos;t load the map data.</p>
        <button
          type="button"
          onClick={() => setRetryKey((k) => k + 1)}
          className="mt-3 rounded-lg border border-[var(--accent-ink)] px-4 py-1.5 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--line-1)]/50"
        >
          Try again
        </button>
      </div>
    );
  }

  // Only the detail level waits on an asset; the fallback has nothing to load.
  if (hasDetail && !topology) {
    return (
      <div className="mt-5 animate-pulse rounded-xl border border-[var(--line-1)] bg-[var(--surf-1)] p-6">
        <div className="h-[420px] rounded-lg bg-[var(--line-1)]/40" />
        <p className="mt-3 text-center text-sm text-[var(--ink-2)]">Unfolding the map…</p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {!hasDetail ? (
            <h3 className="font-display text-lg font-bold">{countryLabel}</h3>
          ) : zoomRegion ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setZoomRegion(null);
                  setHover(null);
                }}
                className="rounded-lg border border-[var(--line-1)] px-3 py-1 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
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
        {/* The legend reads the marker colours, so it appears only where there
            are markers to read. */}
        {hasDetail && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Map legend">
            {(Object.keys(FIT_COLORS) as (keyof typeof FIT_COLORS)[]).map((fit) => (
              <span key={fit} className="flex items-center gap-1 text-[11px] text-[var(--ink-2)]">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: FIT_COLORS[fit] }}
                />
                {FIT_LABELS[fit]}
              </span>
            ))}
          </div>
        )}
      </div>

      {citiesUnavailable && (
        <p className="mt-2 rounded-lg bg-[var(--surf-1)] px-3 py-2 text-xs text-[var(--ink-2)]">
          The all-China catalog is unavailable right now — showing curated
          destinations only.
        </p>
      )}

      <div ref={mapWrapRef} className="relative mt-3">
        <CountryMap
          country={country}
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

      {hasDetail && (
        <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
          {zoomRegion
            ? "Click any marker to add it to your trip"
            : "Markers show curated picks — zoom into a region for every city"}
        </p>
      )}

      <div className="mt-4 border-t border-dashed border-[var(--line-1)] pt-4">
        <MonthTimeline month={month} onMonth={handleMonth} />
      </div>

      {route && (
        <div className="mt-4 rounded-lg border border-[var(--line-1)] bg-[var(--surf-1)]/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold">
              Suggested route · {route.totalKm.toLocaleString()} km
            </h4>
            <button
              type="button"
              onClick={applyRouteOrder}
              className="rounded-lg bg-[var(--accent-ink)] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
            >
              Apply this order
            </button>
          </div>
          <ol className="mt-2 flex flex-wrap items-center gap-1 text-sm">
            {route.order.map((p, i) => {
              const leg = i > 0 ? route.legs[i - 1] : null;
              return (
                <li key={p.id} className="flex items-center gap-1">
                  {leg?.kind === "estimated" && (
                    <span
                      className="mx-0.5 text-xs text-[var(--ink-2)]"
                      title={`${leg.km.toLocaleString()} km · ~${leg.hours}h`}
                    >
                      {leg.mode === "flight" ? "✈️" : "🚄"}
                      <span className="ml-0.5 font-mono text-[10px]">{leg.hours}h</span>
                    </span>
                  )}
                  {/*
                    A leg into a hand-typed place has no distance or duration
                    (spec §5.6). Rendered as an untimed transfer rather than a
                    fabricated estimate — inventing "0 km · ~0.5h" for a place
                    with no location would be a guess dressed as data.
                  */}
                  {leg?.kind === "unknown" && (
                    <span className="mx-0.5 text-xs text-[var(--ink-2)]" title="No location set for this place">
                      · transfer
                    </span>
                  )}
                  <span className="rounded-full bg-[var(--paper)] px-2.5 py-0.5 font-medium">
                    {i + 1}. {p.name}
                  </span>
                </li>
              );
            })}
          </ol>
          {route.notes.map((note) => (
            <p key={note} className="mt-2 text-xs text-[var(--ink-2)]">
              {note}
            </p>
          ))}
          {unresolvedCount > 0 && (
            <p className="mt-2 text-xs text-[var(--ink-2)]">
              {unresolvedCount} selected place{unresolvedCount > 1 ? "s" : ""}{" "}
              couldn&apos;t be placed on the map and stay at the end of the order.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
