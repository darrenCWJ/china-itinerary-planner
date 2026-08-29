"use client";

import { useMemo, useState } from "react";
import { getCountry } from "@/lib/countries";
import { filterPlaces, groupPlacesByAdmin1 } from "@/lib/placeGrouping";
import type { MapPlace } from "./mapTypes";

/**
 * The country level's place list — §5.2's accessibility spine.
 *
 * Moved out of `CountryMap.tsx` unchanged except for `hasMap`, because it now
 * has two renderers above it rather than one: it is the WHOLE of the level for
 * a country with no geometry loaded, and it sits beside the map in
 * `CountryLevel`. Importing it back out of `CountryMap` would have made the
 * dispatcher and the level import each other.
 *
 * It is never optional and never a fallback. Spec §5.2 makes it the source of
 * truth for the accessibility tree and §12.2 makes that testable: whatever the
 * map draws, every place in the open country stays reachable here by keyboard,
 * by filter, and at the minimum tap target.
 *
 * This panel used to defer to the destination step's own search rather than
 * grow a second input, on the grounds that two boxes could disagree. It has
 * one now, and they do different jobs: that search reaches the whole catalog
 * and adds places; this filter narrows the shard already on screen and never
 * fetches. A spine that renders 60 of 750 rows is not one — for 150 of 246
 * countries the old cap hid most of the shard.
 */

/** Chips shown per province before the group offers to expand. */
const PLACES_PER_GROUP = 12;

export function CountryPlaceList({
  country,
  places,
  selected,
  onTogglePlace,
  hasMap = false,
}: {
  country: string;
  places: MapPlace[];
  selected: string[];
  onTogglePlace: (place: MapPlace) => void;
  /**
   * Whether a map is drawn beside this list.
   *
   * It changes one sentence and nothing else. "No map for Peru yet" was true
   * for 245 countries and is now true for none of them that have loaded their
   * geometry, and a list that says it under a drawn map is telling the user
   * something they can see is false.
   */
  hasMap?: boolean;
}) {
  const { name, code } = getCountry(country);
  // `getCountry` is total and never throws, and since `INGESTED_NAMES` landed
  // in lib/countries.ts it names all 246 countries rather than the curated 24 —
  // so this reads "Peru", not "PE". The `||` chain is the guard for the case
  // that is left: a code that is not a country at all, where both are "".
  const label = name || code || "this country";
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const matched = useMemo(() => filterPlaces(places, query), [places, query]);
  const groups = useMemo(() => groupPlacesByAdmin1(matched), [matched]);
  // A filter is a deliberate narrowing, so it expands everything it matched —
  // asking a user to expand a group they just searched into is a second step
  // for a decision they already made.
  const filtering = query.trim() !== "";

  const emptyCopy = hasMap
    ? `No places in ${label} yet — search above to add them, and they'll show up on the map and in your plan.`
    : `No map for ${label} yet — search above to add places, and they'll show up in your plan the same way.`;

  return (
    <div className="rounded-xl border border-dashed border-[var(--line-1)] bg-[var(--surf-1)]/50 p-5">
      <h4 className="font-display text-base font-bold">{label}</h4>
      <p className="mt-1 text-sm text-[var(--ink-2)]">
        {places.length > 0 ? `Tap a place to add it, or filter to find one by name.` : emptyCopy}
      </p>

      {places.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={`Filter places in ${label}`}
          placeholder={`Filter ${places.length} places`}
          className="mt-3 min-h-[var(--tap-min)] w-full rounded-full border border-[var(--line-1)] bg-[var(--paper)] px-4 text-sm text-[var(--ink-1)] placeholder:text-[var(--ink-2)]"
        />
      )}

      {groups.map((group) => {
        const open = filtering || expanded.has(group.key);
        const shown = open ? group.places : group.places.slice(0, PLACES_PER_GROUP);
        const hidden = group.places.length - shown.length;
        const groupLabel = group.label ?? `Elsewhere in ${label}`;
        return (
          <section key={group.key} aria-label={groupLabel} role="group" className="mt-4">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-2)]">
              {groupLabel}
            </h5>
            <ul className="mt-2 flex flex-wrap gap-2">
              {shown.map((place) => {
                const isSelected = selected.includes(place.id);
                return (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => onTogglePlace(place)}
                      aria-pressed={isSelected}
                      className={`min-h-[var(--tap-min)] rounded-full border px-3.5 text-sm transition-colors ${
                        isSelected
                          ? "border-[var(--accent-ink)] bg-[var(--accent-ink)] text-[var(--paper)]"
                          : "border-[var(--line-1)] bg-[var(--paper)] text-[var(--ink-2)] hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)]"
                      }`}
                    >
                      {place.name}
                      {place.localName && (
                        <span className="ml-1.5 font-kai opacity-80">{place.localName}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((prev) => new Set(prev).add(group.key))}
                className="mt-2 min-h-[var(--tap-min)] text-xs font-semibold text-[var(--accent-ink)] underline"
              >
                {`Show all ${group.places.length} in ${groupLabel}`}
              </button>
            )}
          </section>
        );
      })}

      {places.length > 0 && groups.length === 0 && (
        <p className="mt-3 text-sm text-[var(--ink-2)]">
          {`No places in ${label} match "${query.trim()}".`}
        </p>
      )}
    </div>
  );
}
