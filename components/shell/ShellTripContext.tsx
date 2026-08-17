"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { TripPayload } from "@/lib/tripShared";

/**
 * The open trip, published once per trip page and read by the header pieces.
 *
 * Spec §2.3 puts the trip switcher, crew and Share in the header, which lives
 * in the shell — outside the trip page that owns the accessor. Without this,
 * each header piece would call `useTripPayload` itself and the page would poll
 * once per widget (J3). One call, one poll, shared.
 *
 * ⚠ Why this is a store and not a plain context, which is what the plan says:
 * the shell *wraps* the page, so the header is an ancestor of the page. A
 * context the page provides is invisible to the header above it — the read
 * would always be null. So the provider is mounted above the shell and holds
 * state; the page publishes into it (`useSetShellTrip`) and the header reads it
 * (`useShellTrip`). Same single-accessor guarantee, correct direction.
 */
export interface ShellTripValue {
  tripId: string;
  /** Null while the first read is in flight, or when the viewer is a guest. */
  payload: TripPayload | null;
  /** The accessor's mutation path, so header actions never call `fetch` (C4). */
  mutate(url: string, init: RequestInit): Promise<string | null>;
}

const TripValueContext = createContext<ShellTripValue | null>(null);
const TripSetterContext = createContext<(value: ShellTripValue | null) => void>(() => {});

/**
 * Mounted above `AppShell` in the root layout. Split into two contexts so the
 * trip page, which only ever publishes, does not re-render every time the
 * payload it published changes.
 */
export function ShellTripProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<ShellTripValue | null>(null);
  // The setter is referentially stable, so a publishing effect keyed on it does
  // not re-fire on every payload change.
  const set = useMemo(() => setValue, []);
  return (
    <TripSetterContext.Provider value={set}>
      <TripValueContext.Provider value={value}>{children}</TripValueContext.Provider>
    </TripSetterContext.Provider>
  );
}

/**
 * Null off a trip route — the shell wraps every page, but only `/trip/[id]` has
 * a trip. Header pieces branch on null rather than the shell rendering two
 * different headers.
 */
export function useShellTrip(): ShellTripValue | null {
  return useContext(TripValueContext);
}

/**
 * For the trip page (Task 12): publish the open trip, and publish null on
 * unmount so the header does not keep describing a trip the user has left.
 */
export function useSetShellTrip(): (value: ShellTripValue | null) => void {
  return useContext(TripSetterContext);
}
