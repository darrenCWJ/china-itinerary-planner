"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { geoCentroid } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection } from "topojson-specification";
import { nonOverlappingRadii } from "@/lib/dragLayer";
import {
  GLOBE_CX,
  GLOBE_CY,
  GLOBE_R,
  isFrontFacing,
  rotateByDrag,
  rotationAt,
  rotationFor,
  type Rotation,
} from "@/lib/globeRotation";
import {
  GLOBE_COUNTRIES_OBJECT,
  fetchGlobeTopology,
  type GlobeTopology,
} from "@/lib/globeTopology";
import { usePrefs } from "@/components/shell/PrefsProvider";
import { buildGlobeProjection } from "./globeProjection";
import { MAP_VIEW_H, MAP_VIEW_W, ZOOM_MS, makeProjector } from "./mapShared";
import type { WorldLevelProps } from "./worldLevel";
import {
  CountryPicker,
  SelectedCountryCard,
  WorldLevelError,
  WorldLevelSkeleton,
  countryLabel,
  useCountrySelection,
  type Entry,
} from "./worldLevelShared";

/**
 * The globe world level: the same country picker as `WorldMap`, on a sphere.
 *
 * Structurally it *is* `WorldMap` — the same fetch, the same split memo, the
 * same `worldLevelShared` selection, picker, card, error and skeleton. Only
 * the projection differs, and everything below follows from that one change.
 *
 * **A clipping projection makes "drawn" a moving target.** Orthographic hides
 * half the planet, so the set of countries with an SVG node changes as the
 * globe turns. `entries` — the A–Z list, the roving tabindex order, the
 * selected-country card — is derived from the *features*, never from what got
 * drawn, so which side of the world is facing the user cannot change what
 * exists. `mounted` is the moving half, and only `tabStop` reads it.
 *
 * **A back-face country gets no node at all.** Not a hidden one: `opacity: 0`
 * removes an element from neither the accessibility tree nor the focus order,
 * so up to 151 invisible `role="button"` nodes would announce phantom controls
 * to a screen reader and hand a sighted keyboard user focus with no visible
 * indicator — WCAG 2.2 AA 2.4.7 and 2.4.11. `aria-hidden` is not the way out
 * either; `aria-hidden` on a focusable element is its own violation.
 *
 * **Focus drives rotation.** Because the far side has no nodes, the keyboard
 * would otherwise be able to reach only whichever hemisphere happened to be
 * facing the user. `useCountrySelection` reports a move onto an unmounted
 * country instead of silently no-op'ing, the globe turns to it, and focus is
 * applied once the rotation has brought the node into being.
 *
 * **A spin can outlive the node the caret was on.** The origin country crosses
 * the limb part-way through, its node is removed, and a removed element takes
 * the caret with it — neither browsers nor jsdom fire `blur` or `focusout` for
 * a focused element that is deleted, so `document.activeElement` falls back to
 * <body>. On the real asset that leaves a gap on 18 of the 104 arrow
 * transitions that need a spin, up to ~104ms in which an arrow key reaches no
 * handler at all and is silently swallowed. The `<svg>` therefore takes
 * `tabIndex={-1}` and holds the caret for the duration — focusable so it can,
 * -1 so it never becomes a Tab stop, and running the pending country's key
 * handler so the keys keep working while its node does not exist.
 *
 * **The point layer needs a guard the flat map does not.** `geoPath` clips
 * polygon geometry at the limb and returns null beyond it, but a bare
 * `projection([lon, lat])` does not clip at all — centred on China it places
 * Buenos Aires 70px from the middle of the disc, drawn over Asia and fully
 * clickable from the far side of the planet. Every point passes
 * `isFrontFacing` before it is drawn or made a target. This matters more here
 * than it would on the 50m asset: 61 of the 110m point-layer countries have no
 * polygon underneath them at all, so the point is the *only* thing that would
 * be wrong.
 */

/** The only property `scripts/build-globe-topology.mjs` keeps per feature. */
interface CountryProps {
  name: string;
}

const POINT_R = 4.5;
/** Transparent hit circle: the visible dot is smaller than a usable target. */
const POINT_HIT_R = 9;

/**
 * Opening rotation: centred on the app's default country rather than 0°E.
 *
 * `lib/globeRotation.test.ts` pins the disc constants against this same value,
 * for the same reason — it is where the picker actually opens.
 */
const INITIAL_ROTATION: Rotation = [-105, -35];

/** Pointer travel, in viewBox units, past which a press is a drag not a tap. */
const DRAG_SLOP = 4;

interface Shape {
  code: string;
  name: string;
  d: string;
  /** False for a point-layer country: its circle owns the interaction. */
  interactive: boolean;
}

interface PointMark {
  code: string;
  name: string;
  x: number;
  y: number;
  /** Hit radius, capped so it cannot overlap a neighbouring point's. */
  hitR: number;
}

export function GlobeLevel({
  selectedCountry = null,
  onSelectCountry,
  theme: themeOverride,
}: WorldLevelProps) {
  const pickerId = useId();
  const { theme: resolvedTheme } = usePrefs();
  const theme = themeOverride ?? resolvedTheme;

  const [globe, setGlobe] = useState<GlobeTopology | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [rotation, setRotation] = useState<Rotation>(INITIAL_ROTATION);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    fetchGlobeTopology(controller.signal)
      .then(setGlobe)
      // A missing or malformed asset is a picker that cannot draw, not a page
      // that should crash — the map is a discovery affordance and search is the
      // guaranteed path (spec §6). Retry is offered; the caller keeps working.
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retryKey]);

  /**
   * Topology-derived half: everything that does not depend on the rotation.
   *
   * The split is the entire performance argument for the globe. `feature()`
   * decoding the whole topology, the 235-entry `localeCompare` sort, the index
   * `Map` and the centroids cost roughly as much as a frame of path
   * generation, and re-running them on every pointermove is the difference
   * between a globe that turns and one that stutters.
   */
  const topo = useMemo(() => {
    if (!globe) return null;

    const collection = feature(
      globe.topology,
      globe.topology.objects[GLOBE_COUNTRIES_OBJECT] as GeometryCollection<CountryProps>
    );
    // Features are re-keyed to alpha-2 at build time; anything still numeric
    // failed the re-key and has no code to select, so it is not drawn.
    const features = collection.features.filter(
      (f): f is GeoJSON.Feature<GeoJSON.Geometry, CountryProps> & { id: string } =>
        typeof f.id === "string"
    );

    const pointCodes = new Set(globe.points.map((p) => p.code));

    /** One stop per country, in name order — from the features, not the paths. */
    const entries: Entry[] = [
      ...features
        .filter((f) => !pointCodes.has(f.id))
        .map((f) => ({ code: f.id, name: countryLabel(f.id, f.properties.name) })),
      ...globe.points.map((p) => ({ code: p.code, name: countryLabel(p.code, p.name) })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    /**
     * Where to turn the globe to bring a country to the front. Rotation-
     * independent by nature: a centroid does not move when the globe does.
     *
     * The curated point wins over the polygon centroid where a country has
     * both, and is the only source where it has no polygon — which is 61 of
     * the 77 point-layer countries on the 110m asset.
     */
    const lonLat = new Map<string, [number, number]>();
    for (const f of features) {
      const [lon, lat] = geoCentroid(f);
      if (Number.isFinite(lon) && Number.isFinite(lat)) lonLat.set(f.id, [lon, lat]);
    }
    for (const p of globe.points) lonLat.set(p.code, [p.lon, p.lat]);

    return {
      features,
      pointCodes,
      points: globe.points,
      entries,
      indexOf: new Map(entries.map((e, i) => [e.code, i])),
      lonLat,
    };
  }, [globe]);

  /**
   * Projection-derived half: recomputed every frame of a turn, and the only
   * thing that is.
   */
  const view = useMemo(() => {
    if (!topo) return null;

    const { projection, pathGen } = buildGlobeProjection(rotation);
    const project = makeProjector(projection);

    const shapes: Shape[] = [];
    for (const f of topo.features) {
      const d = pathGen(f);
      // Null means the projection clipped the whole feature away: it is on the
      // far side, and it gets no node rather than an invisible one.
      if (!d) continue;
      shapes.push({
        code: f.id,
        name: countryLabel(f.id, f.properties.name),
        d,
        interactive: !topo.pointCodes.has(f.id),
      });
    }

    const facing = topo.points.filter((p) => isFrontFacing(p.lon, p.lat, rotation));
    const placed = facing.map((p) => {
      const [x, y] = project(p.lon, p.lat);
      return { code: p.code, name: countryLabel(p.code, p.name), x, y };
    });
    /**
     * Per-point hit radii, capped so no two overlap — computed over the
     * survivors, because two points that are far apart on the sphere can land
     * close together near the limb.
     */
    const hitRadii = nonOverlappingRadii(placed, POINT_HIT_R);
    const points: PointMark[] = placed.map((p, i) => ({ ...p, hitR: hitRadii[i] }));

    return { shapes, points };
  }, [topo, rotation]);

  const selected = (selectedCountry ?? "").trim().toUpperCase() || null;

  const entries = topo?.entries ?? [];

  /** Only a country the globe knows about gets a card; a stray code gets none. */
  const selectedEntry = selected ? entries.find((entry) => entry.code === selected) : undefined;

  /**
   * The codes with a node on screen right now — a strict subset of `entries`
   * at every rotation. `tabStop` must name one of these, because `tabIndex 0`
   * on a country that is not rendered leaves the whole map with no tab stop at
   * all and Shift+Tab unable to re-enter it.
   */
  const mounted = useMemo(() => {
    if (!view) return new Set<string>();
    return new Set([
      ...view.shapes.filter((s) => s.interactive).map((s) => s.code),
      ...view.points.map((p) => p.code),
    ]);
  }, [view]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const spinFrame = useRef<number | null>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    from: Rotation;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  /** A country the keyboard has moved to that has no node yet. */
  const pendingFocus = useRef<string | null>(null);

  const cancelSpin = () => {
    if (spinFrame.current !== null) cancelAnimationFrame(spinFrame.current);
    spinFrame.current = null;
    // The focus the cancelled spin was carrying dies with it. Left set, it is
    // delivered by whatever next changes `mounted` — including the user's own
    // drag, which snatches the caret to a country the moment their gesture
    // brings it round, and on a real page scrolls it into view under them.
    pendingFocus.current = null;
  };

  /**
   * A bounded, self-stopping tween — never an ambient loop.
   *
   * `MapExplorer.test.tsx`'s `settle()` drains microtasks until the DOM stops
   * changing, so a globe that repainted forever would either spin that helper
   * to its cap or have every assertion read a frame that happened to be
   * mid-flight. At `t >= 1` no further frame is scheduled and the handle is
   * dropped, so the component is quiescent between turns.
   */
  const spinTo = (to: Rotation) => {
    cancelSpin();
    const from = rotation;
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / ZOOM_MS;
      // `rotationAt` clamps t, so a frame delivered late lands on the target
      // rather than overshooting it and swinging back.
      setRotation(rotationAt(from, to, t));
      spinFrame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    spinFrame.current = requestAnimationFrame(step);
  };

  useEffect(() => cancelSpin, []);

  /** Turns the globe to a country, unless it is already facing the viewer. */
  const turnTo = (code: string) => {
    const at = topo?.lonLat.get(code);
    if (at && !isFrontFacing(at[0], at[1], rotation)) spinTo(rotationFor(at[0], at[1]));
  };

  const pickCountry = (code: string) => {
    // The globe follows the choice even when the caller is uncontrolled and
    // `selectedCountry` never comes back — picking a far-side country from the
    // A-Z list has to *show* it, not highlight something invisible.
    turnTo(code);
    onSelectCountry(code);
  };

  const { interactionProps, strokeFor, opacityFor, fillFor, refocus } = useCountrySelection({
    entries,
    indexOf: topo?.indexOf ?? new Map(),
    mounted,
    selected,
    onSelectCountry: pickCountry,
    // A country on the far side has no node, so focus would land nowhere.
    // Turning the globe to it is what makes the roving ring cover all 235
    // rather than only whichever hemisphere happens to be facing the user.
    onFocusOffscreen: (code) => {
      // `turnTo` first: it goes through `spinTo`, which calls `cancelSpin` to
      // drop whatever the previous spin was carrying — so a target recorded
      // before the spin exists would be erased by the spin that serves it.
      turnTo(code);
      pendingFocus.current = code;
    },
    theme: themeOverride,
  });

  /**
   * The other half of it: the node does not exist at the moment the spin
   * starts, so focus is applied once the rotation has brought it into being.
   *
   * Gated on a *pending* target rather than run on every rotation change. The
   * unconditional version fires on every frame of a drag too, which would yank
   * focus back to the last keyboard-visited country while the user is turning
   * the globe with the mouse.
   *
   * The gate narrows that but does not close it: a target recorded and then
   * left set survives the spin it belonged to, and the next thing to change
   * `mounted` delivers it — which is the user's own drag, if they grab the
   * globe rather than waiting for it. `cancelSpin` clearing the ref is what
   * actually closes it, and `onPointerDown` calls `cancelSpin` first thing.
   */
  useEffect(() => {
    const code = pendingFocus.current;
    if (!code) return;
    if (!mounted.has(code)) {
      // Mid-journey, and the node the caret was on may already have crossed
      // the limb and been removed — which drops focus to <body> silently. Park
      // it on the map instead, so every frame of the spin keeps the keyboard
      // on an element that answers. Only from <body>: focus that is somewhere
      // real (a still-facing country, the A-Z picker) belongs to the user.
      if (document.activeElement === document.body) svgRef.current?.focus();
      return;
    }
    pendingFocus.current = null;
    refocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `refocus` is
    // recreated every render; depending on it would re-focus on every frame of
    // a drag and fight the user for the caret.
  }, [mounted]);

  /**
   * Keys that arrive while the caret is parked on the `<svg>` itself.
   *
   * Parking stops focus falling to <body>, but an arrow key still has to *do*
   * something, and the country it logically belongs to has no node to carry a
   * handler yet — so the svg runs that country's handler on its behalf.
   * Gated on the event's own target, so a key pressed on a country is handled
   * by that country and only bubbles through here.
   */
  const onParkedKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return;
    const parked = pendingFocus.current;
    if (!parked) return;
    const name = entries.find((entry) => entry.code === parked)?.name ?? parked;
    interactionProps(parked, name).onKeyDown(event);
  };

  /**
   * The globe opens showing whatever is already chosen, and turns when the
   * choice changes from outside — a restored trip, the back button, the
   * consumer's own state. Guarded on front-facing so re-selecting a visible
   * country does not re-centre the map under the user.
   */
  useEffect(() => {
    if (selected) turnTo(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- this reacts to
    // the selection changing, not to every frame of the spin it starts, so
    // `rotation` is deliberately absent.
  }, [selected, topo]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // Only a gesture's primary pointer rotates, and for a mouse only its main
    // button. Without this a right- or middle-click starts a rotation drag,
    // which is also the likeliest way into the lockout below: the context menu
    // it opens can swallow the pointerup, and the drag then never ends.
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const held = drag.current;
    if (held) {
      // One pointer owns the globe at a time. A second finger landing mid-drag
      // would otherwise re-anchor `from` to the current rotation and take the
      // gesture over — the globe jumps, the first finger's remaining travel is
      // ignored because `onPointerMove` gates on the id, and its eventual
      // pointerup never reaches `endDrag`, so the click it generates is judged
      // by whichever gesture last wrote the suppression flag.
      //
      // Unless the held pointer is provably gone. `endDrag` is the only thing
      // that clears `drag.current` and it needs a matching pointerup or
      // pointercancel, so a terminating event that never arrives would strand
      // the ref and reject every later gesture for the life of the component —
      // rotation dead until a remount. Two things prove it gone: the same id
      // pressing again (a pointer cannot press twice without releasing), and
      // the element saying it no longer captures it. `hasPointerCapture` is
      // absent in jsdom, and absence is not a denial, so that clause can only
      // ever release the lock, never create one.
      const stale =
        held.id === event.pointerId ||
        event.currentTarget.hasPointerCapture?.(held.id) === false;
      if (!stale) return;
    }
    // No pointerType gate. `DayBuilder` gates on `!== "mouse"` because tap is
    // its touch path; here that would make the globe unrotatable on every
    // phone. `touch-action: pan-y` below is what keeps the page scrollable —
    // NOT `touch-action: none`, which would trap vertical scrolling over a
    // 620-unit-tall element.
    cancelSpin();
    // Capture is claimed *before* the ref is armed, and defensively: assigning
    // first meant a throw out of `setPointerCapture` left a drag nothing could
    // ever end. jsdom implements neither capture method, and a browser without
    // pointer capture still delivers pointermove to the element under the
    // pointer — so losing it costs precision on a fast drag, not the drag.
    // Release is implicit on pointerup and pointercancel, so there is none to
    // do; `onLostPointerCapture` below covers the involuntary case.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A globe that cannot capture still turns. Nothing to recover from.
    }
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      from: rotation,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // Client pixels are not viewBox units; the SVG renders `w-full`. A zero
    // width means the element has not been laid out yet — dividing by it would
    // make every rotation NaN, so the untransformed 1:1 reading stands in.
    const scale = rect.width > 0 ? MAP_VIEW_W / rect.width : 1;
    const dx = (event.clientX - held.x) * scale;
    const dy = (event.clientY - held.y) * scale;
    if (Math.hypot(dx, dy) > DRAG_SLOP) held.moved = true;
    setRotation(rotateByDrag(held.from, dx, dy));
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const held = drag.current;
    if (!held || held.id !== event.pointerId) return;
    drag.current = null;
    // A completed drag is followed by the click the browser synthesises from
    // the same gesture, so that one click has to be swallowed. A *cancelled*
    // gesture is followed by nothing, so arming the flag here would swallow
    // the user's next genuine tap instead.
    suppressClick.current = cancelled ? false : held.moved;
  };

  if (loadError) return <WorldLevelError onRetry={() => setRetryKey((k) => k + 1)} />;
  if (!view) return <WorldLevelSkeleton />;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
        className="h-auto w-full touch-pan-y select-none"
        // A group, not an image: `role="img"` would drop every country button
        // out of the accessibility tree, which is where `ChinaMap` is wrong.
        role="group"
        aria-label="World globe — pick a country"
        // -1, never 0: the caret is parked here while a spin is carrying it to
        // a country that has no node yet, and a 0 would put the whole map in
        // the Tab order twice — once as the svg and once as the roving country
        // stop that `useCountrySelection` maintains.
        tabIndex={-1}
        onKeyDown={onParkedKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        // The browser fires this the moment it claims a vertical scroll.
        // Without it the drag origin is left stale and the globe keeps turning
        // under a pointer it no longer owns.
        onPointerCancel={(event) => endDrag(event, true)}
        // Capture can be revoked without a pointerup ever being delivered, and
        // this is the only notice the page gets that the gesture is over.
        // Treated as a cancel, for the same reason: nothing the page did not
        // finish generates a click to swallow. After a normal release this
        // fires *after* `onPointerUp` has already cleared the ref, so the id
        // no longer matches and the suppression flag it set is left alone.
        onLostPointerCapture={(event) => endDrag(event, true)}
        // Capture phase, so the flag is consumed by the gesture's own click
        // wherever it lands — over a country or over empty space — and the
        // country's handler never runs for it. A flag cleared only by a
        // country's `onClick` survives a drag that ends on the ocean and eats
        // the next real selection, including one made from the keyboard.
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.stopPropagation();
        }}
      >
        {/*
          A <circle>, not a <path>. The fill guard in both world-level test
          files collects every <path> and asserts an oklch fill; a sphere drawn
          as a path would break it for a reason unrelated to what it checks.
        */}
        <circle cx={GLOBE_CX} cy={GLOBE_CY} r={GLOBE_R} fill="var(--surf-2)" aria-hidden />

        {view.shapes.map((shape) =>
          shape.interactive ? (
            <g key={shape.code} {...interactionProps(shape.code, shape.name)}>
              <path
                d={shape.d}
                fill={fillFor(shape.code)}
                fillOpacity={opacityFor(shape.code)}
                {...strokeFor(shape.code)}
              />
              <title>{shape.name}</title>
            </g>
          ) : (
            <path
              // Drawn for continuity of the coastline; the point layer selects it.
              key={shape.code}
              d={shape.d}
              fill={fillFor(shape.code)}
              fillOpacity={opacityFor(shape.code)}
              stroke="none"
              className="pointer-events-none"
              aria-hidden
            />
          )
        )}

        {view.points.map((point) => (
          <g key={point.code} {...interactionProps(point.code, point.name)}>
            {/* Hit area first so the visible dot is never the target's edge. */}
            <circle cx={point.x} cy={point.y} r={point.hitR} fill="transparent" />
            <circle
              cx={point.x}
              cy={point.y}
              r={point.code === selected ? POINT_R + 1.5 : POINT_R}
              fill={fillFor(point.code)}
              fillOpacity={opacityFor(point.code)}
              {...strokeFor(point.code)}
            />
            <title>{point.name}</title>
          </g>
        ))}
      </svg>

      <CountryPicker
        id={pickerId}
        entries={entries}
        selectedCode={selectedEntry?.code ?? ""}
        onSelectCountry={pickCountry}
      />
      <SelectedCountryCard entry={selectedEntry} theme={theme} />
    </div>
  );
}
