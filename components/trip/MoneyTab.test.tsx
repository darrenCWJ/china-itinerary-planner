import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    renderMoneyTab({
      currencySettings: { home: "SGD", rates: { SGD: 5.2 } },
      tripCurrency: "CNY",
    });

    expect(screen.getByText("Total CNY")).toBeInTheDocument();
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
