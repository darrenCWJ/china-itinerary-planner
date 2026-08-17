"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/authClient";
import {
  localTodayIso,
  pickNextTrip,
  tripEndDate,
  tripPhase,
  type MyTrip,
  type TripPhase,
} from "@/lib/myTrips";

/** Shape of `GET /api/me/trips`'s `trips` entries (Task 3's `UserTrip`). */
interface ApiTrip {
  id: string;
  name: string;
  startDate: string | null;
  days: number;
  destinationNames: string[];
  memberName: string;
}

type FetchStatus = "loading" | "ready" | "error";

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

/** The highlighted "next" trip plus a grid of the rest. */
function TripCards({ trips, today }: { trips: MyTrip[]; today: string }) {
  const next = pickNextTrip(trips, today);
  const others = trips.filter((t) => t.id !== next?.id);

  return (
    <>
      {next && (
        <Link
          href={`/trip/${next.id}`}
          className="group mt-3 block overflow-hidden rounded-2xl border-2 border-seal bg-[var(--paper)] shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-stretch">
            <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 bg-seal py-5 text-white">
              <span aria-hidden className="font-kai text-2xl">游</span>
              <span className="font-mono text-[9px] uppercase tracking-widest">Next</span>
            </div>
            <div className="min-w-0 flex-1 border-l-2 border-dashed border-[var(--line-1)] px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-display text-lg font-bold [text-wrap:balance] group-hover:text-[var(--accent-ink)]">
                  {next.name}
                </p>
                <p className="font-mono text-xs font-semibold tabular-nums text-seal">
                  {phaseLabel(tripPhase(next, today), next.days)}
                </p>
              </div>
              <p className="mt-0.5 truncate font-mono text-sm uppercase tracking-wide text-[var(--ink-2)]">
                {next.destinations.join(" → ")}
              </p>
              <p className="mt-1.5 text-xs tabular-nums text-[var(--ink-2)]">
                {dateRange(next) ?? `${next.days} days — set a start date on the trip page`}
                <span className="ml-2 font-semibold text-[var(--accent-ink)]">Open trip →</span>
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
                className="flex items-center gap-2 rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-3 py-2"
              >
                <Link href={`/trip/${t.id}`} className="min-w-0 flex-1 hover:text-[var(--accent-ink)]">
                  <p className="truncate text-sm font-semibold">{t.name}</p>
                  <p className="truncate text-[11px] tabular-nums text-[var(--ink-2)]">
                    {phaseLabel(phase, t.days)}
                    {dateRange(t) ? ` · ${dateRange(t)}` : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The dashed-border invitation card shown when there's nothing to list yet. */
function EmptyTripsCard({
  heading,
  body,
  ctaHref = "/plan",
  ctaLabel = "Plan a trip →",
}: {
  heading: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className="mt-8 rounded-2xl border-2 border-dashed border-[var(--line-1)] bg-[var(--paper)] px-6 py-10 text-center">
      <p className="font-display text-xl font-bold [text-wrap:balance]">{heading}</p>
      <p className="mt-1 text-sm [text-wrap:pretty] text-[var(--ink-2)]">{body}</p>
      <Link href={ctaHref}
        className="mt-4 inline-flex min-h-[var(--tap-min)] items-center rounded-lg bg-[var(--accent-ink)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]">
        {ctaLabel}
      </Link>
    </div>
  );
}

/**
 * "Your trips" — the account-linked list from `/api/me/trips`. The wall
 * (Task 2) guarantees a session for every real visitor when accounts are
 * on, so this component only has to handle: hook settling, the fetch
 * lifecycle, and accounts being disabled outright.
 */
export function TripsDashboard() {
  const { data: session, isPending, error } = authClient.useSession();
  const userId = session?.user.id;

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [trips, setTrips] = useState<MyTrip[]>([]);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setStatus("loading");
    fetch("/api/me/trips")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          console.error(`TripsDashboard: /api/me/trips failed (${res.status})`);
          setStatus("error");
          return;
        }
        const json: { trips: ApiTrip[] } = await res.json();
        setTrips(json.trips.map(toMyTrip));
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("TripsDashboard: failed to load trips", error);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, retryToken]);

  // The session hook itself hasn't settled yet — render nothing rather
  // than flash any interim state before we know whether there's a session.
  if (isPending) return null;

  // With the wall on, a signed-out visitor is redirected before ever
  // reaching "/" — so a settled session with no user here is *usually*
  // because accounts are disabled on this deployment. But the wall's cookie
  // check is optimistic (it only checks presence, not validity), so a
  // present-yet-invalid cookie — password change with revokeOtherSessions,
  // an admin password reset — passes the wall and still lands here. Better
  // Auth's own get-session call distinguishes the two: it 503s (surfaced as
  // `error`) when accounts are off, and 200s with a null user when the
  // session was simply revoked. Use that to show the right invitation.
  if (!userId) {
    if (error) {
      return (
        <section aria-label="Your trips" className="mb-8">
          <EmptyTripsCard
            heading="Plan locally"
            body="Accounts are not set up on this deployment — plan a trip locally."
          />
        </section>
      );
    }
    return (
      <section aria-label="Your trips" className="mb-8">
        <EmptyTripsCard
          heading="Signed out"
          body="Your session ended — sign in to see your trips."
          ctaHref="/login?next=/"
          ctaLabel="Sign in →"
        />
      </section>
    );
  }

  if (status === "loading") return null;

  if (status === "error") {
    return (
      <section aria-label="Your trips" className="mb-8">
        <p role="status" className="text-sm text-[var(--ink-2)]">
          Couldn&apos;t load your trips —{" "}
          <button
            type="button"
            onClick={() => setRetryToken((k) => k + 1)}
            className="font-semibold text-[var(--accent-ink)] hover:underline"
          >
            retry
          </button>
        </p>
      </section>
    );
  }

  if (trips.length === 0) {
    return (
      <section aria-label="Your trips" className="mb-8">
        <EmptyTripsCard
          heading="No trips yet"
          body="Plan your first one — pick places, tune the details, get a day-by-day plan."
        />
      </section>
    );
  }

  const today = localTodayIso();
  return (
    <section aria-label="Your trips" className="mb-8">
      <TripCards trips={trips} today={today} />
    </section>
  );
}
