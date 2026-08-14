"use client";

import { useState } from "react";
import { majorToMinor } from "@/lib/money";
import { todayIso } from "@/lib/tracker";
import type { Expense, ExpenseCategory } from "@/lib/tripShared";

export interface ExpenseDraft {
  date: string;
  title: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  paidBy: string;
  splitAmong: string[];
  notes: string | null;
}

export const CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: "food", label: "Food", emoji: "🍜" },
  { id: "transport", label: "Transport", emoji: "🚄" },
  { id: "lodging", label: "Lodging", emoji: "🏨" },
  { id: "tickets", label: "Tickets", emoji: "🎫" },
  { id: "shopping", label: "Shopping", emoji: "🛍️" },
  { id: "other", label: "Other", emoji: "💳" },
];

const QUICK_CURRENCIES = ["CNY", "SGD"];

type Props = {
  members: string[];
  myName: string;
  initial?: Expense;
  submitLabel: string;
  onSubmit: (draft: ExpenseDraft) => Promise<string | null>;
  onCancel?: () => void;
};

export function ExpenseForm({ members, myName, initial, submitLabel, onSubmit, onCancel }: Props) {
  const initialQuick = !initial || QUICK_CURRENCIES.includes(initial.currency);
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? "food");
  const [amount, setAmount] = useState(initial ? (initial.amount / 100).toFixed(2) : "");
  const [currencyPick, setCurrencyPick] = useState(
    initialQuick ? (initial?.currency ?? "CNY") : "other"
  );
  const [customCurrency, setCustomCurrency] = useState(initialQuick ? "" : initial!.currency);
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? myName);
  const [splitAmong, setSplitAmong] = useState<string[]>(
    initial && initial.splitAmong.length > 0 ? initial.splitAmong : members
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleSplit = (name: string) => {
    setSplitAmong((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const submit = async () => {
    const minor = majorToMinor(amount);
    const currency = (currencyPick === "other" ? customCurrency : currencyPick)
      .trim()
      .toUpperCase();
    if (!title.trim()) return setError("Give the expense a name.");
    if (minor === null) return setError("Enter an amount like 128 or 128.50.");
    if (!/^[A-Z]{3}$/.test(currency)) return setError("Currency must be a 3-letter code.");
    if (splitAmong.length === 0) return setError("Pick at least one person to split among.");
    setSaving(true);
    setError(null);
    const err = await onSubmit({
      date,
      title: title.trim(),
      category,
      amount: minor,
      currency,
      paidBy,
      splitAmong,
      notes: notes.trim() ? notes.trim() : null,
    });
    setSaving(false);
    if (err) return setError(err);
    if (!initial) {
      setTitle("");
      setAmount("");
      setNotes("");
    }
    onCancel?.();
  };

  const inputCls =
    "mt-1 block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail";

  return (
    <div className="rounded-xl border border-sky bg-paper p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-ink-soft">
          What was it?
          <input type="text" value={title} maxLength={80} className={inputCls}
            onChange={(e) => setTitle(e.target.value)} placeholder="Hotpot dinner" />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Date
          <input type="date" value={date} className={inputCls}
            onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Amount
          <div className="mt-1 flex gap-2">
            <input type="text" inputMode="decimal" value={amount} placeholder="128.50"
              className="block w-full rounded-lg border border-sky bg-mist px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-rail"
              onChange={(e) => setAmount(e.target.value)} />
            <select value={currencyPick} aria-label="Currency"
              className="rounded-lg border border-sky bg-paper px-2 py-1.5 text-sm text-ink"
              onChange={(e) => setCurrencyPick(e.target.value)}>
              {QUICK_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value="other">Other…</option>
            </select>
            {currencyPick === "other" && (
              <input type="text" value={customCurrency} maxLength={3} placeholder="USD"
                aria-label="Custom currency code"
                className="w-20 rounded-lg border border-sky bg-mist px-2 py-2 font-mono text-sm uppercase text-ink"
                onChange={(e) => setCustomCurrency(e.target.value.toUpperCase())} />
            )}
          </div>
        </label>
        <label className="text-xs font-medium text-ink-soft">
          Paid by
          <select value={paidBy} className={inputCls} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-ink-soft">Category</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                category === c.id ? "bg-rail text-white" : "bg-mist text-ink-soft hover:bg-sky"
              }`}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-ink-soft">Split among</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button key={m} type="button" onClick={() => toggleSplit(m)}
              aria-pressed={splitAmong.includes(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                splitAmong.includes(m) ? "bg-rail text-white" : "bg-mist text-ink-soft hover:bg-sky"
              }`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Notes (optional)
        <input type="text" value={notes} maxLength={300} className={inputCls}
          onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => void submit()} disabled={saving}
          className="rounded-lg bg-rail px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rail-deep disabled:opacity-50">
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="text-sm text-ink-soft hover:text-ink">
            Cancel
          </button>
        )}
        {error && <span className="text-xs text-seal">{error}</span>}
      </div>
    </div>
  );
}
