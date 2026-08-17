"use client";

import { useMemo } from "react";
import { DURATION_STEP, dayLoad, formatClock, formatSpan, reflow, type ReflowedItem } from "@/lib/timeline";
import type { TripPayload } from "@/lib/tripShared";
import type { Activity } from "@/lib/types";
import { useDayBuilder, type DayBuilderApi } from "./useDayBuilder";

/**
 * The member editing surface for a day (spec §3.2.4-6, §8): a places shelf on one
 * side, the target day's blocks on the other, and an explicit target chip so a
 * `+` tap lands somewhere the user chose rather than wherever they happen to be
 * scrolled.
 *
 * `DayCard` stays the read-only renderer for guests and print (J13) — this never
 * mounts for them.
 *
 * State lives entirely in the reducer (C3). Nothing here computes a transition;
 * layout reads `state` and calls the api. The one thing worth knowing before
 * reading further: **no stored item has timing**, because `buildItinerary` has
 * never set `startMinutes`. So the primary affordance on an untimed item is "give
 * it a time", not "adjust its time" — without that the ±15m controls would have
 * nothing to act on and time blocks would look broken on every existing trip.
 */

interface Props {
  tripId: string;
  payload: TripPayload;
  mutate(url: string, init: RequestInit): Promise<string | null>;
  activitiesByDestination: Readonly<Record<string, readonly Activity[]>>;
}

/** Where a block lands when an untimed item is given its first time: 09:00, 1h. */
const FIRST_BLOCK_START = 540;
const FIRST_BLOCK_DURATION = 60;

export function DayBuilder({ tripId, payload, mutate, activitiesByDestination }: Props) {
  const api = useDayBuilder({ tripId, payload, mutate, activitiesByDestination });
  const { state } = api;

  const target = state.days[state.targetDay - 1];
  // reflow is read-time only. Its output is never written back — it normalises
  // every overlap it finds, including ones already in storage.
  const view = useMemo(() => reflow(target?.items ?? []), [target]);
  const load = useMemo(() => dayLoad(view), [view]);

  if (!target) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-sky bg-paper p-4 text-sm text-ink-soft">
        This trip has no days yet.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {state.error !== null && (
        <p role="alert" className="mb-3 rounded-lg border border-seal/50 bg-seal/5 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <TargetDayChip api={api} />

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <ShelfPanel api={api} />

        <section aria-labelledby="day-blocks">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="day-blocks" className="font-display text-base font-semibold">
              Day {String(target.day).padStart(2, "0")} · {target.destinationName}
            </h3>
            {/* The §3.2.6 readout. */}
            <p className="text-xs text-ink-soft">
              {formatSpan(load.plannedMinutes)} planned
              {load.gaps > 0 && ` · ${load.gaps} gap${load.gaps === 1 ? "" : "s"}`}
            </p>
          </div>

          {view.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-sky bg-paper p-4 text-sm text-ink-soft">
              Nothing here yet — add something from the shelf.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {view.map((entry, index) => (
                <TimeBlock
                  key={entry.id}
                  entry={entry}
                  api={api}
                  isFirst={index === 0}
                  isLast={index === view.length - 1}
                />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * "Adding to Day 03" — the explicit routing target (spec §3.2.4).
 *
 * Rendered as radios rather than a select: the whole point is that the
 * destination of a `+` tap is visible without opening anything.
 */
function TargetDayChip({ api }: { api: DayBuilderApi }) {
  const { state } = api;
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Which day new places are added to</legend>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Adding to
      </span>
      {state.days.map((day) => {
        const isTarget = day.day === state.targetDay;
        return (
          <label
            key={day.day}
            className={`flex min-h-[var(--tap-min)] cursor-pointer items-center rounded-full px-3 text-sm font-medium ${
              isTarget ? "bg-rail text-white" : "bg-paper text-ink-soft hover:bg-sky"
            }`}
          >
            <input
              type="radio"
              name="target-day"
              className="sr-only"
              checked={isTarget}
              onChange={() => api.setTargetDay(day.day)}
            />
            Day {String(day.day).padStart(2, "0")}
          </label>
        );
      })}
    </fieldset>
  );
}

/** The shelf: unscheduled activities for the target day's destination, plus a custom row. */
function ShelfPanel({ api }: { api: DayBuilderApi }) {
  const { state } = api;
  const rows = state.shelf.filter((row) => !row.isCustom);
  const custom = state.shelf.find((row) => row.isCustom);

  return (
    <section aria-labelledby="shelf-heading" className="rounded-xl border border-sky bg-paper p-3">
      <h3 id="shelf-heading" className="font-display text-base font-semibold">
        Places to add
      </h3>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">
          Everything for this destination is already on the plan.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
              {/* The primary add: one tap, no modal, no navigation (§3.2.4). */}
              <button
                type="button"
                onClick={() => api.addFromShelf(row.key)}
                aria-label={`Add ${row.title} to day ${state.targetDay}`}
                className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center rounded-lg border border-dashed border-rail/50 text-lg font-semibold text-rail transition-colors hover:bg-sky"
              >
                +
              </button>
            </li>
          ))}
        </ul>
      )}

      {custom && (
        <div className="mt-3 border-t border-sky pt-2">
          <label htmlFor="shelf-custom" className="text-xs font-semibold text-ink-soft">
            Something else
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="shelf-custom"
              type="text"
              value={state.customDraft}
              onChange={(event) => api.setCustomDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                api.addFromShelf("custom");
              }}
              placeholder="Anything you like"
              className="min-h-[var(--tap-min)] w-full min-w-0 rounded-lg border border-sky px-2 text-sm"
            />
            <button
              type="button"
              onClick={() => api.addFromShelf("custom")}
              disabled={custom.title === ""}
              aria-label={`Add your own place to day ${state.targetDay}`}
              className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center rounded-lg border border-dashed border-rail/50 text-lg font-semibold text-rail transition-colors hover:bg-sky disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One item: a timed block with ±15m controls, or an untimed item in its slot band.
 *
 * Every control is a real button, which is the keyboard path spec §3.2.5 requires
 * as the accessible equivalent of dragging — not an afterthought bolted beside it.
 */
function TimeBlock({
  entry,
  api,
  isFirst,
  isLast,
}: {
  entry: ReflowedItem;
  api: DayBuilderApi;
  isFirst: boolean;
  isLast: boolean;
}) {
  const timed =
    typeof entry.startMinutes === "number" &&
    typeof entry.durationMinutes === "number" &&
    entry.durationMinutes > 0;

  return (
    <li className="rounded-xl border border-sky bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        {timed ? (
          <span className="font-mono text-sm font-semibold">
            {formatClock(entry.startMinutes as number)}
          </span>
        ) : (
          // Untimed items keep their slot band — spec §5.3 forbids inventing a
          // start, so the band is all the position information there is.
          <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-soft">
            {entry.slot}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>

        {entry.pushedBy !== undefined && (
          <span
            className="shrink-0 rounded bg-sky px-1.5 py-0.5 text-[10px] text-rail-deep"
            title={`Moved later to clear the block above it`}
          >
            pushed
          </span>
        )}
        {entry.overflows === true && (
          <span className="shrink-0 rounded bg-seal/10 px-1.5 py-0.5 text-[10px] text-seal">
            past midnight
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {timed ? (
          <>
            <span className="mr-1 text-xs text-ink-soft">
              {formatSpan(entry.durationMinutes as number)}
            </span>
            <BlockButton
              label={`Shorten ${entry.title} by 15 minutes`}
              onClick={() => api.adjustTiming(entry.id, -DURATION_STEP)}
            >
              −15m
            </BlockButton>
            <BlockButton
              label={`Lengthen ${entry.title} by 15 minutes`}
              onClick={() => api.adjustTiming(entry.id, DURATION_STEP)}
            >
              +15m
            </BlockButton>
            <BlockButton
              label={`Remove the time from ${entry.title}`}
              onClick={() => api.clearBlock(entry.id)}
            >
              Untime
            </BlockButton>
          </>
        ) : (
          // The affordance every existing trip needs: nothing is timed yet, so
          // this is how a block comes into being at all.
          <BlockButton
            label={`Give ${entry.title} a time`}
            onClick={() => api.setBlock(entry.id, FIRST_BLOCK_START, FIRST_BLOCK_DURATION)}
          >
            Set a time
          </BlockButton>
        )}

        <span className="ml-auto flex items-center gap-1">
          <BlockButton
            label={`Move ${entry.title} up`}
            disabled={isFirst}
            onClick={() => api.moveBlock(entry.id, "up")}
          >
            ↑
          </BlockButton>
          <BlockButton
            label={`Move ${entry.title} down`}
            disabled={isLast}
            onClick={() => api.moveBlock(entry.id, "down")}
          >
            ↓
          </BlockButton>
        </span>
      </div>
    </li>
  );
}

function BlockButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] items-center justify-center rounded-lg border border-sky px-2 text-xs font-semibold text-ink-soft transition-colors hover:border-rail hover:text-rail disabled:opacity-40 disabled:hover:border-sky disabled:hover:text-ink-soft"
    >
      {children}
    </button>
  );
}
