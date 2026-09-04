"use client";

import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { bandsIn, highlightFor } from "@/lib/months";
import {
  FIT_COLORS,
  FIT_LABELS,
  fitForPlace,
  formatPopulation,
  originLineFor,
  placeClimateFor,
  type DerivedClimateIndex,
  type MapPlace,
} from "./mapTypes";

interface Props {
  place: MapPlace;
  month: number;
  position: { x: number; y: number };
  containerWidth: number;
  /**
   * The country being planned.
   *
   * The crowd dots and the holiday glyph below used to come from lib/months.ts
   * directly, which is China's table — so hovering any Peruvian city showed
   * China's national crowd curve, and February showed 🧧. The season used to
   * pick a `seasonNotes` line was northern for the same reason.
   */
  country: string;
  /**
   * The open country's derived climate, keyed by `MapPlace.id` (§9.4), for
   * every place whose country is not China. Optional: the trip map's markers
   * have no hover card, and every caller before Plan 6 passed nothing. A
   * Chinese place never reads it (§9.5) — `chinaBaseline.test.tsx` renders
   * this component with and without one and pins the same bytes.
   */
  climate?: DerivedClimateIndex;
}

const POPUP_W = 260;

/** Hover card following the cursor over a map marker. */
export function PlacePopup({ place, month, position, containerWidth, country, climate }: Props) {
  const profile = getCountryBaseProfile(country);
  const fit = fitForPlace(place, month, climate);
  // Curated for a Chinese place in one of the seven, derived for a place
  // outside China with a row in the lookup, nothing otherwise — one resolver
  // shared with `SelectedPlaceCard`, so the two surfaces cannot disagree.
  // Keyed off the place's own country, not the open one: Botswana's Central
  // District is spelled exactly like one of China's seven.
  const typical = placeClimateFor(place, month, climate);
  const season = profile.seasonOfMonth(month);
  const seasonNote = place.seasonNotes?.[season];
  const highlight = place.kind === "curated" ? highlightFor(place.id, month) : undefined;
  // null, not a flat curve, for a country nobody has researched — the crowd
  // line is then not rendered at all. See `CountryBaseProfile.crowdByMonth`.
  const crowd = profile.crowdByMonth?.[month - 1] ?? null;
  const band = bandsIn(profile.holidays, month)[0];
  const hasCrowdLine = crowd !== null || band !== undefined;
  const population = formatPopulation(place.population);

  // Where the card says the place is. Shared with `SelectedPlaceCard`, which
  // makes the same claim about the same place on the surface §5.3.3 added —
  // see `originLineFor` for the two fallbacks it encodes.
  const originLine = originLineFor(place);

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
      {originLine !== "" && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
          {originLine}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: FIT_COLORS[fit] }}
          aria-hidden
        />
        <span className="text-xs font-semibold">{FIT_LABELS[fit]}</span>
        {typical && (
          <span className="text-xs text-[var(--ink-2)]">
            {typical.lo}°–{typical.hi}°C typical
          </span>
        )}
      </div>

      {typical?.note && !seasonNote && (
        <p className="mt-1 text-xs text-[var(--ink-2)]">{typical.note}</p>
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

      <div
        className={`mt-2 flex items-center ${
          hasCrowdLine ? "justify-between" : "justify-end"
        } border-t border-dashed border-[var(--line-1)] pt-2 text-[11px] text-[var(--ink-2)]`}
      >
        {hasCrowdLine && (
          <span title={band ? `${band.name} falls in this month` : undefined}>
            {crowd !== null && (
              <>
                Crowds {"●".repeat(crowd)}
                {"○".repeat(5 - crowd)}
              </>
            )}
            {band && <span className="ml-1">{band.emoji}</span>}
          </span>
        )}
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
