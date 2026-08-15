"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/authClient";
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

/** Shape of `GET /api/me/trips`'s `trips` entries (Task 3's `UserTrip`). */
interface ApiTrip {
  id: string;
  name: string;
  startDate: string | null;
  days: number;
  destinationNames: string[];
  memberName: string;
}

type ServerFetchStatus = "idle" | "loading" | "ready" | "unauthorized" | "error";

/**
 * An account-linked trip has no per-device "role"/"savedAt" concept — the
 * card rendering never reads either field, so inert defaults let it reuse
 * `pickNextTrip`/`tripPhase`/`tripEndDate` and the card JSX unchanged.
 */
function toMyTrip(trip: ApiTrip): MyTrip {
  return {
    id: trip.id,
    name: trip.name,
    startDate: trip.startDate,
    days: trip.days,
    destinations: trip.destinationNames,
    role: "member",
    memberName: trip.memberName,
    savedAt: 0,
  };
}

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

/** The highlighted "next" trip plus a grid of the rest — shared by both data sources. */
function TripCards({
  trips,
  today,
  onForget,
}: {
  trips: MyTrip[];
  today: string;
  onForget?: (id: string) => void;
}) {
  const next = pickNextTrip(trips, today);
  const others = trips.filter((t) => t.id !== next?.id);

  return (
    <>
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
                {onForget && (
                  <button
                    type="button"
                    onClick={() => onForget(t.id)}
                    aria-label={`Forget "${t.name}" on this device`}
                    title="Forget on this device (the trip itself is not deleted)"
                    className="h-6 w-6 shrink-0 rounded text-xs text-ink-soft transition-colors hover:bg-sky hover:text-seal"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function SignInCta() {
  return (
    <Link
      href="/login"
      className="mt-3 inline-block rounded-lg border border-dashed border-rail/40 px-3 py-1.5 text-xs font-semibold text-rail transition-colors hover:bg-sky print:hidden"
    >
      Sign in to see your trips on every device →
    </Link>
  );
}

/**
 * "Your trips" — signed-in accounts get the server-side list from
 * `/api/me/trips` (synced everywhere); signed-out visitors keep the
 * device-local list this page always had, with a nudge to sign in.
 * Renders nothing until hydrated (and nothing at all for first-time visitors).
 */
export function TripsDashboard() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;

  const [localTrips, setLocalTrips] = useState<MyTrip[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerFetchStatus>("idle");
  const [serverTrips, setServerTrips] = useState<MyTrip[]>([]);

  useEffect(() => {
    const local = loadMyTrips();
    setLocalTrips(local);
    const code = loadWalletCode();
    if (!code) return;
    // Linked device: pull the wallet, merge, and push back any local news.
    let cancelled = false;
    void syncWallet(code, local).then((result) => {
      if (cancelled) return;
      setLocalTrips(result.trips);
      setSyncError(result.ok ? null : result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setServerStatus("idle");
      return;
    }
    let cancelled = false;
    setServerStatus("loading");
    fetch("/api/me/trips")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          // Session raced out between the client hook and the request —
          // fall back to the signed-out rendering rather than erroring.
          setServerStatus("unauthorized");
          return;
        }
        if (!res.ok) {
          console.error(`TripsDashboard: /api/me/trips failed (${res.status})`);
          setServerStatus("error");
          return;
        }
        const json: { trips: ApiTrip[] } = await res.json();
        setServerTrips(json.trips.map(toMyTrip));
        setServerStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("TripsDashboard: failed to load trips", error);
        setServerStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const forget = (id: string) => {
    forgetMyTrip(id);
    setLocalTrips((prev) => removeMyTrip(prev ?? [], id));
    void forgetTripEverywhere(id);
  };

  // Signed in and the server list is on its way — render nothing rather
  // than flash the local list first.
  if (userId && (serverStatus === "idle" || serverStatus === "loading")) {
    return null;
  }

  if (userId && serverStatus === "ready") {
    if (serverTrips.length === 0) return null;
    const today = localTodayIso();
    return (
      <section aria-label="Your trips" className="mb-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold">Your trips</h2>
          <p className="text-xs text-ink-soft">synced to your account</p>
        </div>
        <TripCards trips={serverTrips} today={today} />
      </section>
    );
  }

  // Signed out, session raced out (401), or a server-list fetch error — the
  // localStorage list is always the fallback. Only invite sign-in when we
  // know there is no valid session; a fetch hiccup while signed in should
  // stay quiet.
  if (!localTrips) return null;
  const showSignInCta = !userId || serverStatus === "unauthorized";

  if (localTrips.length === 0) {
    if (!showSignInCta) return null;
    return (
      <section aria-label="Your trips" className="mb-8">
        <SignInCta />
      </section>
    );
  }

  const today = localTodayIso();
  const isLinked = Boolean(loadWalletCode());

  return (
    <section aria-label="Your trips" className="mb-8">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold">Your trips</h2>
        <p className="text-xs text-ink-soft">
          {isLinked ? "synced across your devices" : "remembered on this device"}
        </p>
      </div>
      <TripCards trips={localTrips} today={today} onForget={forget} />
      {syncError && <p className="mt-1 text-xs text-seal">{syncError}</p>}
      {showSignInCta && <SignInCta />}
    </section>
  );
}
