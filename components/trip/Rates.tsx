"use client";

import { useEffect, useState } from "react";

type Props = {
  /** The destination currency, or null when the country has no researched
   * profile yet (see `lib/tripShared.ts`'s `tripCurrency`). Never a guess. */
  tripCurrency: string | null;
  /** `currencySettings.home` — gates the empty state and the fetch, and is
   * the one currency of every pair that is *not* priced against `pivot`. */
  homeCurrency: string | null;
  /**
   * `currencyPivot(currencySettings)` — the same currency
   * `CurrencySettingsEditor`'s rate rows are priced against (`MoneyTab.tsx`'s
   * "1 {c} = [___] {pivot}" label). Every rate this panel shows is fetched
   * and rendered against this currency, never `homeCurrency`, so the number
   * a member reads here is always the number the rate editor wants — for the
   * headline pair *and* for every J-C5 extra currency alike. Before this,
   * every row was priced against `homeCurrency`: that coincided with the
   * editor's pivot-relative field for the headline pair (because the trip's
   * pivot is usually the destination currency, which is also what the
   * headline pair's "other" side already was) but was quietly wrong for any
   * extra currency, where copying the panel's number into the editor stored
   * a rate off by roughly the home/pivot cross-rate.
   */
  pivot: string;
  /**
   * Currencies actually present in the trip's expenses, beyond the headline
   * pair (J-C5) — a layover or cross-border spend the member still needs a
   * rate for. Never a currency nobody spent in.
   */
  extraCurrencies: string[];
  /** Whether this viewer can set a home currency — gates the empty-state link. */
  isMember: boolean;
};

type RatesResponse = {
  base: string;
  rates: Record<string, number>;
  asOf: string;
  source: "er-api" | "cdn";
  stale: boolean;
};

type FetchState =
  | { status: "loading" }
  | { status: "ok"; data: RatesResponse }
  | { status: "rejected" }
  | { status: "unavailable" }
  | { status: "error" };

/** The licence condition er-api's terms require — discreet, but present
 * whenever this panel is open, so it can never regress silently (there's a
 * test for exactly that). */
const ATTRIBUTION_URL = "https://www.exchangerate-api.com";

/**
 * Fixed to UTC regardless of the viewer's machine, so "as of" reads the same
 * for every member looking at the same trip — and so this is deterministic
 * in tests, which would otherwise depend on the test runner's local timezone.
 */
function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = date.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${formatted} UTC`;
}

/**
 * Display only (J-C2 — this never feeds arithmetic), so precision is chosen
 * for readability, not accounting: enough digits that a small-value rate
 * (CNY per JPY ≈ 0.0424) isn't rounded to nothing, without dumping float
 * noise on a large one.
 */
function formatRate(value: number): string {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : 4;
  return value.toFixed(digits);
}

/** One `1 X = Y Z` line and its inverse, or an honest "no rate" line when the
 * provider has nothing for that code. */
function PairLines({
  home,
  other,
  rates,
}: {
  home: string;
  other: string;
  rates: Record<string, number>;
}) {
  const rate = rates[other];
  if (rate === undefined) {
    return <li className="text-[var(--ink-2)]">No live rate available for {other}.</li>;
  }
  return (
    <li>
      1 {home} = {formatRate(rate)} {other}
      {" · "}1 {other} = {formatRate(1 / rate)} {home}
    </li>
  );
}

function RatesPanel({ tripCurrency, homeCurrency, pivot, extraCurrencies, isMember }: Props) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    // Still gated on a home currency being set — there's nothing personal to
    // price against otherwise (unchanged UX) — but the request itself is
    // keyed by `pivot`, not `homeCurrency` (see the Props doc above).
    if (!homeCurrency) return;
    let live = true;
    setState({ status: "loading" });
    fetch(`/api/rates?base=${encodeURIComponent(pivot)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!live) return;
        // The 400 and 502 bodies both carry `{ error }`, but neither is
        // rendered verbatim — the honest message shown for each is authored
        // here, not coupled to the route's exact wording, so parsing either
        // body would be dead weight.
        if (res.status === 400) return setState({ status: "rejected" });
        if (res.status === 502) return setState({ status: "unavailable" });
        if (!res.ok) return setState({ status: "error" });
        const body = (await res.json().catch(() => null)) as RatesResponse | null;
        if (!live) return;
        setState(body ? { status: "ok", data: body } : { status: "error" });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [homeCurrency, pivot]);

  if (!homeCurrency) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-[var(--ink-2)]">
          {isMember ? (
            <>
              No home currency is set for this trip yet, so there is nothing to price against.{" "}
              <a
                href="#currency-settings"
                className="font-medium text-[var(--accent-ink)] underline"
              >
                Set it now
              </a>
              .
            </>
          ) : (
            "No home currency is set for this trip yet."
          )}
        </p>
        <Attribution />
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {!tripCurrency && (
        <p className="text-[var(--ink-2)]">
          We haven&apos;t researched a currency for this trip&apos;s destination yet, so we
          can&apos;t show its rate.
        </p>
      )}

      {state.status === "loading" && (
        <p className="text-[var(--ink-2)]">Loading today&apos;s rate…</p>
      )}

      {state.status === "rejected" && (
        <p className="text-[var(--seal)]">
          {pivot} isn&apos;t recognised by our rates provider, so we can&apos;t look up its
          rate.
        </p>
      )}

      {state.status === "unavailable" && (
        <p className="text-[var(--seal)]">
          Exchange rates are temporarily unavailable — both providers are unreachable and we
          have nothing cached yet. Your hand-entered rates above are unaffected.
        </p>
      )}

      {state.status === "error" && (
        <p className="text-[var(--seal)]">Could not load today&apos;s exchange rate.</p>
      )}

      {state.status === "ok" && (
        <>
          {state.data.stale && (
            <p className="rounded-lg bg-[var(--surf-1)] px-3 py-2 text-xs text-[var(--ink-2)]">
              These are the last rates we could reach — today&apos;s update hasn&apos;t come
              through yet.
            </p>
          )}
          <ul className="space-y-1">
            {/*
              Every row is priced against `pivot`, not `homeCurrency` — see
              the Props doc on `pivot` above for why. `PairLines`' `home` slot
              is always `pivot` here; its `other` slot is whichever currency
              this row is about, so the inverse clause it renders ("1 {other}
              = {rate} {pivot}") is always the exact number the rate editor's
              "1 {other} = [___] {pivot}" field wants.
            */}
            {homeCurrency !== pivot && (
              <PairLines home={pivot} other={homeCurrency} rates={state.data.rates} />
            )}
            {extraCurrencies
              .filter((c) => c !== homeCurrency && c !== pivot)
              .map((c) => (
                <PairLines key={c} home={pivot} other={c} rates={state.data.rates} />
              ))}
          </ul>
          <p className="text-xs text-[var(--ink-2)]">
            Rate as of {formatAsOf(state.data.asOf)} — updated at most once a day, not live.
          </p>
        </>
      )}

      <Attribution />
    </div>
  );
}

function Attribution() {
  return (
    <p className="text-xs text-[var(--ink-2)]">
      Rates by{" "}
      <a
        href={ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-[var(--ink-0)]"
      >
        Exchange Rate API
      </a>
    </p>
  );
}

/**
 * The disclosure itself — mirrors `CurrencySettingsEditor`'s existing
 * collapsed/expanded pattern in MoneyTab.tsx rather than a new interaction
 * idiom, and keeps this a sub-view of Money (contract C1) instead of a route
 * or a fifth tab.
 */
export function Rates(props: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 min-h-[var(--tap-min)] text-xs font-medium text-[var(--accent-ink)] hover:underline"
      >
        {props.homeCurrency ? "View today's exchange rate" : "Set up live exchange rates"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-[var(--surf-1)] p-3">
      <RatesPanel {...props} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-3 min-h-[var(--tap-min)] text-xs text-[var(--ink-2)] hover:text-[var(--ink-0)]"
      >
        Hide
      </button>
    </div>
  );
}
