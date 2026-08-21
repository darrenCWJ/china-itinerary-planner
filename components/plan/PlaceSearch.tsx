"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rankPlaces, type RankedPlace, type SearchableCurated } from "@/lib/placeSearch";
import type { CatalogHit } from "@/lib/tripShared";

/**
 * The merged place input (spec §3.2.2, §8): one always-focused box over the
 * curated set and the all-country catalog, with keyboard-first selection.
 *
 * This replaces a browsable grid, which stops working once the app covers every
 * country — a grid of every city on Earth cannot be rendered.
 *
 * Ranking lives in `lib/placeSearch` and is unit-tested there; this component is
 * the input, the debounce, the listbox semantics and the chips.
 */

/** What a picked place looks like to the caller, whatever its source. */
export interface PickedPlace {
  /** Curated id, catalog qid, or the typed name for an off-map place. */
  id: string;
  name: string;
  kind: RankedPlace["kind"];
  /** Null for off-map places — hand-typed, no location attached (spec §5.6). */
  lat: number | null;
  lon: number | null;
  /** ISO alpha-2 of the country being planned. */
  country: string;
}

interface Props {
  curated: readonly SearchableCurated[];
  /** Coordinates for curated ids, so a pick can carry them without a refetch. */
  coordsFor(id: string): { lat: number; lon: number } | null;
  selected: readonly PickedPlace[];
  country: string;
  onAdd(place: PickedPlace): void;
  onRemove(id: string): void;
}

/** Below this the catalog is not worth a request; one letter matches everything. */
const MIN_QUERY = 2;
/** Countries the catalog actually covers. One, for now. */
const CATALOG_COUNTRIES = new Set(["CN"]);
const DEBOUNCE_MS = 300;

export function PlaceSearch({
  curated,
  coordsFor,
  selected,
  country,
  onAdd,
  onRemove,
}: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same shape as CatalogSearch's fetch: debounce, then abort in flight so a
  // slow older response cannot overwrite a newer one after further typing.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY) {
      setHits([]);
      return;
    }
    /**
     * The catalog is China-only — lib/server/catalog.ts calls it "the full
     * all-China dataset" and its rows carry no country. Querying it while the
     * step is scoped to another country offered Chinese cities for a Japan trip,
     * directly contradicting the scoping this component and CountryMap both
     * claim in comments. Off CN the off-map row is the honest path, and it still
     * works, so nothing is lost but the wrong answers.
     */
    if (!CATALOG_COUNTRIES.has(country.trim().toUpperCase())) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/destinations?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const json: { available: boolean; results: CatalogHit[] } = await res.json();
        setHits(json.results);
      } catch {
        if (!controller.signal.aborted) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [query, country]);

  const selectedIds = useMemo(() => selected.map((p) => p.id), [selected]);
  // Off-map rows are matched by name, not id — see RankOptions.
  const selectedOffMapNames = useMemo(
    () => selected.filter((p) => p.kind === "off-map").map((p) => p.name),
    [selected]
  );

  const results = useMemo(
    () =>
      rankPlaces(
        query,
        curated,
        hits.map((h) => ({
          qid: h.qid,
          name: h.name,
          localName: h.localName,
          province: h.province,
        })),
        { selectedIds, selectedOffMapNames }
      ),
    [query, curated, hits, selectedIds, selectedOffMapNames]
  );

  // Clamp rather than reset: the list reshuffles as results arrive, and jumping
  // back to the first row every time would fight the user's arrow keys.
  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1);

  const add = (place: RankedPlace) => {
    if (place.isSelected) return;
    const coords = place.kind === "curated" ? coordsFor(place.id) : null;
    onAdd({
      id: place.id,
      name: place.name,
      kind: place.kind,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      country,
    });
    setQuery("");
    setActive(0);
    // Focus is never surrendered: the whole point of this input is that a user
    // can add five places without touching the mouse.
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (Math.min(i, results.length - 1) + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) =>
        results.length === 0 ? 0 : (Math.min(i, results.length - 1) + results.length - 1) % results.length
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const place = results[activeIndex];
      if (place) add(place);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setActive(0);
    }
  };

  const listboxId = "place-search-results";
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  return (
    <div>
      <label className="block text-sm font-semibold" htmlFor="place-search-input">
        Where are you going?
      </label>
      <input
        ref={inputRef}
        id="place-search-input"
        type="text"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search a city, or type any place"
        className="mt-1 min-h-[var(--tap-min)] w-full rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-3 text-sm"
      />

      {results.length > 0 && (
        <ul id={listboxId} role="listbox" aria-label="Places" className="mt-1 space-y-0.5">
          {results.map((place, index) => (
            <li
              key={`${place.kind}:${place.id}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex min-h-[var(--tap-min)] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm ${
                index === activeIndex ? "bg-[var(--line-1)]" : ""
              }`}
              // Mouse and keyboard land in the same place() so the two paths
              // cannot drift apart.
              onMouseDown={(e) => {
                e.preventDefault();
                add(place);
              }}
            >
              <span className="truncate">
                {place.kind === "off-map" ? `Add “${place.name}” as its own place` : place.name}
              </span>
              {place.localName && <span className="font-kai text-xs text-seal">{place.localName}</span>}
              {place.province && (
                <span className="text-xs text-[var(--ink-2)]">{place.province}</span>
              )}
              {place.kind === "off-map" && (
                <span className="ml-auto shrink-0 rounded bg-[var(--surf-1)] px-1.5 py-0.5 text-[10px] text-[var(--ink-2)]">
                  no map pin
                </span>
              )}
              {place.isSelected && (
                <span className="ml-auto shrink-0 text-xs font-semibold text-[var(--accent-ink)]">added</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {selected.length > 0 && (
        <ul aria-label="Selected places" className="mt-3 flex flex-wrap gap-2">
          {selected.map((place) => (
            <li
              key={place.id}
              className="flex min-h-8 items-center gap-1 rounded-full bg-[var(--line-1)] px-3 text-sm text-[var(--accent-ink)]"
            >
              {place.name}
              {/*
                Keyed on kind, not on lat === null. A catalog pick also arrives
                without coordinates — CatalogHit carries none until goToPlan
                resolves it — so testing for null coordinates marked real cities
                as hand-typed.
              */}
              {place.kind === "off-map" && (
                <span className="text-[10px] text-[var(--accent-ink)]" title="Hand-typed — no map pin">
                  ○
                </span>
              )}
              {/*
                A real tap target (C5), not a bare glyph. The chip row is 32px
                so the button drives its height; -my-1 lets it reach 44px
                without the chip growing to match.
              */}
              <button
                type="button"
                onClick={() => onRemove(place.id)}
                aria-label={`Remove ${place.name}`}
                className="-my-1 ml-0.5 flex min-h-[var(--tap-min)] min-w-[var(--tap-min)] items-center justify-center rounded-full font-semibold"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
