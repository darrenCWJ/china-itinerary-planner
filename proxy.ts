import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
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

  const decision = wallDecision({
    pathname: req.nextUrl.pathname,
    hasCode: Boolean(req.nextUrl.searchParams.get("code")),
    hasSessionCookie: getSessionCookie(req) !== null,
    accountsConfigured: Boolean(process.env.BETTER_AUTH_SECRET),
  });
  if (decision === "pass") return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // b/ stays exempt (briefing links are their own bearer secret); api/ routes
  // self-enforce auth; login/signup are the wall's own destination.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|b/|login|signup).*)"],
};
