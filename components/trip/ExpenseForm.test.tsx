import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { Expense } from "@/lib/tripShared";
import { ExpenseForm, type ExpenseDraft } from "./ExpenseForm";

/**
 * Editing an expense seeds its amount field from the stored minor-unit
 * value via `minorToMajorInput` (lib/money.ts) -- the declared inverse of
 * the `majorToMinor` parser Task 3 made currency-aware. Before that inverse
 * existed, the prefill was a hardcoded `(amount / 100).toFixed(2)`, which
 * disagrees with `majorToMinor` the moment a currency isn't exponent-2: a
 * three-decimal currency's stored amount gets silently multiplied by ten on
 * an untouched re-save, and a zero-decimal currency's edit can't be saved at
 * all. These tests drive the real form end to end -- render with a stored
 * expense, click Save without touching anything, inspect what onSubmit
 * actually received -- rather than testing lib/money.ts in isolation.
 */

afterEach(cleanup);

const members = ["Ada", "Bob"];

async function renderAndResaveUntouched(expense: Expense): Promise<ExpenseDraft> {
  let submitted: ExpenseDraft | null = null;
  render(
    <ExpenseForm
      members={members}
      myName="Ada"
      initial={expense}
      submitLabel="Save changes"
      quickCurrencies={["JPY"]}
      onSubmit={async (draft) => {
        submitted = draft;
        return null;
      }}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  await waitFor(() => expect(submitted).not.toBeNull());
  return submitted as unknown as ExpenseDraft;
}

describe("the currency picker is the trip's, not a hardcoded pair", () => {
  const noop = async () => null;

  test("a new expense defaults to the first quick currency the caller supplies", () => {
    // It used to default to "CNY" from a module-level `["CNY", "SGD"]`, so an
    // expense on a trip to Peru was priced in Chinese yuan until the traveller
    // noticed — on every entry. Asserted on the rendered select value, because
    // the default IS what the form submits when nobody touches the control.
    render(
      <ExpenseForm
        members={members}
        myName="Ada"
        submitLabel="Add expense"
        quickCurrencies={["PEN", "SGD"]}
        onSubmit={noop}
      />
    );
    const select = screen.getByLabelText("Currency") as HTMLSelectElement;
    expect(select.value).toBe("PEN");
    expect([...select.options].map((o) => o.value)).toEqual(["PEN", "SGD", "other"]);
    expect(screen.queryByText("CNY")).toBeNull();
  });

  test("no researched currency and no home currency asks for one instead of guessing", () => {
    // The honest end state, matching what `currencyPivot` does to the totals
    // row: nothing has named a unit, so the form does not name one either. The
    // custom-code input is shown rather than a blank picker, so the member can
    // still record the expense.
    render(
      <ExpenseForm
        members={members}
        myName="Ada"
        submitLabel="Add expense"
        quickCurrencies={[]}
        onSubmit={noop}
      />
    );
    const select = screen.getByLabelText("Currency") as HTMLSelectElement;
    expect(select.value).toBe("other");
    expect([...select.options].map((o) => o.value)).toEqual(["other"]);
    expect(screen.getByLabelText("Custom currency code")).toBeTruthy();
  });

  test("an existing expense keeps its own currency even when it is not on the quick list", () => {
    render(
      <ExpenseForm
        members={members}
        myName="Ada"
        initial={{
          id: "e1",
          date: "2026-08-27",
          title: "Taxi",
          category: "transport",
          amount: 1_000,
          currency: "KRW",
          paidBy: "Ada",
          splitAmong: members,
          notes: null,
          addedBy: "Ada",
          createdAt: 1,
        }}
        submitLabel="Save changes"
        quickCurrencies={["PEN"]}
        onSubmit={noop}
      />
    );
    expect((screen.getByLabelText("Currency") as HTMLSelectElement).value).toBe("other");
    expect((screen.getByLabelText("Custom currency code") as HTMLInputElement).value).toBe("KRW");
  });
});

describe("re-saving an edited expense untouched", () => {
  test("a three-decimal currency (KWD) keeps its stored amount, not ten times it", async () => {
    const draft = await renderAndResaveUntouched({
      id: "e1",
      date: "2026-11-02",
      title: "Hotel",
      category: "lodging",
      amount: 50_000, // KWD 50.000
      currency: "KWD",
      paidBy: "Ada",
      splitAmong: ["Ada", "Bob"],
      notes: null,
      addedBy: "Ada",
      createdAt: 1,
    });
    expect(draft.amount).toBe(50_000);
  });

  test("a zero-decimal currency (JPY) can still be saved at all", async () => {
    const draft = await renderAndResaveUntouched({
      id: "e2",
      date: "2026-11-02",
      title: "Ramen",
      category: "food",
      amount: 5_000, // JPY 5,000, no cents
      currency: "JPY",
      paidBy: "Ada",
      splitAmong: ["Ada", "Bob"],
      notes: null,
      addedBy: "Ada",
      createdAt: 2,
    });
    expect(draft.amount).toBe(5_000);
  });

  test("a two-decimal currency (CNY) is unaffected -- the existing behaviour", async () => {
    const draft = await renderAndResaveUntouched({
      id: "e3",
      date: "2026-11-02",
      title: "Dinner",
      category: "food",
      amount: 12_450, // CNY 124.50
      currency: "CNY",
      paidBy: "Ada",
      splitAmong: ["Ada", "Bob"],
      notes: null,
      addedBy: "Ada",
      createdAt: 3,
    });
    expect(draft.amount).toBe(12_450);
  });
});
