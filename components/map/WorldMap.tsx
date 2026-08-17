"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection } from "topojson-specification";
import { accentColor, type AccentTheme } from "@/lib/accent";
import { getCountry } from "@/lib/countries";
import {
  WORLD_COUNTRIES_OBJECT,
  fetchWorldTopology,
  type WorldTopology,
} from "@/lib/isoTopology";
import { CountryHero } from "@/components/shell/CountryHero";
import { usePrefs } from "@/components/shell/PrefsProvider";
import {
  MAP_VIEW_H,
  MAP_VIEW_W,
  buildFitProjection,
  createHoverReporter,
  makeProjector,
  type HoverPos,
} from "./mapShared";

/**
 * World level of the two-level picker (spec §6): every country as a selectable
 * feature, tinted by its own accent.
 *
 * Three things are load-bearing here.
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

/** Tint strength by state. Hue carries identity; opacity carries interaction. */
const FILL_BASE = 0.5;
const FILL_HOVER = 0.75;
const FILL_SELECTED = 0.95;

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
}

/** One keyboard stop per country, whichever layer it is selected through. */
interface Entry {
  code: string;
  name: string;
}

export interface WorldMapProps {
  /** ISO alpha-2 of the country currently chosen, if any. */
  selectedCountry?: string | null;
  onSelectCountry: (code: string) => void;
  /** Hover in container coordinates, for a popup the parent positions. */
  onHoverCountry?: (code: string | null, pos: HoverPos | null) => void;
  /**
   * Which accent ramp to tint with. Defaults to light because the shell still
   * pins `data-theme="light"` (`PrefsProvider`'s `PINNED_THEME`) — resolving the
   * theme a second time here would let the map disagree with the page it sits
   * on. PR3 drops the pin and this is the one prop that has to be wired.
   */
  theme?: AccentTheme;
}

/** Curated names beat the topology's ("Türkiye", not "Turkey"). */
function countryLabel(code: string, topologyName: string): string {
  const curated = getCountry(code).name;
  return curated && curated !== code ? curated : topologyName;
}

export function WorldMap({
  selectedCountry = null,
  onSelectCountry,
  onHoverCountry,
  theme = "light",
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const { prefs } = usePrefs();

  const [world, setWorld] = useState<WorldTopology | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [focusedCode, setFocusedCode] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

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

  const view = useMemo(() => {
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

    const fitTo = features.filter((f) => f.id !== UNFITTED);
    const { projection, pathGen } = buildFitProjection(
      fitTo.length > 0 ? fitTo : features
    );
    const project = makeProjector(projection);

    const pointCodes = new Set(world.smallCountries.map((c) => c.code));

    const shapes: Shape[] = [];
    for (const f of features) {
      const d = pathGen(f);
      if (!d) continue;
      shapes.push({
        code: f.id,
        name: countryLabel(f.id, f.properties.name),
        d,
        interactive: !pointCodes.has(f.id),
      });
    }

    const points: PointMark[] = world.smallCountries.map((c) => {
      const [x, y] = project(c.lon, c.lat);
      return { code: c.code, name: countryLabel(c.code, c.name), x, y };
    });

    // One stop per country, in name order: arrow keys then walk the world
    // predictably instead of following whatever order the asset happens to hold.
    const entries: Entry[] = [
      ...shapes.filter((s) => s.interactive).map((s) => ({ code: s.code, name: s.name })),
      ...points.map((p) => ({ code: p.code, name: p.name })),
    ].sort((a, b) => a.name.localeCompare(b.name));

    return {
      shapes,
      points,
      entries,
      indexOf: new Map(entries.map((e, i) => [e.code, i])),
    };
  }, [world]);

  const selected = (selectedCountry ?? "").trim().toUpperCase() || null;

  /**
   * Per-country hue overrides are honoured; a *fixed* accent is deliberately
   * not. "One accent everywhere" (spec §4.3) applied to this map would paint
   * 235 countries the same colour and erase the only thing the tint says.
   */
  const fillFor = (code: string): string =>
    accentColor(code, theme, "fill", prefs.accentHues[code]);

  const reportHover = createHoverReporter<string>(
    containerRef,
    (code, pos) => onHoverCountry?.(code, pos)
  );

  const entries = view?.entries ?? [];

  /** Only a country the map actually drew gets a card; a stray code gets none. */
  const selectedEntry = selected ? entries.find((entry) => entry.code === selected) : undefined;

  /**
   * Roving tabindex: the map is one tab stop, and arrows move within it.
   *
   * `ChinaMap` makes every curated marker a tab stop, which is fine for thirty
   * of them and indefensible for 235 — a keyboard user would tab a quarter of
   * the way round the world to reach the control after the map. Enter/Space to
   * select is unchanged from that pattern; only which element is reachable by
   * Tab differs.
   */
  const tabStop =
    (activeCode && view?.indexOf.has(activeCode) ? activeCode : null) ??
    (selected && view?.indexOf.has(selected) ? selected : null) ??
    entries[0]?.code ??
    null;

  const focusEntry = (index: number) => {
    if (entries.length === 0) return;
    const wrapped = ((index % entries.length) + entries.length) % entries.length;
    const next = entries[wrapped];
    setActiveCode(next.code);
    nodeRefs.current.get(next.code)?.focus();
  };

  const stepFor = (key: string): number => {
    if (key === "ArrowRight" || key === "ArrowDown") return 1;
    if (key === "ArrowLeft" || key === "ArrowUp") return -1;
    return 0;
  };

  const handleKeyDown = (event: React.KeyboardEvent, code: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectCountry(code);
      return;
    }
    const from = view?.indexOf.get(code) ?? 0;
    const step = stepFor(event.key);
    if (step !== 0) {
      event.preventDefault();
      focusEntry(from + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusEntry(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusEntry(entries.length - 1);
    }
  };

  /** Everything an interactive country needs, whatever layer draws it. */
  const interactionProps = (code: string, name: string) => {
    const isSelected = code === selected;
    return {
      ref: (node: SVGGElement | null) => {
        if (node) nodeRefs.current.set(code, node);
        else nodeRefs.current.delete(code);
      },
      role: "button",
      tabIndex: code === tabStop ? 0 : -1,
      "aria-pressed": isSelected,
      "aria-label": `${name}${isSelected ? " (selected)" : ""}`,
      className: "cursor-pointer",
      onClick: () => onSelectCountry(code),
      onKeyDown: (event: React.KeyboardEvent) => handleKeyDown(event, code),
      onFocus: () => {
        setActiveCode(code);
        setFocusedCode(code);
      },
      onBlur: () => setFocusedCode((current) => (current === code ? null : current)),
      onMouseEnter: (event: React.MouseEvent) => {
        setHoverCode(code);
        reportHover(code, event);
      },
      // Position updates skip React state on purpose: a setState per mousemove
      // would re-render every country to move one popup.
      onMouseMove: (event: React.MouseEvent) => reportHover(code, event),
      onMouseLeave: () => {
        setHoverCode((current) => (current === code ? null : current));
        reportHover(null);
      },
    };
  };

  const strokeFor = (code: string) => {
    const isSelected = code === selected;
    const isFocused = code === focusedCode;
    return {
      stroke: isSelected || isFocused ? "var(--ink-0)" : "var(--paper)",
      strokeWidth: isSelected ? 1.6 : isFocused ? 1.2 : 0.4,
      // Dashed marks keyboard focus apart from selection, so the two states are
      // still distinguishable when they land on the same country.
      strokeDasharray: isFocused && !isSelected ? "3 2" : undefined,
    };
  };

  const opacityFor = (code: string): number => {
    if (code === selected) return FILL_SELECTED;
    if (code === hoverCode) return FILL_HOVER;
    return FILL_BASE;
  };

  if (loadError) {
    return (
      <div
        className="rounded-xl border p-6 text-center"
        style={{ borderColor: "var(--line-1)", background: "var(--raise)" }}
      >
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          Couldn&apos;t load the world map. You can still search for a country.
        </p>
        <button
          type="button"
          onClick={() => setRetryKey((k) => k + 1)}
          className="mt-3 min-h-[var(--tap-min)] rounded-lg border px-4 text-sm font-medium"
          style={{ borderColor: "var(--line-1)", color: "var(--accent-ink)" }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!view) {
    return (
      <div
        className="animate-pulse rounded-xl border p-6"
        style={{ borderColor: "var(--line-1)", background: "var(--surf-1)" }}
        aria-busy="true"
      >
        <div
          className="h-[420px] rounded-lg"
          style={{ background: "var(--surf-2)" }}
        />
        <p className="mt-3 text-center text-sm" style={{ color: "var(--ink-2)" }}>
          Unrolling the world…
        </p>
      </div>
    );
  }

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
            <circle cx={point.x} cy={point.y} r={POINT_HIT_R} fill="transparent" />
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

      {/*
        The chosen country's imagery (spec §4.4). Below the SVG, not above it:
        `createHoverReporter` measures pointer positions against this container's
        top-left corner, so anything inserted before the map would silently
        offset every hover popup the parent draws.

        The ground is `--ink-0` because everything above the scrim is light text.
        That token inverts under `data-theme="dark"`, which is unreachable while
        `PrefsProvider` pins light; it needs revisiting with the `theme` prop in
        PR3, and for the same reason.
      */}
      {selectedEntry && (
        <CountryHero
          countryCode={selectedEntry.code}
          theme={theme}
          className="mt-3 rounded-xl bg-[var(--ink-0)] px-4 py-3 text-white"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/70">
            Selected
          </p>
          <p className="font-display text-lg font-bold">{selectedEntry.name}</p>
        </CountryHero>
      )}
    </div>
  );
}
