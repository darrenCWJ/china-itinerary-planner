"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyOptimisticCheck,
  classifyTripResponse,
  createSeqGuard,
  extractMutationError,
  POLL_MS,
  reducePayload,
  type SeqGuard,
} from "./tripPayloadCore";
import type { GuestTripPayload, TripPayload } from "./tripShared";

/**
 * The trip-payload accessor (spec §7 C4): the one module that fetches trip
 * data. Components read the trip through this hook and never call `fetch` for
 * it themselves, so a cache can later be slotted underneath without touching
 * a single component.
 *
 * Exceptions, deliberate: `components/trip/BriefingShare.tsx` and
 * `components/trip/JournalSection.tsx` call trip-*scoped* endpoints
 * (`/briefing`, `/photos`) that do not return a `TripPayload`. They are
 * outside this contract and stay where they are.
 */

export type TripLoadState = "loading" | "member" | "guest" | "private" | "not-found";

export interface TripPayloadAccessor {
  payload: TripPayload | null;
  guestView: GuestTripPayload | null;
  loadState: TripLoadState;
  /**
   * Increments on every forced apply. A consumer keeping its own copy of the
   * plan watches this alongside `payload`: a forced reconciliation often
   * carries the same version, so `payload` alone cannot reveal it.
   */
  forcedAt: number;
  /** Re-read the trip. `force` applies the response even if it is not newer. */
  refetch(force?: boolean): Promise<void>;
  /** POST/PATCH/DELETE returning a fresh TripPayload; error string for forms, null on success. */
  mutate(url: string, init: RequestInit): Promise<string | null>;
  toggleCheck(key: string, checked: boolean, myName: string): Promise<void>;
  joinTrip(claimName: string | null): Promise<string | null>;
  loadClaimable(): Promise<string[]>;
  /** Try a join code without committing to it; error copy for the gate, null when adopted. */
  probeCode(code: string): Promise<string | null>;
}

function initialGuestCode(tripId: string): string {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem(`cip-guest-code-${tripId}`) ??
    new URLSearchParams(window.location.search).get("code") ??
    ""
  );
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function useTripPayload(tripId: string): TripPayloadAccessor {
  const [payload, setPayload] = useState<TripPayload | null>(null);
  const [guestView, setGuestView] = useState<GuestTripPayload | null>(null);
  const [loadState, setLoadState] = useState<TripLoadState>("loading");
  /**
   * Bumped every time a payload is applied with `force`.
   *
   * A forced apply exists precisely because an optimistic edit deliberately
   * keeps the old version, so the reconciling payload is frequently *not*
   * newer — and `reducePayload` returns `prev` by identity when it drops one.
   * Consumers holding their own copy of the plan therefore cannot detect a
   * forced reconciliation from `payload` alone; this counter is the channel
   * that tells them (the invariants doc's `force-survives-the-buffer`).
   */
  const [forcedAt, setForcedAt] = useState(0);
  const [guestCode, setGuestCode] = useState<string>(() => initialGuestCode(tripId));

  // One guard for the lifetime of the hook (React's documented way to avoid
  // recreating ref contents on every render).
  const seqRef = useRef<SeqGuard | null>(null);
  if (seqRef.current === null) seqRef.current = createSeqGuard();
  const seq = seqRef.current;

  const applyPayload = useCallback((fresh: TripPayload, force = false) => {
    setPayload((prev) => reducePayload(prev, fresh, force));
    if (force) setForcedAt((n) => n + 1);
  }, []);

  const refetch = useCallback(
    async (force = false) => {
      const token = seq.issue();
      const query = guestCode ? `?code=${encodeURIComponent(guestCode)}` : "";
      let res: Response;
      try {
        res = await fetch(`/api/trips/${tripId}${query}`, { cache: "no-store" });
      } catch {
        // Offline, or the tab is being torn down. Leave state untouched and let
        // the next poll try again — every caller is `void refetch(…)`, including
        // the 4s interval, so throwing here is an unhandled rejection rather
        // than something anyone can act on.
        return;
      }
      if (!seq.isCurrent(token)) return;
      const body: unknown = res.ok ? await res.json() : null;
      if (!seq.isCurrent(token)) return;
      const result = classifyTripResponse(res.status, body);
      switch (result.kind) {
        case "not-found":
          setLoadState("not-found");
          return;
        case "private":
          setLoadState("private");
          return;
        case "error":
          return;
        case "guest":
          setGuestView(result.view);
          setLoadState("guest");
          localStorage.setItem(`cip-guest-code-${tripId}`, guestCode);
          return;
        case "member":
          applyPayload(result.payload, force);
          setLoadState("member");
      }
    },
    [tripId, guestCode, applyPayload, seq]
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Live sync: poll while the tab is visible so every member sees updates,
  // and refetch immediately when the tab regains focus.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) void refetch();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refetch]);

  // Shared mutation path: apply the fresh payload on success, reconcile via a
  // forced refetch on failure. Returns an error message for the calling form,
  // or null when the change stuck.
  const mutate = useCallback(
    async (url: string, init: RequestInit): Promise<string | null> => {
      try {
        const res = await fetch(url, init);
        const json: unknown = await res.json();
        if (!res.ok) {
          void refetch(true);
          return extractMutationError(json);
        }
        applyPayload(json as TripPayload);
        return null;
      } catch {
        // Reconcile here too. This branch used to return the message and stop,
        // which left any optimistic edit on screen with nothing at all that
        // would correct it — the HTTP branch above at least forces a refetch.
        void refetch(true);
        return "Couldn't reach the server — try again.";
      }
    },
    [refetch, applyPayload]
  );

  const toggleCheck = useCallback(
    async (key: string, checked: boolean, myName: string) => {
      if (!payload || !payload.members.some((m) => m.name === myName)) return;
      // Optimistic update; the server response is the source of truth.
      setPayload(applyOptimisticCheck(payload, key, checked, myName));
      try {
        const res = await fetch(`/api/trips/${tripId}/checks`, jsonInit({ key, checked }));
        if (res.ok) {
          applyPayload((await res.json()) as TripPayload);
        } else {
          // The optimistic update kept the old version, so polls would never
          // reconcile it — force a fresh copy of the server state.
          void refetch(true);
        }
      } catch {
        void refetch(true);
      }
    },
    [payload, tripId, applyPayload, refetch]
  );

  const joinTrip = useCallback(
    async (claimName: string | null): Promise<string | null> => {
      const res = await fetch(
        `/api/trips/${tripId}/join`,
        jsonInit({ code: guestCode, ...(claimName ? { claimName } : {}) })
      );
      const json = await res.json();
      if (!res.ok) return typeof json.error === "string" ? json.error : "Couldn't join.";
      // Invalidate any in-flight poll so a stale guest response can't revert the join.
      seq.invalidate();
      applyPayload(json as TripPayload, true);
      setLoadState("member");
      return null;
    },
    [tripId, guestCode, applyPayload, seq]
  );

  const loadClaimable = useCallback(async (): Promise<string[]> => {
    const res = await fetch(`/api/trips/${tripId}/join?code=${encodeURIComponent(guestCode)}`);
    if (!res.ok) return [];
    return ((await res.json()) as { claimable: string[] }).claimable;
  }, [tripId, guestCode]);

  const probeCode = useCallback(
    async (code: string): Promise<string | null> => {
      const res = await fetch(`/api/trips/${tripId}?code=${encodeURIComponent(code)}`, {
        cache: "no-store",
      });
      if (res.status === 403) return "Wrong join code — check it and try again.";
      if (!res.ok && res.status !== 404) return "Couldn't check that code — try again.";
      if (res.status === 404) return "Trip not found.";
      // Adopting the code re-runs the fetch effect, which renders the guest view.
      setGuestCode(code);
      return null;
    },
    [tripId]
  );

  return {
    payload,
    guestView,
    loadState,
    forcedAt,
    refetch,
    mutate,
    toggleCheck,
    joinTrip,
    loadClaimable,
    probeCode,
  };
}
