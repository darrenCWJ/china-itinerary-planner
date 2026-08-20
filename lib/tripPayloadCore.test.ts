import { describe, expect, test } from "vitest";
import {
  applyOptimisticCheck,
  classifyTripResponse,
  createSeqGuard,
  extractMutationError,
  POLL_MS,
  reducePayload,
} from "./tripPayloadCore";
import type { GuestTripPayload, TripPayload } from "./tripShared";

function payload(overrides: Partial<TripPayload> = {}): TripPayload {
  return {
    id: "abc123",
    version: 3,
    updatedAt: 1_700_000_000_000,
    data: {
      tripName: "Fujian run",
      startDate: "2026-12-24",
      input: {
        destinationIds: ["beijing"],
        days: 1,
        season: "winter",
        adults: 2,
        kids: 0,
        interests: ["food"],
      },
      plan: {
        days: [
          {
            day: 1,
            destinationId: "beijing",
            destinationName: "Beijing",
            items: [{ id: "i1", slot: "morning", kind: "arrival", title: "Land at PEK" }],
          },
        ],
        tips: [],
      },
      packing: [],
      foods: [],
      destinationNames: ["Beijing"],
    },
    members: [{ name: "Darren", joinedAt: 1 }],
    checks: [],
    tickets: [],
    expenses: [],
    settlements: [],
    journal: [],
    currencySettings: { home: null, rates: {} },
    ...overrides,
  };
}

function guestView(): GuestTripPayload {
  return {
    id: "abc123",
    version: 3,
    guest: true,
    country: "CN",
    tripName: "Fujian run",
    startDate: "2026-12-24",
    days: 1,
    season: "winter",
    destinationNames: ["Beijing"],
    planDays: [],
    packing: [],
    memberCount: 1,
  };
}

describe("POLL_MS", () => {
  test("keeps the four-second live-sync cadence", () => {
    expect(POLL_MS).toBe(4000);
  });
});

describe("reducePayload", () => {
  test("accepts the first payload when there is nothing to compare against", () => {
    const fresh = payload({ version: 1 });

    expect(reducePayload(null, fresh)).toBe(fresh);
  });

  test("takes a higher version", () => {
    const fresh = payload({ version: 4 });

    expect(reducePayload(payload({ version: 3 }), fresh)).toBe(fresh);
  });

  test("drops a lower version so late responses never regress the trip", () => {
    const prev = payload({ version: 5 });

    expect(reducePayload(prev, payload({ version: 4 }))).toBe(prev);
  });

  test("drops an equal version", () => {
    const prev = payload({ version: 5 });

    expect(reducePayload(prev, payload({ version: 5 }))).toBe(prev);
  });

  test("force applies an older payload — the identity-change escape hatch", () => {
    const fresh = payload({ version: 1 });

    expect(reducePayload(payload({ version: 9 }), fresh, true)).toBe(fresh);
  });
});

describe("applyOptimisticCheck", () => {
  test("adds a tick attributed to me", () => {
    const next = applyOptimisticCheck(payload(), "pack:Docs:Passport", true, "Darren");

    expect(next.checks).toEqual([{ key: "pack:Docs:Passport", by: "Darren" }]);
  });

  test("replaces an existing tick rather than duplicating it", () => {
    const prev = payload({ checks: [{ key: "item:i1", by: "Mei" }] });

    const next = applyOptimisticCheck(prev, "item:i1", true, "Darren");

    expect(next.checks).toEqual([{ key: "item:i1", by: "Darren" }]);
  });

  test("removes the tick when unchecked", () => {
    const prev = payload({
      checks: [
        { key: "item:i1", by: "Mei" },
        { key: "item:i2", by: "Darren" },
      ],
    });

    const next = applyOptimisticCheck(prev, "item:i1", false, "Darren");

    expect(next.checks).toEqual([{ key: "item:i2", by: "Darren" }]);
  });

  test("never mutates the payload it was handed", () => {
    const prev = payload({ checks: [{ key: "item:i1", by: "Mei" }] });

    const next = applyOptimisticCheck(prev, "item:i2", true, "Darren");

    expect(prev.checks).toEqual([{ key: "item:i1", by: "Mei" }]);
    expect(next).not.toBe(prev);
  });

  test("leaves the version alone so a poll still reconciles the guess", () => {
    const next = applyOptimisticCheck(payload({ version: 7 }), "item:i1", true, "Darren");

    expect(next.version).toBe(7);
  });
});

describe("classifyTripResponse", () => {
  test("404 is a missing trip", () => {
    expect(classifyTripResponse(404, null)).toEqual({ kind: "not-found" });
  });

  test("403 is a private trip that wants a join code", () => {
    expect(classifyTripResponse(403, null)).toEqual({ kind: "private" });
  });

  test("any other failure is an error the caller ignores", () => {
    expect(classifyTripResponse(500, null)).toEqual({ kind: "error" });
  });

  test("a guest body is the redacted view", () => {
    const view = guestView();

    expect(classifyTripResponse(200, view)).toEqual({ kind: "guest", view });
  });

  test("anything else is the member payload", () => {
    const fresh = payload();

    expect(classifyTripResponse(200, fresh)).toEqual({ kind: "member", payload: fresh });
  });

  test("a falsy body on a 200 is an error rather than a crash", () => {
    expect(classifyTripResponse(200, null)).toEqual({ kind: "error" });
  });
});

describe("createSeqGuard", () => {
  test("the freshly issued token is current", () => {
    const guard = createSeqGuard();

    expect(guard.isCurrent(guard.issue())).toBe(true);
  });

  test("an older token stops being current once a newer one is issued", () => {
    const guard = createSeqGuard();
    const first = guard.issue();
    const second = guard.issue();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  test("invalidate drops every in-flight token without issuing one", () => {
    const guard = createSeqGuard();
    const inFlight = guard.issue();

    guard.invalidate();

    expect(guard.isCurrent(inFlight)).toBe(false);
    expect(guard.isCurrent(guard.issue())).toBe(true);
  });
});

describe("extractMutationError", () => {
  test("prefers the server's own message", () => {
    expect(extractMutationError({ error: "Day not found" })).toBe("Day not found");
  });

  test("falls back to generic copy when the body has no usable error", () => {
    expect(extractMutationError({ error: 42 })).toBe("Couldn't save that change.");
    expect(extractMutationError({})).toBe("Couldn't save that change.");
    expect(extractMutationError(null)).toBe("Couldn't save that change.");
    expect(extractMutationError("nope")).toBe("Couldn't save that change.");
  });
});
