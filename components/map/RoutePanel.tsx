"use client";

import type { RouteSuggestion } from "@/lib/route";
import { AirportPicker, type AirportPick } from "@/components/trip/AirportPicker";

interface Props {
  /** The suggestion to draw. The caller decides there is one; this draws it. */
  route: RouteSuggestion;
  arrival: AirportPick | null;
  /** Absent where the surface has no gateway to change — RouteMap's case. */
  onArrivalChange?: (pick: AirportPick | null) => void;
  onApplyOrder: () => void;
  /** Named in the overland leg's title, where there is no hours figure to give. */
  countryLabel: string;
  /** Selected places with no coordinates, which stay at the end of the order. */
  unresolvedCount: number;
}

/**
 * The suggested route under the map: its length, where it starts, the order
 * itself and the notes the estimator attached to it.
 *
 * Its own file because it is the one block of `MapExplorer` that draws
 * something other than a map — every prop it takes is already computed by the
 * time it renders, and nothing in it reads the level, the month or the hover.
 */
export function RoutePanel({
  route,
  arrival,
  onArrivalChange,
  onApplyOrder,
  countryLabel,
  unresolvedCount,
}: Props) {
  return (
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
          onClick={onApplyOrder}
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
  );
}
