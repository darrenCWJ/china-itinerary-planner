"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Airport } from "@/lib/airports";

/**
 * A text field that suggests real airports (spec §3.6).
 *
 * It stays a *text field*. The ticket's `from`/`to` are free-text strings in
 * the schema, old tickets hold whatever someone typed, and plenty of real
 * journeys start somewhere with no IATA code — so this suggests and never
 * gates. Picking a suggestion writes a display string; typing something else
 * is equally valid and is passed straight through.
 *
 * Debounce-then-abort is the same shape as components/plan/PlaceSearch.tsx, so
 * a slow older response cannot overwrite a newer one after further typing.
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}

/** What a picked suggestion writes: readable, and carrying the code. */
function displayValue(hit: Airport): string {
  return `${hit.name} (${hit.iata})`;
}

export function AirportInput({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 60,
  className,
}: Props) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const [hits, setHits] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Suppresses the lookup that the pick itself would otherwise trigger. */
  const justPickedRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    if (value.trim().length < MIN_QUERY) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/airports/search?q=${encodeURIComponent(value.trim())}`, {
          signal: controller.signal,
        });
        const json: { results: Airport[] } = await res.json();
        setHits(json.results);
        setOpen(json.results.length > 0);
      } catch {
        if (!controller.signal.aborted) setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [value]);

  const pick = (hit: Airport) => {
    justPickedRef.current = true;
    setOpen(false);
    setHits([]);
    onChange(displayValue(hit));
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-3 py-1.5 text-sm text-[var(--ink-0)] focus-visible:outline-2 focus-visible:outline-[var(--accent-ink)]";

  return (
    <div className="relative">
      <label className={className ?? "text-xs font-medium text-[var(--ink-2)]"} htmlFor={inputId}>
        {label}
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setOpen(false)}
          className={inputClass}
        />
      </label>
      {open && hits.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} airport suggestions`}
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--line-1)] bg-[var(--paper)] shadow-lg"
        >
          {hits.map((hit) => (
            <li
              key={hit.iata}
              role="option"
              aria-selected={false}
              // onMouseDown, not onClick: blur fires first and would close the
              // list before a click could land.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
              className="flex min-h-[var(--tap-min)] cursor-pointer items-center gap-2 px-3 text-sm hover:bg-[var(--line-1)]"
            >
              <span className="font-mono text-xs font-semibold text-[var(--accent-ink)]">
                {hit.iata}
              </span>
              <span className="truncate">{hit.name}</span>
              {hit.municipality && (
                <span className="ml-auto shrink-0 text-xs text-[var(--ink-2)]">
                  {hit.municipality}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
