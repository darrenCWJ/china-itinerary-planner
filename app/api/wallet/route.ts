import { NextRequest, NextResponse } from "next/server";
import { WalletCreateSchema } from "@/lib/server/schemas";
import { accountsEnabled } from "@/lib/server/auth";
import { getSessionUser } from "@/lib/server/session";
import { createWallet, DB_UNAVAILABLE, storeMode } from "@/lib/server/store";

/** Create a trip wallet seeded with this device's list; returns the code. */
export async function POST(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  if (accountsEnabled()) {
    const user = await getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = WalletCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid wallet", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { code } = await createWallet(parsed.data.trips);
  return NextResponse.json({ code, version: 1 }, { status: 201 });
}
