import { describe, expect, test } from "vitest";
import type { Expense, Settlement } from "./tripShared";
import {
  // Task 3 restores these
  balancesByCurrency,
  convertedTotals,
  expensesOnDate,
  formatMinor,
  majorToMinor,
  settleUp,
  splitMinorUnits,
  totalsByCurrency,
} from "./money";

let seq = 0;
function expense(overrides: Partial<Expense> = {}): Expense {
  seq += 1;
  return {
    id: `e${seq}`,
    date: "2026-11-02",
    title: "Test",
    category: "food",
    amount: 1000,
    currency: "CNY",
    paidBy: "Ada",
    splitAmong: ["Ada", "Bob"],
    notes: null,
    addedBy: "Ada",
    createdAt: 1,
    ...overrides,
  };
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  seq += 1;
  return {
    id: `s${seq}`,
    date: "2026-11-03",
    from: "Bob",
    to: "Ada",
    amount: 500,
    currency: "CNY",
    recordedBy: "Bob",
    createdAt: 2,
    ...overrides,
  };
}

describe("totalsByCurrency", () => {
  test("sums per currency, sorted by code", () => {
    const totals = totalsByCurrency([
      expense({ amount: 1000, currency: "CNY" }),
      expense({ amount: 2500, currency: "SGD" }),
      expense({ amount: 500, currency: "CNY" }),
    ]);
    expect(totals).toEqual([
      { currency: "CNY", amount: 1500 },
      { currency: "SGD", amount: 2500 },
    ]);
  });

  test("empty list gives no totals", () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe("expensesOnDate", () => {
  test("filters by exact date", () => {
    const a = expense({ date: "2026-11-02" });
    const b = expense({ date: "2026-11-03" });
    expect(expensesOnDate([a, b], "2026-11-03")).toEqual([b]);
  });
});

describe("convertedTotals", () => {
  const totals = [
    { currency: "CNY", amount: 100_000 },
    { currency: "SGD", amount: 10_000 },
  ];

  test("null without a home currency", () => {
    expect(convertedTotals(totals, { home: null, rates: {} })).toBeNull();
  });

  test("converts everything to CNY then to home", () => {
    const c = convertedTotals(totals, { home: "SGD", rates: { SGD: 5.2 } });
    // 100_000 + 10_000×5.2 = 152_000 fen; home = 152_000 / 5.2 ≈ 29_231 cents
    expect(c).toEqual({
      cny: 152_000,
      home: { currency: "SGD", amount: 29_231 },
      unconverted: [],
    });
  });

  test("collects currencies without a rate instead of dropping them", () => {
    const c = convertedTotals(
      [...totals, { currency: "USD", amount: 3_000 }],
      { home: "SGD", rates: { SGD: 5.2 } }
    );
    expect(c!.unconverted).toEqual([{ currency: "USD", amount: 3_000 }]);
    expect(c!.cny).toBe(152_000);
  });

  test("home CNY needs no rate", () => {
    const c = convertedTotals(totals, { home: "CNY", rates: { SGD: 5.2 } });
    expect(c!.home).toEqual({ currency: "CNY", amount: 152_000 });
  });

  test("home without a rate yields null home but still a CNY total", () => {
    const c = convertedTotals(totals, { home: "SGD", rates: {} });
    expect(c!.home).toBeNull();
    expect(c!.cny).toBe(100_000);
    expect(c!.unconverted).toEqual([{ currency: "SGD", amount: 10_000 }]);
  });
});

describe("formatMinor", () => {
  test("known symbols and grouping", () => {
    expect(formatMinor(124_050, "CNY")).toBe("¥1,240.50");
    expect(formatMinor(8_500, "SGD")).toBe("S$85.00");
    expect(formatMinor(1_200, "USD")).toBe("US$12.00");
  });

  test("unknown codes fall back to code prefix", () => {
    expect(formatMinor(1_200, "THB")).toBe("THB 12.00");
  });

  test("negative amounts carry the sign before the symbol", () => {
    expect(formatMinor(-50, "CNY")).toBe("-¥0.50");
  });
});

describe("majorToMinor", () => {
  test("parses major-unit strings", () => {
    expect(majorToMinor("124.5")).toBe(12_450);
    expect(majorToMinor("124.50")).toBe(12_450);
    expect(majorToMinor("0.01")).toBe(1);
    expect(majorToMinor("1000")).toBe(100_000);
  });

  test("rejects junk", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1,000", "1e3"]) {
      expect(majorToMinor(bad)).toBeNull();
    }
  });
});

describe("splitMinorUnits", () => {
  test("splits evenly", () => {
    expect(splitMinorUnits(1000, 2)).toEqual([500, 500]);
  });

  test("distributes the remainder to the first entries", () => {
    expect(splitMinorUnits(1000, 3)).toEqual([334, 333, 333]);
    expect(splitMinorUnits(101, 2)).toEqual([51, 50]);
  });

  test("total always equals the input", () => {
    for (const [amount, parts] of [[997, 3], [1, 4], [12345, 7]] as const) {
      const shares = splitMinorUnits(amount, parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(shares).toHaveLength(parts);
    }
  });
});

describe("balancesByCurrency", () => {
  const members = ["Ada", "Bob", "Cyn"];

  test("payer is owed, participants owe their share", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [],
      members
    );
    expect(out).toEqual([
      {
        currency: "CNY",
        balances: [
          { member: "Ada", net: 500 },
          { member: "Bob", net: -500 },
        ],
      },
    ]);
  });

  test("empty splitAmong means all current members", () => {
    const out = balancesByCurrency(
      [expense({ amount: 900, paidBy: "Ada", splitAmong: [] })],
      [],
      members
    );
    const cny = out[0].balances;
    expect(cny).toContainEqual({ member: "Ada", net: 600 });
    expect(cny).toContainEqual({ member: "Bob", net: -300 });
    expect(cny).toContainEqual({ member: "Cyn", net: -300 });
  });

  test("currencies are tracked independently", () => {
    const out = balancesByCurrency(
      [
        expense({ amount: 1000, currency: "CNY", paidBy: "Ada", splitAmong: ["Ada", "Bob"] }),
        expense({ amount: 400, currency: "SGD", paidBy: "Bob", splitAmong: ["Ada", "Bob"] }),
      ],
      [],
      members
    );
    expect(out.map((c) => c.currency)).toEqual(["CNY", "SGD"]);
  });

  test("a full settlement clears both nets", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [settlement({ from: "Bob", to: "Ada", amount: 500 })],
      members
    );
    expect(out).toEqual([]);
  });

  test("a partial settlement shrinks the debt", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [settlement({ from: "Bob", to: "Ada", amount: 200 })],
      members
    );
    expect(out[0].balances).toEqual([
      { member: "Ada", net: 300 },
      { member: "Bob", net: -300 },
    ]);
  });

  test("an over-payment flips the direction", () => {
    const out = balancesByCurrency(
      [expense({ amount: 1000, paidBy: "Ada", splitAmong: ["Ada", "Bob"] })],
      [settlement({ from: "Bob", to: "Ada", amount: 800 })],
      members
    );
    expect(out[0].balances).toEqual([
      { member: "Ada", net: -300 },
      { member: "Bob", net: 300 },
    ]);
  });

  test("unknown member names in old expenses do not crash", () => {
    const out = balancesByCurrency(
      [expense({ amount: 600, paidBy: "Ghost", splitAmong: ["Ghost", "Ada"] })],
      [],
      members
    );
    expect(out[0].balances).toContainEqual({ member: "Ghost", net: 300 });
    expect(out[0].balances).toContainEqual({ member: "Ada", net: -300 });
  });
});

describe("settleUp", () => {
  test("single debt yields one transfer", () => {
    expect(
      settleUp([
        { member: "Ada", net: 500 },
        { member: "Bob", net: -500 },
      ])
    ).toEqual([{ from: "Bob", to: "Ada", amount: 500 }]);
  });

  test("chain nets to minimal transfers", () => {
    const transfers = settleUp([
      { member: "Ada", net: 700 },
      { member: "Bob", net: -300 },
      { member: "Cyn", net: -400 },
    ]);
    expect(transfers).toEqual([
      { from: "Cyn", to: "Ada", amount: 400 },
      { from: "Bob", to: "Ada", amount: 300 },
    ]);
    const paid = transfers.reduce((a, t) => a + t.amount, 0);
    expect(paid).toBe(700);
  });

  test("balanced books need no transfers", () => {
    expect(settleUp([])).toEqual([]);
    expect(settleUp([{ member: "Ada", net: 0 }])).toEqual([]);
  });
});
