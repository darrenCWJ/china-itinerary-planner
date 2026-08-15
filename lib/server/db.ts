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
CREATE TABLE IF NOT EXISTS expenses (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS settlements (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS journal_entries (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, id)
);
CREATE TABLE IF NOT EXISTS trip_settings (
  trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  currency_settings TEXT
);

-- better-auth v1.6.29 schema (generated 2026-08-15 via @better-auth/cli).
-- Regenerate when bumping the pinned better-auth version.
CREATE TABLE IF NOT EXISTS user (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  role TEXT,
  banned INTEGER,
  banReason TEXT,
  banExpires DATE
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT NOT NULL PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  impersonatedBy TEXT
);
CREATE TABLE IF NOT EXISTS account (
  id TEXT NOT NULL PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON session(userId);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(userId);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS member_accounts (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, member_name),
  UNIQUE (trip_id, user_id)
);
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
