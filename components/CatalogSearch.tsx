"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogHit } from "@/lib/tripShared";

interface Props {
  selectedIds: string[];
  extras: Record<string, CatalogHit>;
  onAdd: (hit: CatalogHit) => void;
  onRemove: (qid: string) => void;
}

interface SearchState {
  available: boolean | null;
  results: CatalogHit[];
  loading: boolean;
}

/** Search box over the full all-China catalog (every city, via Wikidata). */
export function CatalogSearch({ selectedIds, extras, onAdd, onRemove }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ available: null, results: [], loading: false });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setState((s) => ({ ...s, results: [], loading: false }));
      return;
    }
    // Abort in-flight requests so a slow older response can't overwrite a
    // newer one after further typing.
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const res = await fetch(`/api/destinations?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const json: { available: boolean; results: CatalogHit[] } = await res.json();
        setState({ available: json.available, results: json.results, loading: false });
      } catch {
        if (!controller.signal.aborted) {
          setState({ available: null, results: [], loading: false });
        }
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [query]);

  const chosen = Object.values(extras).filter((e) => selectedIds.includes(e.qid));

  return (
    <div className="mt-8 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5">
      <h3 className="font-display text-lg font-semibold">Somewhere else in China?</h3>
      <p className="mt-1 text-xs text-[var(--ink-2)]">
        Search every city in the country — powered by the all-China catalog (Wikidata).
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Try Luoyang, Datong, Dunhuang, Kashgar…"
        aria-label="Search all cities in China"
        className="mt-3 w-full rounded-lg border border-[var(--line-1)] bg-[var(--surf-1)] px-4 py-2.5 text-sm focus-visible:outline-2 focus-visible:outline-[var(--accent-ink)]"
      />

      {state.available === false && (
        <p className="mt-3 rounded-lg bg-[var(--line-1)]/40 p-3 text-xs text-[var(--ink-2)]">
          The all-China catalog hasn&apos;t been generated yet. Run{" "}
          <code className="font-mono">node scripts/ingest-destinations.mjs</code> (or POST{" "}
          <code className="font-mono">/api/destinations/refresh</code>) to fetch it.
        </p>
      )}
      {state.loading && <p className="mt-3 text-xs text-[var(--ink-2)]">Searching…</p>}

      {state.results.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--line-1)]/60 rounded-lg border border-[var(--line-1)]">
          {state.results.slice(0, 8).map((hit) => {
            const isChosen = selectedIds.includes(hit.qid);
            return (
              <li key={hit.qid} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {hit.name}
                    {hit.chineseName && (
                      <span className="ml-2 font-kai text-seal">{hit.chineseName}</span>
                    )}
                    {hit.province && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-[var(--ink-2)]">
                        {hit.province}
                      </span>
                    )}
                  </p>
                  {hit.description && (
                    <p className="truncate text-xs text-[var(--ink-2)]">{hit.description}</p>
                  )}
                  <p className="text-[11px] text-[var(--ink-2)]">
                    {hit.attractionCount > 0
                      ? `${hit.attractionCount} known attraction${hit.attractionCount > 1 ? "s" : ""}`
                      : "General exploration plan"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => (isChosen ? onRemove(hit.qid) : onAdd(hit))}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    isChosen
                      ? "bg-[var(--line-1)] text-[var(--accent-ink)] hover:bg-[var(--line-1)]/70"
                      : "bg-[var(--accent-ink)] text-white hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]"
                  }`}
                >
                  {isChosen ? "Remove" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {chosen.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-[var(--ink-2)]">Added from the catalog:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chosen.map((hit) => (
              <span
                key={hit.qid}
                className="flex items-center gap-1.5 rounded-full border border-[var(--accent-ink)] bg-[var(--line-1)]/50 px-3 py-1 text-xs font-medium"
              >
                📍 {hit.name}
                <button
                  type="button"
                  onClick={() => onRemove(hit.qid)}
                  aria-label={`Remove ${hit.name}`}
                  className="text-[var(--accent-ink)] hover:text-seal"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
