"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Topology } from "topojson-specification";
import type { Airport } from "@/lib/airports";
import { getCountry } from "@/lib/countries";
import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { hasDetailLevel } from "@/lib/countryDetail";
import {
  PROJECTION_PATH,
  parseProjectionManifest,
  type ProjectionEntry,
} from "@/lib/countryProjection";
import { DESTINATIONS } from "@/lib/data";
import { haversineKm, latLonOf } from "@/lib/geo";
import { suggestRoute, type RoutePlace } from "@/lib/route";
import type { CatalogHit, MapCity } from "@/lib/tripShared";
import { usePrefs } from "@/components/shell/PrefsProvider";
import { AirportPicker, type AirportPick } from "@/components/trip/AirportPicker";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { CountryMap } from "./CountryMap";
import { FitLegend } from "./FitLegend";
import { MonthTimeline } from "./MonthTimeline";
import { PlacePopup } from "./PlacePopup";
import { CLIMATE_COUNTRY, type MapPlace } from "./mapTypes";
import {
  fetchCityEnrichment,
  fetchCityShard,
  shardRowToMapCity,
  type CityEnrichmentIndex,
  type CityShardRow,
} from "@/lib/cityShard";
import { curatedPlaceNames } from "@/lib/curatedNames";
import { foldPlaceName } from "@/lib/foldPlaceName";
import { fetchProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import { regionForProvinceText } from "@/lib/provinces";
import { regionSchemeFor, type RegionId } from "@/lib/regionScheme";

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
  /** ISO alpha-2 being planned. Every country has geometry to fetch now. */
  country: string;
  level: MapLevel;
  onCountryChange: (code: string) => void;
  onLevelChange: (level: MapLevel) => void;
  onToggleSelect: (id: string) => void;
  onAddCatalog: (hit: CatalogHit) => void;
  onRemoveCatalog: (qid: string) => void;
  onReorder: (ids: string[]) => void;
  onMonthPicked?: (month: number) => void;
  /**
   * The arrival gateway the traveller chose in the wizard (spec §10.3, D3).
   * Anchors the suggested route only when it carries an airport — a bare
   * typed code has no coordinates to anchor on. Optional: RouteMap and the
   * tests that predate gateways render without it.
   */
  arrival?: AirportPick | null;
  onArrivalChange?: (pick: AirportPick | null) => void;
}

const DEFAULT_MONTH = 10;

/**
 * The one step-up control, drawn at whichever rung the two machines are on.
 *
 * Extracted because there are now three of them — out of a region, out of a
 * country, and back down from the world level — and they are the same control
 * in three states rather than three controls that happen to look alike. A
 * literal repeated three times is a place `min-h-[var(--tap-min)]` can go
 * missing from one of them: C5's 44px minimum is asserted per control in
 * `MapExplorer.test.tsx` precisely because each is the only way out of the
 * state it appears in, and a shared constant is what keeps a fourth rung from
 * being added without it.
 */
const STEP_UP_BUTTON =
  "inline-flex min-h-[var(--tap-min)] items-center rounded-lg border border-[var(--line-1)] px-3 text-xs font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]";

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
  arrival = null,
  onArrivalChange,
}: Props) {
  const [month, setMonth] = useState(DEFAULT_MONTH);
  /**
   * The region the country level is framed on, or null for the whole country.
   *
   * `RegionId` since Phase 4, and deliberately not `ChinaRegion`. This state
   * is the one §6.1 names as the thing to widen, and widening the union it
   * used to hold is what the whole plan exists to avoid: `tsconfig.json` does
   * not set `noUncheckedIndexedAccess`, so a non-China key indexing
   * `REGION_MONTHS` or `REGION_META` compiles clean and throws at render.
   * `lib/regionScheme.ts` sets out the argument in full.
   *
   * A second machine beside `level`, not a third `MapLevel` member, and the
   * two stay independent: `MapLevel` is owned by `DestinationStep` and is
   * switched on in exactly one place, so a third member would buy no
   * exhaustiveness and would leave the app with two level machines anyway.
   * The one place the two meet is the step-up control in the header below,
   * which reads both to know whether its rung is out of a region or out of a
   * country — and writes only one of them.
   */
  const [zoomRegion, setZoomRegion] = useState<RegionId | null>(null);
  /**
   * The open country's own admin-1 geometry, or null when it has none yet.
   *
   * **Nothing renders it yet**, deliberately, and for the reason
   * `lib/provinceTopology.ts` and `lib/countryDetail.ts` each gave one commit
   * earlier: PR4's country level is the reader, and it lands next. What arrives
   * first is the half that can go wrong on its own — which file is asked for,
   * how often, what happens to the one already in flight, and what the pane
   * does when it never comes. None of that is a rendering question, and all of
   * it is covered by `MapExplorer.test.tsx`'s "the open country's province
   * file".
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
   * Whether §10.1's airport layer is drawn — off until a reader asks for it.
   *
   * This component's twelfth `useState`, and deliberately not a fifth
   * `UserPrefs` field (D11). The cost of that fifth field is not the one the
   * spec argued: `PrefsSchema` is a `z.object()` and Zod strips unlisted keys,
   * so `PrefsProvider.setPrefs` would write the correct value to the cookie
   * and then PUT it to `/api/me/prefs`, which answers 200 with the key
   * removed — an active clobber of the value the browser had just written,
   * not merely a failure to persist it. `lib/server/schemas.ts:312-315` is the
   * scar where that happened to `pivot` for real, and `:330-332` is the
   * prophylactic one that kept it from happening to `worldView`.
   *
   * Nothing is lost by keeping it here. The layer answers "where are this
   * country's airports", which is a question about the map currently open
   * rather than a standing preference — the same reason `zoomRegion` above it
   * is ephemeral — and its default is the quiet one, so a reader who never
   * touches the toggle never sees a state they did not choose.
   */
  const [showAirports, setShowAirports] = useState(false);
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
  /** Whether the build wrote this country an admin-1 file. True 246 times. */
  const hasDetail = hasDetailLevel(country);

  /**
   * The zoomable groups this country offers the chrome, and the one it is
   * framed on (§6.4, §6.6).
   *
   * `regionSchemeFor` over the very file this component fetched and passes
   * down, so the control and `CountryLevel`'s own scheme are the same pure
   * function over the same input and cannot disagree about what a group is.
   * Lifting the scheme into a prop would have been the other way to guarantee
   * that and costs `CountryLevel` a required prop for a value it can derive;
   * two memoised calls to one allocation-light function is the cheaper half of
   * that trade.
   *
   * Empty for China, and not by a special case: China's geometry is the
   * curated `Topology`, `provinces` is never fetched for it, and there are no
   * units here to build a scheme from. China's region control is the map — its
   * provinces have been zoom buttons since long before this — so the chrome's
   * `<select>` would be a second control for the same choice. §6.6's gate
   * arrives the same way for everyone else: a country with one selectable unit
   * has no groups, so no control is drawn and no region id can match.
   *
   * `zoomedGroup` is what the chrome names rather than `zoomRegion` itself.
   * `RegionId` is `string`, so a region left over from the country the user
   * just left stays assignable and nothing would catch it — resolving through
   * the groups makes a stale id read as "the whole country", which is what
   * `CountryLevel` draws for it.
   */
  const groups = useMemo(
    () => (provinces ? regionSchemeFor(countryCode, provinces.units).groups : []),
    [countryCode, provinces]
  );
  const zoomedGroup = useMemo(
    () => (zoomRegion ? (groups.find((group) => group.id === zoomRegion) ?? null) : null),
    [groups, zoomRegion]
  );

  /**
   * What the chrome calls the framing, or null when the whole country is
   * drawn — and therefore also which rung the back control is on.
   *
   * China is named from `zoomRegion` itself rather than from a group, because
   * China has no groups here: this component holds the curated `Topology` and
   * never a province file, so the seven regions never reach `regionSchemeFor`
   * on this side. "North China" is the heading pre-Phase-4 China rendered and
   * §9.5 keeps it — it is a region OF a country, where the other 245's groups
   * are named subdivisions and stand alone.
   */
  const zoomedName = zoomedGroup?.label ?? null;

  /**
   * The line under the map, saying what the markers currently are.
   *
   * China's two strings are the ones it has always rendered (§9.5) and they
   * describe China's own behaviour: `ChinaLevel` draws curated picks alone
   * until a region is open, so its country-level caption is an invitation to
   * open one. `CountryLevel` draws every city it has from the start, so the
   * other 245 have nothing to say at country level and say nothing — the
   * caption is not a label for the map, it is an explanation of an absence.
   *
   * The absence a zoom creates is the one that needs explaining: §6.5 stops
   * drawing every city outside the framed group, which reads as a country
   * with fewer cities in it unless the caption names the framing and says
   * where the rest went. §5.2's list is unfiltered underneath, and that is
   * the sentence.
   */
  const caption = zoomedGroup
      ? `Showing ${zoomedGroup.label} — the list below still reaches every city`
      : null;

  /**
   * Whether §10.1's toggle has anything to offer — three conditions, and each
   * one is a rendering where the button would be a control over nothing.
   *
   * The legend beside it already sets the rule: it "reads the marker colours,
   * so it appears only where there are markers to read", and the world level's
   * globe button is withdrawn under reduced motion rather than left offering a
   * view that render would refuse. A toggle whose click changes no pixel is
   * worse than a missing one, because it reads as a broken feature.
   *
   * The first two clauses are `CountryMap`'s own dispatch, restated: China
   * renders `ChinaLevel`, which §9.5 freezes and which has no layer at all; a
   * country whose admin-1 file is missing or in flight renders
   * `CountryPlaceList`, which has no map for a mark to sit on. The third is the
   * array itself, empty for the first moment of every country and permanently
   * for one with no rows of its own — and that transience is a control
   * appearing when its data lands, exactly as the region `<select>` above
   * already does.
   */
  const canDrawAirports = provinces !== null && airports.length > 0;

  /**
   * Everything the open country's map needs: its admin-1 geometry — China's
   * curated asset, or the build's per-country file for everyone else — the
   * frame that geometry is drawn in, the Wikidata catalog's cities for that
   * country, and the GeoNames shard plus its enrichment.
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
   */
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    setCities([]);
    setCitiesUnavailable(false);
    setProvinces(null);
    setProjection(null);
    // `hover` holds a `MapPlace` derived from the `cities` array just emptied,
    // so leaving it would keep a popup open over a place that no longer exists.
    setHover(null);
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
    ])
      .then(([provinceFile, manifest, catalogRes, shardRes, enrichment]) => {
        // Four of the five legs swallow their own rejection, so an abort
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
        // The place list's per-province cap does not apply: China renders
        // ChinaLevel and its curated markers, not CountryLevel and its list.
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
  }, [retryKey, hasDetail, countryCode]);

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
            // The destination's own country, not the open one. A curated place
            // is only ever drawn on its own country's map today, but `region`
            // is only readable against the country it belongs to.
            country: d.country,
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
        // Every city in this list came out of the open country's shard, so the
        // open country IS its country. Carried on the place because `region`
        // below cannot be read without it: outside China the admin-1 name is
        // the region label, and some of those names ARE China's — Botswana's
        // Central District spells the same as China's Central. See `isChinaPlace`.
        country: countryCode,
        // `regionForProvinceText` is a China-only keyword table and its
        // `?? "Central"` fallback is one of China's own seven — which
        // `isChinaRegion` then accepts, handing a Peruvian city a Chinese
        // month-fit rather than the neutral one that guard exists to give.
        // Outside China the admin-1 name IS the region label.
        region:
          countryCode === CLIMATE_COUNTRY
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
    const start = arrival?.airport ? { lat: arrival.airport.lat, lon: arrival.airport.lon } : undefined;
    return {
      route:
        routePlaces.length >= 2
          ? suggestRoute(routePlaces, airports, transport, start ? { start } : {})
          : null,
      unresolvedCount: missing,
    };
  }, [selected, placeById, airports, transport, arrival]);

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

  /**
   * Framing, and the hover that belonged to the framing before it.
   *
   * `hover` holds a `MapPlace` the zoom may have just stopped drawing (§6.5
   * filters the markers to the framed group), so a popup left open would
   * describe a city nothing on the map shows — the same reason the country
   * effect clears it. Every writer of `zoomRegion` goes through here so no
   * later one can forget.
   */
  const showRegion = (region: RegionId | null) => {
    setZoomRegion(region);
    setHover(null);
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
            className={STEP_UP_BUTTON}
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

  return (
    <div
      // A stable scope for the end-to-end tap-target sweep, which has to be
      // able to say "every control the MAP owns" without also sweeping the
      // wizard chrome around it.
      data-map-panel=""
      className="mt-5 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {/*
            The back path, level-aware because the two machines are separate
            and only this control has to look at both: a region's step up is
            the whole country, a country's step up is the world, and one rung
            is offered at a time so the chain reads region → country → world.

            `zoomedName` and not `zoomRegion` decides which rung this is. A
            region id left over from another country resolves to no group, so
            it reads as "the whole country" here exactly as it does in
            `CountryLevel` — the two must agree, or the chrome would offer a
            way out of a framing the map is not in.
          */}
          {zoomedName ? (
            <>
              <button type="button" onClick={() => showRegion(null)} className={STEP_UP_BUTTON}>
                ← All {countryLabel}
              </button>
              <h3 className="font-display text-lg font-bold">{zoomedName}</h3>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onLevelChange("world")}
                className={STEP_UP_BUTTON}
              >
                ← All countries
              </button>
              {/*
                China's own line, unchanged: at country level `ChinaLevel`
                draws curated picks over seven clickable regions, so the
                heading is an instruction rather than a name. Every other
                country draws all of its cities at once and has a `<select>`
                beside it, so its heading is the country.
              */}
              <h3 className="font-display text-lg font-bold">
                {countryLabel}
              </h3>
            </>
          )}
          {/*
            The other 245's region control (§6.1). A `<select>` rather than the
            clickable polygons China has: `CountryLevel`'s units carry no
            keyboard model, and giving 83 of Russia's oblasts one apiece is the
            per-marker tab-stop budget §5.3.1 already rejected — where a native
            select is one stop, one control and one thing a screen reader
            already knows how to drive. It doubles as the sideways move China's
            map has and its back button does not: from inside a province,
            another province is one choice rather than out-then-in.
          */}
          {groups.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="sr-only">Zoom to a province</span>
              <select
                value={zoomedGroup?.id ?? ""}
                onChange={(event) => showRegion(event.target.value || null)}
                className="min-h-[var(--tap-min)] rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-2 text-xs font-medium text-[var(--ink-2)]"
              >
                <option value="">All of {countryLabel}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {/*
          §10.1's layer toggle, in the slot the legend occupies for China —
          the two can never both be drawn, because a curated country has no
          layer to toggle and the other 245 have no colour legend to read.

          `aria-pressed` with one fixed name, rather than the globe button's
          swapping label. That button chooses between two renderers and neither
          of them is "on"; this one is a boolean layer, which is the thing
          `aria-pressed` exists for and which `DetailsStep`'s interest chips
          already use. It also keeps the accessible name stable, so a reader
          who has found the control once can find it again in either state.

          NOT `STEP_UP_BUTTON`: that constant is the one step-up control drawn
          at three rungs, and its whole argument is that the three are the same
          control in three states. A layer toggle is a fourth thing, and
          borrowing the class would make that docblock false — so it carries
          `min-h-[var(--tap-min)]` itself, and a test pins it.
        */}
        {canDrawAirports && (
          <button
            type="button"
            onClick={() => setShowAirports((on) => !on)}
            aria-pressed={showAirports}
            className={`inline-flex min-h-[var(--tap-min)] items-center rounded-lg border px-3 text-xs font-medium transition-colors ${
              showAirports
                ? "border-[var(--accent-ink)] text-[var(--accent-ink)]"
                : "border-[var(--line-1)] text-[var(--ink-2)] hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
            }`}
          >
            Airports
          </button>
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
          provinces={provinces}
          projection={projection}
          places={places}
          selected={selected}
          month={month}
          zoomRegion={zoomRegion}
          routeIds={route?.order.map((p) => p.id) ?? []}
          // The array this component has held since PR1 and spent on one thing
          // — `suggestRoute`'s flight legs — reaching a second reader (§10.2).
          // No new fetch and no new route: `/api/map/airports?country=XX` is
          // already asked for above, and it is the request that keeps
          // `lib/server/airports.ts` and its 876,823 B artifact on the server.
          airports={airports}
          // The layer's switch, and the only writer of it. `airports` above
          // reaches the card whether this is on or off (§10.2): the toggle
          // governs what the map draws, never what the card knows.
          showAirports={showAirports}
          onZoomRegion={showRegion}
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

      {/*
        The key, under the map it explains. Gated on the geometry rather than
        on the climate: a country whose climate file 404s still draws grey
        pins, and "No data" is a colour the reader needs explained too.
      */}
      {provinces !== null && <FitLegend />}

      {caption && (
        <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
          {caption}
        </p>
      )}

      <div className="mt-4 border-t border-dashed border-[var(--line-1)] pt-4">
        <MonthTimeline month={month} onMonth={handleMonth} country={countryCode} />
      </div>

      {route && (
        <div className="mt-4 rounded-lg border border-[var(--line-1)] bg-[var(--surf-1)]/60 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h4 className="text-sm font-bold">
              Suggested route · {route.totalKm.toLocaleString()} km
              {arrival?.airport && (
                // The separator is inside the span, not a margin: a margin is
                // invisible to a screen reader, which reads the heading as one
                // string and heard "…24 kmstarts near PVG".
                <span className="font-normal text-[var(--ink-2)]">
                  {" · starts near "}
                  {arrival.iata}
                </span>
              )}
            </h4>
            {onArrivalChange && (
              // A picked value is a whole airport name — "Jorge Chávez
              // International Airport (LIM)" — so a fixed 12rem truncated
              // every one of them. Full width on a phone, wider than the old
              // box once there is room for it.
              <div className="w-full sm:w-64">
                <AirportPicker
                  label="Flying into"
                  value={arrival?.iata ?? null}
                  onChange={onArrivalChange}
                  placeholder="Airport name or code"
                />
              </div>
            )}
            <button
              type="button"
              onClick={applyRouteOrder}
              className="inline-flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--accent-ink)] px-3 text-xs font-semibold text-[var(--paper)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
            >
              Apply this order
            </button>
          </div>
          {/*
            `role="list"` beside the label, redundant as it looks: Tailwind's
            preflight sets `list-style: none` on every ol, and Safari/VoiceOver
            drop a list's implicit role when it has no marker — so without this
            the labelled list is announced as a plain group of items.
          */}
          <ol
            role="list"
            aria-label="Suggested route"
            className="mt-2 flex flex-wrap items-center gap-1 text-sm"
          >
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
