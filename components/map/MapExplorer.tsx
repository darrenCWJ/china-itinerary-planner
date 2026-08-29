"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Topology } from "topojson-specification";
import type { Airport } from "@/lib/airports";
import { getCountry } from "@/lib/countries";
import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { DESTINATIONS } from "@/lib/data";
import { haversineKm, latLonOf } from "@/lib/geo";
import { suggestRoute, type RoutePlace } from "@/lib/route";
import type { CatalogHit, MapCity } from "@/lib/tripShared";
import type { ChinaRegion } from "@/lib/types";
import { usePrefs } from "@/components/shell/PrefsProvider";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { CountryMap, CURATED_COUNTRY, hasCuratedTopology } from "./CountryMap";
import { MonthTimeline } from "./MonthTimeline";
import { PlacePopup } from "./PlacePopup";
import { FIT_COLORS, FIT_LABELS, type MapPlace } from "./mapTypes";
import {
  fetchCityEnrichment,
  fetchCityShard,
  shardRowToMapCity,
  type CityEnrichmentIndex,
  type CityShardRow,
} from "@/lib/cityShard";
import { curatedPlaceNames } from "@/lib/curatedNames";
import { foldPlaceName } from "@/lib/foldPlaceName";
import { regionForProvinceText } from "@/lib/provinces";

/**
 * The level coordinator (spec §6): world ⇄ country, sharing one shell, one
 * month timeline and one route panel between them.
 *
 * The world topology is 730KB, so `WorldMap` is a dynamic import as well as a
 * conditional render — the asset *and* the code that parses it stay off any
 * page where the picker is never opened. `GlobeLevel` carries the same asset
 * weight for its own 110m topology, so it is dynamic for the same reason.
 */
const WorldMap = dynamic(() => import("./WorldMap").then((m) => m.WorldMap), {
  ssr: false,
  loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-[var(--line-1)]/40" />,
});

const GlobeLevel = dynamic(() => import("./GlobeLevel").then((m) => m.GlobeLevel), {
  ssr: false,
  // Aspect ratio matches the globe's viewBox (860x620): the skeleton preserves
  // the globe's proportions so no visible resize occurs on swap-in. aria-busy
  // so a screen reader is told it is waiting, matching the skeleton inside
  // WorldMap itself.
  loading: () => (
    <div
      className="aspect-[860/620] w-full animate-pulse rounded-lg bg-[var(--line-1)]/40"
      aria-busy="true"
    />
  ),
});

/**
 * How near two places of the same name have to be before they are one place.
 *
 * 25 km, not the ingest's `DEDUP_RADIUS_KM = 5`. GeoNames puts a Chinese
 * prefecture-level city's point on the urban seat and Wikidata puts it on the
 * administrative centroid, and the gap between the two is what these rows are
 * made of: every duplicate measured lands between 5.0 km (Qinzhou, Dezhou) and
 * 18.7 km (Tacheng), so 5 km is exactly the gate they all cleared. 25 km still
 * leaves daylight above the widest of them and well below the nearest pair
 * that must survive — Longnan's two points, 42.9 km apart.
 */
const SAME_CITY_KM = 25;

/**
 * Shard rows that are a second marker for a city the catalog already answered.
 *
 * The sibling of `dropCatalogDuplicates` in `scripts/ingest-cities.mjs`, not a
 * reuse of it: that one is a Node build script reading the GeoNames dump's row
 * shape, it cannot be imported into a "use client" bundle, and it runs at a
 * different radius. A re-ingest would not help here anyway — it would leave the
 * client just as defenceless against the next catalog row that lands beside a
 * shard row already shipped.
 *
 * The two legs are concatenated below, and China is the one country where both
 * of them answer — so without this a duplicate draws twice: two
 * `<g role="button">` with the same `aria-label`, which a screen reader reads
 * out as two cities, and two ids that `togglePlace` resolves separately, so the
 * plan allocates days to Nantong twice with a ~5 km route leg between the
 * copies. Search offers one Nantong (Task 13); this is the same catalog's other
 * surface, and the two have to agree.
 *
 * Keyed on distance, not on the admin-1 string, because `MapCity` carries
 * coordinates on both sides and the strings disagree. Measured against
 * data/catalog.json and public/cities/CN.json with the real `foldPlaceName`
 * and `haversineKm`: of the 19 duplicate rows, 6 would slip through a
 * name-plus-admin-1 test because the catalog labels them by prefecture where
 * the shard labels them by province (Pizhou/Xuzhou, Xingning/Meizhou,
 * Laizhou/Yantai, Laohekou/Xiangyang, plus Yining and Tacheng in Xinjiang) —
 * and that test would also wrongly fold Liaoning's two Jinzhous, 229.5 km
 * apart under one province label. Name alone is worse again: 32 of the 51
 * shard rows sharing a folded name with a catalog city are genuinely different
 * places, the widest being the two Yushus at 2,852 km.
 *
 * The shard row is the one dropped. The catalog row carries the QID that
 * `resolveDestinations` sends down the Wikidata branch, plus its attraction
 * count and blurb; the GeoNames row carries none of that.
 */
function dropCatalogTwins(rows: CityShardRow[], catalog: MapCity[]): CityShardRow[] {
  const byFoldedName = new Map<string, MapCity[]>();
  for (const city of catalog) {
    const key = foldPlaceName(city.name);
    const found = byFoldedName.get(key);
    if (found) found.push(city);
    else byFoldedName.set(key, [city]);
  }
  return rows.filter((row) => {
    const twins = byFoldedName.get(foldPlaceName(row.n));
    return !twins?.some((twin) => haversineKm(twin, row) <= SAME_CITY_KM);
  });
}

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
  const [zoomRegion, setZoomRegion] = useState<ChinaRegion | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [cities, setCities] = useState<MapCity[]>([]);
  const [citiesUnavailable, setCitiesUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  /**
   * The country's airports, for the route estimator. Empty until they load,
   * and empty is exactly the "no airport data" path `estimateLeg` already
   * handles — so the panel renders correct-but-coarser estimates first and
   * sharpens when they arrive, rather than waiting.
   */
  const [airports, setAirports] = useState<Airport[]>([]);
  const [hover, setHover] = useState<{
    place: MapPlace;
    pos: { x: number; y: number };
  } | null>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  const { prefs, setPrefs } = usePrefs();
  const reducedMotion = useReducedMotion();
  /**
   * Reduced motion wins over an explicit globe preference.
   *
   * The globe's rotation is direct manipulation, which the guideline does not
   * forbid — but selecting a country spins it 650ms unprompted, which it does.
   * Rather than shipping a globe with the spin disabled, which is a worse globe
   * than the flat map is a map, the preference resolves to flat and the user
   * keeps a renderer that was designed to be still.
   */
  const WorldLevel = prefs.worldView === "flat" || reducedMotion ? WorldMap : GlobeLevel;

  const { code: countryCode, name: countryName } = getCountry(country);
  const countryLabel = countryName || countryCode || "this country";
  const hasCurated = hasCuratedTopology(country);

  /**
   * Everything the open country's map needs: China's province topology when
   * there is one, the Wikidata catalog's cities for that country, and the
   * GeoNames shard plus its enrichment.
   *
   * Keyed on `countryCode`, which it was not before. The old array was
   * `[retryKey, hasCurated]` — a boolean — so CN→JP→CN refired it but JP→DE did
   * not. That was harmless while /api/map/cities took no country; the moment it
   * does, a foreign-to-foreign switch would leave the previous country's cities
   * on the map.
   *
   * The shard is a static asset the browser fetches, not a second API leg:
   * `public/` is unreadable from a Vercel lambda (spec §3.2), and at 22 KB
   * gzipped for the largest country it needs no loading state of its own.
   *
   * Everything keyed to the country is cleared up front, not just on failure —
   * the same reason the airports effect below clears first. Between a country
   * switch and the new data landing, the previous country's cities are wrong
   * answers, not stale ones, and its "unavailable" notice is a claim about a
   * country the user has already left. `topology` is the one exception and
   * needs no clear: it is read only under `hasCuratedTopology(country)`, both here
   * and inside `CountryMap`, so China's geometry can never be drawn under
   * anywhere else.
   */
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    setCities([]);
    setCitiesUnavailable(false);
    // `hover` holds a `MapPlace` derived from the `cities` array just emptied,
    // so leaving it would keep a popup open over a place that no longer exists.
    setHover(null);
    Promise.all([
      // The province topology describes China and nothing else, so a country
      // with no detail level has nothing to draw it into.
      hasCurated
        ? fetch("/china-provinces.json", { signal: controller.signal }).then((r) => {
            if (!r.ok) throw new Error(`topology ${r.status}`);
            return r.json() as Promise<Topology>;
          })
        : Promise.resolve(null),
      fetch(`/api/map/cities?country=${encodeURIComponent(countryCode)}`, {
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`cities ${r.status}`);
          return r.json() as Promise<{ available: boolean; cities: MapCity[] }>;
        })
        .catch(() => ({ available: false, cities: [] as MapCity[] })),
      // 246 of ~250 codes have a shard; the rest 404. A country with none is a
      // country with no cities to offer, not an outage.
      fetchCityShard(countryCode, controller.signal).catch(() => null),
      fetchCityEnrichment(countryCode, controller.signal).catch(
        () => ({}) as CityEnrichmentIndex
      ),
    ])
      .then(([topo, catalogRes, shardRes, enrichment]) => {
        // Three of the four legs swallow their own rejection, so an abort
        // *resolves* this Promise.all rather than rejecting it — and the
        // `.catch` below, which is where the other aborted paths are filtered
        // out, never runs. Without this the previous country's effect writes
        // its answer over the new country's freshly cleared state one
        // microtask after the switch, and `citiesUnavailable` in particular
        // lands as an outage notice for a country whose request is still in
        // flight.
        if (controller.signal.aborted) return;
        setTopology(topo);
        // A GeoNames row for a place a curated card already covers is a second
        // marker for the same place. `dropCatalogDuplicates` in the ingest only
        // removes rows that duplicate a data/catalog.json QID city, and
        // Yangshuo — a curated destination — has no catalog.json row, so its
        // row survives and would draw beside "Guilin & Yangshuo".
        const suppressed = curatedPlaceNames(countryCode);
        const shardCities = dropCatalogTwins(
          (shardRes?.cities ?? []).filter((row) => !suppressed.has(foldPlaceName(row.n))),
          catalogRes.cities
        ).map((row) => shardRowToMapCity(row, enrichment));
        // China is the one country that gets both halves, and they are not
        // disjoint. Measured on the committed data: /api/map/cities answers CN
        // with 676 Wikidata cities, and of the shard's 413 rows 3 fold to a
        // curated name and 19 more are `dropCatalogTwins` duplicates, so 391
        // join them — 1,067 catalog markers rather than the 1,086 a plain
        // concatenation draws. The 391 are Chinese cities the QID catalog never
        // covered, and that coverage is the point of the phase.
        // The country list's per-province cap does not apply: China has a
        // detail level, so it renders ChinaLevel, not CountryPlaceList.
        setCities([...catalogRes.cities, ...shardCities]);
        // Unavailable only when BOTH sources failed. A country the Wikidata
        // catalog has never covered is the normal case for 245 of them, and
        // showing an outage notice for it would be a lie.
        setCitiesUnavailable(!catalogRes.available && shardRes === null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retryKey, hasCurated, countryCode]);

  useEffect(() => {
    const controller = new AbortController();
    // Cleared up front, not just on failure: without this, a country switch
    // computes the route estimator against the *previous* country's airports
    // until the new fetch resolves — for adjacent countries that interim can
    // resolve a wrong-country pair. Clearing first makes the interim the
    // legacy no-airports path instead, which `estimateLeg` already handles.
    setAirports([]);
    fetch(`/api/map/airports?country=${encodeURIComponent(countryCode)}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((json: { airports: Airport[] }) => setAirports(json.airports))
      // Airports only sharpen the estimate — losing them costs precision, not
      // function, so this failure is silent by design.
      .catch(() => {
        if (!controller.signal.aborted) setAirports([]);
      });
    return () => controller.abort();
  }, [countryCode]);

  const places = useMemo<MapPlace[]>(() => {
    const curated = DESTINATIONS.filter(
      // Every destination states its own country, so there is no default here
      // that a non-Chinese destination could fall through.
      (d) => !visited.includes(d.id) && d.country === countryCode
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
            localName: d.localName,
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
        localName: c.localName,
        province: c.province,
        // `regionForProvinceText` is a China-only keyword table and its
        // `?? "Central"` fallback is one of China's own seven — which
        // `isChinaRegion` then accepts, handing a Peruvian city a Chinese
        // month-fit rather than the neutral one that guard exists to give.
        // Outside China the admin-1 name IS the region label.
        region:
          countryCode === CURATED_COUNTRY
            ? (regionForProvinceText(`${c.province ?? ""} ${c.name}`) ?? "Central")
            : (c.province ?? ""),
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

  /**
   * The open country's own transport assumptions. Without this the estimator
   * falls back to its default profile, which is China's — so a Peruvian route
   * was scored at Chinese high-speed-rail speed and drawn with a 🚄.
   */
  const transport = useMemo(() => getCountryBaseProfile(countryCode).transport, [countryCode]);

  const { route, unresolvedCount } = useMemo(() => {
    const routePlaces: RoutePlace[] = [];
    let missing = 0;
    for (const id of selected) {
      const p = placeById.get(id);
      if (p) routePlaces.push({ id: p.id, name: p.name, lat: p.lat, lon: p.lon });
      else missing++;
    }
    return {
      route: routePlaces.length >= 2 ? suggestRoute(routePlaces, airports, transport) : null,
      unresolvedCount: missing,
    };
  }, [selected, placeById, airports, transport]);

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
      localName: city.localName,
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
              {/* Was "search above": review proved that false — PlaceSearch is
                  scoped to the country already chosen and cannot change it. The
                  control that can is the list beneath the map. */}
              Pick a country to plan in it — or use the list below the map, which
              reaches every country whether the map draws it as a shape or a dot.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onLevelChange("country")}
            className="inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--line-1)] px-3 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
          >
            ← Back to {countryLabel}
          </button>
        </div>
        <div className="mt-3">
          <WorldLevel selectedCountry={countryCode} onSelectCountry={pickCountry} />
        </div>
        {/*
          Hidden under reduced motion: `WorldLevel` above has already resolved
          to the flat map in that case, and offering a globe the same render
          then refuses to show would be worse than not offering it.
        */}
        {!reducedMotion && (
          <button
            type="button"
            onClick={() =>
              setPrefs({ ...prefs, worldView: prefs.worldView === "flat" ? "globe" : "flat" })
            }
            className="mt-3 min-h-[var(--tap-min)] rounded-lg border px-3 text-sm"
            style={{ borderColor: "var(--line-1)", color: "var(--accent-ink)" }}
          >
            {prefs.worldView === "flat" ? "Show the globe" : "Show a flat map"}
          </button>
        )}
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
          className="mt-3 inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--accent-ink)] px-4 text-sm font-medium text-[var(--accent-ink)] hover:bg-[var(--line-1)]/50"
        >
          Try again
        </button>
      </div>
    );
  }

  // Only the detail level waits on an asset; the fallback has nothing to load.
  if (hasCurated && !topology) {
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
          {!hasCurated ? (
            <h3 className="font-display text-lg font-bold">{countryLabel}</h3>
          ) : zoomRegion ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setZoomRegion(null);
                  setHover(null);
                }}
                className="inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--line-1)] px-3 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
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
        {hasCurated && (
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
          The city list is unavailable right now — showing curated destinations
          only. Search still reaches every place.
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
            country={countryCode}
            position={hover.pos}
            containerWidth={mapWrapRef.current?.clientWidth ?? 640}
          />
        )}
      </div>

      {hasCurated && (
        <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
          {zoomRegion
            ? "Click any marker to add it to your trip"
            : "Markers show curated picks — zoom into a region for every city"}
        </p>
      )}

      <div className="mt-4 border-t border-dashed border-[var(--line-1)] pt-4">
        <MonthTimeline month={month} onMonth={handleMonth} country={countryCode} />
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
              className="rounded-lg bg-[var(--accent-ink)] px-3 py-1 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
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
                      // `leg.km` is city-to-city (lib/route.ts), never the
                      // airport pair's distance — the two can differ by ~300
                      // km, so the airport codes are labeled as the flight
                      // and the km called out as city-to-city rather than
                      // left to read as if they measured the same hop.
                      title={
                        leg.airports
                          ? `Flying ${leg.airports.from.iata} → ${leg.airports.to.iata} · ${leg.km.toLocaleString()} km city-to-city · ~${leg.hours}h`
                          : `${leg.km.toLocaleString()} km · ~${leg.hours}h`
                      }
                    >
                      {leg.mode === "flight" ? "✈️" : "🚄"}
                      <span className="ml-0.5 font-mono text-[10px]">{leg.hours}h</span>
                    </span>
                  )}
                  {/*
                    A country whose profile withholds a rail speed has no rail
                    leg to draw, so this one has a distance and no duration.
                    Shown as km without an hours figure: the glyph branch above
                    is binary — rail or flight — and neither is true here.
                  */}
                  {leg?.kind === "overland" && (
                    <span
                      className="mx-0.5 text-xs text-[var(--ink-2)]"
                      title={`${leg.km.toLocaleString()} km overland · no travel-time estimate for ${countryLabel}`}
                    >
                      · {leg.km.toLocaleString()} km overland
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
