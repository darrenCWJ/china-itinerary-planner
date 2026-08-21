import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAuthTables } from "better-auth/db";
import { admin } from "better-auth/plugins";
import { describe, expect, test } from "vitest";

/**
 * Holds both embedded auth schemas against better-auth's own table definitions.
 *
 * This gate exists because of how the `issuer` bump got as far as it did. The
 * SQLite and Postgres schemas are hand-maintained copies of something
 * better-auth declares itself, and nothing compared them to the source of
 * truth — so 1.7.1 adding a required column left both stores silently short of
 * one, and a full green suite plus `next build` said nothing was wrong.
 *
 * Asking better-auth directly, rather than restating the column list here,
 * is the point: the next column it adds fails this file on the version bump
 * that introduces it, in both stores at once, instead of in production.
 *
 * Blunt on purpose — it reads the DDL as text, in the same spirit as the other
 * source scans in this repo. It checks that every declared field has a column,
 * not that types or constraints match; `pgStore` uses timestamptz where SQLite
 * uses DATE, and that divergence is deliberate.
 */

/** The exact options buildAuth() passes — the plugin set changes the columns. */
const AUTH_TABLES = getAuthTables({
  emailAndPassword: { enabled: true },
  plugins: [admin({ adminUserIds: [] })],
});

const read = (file: string) => readFileSync(join(process.cwd(), "lib", "server", file), "utf8");

/** Column names inside `CREATE TABLE … ( … )`, for either quoting style. */
function columnsOf(source: string, table: string): string[] {
  // SQLite: `CREATE TABLE IF NOT EXISTS account (`; Postgres quotes the name.
  const start = new RegExp(`CREATE TABLE IF NOT EXISTS "?${table}"?\\s*\\(`).exec(source);
  if (!start) throw new Error(`no CREATE TABLE for "${table}"`);

  const body = source.slice(start.index + start[0].length);
  const end = body.indexOf("\n)");
  if (end === -1) throw new Error(`unterminated CREATE TABLE for "${table}"`);

  return body
    .slice(0, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("--"))
    // A column line starts with its name; table constraints start with a keyword.
    .filter((line) => !/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(line))
    .map((line) => line.replace(/^"?([A-Za-z_][A-Za-z0-9_]*)"?[\s,].*$/, "$1"))
    .filter(Boolean);
}

const STORES = [
  { label: "sqlite (db.ts)", source: read("db.ts") },
  { label: "postgres (pgStore.ts)", source: read("pgStore.ts") },
] as const;

describe.each(STORES)("$label carries every better-auth column", ({ source }) => {
  for (const [key, definition] of Object.entries(AUTH_TABLES)) {
    const table = definition.modelName ?? key;
    // `id` is implicit in better-auth's field list but a real column in the DDL.
    const expected = ["id", ...Object.keys(definition.fields)].sort();

    test(`${table}`, () => {
      const actual = columnsOf(source, table);
      for (const column of expected) expect(actual).toContain(column);
    });
  }
});

describe("the column that taught us to write this file", () => {
  test("both stores declare account.issuer", () => {
    // Named explicitly as well as covered by the sweep above, so a future
    // refactor of the parser cannot quietly stop checking the one column whose
    // absence locks every existing member out of their account.
    for (const { source } of STORES) expect(columnsOf(source, "account")).toContain("issuer");
  });
});
