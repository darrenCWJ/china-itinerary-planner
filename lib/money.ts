import type { CurrencySettings, Expense, Settlement } from "./tripShared";

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

/** Plain per-currency sums in minor units, sorted by currency code. */
export function totalsByCurrency(expenses: Expense[]): CurrencyAmount[] {
  const sums = new Map<string, number>();
  for (const e of expenses) {
    sums.set(e.currency, (sums.get(e.currency) ?? 0) + e.amount);
  }
  return [...sums.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function expensesOnDate(expenses: Expense[], isoDate: string): Expense[] {
  return expenses.filter((e) => e.date === isoDate);
}

export interface ConvertedTotals {
  /** Grand total expressed in CNY minor units (fen). */
  cny: number;
  /** Grand total expressed in the home currency, when its rate is known. */
  home: CurrencyAmount | null;
  /** Currencies that had no rate — shown unconverted, never silently dropped. */
  unconverted: CurrencyAmount[];
}

/** Rates are CNY per 1 unit of foreign currency. Null when no home currency set. */
export function convertedTotals(
  totals: CurrencyAmount[],
  settings: CurrencySettings
): ConvertedTotals | null {
  if (settings.home === null) return null;
  let cny = 0;
  const unconverted: CurrencyAmount[] = [];
  for (const t of totals) {
    const rate = t.currency === "CNY" ? 1 : settings.rates[t.currency];
    if (rate === undefined) {
      unconverted.push(t);
      continue;
    }
    cny += Math.round(t.amount * rate);
  }
  const homeRate = settings.home === "CNY" ? 1 : settings.rates[settings.home];
  const home =
    homeRate === undefined
      ? null
      : { currency: settings.home, amount: Math.round(cny / homeRate) };
  return { cny, home, unconverted };
}

const SYMBOLS: Record<string, string> = {
  CNY: "¥",
  SGD: "S$",
  USD: "US$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
  TWD: "NT$",
  MYR: "RM",
};

/** Minor units → display string, e.g. 124050 CNY → "¥1,240.50". */
export function formatMinor(amount: number, currency: string): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const major = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100).toString().padStart(2, "0");
  const symbol = SYMBOLS[currency];
  return symbol !== undefined
    ? `${sign}${symbol}${major}.${cents}`
    : `${sign}${currency} ${major}.${cents}`;
}

/** "124.5" → 12450 minor units. Null when not a plain positive decimal. */
export function majorToMinor(input: string): number | null {
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const cents = (m[2] ?? "").padEnd(2, "0");
  const value = Number(m[1]) * 100 + Number(cents);
  return value >= 1 && value <= 100_000_000 ? value : null;
}
