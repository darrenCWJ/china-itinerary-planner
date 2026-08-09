import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { TripData } from "../tripShared";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-test-"));
process.env.CIP_DB_PATH = path.join(dbDir, "test.db");

// Imported after the env override so the store opens the temp database.
import { closeDb } from "./db";
import { createTrip, getTrip, isMember, joinTrip, setCheck, updateTripData } from "./tripStore";

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
