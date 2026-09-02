import { afterEach, describe, expect, it } from "vitest";
import type { TripData } from "../tripShared";
import { getTrip, updateTripDataIf } from "./pgStore";

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

/**
 * `getTrip` reads eight tables. Only the first depends on nothing — the other
 * seven are keyed on the same `id`, which is known before any of them run.
 *
 * Issued one `await` at a time they cost eight round-trips, and on this app's
 * deployment that is the whole of the latency: measured against the real store
 * with the database local, `getTrip`'s query WORK is 0.119 ms, while eight
 * sequential hops over a pooler at 30 ms RTT is 291 ms. Same queries, same
 * rows, 2,400x the wall clock — and none of it visible in a test that only
 * checks the returned shape.
 *
 * So this asserts the ISSUE ORDER rather than a duration: no timing, no
 * threshold to tune, and it fails for the one reason that matters. Sequential
 * code cannot have issued the eighth statement while the first is still
 * unresolved; parallel code cannot have failed to.
 */
describe("getTrip — how many round-trips it costs", () => {
  /** A recorder whose queries stay pending until the test releases them. */
  function installDeferred() {
    const statements: Statement[] = [];
    const release: ((rows: unknown[]) => void)[] = [];
    const tag = (strings: TemplateStringsArray, ...params: unknown[]) => {
      statements.push({ text: strings.join("$"), params });
      return new Promise((resolve) => {
        release.push((rows) => resolve(Object.assign(rows, { count: rows.length })));
      });
    };
    (tag as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
    globalThis.__cipSql = tag as never;
    globalThis.__cipSchemaReady = Promise.resolve();
    return { statements, release };
  }

  /** Let every already-queued microtask run, without advancing real time. */
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it("issues the seven id-keyed reads together, not one after another", async () => {
    const { statements, release } = installDeferred();

    const pending = getTrip("trip-1");
    await flush();

    // Only the trips row can be in flight yet: nothing else is issued until it
    // is known the trip exists at all, which is a real dependency and stays.
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toMatch(/FROM trips/);

    release[0]([
      { id: "trip-1", join_code: "ABCD", version: 1, updated_at: 1, data: DATA },
    ]);
    await flush();

    // The seven that follow depend on each other for nothing.
    expect(
      statements.length,
      `only ${statements.length} of 8 statements issued — the reads are still serialised`
    ).toBe(8);
    for (const i of [1, 2, 3, 4, 5, 6, 7]) release[i]([]);

    const payload = await pending;
    expect(payload?.id).toBe("trip-1");
    expect(payload?.members).toEqual([]);
    expect(payload?.currencySettings).toEqual({ home: null, rates: {} });
  });

  it("still reads every table it needs, and each one exactly once", async () => {
    // The parallel form is a `Promise.all` over a literal array, which is
    // exactly the shape a careless edit drops an entry from — and losing one
    // silently returns a trip with no tickets rather than failing.
    const { statements, release } = installDeferred();
    const pending = getTrip("trip-1");
    await flush();
    release[0]([{ id: "trip-1", join_code: "A", version: 1, updated_at: 1, data: DATA }]);
    await flush();
    for (let i = 1; i < statements.length; i += 1) release[i]([]);
    await pending;

    for (const table of [
      "members",
      "checks",
      "tickets",
      "expenses",
      "settlements",
      "journal_entries",
      "trip_settings",
    ]) {
      // `\\b` and not `\b`: inside a template literal the latter is a backspace
      // character, so the pattern matches nothing and every table reads as
      // missing — which is how this test first failed against correct code.
      const hits = statements.filter((st) => new RegExp(`FROM ${table}\\b`).test(st.text));
      expect(hits, `expected exactly one read of ${table}`).toHaveLength(1);
    }
  });
});
