"use client";

import { useEffect, useMemo, useState } from "react";
import type { Topology } from "topojson-specification";
import { CountryMap, hasDetailLevel } from "@/components/map/CountryMap";
import type { MapPlace } from "@/components/map/mapTypes";
import { getCountryProfile } from "@/lib/countryProfile";
import { DESTINATIONS } from "@/lib/data";
import { latLonOf } from "@/lib/geo";
import type { TripPlan } from "@/lib/itinerary";
import type { Season } from "@/lib/types";

/**
 * Spec §2.1's map view of the itinerary — the thing that justified taking Route
 * out of the nav: "a map ⇄ list toggle *inside* Plan. It is a view of the
 * itinerary, not a sibling of it."
 *
 * Deliberately **read-only**. `CountryMap` is the picker from the wizard, where
 * tapping a place selects it; here there is nothing to select — the plan
 * already exists, and this is a view of it. So the toggle and hover callbacks
 * are inert and every place on the map is one of the trip's own stops, drawn in
 * day order.
 *
 * Off-map stops never reach a saved plan (`resolveDestinations` drops them), and
 * a curated destination without coordinates cannot be drawn, so both simply do
 * not appear — the day list remains the complete record and this is a view of
 * the part that can be plotted.
 */

const noop = () => {};

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
 * The stops that can actually be drawn, in day order.
 *
 * Only the bundled curated set is consulted. A catalog city would need
 * `/api/destinations/resolve`, and a trip is capped at eight destinations so
 * that would fit — but fetching here would put a second resolution path in the
 * tree for data the day list already names, and the map would still be missing
 * the same off-map stops. A catalog-only trip falls through to the empty state
 * below, which says so.
 */
export function routePlaces(plan: TripPlan): MapPlace[] {
  const wanted = routeDestinationIds(plan);
  const byId = new Map(DESTINATIONS.map((d) => [d.id, d]));
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
  const { seasonOfMonth } = getCountryProfile(country);
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
  const places = useMemo(() => routePlaces(plan), [plan]);
  const routeIds = useMemo(() => places.map((p) => p.id), [places]);
  const month = useMemo(
    () => routeMonth(startDate, season, country),
    [startDate, season, country]
  );

  const hasDetail = hasDetailLevel(country);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!hasDetail) return;
    const controller = new AbortController();
    fetch("/china-provinces.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`topology ${r.status}`);
        return r.json() as Promise<Topology>;
      })
      .then(setTopology)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [hasDetail]);

  if (places.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--paper)] p-8 text-center text-sm text-[var(--ink-2)]">
        None of this trip&apos;s stops can be drawn on a map yet. The Days view has
        the whole itinerary.
      </p>
    );
  }

  if (hasDetail && topology === null) {
    return (
      <p
        role="status"
        className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--paper)] p-8 text-center text-sm text-[var(--ink-2)]"
      >
        {failed ? "Couldn't load the map — the Days view has the itinerary." : "Loading the map…"}
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
      <CountryMap
        country={country}
        topology={topology}
        places={places}
        // Every stop is on the plan, so all of them read as selected and the
        // route line runs through them in day order.
        selected={routeIds}
        routeIds={routeIds}
        month={month}
        zoomRegion={null}
        onZoomRegion={noop}
        onTogglePlace={noop}
        onHoverPlace={noop}
      />
    </div>
  );
}
