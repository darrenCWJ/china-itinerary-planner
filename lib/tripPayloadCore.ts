import type { GuestTripPayload, TripPayload } from "./tripShared";

/**
 * Framework-free half of the trip-payload accessor (spec §7 C4). Everything
 * here is a pure function over data the hook already has: no fetch, no timers,
 * no React. `lib/useTripPayload.ts` is the thin wiring that turns these into
 * live state, and a cache layer slotted under the accessor later only has to
 * reuse these same rules.
 */

/** Live-sync cadence: poll the trip while the tab is visible. */
export const POLL_MS = 4000;

/**
 * Version-monotonic apply. A poll issued before an edit can land after the
 * edit's response, so a payload that is not strictly newer is dropped —
 * unless `force`, the escape hatch for identity changes (a join swaps which
 * trip you are looking at) and post-error reconciliation (an optimistic
 * update kept the old version, so no poll would ever overtake it).
 */
export function reducePayload(
  prev: TripPayload | null,
  fresh: TripPayload,
  force = false
): TripPayload {
  if (!force && prev && prev.version >= fresh.version) return prev;
  return fresh;
}

/**
 * The optimistic half of ticking a checkbox: show the change immediately,
 * attributed to me, and let the server response be the source of truth. The
 * version is deliberately untouched so a forced refetch can reconcile it.
 */
export function applyOptimisticCheck(
  payload: TripPayload,
  key: string,
  checked: boolean,
  myName: string
): TripPayload {
  const without = payload.checks.filter((c) => c.key !== key);
  return { ...payload, checks: checked ? [...without, { key, by: myName }] : without };
}

/** What a GET /api/trips/:id response means, once. */
export type TripResponse =
  | { kind: "not-found" }
  | { kind: "private" }
  | { kind: "error" }
  | { kind: "guest"; view: GuestTripPayload }
  | { kind: "member"; payload: TripPayload };

/**
 * Classify a trip response by status and body. `json` is whatever the body
 * parsed to (or null when there was no usable body) — an unreadable 200 is an
 * error rather than a crash, matching the "leave the last good state alone"
 * behaviour of every other failure here.
 */
export function classifyTripResponse(status: number, json: unknown): TripResponse {
  if (status === 404) return { kind: "not-found" };
  if (status === 403) return { kind: "private" };
  if (status < 200 || status >= 300) return { kind: "error" };
  if (!json || typeof json !== "object") return { kind: "error" };
  if ((json as { guest?: unknown }).guest === true) {
    return { kind: "guest", view: json as GuestTripPayload };
  }
  return { kind: "member", payload: json as TripPayload };
}

export interface SeqGuard {
  /** Start a request; hold the token and check it before applying the result. */
  issue(): number;
  isCurrent(token: number): boolean;
  /** Drop every in-flight request without starting one (used by the join flow). */
  invalidate(): void;
}

/**
 * Guards against out-of-order responses: a poll issued before a join resolves,
 * or a fetch carrying a stale guest code, can land after a newer request. Only
 * the most recently issued token may write state.
 */
export function createSeqGuard(): SeqGuard {
  let seq = 0;
  return {
    issue: () => ++seq,
    isCurrent: (token: number) => token === seq,
    invalidate: () => {
      seq++;
    },
  };
}

/** The message a failed mutation should show a form, server copy preferred. */
export function extractMutationError(json: unknown): string {
  const message = (json as { error?: unknown } | null)?.error;
  return typeof message === "string" ? message : "Couldn't save that change.";
}
