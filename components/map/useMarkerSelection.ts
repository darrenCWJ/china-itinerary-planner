"use client";

import { useRef, useState } from "react";
import type { MapPlace } from "./mapTypes";

/**
 * §5.3.1's roving tabindex over the marker layer, and the two prop shapes a
 * marker gets: the full set of controls, or nothing at all. Moved verbatim out
 * of CountryLevel.tsx on 2026-09-07 so that file stays under the 800-line
 * guidance; every docblock below is that file's.
 */

/** Everything spread onto one marker's `<g>` in a level that can be planned in. */
export interface MarkerInteractionProps {
  ref: (node: SVGGElement | null) => void;
  role: "button";
  tabIndex: number;
  "aria-pressed": boolean;
  /**
   * Activating a marker opens §5.3.3's card and, from the keyboard, moves focus
   * into it. Announced rather than sprung: a caret that leaves the marker layer
   * without warning is indistinguishable from focus being lost, which is the
   * thing a roving tabindex exists to prevent.
   */
  "aria-haspopup": "dialog";
  "aria-label": string;
  className: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * What a read-only marker gets instead: nothing.
 *
 * Not a subset with the role left on. Every field above is a claim — `role`
 * that it can be pressed, `tabIndex` that it is worth a Tab, `aria-haspopup`
 * that pressing it opens something, `aria-label` that it is a control with a
 * name, `cursor-pointer` that a mouse has somewhere to go — and on a surface
 * that toggles nothing, each of them is false. The place is still drawn, still
 * labelled on the map, and still a real `<button>` in the list below (§5.2),
 * which is where its one honest control lives.
 *
 * `Record<string, never>` rather than an empty interface so the spread is typed
 * as adding nothing at all, and a field added here has to be argued for.
 */
export type ReadOnlyMarkerProps = Record<string, never>;

const READ_ONLY_MARKER: ReadOnlyMarkerProps = {};

/**
 * Roving tabindex over the marker layer (§5.3.1), ported from
 * `useCountrySelection` in `worldLevelShared.tsx`.
 *
 * The PATTERN, not the hook. That one picks exactly one country out of a
 * name-sorted list and tints it from an accent ramp; this one toggles any
 * number of places in and out of a plan and colours them by month fit, so
 * there is no shared implementation to extract without inventing a third
 * abstraction over two. What is shared is the part that matters and the part
 * that was argued for once: **the marker layer is ONE tab stop**, `tabStop`
 * names which marker carries it, arrows move a caret between markers without
 * leaving the group, and Enter/Space acts on the marker the caret is on.
 *
 * `ChinaLevel` gives `tabIndex={0}` to every curated marker and `-1` to every
 * catalog one, which `worldLevelShared` calls "fine for thirty of them and
 * indefensible for 235". A country shard draws up to 750, and the ones that
 * would have been skipped entirely under that rule are the catalog cities —
 * i.e. all of them, outside China.
 *
 * There is no `mounted` set and none is needed: Mercator clips nothing, so
 * every place in `places` has a node, including the ones the §5.4 trim leaves
 * outside the viewport. The caret can land on one, and the list reaches it.
 */
export function useMarkerSelection(
  places: MapPlace[],
  selected: string[],
  /**
   * Activation, with the modality that caused it.
   *
   * Not `onTogglePlace` any more, because §5.3.3's card has to know: a keyboard
   * activation moves focus into the card, and a pointer one must not. The
   * distinction cannot be recovered downstream — by the time the card mounts,
   * both look like a state change — and it is not `event.detail === 0` either,
   * which is a heuristic about how a click was synthesised rather than a fact
   * about which handler ran.
   */
  onActivate: (place: MapPlace, viaKeyboard: boolean) => void,
  /**
   * Whether the level can be planned in at all.
   *
   * The whole keyboard model hangs off this rather than off a check inside
   * `onActivate`, because what a read-only marker must stop doing first is
   * ANNOUNCING: an inert `role="button"` is a promise the accessibility tree
   * makes on the map's behalf, and it is the one a user acts on.
   */
  interactive: boolean
): {
  markerProps: (place: MapPlace, index: number) => MarkerInteractionProps | ReadOnlyMarkerProps;
  focusedId: string | null;
  /** Put focus back on one marker — what a dismissed card returns it to. */
  refocus: (id: string) => void;
} {
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  /**
   * Which marker Tab lands on: wherever the caret was left, else a place
   * already in the plan, else the first place drawn.
   *
   * The second term is what a user who has never touched the map gets — they
   * added Cusco through the list, so tabbing into the map puts them on Cusco
   * rather than on whichever city the shard happens to list first. The first
   * term is dropped rather than trusted when the shard it pointed into has
   * been replaced by another country's, which is a prop change here and not an
   * unmount: a stale id would leave `tabIndex 0` on nothing at all.
   */
  const active = activeId !== null && places.some((p) => p.id === activeId) ? activeId : null;
  const tabStop =
    active ?? places.find((p) => selected.includes(p.id))?.id ?? places[0]?.id ?? null;

  const focusEntry = (index: number) => {
    if (places.length === 0) return;
    const wrapped = ((index % places.length) + places.length) % places.length;
    const next = places[wrapped];
    setActiveId(next.id);
    nodeRefs.current.get(next.id)?.focus();
  };

  const stepFor = (key: string): number => {
    if (key === "ArrowRight" || key === "ArrowDown") return 1;
    if (key === "ArrowLeft" || key === "ArrowUp") return -1;
    return 0;
  };

  const handleKeyDown = (event: React.KeyboardEvent, place: MapPlace, index: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onActivate(place, true);
      return;
    }
    const step = stepFor(event.key);
    if (step !== 0) {
      event.preventDefault();
      focusEntry(index + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusEntry(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusEntry(places.length - 1);
    }
  };

  return {
    focusedId,
    refocus: (id: string) => nodeRefs.current.get(id)?.focus(),
    markerProps: (
      place: MapPlace,
      index: number
    ): MarkerInteractionProps | ReadOnlyMarkerProps => {
      if (!interactive) return READ_ONLY_MARKER;
      const isSelected = selected.includes(place.id);
      return {
        ref: (node: SVGGElement | null) => {
          if (node) nodeRefs.current.set(place.id, node);
          else nodeRefs.current.delete(place.id);
        },
        role: "button",
        tabIndex: place.id === tabStop ? 0 : -1,
        "aria-pressed": isSelected,
        "aria-haspopup": "dialog",
        "aria-label": `${place.name}${isSelected ? " (selected)" : ""}`,
        className: "cursor-pointer",
        // Here rather than on the `<g>` in the JSX, so that ONE decision — the
        // `interactive` branch above — removes every way in. A click handler
        // left behind by a level that had dropped its role would still open the
        // card on a tap, which is the modality the defect was reported through.
        onClick: () => onActivate(place, false),
        onKeyDown: (event: React.KeyboardEvent) => handleKeyDown(event, place, index),
        onFocus: () => {
          setActiveId(place.id);
          setFocusedId(place.id);
        },
        onBlur: () => setFocusedId((current) => (current === place.id ? null : current)),
      };
    },
  };
}
