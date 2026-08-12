import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, accessToken } from "@/lib/access";

/**
 * When ACCESS_CODE is set, every page and API route requires the unlock
 * cookie. Visitors without it are sent to /unlock (pages) or get a 401
 * (API calls). With no ACCESS_CODE configured the site is open.
 */
export async function proxy(req: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) return NextResponse.next();

  const cookie = req.cookies.get(ACCESS_COOKIE)?.value;
  if (cookie && cookie === (await accessToken(accessCode))) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Access code required — unlock the site first" },
      { status: 401 }
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // `b/` is exempt: a briefing code is itself a 60-bit bearer secret, and the
  // recipient of a shared link will not have the site's access code.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|unlock|api/unlock|b/).*)"],
};
