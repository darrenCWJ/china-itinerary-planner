"use client";

import { FOCUS_RING, labelFor, MARKER_STROKE, SELECTION_RING } from "./markerGeometry";
import type { Mark, VisibleEntry } from "./markerLayout";
import type { createHoverReporter } from "./mapShared";
import type { MapPlace } from "./mapTypes";
import type { MarkerInteractionProps, ReadOnlyMarkerProps } from "./useMarkerSelection";

/**
 * The markers (§5.3.1): a hit circle first, then the focus and selection
 * rings, the dot, the stop number and the label, per place the framed map
 * draws. Every attribute that made a marker a control comes in through
 * `markerProps`, so `readOnly` is decided in one place. Moved verbatim out of
 * CountryLevel.tsx on 2026-09-07; the comments inside are that file's.
 */
export function MarkerLayer({
  visible,
  marks,
  fills,
  selected,
  routeIds,
  focusedId,
  k,
  markerProps,
  reportHover,
}: {
  visible: VisibleEntry[];
  marks: Mark[];
  fills: string[];
  selected: string[];
  routeIds: string[];
  focusedId: string | null;
  k: number;
  markerProps: (place: MapPlace, order: number) => MarkerInteractionProps | ReadOnlyMarkerProps;
  reportHover: ReturnType<typeof createHoverReporter<MapPlace>>;
}) {
  return (
    <g data-markers="">
      {/*
        `visible`, and its two indices are two different things. `index`
        is the place's position in the country — what `marks` and `caps`
        were computed over, so a zoom re-uses them untouched — while
        `order` is its position among the markers actually drawn, which
        is the frame the roving tabindex's arrow keys step through.
        Passing the wrong one moves the caret to a city that is not on
        screen.
      */}
      {visible.map(({ place, index }, order) => {
        const { x, y, r, hitR } = marks[index];
        const isSelected = selected.includes(place.id);
        const stopIndex = routeIds.indexOf(place.id);
        return (
          <g
            key={place.id}
            data-place={place.id}
            {...markerProps(place, order)}
            onMouseEnter={(e) => reportHover(place, e)}
            onMouseMove={(e) => reportHover(place, e)}
            onMouseLeave={() => reportHover(null)}
          >
            {/* Hit area first, so the visible dot is never the target's
                edge — the ordering `WorldMap` establishes. */}
            <circle data-hit="" cx={x} cy={y} r={hitR} fill="transparent" />
            {place.id === focusedId && (
              // Dashed, so keyboard focus stays distinguishable from
              // selection when they land on the same place — the same
              // distinction `worldLevelShared`'s `strokeFor` draws.
              <circle
                data-focus-ring=""
                cx={x}
                cy={y}
                r={r + FOCUS_RING / k}
                fill="none"
                stroke="var(--ink-0)"
                strokeWidth={1.2 / k}
                strokeDasharray={`${3 / k} ${2 / k}`}
                className="pointer-events-none"
              />
            )}
            {isSelected && (
              <circle
                data-selection-ring=""
                cx={x}
                cy={y}
                r={r + SELECTION_RING / k}
                fill="none"
                stroke="var(--seal)"
                strokeWidth={2 / k}
                opacity={0.9}
              />
            )}
            <circle
              data-dot=""
              cx={x}
              cy={y}
              r={r}
              fill={fills[index]}
              fillOpacity={place.kind === "curated" ? 0.95 : 0.8}
              stroke="var(--paper)"
              strokeWidth={MARKER_STROKE / k}
            />
            {isSelected && stopIndex >= 0 && (
              <text
                data-stop=""
                x={x}
                y={y + (r > 5 / k ? 3.2 / k : 2.8 / k)}
                textAnchor="middle"
                fontSize={Math.max(8 / k, r * 1.1)}
                fontWeight={700}
                fill="var(--paper)"
                className="pointer-events-none"
              >
                {stopIndex + 1}
              </text>
            )}
            {labelFor(place) && (
              <text
                data-label=""
                x={x}
                y={y - r - 3 / k}
                textAnchor="middle"
                fontSize={11 / k}
                fontWeight={600}
                fill="var(--ink-0)"
                stroke="var(--paper)"
                strokeWidth={3 / k}
                paintOrder="stroke"
                className="pointer-events-none"
              >
                {place.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
