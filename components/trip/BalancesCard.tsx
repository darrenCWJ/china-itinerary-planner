"use client";

import { useState } from "react";
import {
  formatMinor,
  majorToMinor,
  settleUp,
  type CurrencyBalances,
} from "@/lib/money";
import { todayIso } from "@/lib/tracker";
import type { Settlement } from "@/lib/tripShared";

export interface SettlementDraft {
  date: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
}

type Props = {
  currencies: CurrencyBalances[];
  settlements: Settlement[];
  isMember: boolean;
  onAddSettlement: (draft: SettlementDraft) => Promise<string | null>;
  onDeleteSettlement: (id: string) => Promise<string | null>;
};

export function BalancesCard({
  currencies,
  settlements,
  isMember,
  onAddSettlement,
  onDeleteSettlement,
}: Props) {
  // Key of the transfer currently being confirmed: "CNY:Bob:Ada".
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmAmount, setConfirmAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startConfirm = (key: string, amountMinor: number) => {
    setConfirming(key);
    setConfirmAmount((amountMinor / 100).toFixed(2));
    setError(null);
  };

  const recordRepayment = async (from: string, to: string, currency: string) => {
    const minor = majorToMinor(confirmAmount);
    if (minor === null) return setError("Enter an amount like 62.25.");
    setBusy(true);
    const err = await onAddSettlement({ date: todayIso(), from, to, amount: minor, currency });
    setBusy(false);
    if (err) return setError(err);
    setConfirming(null);
  };

  const removeSettlement = async (id: string) => {
    setError(null);
    setBusy(true);
    const err = await onDeleteSettlement(id);
    setBusy(false);
    if (err) setError(err);
  };

  if (currencies.length === 0 && settlements.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5 text-sm text-[var(--ink-2)]">
        All square — no outstanding balances.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5">
      <h3 className="font-display text-lg font-semibold">Who owes whom</h3>

      {currencies.length === 0 && (
        <p className="mt-2 text-sm text-[var(--ink-2)]">All square — no outstanding balances.</p>
      )}

      {currencies.map(({ currency, balances }) => (
        <div key={currency} className="mt-3">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--ink-2)]">{currency}</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {balances.map((b) => (
              <li key={b.member} className="flex justify-between">
                <span>{b.member}</span>
                {/*
                 * Two spans of identical role and weight where colour is the
                 * encoding, so both halves must be hue-fixed. `--accent-ink` is
                 * the country-identity colour (spec §4.2) and is hue-variable by
                 * design — on China it lands one degree from the seal vermilion
                 * the negative half uses, and on any country it means "China" or
                 * "Japan", never "settled". Neutral-vs-red is the standard
                 * accounting pair and neither side moves with the country.
                 */}
                <span className={b.net > 0 ? "font-medium text-[var(--ink-0)]" : "font-medium text-[var(--seal)]"}>
                  {b.net > 0 ? "is owed " : "owes "}
                  {formatMinor(Math.abs(b.net), currency)}
                </span>
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-1.5">
            {settleUp(balances).map((t) => {
              const key = `${currency}:${t.from}:${t.to}`;
              return (
                <li key={key}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surf-1)] px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{t.from}</span> →{" "}
                    <span className="font-medium">{t.to}</span>:{" "}
                    {formatMinor(t.amount, currency)}
                  </span>
                  {isMember && confirming !== key && (
                    <button type="button" onClick={() => startConfirm(key, t.amount)}
                      className="ml-auto rounded-lg bg-[var(--accent-ink)] px-3 py-1 text-xs font-semibold text-[var(--paper)] hover:bg-[color-mix(in_oklab,var(--accent-ink)_85%,var(--ink-0))]">
                      Mark repaid
                    </button>
                  )}
                  {isMember && confirming === key && (
                    <span className="ml-auto flex items-center gap-2">
                      <input type="text" inputMode="decimal" value={confirmAmount}
                        aria-label="Repaid amount"
                        className="w-24 rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-2 py-1 text-xs text-[var(--ink-0)]"
                        onChange={(e) => setConfirmAmount(e.target.value)} />
                      <button type="button" disabled={busy}
                        onClick={() => void recordRepayment(t.from, t.to, currency)}
                        className="rounded-lg bg-[var(--accent-ink)] px-3 py-1 text-xs font-semibold text-[var(--paper)] disabled:opacity-50">
                        {busy ? "…" : "Confirm"}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}
                        className="text-xs text-[var(--ink-2)] hover:text-[var(--ink-0)]">
                        Cancel
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {error && <p className="mt-2 text-xs text-[var(--seal)]">{error}</p>}

      {settlements.length > 0 && (
        <div className="mt-4 border-t border-[var(--line-1)] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-2)]">Repayments</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="text-[var(--ink-2)]">{s.date}</span>
                <span>
                  {s.from} → {s.to}: {formatMinor(s.amount, s.currency)}
                </span>
                {isMember && (
                  <button type="button" onClick={() => void removeSettlement(s.id)}
                    disabled={busy}
                    aria-label={`Delete repayment ${s.from} to ${s.to}`}
                    className="ml-auto text-xs text-[var(--ink-2)] hover:text-[var(--seal)] disabled:opacity-50">
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
