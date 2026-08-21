"use client";

import { INTERESTS, SEASONS } from "@/lib/meta";
import type { Interest, Season } from "@/lib/types";

interface Props {
  season: Season;
  onSeason: (s: Season) => void;
  days: number;
  onDays: (d: number) => void;
  maxDays: number;
  adults: number;
  onAdults: (n: number) => void;
  kids: number;
  onKids: (n: number) => void;
  interests: Interest[];
  onToggleInterest: (i: Interest) => void;
}

const DAY_PRESETS = [3, 5, 7, 10, 14];

export function DetailsStep({
  season,
  onSeason,
  days,
  onDays,
  maxDays,
  adults,
  onAdults,
  kids,
  onKids,
  interests,
  onToggleInterest,
}: Props) {
  return (
    <section className="space-y-8">
      <div>
        <h2 className="font-display text-2xl font-bold">Shape the trip</h2>
        <p className="mt-1 text-sm text-[var(--ink-2)]">
          Season and interests steer which activities make the schedule.
        </p>
      </div>

      <fieldset>
        <legend className="font-display text-base font-semibold">When are you going?</legend>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SEASONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSeason(s.id)}
              aria-pressed={season === s.id}
              className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ink)] ${
                season === s.id
                  ? "border-[var(--accent-ink)] bg-[var(--line-1)]/50 shadow-sm"
                  : "border-[var(--line-1)] bg-[var(--paper)] hover:border-[var(--accent-ink)]/50"
              }`}
            >
              <span aria-hidden className="text-2xl">{s.emoji}</span>
              <p className="mt-1 font-semibold">{s.label}</p>
              <p className="font-mono text-xs text-[var(--ink-2)]">{s.months}</p>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-base font-semibold">How many days?</legend>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {DAY_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onDays(d)}
              aria-pressed={days === d}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                days === d ? "bg-[var(--accent-ink)] text-[var(--paper)]" : "bg-[var(--paper)] text-[var(--ink-2)] hover:bg-[var(--line-1)]"
              }`}
            >
              {d} days
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-sm text-[var(--ink-2)]">
            Custom
            <input
              type="number"
              min={1}
              max={maxDays}
              value={days}
              onChange={(e) => onDays(Number(e.target.value) || 1)}
              className="w-20 rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[var(--ink-0)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ink)]"
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-base font-semibold">Who&apos;s going?</legend>
        <div className="mt-3 flex flex-wrap gap-4">
          <Counter label="Adults" value={adults} min={1} onChange={onAdults} />
          <Counter label="Kids" value={kids} min={0} onChange={onKids} />
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-display text-base font-semibold">
          What do you love doing?
        </legend>
        <p className="mt-1 text-xs text-[var(--ink-2)]">
          Optional — leave everything off and we&apos;ll build around the must-sees.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const on = interests.includes(i.id);
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => onToggleInterest(i.id)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ink)] ${
                  on
                    ? "border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--paper)]"
                    : "border-[var(--line-1)] bg-[var(--paper)] text-[var(--ink-0)] hover:border-[var(--accent-ink)]/50"
                }`}
              >
                <span aria-hidden>{i.emoji}</span>
                {i.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

function Counter({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] px-4 py-2.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--line-1)] font-mono text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-ink)] hover:text-[var(--paper)] disabled:opacity-40 disabled:hover:bg-[var(--line-1)] disabled:hover:text-[var(--accent-ink)]"
        >
          −
        </button>
        <span className="w-6 text-center font-mono font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          aria-label={`More ${label.toLowerCase()}`}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--line-1)] font-mono text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-ink)] hover:text-[var(--paper)]"
        >
          +
        </button>
      </div>
    </div>
  );
}
