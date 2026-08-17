import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { CurrencyBalances } from "@/lib/money";
import { BalancesCard } from "./BalancesCard";

/**
 * The balance row encodes state in colour: two spans of identical role, size and
 * weight, where the only difference between "is owed" and "owes" is the paint.
 * That makes both halves semantic signals, and a semantic signal must not be
 * painted with `--accent-ink` — the country-identity colour (spec §4.2), whose
 * hue is whatever `resolveAccentVars` puts on the root for the trip's country.
 * On China it resolves one degree from the seal vermilion the negative half
 * uses; on any other country it means "that country", never "settled".
 *
 * jsdom applies no stylesheet, so the resolved colour is not observable here.
 * What is observable, and what actually broke, is which token the branch names —
 * so these assert on the token rather than on a computed rgb().
 */

const currencies: CurrencyBalances[] = [
  {
    currency: "CNY",
    balances: [
      { member: "Ada", net: 6225 },
      { member: "Bob", net: -6225 },
    ],
  },
];

function renderCard() {
  render(
    <BalancesCard
      currencies={currencies}
      settlements={[]}
      isMember={false}
      onAddSettlement={async () => null}
      onDeleteSettlement={async () => null}
    />
  );
  // `selector` keeps the query on the signal span itself; the enclosing <li>
  // matches the same text and would make this ambiguous.
  return {
    owed: screen.getByText(/is owed/, { selector: "span" }),
    owes: screen.getByText(/owes/, { selector: "span" }),
  };
}

afterEach(cleanup);

describe("balance signals", () => {
  test("paints neither half with the hue-variable country accent", () => {
    const { owed, owes } = renderCard();
    expect(owed.className).not.toMatch(/accent/);
    expect(owes.className).not.toMatch(/accent/);
  });

  test("keeps the affirmative half separated from the negative one", () => {
    const { owed, owes } = renderCard();
    expect(owes.className).toMatch(/text-seal/);
    // Equal classes would satisfy the assertion above while erasing the signal.
    expect(owed.className).not.toBe(owes.className);
  });
});
