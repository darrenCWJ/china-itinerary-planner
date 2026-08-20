import { afterEach, describe, expect, it } from "vitest";
import type { TripData } from "../tripShared";
import { updateTripDataIf } from "./pgStore";

/**
 * pgStore has no database to talk to here, so these drive it through the one
 * seam it has: the `postgres` tagged template cached on `globalThis.__cipSql`.
 * Swapping that for a recorder runs the real function body against the real
 * driver shape and fakes only the database itself — which is the part whose
 * *statement boundaries* are the thing under test.
 */

interface Statement {
  /** Template literals joined on `$`, so a placeholder reads as one. */
  text: string;
  params: unknown[];
}

function installRecorder(rowCount: number): Statement[] {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...params: unknown[]) => {
    statements.push({ text: strings.join("$"), params });
    return Promise.resolve(Object.assign([] as unknown[], { count: rowCount }));
  };
  (tag as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  globalThis.__cipSql = tag as never;
  // Skips the DDL: ensureSchema returns this instead of issuing it.
  globalThis.__cipSchemaReady = Promise.resolve();
  return statements;
}

afterEach(() => {
  globalThis.__cipSql = undefined;
  globalThis.__cipSchemaReady = undefined;
});

const DATA: TripData = {
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
};

describe("updateTripDataIf — the optimistic-concurrency guard", () => {
  it("guards on the expected version and bumps it in one statement", async () => {
    const statements = installRecorder(1);

    expect(await updateTripDataIf("trip-1", DATA, 7)).toBe(true);

    // Splitting the guard from the bump across two autocommit statements *is*
    // the lost update: a second writer that also read version 7 passes the same
    // guard in the window before the first one's bump lands, and overwrites it.
    // Both callers are told true; one op is gone. The day builder makes
    // concurrent plan POSTs routine, so the window is not theoretical.
    expect(statements).toHaveLength(1);
    const [write] = statements;
    expect(write.text).toMatch(/version\s*=\s*version\s*\+\s*1/);
    expect(write.text).toMatch(/WHERE[\s\S]*\bversion\s*=/);
    expect(write.params).toContain(7);
    // touch() used to carry this; folding the bump inward must not drop it.
    expect(write.text).toMatch(/updated_at\s*=/);
  });
});
