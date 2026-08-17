"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";

/**
 * Header trip switcher (spec §2.3): the user's trips, current one marked,
 * each a link to `/trip/[id]`.
 *
 * Reads `GET /api/me/trips` — the same endpoint TripsDashboard uses. Not a trip
 * payload, so it is outside C4 and needs no accessor.
 */

/** Only the two fields this menu renders, of the endpoint's wider `ApiTrip`. */
interface SwitcherTrip {
  id: string;
  name: string;
}

type Status = "idle" | "loading" | "ready" | "error";

/** The open trip, from the route rather than the shell store — see AppShell. */
function currentTripId(pathname: string): string | null {
  return pathname.match(/^\/trip\/([^/]+)/)?.[1] ?? null;
}

export function TripSwitcher() {
  const pathname = usePathname();
  const openId = currentTripId(pathname);
  const [trips, setTrips] = useState<SwitcherTrip[]>([]);
  const [status, setStatus] = useState<Status>("idle");

  // Fetched on first open, not on mount: the shell renders on every trip page
  // and most visits never open this menu, so mounting-time fetching would spend
  // a request per navigation to populate a list nobody looked at.
  const load = useCallback(async () => {
    if (status === "loading" || status === "ready") return;
    setStatus("loading");
    try {
      const res = await fetch("/api/me/trips");
      if (!res.ok) {
        console.error(`TripSwitcher: /api/me/trips failed (${res.status})`);
        setStatus("error");
        return;
      }
      const json: { trips: SwitcherTrip[] } = await res.json();
      setTrips(json.trips);
      setStatus("ready");
    } catch (error: unknown) {
      console.error("TripSwitcher: could not load trips", error);
      setStatus("error");
    }
  }, [status]);

  return (
    <details
      className="relative shrink-0 print:hidden"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary
        aria-label="Switch trip"
        className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] cursor-pointer list-none items-center justify-center rounded-lg"
        style={{ color: "var(--ink-2)" }}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </summary>

      <div
        className="absolute left-0 z-20 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border p-1 shadow-lg"
        style={{ borderColor: "var(--line-1)", background: "var(--raise)" }}
      >
        {status === "loading" && (
          <p className="px-2 py-2 text-sm" style={{ color: "var(--ink-3)" }}>
            Loading your trips…
          </p>
        )}
        {status === "error" && (
          <p className="px-2 py-2 text-sm" style={{ color: "var(--ink-2)" }}>
            Couldn&apos;t load your trips.
          </p>
        )}
        {status === "ready" && trips.length === 0 && (
          <p className="px-2 py-2 text-sm" style={{ color: "var(--ink-3)" }}>
            No other trips yet.
          </p>
        )}
        {trips.map((trip) => {
          const isOpen = trip.id === openId;
          return (
            <Link
              key={trip.id}
              href={`/trip/${trip.id}`}
              aria-current={isOpen ? "page" : undefined}
              className="flex min-h-[var(--tap-min)] items-center gap-2 rounded-lg px-2 text-sm"
              style={
                isOpen
                  ? { background: "var(--surf-2)", color: "var(--ink-0)", fontWeight: 600 }
                  : { color: "var(--ink-1)" }
              }
            >
              <span className="truncate">{trip.name}</span>
            </Link>
          );
        })}
        <Link
          href="/plan"
          className="mt-1 flex min-h-[var(--tap-min)] items-center gap-2 rounded-lg border-t px-2 text-sm"
          style={{ borderColor: "var(--line-2)", color: "var(--accent-ink)" }}
        >
          Plan a new trip
        </Link>
      </div>
    </details>
  );
}
