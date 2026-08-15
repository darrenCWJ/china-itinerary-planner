import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { getDb } from "./db";
import { storeMode } from "./store";

export const ACCOUNTS_UNAVAILABLE =
  "Accounts need a BETTER_AUTH_SECRET in the deployment's environment variables. Set one (any long random string) and restart.";

export function accountsEnabled(): boolean {
  return Boolean(process.env.BETTER_AUTH_SECRET);
}

/** Comma-separated user ids granted admin (password resets). */
function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function database() {
  if (storeMode() === "postgres") {
    // Better Auth drives Postgres through pg; reuse the same DATABASE_URL
    // (Supabase transaction pooler) as the trip store.
    // Lazy import keeps pg out of the sqlite path entirely.
    const { Pool } = require("pg") as typeof import("pg");
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return getDb();
}

// Wrapped in a zero-arg function so `ReturnType<typeof buildAuth>` captures
// the exact type inferred from our literal options. `ReturnType<typeof
// betterAuth>` (betterAuth is generic) resolves against the generic's
// default type parameter instead of our call-site options and does not
// type-check against the value `betterAuth({...})` actually produces.
function buildAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    database: database(),
    emailAndPassword: { enabled: true },
    plugins: [admin({ adminUserIds: adminUserIds() })],
  });
}

declare global {
  // Cached across Next.js dev hot reloads, like the sqlite handle.
  var __cipAuth: ReturnType<typeof buildAuth> | undefined;
}

export function getAuth() {
  if (!globalThis.__cipAuth) {
    globalThis.__cipAuth = buildAuth();
  }
  return globalThis.__cipAuth;
}
