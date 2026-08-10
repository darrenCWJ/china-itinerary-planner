"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SyncDevices } from "@/components/home/SyncDevices";
import {
  forgetMyTrip,
  loadMyTrips,
  localTodayIso,
  pickNextTrip,
  removeMyTrip,
  tripEndDate,
  tripPhase,
  type MyTrip,
  type TripPhase,
} from "@/lib/myTrips";
import { forgetTripEverywhere, loadWalletCode, syncWallet } from "@/lib/walletSync";

function phaseLabel(phase: TripPhase, days: number): string {
  switch (phase.kind) {
    case "upcoming":
      return phase.daysUntil === 1 ? "🛫 Tomorrow!" : `🛫 In ${phase.daysUntil} days`;
    case "ongoing":
      return `📍 Day ${phase.dayNumber} of ${days} — happening now`;
    case "past":
      return "✔ Past trip";
    case "undated":
      return "📅 No date set";
  }
}

function dateRange(trip: MyTrip): string | null {
  if (!trip.startDate) return null;
  const end = tripEndDate(trip);
  return end && end !== trip.startDate ? `${trip.startDate} → ${end}` : trip.startDate;
}

/**
 * "Your trips" — trips this device created or joined, remembered locally.
 * Renders nothing until hydrated (and nothing at all for first-time visitors).
 */
export function TripsDashboard() {
  const [trips, setTrips] = useState<MyTrip[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const local = loadMyTrips();
    setTrips(local);
    const code = loadWalletCode();
    if (!code) return;
    // Linked device: pull the wallet, merge, and push back any local news.
    let cancelled = false;
    void syncWallet(code, local).then((result) => {
      if (cancelled) return;
      setTrips(result.trips);
      setSyncError(result.ok ? null : result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!trips) return null;

  const today = localTodayIso();
  const next = pickNextTrip(trips, today);
  const others = trips.filter((t) => t.id !== next?.id);
  const isLinked = Boolean(loadWalletCode());

  const forget = (id: string) => {
    forgetMyTrip(id);
    setTrips((prev) => removeMyTrip(prev ?? [], id));
    void forgetTripEverywhere(id);
  };

  // A fresh device with no trips still needs the link control to pull them.
  if (trips.length === 0) {
    return (
      <section aria-label="Your trips" className="mb-8">
        <SyncDevices onSynced={setTrips} />
        {syncError && <p className="mt-1 text-xs text-seal">{syncError}</p>}
      </section>
    );
  }

  return (
    <section aria-label="Your trips" className="mb-8">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold">Your trips</h2>
        <p className="text-xs text-ink-soft">
          {isLinked ? "synced across your devices" : "remembered on this device"}
        </p>
      </div>

      {next && (
        <Link
          href={`/trip/${next.id}`}
          className="group mt-3 block overflow-hidden rounded-xl border-2 border-seal bg-paper shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-stretch">
            <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 bg-seal py-5 text-white">
              <span aria-hidden className="font-kai text-2xl">游</span>
              <span className="font-mono text-[9px] uppercase tracking-widest">Next</span>
            </div>
            <div className="min-w-0 flex-1 border-l-2 border-dashed border-sky px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-display text-lg font-bold group-hover:text-rail-deep">
                  {next.name}
                </p>
                <p className="font-mono text-xs font-semibold text-seal">
                  {phaseLabel(tripPhase(next, today), next.days)}
                </p>
              </div>
              <p className="mt-0.5 truncate font-mono text-sm uppercase tracking-wide text-ink-soft">
                {next.destinations.join(" → ")}
              </p>
              <p className="mt-1.5 text-xs text-ink-soft">
                {dateRange(next) ?? `${next.days} days — set a start date on the trip page`}
                <span className="ml-2 font-semibold text-rail">Open trip →</span>
              </p>
            </div>
          </div>
        </Link>
      )}

      {others.length > 0 && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((t) => {
            const phase = tripPhase(t, today);
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-sky bg-paper px-3 py-2"
              >
                <Link href={`/trip/${t.id}`} className="min-w-0 flex-1 hover:text-rail-deep">
                  <p className="truncate text-sm font-semibold">{t.name}</p>
                  <p className="truncate text-[11px] text-ink-soft">
                    {phaseLabel(phase, t.days)}
                    {dateRange(t) ? ` · ${dateRange(t)}` : ""}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => forget(t.id)}
                  aria-label={`Forget "${t.name}" on this device`}
                  title="Forget on this device (the trip itself is not deleted)"
                  className="h-6 w-6 shrink-0 rounded text-xs text-ink-soft transition-colors hover:bg-sky hover:text-seal"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <SyncDevices onSynced={setTrips} />
      {syncError && <p className="mt-1 text-xs text-seal">{syncError}</p>}
    </section>
  );
}
