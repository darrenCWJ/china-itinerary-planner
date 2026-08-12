import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** Overridable for tests via CIP_DB_PATH. */
function dbPath(): string {
  return process.env.CIP_DB_PATH ?? path.join(process.cwd(), "data", "app.db");
}

declare global {
  // Cached across Next.js dev hot reloads.
  var __cipDb: Database.Database | undefined;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  join_code TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, name)
);
CREATE TABLE IF NOT EXISTS checks (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, key)
);
CREATE TABLE IF NOT EXISTS tickets (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS wallets (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS briefings (
  code TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  include_bookings INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS briefings_trip ON briefings(trip_id);
`;

export function getDb(): Database.Database {
  if (!globalThis.__cipDb) {
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    const db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    globalThis.__cipDb = db;
  }
  return globalThis.__cipDb;
}

/** Test helper: close and forget the cached connection. */
export function closeDb(): void {
  globalThis.__cipDb?.close();
  globalThis.__cipDb = undefined;
}
