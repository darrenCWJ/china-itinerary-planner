import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MoneyTab } from "./MoneyTab";
import type { CurrencySettings, Expense } from "@/lib/tripShared";

afterEach(() => cleanup());

const noop = vi.fn(async () => null);

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: "e-1",
    date: "2026-08-21",
    title: "Lunch",
    category: "food",
    amount: 1000,
    currency: "JPY",
    paidBy: "Ada",
    splitAmong: [],
    notes: null,
    addedBy: "Ada",
    createdAt: Date.now(),
    ...overrides,
  };
}

function renderMoneyTab({
  expenses = [],
  currencySettings,
  tripCurrency = null,
}: {
  expenses?: Expense[];
  currencySettings: CurrencySettings;
  tripCurrency?: string | null;
}) {
  return render(
    <MoneyTab
      expenses={expenses}
      settlements={[]}
      currencySettings={currencySettings}
      tripCurrency={tripCurrency}
      members={["Ada"]}
      myName="Ada"
      isMember
      onAddExpense={noop}
      onUpdateExpense={noop}
      onDeleteExpense={noop}
      onAddSettlement={noop}
      onDeleteSettlement={noop}
      onSaveCurrency={noop}
    />
  );
}

describe("totals row pivot label", () => {
  test("labels the totals row with the trip's own pivot", () => {
    // A home currency must be set for convertedTotals to return non-null —
    // the rate itself is irrelevant to this test.
    renderMoneyTab({
      currencySettings: { home: "SGD", rates: { SGD: 0.006 }, pivot: "JPY" },
      tripCurrency: "JPY",
    });

    expect(screen.getByText("Total JPY")).toBeInTheDocument();
    expect(screen.queryByText("Total CNY")).not.toBeInTheDocument();
  });

  test("labels the totals row CNY when no pivot is stored — the legacy guarantee", () => {
    // Settings saved before pivots existed carry no `pivot` field at all.
    // A real CNY expense (not the empty-expenses default) makes the
    // grandTotal nonzero, so this proves the legacy path actually prices in
    // CNY, not merely that it would pass at a grandTotal of 0 under any
    // pivot arithmetic — the gap Minor 4 flagged.
    renderMoneyTab({
      expenses: [expense({ id: "e-1", currency: "CNY", amount: 12345 })],
      currencySettings: { home: "SGD", rates: { SGD: 5.2 } },
      tripCurrency: "CNY",
    });

    // CNY is the (legacy default) pivot, so it converts at identity — no
    // rate needed — straight into the totals row.
    const cnyRow = screen.getByText("Total CNY").closest("p");
    expect(cnyRow).toHaveTextContent("¥123.45");

    // The stored SGD rate (5.2) is exercised too: 123.45 CNY ÷ 5.2 = 23.74
    // SGD is the home-currency row, derived from the same CNY grand total.
    const sgdRow = screen.getByText("Total SGD").closest("p");
    expect(sgdRow).toHaveTextContent("S$23.74");
  });

  test("the home-currency row never repeats the pivot itself", () => {
    // home === pivot should not print a redundant second "Total X" line —
    // this covers the same comparison MoneyTab used to hardcode against CNY.
    renderMoneyTab({
      currencySettings: { home: "JPY", rates: {}, pivot: "JPY" },
      tripCurrency: "JPY",
    });

    expect(screen.getAllByText(/Total JPY/)).toHaveLength(1);
  });
});

describe("rates editor currency list (the fourth CNY hardcode)", () => {
  test("excludes the trip's real pivot, not just literal CNY, from the rate rows", () => {
    renderMoneyTab({
      expenses: [
        expense({ id: "e-1", currency: "CNY" }),
        expense({ id: "e-2", currency: "JPY" }),
      ],
      currencySettings: { home: "SGD", rates: {}, pivot: "JPY" },
      tripCurrency: "JPY",
    });

    // home is already set, so the disclosure reads "Edit conversion rates".
    fireEvent.click(screen.getByText(/edit conversion rates/i));

    // CNY is a foreign currency against a JPY pivot, so it needs a rate row.
    expect(screen.getByText("1 CNY =")).toBeInTheDocument();
    // JPY is the pivot itself — it never needs a rate against itself.
    expect(screen.queryByText("1 JPY =")).not.toBeInTheDocument();
  });
});

describe("Spend so far totals list (Task 12: the collision rule reaches the screen)", () => {
  test("a JPY total alongside a CNY total disambiguates into JP¥ and CN¥", () => {
    renderMoneyTab({
      expenses: [
        expense({ id: "e-1", currency: "JPY", amount: 124_000 }),
        expense({ id: "e-2", currency: "CNY", amount: 124_050 }),
      ],
      currencySettings: { home: null, rates: {} },
    });

    // Scoped to the "Spend so far" totals panel specifically — the by-date
    // expense list below renders the same two amounts a second time (it is
    // wired to the same displayed-currency set), so an unscoped query would
    // correctly, but uninformatively, find two matches of each.
    const totalsPanel = within(screen.getByText("Spend so far").closest("div")!);

    // Both currencies are on screen at once, so the ambiguous plain ¥ must
    // be disambiguated for each — never a bare "JPY 124,000" code fallback
    // and never two identical, unattributable ¥ amounts.
    expect(totalsPanel.getByText("JP¥124,000")).toBeInTheDocument();
    expect(totalsPanel.getByText("CN¥1,240.50")).toBeInTheDocument();
    expect(totalsPanel.queryByText(/JPY 124,000/)).not.toBeInTheDocument();
  });

  test("a JPY total alone renders the plain yen sign, not the JPY code fallback", () => {
    renderMoneyTab({
      expenses: [expense({ id: "e-1", currency: "JPY", amount: 124_000 })],
      currencySettings: { home: null, rates: {} },
    });

    // Note: the row's uppercase "JPY" currency-code label is expected and
    // untouched (`t.currency` printed plainly) — only the formatted-amount
    // fallback ("JPY 124,000", the pre-fix code-prefix form) must be absent.
    const totalsPanel = within(screen.getByText("Spend so far").closest("div")!);
    expect(totalsPanel.getByText("¥124,000")).toBeInTheDocument();
    expect(totalsPanel.queryByText(/JPY 124,000/)).not.toBeInTheDocument();
  });
});

describe("rate row unit label (the fifth CNY hardcode)", () => {
  test("labels the rate input's unit with the trip's real pivot, not literal CNY", () => {
    // On a JPY-pivot trip, "1 SGD = [input]" must read as JPY per SGD — a
    // member reading a CNY label here would type a CNY-scale number
    // (~5.2) into a field the app reads as JPY-scale (~110), off by ~20x.
    renderMoneyTab({
      expenses: [expense({ id: "e-1", currency: "SGD" })],
      currencySettings: { home: "SGD", rates: {}, pivot: "JPY" },
      tripCurrency: "JPY",
    });

    // home is already set, so the disclosure reads "Edit conversion rates".
    fireEvent.click(screen.getByText(/edit conversion rates/i));

    expect(screen.getByText("1 SGD =")).toBeInTheDocument();
    expect(screen.getByText("JPY")).toBeInTheDocument();
    expect(screen.queryByText("CNY")).not.toBeInTheDocument();
  });
});

describe("converted-totals rows use the displayed-currency set (Minor 3)", () => {
  test("the pivot total disambiguates its ¥ the same way the totals list above it does", () => {
    // A JPY expense alongside a CNY one makes ¥ genuinely ambiguous on this
    // screen (same fixture shape as the "Spend so far" disambiguation tests
    // above). Before the fix, the totals list correctly printed "CN¥" but
    // the converted-totals row a few lines below called formatMinor with no
    // displayed-currency set, so it fell back to a bare "¥" — the exact
    // ambiguity Task 12 exists to prevent, reappearing two elements away.
    renderMoneyTab({
      expenses: [
        expense({ id: "e-1", currency: "JPY", amount: 124_000 }),
        expense({ id: "e-2", currency: "CNY", amount: 12_345 }),
      ],
      currencySettings: { home: "CNY", rates: {} },
      tripCurrency: "CNY",
    });

    const totalRow = screen.getByText("Total CNY").closest("p");
    expect(totalRow).toHaveTextContent("CN¥123.45");
    // Never the bare, un-disambiguated symbol.
    expect(screen.queryByText("¥123.45")).not.toBeInTheDocument();
  });
});
