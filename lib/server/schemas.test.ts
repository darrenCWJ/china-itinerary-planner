import { describe, expect, test } from "vitest";
import {
  AddExpenseSchema,
  AddJournalSchema,
  AddSettlementSchema,
  CurrencySettingsSchema,
  PlanOpSchema,
  PrefsSchema,
  TripInputSchema,
  UpdateJournalSchema,
} from "./schemas";

const tripInput = {
  destinationIds: ["beijing", "xian"],
  days: 7,
  season: "spring",
  adults: 2,
  kids: 1,
  interests: ["food", "history"],
};

const expense = {
  memberName: "Ada",
  expense: {
    date: "2026-11-02",
    title: "Hotpot dinner",
    category: "food",
    amount: 12450,
    currency: "CNY",
    paidBy: "Ada",
    splitAmong: ["Ada", "Bob"],
  },
};

describe("expense schema", () => {
  test("accepts a valid expense", () => {
    expect(AddExpenseSchema.safeParse(expense).success).toBe(true);
  });

  test("normalizes lowercase currency to uppercase", () => {
    const parsed = AddExpenseSchema.parse({
      ...expense,
      expense: { ...expense.expense, currency: "sgd" },
    });
    expect(parsed.expense.currency).toBe("SGD");
  });

  test("rejects non-integer, zero and oversized amounts", () => {
    for (const amount of [0, -5, 12.5, 100_000_001]) {
      const bad = { ...expense, expense: { ...expense.expense, amount } };
      expect(AddExpenseSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("rejects bad currency codes", () => {
    for (const currency of ["", "C", "CNYY", "12A"]) {
      const bad = { ...expense, expense: { ...expense.expense, currency } };
      expect(AddExpenseSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("settlement schema", () => {
  test("accepts a valid settlement", () => {
    const ok = AddSettlementSchema.safeParse({
      memberName: "Bob",
      settlement: { date: "2026-11-03", from: "Bob", to: "Ada", amount: 6225, currency: "CNY" },
    });
    expect(ok.success).toBe(true);
  });
});

describe("journal schema", () => {
  test("accepts text with upload and link photos", () => {
    const ok = AddJournalSchema.safeParse({
      memberName: "Ada",
      entry: {
        date: "2026-11-02",
        text: "Great Wall day — knees destroyed, worth it.",
        photos: [
          { kind: "upload", ref: "0f3c2a1b-aaaa-bbbb-cccc-121212121212.jpg" },
          { kind: "link", ref: "https://photos.example.com/share/abc" },
        ],
      },
    });
    expect(ok.success).toBe(true);
  });

  test("rejects http links, traversal refs and >12 photos", () => {
    const base = { date: "2026-11-02", text: "x", photos: [] as unknown[] };
    const cases = [
      [{ kind: "link", ref: "http://insecure.example.com/a" }],
      [{ kind: "upload", ref: "../../etc/passwd" }],
      [{ kind: "upload", ref: "a.exe" }],
      Array.from({ length: 13 }, () => ({ kind: "link", ref: "https://e.com/p" })),
    ];
    for (const photos of cases) {
      const bad = { memberName: "Ada", entry: { ...base, photos } };
      expect(AddJournalSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("update allows partial fields", () => {
    const ok = UpdateJournalSchema.safeParse({
      memberName: "Ada",
      entry: { text: "edited" },
    });
    expect(ok.success).toBe(true);
  });
});

describe("currency settings schema", () => {
  test("accepts home + rates and null home", () => {
    expect(
      CurrencySettingsSchema.safeParse({
        memberName: "Ada",
        home: "SGD",
        rates: { SGD: 5.2, USD: 7.1 },
      }).success
    ).toBe(true);
    expect(
      CurrencySettingsSchema.safeParse({ memberName: "Ada", home: null, rates: {} }).success
    ).toBe(true);
  });

  test("carries an optional pivot through instead of stripping it", () => {
    const ok = CurrencySettingsSchema.safeParse({
      memberName: "Ada",
      home: "JPY",
      rates: { USD: 150 },
      pivot: "JPY",
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.pivot).toBe("JPY");
  });

  test("rejects a malformed pivot", () => {
    expect(
      CurrencySettingsSchema.safeParse({
        memberName: "Ada",
        home: "JPY",
        rates: {},
        pivot: "JP",
      }).success
    ).toBe(false);
  });

  test("legacy bodies without a pivot still parse, with the field absent", () => {
    const ok = CurrencySettingsSchema.safeParse({
      memberName: "Ada",
      home: "SGD",
      rates: { SGD: 5.2 },
    });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.pivot).toBeUndefined();
  });

  test("rejects non-positive or non-finite rates", () => {
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        CurrencySettingsSchema.safeParse({
          memberName: "Ada",
          home: "SGD",
          rates: { SGD: rate },
        }).success
      ).toBe(false);
    }
  });
});

describe("trip input country", () => {
  test("defaults to CN when the client sends no country", () => {
    // The write boundary is where country actually lands in storage: every
    // create/update from here on persists one, so no backfill is needed.
    const parsed = TripInputSchema.parse(tripInput);
    expect(parsed.country).toBe("CN");
  });

  test("normalizes a lowercase country to uppercase", () => {
    expect(TripInputSchema.parse({ ...tripInput, country: "jp" }).country).toBe("JP");
  });

  test("rejects anything that is not ISO alpha-2", () => {
    for (const country of ["JPN", "J", "", "12", "日本"]) {
      expect(TripInputSchema.safeParse({ ...tripInput, country }).success).toBe(false);
    }
  });
});

describe("plan op timing", () => {
  const setTiming = { op: "setTiming", day: 1, itemId: "item-1" };

  test("accepts a time block", () => {
    const parsed = PlanOpSchema.parse({ ...setTiming, startMinutes: 540, durationMinutes: 90 });
    expect(parsed).toMatchObject({ op: "setTiming", startMinutes: 540, durationMinutes: 90 });
  });

  test("accepts midnight and a full-day block at the edges of the range", () => {
    expect(
      PlanOpSchema.safeParse({ ...setTiming, startMinutes: 0, durationMinutes: 1440 }).success
    ).toBe(true);
    expect(
      PlanOpSchema.safeParse({ ...setTiming, startMinutes: 1439, durationMinutes: 1 }).success
    ).toBe(true);
  });

  test("accepts explicit nulls, which clear the block", () => {
    expect(
      PlanOpSchema.safeParse({ ...setTiming, startMinutes: null, durationMinutes: null }).success
    ).toBe(true);
  });

  test("rejects minutes outside a day, fractions and non-numbers", () => {
    const bad = [
      { startMinutes: 1440, durationMinutes: 90 },
      { startMinutes: -1, durationMinutes: 90 },
      { startMinutes: 9.5, durationMinutes: 90 },
      { startMinutes: 540, durationMinutes: 0 },
      { startMinutes: 540, durationMinutes: -30 },
      { startMinutes: 540, durationMinutes: 1441 },
      { startMinutes: 540, durationMinutes: 90.5 },
      { startMinutes: "540", durationMinutes: 90 },
      { startMinutes: Number.NaN, durationMinutes: 90 },
    ];
    for (const timing of bad) {
      expect(PlanOpSchema.safeParse({ ...setTiming, ...timing }).success).toBe(false);
    }
  });

  test("requires both fields on setTiming so a half-set block cannot be stored", () => {
    expect(PlanOpSchema.safeParse({ ...setTiming, startMinutes: 540 }).success).toBe(false);
    expect(PlanOpSchema.safeParse({ ...setTiming, durationMinutes: 90 }).success).toBe(false);
  });

  test("addItem takes optional timing and stays valid without it", () => {
    const base = { op: "addItem", day: 1, title: "Lunch", slot: "afternoon" };
    expect(PlanOpSchema.parse(base)).not.toHaveProperty("startMinutes");
    expect(
      PlanOpSchema.parse({ ...base, startMinutes: 540, durationMinutes: 90 })
    ).toMatchObject({ startMinutes: 540, durationMinutes: 90 });
    expect(PlanOpSchema.safeParse({ ...base, startMinutes: 1440 }).success).toBe(false);
    // addItem creates the item, so there is nothing to clear: no nulls here.
    expect(PlanOpSchema.safeParse({ ...base, startMinutes: null }).success).toBe(false);
  });

  test("updateItem takes nullable timing so an edit can clear the block", () => {
    const base = { op: "updateItem", day: 1, itemId: "item-1" };
    expect(PlanOpSchema.parse(base)).not.toHaveProperty("startMinutes");
    expect(
      PlanOpSchema.safeParse({ ...base, startMinutes: null, durationMinutes: null }).success
    ).toBe(true);
    expect(
      PlanOpSchema.parse({ ...base, startMinutes: 600, durationMinutes: 45 })
    ).toMatchObject({ startMinutes: 600, durationMinutes: 45 });
    expect(PlanOpSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(false);
  });

  test("still rejects an unknown op", () => {
    expect(PlanOpSchema.safeParse({ op: "reflow", day: 1 }).success).toBe(false);
  });
});

describe("PrefsSchema", () => {
  test("accepts each accent mode", () => {
    expect(PrefsSchema.parse({ theme: "dark", accent: "country" })).toMatchObject({
      theme: "dark",
      accent: "country",
    });
    expect(PrefsSchema.parse({ theme: "light", accent: 210 })).toMatchObject({ accent: 210 });
    expect(PrefsSchema.parse({ accentHues: { CN: 200, JP: 40 } }).accentHues).toEqual({
      CN: 200,
      JP: 40,
    });
  });

  test("an omitted field takes its default", () => {
    expect(PrefsSchema.parse({})).toEqual({ theme: "light", accent: "country", accentHues: {} });
  });

  test("rejects a theme outside the allowlist", () => {
    expect(PrefsSchema.safeParse({ theme: "purple" }).success).toBe(false);
    expect(PrefsSchema.safeParse({ theme: "<script>alert(1)</script>" }).success).toBe(false);
    expect(PrefsSchema.safeParse({ theme: 1 }).success).toBe(false);
  });

  test("rejects an accent that is not a hue", () => {
    // Hex is no longer a valid accent anywhere: only hue varies, so lightness
    // and chroma stay pinned and no choice can be illegible.
    expect(PrefsSchema.safeParse({ accent: "#1d5c9e" }).success).toBe(false);
    expect(PrefsSchema.safeParse({ accent: 400 }).success).toBe(false);
    expect(PrefsSchema.safeParse({ accent: -1 }).success).toBe(false);
    expect(PrefsSchema.safeParse({ accent: 12.5 }).success).toBe(false);
    expect(PrefsSchema.safeParse({ accent: 0 }).success).toBe(true);
    expect(PrefsSchema.safeParse({ accent: 359 }).success).toBe(true);
  });

  test("rejects malformed override maps", () => {
    expect(PrefsSchema.safeParse({ accentHues: { china: 10 } }).success).toBe(false);
    expect(PrefsSchema.safeParse({ accentHues: { CN: 999 } }).success).toBe(false);
    expect(PrefsSchema.safeParse({ accentHues: { CN: "200" } }).success).toBe(false);
  });
});
