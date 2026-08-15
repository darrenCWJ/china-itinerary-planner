import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { TripData } from "../tripShared";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-test-"));
process.env.CIP_DB_PATH = path.join(dbDir, "test.db");

// Imported after the env override so the store opens the temp database.
import { closeDb } from "./db";
import { createTrip, joinTrip, linkMemberAccount } from "./tripStore";
import { resolveTripAccess } from "./authz";

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

beforeAll(() => {
  // Ensure a fresh connection against the temp path.
  closeDb();
});

afterAll(() => {
  closeDb();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("resolveTripAccess", () => {
  test("linked user is a member with their claimed name", async () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    linkMemberAccount(id, "Ada", "user-1");
    expect(await resolveTripAccess(id, "user-1", null)).toEqual({
      kind: "member",
      memberName: "Ada",
    });
    // A valid code adds nothing for a member.
    expect(await resolveTripAccess(id, "user-1", joinCode)).toEqual({
      kind: "member",
      memberName: "Ada",
    });
  });

  test("valid code without membership is a guest, case-insensitively", async () => {
    const { id, joinCode } = createTrip(tripData(), "Ada");
    expect(await resolveTripAccess(id, null, joinCode)).toEqual({ kind: "guest" });
    expect(await resolveTripAccess(id, null, joinCode.toLowerCase())).toEqual({ kind: "guest" });
    expect(await resolveTripAccess(id, "unlinked-user", joinCode)).toEqual({ kind: "guest" });
  });

  test("no session, no code, wrong code, unknown trip → none", async () => {
    const { id } = createTrip(tripData(), "Ada");
    expect(await resolveTripAccess(id, null, null)).toEqual({ kind: "none" });
    expect(await resolveTripAccess(id, null, "WRONG1")).toEqual({ kind: "none" });
    expect(await resolveTripAccess("missing", "user-1", "ABCDEF")).toEqual({ kind: "none" });
  });
});
