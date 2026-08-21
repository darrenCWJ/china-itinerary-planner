import type { CurrencySettings, Expense, Settlement } from "./tripShared";

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

/**
 * Currencies whose minor unit is not one hundredth of the major unit, keyed by
 * ISO 4217 exponent. Anything absent has two digits — the ISO majority — so an
 * unresearched country is still priceable and an unknown code never throws.
 *
 * IDR is the single deliberate departure from ISO 4217, which still records two
 * digits for it: the sen stopped circulating decades ago and rupiah are quoted
 * whole. Every other entry is the ISO exponent for a circulating currency.
 */
export const MINOR_UNIT_DIGITS: Record<string, number> = {
  // No minor unit at all: the smallest coin is the major unit.
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, IDR: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // Thousandths: the Gulf and North African dinars.
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

const DEFAULT_MINOR_UNIT_DIGITS = 2;

/**
 * How many digits separate a currency's minor unit from its major unit: 0 for
 * yen, 2 for yuan, 3 for dinars. The one authority on the question — every
 * other function here asks this rather than assuming a factor of 100.
 */
export function minorUnitDigits(currency: string): number {
  // The `??` looks unreachable to the compiler: tsconfig.json does not set
  // `noUncheckedIndexedAccess`, so TS types this index as `number`, not
  // `number | undefined`. It is very much reachable at runtime — most codes
  // are absent from the table — so do not "simplify" this away. (Turning on
  // the flag would fix the type but is a tree-wide change, out of scope here.)
  return MINOR_UNIT_DIGITS[currency] ?? DEFAULT_MINOR_UNIT_DIGITS;
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
 * Move a value between two minor-unit exponents.
 *
 * Amounts here are in minor units but a rate is a major-unit ratio, so every
 * conversion has to normalise through major units:
 *
 *     amount ÷ 10^exp(from) × rate × 10^exp(to)
 *
 * While every currency in the app shared an exponent of 2 those two factors
 * cancelled and a bare `amount × rate` was right by accident. It stops being
 * right the moment a zero-decimal currency is in play: ¥1,000 of JPY at
 * 0.0424 CNY per JPY would otherwise book 42 fen instead of 4,240.
 */
function rescaleMinorUnits(value: number, fromDigits: number, toDigits: number): number {
  // Identical exponents return the value untouched rather than multiplying by
  // a computed 1 — that is every trip in existence today, and it guarantees
  // their totals cannot shift by so much as a floating-point ulp. Scaling
  // down divides rather than multiplying by 10^-n, so the result is rounded
  // once instead of twice.
  if (fromDigits === toDigits) return value;
  return toDigits > fromDigits
    ? value * 10 ** (toDigits - fromDigits)
    : value / 10 ** (fromDigits - toDigits);
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
  const pivotDigits = minorUnitDigits(pivot);
  let grandTotal = 0;
  const unconverted: CurrencyAmount[] = [];
  for (const t of totals) {
    const rate = t.currency === pivot ? 1 : settings.rates[t.currency];
    if (rate === undefined) {
      unconverted.push(t);
      continue;
    }
    grandTotal += Math.round(
      rescaleMinorUnits(t.amount * rate, minorUnitDigits(t.currency), pivotDigits)
    );
  }
  const homeRate = settings.home === pivot ? 1 : settings.rates[settings.home];
  const home =
    homeRate === undefined
      ? null
      : {
          currency: settings.home,
          amount: Math.round(
            rescaleMinorUnits(
              grandTotal / homeRate,
              pivotDigits,
              minorUnitDigits(settings.home)
            )
          ),
        };
  return { grandTotal, pivot, home, unconverted };
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

/**
 * Minor units → display string: 124050 CNY → "¥1,240.50", 1000 JPY →
 * "JPY 1,000", 1234567 KWD → "KWD 1,234.567". How many decimals to show is
 * the currency's business, not a fixed factor of 100.
 *
 * `displayedCurrencies` is optional and defaults to `undefined`, in which
 * case symbol lookup goes through the flat, single-currency `SYMBOLS` table
 * exactly as it always has -- so every existing two-argument call keeps its
 * byte-identical output, including `formatMinor(1000, "JPY")` still
 * returning the "JPY 1,000" code fallback. Pass the set of every currency
 * appearing alongside this one on the same screen to route through
 * `currencySymbol`'s context-aware lookup instead -- that is what lets a
 * lone JPY render a plain ¥ while JPY sitting next to CNY disambiguates to
 * JP¥/CN¥. Compute that set once per screen, not once per row (see
 * `currencySymbol`'s own docs), and this stays the single authority on
 * amount formatting -- sign, grouping, and fraction padding are decided
 * here regardless of which symbol path is taken.
 */
export function formatMinor(
  amount: number,
  currency: string,
  displayedCurrencies?: Iterable<string>
): string {
  const digits = minorUnitDigits(currency);
  const unit = 10 ** digits;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const major = Math.floor(abs / unit)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // A currency with no minor unit has nothing to put after a point, so it
  // gets no point either.
  const fraction =
    digits === 0 ? "" : `.${(abs % unit).toString().padStart(digits, "0")}`;
  const symbol = displayedCurrencies
    ? currencySymbol(currency, displayedCurrencies)
    : SYMBOLS[currency];
  return symbol !== undefined
    ? `${sign}${symbol}${major}${fraction}`
    : `${sign}${currency} ${major}${fraction}`;
}

/**
 * Symbols resolvable only through `currencySymbol`'s context-aware lookup,
 * never through `formatMinor`'s single-currency one. JPY's ¥ is genuinely
 * ambiguous with CNY's — the two can only be told apart once you know what
 * else is on screen — so JPY is deliberately absent from the flat `SYMBOLS`
 * map `formatMinor` reads: a single-currency call has no "what else is on
 * screen" to consult, and `formatMinor(1000, "JPY")` must keep returning the
 * "JPY 1,000" fallback it always has (asserted above). This table is where
 * JPY's plain ¥ lives instead, gated behind the context that makes it safe.
 */
export const CONTEXTUAL_SYMBOLS: Record<string, string> = { ...SYMBOLS, JPY: "¥" };

/**
 * Currencies whose plain symbol collides with another currency in
 * `CONTEXTUAL_SYMBOLS`, mapped to the country-prefixed form to use once a
 * collision is actually on screen. Every other symbol in the table (S$,
 * US$, HK$, NT$, …) was already disambiguated when it was chosen, so only
 * the bare ¥ needs this.
 */
export const SYMBOL_DISAMBIGUATION: Record<string, string> = {
  CNY: "CN¥",
  JPY: "JP¥",
};

/**
 * The display symbol for `currency`, given every currency appearing
 * alongside it on the same screen (`displayedCurrencies`) — symbol choice is
 * a property of that whole set, not of one currency in isolation, because
 * whether ¥ is ambiguous depends on who else is in the room.
 *
 * Returns `undefined` for a currency with no known symbol, exactly like
 * `formatMinor`'s internal lookup, so a caller falls back the same way
 * (`` `${currency} ${amount}` ``) rather than this function inventing its
 * own fallback string.
 *
 * Callers rendering N currencies side by side (e.g. a per-currency totals
 * list) should compute the displayed set once — `totals.map(t =>
 * t.currency)` or similar — and pass that same set into every call for that
 * screen, not resolve one currency at a time against an empty or partial
 * set. Resolving row-by-row against whatever has been seen so far would let
 * a CNY row rendered before a JPY row appears keep the ambiguous plain ¥
 * instead of being revisited once JPY shows up.
 */
export function currencySymbol(
  currency: string,
  displayedCurrencies: Iterable<string>
): string | undefined {
  const symbol = CONTEXTUAL_SYMBOLS[currency];
  if (symbol === undefined) return undefined;
  const disambiguated = SYMBOL_DISAMBIGUATION[currency];
  if (disambiguated === undefined) return symbol;
  for (const other of displayedCurrencies) {
    if (other !== currency && CONTEXTUAL_SYMBOLS[other] === symbol) {
      return disambiguated;
    }
  }
  return symbol;
}

/**
 * The largest single amount anyone can enter, in major units. The bound has
 * always been 100_000_000 minor units, which for a two-decimal currency is
 * exactly this; stating it in major units keeps the limit meaning the same
 * thing to a user whatever their currency's exponent.
 *
 * Not quite true for a three-decimal currency (BHD, IQD, JOD, KWD, LYD, OMR,
 * TND): this constant lets `majorToMinor` accept up to 1_000_000_000 minor
 * units for those, but `lib/server/schemas.ts`'s `MinorAmountSchema` caps
 * every stored amount at 100_000_000 minor units regardless of currency — so
 * the ceiling a three-decimal-currency entry actually clears end-to-end is
 * 100,000 major units, ten times lower than this constant on its own would
 * suggest. Untouched here (existing disagreement, not this pass's scope).
 */
const MAX_MAJOR_UNITS = 1_000_000;

/**
 * "124.5" CNY → 12450 minor units; "1000" JPY → 1000. Null when the input is
 * not a plain positive decimal, when it carries more decimals than the
 * currency has (yen have no cents, so "1000.50" is refused rather than
 * quietly floored), or when it falls outside one minor unit to a million
 * major units.
 */
export function majorToMinor(input: string, currency: string): number | null {
  const digits = minorUnitDigits(currency);
  const m = /^(\d{1,7})(?:\.(\d+))?$/.exec(input.trim());
  if (!m) return null;
  const fraction = m[2] ?? "";
  if (fraction.length > digits) return null;
  const unit = 10 ** digits;
  const value = Number(m[1]) * unit + Number(fraction.padEnd(digits, "0") || "0");
  return value >= 1 && value <= MAX_MAJOR_UNITS * unit ? value : null;
}

/**
 * The declared inverse of `majorToMinor`: 12450 CNY → "124.50", 1000 JPY →
 * "1000", 1234 KWD → "1.234". Every edit form that seeds its amount field
 * from a stored minor-unit value must go through this, not a hand-rolled
 * `/ 100`, or the prefill and `majorToMinor` disagree the moment a currency
 * is not exponent-2 — a disagreement that either corrupts the stored amount
 * (padding a three-decimal fraction to two zeros multiplies it by ten) or
 * blocks the save outright (a zero-decimal fraction `majorToMinor` refuses).
 * Built on `minorUnitDigits`, the one authority on a currency's exponent, so
 * this and `majorToMinor` can never drift apart on what a minor unit means.
 */
export function minorToMajorInput(amount: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const unit = 10 ** digits;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const major = Math.floor(abs / unit).toString();
  // A currency with no minor unit has nothing to put after a point, so it
  // gets no point either — mirrors formatMinor's fraction rule exactly.
  const fraction = digits === 0 ? "" : `.${(abs % unit).toString().padStart(digits, "0")}`;
  return `${sign}${major}${fraction}`;
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
