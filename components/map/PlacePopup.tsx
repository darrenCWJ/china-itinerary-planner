"use client";

import { getCountryProfile } from "@/lib/countryProfile";
import { bandsIn, highlightFor, regionMonthClimate } from "@/lib/months";
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
  /**
   * The country being planned.
   *
   * The crowd dots and the holiday glyph below used to come from lib/months.ts
   * directly, which is China's table — so hovering any Peruvian city showed
   * China's national crowd curve, and February showed 🧧. The season used to
   * pick a `seasonNotes` line was northern for the same reason.
   */
  country: string;
}

const POPUP_W = 260;

/** Hover card following the cursor over a map marker. */
export function PlacePopup({ place, month, position, containerWidth, country }: Props) {
  const profile = getCountryProfile(country);
  const fit = fitForPlace(place, month);
  // regionMonthClimate is China-only data (see lib/months.ts); a place from
  // outside China's seven regions has no row to read, so this degrades to no
  // climate line instead of throwing.
  const climate = isChinaRegion(place.region) ? regionMonthClimate(place.region, month) : null;
  const season = profile.seasonOfMonth(month);
  const seasonNote = place.seasonNotes?.[season];
  const highlight = place.kind === "curated" ? highlightFor(place.id, month) : undefined;
  // null, not a flat curve, for a country nobody has researched — the crowd
  // line is then not rendered at all. See `CountryProfile.crowdByMonth`.
  const crowd = profile.crowdByMonth?.[month - 1] ?? null;
  const band = bandsIn(profile.holidays, month)[0];
  const hasCrowdLine = crowd !== null || band !== undefined;
  const population = formatPopulation(place.population);

  /**
   * Where the card says the place is.
   *
   * "<region> China" is a claim about China, and `place.region` is only one of
   * China's seven when the place is Chinese — `MapExplorer` puts the admin-1
   * name there for every other country, and 439 of the 58,742 committed shard
   * rows carry no admin-1 at all. Unguarded, a Peruvian city with a null
   * province rendered a bare " China". The fallback stays for the case it was
   * written for: every curated Chinese destination has `province: null` and one
   * of the seven regions.
   *
   * Joined rather than concatenated so the "· <level>" suffix cannot be left
   * hanging off an origin that resolved to nothing.
   */
  const origin =
    place.province ?? (isChinaRegion(place.region) ? `${place.region} China` : place.region);
  const originLine = [origin, place.level === "curated" ? "" : place.level]
    .filter((part) => part !== "")
    .join(" · ");

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
