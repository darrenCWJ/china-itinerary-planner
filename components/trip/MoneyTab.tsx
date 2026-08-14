"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/briefing/charts/BarChart";
import {
  balancesByCurrency,
  convertedTotals,
  formatMinor,
  totalsByCurrency,
} from "@/lib/money";
import type { CurrencySettings, Expense, ExpenseCategory, Settlement } from "@/lib/tripShared";
import { BalancesCard, type SettlementDraft } from "./BalancesCard";
import { CATEGORIES, ExpenseForm, type ExpenseDraft } from "./ExpenseForm";

type Props = {
  expenses: Expense[];
  settlements: Settlement[];
  currencySettings: CurrencySettings;
  members: string[];
  myName: string;
  isMember: boolean;
  onAddExpense: (d: ExpenseDraft) => Promise<string | null>;
  onUpdateExpense: (id: string, d: ExpenseDraft) => Promise<string | null>;
  onDeleteExpense: (id: string) => Promise<string | null>;
  onAddSettlement: (d: SettlementDraft) => Promise<string | null>;
  onDeleteSettlement: (id: string) => Promise<string | null>;
  onSaveCurrency: (home: string | null, rates: Record<string, number>) => Promise<string | null>;
};

const categoryMeta = (id: ExpenseCategory) => CATEGORIES.find((c) => c.id === id)!;

export function MoneyTab({
  expenses,
  settlements,
  currencySettings,
  members,
  myName,
  isMember,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  onAddSettlement,
  onDeleteSettlement,
  onSaveCurrency,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const totals = useMemo(() => totalsByCurrency(expenses), [expenses]);
  const converted = useMemo(
    () => convertedTotals(totals, currencySettings),
    [totals, currencySettings]
  );
  const balances = useMemo(
    () => balancesByCurrency(expenses, settlements, members),
    [expenses, settlements, members]
  );

  // Expenses grouped by date, newest day first, insertion order within a day.
  const byDate = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const e of [...expenses].sort((a, b) => b.date.localeCompare(a.date))) {
      const list = groups.get(e.date) ?? [];
      list.push(e);
      groups.set(e.date, list);
    }
    return [...groups.entries()];
  }, [expenses]);

  const categorySlices = useMemo(() => {
    return totals.map(({ currency }) => ({
      currency,
      slices: CATEGORIES.map((c) => ({
        label: `${c.emoji} ${c.label}`,
        value: Math.round(
          expenses
            .filter((e) => e.currency === currency && e.category === c.id)
            .reduce((a, e) => a + e.amount, 0) / 100
        ),
      })).filter((s) => s.value > 0),
    })).filter((c) => c.slices.length > 0);
  }, [expenses, totals]);

  const removeExpense = async (id: string) => {
    setListError(null);
    const err = await onDeleteExpense(id);
    if (err) setListError(err);
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-sky bg-paper p-5">
        <h3 className="font-display text-lg font-semibold">Spend so far</h3>
        {totals.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            Nothing logged yet — add the first expense below.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {totals.map((t) => (
              <li key={t.currency} className="flex justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-soft">
                  {t.currency}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {converted && (
          <div className="mt-3 border-t border-sky pt-2 text-sm">
            <p className="flex justify-between">
              <span className="text-ink-soft">Total CNY</span>
              <span className="font-semibold tabular-nums">{formatMinor(converted.cny, "CNY")}</span>
            </p>
            {converted.home && converted.home.currency !== "CNY" && (
              <p className="flex justify-between">
                <span className="text-ink-soft">Total {converted.home.currency}</span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(converted.home.amount, converted.home.currency)}
                </span>
              </p>
            )}
            {converted.unconverted.length > 0 && (
              <p className="mt-1 text-xs text-ink-soft">
                No rate set for{" "}
                {converted.unconverted.map((u) => u.currency).join(", ")} — shown in the sums
                above but left out of the converted totals.
              </p>
            )}
          </div>
        )}
        {isMember && (
          <CurrencySettingsEditor
            currencySettings={currencySettings}
            usedCurrencies={totals.map((t) => t.currency)}
            onSave={onSaveCurrency}
          />
        )}
      </div>

      <BalancesCard
        currencies={balances}
        settlements={settlements}
        isMember={isMember}
        onAddSettlement={onAddSettlement}
        onDeleteSettlement={onDeleteSettlement}
      />

      {categorySlices.map((c) => (
        <BarChart
          key={c.currency}
          title={`By category · ${c.currency}`}
          slices={c.slices}
          unit={c.currency}
        />
      ))}

      {isMember && !adding && !editingId && (
        <button type="button" onClick={() => setAdding(true)}
          className="rounded-lg border border-dashed border-rail/50 px-4 py-2 text-sm font-semibold text-rail transition-colors hover:bg-sky">
          + Add expense
        </button>
      )}
      {adding && (
        <ExpenseForm
          members={members}
          myName={myName}
          submitLabel="Add expense"
          onSubmit={onAddExpense}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="space-y-3">
        {byDate.map(([date, list]) => (
          <div key={date}>
            <p className="font-mono text-xs uppercase tracking-widest text-ink-soft">{date}</p>
            <ul className="mt-1.5 space-y-1.5">
              {list.map((e) =>
                editingId === e.id ? (
                  <li key={e.id}>
                    <ExpenseForm
                      members={members}
                      myName={myName}
                      initial={e}
                      submitLabel="Save changes"
                      onSubmit={(d) => onUpdateExpense(e.id, d)}
                      onCancel={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <li key={e.id}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-sky bg-paper px-4 py-2.5 text-sm">
                    <span aria-hidden>{categoryMeta(e.category).emoji}</span>
                    <span className="font-medium">{e.title}</span>
                    <span className="text-xs text-ink-soft">
                      {e.paidBy} paid
                      {e.splitAmong.length > 0 && e.splitAmong.length < members.length
                        ? ` · split ${e.splitAmong.length}-way`
                        : " · split all"}
                    </span>
                    <span className="ml-auto font-semibold tabular-nums">
                      {formatMinor(e.amount, e.currency)}
                    </span>
                    {isMember && (
                      <span className="flex gap-2">
                        <button type="button" onClick={() => setEditingId(e.id)}
                          className="text-xs text-ink-soft hover:text-ink">
                          Edit
                        </button>
                        <button type="button" onClick={() => void removeExpense(e.id)}
                          className="text-xs text-ink-soft hover:text-seal">
                          Delete
                        </button>
                      </span>
                    )}
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
        {listError && <p className="text-xs text-seal">{listError}</p>}
      </div>
    </div>
  );
}

function CurrencySettingsEditor({
  currencySettings,
  usedCurrencies,
  onSave,
}: {
  currencySettings: CurrencySettings;
  usedCurrencies: string[];
  onSave: (home: string | null, rates: Record<string, number>) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(currencySettings.home ?? "");
  const [rateInputs, setRateInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(currencySettings.rates).map(([c, r]) => [c, String(r)])
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Every currency worth rating: seen in expenses or already rated, CNY excluded.
  const rateCurrencies = [
    ...new Set([...usedCurrencies, ...Object.keys(currencySettings.rates), home].filter(Boolean)),
  ]
    .filter((c) => c !== "CNY")
    .sort();

  const save = async () => {
    const rates: Record<string, number> = {};
    for (const [c, v] of Object.entries(rateInputs)) {
      if (!v.trim()) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return setError(`Rate for ${c} must be a positive number.`);
      rates[c] = n;
    }
    const homeCode = home.trim().toUpperCase();
    if (homeCode && !/^[A-Z]{3}$/.test(homeCode)) {
      return setError("Home currency must be a 3-letter code.");
    }
    setSaving(true);
    setError(null);
    const err = await onSave(homeCode || null, rates);
    setSaving(false);
    if (err) return setError(err);
    setOpen(false);
  };

  const startOpen = () => {
    setHome(currencySettings.home ?? "");
    setRateInputs(Object.fromEntries(
      Object.entries(currencySettings.rates).map(([c, r]) => [c, String(r)])
    ));
    setError(null);
    setOpen(true);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => startOpen()}
        className="mt-3 text-xs font-medium text-rail hover:underline">
        {currencySettings.home ? "Edit conversion rates" : "Set up converted totals"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-mist p-3 text-sm">
      <label className="text-xs font-medium text-ink-soft">
        Home currency (blank = no conversion)
        <input type="text" value={home} maxLength={3} placeholder="SGD"
          className="mt-1 block w-24 rounded-lg border border-sky bg-paper px-2 py-1.5 font-mono text-sm uppercase text-ink"
          onChange={(e) => setHome(e.target.value.toUpperCase())} />
      </label>
      {rateCurrencies.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {rateCurrencies.map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-ink-soft">
              <span className="w-16 font-mono uppercase">1 {c} =</span>
              <input type="text" inputMode="decimal" value={rateInputs[c] ?? ""}
                placeholder="5.20"
                className="w-24 rounded-lg border border-sky bg-paper px-2 py-1 text-sm text-ink"
                onChange={(e) =>
                  setRateInputs((prev) => ({ ...prev, [c]: e.target.value }))
                } />
              <span>CNY</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-rail px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save rates"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="text-xs text-ink-soft hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-xs text-seal">{error}</span>}
      </div>
    </div>
  );
}
