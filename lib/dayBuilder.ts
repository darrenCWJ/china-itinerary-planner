import type { DayPlan, ScheduledItem } from "./itinerary";
import type { PlanOp } from "./planOps";
import { MIN_DURATION } from "./timeline";
import type { TripPayload } from "./tripShared";
import type { Activity, TimeSlot } from "./types";

/**
 * The day-builder state machine: zero React, zero layout knowledge (spec §7 C3),
 * so the desktop split-pane and the mobile bottom sheet are two views over one
 * reducer rather than two implementations.
 *
 * Built from `docs/superpowers/specs/2026-08-18-day-builder-invariants.md`, which
 * records where the plan's own brief is wrong. Three deviations, all forced:
 *
 * 1. **An add is ONE `addItem` op with timing inline.** The brief says emit
 *    `addItem` then `setTiming`; item ids are minted server-side and the plan
 *    route returns no created-item id, so the second op would have nothing to
 *    name.
 * 2. **`moveBlock` and `adjustTiming` take an `itemId`.** The brief's signatures
 *    carry none, and both underlying ops require one.
 * 3. **`setBlock`/`clearBlock` exist**, which the brief does not list. They have
 *    to: `buildItinerary` never sets `startMinutes`, so *every* stored item is
 *    untimed and without a way to give one a block the builder is inert.
 *
 * The rule underneath all of it: state holds raw stored values. `reflow` is a
 * read-time selector, never a source of writes — it normalises every overlap it
 * finds, including ones already in storage, so writing its output back would POST
 * over blocks another member owns.
 */

/** Matches `DayNumberSchema` in lib/server/schemas.ts. */
const MAX_DAY = 60;
/** Matches `ItemTitleSchema`. Titles are trimmed then capped before emitting. */
const MAX_TITLE = 80;
const LAST_START = 1439;
const MAX_DURATION = 1440;

export interface ShelfEntry {
  /**
   * Stable identity for the in-flight guard. Not an item id — a shelf entry has
   * no server identity until it is added.
   */
  key: string;
  title: string;
  slot: TimeSlot;
  /** Present only for the custom free-text row (J6). */
  isCustom?: boolean;
}

export interface PendingOp {
  /** Caller-supplied, so acknowledgement is by identity rather than position. */
  id: string;
  op: PlanOp;
  /** Set when the op came from a shelf row, so that row can hide while in flight. */
  shelfKey?: string;
  /**
   * The days this op's optimistic patch was applied on top of. Stamped by the
   * reducer wrapper, and the only thing that lets a rejection be undone.
   */
  daysBefore?: DayPlan[];
}

export interface DayBuilderState {
  days: DayPlan[];
  /** 1-based, always within `1..days.length` once any payload has applied. */
  targetDay: number;
  shelf: ShelfEntry[];
  pendingOps: PendingOp[];
  /** A drag or press-and-hold is in progress; the poll is gated. */
  interaction: boolean;
  /** The one newest payload withheld during an interaction. */
  buffered: { payload: TripPayload; force: boolean } | null;
  /** Version of the last applied payload. Null before the first one. */
  baselineVersion: number | null;
  customDraft: string;
  /** Last rejection, surfaced by the UI and cleared on the next successful op. */
  error: string | null;
  /** Injected activity catalogue, keyed by destination id. Never resolved here. */
  activitiesByDestination: Readonly<Record<string, readonly Activity[]>>;
}

export type DayBuilderAction =
  | { type: "setTargetDay"; day: number }
  | { type: "setCustomDraft"; text: string }
  | { type: "addFromShelf"; key: string; opId: string }
  | { type: "setBlock"; itemId: string; startMinutes: number; durationMinutes: number; opId: string }
  | { type: "clearBlock"; itemId: string; opId: string }
  | { type: "adjustTiming"; itemId: string; deltaMinutes: number; opId: string }
  | { type: "moveBlock"; itemId: string; direction: "up" | "down"; opId: string }
  | { type: "beginInteraction" }
  | { type: "endInteraction" }
  | { type: "serverPayload"; payload: TripPayload; force?: boolean }
  | {
      type: "setActivities";
      activitiesByDestination: Readonly<Record<string, readonly Activity[]>>;
    }
  | { type: "opSettled"; opId: string }
  | { type: "opFailed"; opId: string; message: string };

/**
 * `'day'` and `'any'` are common in the curated data but `addItem` demands a real
 * slot, and spec §3.2.4 forbids a modal on the `+` tap — so the slot is derived
 * silently rather than asked for. Morning is the choice because a full-day
 * activity starts in the morning and an unconstrained one may as well.
 */
function slotFor(timeOfDay: Activity["timeOfDay"]): TimeSlot {
  return timeOfDay === "day" || timeOfDay === "any" ? "morning" : timeOfDay;
}

const fold = (value: string) => value.trim().toLowerCase();

/** Both halves and a positive duration — a half-timed item is untimed. */
function isTimed(item: ScheduledItem): item is ScheduledItem & {
  startMinutes: number;
  durationMinutes: number;
} {
  return (
    typeof item.startMinutes === "number" &&
    typeof item.durationMinutes === "number" &&
    item.durationMinutes > 0
  );
}

/**
 * Whether two injected maps carry the same activities.
 *
 * `setActivities` is dispatched from an effect keyed on a caller-owned prop, so
 * an equivalent map must be a genuine no-op: without this the reducer would
 * return a new state on every dispatch, the effect would see a new render, and a
 * caller that rebuilt the object each render would spin. Reference equality
 * alone is not enough — the map is recomputed whenever `plan.days` changes, which
 * is every poll that touches an item — so keys are compared and each list is
 * compared element-by-element by identity (curated `Activity` records are shared
 * module-level literals, so identity holds for an unchanged destination).
 */
function sameActivities(
  a: Readonly<Record<string, readonly Activity[]>>,
  b: Readonly<Record<string, readonly Activity[]>>
): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key];
    const right = b[key] as readonly Activity[] | undefined;
    if (left === right) return true;
    if (right === undefined || left.length !== right.length) return false;
    return left.every((activity, index) => activity === right[index]);
  });
}

/** 1-based day clamped into range. Empty plans clamp to 1 rather than 0. */
function clampDay(day: number, dayCount: number): number {
  if (dayCount <= 0) return 1;
  return Math.min(Math.max(1, Math.trunc(day)), Math.min(dayCount, MAX_DAY));
}

/**
 * The shelf: unscheduled activities of the *target day's* destination, plus the
 * custom free-text row (J6).
 *
 * "Unscheduled" is scoped to the destination, not the day: an activity already
 * placed on day 2 of Beijing must not be offered again on day 3 of Beijing.
 * Matching is by folded title, which is all the data supports — items carry no
 * link back to the activity they came from.
 *
 * In-flight adds are hidden so the same row cannot be added twice; nothing on the
 * server prevents duplicates.
 */
export function deriveShelf(state: {
  days: DayPlan[];
  targetDay: number;
  customDraft: string;
  pendingOps: PendingOp[];
  activitiesByDestination: Readonly<Record<string, readonly Activity[]>>;
}): ShelfEntry[] {
  const target = state.days[state.targetDay - 1];
  const entries: ShelfEntry[] = [];

  if (target) {
    const scheduled = new Set(
      state.days
        .filter((day) => day.destinationId === target.destinationId)
        .flatMap((day) => day.items.map((item) => fold(item.title)))
    );
    const inFlight = new Set(
      state.pendingOps.map((pending) => pending.shelfKey).filter((key): key is string => !!key)
    );
    for (const activity of state.activitiesByDestination[target.destinationId] ?? []) {
      const key = `${target.destinationId}:${fold(activity.name)}`;
      if (scheduled.has(fold(activity.name)) || inFlight.has(key)) continue;
      entries.push({ key, title: activity.name, slot: slotFor(activity.timeOfDay) });
    }
  }

  // Always terminal, and never removed by the unscheduled rule — it is whatever
  // the user is currently typing, not a catalogue row.
  entries.push({
    key: "custom",
    title: state.customDraft.trim(),
    slot: "morning",
    isCustom: true,
  });
  return entries;
}

export function createDayBuilderState(
  activitiesByDestination: Readonly<Record<string, readonly Activity[]>> = {}
): DayBuilderState {
  const base: DayBuilderState = {
    days: [],
    targetDay: 1,
    shelf: [],
    pendingOps: [],
    interaction: false,
    buffered: null,
    baselineVersion: null,
    customDraft: "",
    error: null,
    activitiesByDestination,
  };
  return { ...base, shelf: deriveShelf(base) };
}

/** Re-derive the shelf after anything that can change days, target or in-flight. */
function withShelf(state: DayBuilderState): DayBuilderState {
  return { ...state, shelf: deriveShelf(state) };
}

function queue(state: DayBuilderState, pending: PendingOp): DayBuilderState {
  return withShelf({ ...state, pendingOps: [...state.pendingOps, pending], error: null });
}

/** Replace one item on the target day, leaving every other field untouched. */
function patchTargetItem(
  state: DayBuilderState,
  itemId: string,
  patch: (item: ScheduledItem) => ScheduledItem
): DayPlan[] {
  return state.days.map((day, index) =>
    index !== state.targetDay - 1
      ? day
      : { ...day, items: day.items.map((item) => (item.id === itemId ? patch(item) : item)) }
  );
}

function targetItems(state: DayBuilderState): ScheduledItem[] {
  return state.days[state.targetDay - 1]?.items ?? [];
}

/**
 * Apply a payload, or withhold it.
 *
 * The version rule mirrors `reducePayload` exactly — `prev.version >= fresh` is
 * dropped unless forced — because `version` is a whole-trip counter bumped by any
 * write, so "newer" does not imply "contains my op" and a looser rule would let a
 * poll delete a block that had not round-tripped yet.
 */
function applyPayload(
  state: DayBuilderState,
  payload: TripPayload,
  force: boolean
): DayBuilderState {
  const stale =
    !force && state.baselineVersion !== null && state.baselineVersion >= payload.version;
  if (stale) return state;

  const days = payload.data.plan.days;
  const live = new Set(days.flatMap((day) => day.items.map((item) => item.id)));
  // An op naming an item the server no longer has is dropped, not retried: the
  // item is gone and the server wins. Adds have no item id yet, so they survive.
  const kept = state.pendingOps.filter((pending) => {
    const id = "itemId" in pending.op ? pending.op.itemId : null;
    return id === null || live.has(id);
  });
  // Identity preserved when nothing was dropped: the hook's send effect keys on
  // this array, and a fresh one on every poll would re-run it four times a
  // minute for nothing.
  const pendingOps = kept.length === state.pendingOps.length ? state.pendingOps : kept;

  return withShelf({
    ...state,
    days,
    targetDay: clampDay(state.targetDay, days.length),
    pendingOps,
    baselineVersion: payload.version,
    buffered: null,
  });
}

/**
 * Stamps every newly queued op with the days it was built on, so `opFailed` can
 * put them back.
 *
 * Done here rather than in each handler because the handlers patch `days` and
 * call `queue` in one expression — there is no point inside them that still
 * holds the pre-patch value, and threading one through each would be five
 * chances to forget.
 */
export function dayBuilderReducer(
  state: DayBuilderState,
  action: DayBuilderAction
): DayBuilderState {
  const next = reduce(state, action);
  if (next.pendingOps.length <= state.pendingOps.length) return next;
  const queued = next.pendingOps[next.pendingOps.length - 1];
  if (queued.daysBefore !== undefined) return next;
  return {
    ...next,
    pendingOps: [...next.pendingOps.slice(0, -1), { ...queued, daysBefore: state.days }],
  };
}

function reduce(state: DayBuilderState, action: DayBuilderAction): DayBuilderState {
  switch (action.type) {
    case "setTargetDay":
      return withShelf({ ...state, targetDay: clampDay(action.day, state.days.length) });

    case "setCustomDraft":
      return withShelf({ ...state, customDraft: action.text });

    case "addFromShelf": {
      const entry = state.shelf.find((row) => row.key === action.key);
      // An empty custom draft is not an add. Nothing else can be blank.
      if (!entry || entry.title === "") return state;
      if (state.days.length === 0) return state;
      const next = queue(state, {
        id: action.opId,
        shelfKey: entry.key,
        // One op, timing inline. A follow-up setTiming would have no itemId to
        // name — the id is minted server-side.
        op: {
          op: "addItem",
          day: state.targetDay,
          title: entry.title.slice(0, MAX_TITLE),
          slot: entry.slot,
        },
      });
      // The draft has served its purpose; the row goes back to being empty.
      return entry.isCustom ? withShelf({ ...next, customDraft: "" }) : next;
    }

    case "setBlock": {
      const item = targetItems(state).find((candidate) => candidate.id === action.itemId);
      if (!item) return state;
      const startMinutes = Math.min(Math.max(0, Math.trunc(action.startMinutes)), LAST_START);
      const durationMinutes = Math.min(
        MAX_DURATION,
        Math.max(MIN_DURATION, Math.trunc(action.durationMinutes))
      );
      return queue(
        {
          ...state,
          days: patchTargetItem(state, action.itemId, (current) => ({
            ...current,
            startMinutes,
            durationMinutes,
          })),
        },
        {
          id: action.opId,
          op: { op: "setTiming", day: state.targetDay, itemId: action.itemId, startMinutes, durationMinutes },
        }
      );
    }

    case "clearBlock": {
      const item = targetItems(state).find((candidate) => candidate.id === action.itemId);
      if (!item) return state;
      return queue(
        {
          ...state,
          days: patchTargetItem(state, action.itemId, (current) => ({
            ...current,
            startMinutes: null,
            durationMinutes: null,
          })),
        },
        {
          id: action.opId,
          // Both null: a block is cleared as a whole, and a half pair is a
          // silently vanishing block.
          op: {
            op: "setTiming",
            day: state.targetDay,
            itemId: action.itemId,
            startMinutes: null,
            durationMinutes: null,
          },
        }
      );
    }

    case "adjustTiming": {
      const item = targetItems(state).find((candidate) => candidate.id === action.itemId);
      // An untimed item has no duration to adjust, and inventing one would
      // fabricate the block spec §5.3 forbids. `setBlock` is how it gets one.
      if (!item || !isTimed(item)) return state;
      const durationMinutes = Math.min(
        MAX_DURATION,
        Math.max(MIN_DURATION, item.durationMinutes + Math.trunc(action.deltaMinutes))
      );
      if (durationMinutes === item.durationMinutes) return state;
      return queue(
        {
          ...state,
          days: patchTargetItem(state, action.itemId, (current) => ({ ...current, durationMinutes })),
        },
        {
          id: action.opId,
          op: {
            op: "setTiming",
            day: state.targetDay,
            itemId: action.itemId,
            // The existing start is resent: both keys are required, and omitting
            // one fails validation with an error the UI cannot explain.
            startMinutes: item.startMinutes,
            durationMinutes,
          },
        }
      );
    }

    case "moveBlock": {
      const items = targetItems(state);
      const index = items.findIndex((item) => item.id === action.itemId);
      const swapWith = action.direction === "up" ? index - 1 : index + 1;
      // Clamped here rather than relying on a server rejection, which would cost
      // a round trip and a forced refetch to say nothing happened.
      if (index === -1 || swapWith < 0 || swapWith >= items.length) return state;
      const reordered = [...items];
      [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
      return queue(
        {
          ...state,
          days: state.days.map((day, dayIndex) =>
            dayIndex === state.targetDay - 1 ? { ...day, items: reordered } : day
          ),
        },
        {
          id: action.opId,
          op: {
            op: "moveItem",
            day: state.targetDay,
            itemId: action.itemId,
            direction: action.direction,
          },
        }
      );
    }

    case "beginInteraction":
      // A boolean, not a counter: two begins and one end must leave the gate
      // open, because a dropped end would otherwise wedge it shut forever and
      // freeze the trip for that member.
      return state.interaction ? state : { ...state, interaction: true };

    case "endInteraction": {
      if (!state.interaction) return state;
      const opened = { ...state, interaction: false };
      if (state.buffered === null) return opened;
      return applyPayload(
        { ...opened, buffered: null },
        state.buffered.payload,
        state.buffered.force
      );
    }

    case "serverPayload": {
      const force = action.force ?? false;
      // Never gated before the first payload: with no baseline there is no local
      // state worth protecting, and gating would leave the builder empty.
      if (!state.interaction || state.baselineVersion === null) {
        return applyPayload(state, action.payload, force);
      }
      // One slot, newest wins. A forced payload always displaces a buffered one:
      // force marks an identity change or a post-error reconciliation, which the
      // version comparison cannot see.
      const keepExisting =
        state.buffered !== null &&
        !force &&
        state.buffered.force === false &&
        state.buffered.payload.version >= action.payload.version;
      if (keepExisting) return state;
      return { ...state, buffered: { payload: action.payload, force } };
    }

    case "setActivities": {
      // The map is injected, not resolved here, and it is a live value rather
      // than a mount-time constant: a whole-plan rebuild can introduce a
      // destination that was absent when the builder mounted, and a frozen map
      // would show that day an empty shelf forever — reading as "everything is
      // already on the plan" when in fact nothing of it is.
      //
      // Deliberately NOT gated behind `interaction`. The gate exists to stop
      // server truth from replacing member edits to `days` mid-drag; this map is
      // not member state, carries no version, and for every destination already
      // in the gated `days` it resolves to the identical activity list — so the
      // target day's shelf cannot change under a drag. Buffering it would only
      // delay the fix for the day whose shelf is wrong.
      if (sameActivities(state.activitiesByDestination, action.activitiesByDestination)) {
        return state;
      }
      return withShelf({ ...state, activitiesByDestination: action.activitiesByDestination });
    }

    case "opSettled":
      return withShelf({
        ...state,
        pendingOps: state.pendingOps.filter((pending) => pending.id !== action.opId),
      });

    case "opFailed": {
      const index = state.pendingOps.findIndex((pending) => pending.id === action.opId);
      if (index === -1) return state;
      const failed = state.pendingOps[index];
      /**
       * Unwind the optimistic patch here, rather than waiting for a payload to
       * correct it.
       *
       * This used to trust the accessor to force-refetch and let the truth
       * arrive that way. It cannot: a rejected op writes nothing, so the forced
       * refetch returns the *same* version and `applyPayload`'s `>=` rule drops
       * it — and on a network failure `mutate` returns a string without
       * refetching at all. Both paths left the member looking at an edit that
       * was never saved, with nothing that would ever correct it on a
       * single-member trip.
       *
       * Everything queued *after* the failure goes too: those ops were computed
       * against a state the server rejected, so replaying them on the restored
       * days would reapply the edit we are undoing. Server wins, which is the
       * same rule payload reconciliation follows.
       */
      const survivors = state.pendingOps.slice(0, index);
      return withShelf({
        ...state,
        days: failed.daysBefore ?? state.days,
        pendingOps: survivors,
        error: action.message,
      });
    }

    default:
      return state;
  }
}
