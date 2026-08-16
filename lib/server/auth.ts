import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { checkAuthSecret } from "../authSecret";
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
/**
 * Second line of defence behind instrumentation.ts, which is what actually
 * catches a missing secret at startup. This one only ever sees the
 * present-but-weak cases: the route guards on accountsEnabled() first, so an
 * absent secret 503s without reaching here. Locally it warns rather than
 * throws — no secret is the documented no-accounts planning mode.
 */
function assertSecret() {
  const check = checkAuthSecret(process.env.BETTER_AUTH_SECRET, Boolean(process.env.VERCEL));
  if (check.ok) return;
  if (check.fatal) throw new Error(check.message);
  console.warn(check.message);
}

function buildAuth() {
  assertSecret();
  return betterAuth({
    // `||`, not `??`: an env var present but empty (a bare `BETTER_AUTH_URL=`
    // line, or a blank field in a hosting dashboard) is a string, so `??`
    // would hand Better Auth an empty baseURL instead of falling back.
    baseURL: process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    database: database(),
    emailAndPassword: { enabled: true },
    plugins: [admin({ adminUserIds: adminUserIds() })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        const required = (process.env.ACCESS_CODE ?? "").trim();
        if (!required) return; // no invite configured — signups open
        const given = String(
          (ctx.body as { inviteCode?: unknown })?.inviteCode ?? ""
        ).trim();
        if (given.toUpperCase() !== required.toUpperCase()) {
          throw new APIError("FORBIDDEN", {
            message: "Wrong invite code — ask the family for it.",
          });
        }
      }),
    },
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
