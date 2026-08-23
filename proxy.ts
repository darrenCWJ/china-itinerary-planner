import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { checkAuthSecret } from "@/lib/authSecret";
import { wallDecision } from "@/lib/wall";

let warnedLockLoss = false;

/**
 * Compulsory-login wall. Optimistic: checks only that a Better Auth session
 * cookie exists — validity is enforced by the per-route session gates. With
 * no BETTER_AUTH_SECRET configured the site is open (local planning mode).
 */
export async function proxy(req: NextRequest) {
  // Deployments that used ACCESS_CODE as a site-wide gate pre-upgrade but
  // never set BETTER_AUTH_SECRET silently lose that gate: accounts stay
  // off, so the wall passes everything through. Warn once so this doesn't
  // go unnoticed after a routine redeploy.
  if (process.env.ACCESS_CODE && !process.env.BETTER_AUTH_SECRET && !warnedLockLoss) {
    warnedLockLoss = true;
    console.warn(
      "ACCESS_CODE is set but BETTER_AUTH_SECRET is not — the site gate is gone and the site is OPEN. Set BETTER_AUTH_SECRET to enable the login wall."
    );
  }

  const secret = checkAuthSecret(process.env.BETTER_AUTH_SECRET, Boolean(process.env.VERCEL));

  const decision = wallDecision({
    pathname: req.nextUrl.pathname,
    hasCode: Boolean(req.nextUrl.searchParams.get("code")),
    hasSessionCookie: getSessionCookie(req) !== null,
    accountsConfigured: Boolean(process.env.BETTER_AUTH_SECRET),
    secretFatal: !secret.ok && secret.fatal,
  });
  if (decision === "pass") return NextResponse.next();

  // Misconfigured deployment: serve nothing, loudly, rather than serve the
  // whole site to the public. 503 (not 500) says "come back later" to
  // crawlers, and no-store keeps a CDN from caching the outage past the fix.
  // The fix needs a redeploy either way — env vars are read at build.
  if (decision === "refuse") {
    console.error(secret.ok ? "wall refused" : secret.message);
    return new NextResponse("Service unavailable — this deployment is misconfigured.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;

  // no-store: a cached redirect is worse than an uncached one. next.config.ts
  // puts a 24h public cache on the topology assets, and without this header
  // that cache rides along on THIS redirect whenever the request is
  // signed-out — an expired session, a prefetch, a shared link. The browser
  // (or a shared/corporate proxy) then has a day-long redirect to /login
  // parked under the asset's URL: the picker's fetch follows it, the parser
  // chokes on login HTML, and the picker's own "Try again" button hits that
  // same cached redirect instead of a fresh request. no-store keeps every
  // redirect this wall issues live, so signing in actually fixes it.
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}

// Static-asset boundary: this matcher only exempts favicon.ico by name.
// Everything else under public/ (images, manifest files, etc.) is NOT
// excluded here and sits behind the wall like any other page route — it's
// simply never hit today because nothing currently links to a public/
// asset from an exempt surface. Any future asset referenced from /b/* or
// a guest view will need its own exemption added to this matcher, or it
// will 404-via-redirect for signed-out visitors instead of loading.
//
// api/, b/, login and signup used to be excluded here too. They aren't any
// more, because a path the proxy never sees is a path the refusal above
// can't take down — and "the whole thing" has to mean the whole thing.
// Nothing changes for the wall itself: wallDecision already passes all four
// by name, so they were exempt twice over and now are exempt once, in the
// file that spells out why.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
