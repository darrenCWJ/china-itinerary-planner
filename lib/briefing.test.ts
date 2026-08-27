import { describe, expect, test } from "vitest";
import { buildBriefing } from "./briefing";
import type { TripPayload } from "./tripShared";

function payload(overrides: Partial<TripPayload> = {}): TripPayload {
  return {
    id: "abc123",
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "Fujian run",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["beijing", "chengdu"],
        days: 3,
        season: "winter",
        adults: 4,
        kids: 3,
        interests: ["food", "history"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              { id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK" },
              {
                id: "i2",
                slot: "afternoon",
                kind: "activity",
                title: "Forbidden City",
                interests: ["history"],
                note: "Book ahead",
              },
            ],
          },
          {
            day: 2,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [
              {
                id: "i3",
                slot: "morning",
                kind: "activity",
                title: "Hutong food walk",
                interests: ["food", "history"],
              },
            ],
          },
          {
            day: 3,
            destinationId: "chengdu",
            destinationName: "Chengdu",
            items: [{ id: "i4", slot: "morning", kind: "travel", title: "Rail to Chengdu" }],
          },
        ],
        tips: ["Set up Alipay before flying."],
      },
      packing: [],
      foods: [],
      destinationNames: ["Beijing", "Chengdu"],
    },
    members: [{ name: "Ada", joinedAt: 1 }],
    checks: [{ key: "item:i1", by: "Ada" }],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    currencySettings: { home: null, rates: {} },
    ...overrides,
  };
}

const FULL = { redacted: false, includeBookings: true } as const;
const PUBLIC_PLAIN = { redacted: true, includeBookings: false } as const;
const PUBLIC_BOOKINGS = { redacted: true, includeBookings: true } as const;

function withTickets(): TripPayload {
  return payload({
    tickets: [
      {
        id: "t2",
        kind: "hotel",
        title: "Ritz Beijing",
        date: "2026-12-25",
        endDate: "2026-12-26",
        time: null,
        from: null,
        to: null,
        confirmation: "HTL-SECRET-99",
        price: "¥1400",
        notes: "Ask for a high floor",
        addedBy: "Ada",
      },
      {
        id: "t1",
        kind: "flight",
        title: "SQ 806",
        date: "2026-12-24",
        endDate: null,
        time: "11:45",
        from: "SIN",
        to: "PEK",
        confirmation: "PNR-SECRET-42",
        price: "$310",
        notes: "Window seats",
        addedBy: "Ada",
      },
    ],
  });
}

describe("buildBriefing — overview", () => {
  test("titles the briefing and summarises days, cities and season", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.title).toBe("Fujian run");
    expect(b.subtitle).toBe("3 days · 2 cities · winter");
  });

  test("counts days from the plan, not the original input", () => {
    const p = payload();
    p.data.input.days = 99;
    expect(buildBriefing(p, FULL).subtitle).toBe("3 days · 2 cities · winter");
  });

  test("pluralizes correctly for a single-day trip", () => {
    const p = payload();
    p.data.plan.days = [p.data.plan.days[0]];
    expect(buildBriefing(p, FULL).subtitle).toBe("1 day · 1 city · winter");
  });

  test("derives a date range from the start date", () => {
    expect(buildBriefing(payload(), FULL).dateRange).toEqual({
      start: "2026-12-24",
      end: "2026-12-26",
    });
  });

  test("has no date range when the trip has no start date", () => {
    const p = payload();
    p.data.startDate = null;
    const b = buildBriefing(p, FULL);
    expect(b.dateRange).toBeNull();
    expect(b.days.every((d) => d.date === null)).toBe(true);
  });

  test("groups cities in visit order with their day numbers", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.cities).toEqual([
      { id: "beijing", name: "Beijing", localName: "北京", days: [1, 2] },
      { id: "chengdu", name: "Chengdu", localName: "成都", days: [3] },
    ]);
  });

  test("leaves localName null for cities outside the curated set", () => {
    const p = payload();
    p.data.plan.days[2].destinationId = "Q1234";
    p.data.plan.days[2].destinationName = "Quanzhou";
    expect(buildBriefing(p, FULL).cities[1]).toEqual({
      id: "Q1234",
      name: "Quanzhou",
      localName: null,
      days: [3],
    });
  });

  test("carries the party and each day's items", () => {
    const b = buildBriefing(payload(), FULL);
    expect(b.party).toEqual({ adults: 4, kids: 3 });
    expect(b.days[0]).toEqual({
      day: 1,
      date: "2026-12-24",
      destinationName: "Beijing",
      items: [
        { id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK", time: null, note: null },
        {
          id: "i2",
          slot: "afternoon",
          kind: "activity",
          title: "Forbidden City",
          time: null,
          note: "Book ahead",
        },
      ],
    });
  });

  test("does not mutate the payload it is given", () => {
    const p = payload();
    const snapshot = JSON.stringify(p);
    buildBriefing(p, FULL);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe("buildBriefing — charts", () => {
  test("counts days per city in visit order", () => {
    expect(buildBriefing(payload(), FULL).charts.daysPerCity).toEqual([
      { label: "Beijing", value: 2 },
      { label: "Chengdu", value: 1 },
    ]);
  });

  test("counts every interest tag on every item, busiest first", () => {
    expect(buildBriefing(payload(), FULL).charts.interestMix).toEqual([
      { label: "History & Culture", value: 2 },
      { label: "Food & Street Eats", value: 1 },
    ]);
  });

  test("omits interests that no scheduled item carries", () => {
    const labels = buildBriefing(payload(), FULL).charts.interestMix.map((s) => s.label);
    expect(labels).not.toContain("Beach & Islands");
  });

  test("reports pace as items per day, counting travel and arrival blocks", () => {
    expect(buildBriefing(payload(), FULL).charts.pace).toEqual([
      { day: 1, items: 2 },
      { day: 2, items: 1 },
      { day: 3, items: 1 },
    ]);
  });

  test("survives a plan with no days", () => {
    const p = payload();
    p.data.plan.days = [];
    const b = buildBriefing(p, FULL);
    expect(b.charts).toEqual({ daysPerCity: [], interestMix: [], pace: [] });
    expect(b.subtitle).toBe("0 days · 0 cities · winter");
  });
});

describe("buildBriefing — logistics", () => {
  test("carries plan tips through", () => {
    expect(buildBriefing(payload(), FULL).logistics.tips).toEqual([
      "Set up Alipay before flying.",
    ]);
  });

  test("sorts bookings by date and keeps the travel details", () => {
    const bookings = buildBriefing(withTickets(), FULL).logistics.bookings;
    expect(bookings.map((b) => b.title)).toEqual(["SQ 806", "Ritz Beijing"]);
    expect(bookings[0]).toEqual({
      kind: "flight",
      title: "SQ 806",
      date: "2026-12-24",
      endDate: null,
      time: "11:45",
      from: "SIN",
      to: "PEK",
      confirmation: "PNR-SECRET-42",
      price: "$310",
      notes: "Window seats",
    });
  });
});

describe("buildBriefing — redaction", () => {
  test("members' view keeps crew and progress", () => {
    expect(buildBriefing(payload(), FULL).crew).toEqual({
      members: ["Ada"],
      checkedCount: 1,
    });
  });

  test("public view has no crew at all", () => {
    expect(buildBriefing(payload(), PUBLIC_PLAIN).crew).toBeNull();
    expect(buildBriefing(payload(), PUBLIC_BOOKINGS).crew).toBeNull();
  });

  test("public view drops confirmation, price and notes by default", () => {
    const b = buildBriefing(withTickets(), PUBLIC_PLAIN).logistics.bookings[0];
    expect(b.confirmation).toBeNull();
    expect(b.price).toBeNull();
    expect(b.notes).toBeNull();
  });

  test("public view keeps the shape of the journey", () => {
    const bookings = buildBriefing(withTickets(), PUBLIC_PLAIN).logistics.bookings;
    expect(bookings[0]).toMatchObject({
      kind: "flight",
      title: "SQ 806",
      time: "11:45",
      from: "SIN",
      to: "PEK",
    });
  });

  test("endDate survives redaction", () => {
    const bookings = buildBriefing(withTickets(), PUBLIC_PLAIN).logistics.bookings;
    const hotel = bookings.find((b) => b.kind === "hotel");
    expect(hotel?.endDate).toBe("2026-12-26");
  });

  test("the bookings toggle restores confirmation, price and notes", () => {
    const b = buildBriefing(withTickets(), PUBLIC_BOOKINGS).logistics.bookings[0];
    expect(b.confirmation).toBe("PNR-SECRET-42");
    expect(b.price).toBe("$310");
    expect(b.notes).toBe("Window seats");
  });

  test("the bookings toggle never restores member identity", () => {
    const serialized = JSON.stringify(buildBriefing(withTickets(), PUBLIC_BOOKINGS));
    expect(serialized).not.toContain("Ada");
  });

  test("no sensitive value survives anywhere in a redacted briefing", () => {
    const serialized = JSON.stringify(buildBriefing(withTickets(), PUBLIC_PLAIN));
    for (const secret of [
      "PNR-SECRET-42",
      "HTL-SECRET-99",
      "$310",
      "¥1400",
      "Window seats",
      "Ask for a high floor",
      "Ada",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("SQ 806");
  });

  test("records which mode produced it", () => {
    expect(buildBriefing(payload(), FULL).redacted).toBe(false);
    expect(buildBriefing(payload(), PUBLIC_PLAIN).redacted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T28 — the gap note the briefing carries
// ---------------------------------------------------------------------------

/** The same trip, in a different country. Everything else, including the
 *  snapshotted `plan.tips`, is held fixed. */
function inCountry(country: string): TripPayload {
  const base = payload();
  return { ...base, data: { ...base.data, input: { ...base.data.input, country } } };
}

describe("buildBriefing resolves the gap note from the trip's country", () => {
  test("a Peru trip carries the note; the tips it disclaims are untouched", () => {
    const b = buildBriefing(inCountry("PE"), PUBLIC_PLAIN);

    expect(b.gapNote).toEqual([
      "These notes come from open reference data. We don't have Peru-specific guidance on " +
        "payments, connectivity, booking channels or public holidays yet — and we'd rather leave " +
        "that blank than guess.",
    ]);
    // The note sits BESIDE the tips, never in them.
    expect(b.logistics.tips).toEqual(["Set up Alipay before flying."]);
  });

  test("a sparse country names exactly the fields the artifact lacks for it", () => {
    // Measured against the committed data/country-facts.json on 2026-08-27: SH
    // has a driving side, emergency numbers and one official language, and no
    // currency, plugs, voltage or calling code.
    const b = buildBriefing(inCountry("SH"), PUBLIC_PLAIN);
    expect(b.gapNote).toHaveLength(2);
    expect(b.gapNote[1]).toBe(
      "We also have no currency, plug types, mains voltage or dialling code for " +
        "Saint Helena, Ascension and Tristan da Cunha."
    );
  });

  test("China gets none, and neither does a legacy trip with no country stored", () => {
    expect(buildBriefing(inCountry("CN"), PUBLIC_PLAIN).gapNote).toEqual([]);
    // `payload()` predates the country field entirely — `tripCountry`'s "CN"
    // backfill, which must not turn every legacy trip into a disclaimed one.
    expect(buildBriefing(payload(), PUBLIC_PLAIN).gapNote).toEqual([]);
    expect(buildBriefing(payload(), FULL).gapNote).toEqual([]);
  });

  test("it is derived per build, not read off the persisted trip", () => {
    // Two briefings from the SAME stored plan, differing only in country. If
    // the note were ever snapshotted onto `data.plan` these would agree — and
    // a trip created today would keep saying "we don't have Peru guidance"
    // long after we did. It is a claim about our current data, not the trip.
    const peru = buildBriefing(inCountry("PE"), PUBLIC_PLAIN);
    const helena = buildBriefing(inCountry("SH"), PUBLIC_PLAIN);
    expect(peru.gapNote).not.toEqual(helena.gapNote);

    // And nothing on the stored side ever grew a gap note to read from.
    const stored = JSON.stringify(inCountry("PE").data);
    expect(stored).not.toContain("gapNote");
    expect(stored).not.toContain("open reference data");
  });

  test("the redaction sweep still holds with the note present", () => {
    // The note names a country, never a member or a booking reference — but
    // it is new content on the public document, so it goes through the same
    // check rather than being assumed harmless.
    const serialized = JSON.stringify(buildBriefing(inCountry("PE"), PUBLIC_PLAIN));
    expect(serialized).toContain("open reference data");
    expect(serialized).not.toContain("Ada");
  });
});
