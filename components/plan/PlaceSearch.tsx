"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCityShard, type CityShardRow } from "@/lib/cityShard";
import { curatedPlaceNames } from "@/lib/curatedNames";
import { foldPlaceName } from "@/lib/foldPlaceName";
import { rankPlaces, type RankedPlace, type SearchableCurated, type SearchableHit } from "@/lib/placeSearch";
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
  /**
   * ISO alpha-2 of the *country being planned* — the scope that is open in the
   * picker, not the country the place itself sits in. Those are two different
   * questions and this field answers only the first: this component stamps the
   * open `country` on every pick, of every kind, curated included.
   *
   * DestinationStep rebuilds this array itself and its curated and off-map
   * branches still answer the second question; see the note there. Task 13 —
   * the change that made this component search the open country’s shard —
   * deliberately left that divergence alone rather than widening its blast
   * radius, so the two producers still disagree and no later task in this
   * phase owns reconciling them.
   */
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
const DEBOUNCE_MS = 300;
/**
 * Shard rows handed to the ranker per keystroke. A shard holds at most 750
 * cities (measured: AR, the largest of the 246 committed shards) and the ranker
 * slices to ten, so this only bounds the work, never the answer: it is applied
 * after the substring filter, in population order, so what it drops is always
 * smaller than what it keeps.
 */
const SHARD_CANDIDATES = 60;

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
  const [shard, setShard] = useState<CityShardRow[]>([]);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The open country's GeoNames cities, fetched once per country.
   *
   * Keyed on the country rather than the query: a shard holds every city the
   * country has and is small with it — `lib/cityShard.ts` records 21.6 KB
   * gzipped for the largest and under 12 KB for the median — so one fetch
   * answers every keystroke from memory. `public/` is unreadable from a
   * lambda, which is why this is a static asset the browser fetches rather
   * than a second API leg.
   *
   * Cleared up front, not just on failure — the same reason MapExplorer's
   * airports effect clears first. Between a country switch and the new shard
   * landing, the previous country's cities are wrong answers, not stale ones.
   */
  useEffect(() => {
    const controller = new AbortController();
    // Functional, not `setShard([])`: a fresh `[]` is a new reference and
    // re-renders even when the shard was already empty. React bails out when
    // the updater returns the previous value, which keeps the failure path a
    // true no-op — including in tests, where that stray render lands in a
    // microtask outside `act` and prints a warning about nothing happening.
    const clear = () => setShard((previous) => (previous.length === 0 ? previous : []));
    clear();
    fetchCityShard(country, controller.signal)
      .then((loaded) => setShard(loaded.cities))
      // A country with no shard, an offline fetch, a login-wall redirect whose
      // HTML fails to parse, or a shard whose envelope names a different
      // country than the URL asked for: the off-map row is still the
      // guaranteed path to any place, so this failure is silent by design.
      .catch(() => {
        if (!controller.signal.aborted) clear();
      });
    return () => controller.abort();
  }, [country]);

  /**
   * The Wikidata half, which only China has. Debounced, then aborted in flight
   * so a slow older response cannot overwrite a newer one after further typing.
   *
   * There is no allowlist in front of this any more. The China-only allowlist
   * that used to sit here existed because the catalog was China-only and its
   * rows carried no country, so querying it under a Japan scope offered Chinese
   * cities for a Japan trip. `searchCities` takes the country now and answers
   * with that country's cities or with nothing, so the request is correct for
   * every country and the allowlist has nothing left to protect.
   */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/destinations?q=${encodeURIComponent(query.trim())}&country=${encodeURIComponent(country)}`,
          { signal: controller.signal }
        );
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

  /**
   * Names a curated card already covers, so a shard row cannot re-offer them.
   *
   * The ingest's `dropCatalogDuplicates` only removes rows that duplicate a
   * `data/catalog.json` QID city — and a curated destination with no
   * catalog.json row of its own keeps its GeoNames row through the ingest, so
   * it has to be suppressed here instead. `rankPlaces` does not dedupe by name
   * across kinds either (`lib/placeSearch.ts:127-142` concatenates with no
   * cross-kind check), so without this the picker can offer a bare "Yangshuo"
   * chip beside the curated "Guilin & Yangshuo" card.
   *
   * `curatedPlaceNames` rather than the `curated` prop, because the prop
   * already excludes visited destinations — and a place the traveller has been
   * to should still not appear twice. Its names arrive already folded, so the
   * membership test below folds the shard row and nothing else.
   */
  const suppressed = useMemo(() => curatedPlaceNames(country), [country]);

  /**
   * The shard rows worth ranking. Filtered here rather than inside `rankPlaces`
   * so the fold runs once per row per query instead of once per render, and
   * so the ranker never sees more than `SHARD_CANDIDATES` rows.
   */
  const shardHits = useMemo<SearchableHit[]>(() => {
    if (query.trim().length < MIN_QUERY) return [];
    const q = foldPlaceName(query);
    const matched: SearchableHit[] = [];
    for (const row of shard) {
      const folded = foldPlaceName(row.n);
      if (!folded.includes(q)) continue;
      if (suppressed.has(folded)) continue;
      // GeoNames' `name` column is already the local endonym, so there is no
      // second spelling to show beside it.
      matched.push({ qid: row.id, name: row.n, localName: null, province: row.a1 });
      if (matched.length >= SHARD_CANDIDATES) break;
    }
    return matched;
  }, [shard, query, suppressed]);

  /**
   * Wikidata hits first, GeoNames rows second. `rankPlaces` breaks a score tie
   * by input index, so a city that has a researched description and an
   * attraction count outranks a bare shard row that matched just as well.
   */
  const catalogHits = useMemo<SearchableHit[]>(
    () => [
      ...hits.map((h) => ({
        qid: h.qid,
        name: h.name,
        localName: h.localName,
        province: h.province,
      })),
      ...shardHits,
    ],
    [hits, shardHits]
  );

  const results = useMemo(
    () => rankPlaces(query, curated, catalogHits, { selectedIds, selectedOffMapNames }),
    [query, curated, catalogHits, selectedIds, selectedOffMapNames]
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
              {place.localName && <span className="font-kai text-xs text-[var(--seal)]">{place.localName}</span>}
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
