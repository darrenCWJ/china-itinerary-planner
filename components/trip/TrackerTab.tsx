"use client";

import { useEffect, useMemo, useState } from "react";
import { getDestination } from "@/lib/data";
import { latLonOf } from "@/lib/geo";
import { expensesOnDate, formatMinor, totalsByCurrency } from "@/lib/money";
import { dayDate } from "@/lib/tickets";
import {
  citiesSoFar,
  nowNext,
  progress,
  railKmSoFar,
  slotForHour,
  todayIso,
  trackerState,
} from "@/lib/tracker";
import { itemCheckKey, packingCheckKey, type TripPayload } from "@/lib/tripShared";
import { JournalSection, type JournalDraft } from "./JournalSection";

type Props = {
  payload: TripPayload;
  myName: string;
  isMember: boolean;
  onToggle: (key: string, checked: boolean) => void;
  onAddJournal: (d: JournalDraft) => Promise<string | null>;
  onUpdateJournal: (id: string, d: Partial<JournalDraft>) => Promise<string | null>;
  onDeleteJournal: (id: string) => Promise<string | null>;
  onOpenMoney: () => void;
};

const MINUTE_MS = 60_000;

export function TrackerTab({
  payload,
  myName,
  isMember,
  onToggle,
  onAddJournal,
  onUpdateJournal,
  onDeleteJournal,
  onOpenMoney,
}: Props) {
  // Re-render every minute so "now / next" tracks the clock, not just polls.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  const { data, checks, expenses, journal } = payload;
  const days = data.plan.days;
  const today = todayIso(now);
  const state = trackerState(data.startDate, days.length, today);
  const checkedKeys = useMemo(() => new Set(checks.map((c) => c.key)), [checks]);

  const overall = progress(days, checkedKeys);
  const photoUploads = payload.features?.photoUploads ?? false;

  const journalSection = (
    <JournalSection
      tripId={payload.id}
      journal={journal}
      myName={myName}
      isMember={isMember}
      photoUploads={photoUploads}
      defaultDate={today}
      onAdd={onAddJournal}
      onUpdate={onUpdateJournal}
      onDelete={onDeleteJournal}
    />
  );

  if (state.phase === "no-date" || state.phase === "before") {
    const packingTotal = data.packing.reduce((a, g) => a + g.items.length, 0);
    const packingDone = data.packing.reduce(
      (a, g) => a + g.items.filter((i) => checkedKeys.has(packingCheckKey(g.title, i))).length,
      0
    );
    return (
      <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5 text-center">
          {state.phase === "before" ? (
            <>
              <p className="font-display text-3xl font-bold text-[var(--accent-ink)]">
                {state.daysToGo} day{state.daysToGo === 1 ? "" : "s"} to go
              </p>
              <p className="mt-1 text-sm text-[var(--ink-2)]">
                {data.tripName} departs {data.startDate}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-xl font-semibold">No start date yet</p>
              <p className="mt-1 text-sm text-[var(--ink-2)]">
                Set one when creating or editing the trip and this tab becomes a live countdown,
                then a day-by-day tracker.
              </p>
            </>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-[var(--surf-1)] p-3">
              <p className="font-semibold tabular-nums">
                {packingDone}/{packingTotal}
              </p>
              <p className="text-xs text-[var(--ink-2)]">packing ticked</p>
            </div>
            <div className="rounded-lg bg-[var(--surf-1)] p-3">
              <p className="font-semibold tabular-nums">{payload.tickets.length}</p>
              <p className="text-xs text-[var(--ink-2)]">tickets on file</p>
            </div>
          </div>
        </div>
        {journalSection}
      </div>
    );
  }

  const doneIndex = state.phase === "after" ? days.length : state.dayIndex!;
  const cities = citiesSoFar(days, doneIndex);
  const km = railKmSoFar(days, doneIndex, (id) => {
    const d = getDestination(id);
    // An off-map destination resolves to null, so railKmSoFar skips the leg
    // rather than inventing a distance for it.
    return d ? latLonOf(d) : null;
  });
  const tripTotals = totalsByCurrency(expenses);

  const statsStrip = (
    <div className="grid grid-cols-2 gap-3 text-center text-sm sm:grid-cols-4">
      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
        <p className="font-display text-xl font-bold text-[var(--accent-ink)]">{cities.length}</p>
        <p className="text-xs text-[var(--ink-2)]">cities reached</p>
      </div>
      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
        <p className="font-display text-xl font-bold text-[var(--accent-ink)]">{km > 0 ? `${km} km` : "—"}</p>
        <p className="text-xs text-[var(--ink-2)]">by rail so far</p>
      </div>
      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
        <p className="font-display text-xl font-bold text-[var(--accent-ink)]">
          {overall.done}/{overall.total}
        </p>
        <p className="text-xs text-[var(--ink-2)]">activities done</p>
      </div>
      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
        <p className="font-display text-xl font-bold text-[var(--accent-ink)]">{journal.length}</p>
        <p className="text-xs text-[var(--ink-2)]">journal entries</p>
      </div>
    </div>
  );

  if (state.phase === "after") {
    return (
      <div className="mt-5 space-y-4">
        <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5 text-center">
          <p className="font-display text-2xl font-bold">That&apos;s a wrap 🏮</p>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            {days.length} days · {cities.join(" → ")}
          </p>
          {tripTotals.length > 0 && (
            <p className="mt-2 text-sm">
              Total spend:{" "}
              {tripTotals.map((t) => formatMinor(t.amount, t.currency)).join(" + ")}
            </p>
          )}
        </div>
        {statsStrip}
        {journalSection}
      </div>
    );
  }

  // During the trip.
  const dayIndex = state.dayIndex!;
  const todayPlan = days.find((d) => d.day === dayIndex) ?? null;
  const slot = slotForHour(now.getHours());
  const guide = todayPlan ? nowNext(todayPlan, checkedKeys, slot) : { current: null, next: null };
  const todaySpend = totalsByCurrency(expensesOnDate(expenses, today));
  const pct = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))] p-5 text-white">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--line-1)]">
          Day {dayIndex} of {days.length}
        </p>
        <p className="mt-1 font-display text-2xl font-bold">
          {todayPlan ? todayPlan.destinationName : data.tripName}
        </p>
        <div className="mt-3 h-2 rounded-full bg-white/20" aria-hidden>
          <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-[var(--line-1)]">
          {overall.done} of {overall.total} activities ticked · {pct}%
        </p>
      </div>

      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5">
        <h3 className="font-display text-lg font-semibold">Now &amp; next</h3>
        {guide.current ? (
          <p className="mt-2 text-sm">
            <span className="rounded bg-seal px-1.5 py-0.5 text-[10px] font-mono text-white">
              NOW
            </span>{" "}
            {guide.current.title}
          </p>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-2)]">Nothing due right now.</p>
        )}
        {guide.next && (
          <p className="mt-1.5 text-sm">
            <span className="rounded bg-[var(--accent-ink)] px-1.5 py-0.5 text-[10px] font-mono text-white">
              NEXT
            </span>{" "}
            {guide.next.title}
          </p>
        )}
        {!guide.current && !guide.next && todayPlan && (
          <p className="mt-1 text-sm">All of today&apos;s plan is ticked off — enjoy! 🎉</p>
        )}
      </div>

      {todayPlan && (
        <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5">
          <h3 className="font-display text-lg font-semibold">
            Today&apos;s plan · {dayDate(data.startDate, dayIndex)}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {todayPlan.items.map((item) => {
              const key = itemCheckKey(item.id);
              const by = checks.find((c) => c.key === key)?.by;
              return (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input type="checkbox" checked={by !== undefined} disabled={!isMember}
                      onChange={(e) => onToggle(key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-[var(--accent-ink)]" />
                    <span className={by ? "text-[var(--ink-2)] line-through" : ""}>
                      <span className="mr-1 font-mono text-[10px] uppercase text-[var(--ink-2)]">
                        {item.slot}
                      </span>
                      {item.title}
                      {by && <span className="ml-1 text-[11px] text-[var(--accent-ink)]"> · {by}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5">
        <h3 className="font-display text-lg font-semibold">Spend</h3>
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-[var(--ink-2)]">Today</p>
            {todaySpend.length === 0 ? (
              <p className="text-[var(--ink-2)]">Nothing yet</p>
            ) : (
              todaySpend.map((t) => (
                <p key={t.currency} className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency)}
                </p>
              ))
            )}
          </div>
          <div>
            <p className="text-xs text-[var(--ink-2)]">Whole trip</p>
            {tripTotals.length === 0 ? (
              <p className="text-[var(--ink-2)]">Nothing yet</p>
            ) : (
              tripTotals.map((t) => (
                <p key={t.currency} className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency)}
                </p>
              ))
            )}
          </div>
        </div>
        <button type="button" onClick={onOpenMoney}
          className="mt-3 text-xs font-medium text-[var(--accent-ink)] hover:underline">
          Open the Money tab →
        </button>
      </div>

      {statsStrip}
      {journalSection}
    </div>
  );
}
