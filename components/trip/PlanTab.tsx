"use client";

import { useState } from "react";
import type { TripPlan } from "@/lib/itinerary";
import type { PlanOp } from "@/lib/planOps";
import { dayDate, sortTickets, ticketOnDate } from "@/lib/tickets";
import type { Ticket } from "@/lib/tripShared";
import { DayCard } from "./DayCard";

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
  tickets: Ticket[];
  checkedBy: Map<string, string>;
  isMember: boolean;
  /** Day number of today, or null when the trip has no start date or is not running. */
  todayIndex: number | null;
  onToggle(key: string, checked: boolean): void;
  onPlanOp(op: PlanOp): Promise<string | null>;
}

type View = "list" | "map";

export function PlanTab({
  plan,
  startDate,
  tickets,
  checkedBy,
  isMember,
  todayIndex,
  onToggle,
  onPlanOp,
}: Props) {
  const [view, setView] = useState<View>("list");
  const [newDayDest, setNewDayDest] = useState("");
  const [addingDay, setAddingDay] = useState(false);
  const [addDayError, setAddDayError] = useState<string | null>(null);

  // Destinations already in the plan, de-duplicated in first-appearance order —
  // the only sensible choices for "add a day in…".
  const destinationOptions = (() => {
    const seen = new Map<string, string>();
    plan.days.forEach((d) => seen.set(d.destinationId, d.destinationName));
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  })();

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
        aria-label="Switch between the day list and the route map"
        className="flex gap-1 print:hidden"
      >
        {(["list", "map"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setView(option)}
            aria-pressed={view === option}
            className={`min-h-[var(--tap-min)] rounded-lg px-3 text-sm font-semibold transition-colors ${
              view === option ? "bg-sky text-rail-deep" : "text-ink-soft hover:bg-mist"
            }`}
          >
            {option === "list" ? "📋 Days" : "🗺️ Route"}
          </button>
        ))}
      </div>

      {view === "map" ? (
        // Placeholder until Task 30 supplies CountryMap. Deliberately not a
        // spinner or an empty box: a panel that says what it will be is honest,
        // where a loading state would imply something is on its way.
        <div className="rounded-xl border border-dashed border-sky bg-paper p-8 text-center">
          <p className="font-display text-base font-semibold">Route map</p>
          <p className="mt-1 text-sm text-ink-soft">
            The map view arrives with the country map. Use Days for now.
          </p>
        </div>
      ) : (
        <>
          {!startDate && tickets.some((t) => t.date) && (
            <p className="rounded-lg border border-dashed border-rail/40 bg-paper px-4 py-2 text-xs text-ink-soft">
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
                className="rounded-lg border border-dashed border-rail/50 px-4 py-2 text-sm font-semibold text-rail transition-colors hover:bg-sky disabled:opacity-40"
              >
                {addingDay ? "Adding…" : "+ Add day"}
              </button>
              <span className="text-xs text-ink-soft">in</span>
              <select
                value={newDayDest}
                onChange={(e) => setNewDayDest(e.target.value)}
                aria-label="Destination for the new day"
                className="rounded-lg border border-sky bg-paper px-2 py-1.5 text-sm text-ink"
              >
                <option value="">Same as last day</option>
                {destinationOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {addDayError && <span className="text-xs text-seal">{addDayError}</span>}
            </div>
          )}
        </>
      )}

      {plan.tips.length > 0 && (
        <div className="rounded-xl border border-sky bg-paper p-5 text-sm">
          <p className="font-semibold">Good to know</p>
          <ul className="mt-2 space-y-1.5">
            {plan.tips.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span aria-hidden className="text-seal">
                  ※
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
