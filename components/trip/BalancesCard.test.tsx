import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { CurrencyBalances } from "@/lib/money";
import { BalancesCard, type SettlementDraft } from "./BalancesCard";

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
    expect(owes.className).toContain("text-[var(--seal)]");
    // Equal classes would satisfy the assertion above while erasing the signal.
    expect(owed.className).not.toBe(owes.className);
  });
});

/**
 * "Mark repaid" seeds its confirm field from the transfer's stored minor-unit
 * amount via `minorToMajorInput` (lib/money.ts) -- the declared inverse of the
 * `majorToMinor` parser this confirm box re-parses on "Confirm". Before that
 * inverse existed, the seed was a hardcoded `(amount / 100).toFixed(2)`, which
 * disagrees with `majorToMinor` for any currency that isn't exponent-2: a
 * three-decimal currency's transfer gets silently multiplied by ten on an
 * untouched confirm. This drives the real component -- render, click "Mark
 * repaid", click "Confirm" without editing the field -- rather than testing
 * lib/money.ts in isolation.
 */
describe("confirming a repayment untouched", () => {
  test("a three-decimal currency (KWD) records its stored amount, not ten times it", async () => {
    const kwdBalances: CurrencyBalances[] = [
      {
        currency: "KWD",
        balances: [
          { member: "Ada", net: 50_000 }, // KWD 50.000
          { member: "Bob", net: -50_000 },
        ],
      },
    ];
    let recorded: SettlementDraft | null = null;
    render(
      <BalancesCard
        currencies={kwdBalances}
        settlements={[]}
        isMember={true}
        onAddSettlement={async (draft) => {
          recorded = draft;
          return null;
        }}
        onDeleteSettlement={async () => null}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark repaid" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(recorded).not.toBeNull());
    expect((recorded as unknown as SettlementDraft).amount).toBe(50_000);
  });
});
