"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountChip } from "@/components/auth/AccountChip";
import { RailNav } from "./RailNav";
import { useShellTrip } from "./ShellTripContext";

/**
 * The application frame (spec §2.3): persistent header, 76px desktop rail, and
 * the bottom edge.
 *
 * Additive in this task — nothing mounts it yet. Task 5 puts it in the root
 * layout and deletes `AppHeader`.
 *
 * Colours come from the PR1 token set (`--surf-*`, `--ink-*`, `--line-*`) via
 * `var()` rather than Tailwind utilities: PR1 deliberately left those tokens out
 * of `@theme` so they could not collide with the retiring palette, and Task 33
 * owns that wiring. Writing `var()` here keeps this task from pre-empting it.
 */

interface Props {
  children: React.ReactNode;
  /**
   * Header slots, left to right per §2.3. Optional so this component compiles
   * and renders correctly before the pieces exist — Task 4 fills `tripSwitcher`
   * and `themeToggle`, Tasks 10 and 11 fill `crew` and `share`.
   */
  tripSwitcher?: React.ReactNode;
  crew?: React.ReactNode;
  share?: React.ReactNode;
  themeToggle?: React.ReactNode;
}

/** Chrome-free routes: auth, and public briefings, which are shared outward. */
function isBare(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signup" || pathname.startsWith("/b/");
}

export function AppShell({ children, tripSwitcher, crew, share, themeToggle }: Props) {
  const pathname = usePathname();
  const trip = useShellTrip();

  if (isBare(pathname)) return <>{children}</>;

  // Rail visibility keys on the route, not on `trip`, deliberately. The page
  // publishes its trip after mounting, so a context-driven rail would flicker in
  // one render late on every navigation. The route is known immediately (J1).
  const onTripRoute = pathname.startsWith("/trip/");
  const name = trip?.payload?.data.tripName;

  return (
    <div
      className="flex min-h-dvh flex-col"
      style={{ background: "var(--paper)", color: "var(--ink-0)" }}
    >
      <header
        className="flex items-center gap-3 border-b px-4 py-2 print:hidden"
        style={{
          borderColor: "var(--line-1)",
          background: "var(--surf-1)",
          paddingTop: "calc(0.5rem + var(--safe-top))",
          paddingRight: "calc(1rem + var(--safe-right))",
          paddingLeft: "calc(1rem + var(--safe-left))",
        }}
      >
        <Link
          href="/"
          className="flex min-h-[var(--tap-min)] items-center gap-2"
          style={{ color: "var(--ink-0)" }}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-seal font-kai text-lg text-white">
            游
          </span>
          {/* The wordmark is desktop-only: §2.3 collapses the mobile header to
              the trip name, and the brand is the first thing that should go. */}
          <span className="hidden font-display text-base font-bold leading-tight sm:inline">
            Itinerary Planner
          </span>
        </Link>

        {/* Trip zone. Empty off a trip route rather than absent, so the account
            chip keeps its position and the header does not reflow on nav. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {onTripRoute && (
            <>
              {tripSwitcher}
              {name !== undefined && (
                <span className="truncate font-display text-sm font-semibold" title={name}>
                  {name}
                </span>
              )}
              {crew}
              {share}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {themeToggle}
          <AccountChip />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {onTripRoute && <RailNav />}
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/*
        C2 — the shell owns the bottom edge. This region exists empty so that no
        other component ever needs `position: fixed` at the bottom: the mobile
        bottom bar lands here, and Task 19 moves the wizard footer out of
        app/plan/page.tsx into normal flow. Two pinned bottom elements cannot
        coexist, so there is exactly one place for the second one to go.
      */}
      <div
        id="shell-bottom"
        className="print:hidden empty:hidden md:hidden"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      />
    </div>
  );
}
