import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { wallDecision } from "@/lib/wall";

/**
 * Compulsory-login wall. Optimistic: checks only that a Better Auth session
 * cookie exists — validity is enforced by the per-route session gates. With
 * no BETTER_AUTH_SECRET configured the site is open (local planning mode).
 */
export async function proxy(req: NextRequest) {
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
