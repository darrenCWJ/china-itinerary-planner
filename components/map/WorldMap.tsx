"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection } from "topojson-specification";
import { type AccentTheme } from "@/lib/accent";
import {
  WORLD_COUNTRIES_OBJECT,
  fetchWorldTopology,
  type WorldTopology,
} from "@/lib/isoTopology";
import { nonOverlappingRadii } from "@/lib/dragLayer";
import { usePrefs } from "@/components/shell/PrefsProvider";
import { MAP_VIEW_H, MAP_VIEW_W, buildFitProjection, makeProjector } from "./mapShared";
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
 * World level of the two-level picker (spec §6): every country as a selectable
 * feature, tinted by its own accent.
 *
 * Four things are load-bearing here.
 *
 * **The topology is fetched on mount, and nowhere else.** Spec §6 requires the
 * 730KB asset to load only once the picker opens, which this satisfies by
 * fetching from inside the component the picker mounts — so "when does it load"
 * has exactly one answer, and the consumer's `next/dynamic` import keeps the
 * parse cost off the same page too. Nothing here runs on a route that never
 * shows a map.
 *
 * **Colour comes only from `lib/accent` and the token set.** Each country is
 * filled with its own `fill`-role accent, which is what makes 235 countries
 * distinguishable without a hand-picked palette; strokes and the water are
 * tokens. There is no hex literal in this file, deliberately (spec §4.1/§4.2).
 *
 * **Small countries are selected through the point layer, not their polygon.**
 * A country below the area threshold is one pixel of polygon at world zoom, so
 * `smallCountries` carries a centroid and it gets a circle. Its polygon still
 * draws, but inert — one country must not be two competing hit targets.
 *
 * **The A–Z list, not the circle, is the target that meets `--tap-min`.**
 * `POINT_HIT_R` cannot be raised to reach it. A 44px-equivalent circle is
 * r ≈ 17.5 viewBox units at the width `/plan` renders, and San Marino and
 * Vatican City sit ~6 units apart at this fit — so the circle would swallow its
 * neighbours, and around Singapore it would swallow Johor, because the point
 * layer draws on top of every polygon. The compliant target therefore has to be
 * a *second* control rather than a bigger one, which is also what spec §6 asks
 * for: "search remains the guaranteed path to every country". `PlaceSearch`
 * searches within the country already chosen and cannot change it, so the
 * picker below the map is that path. It costs one tab stop, not 235.
 */

/** The only property `scripts/build-world-topology.mjs` keeps per feature. */
interface CountryProps {
  name: string;
}

/**
 * Antarctica is drawn but never fitted.
 *
 * Mercator stretches latitudes near the pole without limit, so including AQ in
 * `fitExtent` drops the scale from 134 to 100 and pushes the inhabited world
 * into the top two-thirds of the frame. Excluded from the fit it runs off the
 * bottom of the viewBox instead, which costs nothing: it stays drawn, stays
 * selectable along its visible edge, and so is not a silent gap in the picker.
 */
const UNFITTED = "AQ";

const POINT_R = 4.5;
/** Transparent hit circle: the visible dot is smaller than a usable target. */
const POINT_HIT_R = 9;

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

export interface WorldMapProps {
  /** ISO alpha-2 of the country currently chosen, if any. */
  selectedCountry?: string | null;
  onSelectCountry: (code: string) => void;
  /**
   * Which accent ramp to tint with. Defaults to the ramp `PrefsProvider`
   * resolved — resolving the theme a second time here would let the map
   * disagree with the page it sits on. Override only to render a fixed ramp.
   */
  theme?: AccentTheme;
}

export function WorldMap({
  selectedCountry = null,
  onSelectCountry,
  theme: themeOverride,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  const { theme: resolvedTheme } = usePrefs();
  const theme = themeOverride ?? resolvedTheme;

  const [world, setWorld] = useState<WorldTopology | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    fetchWorldTopology(controller.signal)
      .then(setWorld)
      // A missing or malformed asset is a picker that cannot draw, not a page
      // that should crash — the map is a discovery affordance and search is the
      // guaranteed path (spec §6). Retry is offered; the caller keeps working.
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      });
    return () => controller.abort();
  }, [retryKey]);

  /**
   * Topology-derived half: everything that does not depend on the projection.
   *
   * Split from the projection work below because the globe re-projects every
   * frame while this does not. `feature()` decoding the whole topology, the
   * 235-entry `localeCompare` sort and the index `Map` cost roughly the same as
   * a frame of path generation, and re-running them on every pointermove is the
   * difference between a globe that turns and one that stutters.
   */
  const topo = useMemo(() => {
    if (!world) return null;

    const collection = feature(
      world.topology,
      world.topology.objects[WORLD_COUNTRIES_OBJECT] as GeometryCollection<CountryProps>
    );
    // Features are re-keyed to alpha-2 at build time; anything still numeric
    // failed the re-key and has no code to select, so it is not drawn.
    const features = collection.features.filter(
      (f): f is GeoJSON.Feature<GeoJSON.Geometry, CountryProps> & { id: string } =>
        typeof f.id === "string"
    );

    const pointCodes = new Set(world.smallCountries.map((c) => c.code));

    /**
     * One stop per country, in name order — derived from the *features*, not
     * from the paths that got drawn.
     *
     * This is the load-bearing change. Deriving it from `shapes` made the list
     * a function of the projection, which is harmless under Mercator (every
     * feature draws) and wrong under any projection that clips: countries would
     * drop out of the roving tabindex and the A-Z list as the globe turned, and
     * `selectedEntry` below would go undefined mid-rotation, blanking the
     * `<select>` and unmounting the hero card for a country the user had
     * deliberately chosen. Which side of the planet is facing the user is not
     * allowed to change what exists.
     */
    const entries: Entry[] = [
      ...features
        .filter((f) => !pointCodes.has(f.id))
        .map((f) => ({ code: f.id, name: countryLabel(f.id, f.properties.name) })),
      ...world.smallCountries.map((c) => ({
        code: c.code,
        name: countryLabel(c.code, c.name),
      })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return {
      features,
      pointCodes,
      smallCountries: world.smallCountries,
      entries,
      indexOf: new Map(entries.map((e, i) => [e.code, i])),
    };
  }, [world]);

  /**
   * Projection-derived half: the path strings and point positions, which the
   * flat map computes once and the globe recomputes every frame.
   */
  const view = useMemo(() => {
    if (!topo) return null;

    const fitTo = topo.features.filter((f) => f.id !== UNFITTED);
    const { projection, pathGen } = buildFitProjection(
      fitTo.length > 0 ? fitTo : topo.features
    );
    const project = makeProjector(projection);

    const shapes: Shape[] = [];
    for (const f of topo.features) {
      const d = pathGen(f);
      if (!d) continue;
      shapes.push({
        code: f.id,
        name: countryLabel(f.id, f.properties.name),
        d,
        interactive: !topo.pointCodes.has(f.id),
      });
    }

    const placed = topo.smallCountries.map((c) => {
      const [x, y] = project(c.lon, c.lat);
      return { code: c.code, name: countryLabel(c.code, c.name), x, y };
    });
    /**
     * Per-point hit radii, capped so no two overlap. At world scale some
     * micro-states are closer together than POINT_HIT_R — San Marino and Vatican
     * City sit ~6 units apart — so a shared radius made their transparent hit
     * areas cover each other and paint order decided which country a click
     * selected. Shrinking the crowded ones is only acceptable because the country
     * list below reaches every one of them at full size: a wrong selection is
     * worse than a hard one.
     */
    const hitRadii = nonOverlappingRadii(placed, POINT_HIT_R);
    const points: PointMark[] = placed.map((p, i) => ({ ...p, hitR: hitRadii[i] }));

    return { shapes, points };
  }, [topo]);

  const selected = (selectedCountry ?? "").trim().toUpperCase() || null;

  const entries = topo?.entries ?? [];

  /** Only a country the map actually drew gets a card; a stray code gets none. */
  const selectedEntry = selected ? entries.find((entry) => entry.code === selected) : undefined;

  /**
   * The codes with a node on screen right now.
   *
   * Identical to `entries` under Mercator, where every feature draws. Under a
   * clipping projection it is a strict subset, and the distinction is what
   * keeps the map in the tab order: `tabStop` must name a *mounted* element,
   * because `tabIndex 0` on a country that is not rendered leaves the whole map
   * with no tab stop at all and Shift+Tab unable to re-enter it.
   */
  const mounted = useMemo(() => {
    if (!view) return new Set<string>();
    return new Set([
      ...view.shapes.filter((s) => s.interactive).map((s) => s.code),
      ...view.points.map((p) => p.code),
    ]);
  }, [view]);

  const { interactionProps, strokeFor, opacityFor, fillFor } = useCountrySelection({
    entries,
    indexOf: topo?.indexOf ?? new Map(),
    mounted,
    selected,
    onSelectCountry,
    theme: themeOverride,
  });

  if (loadError) return <WorldLevelError onRetry={() => setRetryKey((k) => k + 1)} />;
  if (!view) return <WorldLevelSkeleton />;

  return (
    <div ref={containerRef} className="relative">
      <svg
        viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
        className="h-auto w-full select-none"
        // A group, not an image: `role="img"` would drop every country button
        // out of the accessibility tree, which is where `ChinaMap` is wrong.
        role="group"
        aria-label="World map — pick a country"
      >
        <rect
          width={MAP_VIEW_W}
          height={MAP_VIEW_H}
          fill="var(--surf-2)"
          aria-hidden
        />

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
        onSelectCountry={onSelectCountry}
      />
      <SelectedCountryCard entry={selectedEntry} theme={theme} />
    </div>
  );
}
