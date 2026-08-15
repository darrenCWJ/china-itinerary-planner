import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "cip-auth-schema-"));
process.env.CIP_DB_PATH = path.join(dbDir, "test.db");

import { closeDb, getDb } from "./db";

describe("embedded better-auth schema", () => {
  beforeAll(() => closeDb());
  afterAll(() => {
    closeDb();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  test("auth tables exist after boot", () => {
    const names = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["user", "session", "account", "verification"]) {
      expect(names).toContain(t);
    }
  });

  test("admin plugin columns are present", () => {
    const cols = getDb()
      .prepare("PRAGMA table_info(user)")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(cols).toContain("role");
    expect(cols).toContain("banned");
  });
});
