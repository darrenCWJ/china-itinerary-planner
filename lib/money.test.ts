import { describe, expect, test } from "vitest";
import { getCountryProfile } from "./countryProfile";
import { currencyPivot, type Expense, type Settlement } from "./tripShared";
import {
  balancesByCurrency,
  convertedTotals,
  expensesOnDate,
  formatMinor,
  majorToMinor,
  minorToMajorInput,
  minorUnitDigits,
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
    // Back-compat pin: with no pivot argument the numbers are exactly what
    // they have always been, and the pivot is CNY by default.
    expect(c).toEqual({
      cny: 152_000,
      grandTotal: 152_000,
      pivot: "CNY",
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

  test("an explicit pivot reads the rates in that pivot's terms", () => {
    // rates = { USD: 150 } read as "JPY per 1 USD".
    //
    //   JPY leg     10_000 yen, already the pivot = 10_000 JPY
    //   USD leg     100 cents ÷ 10^2 = $1.00,
    //               then $1.00 × 150 JPY/USD      =    150 JPY
    //   grandTotal                                = 10_150 JPY
    //
    // This test predates the exponent table and expected 25_000, which read
    // the USD leg's 15_000 as JPY minor units — the ¥150 a dollar actually
    // buys, inflated 100x by the factor that no longer cancels. No trip in
    // existence has a JPY pivot, so no shipped total moves: the old number
    // was the conversion bug written down as an expectation.
    const c = convertedTotals(
      [
        { currency: "JPY", amount: 10_000 },
        { currency: "USD", amount: 100 },
        { currency: "XXX", amount: 5 },
      ],
      { home: "JPY", rates: { USD: 150 } },
      "JPY"
    );
    expect(c!.pivot).toBe("JPY");
    expect(c!.grandTotal).toBe(10_150);
    expect(c!.unconverted).toEqual([{ currency: "XXX", amount: 5 }]);
    expect(c!.home).toEqual({ currency: "JPY", amount: 10_150 });
  });

  test("the country profile supplies the pivot with no special-casing", () => {
    const settings = { home: "SGD", rates: { SGD: 5.2 } };
    expect(convertedTotals(totals, settings, getCountryProfile("CN").currency)).toEqual(
      convertedTotals(totals, settings)
    );
  });

  test("cny stays an alias of the grand total for existing readers", () => {
    const c = convertedTotals(totals, { home: "SGD", rates: { SGD: 5.2 } }, "JPY");
    expect(c!.cny).toBe(c!.grandTotal);
  });

  test("a zero-decimal expense converts into a two-decimal pivot", () => {
    // ¥12,000 spent in JPY (exponent 0) alongside ¥1,000.00 spent in CNY
    // (exponent 2), totalled into a CNY pivot at 0.05 CNY per 1 JPY.
    //
    //   JPY leg     12_000 ÷ 10^0 = 12_000 JPY major
    //               12_000 × 0.05 =    600.00 CNY major
    //               600 × 10^2                    =  60_000 fen
    //   CNY leg     already the pivot, rate 1     = 100_000 fen
    //   grandTotal                                = 160_000 fen = ¥1,600.00
    //   home SGD at 5.2 CNY per SGD:
    //               160_000 ÷ 5.2 = 30_769.23…    =  30_769 cents = S$307.69
    //
    // The unfixed arithmetic multiplied minor units by a major-unit ratio:
    // Math.round(12_000 × 0.05) = 600 fen, booking ¥6.00 for a ¥600.00
    // expense — wrong by exactly the 100 that used to cancel.
    const c = convertedTotals(
      [
        { currency: "CNY", amount: 100_000 },
        { currency: "JPY", amount: 12_000 },
      ],
      { home: "SGD", rates: { JPY: 0.05, SGD: 5.2 } },
      "CNY"
    );
    expect(c!.grandTotal).toBe(160_000);
    expect(c!.home).toEqual({ currency: "SGD", amount: 30_769 });
  });

  test("a two-decimal expense converts into a zero-decimal pivot", () => {
    // The same break the other way round: ¥1,240.50 spent in CNY, totalled
    // into a JPY pivot at 20 JPY per 1 CNY.
    //
    //   124_050 ÷ 10^2                            =   1_240.50 CNY major
    //   1_240.50 × 20                             =  24_810    JPY major
    //   24_810 × 10^0                             =  24_810    JPY minor
    //   home CNY    24_810 ÷ 20 = 1_240.50 major  = 124_050    fen
    //
    // The home leg lands back on exactly the amount that went in, so the two
    // conversions round-trip. The unfixed arithmetic gave
    // Math.round(124_050 × 20) = 2_481_000, i.e. ¥2,481,000 of yen owed for
    // a ¥1,240.50 dinner.
    const c = convertedTotals(
      [{ currency: "CNY", amount: 124_050 }],
      { home: "CNY", rates: { CNY: 20 } },
      "JPY"
    );
    expect(c!.grandTotal).toBe(24_810);
    expect(c!.home).toEqual({ currency: "CNY", amount: 124_050 });
  });
});

describe("currencyPivot", () => {
  test("settings without the field are read as CNY, never reinterpreted", () => {
    expect(currencyPivot({ home: null, rates: {} })).toBe("CNY");
    expect(currencyPivot({ home: "SGD", rates: { SGD: 5.2 } })).toBe("CNY");
  });

  test("a recorded pivot is used as-is", () => {
    expect(currencyPivot({ home: null, rates: {}, pivot: "JPY" })).toBe("JPY");
  });
});

describe("minorUnitDigits", () => {
  test("zero-decimal currencies have no minor unit at all", () => {
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("KRW")).toBe(0);
    expect(minorUnitDigits("VND")).toBe(0);
    expect(minorUnitDigits("IDR")).toBe(0);
  });

  test("three-decimal currencies keep all three", () => {
    expect(minorUnitDigits("BHD")).toBe(3);
    expect(minorUnitDigits("JOD")).toBe(3);
    expect(minorUnitDigits("KWD")).toBe(3);
    expect(minorUnitDigits("OMR")).toBe(3);
    expect(minorUnitDigits("TND")).toBe(3);
  });

  test("the ISO-4217 majority has two", () => {
    expect(minorUnitDigits("CNY")).toBe(2);
    expect(minorUnitDigits("SGD")).toBe(2);
    expect(minorUnitDigits("USD")).toBe(2);
  });

  test("an unlisted code defaults to two instead of throwing", () => {
    // An unresearched country must still be priceable. Two is the ISO-4217
    // majority, so the default is the least-surprising guess, never an error.
    expect(minorUnitDigits("XXX")).toBe(2);
    expect(minorUnitDigits("")).toBe(2);
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

  test("a zero-decimal currency renders no decimal point", () => {
    // Yen have no cents, so there is nothing to put after a point. The
    // thousands separator still applies. JPY is absent from SYMBOLS and so
    // takes the code-prefix fallback -- filling that map out is Task 12, and
    // the yen sign is already spoken for by CNY here.
    expect(formatMinor(1_000, "JPY")).toBe("JPY 1,000");
    expect(formatMinor(1_234_567, "KRW")).toBe("KRW 1,234,567");
    expect(formatMinor(-500, "JPY")).toBe("-JPY 500");
  });

  test("a three-decimal currency renders all three", () => {
    expect(formatMinor(1_234_567, "KWD")).toBe("KWD 1,234.567");
    expect(formatMinor(5, "BHD")).toBe("BHD 0.005");
  });
});

describe("majorToMinor", () => {
  test("parses major-unit strings", () => {
    expect(majorToMinor("124.5", "CNY")).toBe(12_450);
    expect(majorToMinor("124.50", "CNY")).toBe(12_450);
    expect(majorToMinor("0.01", "CNY")).toBe(1);
    expect(majorToMinor("1000", "CNY")).toBe(100_000);
  });

  test("rejects junk", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1,000", "1e3"]) {
      expect(majorToMinor(bad, "CNY")).toBeNull();
    }
  });

  test("a zero-decimal currency counts whole units", () => {
    expect(majorToMinor("1000", "JPY")).toBe(1_000);
    expect(majorToMinor("1", "KRW")).toBe(1);
  });

  test("a zero-decimal currency rejects decimals instead of flooring them", () => {
    // Yen have no cents. Silently dropping the .50 would lose real money and
    // tell the user nothing; refusing the input is the honest answer.
    expect(majorToMinor("1000.50", "JPY")).toBeNull();
    expect(majorToMinor("1000.0", "JPY")).toBeNull();
  });

  test("a three-decimal currency accepts three and no more", () => {
    expect(majorToMinor("1.234", "KWD")).toBe(1_234);
    expect(majorToMinor("1.2", "KWD")).toBe(1_200);
    expect(majorToMinor("1.2345", "KWD")).toBeNull();
  });

  test("the ceiling is a million major units whatever the exponent", () => {
    // The bound has always read 100_000_000 minor units, which for a
    // two-decimal currency is exactly a million major units. Pinning the
    // major meaning keeps the ceiling where it has always been for CNY
    // instead of letting it drift 100x either way with the exponent.
    expect(majorToMinor("1000000", "CNY")).toBe(100_000_000);
    expect(majorToMinor("1000000.01", "CNY")).toBeNull();
    expect(majorToMinor("1000000", "JPY")).toBe(1_000_000);
    expect(majorToMinor("1000001", "JPY")).toBeNull();
    expect(majorToMinor("1000000", "KWD")).toBe(1_000_000_000);
    expect(majorToMinor("1000000.001", "KWD")).toBeNull();
  });

  test("the floor is one minor unit whatever the exponent", () => {
    expect(majorToMinor("0", "CNY")).toBeNull();
    expect(majorToMinor("0.01", "CNY")).toBe(1);
    expect(majorToMinor("0", "JPY")).toBeNull();
    expect(majorToMinor("1", "JPY")).toBe(1);
    expect(majorToMinor("0.001", "KWD")).toBe(1);
  });

  test("an unlisted currency is parsed as a two-decimal one", () => {
    expect(majorToMinor("124.5", "XXX")).toBe(12_450);
  });
});

describe("minorToMajorInput", () => {
  test("formats to the currency's own exponent", () => {
    expect(minorToMajorInput(12_450, "CNY")).toBe("124.50");
    expect(minorToMajorInput(1_000, "JPY")).toBe("1000");
    expect(minorToMajorInput(1_234, "KWD")).toBe("1.234");
  });

  /**
   * This is the property that matters: minorToMajorInput is the declared
   * inverse of majorToMinor, so feeding one's output back into the other
   * must reproduce the original minor-unit amount, for every exponent in
   * the table -- not just CNY's. An edit form's amount field is seeded with
   * minorToMajorInput and re-parsed with majorToMinor on save, so any
   * disagreement here is a live data-corruption or save-blocking bug, not a
   * cosmetic one.
   */
  test("round-trips through majorToMinor at every exponent", () => {
    const cases: Array<[number, string]> = [
      [1, "CNY"], // one fen, the floor
      [12_450, "CNY"], // an ordinary two-decimal amount
      [100_000_000, "CNY"], // the ceiling, two-decimal
      [1, "JPY"], // one yen, the floor
      [5_000, "JPY"], // an ordinary zero-decimal amount
      [1_000_000, "JPY"], // the ceiling, zero-decimal
      [1, "KWD"], // one fils, the floor
      [1_234, "KWD"], // an ordinary three-decimal amount
      [50_000, "KWD"], // KWD 50.000 -- the exact figure from the corruption report
      [1_000_000_000, "KWD"], // the ceiling, three-decimal
    ];
    for (const [minor, currency] of cases) {
      expect(majorToMinor(minorToMajorInput(minor, currency), currency)).toBe(minor);
    }
  });

  test("a three-decimal currency no longer inflates a stored amount tenfold on re-save", () => {
    // Before this fix, an edit form seeded its amount field with a hardcoded
    // `(amount / 100).toFixed(2)`. For KWD 50.000 (50_000 minor units) that
    // produced "500.00", and majorToMinor("500.00", "KWD") accepted that
    // two-digit fraction and returned 500_000 -- an untouched re-save
    // silently multiplied the stored amount by ten.
    const prefill = minorToMajorInput(50_000, "KWD");
    expect(prefill).toBe("50.000");
    expect(majorToMinor(prefill, "KWD")).toBe(50_000);
  });

  test("a zero-decimal currency's prefill is no longer refused by majorToMinor", () => {
    // Before this fix, JPY 5,000 (5_000 minor units, no cents) prefilled as
    // "50.00", and majorToMinor("50.00", "JPY") returned null -- the save
    // failed even for a title-only edit, on an amount the user never touched.
    const prefill = minorToMajorInput(5_000, "JPY");
    expect(prefill).toBe("5000");
    expect(majorToMinor(prefill, "JPY")).toBe(5_000);
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
