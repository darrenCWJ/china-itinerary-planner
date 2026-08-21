"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { TRIP_NAV, toTripTabId, type TripTabId } from "@/lib/nav";

/**
 * The desktop rail: the four trip tabs, rendered from `TRIP_NAV` and nowhere
 * else (C1). The mobile bottom bar renders from the same array, which is the
 * whole point of the array existing.
 *
 * Icons are resolved here rather than in `lib/nav` so that module stays free of
 * React and unit-tests in node. Hand-drawn rather than pulled from a package:
 * four 24px glyphs do not justify a dependency.
 */
const ICONS: Record<string, React.ReactNode> = {
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19h5a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7h4.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.5 1.5m11.2 11.2 1.5 1.5M19.1 4.9l-1.5 1.5M6.4 17.6l-1.5 1.5" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z" />
      <path d="M3 9h18" />
      <circle cx="16.5" cy="13.5" r="1.2" />
    </>
  ),
  bag: (
    <>
      <path d="M4 8h16l-1 12H5z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
};

function TabIcon({ name }: { name: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * Tab state lives in `?tab=` (J2): deep-linkable, survives a refresh, and gives
 * the future bottom bar the same source as the rail with no new plumbing.
 */
export function useActiveTab(): TripTabId {
  return toTripTabId(useSearchParams().get("tab"));
}

export function RailNav() {
  const pathname = usePathname();
  const active = useActiveTab();

  return (
    <nav
      aria-label="Trip sections"
      // 76px per spec §2.3. Hidden below md: the same four items become the
      // mobile bottom bar in the follow-up spec, and two visible navs would
      // duplicate what C1 exists to keep single.
      className="hidden w-[76px] shrink-0 flex-col gap-1 border-r px-2 py-3 md:flex print:hidden"
      style={{
        borderColor: "var(--line-1)",
        // Paper, like the header: the rail is chrome, and sharing the header's
        // fill is what makes the two read as one frame around the content.
        background: "var(--paper)",
        paddingBottom: "calc(0.75rem + var(--safe-bottom))",
        paddingLeft: "calc(0.5rem + var(--safe-left))",
      }}
    >
      {TRIP_NAV.map((item) => {
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={`${pathname}?tab=${item.id}`}
            aria-label={item.ariaLabel}
            aria-current={isActive ? "page" : undefined}
            // min-h-[--tap-min] even on desktop, which does not need it (C5).
            className="flex min-h-[var(--tap-min)] flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors"
            // `--on-accent` on `--accent-fill`, not `--ink-0` and not `--paper`.
            // Spec §4.2 defines `--accent-fill` as "accent as fill behind *dark*
            // ink"; white on it peaks at 2.62:1 across all 360 hues — under AA
            // for this 11px label and under even the 3:1 graphics floor for the
            // icon.
            //
            // `--ink-0` looked like the fix — it bottoms out at 5.82:1 in
            // light — but `--accent-fill` does not invert between ramps the way
            // `--accent-ink` and `--seal` do (oklch 72% light, 80% dark: a light
            // colour in *both*). `--ink-0` inverts, so the same pairing reads
            // 1.72:1 in dark. Neither a ramp-following token nor `--paper` (which
            // also inverts) can work here; `--on-accent` exists because this is
            // the one surface that needs an ink pinned dark in both ramps.
            //
            // accent.test.ts pins the fill token's contrast at ≥3.0 only, which
            // is the right spec-level floor for a fill but is *not* enough for
            // text this small — RailNav.test.tsx carries the ≥4.5 assertion,
            // next to the component that needs it, and accent.test.ts separately
            // sweeps `--on-accent` itself against the fill in both themes.
            style={
              isActive
                ? { background: "var(--accent-fill)", color: "var(--on-accent)" }
                : { color: "var(--ink-2)" }
            }
          >
            <TabIcon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
