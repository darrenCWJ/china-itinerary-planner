"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountChip } from "@/components/auth/AccountChip";
import { CrewMenu } from "./CrewMenu";
import { RailNav } from "./RailNav";
import { ShareMenu } from "./ShareMenu";
import { useShellTrip } from "./ShellTripContext";
import { ThemeToggle } from "./ThemeToggle";
import { TripSwitcher } from "./TripSwitcher";

/**
 * The application frame (spec §2.3): persistent header, 76px desktop rail, and
 * the bottom edge.
 *
 * Mounted in the root layout as of Task 5, which retired `AppHeader` and moved
 * its brand mark and `AccountChip` here.
 *
 * Colours come from the PR1 token set (`--surf-*`, `--ink-*`, `--line-*`) via
 * `var()` rather than Tailwind utilities: PR1 deliberately left those tokens out
 * of `@theme` so they could not collide with the retiring palette, and Task 33
 * owns that wiring. Writing `var()` here keeps this task from pre-empting it.
 */

interface Props {
  children: React.ReactNode;
  /**
   * Header slots, left to right per §2.3, each defaulting to the real piece.
   * Kept as props rather than hardcoded so a test can render the frame without
   * dragging in the auth client or a fetch — AppShell.test.tsx does exactly that.
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

export function AppShell({
  children,
  tripSwitcher = <TripSwitcher />,
  crew = <CrewMenu />,
  share = <ShareMenu />,
  themeToggle = <ThemeToggle />,
}: Props) {
  const pathname = usePathname();
  const trip = useShellTrip();

  if (isBare(pathname)) return <>{children}</>;

  // Rail visibility keys on the route, not on `trip`, deliberately. The page
  // publishes its trip after mounting, so a context-driven rail would flicker in
  // one render late on every navigation. The route is known immediately (J1).
  const onTripRoute = pathname.startsWith("/trip/");
  const data = trip?.payload?.data;
  const name = data?.tripName;
  /**
   * Spec §2.3 lists the header as "trip name and dates". Day count always, start
   * date when the trip has one — `startDate` is nullable and a trip planned
   * without dates is a normal state, not a missing value to apologise for.
   *
   * Desktop only: §2.3 collapses the mobile header to the trip name, so this is
   * the first thing to go when space runs out.
   */
  const dates = data
    ? [
        `${data.input.days} day${data.input.days === 1 ? "" : "s"}`,
        data.startDate === null ? null : `from ${data.startDate}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div
      // --surf-1 is #f1f5fa in light mode — the value the old mist palette
      // (now retired) gave the body — and a separate dark value (#161d27) in
      // dark mode; --paper is the white the old header used in light mode.
      // Assigning them this way round is what keeps the cutover invisible to
      // every page: content keeps its backdrop and the header keeps its
      // contrast. The reverse — which reads more naturally from the token
      // names — would flip every page from mist to white in one commit.
      className="flex min-h-dvh flex-col"
      style={{ background: "var(--surf-1)", color: "var(--ink-0)" }}
    >
      <header
        // border-b-2 border-dashed reproduces the boarding-pass strip from the
        // old header (--line-1 is the same #d9e7f4 the retired sky border was). The spec
        // redesigns the header's contents, not the project's ticket motif.
        className="flex items-center gap-3 border-b-2 border-dashed px-4 py-2 print:hidden"
        style={{
          borderColor: "var(--line-1)",
          background: "var(--paper)",
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
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--seal)] font-kai text-lg text-white">
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
              {dates !== undefined && (
                <span
                  className="hidden shrink-0 whitespace-nowrap text-xs sm:inline"
                  style={{ color: "var(--ink-3)" }}
                >
                  {dates}
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
        {/*
          A div, not a <main>. Every page already renders its own <main>
          (app/page.tsx, /plan, /login, /b/[code], TripView, …), and wrapping
          them in another one nests a landmark that the spec allows exactly one
          of — verified in the a11y tree as main-inside-main after this shell
          first mounted.
        */}
        <div className="min-w-0 flex-1">{children}</div>
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
