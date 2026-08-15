import { NextResponse, type NextRequest } from "next/server";
import { accountsEnabled, ACCOUNTS_UNAVAILABLE } from "./auth";
import { getSessionUser } from "./session";
import { joinCodeMatches, memberNameForUser } from "./store";

export type TripAccess =
  | { kind: "member"; memberName: string }
  | { kind: "guest" }
  | { kind: "none" };

/**
 * The single classification every trip route uses:
 * member (linked account) > guest (valid join code) > none.
 * Legacy plain-name members are NOT members here — editing requires an
 * account; unclaimed names are claimed via the join flow.
 */
export async function resolveTripAccess(
  tripId: string,
  userId: string | null,
  code: string | null
): Promise<TripAccess> {
  if (userId) {
    const memberName = await memberNameForUser(tripId, userId);
    if (memberName) return { kind: "member", memberName };
  }
  // joinCodeMatches returns false for unknown trips, so this also covers
  // the missing-trip case without a second store read.
  if (code && (await joinCodeMatches(tripId, code))) return { kind: "guest" };
  return { kind: "none" };
}

export async function tripAccessFromRequest(
  req: NextRequest,
  tripId: string
): Promise<TripAccess> {
  const user = await getSessionUser(req);
  const code = req.nextUrl.searchParams.get("code");
  return resolveTripAccess(tripId, user?.id ?? null, code);
}

/**
 * The mutating-route gate: resolves the caller to a member name or returns
 * the error response the route should send verbatim.
 */
export async function requireMember(
  req: NextRequest,
  tripId: string
): Promise<{ memberName: string } | NextResponse> {
  if (!accountsEnabled()) {
    return NextResponse.json({ error: ACCOUNTS_UNAVAILABLE }, { status: 503 });
  }
  const access = await tripAccessFromRequest(req, tripId);
  if (access.kind === "member") return { memberName: access.memberName };
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to make changes" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Only trip members can make changes — join the trip first" },
    { status: 403 }
  );
}
