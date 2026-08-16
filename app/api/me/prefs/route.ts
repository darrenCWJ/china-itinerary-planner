import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_PREFS, PREFS_COOKIE, serializePrefsCookie } from "@/lib/prefs";
import { PrefsSchema } from "@/lib/server/schemas";
import { getSessionUser } from "@/lib/server/session";
import { DB_UNAVAILABLE, getUserPrefs, setUserPrefs, storeMode } from "@/lib/server/store";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function GET(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to see your preferences" }, { status: 401 });
  }
  return NextResponse.json({ prefs: (await getUserPrefs(user.id)) ?? DEFAULT_PREFS });
}

export async function PUT(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to save your preferences" }, { status: 401 });
  }

  const parsed = PrefsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Those preferences aren't valid" }, { status: 400 });
  }

  await setUserPrefs(user.id, parsed.data);

  // Deliberately not HttpOnly: the first-paint inline script reads this to set
  // the theme before React hydrates, which is the whole point of the cookie
  // existing alongside the row. It carries a theme enum and bounded integers,
  // and every read runs it back through the allowlist.
  //
  // The header is written by hand rather than through the cookie helper so the
  // value stays byte-identical to what the client writes and the inline script
  // reads — no percent-encoding to decode in three separate places.
  const response = NextResponse.json({ prefs: parsed.data });
  response.headers.set(
    "Set-Cookie",
    `${PREFS_COOKIE}=${serializePrefsCookie(parsed.data)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax`
  );
  return response;
}
