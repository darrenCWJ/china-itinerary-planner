"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  FIT_COLORS,
  FIT_LABELS,
  fitForPlace,
  formatPopulation,
  originLineFor,
  type DerivedClimateIndex,
  type MapPlace,
} from "./mapTypes";
import { MAP_VIEW_H, MAP_VIEW_W } from "./mapShared";

/**
 * The selected-place card (spec §5.3.3) — a net-new surface, not a variant of
 * `PlacePopup`.
 *
 * `PlacePopup` is `role="tooltip"` and `pointer-events-none`, positioned from
 * `onMouseEnter`/`onMouseMove` alone. That is a correct tooltip and it stays
 * exactly as it is; what it cannot be is a **destination**. It has no touch
 * story at all — with no hover there is nothing to open it — nothing inside it
 * can be operated, which is why its own call to action is a sentence asking you
 * to click the marker underneath it, and it cannot hold focus, so it can say
 * nothing to a keyboard user. The roadmap's §6.4 assumed "a selected city's
 * card" it could add an airport line to already existed. It did not exist
 * anywhere in the map layer.
 *
 * So this is that card: it opens from a tap or from Enter/Space on a marker, it
 * takes focus when the keyboard opened it and gives it back on dismiss, it
 * dismisses on Escape and on a click outside, and it carries controls. PR7's
 * climate `lo`/`hi` line and PR8's "Main airport: TNA · 30 km" (§10.2) go into
 * `children`.
 *
 * **Additive, and that is a constraint rather than a description.** Hover keeps
 * opening the tooltip and nothing else, because the two surfaces would open at
 * the same point under the same cursor — the tooltip follows the pointer, and
 * the card anchors to the marker the pointer is on. The modality each serves is
 * the one the other cannot: hover for the mouse, tap and Enter for everything
 * else.
 */

/** Card width in CSS pixels, matching `PlacePopup`'s so the two read as kin. */
const CARD_W = 260;

/**
 * How far down the map the anchor has to be before the card flips above it,
 * as a percentage of the viewBox height. `PlacePopup` makes the same decision
 * against a pixel threshold; a percentage is what works here, because this card
 * is positioned in the viewBox's own fractions rather than in measured pixels.
 */
const FLIP_ABOVE_PCT = 45;

export interface SelectedPlaceCardProps {
  place: MapPlace;
  /** The month being planned, for the fit chip. */
  month: number;
  /** Whether the place is in the plan — the toggle reflects it and flips it. */
  selected: boolean;
  /**
   * Where the marker is DRAWN, in viewBox units.
   *
   * Drawn, not projected, and the distinction is the caller's to make. This
   * card is an HTML sibling of the `<svg>` rather than a node inside it, so the
   * province zoom's transform — which moves every marker, the units under them
   * and the route between them — reaches none of it. A caller that is zoomed
   * has to hand over the post-transform position (`CountryLevel`'s `paintedAt`
   * is that arithmetic), because a card given the pre-transform one would hang
   * where its marker used to be, by as much as the zoom moved it.
   *
   * The card cannot do that conversion for itself and should not be given the
   * chance to: it would have to be told the SVG's transform to undo a decision
   * the SVG had already made, and there would then be two places where a zoom
   * is applied.
   */
  anchor: { x: number; y: number };
  /**
   * Focus the card as it opens. Set only when the open came from the keyboard:
   * a pointer user who taps a marker has not asked to leave the map, and moving
   * focus for them would scroll the card into view and drop the caret they were
   * never using.
   */
  takeFocus: boolean;
  onToggle: () => void;
  /**
   * `heldFocus` says the card had focus when it went away, so the caller knows
   * whether to put focus back on the marker. The card is the only thing that
   * can answer it — by the time the caller re-renders, the node is gone.
   */
  onDismiss: (heldFocus: boolean) => void;
  /**
   * The open country's derived climate, keyed by `MapPlace.id`, so the fit
   * chip agrees with the marker this card opened from — `CountryLevel`
   * colours that marker through `fitForPlace(place, month, climate)`, and a
   * chip that resolved without the index would read "No data" over a green
   * pin. Optional for the same reason the marker's is: a level with none
   * draws every non-China place grey, and the chip should say so too.
   */
  climate?: DerivedClimateIndex;
  /** §6.4's climate and airport lines. Nothing passes any yet. */
  children?: ReactNode;
}

export function SelectedPlaceCard({
  place,
  month,
  selected,
  anchor,
  takeFocus,
  onToggle,
  onDismiss,
  climate,
  children,
}: SelectedPlaceCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const dismiss = () => {
    // `contains` rather than `=== document.activeElement`: focus may have moved
    // on to the close button or the toggle inside the card, and returning it to
    // the marker is right in all three cases.
    const heldFocus = ref.current?.contains(document.activeElement) ?? false;
    onDismiss(heldFocus);
  };

  // The latest `dismiss`, so the listeners below can be attached once. Without
  // it the effect's dep list carries a closure that is new on every render, and
  // the document listeners are torn down and rebuilt on every selection change.
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  });

  useEffect(() => {
    if (takeFocus) ref.current?.focus();
  }, [takeFocus]);

  // Escape and click-outside, the pattern `AccountChip` already establishes.
  // Mounted only while the card is open — the caller renders it conditionally —
  // so there is no `open` guard here and no listener on a closed surface.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissRef.current();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) dismissRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    // `mousedown`, not `click`, for the reason every menu in this app uses it:
    // a click that starts inside the card and ends outside it is a drag, not a
    // dismissal. The card opens on the marker's `click`, which is after the
    // `mousedown` that would otherwise close it the instant it appeared.
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  const fit = fitForPlace(place, month, climate);
  const originLine = originLineFor(place);
  const population = formatPopulation(place.population);
  const size = place.attractionCount > 0 ? `${place.attractionCount} sights` : population;

  /**
   * Positioned in the viewBox's own fractions, not in measured pixels.
   *
   * The SVG is `w-full` over a fixed viewBox inside this `relative` container,
   * so one percent of the container is exactly one percent of the viewBox on
   * every viewport — no `getBoundingClientRect`, nothing to re-measure on a
   * resize, and it is correct in jsdom, which computes no layout at all.
   * `PlacePopup` has to measure because it is positioned from a mouse event,
   * which is in client pixels; this is positioned from geometry.
   *
   * `clamp` keeps the card on screen when the anchor is not: the §5.4 trim
   * leaves nine countries with markers outside the frame at negative x, and a
   * card for one of them still has to be readable. It is also why the x axis
   * has no test against a rendered card — jsdom's CSS parser drops a
   * declaration it cannot compute, and `clamp()` is one, so `style.left` is
   * absent from every render it produces. `CountryLevel.test.tsx` pins that
   * axis where the number is computed instead.
   *
   * `anchor` is the marker's DRAWN position, which under a province zoom is
   * not the position it was projected to — see the prop's own docblock. The
   * percentages below are of the frame, and the frame is what the zoom moves
   * the marker within.
   */
  const leftPct = (anchor.x / MAP_VIEW_W) * 100;
  const topPct = (anchor.y / MAP_VIEW_H) * 100;
  const above = topPct > FLIP_ABOVE_PCT;

  return (
    <div
      ref={ref}
      // A dialog, not a tooltip, and non-modal: the map behind it stays live,
      // so a second tap moves the card to another marker rather than making
      // someone dismiss this one first.
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      className="absolute z-30 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-3 shadow-lg"
      style={{
        width: CARD_W,
        left: `clamp(0px, calc(${leftPct}% - ${CARD_W / 2}px), calc(100% - ${CARD_W}px))`,
        top: `calc(${topPct}% + ${above ? "-14px" : "22px"})`,
        transform: above ? "translateY(-100%)" : undefined,
      }}
    >
      <div className="flex items-baseline gap-2">
        {place.emoji && <span aria-hidden>{place.emoji}</span>}
        <h5 id={headingId} className="font-display text-sm font-bold">
          {place.name}
        </h5>
        {place.localName && (
          <span className="font-kai text-xs text-[var(--seal)]">{place.localName}</span>
        )}
      </div>
      {originLine !== "" && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-2)]">
          {originLine}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: FIT_COLORS[fit] }}
          aria-hidden
        />
        <span className="text-xs font-semibold">{FIT_LABELS[fit]}</span>
        {size && <span className="text-xs text-[var(--ink-2)]">{size}</span>}
      </div>

      {/*
        PR7's climate line and PR8's "Main airport: TNA · 30 km" (§10.2). Empty
        today and deliberately not stubbed: a placeholder would be the first
        thing either PR had to delete, and this exists so neither has to invent
        a place to put its line — which is what §5.3.3 found had never been
        built. `empty:hidden` keeps it from spending a margin on nothing.
      */}
      <div data-place-facts="" className="mt-1 space-y-1 text-xs text-[var(--ink-2)] empty:hidden">
        {children}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {/*
          Named for the place, not "Add to trip", and the name is the VISIBLE
          text rather than an `aria-label` over a shorter one — WCAG 2.2 AA
          2.5.3 wants the accessible name to contain what is on the control, so
          a voice user asking to "click add to trip" reaches the same button a
          screen reader just read out.
        */}
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          className={`min-h-[var(--tap-min)] flex-1 rounded-full border px-3.5 text-sm transition-colors ${
            selected
              ? "border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--paper)]"
              : "border-[var(--line-1)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
          }`}
        >
          {selected ? `Remove ${place.name} from trip` : `Add ${place.name} to trip`}
        </button>
        <button
          type="button"
          onClick={dismiss}
          // Named for the place rather than a bare "Close": a screen-reader
          // user listing the controls on this page hears which of them it shuts.
          aria-label={`Close ${place.name}`}
          className="min-h-[var(--tap-min)] rounded-full border border-[var(--line-1)] px-3 text-sm text-[var(--ink-2)] transition-colors hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    </div>
  );
}
