import type { MyTrip } from "../myTrips";
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
import { DEFAULT_CURRENCY_SETTINGS } from "../tripShared";
import { getDb } from "./db";
import { newBriefingCode, newJoinCode, newTripId, newWalletCode } from "./ids";

interface TripRow {
  id: string;
  join_code: string;
  name: string;
  data: string;
  version: number;
  created_at: number;
  updated_at: number;
}

function touch(tripId: string): void {
  getDb()
    .prepare("UPDATE trips SET version = version + 1, updated_at = ? WHERE id = ?")
    .run(Date.now(), tripId);
}

type JsonRowTable = "expenses" | "settlements" | "journal_entries";

function insertJsonRow(table: JsonRowTable, tripId: string, id: string, data: unknown): boolean {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId) === undefined) return false;
  db.prepare(
    `INSERT INTO ${table} (trip_id, id, data, created_at) VALUES (?, ?, ?, ?)`
  ).run(tripId, id, JSON.stringify(data), Date.now());
  touch(tripId);
  return true;
}

function updateJsonRow(table: JsonRowTable, tripId: string, id: string, data: unknown): boolean {
  const result = getDb()
    .prepare(`UPDATE ${table} SET data = ? WHERE trip_id = ? AND id = ?`)
    .run(JSON.stringify(data), tripId, id);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

function deleteJsonRow(table: JsonRowTable, tripId: string, id: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM ${table} WHERE trip_id = ? AND id = ?`)
    .run(tripId, id);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

function readJsonRows<T>(table: JsonRowTable, tripId: string): T[] {
  const rows = getDb()
    .prepare(`SELECT data FROM ${table} WHERE trip_id = ? ORDER BY created_at`)
    .all(tripId) as { data: string }[];
  const out: T[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.data) as T);
    } catch {
      // Skip a corrupted row rather than failing the whole trip.
    }
  }
  return out;
}

export function createTrip(data: TripData, creatorName: string): { id: string; joinCode: string } {
  const db = getDb();
  const id = newTripId();
  const joinCode = newJoinCode();
  const now = Date.now();
  const insert = db.transaction(() => {
    db.prepare(
      "INSERT INTO trips (id, join_code, name, data, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)"
    ).run(id, joinCode, data.tripName, JSON.stringify(data), now, now);
    db.prepare("INSERT INTO members (trip_id, name, joined_at) VALUES (?, ?, ?)").run(
      id,
      creatorName,
      now
    );
  });
  insert();
  return { id, joinCode };
}

export function getTrip(id: string, requestingMember?: string): TripPayload | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM trips WHERE id = ?").get(id) as TripRow | undefined;
  if (!row) return null;

  const members = db
    .prepare("SELECT name, joined_at FROM members WHERE trip_id = ? ORDER BY joined_at")
    .all(id) as { name: string; joined_at: number }[];
  const checks = db
    .prepare("SELECT key, checked_by FROM checks WHERE trip_id = ?")
    .all(id) as { key: string; checked_by: string }[];
  const ticketRows = db
    .prepare("SELECT data FROM tickets WHERE trip_id = ? ORDER BY created_at")
    .all(id) as { data: string }[];

  const isMember =
    requestingMember !== undefined && members.some((m) => m.name === requestingMember);

  // A corrupted data column (e.g. OneDrive interfering with the WAL files)
  // should surface as "not found", not a 500 that hides the cause.
  let data: TripData;
  try {
    data = JSON.parse(row.data) as TripData;
  } catch {
    return null;
  }

  const tickets: Ticket[] = [];
  for (const t of ticketRows) {
    try {
      tickets.push(JSON.parse(t.data) as Ticket);
    } catch {
      // Skip a corrupted row rather than failing the whole trip.
    }
  }

  const expenses = readJsonRows<Expense>("expenses", id);
  const settlements = readJsonRows<Settlement>("settlements", id);
  const journal = readJsonRows<JournalEntry>("journal_entries", id);

  let currencySettings: CurrencySettings = DEFAULT_CURRENCY_SETTINGS;
  const settingsRow = db
    .prepare("SELECT currency_settings FROM trip_settings WHERE trip_id = ?")
    .get(id) as { currency_settings: string | null } | undefined;
  if (settingsRow?.currency_settings) {
    try {
      currencySettings = JSON.parse(settingsRow.currency_settings) as CurrencySettings;
    } catch {
      // Corrupted settings degrade to the default rather than 500ing.
    }
  }

  const payload: TripPayload = {
    id: row.id,
    version: row.version,
    updatedAt: row.updated_at,
    data,
    members: members.map((m): TripMember => ({ name: m.name, joinedAt: m.joined_at })),
    checks: checks.map((c): TripCheck => ({ key: c.key, by: c.checked_by })),
    tickets,
    expenses,
    settlements,
    journal,
    currencySettings,
  };
  if (isMember) payload.joinCode = row.join_code;
  return payload;
}

export function isMember(tripId: string, name: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM members WHERE trip_id = ? AND name = ?")
      .get(tripId, name) !== undefined
  );
}

export type JoinResult = "joined" | "rejoined" | "bad-code" | "not-found";

export function joinTrip(tripId: string, code: string, name: string): JoinResult {
  const db = getDb();
  const row = db.prepare("SELECT join_code FROM trips WHERE id = ?").get(tripId) as
    | { join_code: string }
    | undefined;
  if (!row) return "not-found";
  if (row.join_code.toUpperCase() !== code.toUpperCase()) return "bad-code";
  if (isMember(tripId, name)) return "rejoined";
  db.prepare("INSERT INTO members (trip_id, name, joined_at) VALUES (?, ?, ?)").run(
    tripId,
    name,
    Date.now()
  );
  touch(tripId);
  return "joined";
}

export function updateTripData(tripId: string, data: TripData): boolean {
  const db = getDb();
  const result = db
    .prepare("UPDATE trips SET data = ?, name = ? WHERE id = ?")
    .run(JSON.stringify(data), data.tripName, tripId);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

/**
 * Optimistic-concurrency write: only lands if nobody else has bumped the
 * trip version since it was read. False = conflict, re-read and retry.
 */
export function updateTripDataIf(
  tripId: string,
  data: TripData,
  expectedVersion: number
): boolean {
  const db = getDb();
  const result = db
    .prepare("UPDATE trips SET data = ?, name = ? WHERE id = ? AND version = ?")
    .run(JSON.stringify(data), data.tripName, tripId, expectedVersion);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

export function addTicket(tripId: string, ticket: Ticket): boolean {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId);
  if (!exists) return false;
  db.prepare("INSERT INTO tickets (trip_id, id, data, created_at) VALUES (?, ?, ?, ?)").run(
    tripId,
    ticket.id,
    JSON.stringify(ticket),
    Date.now()
  );
  touch(tripId);
  return true;
}

export function updateTicket(tripId: string, ticket: Ticket): boolean {
  const result = getDb()
    .prepare("UPDATE tickets SET data = ? WHERE trip_id = ? AND id = ?")
    .run(JSON.stringify(ticket), tripId, ticket.id);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

export function deleteTicket(tripId: string, ticketId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM tickets WHERE trip_id = ? AND id = ?")
    .run(tripId, ticketId);
  if (result.changes === 0) return false;
  touch(tripId);
  return true;
}

export function addExpense(tripId: string, expense: Expense): boolean {
  return insertJsonRow("expenses", tripId, expense.id, expense);
}

export function updateExpense(tripId: string, expense: Expense): boolean {
  return updateJsonRow("expenses", tripId, expense.id, expense);
}

export function deleteExpense(tripId: string, expenseId: string): boolean {
  return deleteJsonRow("expenses", tripId, expenseId);
}

export function addSettlement(tripId: string, settlement: Settlement): boolean {
  return insertJsonRow("settlements", tripId, settlement.id, settlement);
}

export function deleteSettlement(tripId: string, settlementId: string): boolean {
  return deleteJsonRow("settlements", tripId, settlementId);
}

export function addJournalEntry(tripId: string, entry: JournalEntry): boolean {
  return insertJsonRow("journal_entries", tripId, entry.id, entry);
}

export function updateJournalEntry(tripId: string, entry: JournalEntry): boolean {
  return updateJsonRow("journal_entries", tripId, entry.id, entry);
}

export function deleteJournalEntry(tripId: string, entryId: string): boolean {
  return deleteJsonRow("journal_entries", tripId, entryId);
}

export function setCurrencySettings(tripId: string, settings: CurrencySettings): boolean {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId) === undefined) return false;
  db.prepare(
    "INSERT INTO trip_settings (trip_id, currency_settings) VALUES (?, ?) " +
      "ON CONFLICT(trip_id) DO UPDATE SET currency_settings = excluded.currency_settings"
  ).run(tripId, JSON.stringify(settings));
  touch(tripId);
  return true;
}

/** Rebuilding the plan orphans every schedule check (item ids change). */
export function clearScheduleChecks(tripId: string): void {
  getDb()
    .prepare("DELETE FROM checks WHERE trip_id = ? AND (key LIKE 'item:%' OR key LIKE 'day:%')")
    .run(tripId);
  touch(tripId);
}

export interface WalletData {
  trips: MyTrip[];
  version: number;
}

export type WalletPutResult = "ok" | "conflict" | "not-found";

export function createWallet(trips: MyTrip[]): { code: string } {
  const db = getDb();
  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newWalletCode();
    try {
      db.prepare(
        "INSERT INTO wallets (code, data, version, created_at, updated_at) VALUES (?, ?, 1, ?, ?)"
      ).run(code, JSON.stringify(trips), now, now);
      return { code };
    } catch (error) {
      // Only a primary-key collision is worth retrying with a fresh code;
      // anything else (missing table, disk error) must surface.
      const code2 = (error as { code?: string }).code ?? "";
      if (!code2.startsWith("SQLITE_CONSTRAINT")) throw error;
    }
  }
  throw new Error("Could not allocate a wallet code");
}

export function getWallet(code: string): WalletData | null {
  const row = getDb()
    .prepare("SELECT data, version FROM wallets WHERE code = ?")
    .get(code) as { data: string; version: number } | undefined;
  if (!row) return null;
  try {
    return { trips: JSON.parse(row.data) as MyTrip[], version: Number(row.version) };
  } catch {
    return null;
  }
}

/** Version-guarded replace: "conflict" means re-fetch, re-merge, retry. */
export function putWallet(code: string, trips: MyTrip[], baseVersion: number): WalletPutResult {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM wallets WHERE code = ?").get(code);
  if (!exists) return "not-found";
  const result = db
    .prepare(
      "UPDATE wallets SET data = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?"
    )
    .run(JSON.stringify(trips), Date.now(), code, baseVersion);
  return result.changes === 0 ? "conflict" : "ok";
}

export function setCheck(tripId: string, key: string, memberName: string, checked: boolean): void {
  const db = getDb();
  if (checked) {
    db.prepare(
      "INSERT INTO checks (trip_id, key, checked_by, checked_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(trip_id, key) DO UPDATE SET checked_by = excluded.checked_by, checked_at = excluded.checked_at"
    ).run(tripId, key, memberName, Date.now());
  } else {
    db.prepare("DELETE FROM checks WHERE trip_id = ? AND key = ?").run(tripId, key);
  }
  touch(tripId);
}

export interface BriefingRecord {
  code: string;
  includeBookings: boolean;
}

/**
 * Idempotent: an existing link keeps its code so already-shared URLs survive a
 * bookings toggle. Only a revoke retires a code.
 */
export function enableBriefing(
  tripId: string,
  includeBookings: boolean
): { code: string } | null {
  const db = getDb();
  if (db.prepare("SELECT 1 FROM trips WHERE id = ?").get(tripId) === undefined) return null;

  const existing = db.prepare("SELECT code FROM briefings WHERE trip_id = ?").get(tripId) as
    | { code: string }
    | undefined;
  if (existing) {
    db.prepare("UPDATE briefings SET include_bookings = ? WHERE trip_id = ?").run(
      includeBookings ? 1 : 0,
      tripId
    );
    return { code: existing.code };
  }

  const now = Date.now();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = newBriefingCode();
    try {
      db.prepare(
        "INSERT INTO briefings (code, trip_id, include_bookings, created_at) VALUES (?, ?, ?, ?)"
      ).run(code, tripId, includeBookings ? 1 : 0, now);
      return { code };
    } catch (error) {
      // Only a primary-key collision is worth retrying with a fresh code.
      const sqliteCode = (error as { code?: string }).code ?? "";
      if (!sqliteCode.startsWith("SQLITE_CONSTRAINT")) throw error;
    }
  }
  throw new Error("Could not allocate a briefing code");
}

export function revokeBriefing(tripId: string): boolean {
  return getDb().prepare("DELETE FROM briefings WHERE trip_id = ?").run(tripId).changes > 0;
}

export function getBriefingByCode(
  code: string
): { tripId: string; includeBookings: boolean } | null {
  const row = getDb()
    .prepare("SELECT trip_id, include_bookings FROM briefings WHERE code = ?")
    .get(code) as { trip_id: string; include_bookings: number } | undefined;
  if (!row) return null;
  return { tripId: row.trip_id, includeBookings: row.include_bookings === 1 };
}

export function getBriefingForTrip(tripId: string): BriefingRecord | null {
  const row = getDb()
    .prepare("SELECT code, include_bookings FROM briefings WHERE trip_id = ?")
    .get(tripId) as { code: string; include_bookings: number } | undefined;
  if (!row) return null;
  return { code: row.code, includeBookings: row.include_bookings === 1 };
}
