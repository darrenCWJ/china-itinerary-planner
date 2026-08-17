"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  createDayBuilderState,
  dayBuilderReducer,
  type DayBuilderState,
} from "@/lib/dayBuilder";
import { newId } from "@/lib/id";
import type { TripPayload } from "@/lib/tripShared";
import type { Activity } from "@/lib/types";

/**
 * The binding between the day-builder reducer and the trip accessor.
 *
 * Deliberately thin: every rule worth arguing about lives in `lib/dayBuilder.ts`
 * and is tested there (C3). This file owns three jobs and no logic — feed the
 * payload stream in, send one pending op at a time, and hand the reducer the
 * result.
 *
 * ⚠ Lives under `components/plan/` and not `lib/`. A React hook is neither pure
 * state nor layout-free, and the C3 scan in lib/contracts.test.ts fails any
 * day-builder hook found in lib/.
 */

interface Options {
  tripId: string;
  /** The accessor's payload. Its identity is stable across dropped polls. */
  payload: TripPayload | null;
  /** The accessor's mutation path — never `fetch` from here (C4). */
  mutate(url: string, init: RequestInit): Promise<string | null>;
  /** Activities per destination id, resolved by the caller from the trip's data. */
  activitiesByDestination: Readonly<Record<string, readonly Activity[]>>;
}

export interface DayBuilderApi {
  state: DayBuilderState;
  setTargetDay(day: number): void;
  setCustomDraft(text: string): void;
  addFromShelf(key: string): void;
  setBlock(itemId: string, startMinutes: number, durationMinutes: number): void;
  clearBlock(itemId: string): void;
  adjustTiming(itemId: string, deltaMinutes: number): void;
  moveBlock(itemId: string, direction: "up" | "down"): void;
  /** Bracket every drag or press-and-hold with these, so the poll gate engages. */
  beginInteraction(): void;
  endInteraction(): void;
}

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function useDayBuilder({
  tripId,
  payload,
  mutate,
  activitiesByDestination,
}: Options): DayBuilderApi {
  const [state, dispatch] = useReducer(
    dayBuilderReducer,
    activitiesByDestination,
    createDayBuilderState
  );

  // The accessor returns the previous payload *by identity* when it drops a
  // stale poll, so this effect does not re-fire on one. That is why the gate's
  // flush lives in the reducer's own buffer and not here: after
  // endInteraction no new payload identity is guaranteed to arrive.
  useEffect(() => {
    if (payload) dispatch({ type: "serverPayload", payload });
  }, [payload]);

  // One op per request: PlanEditSchema takes a single op and the route applies
  // exactly one under a version guard, so there is nothing to batch into.
  const inFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = state.pendingOps.find((pending) => !inFlight.current.has(pending.id));
    if (!next) return;
    inFlight.current.add(next.id);
    void (async () => {
      const error = await mutate(`/api/trips/${tripId}/plan`, jsonInit({ op: next.op }));
      inFlight.current.delete(next.id);
      if (error === null) {
        dispatch({ type: "opSettled", opId: next.id });
        return;
      }
      // No refetch here: the accessor's mutate already forces one on a rejected
      // response. Calling it again would double-fetch and could stomp a second
      // in-flight edit. Failure reaches the reducer as its own action rather
      // than being inferred from the payload stream.
      dispatch({ type: "opFailed", opId: next.id, message: error });
    })();
  }, [state.pendingOps, tripId, mutate]);

  const setTargetDay = useCallback((day: number) => dispatch({ type: "setTargetDay", day }), []);
  const setCustomDraft = useCallback(
    (text: string) => dispatch({ type: "setCustomDraft", text }),
    []
  );
  const addFromShelf = useCallback(
    (key: string) => dispatch({ type: "addFromShelf", key, opId: newId() }),
    []
  );
  const setBlock = useCallback(
    (itemId: string, startMinutes: number, durationMinutes: number) =>
      dispatch({ type: "setBlock", itemId, startMinutes, durationMinutes, opId: newId() }),
    []
  );
  const clearBlock = useCallback(
    (itemId: string) => dispatch({ type: "clearBlock", itemId, opId: newId() }),
    []
  );
  const adjustTiming = useCallback(
    (itemId: string, deltaMinutes: number) =>
      dispatch({ type: "adjustTiming", itemId, deltaMinutes, opId: newId() }),
    []
  );
  const moveBlock = useCallback(
    (itemId: string, direction: "up" | "down") =>
      dispatch({ type: "moveBlock", itemId, direction, opId: newId() }),
    []
  );
  const beginInteraction = useCallback(() => dispatch({ type: "beginInteraction" }), []);
  const endInteraction = useCallback(() => dispatch({ type: "endInteraction" }), []);

  return useMemo(
    () => ({
      state,
      setTargetDay,
      setCustomDraft,
      addFromShelf,
      setBlock,
      clearBlock,
      adjustTiming,
      moveBlock,
      beginInteraction,
      endInteraction,
    }),
    [
      state,
      setTargetDay,
      setCustomDraft,
      addFromShelf,
      setBlock,
      clearBlock,
      adjustTiming,
      moveBlock,
      beginInteraction,
      endInteraction,
    ]
  );
}
