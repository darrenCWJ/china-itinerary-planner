import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * Coverage for the account row itself — signing up, signing back in, and
 * surviving a schema bump.
 *
 * This file exists because the suite had none of it. better-auth 1.7.1 added a
 * required `account.issuer` that no embedded schema carried, and types, 833
 * tests and `next build` were all green on the upgrade: nothing anywhere drove
 * a signup, so nothing noticed that account creation was broken outright. The
 * gap, not the column, is what made that possible.
 *
 * Everything here goes through `getAuth().api`, the same entry point the route
 * handlers use, against the real embedded schema on a temp database.
 */

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-auth-accounts-"));
process.env.CIP_DB_PATH = path.join(dbDir, "accounts.db");
// A usable-looking secret, so getAuth() boots instead of refusing (authBoot.test.ts
// covers the refusal). Local, not a deployment: the wall stays off either way.
process.env.BETTER_AUTH_SECRET = "k3Nv8xQ2mR7pL0wZaB6tY4hJ1cF9sD5gE2uI8oP3nA0";
delete process.env.VERCEL;

const { getAuth } = await import("./auth");
const { getDb, closeDb } = await import("./db");

/** What better-auth derives for an email+password account: `local:` + providerId. */
const CREDENTIAL_ISSUER = "local:credential";

const CREDENTIALS = {
  email: "member@example.com",
  password: "correct-horse-battery-staple",
  name: "Member",
};

interface AccountRow {
  providerId: string;
  issuer: string | null;
  password: string | null;
}

const accountRow = (): AccountRow =>
  getDb().prepare("SELECT providerId, issuer, password FROM account").get() as AccountRow;

/**
 * Drop both cached singletons, so the next `getDb()` reopens the file — running
 * the migration — and the next `getAuth()` binds to that new connection.
 *
 * Auth has to go too, not just the database: `buildAuth()` resolves the
 * connection once and holds it, so clearing only `closeDb()` leaves better-auth
 * talking to a closed handle ("The database connection is not open").
 */
function reopen(): void {
  closeDb();
  delete globalThis.__cipAuth;
}

afterAll(() => {
  closeDb();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("email+password accounts against the embedded schema", () => {
  beforeAll(async () => {
    await getAuth().api.signUpEmail({ body: CREDENTIALS });
  });

  test("signing up writes an account row the schema can hold", () => {
    // The regression in one line: on 1.7.1 against the 1.6.29 schema this threw
    // `SqliteError: table account has no column named issuer` before any
    // assertion could run.
    const row = accountRow();
    expect(row.providerId).toBe("credential");
    expect(row.password).toBeTruthy();
  });

  test("stamps the issuer better-auth looks the account up by", () => {
    expect(accountRow().issuer).toBe(CREDENTIAL_ISSUER);
  });

  test("the new account can sign back in", async () => {
    const result = await getAuth().api.signInEmail({
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
    });

    expect(result.user.email).toBe(CREDENTIALS.email);
  });

  test("a wrong password is still refused", async () => {
    await expect(
      getAuth().api.signInEmail({
        body: { email: CREDENTIALS.email, password: "not-the-password" },
      })
    ).rejects.toThrow();
  });
});

/**
 * The upgrade path, which is the half that cannot be checked by creating a
 * fresh database: every existing deployment already has an `account` table, and
 * `CREATE TABLE IF NOT EXISTS` leaves it exactly as found.
 *
 * What makes this worth a test rather than a comment is the failure mode. 1.7.1
 * does not merely store the issuer, it *matches* on it when signing in, so a
 * database carrying the old shape rejects every member's correct password with
 * "invalid email or password" — a lockout that reads like a user error and
 * would not have raised a single failing test.
 */
describe("a database created before better-auth 1.7.1", () => {
  const legacy = { email: "legacy@example.com", password: "old-account-password", name: "Legacy" };
  /** Column names as they stood *before* reopening, i.e. before the migration ran. */
  let columnsBefore: string[] = [];

  beforeAll(async () => {
    await getAuth().api.signUpEmail({ body: legacy });

    // Reproduce the 1.6.29 table shape exactly, keeping the real password hash
    // so the sign-in below exercises the genuine path rather than a re-signup.
    getDb().exec("ALTER TABLE account DROP COLUMN issuer");
    columnsBefore = (getDb().prepare("PRAGMA table_info(account)").all() as { name: string }[]).map(
      (column) => column.name
    );

    reopen();
  });

  test("really did arrive without the column", () => {
    // Guards the guard. Read before the reopen on purpose: asking after it
    // describes the migrated table, so this assertion would hold on a database
    // that never needed migrating and the three below would prove nothing.
    expect(columnsBefore).not.toContain("issuer");
    expect(columnsBefore).toContain("password");
  });

  test("adds the column on open", () => {
    const columns = getDb().prepare("PRAGMA table_info(account)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain("issuer");
  });

  test("backfills the issuer rather than leaving it empty", () => {
    const rows = getDb()
      .prepare("SELECT issuer FROM account WHERE providerId = 'credential'")
      .all() as { issuer: string | null }[];

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.issuer).toBe(CREDENTIAL_ISSUER);
  });

  test("lets a member who predates the bump sign in with their existing password", async () => {
    // The whole point. Adding the column without the backfill passes every
    // other assertion in this file and still fails here.
    const result = await getAuth().api.signInEmail({
      body: { email: legacy.email, password: legacy.password },
    });

    expect(result.user.email).toBe(legacy.email);
  });
});
