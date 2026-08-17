"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { containsPoint, dropIndexFor, moveStepsFor, type Box } from "@/lib/dragLayer";
import { DURATION_STEP, dayLoad, formatClock, formatSpan, reflow, type ReflowedItem } from "@/lib/timeline";
import type { TripPayload } from "@/lib/tripShared";
import type { Activity } from "@/lib/types";
import { useDayBuilder, type DayBuilderApi } from "./useDayBuilder";

/**
 * The member editing surface for a day (spec §3.2.4-6, §8): a places shelf on one
 * side, the target day's blocks on the other, and an explicit target chip so a
 * `+` tap lands somewhere the user chose rather than wherever they happen to be
 * scrolled.
 *
 * `DayCard` stays the read-only renderer for guests and print (J13) — this never
 * mounts for them.
 *
 * State lives entirely in the reducer (C3). Nothing here computes a transition;
 * layout reads `state` and calls the api. The one thing worth knowing before
 * reading further: **no stored item has timing**, because `buildItinerary` has
 * never set `startMinutes`. So the primary affordance on an untimed item is "give
 * it a time", not "adjust its time" — without that the ±15m controls would have
 * nothing to act on and time blocks would look broken on every existing trip.
 *
 * The desktop drag layer sits *on top* of all of that (spec §3.2.5) and is
 * additive by construction: every drop dispatches the same api call the tap and
 * keyboard controls already dispatch, so there is one mutation path and no drag
 * can reach the server by a route the keyboard cannot.
 */

interface Props {
  tripId: string;
  payload: TripPayload;
  mutate(url: string, init: RequestInit): Promise<string | null>;
  activitiesByDestination: Readonly<Record<string, readonly Activity[]>>;
}

/** Where a block lands when an untimed item is given its first time: 09:00, 1h. */
const FIRST_BLOCK_START = 540;
const FIRST_BLOCK_DURATION = 60;

/**
 * What the pointer picked up. A shelf row becomes an add, a block a reorder.
 *
 * The custom free-text row is deliberately not draggable: it is a text input, and
 * dragging inside one is the browser's own text selection.
 */
type DragSource =
  | { kind: "shelf"; shelfKey: string }
  | { kind: "block"; itemId: string; fromIndex: number };

/**
 * Where it would land. `list` carries the insertion index the day list is showing;
 * `chip` is a retarget-and-add onto another day.
 */
type DropTarget = { zone: "list"; index: number } | { zone: "chip"; day: number };

interface DragController {
  source: DragSource | null;
  over: DropTarget | null;
  /** Spread onto the handle element — all four pointer phases belong together. */
  handleProps(source: DragSource): React.DOMAttributes<HTMLElement>;
  /** True while a shelf row is in flight and that day could receive it. */
  acceptsRetarget(day: number): boolean;
}

/**
 * Pointer capture keeps the move/up stream on the handle once the pointer leaves
 * it, which is why there are no window listeners here. Both calls are feature
 * checked because jsdom implements neither, and the component renders there.
 */
function capturePointer(node: Element, pointerId: number) {
  if (typeof node.setPointerCapture === "function") node.setPointerCapture(pointerId);
}

function releasePointer(node: Element, pointerId: number) {
  if (typeof node.hasPointerCapture !== "function") return;
  if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  a === null || b === null
    ? a === b
    : a.zone === "list" && b.zone === "list"
      ? a.index === b.index
      : a.zone === "chip" && b.zone === "chip"
        ? a.day === b.day
        : false;

export function DayBuilder({ tripId, payload, mutate, activitiesByDestination }: Props) {
  const api = useDayBuilder({ tripId, payload, mutate, activitiesByDestination });
  const { state } = api;

  const target = state.days[state.targetDay - 1];
  // reflow is read-time only. Its output is never written back — it normalises
  // every overlap it finds, including ones already in storage.
  const view = useMemo(() => reflow(target?.items ?? []), [target]);
  const load = useMemo(() => dayLoad(view), [view]);

  const [drag, setDrag] = useState<{
    pointerId: number;
    source: DragSource;
    over: DropTarget | null;
  } | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLFieldSetElement | null>(null);
  const capturedRef = useRef<{ node: Element; pointerId: number } | null>(null);
  // Esc has to be a window listener because the handle never takes focus. The
  // ref keeps that listener subscribed once per drag instead of once per move.
  const cancelRef = useRef<() => void>(() => {});

  /**
   * Rows are measured live rather than cached at drag start: the day list scrolls
   * with the page, and a cached rect would drop the block a row off after a
   * scroll. DOM order is `day.items` order — `reflow` never sorts, and the drop
   * marker is the only other child and carries no `data-block`.
   */
  function blockBoxes(): Box[] {
    const nodes = listRef.current?.querySelectorAll<HTMLElement>("[data-block]");
    return nodes ? Array.from(nodes, (node) => node.getBoundingClientRect()) : [];
  }

  function chipDayAt(x: number, y: number): number | null {
    const nodes = chipsRef.current?.querySelectorAll<HTMLElement>("[data-day]");
    for (const node of Array.from(nodes ?? [])) {
      if (containsPoint(node.getBoundingClientRect(), x, y)) return Number(node.dataset.day);
    }
    return null;
  }

  /**
   * A shelf row is derived from the *target day's* destination, so dropping it on
   * a day in another city would retarget, re-derive the shelf, and then find no
   * row to add — a drop that silently does nothing. Those chips are refused
   * outright and dimmed instead.
   */
  function acceptsRetarget(day: number): boolean {
    if (drag?.source.kind !== "shelf") return false;
    return state.days[day - 1]?.destinationId === target?.destinationId;
  }

  function targetAt(source: DragSource, x: number, y: number): DropTarget | null {
    if (source.kind === "shelf") {
      const day = chipDayAt(x, y);
      // A chip hit is decisive either way: falling through to the list below it
      // would add to the wrong day.
      if (day !== null) return acceptsRetarget(day) ? { zone: "chip", day } : null;
    }
    const listRect = listRef.current?.getBoundingClientRect();
    if (!listRect || !containsPoint(listRect, x, y)) return null;
    // `addItem` appends regardless of slot or pointer position, so a shelf drop
    // reports the end of the list — the marker must not promise a placement the
    // server has no op to honour.
    if (source.kind === "shelf") return { zone: "list", index: view.length };
    return { zone: "list", index: dropIndexFor(y, blockBoxes()) };
  }

  function commit(source: DragSource, over: DropTarget | null) {
    if (over === null) return;
    if (source.kind === "shelf") {
      if (over.zone === "chip") api.setTargetDay(over.day);
      // The same call the `+` tap makes. Drag adds no second write path.
      api.addFromShelf(source.shelfKey);
      return;
    }
    if (over.zone !== "list") return;
    // One `moveItem` per row crossed, because the server has no insert-at-index
    // op — identical to holding the "move up" control down. A rejection partway
    // leaves a partial reorder, exactly as it would for the keyboard user.
    for (const direction of moveStepsFor(source.fromIndex, over.index)) {
      api.moveBlock(source.itemId, direction);
    }
  }

  function release() {
    const captured = capturedRef.current;
    capturedRef.current = null;
    if (captured) releasePointer(captured.node, captured.pointerId);
  }

  function handleProps(source: DragSource): React.DOMAttributes<HTMLElement> {
    return {
      onPointerDown(event) {
        // Desktop only (spec §3.2.5). Gated on `pointerType` rather than a media
        // query so a hybrid laptop keeps drag on its mouse and tap-to-target on
        // its screen, and `touch-action` is deliberately left alone — overriding
        // it here would break scrolling for the path drag is layered on top of.
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        if (drag !== null) return;
        // Suppresses the text selection a press-and-drag would otherwise paint
        // across the row.
        event.preventDefault();
        capturePointer(event.currentTarget, event.pointerId);
        capturedRef.current = { node: event.currentTarget, pointerId: event.pointerId };
        // Bracketing starts here, not at the first move: the gate must be shut
        // before any geometry is read, so a 4-second poll cannot replace the row
        // under the cursor mid-drag. `endInteraction` is unconditional, so a
        // press that never moves brackets a no-op rather than leaking the gate.
        api.beginInteraction();
        setDrag({ pointerId: event.pointerId, source, over: null });
      },
      onPointerMove(event) {
        if (drag === null || event.pointerId !== drag.pointerId) return;
        const over = targetAt(drag.source, event.clientX, event.clientY);
        // A pointer stream is ~60 events a second; re-rendering only when the
        // landing slot actually changes keeps the drag from thrashing the tree.
        if (sameTarget(over, drag.over)) return;
        setDrag({ ...drag, over });
      },
      onPointerUp(event) {
        if (drag === null || event.pointerId !== drag.pointerId) return;
        const over = targetAt(drag.source, event.clientX, event.clientY);
        release();
        setDrag(null);
        commit(drag.source, over);
        // Opened last, so the ops the drop queued are in the queue before the
        // buffered payload is applied over them.
        api.endInteraction();
      },
      onPointerCancel(event) {
        if (drag === null || event.pointerId !== drag.pointerId) return;
        cancelRef.current();
      },
    };
  }

  /** Esc and pointercancel both land here: release the gate, dispatch nothing. */
  function cancelDrag() {
    if (drag === null) return;
    release();
    setDrag(null);
    api.endInteraction();
  }

  useEffect(() => {
    cancelRef.current = cancelDrag;
  });

  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelRef.current();
    };
    // Releasing the button outside the window is not guaranteed to deliver a
    // pointerup, and a swallowed one would leave the poll gate shut for good —
    // live sync silently stops for that member. Blur cancels instead.
    const onBlur = () => cancelRef.current();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [isDragging]);

  const controller: DragController = {
    source: drag?.source ?? null,
    over: drag?.over ?? null,
    handleProps,
    acceptsRetarget,
  };

  if (!target) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-[var(--line-1)] bg-[var(--paper)] p-4 text-sm text-[var(--ink-2)]">
        This trip has no days yet.
      </p>
    );
  }

  const insertAt = controller.over?.zone === "list" ? controller.over.index : null;
  // A shelf drop needs "this list will take it"; a reorder already has the
  // marker, and ringing the whole list on top of it is noise.
  const overList = insertAt !== null && controller.source?.kind === "shelf";

  return (
    <div className="mt-4">
      {state.error !== null && (
        <p role="alert" className="mb-3 rounded-lg border border-seal/50 bg-seal/5 px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <TargetDayChip api={api} drag={controller} chipsRef={chipsRef} />

      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <ShelfPanel api={api} drag={controller} />

        <section aria-labelledby="day-blocks">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="day-blocks" className="font-display text-base font-semibold">
              Day {String(target.day).padStart(2, "0")} · {target.destinationName}
            </h3>
            {/* The §3.2.6 readout. */}
            <p className="text-xs text-[var(--ink-2)]">
              {formatSpan(load.plannedMinutes)} planned
              {load.gaps > 0 && ` · ${load.gaps} gap${load.gaps === 1 ? "" : "s"}`}
            </p>
          </div>

          <div
            ref={listRef}
            className={`mt-3 rounded-xl p-1 ${overList ? "ring-2 ring-[var(--accent-ink)]/50" : ""}`}
          >
            {view.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--line-1)] bg-[var(--paper)] p-4 text-sm text-[var(--ink-2)]">
                Nothing here yet — add something from the shelf.
              </p>
            ) : (
              <ol className="space-y-2">
                {view.map((entry, index) => (
                  <Fragment key={entry.id}>
                    {insertAt === index && <DropMarker />}
                    <TimeBlock
                      entry={entry}
                      index={index}
                      api={api}
                      drag={controller}
                      isFirst={index === 0}
                      isLast={index === view.length - 1}
                    />
                  </Fragment>
                ))}
                {insertAt === view.length && <DropMarker />}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Where the dragged row would land. Purely a hint — never a control. */
function DropMarker() {
  return <li aria-hidden="true" className="h-0.5 rounded-full bg-[var(--accent-ink)]" />;
}

/**
 * "Adding to Day 03" — the explicit routing target (spec §3.2.4).
 *
 * Rendered as radios rather than a select: the whole point is that the
 * destination of a `+` tap is visible without opening anything. Each chip is also
 * a drop target, so dragging a place onto "Day 05" retargets and adds in one
 * gesture — but only where the shelf row would survive the retarget.
 */
function TargetDayChip({
  api,
  drag,
  chipsRef,
}: {
  api: DayBuilderApi;
  drag: DragController;
  chipsRef: React.RefObject<HTMLFieldSetElement | null>;
}) {
  const { state } = api;
  const draggingShelf = drag.source?.kind === "shelf";
  return (
    <fieldset ref={chipsRef} className="flex flex-wrap items-center gap-2">
      <legend className="sr-only">Which day new places are added to</legend>
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-2)]">
        Adding to
      </span>
      {state.days.map((day) => {
        const isTarget = day.day === state.targetDay;
        const accepts = drag.acceptsRetarget(day.day);
        const isOver = drag.over?.zone === "chip" && drag.over.day === day.day;
        return (
          <label
            key={day.day}
            data-day={day.day}
            className={`flex min-h-[var(--tap-min)] cursor-pointer items-center rounded-full px-3 text-sm font-medium ${
              isTarget ? "bg-[var(--accent-ink)] text-white" : "bg-[var(--paper)] text-[var(--ink-2)] hover:bg-[var(--line-1)]"
            } ${isOver ? "ring-2 ring-[var(--accent-ink)]" : ""} ${draggingShelf && !accepts ? "opacity-40" : ""}`}
          >
            <input
              type="radio"
              name="target-day"
              className="sr-only"
              checked={isTarget}
              onChange={() => api.setTargetDay(day.day)}
            />
            Day {String(day.day).padStart(2, "0")}
          </label>
        );
      })}
    </fieldset>
  );
}

/** The shelf: unscheduled activities for the target day's destination, plus a custom row. */
function ShelfPanel({ api, drag }: { api: DayBuilderApi; drag: DragController }) {
  const { state } = api;
  const rows = state.shelf.filter((row) => !row.isCustom);
  const custom = state.shelf.find((row) => row.isCustom);
  const draggingKey = drag.source?.kind === "shelf" ? drag.source.shelfKey : null;

  return (
    <section aria-labelledby="shelf-heading" className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3">
      <h3 id="shelf-heading" className="font-display text-base font-semibold">
        Places to add
      </h3>

      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          Everything for this destination is already on the plan.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              {/* The drag handle is the label, not the row: a pointerdown on the
                  `+` button must stay a tap. */}
              <span
                {...drag.handleProps({ kind: "shelf", shelfKey: row.key })}
                title="Drag onto a day, or use +"
                className={`min-w-0 flex-1 cursor-grab truncate text-sm ${
                  draggingKey === row.key ? "cursor-grabbing opacity-40" : ""
                }`}
              >
                {row.title}
              </span>
              {/* The primary add: one tap, no modal, no navigation (§3.2.4). */}
              <button
                type="button"
                onClick={() => api.addFromShelf(row.key)}
                aria-label={`Add ${row.title} to day ${state.targetDay}`}
                className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--accent-ink)]/50 text-lg font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--line-1)]"
              >
                +
              </button>
            </li>
          ))}
        </ul>
      )}

      {custom && (
        <div className="mt-3 border-t border-[var(--line-1)] pt-2">
          <label htmlFor="shelf-custom" className="text-xs font-semibold text-[var(--ink-2)]">
            Something else
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="shelf-custom"
              type="text"
              value={state.customDraft}
              onChange={(event) => api.setCustomDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                api.addFromShelf("custom");
              }}
              placeholder="Anything you like"
              className="min-h-[var(--tap-min)] w-full min-w-0 rounded-lg border border-[var(--line-1)] px-2 text-sm"
            />
            <button
              type="button"
              onClick={() => api.addFromShelf("custom")}
              disabled={custom.title === ""}
              aria-label={`Add your own place to day ${state.targetDay}`}
              className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--accent-ink)]/50 text-lg font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--line-1)] disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One item: a timed block with ±15m controls, or an untimed item in its slot band.
 *
 * Every control is a real button, which is the keyboard path spec §3.2.5 requires
 * as the accessible equivalent of dragging — not an afterthought bolted beside it.
 * The drag handle is the block's header, so the buttons below it stay taps.
 */
function TimeBlock({
  entry,
  index,
  api,
  drag,
  isFirst,
  isLast,
}: {
  entry: ReflowedItem;
  index: number;
  api: DayBuilderApi;
  drag: DragController;
  isFirst: boolean;
  isLast: boolean;
}) {
  const timed =
    typeof entry.startMinutes === "number" &&
    typeof entry.durationMinutes === "number" &&
    entry.durationMinutes > 0;
  const isDragged = drag.source?.kind === "block" && drag.source.itemId === entry.id;

  return (
    <li
      data-block={entry.id}
      className={`rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 ${isDragged ? "opacity-40" : ""}`}
    >
      <div
        {...drag.handleProps({ kind: "block", itemId: entry.id, fromIndex: index })}
        title="Drag to reorder, or use the arrow buttons"
        className={`flex flex-wrap items-center gap-2 ${isDragged ? "cursor-grabbing" : "cursor-grab"}`}
      >
        {timed ? (
          <span className="font-mono text-sm font-semibold">
            {formatClock(entry.startMinutes as number)}
          </span>
        ) : (
          // Untimed items keep their slot band — spec §5.3 forbids inventing a
          // start, so the band is all the position information there is.
          <span className="rounded bg-[var(--surf-1)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--ink-2)]">
            {entry.slot}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>

        {entry.pushedBy !== undefined && (
          <span
            className="shrink-0 rounded bg-[var(--line-1)] px-1.5 py-0.5 text-[10px] text-[var(--accent-ink)]"
            title={`Moved later to clear the block above it`}
          >
            pushed
          </span>
        )}
        {entry.overflows === true && (
          <span className="shrink-0 rounded bg-seal/10 px-1.5 py-0.5 text-[10px] text-seal">
            past midnight
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {timed ? (
          <>
            <span className="mr-1 text-xs text-[var(--ink-2)]">
              {formatSpan(entry.durationMinutes as number)}
            </span>
            <BlockButton
              label={`Shorten ${entry.title} by 15 minutes`}
              onClick={() => api.adjustTiming(entry.id, -DURATION_STEP)}
            >
              −15m
            </BlockButton>
            <BlockButton
              label={`Lengthen ${entry.title} by 15 minutes`}
              onClick={() => api.adjustTiming(entry.id, DURATION_STEP)}
            >
              +15m
            </BlockButton>
            <BlockButton
              label={`Remove the time from ${entry.title}`}
              onClick={() => api.clearBlock(entry.id)}
            >
              Untime
            </BlockButton>
          </>
        ) : (
          // The affordance every existing trip needs: nothing is timed yet, so
          // this is how a block comes into being at all.
          <BlockButton
            label={`Give ${entry.title} a time`}
            onClick={() => api.setBlock(entry.id, FIRST_BLOCK_START, FIRST_BLOCK_DURATION)}
          >
            Set a time
          </BlockButton>
        )}

        <span className="ml-auto flex items-center gap-1">
          <BlockButton
            label={`Move ${entry.title} up`}
            disabled={isFirst}
            onClick={() => api.moveBlock(entry.id, "up")}
          >
            ↑
          </BlockButton>
          <BlockButton
            label={`Move ${entry.title} down`}
            disabled={isLast}
            onClick={() => api.moveBlock(entry.id, "down")}
          >
            ↓
          </BlockButton>
        </span>
      </div>
    </li>
  );
}

function BlockButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] items-center justify-center rounded-lg border border-[var(--line-1)] px-2 text-xs font-semibold text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)] disabled:opacity-40 disabled:hover:border-[var(--line-1)] disabled:hover:text-[var(--ink-2)]"
    >
      {children}
    </button>
  );
}
