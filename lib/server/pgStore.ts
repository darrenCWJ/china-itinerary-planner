import postgres from "postgres";
import type { MyTrip } from "../myTrips";
import { sanitizePrefs, type UserPrefs } from "../prefs";
import type {
  CurrencySettings,
  Expense,
  JournalEntry,
  Settlement,
  Ticket,
  TripCheck,
  TripData,
  TripMember,
  TripPayload,
} from "../tripShared";
import { newBriefingCode, newWalletCode } from "./ids";
import { newJoinCode, newTripId } from "./ids";
import type { BriefingRecord, JoinResult, LinkResult, UserTrip } from "./tripStore";

/**
 * Postgres (Supabase) implementation of the trip store. Used when
 * DATABASE_URL is set — see store.ts for selection logic.
 */

declare global {
  // Cached across dev hot reloads and reused across serverless invocations
  // within the same instance.
  var __cipSql: ReturnType<typeof postgres> | undefined;
  var __cipSchemaReady: Promise<void> | undefined;
}

function sql(): ReturnType<typeof postgres> {
  if (!globalThis.__cipSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__cipSql = postgres(url, {
      // Supabase's transaction pooler (pgbouncer) does not support prepared
      // statements; disabling them is required for the pooled connection URI.
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalThis.__cipSql;
}

function ensureSchema(): Promise<void> {
  if (!globalThis.__cipSchemaReady) {
    const s = sql();
    globalThis.__cipSchemaReady = (async () => {
      await s`CREATE TABLE IF NOT EXISTS trips (
        id text PRIMARY KEY,
        join_code text NOT NULL,
        name text NOT NULL,
        data jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )`;
      await s`CREATE TABLE IF NOT EXISTS members (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        name text NOT NULL,
        joined_at bigint NOT NULL,
        PRIMARY KEY (trip_id, name)
      )`;
      await s`CREATE TABLE IF NOT EXISTS checks (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        key text NOT NULL,
        checked_by text NOT NULL,
        checked_at bigint NOT NULL,
        PRIMARY KEY (trip_id, key)
      )`;
      await s`CREATE TABLE IF NOT EXISTS tickets (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS wallets (
        code text PRIMARY KEY,
        data jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )`;
      await s`CREATE TABLE IF NOT EXISTS briefings (
        code text PRIMARY KEY,
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        include_bookings boolean NOT NULL DEFAULT false,
        created_at bigint NOT NULL
      )`;
      await s`CREATE UNIQUE INDEX IF NOT EXISTS briefings_trip ON briefings(trip_id)`;
      await s`CREATE TABLE IF NOT EXISTS expenses (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS settlements (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS journal_entries (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        id text NOT NULL,
        data jsonb NOT NULL,
        created_at bigint NOT NULL,
        PRIMARY KEY (trip_id, id)
      )`;
      await s`CREATE TABLE IF NOT EXISTS trip_settings (
        trip_id text PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
        currency_settings jsonb
      )`;
      // better-auth v1.7.1 schema. Regenerate when bumping the pinned version,
      // and pair any new column with a backfill below — these are CREATE TABLE
      // IF NOT EXISTS, so an existing database never picks one up on its own.
      // Columns are double-quoted throughout: better-auth's Kysely query
      // builder always quotes identifiers, so an unquoted CREATE TABLE would
      // have Postgres fold camelCase column names (e.g. emailVerified) to
      // lowercase and every query would then fail with "column does not
      // exist". "user" is additionally a reserved word in Postgres.
      await s`CREATE TABLE IF NOT EXISTS "user" (
        "id" text NOT NULL PRIMARY KEY,
        "name" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "emailVerified" boolean NOT NULL,
        "image" text,
        "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL,
        "role" text,
        "banned" boolean,
        "banReason" text,
        "banExpires" timestamptz
      )`;
      await s`CREATE TABLE IF NOT EXISTS "session" (
        "id" text NOT NULL PRIMARY KEY,
        "expiresAt" timestamptz NOT NULL,
        "token" text NOT NULL UNIQUE,
        "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL,
        "ipAddress" text,
        "userAgent" text,
        "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "impersonatedBy" text
      )`;
      await s`CREATE TABLE IF NOT EXISTS "account" (
        "id" text NOT NULL PRIMARY KEY,
        "accountId" text NOT NULL,
        "providerId" text NOT NULL,
        "issuer" text NOT NULL,
        "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "accessToken" text,
        "refreshToken" text,
        "idToken" text,
        "accessTokenExpiresAt" timestamptz,
        "refreshTokenExpiresAt" timestamptz,
        "scope" text,
        "password" text,
        "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL
      )`;
      await s`CREATE TABLE IF NOT EXISTS "verification" (
        "id" text NOT NULL PRIMARY KEY,
        "identifier" text NOT NULL,
        "value" text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL
      )`;
      /**
       * The Postgres half of db.ts's migrateAuthSchema, and load-bearing for the
       * same reason: better-auth 1.7.1 added "issuer" and sign-in matches on it,
       * so a database created before the bump locks every existing member out —
       * with "invalid email or password", on a correct password — until the
       * column exists *and* carries `local:credential`.
       *
       * Deliberately no `SET NOT NULL`: ensureSchema gates every request, so a
       * statement that can fail on unexpected data would take the whole app
       * down rather than one login. Fresh databases get the constraint from the
       * CREATE TABLE above; migrated ones are nullable-but-populated.
       */
      await s`ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" text`;
      await s`UPDATE "account" SET "issuer" = 'local:credential'
              WHERE "issuer" IS NULL AND "providerId" = 'credential'`;
      await s`CREATE INDEX IF NOT EXISTS session_userId_idx ON "session" ("userId")`;
      await s`CREATE INDEX IF NOT EXISTS account_userId_idx ON "account" ("userId")`;
      await s`CREATE INDEX IF NOT EXISTS verification_identifier_idx ON "verification" ("identifier")`;
      // Mirrors the sqlite user_prefs table. Additive DDL inside the existing
      // bootstrap block, so a failure here still clears the cached promise
      // below and lets a later request retry.
      await s`CREATE TABLE IF NOT EXISTS user_prefs (
        user_id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at bigint NOT NULL
      )`;
      await s`CREATE TABLE IF NOT EXISTS member_accounts (
        trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        member_name text NOT NULL,
        user_id text NOT NULL,
        linked_at bigint NOT NULL,
        PRIMARY KEY (trip_id, member_name),
        UNIQUE (trip_id, user_id)
      )`;
    })().catch((err) => {
      // Allow a later request to retry instead of caching the failure forever.
      globalThis.__cipSchemaReady = undefined;
      throw err;
    });
  }
  return globalThis.__cipSchemaReady;
}

async function touch(tripId: string): Promise<void> {
  await sql()`UPDATE trips SET version = version + 1, updated_at = ${Date.now()} WHERE id = ${tripId}`;
}

export async function createTrip(
  data: TripData,
  creatorName: string
): Promise<{ id: string; joinCode: string }> {
  await ensureSchema();
  const s = sql();
  const id = newTripId();
  const joinCode = newJoinCode();
  const now = Date.now();
  await s.begin(async (tx) => {
    await tx`INSERT INTO trips (id, join_code, name, data, version, created_at, updated_at)
      VALUES (${id}, ${joinCode}, ${data.tripName}, ${s.json(JSON.parse(JSON.stringify(data)))}, 1, ${now}, ${now})`;
    await tx`INSERT INTO members (trip_id, name, joined_at) VALUES (${id}, ${creatorName}, ${now})`;
  });
  return { id, joinCode };
}

export async function getTrip(
  id: string,
  requestingMember?: string
): Promise<TripPayload | null> {
  await ensureSchema();
  const s = sql();
  const rows = await s`SELECT * FROM trips WHERE id = ${id}`;
  if (rows.length === 0) return null;
  const row = rows[0];

  /**
   * Issued together, because none of them needs another's answer — every one
   * is keyed on `id`, which was known before the trips row was even read.
   *
   * They used to be seven `await`s in a row, and on this deployment that was
   * the entire cost of loading a trip. Measured: the query WORK is 0.119 ms
   * (the same code against a local store), while seven extra sequential hops
   * over Supabase's pooler at a 30 ms round-trip is ~290 ms. The database was
   * never busy; the request was just waiting seven more times than it had to.
   *
   * `max: 1` above does not defeat this. `postgres` pipelines statements on a
   * connection — it writes them all and reads the replies as they come — so
   * one connection still collapses these into roughly one round-trip. It is
   * the awaiting that serialised them, not the pool size.
   *
   * `Promise.all` and not `allSettled`: a failing read here is a failed trip
   * load, exactly as it was when the first `await` of the seven threw.
   */
  const [
    memberRows,
    checkRows,
    ticketRows,
    expenseRows,
    settlementRows,
    journalRows,
    settingsRows,
  ] = await Promise.all([
    s`SELECT name, joined_at FROM members WHERE trip_id = ${id} ORDER BY joined_at`,
    s`SELECT key, checked_by FROM checks WHERE trip_id = ${id}`,
    s`SELECT data FROM tickets WHERE trip_id = ${id} ORDER BY created_at`,
    s`SELECT data FROM expenses WHERE trip_id = ${id} ORDER BY created_at`,
    s`SELECT data FROM settlements WHERE trip_id = ${id} ORDER BY created_at`,
    s`SELECT data FROM journal_entries WHERE trip_id = ${id} ORDER BY created_at`,
    s`SELECT currency_settings FROM trip_settings WHERE trip_id = ${id}`,
  ]);

  const members = memberRows.map(
    (m): TripMember => ({ name: m.name as string, joinedAt: Number(m.joined_at) })
  );
  const checks = checkRows.map(
    (c): TripCheck => ({ key: c.key as string, by: c.checked_by as string })
  );
  const isMember =
    requestingMember !== undefined && members.some((m) => m.name === requestingMember);

  const payload: TripPayload = {
    id: row.id as string,
    version: Number(row.version),
    updatedAt: Number(row.updated_at),
    data: row.data as TripData,
    members,
    checks,
    tickets: ticketRows.map((t) => t.data as Ticket),
    expenses: expenseRows.map((r) => r.data as Expense),
    settlements: settlementRows.map((r) => r.data as Settlement),
    journal: journalRows.map((r) => r.data as JournalEntry),
    // A fresh object literal when no settings row exists, never a shared
    // module-level instance — a caller that ever mutated a returned settings
    // object in place would otherwise poison the fallback every other trip
    // with no settings row reads.
    currencySettings:
      (settingsRows[0]?.currency_settings as CurrencySettings | null | undefined) ??
      { home: null, rates: {} },
  };
  if (isMember) payload.joinCode = row.join_code as string;
  return payload;
}

export async function isMember(tripId: string, name: string): Promise<boolean> {
  await ensureSchema();
  const rows = await sql()`SELECT 1 FROM members WHERE trip_id = ${tripId} AND name = ${name}`;
  return rows.length > 0;
}

export async function joinTrip(
  tripId: string,
  code: string,
  name: string
): Promise<JoinResult> {
  await ensureSchema();
  const s = sql();
  const rows = await s`SELECT join_code FROM trips WHERE id = ${tripId}`;
  if (rows.length === 0) return "not-found";
  if ((rows[0].join_code as string).toUpperCase() !== code.toUpperCase()) return "bad-code";
  if (await isMember(tripId, name)) return "rejoined";
  await s`INSERT INTO members (trip_id, name, joined_at) VALUES (${tripId}, ${name}, ${Date.now()})
    ON CONFLICT (trip_id, name) DO NOTHING`;
  await touch(tripId);
  return "joined";
}

export async function joinCodeMatches(tripId: string, code: string): Promise<boolean> {
  await ensureSchema();
  const rows = await sql()`SELECT join_code FROM trips WHERE id = ${tripId}`;
  if (rows.length === 0) return false;
  return (rows[0].join_code as string).toUpperCase() === code.trim().toUpperCase();
}

export async function updateTripData(tripId: string, data: TripData): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`UPDATE trips
    SET data = ${s.json(JSON.parse(JSON.stringify(data)))}, name = ${data.tripName}
    WHERE id = ${tripId}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

/**
 * Optimistic-concurrency write: only lands if nobody else has bumped the
 * trip version since it was read. False = conflict, re-read and retry.
 *
 * The guard and the bump are deliberately one statement, not a guarded UPDATE
 * followed by `touch`. As two autocommit statements they lose updates: a second
 * writer that read the same version clears the identical guard in the window
 * before the first one's bump lands, overwrites it, and both callers are told
 * true. `putWallet` has always done it this way; this is the same shape.
 */
export async function updateTripDataIf(
  tripId: string,
  data: TripData,
  expectedVersion: number
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`UPDATE trips
    SET data = ${s.json(JSON.parse(JSON.stringify(data)))}, name = ${data.tripName},
        version = version + 1, updated_at = ${Date.now()}
    WHERE id = ${tripId} AND version = ${expectedVersion}`;
  return result.count > 0;
}

export async function addTicket(tripId: string, ticket: Ticket): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const exists = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (exists.length === 0) return false;
  await s`INSERT INTO tickets (trip_id, id, data, created_at)
    VALUES (${tripId}, ${ticket.id}, ${s.json(JSON.parse(JSON.stringify(ticket)))}, ${Date.now()})`;
  await touch(tripId);
  return true;
}

export async function updateTicket(tripId: string, ticket: Ticket): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`UPDATE tickets
    SET data = ${s.json(JSON.parse(JSON.stringify(ticket)))}
    WHERE trip_id = ${tripId} AND id = ${ticket.id}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

export async function deleteTicket(tripId: string, ticketId: string): Promise<boolean> {
  await ensureSchema();
  const result = await sql()`DELETE FROM tickets WHERE trip_id = ${tripId} AND id = ${ticketId}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

/** Rebuilding the plan orphans every schedule check (item ids change). */
export async function clearScheduleChecks(tripId: string): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM checks
    WHERE trip_id = ${tripId} AND (key LIKE 'item:%' OR key LIKE 'day:%')`;
  await touch(tripId);
}

export type WalletPutResult = "ok" | "conflict" | "not-found";

export async function createWallet(trips: MyTrip[]): Promise<{ code: string }> {
  await ensureSchema();
  const s = sql();
  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newWalletCode();
    try {
      await s`INSERT INTO wallets (code, data, version, created_at, updated_at)
        VALUES (${code}, ${s.json(JSON.parse(JSON.stringify(trips)))}, 1, ${now}, ${now})`;
      return { code };
    } catch (error) {
      // 23505 = unique_violation; anything else must surface.
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Could not allocate a wallet code");
}

export async function getWallet(
  code: string
): Promise<{ trips: MyTrip[]; version: number } | null> {
  await ensureSchema();
  const rows = await sql()`SELECT data, version FROM wallets WHERE code = ${code}`;
  if (rows.length === 0) return null;
  return { trips: rows[0].data as MyTrip[], version: Number(rows[0].version) };
}

/** Version-guarded replace: "conflict" means re-fetch, re-merge, retry. */
export async function putWallet(
  code: string,
  trips: MyTrip[],
  baseVersion: number
): Promise<WalletPutResult> {
  await ensureSchema();
  const s = sql();
  const exists = await s`SELECT 1 FROM wallets WHERE code = ${code}`;
  if (exists.length === 0) return "not-found";
  const result = await s`UPDATE wallets
    SET data = ${s.json(JSON.parse(JSON.stringify(trips)))},
        version = version + 1, updated_at = ${Date.now()}
    WHERE code = ${code} AND version = ${baseVersion}`;
  return result.count === 0 ? "conflict" : "ok";
}

export async function setCheck(
  tripId: string,
  key: string,
  memberName: string,
  checked: boolean
): Promise<void> {
  await ensureSchema();
  const s = sql();
  if (checked) {
    await s`INSERT INTO checks (trip_id, key, checked_by, checked_at)
      VALUES (${tripId}, ${key}, ${memberName}, ${Date.now()})
      ON CONFLICT (trip_id, key)
      DO UPDATE SET checked_by = EXCLUDED.checked_by, checked_at = EXCLUDED.checked_at`;
  } else {
    await s`DELETE FROM checks WHERE trip_id = ${tripId} AND key = ${key}`;
  }
  await touch(tripId);
}

export async function enableBriefing(
  tripId: string,
  includeBookings: boolean
): Promise<{ code: string } | null> {
  await ensureSchema();
  const s = sql();
  const trip = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (trip.length === 0) return null;

  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newBriefingCode();
    try {
      // Atomic upsert: a concurrent enable for the same trip returns the code
      // the winner inserted instead of racing on a second INSERT. DO UPDATE
      // returns the existing row, so an already-shared link keeps its code.
      const rows = await s`INSERT INTO briefings (code, trip_id, include_bookings, created_at)
        VALUES (${code}, ${tripId}, ${includeBookings}, ${now})
        ON CONFLICT (trip_id) DO UPDATE SET include_bookings = EXCLUDED.include_bookings
        RETURNING code`;
      return { code: rows[0].code as string };
    } catch (error) {
      // 23505 can now only be the `code` primary key — trip_id conflicts are
      // absorbed by ON CONFLICT above. Anything else must surface.
      if ((error as { code?: string }).code !== "23505") throw error;
    }
  }
  throw new Error("Could not allocate a briefing code");
}

export async function revokeBriefing(tripId: string): Promise<boolean> {
  await ensureSchema();
  const result = await sql()`DELETE FROM briefings WHERE trip_id = ${tripId}`;
  return result.count > 0;
}

export async function getBriefingByCode(
  code: string
): Promise<{ tripId: string; includeBookings: boolean } | null> {
  await ensureSchema();
  const rows = await sql()`SELECT trip_id, include_bookings FROM briefings WHERE code = ${code}`;
  if (rows.length === 0) return null;
  return { tripId: rows[0].trip_id as string, includeBookings: rows[0].include_bookings === true };
}

export async function getBriefingForTrip(tripId: string): Promise<BriefingRecord | null> {
  await ensureSchema();
  const rows = await sql()`SELECT code, include_bookings FROM briefings WHERE trip_id = ${tripId}`;
  if (rows.length === 0) return null;
  return { code: rows[0].code as string, includeBookings: rows[0].include_bookings === true };
}

async function insertJsonRow(
  table: "expenses" | "settlements" | "journal_entries",
  tripId: string,
  id: string,
  data: unknown
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const exists = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (exists.length === 0) return false;
  await s`INSERT INTO ${s(table)} (trip_id, id, data, created_at)
    VALUES (${tripId}, ${id}, ${s.json(JSON.parse(JSON.stringify(data)))}, ${Date.now()})`;
  await touch(tripId);
  return true;
}

async function updateJsonRow(
  table: "expenses" | "settlements" | "journal_entries",
  tripId: string,
  id: string,
  data: unknown
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`UPDATE ${s(table)} SET data = ${s.json(JSON.parse(JSON.stringify(data)))}
    WHERE trip_id = ${tripId} AND id = ${id}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

async function deleteJsonRow(
  table: "expenses" | "settlements" | "journal_entries",
  tripId: string,
  id: string
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`DELETE FROM ${s(table)}
    WHERE trip_id = ${tripId} AND id = ${id}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
}

export async function addExpense(tripId: string, expense: Expense): Promise<boolean> {
  return insertJsonRow("expenses", tripId, expense.id, expense);
}

export async function updateExpense(tripId: string, expense: Expense): Promise<boolean> {
  return updateJsonRow("expenses", tripId, expense.id, expense);
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<boolean> {
  return deleteJsonRow("expenses", tripId, expenseId);
}

export async function addSettlement(tripId: string, settlement: Settlement): Promise<boolean> {
  return insertJsonRow("settlements", tripId, settlement.id, settlement);
}

export async function deleteSettlement(tripId: string, settlementId: string): Promise<boolean> {
  return deleteJsonRow("settlements", tripId, settlementId);
}

export async function addJournalEntry(tripId: string, entry: JournalEntry): Promise<boolean> {
  return insertJsonRow("journal_entries", tripId, entry.id, entry);
}

export async function updateJournalEntry(tripId: string, entry: JournalEntry): Promise<boolean> {
  return updateJsonRow("journal_entries", tripId, entry.id, entry);
}

export async function deleteJournalEntry(tripId: string, entryId: string): Promise<boolean> {
  return deleteJsonRow("journal_entries", tripId, entryId);
}

export async function setCurrencySettings(
  tripId: string,
  settings: CurrencySettings
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const exists = await s`SELECT 1 FROM trips WHERE id = ${tripId}`;
  if (exists.length === 0) return false;
  await s`INSERT INTO trip_settings (trip_id, currency_settings)
    VALUES (${tripId}, ${s.json(JSON.parse(JSON.stringify(settings)))})
    ON CONFLICT (trip_id) DO UPDATE SET currency_settings = EXCLUDED.currency_settings`;
  await touch(tripId);
  return true;
}

export async function linkMemberAccount(
  tripId: string,
  memberName: string,
  userId: string
): Promise<LinkResult> {
  await ensureSchema();
  const s = sql();
  const member = await s`SELECT 1 FROM members WHERE trip_id = ${tripId} AND name = ${memberName}`;
  if (member.length === 0) return "not-found";
  const nameTaken = await s`SELECT user_id FROM member_accounts
    WHERE trip_id = ${tripId} AND member_name = ${memberName}`;
  if (nameTaken.length > 0) {
    return (nameTaken[0].user_id as string) === userId ? "linked" : "name-claimed";
  }
  const userLinked = await s`SELECT 1 FROM member_accounts
    WHERE trip_id = ${tripId} AND user_id = ${userId}`;
  if (userLinked.length > 0) return "user-already-member";
  try {
    await s`INSERT INTO member_accounts (trip_id, member_name, user_id, linked_at)
      VALUES (${tripId}, ${memberName}, ${userId}, ${Date.now()})`;
  } catch (error) {
    // 23505 = unique_violation: someone else's INSERT won the race between our
    // checks above and this insert (either PRIMARY KEY (trip_id, member_name)
    // or UNIQUE (trip_id, user_id)). Re-query to classify what won instead of
    // surfacing a raw constraint error.
    if ((error as { code?: string }).code !== "23505") throw error;
    const nameTakenAfter = await s`SELECT user_id FROM member_accounts
      WHERE trip_id = ${tripId} AND member_name = ${memberName}`;
    if (nameTakenAfter.length > 0) {
      return (nameTakenAfter[0].user_id as string) === userId ? "linked" : "name-claimed";
    }
    const userLinkedAfter = await s`SELECT 1 FROM member_accounts
      WHERE trip_id = ${tripId} AND user_id = ${userId}`;
    if (userLinkedAfter.length > 0) return "user-already-member";
    throw error;
  }
  await touch(tripId);
  return "linked";
}

export async function memberNameForUser(tripId: string, userId: string): Promise<string | null> {
  await ensureSchema();
  const rows = await sql()`SELECT member_name FROM member_accounts
    WHERE trip_id = ${tripId} AND user_id = ${userId}`;
  return rows.length > 0 ? (rows[0].member_name as string) : null;
}

export async function isNameClaimed(tripId: string, memberName: string): Promise<boolean> {
  await ensureSchema();
  const rows = await sql()`SELECT 1 FROM member_accounts
    WHERE trip_id = ${tripId} AND member_name = ${memberName}`;
  return rows.length > 0;
}

/**
 * Awaitable hook for callers outside this module (the Better Auth route
 * handler) that need the auth tables to exist before Better Auth touches
 * them, without triggering a second concurrent schema run. Reuses the same
 * memoized promise every other function in this file already awaits.
 */
export function schemaReady(): Promise<void> {
  return ensureSchema();
}

export async function tripsForUser(userId: string): Promise<UserTrip[]> {
  await ensureSchema();
  // Postgres has no rowid tiebreaker; trip_id is stable-but-arbitrary and only
  // decides the rare case of the same user linking two trips in the same
  // millisecond across processes.
  const rows = await sql()`SELECT t.id, t.data, ma.member_name, ma.linked_at FROM member_accounts ma
    JOIN trips t ON t.id = ma.trip_id WHERE ma.user_id = ${userId}
    ORDER BY ma.linked_at DESC, ma.trip_id DESC`;
  const out: UserTrip[] = [];
  for (const r of rows) {
    try {
      const data = r.data as TripData;
      out.push({
        id: r.id as string,
        name: data.tripName,
        startDate: data.startDate,
        days: data.plan.days.length,
        destinationNames: data.destinationNames,
        memberName: r.member_name as string,
      });
    } catch {
      // Skip a corrupted trip rather than failing the whole list.
    }
  }
  return out;
}

/** Mirrors the sqlite reader: null for absent, and for anything unreadable. */
export async function getUserPrefs(userId: string): Promise<UserPrefs | null> {
  await ensureSchema();
  const rows = await sql()`SELECT data FROM user_prefs WHERE user_id = ${userId}`;
  if (rows.length === 0) return null;
  try {
    return sanitizePrefs(rows[0].data);
  } catch {
    return null;
  }
}

export async function setUserPrefs(userId: string, prefs: UserPrefs): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`INSERT INTO user_prefs (user_id, data, updated_at)
    VALUES (${userId}, ${s.json(JSON.parse(JSON.stringify(prefs)))}, ${Date.now()})
    ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
}
