import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, accessToken, safeEqual } from "@/lib/access";

const UnlockSchema = z.object({ code: z.string().min(1).max(100) });

export async function POST(req: NextRequest) {
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    // Gate not configured — nothing to unlock.
    return NextResponse.json({ ok: true, open: true });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UnlockSchema.safeParse(body);
  if (!parsed.success || !safeEqual(parsed.data.code.trim(), accessCode)) {
    return NextResponse.json({ error: "That access code isn't right" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: ACCESS_COOKIE,
    value: await accessToken(accessCode),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  return res;
}
