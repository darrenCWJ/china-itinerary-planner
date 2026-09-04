"use client";

import { useEffect, useMemo, useState } from "react";
import type { Topology } from "topojson-specification";
import { CountryMap } from "@/components/map/CountryMap";
import { buildClimateIndex, NO_CLIMATE } from "@/components/map/climateIndex";
import { CLIMATE_COUNTRY, type DerivedClimateIndex, type MapPlace } from "@/components/map/mapTypes";
import { fetchCityShard } from "@/lib/cityShard";
import { fetchClimateShard } from "@/lib/climateShard";
import { getCountry } from "@/lib/countries";
import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { hasDetailLevel } from "@/lib/countryDetail";
import {
  PROJECTION_PATH,
  parseProjectionManifest,
  type ProjectionEntry,
} from "@/lib/countryProjection";
import { DESTINATIONS } from "@/lib/data";
import { latLonOf } from "@/lib/geo";
import type { TripPlan } from "@/lib/itinerary";
import { fetchProvinceTopology, type ProvinceFile } from "@/lib/provinceTopology";
import type { Destination, Season } from "@/lib/types";

/**
 * Spec §2.1's map view of the itinerary — the thing that justified taking Route
 * out of the nav: "a map ⇄ list toggle *inside* Plan. It is a view of the
 * itinerary, not a sibling of it."
 *
 * Deliberately **read-only**, and it now says so with a prop rather than with a
 * `noop`. `CountryMap` is the picker from the wizard, where tapping a place
 * selects it; here there is nothing to select — the plan already exists, and
 * this is a view of it. Every place on the map is one of the trip's own stops,
 * drawn in day order.
 *
 * The inert callback used to be the whole of that statement, and it stopped
 * being enough the moment `CountryLevel` grew controls (§5.3): a marker
 * announced itself as a pressed toggle, held a tab stop, and opened a card
 * whose primary button reads "Remove <name> from trip" — all of it wired to
 * the noop, on a surface a shared link is one component away from reaching.
 * `readOnly` is what the level is actually built from now; `noop` remains only
 * for the two branches that were always inert and have nothing to suppress —
 * `ChinaLevel`, frozen by §9.5, and the stop list, which is §5.2's spine.
 *
 * Off-map stops never resolve to coordinates, and a curated destination without
 * coordinates cannot be drawn, so both simply do not appear — the day list
 * remains the complete record and this is a view of the part that can be
 * plotted.
 *
 * **It was blank for every worldwide trip on two counts, and PR4 fixes both.**
 * The stops came from the bundled curated set, which is sixteen Chinese cities,
 * so a Peruvian trip drew nothing at all; and the geometry came from
 * `/china-provinces.json` whatever country the trip was in, so there was
 * nothing to draw it on. Each is now a fetch, and the two are independent:
 * geometry that never arrives costs the drawing and never the stops (§5.2).
 *
 * **Everything it fetches answers a signed-out request, and that was checked
 * rather than assumed.** §5.1 calls this "a guest-reachable surface", which is
 * true of the PAGE and not of this component: `lib/wall.ts` passes
 * `/trip/<id>?code=…`, but `resolveTripAccess` answers `guest` for a request
 * with no session, and `TripView` renders `GuestTripView` — not `PlanTab`, and
 * so not this — for anything short of `member`. So a shared trip link does not
 * reach here today.
 *
 * The property is still worth holding, because losing it is silent: a fetch
 * that needs a session works for every developer and every member and fails
 * only for the visitor the guest branch is one component away from gaining.
 * `/api/destinations/resolve` is guest-safe on both counts — the wall passes
 * every `/api/` path, and the route reads no session — and `RouteMap.test.tsx`
 * pins it. The province files are NOT: they are static assets behind the wall,
 * so a guest who ever did mount this would get the stops without the geometry,
 * which is the same fallback a 500 gets.
 */

/**
 * The callback the branches that cannot be switched off still require.
 *
 * `readOnly` on the `CountryLevel` branch is what actually makes this surface a
 * view; this is what `ChinaLevel` (§9.5: untouched) and the stop list get, and
 * neither has ever offered a card. It is no longer standing in for a mode.
 */
const noop = () => {};

/**
 * How many ids one resolve call may carry.
 *
 * `app/api/destinations/resolve/route.ts` slices its `ids` param at 12 and
 * drops the rest in silence. Asking for exactly what it will answer keeps that
 * ceiling here, where this comment can name it: a trip with more than twelve
 * catalog stops loses the remainder from the MAP — as it loses all of them
 * today — and the day list stays the complete record either way.
 */
const RESOLVE_MAX = 12;

/** Plan destinations in day order, de-duplicated on first appearance. */
export function routeDestinationIds(plan: TripPlan): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const day of plan.days) {
    if (day.destinationId === undefined || seen.has(day.destinationId)) continue;
    seen.add(day.destinationId);
    ids.push(day.destinationId);
  }
  return ids;
}

/**
 * The stops `/api/destinations/resolve` has to answer for — the plan's own
 * destination ids, less the ones the bundled curated set already describes.
 *
 * Empty for a wholly curated trip, which is every China trip built from the
 * sixteen destination cards, and that emptiness is load-bearing: it is what
 * keeps this component making exactly the one request it always made for
 * China, which §9.5 requires.
 *
 * Off-map ids (`offmap:<slug>`) are asked about rather than filtered out. They
 * resolve to nothing — they are in no catalog by construction — and they carry
 * no coordinates to draw either way, so excluding them here would only put the
 * wizard's private id namespace into this file to save an id in a query string.
 */
export function unresolvedStopIds(plan: TripPlan): string[] {
  const curated = new Set(DESTINATIONS.map((d) => d.id));
  return routeDestinationIds(plan)
    .filter((id) => !curated.has(id))
    .slice(0, RESOLVE_MAX);
}

/**
 * The stops that can actually be drawn, in day order.
 *
 * `resolved` is what `/api/destinations/resolve` answered for the ids the
 * bundled set could not describe. Before PR4 there was no second argument and
 * only `DESTINATIONS` was consulted, which is the reason this surface was blank
 * outside China: the sixteen curated cards are all Chinese, so every catalog
 * city on every worldwide trip fell through the `continue` below.
 *
 * The old docblock argued against fetching here — "a second resolution path in
 * the tree for data the day list already names". That trade is settled the
 * other way now, because the thing being weighed changed: the cost is one GET
 * for a page that already renders a map, and the benefit is the map existing at
 * all for 245 countries.
 *
 * Curated wins a collision, though nothing turns on it — `resolveDestinations`
 * returns the very same object for a curated id.
 *
 * Every drawn stop is `kind: "curated"`, resolved or not. On this surface that
 * is not a claim about where the data came from: `kind` is what the renderers
 * size and label a marker by, and every place here is a destination of the plan
 * rather than a suggestion beside it. It is also what `ChinaLevel` filters on at
 * country level, so a China trip keeps drawing exactly the pins it drew before.
 */
export function routePlaces(plan: TripPlan, resolved: readonly Destination[] = []): MapPlace[] {
  const wanted = routeDestinationIds(plan);
  const byId = new Map<string, Destination>(DESTINATIONS.map((d) => [d.id, d]));
  for (const destination of resolved) {
    if (!byId.has(destination.id)) byId.set(destination.id, destination);
  }
  const places: MapPlace[] = [];
  for (const id of wanted) {
    const destination = byId.get(id);
    if (!destination) continue;
    const at = latLonOf(destination);
    if (!at) continue;
    places.push({
      id: destination.id,
      kind: "curated",
      name: destination.name,
      localName: destination.localName,
      province: null,
      country: destination.country,
      region: destination.region,
      lat: at.lat,
      lon: at.lon,
      population: null,
      level: "curated",
      attractionCount: destination.activities.length,
      blurb: destination.tagline,
      emoji: destination.emoji,
      bestSeasons: destination.bestSeasons,
      seasonNotes: destination.seasonNotes,
    });
  }
  return places;
}

/**
 * The month the map should colour its season fit against.
 *
 * The start date is the fact when there is one. Without it, fall back to the
 * first month the *country's own* profile calls this season — hemisphere-aware,
 * so a Southern-hemisphere trip does not get a Northern month. Reading the
 * profile rather than a local table keeps the one that PR1 built as the single
 * source of truth (spec §5.2).
 */
export function routeMonth(startDate: string | null, season: Season, country: string): number {
  if (startDate !== null) {
    const month = Number(startDate.slice(5, 7));
    if (Number.isInteger(month) && month >= 1 && month <= 12) return month;
  }
  const { seasonOfMonth } = getCountryBaseProfile(country);
  for (let month = 1; month <= 12; month++) {
    if (seasonOfMonth(month) === season) return month;
  }
  return 1;
}

interface Props {
  plan: TripPlan;
  /** ISO alpha-2 of the country being travelled. */
  country: string;
  startDate: string | null;
  season: Season;
}

export function RouteMap({ plan, country, startDate, season }: Props) {
  const month = useMemo(
    () => routeMonth(startDate, season, country),
    [startDate, season, country]
  );

  /**
   * Keyed on the id list rather than on `plan`, which is a new object on every
   * edit: adding a day to a destination the trip already visits must not
   * re-request the stops it already has.
   */
  const idsKey = useMemo(() => unresolvedStopIds(plan).join(","), [plan]);
  const [resolved, setResolved] = useState<readonly Destination[]>([]);
  /**
   * Whether the stops are still being looked up.
   *
   * It exists for one sentence: the empty state below is a CLAIM — "none of
   * this trip's stops can be drawn on a map yet" — and on a worldwide trip that
   * claim was true for as long as it took the resolve call to answer. Saying it
   * and then replacing it with a map is worse than saying nothing.
   */
  const [resolving, setResolving] = useState(idsKey !== "");

  useEffect(() => {
    if (idsKey === "") {
      setResolved([]);
      setResolving(false);
      return;
    }
    const controller = new AbortController();
    setResolved([]);
    setResolving(true);
    // Encoded, unlike `app/plan/page.tsx`'s own call: an off-map id is
    // `offmap:${name.toLowerCase().replace(/\s+/g, "-")}`, so a hand-typed
    // "R&B Town" puts a bare `&` in the query string and truncates the list at
    // it. The route splits on "," after the param is decoded, so the commas
    // survive the round trip.
    fetch(`/api/destinations/resolve?ids=${encodeURIComponent(idsKey)}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`resolve ${r.status}`);
        return r.json() as Promise<{ destinations?: Destination[] }>;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        // The one boundary check worth making here: `routePlaces` iterates
        // this, and a string would iterate as its characters rather than throw.
        setResolved(Array.isArray(body?.destinations) ? body.destinations : []);
        setResolving(false);
      })
      .catch(() => {
        // A stop that cannot be resolved is a stop that cannot be drawn, which
        // is the state this surface has always degraded to. The day list is
        // still the complete record.
        if (!controller.signal.aborted) setResolving(false);
      });
    return () => controller.abort();
  }, [idsKey]);

  const places = useMemo(() => routePlaces(plan, resolved), [plan, resolved]);
  const routeIds = useMemo(() => places.map((p) => p.id), [places]);

  const [failed, setFailed] = useState(false);

  const { code: countryCode } = getCountry(country);
  /**
   * Gated on the registry rather than tried-and-caught, exactly as
   * `MapExplorer` gates its own: `provincePath` is well-formed for AQ, BV, HM
   * and XD too and the build wrote no file for any of them, so without this
   * every trip to one of those four spends a request on a guaranteed 404.
   *
   * China included: it reads `/provinces/CN.json` like every other country
   * now that the curated renderer is gone.
   */
  const wantsProvinces = hasDetailLevel(country);
  const [provinces, setProvinces] = useState<ProvinceFile | null>(null);
  const [projection, setProjection] = useState<ProjectionEntry | null>(null);

  /**
   * The trip country's own admin-1 geometry and its §5.4 framing.
   *
   * Cleared up front rather than only on failure, and for the reason
   * `MapExplorer` gives: these files carry no country guard of their own, so
   * one country's units left in place across a switch draw as another's, which
   * is not a stale answer but a wrong one that looks exactly like a working
   * map.
   *
   * Both legs swallow their own rejection and neither reaches a visible error.
   * That is §5.2 rather than sloppiness: the stops are the spine and they are
   * never gated on a map, so a country whose geometry is missing still renders
   * every place on the trip. It is also the only sane answer for a signed-out
   * caller, where these are wall-redirected to /login and `res.json()` rejects
   * on the login page's `<`.
   */
  useEffect(() => {
    if (!wantsProvinces) return;
    const controller = new AbortController();
    setProvinces(null);
    setProjection(null);
    Promise.all([
      fetchProvinceTopology(countryCode, controller.signal),
      // Degrades further than the geometry does: a country with no entry still
      // gets a map, fitted to its own units, because the manifest and the code
      // deploy independently.
      fetch(PROJECTION_PATH, { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`projections ${r.status}`);
          return r.json() as Promise<unknown>;
        })
        .then(parseProjectionManifest)
        .catch(() => null),
    ])
      .then(([provinceFile, manifest]) => {
        if (controller.signal.aborted) return;
        setProvinces(provinceFile);
        setProjection(manifest?.get(countryCode) ?? null);
      })
      .catch(() => {
        // Nothing to set: `provinces` is already null, and null is what the
        // list-only fallback reads.
      });
    return () => controller.abort();
  }, [wantsProvinces, countryCode]);

  /**
   * The trip country's derived climate (§9.4), for the stops' colours.
   *
   * Two static fetches the wizard's map also makes, joined the same way
   * (`buildClimateIndex`), so this surface and `MapExplorer` cannot disagree
   * about a stop's verdict. The city shard is fetched for ONE field — `elev`
   * — because the climate row does not carry it and `Destination` has no
   * slot for it, and at Cusco's 3,312 m it is worth a whole band. Both files
   * are served with a day of cache (next.config.ts), so the second trip page
   * that opens on the same country pays nothing.
   *
   * Skipped for China (§9.5): `fitForPlace` never reads a derived row for a
   * Chinese place, and the shard would be 412 rows nothing consults.
   *
   * Both legs swallow their own rejection, for §5.2's reason: a stop is drawn
   * whether or not its verdict arrives, and grey is the absence of a claim.
   * Cleared up front so one country's rows are never read against another's
   * stops between a switch and the new file landing.
   *
   * And unlike `MapExplorer`, a city shard that fails while the climate file
   * answers still builds the index: this surface's stops come from
   * `/api/destinations/resolve`, not from the shard, so they are drawn either
   * way, and a verdict without the lapse-rate correction is still a verdict
   * — `lib/climateModel.ts` reads a missing elevation as no correction. The
   * shard here is fetched for that one field and nothing else.
   */
  const [climate, setClimate] = useState<DerivedClimateIndex>(NO_CLIMATE);

  useEffect(() => {
    setClimate(NO_CLIMATE);
    if (countryCode === CLIMATE_COUNTRY) return;
    const controller = new AbortController();
    // `fetchClimateShard` takes a fetch rather than a signal — lib/rates.ts's
    // pattern — so the abort is wrapped in.
    const scoped: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
    Promise.all([
      fetchClimateShard(countryCode, scoped).catch(() => null),
      fetchCityShard(countryCode, controller.signal).catch(() => null),
    ]).then(([shard, cities]) => {
      if (controller.signal.aborted) return;
      setClimate(buildClimateIndex(shard, cities?.cities ?? []));
    });
    return () => controller.abort();
  }, [countryCode]);

  if (places.length === 0) {
    return (
      <p
        role="status"
        className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--paper)] p-8 text-center text-sm text-[var(--ink-2)]"
      >
        {resolving
          ? "Loading the map…"
          : "None of this trip's stops can be drawn on a map yet. The Days view has the whole itinerary."}
      </p>
    );
  }


  return (
    <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
      <CountryMap
        country={country}
        // Null while the file is in flight and null after it failed — the same
        // thing here, deliberately, because the fallback for both is the stop
        // list rather than a spinner or an error (§5.2).
        provinces={provinces}
        projection={projection}
        places={places}
        // Every stop is on the plan, so all of them read as selected and the
        // route line runs through them in day order.
        selected={routeIds}
        routeIds={routeIds}
        month={month}
        // The whole country, deliberately — and stated, because nothing else
        // states it. Phase 4 widened this prop from `ChinaRegion` to
        // `RegionId`, which is `string`, so `null` stayed assignable and no
        // compiler pointed at the one call site the widening did not migrate.
        // There is nothing here to migrate TO: the province chrome is
        // `MapExplorer`'s — a `<select>` and a step-up button — and this
        // surface renders none of it, so a framing would be one nothing could
        // leave. It would also cost stops: a framed level filters its markers
        // to the framed group's own cities (§6.5), and a trip's stops are
        // spread across provinces by definition.
        zoomRegion={null}
        // A view of the plan, not a picker for one: the markers keep their
        // dots, labels and hover and drop every control §5.3 gave them, so
        // nothing here offers to change a trip it cannot change.
        readOnly
        climate={climate}
        onZoomRegion={noop}
        onTogglePlace={noop}
        onHoverPlace={noop}
      />
    </div>
  );
}
