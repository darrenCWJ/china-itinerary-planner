import { describe, expect, test } from "vitest";
import type { TripPayload } from "./tripShared";
import { guestTripView } from "./redactTrip";

function fullPayload(): TripPayload {
  return {
    id: "trip-1",
    version: 7,
    updatedAt: 123,
    data: {
      tripName: "Family Trip",
      startDate: "2026-12-20",
      input: {
        destinationIds: ["beijing"],
        days: 3,
        season: "winter",
        adults: 2,
        kids: 1,
        interests: ["food"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [{ id: "i1", slot: "morning", kind: "activity", title: "Great Wall" }],
          },
        ],
        tips: ["secret member tip"],
      },
      packing: [{ title: "Documents", emoji: "🛂", items: ["Passports"] }],
      foods: [{ destination: "Beijing", emoji: "🥟", dishes: ["Duck"] }],
      destinationNames: ["Beijing"],
    },
    members: [{ name: "Ada", joinedAt: 1 }, { name: "Bob", joinedAt: 2 }],
    checks: [{ key: "item:i1", by: "Ada" }],
    tickets: [{ id: "t1", kind: "flight", title: "SQ 800", date: null, endDate: null, time: null, from: null, to: null, confirmation: "PNR-XYZ", price: null, notes: null, addedBy: "Ada" }],
    expenses: [{ id: "e1", date: "2026-12-20", title: "Hotpot", category: "food", amount: 100, currency: "CNY", paidBy: "Ada", splitAmong: [], notes: null, addedBy: "Ada", createdAt: 1 }],
    settlements: [{ id: "s1", date: "2026-12-21", from: "Bob", to: "Ada", amount: 50, currency: "CNY", recordedBy: "Bob", createdAt: 2 }],
    journal: [{ id: "j1", date: "2026-12-20", text: "diary", photos: [], by: "Ada", createdAt: 1, updatedAt: 1 }],
    currencySettings: { home: "SGD", rates: { SGD: 5.2 } },
    features: { photoUploads: true },
    joinCode: "SECRET",
  };
}

describe("guestTripView", () => {
  test("contains exactly the whitelisted fields", () => {
    const view = guestTripView(fullPayload());
    expect(Object.keys(view).sort()).toEqual(
      [
        "days",
        "destinationNames",
        "guest",
        "id",
        "memberCount",
        "packing",
        "planDays",
        "season",
        "startDate",
        "tripName",
        "version",
      ].sort()
    );
    expect(view.guest).toBe(true);
    expect(view.memberCount).toBe(2);
    expect(view.planDays[0].items[0].title).toBe("Great Wall");
  });

  test("leaks nothing sensitive anywhere in the serialized view", () => {
    const json = JSON.stringify(guestTripView(fullPayload()));
    for (const secret of [
      "SECRET",      // join code
      "PNR-XYZ",     // ticket confirmation
      "Hotpot",      // expense
      "diary",       // journal
      "Ada",         // member names / attribution
      "item:i1",     // check keys
      "SGD",         // currency settings
      "secret member tip", // tips are member-facing
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});
