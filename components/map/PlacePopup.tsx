"use client";

import {
  bandsForMonth,
  crowdForMonth,
  highlightFor,
  regionMonthClimate,
  seasonOfMonth,
} from "@/lib/months";
import {
  FIT_COLORS,
  FIT_LABELS,
  fitForPlace,
  formatPopulation,
  isChinaRegion,
  type MapPlace,
} from "./mapTypes";

interface Props {
  place: MapPlace;
  month: number;
  position: { x: number; y: number };
  containerWidth: number;
}

const POPUP_W = 260;

/** Hover card following the cursor over a map marker. */
export function PlacePopup({ place, month, position, containerWidth }: Props) {
  const fit = fitForPlace(place, month);
  // regionMonthClimate is China-only data (see lib/months.ts); a place from
  // outside China's seven regions has no row to read, so this degrades to no
  // climate line instead of throwing.
  const climate = isChinaRegion(place.region) ? regionMonthClimate(place.region, month) : null;
  const season = seasonOfMonth(month);
  const seasonNote = place.seasonNotes?.[season];
  const highlight = place.kind === "curated" ? highlightFor(place.id, month) : undefined;
  const crowd = crowdForMonth(month);
  const band = bandsForMonth(month)[0];
  const population = formatPopulation(place.population);

  const left = Math.min(Math.max(position.x - POPUP_W / 2, 8), containerWidth - POPUP_W - 8);
  const showAbove = position.y > 190;

  return (
    <div
      className="pointer-events-none absolute z-20 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 shadow-lg"
      style={{
        width: POPUP_W,
        left,
        top: showAbove ? position.y - 12 : position.y + 20,
        transform: showAbove ? "translateY(-100%)" : undefined,
      }}
      role="tooltip"
    >
      <div className="flex items-baseline gap-2">
        {place.emoji && <span aria-hidden>{place.emoji}</span>}
        <p className="font-display text-sm font-bold">{place.name}</p>
        {place.localName && (
          <span className="font-kai text-xs text-[var(--seal)]">{place.localName}</span>
        )}
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
        {place.province ?? `${place.region} China`}
        {place.level !== "curated" && ` · ${place.level}`}
      </p>

      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: FIT_COLORS[fit] }}
          aria-hidden
        />
        <span className="text-xs font-semibold">{FIT_LABELS[fit]}</span>
        {climate && (
          <span className="text-xs text-[var(--ink-2)]">
            {climate.lo}°–{climate.hi}°C typical
          </span>
        )}
      </div>

      {climate?.note && !seasonNote && (
        <p className="mt-1 text-xs text-[var(--ink-2)]">{climate.note}</p>
      )}
      {seasonNote && <p className="mt-1 text-xs text-[var(--ink-2)]">{seasonNote}</p>}
      {highlight && (
        <p className="mt-1 text-xs">
          <span aria-hidden>✨</span> {highlight}
        </p>
      )}
      {place.kind === "catalog" && place.blurb && (
        <p className="mt-1 line-clamp-3 text-xs text-[var(--ink-2)]">{place.blurb}</p>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-dashed border-[var(--line-1)] pt-2 text-[11px] text-[var(--ink-2)]">
        <span title={band ? `${band.name} falls in this month` : undefined}>
          Crowds {"●".repeat(crowd)}
          {"○".repeat(5 - crowd)}
          {band && <span className="ml-1">{band.emoji}</span>}
        </span>
        {place.attractionCount > 0 ? (
          <span>{place.attractionCount} sights</span>
        ) : (
          population && <span>{population}</span>
        )}
      </div>
      <p className="mt-1.5 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--accent-ink)]">
        Click to select
      </p>
    </div>
  );
}
