import { checkAuthSecret } from "@/lib/authSecret";

/**
 * Next.js calls this once per server instance, before any request is served.
 *
 * It has to live here rather than in the auth module: app/api/auth/[...all]
 * short-circuits to 503 via accountsEnabled() *before* it ever builds the auth
 * instance, so a missing secret would never reach a check placed in there —
 * which is precisely the case that matters, since lib/wall.ts also turns the
 * login wall off when the secret is absent. Throwing here makes a deployment
 * without a usable secret fail to start instead of quietly serving every page
 * to the public.
 */
export function register() {
  const check = checkAuthSecret(process.env.BETTER_AUTH_SECRET, Boolean(process.env.VERCEL));
  if (check.ok) return;
  if (check.fatal) throw new Error(check.message);
  console.warn(check.message);
}
