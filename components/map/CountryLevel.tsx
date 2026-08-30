"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { geoPath, type GeoPath } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryCollection, MultiPolygon, Polygon } from "topojson-specification";
import { getCountry } from "@/lib/countries";
import { projectionFor, type ProjectionEntry, type ViewBox } from "@/lib/countryProjection";
import { nonOverlappingRadii } from "@/lib/dragLayer";
import { IDENTITY_TRANSFORM } from "@/lib/mapTransform";
import { MAP_VIEW_PAD } from "@/lib/mapView";
import { PROVINCE_OBJECT, type ProvinceFile, type ProvinceUnit } from "@/lib/provinceTopology";
import { regionSchemeFor, type RegionId } from "@/lib/regionScheme";
import { CountryPlaceList } from "./CountryPlaceList";
import {
  buildFitProjection,
  createHoverReporter,
  makeProjector,
  transformForFeatures,
  MAP_VIEW_H,
  MAP_VIEW_W,
  ZOOM_MS,
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
 * line and China's own region zoom, none of which any other country has. §9.5
 * requires China's rendered output to be byte-identical across this phase, and
 * the cheapest way to guarantee that is for this work to never touch the code
 * path that draws it.
 *
 * This level now has a region zoom of its own, and that is convergence rather
 * than duplication: `regionSchemeFor` answers "what are this country's regions"
 * for all 246, and China's seven are one of its answers. What is not shared is
 * the DRAWING, which is the half §9.5 pins.
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
 *
 * **`readOnly` is a mode, and it exists because a noop callback is not one.**
 * `RouteMap` draws an itinerary that already exists (§2.1) and has always
 * passed `noop` for the toggle. Every control above still rendered against
 * it: a marker announcing `role="button"` and `aria-pressed`, holding a tab
 * stop, opening a card whose primary button reads "Remove <name> from trip" —
 * on a surface where none of it can change anything. The damage is in the
 * ANNOUNCEMENT as much as in the dead callback, so the mode is what the
 * markers are built from rather than a guard inside `activate`: read-only
 * markers are a drawing of the plan, with no role, no tab stop and no card.
 * Hover is untouched, because a tooltip describes without offering.
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
 * Marker geometry, in viewBox units **at `k` = 1** — which is to say, the
 * number each of these is meant to be on screen.
 *
 * Every one of them is written `/ k` at its use site, and that is not
 * decoration. The province zoom magnifies the whole group by `k`, so a
 * constant left undivided is drawn over `k` times as many CSS pixels: at the
 * ceiling of 5 a 0.7-unit province border is a 3.5-pixel one, and the map
 * dissolves into a handful of fat strokes exactly as `MAX_ZOOM_K`'s docblock
 * warns. Dividing here is what makes visual weight scale-invariant, and it is
 * why these are named constants rather than literals scattered through the JSX
 * — a literal is a place a `/ k` can go missing without anyone noticing.
 *
 * `CountryLevel.test.tsx`'s "every stroke, radius and font divides by k" holds
 * the whole set to that ratio by rendering the map twice, so a constant added
 * later without one fails there rather than on someone's screen.
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
 * `--tap-min` as a marker radius in viewBox units, at a given rendered width
 * (§5.3.2).
 *
 * The SVG is `w-full` over a fixed 860-unit viewBox, so one viewBox unit is
 * `renderedWidth / MAP_VIEW_W` CSS pixels — 1.30px across a 1120px desktop
 * column, 0.45px across a 390px phone. A radius in viewBox units is therefore
 * a different number of pixels on every viewport, and it moves the OPPOSITE
 * way from the viewport: a NARROWER screen stretches the same viewBox over
 * FEWER pixels, each unit is worth less, and the compliant radius is LARGER.
 * 16.9 units on the desktop column; 48.5 on the phone.
 *
 * That inversion is why this is a function of a measured width and not the
 * constant it obviously wants to be. Folding `MAP_MAX_RENDER_W` in and calling
 * the widest layout the worst case reads as the conservative choice and is the
 * exact opposite of one: it yields 44px at 1120 and less at every width below
 * — 30px at 768, 15px at 390 — so it fails 2.5.8 on every phone, i.e. on
 * precisely the devices a minimum tap target exists for. If a later PR is
 * tempted to simplify this back to a constant, that is the arithmetic it has
 * to answer, and `CountryLevel.test.tsx` asserts it at three widths.
 *
 * `renderedWidth` must be positive; `useRenderedWidth` is what guarantees it,
 * by reporting an unmeasurable container as null rather than as 0.
 *
 * `WorldMap`'s docblock converts the same way when it calls its 9-unit hit
 * circle "~22px at desktop" — and reaches the opposite conclusion for the
 * world level, where a compliant circle would swallow San Marino's neighbours
 * outright. At country level the same collision is possible between two
 * cities, so this is a ceiling and `nonOverlappingRadii` is what enforces it.
 * The narrower the screen the harder that cap bites, which is the trade §5.2's
 * list is there to make acceptable.
 *
 * At `k` = 1, for the reason the marker constants above are, and divided by
 * `k` at its use site like every one of them: a magnified map draws the same
 * radius over `k` times as many CSS pixels, so `/ k` is what keeps the target
 * 44px rather than 44k. It is the MEASUREMENT that is divided —
 * `tapTargetRadius(renderedWidth) / k`, never `TAP_MIN_R_FALLBACK / k` —
 * because a zoomed phone needs three times the radius a zoomed desktop does,
 * exactly as an unzoomed one does.
 */
export function tapTargetRadius(renderedWidth: number): number {
  return (TAP_MIN_PX / 2) * (MAP_VIEW_W / renderedWidth);
}

/**
 * The widest the map is ever laid out, in CSS pixels: `/plan`'s `max-w-6xl`
 * (72rem) less its `px-4` gutters, from `app/plan/page.tsx`.
 */
export const MAP_MAX_RENDER_W = 1120;

/**
 * The radius used until a width can be measured: the server render, the first
 * client paint, and jsdom — which lays nothing out and answers 0 to every
 * `getBoundingClientRect`.
 *
 * The widest layout gives the SMALLEST compliant radius, so this is the floor
 * of the honest range rather than a middle guess. An unmeasured frame then
 * draws a target that is merely too small on a phone, for the one commit
 * before the measurement replaces it, instead of one that swallows half the
 * country's cities on a desktop and has to shrink back.
 */
export const TAP_MIN_R_FALLBACK = tapTargetRadius(MAP_MAX_RENDER_W);

/**
 * The container's own width in CSS pixels, or null while there is nothing to
 * measure.
 *
 * §5.3.2's target is specified in CSS pixels and drawn in viewBox units, and
 * only the browser knows the ratio between them: `w-full` hands the width to
 * the layout, so a phone, a tablet and a desktop column each produce a
 * different one. Measuring is the only way to honour a pixel token from inside
 * a scaled viewBox — any compile-time constant is correct at exactly one width
 * and wrong at all the others.
 *
 * `useEffect` rather than `useLayoutEffect`: this is a `"use client"` component
 * that Next still renders on the server, where a layout effect is a warning and
 * a no-op. The cost is one commit at `TAP_MIN_R_FALLBACK`, and the circle it
 * sizes is `fill="transparent"`, so nothing visible moves when it is replaced.
 *
 * The observer is what carries it through a rotation or a window drag, both of
 * which change the ratio without remounting anything. jsdom implements no
 * `ResizeObserver`, so there the mount measurement stands alone.
 */
function useRenderedWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const measured = node.getBoundingClientRect().width;
      // 0 is what jsdom answers for everything and what a browser answers for
      // a `display: none` subtree. Neither is a width to divide by.
      setWidth(measured > 0 ? measured : null);
    };
    measure();

    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

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

/** One unit as geometry rather than as a path string — what a zoom measures. */
type UnitFeature = GeoJSON.Feature<GeoJSON.Geometry, UnitProps>;

/**
 * Everything one country's topology is drawn from, and everything a zoom into
 * one of its units needs to frame it.
 *
 * The first three are what the JSX consumes. The last two used to be computed
 * here and thrown away, and the province zoom is what wants them back: they
 * are the pair `transformForFeatures` takes — a generator, and the features to
 * frame — and they fall out of the same pass that produced the `d` strings.
 * `pathGen` turns a unit into the path beside it; `pathGen.bounds(feature)`
 * turns the same unit into the extent the zoom is fitted to. Rebuilding a
 * projection at zoom time would be that arithmetic twice over and, worse, a
 * SECOND answer to "where is this province" — the kind of drift that leaves a
 * marker outside the frame that was supposed to hold it.
 */
export interface CountryView {
  units: UnitShape[];
  /** The merged national border, or null when the merge drew nothing. */
  outline: string | null;
  project: (lon: number, lat: number) => [number, number];
  /**
   * The generator the shapes above were drawn through.
   *
   * Exposed to be MEASURED with, not to re-draw with: every `d` a unit needs
   * is already in `units`, and a second `pathGen(feature)` per frame is
   * precisely the cost the memo around this exists to pay once.
   */
  pathGen: GeoPath;
  /**
   * The units a region group can name, by id.
   *
   * Selectable ones, and drawn ones. `regionSchemeFor` drops `sel: 0` for
   * §7.2's reason — ISO 3166-1 governs territorial EXTENT while 3166-2 governs
   * SUBDIVISION identity — and this map drops them for the same one, so the set
   * that can be zoomed to is exactly the set `data-unit` marks. That matters
   * because 43 committed `cityProvince` values name a unit this omits: a
   * lookup that ought to miss must not be made to hit by a second, laxer index
   * of the same geometry.
   *
   * A miss therefore resolves to no feature, an empty list, and
   * `IDENTITY_TRANSFORM` from the guard in `transformForFeatures` — an
   * unzoomed map rather than a vanished one.
   */
  selectableFeatures: ReadonlyMap<string, UnitFeature>;
}

/**
 * Decodes one country's province file into everything drawn from it.
 *
 * A module-level function rather than an inline `useMemo` body, because it is
 * the expensive half of this file — a TopoJSON decode, a `merge()` over every
 * unit, and one path render each — and out here a test can hold its product in
 * a hand instead of inferring it from the DOM. The memo is then one line, and
 * its dependency array is the whole of its policy: this runs once per
 * topology, and a zoom must never be one of its inputs.
 */
export function buildCountryView(
  provinces: ProvinceFile,
  projection: ProjectionEntry | null
): CountryView {
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
  const selectableFeatures = new Map<string, UnitFeature>();
  for (const shape of features) {
    const d = pathGen(shape);
    if (!d) continue;
    const id = typeof shape.id === "string" ? shape.id : "";
    const unit = typeof shape.id === "string" ? (byId.get(shape.id) ?? null) : null;
    const selectable = unit?.selectable ?? false;
    units.push({
      id,
      d,
      selectable,
      // Endonym first, English second, and the id only when a source carries
      // neither — `KI-X02~` has a null name and would otherwise render a
      // `<title>` with nothing in it.
      label: unit ? (unit.nameEn ?? unit.name ?? unit.id) : null,
    });
    // Indexed off the same `selectable` the path above was drawn with, inside
    // the same `if (!d) continue`, so the zoomable set cannot drift from the
    // drawn one.
    if (selectable) selectableFeatures.set(id, shape);
  }

  return {
    units,
    outline: pathGen(outline),
    project: makeProjector(proj),
    pathGen,
    selectableFeatures,
  };
}

/** Everything spread onto one marker's `<g>` in a level that can be planned in. */
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
type ReadOnlyMarkerProps = Record<string, never>;

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
  /**
   * The region this level is framed on — a `regionSchemeFor` group id — or
   * null for the whole country.
   *
   * `RegionId` and deliberately not `ChinaRegion`. `tsconfig.json` does not set
   * `noUncheckedIndexedAccess`, so widening that union would let a non-China
   * key index `REGION_MONTHS` and `REGION_META` with no compile error and a
   * TypeError at render; `lib/regionScheme.ts` sets out the whole argument.
   *
   * Optional, unlike `readOnly`, and the difference is real rather than
   * stylistic. `readOnly` has to be stated because a caller passing a noop
   * toggle silently MEANT it and got the opposite; here no caller can
   * accidentally mean "zoomed", and the whole country is what every picker
   * shows until someone asks for less.
   */
  region?: RegionId | null;
  /**
   * The level draws a plan rather than building one: no marker is a control,
   * and tapping one opens nothing.
   *
   * Optional and interactive by default, because that is what every picker
   * call site means and a flag on each of them would be noise. What it is NOT
   * is inferred from `onTogglePlace` — a caller that passes a callback which
   * does nothing (`RouteMap` did, for exactly this reason) still gets the full
   * set of controls, all of them lying. The mode has to be stated.
   */
  readOnly?: boolean;
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
  region = null,
  readOnly = false,
  onTogglePlace,
  onHoverPlace,
}: CountryLevelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { name, code } = getCountry(country);
  const label = name || code || "this country";

  const renderedWidth = useRenderedWidth(containerRef);

  /**
   * Once per topology, and on nothing else.
   *
   * `[provinces, projection]` is the whole of the policy: the decode, the
   * merge and one path render per unit are what this costs, and the zoom —
   * which changes on a click and reads `pathGen` and `selectableFeatures` off
   * the result — must stay out of these deps. It would re-run all of it to
   * produce the same paths it produced last time.
   */
  const view = useMemo(() => buildCountryView(provinces, projection), [provinces, projection]);

  const { units, outline, project } = view;

  /**
   * The zoomable groups this country offers, and the join between a group id
   * and the geometry it names.
   *
   * `regionSchemeFor` rather than a lookup straight into `selectableFeatures`,
   * because a group is not always a unit: China's seven regions are a level
   * ABOVE admin-1 (§6.4) and "East" is five provinces. For the other 245
   * countries the list is one id long and the two are the same thing.
   *
   * Keyed on the province file, so it costs one pass per country. §6.6's
   * single-unit gate falls out of it for free: a country with one selectable
   * unit has no groups, so no region id can match and the map stays where it
   * was.
   */
  const scheme = useMemo(() => regionSchemeFor(country, provinces.units), [country, provinces]);

  /**
   * The zoom itself, and the identity transform until one is asked for.
   *
   * Three ways to end up unzoomed, and all three are a map rather than a
   * blank: no region, a region no group answers to, and a group whose units
   * carry no drawable geometry. The first is stated here because "nothing is
   * selected" is not the same fact as "the filter matched nothing" and should
   * not read as one. The other two both arrive at `transformForFeatures`,
   * which is where §6.2's guard lives — 43 committed `cityProvince` values
   * name a unit `regionSchemeFor` omits, so a lookup that misses is a case
   * this level actually sees.
   *
   * `view` in the deps rather than `view.pathGen` and `view.selectableFeatures`
   * separately: they are two fields of one memoised object and cannot change
   * apart from each other.
   */
  const { k, tx, ty } = useMemo(() => {
    if (!region) return IDENTITY_TRANSFORM;
    const group = scheme.groups.find((candidate) => candidate.id === region);
    const features = (group?.unitIds ?? [])
      .map((id) => view.selectableFeatures.get(id))
      .filter((shape) => shape !== undefined);
    return transformForFeatures(view.pathGen, features);
  }, [region, scheme, view]);

  /**
   * The `--tap-min` ceiling for THIS rendering, not for the one the widest
   * layout would have produced. The container is the SVG's own parent and the
   * SVG is `w-full`, so its width is the width the 860-unit viewBox is
   * stretched across — and `k` is how much of that width the zoom is
   * currently spending on one province.
   */
  const tapMinR =
    (renderedWidth === null ? TAP_MIN_R_FALLBACK : tapTargetRadius(renderedWidth)) / k;

  const routePoints = useMemo(
    () =>
      routeIds
        .map((id) => places.find((p) => p.id === id))
        .filter((p): p is MapPlace => Boolean(p))
        .map((p) => project(p.lon, p.lat)),
    [routeIds, places, project]
  );

  const points = useMemo(
    () =>
      places.map((place) => {
        const [x, y] = project(place.lon, place.lat);
        return { x, y };
      }),
    [places, project]
  );

  /**
   * How large each marker's target may grow before it reaches its nearest
   * neighbour's — half the gap, so two circles can touch but never overlap.
   *
   * `Infinity` as the ceiling because the ceiling is not known here: it is
   * `tapMinR`, which changes with the measured width AND with the zoom, and
   * folding either in would make this O(n²) pass re-run on every frame of a
   * window drag or a province zoom. Half the gap is a property of where the
   * cities are and nothing else — a zoom magnifies the frame the markers were
   * projected into rather than moving them within it, so the gap between two
   * of them is the same number of viewBox units at every `k`. It is therefore
   * computed once per country, and the width and the zoom only choose where to
   * clip it. A lone place has no neighbour and comes back `Infinity`, which
   * `Math.min` below reads correctly as "no cap at all".
   *
   * The cap is what `lib/dragLayer.ts` was written for, applied to cities
   * rather than micro-states: two overlapping transparent circles let paint
   * order decide which place a tap adds, silently and wrongly. Cities crowd far
   * harder than San Marino and Vatican City — a country shard puts a dozen
   * inside one metro area — and harder still on a phone, where `tapMinR` is
   * three times what it is on a desktop and so meets the cap three times as
   * often. That is only acceptable because the list below reaches every one of
   * them at the full `--tap-min`: the equivalent control WCAG 2.2 AA 2.5.8
   * allows, which §5.2 already required to exist.
   *
   * O(n²), and the largest shard is ~750 places — ~560k distance checks. The
   * memo is keyed on the same inputs as the topology decode above it, which
   * costs more, so this still runs once per country and never on a hover, a
   * selection, or a resize.
   */
  const caps = useMemo(() => nonOverlappingRadii(points, Infinity), [points]);

  /**
   * Marker positions and their transparent targets (§5.3.2).
   *
   * The floor is the marker's own dot: a target INSIDE the visible circle
   * would make the dot's edge the target's edge, which is the failure the
   * hit-area-first ordering exists to prevent. Where two dots are closer than
   * their own radii they already overlapped before this existed.
   *
   * Two of the three terms are divided by `k` and one is not, which is the
   * whole of the clamp-after discipline in one line. The dot is a drawn length
   * and the tap target is a pixel promise, so both shrink as the map is
   * magnified; `caps` is a gap between two projected points, which the zoom
   * does not change. This memo is O(n) and may re-run per zoom; the O(n²) one
   * above must not.
   */
  const marks = useMemo(
    () =>
      points.map((point, index) => {
        const r = radiusFor(places[index]) / k;
        return { ...point, r, hitR: Math.max(r, Math.min(caps[index], tapMinR)) };
      }),
    [points, caps, places, tapMinR, k]
  );

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
   *
   * Unreachable when `readOnly`: `useMarkerSelection` hands the markers no
   * handler to call it from, so `card` stays null and `SelectedPlaceCard`
   * never mounts. Gating here as well would put the mode in two places and
   * leave the announced-but-dead controls in place, which was the bug.
   */
  const activate = (place: MapPlace, viaKeyboard: boolean) => {
    onTogglePlace(place);
    setCard({ id: place.id, viaKeyboard });
  };

  const { markerProps, focusedId, refocus } = useMarkerSelection(
    places,
    selected,
    activate,
    !readOnly
  );

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
          {/*
            The province zoom, and the only thing in this file that moves the
            map. Everything drawn is inside it, so a zoom frames the provinces
            and the markers together; a marker layer left outside would stay
            put while the country slid under it.

            Unconditional, and identity until a region is chosen. A wrapper
            mounted only while zoomed would remount every marker under it on
            each zoom — taking `useMarkerSelection`'s node refs, the roving tab
            stop and whatever the caret was on with them — and would give the
            transition nothing to animate from, since a node created with its
            final transform has no previous value to leave.

            A CSS transform rather than the SVG attribute, because it is the
            one that transitions, and `transformOrigin: 0 0` because the
            translate is computed about the viewBox origin. `ChinaLevel` frames
            its regions exactly this way.
          */}
          <g
            data-zoom=""
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${k})`,
              transformOrigin: "0 0",
              transition: `transform ${ZOOM_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`,
            }}
          >
            <g data-units="">
              {units.map((unit) => (
                <path
                  key={unit.id}
                  // Only the selectable ones are marked, and it is the same
                  // `selectable` flag `selectableFeatures` is indexed off, so
                  // what is marked here and what a region can be zoomed to are
                  // one decision: a unit that is not a subdivision must not
                  // become one by being drawn.
                  data-unit={unit.selectable ? unit.id : undefined}
                  d={unit.d}
                  fill="var(--surf-2)"
                  stroke="var(--paper)"
                  strokeWidth={UNIT_STROKE / k}
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
                strokeWidth={OUTLINE_STROKE / k}
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
                strokeWidth={ROUTE_STROKE / k}
                strokeDasharray={`${7 / k} ${5 / k}`}
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

              "Now that both are operable" is the whole of it, and `readOnly` is
              the case where only one of them is: the marker keeps its dot, its
              label and its hover, and drops every attribute that claimed it was
              a control.
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
                        r={r + FOCUS_RING / k}
                        fill="none"
                        stroke="var(--ink-0)"
                        strokeWidth={1.2 / k}
                        strokeDasharray={`${3 / k} ${2 / k}`}
                        className="pointer-events-none"
                      />
                    )}
                    {isSelected && (
                      <circle
                        data-selection-ring=""
                        cx={x}
                        cy={y}
                        r={r + SELECTION_RING / k}
                        fill="none"
                        stroke="var(--seal)"
                        strokeWidth={2 / k}
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
                      strokeWidth={MARKER_STROKE / k}
                    />
                    {isSelected && stopIndex >= 0 && (
                      <text
                        data-stop=""
                        x={x}
                        y={y + (r > 5 / k ? 3.2 / k : 2.8 / k)}
                        textAnchor="middle"
                        fontSize={Math.max(8 / k, r * 1.1)}
                        fontWeight={700}
                        fill="var(--paper)"
                        className="pointer-events-none"
                      >
                        {stopIndex + 1}
                      </text>
                    )}
                    {labelFor(place) && (
                      <text
                        data-label=""
                        x={x}
                        y={y - r - 3 / k}
                        textAnchor="middle"
                        fontSize={11 / k}
                        fontWeight={600}
                        fill="var(--ink-0)"
                        stroke="var(--paper)"
                        strokeWidth={3 / k}
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
