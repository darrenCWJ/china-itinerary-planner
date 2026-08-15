import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CurrencySettings, Expense, JournalEntry, Settlement, TripData } from "../tripShared";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-test-"));
process.env.CIP_DB_PATH = path.join(dbDir, "test.db");

// Imported after the env override so the store opens the temp database.
import { closeDb } from "./db";
import {
  addExpense,
  addJournalEntry,
  addSettlement,
  createTrip,
  deleteExpense,
  deleteJournalEntry,
  deleteSettlement,
  enableBriefing,
  getBriefingByCode,
  getBriefingForTrip,
  getTrip,
  isMember,
  isNameClaimed,
  joinTrip,
  linkMemberAccount,
  memberNameForUser,
  revokeBriefing,
  setCheck,
  setCurrencySettings,
  tripsForUser,
  updateExpense,
  updateJournalEntry,
  updateTripData,
} from "./tripStore";

function tripData(overrides: Partial<TripData> = {}): TripData {
  return {
    tripName: "Test trip",
    startDate: null,
    input: {
      destinationIds: ["beijing"],
      days: 3,
      season: "autumn",
      adults: 2,
      kids: 0,
      interests: ["food"],
    },
    plan: { days: [], tips: [] },
    packing: [],
    foods: [],
    destinationNames: ["Beijing"],
    ...overrides,
  };
}

describe("tripStore", () => {
  beforeAll(() => {
    // Ensure a fresh connection against the temp path.
    closeDb();
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  test("creates a trip with the creator as first member", () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    expect(id).toMatch(/^[0-9a-f]{10}$/);
    expect(joinCode).toHaveLength(6);

    const trip = getTrip(id, "Ada");
    expect(trip).not.toBeNull();
    expect(trip!.members.map((m) => m.name)).toEqual(["Ada"]);
    expect(trip!.joinCode).toBe(joinCode);
    expect(trip!.version).toBe(1);
  });

  test("hides the join code from non-members", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(getTrip(id)!.joinCode).toBeUndefined();
    expect(getTrip(id, "Stranger")!.joinCode).toBeUndefined();
  });

  test("join requires the right code and bumps the version", () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    expect(joinTrip(id, "WRONG1", "Bob")).toBe("bad-code");
    expect(isMember(id, "Bob")).toBe(false);

    expect(joinTrip(id, joinCode.toLowerCase(), "Bob")).toBe("joined");
    expect(isMember(id, "Bob")).toBe(true);

    const trip = getTrip(id, "Bob");
    expect(trip!.members.map((m) => m.name)).toEqual(["Ada", "Bob"]);
    expect(trip!.version).toBe(2);
    expect(joinTrip(id, joinCode, "Bob")).toBe("rejoined");
  });

  test("returns not-found for unknown trips", () => {
    expect(joinTrip("nope", "ABCDEF", "Bob")).toBe("not-found");
    expect(getTrip("nope")).toBeNull();
  });

  test("checks toggle on and off with attribution", () => {
    const { id } = createTrip(tripData(), "Ada");
    setCheck(id, "pack:Tech:VPN", "Ada", true);
    expect(getTrip(id)!.checks).toEqual([{ key: "pack:Tech:VPN", by: "Ada" }]);

    setCheck(id, "pack:Tech:VPN", "Bob", true);
    expect(getTrip(id)!.checks).toEqual([{ key: "pack:Tech:VPN", by: "Bob" }]);

    setCheck(id, "pack:Tech:VPN", "Bob", false);
    expect(getTrip(id)!.checks).toEqual([]);
  });

  test("updating trip data replaces the snapshot and bumps the version", () => {
    const { id } = createTrip(tripData(), "Ada");
    const updated = updateTripData(id, tripData({ tripName: "Renamed" }));
    expect(updated).toBe(true);
    const trip = getTrip(id);
    expect(trip!.data.tripName).toBe("Renamed");
    expect(trip!.version).toBe(2);
    expect(updateTripData("nope", tripData())).toBe(false);
  });
});

describe("briefing links", () => {
  test("mints a 12-character code resolvable back to the trip", () => {
    const { id } = createTrip(tripData(), "Ada");
    const enabled = enableBriefing(id, false);
    expect(enabled).not.toBeNull();
    expect(enabled!.code).toHaveLength(12);
    expect(getBriefingByCode(enabled!.code)).toEqual({ tripId: id, includeBookings: false });
  });

  test("returns null for a trip that does not exist", () => {
    expect(enableBriefing("nope", false)).toBeNull();
  });

  test("toggling bookings keeps the same code so shared links stay alive", () => {
    const { id } = createTrip(tripData(), "Ada");
    const first = enableBriefing(id, false)!;
    const second = enableBriefing(id, true)!;
    expect(second.code).toBe(first.code);
    expect(getBriefingByCode(first.code)).toEqual({ tripId: id, includeBookings: true });
  });

  test("reads back the live link for a trip", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(getBriefingForTrip(id)).toBeNull();
    const { code } = enableBriefing(id, true)!;
    expect(getBriefingForTrip(id)).toEqual({ code, includeBookings: true });
  });

  test("revoking kills the shared link", () => {
    const { id } = createTrip(tripData(), "Ada");
    const { code } = enableBriefing(id, false)!;
    expect(revokeBriefing(id)).toBe(true);
    expect(getBriefingByCode(code)).toBeNull();
    expect(getBriefingForTrip(id)).toBeNull();
    expect(revokeBriefing(id)).toBe(false);
  });

  test("re-enabling after a revoke mints a different code", () => {
    const { id } = createTrip(tripData(), "Ada");
    const first = enableBriefing(id, false)!;
    revokeBriefing(id);
    const second = enableBriefing(id, false)!;
    expect(second.code).not.toBe(first.code);
    expect(getBriefingByCode(first.code)).toBeNull();
  });

  test("codes use the unambiguous alphabet", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(enableBriefing(id, false)!.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
  });
});

function expenseFixture(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-1",
    date: "2026-11-02",
    title: "Hotpot",
    category: "food",
    amount: 12450,
    currency: "CNY",
    paidBy: "Ada",
    splitAmong: ["Ada"],
    notes: null,
    addedBy: "Ada",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("money & journal storage", () => {
  test("expense CRUD round-trips and bumps the version", () => {
    const { id } = createTrip(tripData(), "Ada");
    const before = getTrip(id)!.version;

    expect(addExpense(id, expenseFixture())).toBe(true);
    let trip = getTrip(id)!;
    expect(trip.expenses).toHaveLength(1);
    expect(trip.expenses[0].title).toBe("Hotpot");
    expect(trip.version).toBe(before + 1);

    expect(updateExpense(id, expenseFixture({ title: "Hotpot deluxe" }))).toBe(true);
    trip = getTrip(id)!;
    expect(trip.expenses[0].title).toBe("Hotpot deluxe");
    expect(trip.version).toBe(before + 2);

    expect(deleteExpense(id, "exp-1")).toBe(true);
    trip = getTrip(id)!;
    expect(trip.expenses).toHaveLength(0);
    expect(trip.version).toBe(before + 3);
  });

  test("mutations against a missing trip or record return false", () => {
    expect(addExpense("nope", expenseFixture())).toBe(false);
    const { id } = createTrip(tripData(), "Ada");
    expect(updateExpense(id, expenseFixture({ id: "ghost" }))).toBe(false);
    expect(deleteExpense(id, "ghost")).toBe(false);
    expect(deleteSettlement(id, "ghost")).toBe(false);
    expect(deleteJournalEntry(id, "ghost")).toBe(false);
  });

  test("settlements round-trip", () => {
    const { id } = createTrip(tripData(), "Ada");
    const s: Settlement = {
      id: "set-1",
      date: "2026-11-03",
      from: "Bob",
      to: "Ada",
      amount: 6225,
      currency: "CNY",
      recordedBy: "Bob",
      createdAt: Date.now(),
    };
    expect(addSettlement(id, s)).toBe(true);
    expect(getTrip(id)!.settlements).toEqual([s]);
    expect(deleteSettlement(id, "set-1")).toBe(true);
    expect(getTrip(id)!.settlements).toEqual([]);
  });

  test("journal entries round-trip with photos", () => {
    const { id } = createTrip(tripData(), "Ada");
    const entry: JournalEntry = {
      id: "j-1",
      date: "2026-11-02",
      text: "Great Wall!",
      photos: [{ kind: "link", ref: "https://photos.example.com/a" }],
      by: "Ada",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(addJournalEntry(id, entry)).toBe(true);
    expect(getTrip(id)!.journal).toEqual([entry]);

    const edited = { ...entry, text: "Great Wall — 10/10", updatedAt: Date.now() + 1 };
    expect(updateJournalEntry(id, edited)).toBe(true);
    expect(getTrip(id)!.journal[0].text).toBe("Great Wall — 10/10");

    expect(deleteJournalEntry(id, "j-1")).toBe(true);
    expect(getTrip(id)!.journal).toEqual([]);
  });

  test("currency settings default and persist", () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(getTrip(id)!.currencySettings).toEqual({ home: null, rates: {} });

    const settings: CurrencySettings = { home: "SGD", rates: { SGD: 5.2 } };
    expect(setCurrencySettings(id, settings)).toBe(true);
    const trip = getTrip(id)!;
    expect(trip.currencySettings).toEqual(settings);
    expect(setCurrencySettings("nope", settings)).toBe(false);
  });
});

describe("member accounts", () => {
  test("link, lookup and claim rules", () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    joinTrip(id, joinCode, "Bob");

    expect(linkMemberAccount(id, "Ada", "user-1")).toBe("linked");
    expect(memberNameForUser(id, "user-1")).toBe("Ada");
    expect(isNameClaimed(id, "Ada")).toBe(true);
    expect(isNameClaimed(id, "Bob")).toBe(false);

    // A claimed name cannot be re-claimed; a linked user cannot link twice.
    expect(linkMemberAccount(id, "Ada", "user-2")).toBe("name-claimed");
    expect(linkMemberAccount(id, "Bob", "user-1")).toBe("user-already-member");

    // Unknown trip or member name.
    expect(linkMemberAccount("nope", "Ada", "user-9")).toBe("not-found");
    expect(linkMemberAccount(id, "Ghost", "user-9")).toBe("not-found");
    expect(memberNameForUser(id, "user-9")).toBeNull();
  });

  test("tripsForUser lists linked trips newest-first", () => {
    const a = createTrip(tripData({ tripName: "Trip A" }), "Ada");
    const b = createTrip(tripData({ tripName: "Trip B" }), "Ada");
    linkMemberAccount(a.id, "Ada", "user-list");
    linkMemberAccount(b.id, "Ada", "user-list");
    const list = tripsForUser("user-list");
    expect(list.map((t) => t.name)).toEqual(["Trip B", "Trip A"]);
    expect(list[0].memberName).toBe("Ada");
    expect(list[0].destinationNames).toEqual(["Beijing"]);
    expect(list[0].days).toBe(0);
    expect(list[0].startDate).toBeNull();
  });

  test("tripsForUser returns an empty array for a user with no linked trips", () => {
    expect(tripsForUser("nobody")).toEqual([]);
  });
});
