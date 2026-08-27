"use client";

import { useMemo, useState } from "react";
import { DayBuilder } from "@/components/plan/DayBuilder";
import { GapNote } from "@/components/plan/GapNote";
import { getCountryProfile } from "@/lib/countryProfile";
import { DESTINATIONS } from "@/lib/data";
import type { TripPlan } from "@/lib/itinerary";
import type { PlanOp } from "@/lib/planOps";
import { dayDate, sortTickets, ticketOnDate } from "@/lib/tickets";
import type { Ticket, TripPayload } from "@/lib/tripShared";
import type { Activity, Season } from "@/lib/types";
import { DayCard } from "./DayCard";
import { RouteMap } from "./RouteMap";

/**
 * Plan (spec §2.1): the day-by-day itinerary, with the route map as a *view*
 * inside it rather than a tab of its own.
 *
 * Absorbs the old Itinerary tab body — the DayCard loop, the start-date hint and
 * the add-day controls, whose state lives here now rather than in TripView. Also
 * hosts the "Good to know" tips block moved down from the Crew tab: tips are
 * generation-time planning content, and Crew was a leftovers bin (J4).
 *
 * Additive — TripView does not render this until Task 12.
 */
interface Props {
  plan: TripPlan;
  startDate: string | null;
  /** ISO alpha-2 of the country being travelled — the Route map needs it. */
  country: string;
  season: Season;
  tickets: Ticket[];
  checkedBy: Map<string, string>;
  isMember: boolean;
  /** Day number of today, or null when the trip has no start date or is not running. */
  todayIndex: number | null;
  onToggle(key: string, checked: boolean): void;
  onPlanOp(op: PlanOp): Promise<string | null>;
  /** Present for members only — the day builder needs the whole payload. */
  tripId?: string;
  payload?: TripPayload;
  /** The accessor's forced-apply counter — see useDayBuilder's payload effect. */
  forcedAt?: number;
  mutate?: (url: string, init: RequestInit) => Promise<string | null>;
}

/**
 * "build" is the member editing surface (Task 24). It is a third view rather
 * than a replacement for "list": the DayCard list carries per-day tickets and
 * the add-day controls, which the builder does not, so swapping it out would
 * lose them. Guests never see this option, and DayCard stays their renderer
 * and the print one (J13).
 */
type View = "list" | "map" | "build";

export function PlanTab({
  plan,
  startDate,
  country,
  season,
  tickets,
  checkedBy,
  isMember,
  todayIndex,
  onToggle,
  onPlanOp,
  tripId,
  payload,
  forcedAt = 0,
  mutate,
}: Props) {
  /**
   * The honesty surface, resolved from the trip's country at render and never
   * from `plan`.
   *
   * `country` is `tripCountry(data)`, handed down by TripView. Reading it here
   * rather than snapshotting a note into `plan` is the whole point: `plan.tips`
   * is frozen when the trip is created, and this is a claim about our current
   * coverage rather than about the trip, so it must shrink as the data
   * improves. Empty for China and for any code that is not a country.
   */
  const gapNote = getCountryProfile(country).gapNote;
  const [view, setView] = useState<View>("list");
  const [newDayDest, setNewDayDest] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [addDayError, setAddDayError] = useState<string | null>(null);
  /**
   * Once opened the builder stays mounted, hidden rather than destroyed.
   *
   * Its queue lives in the hook's reducer, and ops leave one at a time — each
   * waits for the previous round-trip — so anything queued behind the one in
   * flight dies with the component. Switching to Days after a burst of edits
   * dropped them with no error, and the optimistic copy on screen made it look
   * as though they had landed. `hidden` keeps the effect draining while taking
   * the whole subtree out of the accessibility tree and the tab order.
   */
  const [builderOpened, setBuilderOpened] = useState(false);

  // Destinations already in the plan, de-duplicated in first-appearance order —
  // the only sensible choices for "add a day in…".
  const destinationOptions = (() => {
    const seen = new Map<string, string>();
    plan.days.forEach((d) => seen.set(d.destinationId, d.destinationName));
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  })();

  // The builder needs the whole payload and the accessor's mutate, which only a
  // member's TripView passes. Guests never get the option.
  const canBuild = isMember && tripId !== undefined && payload !== undefined && mutate !== undefined;

  /**
   * Activities per destination id, for the shelf. Curated destinations only —
   * a catalog city's activities were baked into its plan items at generation and
   * the Destination object is not stored, so its shelf holds just the custom row.
   * J6 puts catalog attractions for arbitrary cities out of scope for this PR.
   */
  const activitiesByDestination = useMemo(() => {
    const map: Record<string, readonly Activity[]> = {};
    for (const day of plan.days) {
      if (map[day.destinationId]) continue;
      const curated = DESTINATIONS.find((d) => d.id === day.destinationId);
      if (curated) map[day.destinationId] = curated.activities;
    }
    return map;
  }, [plan.days]);

  const addDay = async () => {
    if (addingDay) return;
    setAddingDay(true);
    setAddDayError(null);
    const err = await onPlanOp({ op: "addDay", destinationId: newDayDest || undefined });
    setAddingDay(false);
    if (err) setAddDayError(err);
  };

  return (
    <div className="mt-5 space-y-5">
      <div
        role="group"
        aria-label="Switch between the day list, the route map and the day builder"
        className="flex gap-1 print:hidden"
      >
        {(canBuild ? (["list", "build", "map"] as const) : (["list", "map"] as const)).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              if (option === "build") setBuilderOpened(true);
              setView(option);
            }}
            aria-pressed={view === option}
            className={`min-h-[var(--tap-min)] rounded-lg px-3 text-sm font-semibold transition-colors ${
              view === option ? "bg-[var(--line-1)] text-[var(--accent-ink)]" : "text-[var(--ink-2)] hover:bg-[var(--surf-1)]"
            }`}
          >
            {option === "list" ? "📋 Days" : option === "build" ? "🧱 Build" : "🗺️ Route"}
          </button>
        ))}
      </div>

      {canBuild && builderOpened && (
        <div hidden={view !== "build"}>
          <DayBuilder
            tripId={tripId}
            payload={payload}
            forcedAt={forcedAt}
            mutate={mutate}
            activitiesByDestination={activitiesByDestination}
          />
        </div>
      )}

      {/* Build renders nothing here — the block above owns it, mounted or hidden. */}
      {view === "build" && canBuild ? null : view === "map" ? (
        // Spec §2.1's "map ⇄ list toggle *inside* Plan", which is the whole
        // justification for Route not being a nav tab. Read-only: the plan
        // already exists, so this draws it rather than offering a picker.
        <RouteMap plan={plan} country={country} startDate={startDate} season={season} />
      ) : (
        <>
          {!startDate && tickets.some((t) => t.date) && (
            <p className="rounded-lg border border-dashed border-[var(--accent-ink)]/40 bg-[var(--paper)] px-4 py-2 text-xs text-[var(--ink-2)]">
              💡 Set a trip start date to see tickets pinned to their days.
            </p>
          )}
          {plan.days.map((day) => {
            const date = dayDate(startDate, day.day);
            const dayTickets = date
              ? sortTickets(tickets.filter((t) => ticketOnDate(t, date)))
              : [];
            return (
              <DayCard
                key={day.day}
                day={day}
                isToday={todayIndex === day.day}
                tickets={dayTickets}
                checkedBy={checkedBy}
                isMember={isMember}
                onToggle={onToggle}
                onOp={onPlanOp}
              />
            );
          })}
          {isMember && (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => void addDay()}
                disabled={addingDay}
                className="rounded-lg border border-dashed border-[var(--accent-ink)]/50 px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--line-1)] disabled:opacity-40"
              >
                {addingDay ? "Adding…" : "+ Add day"}
              </button>
              <span className="text-xs text-[var(--ink-2)]">in</span>
              <select
                value={newDayDest}
                onChange={(e) => setNewDayDest(e.target.value)}
                aria-label="Destination for the new day"
                className="rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-2 py-1.5 text-sm text-[var(--ink-0)]"
              >
                <option value="">Same as last day</option>
                {destinationOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {/*
                Rendered unconditionally, empty and all. A live region created
                in the same tick as its first content is unreliably announced —
                the region has to already be in the tree for the insertion to
                register as a change. Conditional rendering was why a failed
                add-day was silent to a screen reader.
              */}
              <span role="status" aria-live="polite" className="text-xs text-[var(--seal)]">
                {addDayError}
              </span>
            </div>
          )}
        </>
      )}

      {(plan.tips.length > 0 || gapNote.length > 0) && (
        <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5 text-sm">
          <p className="font-semibold">Good to know</p>
          {plan.tips.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {plan.tips.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span aria-hidden className="text-[var(--seal)]">
                    ※
                  </span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          )}
          {/*
            Outside the list, deliberately. A country whose tips list is empty
            is the one that most needs the explanation, which is why the block
            now opens on either condition rather than on tips alone.
          */}
          <GapNote lines={gapNote} />
        </div>
      )}
    </div>
  );
}
