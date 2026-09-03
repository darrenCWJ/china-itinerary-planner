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
 * Keyboard operability (arrow keys, Enter, Escape, aria-activedescendant) also
 * mirrors PlaceSearch.tsx — see its comments for why active index is clamped
 * rather than reset when results change underneath the user.
 */

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * The airport behind a pick, for callers that want a CODE rather than the
   * display string `onChange` receives. Fired after `onChange`, only on a
   * list pick — free typing never reaches it.
   */
  onPick?: (airport: Airport) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
}

/**
 * What a picked suggestion writes: readable, and carrying the code — capped so
 * it never exceeds `cap`.
 *
 * The ticket schema (lib/server/schemas.ts: `z.string().trim().max(60)`) caps
 * `from`/`to` at 60 characters, and the input's `maxLength` prop defaults to
 * that same 60 — but `maxLength` only limits typed keystrokes, never a value
 * set programmatically here, so this function has to enforce the cap itself.
 *
 * Order: try "Name (IATA)"; if that doesn't fit and the airport has a
 * municipality, fall back to "Municipality (IATA)" (which also just reads
 * better — "Baghdad (BGW)" over "Baghdad International Airport / New Al
 * Muthana Air Base (BGW)"); if that still doesn't fit, or there's no
 * municipality, truncate the name portion so the whole string fits. Against
 * today's artifact every one of the 48 airports whose full name overflows 60
 * chars has a municipality that fits, so that last branch is unreachable — but
 * the artifact refreshes nightly and a longer name could arrive.
 */
function displayValue(hit: Airport, cap: number): string {
  const full = `${hit.name} (${hit.iata})`;
  if (full.length <= cap) return full;

  if (hit.municipality) {
    const viaMunicipality = `${hit.municipality} (${hit.iata})`;
    if (viaMunicipality.length <= cap) return viaMunicipality;
  }

  const suffix = ` (${hit.iata})`;
  const truncatedName = hit.name.slice(0, Math.max(0, cap - suffix.length));
  return `${truncatedName}${suffix}`;
}

export function AirportInput({
  label,
  value,
  onChange,
  onPick,
  placeholder,
  // Mirrors the ticket schema's own cap on `from`/`to` (lib/server/schemas.ts:
  // `z.string().trim().max(60)`). Kept as a prop, read by displayValue below,
  // rather than a second hardcoded 60 — so the two cannot drift apart.
  maxLength = 60,
  className,
}: Props) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const [hits, setHits] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The exact string `pick()` last wrote. The query effect below compares the
   * incoming `value` against this rather than trusting a bare boolean latch —
   * a boolean would misfire if a pick ever produced a value identical to the
   * pre-pick one, since remembering "a pick just happened" is not the same as
   * remembering "a pick just wrote this specific string."
   */
  const lastPickedValueRef = useRef<string | null>(null);
  /**
   * Whether the field currently has focus. Read (never rendered) so the
   * debounced fetch below can tell a value change the user is actively
   * typing apart from one that landed on an unfocused field — a prefilled
   * `value` on mount (editing a saved ticket) is the latter, and opening the
   * list under a field nobody focused would float it over the row beneath
   * with nothing — no outside-click handler, blur already gone — able to
   * close it again.
   */
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (lastPickedValueRef.current !== null && value === lastPickedValueRef.current) {
      lastPickedValueRef.current = null;
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
        // Gated on focus, not just "results arrived": a blur that lands after
        // this timer already started the fetch (the window between the debounce
        // firing and the response resolving) still lands here with the field no
        // longer focused, and opening the list at that point would be exactly
        // the reopen-after-blur race this field exists to avoid.
        if (isFocusedRef.current) setOpen(json.results.length > 0);
      } catch {
        if (!controller.signal.aborted) {
          setHits([]);
          setOpen(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [value]);

  // Clamp rather than reset: hits arrive asynchronously after the debounce, and
  // jumping the active option back to the first row every time would fight the
  // user's arrow keys mid-navigation (see PlaceSearch.tsx for the same call).
  const activeIndex = hits.length === 0 ? -1 : Math.min(active, hits.length - 1);
  const showList = open && hits.length > 0;

  const pick = (hit: Airport) => {
    const next = displayValue(hit, maxLength);
    lastPickedValueRef.current = next;
    setOpen(false);
    setHits([]);
    setActive(0);
    onChange(next);
    onPick?.(hit);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (Math.min(i, hits.length - 1) + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (Math.min(i, hits.length - 1) + hits.length - 1) % hits.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      pick(hits[activeIndex]);
    }
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
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showList && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            isFocusedRef.current = true;
          }}
          onBlur={() => {
            isFocusedRef.current = false;
            // Cancels the pending debounce outright, not just its eventual
            // `setOpen` — a fetch that never starts cannot race back open at
            // all. Without this, a blur inside the 300ms window leaves the
            // timer alive to fire after the field is no longer focused (the
            // `isFocusedRef` gate above catches that case too, but there is
            // no reason to fire the request in the first place).
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            setOpen(false);
          }}
          className={inputClass}
        />
      </label>
      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${label} airport suggestions`}
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--line-1)] bg-[var(--paper)] shadow-lg"
        >
          {hits.map((hit, index) => (
            <li
              key={hit.iata}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              // onMouseDown, not onClick: blur fires first and would close the
              // list before a click could land.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(hit);
              }}
              className={`flex min-h-[var(--tap-min)] cursor-pointer items-center gap-2 px-3 text-sm hover:bg-[var(--line-1)] ${
                index === activeIndex ? "bg-[var(--line-1)]" : ""
              }`}
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
