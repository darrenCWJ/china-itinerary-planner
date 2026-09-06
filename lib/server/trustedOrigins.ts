/**
 * The origins Better Auth accepts a browser request from, beyond its base URL.
 *
 * `BETTER_AUTH_URL` is one value shared by Vercel's Preview and Production
 * environments and names the production alias, and Better Auth trusts only
 * that origin by default — so every preview deployment, and the two
 * secondary production aliases, answered 403 "Invalid origin" on sign-in.
 *
 * Two sources, in this order:
 *
 *   1. `TRUSTED_ORIGINS`, the comma-separated manual list the README has
 *      always documented. Entries pass through verbatim: Better Auth's own
 *      wildcard syntax (`https://*.example.com`) is theirs to interpret.
 *   2. The hosts Vercel sets on every deployment — `VERCEL_URL` (this
 *      deployment's unique host), `VERCEL_BRANCH_URL` (its git-branch alias)
 *      and `VERCEL_PROJECT_PRODUCTION_URL` (the production domain) — each
 *      made an https origin. They are absent locally and on any other host,
 *      where this adds nothing.
 *
 * Derived per deployment rather than a team-wide wildcard on purpose: a
 * wildcard over `*-<team>.vercel.app` would trust every project the team ever
 * deploys, where this trusts exactly the aliases of the deployment answering
 * the request. The bare `<project>-<team>.vercel.app` alias is in no system
 * variable and stays untrusted unless someone lists it.
 */
const VERCEL_HOST_VARS = [
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

/** `host`, `https://host/`, `http://host/path?q` → `https://host`. */
function asHttpsOrigin(value: string): string {
  const host = value.replace(/^https?:\/\//i, "").replace(/[/?#].*$/, "");
  return `https://${host}`;
}

export function trustedOriginsFrom(
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const listed = (env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const derived = VERCEL_HOST_VARS.map((name) => env[name]?.trim() ?? "")
    .filter(Boolean)
    .map(asHttpsOrigin);
  return Array.from(new Set([...listed, ...derived]));
}
