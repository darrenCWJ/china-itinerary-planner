"use client";

import { useEffect, useState } from "react";
import type { Airport } from "@/lib/airports";
import {
  fetchCityEnrichment,
  fetchCityShard,
  type CityEnrichmentIndex,
} from "@/lib/cityShard";
import { fetchClimateShard } from "@/lib/climateShard";
import {
  PROJECTION_PATH,
  parseProjectionManifest,
  type ProjectionEntry,
} from "@/lib/countryProjection";
import { fetchProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import type { MapCity } from "@/lib/tripShared";
import { buildClimateIndex, NO_CLIMATE } from "./climateIndex";
import { mergeCountryCities } from "./explorerPlaces";
import { CLIMATE_COUNTRY, type DerivedClimateIndex } from "./mapTypes";

/** Everything one country's map is drawn from, plus the way to ask again. */
export interface CountryAssets {
  provinces: ProvinceFile | null;
  projection: ProjectionEntry | null;
  cities: MapCity[];
  citiesUnavailable: boolean;
  airports: Airport[];
  climate: DerivedClimateIndex;
  loadError: boolean;
  retry: () => void;
}

/**
 * The open country's assets, fetched and cleared as the country changes.
 *
 * A hook rather than lines in `MapExplorer` because none of it is about
 * levels, chrome or selection: it is two effects, eight pieces of state and
 * one retry, and the component that reads them only ever reads them. What is
 * NOT here is `showAirports` — that is UI state, a question about the map
 * currently open rather than an asset, and it stays with the toggle that
 * writes it.
 */
export function useCountryAssets(
  countryCode: string,
  hasDetail: boolean,
  /**
   * Whether to fetch at all. `MapExplorer` passes its `openedCountry` latch:
   * false on the world level until a country has been shown, true from then
   * on and never back. While false both effects do nothing — no request, no
   * state change — so a visitor looking at the globe pays for the globe alone.
   * Measured 2026-09-07 before this existed: the default country's six
   * requests (provinces 23.1 KB, manifest 6.9, catalog cities 38.7, shard
   * 12.6, enrichment 3.9, airports 9.5 — 94.7 KB gzipped) went out on every
   * mount, alongside the globe's own 40 KB topology, for a visitor who may
   * never open China.
   * A one-way latch rather than `level !== "world"` so that going back to
   * the globe and returning re-runs nothing.
   */
  enabled: boolean
): CountryAssets {
  /**
   * The open country's own admin-1 geometry, or null when it has none yet.
   *
   * **Nothing renders it yet**, deliberately, and for the reason
   * `lib/provinceTopology.ts` and `lib/countryDetail.ts` each gave one commit
   * earlier: PR4's country level is the reader, and it lands next. What arrives
   * first is the half that can go wrong on its own — which file is asked for,
   * how often, what happens to the one already in flight, and what the pane
   * does when it never comes. None of that is a rendering question, and all of
   * it is covered by `MapExplorer.provinces.test.tsx`'s "the open country's
   * province file".
   *
   * Null and not `undefined`: there is no pending state to distinguish here,
   * because nothing in this component waits on it. A country whose geometry has
   * not landed renders exactly as a country whose geometry failed — the list,
   * which is the accessibility spine and is never gated on a map (§5.2).
   */
  const [provinces, setProvinces] = useState<ProvinceFile | null>(null);
  /**
   * The open country's §5.4 framing, or null when the manifest has none for it.
   *
   * Fetched in the same `Promise.all` as the geometry rather than once on
   * mount, so the two land in the same render. Split across two effects, the
   * level would draw its fallback fit first and re-frame when the manifest
   * arrived — a visible jump, and for the nine trimmed countries a frame that
   * briefly shows the island the trim exists to leave out.
   *
   * The whole 20 KB manifest is re-fetched per country rather than cached in a
   * ref: `next.config.ts` serves it immutable, so the second request is a
   * memory-cache hit, and a cache here would need a test-only reset hook —
   * `lib/provinceTopology.ts` and `lib/cityShard.ts` both make the same call.
   */
  const [projection, setProjection] = useState<ProjectionEntry | null>(null);
  const [cities, setCities] = useState<MapCity[]>([]);
  const [citiesUnavailable, setCitiesUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  /**
   * The country's airports — for the route estimator, and since PR8 for the
   * card's "Main airport" line and §10.1's layer too. Empty until they load,
   * and empty is exactly the "no airport data" path `estimateLeg` already
   * handles — so the panel renders correct-but-coarser estimates first and
   * sharpens when they arrive, rather than waiting.
   *
   * ONE country's rows, which is the scope of every answer downstream: a
   * border city's true main airport can be across the border and simply absent
   * here. `mainAirportFor` in lib/mainAirport.ts carries that record and the
   * worked case (Basel gets ZRH at 74 km; its real airport is BSL at 6 km, in
   * France), because the limit belongs to this fetch rather than to the line of
   * text it ends up as — and the fix, when someone wants it, is a wider fetch
   * on this line rather than a change there.
   */
  const [airports, setAirports] = useState<Airport[]>([]);
  /**
   * The open country's derived climate (§9.4): every shard row joined to its
   * city's elevation, keyed by `MapPlace.id`. What colours the markers
   * outside China, what the hover card and the selected-place card read
   * their `lo°–hi°C typical` line from, and what the honesty note under the
   * map is about.
   *
   * Built once per country load, in the effect below, from two of the legs
   * it already runs — the climate shard and the city shard's `elev` — and
   * never at render: `mapTypes.ts`'s rule is that the fit resolution stays
   * synchronous over rows already in hand. `NO_CLIMATE` rather than a fresh
   * `Map` so "nothing yet" is one referentially stable value.
   */
  const [climate, setClimate] = useState<DerivedClimateIndex>(NO_CLIMATE);

  /**
   * Everything the open country's map needs: its admin-1 geometry — China's
   * curated asset, or the build's per-country file for everyone else — the
   * frame that geometry is drawn in, the Wikidata catalog's cities for that
   * country, the GeoNames shard plus its enrichment, and, for every country
   * but China, its climate normals (§9.4).
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
   * country the user has already left.
   *
   * `provinces` is cleared with the rest. It carries
   * no country guard of its own — every country has one of these files — so
   * Peru's departments left in place across a switch would draw as Germany's
   * states, which is not a stale answer but a wrong one, and one that looks
   * exactly like a working map.
   *
   * Neither effect runs at all while `enabled` is false — see the parameter —
   * so the initial empties are what the world level renders against.
   */
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoadError(false);
    setCities([]);
    setCitiesUnavailable(false);
    setProvinces(null);
    setProjection(null);
    // Peru's rows left in place across a switch would colour Germany's cities.
    setClimate(NO_CLIMATE);
    Promise.all([
      // All 246, China included. Gated on the registry rather than tried-and-caught,
      // because `provincePath` is well-formed for AQ, BV, HM and XD too and
      // the build wrote no file for any of them: without this, every map open
      // in one of those four spends a request on a guaranteed 404.
      //
      // Swallows its own rejection (§5.2): a country whose geometry is missing
      // still lists every one of its cities, so routing that failure to
      // `loadError` would replace a working list with a retry button.
      hasDetail
        ? fetchProvinceTopology(countryCode, controller.signal).catch(() => null)
        : Promise.resolve(null),
      // The frame the geometry above is drawn in (§5.4). Swallows its own
      // rejection for the same reason the leg above it does, and degrades
      // further than that one: a country with no entry still gets a map, fitted
      // to its own units, because the manifest and the code deploy
      // independently and a country whose entry has not been built yet must not
      // lose its map over it.
      hasDetail
        ? fetch(PROJECTION_PATH, { signal: controller.signal })
            .then((r) => {
              if (!r.ok) throw new Error(`projections ${r.status}`);
              return r.json() as Promise<unknown>;
            })
            .then(parseProjectionManifest)
            .catch(() => null)
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
      // The open country's climate normals (§9.4), for every country but the
      // one whose month table is hand-authored: `fitForPlace` never reads a
      // derived row for a Chinese place (§9.5), so CN.json's 412 rows would be
      // 24 KB gzipped (78 KB raw) per open that nothing consults.
      // `fetchClimateShard` takes a fetch rather than a signal — lib/rates.ts's
      // pattern — so the abort is
      // wrapped in. Swallows its own rejection like the shard leg above it: a
      // country with no climate file draws grey pins, which is the absence of
      // a claim and not an outage.
      countryCode === CLIMATE_COUNTRY
        ? Promise.resolve(null)
        : fetchClimateShard(countryCode, (input, init) =>
            fetch(input, { ...init, signal: controller.signal })
          ).catch(() => null),
    ])
      .then(([provinceFile, manifest, catalogRes, shardRes, enrichment, climateRes]) => {
        // All six legs swallow their own rejection, so an abort
        // *resolves* this Promise.all rather than rejecting it — and the
        // `.catch` below, which is where the other aborted paths are filtered
        // out, never runs. Without this the previous country's effect writes
        // its answer over the new country's freshly cleared state one
        // microtask after the switch, and `citiesUnavailable` in particular
        // lands as an outage notice for a country whose request is still in
        // flight.
        if (controller.signal.aborted) return;
        setProvinces(provinceFile);
        setProjection(manifest?.get(countryCode) ?? null);
        // The 391 shard rows China keeps are Chinese cities the QID catalog
        // never covered, and that coverage is the point of the phase. The
        // place list's per-province cap does not apply: China renders
        // ChinaLevel and its curated markers, not CountryLevel and its list.
        setCities(
          mergeCountryCities(countryCode, catalogRes.cities, shardRes?.cities ?? [], enrichment)
        );
        // Unavailable only when BOTH sources failed. A country the Wikidata
        // catalog has never covered is the normal case for 245 of them, and
        // showing an outage notice for it would be a lie.
        setCitiesUnavailable(!catalogRes.available && shardRes === null);
        // Joined here, where the parsed shard rows are still in hand: the
        // climate row carries no elevation and `MapPlace` has no field for
        // one, so this is the only moment the two halves meet. And no shard,
        // no index: without the city rows there is no `G`-id place on the map
        // to look a climate row up for, so an index built from the climate
        // file alone would colour nothing and still put the honesty note
        // under a map with no derived pin on it.
        setClimate(buildClimateIndex(shardRes === null ? null : climateRes, shardRes?.cities ?? []));
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retryKey, hasDetail, countryCode, enabled]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [countryCode, enabled]);

  return {
    provinces,
    projection,
    cities,
    citiesUnavailable,
    airports,
    climate,
    loadError,
    retry: () => setRetryKey((k) => k + 1),
  };
}
