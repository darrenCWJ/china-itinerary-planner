"use client";

import { useMemo, useRef, useState } from "react";
import { geoPath } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, MultiPolygon, Polygon } from "topojson-specification";
import { getCountry } from "@/lib/countries";
import { projectionFor, type ProjectionEntry, type ViewBox } from "@/lib/countryProjection";
import { nonOverlappingRadii } from "@/lib/dragLayer";
import { MAP_VIEW_PAD } from "@/lib/mapView";
import { PROVINCE_OBJECT, type ProvinceFile, type ProvinceUnit } from "@/lib/provinceTopology";
import { CountryPlaceList } from "./CountryPlaceList";
import {
  buildFitProjection,
  createHoverReporter,
  makeProjector,
  MAP_VIEW_H,
  MAP_VIEW_W,
  type FittedProjection,
  type HoverPos,
} from "./mapShared";
import { FIT_COLORS, fitForPlace, type MapPlace } from "./mapTypes";
import { SelectedPlaceCard } from "./SelectedPlaceCard";

/**
 * The country level every country that is not China renders (spec §5).
 *
 * A separate file from `ChinaLevel` rather than a generalisation of it, and
 * deliberately: `ChinaLevel` carries the seven curated regions, the nine-dash
 * line and the region zoom, all of which are L3's problem (PR5) and none of
 * which any other country has. §9.5 requires China's rendered output to be
 * byte-identical across this phase, and the cheapest way to guarantee that is
 * for this work to never touch the code path that draws it.
 *
 * Four things here are load-bearing.
 *
 * **The outline is `merge()` over the very units the picker lists**, not a
 * second asset (§4.1). One fetch feeds both, and the seams between units
 * dissolve because they share arcs — a country whose units were separate
 * polygons would draw its internal borders twice, once as a unit edge and once
 * as coastline.
 *
 * **The frame comes from the manifest, not from a fit over what happened to
 * load.** `public/country-projections.json` is where the §5.4 trim decisions
 * live — the nine countries whose outlying polygons are deliberately out of
 * frame — and a per-render `fitExtent` would silently overrule every one of
 * them, putting Clipperton back in France's viewport and shrinking the country
 * anyone actually plans in by a factor of six. The fit remains as the fallback
 * for a country with no entry, because the manifest and the code deploy
 * independently.
 *
 * **The list beside the map is not decoration.** §5.2 makes it the source of
 * truth for the accessibility tree and §12.2 gates the phase on it: the map
 * must never become the only way to select a place. The markers now carry a
 * keyboard model of their own (§5.3.1) and are in the accessibility tree
 * because of it, so each place is two controls — a marker and a list chip.
 * That is deliberate and it is not duplication for its own sake: the marker
 * layer costs ONE tab stop however many places it draws, and the list is what
 * reaches a place the §5.4 trim left outside the viewport.
 *
 * **Activating a marker opens a card, and the modality it was activated with
 * decides where focus goes.** `SelectedPlaceCard` (§5.3.3) is the surface
 * `PlacePopup` cannot be — the popup is a `pointer-events-none` tooltip
 * positioned from mouse events alone, so on a touch screen it never opens and
 * on any screen nothing inside it can be operated. Hover keeps going to the
 * popup, untouched; tap and Enter open the card. The `viaKeyboard` flag
 * threaded through `useMarkerSelection` exists for exactly one reason: focus
 * follows a keyboard activation into the card and comes back on dismiss, and
 * does not move for a pointer one.
 */

/** What this level reads off a unit's TopoJSON geometry. */
interface UnitProps {
  sel: 0 | 1;
}

/**
 * The extent the country is fitted into, inset so coastlines are not flush
 * against the frame.
 *
 * The same box `buildFitProjection` uses, on purpose: the manifest path and
 * the fallback then frame a country identically, and the only difference
 * between them is WHICH geometry decides the bounds. The committed `scale` is
 * measured against the flush 860 x 620 box, so it is not the number this
 * produces — `projectionFor` refits to whatever box it is handed, and §5.4's
 * own test recomputes the committed value from the committed bounds.
 */
const VIEW_BOX: ViewBox = [
  [MAP_VIEW_PAD, MAP_VIEW_PAD],
  [MAP_VIEW_W - MAP_VIEW_PAD, MAP_VIEW_H - MAP_VIEW_PAD],
];

/**
 * Marker geometry, in viewBox units at country level.
 *
 * Plain numbers rather than `x / k` because this level has no zoom transform:
 * `k` is 1 everywhere here, exactly as it is for `ChinaLevel`'s unzoomed
 * curated radius of 7. PR5 adds the province zoom, and every one of these
 * becomes a division the moment it does — that is the discipline that keeps
 * visual weight scale-invariant, and the reason they are named constants
 * rather than literals scattered through the JSX.
 */
const UNIT_STROKE = 0.7;
const OUTLINE_STROKE = 1.2;
const MARKER_STROKE = 1.2;
const SELECTION_RING = 3.5;
/**
 * Outside the selection ring rather than on top of it.
 *
 * The two states land on the same marker constantly — a keyboard user selects
 * by focusing and then pressing Enter — and at the same radius the solid
 * `--seal` ring simply paints over the dashed one, which is a focus indicator
 * that vanishes exactly when it is being used. Concentric keeps both readable.
 */
const FOCUS_RING = SELECTION_RING + 2.5;
const ROUTE_STROKE = 2;

/** `--tap-min`, in CSS pixels — `app/globals.css`, and WCAG 2.2 AA 2.5.8. */
export const TAP_MIN_PX = 44;

/**
 * The widest the map is ever laid out, in CSS pixels: `/plan`'s `max-w-6xl`
 * (72rem) less its `px-4` gutters, from `app/plan/page.tsx`.
 *
 * The SVG is `w-full` over a fixed 860-unit viewBox, so one viewBox unit is
 * `renderedWidth / MAP_VIEW_W` CSS pixels and a radius in viewBox units means
 * a different number of pixels on every viewport. The WIDEST rendering is the
 * worst case and therefore the only one worth sizing against: every narrower
 * one stretches the same viewBox over fewer pixels and gets a larger target.
 */
export const MAP_MAX_RENDER_W = 1120;

/**
 * `--tap-min` as a marker radius, in viewBox units (§5.3.2).
 *
 * Derived rather than written down, because the two numbers it comes from are
 * both real and both liable to move: 44 is the token, 1120 is the layout.
 * `WorldMap`'s docblock converts the same way when it calls its 9-unit hit
 * circle "~22px at desktop" — and reaches the opposite conclusion for the
 * world level, where a compliant circle would swallow San Marino's neighbours
 * outright. At country level the same collision is possible between two
 * cities, so this is a ceiling and `nonOverlappingRadii` is what enforces it.
 *
 * Unscaled for the reason the marker constants above are: `k` is 1 at country
 * level. PR5's province zoom divides this one too — a magnified map draws the
 * same radius over `k` times as many CSS pixels, so `TAP_MIN_R / k` is what
 * keeps the target 44px rather than 44k.
 */
export const TAP_MIN_R = (TAP_MIN_PX / 2) * (MAP_VIEW_W / MAP_MAX_RENDER_W);

/** A place big enough to be worth a name on a country-wide map. */
const LABELLED_PREFECTURE_POPULATION = 3_000_000;

function labelFor(place: MapPlace): boolean {
  return (
    place.kind === "curated" ||
    place.level === "municipality" ||
    (place.level === "prefecture" && (place.population ?? 0) > LABELLED_PREFECTURE_POPULATION)
  );
}

function radiusFor(place: MapPlace): number {
  if (place.kind === "curated") return 7;
  if (place.level === "municipality") return 8;
  if (place.level === "prefecture") return 6.5;
  return 4.5;
}

/** The manifest's projection, plus the path generator that draws through it. */
function fromManifest(entry: ProjectionEntry): FittedProjection {
  const projection = projectionFor(entry, VIEW_BOX);
  return { projection, pathGen: geoPath(projection) };
}

interface UnitShape {
  id: string;
  d: string;
  /** §7.2: false for geometry that shapes the outline without being a choice. */
  selectable: boolean;
  label: string | null;
}

/** Everything spread onto one marker's `<g>`. */
interface MarkerInteractionProps {
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
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: () => void;
}

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
function useMarkerSelection(
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
  onActivate: (place: MapPlace, viaKeyboard: boolean) => void
): {
  markerProps: (place: MapPlace, index: number) => MarkerInteractionProps;
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
    markerProps: (place: MapPlace, index: number): MarkerInteractionProps => {
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

export interface CountryLevelProps {
  /** ISO alpha-2 of the country being planned. */
  country: string;
  /** Its admin-1 geometry, already validated by `parseProvinceTopology`. */
  provinces: ProvinceFile;
  /** Its §5.4 manifest entry, or null to fall back to a fit over the units. */
  projection: ProjectionEntry | null;
  places: MapPlace[];
  selected: string[];
  month: number;
  routeIds: string[];
  onTogglePlace: (place: MapPlace) => void;
  onHoverPlace: (place: MapPlace | null, pos: HoverPos | null) => void;
}

export function CountryLevel({
  country,
  provinces,
  projection,
  places,
  selected,
  month,
  routeIds,
  onTogglePlace,
  onHoverPlace,
}: CountryLevelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { name, code } = getCountry(country);
  const label = name || code || "this country";

  const view = useMemo(() => {
    const topology = provinces.topology;
    const collection = topology.objects[PROVINCE_OBJECT] as GeometryCollection<UnitProps>;
    const features = feature(topology, collection).features;

    /**
     * `collection.geometries`, not `collection`.
     *
     * `@types/topojson-client` declares `merge(topology, GeometryCollection |
     * Array<Polygon | MultiPolygon>)`, and the runtime accepts only the array:
     * `mergeArcs` calls `objects.forEach`, so a GeometryCollection throws
     * "objects.forEach is not a function". The types are wrong, not the docs.
     */
    const outline = merge(
      topology,
      collection.geometries as Array<Polygon<UnitProps> | MultiPolygon<UnitProps>>
    );

    // A manifest entry beats a fit; the fit is what a country without one gets.
    const { projection: proj, pathGen } = projection
      ? fromManifest(projection)
      : buildFitProjection(features);

    const byId = new Map<string, ProvinceUnit>(provinces.units.map((unit) => [unit.id, unit]));
    const units: UnitShape[] = [];
    for (const shape of features) {
      const d = pathGen(shape);
      if (!d) continue;
      const unit = typeof shape.id === "string" ? (byId.get(shape.id) ?? null) : null;
      units.push({
        id: typeof shape.id === "string" ? shape.id : "",
        d,
        selectable: unit?.selectable ?? false,
        // Endonym first, English second, and the id only when a source carries
        // neither — `KI-X02~` has a null name and would otherwise render a
        // `<title>` with nothing in it.
        label: unit ? (unit.nameEn ?? unit.name ?? unit.id) : null,
      });
    }

    return { units, outline: pathGen(outline), project: makeProjector(proj) };
  }, [provinces, projection]);

  const { units, outline, project } = view;

  const routePoints = useMemo(
    () =>
      routeIds
        .map((id) => places.find((p) => p.id === id))
        .filter((p): p is MapPlace => Boolean(p))
        .map((p) => project(p.lon, p.lat)),
    [routeIds, places, project]
  );

  /**
   * Marker positions and their transparent targets (§5.3.2).
   *
   * `nonOverlappingRadii` caps each target at half the distance to its nearest
   * neighbour, for the reason `lib/dragLayer.ts` gives about San Marino and
   * Vatican City: two overlapping transparent circles let paint order decide
   * which place a tap adds, silently and wrongly. Cities crowd far harder than
   * micro-states — a country shard puts a dozen inside one metro area — so the
   * cap bites often, and it is only acceptable because the list below reaches
   * every one of them at the full `--tap-min`. That is the equivalent control
   * WCAG 2.2 AA 2.5.8 allows, and §5.2 already required it to exist.
   *
   * The floor is the marker's own dot: a target INSIDE the visible circle
   * would make the dot's edge the target's edge, which is the failure the
   * hit-area-first ordering exists to prevent. Where two dots are closer than
   * their own radii they already overlapped before this existed.
   *
   * `nonOverlappingRadii` is O(n²) and the largest shard is ~750 places, so
   * this is ~560k distance checks. It runs once per country — the memo it sits
   * in is keyed on the same inputs as the topology decode above it, which
   * costs more — and never on a hover or a selection.
   */
  const marks = useMemo(() => {
    const points = places.map((place) => {
      const [x, y] = project(place.lon, place.lat);
      return { x, y };
    });
    const capped = nonOverlappingRadii(points, TAP_MIN_R);
    return points.map((point, index) => {
      const r = radiusFor(places[index]);
      return { ...point, r, hitR: Math.max(r, capped[index]) };
    });
  }, [places, project]);

  /**
   * The place whose card is open, and whether the keyboard opened it (§5.3.3).
   *
   * The id rather than the place, and re-resolved against `places` below for
   * the same reason `useMarkerSelection` re-resolves its caret: opening another
   * country replaces this prop rather than unmounting the level, and a card
   * holding a `MapPlace` from the shard that just went away would keep
   * rendering a city the map no longer draws.
   */
  const [card, setCard] = useState<{ id: string; viaKeyboard: boolean } | null>(null);

  /**
   * Activating a marker does BOTH: it toggles the place, exactly as a tap
   * always has, and it opens the card on it. The card reports the selection
   * rather than gating it — making the tap open a card the user then has to
   * confirm in would turn one interaction into two for every place added with
   * a mouse, which is most of them.
   */
  const activate = (place: MapPlace, viaKeyboard: boolean) => {
    onTogglePlace(place);
    setCard({ id: place.id, viaKeyboard });
  };

  const { markerProps, focusedId, refocus } = useMarkerSelection(places, selected, activate);

  const cardIndex = card === null ? -1 : places.findIndex((p) => p.id === card.id);
  const cardPlace = cardIndex >= 0 ? places[cardIndex] : null;

  const reportHover = createHoverReporter<MapPlace>(containerRef, onHoverPlace);

  return (
    <div>
      <div ref={containerRef} className="relative">
        <svg
          viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
          className="h-auto w-full select-none"
          // A group, not an image: `role="img"` makes the whole subtree
          // presentational, which is the mistake `WorldMap` and `ChinaLevel`
          // both call out in their own docblocks.
          role="group"
          aria-label={`Map of ${label}`}
        >
          <g data-units="">
            {units.map((unit) => (
              <path
                key={unit.id}
                // Only the selectable ones are marked, because this is the
                // attribute PR5 hangs the province zoom on: a unit that is not
                // a subdivision must not become one by being drawn.
                data-unit={unit.selectable ? unit.id : undefined}
                d={unit.d}
                fill="var(--surf-2)"
                stroke="var(--paper)"
                strokeWidth={UNIT_STROKE}
              >
                {unit.selectable && unit.label && <title>{unit.label}</title>}
              </path>
            ))}
          </g>

          {/* The national border, over the seams the units drew. */}
          {outline && (
            <path
              data-outline=""
              d={outline}
              fill="none"
              stroke="var(--ink-2)"
              strokeOpacity={0.55}
              strokeWidth={OUTLINE_STROKE}
              className="pointer-events-none"
              aria-hidden
            />
          )}

          {/*
            Suggested route, in neutral ink for the reason `ChinaLevel` gives:
            at strokeOpacity 0.75 no fixed colour clears 3:1 against both
            papers, and an accent-coloured line would read as the same mark as
            the `--seal` selection ring beside it.
          */}
          {routePoints.length >= 2 && (
            <polyline
              points={routePoints.map(([x, y]) => `${x},${y}`).join(" ")}
              fill="none"
              stroke="var(--ink-1)"
              strokeWidth={ROUTE_STROKE}
              strokeDasharray="7 5"
              strokeLinecap="round"
              opacity={0.75}
              className="pointer-events-none"
            />
          )}

          {/*
            Markers, each one a button on a roving tabindex (§5.3.1) rather
            than the `aria-hidden` backdrop they were, or the tab stop per
            curated marker `ChinaLevel` gives them. Every place is announced
            twice — here and in the list — and that is the right trade now
            that both are operable: the list is the spine, and this layer adds
            exactly one stop to the tab order however many cities it draws.
          */}
          <g data-markers="">
            {places.map((place, index) => {
              const { x, y, r, hitR } = marks[index];
              const isSelected = selected.includes(place.id);
              const stopIndex = routeIds.indexOf(place.id);
              return (
                <g
                  key={place.id}
                  data-place={place.id}
                  {...markerProps(place, index)}
                  onClick={() => activate(place, false)}
                  onMouseEnter={(e) => reportHover(place, e)}
                  onMouseMove={(e) => reportHover(place, e)}
                  onMouseLeave={() => reportHover(null)}
                >
                  {/* Hit area first, so the visible dot is never the target's
                      edge — the ordering `WorldMap` establishes. */}
                  <circle data-hit="" cx={x} cy={y} r={hitR} fill="transparent" />
                  {place.id === focusedId && (
                    // Dashed, so keyboard focus stays distinguishable from
                    // selection when they land on the same place — the same
                    // distinction `worldLevelShared`'s `strokeFor` draws.
                    <circle
                      data-focus-ring=""
                      cx={x}
                      cy={y}
                      r={r + FOCUS_RING}
                      fill="none"
                      stroke="var(--ink-0)"
                      strokeWidth={1.2}
                      strokeDasharray="3 2"
                      className="pointer-events-none"
                    />
                  )}
                  {isSelected && (
                    <circle
                      data-selection-ring=""
                      cx={x}
                      cy={y}
                      r={r + SELECTION_RING}
                      fill="none"
                      stroke="var(--seal)"
                      strokeWidth={2}
                      opacity={0.9}
                    />
                  )}
                  <circle
                    data-dot=""
                    cx={x}
                    cy={y}
                    r={r}
                    fill={FIT_COLORS[fitForPlace(place, month)]}
                    fillOpacity={place.kind === "curated" ? 0.95 : 0.8}
                    stroke="var(--paper)"
                    strokeWidth={MARKER_STROKE}
                  />
                  {isSelected && stopIndex >= 0 && (
                    <text
                      x={x}
                      y={y + (r > 5 ? 3.2 : 2.8)}
                      textAnchor="middle"
                      fontSize={Math.max(8, r * 1.1)}
                      fontWeight={700}
                      fill="var(--paper)"
                      className="pointer-events-none"
                    >
                      {stopIndex + 1}
                    </text>
                  )}
                  {labelFor(place) && (
                    <text
                      x={x}
                      y={y - r - 3}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill="var(--ink-0)"
                      stroke="var(--paper)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      className="pointer-events-none"
                    >
                      {place.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/*
          §5.3.3's card, inside the positioned container so it can anchor to the
          marker it belongs to. `PlacePopup` is a sibling of this whole level in
          `MapExplorer` and is unaffected: hover still reports through
          `onHoverPlace` and still draws the tooltip at the cursor. This is the
          surface tap and Enter open, which hover-positioned markup could never
          be.
        */}
        {cardPlace && card && (
          <SelectedPlaceCard
            // Keyed on the place so moving to another marker remounts rather
            // than mutates: `takeFocus` is read on mount, and a card that
            // merely re-rendered into a new place would keep the focus state of
            // the interaction that opened the previous one.
            key={cardPlace.id}
            place={cardPlace}
            month={month}
            selected={selected.includes(cardPlace.id)}
            anchor={{ x: marks[cardIndex].x, y: marks[cardIndex].y }}
            takeFocus={card.viaKeyboard}
            onToggle={() => onTogglePlace(cardPlace)}
            onDismiss={(heldFocus) => {
              setCard(null);
              // Only when the card actually had focus. Dismissing by clicking
              // somewhere else is not a request to be sent back to the map.
              if (heldFocus) refocus(cardPlace.id);
            }}
          />
        )}
      </div>

      <div className="mt-4">
        <CountryPlaceList
          country={country}
          places={places}
          selected={selected}
          onTogglePlace={onTogglePlace}
          hasMap
        />
      </div>
    </div>
  );
}
