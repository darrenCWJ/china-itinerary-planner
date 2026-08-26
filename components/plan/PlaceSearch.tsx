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
   * What the picked row itself displayed, carried through so the `CatalogHit`
   * the wizard stores under this id matches the one the map's tap would store.
   *
   * `app/plan/page.tsx` keeps `extras` keyed by qid with last-write-wins, and
   * since Task 13 both this component and `MapExplorer.togglePlace` can emit
   * the same worldwide id. The map sent the shard row's admin-1; this path
   * hard-coded `province: null` in `DestinationStep.addPlace` and threw away
   * the `a1` the row had just rendered beside the city's name — so the same
   * city ended up shaped two different ways depending on which surface added
   * it, and a re-pick through search silently downgraded what the map stored.
   *
   * `population`, `description` and `attractionCount` stay null/0 on this path
   * and that is not a discard: a `RankedPlace` never held them. Description in
   * particular is filled at the merge point by the lazy enrichment fetch that
   * Task 15 adds to `addCatalog`, which is where a fetch belongs — not here,
   * per keystroke.
   */
  localName: string | null;
  province: string | null;
  /**
   * The one-line Wikidata blurb for this place, once something knows one.
   *
   * The read end of the lazy enrichment fetch. `addCatalog` writes the fetched
   * string to `extras[qid].description`, `DestinationStep`'s `picked` memo
   * carries it here, and the chip below renders it — without that chain the
   * fetch wrote into a dead end and the whole feature was invisible.
   *
   * This one field is what both pick surfaces share. `extras` is the single
   * store that `MapExplorer.togglePlace` and `DestinationStep.addPlace` both
   * write, and `picked` is rebuilt from it, so a city added by tapping the map
   * and a city added through this box arrive at the same chip and show the
   * same blurb — no second render path to keep in step.
   *
   * Null on the producer side: this component emits a pick from a
   * `RankedPlace`, which never held one. Only the `picked` rebuild fills it.
   */
  description: string | null;
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
 * Shard rows handed to the ranker per keystroke, prefix matches first.
 *
 * A shard holds at most 750 cities (measured: AR, the largest of the 246
 * committed shards) and the ranker slices to ten, so a cap is worth having.
 * What it must not do is decide the answer — and until this commit it did.
 * The cap was applied to a single list in file order, and file order is
 * population order, which `lib/cityShard.ts` states is "display order, never
 * score order". `rankPlaces` scores a prefix match 100 and a substring match
 * 80, so truncating by population before scoring dropped prefix matches in
 * favour of more populous substring matches.
 *
 * Measured over all 246 committed shards and every 2-6 character prefix of
 * every city name in them (175,814 distinct queries): 1,009 of those queries
 * match more than 60 rows, and a population-ordered cut changes the visible
 * top ten in 409 of them (0.23%) and row one in 64. Small, but not "never".
 *
 * The two buckets below make the claim true rather than merely small: prefix
 * matches fill the budget first and substring matches take what is left, so a
 * row the cap drops always scores at or below every row it keeps.
 */
export const SHARD_CANDIDATES = 60;

/**
 * The Wikidata leg's answers indexed as folded name -> folded provinces, which
 * is the key the two catalog legs are deduped on.
 *
 * China is the one country where both legs answer — `lib/server/catalog.ts`
 * stamps `LEGACY_CATALOG_COUNTRY = "CN"` on all 695 Wikidata rows — and the
 * two sources overlap there. Measured against the committed
 * `data/catalog.json` and `public/cities/CN.json` (413 rows): 54 shard rows
 * carry a name the catalog also has, 3 of which (`chongqing`, `qingdao`,
 * `dali`) the curated set already removes from both legs.
 *
 * Name alone is the wrong key and would be a worse bug than the one it fixes.
 * The 51 rows that remain make 55 name-pairs — Longnan and Jinzhou each match
 * two catalog cities — and 40 of those pairs, across 36 distinct names, are
 * genuinely different Chinese cities: Yushu (Changchun) and Yushu (Qinghai)
 * are 2,852 km apart, and 32 of the 40 are more than 100 km apart. Their
 * provinces differ, so they survive this key. The other 15 are one city
 * offered twice, 5.0-229.5 km apart depending on which point in a prefecture
 * each source picked, and those are the ones suppressed.
 *
 * `CatalogHit` carries no coordinates, so distance is not available to key on
 * and the province label is the closest stand-in. It is not exact in either
 * direction: it keeps a duplicate whose two labels name the same place at
 * different levels (the catalog's "Meizhou" against the shard's "Guangdong",
 * 6 of the 51), and it drops Jinzhou (Liaoning), where the catalog's
 * prefecture-level city and the shard's Dalian district really are two places
 * 229 km apart under one province. Both are quieter failures than offering 15
 * duplicate cities, which `app/plan/page.tsx` will accept twice because it
 * dedupes `selected` by id and the two rows carry different ids.
 */
function foldedProvincesByName(rows: readonly CatalogHit[]): ReadonlyMap<string, ReadonlySet<string>> {
  // Two levels rather than one joined string key: a province label can contain
  // whatever a place name can, so any separator that is legal in one part can
  // make two different pairs share a key. Nesting has no separator to get
  // wrong.
  const index = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = foldPlaceName(row.name);
    const provinces = index.get(name) ?? new Set<string>();
    provinces.add(foldPlaceName(row.province ?? ""));
    index.set(name, provinces);
  }
  return index;
}

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
   * The Wikidata hits, cleared on a country switch — the shard's counterpart,
   * and for the identical reason.
   *
   * It is a separate effect from the debounced fetch below on purpose. That
   * one is keyed `[query, country]` and so runs on every keystroke; clearing
   * at the top of it would blank the list between letters. This one runs only
   * when the country changes.
   *
   * Without it a country switch left the previous country's hits on screen
   * for a debounce plus a round trip — and indefinitely if `/api/destinations`
   * hung, because the only other clears are the `query < MIN_QUERY` guard and
   * the `catch`, which fires on rejection alone. Since every catalog row is
   * Chinese (`lib/server/catalog.ts` stamps `LEGACY_CATALOG_COUNTRY = "CN"`),
   * a non-empty `hits` under a switched-away scope is always a Chinese city
   * offered for another country's trip — first in the list, keyboard-active
   * and addable. The China-only allowlist Task 13 deleted used to clear
   * synchronously here; nothing replaced it until this effect.
   *
   * `PlaceSearch` is rendered without a `key` (`components/DestinationStep`),
   * so a switch is a prop change, not a remount: `query` and `hits` both
   * survive it.
   */
  useEffect(() => {
    // Bail-out updater, same as the shard's `clear()`: an already-empty `hits`
    // must be a true no-op rather than a fresh `[]` that re-renders.
    setHits((previous) => (previous.length === 0 ? previous : []));
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
   * it has to be suppressed here instead.
   *
   * `rankPlaces` does have a cross-kind name check (`lib/placeSearch.ts:129`
   * drops a catalog row whose folded name matches a `curated` entry), but it
   * can only see the names in the `curated` prop. This set covers what that
   * prop cannot: a name a curated destination's *activities* cover without a
   * card of its own — "Yangshuo", planned by the "Guilin & Yangshuo" card —
   * so without it the picker offers a bare "Yangshuo" chip beside the card.
   *
   * `curatedPlaceNames` rather than the `curated` prop, because the prop
   * already excludes visited destinations — and a place the traveller has been
   * to should still not appear twice. Its names arrive already folded, so the
   * membership test below folds the shard row and nothing else.
   */
  const suppressed = useMemo(() => curatedPlaceNames(country), [country]);

  /** See `foldedProvincesByName` for why the province is half of the key. */
  const catalogProvinces = useMemo(() => foldedProvincesByName(hits), [hits]);

  /**
   * The shard rows worth ranking. Filtered here rather than inside `rankPlaces`
   * so the fold runs once per row per query instead of once per render, and
   * so the ranker never sees more than `SHARD_CANDIDATES` rows.
   *
   * Two buckets, not one list: see `SHARD_CANDIDATES`. A prefix match outranks
   * a substring match, so filling the budget in the shard's own population
   * order let the cap decide the answer.
   */
  const shardHits = useMemo<SearchableHit[]>(() => {
    if (query.trim().length < MIN_QUERY) return [];
    const q = foldPlaceName(query);
    const prefix: SearchableHit[] = [];
    const substring: SearchableHit[] = [];
    for (const row of shard) {
      const folded = foldPlaceName(row.n);
      const at = folded.indexOf(q);
      if (at < 0) continue;
      if (suppressed.has(folded)) continue;
      if (catalogProvinces.get(folded)?.has(foldPlaceName(row.a1 ?? ""))) continue;
      // `localName: null` for every shard row, and it stays null: GeoNames'
      // `name` column is the romanised conventional name, not the endonym.
      // Measured across all 246 committed shards (58,742 rows), 20 names carry
      // a non-Latin script at all, and CN, JP, RU, KR, GR, TH and EG carry
      // none — JP opens "Tokyo"/"Yokohama", RU "Moscow". So the `font-kai`
      // span beside a shard row would have nothing to render even if this
      // field were wired to something.
      const hit: SearchableHit = { qid: row.id, name: row.n, localName: null, province: row.a1 };
      if (at === 0) {
        prefix.push(hit);
        // Nothing after this point can outrank a full bucket of prefix
        // matches, so the rest of the shard cannot change the answer.
        if (prefix.length >= SHARD_CANDIDATES) break;
      } else if (substring.length < SHARD_CANDIDATES) {
        substring.push(hit);
      }
    }
    return [...prefix, ...substring].slice(0, SHARD_CANDIDATES);
  }, [shard, query, suppressed, catalogProvinces]);

  /**
   * Wikidata hits first, GeoNames rows second. `rankPlaces` breaks a score tie
   * by input index, so a city that has a researched description and an
   * attraction count outranks a bare shard row that matched just as well.
   *
   * Order settles which of two *different* cities leads. It is `shardHits`
   * that keeps the same city from appearing on both sides of this
   * concatenation — `rankPlaces` dedupes catalog against curated and never
   * catalog against catalog.
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
      localName: place.localName,
      province: place.province,
      // A ranked row never held a blurb; `extras` is where one arrives.
      description: null,
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
                The lazy enrichment fetch's only render path (spec §4). Wikidata
                descriptions are one short noun phrase — "city in the Lima
                Region, Peru" — so the chip can carry one as secondary text;
                `truncate` plus `title` keeps the pill's height for the rare
                long one.
              */}
              {place.description && (
                <span
                  className="max-w-[18ch] truncate text-xs font-normal text-[var(--ink-2)]"
                  title={place.description}
                >
                  {place.description}
                </span>
              )}
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
