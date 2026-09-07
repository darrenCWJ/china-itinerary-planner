"use client";

import { useMemo } from "react";
import { ARRIVABLE_AIRPORT_SIZES, type Airport } from "@/lib/airports";
import { AIRPORT_MARK, AIRPORT_STROKE } from "./markerGeometry";
import type { Project } from "./markerLayout";

/**
 * §10.1's airport layer: decorative diamonds, `aria-hidden` and
 * `pointer-events-none`, beneath the markers. Owns the projection memo that
 * lived in CountryLevel.tsx so the JSX's 700-word rationale lives with the
 * `<g>` it explains. Moved verbatim on 2026-09-07.
 */
export function AirportLayer({
  airports,
  showAirports,
  project,
  k,
}: {
  airports: Airport[];
  showAirports: boolean;
  project: Project;
  k: number;
}) {
  /**
   * §10.1's sizes are `ARRIVABLE_AIRPORT_SIZES`, and this file no longer owns
   * them: `mainAirportFor` ranks over the same set, so the code the card prints
   * is always a diamond this layer drew. That used to be two lists on two axes —
   * an allow-list here, a 150 km cut over all three sizes there — and they
   * disagreed both ways. lib/airports.ts carries the decision.
   *
   * What size does NOT decide is how big a mark is. It chooses WHETHER an airport
   * is drawn and nothing else: a two-tier glyph would put a second visual scale
   * beside the city dots', and a reader cannot act on the difference anyway.
   */

  /**
   * §10.1's layer, projected once per country rather than once per frame.
   *
   * Empty while the layer is off, so a country whose airports have landed pays
   * nothing for them until someone asks: this level re-renders on every hover —
   * `onHoverPlace` reports up to `MapExplorer`, which holds the tooltip — and a
   * `filter().map()` in the JSX would re-project all 502 of the United States'
   * on every mouse move. Per country the drawn set is a median of 4 and a
   * maximum of those 502, across the 233 countries with any at all.
   *
   * `project` and never `points`: that array is indexed by place and is what
   * `caps` and `marks` were computed over. An airport is not one of them, and
   * §10.1's "never a selectable trip stop" is exactly that the two never merge.
   */
  const airportMarks = useMemo(
    () =>
      showAirports
        ? airports
            .filter((airport) => ARRIVABLE_AIRPORT_SIZES.has(airport.size))
            .map((airport) => {
              const [x, y] = project(airport.lon, airport.lat);
              return { iata: airport.iata, x, y };
            })
        : [],
    [showAirports, airports, project]
  );
  if (airportMarks.length === 0) return null;
  return (
    /*
      §10.1's airport layer, and decorative in a stronger sense than a
      `readOnly` marker is. A read-only marker is a control the surface
      cannot honour; an airport is not a place at all — so there is no
      role to drop, no card to open, and no `MapPlace` to hand to
      `onTogglePlace`, because `Airport` is a separate type that never
      becomes one.

      `aria-hidden`, because the airport a reader can act on is the one
      the card names — a dialog they can open, focus and read — and an
      unlabelled diamond is not a second way to reach it.
      `pointer-events-none` and beneath the markers for one reason
      between them: a decoration must never take a tap that belonged to
      a city's `--tap-min` target, nor sit on top of one.

      §10.1 also asks for the layer "below a zoom threshold", and that
      cannot be a number here. `k` is not a stable quantity — 3,039 of
      the 4,525 zoomable groups clamp against `ADMIN1_MAX_ZOOM_K`, and
      `transformForFeatures` answers `IDENTITY_TRANSFORM` with `k === 1`
      for a group whose bounds are non-finite, which is a case this
      level actually sees. The threshold that does exist is the LEVEL:
      airports are drawn on a country and never on the world map, where
      4,132 marks would be a grey wash over every continent.

      Inside the country the province zoom does not gate the layer
      either — it MOVES it, exactly as it moves the cities. §6.5 filters
      cities to the framed group through `cityProvince`; nothing
      assigns an airport to a province, so the choice is between drawing
      them all and letting the frame clip, or drawing none. None would
      make a toggle pressed before a zoom look broken after it.
    */
    <g data-airports="" className="pointer-events-none" aria-hidden>
      {airportMarks.map(({ iata, x, y }) => (
        <rect
          key={iata}
          data-airport={iata}
          x={x - AIRPORT_MARK / k}
          y={y - AIRPORT_MARK / k}
          width={(2 * AIRPORT_MARK) / k}
          height={(2 * AIRPORT_MARK) / k}
          // A rotation, which the zoom neither scales nor needs to:
          // about the airport's own projected point, so the diamond
          // stays centred on it at every `k`.
          transform={`rotate(45 ${x} ${y})`}
          fill="var(--paper)"
          stroke="var(--ink-2)"
          strokeWidth={AIRPORT_STROKE / k}
        />
      ))}
    </g>
  );
}
