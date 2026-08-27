"use client";

import { useCallback, useMemo, useRef } from "react";
import { getCountryBaseProfile } from "@/lib/countryBaseProfile";
import { SEASON_EMOJI } from "@/lib/meta";
import { bandsIn, MONTHS } from "@/lib/months";

interface Props {
  month: number;
  onMonth: (month: number) => void;
  /**
   * The country being planned.
   *
   * Load-bearing, not decorative. This scrubber read `HOLIDAY_BANDS` and
   * `crowdForMonth` straight out of lib/months.ts, both of which are China's
   * and only China's — so a traveller picking Peruvian cities and dragging to
   * October was told about "National Day Golden Week 🇨🇳", February showed
   * "Chinese New Year 🧧", and every month carried China's crowd curve under a
   * label reading *typical national crowd pressure*. Everything month-shaped
   * below now comes from `getCountryBaseProfile(country)`, including the season
   * word: MONTHS[].season is the northern table, which calls Peru's June
   * summer while the plan the same wizard builds says winter.
   */
  country: string;
}

/** Draggable Jan–Dec scrubber with the open country's holiday/crowd bands. */
export function MonthTimeline({ month, onMonth, country }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const monthFromClientX = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 1;
    const frac = Math.min(0.9999, Math.max(0, (clientX - rect.left) / rect.width));
    return 1 + Math.floor(frac * 12);
  }, []);

  const handlePointer = useCallback(
    (e: React.PointerEvent) => {
      onMonth(monthFromClientX(e.clientX));
    },
    [monthFromClientX, onMonth]
  );

  const profile = useMemo(() => getCountryBaseProfile(country), [country]);
  const info = MONTHS[month - 1];
  const season = profile.seasonOfMonth(month);
  // Absent, never flat: a country with no researched crowd curve renders no
  // crowd element at all rather than a row of three-out-of-five dots, which
  // would be a claim that every month there is equally busy. See
  // `CountryBaseProfile.crowdByMonth`.
  const crowd = profile.crowdByMonth?.[month - 1] ?? null;
  const holidays = profile.holidays;
  const activeBands = bandsIn(holidays, month);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">
          {SEASON_EMOJI[season]} {info.label}
          <span className="ml-2 font-normal capitalize text-[var(--ink-2)]">{season}</span>
        </p>
        {crowd !== null && (
          <p
            className="text-xs text-[var(--ink-2)]"
            title="Typical national crowd pressure this month"
          >
            Crowds{" "}
            <span aria-label={`${crowd} out of 5`} className="tracking-tighter">
              {"●".repeat(crowd)}
              {"○".repeat(5 - crowd)}
            </span>
          </p>
        )}
      </div>

      <div
        ref={trackRef}
        className="relative mt-2 cursor-pointer touch-none select-none"
        role="slider"
        tabIndex={0}
        aria-label="Month of travel"
        aria-valuemin={1}
        aria-valuemax={12}
        aria-valuenow={month}
        aria-valuetext={info.label}
        onPointerDown={(e) => {
          draggingRef.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic or already-released pointers can't be captured — dragging
            // still works, it just won't track outside the element.
          }
          handlePointer(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) handlePointer(e);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onMonth(month === 1 ? 12 : month - 1);
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onMonth(month === 12 ? 1 : month + 1);
          }
        }}
      >
        {/* Holiday bands */}
        <div className="relative h-2.5">
          {holidays.map((b) => (
            <span
              key={b.name}
              title={`${b.emoji} ${b.name}: ${b.note}`}
              className="absolute top-0 h-2 rounded-full bg-[var(--seal)]"
              style={{
                left: `${(b.from / 12) * 100}%`,
                width: `${((b.to - b.from) / 12) * 100}%`,
                opacity: b.crowd >= 5 ? 0.75 : 0.4,
              }}
            />
          ))}
        </div>

        {/* Month segments */}
        <div className="flex overflow-hidden rounded-lg border border-[var(--line-1)] bg-[var(--surf-1)]">
          {MONTHS.map((m) => {
            const isActive = m.id === month;
            return (
              <span
                key={m.id}
                className={`flex-1 border-r border-[var(--line-1)]/60 py-1.5 text-center font-mono text-[11px] uppercase last:border-r-0 ${
                  isActive
                    ? "bg-[var(--accent-ink)] font-bold text-[var(--paper)]"
                    : "text-[var(--ink-2)] hover:bg-[var(--line-1)]/50"
                }`}
              >
                {m.short}
              </span>
            );
          })}
        </div>
      </div>

      {activeBands.length > 0 && (
        <ul className="mt-2 space-y-1">
          {activeBands.map((b) => (
            <li key={b.name} className="text-xs text-[var(--ink-2)]">
              <span className="mr-1">{b.emoji}</span>
              <span className="font-semibold text-[var(--ink-0)]">{b.name}:</span> {b.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
