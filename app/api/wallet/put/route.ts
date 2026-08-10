import { NextRequest, NextResponse } from "next/server";
import { WalletPutSchema } from "@/lib/server/schemas";
import { DB_UNAVAILABLE, putWallet, storeMode } from "@/lib/server/store";

/** Version-guarded replace of a wallet's trip list. */
export async function POST(req: NextRequest) {
  if (storeMode() === "unavailable") {
    return NextResponse.json({ error: DB_UNAVAILABLE }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = WalletPutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid wallet update", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await putWallet(
    parsed.data.code.toUpperCase(),
    parsed.data.trips,
    parsed.data.baseVersion
  );
  if (result === "not-found") {
    return NextResponse.json({ error: "Code not found" }, { status: 404 });
  }
  if (result === "conflict") {
    return NextResponse.json({ error: "Wallet changed — re-sync" }, { status: 409 });
  }
  return NextResponse.json({ version: parsed.data.baseVersion + 1 });
}
