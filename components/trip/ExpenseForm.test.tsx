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
