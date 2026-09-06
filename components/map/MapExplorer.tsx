"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Topology } from "topojson-specification";
import { getCountry } from "@/lib/countries";
import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { hasDetailLevel } from "@/lib/countryDetail";
import { suggestRoute, type RoutePlace } from "@/lib/route";
import type { CatalogHit } from "@/lib/tripShared";
import type { AirportPick } from "@/components/trip/AirportPicker";
import { CountryMap } from "./CountryMap";
import { FitLegend } from "./FitLegend";
import { MonthTimeline } from "./MonthTimeline";
import { PlacePopup } from "./PlacePopup";
import { RoutePanel } from "./RoutePanel";
import { type MapPlace } from "./mapTypes";
import { regionSchemeFor, type RegionId } from "@/lib/regionScheme";
import { GapNote } from "@/components/plan/GapNote";
import { climateGapNote } from "@/lib/climateNote";
import { buildExplorerPlaces } from "./explorerPlaces";
import { STEP_UP_BUTTON } from "./stepUpButton";
import { WorldPane } from "./WorldPane";
import { useCountryAssets } from "./useCountryAssets";

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
 * The level coordinator (spec §6): world ⇄ country, sharing one shell, one
 * month timeline and one route panel between them.
 */
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
  /**
   * Whether this pane has shown a country level yet.
   *
   * The destinations step opens on the world level now, so on a first visit
   * there is no country to go "back" to: the step-down control the world
   * level offers is drawn only once a country has been opened. Derived during
   * render — the pattern `app/plan/page.tsx` uses to keep `seasonCountry` in
   * step with `tripCountry` — rather than in an effect, which would paint one
   * frame without the control and then add it.
   */
  const [openedCountry, setOpenedCountry] = useState(level === "country");
  if (level === "country" && !openedCountry) setOpenedCountry(true);
  const mapWrapRef = useRef<HTMLDivElement>(null);

  const { code: countryCode, name: countryName } = getCountry(country);
  const countryLabel = countryName || countryCode || "this country";
  /** Whether the build wrote this country an admin-1 file. True 246 times. */
  const hasDetail = hasDetailLevel(country);

  const {
    provinces,
    projection,
    cities,
    citiesUnavailable,
    airports,
    climate,
    loadError,
    retry,
  } = useCountryAssets(countryCode, hasDetail);

  // `hover` holds a `MapPlace` derived from the previous country's cities, so
  // it is dropped the moment the country changes — `useCountryAssets` empties
  // those cities in the same commit, and nothing else re-creates a place.
  useEffect(() => setHover(null), [countryCode]);

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
   * The legend beside it sets a related rule, not this one: it is drawn
   * inside the level, under the map, so it exists exactly where the
   * geometry does and "No data" is explained even for a country whose
   * climate file is missing.
   * This toggle follows the same idea from the other side — a control over
   * nothing is worse than a missing one — which is also why the world level's
   * globe button is withdrawn under reduced motion rather than left offering a
   * view that render would refuse.
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

  const places = useMemo(
    () => buildExplorerPlaces(cities, visited, countryCode),
    [cities, visited, countryCode]
  );

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
      <WorldPane
        countryCode={countryCode}
        countryLabel={countryLabel}
        openedCountry={openedCountry}
        onPickCountry={pickCountry}
        onLevelChange={onLevelChange}
      />
    );
  }

  if (loadError) {
    return (
      <div className="mt-5 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-6 text-center">
        <p className="text-sm text-[var(--ink-2)]">Couldn&apos;t load the map data.</p>
        <button
          type="button"
          onClick={retry}
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
          §10.1's layer toggle. Every country this pane draws has the
          marker-colour legend (`FitLegend`) under the map, and any country
          with airports has this toggle in the header — `canDrawAirports` is
          also false for a country with no airport rows of its own — so the two
          sit in different places and never compete for a slot.

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
          climate={climate}
          // Under the map, above the list — see `CountryLevel.belowMap` for why
          // this is a slot and not three siblings after the level. The legend
          // is drawn for every country whose geometry loaded, climate or no
          // climate, because "No data" is a colour that needs explaining too;
          // the note (§9.7) is `climateGapNote`'s lines — `[]` for China and
          // for a country that drew no derived row, and `GapNote` renders
          // nothing for `[]`. Neither reaches the list-only fallback, which
          // has no marker to explain.
          belowMap={
            <>
              <FitLegend />
              {caption && (
                <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
                  {caption}
                </p>
              )}
              <GapNote label="About the climate colours" lines={climateGapNote(countryCode, climate.size)} />
            </>
          }
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
            climate={climate}
            position={hover.pos}
            containerWidth={mapWrapRef.current?.clientWidth ?? 640}
          />
        )}
      </div>

      <div className="mt-4 border-t border-dashed border-[var(--line-1)] pt-4">
        <MonthTimeline month={month} onMonth={handleMonth} country={countryCode} />
      </div>

      {route && (
        <RoutePanel
          route={route}
          arrival={arrival}
          onArrivalChange={onArrivalChange}
          onApplyOrder={applyRouteOrder}
          countryLabel={countryLabel}
          unresolvedCount={unresolvedCount}
        />
      )}
    </div>
  );
}
