import type { NextRequest } from "next/server";
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
