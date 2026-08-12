import postgres from "postgres";
import type { MyTrip } from "../myTrips";
import type { Ticket, TripCheck, TripData, TripMember, TripPayload } from "../tripShared";
import { newBriefingCode, newWalletCode } from "./ids";
import { newJoinCode, newTripId } from "./ids";
import type { BriefingRecord, JoinResult } from "./tripStore";

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

  const memberRows = await s`SELECT name, joined_at FROM members WHERE trip_id = ${id} ORDER BY joined_at`;
  const checkRows = await s`SELECT key, checked_by FROM checks WHERE trip_id = ${id}`;
  const ticketRows = await s`SELECT data FROM tickets WHERE trip_id = ${id} ORDER BY created_at`;

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
 */
export async function updateTripDataIf(
  tripId: string,
  data: TripData,
  expectedVersion: number
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const result = await s`UPDATE trips
    SET data = ${s.json(JSON.parse(JSON.stringify(data)))}, name = ${data.tripName}
    WHERE id = ${tripId} AND version = ${expectedVersion}`;
  if (result.count === 0) return false;
  await touch(tripId);
  return true;
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
