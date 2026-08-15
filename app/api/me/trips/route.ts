import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/session";
import { DB_UNAVAILABLE, storeMode, tripsForUser } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to see your trips" }, { status: 401 });
  }
  return NextResponse.json({ trips: await tripsForUser(user.id) });
}
