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

-- better-auth v1.7.1 schema. Regenerate when bumping the pinned version, and
-- pair any new column with a backfill below: these are CREATE TABLE IF NOT
-- EXISTS, so an existing database never picks a new column up on its own.
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
  -- Added in better-auth 1.7.1. Not decorative: sign-in *matches* on it, so a
  -- row without the right value cannot authenticate. See migrateAuthSchema.
  issuer TEXT NOT NULL,
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

-- Display preferences, keyed by better-auth user id. Deliberately not a
-- foreign key on "user": prefs are disposable and a signed-out read simply
-- finds nothing, so a dangling row is cheaper than a cascade.
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_accounts (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, member_name),
  UNIQUE (trip_id, user_id)
);
`;

/**
 * Additive migrations for databases that predate a schema change.
 *
 * SCHEMA is `CREATE TABLE IF NOT EXISTS` throughout, which is why it cannot
 * carry these: an existing table is left exactly as it was found, so every
 * column added after a database was first created has to be applied here too.
 *
 * The one that forced this to exist: better-auth 1.7.1 added `account.issuer`
 * and made sign-in *match* on it —
 * `accounts.find(a => a.providerId === "credential" && a.issuer === "local:credential" && …)`.
 * A column added but left empty therefore fails every existing member's login
 * with "invalid email or password" while they type the correct one, which is
 * why the backfill is part of the same step rather than a follow-up.
 *
 * `local:credential` is not a guess: better-auth derives a local issuer as
 * `local:` + `encodeURIComponent(providerId)`, and `credential` is the only
 * provider this app enables (email+password, no OAuth), so it is the only
 * value an existing row can correctly take.
 *
 * SQLite cannot add a NOT NULL column without a DEFAULT, and a default here
 * would be a wrong value waiting to be applied silently to some later row, so
 * a migrated database ends up nullable-but-fully-populated where a fresh one
 * carries the NOT NULL that better-auth's own schema declares.
 */
function migrateAuthSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(account)").all() as { name: string }[];
  if (columns.some((column) => column.name === "issuer")) return;
  db.exec("ALTER TABLE account ADD COLUMN issuer TEXT");
  db.prepare("UPDATE account SET issuer = ? WHERE issuer IS NULL AND providerId = ?").run(
    "local:credential",
    "credential"
  );
}

export function getDb(): Database.Database {
  if (!globalThis.__cipDb) {
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    const db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    migrateAuthSchema(db);
    globalThis.__cipDb = db;
  }
  return globalThis.__cipDb;
}

/** Test helper: close and forget the cached connection. */
export function closeDb(): void {
  globalThis.__cipDb?.close();
  globalThis.__cipDb = undefined;
}
