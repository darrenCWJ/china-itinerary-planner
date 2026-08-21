import type { TripPayload } from "./tripShared";

/**
 * A fully-populated `TripPayload`, shared by every test that needs one real
 * fixture rather than a hand-rolled partial.
 *
 * Deliberately not colocated in a `.test.ts` file: `redactTrip.test.ts` and
 * `contracts.test.ts` both need it, and importing a fixture out of another
 * suite's `.test.ts` file re-runs that file's top-level `describe` blocks
 * wherever it is imported — every consumer would silently inherit
 * `guestTripView`'s test suite a second time. A plain module has no such
 * side effect, so this is the one place both suites can import from without
 * two payload fixtures drifting apart.
 */
export function fullPayload(): TripPayload {
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
