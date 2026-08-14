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
      <div className="rounded-xl border border-sky bg-paper p-5 text-sm text-ink-soft">
        All square — no outstanding balances.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky bg-paper p-5">
      <h3 className="font-display text-lg font-semibold">Who owes whom</h3>

      {currencies.length === 0 && (
        <p className="mt-2 text-sm text-ink-soft">All square — no outstanding balances.</p>
      )}

      {currencies.map(({ currency, balances }) => (
        <div key={currency} className="mt-3">
          <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">{currency}</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {balances.map((b) => (
              <li key={b.member} className="flex justify-between">
                <span>{b.member}</span>
                <span className={b.net > 0 ? "font-medium text-rail" : "font-medium text-seal"}>
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
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-mist px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{t.from}</span> →{" "}
                    <span className="font-medium">{t.to}</span>:{" "}
                    {formatMinor(t.amount, currency)}
                  </span>
                  {isMember && confirming !== key && (
                    <button type="button" onClick={() => startConfirm(key, t.amount)}
                      className="ml-auto rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white hover:bg-rail-deep">
                      Mark repaid
                    </button>
                  )}
                  {isMember && confirming === key && (
                    <span className="ml-auto flex items-center gap-2">
                      <input type="text" inputMode="decimal" value={confirmAmount}
                        aria-label="Repaid amount"
                        className="w-24 rounded-lg border border-sky bg-paper px-2 py-1 text-xs text-ink"
                        onChange={(e) => setConfirmAmount(e.target.value)} />
                      <button type="button" disabled={busy}
                        onClick={() => void recordRepayment(t.from, t.to, currency)}
                        className="rounded-lg bg-rail px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
                        {busy ? "…" : "Confirm"}
                      </button>
                      <button type="button" onClick={() => setConfirming(null)}
                        className="text-xs text-ink-soft hover:text-ink">
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

      {error && <p className="mt-2 text-xs text-seal">{error}</p>}

      {settlements.length > 0 && (
        <div className="mt-4 border-t border-sky pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Repayments</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="text-ink-soft">{s.date}</span>
                <span>
                  {s.from} → {s.to}: {formatMinor(s.amount, s.currency)}
                </span>
                {isMember && (
                  <button type="button" onClick={() => void removeSettlement(s.id)}
                    disabled={busy}
                    aria-label={`Delete repayment ${s.from} to ${s.to}`}
                    className="ml-auto text-xs text-ink-soft hover:text-seal disabled:opacity-50">
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
