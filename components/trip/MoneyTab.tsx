"use client";

import { useMemo, useState } from "react";
import { BarChart } from "@/components/briefing/charts/BarChart";
import {
  balancesByCurrency,
  convertedTotals,
  formatMinor,
  minorUnitDigits,
  totalsByCurrency,
} from "@/lib/money";
import { currencyPivot } from "@/lib/tripShared";
import type { CurrencySettings, Expense, ExpenseCategory, Settlement } from "@/lib/tripShared";
import { BalancesCard, type SettlementDraft } from "./BalancesCard";
import { CATEGORIES, ExpenseForm, type ExpenseDraft } from "./ExpenseForm";
import { Rates } from "./Rates";

type Props = {
  expenses: Expense[];
  settlements: Settlement[];
  currencySettings: CurrencySettings;
  /** The destination currency, or null when the country has no researched
   * profile yet — see `lib/tripShared.ts`'s `tripCurrency`. */
  tripCurrency: string | null;
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
  tripCurrency,
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

  // Computed once so the totals row and the rates editor can never disagree
  // about which currency the trip's rates are actually expressed against.
  const pivot = currencyPivot(currencySettings);
  const totals = useMemo(() => totalsByCurrency(expenses), [expenses]);
  // Every currency this trip actually has expenses in, computed once for the
  // whole tab so every amount rendered against it -- the totals list and the
  // per-expense rows below -- resolves JPY/CNY's shared ¥ the same way,
  // rather than each row consulting a different (or empty) set. Per
  // `currencySymbol`'s usage contract: the displayed set is a property of
  // the whole screen, not of one row in isolation.
  const displayedCurrencies = useMemo(() => totals.map((t) => t.currency), [totals]);
  const converted = useMemo(
    () => convertedTotals(totals, currencySettings, pivot),
    [totals, currencySettings, pivot]
  );
  const balances = useMemo(
    () => balancesByCurrency(expenses, settlements, members),
    [expenses, settlements, members]
  );

  // J-C5: currencies the trip actually has expenses in, beyond the
  // trip/home headline pair — never a currency nobody spent in, and never
  // the pair itself repeated as an "extra".
  const extraCurrencies = useMemo(
    () =>
      totals
        .map((t) => t.currency)
        .filter((c) => c !== tripCurrency && c !== currencySettings.home)
        .sort(),
    [totals, tripCurrency, currencySettings.home]
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
            .reduce((a, e) => a + e.amount, 0) / 10 ** minorUnitDigits(currency)
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
      <div className="rounded-xl border border-[var(--line-1)] bg-[var(--paper)] p-5">
        <h3 className="font-display text-lg font-semibold">Spend so far</h3>
        {totals.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-2)]">
            Nothing logged yet — add the first expense below.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {totals.map((t) => (
              <li key={t.currency} className="flex justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-[var(--ink-2)]">
                  {t.currency}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(t.amount, t.currency, displayedCurrencies)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {converted && (
          <div className="mt-3 border-t border-[var(--line-1)] pt-2 text-sm">
            <p className="flex justify-between">
              <span className="text-[var(--ink-2)]">Total {converted.pivot}</span>
              <span className="font-semibold tabular-nums">
                {formatMinor(converted.grandTotal, converted.pivot)}
              </span>
            </p>
            {converted.home && converted.home.currency !== converted.pivot && (
              <p className="flex justify-between">
                <span className="text-[var(--ink-2)]">Total {converted.home.currency}</span>
                <span className="font-semibold tabular-nums">
                  {formatMinor(converted.home.amount, converted.home.currency)}
                </span>
              </p>
            )}
            {converted.unconverted.length > 0 && (
              <p className="mt-1 text-xs text-[var(--ink-2)]">
                No rate set for{" "}
                {converted.unconverted.map((u) => u.currency).join(", ")} — shown in the sums
                above but left out of the converted totals.
              </p>
            )}
          </div>
        )}
        {/*
          Anchored so Rates' empty-state link (below) can jump straight here
          when a member has no home currency set yet — a plain in-page anchor,
          not a route, so it stays inside Money (C1).
        */}
        <div id="currency-settings">
          {isMember && (
            <CurrencySettingsEditor
              currencySettings={currencySettings}
              usedCurrencies={totals.map((t) => t.currency)}
              pivot={pivot}
              onSave={onSaveCurrency}
            />
          )}
        </div>
        {/*
          The live-rates sub-view (Task 7): a disclosure inside Money, not a
          fifth tab (C1) and not a route. Read-only and display-only (J-C2) —
          it never feeds convertedTotals or writes to the trip.
        */}
        <Rates
          tripCurrency={tripCurrency}
          homeCurrency={currencySettings.home}
          pivot={pivot}
          extraCurrencies={extraCurrencies}
          isMember={isMember}
        />
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
          className="rounded-lg border border-dashed border-[var(--accent-ink)]/50 px-4 py-2 text-sm font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--line-1)]">
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
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--ink-2)]">{date}</p>
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
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line-1)] bg-[var(--paper)] px-4 py-2.5 text-sm">
                    <span aria-hidden>{categoryMeta(e.category).emoji}</span>
                    <span className="font-medium">{e.title}</span>
                    <span className="text-xs text-[var(--ink-2)]">
                      {e.paidBy} paid
                      {e.splitAmong.length > 0 && e.splitAmong.length < members.length
                        ? ` · split ${e.splitAmong.length}-way`
                        : " · split all"}
                    </span>
                    <span className="ml-auto font-semibold tabular-nums">
                      {formatMinor(e.amount, e.currency, displayedCurrencies)}
                    </span>
                    {isMember && (
                      <span className="flex gap-2">
                        <button type="button" onClick={() => setEditingId(e.id)}
                          className="text-xs text-[var(--ink-2)] hover:text-[var(--ink-0)]">
                          Edit
                        </button>
                        <button type="button" onClick={() => void removeExpense(e.id)}
                          className="text-xs text-[var(--ink-2)] hover:text-[var(--seal)]">
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
        {listError && <p className="text-xs text-[var(--seal)]">{listError}</p>}
      </div>
    </div>
  );
}

function CurrencySettingsEditor({
  currencySettings,
  usedCurrencies,
  pivot,
  onSave,
}: {
  currencySettings: CurrencySettings;
  usedCurrencies: string[];
  /** The currency the rates are expressed against — never needs a rate row against itself. */
  pivot: string;
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

  // Every currency worth rating: seen in expenses or already rated, the pivot excluded.
  const rateCurrencies = [
    ...new Set([...usedCurrencies, ...Object.keys(currencySettings.rates), home].filter(Boolean)),
  ]
    .filter((c) => c !== pivot)
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
        className="mt-3 text-xs font-medium text-[var(--accent-ink)] hover:underline">
        {currencySettings.home ? "Edit conversion rates" : "Set up converted totals"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg bg-[var(--surf-1)] p-3 text-sm">
      <label className="text-xs font-medium text-[var(--ink-2)]">
        Home currency (blank = no conversion)
        <input type="text" value={home} maxLength={3} placeholder="SGD"
          className="mt-1 block w-24 rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-2 py-1.5 font-mono text-sm uppercase text-[var(--ink-0)]"
          onChange={(e) => setHome(e.target.value.toUpperCase())} />
      </label>
      {rateCurrencies.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {rateCurrencies.map((c) => (
            <label key={c} className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
              <span className="w-16 font-mono uppercase">1 {c} =</span>
              <input type="text" inputMode="decimal" value={rateInputs[c] ?? ""}
                placeholder="5.20"
                className="w-24 rounded-lg border border-[var(--line-1)] bg-[var(--paper)] px-2 py-1 text-sm text-[var(--ink-0)]"
                onChange={(e) =>
                  setRateInputs((prev) => ({ ...prev, [c]: e.target.value }))
                } />
              <span>{pivot}</span>
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-[var(--accent-ink)] px-3 py-1.5 text-xs font-semibold text-[var(--paper)] disabled:opacity-50">
          {saving ? "Saving…" : "Save rates"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="text-xs text-[var(--ink-2)] hover:text-[var(--ink-0)]">
          Cancel
        </button>
        {error && <span className="text-xs text-[var(--seal)]">{error}</span>}
      </div>
    </div>
  );
}
