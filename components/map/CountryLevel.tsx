"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { ARRIVABLE_AIRPORT_SIZES, type Airport } from "@/lib/airports";
import { getCountry } from "@/lib/countries";
import type { ProjectionEntry } from "@/lib/countryProjection";
import { nonOverlappingRadii } from "@/lib/dragLayer";
import { IDENTITY_TRANSFORM } from "@/lib/mapTransform";
import { MAIN_AIRPORT_LABEL, mainAirportFor } from "@/lib/mainAirport";
import type { ProvinceFile } from "@/lib/provinceTopology";
import { regionSchemeFor, type RegionId } from "@/lib/regionScheme";
import { CountryPlaceList } from "./CountryPlaceList";
import { buildCountryView } from "./countryView";
import {
  createHoverReporter,
  transformForFeatures,
  MAP_VIEW_H,
  MAP_VIEW_W,
  ZOOM_MS,
  type HoverPos,
} from "./mapShared";
import {
  ADMIN1_MAX_ZOOM_K,
  AIRPORT_MARK,
  AIRPORT_STROKE,
  FOCUS_RING,
  labelFor,
  MARKER_STROKE,
  OUTLINE_STROKE,
  paintedAt,
  ROUTE_STROKE,
  SELECTION_RING,
  TAP_MIN_R_FALLBACK,
  tapTargetRadius,
  UNIT_STROKE,
} from "./markerGeometry";
import { markerFills, markerMarks, projectPlaces, routePath, visibleEntries } from "./markerLayout";
import { useMarkerSelection } from "./useMarkerSelection";
import { useRenderedWidth } from "./useRenderedWidth";
import { NO_CLIMATE } from "./climateIndex";
import { placeClimateFor, type DerivedClimateIndex, type MapPlace } from "./mapTypes";
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

/**
 * The empty airport array, as one module-level value rather than a `[]` literal
 * in the destructure below.
 *
 * A default written `airports = []` allocates a new array on every render, so
 * the memo that resolves the card's line would see a changed dependency every
 * time the pointer crossed a marker — hover reports up to `MapExplorer`, which
 * re-renders this level — and would re-scan the country's airports for a card
 * that had not changed. `RouteMap` passes none at all, so this is the value the
 * trip map renders against.
 */
const NO_AIRPORTS: Airport[] = [];

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
  /**
   * The open country's airports, for §10.2's "Main airport" line on the card.
   *
   * The ARRAY, and never the artifact. `lib/server/airports.ts` carries no
   * `server-only` guard, so importing it from this file would compile clean and
   * silently ship `data/airports.json` — 876,823 B — to every visitor.
   * `MapExplorer` already fetches the open country's rows from
   * `/api/map/airports?country=XX` for the route estimator, and this is that
   * same array reaching a second reader rather than a second fetch.
   *
   * An `Airport` is not a `MapPlace` and deliberately never becomes one. §10.1
   * says airports are never selectable trip stops, so nothing here may flow
   * into a place-shaped prop: this array's whole reach is the line of text
   * below.
   *
   * That rule is a compiler rule, and it is pinned in `mapTypes.test.tsx`
   * ("airports are never trip stops, and the compiler is what says so") rather
   * than here, because the way it fails is invisible from this file: widening
   * `MapPlace["kind"]` with `"airport"` — the tempting way to draw this layer
   * through the selection machinery that already exists — compiles the whole
   * repo with ZERO errors, measured. Every reader of `kind` is `=== "curated"`
   * with an implicit else, so no branch changes and `MapExplorer.togglePlace`
   * simply starts accepting airports as trip stops.
   *
   * Optional, because `RouteMap` is a second caller and loads none — and
   * because a card with no airport line is the correct render for a country
   * whose airports have not landed yet, which is every country for the first
   * moment it is open.
   */
  airports?: Airport[];
  /**
   * Whether §10.1's airport layer is drawn on the map.
   *
   * Off by default, which is the spec's default and here also the only safe
   * one: `MapExplorer` has passed `airports` since PR1 for the route
   * estimator, so a layer that drew whenever it was handed an array would
   * already be on for every country, with nothing anywhere to turn it off.
   *
   * A flag rather than "pass no airports when it is off", because the array has
   * two readers and only one of them is the layer. The card's "Main airport"
   * line is a fact about the place a user has just opened (§10.2), and a reader
   * who never finds the toggle still deserves it.
   */
  showAirports?: boolean;
  /**
   * The open country's derived climate (§9.4), keyed by `MapPlace.id`: what
   * colours every marker outside China and fills the card's climate line.
   *
   * Built by the caller from two fetches it already makes — the climate
   * shard and the city shard's elevations (`buildClimateIndex`) — and passed
   * down already in hand, so the fit resolution stays synchronous over rows
   * the component holds. Never a callback: `mapTypes.ts`'s docblock on
   * `DerivedClimateIndex` is the rule.
   *
   * Optional, defaulting to the shared empty index: `RouteMap` builds its
   * own, and a level with none is the correct render for a country whose
   * file has not landed yet — grey pins, no line, no claim. A Chinese place
   * never reads it however full it is (§9.5): `fitForPlace` and
   * `placeClimateFor` both gate on the place's own country.
   */
  climate?: DerivedClimateIndex;
  /**
   * What the caller wants drawn directly under the map and above the place
   * list: the picker's legend, its zoom caption and its honesty note.
   *
   * A slot rather than three props, because this level should not know
   * what the chrome says. And a slot HERE rather than markup a caller
   * appends after the level, because the list is part of this level's own
   * markup — §5.2's spine sits under its map — so anything appended after
   * the level lands under 750 chips instead of under the map, which is
   * where a browser found the legend on the first look. `RouteMap` passes
   * nothing.
   */
  belowMap?: ReactNode;
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
  airports = NO_AIRPORTS,
  showAirports = false,
  climate = NO_CLIMATE,
  belowMap,
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
   * Whether this country has a province level to offer at all — §6.6 D10.
   *
   * 34 of the 246 ship exactly ONE selectable unit, so their admin-1 layer is
   * the national outline drawn a second time: nothing to choose between, and
   * `regionSchemeFor` makes no group out of it. Read off the scheme rather than
   * counting `provinces.units` a second time, and deliberately not off
   * `provinces/index.json` — the two agree for all 246 committed files
   * (`lib/regionScheme.test.ts` pins that they do), and the one that agrees
   * with the geometry this level is actually DRAWING is the scheme. A test
   * fixture, a half-built country and a file that has moved on since the index
   * was written are all cases where the index answers about a different map.
   *
   * What it suppresses here is the unit's NAME, and the Faroes are why that is
   * not cosmetic. `FRO-1443` is one MultiPolygon spanning the whole
   * archipelago, Suðuroy to Fugloy, and Natural Earth names it `Eysturoyar` —
   * one island of eighteen, and not the one Tórshavn is on. Titling that
   * polygon tells a reader the Faroe Islands are Eysturoy. Monaco and Puerto
   * Rico get the merely redundant version of the same label, and all 34 are
   * treated alike: where the province layer has nothing to divide, it says
   * nothing. The country is still named, once, by the `<svg>`'s own aria-label.
   *
   * `data-unit` is NOT gated on this, and the difference is the point. That
   * mark is §7.2's — "this polygon is a subdivision rather than territorial
   * extent" — which stays true of a lone unit. What a lone unit is not is a
   * place to zoom to, and the transform above already answers that through the
   * scheme rather than through the mark.
   */
  const offersRegions = scheme.groups.length > 0;

  /**
   * The group the level is framed on, or null for the whole country.
   *
   * Hoisted out of the transform below because it is now read TWICE — the
   * transform frames this group, the marker layer filters to it — and those
   * two must never disagree. A map framed on one group while its markers
   * answered to another would be showing the wrong province's cities, and it
   * would look entirely plausible.
   *
   * Null covers both non-choices, and they stay distinct facts: no region was
   * asked for, or one was and this country's scheme has no such group. §6.6's
   * single-unit gate arrives as the second, and so does a region id left over
   * from the country the user just left — `RegionId` is `string`, so a stale
   * one stays assignable and nothing else would catch it.
   */
  const group = useMemo(
    () => (region ? (scheme.groups.find((candidate) => candidate.id === region) ?? null) : null),
    [region, scheme]
  );

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
   *
   * Kept whole as well as destructured, because `paintedAt` takes the matrix
   * rather than three loose numbers — and rebuilding an object literal at the
   * call site would hand it a new one on every render.
   *
   * `ADMIN1_MAX_ZOOM_K` and not the shared default, which is the difference
   * between framing a province and pointing at one: two thirds of the world's
   * admin-1 units fit above `MAX_ZOOM_K`, so at the default this line drew
   * Rhode Island at 0.14% of the frame. The constant carries the argument.
   */
  const transform = useMemo(() => {
    if (!region) return IDENTITY_TRANSFORM;
    const features = (group?.unitIds ?? [])
      .map((id) => view.selectableFeatures.get(id))
      .filter((shape) => shape !== undefined);
    return transformForFeatures(view.pathGen, features, ADMIN1_MAX_ZOOM_K);
  }, [region, group, view]);

  const { k, tx, ty } = transform;

  /**
   * The `--tap-min` ceiling for THIS rendering, not for the one the widest
   * layout would have produced. The container is the SVG's own parent and the
   * SVG is `w-full`, so its width is the width the 860-unit viewBox is
   * stretched across — and `k` is how much of that width the zoom is
   * currently spending on one province.
   */
  const tapMinR =
    (renderedWidth === null ? TAP_MIN_R_FALLBACK : tapTargetRadius(renderedWidth)) / k;

  // Policy and arithmetic: markerLayout.ts.
  const routePoints = useMemo(() => routePath(routeIds, places, project), [routeIds, places, project]);

  // Policy and arithmetic: markerLayout.ts.
  const points = useMemo(() => projectPlaces(places, project), [places, project]);

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

  // Policy and arithmetic: markerLayout.ts.
  const marks = useMemo(() => markerMarks(points, caps, places, tapMinR, k), [points, caps, places, tapMinR, k]);

  // Policy and arithmetic: markerLayout.ts.
  const fills = useMemo(() => markerFills(places, month, climate), [places, month, climate]);

  // Policy and arithmetic: markerLayout.ts.
  const visible = useMemo(() => visibleEntries(places, group, provinces), [group, places, provinces]);

  /**
   * The same set as `visible`, as the roving tabindex wants it.
   *
   * `useMarkerSelection` is handed the DRAWN places and not `places`, because
   * every one of its answers is about a node: the caret it moves, the tab stop
   * it parks on, the neighbour an arrow key reaches. Given the whole country it
   * would put `tabIndex 0` on a marker the zoom is not rendering — a tab stop
   * that lands nowhere, which is the failure a roving tabindex exists to
   * prevent — and would step the caret onto hidden cities in between the
   * visible ones.
   */
  const visiblePlaces = useMemo(() => visible.map((entry) => entry.place), [visible]);

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
   * The framing the open card belongs to, and the close when it changes.
   *
   * A card outlives a zoom badly, in two different ways. Its place may not be
   * drawn at the new framing at all — §6.5 filters the markers to the group's
   * own cities — which would leave a card describing a city nothing on the map
   * shows. And even when the city IS drawn, the card would arrive at its new
   * anchor INSTANTLY while the marker takes `ZOOM_MS` to glide there, so the
   * two would sit visibly apart for the whole transition. Neither is worth
   * carrying: the card is a surface about one place in one frame, and the frame
   * has been replaced.
   *
   * Adjusted during render rather than in an effect, which is what the React
   * docs prescribe for state that has to follow a prop: an effect would commit
   * one frame of the stale card first, at the old framing's anchor, and only
   * then close it — the flash this exists to prevent. React discards this
   * render and re-runs the component with the new state before anything
   * reaches the DOM.
   *
   * Storing the framing on the card instead and hiding it when the two
   * disagree would leave it OPEN, so zooming away and back would resurrect a
   * card the user had watched vanish.
   */
  const [cardRegion, setCardRegion] = useState<RegionId | null>(region);
  if (cardRegion !== region) {
    setCardRegion(region);
    setCard(null);
  }

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
    visiblePlaces,
    selected,
    activate,
    !readOnly
  );

  const cardIndex = card === null ? -1 : places.findIndex((p) => p.id === card.id);
  const cardPlace = cardIndex >= 0 ? places[cardIndex] : null;

  /**
   * The one airport the open card names (§10.2), or null when there is none
   * worth naming.
   *
   * Memoised because this level re-renders on every hover — `onHoverPlace`
   * reports up to `MapExplorer`, which holds the tooltip's state — and the
   * resolver is a linear scan over the whole country's airports. Nothing about
   * that scan changes between two mouse positions over the same marker.
   *
   * Null covers both an empty array and a card whose place has no airport
   * inside `DEFAULT_AIRPORT_RADIUS_KM`, and the render below treats them alike:
   * no row at all. A place 600 km from the nearest runway is better described
   * by silence than by that runway.
   */
  const mainAirport = useMemo(
    () => (cardPlace === null ? null : mainAirportFor(airports, cardPlace)),
    [airports, cardPlace]
  );

  /**
   * The card's climate line (§5.3.3, "where the climate lo/hi line lives"):
   * the curated table for a Chinese place in one of the seven, the derived
   * row for anyone else who has one, nothing otherwise. Cheap enough to
   * resolve per render — one Map lookup and five array reads.
   */
  const cardClimate = cardPlace === null ? null : placeClimateFor(cardPlace, month, climate);

  /**
   * §10.1's layer, projected once per country rather than once per frame.
   *
   * Empty while the layer is off, so a country whose airports have landed pays
   * nothing for them until someone asks: this level re-renders on every hover —
   * `onHoverPlace` reports up to `MapExplorer`, which holds the tooltip — and a
   * `filter().map()` in the JSX would re-project all 502 of the United States'
   * on every mouse move. Per country the drawn set is a median of 4 and a
   * maximum of those 502, across the 233 countries with any at all.
   *
   * `project` and never `points`: that array is indexed by place and is what
   * `caps` and `marks` were computed over. An airport is not one of them, and
   * §10.1's "never a selectable trip stop" is exactly that the two never merge.
   */
  const airportMarks = useMemo(
    () =>
      showAirports
        ? airports
            .filter((airport) => ARRIVABLE_AIRPORT_SIZES.has(airport.size))
            .map((airport) => {
              const [x, y] = project(airport.lon, airport.lat);
              return { iata: airport.iata, x, y };
            })
        : [],
    [showAirports, airports, project]
  );

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
                  // what is marked here and what a group can name are one
                  // decision: a unit that is not a subdivision must not become
                  // one by being drawn.
                  //
                  // "Marked" and "zoomable" are two things, and §6.6 D10 is
                  // where they part: a country with ONE subdivision still has
                  // that subdivision, and still has nowhere to zoom. The mark
                  // states the first; `offersRegions` decides the second.
                  data-unit={unit.selectable ? unit.id : undefined}
                  d={unit.d}
                  fill="var(--surf-2)"
                  stroke="var(--paper)"
                  strokeWidth={UNIT_STROKE / k}
                >
                  {offersRegions && unit.selectable && unit.label && <title>{unit.label}</title>}
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
              §10.1's airport layer, and decorative in a stronger sense than a
              `readOnly` marker is. A read-only marker is a control the surface
              cannot honour; an airport is not a place at all — so there is no
              role to drop, no card to open, and no `MapPlace` to hand to
              `onTogglePlace`, because `Airport` is a separate type that never
              becomes one.

              `aria-hidden`, because the airport a reader can act on is the one
              the card names — a dialog they can open, focus and read — and an
              unlabelled diamond is not a second way to reach it.
              `pointer-events-none` and beneath the markers for one reason
              between them: a decoration must never take a tap that belonged to
              a city's `--tap-min` target, nor sit on top of one.

              §10.1 also asks for the layer "below a zoom threshold", and that
              cannot be a number here. `k` is not a stable quantity — 3,039 of
              the 4,525 zoomable groups clamp against `ADMIN1_MAX_ZOOM_K`, and
              `transformForFeatures` answers `IDENTITY_TRANSFORM` with `k === 1`
              for a group whose bounds are non-finite, which is a case this
              level actually sees. The threshold that does exist is the LEVEL:
              airports are drawn on a country and never on the world map, where
              4,132 marks would be a grey wash over every continent.

              Inside the country the province zoom does not gate the layer
              either — it MOVES it, exactly as it moves the cities. §6.5 filters
              cities to the framed group through `cityProvince`; nothing
              assigns an airport to a province, so the choice is between drawing
              them all and letting the frame clip, or drawing none. None would
              make a toggle pressed before a zoom look broken after it.
            */}
            {airportMarks.length > 0 && (
              <g data-airports="" className="pointer-events-none" aria-hidden>
                {airportMarks.map(({ iata, x, y }) => (
                  <rect
                    key={iata}
                    data-airport={iata}
                    x={x - AIRPORT_MARK / k}
                    y={y - AIRPORT_MARK / k}
                    width={(2 * AIRPORT_MARK) / k}
                    height={(2 * AIRPORT_MARK) / k}
                    // A rotation, which the zoom neither scales nor needs to:
                    // about the airport's own projected point, so the diamond
                    // stays centred on it at every `k`.
                    transform={`rotate(45 ${x} ${y})`}
                    fill="var(--paper)"
                    stroke="var(--ink-2)"
                    strokeWidth={AIRPORT_STROKE / k}
                  />
                ))}
              </g>
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
              {/*
                `visible`, and its two indices are two different things. `index`
                is the place's position in the country — what `marks` and `caps`
                were computed over, so a zoom re-uses them untouched — while
                `order` is its position among the markers actually drawn, which
                is the frame the roving tabindex's arrow keys step through.
                Passing the wrong one moves the caret to a city that is not on
                screen.
              */}
              {visible.map(({ place, index }, order) => {
                const { x, y, r, hitR } = marks[index];
                const isSelected = selected.includes(place.id);
                const stopIndex = routeIds.indexOf(place.id);
                return (
                  <g
                    key={place.id}
                    data-place={place.id}
                    {...markerProps(place, order)}
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
                      fill={fills[index]}
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
            climate={climate}
            // The marker's PAINTED position, not the projected one its own
            // `cx`/`cy` carry. This card is a sibling of the `<svg>`, so the
            // `[data-zoom]` transform that moves every marker moves nothing
            // about it: it is positioned in percentages of the frame, and
            // `paintedAt` is what turns a point inside the transformed group
            // into the frame coordinate a percentage can be taken from.
            // Without it a zoomed card and its marker separate by the whole
            // reach of the zoom.
            anchor={paintedAt(marks[cardIndex], transform)}
            takeFocus={card.viaKeyboard}
            onToggle={() => onTogglePlace(cardPlace)}
            onDismiss={(heldFocus) => {
              setCard(null);
              // Only when the card actually had focus. Dismissing by clicking
              // somewhere else is not a request to be sent back to the map.
              if (heldFocus) refocus(cardPlace.id);
            }}
          >
            {/*
              The weather the verdict beside it is about, in the same words the
              hover card uses. Above the airport line because it is the fact a
              reader opened the card to check; absent rather than "no data"
              because the wrapper is `empty:hidden` and the chip already says
              "No data" when there is none.
            */}
            {cardClimate && (
              <p data-climate="">
                {cardClimate.lo}°–{cardClimate.hi}°C typical
              </p>
            )}
            {/*
              §10.2's line, into the slot Plan 3 reserved and named. "Main
              airport" and never "Nearest": `nearestAirports` discounts distance
              by size, and the discounts compose, so the airport this names can
              be up to 30 km further out than the true nearest — which is the
              right answer for a traveller and the wrong word for it.

              Rendered only when there is one, because the wrapper is
              `empty:hidden`: a row saying "no airport" would spend a line
              telling a reader something they did not ask.

              And never "in Switzerland" either, though the answer really is
              scoped to the one country whose rows `airports` carries — a
              border city's true main airport can be across the border and
              absent from the array. That limit is real, and it is recorded on
              `mainAirportFor` instead of here; its docblock has the worked case
              and the reason the copy stays clean.
            */}
            {mainAirport && (
              <p data-main-airport="">
                {MAIN_AIRPORT_LABEL}: {mainAirport.iata} · {mainAirport.km} km
              </p>
            )}
          </SelectedPlaceCard>
        )}
      </div>

      {belowMap !== undefined && <div data-below-map="">{belowMap}</div>}

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
