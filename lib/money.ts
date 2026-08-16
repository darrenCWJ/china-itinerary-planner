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
  /**
   * @deprecated Equal to grandTotal. Named for the era when the pivot was
   * always CNY; kept so existing readers keep compiling.
   */
  cny: number;
  /** Grand total in the pivot currency's minor units. */
  grandTotal: number;
  /** The currency the rates are expressed against. */
  pivot: string;
  /** Grand total expressed in the home currency, when its rate is known. */
  home: CurrencyAmount | null;
  /** Currencies that had no rate — shown unconverted, never silently dropped. */
  unconverted: CurrencyAmount[];
}

/**
 * Rates are pivot-currency units per 1 unit of foreign currency. Null when no
 * home currency is set.
 *
 * The pivot is a trailing parameter defaulting to CNY because rate semantics
 * are persisted: a trip saved before pivots existed holds CNY-relative rates,
 * and reading it with any other pivot would silently reprice the whole trip.
 * The default is the guarantee that never happens by accident.
 */
export function convertedTotals(
  totals: CurrencyAmount[],
  settings: CurrencySettings,
  pivot = "CNY"
): ConvertedTotals | null {
  if (settings.home === null) return null;
  let grandTotal = 0;
  const unconverted: CurrencyAmount[] = [];
  for (const t of totals) {
    const rate = t.currency === pivot ? 1 : settings.rates[t.currency];
    if (rate === undefined) {
      unconverted.push(t);
      continue;
    }
    grandTotal += Math.round(t.amount * rate);
  }
  const homeRate = settings.home === pivot ? 1 : settings.rates[settings.home];
  const home =
    homeRate === undefined
      ? null
      : { currency: settings.home, amount: Math.round(grandTotal / homeRate) };
  return { cny: grandTotal, grandTotal, pivot, home, unconverted };
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

/** Equal split with largest-remainder: the first (amount % parts) shares get +1. */
export function splitMinorUnits(amount: number, parts: number): number[] {
  const base = Math.floor(amount / parts);
  const extras = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => (i < extras ? base + 1 : base));
}

export interface MemberBalance {
  member: string;
  /** Positive = is owed money; negative = owes. Minor units. */
  net: number;
}

export interface CurrencyBalances {
  currency: string;
  balances: MemberBalance[];
}

/**
 * net = expenses paid − share owed + repayments sent − repayments received.
 * Members netting to zero are omitted. Unknown names (departed members,
 * typos in old data) are kept as-is — never crash, never drop an expense.
 */
export function balancesByCurrency(
  expenses: Expense[],
  settlements: Settlement[],
  members: string[]
): CurrencyBalances[] {
  const byCurrency = new Map<string, Map<string, number>>();
  const bump = (currency: string, member: string, delta: number) => {
    let m = byCurrency.get(currency);
    if (!m) {
      m = new Map();
      byCurrency.set(currency, m);
    }
    m.set(member, (m.get(member) ?? 0) + delta);
  };

  for (const e of expenses) {
    const participants = e.splitAmong.length > 0 ? e.splitAmong : members;
    if (participants.length === 0) continue;
    bump(e.currency, e.paidBy, e.amount);
    const shares = splitMinorUnits(e.amount, participants.length);
    participants.forEach((member, i) => bump(e.currency, member, -shares[i]));
  }
  for (const s of settlements) {
    bump(s.currency, s.from, s.amount);
    bump(s.currency, s.to, -s.amount);
  }

  return [...byCurrency.entries()]
    .map(([currency, nets]) => ({
      currency,
      balances: [...nets.entries()]
        .filter(([, net]) => net !== 0)
        .map(([member, net]) => ({ member, net }))
        .sort((a, b) => a.member.localeCompare(b.member)),
    }))
    .filter((c) => c.balances.length > 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** Greedy minimal transfers: biggest debtor pays biggest creditor first. */
export function settleUp(balances: MemberBalance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.net > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net || a.member.localeCompare(b.member));
  const debtors = balances
    .filter((b) => b.net < 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => a.net - b.net || a.member.localeCompare(b.member));

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci].net;
    const debt = -debtors[di].net;
    const amount = Math.min(credit, debt);
    transfers.push({ from: debtors[di].member, to: creditors[ci].member, amount });
    creditors[ci].net -= amount;
    debtors[di].net += amount;
    if (creditors[ci].net === 0) ci += 1;
    if (debtors[di].net === 0) di += 1;
  }
  return transfers;
}
