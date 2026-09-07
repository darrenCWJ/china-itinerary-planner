"use client";

import type { CountryView } from "./countryView";
import { OUTLINE_STROKE, UNIT_STROKE } from "./markerGeometry";

/**
 * The admin-1 units and the national border over their seams — the first
 * layer inside `CountryLevel`'s zoom group. Moved verbatim out of
 * CountryLevel.tsx on 2026-09-07; the comments inside are that file's.
 */
export function UnitsLayer({
  units,
  outline,
  offersRegions,
  k,
}: {
  units: CountryView["units"];
  outline: string | null;
  offersRegions: boolean;
  k: number;
}) {
  return (
    <>
      <g data-units="">
        {units.map((unit) => (
          <path
            key={unit.id}
            // Only the selectable ones are marked, and it is the same
            // `selectable` flag `selectableFeatures` is indexed off, so
            // what is marked here and what a group can name are one
            // decision: a unit that is not a subdivision must not become
            // one by being drawn.
            //
            // "Marked" and "zoomable" are two things, and §6.6 D10 is
            // where they part: a country with ONE subdivision still has
            // that subdivision, and still has nowhere to zoom. The mark
            // states the first; `offersRegions` decides the second.
            data-unit={unit.selectable ? unit.id : undefined}
            d={unit.d}
            fill="var(--surf-2)"
            stroke="var(--paper)"
            strokeWidth={UNIT_STROKE / k}
          >
            {offersRegions && unit.selectable && unit.label && <title>{unit.label}</title>}
          </path>
        ))}
      </g>

      {/* The national border, over the seams the units drew. */}
      {outline && (
        <path
          data-outline=""
          d={outline}
          fill="none"
          stroke="var(--ink-2)"
          strokeOpacity={0.55}
          strokeWidth={OUTLINE_STROKE / k}
          className="pointer-events-none"
          aria-hidden
        />
      )}
    </>
  );
}
